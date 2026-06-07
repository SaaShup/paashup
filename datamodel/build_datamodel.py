#!/usr/bin/env python3
"""Derive a database-oriented data model from the filtered NetBox OpenAPI spec.

For each writable collection endpoint we locate the GET-response (read) schema and
the POST-request (write) schema, then merge them into a normalized field list with
types, nullability, foreign keys, many-to-many relations, and enum choices.

Outputs:
  datamodel/data-model.json  -- machine-readable
  datamodel/DATA-MODEL.md    -- human-readable reference
"""

import json
import os
import re
import sys
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = os.path.join(ROOT, "openapi", "netbox-dcim-ipam-virt.openapi.json")

spec = json.load(open(SPEC))
schemas = spec["components"]["schemas"]

# Server-managed / computed fields that are not real persisted columns we author.
# Some NetBox serializers use a context-specific name for what is really another
# model (e.g. ASN.sites serializes Site rows via an "ASNSite" serializer).
MODEL_ALIAS = {"ASNSite": "Site"}

COMPUTED = {
    "url",
    "display",
    "display_url",
    "created",
    "last_updated",
    "id",
    "_depth",
    "family",
    "children",
    "device_count",
    "prefix_count",
    "vlan_count",
    "rack_count",
    "ipaddress_count",
    "depth",
}


def ref_name(node):
    """Return the component schema name a node references, else None."""
    if not isinstance(node, dict):
        return None
    if "$ref" in node:
        return node["$ref"].split("/")[-1]
    return None


def model_of(brief_name):
    """BriefSite / NestedSite / BriefSiteRequest -> Site."""
    n = brief_name
    for pre in ("Brief", "Nested", "Writable"):
        if n.startswith(pre):
            n = n[len(pre) :]
    if n.endswith("Request"):
        n = n[: -len("Request")]
    return n


def unwrap_fk(node):
    """If node is a single FK (read: allOf->$ref Brief*, or direct $ref Brief*),
    return target model name, else None."""
    if not isinstance(node, dict):
        return None
    rn = ref_name(node)
    if rn and (rn.startswith("Brief") or rn.startswith("Nested")):
        return model_of(rn)
    if "allOf" in node and len(node["allOf"]) == 1:
        rn = ref_name(node["allOf"][0])
        if rn and (rn.startswith("Brief") or rn.startswith("Nested")):
            return model_of(rn)
    # write-side FK: oneOf: [{integer}, {allOf:[{$ref Brief*Request}]}]
    if "oneOf" in node:
        for opt in node["oneOf"]:
            t = unwrap_fk(opt)
            if t:
                return t
    return None


def read_enum(node):
    """Extract enum choices from a read-side choice field (type:object w/ value.enum)
    or a plain enum node."""
    if not isinstance(node, dict):
        return None

    def clean(values):
        return [v for v in values if v not in ("", None)]

    if node.get("type") == "object" and "properties" in node:
        val = node["properties"].get("value", {})
        if "enum" in val:
            return clean(val["enum"])
        # nested allOf inside value
        if "allOf" in val:
            return None
    if "enum" in node:
        return clean(node["enum"])
    return None


def enum_labels(rnode, wnode):
    r"""Map enum value -> human label, parsed from the OpenAPI description lines
    of the form `* \`value\` - Label`."""
    desc = None
    for node in (rnode, wnode):
        if not isinstance(node, dict):
            continue
        if node.get("type") == "object" and "properties" in node:
            desc = node["properties"].get("value", {}).get("description")
        elif "enum" in node:
            desc = node.get("description")
        if desc:
            break
    if not desc:
        return {}
    labels = {}
    for m in re.finditer(r"\*\s+`([^`]+)`\s+-\s+(.+)", desc):
        labels[m.group(1)] = m.group(2).strip()
    return labels


def scalar_type(node):
    """Map an OpenAPI scalar node to a generic type string."""
    if not isinstance(node, dict):
        return "unknown"
    t = node.get("type")
    fmt = node.get("format")
    if t == "string":
        if fmt == "date-time":
            return "datetime"
        if fmt == "date":
            return "date"
        if fmt == "uri":
            return "string(uri)"
        if fmt == "uuid":
            return "uuid"
        if fmt == "decimal":
            return "decimal"
        if node.get("maxLength"):
            return f"string({node['maxLength']})"
        return "string"
    if t == "integer":
        return "bigint" if fmt == "int64" else "integer"
    if t == "number":
        return "decimal" if fmt == "decimal" else "number"
    if t == "boolean":
        return "boolean"
    if t == "object":
        return "json"
    if t == "array":
        return "array"
    return t or "object"


