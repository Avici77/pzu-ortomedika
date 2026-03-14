#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$ROOT_DIR/data.db"
BACKUP_DIR="$ROOT_DIR/backups"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
BACKUP_PATH="$BACKUP_DIR/data-$TIMESTAMP.db"

sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"

echo "Backup created: $BACKUP_PATH"