#!/usr/bin/env python3
"""Minimal no-ORM migration runner for paashup (SQLite + MariaDB).

Migrations are plain SQL files in this directory named:

    <version>.<dialect>.sql      e.g.  0001_initial.sqlite.sql
                                       0001_initial.mariadb.sql

`<version>` is everything before the dialect suffix. Files are applied in
ascending filename order. Applied versions are tracked in a `schema_migrations`
table so re-running only applies what's pending.

Usage:
    # SQLite (small customers)
    python migrate.py --dialect sqlite --database /path/to/paashup.db [--status]

    # MariaDB (big customers) — uses PyMySQL if installed, else the mariadb/mysql CLI
    python migrate.py --dialect mariadb --database paashup \
        --host 127.0.0.1 --port 3306 --user root --password secret

    # Just show what is applied / pending
    python migrate.py --dialect sqlite --database paashup.db --status

Environment fallbacks: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SOCKET.
"""

import argparse
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def discover(dialect):
    """Return [(version, path), ...] sorted by version for the given dialect."""
    out = []
    for path in glob.glob(os.path.join(HERE, f"*.{dialect}.sql")):
        base = os.path.basename(path)
        version = base[: -len(f".{dialect}.sql")]
        out.append((version, path))
    return sorted(out)


# --------------------------------------------------------------------- SQLite
def run_sqlite(args):
    import sqlite3

    con = sqlite3.connect(args.database)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "version TEXT PRIMARY KEY, "
        "applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
    )
    con.commit()
    applied = {r[0] for r in con.execute("SELECT version FROM schema_migrations")}
    migs = discover(args.dialect)
    if args.status:
        return report(migs, applied)
    pending = [(v, p) for v, p in migs if v not in applied]
    if not pending:
        print("Already up to date.")
        return
    for version, path in pending:
        print(f"Applying {version} ...", end=" ", flush=True)
        sql = open(path).read()
        try:
            con.executescript(sql)
            con.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
            con.commit()
            print("ok")
        except sqlite3.Error as e:
            con.rollback()
            print("FAILED")
            sys.exit(f"  {e}")
    print(f"Done. {len(pending)} migration(s) applied.")


# -------------------------------------------------------------------- MariaDB
def _maria_conn_params(args):
    return dict(
        host=args.host or os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(args.port or os.environ.get("DB_PORT", 3306)),
        user=args.user or os.environ.get("DB_USER", "root"),
        password=args.password or os.environ.get("DB_PASSWORD", ""),
        database=args.database or os.environ.get("DB_NAME"),
        socket=args.socket or os.environ.get("DB_SOCKET"),
    )


def run_mariadb(args):
    p = _maria_conn_params(args)
    try:
        import pymysql  # optional, cleaner path

        driver = "pymysql"
    except ImportError:
        driver = "cli"

    def ensure_and_applied():
        ddl = (
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version VARCHAR(255) PRIMARY KEY, "
            "applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
        )
        if driver == "pymysql":
            cn = pymysql.connect(
                host=p["host"],
                port=p["port"],
                user=p["user"],
                password=p["password"],
                database=p["database"],
                unix_socket=p["socket"],
            )
            with cn.cursor() as c:
                c.execute(ddl)
                c.execute("SELECT version FROM schema_migrations")
                applied = {r[0] for r in c.fetchall()}
            cn.commit()
            cn.close()
            return applied
        else:
            _cli_exec(p, ddl)
            out = _cli_query(p, "SELECT version FROM schema_migrations")
            return set(filter(None, out.splitlines()))

    applied = ensure_and_applied()
    migs = discover(args.dialect)
    if args.status:
        return report(migs, applied)
    pending = [(v, pth) for v, pth in migs if v not in applied]
    if not pending:
        print("Already up to date.")
        return
    for version, path in pending:
        print(f"Applying {version} ...", end=" ", flush=True)
        sql = open(path).read()
        try:
            if driver == "pymysql":
                cn = pymysql.connect(
                    host=p["host"],
                    port=p["port"],
                    user=p["user"],
                    password=p["password"],
                    database=p["database"],
                    unix_socket=p["socket"],
                    autocommit=True,
                )
                with cn.cursor() as c:
                    for stmt in _split_statements(sql):
                        c.execute(stmt)
                    c.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
                cn.close()
            else:
                _cli_exec(p, sql)
                _cli_exec(p, f"INSERT INTO schema_migrations (version) VALUES ('{version}');")
            print("ok")
        except Exception as e:
            print("FAILED")
            sys.exit(f"  {e}")
    print(f"Done. {len(pending)} migration(s) applied via {driver}.")


def _cli_base(p):
    exe = "mariadb" if _which("mariadb") else "mysql"
    cmd = [exe, f"-h{p['host']}", f"-P{str(p['port'])}", f"-u{p['user']}"]
    if p["password"]:
        cmd.append(f"-p{p['password']}")
    if p["socket"]:
        cmd.append(f"--socket={p['socket']}")
    cmd.append(p["database"])
    return cmd


def _cli_exec(p, sql):
    r = subprocess.run(_cli_base(p), input=sql, text=True, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "mariadb client failed")


def _cli_query(p, sql):
    r = subprocess.run(_cli_base(p) + ["-N", "-e", sql], text=True, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout


def _which(name):
    return any(
        os.access(os.path.join(d, name), os.X_OK)
        for d in os.environ.get("PATH", "").split(os.pathsep)
    )


def _split_statements(sql):
    """Naive splitter for PyMySQL (no procedures/triggers in our schema)."""
    out, buf = [], []
    for line in sql.splitlines():
        s = line.strip()
        if not s or s.startswith("--"):
            continue
        buf.append(line)
        if s.endswith(";"):
            out.append("\n".join(buf).rstrip().rstrip(";"))
            buf = []
    if buf:
        out.append("\n".join(buf))
    return [s for s in out if s.strip()]


def report(migs, applied):
    print(f"{'VERSION':<28} STATUS")
    for v, _ in migs:
        print(f"{v:<28} {'applied' if v in applied else 'pending'}")
    pend = [v for v, _ in migs if v not in applied]
    print(f"\n{len(applied)} applied, {len(pend)} pending.")


def main():
    ap = argparse.ArgumentParser(description="paashup no-ORM migration runner")
    ap.add_argument("--dialect", required=True, choices=["sqlite", "mariadb"])
    ap.add_argument("--database", help="sqlite file path, or mariadb database name")
    ap.add_argument("--status", action="store_true", help="show applied/pending and exit")
    ap.add_argument("--host")
    ap.add_argument("--port")
    ap.add_argument("--user")
    ap.add_argument("--password")
    ap.add_argument("--socket")
    args = ap.parse_args()
    if not args.database and args.dialect == "sqlite":
        ap.error("--database (sqlite file path) is required")
    (run_sqlite if args.dialect == "sqlite" else run_mariadb)(args)


if __name__ == "__main__":
    main()
