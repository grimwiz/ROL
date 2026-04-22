#!/usr/bin/env python3
"""
Read-only comparison helper for Folly character sheet databases.

Usage:
  python3 scripts/compare-character-sheet-dbs.py current.db backup.db

Notes:
- SQLite will read any sibling -wal / -shm files automatically.
- The script only inspects character_sheets rows and their JSON payloads.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


def load_sheets(db_path: Path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        rows = cur.execute(
            """
            SELECT session_id, user_id, updated_at, data
            FROM character_sheets
            ORDER BY session_id, user_id
            """
        ).fetchall()
    finally:
        conn.close()

    result = {}
    for session_id, user_id, updated_at, data in rows:
        try:
            payload = json.loads(data or "{}")
        except json.JSONDecodeError:
            payload = {"__raw__": data}
        result[(session_id, user_id)] = {
            "updated_at": updated_at,
            "data": payload,
        }
    return result


def summarize_row(row):
    data = row["data"]
    return {
        "updated_at": row["updated_at"],
        "name": data.get("name"),
        "occupation": data.get("occupation"),
        "keys": sorted(data.keys()),
        "mandatory_skills": len(data.get("mandatory_skills", []) or []),
        "additional_skills": len(data.get("additional_skills", []) or []),
        "common_skills": len(data.get("common_skills", []) or []),
        "magic_spells": len(data.get("magic_spells", []) or []),
        "custom_fields": len(data.get("custom_fields", []) or []),
    }


def main(argv):
    if len(argv) != 3:
        print("Usage: python3 scripts/compare-character-sheet-dbs.py <current.db> <backup.db>")
        return 2

    current_path = Path(argv[1]).resolve()
    backup_path = Path(argv[2]).resolve()

    if not current_path.exists():
        print(f"Current DB not found: {current_path}")
        return 2
    if not backup_path.exists():
        print(f"Backup DB not found: {backup_path}")
        return 2

    current = load_sheets(current_path)
    backup = load_sheets(backup_path)

    print("Current DB:", current_path)
    print("Backup DB: ", backup_path)
    print("Current sheet rows:", len(current))
    print("Backup sheet rows: ", len(backup))
    print()

    all_keys = sorted(set(current.keys()) | set(backup.keys()))
    if not all_keys:
        print("No character_sheets rows found in either database.")
        return 0

    for key in all_keys:
        cur = current.get(key)
        bak = backup.get(key)
        print(f"=== session_id={key[0]} user_id={key[1]} ===")

        if cur is None:
            print("Only in backup:")
            print(json.dumps(summarize_row(bak), indent=2, ensure_ascii=True))
            print()
            continue

        if bak is None:
            print("Only in current:")
            print(json.dumps(summarize_row(cur), indent=2, ensure_ascii=True))
            print()
            continue

        cur_summary = summarize_row(cur)
        bak_summary = summarize_row(bak)
        print("Current summary:")
        print(json.dumps(cur_summary, indent=2, ensure_ascii=True))
        print("Backup summary:")
        print(json.dumps(bak_summary, indent=2, ensure_ascii=True))

        cur_data = cur["data"]
        bak_data = bak["data"]
        cur_keys = set(cur_data.keys())
        bak_keys = set(bak_data.keys())

        only_current = sorted(cur_keys - bak_keys)
        only_backup = sorted(bak_keys - cur_keys)
        changed = sorted(
            k for k in (cur_keys & bak_keys)
            if json.dumps(cur_data[k], sort_keys=True, ensure_ascii=True)
            != json.dumps(bak_data[k], sort_keys=True, ensure_ascii=True)
        )

        if only_current:
            print("Keys only in current:", ", ".join(only_current))
        if only_backup:
            print("Keys only in backup:", ", ".join(only_backup))
        if changed:
            print("Keys with changed values:", ", ".join(changed))
        if not only_current and not only_backup and not changed:
            print("No JSON differences.")
        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
