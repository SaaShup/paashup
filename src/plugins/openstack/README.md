# OpenStack (built-in plugin)

Connects paashup to an OpenStack cloud. Add a cloud with its Keystone credentials and
paashup imports its regions, VMs, IPs, images, flavors, SSH keys and volumes into the
core virtualization / IPAM tables — then lets you **create and delete VMs** from the UI
or the API. It is **loaded by default**.

## Cloud

| Endpoint | Notes |
|----------|-------|
| `/api/plugins/openstack/clouds/` | Keystone credentials: `name`, `auth_url`, `username`, `password`, `user_domain_name`, `project_name`, `project_domain_name` (empty domains mean `Default`, empty project means the user's default project) |

- **Create / update** first tests the credentials against Keystone: on failure nothing
  is saved and the error is shown in the form (`400`). On success, a background sync
  imports the cloud.
- **Refresh**: `PATCH` the cloud with `operation=refresh` to sync again. `state` shows
  `created` / `refreshing` / `connected` / `error`, with the message in `error`.
- **Delete** removes the cloud and everything imported from it (VMs, types, clusters)
  from paashup — nothing is deleted on OpenStack.

## What a sync imports

| OpenStack | paashup |
|-----------|---------|
| region | a region, a site and a cluster (type "OpenStack"), one of each per region |
| Nova server | virtual machine, with one interface per network |
| server addresses | IP addresses on those interfaces; primary IPv4/IPv6 set |
| flavor (in use) | virtual machine type |
| image (in use) | image |
| Nova keypair | SSH key (public key only; the same key in several regions = one row) |
| Cinder volume | virtual disk of the server it is attached to |

A later sync updates in place, and a server deleted on OpenStack is removed here. A
region that fails is reported and skipped — its existing data is left untouched. The
sync only reads from the cloud.

## Creating and deleting VMs

| Endpoint | Notes |
|----------|-------|
| `POST /clouds/{id}/servers/` | boot a server from an image (`202`): checks the quotas and uploads the chosen SSH key as a Nova keypair if needed; the VM appears once synced |
| `GET /servers/[?virtual_machine_id=]` | the OpenStack server behind each VM |
| `DELETE /servers/{vm_id}/` | delete the server on OpenStack (`202`); the VM is marked `decommissioning`, then removed once Nova no longer has it |
| `GET` / `PUT /servers/{vm_id}/metadata/` | read / edit the server's metadata |

`PB_OPENSTACK_POLL_MS` (default `5000`) sets how often a new or deleted server is polled.

## Live reads (for the "create VM" form)

| Endpoint | Notes |
|----------|-------|
| `GET /clouds/{id}/region-status/` | result of the last sync, per region |
| `GET /clouds/{id}/{kind}/?region=<name>` | `kind` = `flavors`, `images`, `keypairs`, `volumes`, `networks`, `security-groups` or `limits`; read live from OpenStack, cached 60 s |

Paths above are relative to `/api/plugins/openstack`. OpenStack is simulated by a fake
server in the tests: [test/openstack.test.mjs](../../../test/openstack.test.mjs),
[test/openstack-vm.test.mjs](../../../test/openstack-vm.test.mjs).
