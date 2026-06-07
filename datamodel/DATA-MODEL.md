# NetBox-Compatible Data Model (DCIM · IPAM · Virtualization)

Derived from `openapi/netbox-dcim-ipam-virt.openapi.json` (NetBox **4.6.2 (4.6)**).

Each entity below maps to one API collection endpoint and is intended as a database table. Legend: **Null** = column nullable · **Req** = required on create · **RO** = read-only / server-managed (auto PK, timestamps, computed).

> Foreign keys (`→`) are stored as the referenced row's integer `id`. Many-to-many (`⇄`) relations need a join table. `slug` columns are unique. Other unique constraints (e.g. `name` scoped to a parent) follow NetBox's models and are noted where derivable.

**82 entities**, **1484 fields** total.


> **Generic relations.** Where NetBox uses a polymorphic FK, this model stores a pair of columns: `<rel>_type` (a content-type reference such as `dcim.interface`) plus `<rel>_id` (the target row id). Affected: `Prefix.scope_*`, `Cluster.scope_*`, `IPAddress.assigned_object_*`, `Service.*`, `FHRPGroupAssignment.*`, `MACAddress.assigned_object_*`, etc.


## DCIM — Devices & Physical Infrastructure

_46 entities._


### CableBundle

- **Table (suggested):** `dcim_cable_bundle`
- **Endpoint:** `/api/dcim/cable-bundles/`
- **Read schema:** `CableBundle` · **Write schema:** `CableBundleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `cable_count` | integer |  |  | ✓ |  |


### CableTermination

- **Table (suggested):** `dcim_cable_termination`
- **Endpoint:** `/api/dcim/cable-terminations/`
- **Read schema:** `CableTermination` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `cable` | integer |  |  | ✓ |  |
| `cable_end` | enum |  |  | ✓ | enum: `A`, `B` |
| `termination_type` | string (content-type) |  |  | ✓ | generic relation (content-type + id) |
| `termination_id` | integer |  |  | ✓ |  |
| `termination` | json | ✓ |  | ✓ |  |
| `connector` | integer | ✓ |  | ✓ |  |
| `positions` | array<integer> | ✓ |  | ✓ |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### Cable

- **Table (suggested):** `dcim_cable`
- **Endpoint:** `/api/dcim/cables/`
- **Read schema:** `Cable` · **Write schema:** `WritableCableRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `type` | enum | ✓ |  |  | enum: `cat3`, `cat5`, `cat5e`, `cat6`, `cat6a`, `cat7`, `cat7a`, `cat8`, … |
| `a_terminations` | json (array<GenericObject>) |  |  |  | embedded value-objects (store as JSON) |
| `b_terminations` | json (array<GenericObject>) |  |  |  | embedded value-objects (store as JSON) |
| `status` | enum |  |  |  | enum: `connected`, `planned`, `decommissioning` |
| `profile` | enum |  |  |  | enum: `single-1c1p`, `single-1c2p`, `single-1c4p`, `single-1c6p`, `single-1c8p`, `single-1c12p`, `single-1c16p`, `trunk-2c1p`, … |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `bundle` | integer (fk) | ✓ |  |  | → **CableBundle** (FK) |
| `label` | string(100) |  |  |  |  |
| `color` | string(6) |  |  |  |  |
| `length` | number | ✓ |  |  |  |
| `length_unit` | enum | ✓ |  |  | enum: `km`, `m`, `cm`, `mi`, `ft`, `in` |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ConsolePortTemplate

- **Table (suggested):** `dcim_console_port_template`
- **Endpoint:** `/api/dcim/console-port-templates/`
- **Read schema:** `ConsolePortTemplate` · **Write schema:** `WritableConsolePortTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, … |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ConsolePort

- **Table (suggested):** `dcim_console_port`
- **Endpoint:** `/api/dcim/console-ports/`
- **Read schema:** `ConsolePort` · **Write schema:** `WritableConsolePortRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, … |
| `speed` | enum | ✓ |  |  | enum: `1200`, `2400`, `4800`, `9600`, `19200`, `38400`, `57600`, `115200` |
| `description` | string(200) |  |  |  |  |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints` | array<object> | ✓ |  | ✓ |  |
| `connected_endpoints_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints_reachable` | boolean |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### ConsoleServerPortTemplate

- **Table (suggested):** `dcim_console_server_port_template`
- **Endpoint:** `/api/dcim/console-server-port-templates/`
- **Read schema:** `ConsoleServerPortTemplate` · **Write schema:** `WritableConsoleServerPortTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, … |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ConsoleServerPort

- **Table (suggested):** `dcim_console_server_port`
- **Endpoint:** `/api/dcim/console-server-ports/`
- **Read schema:** `ConsoleServerPort` · **Write schema:** `WritableConsoleServerPortRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, … |
| `speed` | enum | ✓ |  |  | enum: `1200`, `2400`, `4800`, `9600`, `19200`, `38400`, `57600`, `115200` |
| `description` | string(200) |  |  |  |  |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints` | array<object> | ✓ |  | ✓ |  |
| `connected_endpoints_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints_reachable` | boolean |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### DeviceBayTemplate

- **Table (suggested):** `dcim_device_bay_template`
- **Endpoint:** `/api/dcim/device-bay-templates/`
- **Read schema:** `DeviceBayTemplate` · **Write schema:** `DeviceBayTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) |  | ✓ |  | → **DeviceType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `enabled` | boolean |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### DeviceBay

- **Table (suggested):** `dcim_device_bay`
- **Endpoint:** `/api/dcim/device-bays/`
- **Read schema:** `DeviceBay` · **Write schema:** `DeviceBayRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `enabled` | boolean |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `installed_device` | integer (fk) | ✓ |  |  | → **Device** (FK) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### DeviceRole

- **Table (suggested):** `dcim_device_role`
- **Endpoint:** `/api/dcim/device-roles/`
- **Read schema:** `DeviceRole` · **Write schema:** `WritableDeviceRoleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `color` | string(6) |  |  |  |  |
| `vm_role` | boolean |  |  |  | Virtual machines may be assigned to this role |
| `config_template` | integer (fk) | ✓ |  |  | → **ConfigTemplate** (FK) |
| `parent` | integer (fk) | ✓ |  |  | → **DeviceRole** (FK) |
| `description` | string(200) |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `device_count` | integer |  |  | ✓ |  |
| `virtualmachine_count` | integer |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `_depth` | integer |  |  | ✓ |  |


### DeviceType

- **Table (suggested):** `dcim_device_type`
- **Endpoint:** `/api/dcim/device-types/`
- **Read schema:** `DeviceType` · **Write schema:** `WritableDeviceTypeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `manufacturer` | integer (fk) |  | ✓ |  | → **Manufacturer** (FK) |
| `default_platform` | integer (fk) | ✓ |  |  | → **Platform** (FK) |
| `model` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `part_number` | string(50) |  |  |  | Discrete part number (optional) |
| `u_height` | number |  |  |  |  |
| `exclude_from_utilization` | boolean |  |  |  | Devices of this type are excluded when calculating rack utilization. |
| `is_full_depth` | boolean |  |  |  | Device consumes both front and rear rack faces. |
| `subdevice_role` | enum | ✓ |  |  | enum: `parent`, `child` |
| `airflow` | enum | ✓ |  |  | enum: `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `rear-to-side`, `bottom-to-top`, `top-to-bottom`, … |
| `weight` | number | ✓ |  |  |  |
| `weight_unit` | enum | ✓ |  |  | enum: `kg`, `g`, `lb`, `oz` |
| `front_image` | string(uri) | ✓ |  |  |  |
| `rear_image` | string(uri) | ✓ |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `device_count` | integer |  |  | ✓ |  |
| `console_port_template_count` | integer |  |  | ✓ |  |
| `console_server_port_template_count` | integer |  |  | ✓ |  |
| `power_port_template_count` | integer |  |  | ✓ |  |
| `power_outlet_template_count` | integer |  |  | ✓ |  |
| `interface_template_count` | integer |  |  | ✓ |  |
| `front_port_template_count` | integer |  |  | ✓ |  |
| `rear_port_template_count` | integer |  |  | ✓ |  |
| `device_bay_template_count` | integer |  |  | ✓ |  |
| `module_bay_template_count` | integer |  |  | ✓ |  |
| `inventory_item_template_count` | integer |  |  | ✓ |  |


### Device

- **Table (suggested):** `dcim_device`
- **Endpoint:** `/api/dcim/devices/`
- **Read schema:** `DeviceWithConfigContext` · **Write schema:** `WritableDeviceWithConfigContextRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(64) | ✓ |  |  |  |
| `device_type` | integer (fk) |  | ✓ |  | → **DeviceType** (FK) |
| `role` | integer (fk) | ✓ |  |  | → **DeviceRole** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `platform` | integer (fk) | ✓ |  |  | → **Platform** (FK) |
| `serial` | string(50) |  |  |  | Chassis serial number, assigned by the manufacturer |
| `asset_tag` | string(50) | ✓ |  |  | A unique tag used to identify this device |
| `site` | integer (fk) |  | ✓ |  | → **Site** (FK) |
| `location` | integer (fk) | ✓ |  |  | → **Location** (FK) |
| `rack` | integer (fk) | ✓ |  |  | → **Rack** (FK) |
| `position` | number | ✓ |  |  |  |
| `face` | enum | ✓ |  |  | enum: `front`, `rear` |
| `latitude` | number | ✓ |  |  | GPS coordinate in decimal format (xx.yyyyyy) |
| `longitude` | number | ✓ |  |  | GPS coordinate in decimal format (xx.yyyyyy) |
| `parent_device` | integer (fk) | ✓ |  | ✓ | → **Device** (FK) |
| `status` | enum |  |  |  | enum: `offline`, `active`, `planned`, `staged`, `failed`, `inventory`, `decommissioning` |
| `airflow` | enum | ✓ |  |  | enum: `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `rear-to-side`, `bottom-to-top`, `top-to-bottom`, … |
| `primary_ip` | integer (fk) | ✓ |  | ✓ | → **IPAddress** (FK) |
| `primary_ip4` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `primary_ip6` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `oob_ip` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `cluster` | integer (fk) | ✓ |  |  | → **Cluster** (FK) |
| `virtual_chassis` | integer (fk) | ✓ |  |  | → **VirtualChassis** (FK) |
| `vc_position` | integer | ✓ |  |  |  |
| `vc_priority` | integer | ✓ |  |  | Virtual chassis master election priority |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `config_template` | integer (fk) | ✓ |  |  | → **ConfigTemplate** (FK) |
| `config_context` | json | ✓ |  | ✓ |  |
| `local_context_data` | json | ✓ |  |  | Local config context data takes precedence over source contexts in the final rendered config context |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `console_port_count` | integer |  |  | ✓ |  |
| `console_server_port_count` | integer |  |  | ✓ |  |
| `power_port_count` | integer |  |  | ✓ |  |
| `power_outlet_count` | integer |  |  | ✓ |  |
| `interface_count` | integer |  |  | ✓ |  |
| `front_port_count` | integer |  |  | ✓ |  |
| `rear_port_count` | integer |  |  | ✓ |  |
| `device_bay_count` | integer |  |  | ✓ |  |
| `module_bay_count` | integer |  |  | ✓ |  |
| `inventory_item_count` | integer |  |  | ✓ |  |


### FrontPortTemplate

- **Table (suggested):** `dcim_front_port_template`
- **Endpoint:** `/api/dcim/front-port-templates/`
- **Read schema:** `FrontPortTemplate` · **Write schema:** `WritableFrontPortTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum |  | ✓ |  | enum: `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, … |
| `color` | string(6) |  |  |  |  |
| `positions` | integer |  |  |  |  |
| `rear_ports` | json (array<FrontPortTemplateMapping>) |  |  |  | embedded value-objects (store as JSON) |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### FrontPort

- **Table (suggested):** `dcim_front_port`
- **Endpoint:** `/api/dcim/front-ports/`
- **Read schema:** `FrontPort` · **Write schema:** `WritableFrontPortRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum |  | ✓ |  | enum: `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, … |
| `color` | string(6) |  |  |  |  |
| `positions` | integer |  |  |  |  |
| `rear_ports` | json (array<FrontPortMapping>) |  |  |  | embedded value-objects (store as JSON) |
| `description` | string(200) |  |  |  |  |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### InterfaceTemplate

- **Table (suggested):** `dcim_interface_template`
- **Endpoint:** `/api/dcim/interface-templates/`
- **Read schema:** `InterfaceTemplate` · **Write schema:** `WritableInterfaceTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum |  | ✓ |  | enum: `virtual`, `bridge`, `lag`, `100base-fx`, `100base-lfx`, `100base-tx`, `100base-t1`, `1000base-bx10-d`, … |
| `enabled` | boolean |  |  |  |  |
| `mgmt_only` | boolean |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `bridge` | integer (fk) | ✓ |  |  | → **InterfaceTemplate** (FK) |
| `poe_mode` | enum | ✓ |  |  | enum: `pd`, `pse` |
| `poe_type` | enum | ✓ |  |  | enum: `type1-ieee802.3af`, `type2-ieee802.3at`, `type3-ieee802.3bt`, `type4-ieee802.3bt`, `passive-24v-2pair`, `passive-24v-4pair`, `passive-48v-2pair`, `passive-48v-4pair` |
| `rf_role` | enum | ✓ |  |  | enum: `ap`, `station` |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### Interface

