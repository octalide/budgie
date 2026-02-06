#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_USER=budgie
APP_GROUP=budgie
APP_DIR=/opt/budgie
ENV_DIR=/etc/budgie
ENV_FILE=$ENV_DIR/budgie.env
SERVICE_FILE=/etc/systemd/system/budgie.service
BIN_TMP=$(mktemp -t budgie-XXXXXX)
BIN_DEST=$APP_DIR/budgie

trap 'rm -f "$BIN_TMP"' EXIT

echo "Building Budgie..."
cd "$ROOT_DIR"
go build -o "$BIN_TMP" .

if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  sudo groupadd --system "$APP_GROUP"
fi
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin --gid "$APP_GROUP" "$APP_USER"
fi

sudo mkdir -p "$APP_DIR" "$ENV_DIR"

sudo install -m 0755 "$BIN_TMP" "$BIN_DEST"
if [[ -d "$ROOT_DIR/static" ]]; then
  sudo rm -rf "$APP_DIR/static"
  sudo cp -a "$ROOT_DIR/static" "$APP_DIR/"
fi
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ROOT_DIR/.env.example" ]]; then
    sudo cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  else
    sudo tee "$ENV_FILE" >/dev/null <<'EOF'
BUDGIE_DB=/opt/budgie/budgie.db
BUDGIE_BIND=127.0.0.1:4000
BUDGIE_ALLOW_SIGNUP=true
BUDGIE_SESSION_TTL=336h
BUDGIE_PASSWORD_MIN=12
BUDGIE_TRUST_PROXY=false
BUDGIE_COOKIE_SECURE=true
EOF
  fi
fi

sudo tee "$SERVICE_FILE" >/dev/null <<'EOF'
[Unit]
Description=Budgie server
After=network.target

[Service]
Type=simple
User=budgie
Group=budgie
WorkingDirectory=/opt/budgie
EnvironmentFile=/etc/budgie/budgie.env
ExecStart=/opt/budgie/budgie
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable budgie
sudo systemctl restart budgie

echo "Budgie installed. Edit $ENV_FILE as needed."
