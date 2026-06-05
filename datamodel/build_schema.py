#!/usr/bin/env python3
"""Generate SQLite + MariaDB DDL from data-model.json (no ORM).

Single source of truth -> two dialects, always in sync. Emits:
  datamodel/sql/schema.sqlite.sql
  datamodel/sql/schema.mariadb.sql
  migrations/0001_initial.sqlite.sql   (identical to the schema file)
  migrations/0001_initial.mariadb.sql

Handles: per-dialect column types, auto-increment PK, FK constraints, generic
(polymorphic) relations as <rel>_type/<rel>_id, M2M join tables, a shared
polymorphic tagging table, enum CHECK constraints, and NetBox's unique
constraints (field-level, composite, case-insensitive, and partial) from
netbox-constraints.json.
"""
import json, os, re, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = json.load(open(os.path.join(ROOT, 'datamodel', 'data-model.json')))
CONSTRAINTS = json.load(open(os.path.join(ROOT, 'datamodel', 'netbox-constraints.json')))
ENTITIES = MODEL['entities']

# computed/server-managed columns that are not persisted (except timestamps)
COMPUTED = {'url', 'display', 'display_url', 'id', '_depth', 'family', 'children',
            'depth', 'device_count', 'prefix_count', 'vlan_count', 'rack_count',
            'ipaddress_count', 'virtualmachine_count', 'allocated_vcpus',
            'allocated_memory', 'allocated_disk', 'cable_count', 'tenant_count',
            'circuit_count', 'site_count', 'vrf_count', 'cluster_count',
            'tagged_items', 'permissions', 'groups'}
TIMESTAMPS = ('created', 'last_updated')

def snake(name):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', name).lower()

MODEL_TABLE = {e['model']: f"{e['section']}_{snake(e['model'])}" for e in ENTITIES.values()}

# ---------------------------------------------------------------- dialects ----
class Dialect:
    name = ''
    def pk(self): ...
    def coltype(self, f): ...
    def table_suffix(self): return ''
    def header(self): return ''
    def footer(self): return ''
    def autoinc_note(self): return ''

class SQLite(Dialect):
    name = 'sqlite'
    def pk(self):
        return "id INTEGER PRIMARY KEY AUTOINCREMENT"
    def header(self):
        return ("PRAGMA foreign_keys = ON;\n\nBEGIN;\n")
    def footer(self):
        return "\nCOMMIT;\n"
    def coltype(self, f):
        k, t = f['kind'], f['type']
        if k in ('fk', 'generic_id'):
            return 'INTEGER'
        if k == 'enum':
            return 'INTEGER' if all(isinstance(v, int) for v in f['enum']) else 'TEXT'
        if t == 'boolean':
            return 'INTEGER'
        if t in ('integer', 'bigint'):
            return 'INTEGER'
        if t in ('decimal', 'number'):
            return 'NUMERIC'
        # strings, uuid, datetime, date, json, content-type, arrays -> TEXT affinity
        return 'TEXT'
    def now_default(self):
        return "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"

class MariaDB(Dialect):
    name = 'mariadb'
    def pk(self):
        return "id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY"
    def header(self):
        return ("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n")
    def footer(self):
        return "\nSET FOREIGN_KEY_CHECKS = 1;\n"
    def table_suffix(self):
        return " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    def coltype(self, f):
        k, t = f['kind'], f['type']
        if k in ('fk', 'generic_id'):
            return 'BIGINT'
        if k == 'enum':
            if all(isinstance(v, int) for v in f['enum']):
                return 'INT'
            n = max((len(str(v)) for v in f['enum']), default=50)
            return f'VARCHAR({max(n, 32)})'
        if t == 'boolean':
            return 'TINYINT(1)'
        if t == 'integer':
            return 'INT'
        if t == 'bigint':
            return 'BIGINT'
        if t in ('decimal', 'number'):
            return 'DECIMAL(20,6)'
        if t == 'uuid':
            return 'CHAR(36)'
        if t == 'datetime':
            return 'DATETIME(6)'
        if t == 'date':
            return 'DATE'
        if t.startswith('json') or t.startswith('array'):
            return 'JSON'
        if t == 'string (content-type)':
            return 'VARCHAR(100)'
        if t == 'string(uri)':
            return 'VARCHAR(500)'
        if t.startswith('string('):
            return 'VARCHAR(' + t[len('string('):-1] + ')'
        return 'TEXT'      # unbounded string -> TEXT
    def now_default(self):
        return "DEFAULT CURRENT_TIMESTAMP(6)"

