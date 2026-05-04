# =============================================================
# Production Readiness Validation Script
# =============================================================
#
# Run from repo root:  .\scripts\validate-production.ps1
# Run specific phase:  .\scripts\validate-production.ps1 -Phase 0
# Run specific step:   .\scripts\validate-production.ps1 -Phase 0 -Step 1
# Skip Docker checks:  .\scripts\validate-production.ps1 -SkipDocker
# Skip build checks:   .\scripts\validate-production.ps1 -SkipBuild
#
# Exit code = number of failures (0 = all passed)
#
# To add checks for a new step:
#   1. Find the phase/step section below
#   2. Uncomment the TODO placeholder or add new checks
#   3. Use FileExists, FileContains, FileNotContains helpers
# =============================================================

param(
    [int]$Phase = -1,         # -1 = run all phases
    [int]$Step  = -1,         # -1 = run all steps in phase
    [switch]$SkipDocker,      # Skip checks that require Docker daemon
    [switch]$SkipBuild        # Skip build verification (faster iteration)
)

$ErrorActionPreference = "Continue"

# -- Counters and helpers ------------------------------------

$script:passed  = 0
$script:failed  = 0
$script:skipped = 0

function Pass($msg)    { Write-Host "  PASS  $msg" -ForegroundColor Green;  $script:passed++ }
function Fail($msg)    { Write-Host "  FAIL  $msg" -ForegroundColor Red;    $script:failed++ }
function Skip($msg)    { Write-Host "  SKIP  $msg" -ForegroundColor Yellow; $script:skipped++ }
function Section($msg) { Write-Host "`n--- $msg ---" -ForegroundColor Cyan }
function PhaseHeader($msg) { Write-Host "`n============================`n  $msg`n============================" -ForegroundColor Magenta }

function FileExists($path, $label) {
    if (Test-Path $path) { Pass "$label exists" } else { Fail "$label missing: $path" }
}
function FileContains($path, $pattern, $label) {
    if (!(Test-Path $path)) { Fail "$label -- file not found: $path"; return }
    if ((Get-Content $path -Raw) -match $pattern) { Pass $label } else { Fail $label }
}
function FileNotContains($path, $pattern, $label) {
    if (!(Test-Path $path)) { Fail "$label -- file not found: $path"; return }
    if ((Get-Content $path -Raw) -notmatch $pattern) { Pass $label } else { Fail $label }
}

function ShouldRun($p, $s) {
    if ($Phase -ge 0 -and $Phase -ne $p) { return $false }
    if ($Step  -ge 0 -and $Step  -ne $s) { return $false }
    return $true
}

# -- Resolve repo root ---------------------------------------

$repoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Get-Location }
Push-Location $repoRoot

# -- Path shorthands -----------------------------------------

$BE         = "packages/backend"
$FE         = "packages/frontend"
$COLLAB     = "packages/collaboration"
$COLLAB_SVC = "packages/collab-service"
$AM         = "packages/agent-manager"
$CONFIG     = "$BE/config"
$ENV_EX     = "$BE/.env.example"
$COMPOSE    = "docker-compose.yml"
$COMPOSE_D  = "docker-compose.dev.yml"

# ============================================================
#  PHASE 0 -- Production Infrastructure & Session Persistence
# ============================================================