def resolve_list_item(read_ref, S=None):
    """Given a Paginated*List schema, return the item schema name."""
    S = S if S is not None else schemas
    s = S.get(read_ref, {})
    results = s.get("properties", {}).get("results", {})
    item = results.get("items", {})
    return ref_name(item)


# ---- map each collection endpoint to (read_schema, write_schema) -------------
def schema_from_response(op, S=None):
    try:
        content = op["responses"]["200"]["content"]["application/json"]["schema"]
    except (KeyError, TypeError):
        return None
    rn = ref_name(content)
    if rn and rn.startswith("Paginated"):
        return resolve_list_item(rn, S)
    return rn


def schema_from_request(op):
    try:
        content = op["requestBody"]["content"]["application/json"]["schema"]
    except (KeyError, TypeError):
        return None
    rn = ref_name(content)
    if rn:
        return rn
    # bulk-create endpoints use: oneOf: [{$ref Writable*Request}, {array of it}]
    if isinstance(content, dict) and "oneOf" in content:
        for opt in content["oneOf"]:
            rn = ref_name(opt)
            if rn:
                return rn
    return None


entities = OrderedDict()
for path, methods in spec["paths"].items():
    parts = path.split("/")  # ['', 'api', 'dcim', 'devices', ...]
    if len(parts) < 4:
        continue
    section, resource = parts[2], parts[3]
    is_collection = path.rstrip("/").endswith(resource)  # no {id}
    if not is_collection:
        continue
    get_op, post_op = methods.get("get"), methods.get("post")
    read = schema_from_response(get_op) if get_op else None
    write = schema_from_request(post_op) if post_op else None
    if not read:
        continue
    key = f"{section}/{resource}"
    entities[key] = {
        "section": section,
        "endpoint": f"/api/{section}/{resource}/",
        "read_schema": read,
        "write_schema": write,
        "model": model_of(read).replace("WithConfigContext", ""),
        "origin": "core",
    }


# ---- build field lists -------------------------------------------------------
def is_generic_read_accessor(rnode):
    """A read-only property with no type/ref/enum is a GenericForeignKey accessor
    (e.g. `scope`, `assigned_object`) backed by companion `*_type`/`*_id` columns."""
    if not isinstance(rnode, dict):
        return False
    return (
        rnode.get("readOnly")
        and "type" not in rnode
        and not ref_name(rnode)
        and "allOf" not in rnode
        and "oneOf" not in rnode
    )


