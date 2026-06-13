#!/usr/bin/env bash
#
# paasbox-bearer.sh — call the paas2box API using an OIDC (Keycloak) Bearer token.
#
# It fetches a short-lived access token from Keycloak at runtime and sends it as
# `Authorization: Bearer <jwt>`; paas2box verifies it live against the issuer's JWKS.
# Nothing is pre-registered in paas2box — see README "SSO via OIDC".
#
# Usage:
#   ./paasbox-bearer.sh GET  /api/dcim/sites/
#   ./paasbox-bearer.sh POST /api/dcim/manufacturers/ '{"name":"Acme","slug":"acme"}'
#   ./paasbox-bearer.sh --token-only            # just print the access token
#
# Configure via env (defaults shown):
#   PB_OIDC_ISSUER   https://kc.example.com/realms/paasbox   (required)
#   PAASBOX_URL      http://localhost:8000
#   GRANT            client_credentials | password           (default: client_credentials)
#   CLIENT_ID        paasbox-svc
#   CLIENT_SECRET    (required for client_credentials / confidential clients)
#   USERNAME PASSWORD                                         (required for GRANT=password)
#
set -euo pipefail

# --- configuration (env overrides) ---
PB_OIDC_ISSUER="${PB_OIDC_ISSUER:-}"
PAASBOX_URL="${PAASBOX_URL:-http://localhost:8000}"
GRANT="${GRANT:-client_credentials}"
CLIENT_ID="${CLIENT_ID:-paasbox-svc}"
CLIENT_SECRET="${CLIENT_SECRET:-}"
USERNAME="${USERNAME:-}"
PASSWORD="${PASSWORD:-}"

die() { echo "error: $*" >&2; exit 1; }
command -v curl >/dev/null || die "curl is required"
[ -n "$PB_OIDC_ISSUER" ] || die "set PB_OIDC_ISSUER (e.g. https://kc.example.com/realms/paasbox)"

# --- extract a JSON string field without hard-depending on jq ---
json_field() { # <field>  (reads JSON on stdin)
  local f="$1"
  if command -v jq >/dev/null; then
    jq -r --arg f "$f" '.[$f] // empty'
  elif command -v python3 >/dev/null; then
    python3 -c 'import sys,json; print(json.load(sys.stdin).get(sys.argv[1],""))' "$f"
  else
    # last-resort regex (fine for flat token responses)
    sed -n "s/.*\"$f\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
  fi
}

get_token() {
  local args=(-s -X POST "$PB_OIDC_ISSUER/protocol/openid-connect/token"
              -d "client_id=$CLIENT_ID")
  case "$GRANT" in
    client_credentials)
      [ -n "$CLIENT_SECRET" ] || die "GRANT=client_credentials needs CLIENT_SECRET"
      args+=(-d grant_type=client_credentials -d "client_secret=$CLIENT_SECRET") ;;
    password)
      [ -n "$USERNAME" ] && [ -n "$PASSWORD" ] || die "GRANT=password needs USERNAME and PASSWORD"
      args+=(-d grant_type=password -d "username=$USERNAME" -d "password=$PASSWORD")
      [ -n "$CLIENT_SECRET" ] && args+=(-d "client_secret=$CLIENT_SECRET") ;;
    *) die "unknown GRANT '$GRANT' (use client_credentials or password)" ;;
  esac

  local resp jwt err
  resp="$(curl "${args[@]}")"
  jwt="$(printf '%s' "$resp" | json_field access_token)"
  if [ -z "$jwt" ]; then
    err="$(printf '%s' "$resp" | json_field error_description)"
    die "could not obtain a token from Keycloak: ${err:-$resp}"
  fi
  printf '%s' "$jwt"
}

# --- main ---
if [ "${1:-}" = "--token-only" ]; then
  get_token; echo
  exit 0
fi

METHOD="${1:-GET}"
PATH_="${2:-/api/dcim/sites/}"
DATA="${3:-}"

JWT="$(get_token)"

curl_args=(-s -X "$METHOD" "${PAASBOX_URL%/}$PATH_" -H "Authorization: Bearer $JWT")
if [ -n "$DATA" ]; then
  curl_args+=(-H 'Content-Type: application/json' -d "$DATA")
fi

# pretty-print if jq is available, else raw
if command -v jq >/dev/null; then
  curl "${curl_args[@]}" | jq
else
  curl "${curl_args[@]}"; echo
fi