# ------------------------------------------------------------- helpers --------
def persisted_fields(ent):
    """Yield (field, column_name) for columns we actually create."""
    for f in ent['fields']:
        name = f['name']
        if f['kind'] == 'm2m':
            continue                       # join tables
        if name in COMPUTED:
            continue
        if f['read_only'] and name not in TIMESTAMPS:
            continue
        col = name + '_id' if f['kind'] == 'fk' else name
        yield f, col

def field_map(ent):
    return {f['name']: f for f in ent['fields']}

def persisted_cols(ent):
    return {col for _, col in persisted_fields(ent)}

def db_column(ent, django_field):
    """Map a NetBox model field name to our DB column, or None if not persisted."""
    fm = field_map(ent)
    f = fm.get(django_field)
    if f is None:
        return None
    col = django_field + '_id' if f['kind'] == 'fk' else django_field
    return col if col in persisted_cols(ent) else None

def not_null(f):
    return f['required_on_create'] and not f['nullable']

# ------------------------------------------------------------- table DDL ------
def create_table(ent, d):
    table = MODEL_TABLE[ent['model']]
    lines = [f"    {d.pk()}"]
    fks = []
    for f, col in persisted_fields(ent):
        typ = d.coltype(f)
        parts = [f"    {col}", typ]
        if not_null(f):
            parts.append('NOT NULL')
        if f['name'] in TIMESTAMPS:
            parts.append(d.now_default())
            if f['name'] == 'last_updated' and d.name == 'mariadb':
                parts.append('ON UPDATE CURRENT_TIMESTAMP(6)')
        elif f['type'] == 'boolean':
            parts.append('DEFAULT 0')
        line = ' '.join(parts)
        # enum CHECK (textual enums only; numeric handled by INT type)
        if f['kind'] == 'enum' and not all(isinstance(v, int) for v in f['enum']):
            vals = ', '.join("'" + str(v).replace("'", "''") + "'" for v in f['enum'])
            line += f" CHECK ({col} IN ({vals}))"
        lines.append(line)
        # real FK (not polymorphic generic_id)
        if f['kind'] == 'fk' and f.get('references') in MODEL_TABLE:
            tgt = MODEL_TABLE[f['references']]
            on_del = 'SET NULL' if f['nullable'] else 'RESTRICT'
            fks.append(f"    FOREIGN KEY ({col}) REFERENCES {tgt}(id) ON DELETE {on_del}")
    all_lines = lines + fks
    body = ',\n'.join(all_lines)
    return f"CREATE TABLE {table} (\n{body}\n){d.table_suffix()};\n"

# ------------------------------------------------------------- M2M ------------
def m2m_join_tables(d):
    """Join tables for writable (non-tag) M2M relations, from the precomputed,
    canonicalized relation definitions (bidirectional pairs share one table)."""
    out = []
    intt = 'INTEGER' if d.name == 'sqlite' else 'BIGINT'
    for ent in ENTITIES.values():
        for rel in ent.get('relations', []):
            if rel['kind'] != 'm2m' or not rel.get('canonical'):
                continue
            jt, a, b = rel['join_table'], rel['self_column'], rel['target_column']
            out.append(
                f"CREATE TABLE {jt} (\n"
                f"    {d.pk()},\n"
                f"    {a} {intt} NOT NULL,\n"
                f"    {b} {intt} NOT NULL,\n"
                f"    FOREIGN KEY ({a}) REFERENCES {rel['self_table']}(id) ON DELETE CASCADE,\n"
                f"    FOREIGN KEY ({b}) REFERENCES {rel['target_table']}(id) ON DELETE CASCADE,\n"
                f"    UNIQUE ({a}, {b})\n"
                f"){d.table_suffix()};\n")
    return out

def tagging_table(d):
    """Single polymorphic tag join table (NetBox-style generic tagging)."""
    intt = 'INTEGER' if d.name == 'sqlite' else 'BIGINT'
    return (
        "-- Polymorphic tagging: links any row (object_type + object_id) to a tag.\n"
        f"CREATE TABLE tagging_taggeditem (\n"
        f"    {d.pk()},\n"
        f"    tag_id {intt} NOT NULL,\n"
        f"    object_type VARCHAR(100) NOT NULL,\n"
        f"    object_id {intt} NOT NULL,\n"
        f"    FOREIGN KEY (tag_id) REFERENCES {MODEL_TABLE['Tag']}(id) ON DELETE CASCADE,\n"
        f"    UNIQUE (tag_id, object_type, object_id)\n"
        f"){d.table_suffix()};\n")

