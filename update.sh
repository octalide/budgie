#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_USER=budgie
APP_GROUP=budgie
APP_DIR=/opt/budgie
BIN_TMP=$(mktemp -t budgie-XXXXXX)
BIN_DEST=$APP_DIR/budgie

trap 'rm -f "$BIN_TMP"' EXIT

echo "Building Budgie..."
cd "$ROOT_DIR"
go build -o "$BIN_TMP" .

sudo install -m 0755 "$BIN_TMP" "$BIN_DEST"
if [[ -d "$ROOT_DIR/static" ]]; then
	sudo rm -rf "$APP_DIR/static"
	sudo cp -a "$ROOT_DIR/static" "$APP_DIR/"
fi
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

sudo systemctl restart budgie

echo "Budgie updated."
