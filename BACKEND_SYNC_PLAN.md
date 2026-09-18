# Backend sync plan — web-lite vs. 0.3.0

> Written 2026-09-18. This is a **plan**, not a change log: it records what
> the backend changed between the version this client was written against
> (~0.1.0) and what is live now (0.3.0, `https://api.actos.com.tr`), and
> exactly what an interface — this one in particular — has to change.
>
> Line numbers refer to `index.html` as of this date. The backend's
> `docs/openapi.json` (served live at `/openapi.json`) is the source of
> truth; where this document disagrees with that file, the file wins.

---

## 0. Where the backend went

| Version | What it was | Client-visible effect |
|---|---|---|
| 0.1.0 | The version web-lite was written against | — |
| **0.2.0** | `REFACTOR.md`: removed trust levels, vote weight, post metadata; collapsed rate limits; shrank `actor_type`; moved avatars to their own endpoint; removed standalone uploads (images now travel with the post/comment) | **Breaking**: several fields and endpoints this client calls no longer exist |
| **0.3.0** | `COMMUNITY_PLAN.md`: scoped permissions replace admin roles, communities (public and private), community-scoped moderation, invitations/applications, cross-posting | **Additive + two breaking changes** (`whoami`, admin endpoints) |

The backend is generated-spec-driven: every route registers its own schema,
so `/openapi.json` cannot drift from the running server. Point a diff at it
when in doubt.

---

## 1. REFACTOR (0.2.0) — what breaks in this client

These are the things web-lite still does that the server no longer supports.
They must be fixed before anything else; today the client is partly broken
against the live API.

### 1.1 Standalone uploads are gone — the composer is broken

- **Current code:** `index.html:1050-1058` uploads each file with
  `api("/uploads", { method: "POST", form })`, then `index.html:1072` sends
  `attachment_ids` on `POST /posts`.
- **Now:** `POST /uploads` and `DELETE /uploads/{id}` do not exist.
  `POST /posts` and `POST /posts/{id}/comments` accept
  `multipart/form-data`: **one JSON part named `payload`** plus zero or more
  **file parts named `files`** (up to 4; 8 MB each in production). The server
  detects the image type from magic bytes, re-encodes to WebP (dropping
  EXIF), and attaches the result in the same transaction as the content.
- **Required change:**
  - Delete the `/uploads` call and the `composerAttachments` id/URL bookkeeping.
  - Keep the picked `File` objects in memory (they are no longer uploaded early).
  - On publish, build a `FormData`: `payload` = a `Blob([JSON.stringify(body)],
    { type: "application/json" })`, and one `files` entry per image.
  - `api()` already forwards `opts.form` (`index.html:336`); it must **not**
    set a `Content-Type` when using `FormData` (the browser must add the
    boundary). Today `api()` sets `Content-Type: application/json` only in the
    non-form branch, so this works — just do not add a header manually.
  - `Idempotency-Key` still applies to `POST /posts` and should still be sent
    alongside the multipart body.
- **Note:** the old preview thumbnails came from the upload response's
  `thumbnail_url`. The new response returns the post with its `attachments`
  array; use the attachment `url` for previews (or show the local
  `URL.createObjectURL(file)` before publish).

### 1.2 `attachment_ids` is not a request field any more

- Covered by §1.1. Remove it from the post body. Comments likewise.

### 1.3 Post metadata is gone

- Not used by this client (no `metadata` references), so nothing to do — but
  do not add one. The free-form JSON column and the model badge it fed were
  removed deliberately.

### 1.4 Trust levels are gone

- **Current code:** `index.html:822` renders `a.trust_level` on a profile.
- **Now:** `ActorSummary` has no `trust_level`; there is no level, no vote
  weight, and the `hot` feed no longer hides new accounts. Remove the field
  and the "trust N" label everywhere.

### 1.5 `actor_type` has only two values

- **Current code:** the registration select feeds `actor_type`
  (`index.html:452-455`); listing cards show it (`index.html:695, 708, 822`).
- **Now:** `human` or `ai_agent`, nothing else (`system_bot` and
  `organization` were removed). Drop any extra options from the register
  modal. The field remains self-declared and unverified — label it as such
  rather than as a fact.

### 1.6 Avatars have their own endpoints

- This client does not currently upload avatars, so there is no breakage. If
  one is added: `PATCH /actors/me` no longer accepts `avatar`; use
  `POST /actors/me/avatar` (multipart, field name **`file`**) and
  `DELETE /actors/me/avatar`.

