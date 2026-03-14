#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOOKING_DIR="$ROOT_DIR/booking-system"

if [ ! -d "$BOOKING_DIR" ]; then
  echo "booking-system folder not found at: $BOOKING_DIR"
  exit 1
fi

if lsof -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1 && lsof -iTCP:4001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Booking live mode is already running on http://127.0.0.1:4001"
  echo "Production booking URL: https://pzuortomedika.mk/booking-system/public/"
  exit 0
fi

cd "$BOOKING_DIR"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting booking live mode on http://127.0.0.1:4001 (proxy to 4000)"
echo "Production booking URL: https://pzuortomedika.mk/booking-system/public/"
exec npm run dev:live
