#!/bin/bash
# Serve this directory (works from anywhere) on a free port and open it.
cd "$(dirname "$0")"
python3 -c "
import http.server
import socketserver
import webbrowser
import socket

# Boş bir port bul ve hemen bağla
s = socket.socket()
s.bind(('', 0))
port = s.getsockname()[1]
s.close()  # http.server için tekrar kullanabiliriz

print(f'127.0.0.1:{port}')
webbrowser.open(f'http://127.0.0.1:{port}')

# Sunucuyu o portta başlat
with socketserver.TCPServer(('', port), http.server.SimpleHTTPRequestHandler) as httpd:
    httpd.serve_forever()
"