def build_fields(ent, S=None):
    S = S if S is not None else schemas
    read = S.get(ent["read_schema"], {})
    write = S.get(ent["write_schema"], {}) if ent["write_schema"] else {}
    rprops = read.get("properties", {})
    wprops = write.get("properties", {})
    wreq = set(write.get("required", []))

    # union of columns: read first (ordered), then write-only columns
    names = list(rprops) + [n for n in wprops if n not in rprops]

    fields = []
    for name in names:
        rnode = rprops.get(name)
        wnode = wprops.get(name)
        node = rnode if isinstance(rnode, dict) else (wnode or {})

        # skip the polymorphic read accessor; its companion *_type/*_id are real columns
        if (
            isinstance(rnode, dict)
            and is_generic_read_accessor(rnode)
            and (f"{name}_type" in wprops or f"{name}_id" in wprops)
        ):
            continue

        f = {"name": name}
        fk = unwrap_fk(rnode) or unwrap_fk(wnode)
        enum = read_enum(rnode) or read_enum(wnode)
        nullable = bool(node.get("nullable")) or bool((wnode or {}).get("nullable"))
        writable = name in wprops
        required = name in wreq
        read_only = bool(node.get("readOnly")) or (name in COMPUTED and not writable)

        if fk:
            f["kind"] = "fk"
            f["type"] = "integer (fk)"
            f["references"] = fk
        elif node.get("type") == "array" or (wnode or {}).get("type") == "array":
            arr = node if node.get("type") == "array" else wnode
            item_ref = ref_name(arr.get("items", {}))
            item_schema = S.get(item_ref, {}) if item_ref else {}
            item_has_id = "id" in item_schema.get("properties", {})
            target = model_of(item_ref) if item_ref else None
            if target and item_has_id:
                # genuine related table (item carries its own id)
                target = MODEL_ALIAS.get(target, target)
                f["kind"] = "m2m"
                f["type"] = "m2m"
                f["references"] = "Tag" if target.lower() == "tag" else target
            elif item_ref:
                # array of embedded value-objects (e.g. VLAN id-ranges, port
                # position mappings, polymorphic cable terminations) -> JSON column
                f["kind"] = "embedded"
                f["type"] = f"json (array<{item_ref}>)"
            else:
                f["kind"] = "array"
                f["type"] = f"array<{scalar_type(arr.get('items', {}))}>"
        elif enum is not None:
            f["kind"] = "enum"
            f["type"] = "enum"
            f["enum"] = enum
            labels = enum_labels(rnode, wnode)
            if labels:
                f["enum_labels"] = labels
        elif name.endswith("_type") and (f"{name[:-5]}_id" in wprops or f"{name[:-5]}" in rprops):
            # ContentType half of a generic relation
            f["kind"] = "generic_type"
            f["type"] = "string (content-type)"
        elif name.endswith("_id") and (f"{name[:-3]}_type" in wprops):
            f["kind"] = "generic_id"
            f["type"] = "integer"
        elif node.get("type"):
            f["kind"] = "scalar"
            f["type"] = scalar_type(node)
        else:
            # no type, ref, or enum, and persisted -> opaque JSON (custom_fields,
            # local_context_data, etc.)
            f["kind"] = "json"
            f["type"] = "json"

        f["nullable"] = nullable
        f["required_on_create"] = required
        f["writable"] = writable
        f["read_only"] = read_only
        ml = node.get("maxLength") or (wnode or {}).get("maxLength")
        if ml:
            f["max_length"] = ml
        if name == "slug":
            f["unique"] = True
        desc = node.get("description") or (wnode or {}).get("description")
        if desc:
            f["description"] = desc.split("\n")[0][:120]
        fields.append(f)
    return fields


for ent in entities.values():
    ent["fields"] = build_fields(ent)

# ---- paas2box extensions ----------------------------------------------------
# Extra fields added to core entities beyond the NetBox spec. Inserted after the
# named anchor field (or appended). Keeps the data model reproducible across regens.
EXTRA_FIELDS = {
    "ipam/ip-ranges": [
        (
            "end_address",  # insert after this field
            {
                "name": "gateway",
                "kind": "scalar",
                "type": "string",
                "nullable": True,
                "required_on_create": False,
                "writable": True,
                "read_only": False,
                "paas2box_extra": True,
            },
        ),
        (
            "gateway",  # insert after gateway
            {
                "name": "dhcp_relays",
                "kind": "scalar",
                "type": "json",  # JSON array of IP strings
                "nullable": True,
                "required_on_create": False,
                "writable": True,
                "read_only": False,
                "paas2box_extra": True,
            },
        ),
    ],
}
for key, extras in EXTRA_FIELDS.items():
    ent = entities.get(key)
    if not ent:
        continue
    for anchor, field in extras:
        if any(f["name"] == field["name"] for f in ent["fields"]):
            continue
        idx = next((i for i, f in enumerate(ent["fields"]) if f["name"] == anchor), None)
        if idx is None:
            ent["fields"].append(field)
        else:
            ent["fields"].insert(idx + 1, field)