if ($Phase -le 0 -or $Phase -eq -1) {
PhaseHeader "Phase 0: Production Infrastructure"

# -- Step 0.1: Docker Compose + Volumes ----------------------

if (ShouldRun 0 1) {
    Section "Step 0.1: Docker Compose + Volumes"

    if ($SkipDocker) {
        Skip "docker-compose.yml syntax (Docker skipped)"
        Skip "docker-compose.dev.yml syntax (Docker skipped)"
    } else {
        $null = docker compose config 2>&1
        if ($LASTEXITCODE -eq 0) { Pass "docker-compose.yml syntax valid" } else { Fail "docker-compose.yml syntax errors" }

        $null = docker compose -f $COMPOSE_D config 2>&1
        if ($LASTEXITCODE -eq 0) { Pass "docker-compose.dev.yml syntax valid" } else { Fail "docker-compose.dev.yml syntax errors" }
    }

    # Prod compose structure
    FileContains    $COMPOSE "collab:"                  "Prod: collab service defined"
    FileContains    $COMPOSE "backend:"                 "Prod: backend service defined"
    FileContains    $COMPOSE "frontend:"                "Prod: frontend service defined"
    FileNotContains $COMPOSE "image:\s*mongo"           "Prod: no MongoDB container (use Atlas)"
    FileContains    $COMPOSE "ping-app-state"           "Prod: ping-app-state volume"
    FileContains    $COMPOSE "ping-collab"              "Prod: ping-collab volume"
    FileContains    $COMPOSE "ping-workspaces"          "Prod: ping-workspaces volume"
    FileContains    $COMPOSE "COLLAB_MODE=external"     "Prod: COLLAB_MODE=external for backend"
    FileContains    $COMPOSE "COLLAB_URL=ws://collab"   "Prod: COLLAB_URL points to collab service"

    # Dev compose structure
    FileContains    $COMPOSE_D "mongo"                  "Dev: MongoDB container present"
    FileNotContains $COMPOSE_D "backend:"               "Dev: no backend container (run locally)"
    FileNotContains $COMPOSE_D "frontend:"              "Dev: no frontend container (run locally)"

    # Collab-service Dockerfile + standalone entry point
    FileExists      "$COLLAB_SVC/Dockerfile"                    "Collab-service Dockerfile"
    FileContains    "$COLLAB_SVC/Dockerfile" "standalone\.ts"    "Collab Dockerfile: CMD uses standalone.ts"
    FileContains    "$COLLAB_SVC/Dockerfile" "EXPOSE 1234"       "Collab Dockerfile: exposes port 1234"
    FileContains    "$COLLAB_SVC/Dockerfile" "oven/bun"          "Collab Dockerfile: uses bun image"
    FileExists      "$COLLAB_SVC/src/standalone.ts"              "Standalone collab-service entry point"
    FileContains    "$COLLAB_SVC/src/standalone.ts" "CollabServer"  "standalone.ts: imports CollabServer"
    FileContains    "$COLLAB_SVC/src/standalone.ts" "SIGTERM"       "standalone.ts: handles SIGTERM"
    FileContains    "$COLLAB_SVC/src/standalone.ts" "SIGINT"        "standalone.ts: handles SIGINT"

    # Config system
    FileContains    "$CONFIG/index.ts"      "collabMode"        "AppConfig: collabMode field"
    FileContains    "$CONFIG/index.ts"      "collabUrl"         "AppConfig: collabUrl field"
    FileContains    "$CONFIG/index.ts"      "COLLAB_MODE"       "Config: COLLAB_MODE env override"
    FileContains    "$CONFIG/index.ts"      "COLLAB_URL"        "Config: COLLAB_URL env override"
    FileContains    "$CONFIG/default.ts"    'collabMode.*embedded'       "Default: collabMode=embedded"
    FileContains    "$CONFIG/default.ts"    'collabUrl.*ws://localhost'   "Default: collabUrl=ws://localhost:1234"
    FileContains    "$CONFIG/production.ts" 'collabMode.*external'       "Production: collabMode=external"
    FileContains    $ENV_EX                 "COLLAB_MODE"       ".env.example: COLLAB_MODE documented"
    FileContains    $ENV_EX                 "COLLAB_URL"        ".env.example: COLLAB_URL documented"

    # Backend Dockerfile -- workspace package deps
    FileContains    "$BE/Dockerfile"  "agent-manager"    "Backend Dockerfile: includes agent-manager"
    FileContains    "$BE/Dockerfile"  "collaboration"     "Backend Dockerfile: includes collaboration"
    FileContains    "$BE/Dockerfile"  "workspace"         "Backend Dockerfile: includes workspace"
    FileContains    "$BE/Dockerfile"  "knowledge"         "Backend Dockerfile: includes knowledge"
}

# -- Step 0.2: MongoDB Atlas ---------------------------------

if (ShouldRun 0 2) {
    Section "Step 0.2: MongoDB Atlas setup"
    FileContains $ENV_EX "mongodb.srv"  ".env.example: Atlas connection string template"
}

# -- Step 0.3: Graceful shutdown -----------------------------

if (ShouldRun 0 3) {
    Section "Step 0.3: Graceful shutdown flush"
    FileContains "$BE/server.ts"  "SIGTERM"     "server.ts: SIGTERM handler"
    FileContains "$BE/server.ts"  "SIGINT"      "server.ts: SIGINT handler"
    FileContains "$BE/server.ts"  "flushAll"    "server.ts: calls flushAll on shutdown"
    FileContains "$BE/agentManager/AgentManagerRegistry.ts" "flushAll" "Registry: flushAll method"
}

# -- Step 0.4: Storage interfaces ---------------------------

if (ShouldRun 0 4) {
    Section "Step 0.4: Storage interfaces"
    FileExists "$BE/storage/AppStateStorage.ts"  "AppStateStorage interface"
    FileExists "$BE/storage/WorkspaceStorage.ts" "WorkspaceStorage interface"
    FileExists "$BE/storage/index.ts"            "Storage barrel export"
    FileContains "$CONFIG/index.ts" "storageType"  "AppConfig: storageType field"
    FileContains $ENV_EX "STORAGE_TYPE"             ".env.example: STORAGE_TYPE documented"
}

# -- Step 0.5: Auth (better-auth) ----------------------------

if (ShouldRun 0 5) {
    Section "Step 0.5: Production auth (better-auth)"
    FileExists "$BE/auth/index.ts"                      "Auth module"
    FileExists "$FE/lib/auth-client.ts"                 "Frontend auth client"
    FileExists "$FE/components/Auth/LoginPage.tsx"      "Login page"
    FileContains "$BE/api/HttpServer.ts" "authHandler"  "Auth handler mounted"
    FileContains $ENV_EX "BETTER_AUTH_SECRET"            "BETTER_AUTH_SECRET documented"
}

# -- Step 0.6: Chat history ---------------------------------

if (ShouldRun 0 6) {
    Section "Step 0.6: Server-side chat history"
    FileExists "$BE/db/models/ChatMessage.ts"                    "ChatMessage model"
    FileContains "$BE/api/HttpServer.ts" "messages"              "Messages endpoint"
    FileContains "$FE/services/AgentServiceV2.ts" "getMessages"  "Frontend getMessages"
}

# -- Step 0.7: Goal history ---------------------------------

if (ShouldRun 0 7) {
    Section "Step 0.7: Goal and execution history"
    FileExists "$BE/db/models/Goal.ts"                   "Goal model"
    FileContains "$BE/api/HttpServer.ts" "goals"         "Goals endpoint"
}

# -- Step 0.8: Session recovery -----------------------------

if (ShouldRun 0 8) {
    Section "Step 0.8: Session recovery API"
    FileContains "$BE/api/HttpServer.ts" "restore"  "Session restore endpoint"
}

# -- Step 0.9: Health check ---------------------------------

if (ShouldRun 0 9) {
    Section "Step 0.9: Extended health check"
    FileContains "$BE/api/HttpServer.ts" "api/v2/health"  "Extended health endpoint"
    FileContains "$BE/api/HttpServer.ts" "readyState"     "Health check: MongoDB status"
    FileContains "$BE/api/HttpServer.ts" "uptime"         "Health check: uptime"
}

} # end Phase 0

