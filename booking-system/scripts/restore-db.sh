#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$ROOT_DIR/data.db"
BACKUP_DIR="$ROOT_DIR/backups"

if [ $# -lt 1 ]; then
  echo "Usage: npm run restore:db -- <backup-file-path>"
  exit 1
fi

INPUT_PATH="$1"
if [ -f "$INPUT_PATH" ]; then
  RESTORE_PATH="$INPUT_PATH"
elif [ -f "$BACKUP_DIR/$INPUT_PATH" ]; then
  RESTORE_PATH="$BACKUP_DIR/$INPUT_PATH"
else
  echo "Backup file not found: $INPUT_PATH"
  exit 1
fi

if lsof "$DB_PATH" >/dev/null 2>&1; then
  echo "Database appears in use. Stop the server before restore."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_PATH" ]; then
  TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
  PRE_RESTORE="$BACKUP_DIR/pre-restore-$TIMESTAMP.db"
  sqlite3 "$DB_PATH" ".backup '$PRE_RESTORE'"
  echo "Safety backup created: $PRE_RESTORE"
fi

cp "$RESTORE_PATH" "$DB_PATH"
rm -f "$DB_PATH-wal" "$DB_PATH-shm"

echo "Database restored from: $RESTORE_PATH"