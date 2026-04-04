#!/bin/bash
# Reset kent to a clean state (dev only)

# Stop daemon if running
if [ -f ~/.kent/daemon.pid ]; then
  PID=$(cat ~/.kent/daemon.pid)
  kill "$PID" 2>/dev/null && echo "Stopped daemon (PID $PID)" || echo "Daemon not running"
fi

# Unload and remove LaunchAgent plists
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/sh.kent.daemon.plist 2>/dev/null
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/sh.kent.web.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/sh.kent.daemon.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/sh.kent.web.plist 2>/dev/null

# Nuke everything
rm -rf ~/.kent
echo "Removed ~/.kent"
echo "Done. Run 'bun run cli/index.ts init' to start fresh."
