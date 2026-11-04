"""Render store/*.html to Web Store images with headless Chrome.

Outputs store/screenshot-1.png, store/screenshot-2.png (1280x800) and
store/promo-small.png (440x280) as 24-bit PNGs (the store rejects alpha).
Usage: python scripts/render_store_images.py [path-to-chrome]
"""
import pathlib
import struct
import subprocess
import sys
import tempfile
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = sys.argv[1] if len(sys.argv) > 1 else r"C:\Program Files\Google\Chrome\Application\chrome.exe"
IMAGES = {"screenshot-1": (1280, 800), "screenshot-2": (1280, 800), "promo-small": (440, 280)}


def chunks(data):
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        yield data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        pos += 12 + length


def strip_alpha(path):
    """Rewrite an 8-bit RGBA PNG as RGB (filters undone, alpha dropped)."""
    data = path.read_bytes()
    parts = list(chunks(data))
    ihdr = next(d for t, d in parts if t == b"IHDR")
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    if ctype != 6 or depth != 8:
        return
    raw = zlib.decompress(b"".join(d for t, d in parts if t == b"IDAT"))
    bpp, stride = 4, w * 4
    prev = bytearray(stride)
    out = bytearray()
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        out.append(0)
        for x in range(w):
            out += line[x * 4:x * 4 + 3]

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(out), 9))
        + chunk(b"IEND", b"")
    )


for name, (w, h) in IMAGES.items():
    src = ROOT / "store" / f"{name}.html"
    dst = ROOT / "store" / f"{name}.png"
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1", f"--user-data-dir={profile}",
            f"--window-size={w},{h}", f"--screenshot={dst}", src.as_uri(),
        ], check=True, capture_output=True)
    strip_alpha(dst)
    print("rendered", dst.relative_to(ROOT).as_posix())