# ---- external entities ------------------------------------------------------
# FK/M2M targets that live in other NetBox apps. Per project decision:
#   * "full"  -> Tag, Tenant, TenantGroup, Owner, OwnerGroup (extracted from the
#                full NetBox schema, same way as core entities)
#   * "stub"  -> User, ConfigTemplate, L2VPNTermination, WirelessLAN, WirelessLink
#                (minimal tables, enough to satisfy the FK; flesh out later)
# The extracted "full" definitions are cached to datamodel/external-entities.json
# so regeneration does not require the 11 MB full spec to be present.
EXTERNAL_FULL = {  # model -> (section, endpoint)
    "extras/tags": ("extras", "/api/extras/tags/"),
    "tenancy/tenants": ("tenancy", "/api/tenancy/tenants/"),
    "tenancy/tenant-groups": ("tenancy", "/api/tenancy/tenant-groups/"),
    "users/owners": ("users", "/api/users/owners/"),
    "users/owner-groups": ("users", "/api/users/owner-groups/"),
}
EXT_CACHE = os.path.join(ROOT, "datamodel", "external-entities.json")
FULL_SPEC = os.environ.get("NETBOX_FULL_SPEC", "/tmp/nb_schema.json")


def extract_external_full():
    """Extract the 'full' external entities from the full NetBox spec."""
    full = json.load(open(FULL_SPEC))
    fs = full["components"]["schemas"]
    out = {}
    for key, (section, path) in EXTERNAL_FULL.items():
        methods = full["paths"][path]
        read = schema_from_response(methods.get("get", {}), fs)
        write = schema_from_request(methods.get("post", {}))
        ent = {
            "section": section,
            "endpoint": path,
            "read_schema": read,
            "write_schema": write,
            "model": model_of(read),
            "origin": "external-full",
        }
        ent["fields"] = build_fields(ent, fs)
        out[key] = ent
    return out


if os.path.exists(FULL_SPEC):
    external_full = extract_external_full()
    with open(EXT_CACHE, "w") as f:
        json.dump(external_full, f, indent=2)
elif os.path.exists(EXT_CACHE):
    external_full = json.load(open(EXT_CACHE))
else:
    external_full = {}
    print(
        f"WARNING: no full spec at {FULL_SPEC} and no cache at {EXT_CACHE}; "
        "external-full entities omitted",
        file=sys.stderr,
    )
entities.update(external_full)


# Hand-coded minimal stub entities (enough to be valid FK targets).
def col(name, typ, kind="scalar", **kw):
    f = {
        "name": name,
        "type": typ,
        "kind": kind,
        "nullable": kw.get("nullable", False),
        "required_on_create": kw.get("required", False),
        "writable": kw.get("writable", True),
        "read_only": kw.get("read_only", False),
    }
    f.update(
        {
            k: v
            for k, v in kw.items()
            if k in ("references", "enum", "max_length", "unique", "description")
        }
    )
    return f


STUBS = {
    "users/users": {
        "section": "users",
        "model": "User",
        "endpoint": "/api/users/users/",
        "fields": [
            col("username", "string(150)", max_length=150, required=True, unique=True),
            col("email", "string(254)", max_length=254, nullable=True),
            col("first_name", "string(150)", max_length=150, nullable=True),
            col("last_name", "string(150)", max_length=150, nullable=True),
            col("is_active", "boolean"),
            col("is_staff", "boolean"),
            col("date_joined", "datetime", nullable=True),
        ],
    },
    "users/groups": {
        "section": "users",
        "model": "Group",
        "endpoint": "/api/users/groups/",
        "fields": [
            col("name", "string(150)", max_length=150, required=True, unique=True),
        ],
    },
    "extras/config-templates": {
        "section": "extras",
        "model": "ConfigTemplate",
        "endpoint": "/api/extras/config-templates/",
        "fields": [
            col("name", "string(100)", max_length=100, required=True, unique=True),
            col("description", "string(200)", max_length=200, nullable=True),
            col("template_code", "string", "scalar", nullable=True),
        ],
    },
    "vpn/l2vpn-terminations": {
        "section": "vpn",
        "model": "L2VPNTermination",
        "endpoint": "/api/vpn/l2vpn-terminations/",
        "fields": [
            col(
                "l2vpn_id",
                "integer",
                "generic_id",
                nullable=True,
                description="FK to L2VPN (vpn app) — stubbed",
            ),
            col("assigned_object_type", "string (content-type)", "generic_type", nullable=True),
            col("assigned_object_id", "integer", "generic_id", nullable=True),
        ],
    },
    "wireless/wireless-lans": {
        "section": "wireless",
        "model": "WirelessLAN",
        "endpoint": "/api/wireless/wireless-lans/",
        "fields": [
            col("ssid", "string(32)", max_length=32, required=True),
            col("description", "string(200)", max_length=200, nullable=True),
        ],
    },
    "wireless/wireless-links": {
        "section": "wireless",
        "model": "WirelessLink",
        "endpoint": "/api/wireless/wireless-links/",
        "fields": [
            col("ssid", "string(32)", max_length=32, nullable=True),
            col("description", "string(200)", max_length=200, nullable=True),
        ],
    },
}
for key, ent in STUBS.items():
    ent.setdefault("read_schema", None)
    ent.setdefault("write_schema", None)
    ent["origin"] = "external-stub"
    entities[key] = ent