- **Table (suggested):** `dcim_interface`
- **Endpoint:** `/api/dcim/interfaces/`
- **Read schema:** `Interface` · **Write schema:** `WritableInterfaceRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `vdcs` | m2m |  |  |  | ⇄ **VirtualDeviceContext** (M2M) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum |  | ✓ |  | enum: `virtual`, `bridge`, `lag`, `100base-fx`, `100base-lfx`, `100base-tx`, `100base-t1`, `1000base-bx10-d`, … |
| `enabled` | boolean |  |  |  |  |
| `parent` | integer (fk) | ✓ |  |  | → **Interface** (FK) |
| `bridge` | integer (fk) | ✓ |  |  | → **Interface** (FK) |
| `bridge_interfaces` | m2m |  |  | ✓ | ⇄ **Interface** (M2M) |
| `lag` | integer (fk) | ✓ |  |  | → **Interface** (FK) |
| `mtu` | integer | ✓ |  |  |  |
| `mac_address` | string | ✓ |  | ✓ |  |
| `primary_mac_address` | integer (fk) | ✓ |  |  | → **MACAddress** (FK) |
| `mac_addresses` | m2m | ✓ |  | ✓ | ⇄ **MACAddress** (M2M) |
| `speed` | bigint | ✓ |  |  |  |
| `duplex` | enum | ✓ |  |  | enum: `half`, `full`, `auto` |
| `wwn` | string | ✓ |  |  |  |
| `mgmt_only` | boolean |  |  |  | This interface is used only for out-of-band management |
| `description` | string(200) |  |  |  |  |
| `mode` | enum | ✓ |  |  | enum: `access`, `tagged`, `tagged-all`, `q-in-q` |
| `rf_role` | enum | ✓ |  |  | enum: `ap`, `station` |
| `rf_channel` | enum | ✓ |  |  | enum: `2.4g-1-2412-22`, `2.4g-2-2417-22`, `2.4g-3-2422-22`, `2.4g-4-2427-22`, `2.4g-5-2432-22`, `2.4g-6-2437-22`, `2.4g-7-2442-22`, `2.4g-8-2447-22`, … |
| `poe_mode` | enum | ✓ |  |  | enum: `pd`, `pse` |
| `poe_type` | enum | ✓ |  |  | enum: `type1-ieee802.3af`, `type2-ieee802.3at`, `type3-ieee802.3bt`, `type4-ieee802.3bt`, `passive-24v-2pair`, `passive-24v-4pair`, `passive-48v-2pair`, `passive-48v-4pair` |
| `rf_channel_frequency` | number | ✓ |  |  | Populated by selected channel (if set) |
| `rf_channel_width` | number | ✓ |  |  | Populated by selected channel (if set) |
| `tx_power` | integer | ✓ |  |  |  |
| `untagged_vlan` | integer (fk) | ✓ |  |  | → **VLAN** (FK) |
| `tagged_vlans` | m2m |  |  |  | ⇄ **VLAN** (M2M) |
| `qinq_svlan` | integer (fk) | ✓ |  |  | → **VLAN** (FK) |
| `vlan_translation_policy` | integer (fk) | ✓ |  |  | → **VLANTranslationPolicy** (FK) |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `wireless_link` | integer (fk) | ✓ |  | ✓ | → **WirelessLink** (FK) |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `wireless_lans` | m2m |  |  |  | ⇄ **WirelessLAN** (M2M) |
| `vrf` | integer (fk) | ✓ |  |  | → **VRF** (FK) |
| `l2vpn_termination` | integer (fk) | ✓ |  | ✓ | → **L2VPNTermination** (FK) |
| `connected_endpoints` | array<object> | ✓ |  | ✓ |  |
| `connected_endpoints_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints_reachable` | boolean |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `count_ipaddresses` | integer |  |  | ✓ |  |
| `count_fhrp_groups` | integer |  |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### InventoryItemRole

- **Table (suggested):** `dcim_inventory_item_role`
- **Endpoint:** `/api/dcim/inventory-item-roles/`
- **Read schema:** `InventoryItemRole` · **Write schema:** `InventoryItemRoleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `color` | string(6) |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `inventoryitem_count` | bigint |  |  | ✓ |  |


### InventoryItemTemplate

- **Table (suggested):** `dcim_inventory_item_template`
- **Endpoint:** `/api/dcim/inventory-item-templates/`
- **Read schema:** `InventoryItemTemplate` · **Write schema:** `InventoryItemTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) |  | ✓ |  | → **DeviceType** (FK) |
| `parent` | integer | ✓ |  |  |  |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `role` | integer (fk) | ✓ |  |  | → **InventoryItemRole** (FK) |
| `manufacturer` | integer (fk) | ✓ |  |  | → **Manufacturer** (FK) |
| `part_id` | string(50) |  |  |  | Manufacturer-assigned part identifier |
| `description` | string(200) |  |  |  |  |
| `component_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `component_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_depth` | integer |  |  | ✓ |  |


### InventoryItem

- **Table (suggested):** `dcim_inventory_item`
- **Endpoint:** `/api/dcim/inventory-items/`
- **Read schema:** `InventoryItem` · **Write schema:** `WritableInventoryItemRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `parent` | integer | ✓ |  |  |  |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `status` | enum |  |  |  | enum: `offline`, `active`, `planned`, `staged`, `failed`, `decommissioning` |
| `role` | integer (fk) | ✓ |  |  | → **InventoryItemRole** (FK) |
| `manufacturer` | integer (fk) | ✓ |  |  | → **Manufacturer** (FK) |
| `part_id` | string(50) |  |  |  | Manufacturer-assigned part identifier |
| `serial` | string(50) |  |  |  |  |
| `asset_tag` | string(50) | ✓ |  |  | A unique tag used to identify this item |
| `discovered` | boolean |  |  |  | This item was automatically discovered |
| `description` | string(200) |  |  |  |  |
| `component_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `component_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_depth` | integer |  |  | ✓ |  |


### Location

- **Table (suggested):** `dcim_location`
- **Endpoint:** `/api/dcim/locations/`
- **Read schema:** `Location` · **Write schema:** `WritableLocationRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `site` | integer (fk) |  | ✓ |  | → **Site** (FK) |
| `parent` | integer (fk) | ✓ |  |  | → **Location** (FK) |
| `status` | enum |  |  |  | enum: `planned`, `staging`, `active`, `decommissioning`, `retired` |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `facility` | string(50) |  |  |  | Local facility ID or description |
| `description` | string(200) |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `rack_count` | integer |  |  | ✓ |  |
| `device_count` | integer |  |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `_depth` | integer |  |  | ✓ |  |


### MACAddress

- **Table (suggested):** `dcim_macaddress`
- **Endpoint:** `/api/dcim/mac-addresses/`
- **Read schema:** `MACAddress` · **Write schema:** `MACAddressRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `mac_address` | string |  | ✓ |  |  |
| `assigned_object_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `assigned_object_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### Manufacturer

- **Table (suggested):** `dcim_manufacturer`
- **Endpoint:** `/api/dcim/manufacturers/`
- **Read schema:** `Manufacturer` · **Write schema:** `ManufacturerRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `devicetype_count` | bigint |  |  | ✓ |  |
| `moduletype_count` | bigint |  |  | ✓ |  |
| `inventoryitem_count` | bigint |  |  | ✓ |  |
| `platform_count` | bigint |  |  | ✓ |  |


### ModuleBayTemplate

- **Table (suggested):** `dcim_module_bay_template`
- **Endpoint:** `/api/dcim/module-bay-templates/`
- **Read schema:** `ModuleBayTemplate` · **Write schema:** `ModuleBayTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `position` | string(30) |  |  |  | Identifier to reference when renaming installed components |
| `enabled` | boolean |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ModuleBay

- **Table (suggested):** `dcim_module_bay`
- **Endpoint:** `/api/dcim/module-bays/`
- **Read schema:** `ModuleBay` · **Write schema:** `ModuleBayRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `position` | string(30) |  |  |  | Identifier to reference when renaming installed components |
| `enabled` | boolean |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `installed_module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### ModuleTypeProfile

- **Table (suggested):** `dcim_module_type_profile`
- **Endpoint:** `/api/dcim/module-type-profiles/`
- **Read schema:** `ModuleTypeProfile` · **Write schema:** `ModuleTypeProfileRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `schema` | json | ✓ |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ModuleType

- **Table (suggested):** `dcim_module_type`
- **Endpoint:** `/api/dcim/module-types/`
- **Read schema:** `ModuleType` · **Write schema:** `WritableModuleTypeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `profile` | integer (fk) | ✓ |  |  | → **ModuleTypeProfile** (FK) |
| `manufacturer` | integer (fk) |  | ✓ |  | → **Manufacturer** (FK) |
| `model` | string(100) |  | ✓ |  |  |
| `part_number` | string(50) |  |  |  | Discrete part number (optional) |
| `airflow` | enum | ✓ |  |  | enum: `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `passive` |
| `weight` | number | ✓ |  |  |  |
| `weight_unit` | enum | ✓ |  |  | enum: `kg`, `g`, `lb`, `oz` |
| `description` | string(200) |  |  |  |  |
| `attributes` | json | ✓ |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `module_count` | integer |  |  | ✓ |  |
| `console_port_template_count` | integer |  |  | ✓ |  |
| `console_server_port_template_count` | integer |  |  | ✓ |  |
| `power_port_template_count` | integer |  |  | ✓ |  |
| `power_outlet_template_count` | integer |  |  | ✓ |  |
| `interface_template_count` | integer |  |  | ✓ |  |
| `front_port_template_count` | integer |  |  | ✓ |  |
| `rear_port_template_count` | integer |  |  | ✓ |  |
| `module_bay_template_count` | integer |  |  | ✓ |  |


### Module

- **Table (suggested):** `dcim_module`
- **Endpoint:** `/api/dcim/modules/`
- **Read schema:** `Module` · **Write schema:** `WritableModuleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module_bay` | integer (fk) |  | ✓ |  | → **ModuleBay** (FK) |
| `module_type` | integer (fk) |  | ✓ |  | → **ModuleType** (FK) |
| `status` | enum |  |  |  | enum: `offline`, `active`, `planned`, `staged`, `failed`, `decommissioning` |
| `serial` | string(50) |  |  |  |  |
| `asset_tag` | string(50) | ✓ |  |  | A unique tag used to identify this device |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `replicate_components` | boolean |  |  |  | Automatically populate components associated with this module type (default: true) |
| `adopt_components` | boolean |  |  |  | Adopt already existing components |


### Platform

- **Table (suggested):** `dcim_platform`
- **Endpoint:** `/api/dcim/platforms/`
- **Read schema:** `Platform` · **Write schema:** `WritablePlatformRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `parent` | integer (fk) | ✓ |  |  | → **Platform** (FK) |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `manufacturer` | integer (fk) | ✓ |  |  | → **Manufacturer** (FK) |
| `config_template` | integer (fk) | ✓ |  |  | → **ConfigTemplate** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `device_count` | integer |  |  | ✓ |  |
| `virtualmachine_count` | integer |  |  | ✓ |  |
| `_depth` | integer |  |  | ✓ |  |


### PowerFeed

- **Table (suggested):** `dcim_power_feed`
- **Endpoint:** `/api/dcim/power-feeds/`
- **Read schema:** `PowerFeed` · **Write schema:** `WritablePowerFeedRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `power_panel` | integer (fk) |  | ✓ |  | → **PowerPanel** (FK) |
| `rack` | integer (fk) | ✓ |  |  | → **Rack** (FK) |
| `name` | string(100) |  | ✓ |  |  |
| `status` | enum |  |  |  | enum: `offline`, `active`, `planned`, `failed` |
| `type` | enum |  |  |  | enum: `primary`, `redundant` |
| `supply` | enum |  |  |  | enum: `ac`, `dc` |
| `phase` | enum |  |  |  | enum: `single-phase`, `three-phase` |
| `voltage` | integer |  |  |  |  |
| `amperage` | integer |  |  |  |  |
| `max_utilization` | integer |  |  |  | Maximum permissible draw (percentage) |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints` | array<object> | ✓ |  | ✓ |  |
| `connected_endpoints_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints_reachable` | boolean |  |  | ✓ |  |
| `description` | string(200) |  |  |  |  |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### PowerOutletTemplate

