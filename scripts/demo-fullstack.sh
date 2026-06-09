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
#   • The hosted app is a real ISManager object: an InformationSystem + Component +
#     ComponentPort. The Component is HARD-linked to the core device via its `device`
#     FK (ISManager migration 0002_component_host), so the device brief embeds in the
#     component. (ipam/services can't bind to a device here: services need an integer
#     parent id but dcim/devices have UUID ids — which is also why device ids are quoted
#     in the JSON below; every other entity here uses integer ids.)
#
# Requires BOTH plugins loaded on the server, e.g.:
#   PB_PLUGINS="./dist/plugins/docker/index.js,/abs/path/paas2box-ISManager-plugin/dist/index.js"
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
echo "==> [Path 1] bare-metal device + OS"
DEV_BM=$(post "$API/dcim/devices/" "{\"name\":\"bm-app-01\",\"device_type\":$DTYPE,\"role\":$ROLE,\"site\":$SITE,\"location\":$ROW,\"rack\":$RACK,\"position\":1,\"face\":\"front\",\"platform\":$OS_UBUNTU,\"status\":\"active\",\"comments\":\"Hosts ISManager component billing-web (tcp/8080) @ 10.20.1.10\"}")
echo "    device=$DEV_BM (Ubuntu 22.04)"

echo "==> [Path 1] hosted app as an ISManager InformationSystem / Component / Port"
IS=$(post   "$API/plugins/ismanager/information-systems/" '{"name":"Billing App","slug":"billing-app","domain":"app.example.com","status":"active"}')
# Component HARD-linked to the bare-metal device via the `device` FK (UUID, quoted).
COMP=$(post "$API/plugins/ismanager/components/" "{\"information_system\":$IS,\"name\":\"billing-web\",\"role\":\"app\",\"service_ip\":\"10.20.1.10\",\"status\":\"active\",\"device\":\"$DEV_BM\"}")
CPORT=$(post "$API/plugins/ismanager/component-ports/" "{\"component\":$COMP,\"kind\":\"service\",\"name\":\"http\",\"port\":8080,\"protocol\":\"tcp\"}")
echo "    information_system=$IS component=$COMP port=$CPORT (billing-web tcp/8080, hard-linked to device bm-app-01)"

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
               └─ billing-web  (ismanager component $COMP)  tcp/8080
                  ·InformationSystem "Billing App" ($IS)  ·device FK → bm-app-01
TREE
echo
echo "Browse:    $BASE/"
echo "Device:    $API/dcim/devices/$DEV_BM/"
echo "App (IS):  $API/plugins/ismanager/components/$COMP/"