# ---- enum registry (dedup by value set) ------------------------------------
enum_registry = {}  # entity.field -> values
for ent in entities.values():
    for f in ent["fields"]:
        if f["kind"] == "enum":
            enum_registry[f"{ent['model']}.{f['name']}"] = f["enum"]


# ---- M2M relations + content types ------------------------------------------
# Computed once here so build_schema.py (join tables) and the TS generator
# (runtime metadata) consume identical, canonicalized definitions.
def _snake(name):
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name).lower()


_model_table = {e["model"]: f"{e['section']}_{_snake(e['model'])}" for e in entities.values()}

# All writable, non-tag M2M fields: (model, field, target_model)
_m2m_fields = []
for ent in entities.values():
    for f in ent["fields"]:
        if (
            f["kind"] == "m2m"
            and not f["read_only"]
            and f.get("references")
            and f["references"] != "Tag"
            and f["references"] in _model_table
        ):
            _m2m_fields.append((ent["model"], f["name"], f["references"]))
_targets_by_model = {}
for m, fn, t in _m2m_fields:
    _targets_by_model.setdefault(m, {})[t] = fn  # model -> {target: field}


def _relation(model, field, target):
    """Resolve join-table + columns, canonicalizing bidirectional pairs so both
    sides share one through table (e.g. ASN.sites / Site.asns -> ipam_asn_sites)."""
    self_col, tgt_col = f"{model.lower()}_id", f"{_snake(target)}_id"
    bidirectional = model in _targets_by_model.get(target, {})
    if bidirectional:
        canonical_model = min(model, target)
        canonical = model == canonical_model
        if canonical:
            join_table = f"{_model_table[model]}_{_snake(field)}"
        else:
            partner_field = _targets_by_model[target][model]
            join_table = f"{_model_table[target]}_{_snake(partner_field)}"
    else:
        canonical = True
        join_table = f"{_model_table[model]}_{_snake(field)}"
        if self_col == tgt_col:
            tgt_col = tgt_col[:-3] + "2_id"
    return {
        "name": field,
        "kind": "m2m",
        "target": target,
        "target_table": _model_table[target],
        "self_table": _model_table[model],
        "join_table": join_table,
        "self_column": self_col,
        "target_column": tgt_col,
        "canonical": canonical,
    }


# Reverse-FK index: model -> [(table, fk_column, referencing_model)] for resolving
# `*_count` read-schema fields to a real GROUP BY.
_reverse_fk = {}
for ent in entities.values():
    for f in ent["fields"]:
        if f["kind"] == "fk" and f.get("references"):
            _reverse_fk.setdefault(f["references"], []).append(
                (_model_table[ent["model"]], f["name"] + "_id", ent["model"])
            )


def _counts_for(ent):
    """Resolve `<x>_count` properties of the read schema to (name, table, column)
    where some model <x> has a direct FK back to this entity."""
    rs = ent.get("read_schema")
    props = schemas.get(rs, {}).get("properties", {}) if rs else {}
    refs = _reverse_fk.get(ent["model"], [])
    out = []
    for name in props:
        if not name.endswith("_count"):
            continue
        base = name[: -len("_count")]
        matches = [(t, c) for (t, c, m) in refs if m.lower() == base or _snake(m) == base]
        if len(matches) == 1:  # unambiguous reverse FK
            out.append({"name": name, "table": matches[0][0], "column": matches[0][1]})
    return out