# ============================================================
#  PHASE 1 -- Backend Logging (Pino Migration)
# ============================================================

if ($Phase -eq 1 -or $Phase -eq -1) {
PhaseHeader "Phase 1: Backend Logging (Pino)"

if (ShouldRun 1 1) {
    Section "Step 1.1: Shared logging module"
    FileExists "$BE/logging/index.ts"            "Logging module"
    FileContains "$BE/logging/index.ts" "pino"   "Uses pino"
    FileContains $ENV_EX "LOG_LEVEL"             "LOG_LEVEL documented"
}

if (ShouldRun 1 2) {
    Section "Step 1.2: Migrate packages/backend"
    FileContains "$BE/server.ts" "rootLogger"                   "server.ts uses rootLogger"
    FileNotContains "$BE/server.ts" "from .tslog."              "server.ts: no tslog import"
    FileNotContains "$BE/api/HttpServer.ts" "from .tslog."      "HttpServer: no tslog import"
    FileNotContains "$BE/api/SocketServerV2.ts" "from .tslog."  "SocketServerV2: no tslog import"
}

if (ShouldRun 1 3) {
    Section "Step 1.3: Migrate packages/agent-manager"
    FileExists "$AM/src/logging.ts"                             "agent-manager logging module"
    FileNotContains "$AM/src/AgentManagerV2.ts" "from .tslog."  "AgentManagerV2: no tslog"
}

if (ShouldRun 1 4) {
    Section "Step 1.4: Migrate packages/workspace"
    FileExists "packages/workspace/src/logging.ts"                         "workspace logging module"
    FileNotContains "packages/workspace/src/L1/L1WorkspacePlugin.ts" "from .tslog."  "L1Plugin: no tslog"
}

if (ShouldRun 1 5) {
    Section "Step 1.5: Migrate packages/collaboration"
    FileExists "$COLLAB/src/logging.ts"                                          "collaboration logging module"
    FileNotContains "$COLLAB/src/L2/L2CollaborationPlugin.ts" "from .tslog."     "L2Plugin: no tslog"
}

if (ShouldRun 1 6) {
    Section "Step 1.6: Migrate packages/knowledge"
    FileExists "packages/knowledge/src/logging.ts"                               "knowledge logging module"
    FileNotContains "packages/knowledge/src/L3/L3KnowledgePlugin.ts" "from .tslog." "L3Plugin: no tslog"
}

if (ShouldRun 1 7) {
    Section "Step 1.7: Migrate packages/registry"
    FileExists "packages/registry/logging.ts"                              "registry logging module"
    FileNotContains "packages/registry/index.ts" "from .tslog."            "registry index: no tslog"
}

if (ShouldRun 1 8) {
    Section "Step 1.8: Cleanup -- tslog removed"
    FileNotContains "$BE/package.json" "tslog"                     "backend: no tslog dep"
    FileNotContains "$AM/package.json" "tslog"                     "agent-manager: no tslog dep"
    FileNotContains "packages/workspace/package.json" "tslog"      "workspace: no tslog dep"
    FileNotContains "$COLLAB/package.json" "tslog"                 "collaboration: no tslog dep"
    FileNotContains "packages/knowledge/package.json" "tslog"      "knowledge: no tslog dep"
    FileNotContains "packages/registry/package.json" "tslog"       "registry: no tslog dep"
}

} # end Phase 1