- **Table (suggested):** `dcim_power_outlet_template`
- **Endpoint:** `/api/dcim/power-outlet-templates/`
- **Read schema:** `PowerOutletTemplate` · **Write schema:** `WritablePowerOutletTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `iec-60320-c5`, `iec-60320-c7`, `iec-60320-c13`, `iec-60320-c15`, `iec-60320-c17`, `iec-60320-c19`, `iec-60320-c21`, `iec-60309-p-n-e-4h`, … |
| `color` | string(6) |  |  |  |  |
| `power_port` | integer (fk) | ✓ |  |  | → **PowerPortTemplate** (FK) |
| `feed_leg` | enum | ✓ |  |  | enum: `A`, `B`, `C` |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### PowerOutlet

- **Table (suggested):** `dcim_power_outlet`
- **Endpoint:** `/api/dcim/power-outlets/`
- **Read schema:** `PowerOutlet` · **Write schema:** `WritablePowerOutletRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `iec-60320-c5`, `iec-60320-c7`, `iec-60320-c13`, `iec-60320-c15`, `iec-60320-c17`, `iec-60320-c19`, `iec-60320-c21`, `iec-60309-p-n-e-4h`, … |
| `status` | enum |  |  |  | enum: `enabled`, `disabled`, `faulty` |
| `color` | string(6) |  |  |  |  |
| `power_port` | integer (fk) | ✓ |  |  | → **PowerPort** (FK) |
| `feed_leg` | enum | ✓ |  |  | enum: `A`, `B`, `C` |
| `description` | string(200) |  |  |  |  |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints` | array<object> | ✓ |  | ✓ |  |
| `connected_endpoints_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints_reachable` | boolean |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### PowerPanel

- **Table (suggested):** `dcim_power_panel`
- **Endpoint:** `/api/dcim/power-panels/`
- **Read schema:** `PowerPanel` · **Write schema:** `PowerPanelRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `site` | integer (fk) |  | ✓ |  | → **Site** (FK) |
| `location` | integer (fk) | ✓ |  |  | → **Location** (FK) |
| `name` | string(100) |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `powerfeed_count` | bigint |  |  | ✓ |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### PowerPortTemplate

- **Table (suggested):** `dcim_power_port_template`
- **Endpoint:** `/api/dcim/power-port-templates/`
- **Read schema:** `PowerPortTemplate` · **Write schema:** `WritablePowerPortTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `iec-60320-c6`, `iec-60320-c8`, `iec-60320-c14`, `iec-60320-c16`, `iec-60320-c18`, `iec-60320-c20`, `iec-60320-c22`, `iec-60309-p-n-e-4h`, … |
| `maximum_draw` | integer | ✓ |  |  | Maximum power draw (watts) |
| `allocated_draw` | integer | ✓ |  |  | Allocated power draw (watts) |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### PowerPort

- **Table (suggested):** `dcim_power_port`
- **Endpoint:** `/api/dcim/power-ports/`
- **Read schema:** `PowerPort` · **Write schema:** `WritablePowerPortRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum | ✓ |  |  | enum: `iec-60320-c6`, `iec-60320-c8`, `iec-60320-c14`, `iec-60320-c16`, `iec-60320-c18`, `iec-60320-c20`, `iec-60320-c22`, `iec-60309-p-n-e-4h`, … |
| `maximum_draw` | integer | ✓ |  |  | Maximum power draw (watts) |
| `allocated_draw` | integer | ✓ |  |  | Allocated power draw (watts) |
| `description` | string(200) |  |  |  |  |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints` | array<object> | ✓ |  | ✓ |  |
| `connected_endpoints_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `connected_endpoints_reachable` | boolean |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### RackGroup

- **Table (suggested):** `dcim_rack_group`
- **Endpoint:** `/api/dcim/rack-groups/`
- **Read schema:** `RackGroup` · **Write schema:** `RackGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `rack_count` | bigint |  |  | ✓ |  |


### RackReservation

- **Table (suggested):** `dcim_rack_reservation`
- **Endpoint:** `/api/dcim/rack-reservations/`
- **Read schema:** `RackReservation` · **Write schema:** `WritableRackReservationRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `rack` | integer (fk) |  | ✓ |  | → **Rack** (FK) |
| `units` | array<integer> |  | ✓ |  |  |
| `unit_count` | integer |  |  | ✓ |  |
| `status` | enum |  |  |  | enum: `pending`, `active`, `stale` |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `user` | integer (fk) |  | ✓ |  | → **User** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `description` | string(200) |  | ✓ |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |


### RackRole

- **Table (suggested):** `dcim_rack_role`
- **Endpoint:** `/api/dcim/rack-roles/`
- **Read schema:** `RackRole` · **Write schema:** `RackRoleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `color` | string(6) |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `rack_count` | bigint |  |  | ✓ |  |


### RackType

- **Table (suggested):** `dcim_rack_type`
- **Endpoint:** `/api/dcim/rack-types/`
- **Read schema:** `RackType` · **Write schema:** `WritableRackTypeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `manufacturer` | integer (fk) |  | ✓ |  | → **Manufacturer** (FK) |
| `model` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `description` | string(200) |  |  |  |  |
| `form_factor` | enum | ✓ | ✓ |  | enum: `2-post-frame`, `4-post-frame`, `4-post-cabinet`, `wall-frame`, `wall-frame-vertical`, `wall-cabinet`, `wall-cabinet-vertical` |
| `width` | enum |  |  |  | enum: `10`, `19`, `21`, `23` |
| `u_height` | integer |  |  |  | Height in rack units |
| `starting_unit` | integer |  |  |  | Starting unit for rack |
| `desc_units` | boolean |  |  |  | Units are numbered top-to-bottom |
| `outer_width` | integer | ✓ |  |  | Outer dimension of rack (width) |
| `outer_height` | integer | ✓ |  |  | Outer dimension of rack (height) |
| `outer_depth` | integer | ✓ |  |  | Outer dimension of rack (depth) |
| `outer_unit` | enum | ✓ |  |  | enum: `mm`, `in` |
| `weight` | number | ✓ |  |  |  |
| `max_weight` | integer | ✓ |  |  | Maximum load capacity for the rack |
| `weight_unit` | enum | ✓ |  |  | enum: `kg`, `g`, `lb`, `oz` |
| `mounting_depth` | integer | ✓ |  |  | Maximum depth of a mounted device, in millimeters. For four-post racks, this is the distance between the front and rear  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `rack_count` | integer |  |  | ✓ |  |


### Rack

- **Table (suggested):** `dcim_rack`
- **Endpoint:** `/api/dcim/racks/`
- **Read schema:** `Rack` · **Write schema:** `WritableRackRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `facility_id` | string(50) | ✓ |  |  |  |
| `site` | integer (fk) |  | ✓ |  | → **Site** (FK) |
| `location` | integer (fk) | ✓ |  |  | → **Location** (FK) |
| `group` | integer (fk) | ✓ |  |  | → **RackGroup** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `status` | enum |  |  |  | enum: `reserved`, `available`, `planned`, `active`, `deprecated` |
| `role` | integer (fk) | ✓ |  |  | → **RackRole** (FK) |
| `serial` | string(50) |  |  |  |  |
| `asset_tag` | string(50) | ✓ |  |  | A unique tag used to identify this rack |
| `rack_type` | integer (fk) | ✓ |  |  | → **RackType** (FK) |
| `form_factor` | enum | ✓ |  |  | enum: `2-post-frame`, `4-post-frame`, `4-post-cabinet`, `wall-frame`, `wall-frame-vertical`, `wall-cabinet`, `wall-cabinet-vertical` |
| `width` | enum |  |  |  | enum: `10`, `19`, `21`, `23` |
| `u_height` | integer |  |  |  | Height in rack units |
| `starting_unit` | integer |  |  |  | Starting unit for rack |
| `weight` | number | ✓ |  |  |  |
| `max_weight` | integer | ✓ |  |  | Maximum load capacity for the rack |
| `weight_unit` | enum | ✓ |  |  | enum: `kg`, `g`, `lb`, `oz` |
| `desc_units` | boolean |  |  |  | Units are numbered top-to-bottom |
| `outer_width` | integer | ✓ |  |  | Outer dimension of rack (width) |
| `outer_height` | integer | ✓ |  |  | Outer dimension of rack (height) |
| `outer_depth` | integer | ✓ |  |  | Outer dimension of rack (depth) |
| `outer_unit` | enum | ✓ |  |  | enum: `mm`, `in` |
| `mounting_depth` | integer | ✓ |  |  | Maximum depth of a mounted device, in millimeters. For four-post racks, this is the distance between the front and rear  |
| `airflow` | enum | ✓ |  |  | enum: `front-to-rear`, `rear-to-front` |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `device_count` | bigint |  |  | ✓ |  |
| `powerfeed_count` | bigint |  |  | ✓ |  |


### RearPortTemplate

- **Table (suggested):** `dcim_rear_port_template`
- **Endpoint:** `/api/dcim/rear-port-templates/`
- **Read schema:** `RearPortTemplate` · **Write schema:** `WritableRearPortTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device_type` | integer (fk) | ✓ |  |  | → **DeviceType** (FK) |
| `module_type` | integer (fk) | ✓ |  |  | → **ModuleType** (FK) |
| `name` | string(64) |  | ✓ |  | {module} is accepted as a substitution for the module bay position when attached to a module type. |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum |  | ✓ |  | enum: `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, … |
| `color` | string(6) |  |  |  |  |
| `positions` | integer |  |  |  |  |
| `front_ports` | json (array<RearPortTemplateMapping>) |  |  |  | embedded value-objects (store as JSON) |
| `description` | string(200) |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### RearPort

- **Table (suggested):** `dcim_rear_port`
- **Endpoint:** `/api/dcim/rear-ports/`
- **Read schema:** `RearPort` · **Write schema:** `WritableRearPortRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `module` | integer (fk) | ✓ |  |  | → **Module** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `label` | string(64) |  |  |  | Physical label |
| `type` | enum |  | ✓ |  | enum: `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, … |
| `color` | string(6) |  |  |  |  |
| `positions` | integer |  |  |  |  |
| `front_ports` | json (array<RearPortMapping>) |  |  |  | embedded value-objects (store as JSON) |
| `description` | string(200) |  |  |  |  |
| `mark_connected` | boolean |  |  |  | Treat as if a cable is connected |
| `cable` | integer (fk) | ✓ |  | ✓ | → **Cable** (FK) |
| `cable_end` | enum | ✓ |  | ✓ | enum: `A`, `B` |
| `link_peers` | array<object> |  |  | ✓ |  |
| `link_peers_type` | string (content-type) | ✓ |  | ✓ | generic relation (content-type + id) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `_occupied` | boolean |  |  | ✓ |  |


### Region

- **Table (suggested):** `dcim_region`
- **Endpoint:** `/api/dcim/regions/`
- **Read schema:** `Region` · **Write schema:** `WritableRegionRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `parent` | integer (fk) | ✓ |  |  | → **Region** (FK) |
| `description` | string(200) |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `site_count` | integer |  |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `_depth` | integer |  |  | ✓ |  |


### SiteGroup

- **Table (suggested):** `dcim_site_group`
- **Endpoint:** `/api/dcim/site-groups/`
- **Read schema:** `SiteGroup` · **Write schema:** `WritableSiteGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `parent` | integer (fk) | ✓ |  |  | → **SiteGroup** (FK) |
| `description` | string(200) |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `site_count` | integer |  |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `_depth` | integer |  |  | ✓ |  |


### Site

- **Table (suggested):** `dcim_site`
- **Endpoint:** `/api/dcim/sites/`
- **Read schema:** `Site` · **Write schema:** `WritableSiteRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  | Full name of the site |
| `slug` | string(100) |  | ✓ |  | unique |
| `status` | enum |  |  |  | enum: `planned`, `staging`, `active`, `decommissioning`, `retired` |
| `region` | integer (fk) | ✓ |  |  | → **Region** (FK) |
| `group` | integer (fk) | ✓ |  |  | → **SiteGroup** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `facility` | string(50) |  |  |  | Local facility ID or description |
| `time_zone` | string | ✓ |  |  |  |
| `description` | string(200) |  |  |  |  |
| `physical_address` | string(200) |  |  |  | Physical location of the building |
| `shipping_address` | string(200) |  |  |  | If different from the physical address |
| `latitude` | number | ✓ |  |  | GPS coordinate in decimal format (xx.yyyyyy) |
| `longitude` | number | ✓ |  |  | GPS coordinate in decimal format (xx.yyyyyy) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `asns` | m2m |  |  |  | ⇄ **ASN** (M2M) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `circuit_count` | bigint |  |  | ✓ |  |
| `device_count` | bigint |  |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |
| `rack_count` | bigint |  |  | ✓ |  |
| `virtualmachine_count` | bigint |  |  | ✓ |  |
| `vlan_count` | bigint |  |  | ✓ |  |


### VirtualChassis

- **Table (suggested):** `dcim_virtual_chassis`
- **Endpoint:** `/api/dcim/virtual-chassis/`
- **Read schema:** `VirtualChassis` · **Write schema:** `WritableVirtualChassisRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(64) |  | ✓ |  |  |
| `domain` | string(30) |  |  |  |  |
| `master` | integer (fk) | ✓ |  |  | → **Device** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `member_count` | integer |  |  | ✓ |  |
| `members` | m2m |  |  | ✓ | ⇄ **Device** (M2M) |


