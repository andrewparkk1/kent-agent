#!/usr/bin/env bash
# Build a fresh DMG and upload it as a GitHub release.
# Calls build-dmg.sh under the hood so you can never release a stale build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT/web/src-tauri"

# 1. Build (this rebuilds sidecars + web + tauri — see build-dmg.sh)
"$ROOT/scripts/build-dmg.sh"

# 2. Derive version + tag from package.json
VERSION=$(cd "$ROOT" && bun -e "console.log(require('./package.json').version)")
TAG="v$VERSION"

echo ""
echo "==> Creating GitHub release $TAG..."

# 3. Push tag (create or update)
cd "$ROOT"
git tag -d "$TAG" 2>/dev/null || true
git push origin --delete "$TAG" 2>/dev/null || true
git tag "$TAG"
git push origin main --tags

# 4. Collect release assets
ASSETS=()
for f in "$TAURI_DIR"/target/release/bundle/dmg/*.dmg; do
  [ -f "$f" ] && ASSETS+=("$f")
done
for f in "$TAURI_DIR"/target/release/bundle/macos/*.app.tar.gz; do
  [ -f "$f" ] && ASSETS+=("$f")
done
for f in "$TAURI_DIR"/target/release/bundle/macos/*.app.tar.gz.sig; do
  [ -f "$f" ] && ASSETS+=("$f")
done

# 5. Generate latest.json for Tauri auto-updater
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

# 6. Create the GitHub release
gh release delete "$TAG" --yes 2>/dev/null || true
if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "    No artifacts found — creating release without assets"
  gh release create "$TAG" --title "$TAG" --generate-notes
else
  echo "    Uploading ${#ASSETS[@]} artifact(s)..."
  gh release create "$TAG" "${ASSETS[@]}" --title "$TAG" --generate-notes
fi

echo ""
echo "==> Released $TAG on GitHub"
echo "    https://github.com/andrewparkk1/kent-agent/releases/tag/$TAG"
