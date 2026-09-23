"""Synthesizes the promo film's soundtrack (no samples, no licensed music) from cues.json.

  music bed   soft warm pad + a quiet kalimba-style arpeggio, C major, 92 BPM
  UI sounds   key clicks, mouse clicks, message pops, tool-chip ticks/dings, window
              whooshes, a selection sweep, an "instant definition" chime, a build hum, and
              a "ready" arpeggio when the artifact appears
  drag tone   a soft sine whose pitch follows the artifact point's angle (one octave over a
              full turn), so dragging is heard as well as seen

Everything is placed from cues.json, which is exported from the SAME timeline the video is
rendered from (scripts/export-cues.ts), so sound cannot drift from picture.
Writes public/promo-audio.wav (44.1 kHz stereo).
"""
import json
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

SR = 44100
rng = np.random.default_rng(7)
cues = json.load(open("cues.json"))
DUR = cues["duration"]
N = int(DUR * SR) + SR  # tail room for reverb
t_all = np.arange(N) / SR

music = np.zeros((2, N))
fx = np.zeros((2, N))


def bp(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="band")
    return lfilter(b, a, x)


def lp(x, f):
    b, a = butter(2, f / (SR / 2))
    return lfilter(b, a, x)


def place(bus, sig, t0, pan=0.0, gain=1.0):
    i = int(t0 * SR)
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    l = gain * np.sqrt((1 - pan) / 2 + 0.5 * 0)  # constant-ish power pan
    l = gain * (1 - max(pan, 0))
    r = gain * (1 + min(pan, 0))
    bus[0, i : i + len(sig)] += sig * l
    bus[1, i : i + len(sig)] += sig * r


def env_exp(n, tau):
    return np.exp(-np.arange(n) / SR / tau)


def sine(f, dur, tau=None):
    n = int(dur * SR)
    x = np.sin(2 * np.pi * f * np.arange(n) / SR)
    return x * (env_exp(n, tau) if tau else 1.0)


# ------------------------------------------------------------------ UI sounds
def key_click(space=False):
    n = int(0.05 * SR)
    noise = bp(rng.standard_normal(n), 1800, 7000) * env_exp(n, 0.004)
    f = rng.uniform(150, 220) * (0.7 if space else 1.0)
    thock = np.sin(2 * np.pi * f * np.arange(n) / SR) * env_exp(n, 0.012)
    return (noise * 0.9 + thock * (0.8 if space else 0.45)) * (0.85 if space else 1.0)


def mouse_click(down=True):
    n = int(0.06 * SR)
    noise = bp(rng.standard_normal(n), 2200, 6500) * env_exp(n, 0.005)
    thock = np.sin(2 * np.pi * (430 if down else 560) * np.arange(n) / SR) * env_exp(n, 0.02)
    return (noise * 0.8 + thock * 0.9) * (1.0 if down else 0.55)


def pop():
    n = int(0.16 * SR)
    ti = np.arange(n) / SR
    f = 520 + 420 * (1 - np.exp(-ti / 0.02))
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * env_exp(n, 0.05)


def tick():
    n = int(0.04 * SR)
    return bp(rng.standard_normal(n), 1200, 3800) * env_exp(n, 0.006) * 0.7


def ding(f):
    n = int(0.9 * SR)
    ti = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * ti) + 0.28 * np.sin(2 * np.pi * 2.01 * f * ti)) * env_exp(n, 0.16)


def chime(notes, gap=0.09, tail=1.4, tau=0.35):
    total = int((gap * len(notes) + tail) * SR)
    out = np.zeros(total)
    for k, f in enumerate(notes):
        s = int(k * gap * SR)
        n = int(tail * SR)
        ti = np.arange(n) / SR
        v = (np.sin(2 * np.pi * f * ti) + 0.3 * np.sin(2 * np.pi * 2 * f * ti) + 0.1 * np.sin(2 * np.pi * 3 * f * ti)) * env_exp(n, tau)
        out[s : s + n] += v[: total - s]
    return out


