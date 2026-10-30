# Docker management (built-in plugin)

Manages Docker — a port of
[SaaShup/netbox-docker-plugin](https://github.com/SaaShup/netbox-docker-plugin), designed
to pair with the [netbox-docker-agent](https://github.com/SaaShup/netbox-docker-agent). It
is **loaded by default** (via the `paashup.plugins` key in `package.json`), so the
endpoints are live out of the box and appear in the web UI under the **plugins** menu
section.

| Endpoint | Notes |
|----------|-------|
| `/api/plugins/docker/hosts/` | embeds `images`/`volumes`/`networks`/`containers`/`registries`; a `dockerhub` registry is auto-created on host creation |
| `/api/plugins/docker/registries/` | embeds `images` |
| `/api/plugins/docker/images/` | embeds `containers`; `POST {id}/force_pull/` proxies to the agent |
| `/api/plugins/docker/volumes/` | embeds `mounts` |
| `/api/plugins/docker/networks/` | embeds `network_settings` |
| `/api/plugins/docker/containers/` | inline nested `ports`/`env`/`labels`/`mounts`/`binds`/`network_settings`/`devices`/`log_driver_options`/`sysctls` on **read and write**; cross-host integrity is validated; `GET {id}/logs/`, `POST {id}/exec/` proxy to the agent; `WS {id}/ws/` relays the agent's interactive exec stream (terminal) |

## Differences from the NetBox plugin

- NetBox token + webhook auto-provisioning is dropped (paashup has its own auth + a
  WebSocket change-feed).
- The agent-driven container state machine is not enforced (`state`/`operation` are
  plain fields).
- `logs` is returned JSON-encoded (plugin responses are JSON-only).
- The nested container routes build absolute `url`s from `BASE_URL` (set it for parity
  with core endpoints).

Tests: [test/docker.test.mjs](../../../test/docker.test.mjs).
