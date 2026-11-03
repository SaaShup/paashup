# The Docker agent

paashup manages Docker through a small companion process, the **agent**
(`ghcr.io/saashup/agent`), rather than talking to the Docker socket directly. The agent
does the real work (talking to `dockerd`); paashup's own **Docker plugin** (loaded by
default) only stores and exposes the state, and is designed to pair with this agent.

## What the agent does

The agent runs **next to the Docker daemon it manages** (same host, same socket) and is
the only thing that ever touches `dockerd`. It:

- **discovers** the host's images, volumes, networks and containers and reports them to
  paashup;
- **executes** the operations you trigger from paashup (pull an image, create/start/stop
  a container, etc.), then syncs the real observed state back (container IDs, running
  state, …);
- **serves** logs and an interactive exec/terminal session, which paashup proxies to
  from the UI;
- **writes its own journal entries** to paashup (`/api/extras/journal-entries/`) so
  what it does shows up in the activity log, same as any other client.

## 1. Install the agent on the Docker host

The agent is a standalone container that needs no prior knowledge of paashup: just the
real Docker socket and a port exposed directly on the host (`1880` by default) for
paashup to reach it on.

```bash
docker run -d --name agent --restart always \
  -e API_USERNAME=admin \
  -e API_PASSWORD='<a bcrypt hash, e.g. from `htpasswd -nbB`>' \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v agent-data:/data \
  -p 1880:1880 \
  ghcr.io/saashup/agent
```

In practice this runs as a `systemd` service (restart on boot/crash, pull before
start) rather than a bare `docker run`. `API_USERNAME` / `API_PASSWORD` protect the
agent's own HTTP API; the agent also supports managing the host's SSH
`authorized_keys` (via `SSH_AUTHORIZED_KEYS_FILE` / `SSH_KEYS_ACCOUNT`) if you want
paashup-managed SSH keys to land there too.

## 2. Add the host in paashup

With the agent running and reachable, create the **Docker Host** pointing at it:

`POST /api/plugins/docker/hosts/`

```json
{ "endpoint": "http://<agent-ip>:1880", "name": "docker-host-1" }
```

- `endpoint` is the URL paashup uses to reach the agent (for logs, exec, and
  dispatching operations), not the Docker daemon's own address.
- A `dockerhub` registry is created automatically for the new host.
- Creating the host fires a webhook at that `endpoint` carrying the host's `id` and a
  freshly minted API token: the agent configures itself from that call, so there's
  nothing to copy into the agent by hand.

Once that handshake succeeds, the agent reports back `agent_version` and
`docker_api_version` on the host record and flips its `state`, confirming the
connection is live, then starts syncing its inventory.

## Interactive features

The host's `endpoint` is also what powers the UI's **container logs** and
**terminal** tabs (see *Using the interface*): both go through paashup to that URL, so
it must stay reachable from wherever paashup runs. The agent can disable the terminal
entirely with its `DISABLE_EXEC` setting, and serves one exec session at a time per
host.

Next: **Managing containers** covers the day-to-day operations once a host is connected.
