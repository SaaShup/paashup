# Creating VMs

Once a cloud is connected (see **Virtualization: OpenStack**), you can boot and delete
VMs on it from paashup, with no need to go to your cloud provider's own dashboard.

## Booting a VM

Click **Virtualization → Virtual Machines → + Add**, or use
`POST /api/plugins/openstack/clouds/{id}/servers/` with:

- `region`, `name`
- `flavor_id`, `image_id`: read live from the cloud (`GET .../flavors/`, `.../images/`,
  cached 60 s) so the choices always match what's actually available
- `network_ids`: at least one
- `security_groups` *(optional)*
- `ssh_key`: either `{ "source": "cloud", "name": "..." }` (an existing Nova keypair)
  or `{ "source": "paashup", "id": <ssh key id> }` (uploaded to Nova automatically if
  not already there)
- `metadata` *(optional)*: free-form key/value pairs set on the server
- `init_script` *(optional)*: see below

The request returns `202`; the VM appears in the list once the first sync after boot
picks it up. Quotas are checked up front, so you get a clear error instead of a stuck
OpenStack request.

## SSH keys

There are two different ways to get an SSH key onto a VM, depending on when:

- **At boot, via OpenStack**: the `ssh_key` field above sets **one** key, baked in as
  the Nova keypair for that server. It's fixed at creation: this path can't add a
  second key or change it later.
- **After boot, via the agent (agent v2+)**: once the agent is installed on the VM
  (see **The Docker agent**; the VM doesn't need to be a registered Docker host for
  this), `/api/plugins/docker/vm-ssh-keys/` lets you **add and remove** keys from its
  `authorized_keys` at any time:
  - `POST` with `virtual_machine` and either `ssh_key` (an id from the shared catalog,
    `/api/virtualization/ssh-keys/`) or a raw `public_key` to paste one in directly.
  - `DELETE {id}/` removes one.
  - This needs `PB_SSH_AGENT_USER` / `PB_SSH_AGENT_PASSWORD` configured on paashup
    (the credentials the agent's key-management API expects) and a VM with a primary
    IP the agent is reachable on.
  - A key added or removed directly on the machine (outside paashup) is picked up at
    the next sync of its cloud.

## Install scripts

**Virtualization → Init Scripts** is a small library of shell scripts, handed to new
VMs as `user_data` (cloud-init runs them at first boot). A script just declares its
adjustable settings the normal shell way:

```bash
#!/bin/bash
APP_ENV=${APP_ENV:-production}
PAASHUP_API_KEY=${PAASHUP_API_KEY:-}

echo "deploying in $APP_ENV"
```

- Every `${NAME:-default}` paashup finds (outside of comments) becomes a form field
  when you pick that script for a new VM: you only need to fill in the ones you want
  to **override**; anything left alone keeps its default.
- Mark sensitive ones (API keys, passwords) as **secret variables** on the script: their
  values are still exported in the script, but paashup never writes them to the journal,
  so they don't leak into activity logs.
- Scripts must start with a shebang and stay under ~48 KB (OpenStack's `user_data`
  limit once base64-encoded).

## Logging from inside a script back to paashup

Because an init script runs with network access, it can report its own progress to
paashup instead of leaving you to guess from VM state alone:

```bash
#!/bin/bash
PAASHUP_URL=${PAASHUP_URL:-https://paasbox.example.com}
PAASHUP_API_KEY=${PAASHUP_API_KEY:-}
VM_NAME=${VM_NAME:-}

vm_id() {
  curl -s -H "Authorization: Token $PAASHUP_API_KEY" \
    "$PAASHUP_URL/api/virtualization/virtual-machines/?name=$VM_NAME" \
    | grep -oE '"id":[0-9]+' | head -1 | grep -oE '[0-9]+'
}

log() {
  curl -s -X POST "$PAASHUP_URL/api/extras/journal-entries/" \
    -H "Authorization: Token $PAASHUP_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"assigned_object_type\":\"virtualization.virtualmachine\",\"assigned_object_id\":$(vm_id),\"kind\":\"$1\",\"comments\":\"$2\"}"
}

log info "starting provisioning"
# ... install steps ...
log success "provisioning complete"
```

- Use a **read-write API key** (see **API keys**) created for this purpose, passed in
  as a script variable and marked **secret**.
- `kind` is one of `info`, `success`, `warning`, `danger` and shows up as a coloured
  entry in the VM's journal, right in the UI.
- `assigned_object_id` is the VM's numeric **paashup** id, which doesn't exist yet when
  the script is rendered (the server is still being created in OpenStack at that point,
  and paashup only assigns an id once it imports it). The VM's **name** is known in
  advance instead, since you chose it yourself, so pass that in as `VM_NAME` and have
  the script resolve it to an id at runtime with a quick lookup
  (`?name=<VM_NAME>` does an exact match, see **The API**).

## Deleting a VM

`DELETE /api/plugins/openstack/clouds/{id}/servers/{vm_id}/` deletes the server on
OpenStack (`202`). The VM is marked `decommissioning` in paashup and removed once Nova
confirms it's gone, with nothing to clean up by hand.

Next: **The Docker agent** covers installing the agent that lets paashup see and manage
containers on a host, including ones running on the VMs you just created.
