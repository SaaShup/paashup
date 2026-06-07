# Extending paas2box (plugins)

paas2box can be extended with **plugins** that add new object types and endpoints —
the same idea as NetBox plugins, but lighter. This page is an orientation; full
authoring docs live in the project repository.

## What a plugin can add

- **Entities** — new object types. Because paas2box is metadata-driven, registering an
  entity automatically gives it a full REST API, validation, the OpenAPI schema entry,
  webhooks/realtime, **and** a page in this UI — no extra code.
- **Migrations** — the SQL to create the plugin's tables (SQLite + MariaDB), applied
  and tracked automatically.
- **Routes** — custom, non-CRUD endpoints under `/api/plugins/<name>/…`.
- **Hooks** — run code after a create/update/delete.
- **Custom fields** — add extra fields to existing core object types.

## Where plugin content shows up

- New entities appear in the left menu (usually under a **Plugins** section) and at
  `/api/plugins/<name>/<resource>/`.
- They behave exactly like core objects: filtering, pagination, the API links on each
  page, webhooks, and live updates all work out of the box.

## For administrators

A host loads plugins it discovers as dependencies (`paas2box-plugin-*`) or that are
listed explicitly (via the `PB_PLUGINS` setting). Ask whoever operates your paas2box
instance which plugins are installed.

## For developers

The repository ships a **starter template** (`templates/plugin-starter/`) and a
**porting guide** (`docs/PLUGIN-PORTING.md`, including a NetBox → paas2box mapping).
A plugin is a single module that exports a `Plugin` object; it needs no runtime
dependency on paas2box. Build it, point a paas2box host at it, and your new objects get
API + schema + UI automatically.
