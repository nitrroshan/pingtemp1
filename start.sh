#!/usr/bin/env bash
# Ping Monorepo — Interactive Service Manager (macOS/Linux)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=3002
FRONTEND_PORT=3000
MONGO_PORT=27017
OLLAMA_PORT=11434
COLLAB_PORT=1234

# ─── Colors ───────────────────────────────────────────────────────────
cyan='\033[0;36m'  green='\033[0;32m'  yellow='\033[0;33m'
red='\033[0;31m'   dim='\033[2m'       bold='\033[1m'  reset='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────
info()  { printf "  ${green}%s${reset}\n" "$*"; }
warn()  { printf "  ${yellow}%s${reset}\n" "$*"; }
err()   { printf "  ${red}%s${reset}\n" "$*"; }
dim()   { printf "  ${dim}%s${reset}\n" "$*"; }

port_pid() { lsof -ti :"$1" 2>/dev/null || true; }

kill_port() {
  local name=$1 port=$2
  local pids
  pids=$(port_pid "$port")
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    info "$name stopped (port $port)"
  else
    dim "$name not running (port $port)"
  fi
}

is_running() { [[ -n "$(port_pid "$1")" ]]; }

# Open a command in a new Terminal.app window (macOS)
new_terminal() {
  local title="$1" dir="$2" cmd="$3"
  osascript <<EOF
tell application "Terminal"
  activate
  set w to do script "cd '$dir' && echo '=== $title ===' && $cmd"
  set custom title of front window to "$title"
end tell
EOF
}

# ─── MongoDB ──────────────────────────────────────────────────────────
require_docker() {
  if ! command -v docker &>/dev/null; then
    err "Docker not found. Install Docker Desktop: https://docs.docker.com/desktop/install/mac-install/"
    err "Or install via Homebrew:  brew install --cask docker"
    return 1
  fi
  if ! docker info &>/dev/null; then
    err "Docker is installed but not running. Start Docker Desktop first."
    return 1
  fi
  return 0
}

start_mongo() {
  require_docker || return 1
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ping-mongo$'; then
    warn "MongoDB already running"
    return
  fi
  warn "Starting MongoDB..."
  if docker start ping-mongo 2>/dev/null; then
    info "MongoDB started (existing container)"
  else
    docker run -d --name ping-mongo -p "${MONGO_PORT}:27017" -v ping-mongo-data:/data/db mongo:7 >/dev/null
    info "MongoDB started (new container)"
  fi
}

stop_mongo() {
  command -v docker &>/dev/null || { dim "Docker not installed, skipping"; return; }
  if docker stop ping-mongo 2>/dev/null; then
    info "MongoDB stopped"
  else
    dim "MongoDB not running"
  fi
}

# ─── Ollama ────────────────────────────────────────────────────────────
# Check if .env MODEL_ID requires Ollama
needs_ollama() {
  local model_id
  model_id=$(grep '^MODEL_ID=' "$ROOT/packages/backend/.env" 2>/dev/null | cut -d= -f2)
  [[ "$model_id" == ollama:* ]]
}

