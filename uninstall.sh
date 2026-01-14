#!/usr/bin/env bash
set -euo pipefail

APP_USER=budgie
APP_GROUP=budgie
APP_DIR=/opt/budgie
ENV_DIR=/etc/budgie
SERVICE_FILE=/etc/systemd/system/budgie.service

if systemctl list-unit-files | grep -q '^budgie.service'; then
  sudo systemctl stop budgie || true
  sudo systemctl disable budgie || true
fi

if [[ -f "$SERVICE_FILE" ]]; then
  sudo rm -f "$SERVICE_FILE"
  sudo systemctl daemon-reload
fi

if [[ -d "$ENV_DIR" ]]; then
  sudo rm -rf "$ENV_DIR"
fi

if [[ -d "$APP_DIR" ]]; then
  sudo rm -rf "$APP_DIR"
fi

if id -u "$APP_USER" >/dev/null 2>&1; then
  sudo userdel "$APP_USER" || true
fi

if getent group "$APP_GROUP" >/dev/null 2>&1; then
  # Only delete the group if it has no members.
  if ! getent group "$APP_GROUP" | awk -F: '{print $4}' | grep -q .; then
    sudo groupdel "$APP_GROUP" || true
  fi
fi

echo "Budgie uninstalled."