def whoosh(dur, direction):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    lo, mid, hi = bp(noise, 250, 900), bp(noise, 900, 2600), bp(noise, 2600, 7000)
    ti = np.linspace(0, 1, n)
    w = lambda c, wd: np.exp(-((ti - c) ** 2) / (2 * wd**2))
    if direction == "in":
        sig = lo * w(0.25, 0.22) + mid * w(0.55, 0.2) + hi * w(0.8, 0.16) * 0.6
    else:
        sig = hi * w(0.2, 0.16) * 0.6 + mid * w(0.45, 0.2) + lo * w(0.75, 0.22)
    return sig * np.sin(np.pi * ti) ** 2


def sweep(dur):
    n = int(dur * SR)
    ti = np.linspace(0, 1, n)
    f = 380 + 900 * ti**1.5
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.sin(np.pi * ti) ** 2


# place UI sounds
for k in cues["keys"]:
    place(fx, key_click(k["space"]), k["t"], pan=rng.uniform(-0.18, 0.18), gain=0.16 * rng.uniform(0.7, 1.0))
for c in cues["clicks"]:
    place(fx, mouse_click(True), c, gain=0.30)
    place(fx, mouse_click(False), c + 0.075, gain=0.16)
for p in cues["pops"]:
    place(fx, pop(), p, gain=0.16)
for c in cues["chipTicks"]:
    place(fx, tick(), c, gain=0.22)
for k, d in enumerate(cues["dings"]):
    place(fx, ding([880, 988, 1175][k % 3]), d, gain=0.10)
for w in cues["whooshes"]:
    place(fx, whoosh(w["dur"] + 0.25, w["dir"]), w["t"] - 0.1, gain=0.20)
s = cues["selection"]
place(fx, sweep(s["dur"]), s["t"], gain=0.045)
place(fx, chime([880, 1319, 1760], gap=0.07, tail=1.3), cues["defineChime"], gain=0.15)
place(fx, chime([523, 659, 784, 1047, 1319], gap=0.11, tail=1.8, tau=0.45), cues["readyChime"], gain=0.15)

# building hum: soft pulsing pad + ticks while the (sped-up) build runs
b0, b1 = cues["building"]["start"], cues["building"]["end"]
i0, i1 = int(b0 * SR), int(b1 * SR)
tb = t_all[i0:i1] - b0
fade = np.minimum(1, tb / 0.5) * np.minimum(1, (b1 - b0 - tb) / 0.6)
hum = (np.sin(2 * np.pi * 110 * tb) + 0.6 * np.sin(2 * np.pi * 165 * tb)) * (0.55 + 0.45 * np.sin(2 * np.pi * 3.2 * tb)) * fade
fx[0, i0:i1] += hum * 0.05
fx[1, i0:i1] += hum * 0.05
for k in np.arange(b0 + 0.3, b1 - 0.2, 0.3):
    place(fx, tick(), float(k), pan=rng.uniform(-0.3, 0.3), gain=0.10)

# drag tone: pitch follows the angle (one octave per full turn)
d = np.array(cues["drag"])
i0, i1 = int(d[0, 0] * SR), int(d[-1, 0] * SR)
td = t_all[i0:i1]
ang = np.interp(td, d[:, 0], d[:, 1])
freq = 262 * 2 ** (ang / 360.0)
phase = 2 * np.pi * np.cumsum(freq) / SR
vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * td)
tone = (np.sin(phase * vib) + 0.3 * np.sin(2 * phase) + 0.12 * np.sin(3 * phase))
edge = np.minimum(1, (td - td[0]) / 0.2) * np.minimum(1, (td[-1] - td) / 0.35)
fx[0, i0:i1] += tone * edge * 0.055
fx[1, i0:i1] += tone * edge * 0.055

