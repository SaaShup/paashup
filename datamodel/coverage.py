#!/usr/bin/env python3
"""Report which OpenAPI read-schema fields the API does NOT yet emit, per entity.

Static analysis: compares each entity's read-schema `properties` against the field
set the serializer produces (columns + relations + counts + generic accessors +
computed family/children/_depth + id/url/display/display_url). Useful for tracking
NetBox response conformance over time.
"""
import json, os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = json.load(open(os.path.join(ROOT, 'openapi', 'netbox-dcim-ipam-virt.openapi.json')))
schemas = spec['components']['schemas']
dm = json.load(open(os.path.join(ROOT, 'datamodel', 'data-model.json')))['entities']

COMPUTED_COLS = {'url', 'display', 'display_url', 'id', '_depth', 'family', 'children',
    'depth', 'tagged_items', 'permissions', 'groups'}

def emitted(ent):
    out = {'id', 'url', 'display', 'display_url'}
    for f in ent['fields']:
        if f['kind'] == 'm2m' or f['name'] in COMPUTED_COLS:
            continue
        if f['read_only'] and f['name'] not in ('created', 'last_updated'):
            continue
        out.add(f['name'])
        if f['kind'] == 'generic_type':
            out.add(f['name'][:-len('_type')])
    for r in ent.get('relations', []):
        out.add(r['name'])
    for c in ent.get('counts', []):
        out.add(c['name'])
    if any(f['name'] in ('prefix', 'address', 'start_address') for f in ent['fields']):
        out.add('family')
    if any(f['name'] == 'parent' and f.get('references') == ent['model'] for f in ent['fields']):
        out.update({'children', '_depth'})
    return out

hist = Counter()
per_entity = {}
for ent in dm.values():
    rs = ent.get('read_schema')
    if not rs or rs not in schemas:
        continue
    missing = sorted(set(schemas[rs].get('properties', {})) - emitted(ent))
    if missing:
        per_entity[ent['model']] = missing
        hist.update(missing)

clean = len(dm) - len(per_entity)
print(f"fully field-conformant entities: {clean}/{len(dm)}")
print(f"entities with gaps: {len(per_entity)} | total missing-field instances: {sum(len(v) for v in per_entity.values())}\n")
print("most-missing fields:")
for name, cnt in hist.most_common(25):
    print(f"  {cnt:3d}  {name}")
if __name__ == '__main__' and os.environ.get('VERBOSE'):
    print("\nper-entity:")
    for m, fields in sorted(per_entity.items()):
        print(f"  {m}: {fields}")
