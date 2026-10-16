#!/bin/sh
# Nightly pg_dump of the wealth_portfolio database (custom format, compressed).
# Restore: pg_restore -d "$DATABASE_URL" --clean --if-exists backups/<file>.dump
set -eu
STAMP=$(date +%Y%m%d-%H%M)
OUT="/backups/wealth_portfolio-$STAMP.dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find /backups -name 'wealth_portfolio-*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
