"""Frame-by-frame flicker check for the rendered promo video.

Decodes a downscaled grayscale copy, then flags (a) single-frame outliers -- a frame that
differs from BOTH neighbours while the neighbours match each other (the signature of a
flash/flicker) -- and (b) reports the worst consecutive-frame change inside a window.
Usage: python analyze_flicker.py out/newton-promo.mp4 [start_sec end_sec]
"""
import subprocess
import sys

import numpy as np

FFMPEG = (
    "C:/Users/winst/AppData/Local/Microsoft/WinGet/Packages/"
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe"
)
path = sys.argv[1]
W, H, FPS = 384, 216, 30
raw = subprocess.run(
    [FFMPEG, "-loglevel", "error", "-i", path, "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
    capture_output=True,
    check=True,
).stdout
a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)
n = len(a)
d1 = np.abs(a[1:] - a[:-1]).mean(axis=(1, 2))  # frame i -> i+1
d2 = np.abs(a[2:] - a[:-2]).mean(axis=(1, 2))  # frame i -> i+2

outliers = []
for i in range(1, n - 1):
    if d1[i - 1] > 0.8 and d1[i] > 0.8 and d2[i - 1] < 0.4 * min(d1[i - 1], d1[i]):
        outliers.append((i, round(i / FPS, 2), round(float(d1[i - 1]), 2), round(float(d1[i]), 2)))
print(f"{n} frames; single-frame outliers (flicker): {len(outliers)}")
for o in outliers[:30]:
    print("  frame %d (%.2fs): diff-in %.2f, diff-out %.2f" % o)

if len(sys.argv) >= 4:
    s, e = int(float(sys.argv[2]) * FPS), int(float(sys.argv[3]) * FPS)
    w = d1[s:e]
    print(f"window {sys.argv[2]}-{sys.argv[3]}s: max consecutive change {w.max():.2f} at "
          f"{(s + int(w.argmax())) / FPS:.2f}s, mean {w.mean():.2f}")
    big = [(round((s + i) / FPS, 2), round(float(v), 2)) for i, v in enumerate(w) if v > 3.0]
    print("  changes > 3.0:", big[:40])
    # mean brightness swings (the flash metric that matters for photosensitivity)
    lum = a[s:e].mean(axis=(1, 2))
    swing = np.abs(np.diff(lum))
    print(f"  max frame-to-frame mean-luminance swing: {swing.max():.2f} / 255")
