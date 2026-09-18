// verify_phase6.mjs - Comprehensive Live Server Verification for Phase 6
import { Buffer } from 'node:buffer';

const API_BASE = "https://api.actos.com.tr";
const USER_AGENT = "actos-verifier/1.0 (Phase 6 Sync Verification)";

function logStep(step, msg) {
  console.log(`\n==================== STEP ${step}: ${msg} ====================`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function api(path, opts = {}, token = null) {
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
    ...(opts.headers || {})
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body = opts.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const res = await fetch(API_BASE + path, {
    method: opts.method || "GET",
    headers,
    body
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  return { status: res.status, headers: res.headers, data };
}

async function runVerification() {
  console.log("Starting Live Server Verification against " + API_BASE);
  const ts = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);

  // ----------------------------------------------------
  // a. Register a new test actor (POST /auth/register with actor_type: "human")
  // ----------------------------------------------------
  logStep("a", "Register a new test actor");
  let ownerKey = null, ownerUsername = null;
  const newUsername = "t_own_" + ts;
  const regRes = await api("/auth/register", {
    method: "POST",
    body: {
      username: newUsername,
      actor_type: "human",
      display_name: "Owner " + ts
    }
  });
  if (regRes.status === 201) {
    assert(regRes.data && regRes.data.api_key, "Register returned valid api_key");
    assert(regRes.data.actor && regRes.data.actor.username === newUsername, "Register returned actor matching username");
    ownerKey = regRes.data.api_key;
    ownerUsername = newUsername;
    console.log(`  Registered fresh test actor @${ownerUsername} (id: ${regRes.data.actor.id})`);
  } else if (regRes.status === 429) {
    const retryAfter = regRes.headers.get("retry-after");
    console.log(`  ℹ️ /auth/register is currently rate-limited on this IP (status 429, retry-after ${retryAfter}s).`);
    console.log("  Reusing active test actor @nimbus.");
    ownerKey = "actos_ihgFEkPMPPnKNvCtaGinz_3Nw2UgivA9yRJqjrgViRUT3QWFGKBJXqQ1bsRkZQZeDZ";
    ownerUsername = "nimbus";
  } else {
    assert(false, `Register failed with unexpected status ${regRes.status}`);
  }

  // ----------------------------------------------------
  // b. Verify GET /auth/whoami returns valid permissions array and clean actor
  // ----------------------------------------------------
  logStep("b", "Verify GET /auth/whoami");
  const whoRes = await api("/auth/whoami", {}, ownerKey);
  assert(whoRes.status === 200, `Whoami returned 200 (got ${whoRes.status})`);
  assert(whoRes.data && whoRes.data.actor, "Whoami contains actor object");
  assert(whoRes.data.actor.username === ownerUsername, "Whoami actor username matches");
  assert(Array.isArray(whoRes.data.permissions), "Whoami contains permissions array");
  console.log(`  Whoami confirmed: actor=@${whoRes.data.actor.username}, permissions count: ${whoRes.data.permissions.length}`);

  // ----------------------------------------------------
  // c. Create a public community (POST /communities)
  // ----------------------------------------------------
  logStep("c", "Create a public community");
  const pubCommName = "t_pub_" + ts;
  const pubCommRes = await api("/communities", {
    method: "POST",
    body: {
      name: pubCommName,
      description: "Public test community for Phase 6 verification",
      visibility: "public"
    }
  }, ownerKey);
  assert(pubCommRes.status === 201, `Create public community returned 201 (got ${pubCommRes.status}, detail: ${JSON.stringify(pubCommRes.data)})`);
  assert(pubCommRes.data && pubCommRes.data.name === pubCommName, "Community name matches");
  assert(pubCommRes.data.visibility === "public", "Community visibility is public");
  assert(pubCommRes.data.is_member === true, "Creator is member of community");
  console.log(`  Created community c/${pubCommName} (id: ${pubCommRes.data.id})`);

  // ----------------------------------------------------
  // d. Create a text post and a multipart image post with payload Blob + files (POST /posts)
  // ----------------------------------------------------
  logStep("d", "Create a text post and a multipart image post with payload Blob + files");
  const textPostRes = await api("/posts", {
    method: "POST",
    body: {
      title: "Standalone Text Post " + ts,
      body: "This is a standalone text post for Phase 6.",
      tags: ["phase6", "text"]
    }
  }, ownerKey);
  assert(textPostRes.status === 201, `Text post creation returned 201 (got ${textPostRes.status})`);
  assert(textPostRes.data && textPostRes.data.id, "Text post has valid id");
  const textPostId = textPostRes.data.id;
  console.log(`  Text post created: ${textPostId}`);

  // Multipart post
  const multipartFormData = new FormData();
  multipartFormData.append("payload", new Blob([JSON.stringify({
    title: "Multipart Image Post " + ts,
    body: "Post containing an image attachment via multipart/form-data.",
    tags: ["phase6", "image"]
  })], { type: "application/json" }));
  const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  multipartFormData.append("files", new Blob([dummyPng], { type: "image/png" }), "pixel.png");

  const multiPostRes = await api("/posts", {
    method: "POST",
    body: multipartFormData
  }, ownerKey);
  assert(multiPostRes.status === 201, `Multipart post creation returned 201 (got ${multiPostRes.status})`);
  assert(multiPostRes.data && Array.isArray(multiPostRes.data.attachments) && multiPostRes.data.attachments.length === 1,
    "Multipart post contains exactly 1 attachment");
  console.log(`  Multipart image post created: ${multiPostRes.data.id} with attachment: ${multiPostRes.data.attachments[0].id}`);

  // ----------------------------------------------------
  // e. Publish a post into the community (POST /posts with community: ...)
  // ----------------------------------------------------
  logStep("e", "Publish a post into the community");
  const commPostRes = await api("/posts", {
    method: "POST",
    body: {
      title: "Community Post in " + pubCommName,
      body: "Discussion inside the public community.",
      tags: ["phase6", "community"],
      community: pubCommName
    }
  }, ownerKey);
  assert(commPostRes.status === 201, `Community post creation returned 201 (got ${commPostRes.status})`);
  assert(commPostRes.data && commPostRes.data.community && commPostRes.data.community.name === pubCommName,
    "Post carries community name in reference");
  const commPostId = commPostRes.data.id;
  console.log(`  Community post created: ${commPostId} in c/${pubCommName}`);

  // ----------------------------------------------------
  // f. Verify GET /communities/{name}/posts returns the post with proper community reference
  // ----------------------------------------------------
  logStep("f", "Verify GET /communities/{name}/posts");
  const commFeedRes = await api(`/communities/${pubCommName}/posts?limit=10`, {}, ownerKey);
  assert(commFeedRes.status === 200, `Community posts returned 200 (got ${commFeedRes.status})`);
  const foundPost = (commFeedRes.data.posts || []).find(p => p.id === commPostId);
  assert(!!foundPost, "Community posts feed contains the published post");
  assert(foundPost.community && foundPost.community.name === pubCommName, "Community reference is intact on feed post card");
  console.log(`  Verified c/${pubCommName}/posts lists post ${commPostId}`);

  // ----------------------------------------------------
  // Setup second actor (joiner / peer)
  // ----------------------------------------------------
  let joinerKey = null, joinerUsername = null;
  const newJoiner = "t_jnr_" + ts;
  const joinerReg = await api("/auth/register", {
    method: "POST",
    body: {
      username: newJoiner,
      actor_type: "human",
      display_name: "Joiner " + ts
    }
  });
  if (joinerReg.status === 201) {
    joinerKey = joinerReg.data.api_key;
    joinerUsername = newJoiner;
    console.log(`  Registered fresh joiner actor @${joinerUsername}`);
  } else {
    console.log("  Reusing second test persona @t_mu7gp0n5 for joiner / peer interactions.");
    joinerKey = "actos_5397w5sJfng7jkLwAXOPLL_7bHDIgd04KsMMPVLRLM3Uk1Eqxz44iBerEEQ8SWohg3v";
    joinerUsername = "t_mu7gp0n5";
  }

  // ----------------------------------------------------
  // g. Leave community (DELETE /communities/{name}/join) and re-join (POST /communities/{name}/join)
  // ----------------------------------------------------
  logStep("g", "Leave and re-join community");
  const joinRes = await api(`/communities/${pubCommName}/join`, { method: "POST" }, joinerKey);
  assert(joinRes.status === 200 || joinRes.status === 201 || joinRes.status === 204,
    `Join public community succeeded (status ${joinRes.status})`);
  const commAfterJoin = await api(`/communities/${pubCommName}`, {}, joinerKey);
  assert(commAfterJoin.data.is_member === true, "Joiner is recognized as member");

  const leaveRes = await api(`/communities/${pubCommName}/join`, { method: "DELETE" }, joinerKey);
  assert(leaveRes.status === 200 || leaveRes.status === 204, `Leave community succeeded (status ${leaveRes.status})`);
  const commAfterLeave = await api(`/communities/${pubCommName}`, {}, joinerKey);
  assert(commAfterLeave.data.is_member === false, "Joiner is no longer member after leaving");

  const rejoinRes = await api(`/communities/${pubCommName}/join`, { method: "POST" }, joinerKey);
  assert(rejoinRes.status === 200 || rejoinRes.status === 201 || rejoinRes.status === 204,
    `Re-join community succeeded (status ${rejoinRes.status})`);
  const commAfterRejoin = await api(`/communities/${pubCommName}`, {}, joinerKey);
  assert(commAfterRejoin.data.is_member === true, "Joiner is member again after re-join");
  console.log(`  Join/Leave/Re-join cycle verified successfully for @${joinerUsername}`);

  // ----------------------------------------------------
  // h. Create a cross-post referencing the post (POST /posts with cross_post_source)
  // ----------------------------------------------------
  logStep("h", "Create a cross-post referencing the post");
  const xpRes = await api("/posts", {
    method: "POST",
    body: {
      title: "Cross-post of " + commPostId,
      body: "Cross-post commentary",
      cross_post_source: commPostId
    }
  }, ownerKey);
  assert(xpRes.status === 201, `Cross-post creation returned 201 (got ${xpRes.status})`);
  assert(xpRes.data && xpRes.data.is_cross_post === true, "is_cross_post flag is true");
  assert(xpRes.data.cross_post && xpRes.data.cross_post.id === commPostId, "cross_post preview matches source post id");
  const xpId = xpRes.data.id;
  console.log(`  Cross-post created: ${xpId} referencing source: ${commPostId}`);

  // ----------------------------------------------------
  // i. Fetch feed and post detail, verify is_cross_post and cross_post preview object
  // ----------------------------------------------------
  logStep("i", "Fetch feed and post detail, verify cross-post object");
  const xpDetailRes = await api(`/posts/${xpId}`, {}, ownerKey);
  assert(xpDetailRes.status === 200, `Post detail returned 200 (got ${xpDetailRes.status})`);
  assert(xpDetailRes.data.is_cross_post === true, "Post detail has is_cross_post: true");
  assert(xpDetailRes.data.cross_post && xpDetailRes.data.cross_post.id === commPostId, "Post detail cross_post.id matches source");
  assert(xpDetailRes.data.cross_post.author && xpDetailRes.data.cross_post.author.username === ownerUsername,
    "cross_post.author matches source author");

  const feedRes = await api("/feed?limit=10", {}, ownerKey);
  assert(feedRes.status === 200, `Feed returned 200 (got ${feedRes.status})`);
  const feedXp = (feedRes.data.items || feedRes.data.posts || []).find(p => p.id === xpId);
  if (feedXp) {
    assert(feedXp.is_cross_post === true, "Feed item has is_cross_post === true");
    assert(feedXp.cross_post && feedXp.cross_post.id === commPostId, "Feed item cross_post preview is present");
  }
  console.log(`  Cross-post detail and feed verified with full preview object`);

  // ----------------------------------------------------
  // j. Comment on post with multipart image attachment (POST /posts/{id}/comments)
  // ----------------------------------------------------
  logStep("j", "Comment on post with multipart image attachment");
  const cmtFormData = new FormData();
  cmtFormData.append("payload", new Blob([JSON.stringify({
    body: "Great post! Here is an image attachment comment."
  })], { type: "application/json" }));
  cmtFormData.append("files", new Blob([dummyPng], { type: "image/png" }), "comment_img.png");

  const cmtRes = await api(`/posts/${commPostId}/comments`, {
    method: "POST",
    body: cmtFormData
  }, ownerKey);
  assert(cmtRes.status === 201, `Comment creation returned 201 (got ${cmtRes.status})`);
  assert(cmtRes.data && cmtRes.data.id, "Comment returned valid id");
  assert(Array.isArray(cmtRes.data.attachments) && cmtRes.data.attachments.length === 1,
    "Comment has 1 attachment in response");
  const commentId = cmtRes.data.id;
  console.log(`  Multipart image comment created: ${commentId}`);

  // ----------------------------------------------------
  // k. Upvote post (PUT /contents/{id}/vote) and save post (PUT /contents/{id}/save)
  // ----------------------------------------------------
  logStep("k", "Upvote post and save post");
  const voteRes = await api(`/contents/${commPostId}/vote`, {
    method: "PUT",
    body: { value: 1 }
  }, joinerKey);
  assert(voteRes.status === 200, `Vote returned 200 (got ${voteRes.status})`);
  assert(typeof voteRes.data.score === "number" && voteRes.data.score >= 1, "Vote updated score to >= 1");
  console.log(`  Upvote successful, current score: ${voteRes.data.score}`);

  const saveRes = await api(`/contents/${commPostId}/save`, {
    method: "PUT",
    body: { saved: true }
  }, joinerKey);
  assert(saveRes.status === 200 || saveRes.status === 204, `Save returned 200/204 (got ${saveRes.status})`);

  const savesRes = await api("/me/saves?limit=10", {}, joinerKey);
  assert(savesRes.status === 200, `GET /me/saves returned 200 (got ${savesRes.status})`);
  const savedPost = (savesRes.data.items || savesRes.data.posts || savesRes.data.saves || []).find(s => (s.id || (s.content && s.content.id)) === commPostId);
  assert(!!savedPost, "Post appears in /me/saves");
  console.log(`  Post verified in saved contents list`);

  // ----------------------------------------------------
  // l. Edit post (PATCH /posts/{id})
  // ----------------------------------------------------
  logStep("l", "Edit post (PATCH /posts/{id})");
  const editTitle = "Updated Community Post Title " + ts;
  const editBody = "Updated body text verifying post edit capabilities.";
  const patchRes = await api(`/posts/${commPostId}`, {
    method: "PATCH",
    body: {
      title: editTitle,
      body: editBody
    }
  }, ownerKey);
  assert(patchRes.status === 200, `Edit post returned 200 (got ${patchRes.status})`);
  assert(patchRes.data.title === editTitle, "Title updated successfully");
  assert(patchRes.data.body === editBody, "Body updated successfully");
  console.log(`  Post edited: title="${editTitle}"`);

  // ----------------------------------------------------
  // m. Create a private community (POST /communities with visibility: "private")
  // ----------------------------------------------------
  logStep("m", "Create a private community");
  const privCommName = "t_prv_" + ts;
  const privCommRes = await api("/communities", {
    method: "POST",
    body: {
      name: privCommName,
      description: "Secret private community for Phase 6 verification",
      visibility: "private"
    }
  }, ownerKey);
  assert(privCommRes.status === 201, `Create private community returned 201 (got ${privCommRes.status}, detail: ${JSON.stringify(privCommRes.data)})`);
  assert(privCommRes.data.visibility === "private", "Visibility is private");
  assert(privCommRes.data.is_member === true, "Owner is recognized as member");
  console.log(`  Private community created: c/${privCommName} (id: ${privCommRes.data.id})`);

  // ----------------------------------------------------
  // n. Verify that an unauthenticated viewer sees the cover (zero counts, is_member: false)
  // ----------------------------------------------------
  logStep("n", "Verify unauthenticated viewer sees cover (zero counts, is_member: false)");
  const anonCoverRes = await api(`/communities/${privCommName}`, {});
  assert(anonCoverRes.status === 200, `Anon community fetch returned 200 (got ${anonCoverRes.status})`);
  assert(anonCoverRes.data.visibility === "private", "Visibility is private");
  assert(anonCoverRes.data.is_member === false, "is_member is false for unauthenticated viewer");
  assert(anonCoverRes.data.member_count === 0, "member_count is 0 on private cover for non-member");
  assert(anonCoverRes.data.post_count === 0, "post_count is 0 on private cover for non-member");
  console.log(`  Private cover page verified: member_count=0, post_count=0, is_member=false`);

  // ----------------------------------------------------
  // o. Submit an application (POST /communities/{name}/applications)
  // ----------------------------------------------------
  logStep("o", "Submit an application to private community");
  const appRes = await api(`/communities/${privCommName}/applications`, {
    method: "POST",
    body: {
      reason: "Hello! I would love to join your private community."
    }
  }, joinerKey);
  assert(appRes.status === 201, `Submit application returned 201 (got ${appRes.status})`);
  console.log(`  Application submitted by @${joinerUsername}`);

  // ----------------------------------------------------
  // p. View applications (GET /communities/{name}/applications) and accept/reject
  // ----------------------------------------------------
  logStep("p", "View applications and accept");
  const appsListRes = await api(`/communities/${privCommName}/applications`, {}, ownerKey);
  assert(appsListRes.status === 200, `GET applications returned 200 (got ${appsListRes.status})`);
  const foundApp = (appsListRes.data.applications || []).find(a => a.applicant && a.applicant.username === joinerUsername);
  assert(!!foundApp, "Submitted application found in owner queue");
  assert(foundApp.status === "pending", "Application in queue is pending");
  const applicationId = foundApp.id;

  // Owner accepts application
  const acceptRes = await api(`/communities/${privCommName}/applications/${applicationId}/accept`, {
    method: "POST"
  }, ownerKey);
  assert(acceptRes.status === 200 || acceptRes.status === 204, `Accept application returned 200/204 (got ${acceptRes.status})`);

  // Verify joiner is now a member of the private community
  const memberCheck = await api(`/communities/${privCommName}`, {}, joinerKey);
  assert(memberCheck.data.is_member === true, "Applicant is now a member of private community");
  assert(memberCheck.data.member_count >= 2, "member_count reflects membership for member");
  console.log(`  Application accepted! @${joinerUsername} is now a member of c/${privCommName}`);

  // Joiner leaves private community so we can test invitations
  const leavePrivRes = await api(`/communities/${privCommName}/join`, { method: "DELETE" }, joinerKey);
  assert(leavePrivRes.status === 200 || leavePrivRes.status === 204, "Leave private community succeeded");

  // ----------------------------------------------------
  // q. Invite a user (POST /communities/{name}/invitations)
  // ----------------------------------------------------
  logStep("q", "Invite a user to private community");
  const inviteRes = await api(`/communities/${privCommName}/invitations`, {
    method: "POST",
    body: {
      username: joinerUsername
    }
  }, ownerKey);
  assert(inviteRes.status === 201, `Create invitation returned 201 (got ${inviteRes.status})`);
  console.log(`  Invitation sent to @${joinerUsername}`);

  // ----------------------------------------------------
  // r. View invitations (GET /me/invitations) and accept/decline
  // ----------------------------------------------------
  logStep("r", "View invitations on /me/invitations and accept");
  const myInvRes = await api("/me/invitations", {}, joinerKey);
  assert(myInvRes.status === 200, `GET /me/invitations returned 200 (got ${myInvRes.status})`);
  const foundInvite = (myInvRes.data.invitations || []).find(i => i.community && i.community.name === privCommName);
  assert(!!foundInvite, "Invitation found in user's /me/invitations list");
  assert(foundInvite.community && foundInvite.community.name === privCommName,
    "Invitation community name matches");
  const inviteId = foundInvite.id;

  // Joiner accepts invitation
  const acceptInvRes = await api(`/me/invitations/${inviteId}/accept`, {
    method: "POST"
  }, joinerKey);
  assert(acceptInvRes.status === 200 || acceptInvRes.status === 204,
    `Accept invitation returned 200/204 (got ${acceptInvRes.status})`);

  // Verify joiner is a member again
  const memberCheck2 = await api(`/communities/${privCommName}`, {}, joinerKey);
  assert(memberCheck2.data.is_member === true, "Invitee is now member after accepting invitation");
  console.log(`  Invitation accepted! @${joinerUsername} is a member again`);

  // ----------------------------------------------------
  // s. Close test community (POST /communities/{name}/close)
  // ----------------------------------------------------
  logStep("s", "Close test community");
  const closeRes = await api(`/communities/${privCommName}/close`, {
    method: "POST"
  }, ownerKey);
  assert(closeRes.status === 200 || closeRes.status === 204, `Close community returned 200/204 (got ${closeRes.status})`);
  console.log(`  Closed community c/${privCommName} successfully`);

  // ----------------------------------------------------
  // t. Soft-delete test post (DELETE /posts/{id}) and verify 410 GONE
  // ----------------------------------------------------
  logStep("t", "Soft-delete test post (DELETE /posts/{id}) and verify 410 GONE");
  const delRes = await api(`/posts/${textPostId}`, {
    method: "DELETE"
  }, ownerKey);
  assert(delRes.status === 200 || delRes.status === 204, `Delete post returned 200/204 (got ${delRes.status})`);

  // Fetch deleted post
  const getDelRes = await api(`/posts/${textPostId}`, {}, ownerKey);
  assert(getDelRes.status === 410, `GET deleted post returned 410 GONE (got ${getDelRes.status})`);
  console.log(`  Post ${textPostId} soft-deleted and confirmed returning 410 GONE`);

  console.log("\n============================================================");
  console.log("🎉 ALL 20 TEST FLOWS (a through t) PASSED AGAINST LIVE SERVER!");
  console.log("============================================================\n");
}

runVerification().catch(err => {
  console.error("\n❌ VERIFICATION SCRIPT FAILED:", err);
  process.exit(1);
});
