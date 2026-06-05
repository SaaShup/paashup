#!/usr/bin/env bash
# Benchmark orchestrator: brings a target up, measures image-acquire + boot-to-ready
# time, runs the POST/GET benchmark, tears it down, and writes bench/results/<target>.json.
#
# Usage:
#   bench/run.sh paasbox-sqlite
#   bench/run.sh paasbox-mariadb
#   bench/run.sh netbox
#   REQUESTS=1000 CONCURRENCY=32 bench/run.sh paasbox-sqlite
#   bench/run.sh report                 # combine results into a markdown table
set -uo pipefail
cd "$(dirname "$0")" || exit 1
mkdir -p results

REQUESTS="${REQUESTS:-1000}"
CONCURRENCY="${CONCURRENCY:-32}"
BASE="http://localhost:8000"
READY_PATH="/api/dcim/manufacturers/?limit=1"

now_ms() { date +%s%3N; }
dc() { docker compose -p "pbx-bench" -f "$COMPOSE" "$@"; }

http_code() { # $1=token (optional)
  if [ -n "${1:-}" ]; then
    curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Token $1" "$BASE$READY_PATH" 2>/dev/null
  else
    curl -s -o /dev/null -w '%{http_code}' "$BASE$READY_PATH" 2>/dev/null
  fi
}

run_target() {
  local target="$1" token="" acquire_ms boot_ms t0
  case "$target" in
    paasbox-sqlite)  COMPOSE="compose/paasbox-sqlite.yml" ;;
    paasbox-mariadb) COMPOSE="compose/paasbox-mariadb.yml" ;;
    netbox)          COMPOSE="compose/netbox.yml"; token="0123456789abcdef0123456789abcdef01234567" ;;
    *) echo "unknown target: $target"; exit 1 ;;
  esac

  echo "### $target — tearing down any previous run"
  dc down -v >/dev/null 2>&1 || true

  # ---- acquire image (build for paasbox, pull for netbox) ----
  echo "### $target — acquiring image"
  t0=$(now_ms)
  if [ "$target" = "netbox" ]; then dc pull >/dev/null 2>&1; else dc build >/dev/null 2>&1; fi
  acquire_ms=$(( $(now_ms) - t0 ))

  # ---- boot to ready ----
  echo "### $target — booting"
  t0=$(now_ms)
  dc up -d >/dev/null 2>&1

  local tries=240   # netbox first boot can take minutes

  if [ "$target" = "paasbox-mariadb" ]; then
    # wait for db health, then apply migrations (part of "deployment")
    for _ in $(seq 1 60); do
      [ "$(dc ps db --format '{{.Health}}' 2>/dev/null)" = "healthy" ] && break; sleep 2
    done
    dc exec -T db mariadb -uroot -proot paasbox < ../migrations/0001_initial.mariadb.sql
    dc exec -T db mariadb -uroot -proot paasbox < ../migrations/0002_auth_token.mariadb.sql
  fi

  if [ "$target" = "netbox" ]; then
    # wait until NetBox serves (403 = up, auth required), then mint a fixed v1 token
    for _ in $(seq 1 "$tries"); do
      c=$(http_code ""); { [ "$c" = "403" ] || [ "$c" = "200" ]; } && break; sleep 2
    done
    dc exec -T netbox /opt/netbox/netbox/manage.py shell -c "
from django.contrib.auth import get_user_model
from users.models import Token
U=get_user_model()
u=U.objects.filter(is_superuser=True).first() or U.objects.create_superuser('bench','b@e.com','benchpass12')
u.tokens.all().delete()
Token(user=u, version=1, token='$token').save()
print('token-ready')
" >/dev/null 2>&1
  fi

  local ready="" code
  for _ in $(seq 1 "$tries"); do
    code=$(http_code "$token")
    if [ "$code" = "200" ]; then ready=1; break; fi
    sleep 2
  done
  boot_ms=$(( $(now_ms) - t0 ))

  if [ -z "$ready" ]; then
    echo "!!! $target never became ready (last HTTP $code). Logs:"; dc logs --tail 30 || true
    dc down -v >/dev/null 2>&1 || true
    return 1
  fi
  echo "### $target — ready in ${boot_ms}ms (acquire ${acquire_ms}ms)"

  # ---- benchmark ----
  local tokarg=(); [ -n "$token" ] && tokarg=(--token "$token")
  node bench.mjs --base "$BASE" "${tokarg[@]}" --label "$target" \
    --requests "$REQUESTS" --concurrency "$CONCURRENCY" --json "results/$target.bench.json"

  # ---- merge startup + bench ----
  node -e "
    const fs=require('fs');
    const b=JSON.parse(fs.readFileSync('results/$target.bench.json','utf8'));
    b.startup={acquire_ms:$acquire_ms, boot_ms:$boot_ms};
    fs.writeFileSync('results/$target.json', JSON.stringify(b,null,2));
    fs.rmSync('results/$target.bench.json');
  "
  echo "### $target — wrote results/$target.json"

  dc down -v >/dev/null 2>&1 || true
}

if [ "${1:-}" = "report" ]; then node report.mjs; exit 0; fi
[ $# -lt 1 ] && { echo "usage: run.sh <paasbox-sqlite|paasbox-mariadb|netbox|report>"; exit 1; }
run_target "$1"
