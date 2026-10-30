# Cloudflare DNS (built-in plugin)

Manages Cloudflare DNS zones and their **A / CNAME** records — a port of
[SaaShup/netbox-cloudflare-plugin](https://github.com/SaaShup/netbox-cloudflare-plugin).
Record changes made in paashup are written to Cloudflare. It is **loaded by default**.

| Endpoint | Notes |
|----------|-------|
| `/api/plugins/cloudflare/dns/accounts/` | a zone: `zone_name`, `zone_id` and an API `token`. Creating one imports the zone's existing A/CNAME records (best effort — the account is still created if Cloudflare is unreachable). Shows `record_count` |
| `/api/plugins/cloudflare/dns/records/` | records: `zone`, `name`, `type`, `content`, `ttl`, `proxied`. Writes are **real**, see below |

## Record writes

- **Create**: the zone suffix is appended to the name, a conflict with an
  opposite-`proxied` record is rejected, then the record is created on Cloudflare (its
  id is stored) and saved locally.
- **Update** (`PATCH` / `PUT`): the change is merged over the current record, written to
  Cloudflare, then saved locally.
- **Delete**: deleted on Cloudflare, then locally.

Reads come from the local database.

`PB_CLOUDFLARE_BASE_URL` overrides the API base (default
`https://api.cloudflare.com/client/v4`). Tests:
[test/cloudflare.test.mjs](../../../test/cloudflare.test.mjs).
