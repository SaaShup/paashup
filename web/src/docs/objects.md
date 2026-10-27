# The object model

paashup models three domains. Understanding how their objects relate makes data entry
fast and avoids dead-ends.

## DCIM — physical infrastructure

Organised roughly in the order you build things:

- **Sites**: *Region* (geographic tree) → *Site Group* → **Site** → *Location*
  (rooms/rows inside a site). A site is the anchor most other DCIM objects hang off.
- **Racks**: *Rack Role*, *Rack Type*, then **Rack** (placed in a site/location), plus
  *Rack Reservation*.
- **Devices**: *Manufacturer* → *Device Type* (a model) and *Device Role*/*Platform*,
  then **Device** (an actual unit installed in a site/rack). *Virtual Chassis* and
  *Virtual Device Context* build on devices.
- **Components** of a device: *Interfaces*, *Console Ports*, *Power Ports/Outlets*,
  *Front/Rear Ports*, *Module Bays*, *Device Bays*, *Inventory Items*. The
  matching **\*-templates** define components on a *Device Type* so they are created
  automatically on each device.
- **Cabling** and **Power**: *Cables* connect two terminations; *Power Panels* and
  *Power Feeds* model power distribution.

## IPAM — addressing

- **RIR** and **Aggregate** describe the big blocks you are allocated.
- **Prefix** (a network), **IP Range**, and **IP Address** are the working objects.
- **VLAN Group** → **VLAN**, **VRF** + **Route Target**, **ASN**, **Service**, and
  **FHRP Group** cover L2/L3 constructs.

## Virtualization

- **Cluster Type**/**Cluster Group** → **Cluster**, then **Virtual Machine** with its
  **Interfaces** and **Virtual Disks**.

## How objects relate (and why order matters)

- **Foreign keys** are links to *one* other object (e.g. a Site belongs to a Region).
  In the UI these are searchable dropdowns; in the API you send the target's numeric
  `id`. You must create the target first — which is exactly why the menu lists
  prerequisites first.
- **Many-to-many** links (e.g. **tags**, or a VLAN's allowed lists) are *optional*
  associations you attach later — no ordering requirement.
- **Choice fields** (status, type, …) have a fixed set of values. The UI shows a
  dropdown; the API returns them as `{ "value": "...", "label": "..." }` and accepts
  the bare value on write.

## Cross-cutting features

- **Tags** — free-form labels you can attach to most objects for grouping/filtering.
- **Custom fields** — your administrator (or a plugin) can add extra fields to existing
  object types; they appear automatically in the form and the API.
- **Counts** — list/detail responses include reverse counts (e.g. a Site's
  `device_count`).
- **Timestamps** — most objects carry read-only `created` / `last_updated`.

## Operations

The **Operations** section holds cross-cutting tooling rather than inventory:

- **Webhooks** and their **delivery log** (see *Webhooks & realtime*),
- **Tags** and **Config** objects.
