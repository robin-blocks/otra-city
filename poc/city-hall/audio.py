#!/usr/bin/env python3
"""
Generate hall_loop.m4a - a seamless 72s ambient night-city loop for
OTRA CITY HALL (otra.city/plots/city-hall).

Design
------
Key: D major / D major pentatonic (D, E, F#, A, B). Tempo feel: ~60 BPM,
no drums - purely a slow harmonic/melodic bed for a calm civic night scene.

Layers:
  1. Pad      - 4 detuned sine/triangle voices per chord. Chord progression
                D -> A/C# -> Bm -> G, 18s per chord (4 x 18s = 72s exactly),
                with 2.5s equal-power crossfades between chords. Using only
                sine + triangle partials (no bright harmonics) gives the
                "filtered" mellow feel without needing an actual filter.
  2. Bells    - sparse D-major-pentatonic bell tones (sine fundamental with
                a fast-decaying 2nd/3rd harmonic on top, ~3s audible decay),
                14 events over the 72s loop, panned left/right.
  3. Sub bass - very quiet sine one octave below each chord's bass note,
                following the same chord windows as the pad.
  4. Air      - heavily low-passed (cascaded circular moving-average) white
                noise per channel, with a slow amplitude LFO, sitting about
                -30 dB relative to the pad.

Looping
-------
All timing is built from exact integer fractions of the 72s loop: the
chord cycle is exactly 4 x 18s, every LFO rate is k/72 Hz for an integer
k (so it completes a whole number of cycles per loop), the noise bed is
generated with circular (wrap-around) filtering so its texture is itself
seamless, and every bell note is scheduled to fully decay well before the
loop end. On top of all that, a final 2s equal-power crossfade blends the
buffer's tail into its head so any residual raw-oscillator phase mismatch
at the wrap point (musical pitches are never exact integer-cycle divisors
of 72s) is inaudible.

Pipeline: synthesize with numpy -> write 16-bit PCM WAV (stdlib `wave`)
-> ffmpeg two-pass `loudnorm` to ~-18 LUFS / <=-1.5 dBTP -> encode AAC.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

SR = 44100
LOOP_SEC = 72.0
N = int(round(LOOP_SEC * SR))  # 3,175,200 samples, exact

CHORD_SEC = 18.0         # 4 chords * 18s = 72s exactly
CHORD_XFADE_SEC = 2.5     # smooth 2-3s crossfade between chords
LOOP_XFADE_SEC = 2.0       # final tail-into-head loop crossfade

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
MEDIA_DIR = REPO_ROOT / "public" / "plots" / "city-hall" / "media"
OUT_M4A = MEDIA_DIR / "hall_loop.m4a"

TARGET_I = -18.0    # integrated loudness target, LUFS
TARGET_TP = -1.5    # true peak ceiling, dBTP
TARGET_LRA = 11.0   # loudness range target, LU

RNG_SEED = 20260901

# --------------------------------------------------------------------------
# Music theory helpers
# --------------------------------------------------------------------------

_LETTER_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_to_midi(name: str) -> int:
    """Parse scientific pitch notation, e.g. 'F#3', 'C4', 'A2' -> MIDI number."""
    letter = name[0].upper()
    i = 1
    acc = 0
    if i < len(name) and name[i] in "#b":
        acc = 1 if name[i] == "#" else -1
        i += 1
    octave = int(name[i:])
    return _LETTER_SEMITONE[letter] + acc + (octave + 1) * 12


def note_freq(name: str) -> float:
    m = note_to_midi(name)
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


# --------------------------------------------------------------------------
# Chord progression (D - A/C# - Bm - G) and bell melody
# --------------------------------------------------------------------------

# Each chord's pad voicing (3-4 detuned voices) plus its bass/root note,
# whose octave-down copy drives the sub bass. Chosen so neighboring chords
# share close voice-leading (smooth crossfades) and the final chord (G)
# leads smoothly back into the first (D) across the loop seam.
CHORDS = [
    dict(name="D",    pad=["D3", "F#3", "A3", "D4"],   sub="D2"),
    dict(name="A/C#", pad=["C#3", "E3", "A3", "C#4"],  sub="C#2"),
    dict(name="Bm",   pad=["B2", "D3", "F#3", "B3"],   sub="B1"),
    dict(name="G",    pad=["G2", "B2", "D3", "G3"],    sub="G1"),
]

# Pad voice "roles" (slot 0..3 within each chord's 4-note voicing): static
# detune (cents), vibrato rate (integer cycles per 72s loop -> exactly
# periodic), vibrato depth (fractional peak frequency deviation), a phase
# offset per voice/chord so voices don't all wobble in lockstep, a fixed
# stereo pan, and the sine/triangle blend for timbre.
VOICE_DETUNE_CENTS = [-5.0, -1.6, 1.6, 5.0]
VOICE_VIBRATO_CYCLES = [3, 5, 4, 7]          # k/72 Hz => integer cycles/loop
VOICE_VIBRATO_DEPTH = [0.0025, 0.0018, 0.0020, 0.0028]  # ~3-5 cents peak
VOICE_VIBRATO_PHASE = [0.0, 1.3, 2.6, 4.1]
VOICE_PAN = [-0.32, -0.11, 0.11, 0.32]
VOICE_SINE_W = [0.70, 0.60, 0.60, 0.68]

# Sparse D-major-pentatonic (D, E, F#, A, B) bell melody: (onset_sec, note,
# pan, relative amplitude). 14 events, irregular spacing for a gentle,
# non-mechanical feel. Last onset + full decay tail finishes well before
# the final loop crossfade zone (70-72s) so no bell ever crosses the seam.
BELL_EVENTS = [
    (3.0,  "D5",  -0.60, 1.00),
    (7.0,  "A4",   0.50, 0.85),
    (11.5, "F#4", -0.30, 0.90),
    (15.0, "B4",   0.70, 0.80),
    (20.5, "E4",  -0.50, 0.85),
    (25.0, "A4",   0.30, 0.75),
    (29.0, "D5",  -0.20, 1.00),
    (34.5, "F#4",  0.60, 0.85),
    (39.0, "B3",  -0.70, 0.70),
    (44.5, "A4",   0.20, 0.80),
    (49.0, "E5",   0.40, 0.90),
    (54.5, "D5",  -0.40, 0.95),
    (58.5, "F#4",  0.10, 0.80),
    (63.0, "B4",  -0.15, 0.90),
]

BELL_TAIL_SEC = 6.0    # generous full-decay window per note
BELL_TAU_FUND = 1.05   # fundamental exponential decay time constant (s)
BELL_TAU_HARM = 0.32   # 2nd/3rd harmonic decay time constant (s) - much faster
BELL_AMP2 = 0.45       # 2nd harmonic relative weight at onset
BELL_AMP3 = 0.22       # 3rd harmonic relative weight at onset

AIR_KERNEL = 64        # moving-average box size (samples)
AIR_PASSES = 4         # cascaded passes -> heavier, smoother low-pass
AIR_LFO_CYCLES = 2      # integer cycles per loop -> 36s breathing swell

SUB_SINE_W = 0.92       # sub bass: almost pure sine, a hint of triangle warmth
SUB_REL_DB = -22.0      # sub bass level relative to pad RMS
AIR_REL_DB = -30.0      # air layer level relative to pad RMS ("about -30dB")
BELL_PEAK_FRAC = 0.85   # bell peak relative to pad peak


# --------------------------------------------------------------------------
# DSP helpers
# --------------------------------------------------------------------------

def triangle_from_phase(phase: np.ndarray) -> np.ndarray:
    return (2.0 / np.pi) * np.arcsin(np.sin(phase))


def pan_gains(p: float) -> tuple[float, float]:
    """Equal-power pan: p in [-1, 1] -> (left_gain, right_gain)."""
    p = max(-1.0, min(1.0, p))
    angle = (p + 1.0) * math.pi / 4.0
    return math.cos(angle), math.sin(angle)


def chord_window(t: np.ndarray, index: int, cf: float = CHORD_XFADE_SEC,
                  chord_len: float = CHORD_SEC, total: float = LOOP_SEC) -> np.ndarray:
    """Equal-power trapezoid window for chord `index`, periodic (mod `total`)
    so the last chord's fade-out and the first chord's fade-in meet exactly
    at the t=0/t=total seam with no gap or bump.
    """
    start = index * chord_len
    shifted = (t - (start - cf / 2.0)) % total
    w = np.zeros_like(t)
    m1 = shifted < cf
    w[m1] = np.sin(0.5 * np.pi * shifted[m1] / cf)
    m2 = (shifted >= cf) & (shifted < chord_len)
    w[m2] = 1.0
    m3 = (shifted >= chord_len) & (shifted < chord_len + cf)
    w[m3] = np.cos(0.5 * np.pi * (shifted[m3] - chord_len) / cf)
    return w


def pad_voice(t: np.ndarray, freq: float, detune_cents: float, vibrato_cycles: int,
              vibrato_depth: float, lfo_phase: float, sine_w: float) -> np.ndarray:
    """One chorus-y pad voice: sine/triangle blend, statically detuned, with
    a slow true-FM vibrato whose rate is an integer number of cycles over
    the 72s loop (so the modulation itself is exactly loop-periodic).
    """
    f0 = freq * (2.0 ** (detune_cents / 1200.0))
    fl = vibrato_cycles / LOOP_SEC
    phase = 2 * np.pi * f0 * t - (f0 * vibrato_depth / fl) * np.cos(2 * np.pi * fl * t + lfo_phase)
    return sine_w * np.sin(phase) + (1.0 - sine_w) * triangle_from_phase(phase)


def circular_moving_average(x: np.ndarray, kernel_len: int) -> np.ndarray:
    """Box-filter moving average with wrap-around padding, so the result is
    itself seamlessly periodic over the buffer length.
    """
    pad = kernel_len // 2
    xp = np.pad(x, (pad, kernel_len - 1 - pad), mode="wrap")
    kernel = np.ones(kernel_len) / kernel_len
    return np.convolve(xp, kernel, mode="valid")


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)) + 1e-24))


def db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


# --------------------------------------------------------------------------
# Layer builders
# --------------------------------------------------------------------------

def build_pad(t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    pad_L = np.zeros(N)
    pad_R = np.zeros(N)
    for ci, chord in enumerate(CHORDS):
        w = chord_window(t, ci)
        for vi, note in enumerate(chord["pad"]):
            freq = note_freq(note)
            voice = pad_voice(
                t, freq,
                VOICE_DETUNE_CENTS[vi],
                VOICE_VIBRATO_CYCLES[vi],
                VOICE_VIBRATO_DEPTH[vi],
                VOICE_VIBRATO_PHASE[vi] + ci * 0.7,
                VOICE_SINE_W[vi],
            )
            gl, gr = pan_gains(VOICE_PAN[vi])
            windowed = voice * w
            pad_L += windowed * gl
            pad_R += windowed * gr
    return pad_L, pad_R


def build_sub(t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    sub = np.zeros(N)
    for ci, chord in enumerate(CHORDS):
        w = chord_window(t, ci)
        freq = note_freq(chord["sub"])
        phase = 2 * np.pi * freq * t
        voice = SUB_SINE_W * np.sin(phase) + (1.0 - SUB_SINE_W) * triangle_from_phase(phase)
        sub += voice * w
    # Sub bass is dual-mono (centered, phase-coherent), not pan-law reduced.
    return sub, sub.copy()


def bell_signal(freq: float, n_samples: int) -> np.ndarray:
    tl = np.arange(n_samples) / SR
    env_fund = np.exp(-tl / BELL_TAU_FUND)
    env_harm = np.exp(-tl / BELL_TAU_HARM)
    sig = (env_fund * np.sin(2 * np.pi * freq * tl)
           + BELL_AMP2 * env_harm * np.sin(2 * np.pi * 2 * freq * tl)
           + BELL_AMP3 * env_harm * np.sin(2 * np.pi * 3 * freq * tl))
    return sig


def build_bells() -> tuple[np.ndarray, np.ndarray]:
    bells_L = np.zeros(N)
    bells_R = np.zeros(N)
    tail_n = int(round(BELL_TAIL_SEC * SR))
    for onset, note, pan, amp in BELL_EVENTS:
        freq = note_freq(note)
        sig = bell_signal(freq, tail_n) * amp
        gl, gr = pan_gains(pan)
        start_idx = int(round(onset * SR))
        end_idx = min(start_idx + tail_n, N)
        length = end_idx - start_idx
        bells_L[start_idx:end_idx] += sig[:length] * gl
        bells_R[start_idx:end_idx] += sig[:length] * gr
    return bells_L, bells_R


def build_air(t: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    noise_L = rng.standard_normal(N)
    noise_R = rng.standard_normal(N)
    for _ in range(AIR_PASSES):
        noise_L = circular_moving_average(noise_L, AIR_KERNEL)
        noise_R = circular_moving_average(noise_R, AIR_KERNEL)
    lfo_rate = AIR_LFO_CYCLES / LOOP_SEC
    env = 0.7 + 0.3 * np.sin(2 * np.pi * lfo_rate * t - math.pi / 2.0)  # always in [0.4, 1.0]
    return noise_L * env, noise_R * env


# --------------------------------------------------------------------------
# Mixdown, loop crossfade, WAV output
# --------------------------------------------------------------------------

def apply_loop_crossfade(L: np.ndarray, R: np.ndarray,
                          xfade_sec: float = LOOP_XFADE_SEC) -> tuple[np.ndarray, np.ndarray]:
    """Equal-power crossfade of the buffer's tail into its head, in place,
    keeping the total length unchanged (still exactly 72s)."""
    x = int(round(xfade_sec * SR))
    n = np.arange(x) / x
    fade_in = np.sin(0.5 * np.pi * n)
    fade_out = np.cos(0.5 * np.pi * n)
    for buf in (L, R):
        head = buf[:x].copy()
        tail = buf[-x:].copy()
        buf[:x] = head * fade_in + tail * fade_out
    return L, R


def loop_smoothness_check(L: np.ndarray, R: np.ndarray, n_samples: int = 2048) -> tuple[float, float]:
    """Quick sanity check: RMS of the last n_samples vs the first n_samples
    of the final (post-crossfade) buffer should be close in level, with no
    jarring jump, confirming the loop point is smooth."""
    first = np.concatenate([L[:n_samples], R[:n_samples]])
    last = np.concatenate([L[-n_samples:], R[-n_samples:]])
    rms_first = rms(first)
    rms_last = rms(last)
    print(f"[loop check] RMS of first {n_samples} samples: {rms_first:.6f}")
    print(f"[loop check] RMS of last  {n_samples} samples: {rms_last:.6f}")
    if rms_first > 1e-9 and rms_last > 1e-9:
        diff_db = 20 * math.log10(rms_last / rms_first)
        print(f"[loop check] level difference: {diff_db:+.2f} dB")
    return rms_first, rms_last


def float_to_int16(x: np.ndarray) -> np.ndarray:
    return np.clip(np.round(x * 32767.0), -32768, 32767).astype(np.int16)


def write_wav(path: Path, L: np.ndarray, R: np.ndarray, sr: int = SR) -> None:
    li = float_to_int16(L)
    ri = float_to_int16(R)
    interleaved = np.empty(len(li) * 2, dtype=np.int16)
    interleaved[0::2] = li
    interleaved[1::2] = ri
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(interleaved.tobytes())


def synthesize() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(RNG_SEED)
    t = np.arange(N) / SR

    print("Synthesizing pad (4 chords x 4 voices)...")
    pad_L, pad_R = build_pad(t)
    print("Synthesizing sub bass...")
    sub_L, sub_R = build_sub(t)
    print(f"Synthesizing bells ({len(BELL_EVENTS)} events)...")
    bells_L, bells_R = build_bells()
    print("Synthesizing air layer...")
    air_L, air_R = build_air(t, rng)

    pad_stack = np.stack([pad_L, pad_R])
    pad_rms = rms(pad_stack)
    pad_peak = float(np.max(np.abs(pad_stack)))

    sub_rms = rms(np.stack([sub_L, sub_R])) + 1e-12
    air_rms = rms(np.stack([air_L, air_R])) + 1e-12
    bells_peak = float(np.max(np.abs(np.stack([bells_L, bells_R])))) + 1e-12

    sub_gain = pad_rms * db_to_lin(SUB_REL_DB) / sub_rms
    air_gain = pad_rms * db_to_lin(AIR_REL_DB) / air_rms
    bell_gain = pad_peak * BELL_PEAK_FRAC / bells_peak

    print(f"pad rms={pad_rms:.5f} peak={pad_peak:.5f}")
    print(f"gains: sub={sub_gain:.4f} (target {SUB_REL_DB} dB rel.), "
          f"air={air_gain:.4f} (target {AIR_REL_DB} dB rel.), bell={bell_gain:.4f}")

    L = pad_L + sub_L * sub_gain + air_L * air_gain + bells_L * bell_gain
    R = pad_R + sub_R * sub_gain + air_R * air_gain + bells_R * bell_gain

    L, R = apply_loop_crossfade(L, R)
    loop_smoothness_check(L, R)

    peak = max(float(np.max(np.abs(L))), float(np.max(np.abs(R))), 1e-9)
    target_peak = db_to_lin(-3.0)
    norm_gain = target_peak / peak
    L = L * norm_gain
    R = R * norm_gain
    final_peak_db = 20 * math.log10(max(float(np.max(np.abs(L))), float(np.max(np.abs(R)))))
    print(f"Pre-encode peak normalized to {final_peak_db:.2f} dBFS (headroom before loudnorm)")

    return L, R


# --------------------------------------------------------------------------
# ffmpeg pipeline: loudnorm (two-pass) -> AAC encode -> verification
# --------------------------------------------------------------------------

def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def loudnorm_two_pass(src_wav: Path, dst_wav: Path) -> dict:
    filt1 = f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json"
    p1 = run([FFMPEG, "-hide_banner", "-nostats", "-i", str(src_wav), "-af", filt1, "-f", "null", "-"])
    stderr = p1.stderr
    start = stderr.rfind("{")
    end = stderr.rfind("}")
    if start == -1 or end == -1:
        print(stderr, file=sys.stderr)
        raise RuntimeError("loudnorm pass 1 did not produce measurement JSON")
    stats = json.loads(stderr[start:end + 1])

    filt2 = (
        f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:"
        f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
        f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
        f"offset={stats['target_offset']}:linear=true:print_format=summary"
    )
    p2 = run([FFMPEG, "-y", "-hide_banner", "-nostats", "-i", str(src_wav),
              "-af", filt2, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(dst_wav)])
    if p2.returncode != 0:
        print(p2.stderr, file=sys.stderr)
        raise RuntimeError("loudnorm pass 2 failed")
    return stats


def encode_aac(src_wav: Path, dst_m4a: Path) -> None:
    p = run([FFMPEG, "-y", "-hide_banner", "-nostats", "-i", str(src_wav),
             "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "2",
             "-movflags", "+faststart", str(dst_m4a)])
    if p.returncode != 0:
        print(p.stderr, file=sys.stderr)
        raise RuntimeError("AAC encode failed")


def probe_duration_size(path: Path) -> tuple[float, int]:
    p = run([FFPROBE, "-v", "error", "-show_entries", "format=duration,size",
             "-of", "json", str(path)])
    if p.returncode != 0:
        print(p.stderr, file=sys.stderr)
        raise RuntimeError("ffprobe failed")
    data = json.loads(p.stdout)["format"]
    return float(data["duration"]), int(data["size"])


def measure_loudness(path: Path) -> dict:
    # peak=true is required for the filter to report True peak at all
    # (default is peak=none); everything else matches the plain
    # `-af ebur128` verification command.
    p = run([FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"])
    stderr = p.stderr
    idx = stderr.rfind("Summary:")
    tail = stderr[idx:] if idx != -1 else stderr

    def grab(pattern: str):
        m = re.search(pattern, tail)
        return float(m.group(1)) if m else None

    integrated = grab(r"Integrated loudness:\s*\n\s*I:\s*(-?\d+\.?\d*)\s*LUFS")
    lra = grab(r"Loudness range:\s*\n\s*LRA:\s*(-?\d+\.?\d*)\s*LU")
    true_peak = grab(r"True peak:\s*\n\s*Peak:\s*(-?\d+\.?\d*)\s*dBFS")
    return dict(integrated=integrated, lra=lra, true_peak=true_peak, raw=stderr)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    L, R = synthesize()

    with tempfile.TemporaryDirectory(prefix="hall_loop_") as tmp_str:
        tmp = Path(tmp_str)
        raw_wav = tmp / "raw.wav"
        norm_wav = tmp / "normalized.wav"

        write_wav(raw_wav, L, R)
        print(f"Wrote intermediate WAV: {raw_wav} ({raw_wav.stat().st_size} bytes)")

        print("Running two-pass loudnorm...")
        stats = loudnorm_two_pass(raw_wav, norm_wav)
        print("Measured (pre-normalization): "
              f"I={stats['input_i']} LUFS, TP={stats['input_tp']} dBTP, LRA={stats['input_lra']} LU")

        print("Encoding AAC...")
        encode_aac(norm_wav, OUT_M4A)

    duration, size = probe_duration_size(OUT_M4A)
    loud = measure_loudness(OUT_M4A)

    print()
    print("=" * 64)
    print("RESULT")
    print("=" * 64)
    print(f"File:      {OUT_M4A}")
    print(f"Duration:  {duration:.3f} s (limit <= 90 s)")
    print(f"Size:      {size} bytes ({size / 1024 / 1024:.3f} MiB, limit <= 2 MiB)")
    print(f"Integrated loudness: {loud['integrated']} LUFS (target {TARGET_I} +/- 2 LU)")
    print(f"Loudness range:      {loud['lra']} LU")
    print(f"True peak:           {loud['true_peak']} dBFS (target <= {TARGET_TP})")

    ok = True
    if duration > 90.0:
        print("FAIL: duration exceeds 90s")
        ok = False
    if size > 2 * 1024 * 1024:
        print("FAIL: file exceeds 2 MiB")
        ok = False
    if loud["integrated"] is None or abs(loud["integrated"] - TARGET_I) > 2.0:
        print("FAIL: integrated loudness out of +/-2 LU tolerance")
        ok = False
    if loud["true_peak"] is not None and loud["true_peak"] > TARGET_TP + 0.2:
        print("WARN: true peak above target ceiling")
    print("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    if not ok:
        print(loud["raw"])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