# ------------------------------------------------------------- unique idx -----
def unique_indexes(d):
    """Field-level + composite + partial unique constraints from NetBox."""
    out = []
    notes = []
    used = set()
    def uniq_name(base):
        # MariaDB caps identifiers at 64 chars; shorten deterministically.
        if len(base) > 64:
            h = hashlib.md5(base.encode()).hexdigest()[:6]
            base = base[:57] + '_' + h
        name = base
        i = 2
        while name in used:
            suffix = f"_{i}"
            name = base[:64 - len(suffix)] + suffix
            i += 1
        used.add(name)
        return name
    for ent in ENTITIES.values():
        model = ent['model']
        table = MODEL_TABLE[model]
        cons = CONSTRAINTS.get(model, {})
        fm = field_map(ent)
        # single-column uniques: NetBox field-level unique ∪ slug heuristic
        singles = set(cons.get('unique_fields', []))
        singles |= {f['name'] for f in ent['fields'] if f.get('unique')}
        for col in sorted(singles):
            dbcol = db_column(ent, col)
            if not dbcol:
                continue
            name = uniq_name(f"uq_{table}_{col}")
            out.append(f"CREATE UNIQUE INDEX {name} ON {table} ({dbcol});")
        # composite / functional / partial
        for i, c in enumerate(cons.get('unique_constraints', [])):
            cols = c['columns']
            dbcols, missing = [], False
            for col in cols:
                dc = db_column(ent, col)
                if dc is None:
                    missing = True
                    break
                dbcols.append((col, dc))
            if missing:
                notes.append(f"-- SKIP unique on {table} ({', '.join(cols)}): "
                             f"column not present in model")
                continue
            base = f"uq_{table}_" + '_'.join(dc for _, dc in dbcols)
            if c.get('partial'):
                base += '_partial'
            name = uniq_name(base)
            lower = set(c.get('lower') or [])
            # build column expressions
            def expr(col, dc):
                if d.name == 'sqlite' and col in lower:
                    return f"lower({dc})"
                return dc            # mariadb ci collation handles case-insensitivity
            exprs = ', '.join(expr(col, dc) for col, dc in dbcols)
            where = ''
            if c.get('partial'):
                if d.name == 'sqlite' and c.get('cond_field'):
                    cond_col = db_column(ent, c['cond_field']) or c['cond_field']
                    where = f" WHERE {cond_col} {c['cond_op']}"
                else:
                    # MariaDB has no partial indexes -> enforce in application layer
                    notes.append(
                        f"-- APP-ENFORCED unique on {table} ({', '.join(dc for _,dc in dbcols)}) "
                        f"WHERE {c.get('cond_field')} {c.get('cond_op')} "
                        f"(partial index unsupported in MariaDB)")
                    continue
            out.append(f"CREATE UNIQUE INDEX {name} ON {table} ({exprs}){where};")
    return out, notes

# ------------------------------------------------------------- assemble -------
def build(d):
    parts = [
        f"-- paasbox initial schema ({d.name}) — generated from data-model.json",
        f"-- NetBox {MODEL.get('source')} compatible. Do not edit by hand; "
        f"run datamodel/build_schema.py.",
        d.header(),
    ]
    parts.append("-- ===== Entity tables =====")
    for ent in ENTITIES.values():
        parts.append(create_table(ent, d))
    parts.append("-- ===== Polymorphic tagging =====")
    parts.append(tagging_table(d))
    parts.append("-- ===== M2M join tables =====")
    parts.extend(m2m_join_tables(d))
    parts.append("\n-- ===== Unique constraints (indexes) =====")
    idx, notes = unique_indexes(d)
    parts.extend(idx)
    if notes:
        parts.append("\n-- ----- constraints enforced in the application layer -----")
        parts.extend(notes)
    parts.append(d.footer())
    return '\n'.join(parts)

def main():
    os.makedirs(os.path.join(ROOT, 'datamodel', 'sql'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'migrations'), exist_ok=True)
    for d in (SQLite(), MariaDB()):
        sql = build(d)
        for path in (os.path.join(ROOT, 'datamodel', 'sql', f'schema.{d.name}.sql'),
                     os.path.join(ROOT, 'migrations', f'0001_initial.{d.name}.sql')):
            with open(path, 'w') as f:
                f.write(sql)
        ntab = sql.count('CREATE TABLE')
        nidx = sql.count('CREATE UNIQUE INDEX')
        print(f"{d.name}: {ntab} tables, {nidx} unique indexes")

if __name__ == '__main__':
    main()