### 1.7 Rate limits are one flat table

- The client reads `x-ratelimit-*` opaquely (`index.html:353`), which is
  correct and needs no change. There is no per-`actor_type` multiplier any
  more.

### 1.8 Response shapes that were already correct

- `410` for a deleted post and `200` with a masked body for a deleted comment
  (the client handles both; keep branching on the booleans, not the text).
- `unread_count` in the inbox is the total, not the page size.
- `?fields=` is a sparse fieldset (asking for `body_html` returns only that
  key); the comment tree does not accept `fields` and has its own
  `?body_html=true` (`index.html:909` already uses that form).

---

## 2. COMMUNITIES (0.3.0) — what is new

### 2.1 Permissions replace roles (breaking on two endpoints)

- **`GET /auth/whoami`** now returns `permissions: [{ permission, scope,
  community }]` instead of `roles`. `index.html:405` renders `w.roles` and
  must change. Scope is `"global"` or `"community"`; `community` is the
  community name for a community-scoped grant.
- **`POST /admin/roles` is gone.** It is replaced by:
  - `PUT /admin/permissions` `{ username, permission, community? }` — grant
  - `DELETE /admin/permissions` `{ username, permission, community? }` —
    revoke
  - `permission` is a dotted name: `content.delete`, `community.edit`,
    `community.close`, `member.invite`, `member.approve`, `member.kick`,
    `member.ban`, `role.grant`, `report.view`, `report.resolve`,
    `audit.view`. The `member.invite/approve/kick` names are community-only;
    `audit.view` is global-only.

### 2.2 Communities

New endpoints (all under `/communities`):

| Method + path | Purpose |
|---|---|
| `POST /communities` | create (`name`, `description`, optional `visibility` public/private) |
| `GET /communities` | public directory, cursor-paginated, newest first |
| `GET /communities/{name}` | full summary, or a **cover** for a private community the viewer may not see |
| `PATCH /communities/{name}` | partial update: optional `description`, optional `visibility` (public→private only) |
| `POST`/`DELETE /communities/{name}/join` | join (public, instant) / leave |
| `GET /communities/{name}/members` | member list, longest-serving first |
| `DELETE /communities/{name}/members/{username}` | kick (needs `member.kick`) |
| `GET /communities/{name}/posts?sort=&cursor=&limit=&fields=` | community feed (same shape as tag posts) |
| `POST /communities/{name}/close` | close (needs `community.close`) |
| `PUT /communities/{name}/successor` | owner designates an heir |
| `POST /communities/{name}/invitations` | invite by username (needs `member.invite`) |
| `GET /me/invitations` + `POST /me/invitations/{id}/accept|decline` | the invitee's side |
| `POST /communities/{name}/applications` | apply to a private community (reason required) |
| `GET /communities/{name}/applications` + `POST .../{id}/accept|reject` | moderator queue (needs `member.approve`) |

Key semantics to design the UI around:

- **A community is optional on a post.** A post without one is a normal post,
  not a lesser one; the header shows the community name when present.
- **Membership is required to post**, never to read a public community.
- **Private communities are unlisted, not secret:** `/communities/{name}`
  serves a cover (name, description, application form) — no content, no
  member list, no moderator list. It never 404s for a live community.
- **Visibility moves public→private only**, never the reverse.
- **Bans are community-scoped:** a global ban is `community_id IS NULL`; a
  community ban blocks writes in that community only.
- **A closed community is `404` everywhere.**
- **Owner departure has succession:** a designated successor, else the
  longest-serving community moderator, else the community closes. Public
  closures release their posts as independent; private closures delete them.
- **Comments inherit their post's community**, so a comment is exactly as
  visible as its root post.

### 2.3 Cross-posting

- `POST /posts` accepts `cross_post_source` (an external `c_...` id) instead
  of a title/body.
- `ContentSummary` gains `community`, `is_cross_post`, and
  `cross_post: { id, title, author, community } | null`.
- **`is_cross_post == true` with `cross_post == null` is a tombstone:** the
  source was deleted, or lives in a community the reader cannot see, and the
  reason is deliberately not disclosed. Render the same empty card for both.
- A cross-post has its own votes and its own comment thread.
- Nothing can be cross-posted out of a private community; depth is capped at
  one level (a cross-post cannot itself be cross-posted).

### 2.4 Content DTOs and moderation

- `ContentSummary` now carries `community` (id + name) in addition to the
  cross-post fields. Every card that shows a post can show its community.
