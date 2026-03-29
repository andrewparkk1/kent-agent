#!/bin/bash
# Kent CLI demo script for asciinema recording
#
# Prerequisites:
#   brew install asciinema
#   bun run scripts/mock-data.ts   # populate Convex with demo data
#
# Record:
#   asciinema rec kent-demo.cast -c "bash scripts/demo.sh"
#
# Upload:
#   asciinema upload kent-demo.cast

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

# Simulates typing a command character by character
type_cmd() {
  local cmd="$1"
  echo -ne "${GREEN}\$ ${NC}"
  for (( i=0; i<${#cmd}; i++ )); do
    echo -n "${cmd:$i:1}"
    sleep 0.04
  done
  echo ""
  sleep 0.3
}

# Section divider
section() {
  echo ""
  echo -e "${CYAN}─── $1 ───${NC}"
  echo ""
  sleep 1
}

clear

echo -e "${BOLD}"
echo "  _  __          _   "
echo " | |/ /___ _ __ | |_ "
echo " | ' // _ \ '_ \| __|"
echo " | . \  __/ | | | |_ "
echo " |_|\_\___|_| |_|\__|"
echo -e "${NC}"
echo "Personal AI Agent CLI — Demo"
echo ""
sleep 2

# --------------------------------------------------
# 1. Daemon status
# --------------------------------------------------
section "Check daemon status"

type_cmd "kent daemon status"
sleep 0.5
echo -e "  ${GREEN}●${NC} Daemon running (PID 48291)"
echo "  Last sync:   2 minutes ago"
echo "  Items:       1,247 indexed"
echo "  Sources:     iMessage (623) · Gmail (312) · GitHub (187) · Granola (89) · Chrome (36)"
echo "  Uptime:      3h 42m"
sleep 3

# --------------------------------------------------
# 2. Sync iMessage
# --------------------------------------------------
section "Sync a specific source"

type_cmd "kent sync --source imessage"
sleep 0.5
echo "  [imessage] Connecting to chat.db..."
sleep 0.8
echo "  [imessage] Reading messages since last sync..."
sleep 1.2
echo "  [imessage] Found 23 new messages"
echo "  [imessage] Pushing to Convex..."
sleep 0.6
echo -e "  ${GREEN}✓${NC} Synced 23 new messages (1,270 total)"
sleep 3

# --------------------------------------------------
# 3. Ask a question
# --------------------------------------------------
section "Ask Kent a question"

type_cmd "kent run \"what should I focus on today?\""
sleep 1
echo ""
echo -e "  ${DIM}[searching memory...]${NC}"
sleep 1.5
echo -e "  ${DIM}[reading 12 items across 4 sources...]${NC}"
sleep 1
echo ""
echo "  Based on your recent activity, here's what needs attention:"
echo ""
sleep 0.5
echo "  1. **API migration PR** — Sarah left 3 comments on your PR"
echo "     #247 (kent-cli/backend) asking about the retry logic."
echo "     Last comment was 4 hours ago."
sleep 0.8
echo ""
echo "  2. **Q1 planning follow-up** — In yesterday's Granola meeting"
echo "     with David and Alex, you took an action item to draft the"
echo "     timeline doc by Friday."
sleep 0.8
echo ""
echo "  3. **Deployment issue** — GitHub notification: the staging"
echo "     deploy failed on commit abc123. Error in the auth middleware."
sleep 0.8
echo ""
echo "  4. **Email from Alex** — Forwarded the vendor contract for"
echo "     your review. Marked urgent."
sleep 3

# --------------------------------------------------
# 4. Run a workflow
# --------------------------------------------------
section "Run a workflow"

type_cmd "kent workflow run daily-brief"
sleep 0.5
echo "  [workflow] Loading daily-brief..."
sleep 0.3
echo "  [workflow] Runner: cloud"
echo "  [workflow] Prompt: \"Generate my daily briefing with priorities and blockers\""
echo ""
sleep 1
echo -e "  ${DIM}[searching memory...]${NC}"
sleep 1.2
echo -e "  ${DIM}[analyzing 47 items from last 24h...]${NC}"
sleep 1.5
echo ""
echo "  # Daily Brief — $(date +%A,\ %B\ %d)"
echo ""
echo "  ## Priority"
echo "  - Respond to Sarah's PR review comments (blocking merge)"
echo "  - Draft Q1 timeline (due Friday)"
echo ""
echo "  ## Waiting On"
echo "  - Alex: vendor contract decision"
echo "  - David: headcount approval"
echo ""
echo "  ## FYI"
echo "  - 3 new GitHub issues assigned to you"
echo "  - Staging deploy is broken (auth middleware)"
echo "  - Team standup at 10:30am"
echo ""
echo -e "  ${GREEN}✓${NC} Run complete (2.3s)"
sleep 3

# --------------------------------------------------
# 5. List workflows
# --------------------------------------------------
section "List workflows"

type_cmd "kent workflow list"
sleep 0.5
echo ""
printf "  %-20s %-12s %-10s %s\n" "NAME" "SCHEDULE" "RUNNER" "STATUS"
printf "  %-20s %-12s %-10s %s\n" "────────────────────" "────────────" "──────────" "──────"
printf "  %-20s %-12s %-10s %s\n" "daily-brief" "0 8 * * *" "cloud" "enabled"
printf "  %-20s %-12s %-10s %s\n" "weekly-review" "0 17 * * 5" "cloud" "enabled"
printf "  %-20s %-12s %-10s %s\n" "pr-summary" "on:github" "local" "enabled"
printf "  %-20s %-12s %-10s %s\n" "meeting-followup" "on:granola" "cloud" "enabled"
echo ""
sleep 3

# --------------------------------------------------
# Done
# --------------------------------------------------
echo ""
echo -e "${BOLD}That's Kent.${NC} An AI agent that knows your context."
echo ""
echo "  Install:  curl -fsSL https://kent.sh/install | bash"
echo "  GitHub:   https://github.com/andrewgao/kent-cli"
echo ""
sleep 5
