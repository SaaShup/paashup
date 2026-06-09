#!/usr/bin/env bash
# Seed a datacenter stack into a running paas2box and print a tree of what was created.
#
# PATH 1 — bare-metal app (implemented):
#   Region → Site → Room → Row → Rack → Physical Device → Operating System → Hosted App
#
# Paths 2 (app on a VM) and 3 (app in a container on a VM) are stubbed below and will be
# filled in next; the VM/container layers already work against this engine.
#
# Modeling notes for path 1:
#   • "Room" and "Row" are two dcim/location levels (Row's parent = Room).
#   • "Operating System" is a dcim/platform set on the device's `platform`.
#   • The hosted app is recorded on the device's `comments` (name + ports). In this
#     engine an ipam/service can't bind to a physical device — services require an
#     integer parent id, but devices have UUID ids — so services are used for the VM
#     paths only. (dcim/devices use string/UUID primary keys; everything else here is
#     integer, which is why device ids are quoted in the JSON below.)
#
#   scripts/demo-fullstack.sh                  # against http://localhost:8000
#   BASE=http://host:port scripts/demo-fullstack.sh
set -euo pipefail
BASE="${BASE:-http://localhost:8000}"
API="$BASE/api"

# POST $url $json -> echoes the created object's id (fails loudly on error).
post() {
  local url="$1" body="$2" resp
  resp=$(curl -s -X POST "$url" -H 'Content-Type: application/json' -d "$body")
  URL="$url" node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let o; try{o=JSON.parse(s)}catch{console.error("non-JSON from "+process.env.URL+": "+s);process.exit(1)}
      if(o.id===undefined){console.error("ERROR creating "+process.env.URL+":\n"+JSON.stringify(o,null,2));process.exit(1)}
      process.stdout.write(String(o.id));
    });' <<<"$resp"
}

echo "==> Region / Site / Room / Row / Rack"
REGION=$(post "$API/dcim/regions/"   '{"name":"EU-West","slug":"eu-west","description":"Western Europe"}')
SITE=$(post   "$API/dcim/sites/"     "{\"name\":\"Paris DC1\",\"slug\":\"paris-dc1\",\"region\":$REGION,\"status\":\"active\",\"facility\":\"PA1\"}")
ROOM=$(post   "$API/dcim/locations/" "{\"name\":\"Room A\",\"slug\":\"room-a\",\"site\":$SITE,\"status\":\"active\"}")
ROW=$(post    "$API/dcim/locations/" "{\"name\":\"Row 1\",\"slug\":\"row-1\",\"site\":$SITE,\"parent\":$ROOM,\"status\":\"active\"}")
RACK=$(post   "$API/dcim/racks/"     "{\"name\":\"Rack R1\",\"site\":$SITE,\"location\":$ROW,\"status\":\"active\",\"u_height\":42}")
echo "    region=$REGION site=$SITE room=$ROOM row=$ROW rack=$RACK"

echo "==> Device prerequisites (manufacturer / type / role) + Operating System (platform)"
MFR=$(post   "$API/dcim/manufacturers/" '{"name":"Dell","slug":"dell"}')
DTYPE=$(post "$API/dcim/device-types/"  "{\"manufacturer\":$MFR,\"model\":\"PowerEdge R750\",\"slug\":\"poweredge-r750\",\"u_height\":2}")
ROLE=$(post  "$API/dcim/device-roles/"  '{"name":"Compute","slug":"compute","color":"00bcd4"}')
OS_UBUNTU=$(post "$API/dcim/platforms/" '{"name":"Ubuntu 22.04","slug":"ubuntu-22-04"}')
echo "    mfr=$MFR type=$DTYPE role=$ROLE os(ubuntu)=$OS_UBUNTU"

# ============================================================================
# PATH 1 — bare-metal app:  Device → OS(Ubuntu) → hosted app "billing-web" (tcp/8080)
# Device ids are UUID strings, so $DEV_BM is quoted everywhere it appears in JSON.
# ============================================================================
echo "==> [Path 1] bare-metal app"
DEV_BM=$(post "$API/dcim/devices/" "{\"name\":\"bm-app-01\",\"device_type\":$DTYPE,\"role\":$ROLE,\"site\":$SITE,\"location\":$ROW,\"rack\":$RACK,\"position\":1,\"face\":\"front\",\"platform\":$OS_UBUNTU,\"status\":\"active\",\"comments\":\"Hosted app: billing-web (tcp/8080) @ 10.20.1.10\"}")
echo "    device=$DEV_BM (Ubuntu 22.04)  app=billing-web tcp/8080 (recorded on device comments)"

# ============================================================================
# PATH 2 — app on a VM            (stub — to implement next)
#   Device(hypervisor) → VM → OS → ipam/service
# PATH 3 — app in a container     (stub — to implement next)
#   Device(hypervisor) → VM → OS → docker host → container → ipam/service
# ============================================================================

echo
echo "================ STACK CREATED (path 1) ================"
cat <<TREE
EU-West (region $REGION)
└─ Paris DC1 (site $SITE)
   └─ Room A (location $ROOM)
      └─ Row 1 (location $ROW)
         └─ Rack R1 (rack $RACK)
            └─ bm-app-01 (device $DEV_BM)  ·OS Ubuntu 22.04
               └─ billing-web  tcp/8080   (hosted app, on device comments)
TREE
echo
echo "Browse: $BASE/   |   API: $API/dcim/devices/$DEV_BM/"
