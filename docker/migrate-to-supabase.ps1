# migrate-to-supabase.ps1
#
# Safely migrates the N-REV database schema and data from the local Docker
# PostgreSQL database to a Supabase PostgreSQL database.
#
# Requirements:
#   1. The Supabase DATABASE_URL must be set as an env var:
#      $env:DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"
#   2. The local Docker PostgreSQL must be running (docker-compose up -d)
#   3. The data dump file docker/nrev_data_dump.sql must exist
#
# This script does NOT modify/delete local Docker PostgreSQL, does NOT hardcode
# Supabase credentials, does NOT deploy to Vercel, does NOT push to GitHub.

param(
    [switch]$SkipSchemaPush,
    [switch]$SkipDataImport,
    [switch]$SkipVerification
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path "$PSScriptRoot\.."
$dbDump = "$PSScriptRoot\nrev_data_dump.sql"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "N-REV Database Migration to Supabase" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# --- Safety Check 1: DATABASE_URL must be set (real env var, not .env file) ---
$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) {
    Write-Host "ERROR: DATABASE_URL environment variable is not set in this shell." -ForegroundColor Red
    Write-Host "Set it with:" -ForegroundColor Yellow
    Write-Host "  `$env:DATABASE_URL=`"postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres`"" -ForegroundColor Yellow
    exit 1
}

# --- Safety Check 2: Must target Supabase, not localhost ---
if ($dbUrl -match "localhost") {
    Write-Host "ERROR: DATABASE_URL contains 'localhost'. This is the local Docker DB, not Supabase." -ForegroundColor Red
    Write-Host "Refusing to proceed." -ForegroundColor Red
    exit 1
}

if ($dbUrl -match "postgres:postgres@") {
    Write-Host "ERROR: DATABASE_URL contains default local credentials (postgres:postgres)." -ForegroundColor Red
    Write-Host "This is the local Docker DB, not Supabase. Refusing to proceed." -ForegroundColor Red
    exit 1
}

if ($dbUrl -notmatch "supabase") {
    Write-Host "WARNING: DATABASE_URL does not contain 'supabase'. Verify this is correct." -ForegroundColor Yellow
} else {
    Write-Host "DATABASE_URL target confirmed: Supabase [length: $($dbUrl.Length)]" -ForegroundColor Green
}

Write-Host "No credentials will be printed or saved to files." -ForegroundColor Gray
Write-Host ""
# --- Step 1: Push Drizzle schema to Supabase ---
if (-not $SkipSchemaPush) {
    Write-Host "--- Step 1: Pushing Drizzle schema to Supabase ---" -ForegroundColor Cyan
    Push-Location "$projectRoot\lib\db"
    try {
        # dotenv.config() in drizzle.config.ts does NOT override an already-set
        # DATABASE_URL env var, so the authentic Supabase URL is used.
        if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
            Write-Host "ERROR: pnpm not found. Run via corepack or npm i -g pnpm." -ForegroundColor Red
            exit 1
        }
        & pnpm exec drizzle-kit push 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: drizzle-kit push failed (exit $LASTEXITCODE)." -ForegroundColor Red
            exit 1
        }
        Write-Host "Schema push complete." -ForegroundColor Green
    } finally {
        Pop-Location
    }
    Write-Host ""
}

# --- Step 2: Import data dump into Supabase ---
if (-not $SkipDataImport) {
    Write-Host "--- Step 2: Importing N-REV data into Supabase ---" -ForegroundColor Cyan

    if (-not (Test-Path $dbDump)) {
        Write-Host "ERROR: Data dump file not found at $dbDump" -ForegroundColor Red
        exit 1
    }

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: docker not found on PATH. The psql client is run via the postgres image." -ForegroundColor Red
        exit 1
    }

    Write-Host "Importing data from $(Split-Path $dbDump -Leaf) ..."
    $dumpParent = Split-Path $dbDump -Parent
    $dumpName = Split-Path $dbDump -Leaf
    docker run --rm -v "${dumpParent}:/data" postgres:16-alpine psql "$dbUrl" -f "/data/$dumpName" -v ON_ERROR_STOP=1 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: data import failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    Write-Host "Data import complete." -ForegroundColor Green
    Write-Host ""
}
# --- Step 3: Verification (read-only) ---
if (-not $SkipVerification) {
    Write-Host "--- Step 3: Verification ---" -ForegroundColor Cyan
    Write-Host ""

    function Run-Supabase($label, $sql) {
        Write-Host "=== $label ===" -ForegroundColor Yellow
        docker run --rm postgres:16-alpine psql "$dbUrl" -t -c $sql 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: verification query '$label' failed." -ForegroundColor Red
            exit 1
        }
        Write-Host ""
    }

    Run-Supabase "Supabase row counts" "SELECT 'foods: ' || count(*) FROM foods UNION ALL SELECT 'profiles: ' || count(*) FROM profiles UNION ALL SELECT 'meal_logs: ' || count(*) FROM meal_logs UNION ALL SELECT 'lab_comparisons: ' || count(*) FROM lab_comparisons;"
    Run-Supabase "foods count must be 82073" "SELECT count(*) AS foods_count FROM foods;"
    Run-Supabase "foods sample (first 3 by id)" "SELECT id, name, tier, source FROM foods ORDER BY id LIMIT 3;"
    Run-Supabase "foods sequence state" "SELECT last_value FROM foods_id_seq;"
    Run-Supabase "empty tables check" "SELECT (SELECT count(*) FROM profiles) AS profiles, (SELECT count(*) FROM meal_logs) AS meal_logs, (SELECT count(*) FROM lab_comparisons) AS lab_comparisons;"
    Run-Supabase "public tables list" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"

    Write-Host "=== Local Docker PostgreSQL status (must be unchanged) ===" -ForegroundColor Yellow
    docker exec nutrirecover-db psql -U postgres -d nutrirecover -t -c "SELECT 'foods: ' || count(*) FROM foods UNION ALL SELECT 'profiles: ' || count(*) FROM profiles UNION ALL SELECT 'meal_logs: ' || count(*) FROM meal_logs UNION ALL SELECT 'lab_comparisons: ' || count(*) FROM lab_comparisons;" 2>&1

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "Migration and verification complete." -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
} else {
    Write-Host "Skipping verification." -ForegroundColor Gray
}