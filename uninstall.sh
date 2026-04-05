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

# Unload and remove LaunchAgent plists
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/sh.kent.daemon.plist 2>/dev/null || true
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/sh.kent.web.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/sh.kent.daemon.plist
rm -f ~/Library/LaunchAgents/sh.kent.web.plist
echo "  Removed launchd services"

# Remove global binary
bun remove -g meet-kent 2>/dev/null && echo "  Removed global kent binary" || true

# Nuke data
rm -rf ~/.kent
echo "  Removed ~/.kent"

echo ""
echo "Kent fully uninstalled."