# ------------------------------------------------------------------ music bed
BPM = 92
beat = 60.0 / BPM
midi = lambda m: 440.0 * 2 ** ((m - 69) / 12)
CHORDS = [  # (bass, chord tones) — Cmaj7, Am7, Fmaj7, G6
    (36, [60, 64, 67, 71]),
    (33, [57, 60, 64, 67]),
    (41, [53, 57, 60, 64]),
    (43, [55, 59, 62, 64]),
]
bar = 4 * beat
n_bars = int(np.ceil(DUR / bar)) + 1
ARP = [0, 2, 1, 3, 2, 1, 3, 2]  # eighth-note pattern over the chord tones, an octave up
for bi in range(n_bars):
    bass, tones = CHORDS[bi % 4]
    t0 = bi * bar
    dur = bar + 0.6
    n = int(dur * SR)
    ti = np.arange(n) / SR
    swell = np.minimum(1, ti / 0.9) * np.minimum(1, (dur - ti) / 0.9)
    pad = np.zeros(n)
    for m in tones:
        for det in (-0.06, 0.06):
            pad += np.sin(2 * np.pi * midi(m) * (1 + det / 100) * ti)
    pad = lp(pad, 1800) * swell * 0.05
    bassline = np.sin(2 * np.pi * midi(bass) * ti) * swell * 0.11
    place(music, pad + bassline, t0)
    for k, ai in enumerate(ARP):
        tk = t0 + k * beat / 2
        f = midi(tones[ai] + 12)
        nn = int(0.9 * SR)
        tt = np.arange(nn) / SR
        pluck = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 4.0 * f * tt) * np.exp(-tt / 0.03)) * env_exp(nn, 0.22)
        place(music, pluck, tk, pan=(-0.25 if k % 2 else 0.25), gain=0.035 * (0.75 + 0.25 * ((k % 4) == 0)))

# intro swell and outro resolve
def swell_chord(notes, dur, peak):
    n = int(dur * SR)
    ti = np.arange(n) / SR
    env = np.sin(np.pi * np.minimum(1, ti / dur)) ** 2
    x = sum(np.sin(2 * np.pi * midi(m) * ti) for m in notes)
    return lp(x, 2400) * env * peak

place(music, swell_chord([48, 55, 60, 64, 71], 2.6, 0.05), cues["introAt"])
outro = chime([523, 659, 784, 988, 1319], gap=0.16, tail=3.2, tau=0.9)
place(fx, outro, cues["outroAt"], gain=0.13)
place(music, swell_chord([48, 55, 60, 64, 67, 71], 3.4, 0.055), cues["outroAt"] - 0.3)

# ------------------------------------------------------------------ mix
def reverb(x, seconds=1.7, wet=0.22):
    n = int(seconds * SR)
    ir = np.stack([lp(rng.standard_normal(n), 3800) * np.exp(-np.arange(n) / SR / 0.42) for _ in range(2)])
    ir /= np.sqrt((ir**2).sum(axis=1, keepdims=True)) + 1e-9
    wetsig = np.stack([fftconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])
    return x * (1 - wet) + wetsig * wet * 2.2

mix = reverb(music * 1.0, wet=0.35) + reverb(fx, wet=0.16)
mix = mix[:, : int(DUR * SR)]
tt = np.arange(mix.shape[1]) / SR
mix *= np.minimum(1, tt / 0.4) * np.minimum(1, (DUR - tt) / 1.4)  # fade in / out
# Target roughly -17 LUFS integrated (for this material LUFS ~= RMS dBFS + 1.7), then a
# transparent soft limiter so peaks stay under -1 dBFS without squashing the dynamics.
rms = np.sqrt((mix**2).mean())
mix *= 0.115 / max(rms, 1e-9)
knee = 0.7
over = np.abs(mix) > knee
mix[over] = np.sign(mix[over]) * (knee + (0.89 - knee) * np.tanh((np.abs(mix[over]) - knee) / (0.89 - knee)))

pcm = (mix.T * 32767).astype("<i2")
with wave.open("public/promo-audio.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote public/promo-audio.wav  {DUR:.1f}s  rms={np.sqrt((mix**2).mean()):.3f}  peak={np.abs(mix).max():.2f}")