# ============================================================
#  PHASE 2 -- Frontend Logger
# ============================================================

if ($Phase -eq 2 -or $Phase -eq -1) {
PhaseHeader "Phase 2: Frontend Logger"

if (ShouldRun 2 1) {
    Section "Step 2.1: Logger utility"
    FileExists "$FE/utils/logger.ts"  "Frontend logger"
}

if (ShouldRun 2 2) {
    Section "Step 2.2: Replace console calls"
    FileContains "$FE/services/AgentServiceV2.ts" "logger\.info"   "AgentServiceV2: uses logger.info"
    FileContains "$FE/hooks/useAgentTree.ts" "logger\.error"       "useAgentTree: uses logger.error"
    FileContains "$FE/components/ChatArea/ChatArea.tsx" "logger\.error"  "ChatArea: uses logger.error"
}

} # end Phase 2

# ============================================================
#  PHASE 3 -- Feature Flags
# ============================================================

if ($Phase -eq 3 -or $Phase -eq -1) {
PhaseHeader "Phase 3: Feature Flags"

if (ShouldRun 3 1) {
    Section "Step 3.1: FeatureFlags type + defaults"
    FileExists "$CONFIG/featureFlags.ts"                  "FeatureFlags module"
    FileContains "$CONFIG/index.ts" "featureFlags"        "AppConfig: featureFlags field"
    FileContains "$CONFIG/featureFlags.ts" "FRONTEND_FLAG_KEYS"  "Frontend flag keys defined"
}

if (ShouldRun 3 2) {
    Section "Step 3.2: Migrate existing flags"
    FileContains "$CONFIG/featureFlags.ts" "FF_ENV_MAP"   "FF env var mapping defined"
    FileContains $ENV_EX "FF_ENABLE_COST_TRACKING"         "FF env vars documented"
}

if (ShouldRun 3 3) {
    Section "Step 3.3: Feature flags API"
    FileContains "$BE/api/HttpServer.ts" "feature-flags"  "Feature flags endpoint"
}

if (ShouldRun 3 4) {
    Section "Step 3.4: Frontend feature flags hook"
    FileExists "$FE/hooks/useFeatureFlags.ts"  "useFeatureFlags hook"
}

} # end Phase 3

