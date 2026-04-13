#!/bin/bash
# Fully uninstall kent — stops services, removes data, and unlinks the global binary.

set -e

echo "Uninstalling Kent..."
echo ""

# Stop daemon if running
if [ -f ~/.kent/daemon.pid ]; then
  PID=$(cat ~/.kent/daemon.pid)
  kill "$PID" 2>/dev/null && echo "  Stopped daemon (PID $PID)" || echo "  Daemon not running"
fi

# Kill any process bound to Kent's ports (API: 19456) and any stray Kent processes
for port in 19456; do
  PIDS=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "  Killing processes on port $port: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
done

# Kill any lingering Kent binaries (Kent.app, kent-server, kent-daemon, kent-agent)
pkill -9 -f "Kent\.app/Contents/MacOS" 2>/dev/null || true
pkill -9 -x "kent-server" 2>/dev/null || true
pkill -9 -x "kent-daemon" 2>/dev/null || true
pkill -9 -x "kent-agent" 2>/dev/null || true
echo "  Killed lingering Kent processes"

# Unload and remove LaunchAgent plists
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/sh.kent.daemon.plist 2>/dev/null || true
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/sh.kent.web.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/sh.kent.daemon.plist
rm -f ~/Library/LaunchAgents/sh.kent.web.plist
echo "  Removed launchd services"

# Remove global binary (handles both npm install and bun link)
bun remove -g meet-kent 2>/dev/null || true
rm -f ~/.bun/bin/kent 2>/dev/null || true
echo "  Removed global kent binary"

# Remove Kent.app from /Applications
rm -rf "/Applications/Kent.app"
echo "  Removed /Applications/Kent.app"

# Remove Chrome app shortcut (if installed as Chrome app)
rm -rf ~/Applications/Chrome\ Apps.localized/Kent*.app 2>/dev/null || true
rm -rf ~/Applications/Chrome\ Apps/Kent*.app 2>/dev/null || true
echo "  Removed Chrome app shortcut (if any)"

# Nuke data
rm -rf ~/.kent
echo "  Removed ~/.kent"

echo ""
echo "Kent fully uninstalled."
