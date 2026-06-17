#!/usr/bin/env python3
"""Restore local image assets referenced by game-systems/rivers-of-london/The Domestic.md."""

from __future__ import annotations

import argparse
import html
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
DOMESTIC_MD = ROOT / "game-systems" / "rivers-of-london" / "The Domestic.md"
PRIVATE_SOURCE = ROOT / "private" / "rulebook-source"
PUBLIC_ROOT = ROOT / "game-systems" / "rivers-of-london"
IMAGE_EXTENSIONS = {".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"}


MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*]\(([^)\n]+)\)")
HTML_IMAGE_RE = re.compile(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"']", re.IGNORECASE)


def normalize_reference(raw: str) -> str | None:
    reference = html.unescape(raw.strip())
    if not reference:
        return None

    if reference.startswith("<") and ">" in reference:
        reference = reference[1 : reference.index(">")]
    elif " " in reference:
        reference = reference.split()[0]

    parsed = urlparse(reference)
    if parsed.scheme or parsed.netloc or reference.startswith(("/", "#")):
        return None

    path = unquote(parsed.path)
    if Path(path).suffix.lower() not in IMAGE_EXTENSIONS:
        return None
    if ".." in Path(path).parts:
        raise ValueError(f"Refusing path traversal reference: {raw}")

    return path


def find_image_references(markdown: str) -> list[str]:
    references: set[str] = set()
    for match in MARKDOWN_IMAGE_RE.finditer(markdown):
        normalized = normalize_reference(match.group(1))
        if normalized:
            references.add(normalized)
    for match in HTML_IMAGE_RE.finditer(markdown):
        normalized = normalize_reference(match.group(1))
        if normalized:
            references.add(normalized)
    return sorted(references)


def restore_assets(dry_run: bool) -> tuple[list[Path], list[str]]:
    markdown = DOMESTIC_MD.read_text(encoding="utf-8")
    references = find_image_references(markdown)

    copied: list[Path] = []
    missing: list[str] = []

    for reference in references:
        source = PRIVATE_SOURCE / reference
        destination = PUBLIC_ROOT / reference

        if not source.is_file():
            missing.append(reference)
            continue

        if not dry_run:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        copied.append(destination)

    return copied, missing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not DOMESTIC_MD.is_file():
        print(f"Missing markdown file: {DOMESTIC_MD}", file=sys.stderr)
        return 1
    if not PRIVATE_SOURCE.is_dir():
        print(f"Missing private source directory: {PRIVATE_SOURCE}", file=sys.stderr)
        return 1

    try:
        restored, missing = restore_assets(args.dry_run)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1

    action = "Would restore" if args.dry_run else "Restored"
    print(f"{action} {len(restored)} Domestic asset(s).")

    if missing:
        print("Missing referenced asset(s):", file=sys.stderr)
        for reference in missing:
            print(f"  {reference}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