start_ollama() {
  if ! needs_ollama; then
    dim "Ollama not needed (MODEL_ID is not ollama:*)"
    return 0
  fi
  if is_running $OLLAMA_PORT; then
    warn "Ollama already running on :$OLLAMA_PORT"
    return
  fi
  if ! command -v ollama &>/dev/null; then
    # Try homebrew path
    if [[ -x /opt/homebrew/bin/ollama ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    else
      err "Ollama not found but MODEL_ID requires it."
      err "Install:  brew install ollama  (macOS)  or  https://ollama.com/download (Windows/Linux)"
      err "Or change MODEL_ID in packages/backend/.env to use an API provider."
      return 1
    fi
  fi
  warn "Starting Ollama..."
  ollama serve &>/dev/null &
  sleep 2
  if is_running $OLLAMA_PORT; then
    info "Ollama running on :$OLLAMA_PORT"
    # Pull model from .env if set
    local model_id
    model_id=$(grep '^MODEL_ID=' "$ROOT/packages/backend/.env" 2>/dev/null | cut -d= -f2)
    local model_name="${model_id#ollama:}"
    if ! ollama list 2>/dev/null | grep -q "$model_name"; then
      warn "Pulling model $model_name..."
      ollama pull "$model_name"
      info "Model $model_name ready"
    else
      dim "Model $model_name already downloaded"
    fi
  else
    err "Ollama failed to start"
  fi
}

stop_ollama() {
  local pids
  pids=$(port_pid $OLLAMA_PORT)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    info "Ollama stopped"
  else
    # Also try brew services
    if command -v brew &>/dev/null; then
      brew services stop ollama 2>/dev/null
    fi
    dim "Ollama not running"
  fi
}

# ─── Core Actions ─────────────────────────────────────────────────────
do_install() { cd "$ROOT" && bun install; }

do_build() {
  warn "Building..."
  cd "$ROOT" && bun run build
  info "Build complete"
}

do_seed() {
  warn "Seeding..."
  # Ensure MongoDB is running
  if command -v docker &>/dev/null; then
    start_mongo 2>/dev/null
    sleep 1
  fi
  cd "$ROOT" && bun run seed
  # Also seed admin user
  cd "$ROOT/packages/backend" && bun run seed:admin 2>/dev/null
  cd "$ROOT"
  info "Seed complete (teams + admin user)"
}

do_reset_db() {
  printf "  ${red}This will DELETE all MongoDB data. Continue? [y/N]${reset} "
  read -r confirm
  if [[ "$confirm" == "y" ]]; then
    start_mongo
    sleep 1
    cd "$ROOT" && bun run db:reset
    info "Database reset complete"
  else
    dim "Cancelled"
  fi
}

do_clean() {
  printf "  ${red}This will DELETE all data (workspaces, plans, messages, auth). Continue? [y/N]${reset} "
  read -r confirm
  if [[ "$confirm" != "y" ]]; then
    dim "Cancelled"
    return
  fi

  local data_dir="$ROOT/packages/backend/data"
  if [[ -d "$data_dir" ]]; then
    # Remove workspaces (git clones, agent work)
    rm -rf "$data_dir/workspaces" 2>/dev/null && info "Workspaces cleared"
    # Remove task persistence
    rm -rf "$data_dir/tasks" 2>/dev/null && info "Tasks cleared"
    # Remove plans
    rm -rf "$data_dir/plans" 2>/dev/null && info "Plans cleared"
    # Remove SQLite DBs (auth + local storage)
    rm -f "$data_dir/auth.db" "$data_dir/auth.db-shm" "$data_dir/auth.db-wal" 2>/dev/null && info "Auth DB cleared"
    rm -f "$data_dir/ping.db" "$data_dir/ping.db-shm" "$data_dir/ping.db-wal" 2>/dev/null && info "Local DB cleared"
    # Remove conversations
    rm -rf "$data_dir/conversations" 2>/dev/null
    # Remove CRDT collab data
    rm -rf "$data_dir/collab" 2>/dev/null && info "CRDT data cleared"
    info "All local data cleared."
  else
    dim "No data directory found"
  fi

  # Also clear MongoDB if docker is available
  if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ping-mongo$'; then
    docker exec ping-mongo mongosh "mongodb://localhost:27017/ping" --quiet --eval '
      db.getCollectionNames().forEach(c => { if (c !== "system.version") db[c].deleteMany({}); });
    ' 2>/dev/null && info "MongoDB cleared (all collections)"

    # Re-seed admin user into MongoDB (cloud mode)
    cd "$ROOT/packages/backend" && PING_MODE=cloud bun run seed:admin 2>/dev/null && info "Admin user re-seeded (MongoDB)"
  else
    # Re-seed admin user into SQLite (local mode)
    cd "$ROOT/packages/backend" && bun run seed:admin 2>/dev/null && info "Admin user re-seeded (SQLite)"
  fi
  cd "$ROOT"

  info "Clean complete."
}

start_backend() {
  if is_running $BACKEND_PORT; then
    warn "Backend already running on :$BACKEND_PORT"
    return
  fi
  warn "Starting backend in new terminal..."
  new_terminal "Ping - Backend" "$ROOT/packages/backend" "PING_MODE=${1:-local} bun dist/server.js"
  info "Backend starting on :$BACKEND_PORT"
}

start_frontend() {
  if is_running $FRONTEND_PORT; then
    warn "Frontend already running on :$FRONTEND_PORT"
    return
  fi
  warn "Starting frontend in new terminal..."
  new_terminal "Ping - Frontend" "$ROOT" "bun run dev:frontend"
  info "Frontend starting on :$FRONTEND_PORT"
}

start_collab() {
  if is_running $COLLAB_PORT; then
    warn "Collab service already running on :$COLLAB_PORT"
    return
  fi
  warn "Starting collab service in new terminal..."
  new_terminal "Ping - Collab" "$ROOT/packages/collab-service" "bun run start"
  info "Collab service starting on :$COLLAB_PORT"
}

stop_collab() {
  kill_port "Collab" $COLLAB_PORT
}

show_status() {
  echo ""
  if is_running $BACKEND_PORT; then
    info "Backend   http://localhost:$BACKEND_PORT   RUNNING"
  else
    err  "Backend   http://localhost:$BACKEND_PORT   STOPPED"
  fi
  if is_running $FRONTEND_PORT; then
    info "Frontend  http://localhost:$FRONTEND_PORT   RUNNING"
  else
    err  "Frontend  http://localhost:$FRONTEND_PORT   STOPPED"
  fi
  if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ping-mongo$'; then
    info "MongoDB   localhost:$MONGO_PORT          RUNNING"
  else
    err  "MongoDB   localhost:$MONGO_PORT          STOPPED"
  fi
  if is_running $OLLAMA_PORT; then
    local model_id
    model_id=$(grep '^MODEL_ID=' "$ROOT/packages/backend/.env" 2>/dev/null | cut -d= -f2 || echo "")
    info "Ollama    localhost:$OLLAMA_PORT         RUNNING  ${model_id:-}"
  else
    err  "Ollama    localhost:$OLLAMA_PORT         STOPPED"
  fi
  if is_running $COLLAB_PORT; then
    info "Collab    localhost:$COLLAB_PORT          RUNNING"
  else
    err  "Collab    localhost:$COLLAB_PORT          STOPPED"
  fi
  echo ""
}

stop_all() {
  kill_port "Backend"  $BACKEND_PORT
  kill_port "Frontend" $FRONTEND_PORT
  stop_collab
  stop_mongo
  stop_ollama
}

# ─── Menu ─────────────────────────────────────────────────────────────
show_menu() {
  echo ""
  printf "  ${bold}${cyan}═══════ Ping Monorepo ═══════${reset}\n"
  echo ""
  printf "  ${cyan}Dev${reset}\n"
  printf "  ${green}1${reset}  Dev Local    ${dim}build + seed + start (no MongoDB)${reset}\n"
  printf "  ${green}2${reset}  Dev Cloud    ${dim}MongoDB + build + seed + start${reset}\n"
  echo ""
  printf "  ${cyan}Start / Stop${reset}\n"
  printf "  ${green}3${reset}  Frontend     ${dim}Vite dev server :$FRONTEND_PORT${reset}\n"
  printf "  ${green}4${reset}  Backend      ${dim}build + start :$BACKEND_PORT${reset}\n"
  printf "  ${green}5${reset}  MongoDB      ${dim}Docker container${reset}\n"
  printf "  ${green}6${reset}  Ollama       ${dim}Local LLM :$OLLAMA_PORT${reset}\n"
  printf "  ${green}10${reset} Collab       ${dim}CRDT server :$COLLAB_PORT${reset}\n"
  printf "  ${red}7${reset}  Stop All\n"
  echo ""
  printf "  ${cyan}Tools${reset}\n"
  printf "  ${yellow}8${reset}  Build        ${dim}bun run build${reset}\n"
  printf "  ${yellow}9${reset}  Seed         ${dim}seed admin user${reset}\n"
  printf "  ${red}c${reset}  Clean        ${dim}delete all local data${reset}\n"
  printf "  ${yellow}s${reset}  Status\n"
  printf "  ${red}0${reset}  ${dim}Exit${reset}\n"
  echo ""
}

# ─── Main Loop ────────────────────────────────────────────────────────
main() {
  while true; do
    show_menu
    printf "  Choose: "
    read -r choice

    case "$choice" in
      1)
        echo ""
        info "=== Dev Local ==="
        do_install
        start_ollama
        do_build
        do_seed
        start_backend local
        sleep 2
        start_frontend
        echo ""
        info "Local dev ready! File-based storage, teams from plugins."
        ;;
      2)
        echo ""
        info "=== Dev Cloud ==="
        do_install
        start_ollama
        start_mongo
        sleep 2
        do_build
        do_seed
        start_backend cloud
        sleep 2
        start_frontend
        echo ""
        info "Cloud dev ready! MongoDB for chat/auth, teams from plugins."
        ;;
      3) start_frontend ;;
      4) do_build && start_backend local ;;
      5) start_mongo ;;
      6) start_ollama ;;
      7) stop_all ;;
      8) do_build ;;
      9) do_seed ;;
      10) start_collab ;;
      c|C) do_clean ;;
      s|S) show_status ;;
      0) dim "Bye!"; exit 0 ;;
      *) err "Invalid option" ;;
    esac
  done
}

main "$@"
