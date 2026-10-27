#!/usr/bin/env bash
#
# End-to-end against the REAL SaaShup netbox-docker-agent driving a REAL dockerd.
#
#   dind     -> a real Docker daemon (shares its unix socket with the agent)
#   paashup  -> the real paashup image (the NetBox-compatible API)
#   agent    -> saashup/netbox-docker-agent, configured to talk to paashup
#
# Flow proven:
#   1. seed a docker host + image + container in paashup
#   2. tell the agent (its /api/engine API) to create that container
#   3. the agent creates a REAL container in dind AND syncs state back to paashup
#      (bulk PATCH of the observed ContainerID/state + journal entries)
#
# Requires: docker CLI + network (pulls docker:dind and saashup/netbox-docker-agent).
# Gated so it never runs in the normal suite. Run:
#   PB_AGENT_E2E=1 tests/integration/agent/run.sh
set -euo pipefail

if [ "${PB_AGENT_E2E:-}" != "1" ]; then
  echo "skipped: set PB_AGENT_E2E=1 to run the real-agent integration"
  exit 0
fi

cd "$(dirname "$0")"
ROOT=$(cd ../../.. && pwd)
DC=(docker compose -p pbx-agent-e2e -f docker-compose.yml)
A=(curl -fsS -u admin:saashup)

fail() { echo "FAIL: $*" >&2; "${DC[@]}" logs --no-log-prefix agent 2>&1 | tail -20 >&2; exit 1; }
cleanup() { "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> building paashup image"
docker build -q -t paashup "$ROOT" >/dev/null

echo "==> starting dind + paashup"
cleanup
"${DC[@]}" up -d dind paashup >/dev/null
for _ in $(seq 1 60); do
  [ "$(curl -fsS -o /dev/null -w '%{http_code}' localhost:8000/api/schema/ 2>/dev/null)" = "200" ] && break
  sleep 1
done

echo "==> seeding host + image + container in paashup"
curl -fsS -X POST localhost:8000/api/plugins/docker/hosts/ -H 'content-type: application/json' \
  -d '{"endpoint":"http://agent:1880","name":"e2e-host"}' >/dev/null
reg=$(curl -fsS localhost:8000/api/plugins/docker/hosts/1/ | grep -oE '"registries":\[\{"id":[0-9]+' | grep -oE '[0-9]+$')
img=$(curl -fsS -X POST localhost:8000/api/plugins/docker/images/ -H 'content-type: application/json' \
  -d "{\"host\":1,\"registry\":${reg},\"name\":\"nginx\",\"version\":\"alpine\"}" | grep -oE '"id":[0-9]+' | head -1 | grep -oE '[0-9]+')
cid=$(curl -fsS -X POST localhost:8000/api/plugins/docker/containers/ -H 'content-type: application/json' \
  -d "{\"host\":1,\"image\":${img},\"name\":\"pbx-managed\"}" | grep -oE '"id":[0-9]+' | head -1 | grep -oE '[0-9]+')
echo "    paashup container id=$cid"

echo "==> starting the real agent"
"${DC[@]}" up -d agent >/dev/null
for _ in $(seq 1 30); do
  [ "$(curl -fsS -u admin:saashup -o /dev/null -w '%{http_code}' localhost:1880/info 2>/dev/null)" = "200" ] && break
  sleep 1
done

echo "==> agent: pull image + create the container in dind"
"${A[@]}" -X POST localhost:1880/api/engine/images -H 'content-type: application/json' \
  -d "{\"data\":{\"id\":${img},\"name\":\"nginx\",\"version\":\"alpine\",\"size\":0,\"ImageID\":null}}" >/dev/null
for _ in $(seq 1 60); do "${A[@]}" localhost:1880/api/images | grep -q "nginx:alpine" && break; sleep 2; done
"${A[@]}" -X POST localhost:1880/api/engine/containers -H 'content-type: application/json' \
  -d "{\"data\":{\"id\":${cid},\"name\":\"pbx-managed\",\"state\":\"none\",\"image\":{\"name\":\"nginx\",\"version\":\"alpine\"}}}" >/dev/null

echo "==> waiting for the agent to sync the real ContainerID back into paashup"
synced=""
for _ in $(seq 1 40); do
  synced=$(curl -fsS localhost:8000/api/plugins/docker/containers/$cid/ | grep -oE '"ContainerID":"[0-9a-f]{12,}"' || true)
  [ -n "$synced" ] && break
  sleep 1
done
[ -n "$synced" ] || fail "paashup container never received a real ContainerID from the agent"
echo "    $synced"

docker exec pbx-agent-e2e-dind-1 docker ps -a --filter name=pbx-managed --format '{{.Names}}' | grep -q pbx-managed \
  || fail "container not present in the real dind daemon"
[ "$(curl -fsS localhost:8000/api/extras/journal-entries/ | grep -oE '"count":[0-9]+' | grep -oE '[0-9]+')" -ge 1 ] \
  || fail "agent wrote no journal entries to paashup"

echo "PASS: real agent created a real container in dind and synced it back to paashup"
