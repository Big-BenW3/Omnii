#!/usr/bin/env bash
# Installs a pinned livekit-server binary for local dev and E2E (no Docker needed).
# Usage: scripts/install-livekit-server.sh   -> .tools/livekit-server
set -euo pipefail
VERSION="1.13.10"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools"
BIN="$DEST_DIR/livekit-server"
if [[ -x "$BIN" ]] && "$BIN" --version 2>/dev/null | grep -q "$VERSION"; then
  echo "livekit-server $VERSION already installed at $BIN"; exit 0
fi
mkdir -p "$DEST_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="https://github.com/livekit/livekit/releases/download/v${VERSION}"
TAR="livekit_${VERSION}_linux_amd64.tar.gz"
curl -4 -fsSL --retry 10 --retry-all-errors -o "$TMP/$TAR" "$BASE/$TAR"
if curl -4 -fsSL --retry 5 --retry-all-errors -o "$TMP/checksums.txt" "$BASE/checksums.txt"; then
  (cd "$TMP" && grep " $TAR\$" checksums.txt | sha256sum -c -)
else
  echo "warning: no checksums.txt published for v$VERSION; skipping verification" >&2
fi
tar -xzf "$TMP/$TAR" -C "$TMP"
install -m 0755 "$TMP/livekit-server" "$BIN"
"$BIN" --version
