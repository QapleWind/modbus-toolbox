#!/usr/bin/env python3
"""Render the existing M vector mark into native app icons; no dependencies."""
import math
from pathlib import Path
import struct
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)
SEGMENTS = [(270, 700, 270, 330), (270, 330, 512, 560), (512, 560, 754, 330), (754, 330, 754, 700)]


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def png(size):
    scale = 1024 / size
    raw = bytearray()
    for row in range(size):
        raw.append(0)
        y = (row + .5) * scale
        for col in range(size):
            x = (col + .5) * scale
            qx, qy = abs(x - 512) - 260, abs(y - 512) - 260
            rounded_distance = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - 220
            alpha = max(0, min(1, .5 - rounded_distance / scale))
            white = 0
            if alpha and 220 < x < 810 and 280 < y < 750:
                distance = 10000
                for ax, ay, bx, by in SEGMENTS:
                    dx, dy = bx - ax, by - ay
                    t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
                    distance = min(distance, math.hypot(x - ax - t * dx, y - ay - t * dy))
                white = max(0, min(1, .5 + (37 - distance) / scale))
            raw.extend((round(37 + 218 * white), round(99 + 156 * white), round(235 + 20 * white), round(255 * alpha)))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


images = {size: png(size) for size in [16, 32, 48, 64, 128, 256, 512, 1024]}
(ASSETS / 'icon.png').write_bytes(images[1024])
(ASSETS / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="32" y="32" width="960" height="960" rx="220" fill="#2563eb"/><path d="M270 700V330L512 560L754 330V700" fill="none" stroke="white" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/></svg>')
iconset = ASSETS / 'icon.iconset'
iconset.mkdir(exist_ok=True)
for size in [16, 32, 128, 256, 512]:
    (iconset / ('icon_%dx%d.png' % (size, size))).write_bytes(images[size])
    (iconset / ('icon_%dx%d@2x.png' % (size, size))).write_bytes(images[size * 2])
ico_sizes = [16, 32, 48, 64, 128, 256]
directory = bytearray(struct.pack('<HHH', 0, 1, len(ico_sizes)))
offset = 6 + 16 * len(ico_sizes)
for size in ico_sizes:
    payload = images[size]
    directory.extend(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(payload), offset))
    offset += len(payload)
(ASSETS / 'icon.ico').write_bytes(directory + b''.join(images[size] for size in ico_sizes))
if sys.platform == 'darwin':
    subprocess.run(['iconutil', '--convert', 'icns', '--output', str(ASSETS / 'icon.icns'), str(iconset)], check=True)
print('Native app icons generated.')
