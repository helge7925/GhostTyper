#!/usr/bin/env bash

set -u
set -o pipefail

COMPOSE_FILE="config/docker-compose.dev.yml"
BASE_URL="${BASE_URL:-http://localhost:3000}"
FULL=0
PDF_CHECK=0
BUILD_IMAGES=0
DB_INIT_SECRET="${DB_INIT_SECRET:-}"
FAILURES=0

COMPOSE=(docker compose -f "$COMPOSE_FILE")

usage() {
  cat <<'EOF'
Usage: bash scripts/smoke-test.sh [options]

Options:
  --full         Run npm test + lint + build before smoke checks.
  --pdf          Validate Chromium PDF render in container.
  --build        Rebuild Docker images before starting stack.
  --base-url URL Override host URL (default: http://localhost:3000).
  --help         Show this help.
EOF
}

log() {
  printf '[INFO] %s\n' "$1"
}

ok() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

run_step() {
  local name="$1"
  shift
  log "$name"
  if "$@"; then
    ok "$name"
  else
    fail "$name"
  fi
}

wait_healthy() {
  local container="$1"
  local timeout_seconds="${2:-120}"
  local start now status
  start="$(date +%s)"
  while true; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [ "$status" = "healthy" ]; then
      return 0
    fi
    now="$(date +%s)"
    if [ $((now - start)) -ge "$timeout_seconds" ]; then
      printf 'Container %s status: %s\n' "$container" "${status:-unknown}"
      return 1
    fi
    sleep 2
  done
}

http_status_host() {
  local method="$1"
  local path="$2"
  local header="${3:-}"
  local url="${BASE_URL}${path}"
  local status
  if [ -n "$header" ]; then
    status="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" -H "$header" "$url" 2>/dev/null || true)"
  else
    status="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$url" 2>/dev/null || true)"
  fi
  printf '%s' "${status:-000}"
}

http_status_container() {
  local method="$1"
  local path="$2"
  local header="${3:-}"
  local cmd status

  cmd='wget -S -O /dev/null '
  if [ "$method" = "POST" ]; then
    cmd="${cmd} --post-data=\"\""
  fi
  if [ -n "$header" ]; then
    cmd="${cmd} --header=\"$header\""
  fi
  cmd="${cmd} \"http://127.0.0.1:3000${path}\""

  status="$("${COMPOSE[@]}" exec -T transkription-webapp sh -lc "$cmd" 2>&1 | awk '/HTTP\//{code=$2} END{print code}' | tail -n 1 | tr -d '\r' || true)"
  printf '%s' "${status:-000}"
}

assert_status() {
  local name="$1"
  local expected="$2"
  local method="$3"
  local path="$4"
  local header="${5:-}"
  local status

  status="$(http_status_host "$method" "$path" "$header")"
  if [ "$status" = "000" ] || { [ "$expected" != "403" ] && [ "$status" = "403" ]; }; then
    status="$(http_status_container "$method" "$path" "$header")"
  fi

  if [ "$status" = "$expected" ]; then
    ok "$name -> $status"
  else
    fail "$name -> erwartet $expected, erhalten $status"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --full)
      FULL=1
      ;;
    --pdf)
      PDF_CHECK=1
      ;;
    --build)
      BUILD_IMAGES=1
      ;;
    --base-url)
      shift
      if [ $# -eq 0 ]; then
        printf 'Missing value for --base-url\n' >&2
        exit 2
      fi
      BASE_URL="$1"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

if [ "$FULL" -eq 1 ]; then
  run_step "npm test" npm test
  run_step "npm run lint" npm run lint
  run_step "npm run build" npm run build
fi

if [ "$BUILD_IMAGES" -eq 1 ]; then
  run_step "Docker stack up (build)" "${COMPOSE[@]}" up --build -d
else
  run_step "Docker stack up" "${COMPOSE[@]}" up -d
fi

run_step "Warten auf DB health" wait_healthy "transkription-db" 120
run_step "Warten auf Webapp health" wait_healthy "transkription-webapp" 120

if [ -z "$DB_INIT_SECRET" ]; then
  DB_INIT_SECRET="$("${COMPOSE[@]}" exec -T transkription-webapp sh -lc 'printf %s "$DB_INIT_SECRET"' 2>/dev/null || true)"
fi
if [ -z "$DB_INIT_SECRET" ]; then
  DB_INIT_SECRET="dev-db-init-secret"
fi
log "Verwendetes DB_INIT_SECRET: ${DB_INIT_SECRET:+***gesetzt***}"

assert_status "Health endpoint" "200" "GET" "/api/health"
assert_status "DB-Init ohne Secret" "403" "POST" "/api/db-init"
assert_status "DB-Init mit Secret" "200" "POST" "/api/db-init" "x-init-secret: ${DB_INIT_SECRET}"

if [ "$PDF_CHECK" -eq 1 ]; then
  log "Chromium PDF smoke check"
  if "${COMPOSE[@]}" exec -T transkription-webapp sh -lc '
    CHROMIUM_BIN="${PDF_CHROMIUM_PATH:-chromium-browser}"
    NO_SANDBOX_FLAG=""
    if [ "${PDF_CHROMIUM_NO_SANDBOX:-false}" = "true" ]; then
      NO_SANDBOX_FLAG="--no-sandbox"
    fi
    rm -f /tmp/smoke-render.pdf
    "$CHROMIUM_BIN" --headless=new ${NO_SANDBOX_FLAG} --disable-gpu --disable-dev-shm-usage --disable-background-networking --disable-default-apps --disable-sync --metrics-recording-only --no-pdf-header-footer --print-to-pdf=/tmp/smoke-render.pdf about:blank >/tmp/chromium.out 2>/tmp/chromium.err
    code=$?
    [ "$code" -eq 0 ] && [ -s /tmp/smoke-render.pdf ]
  '; then
    ok "PDF render im Container"
  else
    fail "PDF render im Container"
  fi
fi

if [ "$FAILURES" -eq 0 ]; then
  printf '\nSmoke-Test erfolgreich.\n'
  exit 0
fi

printf '\nSmoke-Test fehlgeschlagen: %s Check(s).\n' "$FAILURES"
exit 1
