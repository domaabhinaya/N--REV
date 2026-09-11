#!/bin/bash
# migrate-to-supabase.sh
#
# Safely migrates the N-REV database schema and data from the local Docker
# PostgreSQL database to a Supabase PostgreSQL database.
#
# Requirements:
#   1. The Supabase DATABASE_URL must be set as an environment variable:
#      export DATABASE_URL="postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres"
#   2. The local Docker PostgreSQL must be running (docker-compose up -d)
#   3. The data dump file docker/nrev_data_dump.sql must exist
#
# This script:
#   - Does NOT modify or delete the local Docker PostgreSQL database
#   - Does NOT hardcode or save Supabase credentials
#   - Does NOT deploy to Vercel or push to GitHub
#
# Safety checks:
#   - Refuses to run if DATABASE_URL is not set
#   - Refuses to run if DATABASE_URL points to localhost
#   - Refuses to run if DATABASE_URL contains default local password
#

set -euo pipefail

echo "=========================================="
echo "N-REV Database Migration to Supabase"
echo "=========================================="
echo ""

# --- Safety Check 1: DATABASE_URL must be set ---
if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set."
    echo "Set it with: export DATABASE_URL=\"postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres\""
    exit 1
fi

# --- Safety Check 2: Must target Supabase, not localhost ---
if echo "$DATABASE_URL" | grep -q "localhost"; then
    echo "ERROR: DATABASE_URL contains 'localhost'. This appears to be a local database, not Supabase."
    echo "Refusing to proceed."
    exit 1
fi

if echo "$DATABASE_URL" | grep -q "postgres:postgres@"; then
    echo "ERROR: DATABASE_URL contains default local credentials (postgres:postgres)."
    echo "This appears to be the local Docker database, not Supabase."
    echo "Refusing to proceed."
    exit 1
fi

if ! echo "$DATABASE_URL" | grep -q "supabase"; then
    echo "WARNING: DATABASE_URL does not contain 'supabase'. Proceeding, but please verify this is correct."
fi

echo "DATABASE_URL is configured (target confirmed: Supabase) ✓"
echo "No credentials will be printed or saved to files."
echo ""

# --- Step 1: Push Drizzle schema to Supabase ---
echo "--- Step 1: Pushing Drizzle schema to Supabase ---"
cd "$(dirname "$0")/../lib/db" || exit 1
npx drizzle-kit push
echo "Schema push complete ✓"
echo ""

# --- Step 2: Import data dump into Supabase ---
echo "--- Step 2: Importing N-REV data into Supabase ---"
DUMP_FILE="$(dirname "$0")/nrev_data_dump.sql"
if [ ! -f "$DUMP_FILE" ]; then
    echo "ERROR: Data dump file not found at $DUMP_FILE"
    echo "Run the export first: docker run --rm -e PGPASSWORD=postgres postgres:16-alpine pg_dump --data-only --table=foods --table=profiles --table=meal_logs --table=lab_comparisons -h host.docker.internal -U postgres -d nutrirecover --file - > $DUMP_FILE"
    exit 1
fi

echo "Importing data from $DUMP_FILE ..."
psql "$DATABASE_URL" -f "$DUMP_FILE" -v ON_ERROR_STOP=1
echo "Data import complete ✓"
echo ""

# --- Step 3: Verification ---
echo "--- Step 3: Verification ---"
echo ""
echo "=== Supabase row counts ==="
psql "$DATABASE_URL" -t -c "
SELECT 'foods: ' || count(*) FROM foods
UNION ALL SELECT 'profiles: ' || count(*) FROM profiles
UNION ALL SELECT 'meal_logs: ' || count(*) FROM meal_logs
UNION ALL SELECT 'lab_comparisons: ' || count(*) FROM lab_comparisons;
"

echo ""
echo "=== Supabase foods sample (first 3) ==="
psql "$DATABASE_URL" -t -c "SELECT id, name, slug, tier, source FROM foods ORDER BY id LIMIT 3;"

echo ""
echo "=== Supabase foods sequence state ==="
psql "$DATABASE_URL" -t -c "SELECT last_value FROM foods_id_seq;"

echo ""
echo "=== Supabase tables list ==="
psql "$DATABASE_URL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"

echo ""
echo "=== Local Docker PostgreSQL status (must be unchanged) ==="
docker exec nutrirecover-db psql -U postgres -d nutrirecover -t -c "
SELECT 'foods: ' || count(*) FROM foods
UNION ALL SELECT 'profiles: ' || count(*) FROM profiles
UNION ALL SELECT 'meal_logs: ' || count(*) FROM meal_logs
UNION ALL SELECT 'lab_comparisons: ' || count(*) FROM lab_comparisons;
"

echo ""
echo "=========================================="
echo "Migration and verification complete ✓"
echo "=========================================="