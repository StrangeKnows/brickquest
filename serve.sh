#!/bin/bash
echo "Finding your IP address..."
IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
echo ""
echo "═══════════════════════════════════════"
echo "  Server starting..."
echo "  Open on Android: http://$IP:8080/arena_test.html"
echo "═══════════════════════════════════════"
echo ""
cd "$(dirname "$0")"
python3 -m http.server 8080