### VirtualDeviceContext

- **Table (suggested):** `dcim_virtual_device_context`
- **Endpoint:** `/api/dcim/virtual-device-contexts/`
- **Read schema:** `VirtualDeviceContext` · **Write schema:** `WritableVirtualDeviceContextRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(64) |  | ✓ |  |  |
| `device` | integer (fk) |  | ✓ |  | → **Device** (FK) |
| `identifier` | integer | ✓ |  |  |  |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `primary_ip` | integer (fk) | ✓ |  | ✓ | → **IPAddress** (FK) |
| `primary_ip4` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `primary_ip6` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `status` | enum |  | ✓ |  | enum: `active`, `planned`, `offline` |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `interface_count` | bigint |  |  | ✓ |  |


## IPAM — IP Address Management

_18 entities._


### Aggregate

- **Table (suggested):** `ipam_aggregate`
- **Endpoint:** `/api/ipam/aggregates/`
- **Read schema:** `Aggregate` · **Write schema:** `WritableAggregateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `family` | enum |  |  | ✓ | enum: `4`, `6` |
| `prefix` | string |  | ✓ |  |  |
| `rir` | integer (fk) |  | ✓ |  | → **RIR** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `date_added` | date | ✓ |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ASNRange

- **Table (suggested):** `ipam_asnrange`
- **Endpoint:** `/api/ipam/asn-ranges/`
- **Read schema:** `ASNRange` · **Write schema:** `ASNRangeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `rir` | integer (fk) |  | ✓ |  | → **RIR** (FK) |
| `start` | bigint |  | ✓ |  |  |
| `end` | bigint |  | ✓ |  |  |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `asn_count` | integer |  |  | ✓ |  |


### ASN

- **Table (suggested):** `ipam_asn`
- **Endpoint:** `/api/ipam/asns/`
- **Read schema:** `ASN` · **Write schema:** `ASNRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `asn` | bigint |  | ✓ |  | 16- or 32-bit autonomous system number |
| `rir` | integer (fk) | ✓ |  |  | → **RIR** (FK) |
| `role` | integer (fk) | ✓ |  |  | → **Role** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `site_count` | bigint |  |  | ✓ |  |
| `provider_count` | bigint |  |  | ✓ |  |
| `sites` | m2m |  |  |  | ⇄ **Site** (M2M) |


### FHRPGroupAssignment

- **Table (suggested):** `ipam_fhrpgroup_assignment`
- **Endpoint:** `/api/ipam/fhrp-group-assignments/`
- **Read schema:** `FHRPGroupAssignment` · **Write schema:** `FHRPGroupAssignmentRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `group` | integer (fk) |  | ✓ |  | → **FHRPGroup** (FK) |
| `interface_type` | string (content-type) |  | ✓ |  | generic relation (content-type + id) |
| `interface_id` | integer |  | ✓ |  | generic relation (content-type + id) |
| `priority` | integer |  | ✓ |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### FHRPGroup

- **Table (suggested):** `ipam_fhrpgroup`
- **Endpoint:** `/api/ipam/fhrp-groups/`
- **Read schema:** `FHRPGroup` · **Write schema:** `FHRPGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `name` | string(100) |  |  |  |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `protocol` | enum |  | ✓ |  | enum: `vrrp2`, `vrrp3`, `carp`, `clusterxl`, `hsrp`, `glbp`, `other` |
| `group_id` | integer |  | ✓ |  |  |
| `auth_type` | enum | ✓ |  |  | enum: `plaintext`, `md5` |
| `auth_key` | string(255) |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `ip_addresses` | m2m |  |  | ✓ | ⇄ **IPAddress** (M2M) |


### IPAddress

- **Table (suggested):** `ipam_ipaddress`
- **Endpoint:** `/api/ipam/ip-addresses/`
- **Read schema:** `IPAddress` · **Write schema:** `WritableIPAddressRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `family` | enum |  |  | ✓ | enum: `4`, `6` |
| `address` | string |  | ✓ |  |  |
| `vrf` | integer (fk) | ✓ |  |  | → **VRF** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `status` | enum |  |  |  | enum: `active`, `reserved`, `deprecated`, `dhcp`, `slaac` |
| `role` | enum | ✓ |  |  | enum: `loopback`, `secondary`, `anycast`, `vip`, `vrrp`, `hsrp`, `glbp`, `carp` |
| `assigned_object_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `assigned_object_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `nat_inside` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `nat_outside` | m2m |  |  | ✓ | ⇄ **IPAddress** (M2M) |
| `dns_name` | string(255) |  |  |  | Hostname or FQDN (not case-sensitive) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### IPRange

- **Table (suggested):** `ipam_iprange`
- **Endpoint:** `/api/ipam/ip-ranges/`
- **Read schema:** `IPRange` · **Write schema:** `WritableIPRangeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `family` | enum |  |  | ✓ | enum: `4`, `6` |
| `start_address` | string |  | ✓ |  |  |
| `end_address` | string |  | ✓ |  |  |
| `gateway` | string | ✓ |  |  |  |
| `dhcp_relays` | json | ✓ |  |  |  |
| `size` | integer |  |  | ✓ |  |
| `vrf` | integer (fk) | ✓ |  |  | → **VRF** (FK) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `status` | enum |  |  |  | enum: `active`, `reserved`, `deprecated` |
| `role` | integer (fk) | ✓ |  |  | → **Role** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `mark_populated` | boolean |  |  |  | Prevent the creation of IP addresses within this range |
| `mark_utilized` | boolean |  |  |  | Report space as fully utilized |


### Prefix

- **Table (suggested):** `ipam_prefix`
- **Endpoint:** `/api/ipam/prefixes/`
- **Read schema:** `Prefix` · **Write schema:** `WritablePrefixRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `family` | enum |  |  | ✓ | enum: `4`, `6` |
| `prefix` | string |  | ✓ |  |  |
| `vrf` | integer (fk) | ✓ |  |  | → **VRF** (FK) |
| `scope_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `scope_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `vlan` | integer (fk) | ✓ |  |  | → **VLAN** (FK) |
| `status` | enum |  |  |  | enum: `container`, `active`, `reserved`, `deprecated` |
| `role` | integer (fk) | ✓ |  |  | → **Role** (FK) |
| `is_pool` | boolean |  |  |  | All IP addresses within this prefix are considered usable |
| `mark_utilized` | boolean |  |  |  | Treat as fully utilized |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `children` | integer |  |  | ✓ |  |
| `_depth` | integer |  |  | ✓ |  |


### RIR

- **Table (suggested):** `ipam_rir`
- **Endpoint:** `/api/ipam/rirs/`
- **Read schema:** `RIR` · **Write schema:** `RIRRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `is_private` | boolean |  |  |  | IP space managed by this RIR is considered private |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `aggregate_count` | bigint |  |  | ✓ |  |


### Role

- **Table (suggested):** `ipam_role`
- **Endpoint:** `/api/ipam/roles/`
- **Read schema:** `Role` · **Write schema:** `RoleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `weight` | integer |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |
| `vlan_count` | bigint |  |  | ✓ |  |
| `asn_count` | bigint |  |  | ✓ |  |


### RouteTarget

- **Table (suggested):** `ipam_route_target`
- **Endpoint:** `/api/ipam/route-targets/`
- **Read schema:** `RouteTarget` · **Write schema:** `RouteTargetRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(21) |  | ✓ |  | Route target value (formatted in accordance with RFC 4360) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ServiceTemplate

- **Table (suggested):** `ipam_service_template`
- **Endpoint:** `/api/ipam/service-templates/`
- **Read schema:** `ServiceTemplate` · **Write schema:** `WritableServiceTemplateRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `protocol` | enum |  | ✓ |  | enum: `tcp`, `udp`, `sctp` |
| `ports` | array<integer> |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### Service

- **Table (suggested):** `ipam_service`
- **Endpoint:** `/api/ipam/services/`
- **Read schema:** `Service` · **Write schema:** `WritableServiceRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `parent_object_type` | string (content-type) |  | ✓ |  | generic relation (content-type + id) |
| `parent_object_id` | integer |  | ✓ |  | generic relation (content-type + id) |
| `parent` | json | ✓ |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `protocol` | enum |  | ✓ |  | enum: `tcp`, `udp`, `sctp` |
| `ports` | array<integer> |  | ✓ |  |  |
| `ipaddresses` | m2m |  |  |  | ⇄ **IPAddress** (M2M) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### VLANGroup

- **Table (suggested):** `ipam_vlangroup`
- **Endpoint:** `/api/ipam/vlan-groups/`
- **Read schema:** `VLANGroup` · **Write schema:** `VLANGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `scope_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `scope_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `vid_ranges` | json (array<IntegerRange>) |  |  |  | embedded value-objects (store as JSON) |
| `total_vlan_ids` | integer |  |  | ✓ |  |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `vlan_count` | bigint |  |  | ✓ |  |
| `utilization` | string |  |  | ✓ |  |


### VLANTranslationPolicy

- **Table (suggested):** `ipam_vlantranslation_policy`
- **Endpoint:** `/api/ipam/vlan-translation-policies/`
- **Read schema:** `VLANTranslationPolicy` · **Write schema:** `VLANTranslationPolicyRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `rules` | m2m |  |  | ✓ | ⇄ **VLANTranslationRule** (M2M) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |


### VLANTranslationRule

- **Table (suggested):** `ipam_vlantranslation_rule`
- **Endpoint:** `/api/ipam/vlan-translation-rules/`
- **Read schema:** `VLANTranslationRule` · **Write schema:** `VLANTranslationRuleRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `policy` | integer |  | ✓ |  |  |
| `local_vid` | integer |  | ✓ |  | Numeric VLAN ID (1-4094) |
| `remote_vid` | integer |  | ✓ |  | Numeric VLAN ID (1-4094) |
| `description` | string(200) |  |  |  |  |


### VLAN

- **Table (suggested):** `ipam_vlan`
- **Endpoint:** `/api/ipam/vlans/`
- **Read schema:** `VLAN` · **Write schema:** `WritableVLANRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `site` | integer (fk) | ✓ |  |  | → **Site** (FK) |
| `group` | integer (fk) | ✓ |  |  | → **VLANGroup** (FK) |
| `vid` | integer |  | ✓ |  | Numeric VLAN ID (1-4094) |
| `name` | string(64) |  | ✓ |  |  |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `status` | enum |  |  |  | enum: `active`, `reserved`, `deprecated` |
| `role` | integer (fk) | ✓ |  |  | → **Role** (FK) |
| `description` | string(200) |  |  |  |  |
| `qinq_role` | enum | ✓ |  |  | enum: `svlan`, `cvlan` |
| `qinq_svlan` | integer (fk) | ✓ |  |  | → **VLAN** (FK) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `l2vpn_termination` | integer (fk) | ✓ |  | ✓ | → **L2VPNTermination** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |


### VRF

- **Table (suggested):** `ipam_vrf`
- **Endpoint:** `/api/ipam/vrfs/`
- **Read schema:** `VRF` · **Write schema:** `VRFRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `rd` | string(21) | ✓ |  |  | Unique route distinguisher (as defined in RFC 4364) |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `enforce_unique` | boolean |  |  |  | Prevent duplicate prefixes/IP addresses within this VRF |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `import_targets` | m2m |  |  |  | ⇄ **RouteTarget** (M2M) |
| `export_targets` | m2m |  |  |  | ⇄ **RouteTarget** (M2M) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `ipaddress_count` | bigint |  |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |


## Virtualization

_7 entities._


### ClusterGroup

- **Table (suggested):** `virtualization_cluster_group`
- **Endpoint:** `/api/virtualization/cluster-groups/`
- **Read schema:** `ClusterGroup` · **Write schema:** `ClusterGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `cluster_count` | bigint |  |  | ✓ |  |


### ClusterType

- **Table (suggested):** `virtualization_cluster_type`
- **Endpoint:** `/api/virtualization/cluster-types/`
- **Read schema:** `ClusterType` · **Write schema:** `ClusterTypeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `cluster_count` | bigint |  |  | ✓ |  |


### Cluster

- **Table (suggested):** `virtualization_cluster`
- **Endpoint:** `/api/virtualization/clusters/`
- **Read schema:** `Cluster` · **Write schema:** `WritableClusterRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `type` | integer (fk) |  | ✓ |  | → **ClusterType** (FK) |
| `group` | integer (fk) | ✓ |  |  | → **ClusterGroup** (FK) |
| `status` | enum |  |  |  | enum: `planned`, `staging`, `active`, `decommissioning`, `offline` |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `scope_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `scope_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `device_count` | bigint |  |  | ✓ |  |
| `virtualmachine_count` | bigint |  |  | ✓ |  |
| `allocated_vcpus` | number |  |  | ✓ |  |
| `allocated_memory` | integer |  |  | ✓ |  |
| `allocated_disk` | integer |  |  | ✓ |  |