for ent in entities.values():
    rels = []
    has_tags = any(f["name"] == "tags" and f["kind"] == "m2m" for f in ent["fields"])
    if has_tags:
        rels.append(
            {"name": "tags", "kind": "tags", "target": "Tag", "target_table": _model_table["Tag"]}
        )
    for f in ent["fields"]:
        if (
            f["kind"] == "m2m"
            and not f["read_only"]
            and f.get("references")
            and f["references"] != "Tag"
            and f["references"] in _model_table
        ):
            rels.append(_relation(ent["model"], f["name"], f["references"]))
    ent["object_type"] = f"{ent['section']}.{ent['model'].lower()}"
    ent["relations"] = rels
    ent["counts"] = _counts_for(ent)

# ---- emit JSON --------------------------------------------------------------
out = {
    "source": spec["info"].get("version"),
    "generated_from": "openapi/netbox-dcim-ipam-virt.openapi.json",
    "entities": entities,
}
os.makedirs(os.path.join(ROOT, "datamodel"), exist_ok=True)
with open(os.path.join(ROOT, "datamodel", "data-model.json"), "w") as f:
    json.dump(out, f, indent=2)


# ---- internal vs. external referenced entities ------------------------------
def snake(name):
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    return s.lower()


internal_models = {e["model"] for e in entities.values()}
model_table = {e["model"]: f"{e['section']}_{snake(e['model'])}" for e in entities.values()}

# Map every referenced model -> the table it should point at (internal) or note external.
referenced = {}  # model -> set of (entity_model, field)
for ent in entities.values():
    for f in ent["fields"]:
        if f["kind"] in ("fk", "m2m") and f.get("references"):
            referenced.setdefault(f["references"], set()).add((ent["model"], f["name"]))
external_models = sorted(m for m in referenced if m not in internal_models)

# ---- emit Markdown ----------------------------------------------------------
SECTION_TITLES = {
    "dcim": "DCIM — Devices & Physical Infrastructure",
    "ipam": "IPAM — IP Address Management",
    "virtualization": "Virtualization",
    "extras": "Extras (external)",
    "tenancy": "Tenancy (external)",
    "users": "Users (external)",
    "vpn": "VPN (external, stub)",
    "wireless": "Wireless (external, stub)",
}
CORE_SECTIONS = ("dcim", "ipam", "virtualization")
EXT_SECTIONS = ("extras", "tenancy", "users", "vpn", "wireless")


def md_table(ent):
    lines = [
        "| Field | Type | Null | Req | RO | Relationship / Notes |",
        "|-------|------|:----:|:---:|:--:|----------------------|",
    ]
    for f in ent["fields"]:
        rel = ""
        if f["kind"] == "fk":
            rel = f"→ **{f['references']}** (FK)"
        elif f["kind"] == "m2m":
            rel = f"⇄ **{f['references']}** (M2M)"
        elif f["kind"] == "enum":
            rel = "enum: " + ", ".join(f"`{v}`" for v in f["enum"][:8])
            if len(f["enum"]) > 8:
                rel += ", …"
        elif f["kind"] in ("generic_type", "generic_id"):
            rel = "generic relation (content-type + id)"
        elif f["kind"] == "embedded":
            rel = "embedded value-objects (store as JSON)"
            if f.get("description"):
                rel += " · " + f["description"]
        elif f.get("description"):
            rel = f["description"]
        if f.get("unique"):
            rel = (rel + " · unique").strip(" ·")
        null = "✓" if f["nullable"] else ""
        req = "✓" if f["required_on_create"] else ""
        ro = "✓" if f["read_only"] else ""
        lines.append(f"| `{f['name']}` | {f['type']} | {null} | {req} | {ro} | {rel} |")
    return "\n".join(lines)


md = []
md.append("# NetBox-Compatible Data Model (DCIM · IPAM · Virtualization)\n")
md.append(
    f"Derived from `openapi/netbox-dcim-ipam-virt.openapi.json` "
    f"(NetBox **{spec['info'].get('version')}**).\n"
)
md.append(
    "Each entity below maps to one API collection endpoint and is intended as a "
    "database table. Legend: **Null** = column nullable · **Req** = required on "
    "create · **RO** = read-only / server-managed (auto PK, timestamps, computed).\n"
)
md.append(
    "> Foreign keys (`→`) are stored as the referenced row's integer `id`. "
    "Many-to-many (`⇄`) relations need a join table. `slug` columns are unique. "
    "Other unique constraints (e.g. `name` scoped to a parent) follow NetBox's "
    "models and are noted where derivable.\n"
)

