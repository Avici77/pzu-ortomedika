#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOOKING_DIR="$ROOT_DIR/booking-system"

if [ ! -d "$BOOKING_DIR" ]; then
  echo "booking-system folder not found at: $BOOKING_DIR"
  exit 1
fi

cd "$BOOKING_DIR"
if [ ! -d "node_modules" ]; then
  echo "Installing booking-system dependencies..."
  npm install
fi

cleanup() {
  local exit_code=$?
  if [[ -n "${BOOKING_PID:-}" ]]; then
    kill "$BOOKING_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SITE_PID:-}" ]]; then
    kill "$SITE_PID" >/dev/null 2>&1 || true
  fi
  exit $exit_code
}
trap cleanup INT TERM EXIT

echo "Starting booking live-reload on http://127.0.0.1:4001"
echo "Production booking URL: https://pzuortomedika.mk/booking-system/public/"
(
  cd "$BOOKING_DIR"
  npm run dev:live
) &
BOOKING_PID=$!

echo "Starting homepage live-reload on http://127.0.0.1:3000"
echo "Production homepage URL: https://pzuortomedika.mk/"
(
  cd "$ROOT_DIR"
  npx --prefix "$BOOKING_DIR" browser-sync start \
    --server "$ROOT_DIR" \
    --files "$ROOT_DIR/index.html,$ROOT_DIR/css/**/*.css,$ROOT_DIR/js/**/*.js" \
    --port 3000 \
    --ui-port 3001 \
    --no-open \
    --no-notify
) &
SITE_PID=$!

wait "$BOOKING_PID" "$SITE_PID"