### VMInterface

- **Table (suggested):** `virtualization_vminterface`
- **Endpoint:** `/api/virtualization/interfaces/`
- **Read schema:** `VMInterface` · **Write schema:** `WritableVMInterfaceRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `virtual_machine` | integer (fk) |  | ✓ |  | → **VirtualMachine** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `enabled` | boolean |  |  |  |  |
| `parent` | integer (fk) | ✓ |  |  | → **VMInterface** (FK) |
| `bridge` | integer (fk) | ✓ |  |  | → **VMInterface** (FK) |
| `mtu` | integer | ✓ |  |  |  |
| `mac_address` | string | ✓ |  | ✓ |  |
| `primary_mac_address` | integer (fk) | ✓ |  |  | → **MACAddress** (FK) |
| `mac_addresses` | m2m | ✓ |  | ✓ | ⇄ **MACAddress** (M2M) |
| `description` | string(200) |  |  |  |  |
| `mode` | enum | ✓ |  |  | enum: `access`, `tagged`, `tagged-all`, `q-in-q` |
| `untagged_vlan` | integer (fk) | ✓ |  |  | → **VLAN** (FK) |
| `tagged_vlans` | m2m |  |  |  | ⇄ **VLAN** (M2M) |
| `qinq_svlan` | integer (fk) | ✓ |  |  | → **VLAN** (FK) |
| `vlan_translation_policy` | integer (fk) | ✓ |  |  | → **VLANTranslationPolicy** (FK) |
| `vrf` | integer (fk) | ✓ |  |  | → **VRF** (FK) |
| `l2vpn_termination` | integer (fk) | ✓ |  | ✓ | → **L2VPNTermination** (FK) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `count_ipaddresses` | integer |  |  | ✓ |  |
| `count_fhrp_groups` | integer |  |  | ✓ |  |


### VirtualDisk

- **Table (suggested):** `virtualization_virtual_disk`
- **Endpoint:** `/api/virtualization/virtual-disks/`
- **Read schema:** `VirtualDisk` · **Write schema:** `VirtualDiskRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `virtual_machine` | integer (fk) |  | ✓ |  | → **VirtualMachine** (FK) |
| `name` | string(64) |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `size` | integer |  | ✓ |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### VirtualMachineType

- **Table (suggested):** `virtualization_virtual_machine_type`
- **Endpoint:** `/api/virtualization/virtual-machine-types/`
- **Read schema:** `VirtualMachineType` · **Write schema:** `VirtualMachineTypeRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `default_platform` | integer (fk) | ✓ |  |  | → **Platform** (FK) |
| `default_vcpus` | number | ✓ |  |  |  |
| `default_memory` | integer | ✓ |  |  |  |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `virtual_machine_count` | integer |  |  | ✓ |  |


### VirtualMachine

- **Table (suggested):** `virtualization_virtual_machine`
- **Endpoint:** `/api/virtualization/virtual-machines/`
- **Read schema:** `VirtualMachineWithConfigContext` · **Write schema:** `WritableVirtualMachineWithConfigContextRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(64) |  | ✓ |  |  |
| `virtual_machine_type` | integer (fk) | ✓ |  |  | → **VirtualMachineType** (FK) |
| `role` | integer (fk) | ✓ |  |  | → **DeviceRole** (FK) |
| `status` | enum |  |  |  | enum: `offline`, `active`, `planned`, `staged`, `failed`, `decommissioning`, `paused` |
| `start_on_boot` | enum |  |  |  | enum: `on`, `off`, `laststate` |
| `site` | integer (fk) | ✓ |  |  | → **Site** (FK) |
| `cluster` | integer (fk) | ✓ |  |  | → **Cluster** (FK) |
| `device` | integer (fk) | ✓ |  |  | → **Device** (FK) |
| `platform` | integer (fk) | ✓ |  |  | → **Platform** (FK) |
| `primary_ip` | integer (fk) | ✓ |  | ✓ | → **IPAddress** (FK) |
| `primary_ip4` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `primary_ip6` | integer (fk) | ✓ |  |  | → **IPAddress** (FK) |
| `vcpus` | number | ✓ |  |  |  |
| `memory` | integer | ✓ |  |  |  |
| `disk` | integer | ✓ |  |  |  |
| `description` | string(200) |  |  |  |  |
| `serial` | string(50) |  |  |  |  |
| `tenant` | integer (fk) | ✓ |  |  | → **Tenant** (FK) |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `local_context_data` | json | ✓ |  |  | Local config context data takes precedence over source contexts in the final rendered config context |
| `config_template` | integer (fk) | ✓ |  |  | → **ConfigTemplate** (FK) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `interface_count` | integer |  |  | ✓ |  |
| `virtual_disk_count` | integer |  |  | ✓ |  |
| `config_context` | json | ✓ |  | ✓ |  |


# External entities

FK/M2M targets that live in other NetBox apps. Per project scope: **Tag, Tenant, TenantGroup, Owner, OwnerGroup** are modeled fully (extracted from the full NetBox schema); **User, ConfigTemplate, L2VPNTermination, WirelessLAN, WirelessLink** are minimal stubs to be fleshed out when those subsystems are built.


## Extras (external)

_2 entities._


### Tag _(external, full)_

- **Table (suggested):** `extras_tag`
- **Endpoint:** `/api/extras/tags/`
- **Read schema:** `Tag` · **Write schema:** `TagRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `color` | string(6) |  |  |  |  |
| `description` | string(200) |  |  |  |  |
| `weight` | integer |  |  |  |  |
| `object_types` | array<string> |  |  |  |  |
| `tagged_items` | bigint |  |  | ✓ |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |


### ConfigTemplate _(external, stub)_

- **Table (suggested):** `extras_config_template`
- **Endpoint:** `/api/extras/config-templates/`
- **Read schema:** `(hand-defined stub)` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `name` | string(100) |  | ✓ |  | unique |
| `description` | string(200) | ✓ |  |  |  |
| `template_code` | string | ✓ |  |  |  |


## Tenancy (external)

_2 entities._


### Tenant _(external, full)_

- **Table (suggested):** `tenancy_tenant`
- **Endpoint:** `/api/tenancy/tenants/`
- **Read schema:** `Tenant` · **Write schema:** `TenantRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `group` | integer (fk) | ✓ |  |  | → **TenantGroup** (FK) |
| `description` | string(200) |  |  |  |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `circuit_count` | bigint |  |  | ✓ |  |
| `device_count` | bigint |  |  | ✓ |  |
| `ipaddress_count` | bigint |  |  | ✓ |  |
| `prefix_count` | bigint |  |  | ✓ |  |
| `rack_count` | bigint |  |  | ✓ |  |
| `site_count` | bigint |  |  | ✓ |  |
| `virtualmachine_count` | bigint |  |  | ✓ |  |
| `vlan_count` | bigint |  |  | ✓ |  |
| `vrf_count` | bigint |  |  | ✓ |  |
| `cluster_count` | bigint |  |  | ✓ |  |


### TenantGroup _(external, full)_

- **Table (suggested):** `tenancy_tenant_group`
- **Endpoint:** `/api/tenancy/tenant-groups/`
- **Read schema:** `TenantGroup` · **Write schema:** `WritableTenantGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `slug` | string(100) |  | ✓ |  | unique |
| `parent` | integer (fk) | ✓ |  |  | → **TenantGroup** (FK) |
| `description` | string(200) |  |  |  |  |
| `tags` | m2m |  |  |  | ⇄ **Tag** (M2M) |
| `custom_fields` | json |  |  |  |  |
| `created` | datetime | ✓ |  | ✓ |  |
| `last_updated` | datetime | ✓ |  | ✓ |  |
| `tenant_count` | integer |  |  | ✓ |  |
| `owner` | integer (fk) | ✓ |  |  | → **Owner** (FK) |
| `comments` | string |  |  |  |  |
| `_depth` | integer |  |  | ✓ |  |


## Users (external)

_4 entities._


### Owner _(external, full)_

- **Table (suggested):** `users_owner`
- **Endpoint:** `/api/users/owners/`
- **Read schema:** `Owner` · **Write schema:** `OwnerRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `group` | integer (fk) | ✓ | ✓ |  | → **OwnerGroup** (FK) |
| `description` | string(200) |  |  |  |  |
| `user_groups` | m2m |  |  |  | ⇄ **Group** (M2M) |
| `users` | m2m |  |  |  | ⇄ **User** (M2M) |


### OwnerGroup _(external, full)_

- **Table (suggested):** `users_owner_group`
- **Endpoint:** `/api/users/owner-groups/`
- **Read schema:** `OwnerGroup` · **Write schema:** `OwnerGroupRequest`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `id` | integer |  |  | ✓ |  |
| `url` | string(uri) |  |  | ✓ |  |
| `display_url` | string(uri) |  |  | ✓ |  |
| `display` | string |  |  | ✓ |  |
| `name` | string(100) |  | ✓ |  |  |
| `description` | string(200) |  |  |  |  |
| `member_count` | bigint |  |  | ✓ |  |


### User _(external, stub)_

- **Table (suggested):** `users_user`
- **Endpoint:** `/api/users/users/`
- **Read schema:** `(hand-defined stub)` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `username` | string(150) |  | ✓ |  | unique |
| `email` | string(254) | ✓ |  |  |  |
| `first_name` | string(150) | ✓ |  |  |  |
| `last_name` | string(150) | ✓ |  |  |  |
| `is_active` | boolean |  |  |  |  |
| `is_staff` | boolean |  |  |  |  |
| `date_joined` | datetime | ✓ |  |  |  |


### Group _(external, stub)_

- **Table (suggested):** `users_group`
- **Endpoint:** `/api/users/groups/`
- **Read schema:** `(hand-defined stub)` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `name` | string(150) |  | ✓ |  | unique |


## VPN (external, stub)

_1 entities._


### L2VPNTermination _(external, stub)_

- **Table (suggested):** `vpn_l2_vpntermination`
- **Endpoint:** `/api/vpn/l2vpn-terminations/`
- **Read schema:** `(hand-defined stub)` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `l2vpn_id` | integer | ✓ |  |  | generic relation (content-type + id) |
| `assigned_object_type` | string (content-type) | ✓ |  |  | generic relation (content-type + id) |
| `assigned_object_id` | integer | ✓ |  |  | generic relation (content-type + id) |


## Wireless (external, stub)

_2 entities._


### WirelessLAN _(external, stub)_

- **Table (suggested):** `wireless_wireless_lan`
- **Endpoint:** `/api/wireless/wireless-lans/`
- **Read schema:** `(hand-defined stub)` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `ssid` | string(32) |  | ✓ |  |  |
| `description` | string(200) | ✓ |  |  |  |


### WirelessLink _(external, stub)_

- **Table (suggested):** `wireless_wireless_link`
- **Endpoint:** `/api/wireless/wireless-links/`
- **Read schema:** `(hand-defined stub)` · **Write schema:** `(read-only / stub)`

| Field | Type | Null | Req | RO | Relationship / Notes |
|-------|------|:----:|:---:|:--:|----------------------|
| `ssid` | string(32) | ✓ |  |  |  |
| `description` | string(200) | ✓ |  |  |  |


## Appendix A — Still-unmodeled referenced entities

_None — every FK/M2M target now resolves to a table in this model._

## Appendix B — Enumerations (choice fields)

Suggested storage: `VARCHAR` (or small int for numeric enums) with a `CHECK` constraint. Values are the API wire values.

