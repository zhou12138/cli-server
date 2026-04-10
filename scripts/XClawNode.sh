#!/usr/bin/env bash

set -euo pipefail

APP_NAME="XClawNode"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

print_header() {
  echo "========================================"
  echo "  $APP_NAME Onboarding"
  echo "========================================"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required but not found."
    exit 1
  fi
}

ask_yes_no() {
  local prompt="$1"
  local default="$2"
  local answer

  while true; do
    read -r -p "$prompt [$default]: " answer || true
    answer="${answer:-$default}"
    case "${answer,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) echo "Please answer yes or no." ;;
    esac
  done
}

select_mode() {
  echo "Choose startup mode:"
  echo "  1) Head UI (Managed MCP WS)"
  echo "  2) Headless (Managed MCP WS)"

  local option
  while true; do
    read -r -p "Select [1-2]: " option || true
    case "$option" in
      1) echo "head-ui-ws"; return ;;
      2) echo "headless-ws"; return ;;
      *) echo "Invalid option. Please enter 1 or 2." ;;
    esac
  done
}

build_bundle() {
  echo "Creating app package..."
  (cd "$ROOT_DIR" && npm run make)

  mkdir -p "$DIST_DIR"
  local bundle_name="$APP_NAME-$(date +%Y%m%d-%H%M%S).tar.gz"

  echo "Compressing output to dist/$bundle_name ..."
  # Electron Forge output is under out/make
  (cd "$ROOT_DIR" && tar -czf "$DIST_DIR/$bundle_name" out/make)

  echo "Bundle created: $DIST_DIR/$bundle_name"
}

run_onboarding() {
  print_header

  require_cmd npm

  if ask_yes_no "Install dependencies now?" "yes"; then
    (cd "$ROOT_DIR" && npm install)
  fi

  local mode
  mode="$(select_mode)"

  local base_url token
  read -r -p "Managed MCP base URL (e.g. ws://localhost:8000/api/mcphub/ws): " base_url || true
  read -r -p "Managed MCP bearer token (optional): " token || true

  export MANAGED_CLIENT_BASE_URL="$base_url"
  if [[ -n "${token:-}" ]]; then
    export MANAGED_CLIENT_BEARER_TOKEN="$token"
    if [[ "$mode" == "head-ui-ws" ]]; then
      echo "Static token detected. Switching to headless mode (no renderer UI required)."
      mode="headless-ws"
    fi
  fi

  if ask_yes_no "Build distributable bundle now?" "yes"; then
    build_bundle
  fi

  echo "Launching app..."
  case "$mode" in
    head-ui-ws)
      (cd "$ROOT_DIR" && npm run start:managed-client-mcp-ws-ui)
      ;;
    headless-ws)
      (cd "$ROOT_DIR" && npm run start:managed-client-mcp-ws)
      ;;
  esac
}

run_onboarding