# stats
total_fields = sum(len(e["fields"]) for e in entities.values())
md.append(f"**{len(entities)} entities**, **{total_fields} fields** total.\n")

# Generic-relation note
md.append(
    "\n> **Generic relations.** Where NetBox uses a polymorphic FK, this model "
    "stores a pair of columns: `<rel>_type` (a content-type reference such as "
    "`dcim.interface`) plus `<rel>_id` (the target row id). Affected: "
    "`Prefix.scope_*`, `Cluster.scope_*`, `IPAddress.assigned_object_*`, "
    "`Service.*`, `FHRPGroupAssignment.*`, `MACAddress.assigned_object_*`, etc.\n"
)


def emit_section(section):
    md.append(f"\n## {SECTION_TITLES[section]}\n")
    ents = [(k, e) for k, e in entities.items() if e["section"] == section]
    md.append(f"_{len(ents)} entities._\n")
    for _key, ent in ents:
        origin = ent.get("origin", "core")
        tag = {
            "core": "",
            "external-full": " _(external, full)_",
            "external-stub": " _(external, stub)_",
        }.get(origin, "")
        md.append(f"\n### {ent['model']}{tag}\n")
        md.append(f"- **Table (suggested):** `{model_table[ent['model']]}`")
        md.append(f"- **Endpoint:** `{ent['endpoint']}`")
        rs = ent.get("read_schema") or "(hand-defined stub)"
        md.append(
            f"- **Read schema:** `{rs}` · "
            f"**Write schema:** `{ent['write_schema'] or '(read-only / stub)'}`\n"
        )
        md.append(md_table(ent))
        md.append("")


for section in CORE_SECTIONS:
    emit_section(section)

md.append("\n# External entities\n")
md.append(
    "FK/M2M targets that live in other NetBox apps. Per project scope: "
    "**Tag, Tenant, TenantGroup, Owner, OwnerGroup** are modeled fully "
    "(extracted from the full NetBox schema); **User, ConfigTemplate, "
    "L2VPNTermination, WirelessLAN, WirelessLink** are minimal stubs to be "
    "fleshed out when those subsystems are built.\n"
)
for section in EXT_SECTIONS:
    if any(e["section"] == section for e in entities.values()):
        emit_section(section)

# ---- appendix: still-unmodeled referenced entities -------------------------
md.append("\n## Appendix A — Still-unmodeled referenced entities\n")
if external_models:
    md.append("These models are still referenced but have no table yet:\n")
    md.append("| Entity | Referenced by (field count) | Example sources |")
    md.append("|--------|:---------------------------:|-----------------|")
    for m in external_models:
        srcs = sorted(referenced[m])
        ex = ", ".join(f"{s}.{fld}" for s, fld in srcs[:3])
        md.append(f"| **{m}** | {len(srcs)} | {ex}{' …' if len(srcs) > 3 else ''} |")
else:
    md.append("_None — every FK/M2M target now resolves to a table in this model._")

# ---- appendix: enums --------------------------------------------------------
md.append("\n## Appendix B — Enumerations (choice fields)\n")
md.append(
    "Suggested storage: `VARCHAR` (or small int for numeric enums) with a "
    "`CHECK` constraint. Values are the API wire values.\n"
)
for fq in sorted(enum_registry):
    vals = enum_registry[fq]
    md.append(f"- **`{fq}`** — " + ", ".join(f"`{v}`" for v in vals))

with open(os.path.join(ROOT, "datamodel", "DATA-MODEL.md"), "w") as f:
    f.write("\n".join(md))

# DDL (sqlite + mariadb) is generated by build_schema.py from data-model.json.

print(f"entities: {len(entities)}")
print(f"fields:   {total_fields}")
print(f"enums:    {len(enum_registry)}")
print(f"external referenced entities: {len(external_models)} -> {external_models}")
unknown = [
    (k, fld["name"])
    for k, e in entities.items()
    for fld in e["fields"]
    if "unknown" in str(fld.get("type"))
]
print(f"unknown-typed fields: {len(unknown)}", unknown[:10])
missing_write = [k for k, e in entities.items() if not e["write_schema"]]
print(f"entities w/o write schema: {missing_write}")
