#!/bin/bash
# =============================================================================
# Ptah Database Backup Script
# =============================================================================
# Usage: ./scripts/backup-db.sh
# Cron:  0 3 * * * /path/to/ptah-extension/scripts/backup-db.sh
# =============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/ptah_db_${TIMESTAMP}.sql.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Starting database backup..."
docker exec ptah_postgres_prod pg_dump -U "${POSTGRES_USER:-ptah}" "${POSTGRES_DB:-ptah_db}" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
else
  echo "ERROR: Backup failed!"
  exit 1
fi

# Remove backups older than retention period
echo "Removing backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "ptah_db_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "Backup complete."
