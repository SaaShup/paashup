#!/usr/bin/env bash
# Local CI — mirrors .github/workflows/ci.yml so you can run the full pipeline
# before pushing. Stages whose tools aren't installed (Docker, Ruff, Trivy) are
# SKIPPED with a hint rather than failing. Exit code is non-zero only on FAIL.
#
# Usage:
#   npm run ci                 # everything available
#   scripts/ci.sh lint test    # only the named stages
#   SKIP_DOCKER=1 npm run ci    # force-skip docker stages
set -u
cd "$(dirname "$0")/.."

# ---------- pretty output + result tracking ----------
BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
PASS=(); FAIL=(); SKIP=()
have() { command -v "$1" >/dev/null 2>&1; }
banner() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RST"; }
pass() { PASS+=("$1"); printf '%s✓ %s%s\n' "$GRN" "$1" "$RST"; }
skip() { SKIP+=("$1"); printf '%s- SKIP %s%s (%s)\n' "$YEL" "$1" "$RST" "${2:-unavailable}"; }
fail() { FAIL+=("$1"); printf '%s✗ %s%s\n' "$RED" "$1" "$RST"; }
run()  { printf '%s$ %s%s\n' "$DIM" "$*" "$RST"; "$@"; }

# stage <name> <command...> : run a command, record pass/fail
stage() { local name="$1"; shift; banner "$name"; if run "$@"; then pass "$name"; else fail "$name"; fi; }

# which stages to run (default: all)
WANT="${*:-lint test security build web test-mariadb}"
wants() { case " $WANT " in *" $1 "*) return 0;; *) return 1;; esac; }

cleanup() { docker rm -f paas2box-ci-app paas2box-ci-maria >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ---------- ensure deps ----------
if [ ! -d node_modules ]; then stage "install" npm ci; fi

# ---------- lint ----------
if wants lint; then
  banner "lint"
  if run npm run format:check; then pass "prettier"; else fail "prettier"; fi
  if run npm run lint; then pass "eslint"; else fail "eslint"; fi
  if have ruff; then
    if run ruff format --check .; then pass "ruff-format"; else fail "ruff-format"; fi
    if run ruff check .; then pass "ruff-check"; else fail "ruff-check"; fi
  else
    skip "ruff" "pip install ruff"
  fi
fi

# ---------- test (SQLite) ----------
wants test && stage "test (sqlite)" npm test

# ---------- security ----------
if wants security; then
  banner "security"
  if run npm audit --audit-level=high; then pass "npm-audit"; else fail "npm-audit"; fi
  if have trivy; then
    if run trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress .; then
      pass "trivy"; else fail "trivy"; fi
  else
    skip "trivy" "https://aquasecurity.github.io/trivy"
  fi
fi

# ---------- build + Docker image smoke ----------
if wants build; then
  stage "build (tsc)" npm run build
  if [ "${SKIP_DOCKER:-0}" = "1" ]; then skip "docker-image" "SKIP_DOCKER=1"
  elif ! have docker; then skip "docker-image" "docker not installed"
  else
    banner "docker image"
    if run docker build -t paas2box:ci-local .; then
      docker rm -f paas2box-ci-app >/dev/null 2>&1 || true
      docker run -d --name paas2box-ci-app -e PB_MIGRATE=1 -p 18000:8000 paas2box:ci-local >/dev/null
      ok=""
      for _ in $(seq 1 30); do
        [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:18000/api/dcim/manufacturers/ 2>/dev/null)" = "200" ] && { ok=1; break; }
        sleep 1
      done
      if [ -n "$ok" ] \
        && curl -sf -X POST localhost:18000/api/dcim/manufacturers/ -H 'Content-Type: application/json' -d '{"name":"Acme","slug":"acme"}' >/dev/null \
        && curl -sf 'localhost:18000/api/dcim/manufacturers/?limit=1' | grep -q '"count":1'; then
        pass "docker-image"
      else
        docker logs paas2box-ci-app 2>&1 | tail -20; fail "docker-image"
      fi
      docker rm -f paas2box-ci-app >/dev/null 2>&1 || true
    else
      fail "docker-image"
    fi
  fi
fi

# ---------- web (frontend build) ----------
if wants web; then
  if have npm && [ -d web ]; then
    banner "web"
    [ -d web/node_modules ] || (cd web && npm ci >/dev/null 2>&1)
    if (cd web && npm run build && npm test); then pass "web"; else fail "web"; fi
  else
    skip "web" "npm or web/ missing"
  fi
fi

# ---------- test (MariaDB) ----------
if wants test-mariadb; then
  if [ "${SKIP_DOCKER:-0}" = "1" ]; then skip "test (mariadb)" "SKIP_DOCKER=1"
  elif ! have docker; then skip "test (mariadb)" "docker not installed"
  else
    banner "test (mariadb)"
    docker rm -f paas2box-ci-maria >/dev/null 2>&1 || true
    docker run -d --name paas2box-ci-maria -p 13306:3306 \
      -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=paas2box mariadb:11 >/dev/null
    ready=""
    for _ in $(seq 1 60); do
      docker exec paas2box-ci-maria mariadb -uroot -proot -e "SELECT 1" >/dev/null 2>&1 && { ready=1; break; }
      sleep 1
    done
    if [ -z "$ready" ]; then fail "test (mariadb)"; else
      docker exec -i paas2box-ci-maria mariadb -uroot -proot paas2box < migrations/0001_initial.mariadb.sql
      docker exec -i paas2box-ci-maria mariadb -uroot -proot paas2box < migrations/0002_auth_token.mariadb.sql
      if DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD=root DB_NAME=paas2box \
           run npm run test:mariadb; then pass "test (mariadb)"; else fail "test (mariadb)"; fi
    fi
    docker rm -f paas2box-ci-maria >/dev/null 2>&1 || true
  fi
fi

# ---------- summary ----------
banner "summary"
[ ${#PASS[@]} -gt 0 ] && printf '%spassed:%s  %s\n' "$GRN" "$RST" "${PASS[*]}"
[ ${#SKIP[@]} -gt 0 ] && printf '%sskipped:%s %s\n' "$YEL" "$RST" "${SKIP[*]}"
[ ${#FAIL[@]} -gt 0 ] && printf '%sfailed:%s  %s\n' "$RED" "$RST" "${FAIL[*]}"
if [ ${#FAIL[@]} -gt 0 ]; then printf '\n%sCI FAILED%s\n' "$RED$BOLD" "$RST"; exit 1; fi
printf '\n%sCI PASSED%s\n' "$GRN$BOLD" "$RST"
