#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

bash "$ROOT_DIR/scripts/backup-db.sh"

find "$BACKUP_DIR" -type f -name 'data-*.db' -mtime +"$RETENTION_DAYS" -print -delete

echo "Retention cleanup done (kept last $RETENTION_DAYS days)."