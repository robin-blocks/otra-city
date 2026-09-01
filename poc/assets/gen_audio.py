#!/usr/bin/env python3
"""Synthesize PromptFrenzy's in-shop ambient loop (pure stdlib -> WAV).

A soft synth arpeggio, 8 s, seamless loop. Convert to AAC with:
  afconvert promptfrenzy_loop.wav promptfrenzy_loop.m4a -f m4af -d aac -b 96000
"""
import math
import os
import struct
import wave

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "media")
os.makedirs(HERE, exist_ok=True)

SR = 44100
BPM = 96
STEP = 60.0 / BPM / 2.0          # eighth notes
STEPS = 32                        # 8 bars of eighths = 8 s at 96 bpm
DUR = STEP * STEPS

A2 = 110.0
semi = lambda n: A2 * (2.0 ** (n / 12.0))
# A minor pentatonic arp, two octaves, with a lift in the second half
PATTERN = [0, 3, 7, 12, 10, 7, 3, 0,
           0, 3, 7, 12, 15, 12, 7, 3,
           5, 8, 12, 17, 15, 12, 8, 5,
           3, 7, 10, 15, 19, 15, 12, 7]

samples = [0.0] * int(SR * DUR)

def add_note(t0, freq, length, amp):
    n0 = int(t0 * SR)
    n1 = min(len(samples), int((t0 + length) * SR))
    for i in range(n0, n1):
        t = (i - n0) / SR
        env = min(t / 0.02, 1.0) * math.exp(-2.6 * t)
        # sine + a whisper of an octave-up triangle for sparkle
        v = math.sin(2 * math.pi * freq * t)
        v += 0.25 * math.sin(2 * math.pi * freq * 2 * t)
        samples[i] += amp * env * v

for s, n in enumerate(PATTERN):
    add_note(s * STEP, semi(n + 12), STEP * 1.8, 0.16)
# slow root drone underneath
for b in range(4):
    add_note(b * DUR / 4, semi(0), DUR / 4 * 1.05, 0.10)
    add_note(b * DUR / 4, semi(7) / 2, DUR / 4 * 1.05, 0.06)

# gentle soft-clip + fade the loop seam
out = []
FADE = int(SR * 0.02)
N = len(samples)
for i, v in enumerate(samples):
    v = math.tanh(v * 1.2) * 0.85
    if i < FADE:
        v *= i / FADE
    if i > N - FADE:
        v *= (N - i) / FADE
    out.append(int(max(-1.0, min(1.0, v)) * 32767))

path = os.path.join(HERE, "promptfrenzy_loop.wav")
with wave.open(path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(struct.pack("<%dh" % len(out), *out))
print("wrote", path, f"{DUR:.1f}s")