# ============================================================
#  PHASE 4 -- File Storage Abstraction
# ============================================================

if ($Phase -eq 4 -or $Phase -eq -1) {
PhaseHeader "Phase 4: File Storage"

if (ShouldRun 4 1) {
    Section "Step 4.1: StorageProvider interface"
    FileExists "$BE/storage/AppStateStorage.ts"     "AppStateStorage interface"
    FileExists "$BE/storage/WorkspaceStorage.ts"    "WorkspaceStorage interface"
    FileExists "$BE/storage/index.ts"               "Storage factory"
}

if (ShouldRun 4 2) {
    Section "Step 4.2: Wire into existing stores"
    FileContains "$AM/src/persistence/FileTaskStore.ts" "StorageProvider"  "FileTaskStore: accepts StorageProvider"
    FileContains "$AM/src/persistence/FilePlanStore.ts" "StorageProvider"  "FilePlanStore: accepts StorageProvider"
}

if (ShouldRun 4 3) {
    Section "Step 4.3: Azure Blob StorageProvider"
    FileExists "$BE/storage/AzureBlobStorageProvider.ts"  "AzureBlobStorageProvider"
    FileContains "$BE/storage/index.ts" "azure"           "Storage factory: azure support"
    FileContains $ENV_EX "AZURE_STORAGE_CONNECTION_STRING" "Azure env vars documented"
}

if (ShouldRun 4 4) {
    Section "Step 4.4: Git remote push"
    FileContains "packages/workspace/src/L1/workspace/GitBranchManager.ts" "addRemote"  "GitBranchManager: addRemote"
    FileContains "packages/workspace/src/L1/workspace/GitBranchManager.ts" "async push"  "GitBranchManager: push"
    FileContains "$BE/api/HttpServer.ts" "workspaces.*push"  "Push endpoint"
}

} # end Phase 4

# ============================================================
#  BUILD VERIFICATION
# ============================================================

if (!$SkipBuild) {
    PhaseHeader "Build Verification"

    Section "Backend build"
    Push-Location "$BE"
    $null = bun run build 2>&1
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -eq 0) { Pass "bun run build:backend succeeds" } else { Fail "bun run build:backend failed (exit $code)" }

    # TODO: Uncomment when frontend changes are made
    # Section "Frontend build"
    # Push-Location "$FE"
    # $null = bun run build 2>&1
    # $code = $LASTEXITCODE
    # Pop-Location
    # if ($code -eq 0) { Pass "bun run build:frontend succeeds" } else { Fail "bun run build:frontend failed" }
}

# ============================================================
#  SUMMARY
# ============================================================

$total = $script:passed + $script:failed + $script:skipped
Write-Host "`n============================================" -ForegroundColor White
Write-Host "  Total:   $total" -ForegroundColor White
Write-Host "  Passed:  $($script:passed)" -ForegroundColor Green
if ($script:failed -gt 0)  { Write-Host "  Failed:  $($script:failed)" -ForegroundColor Red }
if ($script:skipped -gt 0) { Write-Host "  Skipped: $($script:skipped)" -ForegroundColor Yellow }
Write-Host "============================================`n" -ForegroundColor White

Pop-Location

exit $script:failed
