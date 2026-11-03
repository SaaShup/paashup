# Managing containers

Once a **Docker Host** is connected (see **The Docker agent**), paashup gives you full
CRUD over its images, volumes, networks and containers, plus live logs and an
interactive terminal, all under **Docker** in the menu.

## The resources

| Endpoint | Notes |
| ---- | ---- |
| `/api/plugins/docker/hosts/` | embeds `images` / `volumes` / `networks` / `containers` / `registries` |
| `/api/plugins/docker/registries/` | an image source (see *Adding a registry*); embeds `images` |
| `/api/plugins/docker/images/` | embeds `containers` |
| `/api/plugins/docker/volumes/` | embeds `mounts` |
| `/api/plugins/docker/networks/` | embeds `network_settings` |
| `/api/plugins/docker/containers/` | the main one, see below |

A container's **ports**, **env**, **labels**, **mounts**, **binds**, **network_settings**,
**devices**, **log_driver_options** and **sysctls** are nested fields you read and write
inline, rather than separate endpoints: create or edit a container with all of it in one
request, the same shape you get back on read.

## Adding a registry

Every host gets a `dockerhub` registry automatically, for public Docker Hub images. To
pull from somewhere else, such as `ghcr.io`, a private registry, or Docker Hub but with
a private image, add another one on `/api/plugins/docker/registries/`:

| Field | Notes |
| ---- | ---- |
| `host` | the Docker Host this registry belongs to |
| `name` | a label for the dropdown when picking a registry for an image |
| `serveraddress` | the registry's address, e.g. `ghcr.io` |
| `username` / `password` | only needed for private images; for GitHub, GitLab, etc. this is usually your account name and a **personal access token (PAT)** rather than your real password |
| `email` *(optional)* | some registries expect one |

Once added, pick that registry when creating an **Image** so the agent authenticates
with it on pull.

## Operating a container

Set `operation` on a container to tell the agent what to do next:

| Operation | Effect |
| ---- | ---- |
| `create` | the agent creates it in Docker from the stored config |
| `start` / `stop` / `restart` | the usual lifecycle actions |
| `pause` / `unpause` | freeze/unfreeze the container's processes |
| `recreate` | drop and recreate it (e.g. after changing its image or config) |
| `kill` | force-stop |

`state` (`created`, `running`, `paused`, `restarting`, `exited`, `dead`, `none`) reflects
what the agent last observed: it's reported back, not something you set directly.

Pulling a fresh image: `POST /api/plugins/docker/images/{id}/force_pull/` proxies the
request to the host's agent.

## Logs and terminal

The container detail page in the UI has **Logs** and **Terminal** tabs (both only work
once the container actually exists on the host):

- **Logs**: `GET /api/plugins/docker/containers/{id}/logs/`. *Refresh* re-fetches;
  *Follow* polls every few seconds and keeps the tail in view.
- **Terminal**: `WS /api/plugins/docker/containers/{id}/ws/` relays a real interactive
  shell (`sh` by default; change the *Shell* field to use another). Keystrokes stream
  live, so `cd`, editors, `top`, and coloured prompts behave like a real terminal.
  `POST .../exec/` runs a one-off command the same way. Both go through paashup to the
  host's agent, which serves **one session at a time** and can disable this entirely
  with its `DISABLE_EXEC` setting.

## Day to day

- **Create** a container pointing at an existing **Image** and **Host**, fill in ports/
  env/mounts as needed, then set `operation: "create"` (and `"start"` once created).
- **Networks** and **volumes** are managed the same CRUD way, then referenced from a
  container's `network_settings` / `mounts`.
- Everything streams over the live WebSocket feed, so two people watching the same host
  see each other's changes instantly (see *Using the interface*).

Next: **Keycloak** covers provisioning realms, OIDC clients and redirect URLs.
