# Virtualization: OpenStack

paashup connects to any standard **OpenStack** cloud (public or private, anything
speaking Keystone/Nova/Cinder) and keeps a read-only mirror of it in the core
virtualization and IPAM tables. This plugin is loaded by default.

## Adding a cloud

Open **Virtualization → Clouds** (or `POST /api/plugins/openstack/clouds/`) and give it
a name plus Keystone credentials. The fastest way to fill these in is your cloud's
**OpenStack RC file**: most providers let you download one from their dashboard (often
under *API Access*; on **Horizon**, the dashboard many OpenStack clouds use, including
OVH, it's under *Project → API Access → Download OpenStack RC File*). It exports
exactly what paashup needs:

| RC file variable | paashup field |
| ---- | ---- |
| `OS_AUTH_URL` | `auth_url` |
| `OS_USERNAME` | `username` |
| `OS_PASSWORD` | `password` |
| `OS_USER_DOMAIN_NAME` | `user_domain_name` (empty = `Default`) |
| `OS_PROJECT_NAME` | `project_name` (empty = your user's default project) |
| `OS_PROJECT_DOMAIN_NAME` | `project_domain_name` (empty = `Default`) |

Credentials are tested against Keystone before anything is saved: if authentication
fails, nothing is created and the error shows inline on the form. On success, a
background sync starts importing the cloud; `state` moves `created` → `refreshing` →
`connected` (or `error`, with details in `error`).

## What a sync imports

Only a one-way read: paashup never writes anything back to OpenStack during a sync.

| OpenStack | paashup |
| ---- | ---- |
| Region | a Region, a Site, and a Cluster (type "OpenStack"), one of each per region |
| Nova server | a Virtual Machine, with one interface per network |
| Server addresses | IP addresses on those interfaces; primary IPv4/IPv6 set |
| Flavor in use | a Virtual Machine Type |
| Image in use | an Image |
| Nova keypair | an SSH Key (public key only; the same key reused across regions becomes one row) |
| Cinder volume | a Virtual Disk, attached to its server |

A later sync **updates in place**: changes on OpenStack are reflected, and a server
deleted on OpenStack disappears here too. If a region fails to sync, it's reported and
skipped, so its existing data is left untouched and one bad region doesn't wipe the rest.

## Keeping it in sync

- **Refresh**: `PATCH` the cloud with `operation=refresh` to sync again on demand.
- **Delete**: removes the cloud and everything paashup imported from it (VMs, types,
  clusters). Nothing is deleted on OpenStack itself.

Next: **Creating VMs** covers booting and deleting servers from paashup, including
install scripts.
