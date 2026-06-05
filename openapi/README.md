# NetBox-Compatible OpenAPI (DCIM · IPAM · Virtualization)

This directory holds an OpenAPI 3.0.3 specification that mirrors the
[NetBox community](https://github.com/netbox-community/netbox) REST API for the
**DCIM**, **IPAM**, and **Virtualization** sections only. The goal is API
compatibility: a client built against NetBox should work unchanged against an
implementation of this spec.

## Files

| File | Description |
|------|-------------|
| `netbox-dcim-ipam-virt.openapi.json` | The filtered spec (JSON). |
| `netbox-dcim-ipam-virt.openapi.yaml` | Same spec (YAML). |
| `extract_sections.py` | Script that produces the spec from a full NetBox schema. |

## Source

- Generated from **NetBox 4.6.2** (`/api/schema/` via drf-spectacular).
- Pulled from the public demo instance `https://demo.netbox.dev`.

## Coverage

- **159 paths** = 103 DCIM + 41 IPAM + 15 Virtualization.
- **462 component schemas** (transitive closure of everything the kept paths
  reference, so the spec is fully self-contained — zero dangling `$ref`s).
- Resource groups: 47 (DCIM) · 18 (IPAM) · 7 (Virtualization).
- Each writable resource exposes the standard NetBox verbs:
  list/create (`GET`/`POST` on the collection) and
  retrieve/replace/update/delete (`GET`/`PUT`/`PATCH`/`DELETE` on `/{id}/`).
- Auth schemes preserved: `tokenAuth` (Authorization: Token …) and `cookieAuth`.

## How to regenerate (e.g. for a newer NetBox release)

```bash
# 1. Fetch the full schema from any NetBox instance (no auth needed for /schema/)
curl -s "https://demo.netbox.dev/api/schema/?format=json" -o nb_schema.json

# 2. Filter to the three sections + referenced components
python3 extract_sections.py     # reads /tmp/nb_schema.json, writes /tmp/openapi_filtered.json
```

> `extract_sections.py` currently reads `/tmp/nb_schema.json` and writes
> `/tmp/openapi_filtered.json`. Adjust the paths at the top of the script, or the
> `SECTIONS` list to change which API sections are included.

## Validation

The spec passes `openapi-spec-validator` (OpenAPI 3.0.3) with no errors.

```bash
pip install openapi-spec-validator
python3 -c "import json,openapi_spec_validator as v; v.validate(json.load(open('netbox-dcim-ipam-virt.openapi.json')))"
```
