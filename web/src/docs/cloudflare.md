# Cloudflare DNS

This plugin (loaded by default) manages **Cloudflare DNS zones** and their **A** and
**CNAME** records. Record changes made in paashup are written straight to Cloudflare:
this isn't just a local copy for reference.

## Adding a zone

Click **Cloudflare → Accounts → + Add**, or use `POST /api/plugins/cloudflare/dns/accounts/` with `zone_name`, `zone_id`, and an API
`token` (scoped to that zone on Cloudflare).

- Creating it **imports the zone's existing A/CNAME records** so you start with a
  complete picture, not an empty list.
- This is best-effort: if Cloudflare is unreachable at creation time, the zone account
  is still created, and you can retry the import later by re-saving it.
- The list shows a `record_count` for each zone.

## Managing records

Go to **Cloudflare → Records** `/api/plugins/cloudflare/dns/records/`, fields: `zone`, `name`, `type` (`A` or
`CNAME`), `content`, `ttl`, `proxied`.

- **Create**: the zone's suffix is appended to `name` automatically; a conflict with
  an existing record of the opposite `proxied` value is rejected. The record is created
  on Cloudflare first (its id is stored), then saved locally.
- **Update** (`PATCH`/`PUT`): your change is merged over the current record, written to
  Cloudflare, then saved locally.
- **Delete**: removed on Cloudflare first, then locally.

Reads always come from the local database (kept in sync by the writes above), so
listing records doesn't round-trip to Cloudflare on every page load.

## A typical flow

1. Add the zone once (imports what's already there).
2. Point a new service's hostname at your infrastructure by creating an `A` or `CNAME`
   record: for example after booting a VM (see **Creating VMs**) or standing up a
   container (see **Managing containers**), add the record that points traffic at it.
3. Toggle `proxied` if you want Cloudflare's proxy/CDN in front of it.

That closes the loop across the five pages in this section: import or create compute
(OpenStack VMs or Docker containers), register it with your identity provider
(Keycloak), and point DNS at it (Cloudflare), all from paashup.
