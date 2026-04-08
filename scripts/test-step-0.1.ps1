# =============================================================
# Test Script — Phase 0, Step 0.1: Docker Compose + Volumes
# Run from repo root: .\scripts\test-step-0.1.ps1
# =============================================================

$ErrorActionPreference = "Stop"
$passed = 0
$failed = 0
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root

function Pass($msg) { Write-Host "  PASS: $msg" -ForegroundColor Green; $script:passed++ }
function Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red; $script:failed++ }
function Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ── 1. Docker Compose syntax ────────────────────────────────

Section "Docker Compose file validation"

try {
    $null = docker compose config 2>&1
    if ($LASTEXITCODE -eq 0) { Pass "docker-compose.yml is valid" }
    else { Fail "docker-compose.yml has syntax errors" }
} catch { Fail "docker-compose.yml validation threw: $_" }

try {
    $null = docker compose -f docker-compose.dev.yml config 2>&1
    if ($LASTEXITCODE -eq 0) { Pass "docker-compose.dev.yml is valid" }
    else { Fail "docker-compose.dev.yml has syntax errors" }
} catch { Fail "docker-compose.dev.yml validation threw: $_" }

# ── 2. Production compose structure ─────────────────────────

Section "Production compose structure"

$prodYaml = Get-Content docker-compose.yml -Raw

if ($prodYaml -match "collab:") { Pass "collab service defined" } else { Fail "collab service missing" }
if ($prodYaml -match "backend:") { Pass "backend service defined" } else { Fail "backend service missing" }
if ($prodYaml -match "frontend:") { Pass "frontend service defined" } else { Fail "frontend service missing" }
if ($prodYaml -notmatch "mongodb:" -and $prodYaml -notmatch "image:\s*mongo") {
    Pass "No MongoDB container in prod (use Atlas)"
} else { Fail "MongoDB container still in prod compose" }

if ($prodYaml -match "ping-app-state") { Pass "ping-app-state volume defined" } else { Fail "ping-app-state volume missing" }
if ($prodYaml -match "ping-collab") { Pass "ping-collab volume defined" } else { Fail "ping-collab volume missing" }
if ($prodYaml -match "ping-workspaces") { Pass "ping-workspaces volume defined" } else { Fail "ping-workspaces volume missing" }

if ($prodYaml -match "COLLAB_MODE=external") { Pass "COLLAB_MODE=external set for backend" } else { Fail "COLLAB_MODE=external missing" }
if ($prodYaml -match "COLLAB_URL=ws://collab:1234") { Pass "COLLAB_URL points to collab service" } else { Fail "COLLAB_URL missing or wrong" }

# ── 3. Dev compose structure ────────────────────────────────

Section "Dev compose structure"

$devYaml = Get-Content docker-compose.dev.yml -Raw

if ($devYaml -match "mongodb:" -or $devYaml -match "image:\s*mongo") {
    Pass "MongoDB container in dev compose"
} else { Fail "MongoDB container missing from dev compose" }

if ($devYaml -notmatch "backend:" -and $devYaml -notmatch "frontend:") {
    Pass "Dev compose is MongoDB-only (no app containers)"
} else { Fail "Dev compose should only have MongoDB" }

# ── 4. Collaboration Dockerfile ─────────────────────────────

Section "Collaboration Dockerfile"

$collabDockerfile = "packages/collaboration/Dockerfile"
if (Test-Path $collabDockerfile) { Pass "Dockerfile exists" } else { Fail "Dockerfile missing"; return }

$df = Get-Content $collabDockerfile -Raw

if ($df -match "standalone\.ts") { Pass "CMD uses standalone.ts entry point" } else { Fail "standalone.ts entry point missing" }
if ($df -match "EXPOSE 1234") { Pass "Exposes port 1234" } else { Fail "Port 1234 not exposed" }
if ($df -match "oven/bun") { Pass "Uses bun base image" } else { Fail "Not using bun base image" }
if ($df -match "mkdir.*collab") { Pass "Creates collab data directory" } else { Fail "Collab data directory not created" }

