#!/bin/bash
set -e

# Kent CLI install script
# Usage: curl -fsSL https://raw.githubusercontent.com/andrewgao/kent-cli/main/scripts/install.sh | bash

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info() { echo -e "${BOLD}$1${NC}"; }
success() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
error() { echo -e "${RED}$1${NC}"; }

echo ""
info "  _  __          _   "
info " | |/ /___ _ __ | |_ "
info " | ' // _ \ '_ \| __|"
info " | . \  __/ | | | |_ "
info " |_|\_\___|_| |_|\__|"
echo ""
info "Installing Kent — Personal AI Agent CLI"
echo ""

# --------------------------------------------------
# 1. Detect macOS
# --------------------------------------------------
if [[ "$OSTYPE" != "darwin"* ]]; then
  error "Kent currently requires macOS. Linux support coming soon."
  exit 1
fi
success "  macOS detected"

# --------------------------------------------------
# 2. Check for Bun, install if missing
# --------------------------------------------------
if command -v bun &> /dev/null; then
  BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
  success "  Bun v${BUN_VERSION} found"
else
  warn "  Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  # Source the updated PATH so bun is available in this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &> /dev/null; then
    error "Bun installation failed. Install manually: https://bun.sh"
    exit 1
  fi
  success "  Bun installed"
fi

# --------------------------------------------------
# 3. Install kent-cli globally
# --------------------------------------------------
info "  Installing kent-cli..."
bun add -g kent-cli
success "  kent-cli installed"

# --------------------------------------------------
# 4. Verify installation
# --------------------------------------------------
if command -v kent &> /dev/null; then
  KENT_VERSION=$(kent --version 2>/dev/null || echo "unknown")
  success "  kent v${KENT_VERSION} ready"
else
  # bun global bin might not be in PATH yet
  GLOBAL_BIN="$HOME/.bun/bin"
  if [ -f "$GLOBAL_BIN/kent" ]; then
    warn "  kent installed but not in PATH."
    warn "  Add this to your shell profile:"
    echo ""
    echo "    export PATH=\"$GLOBAL_BIN:\$PATH\""
    echo ""
  else
    error "  Installation verification failed."
    error "  Try: bun add -g kent-cli"
    exit 1
  fi
fi

# --------------------------------------------------
# 5. Next step
# --------------------------------------------------
echo ""
success "Installation complete."
echo ""
info "Next step:"
echo "  kent init"
echo ""
