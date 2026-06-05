import ast
import glob
import json
import os

MODEL_DIRS = [
    "dcim/models",
    "ipam/models",
    "virtualization/models",
    "tenancy/models",
    "extras/models",
    "users/models",
]
BASE = "/tmp/netbox-src/netbox"


def str_const(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def cname(node):
    f = node.func
    return f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)


def cond_to_where(node):
    """Best-effort: Q(field__isnull=True) -> ('field IS NULL', raw). Returns (where|None, raw)."""
    try:
        raw = ast.unparse(node)
    except Exception:
        raw = "<condition>"
    # single isnull pattern
    if isinstance(node, ast.Call) and cname(node) == "Q" and len(node.keywords) == 1:
        kw = node.keywords[0]
        if kw.arg and kw.arg.endswith("__isnull") and isinstance(kw.value, ast.Constant):
            field = kw.arg[: -len("__isnull")]
            return (field, "IS NULL" if kw.value.value else "IS NOT NULL", raw)
    return (None, None, raw)


def cols_from_constraint(call):
    """Return dict(columns, lower, partial, cond_field, cond_op, cond_raw)."""
    cols, lower = [], set()
    cond_field = cond_op = cond_raw = None
    for a in call.args:
        s = str_const(a)
        if s:
            cols.append(s)
            continue
        if isinstance(a, ast.Call):
            fn = cname(a)
            inner = a.args[0] if a.args else None
            si = str_const(inner) if inner is not None else None
            if si:
                cols.append(si)
                if fn in ("Lower", "Upper"):
                    lower.add(si)
    for kw in call.keywords:
        if kw.arg == "fields":
            try:
                cols.extend(list(ast.literal_eval(kw.value)))
            except Exception:
                pass
        elif kw.arg == "condition":
            cond_field, cond_op, cond_raw = cond_to_where(kw.value)
    return {
        "columns": cols,
        "lower": sorted(lower),
        "partial": cond_raw is not None,
        "cond_field": cond_field,
        "cond_op": cond_op,
        "cond_raw": cond_raw,
    }


results = {}
for md in MODEL_DIRS:
    for path in glob.glob(os.path.join(BASE, md, "*.py")):
        try:
            tree = ast.parse(open(path).read())
        except SyntaxError:
            continue
        for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
            info = {
                "unique_fields": [],
                "unique_constraints": [],
                "file": os.path.relpath(path, BASE),
            }
            for stmt in cls.body:
                if (
                    isinstance(stmt, ast.Assign)
                    and len(stmt.targets) == 1
                    and isinstance(stmt.targets[0], ast.Name)
                ):
                    if isinstance(stmt.value, ast.Call):
                        for kw in stmt.value.keywords:
                            if (
                                kw.arg == "unique"
                                and isinstance(kw.value, ast.Constant)
                                and kw.value.value is True
                            ):
                                info["unique_fields"].append(stmt.targets[0].id)
                if isinstance(stmt, ast.ClassDef) and stmt.name == "Meta":
                    for m in stmt.body:
                        if isinstance(m, ast.Assign) and isinstance(m.targets[0], ast.Name):
                            tgt = m.targets[0].id
                            if tgt == "unique_together":
                                try:
                                    ut = ast.literal_eval(m.value)
                                    if ut and isinstance(ut[0], str):
                                        ut = [ut]
                                    for grp in ut:
                                        info["unique_constraints"].append(
                                            {
                                                "columns": list(grp),
                                                "lower": [],
                                                "partial": False,
                                                "cond_field": None,
                                                "cond_op": None,
                                                "cond_raw": None,
                                            }
                                        )
                                except Exception:
                                    pass
                            if tgt == "constraints" and isinstance(m.value, (ast.List, ast.Tuple)):
                                for el in m.value.elts:
                                    if isinstance(el, ast.Call) and cname(el) == "UniqueConstraint":
                                        c = cols_from_constraint(el)
                                        if c["columns"]:
                                            info["unique_constraints"].append(c)
            if info["unique_fields"] or info["unique_constraints"]:
                results[cls.name] = info

json.dump(results, open("/tmp/netbox_constraints.json", "w"), indent=2)
print("classes:", len(results))
tot = sum(len(v["unique_constraints"]) for v in results.values())
print(
    "unique_constraints:",
    tot,
    "| field-uniques:",
    sum(len(v["unique_fields"]) for v in results.values()),
)
for cn in ["Device", "Prefix", "IPAddress", "VLAN", "Interface", "Cluster", "VMInterface"]:
    if cn in results:
        print(f"\n{cn}: unique_fields={results[cn]['unique_fields']}")
        for c in results[cn]["unique_constraints"]:
            print(f"   {c}")