- **`Aggregate.family`** — `4`, `6`
- **`Cable.length_unit`** — `km`, `m`, `cm`, `mi`, `ft`, `in`
- **`Cable.profile`** — `single-1c1p`, `single-1c2p`, `single-1c4p`, `single-1c6p`, `single-1c8p`, `single-1c12p`, `single-1c16p`, `trunk-2c1p`, `trunk-2c2p`, `trunk-2c4p`, `trunk-2c4p-shuffle`, `trunk-2c6p`, `trunk-2c8p`, `trunk-2c12p`, `trunk-4c1p`, `trunk-4c2p`, `trunk-4c4p`, `trunk-4c4p-shuffle`, `trunk-4c6p`, `trunk-4c8p`, `trunk-8c4p`, `breakout-1c2p-2c1p`, `breakout-1c4p-4c1p`, `breakout-1c6p-6c1p`, `breakout-2c4p-8c1p-shuffle`
- **`Cable.status`** — `connected`, `planned`, `decommissioning`
- **`Cable.type`** — `cat3`, `cat5`, `cat5e`, `cat6`, `cat6a`, `cat7`, `cat7a`, `cat8`, `mrj21-trunk`, `dac-active`, `dac-passive`, `coaxial`, `rg-6`, `rg-8`, `rg-11`, `rg-59`, `rg-62`, `rg-213`, `lmr-100`, `lmr-200`, `lmr-400`, `mmf`, `mmf-om1`, `mmf-om2`, `mmf-om3`, `mmf-om4`, `mmf-om5`, `smf`, `smf-os1`, `smf-os2`, `aoc`, `power`, `usb`
- **`CableTermination.cable_end`** — `A`, `B`
- **`Cluster.status`** — `planned`, `staging`, `active`, `decommissioning`, `offline`
- **`ConsolePort.cable_end`** — `A`, `B`
- **`ConsolePort.speed`** — `1200`, `2400`, `4800`, `9600`, `19200`, `38400`, `57600`, `115200`
- **`ConsolePort.type`** — `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`ConsolePortTemplate.type`** — `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`ConsoleServerPort.cable_end`** — `A`, `B`
- **`ConsoleServerPort.speed`** — `1200`, `2400`, `4800`, `9600`, `19200`, `38400`, `57600`, `115200`
- **`ConsoleServerPort.type`** — `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`ConsoleServerPortTemplate.type`** — `de-9`, `db-25`, `rj-11`, `rj-12`, `rj-45`, `mini-din-8`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`Device.airflow`** — `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `rear-to-side`, `bottom-to-top`, `top-to-bottom`, `passive`, `mixed`
- **`Device.face`** — `front`, `rear`
- **`Device.status`** — `offline`, `active`, `planned`, `staged`, `failed`, `inventory`, `decommissioning`
- **`DeviceType.airflow`** — `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `rear-to-side`, `bottom-to-top`, `top-to-bottom`, `passive`, `mixed`
- **`DeviceType.subdevice_role`** — `parent`, `child`
- **`DeviceType.weight_unit`** — `kg`, `g`, `lb`, `oz`
- **`FHRPGroup.auth_type`** — `plaintext`, `md5`
- **`FHRPGroup.protocol`** — `vrrp2`, `vrrp3`, `carp`, `clusterxl`, `hsrp`, `glbp`, `other`
- **`FrontPort.cable_end`** — `A`, `B`
- **`FrontPort.type`** — `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, `4p2c`, `gg45`, `tera-4p`, `tera-2p`, `tera-1p`, `110-punch`, `bnc`, `f`, `n`, `mrj21`, `fc`, `fc-pc`, `fc-upc`, `fc-apc`, `lc`, `lc-pc`, `lc-upc`, `lc-apc`, `lsh`, `lsh-pc`, `lsh-upc`, `lsh-apc`, `lx5`, `lx5-pc`, `lx5-upc`, `lx5-apc`, `mpo`, `mtrj`, `sc`, `sc-pc`, `sc-upc`, `sc-apc`, `st`, `cs`, `sn`, `sma-905`, `sma-906`, `urm-p2`, `urm-p4`, `urm-p8`, `splice`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`FrontPortTemplate.type`** — `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, `4p2c`, `gg45`, `tera-4p`, `tera-2p`, `tera-1p`, `110-punch`, `bnc`, `f`, `n`, `mrj21`, `fc`, `fc-pc`, `fc-upc`, `fc-apc`, `lc`, `lc-pc`, `lc-upc`, `lc-apc`, `lsh`, `lsh-pc`, `lsh-upc`, `lsh-apc`, `lx5`, `lx5-pc`, `lx5-upc`, `lx5-apc`, `mpo`, `mtrj`, `sc`, `sc-pc`, `sc-upc`, `sc-apc`, `st`, `cs`, `sn`, `sma-905`, `sma-906`, `urm-p2`, `urm-p4`, `urm-p8`, `splice`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`IPAddress.family`** — `4`, `6`
- **`IPAddress.role`** — `loopback`, `secondary`, `anycast`, `vip`, `vrrp`, `hsrp`, `glbp`, `carp`
- **`IPAddress.status`** — `active`, `reserved`, `deprecated`, `dhcp`, `slaac`
- **`IPRange.family`** — `4`, `6`
- **`IPRange.status`** — `active`, `reserved`, `deprecated`
- **`Interface.cable_end`** — `A`, `B`
- **`Interface.duplex`** — `half`, `full`, `auto`
- **`Interface.mode`** — `access`, `tagged`, `tagged-all`, `q-in-q`
- **`Interface.poe_mode`** — `pd`, `pse`
- **`Interface.poe_type`** — `type1-ieee802.3af`, `type2-ieee802.3at`, `type3-ieee802.3bt`, `type4-ieee802.3bt`, `passive-24v-2pair`, `passive-24v-4pair`, `passive-48v-2pair`, `passive-48v-4pair`
- **`Interface.rf_channel`** — `2.4g-1-2412-22`, `2.4g-2-2417-22`, `2.4g-3-2422-22`, `2.4g-4-2427-22`, `2.4g-5-2432-22`, `2.4g-6-2437-22`, `2.4g-7-2442-22`, `2.4g-8-2447-22`, `2.4g-9-2452-22`, `2.4g-10-2457-22`, `2.4g-11-2462-22`, `2.4g-12-2467-22`, `2.4g-13-2472-22`, `5g-32-5160-20`, `5g-34-5170-40`, `5g-36-5180-20`, `5g-38-5190-40`, `5g-40-5200-20`, `5g-42-5210-80`, `5g-44-5220-20`, `5g-46-5230-40`, `5g-48-5240-20`, `5g-50-5250-160`, `5g-52-5260-20`, `5g-54-5270-40`, `5g-56-5280-20`, `5g-58-5290-80`, `5g-60-5300-20`, `5g-62-5310-40`, `5g-64-5320-20`, `5g-100-5500-20`, `5g-102-5510-40`, `5g-104-5520-20`, `5g-106-5530-80`, `5g-108-5540-20`, `5g-110-5550-40`, `5g-112-5560-20`, `5g-114-5570-160`, `5g-116-5580-20`, `5g-118-5590-40`, `5g-120-5600-20`, `5g-122-5610-80`, `5g-124-5620-20`, `5g-126-5630-40`, `5g-128-5640-20`, `5g-132-5660-20`, `5g-134-5670-40`, `5g-136-5680-20`, `5g-138-5690-80`, `5g-140-5700-20`, `5g-142-5710-40`, `5g-144-5720-20`, `5g-149-5745-20`, `5g-151-5755-40`, `5g-153-5765-20`, `5g-155-5775-80`, `5g-157-5785-20`, `5g-159-5795-40`, `5g-161-5805-20`, `5g-163-5815-160`, `5g-165-5825-20`, `5g-167-5835-40`, `5g-169-5845-20`, `5g-171-5855-80`, `5g-173-5865-20`, `5g-175-5875-40`, `5g-177-5885-20`, `6g-1-5955-20`, `6g-3-5965-40`, `6g-5-5975-20`, `6g-7-5985-80`, `6g-9-5995-20`, `6g-11-6005-40`, `6g-13-6015-20`, `6g-15-6025-160`, `6g-17-6035-20`, `6g-19-6045-40`, `6g-21-6055-20`, `6g-23-6065-80`, `6g-25-6075-20`, `6g-27-6085-40`, `6g-29-6095-20`, `6g-31-6105-320`, `6g-33-6115-20`, `6g-35-6125-40`, `6g-37-6135-20`, `6g-39-6145-80`, `6g-41-6155-20`, `6g-43-6165-40`, `6g-45-6175-20`, `6g-47-6185-160`, `6g-49-6195-20`, `6g-51-6205-40`, `6g-53-6215-20`, `6g-55-6225-80`, `6g-57-6235-20`, `6g-59-6245-40`, `6g-61-6255-20`, `6g-65-6275-20`, `6g-67-6285-40`, `6g-69-6295-20`, `6g-71-6305-80`, `6g-73-6315-20`, `6g-75-6325-40`, `6g-77-6335-20`, `6g-79-6345-160`, `6g-81-6355-20`, `6g-83-6365-40`, `6g-85-6375-20`, `6g-87-6385-80`, `6g-89-6395-20`, `6g-91-6405-40`, `6g-93-6415-20`, `6g-95-6425-320`, `6g-97-6435-20`, `6g-99-6445-40`, `6g-101-6455-20`, `6g-103-6465-80`, `6g-105-6475-20`, `6g-107-6485-40`, `6g-109-6495-20`, `6g-111-6505-160`, `6g-113-6515-20`, `6g-115-6525-40`, `6g-117-6535-20`, `6g-119-6545-80`, `6g-121-6555-20`, `6g-123-6565-40`, `6g-125-6575-20`, `6g-129-6595-20`, `6g-131-6605-40`, `6g-133-6615-20`, `6g-135-6625-80`, `6g-137-6635-20`, `6g-139-6645-40`, `6g-141-6655-20`, `6g-143-6665-160`, `6g-145-6675-20`, `6g-147-6685-40`, `6g-149-6695-20`, `6g-151-6705-80`, `6g-153-6715-20`, `6g-155-6725-40`, `6g-157-6735-20`, `6g-159-6745-320`, `6g-161-6755-20`, `6g-163-6765-40`, `6g-165-6775-20`, `6g-167-6785-80`, `6g-169-6795-20`, `6g-171-6805-40`, `6g-173-6815-20`, `6g-175-6825-160`, `6g-177-6835-20`, `6g-179-6845-40`, `6g-181-6855-20`, `6g-183-6865-80`, `6g-185-6875-20`, `6g-187-6885-40`, `6g-189-6895-20`, `6g-193-6915-20`, `6g-195-6925-40`, `6g-197-6935-20`, `6g-199-6945-80`, `6g-201-6955-20`, `6g-203-6965-40`, `6g-205-6975-20`, `6g-207-6985-160`, `6g-209-6995-20`, `6g-211-7005-40`, `6g-213-7015-20`, `6g-215-7025-80`, `6g-217-7035-20`, `6g-219-7045-40`, `6g-221-7055-20`, `6g-225-7075-20`, `6g-227-7085-40`, `6g-229-7095-20`, `6g-233-7115-20`, `60g-1-58320-2160`, `60g-2-60480-2160`, `60g-3-62640-2160`, `60g-4-64800-2160`, `60g-5-66960-2160`, `60g-6-69120-2160`, `60g-9-59400-4320`, `60g-10-61560-4320`, `60g-11-63720-4320`, `60g-12-65880-4320`, `60g-13-68040-4320`, `60g-17-60480-6480`, `60g-18-62640-6480`, `60g-19-64800-6480`, `60g-20-66960-6480`, `60g-25-61560-6480`, `60g-26-63720-6480`, `60g-27-65880-6480`
- **`Interface.rf_role`** — `ap`, `station`
- **`Interface.type`** — `virtual`, `bridge`, `lag`, `100base-fx`, `100base-lfx`, `100base-tx`, `100base-t1`, `1000base-bx10-d`, `1000base-bx10-u`, `1000base-cwdm`, `1000base-cx`, `1000base-dwdm`, `1000base-ex`, `1000base-lsx`, `1000base-lx`, `1000base-lx10`, `1000base-sx`, `1000base-t`, `1000base-tx`, `1000base-zx`, `2.5gbase-t`, `5gbase-t`, `10gbase-br-d`, `10gbase-br-u`, `10gbase-cu`, `10gbase-cx4`, `10gbase-er`, `10gbase-lr`, `10gbase-lrm`, `10gbase-lx4`, `10gbase-sr`, `10gbase-t`, `10gbase-zr`, `25gbase-cr`, `25gbase-er`, `25gbase-lr`, `25gbase-sr`, `25gbase-t`, `40gbase-cr4`, `40gbase-er4`, `40gbase-fr4`, `40gbase-lr4`, `40gbase-sr4`, `40gbase-sr4-bd`, `50gbase-cr`, `50gbase-er`, `50gbase-fr`, `50gbase-lr`, `50gbase-sr`, `100gbase-cr1`, `100gbase-cr2`, `100gbase-cr4`, `100gbase-cr10`, `100gbase-cwdm4`, `100gbase-dr`, `100gbase-er4`, `100gbase-fr1`, `100gbase-lr1`, `100gbase-lr4`, `100gbase-sr1`, `100gbase-sr1.2`, `100gbase-sr2`, `100gbase-sr4`, `100gbase-sr10`, `100gbase-zr`, `200gbase-cr2`, `200gbase-cr4`, `200gbase-dr4`, `200gbase-er4`, `200gbase-fr4`, `200gbase-lr4`, `200gbase-sr2`, `200gbase-sr4`, `200gbase-vr2`, `400gbase-cr4`, `400gbase-dr4`, `400gbase-er8`, `400gbase-fr4`, `400gbase-fr8`, `400gbase-lr4`, `400gbase-lr8`, `400gbase-sr4`, `400gbase-sr4_2`, `400gbase-sr8`, `400gbase-sr16`, `400gbase-vr4`, `400gbase-zr`, `800gbase-cr8`, `800gbase-dr8`, `800gbase-sr8`, `800gbase-vr8`, `1.6tbase-cr8`, `1.6tbase-dr8`, `1.6tbase-dr8-2`, `100base-x-sfp`, `1000base-x-gbic`, `1000base-x-sfp`, `2.5gbase-x-sfp`, `10gbase-x-sfpp`, `10gbase-x-xenpak`, `10gbase-x-xfp`, `10gbase-x-x2`, `25gbase-x-sfp28`, `40gbase-x-qsfpp`, `50gbase-x-sfp28`, `50gbase-x-sfp56`, `100gbase-x-cfp`, `100gbase-x-cfp2`, `100gbase-x-cfp4`, `100gbase-x-cxp`, `100gbase-x-cpak`, `100gbase-x-dsfp`, `100gbase-x-qsfp28`, `100gbase-x-qsfpdd`, `100gbase-x-sfpdd`, `200gbase-x-cfp2`, `200gbase-x-qsfp56`, `200gbase-x-qsfpdd`, `400gbase-x-qsfp112`, `400gbase-x-qsfpdd`, `400gbase-x-cdfp`, `400gbase-x-cfp2`, `400gbase-x-cfp8`, `400gbase-x-osfp`, `400gbase-x-osfp-rhs`, `800gbase-x-osfp`, `800gbase-x-qsfpdd`, `1.6tbase-x-osfp1600`, `1.6tbase-x-osfp1600-rhs`, `1.6tbase-x-qsfpdd1600`, `1000base-kx`, `2.5gbase-kx`, `5gbase-kr`, `10gbase-kr`, `10gbase-kx4`, `25gbase-kr`, `40gbase-kr4`, `50gbase-kr`, `100gbase-kp4`, `100gbase-kr2`, `100gbase-kr4`, `1.6tbase-kr8`, `ieee802.11a`, `ieee802.11g`, `ieee802.11n`, `ieee802.11ac`, `ieee802.11ad`, `ieee802.11ax`, `ieee802.11ay`, `ieee802.11be`, `ieee802.15.1`, `ieee802.15.4`, `other-wireless`, `gsm`, `cdma`, `lte`, `4g`, `5g`, `sonet-oc3`, `sonet-oc12`, `sonet-oc48`, `sonet-oc192`, `sonet-oc768`, `sonet-oc1920`, `sonet-oc3840`, `1gfc-sfp`, `2gfc-sfp`, `4gfc-sfp`, `8gfc-sfpp`, `16gfc-sfpp`, `32gfc-sfp28`, `32gfc-sfpp`, `64gfc-qsfpp`, `64gfc-sfpdd`, `64gfc-sfpp`, `128gfc-qsfp28`, `infiniband-sdr`, `infiniband-ddr`, `infiniband-qdr`, `infiniband-fdr10`, `infiniband-fdr`, `infiniband-edr`, `infiniband-hdr`, `infiniband-ndr`, `infiniband-xdr`, `t1`, `e1`, `t3`, `e3`, `xdsl`, `docsis`, `moca`, `bpon`, `epon`, `10g-epon`, `gpon`, `xg-pon`, `xgs-pon`, `ng-pon2`, `25g-pon`, `50g-pon`, `cisco-stackwise`, `cisco-stackwise-plus`, `cisco-flexstack`, `cisco-flexstack-plus`, `cisco-stackwise-80`, `cisco-stackwise-160`, `cisco-stackwise-320`, `cisco-stackwise-480`, `cisco-stackwise-1t`, `juniper-vcp`, `extreme-summitstack`, `extreme-summitstack-128`, `extreme-summitstack-256`, `extreme-summitstack-512`, `other`
- **`InterfaceTemplate.poe_mode`** — `pd`, `pse`
- **`InterfaceTemplate.poe_type`** — `type1-ieee802.3af`, `type2-ieee802.3at`, `type3-ieee802.3bt`, `type4-ieee802.3bt`, `passive-24v-2pair`, `passive-24v-4pair`, `passive-48v-2pair`, `passive-48v-4pair`
- **`InterfaceTemplate.rf_role`** — `ap`, `station`
- **`InterfaceTemplate.type`** — `virtual`, `bridge`, `lag`, `100base-fx`, `100base-lfx`, `100base-tx`, `100base-t1`, `1000base-bx10-d`, `1000base-bx10-u`, `1000base-cwdm`, `1000base-cx`, `1000base-dwdm`, `1000base-ex`, `1000base-lsx`, `1000base-lx`, `1000base-lx10`, `1000base-sx`, `1000base-t`, `1000base-tx`, `1000base-zx`, `2.5gbase-t`, `5gbase-t`, `10gbase-br-d`, `10gbase-br-u`, `10gbase-cu`, `10gbase-cx4`, `10gbase-er`, `10gbase-lr`, `10gbase-lrm`, `10gbase-lx4`, `10gbase-sr`, `10gbase-t`, `10gbase-zr`, `25gbase-cr`, `25gbase-er`, `25gbase-lr`, `25gbase-sr`, `25gbase-t`, `40gbase-cr4`, `40gbase-er4`, `40gbase-fr4`, `40gbase-lr4`, `40gbase-sr4`, `40gbase-sr4-bd`, `50gbase-cr`, `50gbase-er`, `50gbase-fr`, `50gbase-lr`, `50gbase-sr`, `100gbase-cr1`, `100gbase-cr2`, `100gbase-cr4`, `100gbase-cr10`, `100gbase-cwdm4`, `100gbase-dr`, `100gbase-er4`, `100gbase-fr1`, `100gbase-lr1`, `100gbase-lr4`, `100gbase-sr1`, `100gbase-sr1.2`, `100gbase-sr2`, `100gbase-sr4`, `100gbase-sr10`, `100gbase-zr`, `200gbase-cr2`, `200gbase-cr4`, `200gbase-dr4`, `200gbase-er4`, `200gbase-fr4`, `200gbase-lr4`, `200gbase-sr2`, `200gbase-sr4`, `200gbase-vr2`, `400gbase-cr4`, `400gbase-dr4`, `400gbase-er8`, `400gbase-fr4`, `400gbase-fr8`, `400gbase-lr4`, `400gbase-lr8`, `400gbase-sr4`, `400gbase-sr4_2`, `400gbase-sr8`, `400gbase-sr16`, `400gbase-vr4`, `400gbase-zr`, `800gbase-cr8`, `800gbase-dr8`, `800gbase-sr8`, `800gbase-vr8`, `1.6tbase-cr8`, `1.6tbase-dr8`, `1.6tbase-dr8-2`, `100base-x-sfp`, `1000base-x-gbic`, `1000base-x-sfp`, `2.5gbase-x-sfp`, `10gbase-x-sfpp`, `10gbase-x-xenpak`, `10gbase-x-xfp`, `10gbase-x-x2`, `25gbase-x-sfp28`, `40gbase-x-qsfpp`, `50gbase-x-sfp28`, `50gbase-x-sfp56`, `100gbase-x-cfp`, `100gbase-x-cfp2`, `100gbase-x-cfp4`, `100gbase-x-cxp`, `100gbase-x-cpak`, `100gbase-x-dsfp`, `100gbase-x-qsfp28`, `100gbase-x-qsfpdd`, `100gbase-x-sfpdd`, `200gbase-x-cfp2`, `200gbase-x-qsfp56`, `200gbase-x-qsfpdd`, `400gbase-x-qsfp112`, `400gbase-x-qsfpdd`, `400gbase-x-cdfp`, `400gbase-x-cfp2`, `400gbase-x-cfp8`, `400gbase-x-osfp`, `400gbase-x-osfp-rhs`, `800gbase-x-osfp`, `800gbase-x-qsfpdd`, `1.6tbase-x-osfp1600`, `1.6tbase-x-osfp1600-rhs`, `1.6tbase-x-qsfpdd1600`, `1000base-kx`, `2.5gbase-kx`, `5gbase-kr`, `10gbase-kr`, `10gbase-kx4`, `25gbase-kr`, `40gbase-kr4`, `50gbase-kr`, `100gbase-kp4`, `100gbase-kr2`, `100gbase-kr4`, `1.6tbase-kr8`, `ieee802.11a`, `ieee802.11g`, `ieee802.11n`, `ieee802.11ac`, `ieee802.11ad`, `ieee802.11ax`, `ieee802.11ay`, `ieee802.11be`, `ieee802.15.1`, `ieee802.15.4`, `other-wireless`, `gsm`, `cdma`, `lte`, `4g`, `5g`, `sonet-oc3`, `sonet-oc12`, `sonet-oc48`, `sonet-oc192`, `sonet-oc768`, `sonet-oc1920`, `sonet-oc3840`, `1gfc-sfp`, `2gfc-sfp`, `4gfc-sfp`, `8gfc-sfpp`, `16gfc-sfpp`, `32gfc-sfp28`, `32gfc-sfpp`, `64gfc-qsfpp`, `64gfc-sfpdd`, `64gfc-sfpp`, `128gfc-qsfp28`, `infiniband-sdr`, `infiniband-ddr`, `infiniband-qdr`, `infiniband-fdr10`, `infiniband-fdr`, `infiniband-edr`, `infiniband-hdr`, `infiniband-ndr`, `infiniband-xdr`, `t1`, `e1`, `t3`, `e3`, `xdsl`, `docsis`, `moca`, `bpon`, `epon`, `10g-epon`, `gpon`, `xg-pon`, `xgs-pon`, `ng-pon2`, `25g-pon`, `50g-pon`, `cisco-stackwise`, `cisco-stackwise-plus`, `cisco-flexstack`, `cisco-flexstack-plus`, `cisco-stackwise-80`, `cisco-stackwise-160`, `cisco-stackwise-320`, `cisco-stackwise-480`, `cisco-stackwise-1t`, `juniper-vcp`, `extreme-summitstack`, `extreme-summitstack-128`, `extreme-summitstack-256`, `extreme-summitstack-512`, `other`
- **`InventoryItem.status`** — `offline`, `active`, `planned`, `staged`, `failed`, `decommissioning`
- **`Location.status`** — `planned`, `staging`, `active`, `decommissioning`, `retired`
- **`Module.status`** — `offline`, `active`, `planned`, `staged`, `failed`, `decommissioning`
- **`ModuleType.airflow`** — `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `passive`
- **`ModuleType.weight_unit`** — `kg`, `g`, `lb`, `oz`
- **`PowerFeed.cable_end`** — `A`, `B`
- **`PowerFeed.phase`** — `single-phase`, `three-phase`
- **`PowerFeed.status`** — `offline`, `active`, `planned`, `failed`
- **`PowerFeed.supply`** — `ac`, `dc`
- **`PowerFeed.type`** — `primary`, `redundant`
- **`PowerOutlet.cable_end`** — `A`, `B`
- **`PowerOutlet.feed_leg`** — `A`, `B`, `C`
- **`PowerOutlet.status`** — `enabled`, `disabled`, `faulty`
- **`PowerOutlet.type`** — `iec-60320-c5`, `iec-60320-c7`, `iec-60320-c13`, `iec-60320-c15`, `iec-60320-c17`, `iec-60320-c19`, `iec-60320-c21`, `iec-60309-p-n-e-4h`, `iec-60309-p-n-e-6h`, `iec-60309-p-n-e-9h`, `iec-60309-2p-e-4h`, `iec-60309-2p-e-6h`, `iec-60309-2p-e-9h`, `iec-60309-3p-e-4h`, `iec-60309-3p-e-6h`, `iec-60309-3p-e-9h`, `iec-60309-3p-n-e-4h`, `iec-60309-3p-n-e-6h`, `iec-60309-3p-n-e-9h`, `iec-60906-1`, `nbr-14136-10a`, `nbr-14136-20a`, `nema-1-15r`, `nema-5-15r`, `nema-5-20r`, `nema-5-30r`, `nema-5-50r`, `nema-6-15r`, `nema-6-20r`, `nema-6-30r`, `nema-6-50r`, `nema-10-30r`, `nema-10-50r`, `nema-14-20r`, `nema-14-30r`, `nema-14-50r`, `nema-14-60r`, `nema-15-15r`, `nema-15-20r`, `nema-15-30r`, `nema-15-50r`, `nema-15-60r`, `nema-l1-15r`, `nema-l5-15r`, `nema-l5-20r`, `nema-l5-30r`, `nema-l5-50r`, `nema-l6-15r`, `nema-l6-20r`, `nema-l6-30r`, `nema-l6-50r`, `nema-l10-30r`, `nema-l14-20r`, `nema-l14-30r`, `nema-l14-50r`, `nema-l14-60r`, `nema-l15-20r`, `nema-l15-30r`, `nema-l15-50r`, `nema-l15-60r`, `nema-l21-20r`, `nema-l21-30r`, `nema-l22-20r`, `nema-l22-30r`, `CS6360C`, `CS6364C`, `CS8164C`, `CS8264C`, `CS8364C`, `CS8464C`, `ita-e`, `ita-f`, `ita-g`, `ita-h`, `ita-i`, `ita-j`, `ita-k`, `ita-l`, `ita-m`, `ita-n`, `ita-o`, `ita-multistandard`, `usb-a`, `usb-micro-b`, `usb-c`, `molex-micro-fit-1x2`, `molex-micro-fit-2x2`, `molex-micro-fit-2x3`, `molex-micro-fit-2x4`, `dc-terminal`, `eaton-c39`, `hdot-cx`, `saf-d-grid`, `neutrik-powercon-20a`, `neutrik-powercon-32a`, `neutrik-powercon-true1`, `neutrik-powercon-true1-top`, `ubiquiti-smartpower`, `hardwired`, `other`
- **`PowerOutletTemplate.feed_leg`** — `A`, `B`, `C`
- **`PowerOutletTemplate.type`** — `iec-60320-c5`, `iec-60320-c7`, `iec-60320-c13`, `iec-60320-c15`, `iec-60320-c17`, `iec-60320-c19`, `iec-60320-c21`, `iec-60309-p-n-e-4h`, `iec-60309-p-n-e-6h`, `iec-60309-p-n-e-9h`, `iec-60309-2p-e-4h`, `iec-60309-2p-e-6h`, `iec-60309-2p-e-9h`, `iec-60309-3p-e-4h`, `iec-60309-3p-e-6h`, `iec-60309-3p-e-9h`, `iec-60309-3p-n-e-4h`, `iec-60309-3p-n-e-6h`, `iec-60309-3p-n-e-9h`, `iec-60906-1`, `nbr-14136-10a`, `nbr-14136-20a`, `nema-1-15r`, `nema-5-15r`, `nema-5-20r`, `nema-5-30r`, `nema-5-50r`, `nema-6-15r`, `nema-6-20r`, `nema-6-30r`, `nema-6-50r`, `nema-10-30r`, `nema-10-50r`, `nema-14-20r`, `nema-14-30r`, `nema-14-50r`, `nema-14-60r`, `nema-15-15r`, `nema-15-20r`, `nema-15-30r`, `nema-15-50r`, `nema-15-60r`, `nema-l1-15r`, `nema-l5-15r`, `nema-l5-20r`, `nema-l5-30r`, `nema-l5-50r`, `nema-l6-15r`, `nema-l6-20r`, `nema-l6-30r`, `nema-l6-50r`, `nema-l10-30r`, `nema-l14-20r`, `nema-l14-30r`, `nema-l14-50r`, `nema-l14-60r`, `nema-l15-20r`, `nema-l15-30r`, `nema-l15-50r`, `nema-l15-60r`, `nema-l21-20r`, `nema-l21-30r`, `nema-l22-20r`, `nema-l22-30r`, `CS6360C`, `CS6364C`, `CS8164C`, `CS8264C`, `CS8364C`, `CS8464C`, `ita-e`, `ita-f`, `ita-g`, `ita-h`, `ita-i`, `ita-j`, `ita-k`, `ita-l`, `ita-m`, `ita-n`, `ita-o`, `ita-multistandard`, `usb-a`, `usb-micro-b`, `usb-c`, `molex-micro-fit-1x2`, `molex-micro-fit-2x2`, `molex-micro-fit-2x3`, `molex-micro-fit-2x4`, `dc-terminal`, `eaton-c39`, `hdot-cx`, `saf-d-grid`, `neutrik-powercon-20a`, `neutrik-powercon-32a`, `neutrik-powercon-true1`, `neutrik-powercon-true1-top`, `ubiquiti-smartpower`, `hardwired`, `other`
- **`PowerPort.cable_end`** — `A`, `B`
- **`PowerPort.type`** — `iec-60320-c6`, `iec-60320-c8`, `iec-60320-c14`, `iec-60320-c16`, `iec-60320-c18`, `iec-60320-c20`, `iec-60320-c22`, `iec-60309-p-n-e-4h`, `iec-60309-p-n-e-6h`, `iec-60309-p-n-e-9h`, `iec-60309-2p-e-4h`, `iec-60309-2p-e-6h`, `iec-60309-2p-e-9h`, `iec-60309-3p-e-4h`, `iec-60309-3p-e-6h`, `iec-60309-3p-e-9h`, `iec-60309-3p-n-e-4h`, `iec-60309-3p-n-e-6h`, `iec-60309-3p-n-e-9h`, `iec-60906-1`, `nbr-14136-10a`, `nbr-14136-20a`, `nema-1-15p`, `nema-5-15p`, `nema-5-20p`, `nema-5-30p`, `nema-5-50p`, `nema-6-15p`, `nema-6-20p`, `nema-6-30p`, `nema-6-50p`, `nema-10-30p`, `nema-10-50p`, `nema-14-20p`, `nema-14-30p`, `nema-14-50p`, `nema-14-60p`, `nema-15-15p`, `nema-15-20p`, `nema-15-30p`, `nema-15-50p`, `nema-15-60p`, `nema-l1-15p`, `nema-l5-15p`, `nema-l5-20p`, `nema-l5-30p`, `nema-l5-50p`, `nema-l6-15p`, `nema-l6-20p`, `nema-l6-30p`, `nema-l6-50p`, `nema-l10-30p`, `nema-l14-20p`, `nema-l14-30p`, `nema-l14-50p`, `nema-l14-60p`, `nema-l15-20p`, `nema-l15-30p`, `nema-l15-50p`, `nema-l15-60p`, `nema-l21-20p`, `nema-l21-30p`, `nema-l22-20p`, `nema-l22-30p`, `cs6361c`, `cs6365c`, `cs8165c`, `cs8265c`, `cs8365c`, `cs8465c`, `ita-c`, `ita-e`, `ita-f`, `ita-ef`, `ita-g`, `ita-h`, `ita-i`, `ita-j`, `ita-k`, `ita-l`, `ita-m`, `ita-n`, `ita-o`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `usb-3-b`, `usb-3-micro-b`, `molex-micro-fit-1x2`, `molex-micro-fit-2x2`, `molex-micro-fit-2x3`, `molex-micro-fit-2x4`, `dc-terminal`, `saf-d-grid`, `neutrik-powercon-20`, `neutrik-powercon-32`, `neutrik-powercon-true1`, `neutrik-powercon-true1-top`, `ubiquiti-smartpower`, `hardwired`, `other`
- **`PowerPortTemplate.type`** — `iec-60320-c6`, `iec-60320-c8`, `iec-60320-c14`, `iec-60320-c16`, `iec-60320-c18`, `iec-60320-c20`, `iec-60320-c22`, `iec-60309-p-n-e-4h`, `iec-60309-p-n-e-6h`, `iec-60309-p-n-e-9h`, `iec-60309-2p-e-4h`, `iec-60309-2p-e-6h`, `iec-60309-2p-e-9h`, `iec-60309-3p-e-4h`, `iec-60309-3p-e-6h`, `iec-60309-3p-e-9h`, `iec-60309-3p-n-e-4h`, `iec-60309-3p-n-e-6h`, `iec-60309-3p-n-e-9h`, `iec-60906-1`, `nbr-14136-10a`, `nbr-14136-20a`, `nema-1-15p`, `nema-5-15p`, `nema-5-20p`, `nema-5-30p`, `nema-5-50p`, `nema-6-15p`, `nema-6-20p`, `nema-6-30p`, `nema-6-50p`, `nema-10-30p`, `nema-10-50p`, `nema-14-20p`, `nema-14-30p`, `nema-14-50p`, `nema-14-60p`, `nema-15-15p`, `nema-15-20p`, `nema-15-30p`, `nema-15-50p`, `nema-15-60p`, `nema-l1-15p`, `nema-l5-15p`, `nema-l5-20p`, `nema-l5-30p`, `nema-l5-50p`, `nema-l6-15p`, `nema-l6-20p`, `nema-l6-30p`, `nema-l6-50p`, `nema-l10-30p`, `nema-l14-20p`, `nema-l14-30p`, `nema-l14-50p`, `nema-l14-60p`, `nema-l15-20p`, `nema-l15-30p`, `nema-l15-50p`, `nema-l15-60p`, `nema-l21-20p`, `nema-l21-30p`, `nema-l22-20p`, `nema-l22-30p`, `cs6361c`, `cs6365c`, `cs8165c`, `cs8265c`, `cs8365c`, `cs8465c`, `ita-c`, `ita-e`, `ita-f`, `ita-ef`, `ita-g`, `ita-h`, `ita-i`, `ita-j`, `ita-k`, `ita-l`, `ita-m`, `ita-n`, `ita-o`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `usb-3-b`, `usb-3-micro-b`, `molex-micro-fit-1x2`, `molex-micro-fit-2x2`, `molex-micro-fit-2x3`, `molex-micro-fit-2x4`, `dc-terminal`, `saf-d-grid`, `neutrik-powercon-20`, `neutrik-powercon-32`, `neutrik-powercon-true1`, `neutrik-powercon-true1-top`, `ubiquiti-smartpower`, `hardwired`, `other`
- **`Prefix.family`** — `4`, `6`
- **`Prefix.status`** — `container`, `active`, `reserved`, `deprecated`
- **`Rack.airflow`** — `front-to-rear`, `rear-to-front`
- **`Rack.form_factor`** — `2-post-frame`, `4-post-frame`, `4-post-cabinet`, `wall-frame`, `wall-frame-vertical`, `wall-cabinet`, `wall-cabinet-vertical`
- **`Rack.outer_unit`** — `mm`, `in`
- **`Rack.status`** — `reserved`, `available`, `planned`, `active`, `deprecated`
- **`Rack.weight_unit`** — `kg`, `g`, `lb`, `oz`
- **`Rack.width`** — `10`, `19`, `21`, `23`
- **`RackReservation.status`** — `pending`, `active`, `stale`
- **`RackType.form_factor`** — `2-post-frame`, `4-post-frame`, `4-post-cabinet`, `wall-frame`, `wall-frame-vertical`, `wall-cabinet`, `wall-cabinet-vertical`
- **`RackType.outer_unit`** — `mm`, `in`
- **`RackType.weight_unit`** — `kg`, `g`, `lb`, `oz`
- **`RackType.width`** — `10`, `19`, `21`, `23`
- **`RearPort.cable_end`** — `A`, `B`
- **`RearPort.type`** — `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, `4p2c`, `gg45`, `tera-4p`, `tera-2p`, `tera-1p`, `110-punch`, `bnc`, `f`, `n`, `mrj21`, `fc`, `fc-pc`, `fc-upc`, `fc-apc`, `lc`, `lc-pc`, `lc-upc`, `lc-apc`, `lsh`, `lsh-pc`, `lsh-upc`, `lsh-apc`, `lx5`, `lx5-pc`, `lx5-upc`, `lx5-apc`, `mpo`, `mtrj`, `sc`, `sc-pc`, `sc-upc`, `sc-apc`, `st`, `cs`, `sn`, `sma-905`, `sma-906`, `urm-p2`, `urm-p4`, `urm-p8`, `splice`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`RearPortTemplate.type`** — `8p8c`, `8p6c`, `8p4c`, `8p2c`, `6p6c`, `6p4c`, `6p2c`, `4p4c`, `4p2c`, `gg45`, `tera-4p`, `tera-2p`, `tera-1p`, `110-punch`, `bnc`, `f`, `n`, `mrj21`, `fc`, `fc-pc`, `fc-upc`, `fc-apc`, `lc`, `lc-pc`, `lc-upc`, `lc-apc`, `lsh`, `lsh-pc`, `lsh-upc`, `lsh-apc`, `lx5`, `lx5-pc`, `lx5-upc`, `lx5-apc`, `mpo`, `mtrj`, `sc`, `sc-pc`, `sc-upc`, `sc-apc`, `st`, `cs`, `sn`, `sma-905`, `sma-906`, `urm-p2`, `urm-p4`, `urm-p8`, `splice`, `usb-a`, `usb-b`, `usb-c`, `usb-mini-a`, `usb-mini-b`, `usb-micro-a`, `usb-micro-b`, `usb-micro-ab`, `other`
- **`Service.protocol`** — `tcp`, `udp`, `sctp`
- **`ServiceTemplate.protocol`** — `tcp`, `udp`, `sctp`
- **`Site.status`** — `planned`, `staging`, `active`, `decommissioning`, `retired`
- **`VLAN.qinq_role`** — `svlan`, `cvlan`
- **`VLAN.status`** — `active`, `reserved`, `deprecated`
- **`VMInterface.mode`** — `access`, `tagged`, `tagged-all`, `q-in-q`
- **`VirtualDeviceContext.status`** — `active`, `planned`, `offline`
- **`VirtualMachine.start_on_boot`** — `on`, `off`, `laststate`
- **`VirtualMachine.status`** — `offline`, `active`, `planned`, `staged`, `failed`, `decommissioning`, `paused`