# ── 5. Standalone collab server entry point ─────────────────

Section "Standalone collaboration server"

$standaloneFile = "packages/collaboration/src/standalone.ts"
if (Test-Path $standaloneFile) { Pass "standalone.ts exists" } else { Fail "standalone.ts missing"; return }

$standalone = Get-Content $standaloneFile -Raw

if ($standalone -match "CollabServer") { Pass "Imports CollabServer" } else { Fail "CollabServer import missing" }
if ($standalone -match "SIGTERM") { Pass "Handles SIGTERM" } else { Fail "SIGTERM handler missing" }
if ($standalone -match "SIGINT") { Pass "Handles SIGINT" } else { Fail "SIGINT handler missing" }
if ($standalone -match "server\.start") { Pass "Starts server" } else { Fail "server.start() call missing" }
if ($standalone -match "server\.stop") { Pass "Stops server on shutdown" } else { Fail "server.stop() call missing" }

# ── 6. Config system — COLLAB_MODE support ──────────────────

Section "Config system — COLLAB_MODE env var"

$configIndex = Get-Content "packages/backend/config/index.ts" -Raw
$configDefault = Get-Content "packages/backend/config/default.ts" -Raw
$configProd = Get-Content "packages/backend/config/production.ts" -Raw
$envExample = Get-Content "packages/backend/.env.example" -Raw

if ($configIndex -match "collabMode") { Pass "collabMode in AppConfig interface" } else { Fail "collabMode missing from AppConfig" }
if ($configIndex -match "collabUrl") { Pass "collabUrl in AppConfig interface" } else { Fail "collabUrl missing from AppConfig" }
if ($configIndex -match "COLLAB_MODE") { Pass "COLLAB_MODE env override wired" } else { Fail "COLLAB_MODE env override missing" }
if ($configIndex -match "COLLAB_URL") { Pass "COLLAB_URL env override wired" } else { Fail "COLLAB_URL env override missing" }

if ($configDefault -match 'collabMode.*embedded') { Pass "Default collabMode is embedded" } else { Fail "Default collabMode wrong" }
if ($configDefault -match 'collabUrl.*ws://localhost:1234') { Pass "Default collabUrl is ws://localhost:1234" } else { Fail "Default collabUrl wrong" }

if ($configProd -match 'collabMode.*external') { Pass "Prod override sets collabMode=external" } else { Fail "Prod collabMode override missing" }

if ($envExample -match "COLLAB_MODE") { Pass "COLLAB_MODE documented in .env.example" } else { Fail "COLLAB_MODE missing from .env.example" }
if ($envExample -match "COLLAB_URL") { Pass "COLLAB_URL documented in .env.example" } else { Fail "COLLAB_URL missing from .env.example" }

# ── 7. Backend Dockerfile — workspace packages ─────────────

Section "Backend Dockerfile — workspace packages"

$backendDf = Get-Content "packages/backend/Dockerfile" -Raw

if ($backendDf -match "agent-manager") { Pass "Includes agent-manager package" } else { Fail "agent-manager package missing" }
if ($backendDf -match "collaboration") { Pass "Includes collaboration package" } else { Fail "collaboration package missing" }
if ($backendDf -match "workspace") { Pass "Includes workspace package" } else { Fail "workspace package missing" }
if ($backendDf -match "knowledge") { Pass "Includes knowledge package" } else { Fail "knowledge package missing" }

# ── 8. Build verification ──────────────────────────────────

Section "Build verification"

Push-Location "packages/backend"
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$buildOutput = bun run build 2>&1
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $prevPref
if ($buildExit -eq 0) { Pass "bun run build succeeds" } else { Fail "bun run build failed (exit $buildExit)" }
Pop-Location

# ── Summary ─────────────────────────────────────────────────

Write-Host "`n============================================" -ForegroundColor White
Write-Host "  Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "============================================`n" -ForegroundColor White

Pop-Location

exit $failed
