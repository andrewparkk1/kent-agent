#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT/web/src-tauri"
BIN_DIR="$TAURI_DIR/binaries"
ARCH="$(uname -m)"

# Map uname arch to Rust target triple
case "$ARCH" in
  arm64) TARGET="aarch64-apple-darwin" ;;
  x86_64) TARGET="x86_64-apple-darwin" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo "==> Building Kent.app for $TARGET"

# 1. Install dependencies
echo "==> Installing dependencies..."
cd "$ROOT" && bun install
cd "$ROOT/web" && bun install

# 2. Build the web frontend
echo "==> Building web frontend..."
cd "$ROOT/web" && bunx vite build --emptyOutDir

# 3. Compile sidecar binaries
echo "==> Compiling sidecar binaries..."
mkdir -p "$BIN_DIR"

echo "    kent-server..."
cd "$ROOT" && bun build --compile web/server.ts --outfile "$BIN_DIR/kent-server-$TARGET"

echo "    kent-daemon..."
cd "$ROOT" && bun build --compile daemon/daemon.ts --outfile "$BIN_DIR/kent-daemon-$TARGET"

echo "    kent-agent..."
cd "$ROOT" && bun build --compile agent/agent.ts --outfile "$BIN_DIR/kent-agent-$TARGET"

# 4. Copy frontend dist into src-tauri for resource bundling
echo "==> Copying frontend dist into Tauri resources..."
rm -rf "$TAURI_DIR/dist-bundle"
cp -R "$ROOT/web/dist" "$TAURI_DIR/dist-bundle"

# 5. Build the Tauri app (produces .app and .dmg)
echo "==> Building Tauri app..."
cd "$ROOT/web" && bunx tauri build

echo ""
echo "==> Build complete!"
echo "    DMG: $TAURI_DIR/target/release/bundle/dmg/"
echo "    App: $TAURI_DIR/target/release/bundle/macos/"
ls -la "$TAURI_DIR/target/release/bundle/dmg/" 2>/dev/null || echo "    (DMG directory not found — check build output above)"
