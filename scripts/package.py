"""Build the Chrome Web Store upload: dist/page-context-copier-<version>.zip.

Only the files the extension needs at runtime are included. Uses zipfile so
paths use forward slashes (PowerShell 5's Compress-Archive writes backslashes,
which the Web Store rejects).
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDE = ["manifest.json", "src", "icons"]

version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "dist" / f"page-context-copier-{version}.zip"
out.parent.mkdir(exist_ok=True)

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for entry in INCLUDE:
        path = ROOT / entry
        files = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
        for f in files:
            name = f.relative_to(ROOT).as_posix()
            z.write(f, name)
            print("  +", name)

print(f"Wrote {out.relative_to(ROOT).as_posix()} ({out.stat().st_size:,} bytes)")
