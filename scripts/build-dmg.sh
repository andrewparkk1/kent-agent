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

# 6. Create GitHub release and upload artifacts
VERSION=$(cd "$ROOT" && bun -e "console.log(require('./package.json').version)")
TAG="v$VERSION"

echo ""
echo "==> Creating GitHub release $TAG..."

# Push tag if it doesn't exist on remote
git tag "$TAG" 2>/dev/null || true
git push origin main --tags

# Collect release assets
ASSETS=()
for f in "$TAURI_DIR"/target/release/bundle/dmg/*.dmg; do
  [ -f "$f" ] && ASSETS+=("$f")
done
for f in "$TAURI_DIR"/target/release/bundle/macos/*.app.tar.gz; do
  [ -f "$f" ] && ASSETS+=("$f")
done
# Include updater signature if present
for f in "$TAURI_DIR"/target/release/bundle/macos/*.app.tar.gz.sig; do
  [ -f "$f" ] && ASSETS+=("$f")
done

# Generate latest.json for Tauri auto-updater
TAR_GZ=$(ls "$TAURI_DIR"/target/release/bundle/macos/*.app.tar.gz 2>/dev/null | head -1)
SIG_FILE=$(ls "$TAURI_DIR"/target/release/bundle/macos/*.app.tar.gz.sig 2>/dev/null | head -1)
if [ -n "$TAR_GZ" ] && [ -n "$SIG_FILE" ]; then
  SIGNATURE=$(cat "$SIG_FILE")
  TAR_NAME=$(basename "$TAR_GZ")
  LATEST_JSON="$TAURI_DIR/target/release/bundle/latest.json"
  cat > "$LATEST_JSON" <<ENDJSON
{
  "version": "$VERSION",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://github.com/andrewparkk1/kent-agent/releases/download/$TAG/$TAR_NAME",
      "signature": "$SIGNATURE"
    },
    "darwin-x86_64": {
      "url": "https://github.com/andrewparkk1/kent-agent/releases/download/$TAG/$TAR_NAME",
      "signature": "$SIGNATURE"
    }
  }
}
ENDJSON
  ASSETS+=("$LATEST_JSON")
  echo "    Generated latest.json for auto-updater"
fi

if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "    No artifacts found to upload — creating release without assets"
  gh release create "$TAG" --title "$TAG" --generate-notes
else
  echo "    Uploading ${#ASSETS[@]} artifact(s)..."
  gh release create "$TAG" "${ASSETS[@]}" --title "$TAG" --generate-notes
fi

echo ""
echo "==> Released $TAG on GitHub"
echo "    https://github.com/andrewparkk1/kent-agent/releases/tag/$TAG"
