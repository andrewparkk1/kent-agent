#!/usr/bin/env bash
# Build a signed, notarized Kent.app + DMG locally.
# Does NOT upload to GitHub — use `bun run deploy:dmg` for that.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT/web/src-tauri"
BIN_DIR="$TAURI_DIR/binaries"
ARCH="$(uname -m)"

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

# 2. Build the web frontend into web/dist-bundle/
#    (tauri.conf.json `frontendDist` and `resources` both point at ../dist-bundle)
echo "==> Building web frontend..."
cd "$ROOT/web" && bunx vite build --emptyOutDir

# 3. Compile sidecar binaries — CRITICAL: tauri build does NOT do this.
#    Every sidecar must be rebuilt so DMG picks up the latest TS changes.
echo "==> Compiling sidecar binaries..."
mkdir -p "$BIN_DIR"

echo "    kent-server..."
cd "$ROOT" && bun build --compile web/server.ts --outfile "$BIN_DIR/kent-server-$TARGET"

echo "    kent-daemon..."
cd "$ROOT" && bun build --compile daemon/daemon.ts --outfile "$BIN_DIR/kent-daemon-$TARGET"

echo "    kent-agent..."
cd "$ROOT" && bun build --compile agent/agent.ts --outfile "$BIN_DIR/kent-agent-$TARGET"

# 4. Detach any stale mounted Kent DMGs — bundle_dmg.sh fails if one is mounted.
#    Wrapped in `set +e` because `grep` with no matches exits 1 under pipefail
#    and would abort the script when there are no stale mounts (the normal case).
echo "==> Detaching stale Kent DMG mounts..."
set +e
shopt -s nullglob
for vol in /Volumes/Kent /Volumes/Kent\ * /Volumes/dmg.*; do
  [ -d "$vol" ] && hdiutil detach "$vol" -force >/dev/null 2>&1
done
shopt -u nullglob
HDIUTIL_OUT=$(hdiutil info 2>/dev/null)
echo "$HDIUTIL_OUT" | grep -B1 -E "image-path.*Kent" | grep -oE "/dev/disk[0-9]+" | sort -u | while read -r dev; do
  hdiutil detach "$dev" -force >/dev/null 2>&1
done
set -e

# 5. Build the Tauri app (produces .app and signed, notarized .dmg)
echo "==> Building Tauri app..."
cd "$ROOT/web" && bunx tauri build

echo ""
echo "==> Build complete!"
DMG_PATH="$TAURI_DIR/target/release/bundle/dmg/Kent_0.1.0_$TARGET.dmg"
echo "    DMG: $DMG_PATH"
echo "    App: $TAURI_DIR/target/release/bundle/macos/Kent.app"
ls -la "$TAURI_DIR/target/release/bundle/dmg/" 2>/dev/null || echo "    (DMG directory not found — check build output above)"