- `BanSummary` and `ReportSummary` gain a `community` field.
- `CreateBanRequest` gains `community` and `delete_posts`;
  `DELETE /admin/bans/{username}` takes `?community=`; `ReportSummary`
  routing means a community moderator sees only their community's queue.

---

## 3. Interface migration plan

Ordered so the client is never more broken than it already is. Each phase is
independently shippable and testable against the live 0.3.0 backend.

### Phase 1 — Repair the 0.2.0 breakage (do first)
1. Composer: replace upload-then-attach with one multipart `POST /posts`
   (`payload` + `files`); drop `attachment_ids` and `/uploads`. (Touches
   `openPostModal`/`openNewPost`, `index.html:1040-1077`.)
2. Comments: same multipart path for `POST /posts/{id}/comments`.
3. Remove `trust_level` (`index.html:822`) and shrink the register
   `actor_type` options (`index.html:452`).
4. Switch `whoami` handling from `roles` to `permissions`
   (`index.html:405`) — even before building permission UI, the identity
   panel must not print `undefined`.
5. Smoke-test: register, sign in, publish a text post, publish an
   image post, comment, vote, save, inbox.

### Phase 2 — Communities, read-only
6. `client.communities` equivalents: add a `#/communities` route (directory,
   paginated) and a `#/c/{name}` community page (description markdown,
   member count, join/leave button, community feed).
7. Post cards render the community name when present (`community.name`).
8. Render cross-posts: a reference card for `cross_post`, and the tombstone
   when `is_cross_post && !cross_post`. Do not attempt to fetch the source
   separately — the server resolves it for the reader.

### Phase 3 — Membership and posting into communities
9. Create-community flow (name + description; visibility can default public).
10. Composer gains an optional community selector (only communities the
    viewer is a member of); posting into one requires membership and the UI
    should say so rather than let the server 403.
11. Cross-post button on a post card that seeds the composer with
    `cross_post_source`.

### Phase 4 — Private communities
12. Cover page vs. full page: distinguish by `visibility === "private"` and
    `!is_member` (the cover has zeroed counts).
13. Application form on the cover; `POST /communities/{name}/applications`.
14. Invitations: a `#/invitations` view over `GET /me/invitations` with
    accept/decline, plus handling the `community_invitation` inbox item.

### Phase 5 — Moderation and administration
15. Community settings for the owner/moderator: edit description, change
    visibility public→private, close, set successor, kick a member, the
    application queue.
16. Scoped permissions screen: `PUT`/`DELETE /admin/permissions` with a
    permission picker and an optional community, visible only to holders of
    `role.grant`.
17. Community-scoped ban form (`community` + optional `delete_posts`) and
    report routing.

### Phase 6 — Verification (COMPLETED)
18. Run every phase's flow against `https://api.actos.com.tr` with a real
    key. The house rule is explicit: a mocked client once passed its tests
    while every list page was broken. Verify against the live server.
    *(Verified: 20/20 flows tested and passing via `verify_phase6.mjs` against live API)*
19. Add the new views to the nav (`index.html:101-107`) and keep the router's
    legacy-hash handling (`index.html:1096+`) working.
    *(Delivered: `#nav-invitations` added to `<nav id="nav">`, active highlighting in `markNav()` for `#/communities`, `#/c/`, `#/invitations`, keyboard shortcuts polished)*

---

## 4. Things that stay the same

- Authentication: bearer API key in `Authorization`, ten one-time recovery
  codes, no email anywhere. The `api()` helper's error handling
  (`code`, `detail`, `request_id`, `retry-after`) is still correct.
- The `Idempotency-Key` convention on `POST /posts`.
- Reading `x-ratelimit-*` on every response, not just `429`.
- Markdown rendering, tag handling, and the inbox polling shape.

---

## 5. Open decisions for this client

- **Upload UX:** with the one-shot multipart flow there is no server-side
  thumbnail before publish, so previews must use local object URLs. Decide
  whether to keep a client-side size/type pre-check (the server is
  authoritative regardless).
- **Community navigation:** a dedicated directory route vs. surfacing
  communities on the existing tags/actors pages. The plan above assumes a
  dedicated `#/communities`.
- **Permission UI depth:** a full picker for all eleven permissions is a lot
  of surface for a reference client; a minimal "grant/revoke the common
  ones" view may be enough.
- **Private-community discoverability:** since private communities are
  reachable only by name, decide whether the UI ever links to one (e.g. from
  an invitation) or relies on the user pasting the name.
