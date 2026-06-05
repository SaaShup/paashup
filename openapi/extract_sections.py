import json, re, sys

SECTIONS = ["dcim", "ipam", "virtualization"]
PREFIXES = tuple(f"/api/{s}/" for s in SECTIONS)

with open('/tmp/nb_schema.json') as f:
    full = json.load(f)

all_schemas = full['components']['schemas']

# 1. Filter paths
kept_paths = {p: v for p, v in full['paths'].items() if p.startswith(PREFIXES)}

# 2. Collect all $ref strings within an arbitrary JSON object
def find_refs(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == '$ref' and isinstance(v, str):
                out.add(v)
            else:
                find_refs(v, out)
    elif isinstance(obj, list):
        for item in obj:
            find_refs(item, out)

# 3. Transitive closure over component schemas
SCHEMA_PREFIX = '#/components/schemas/'
needed = set()          # schema names we must keep
frontier = set()

seed = set()
find_refs(kept_paths, seed)
for r in seed:
    if r.startswith(SCHEMA_PREFIX):
        frontier.add(r[len(SCHEMA_PREFIX):])

while frontier:
    name = frontier.pop()
    if name in needed:
        continue
    needed.add(name)
    if name not in all_schemas:
        print(f"WARNING: referenced schema not found: {name}", file=sys.stderr)
        continue
    refs = set()
    find_refs(all_schemas[name], refs)
    for r in refs:
        if r.startswith(SCHEMA_PREFIX):
            n = r[len(SCHEMA_PREFIX):]
            if n not in needed:
                frontier.add(n)

kept_schemas = {n: all_schemas[n] for n in sorted(needed) if n in all_schemas}

# 4. Filter tags used by kept operations
used_tags = set()
for p, methods in kept_paths.items():
    for m, op in methods.items():
        if isinstance(op, dict) and 'tags' in op:
            used_tags.update(op['tags'])

out = {
    'openapi': full['openapi'],
    'info': {
        **full['info'],
        'title': 'NetBox-Compatible REST API (DCIM, IPAM, Virtualization)',
    },
    'paths': {p: kept_paths[p] for p in sorted(kept_paths)},
    'components': {
        'schemas': kept_schemas,
        'securitySchemes': full['components']['securitySchemes'],
    },
}
if 'servers' in full:
    out['servers'] = full['servers']
if used_tags:
    out['tags'] = [{'name': t} for t in sorted(used_tags)]

with open('/tmp/openapi_filtered.json', 'w') as f:
    json.dump(out, f, indent=2)

print(f"paths kept:   {len(kept_paths)}")
print(f"schemas kept: {len(kept_schemas)} (of {len(all_schemas)})")
print(f"tags:         {len(used_tags)}")
print(f"output size:  ", end="")
import os; print(f"{os.path.getsize('/tmp/openapi_filtered.json')/1024:.0f} KB")
