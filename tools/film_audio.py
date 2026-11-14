"""Sound of the 30-second demo film: the narration on a score synthesised here, note by note.

    python tools/film_audio.py        writes video/audio.wav (48 kHz stereo, 30 s)

The narration takes are video/voice/main.wav and video/voice/close.wav. They are an AI-generated
voice (OpenAI text-to-speech, voice "marin") reading the script of the film; the project page
says so. The music is not a recording: every tone below is computed.
"""
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 48000
SECONDS = 30.0
N = int(SR * SECONDS)
ROOT = Path(__file__).resolve().parent.parent
t = np.arange(N) / SR
rng = np.random.default_rng(7)

# ---------- when things happen (seconds of film); tools/film.mjs uses the same marks
MAIN_AT = 0.70      # the main narration take starts
MAIN_CUT = 22.53    # ... and is cut here, in the pause after "Horizons"
CLOSE_AT = 24.10    # the closing line
CUT_UI = 9.30       # first cut from the Moon to the tool
CUT_B = 13.30
CUT_C = 16.50
CUT_D = 20.30
TITLE = 23.70       # the title


def read(path: Path) -> np.ndarray:
    """A sound file as mono float samples at 48 kHz."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def fast_smooth(x: np.ndarray, seconds: float) -> np.ndarray:
    """Moving average over a window: a cheap envelope smoother."""
    n = max(1, int(seconds * SR))
    c = np.cumsum(np.concatenate([[0.0], x]))
    out = (c[n:] - c[:-n]) / n
    return np.concatenate([np.full(n // 2, out[0]), out, np.full(len(x) - len(out) - n // 2, out[-1])])


def ramp(t0: float, t1: float) -> np.ndarray:
    """0 before t0, 1 after t1, smooth in between."""
    k = np.clip((t - t0) / max(1e-6, t1 - t0), 0, 1)
    return k * k * (3 - 2 * k)


def span(t0: float, t1: float, attack: float, release: float) -> np.ndarray:
    return ramp(t0, t0 + attack) * (1 - ramp(t1 - release, t1))


def note(name: str) -> float:
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'Bb': 1, 'B': 2}
    return 440.0 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) - 4)) / 12)


def pad(notes: list[str], envelope: np.ndarray, bright: np.ndarray | float, level: float = 1.0) -> np.ndarray:
    """A soft chord: each note is a few harmonics, two slightly detuned voices, one per ear."""
    out = np.zeros((N, 2))
    bright = np.broadcast_to(bright, (N,))
    for f in [note(n) for n in notes]:
        for side, detune in ((0, 0.9983), (1, 1.0017)):
            phase = rng.uniform(0, 2 * np.pi, 7)
            drift = 1 + 0.0009 * np.sin(2 * np.pi * rng.uniform(0.07, 0.19) * t + rng.uniform(0, 6))
            ph = 2 * np.pi * f * detune * np.cumsum(drift) / SR
            voice = np.zeros(N)
            for h in range(1, 7):
                # the brighter the pad, the slower the harmonics fall away
                voice += np.sin(h * ph + phase[h]) * h ** (-(2.6 - 1.3 * bright))
            out[:, side] += voice
    out *= envelope[:, None] * level / len(notes)
    return out


def boom(at: float, f0: float = 52.0, length: float = 2.2, level: float = 1.0) -> np.ndarray:
    """A low hit: a sine falling in pitch, and a short breath of dark noise."""
    x = np.zeros(N)
    i0 = int(at * SR)
    n = min(N - i0, int(length * SR))
    tt = np.arange(n) / SR
    f = f0 * (1 + 1.4 * np.exp(-tt * 18))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.4)
    hiss = fast_smooth(rng.standard_normal(n), 0.004) * np.exp(-tt * 9) * 2.0
    x[i0 : i0 + n] = (body + hiss) * level
    return np.stack([x, x], axis=1)


def riser(t0: float, t1: float, level: float = 1.0) -> np.ndarray:
    """Air that rises towards the title: noise through a band that climbs, louder to the end."""
    n = int((t1 - t0) * SR)
    k = np.arange(n) / n
    out = np.zeros((N, 2))
    for side in (0, 1):
        white = rng.standard_normal(n)
        # band-pass by the difference of two moving averages whose windows shrink
        low = fast_smooth(white, 0.0030)
        high = fast_smooth(white, 0.0006)
        band = high * k + (high - low) * (1 - k)
        out[int(t0 * SR) : int(t0 * SR) + n, side] = band * k**2.2 * level
    return out


def pulse(t0: float, t1: float, step: float, f: float, level: np.ndarray) -> np.ndarray:
    """The clock of the planner: a quiet blip on every step, accented every fourth."""
    out = np.zeros((N, 2))
    k = 0
    at = t0
    while at < t1:
        i0 = int(at * SR)
        n = int(0.16 * SR)
        tt = np.arange(n) / SR
        accent = 1.0 if k % 4 == 0 else 0.55
        blip = np.sin(2 * np.pi * f * (2 if k % 8 == 6 else 1) * tt) * np.exp(-tt * 38) * accent
        pan = 0.5 + 0.28 * np.sin(k * 1.7)
        out[i0 : i0 + n, 0] += blip * (1 - pan) * level[i0]
        out[i0 : i0 + n, 1] += blip * pan * level[i0]
        at += step
        k += 1
    return out


def stars(t0: float, t1: float, level: float) -> np.ndarray:
    """High, still tones for the night sky."""
    out = np.zeros((N, 2))
    e = span(t0, t1, 1.2, 1.6)
    for i, n in enumerate(['A5', 'E6', 'B5', 'D6']):
        trem = 0.55 + 0.45 * np.sin(2 * np.pi * (0.21 + 0.07 * i) * t + i)
        tone = np.sin(2 * np.pi * note(n) * t + i) * trem * e * level
        out[:, 0] += tone * (0.3 + 0.4 * (i % 2))
        out[:, 1] += tone * (0.7 - 0.4 * (i % 2))
    return out


def room(x: np.ndarray, seconds: float, mix: float) -> np.ndarray:
    """A little space around a dry sound: convolution with decaying noise."""
    n = int(seconds * SR)
    tail = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.28 * seconds * SR))
    tail[: int(0.012 * SR)] = 0
    tail /= np.sqrt(np.sum(tail**2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(tail, size), size)[: len(x)]
    return x + wet * mix


# ---------- narration
voice = np.zeros(N)
main = read(ROOT / 'video/voice/main.wav')
main = main[: int((MAIN_CUT - MAIN_AT) * SR)]
main[-int(0.05 * SR) :] *= np.linspace(1, 0, int(0.05 * SR))
i0 = int(MAIN_AT * SR)
voice[i0 : i0 + len(main)] += main
close = read(ROOT / 'video/voice/close.wav')
i0 = int(CLOSE_AT * SR)
close = close[: N - i0]
voice[i0 : i0 + len(close)] += close
voice /= np.max(np.abs(voice))
voice = room(voice, 1.1, 0.085)
level_voice = fast_smooth(np.abs(voice), 0.12)
level_voice /= level_voice.max()
# The score steps back while she speaks.
duck = 1 - 0.58 * np.clip(fast_smooth(np.clip(level_voice * 6, 0, 1), 0.35), 0, 1)

# ---------- score
music = np.zeros((N, 2))
# A: the pole. A dark D minor that opens slowly; it thins out when the ridge takes the Sun.
bright_a = 0.15 + 0.35 * ramp(0.5, 6.0) - 0.3 * ramp(6.3, 8.0)
music += pad(['D2', 'A2', 'D3', 'F3', 'A3', 'E4'], span(0.0, CUT_UI + 0.5, 3.0, 0.9) * (1 - 0.45 * ramp(6.3, 7.6)), bright_a, 0.9)
music += pad(['D1', 'D2'], span(0.0, CUT_UI + 0.4, 2.0, 0.8), 0.0, 0.8)
music += stars(6.6, CUT_UI + 1.2, 0.05)
# B: the launch slips. A hit, and the clock of the planner starts.
music += boom(CUT_UI, 50, 2.4, 0.95)
music += pad(['D2', 'A2', 'D3', 'F3', 'A3'], span(CUT_UI - 0.2, CUT_B + 0.5, 0.5, 0.9), 0.2, 0.75)
music += pad(['D1'], span(CUT_UI, CUT_B + 0.4, 0.3, 0.8), 0.0, 0.7)
# C and D: the tool. The harmony lifts, step by step.
music += pad(['Bb1', 'Bb2', 'F3', 'A3', 'D4'], span(CUT_B - 0.3, CUT_C + 0.5, 0.7, 0.9), 0.42, 0.9)
music += pad(['C2', 'C3', 'G3', 'D4', 'E4'], span(CUT_C - 0.3, CUT_D + 0.5, 0.7, 0.9), 0.52, 0.92)
# E: verified. The dominant holds its breath, air rises, and everything stops for a moment.
music += pad(['A1', 'A2', 'E3', 'A3', 'D4'], span(CUT_D - 0.3, 22.2, 0.7, 0.7), 0.5, 0.9)
music += pad(['A1', 'A2', 'E3', 'A3', 'C#4'], span(21.6, TITLE - 0.12, 0.6, 0.18), 0.6, 0.95)
music += riser(21.4, TITLE - 0.1, 0.5)
beat = pulse(CUT_UI + 0.15, TITLE - 0.45, 0.15, note('D5'), 0.035 + 0.05 * ramp(CUT_B, CUT_D) + 0.03 * ramp(CUT_D, TITLE))
music += beat
# F: the title. D major, wide and bright, and a long way down to silence.
music += boom(TITLE, 55, 3.0, 1.1)
bright_f = 0.55 + 0.25 * ramp(TITLE, TITLE + 2.0) - 0.4 * ramp(27.5, 30.0)
music += pad(['D2', 'A2', 'D3', 'F#3', 'A3', 'E4', 'A4'], span(TITLE - 0.02, 30.2, 0.25, 2.4), bright_f, 1.25)
music += pad(['D1', 'D2'], span(TITLE, 30.2, 0.1, 2.6), 0.0, 0.9)
music += pad(['F#5', 'A5', 'D6'], span(TITLE + 0.4, 29.8, 1.6, 2.2), 0.0, 0.16)

music *= duck[:, None]
music *= 0.30 / np.percentile(np.abs(music), 99.5)

mix = music + voice[:, None] * 0.86
mix[: int(0.25 * SR)] *= np.linspace(0, 1, int(0.25 * SR))[:, None]
mix[-int(0.9 * SR) :] *= np.linspace(1, 0, int(0.9 * SR))[:, None] ** 1.5
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix *= 0.89 / np.max(np.abs(mix))

def save(path: Path, x: np.ndarray) -> None:
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


out = ROOT / 'video/audio.wav'
save(out, mix)
# The two layers apart, to measure their balance.
save(ROOT / 'video/stem_music.wav', music)
save(ROOT / 'video/stem_voice.wav', np.stack([voice, voice], axis=1) * 0.86)
speaking = level_voice > 0.12
rms = lambda x: 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-12)
print(f'while she speaks: voice {rms(voice[speaking] * 0.86):.1f} dB, music {rms(music[speaking].mean(axis=1)):.1f} dB; music alone in the pauses {rms(music[~speaking].mean(axis=1)):.1f} dB')
print(out, f'{SECONDS:.0f} s; voice peak {np.max(np.abs(voice)) * 0.86:.2f}, music p99 {np.percentile(np.abs(music), 99):.2f}')
