# Managing your infrastructure

paashup can be used purely as **documentation**: a source of truth you fill in by hand
or sync from elsewhere, the way you would use NetBox. That works, and nothing below
changes it.

But paashup's real value is **active management**: instead of describing your
infrastructure after the fact, you drive it from here. A handful of built-in plugins,
loaded by default with no extra setup, let you:

- **Import** an existing OpenStack cloud and keep its inventory in sync automatically.
- **Create and delete VMs** straight from the UI or the API, with install scripts run
  at boot.
- **Discover and operate Docker hosts** through a lightweight agent: images, volumes,
  networks, containers, logs, even an interactive terminal.
- **Provision Keycloak** realms, OIDC clients and redirect URLs, including an
  orchestrator-friendly register/unregister contract.
- **Manage Cloudflare DNS zones** with real writes, not just a local record of them.

The next pages cover each of these in turn:

1. **Virtualization: OpenStack**, connecting a cloud and what gets imported.
2. **Creating VMs**, booting servers, install scripts, and logging back to paashup.
3. **The Docker agent**, installing it and registering a host.
4. **Managing containers**, images, volumes, networks, logs, exec.
5. **Keycloak**, servers, realms, clients, redirect URLs.
6. **Cloudflare DNS**, zones and DNS records.

> Everything here is optional and additive: skip a section if you don't use that piece
> of infrastructure. Each plugin only shows up in the menu and the API once your
> administrator has it loaded (all five ship enabled by default).
