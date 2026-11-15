"""The voice of the guided first visit: Mission Control, over a radio link.

    python -X utf8 tools/guide_voice.py [en pt es] [--only id,id] [--check]

Reads the lines from src/ui/guide.lines.json (the same text the tool shows as captions). For each line:
  1. an AI-generated voice reads it (OpenAI text-to-speech, the voice of the demo film); the clean take is kept
     in video/voice/guide/<lang>/<id>.wav, outside the repository, and is not asked for again while the text is
     the same;
  2. the take is made to sound like a voice link with a spacecraft: the band of a radio channel (300 to 3400 Hz),
     a compressor, a little line noise, and the two tones of the Apollo links around it (2525 Hz opens the
     line, 2475 Hz closes it, a quarter of a second each);
  3. it is written to public/audio/guide/<lang>/<id>.mp3, with a comment in the file saying the voice is
     AI-generated.

--check sends each clean take to a speech-to-text model and prints how close what was heard is to the line.
The key of the speech service is read from the environment (OPENAI_API_KEY); it is never written anywhere.
"""
import difflib
import hashlib
import json
import os
import subprocess
import sys
import unicodedata
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LINES = json.loads((ROOT / 'src' / 'ui' / 'guide.lines.json').read_text(encoding='utf-8'))
TAKES = ROOT / 'video' / 'voice' / 'guide'
OUT = ROOT / 'public' / 'audio' / 'guide'
RATE = 24000
KEY = os.environ.get('OPENAI_API_KEY', '').strip()

args = [a for a in sys.argv[1:] if not a.startswith('--')]
LANGS = args or list(LINES)
ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv[1:] if a.startswith('--only=')), None)
CHECK = '--check' in sys.argv

VOICE = (
    "Voice: a young woman in her twenties, a flight controller at mission control talking to a colleague over the "
    "radio link to the Moon. Bright, clear and warm, calm and sure of herself, with a hint of a smile; never "
    "theatrical, never the tone of an advertisement. "
    "Pacing: brisk radio cadence, measured and flowing, a short breath between sentences. Articulate every "
    "consonant. When she names a button to press, she says its name a little slower and clearer. "
    "Pronounce 'JPL' as the three letters."
)
SPEAK = {
    'en': 'Speak in English.',
    'pt': 'Speak in Brazilian Portuguese, with a natural, neutral Brazilian accent. Say the names "Lunar Window", "Malapert Massif", "NASA", "Play" and "JPL Horizons" as they are said in English.',
    'es': 'Speak in neutral Latin American Spanish. Say the names "Lunar Window", "Malapert Massif", "NASA", "Play" and "JPL Horizons" as they are said in English.',
}


def post(url: str, body: bytes, kind: str) -> bytes:
    req = urllib.request.Request(url, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': kind})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def take(lang: str, name: str, text: str) -> Path:
    """The clean take of a line; asked for again only when its text changed."""
    path = TAKES / lang / f'{name}.wav'
    stamp = path.with_suffix('.txt')
    mark = hashlib.sha1((VOICE + SPEAK[lang] + text).encode()).hexdigest()
    if path.exists() and stamp.exists() and stamp.read_text() == mark:
        return path
    if not KEY:
        raise SystemExit(f'{lang}/{name}: no take and no OPENAI_API_KEY to ask for one')
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({'model': 'gpt-4o-mini-tts', 'voice': 'marin', 'input': text, 'instructions': f'{VOICE} {SPEAK[lang]}', 'response_format': 'wav'}).encode()
    path.write_bytes(post('https://api.openai.com/v1/audio/speech', body, 'application/json'))
    stamp.write_text(mark)
    return path


def decode(path: Path, filters: str) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-af', filters, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def band(a: np.ndarray, lo: float, hi: float) -> np.ndarray:
    f = np.fft.rfftfreq(a.size, 1 / RATE)
    return np.fft.irfft(np.fft.rfft(a) * ((f > lo) & (f < hi)), n=a.size).astype(np.float32)


def tone(freq: float, seconds: float, level: float) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    edge = np.minimum(1, np.minimum(t, seconds - t) / 0.006)
    return (np.sin(2 * np.pi * freq * t) * edge * level).astype(np.float32)


def radio(path: Path, seed: int) -> np.ndarray:
    """The take as it would come down a voice link: narrow band, compressed, a little noise, a tone at each end."""
    trim = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.05,areverse'
    link = 'highpass=f=300:poles=2,highpass=f=300:poles=2,lowpass=f=3400:poles=2,lowpass=f=3400:poles=2,acompressor=threshold=0.06:ratio=5:attack=4:release=90:makeup=3,asoftclip=type=tanh:threshold=0.85'
    voice = decode(path, f'{trim},{link}')
    voice *= 0.62 / max(1e-6, float(np.abs(voice).max()))
    gap = np.zeros(int(0.11 * RATE), dtype=np.float32)
    clip = np.concatenate([tone(2525, 0.25, 0.085), gap, voice, gap, tone(2475, 0.25, 0.085)])
    rng = np.random.default_rng(seed)
    hiss = band(rng.standard_normal(clip.size).astype(np.float32), 350, 3300)
    hiss *= 0.0075 / float(np.sqrt(np.mean(hiss**2)))
    t = np.arange(clip.size) / RATE
    hiss *= np.minimum(1, np.minimum(t, t[-1] - t) / 0.03)
    return clip + hiss


def write(a: np.ndarray, lang: str, name: str, text: str) -> Path:
    path = OUT / lang / f'{name}.mp3'
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '56k',
         '-metadata', f'title=Lunar Window guide, {name} ({lang})',
         '-metadata', 'artist=AI-generated voice (OpenAI text-to-speech)',
         '-metadata', 'comment=AI-generated voice (OpenAI text-to-speech) reading a script written for the project. Radio effect and tones added by code.',
         str(path)],
        input=a.astype(np.float32).tobytes(), check=True)
    return path


def plain(s: str) -> str:
    s = unicodedata.normalize('NFKD', s.lower())
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in s if not unicodedata.combining(c)).split())


def heard(path: Path, lang: str) -> str:
    edge = uuid.uuid4().hex
    parts = b''
    for field, value in (('model', 'gpt-4o-mini-transcribe'), ('language', lang), ('response_format', 'json')):
        parts += f'--{edge}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode()
    parts += f'--{edge}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + path.read_bytes() + f'\r\n--{edge}--\r\n'.encode()
    return json.loads(post('https://api.openai.com/v1/audio/transcriptions', parts, f'multipart/form-data; boundary={edge}'))['text']


def one(job: tuple[str, str, str, int]) -> str:
    lang, name, text, seed = job
    clean = take(lang, name, text)
    clip = radio(clean, seed)
    out = write(clip, lang, name, text)
    line = f'{lang}/{name}: {clip.size / RATE:5.2f} s, {out.stat().st_size / 1024:4.0f} kB'
    if CHECK and KEY:
        got = heard(clean, lang)
        score = difflib.SequenceMatcher(None, plain(text), plain(got)).ratio()
        line += f', heard {score:.2f}' + ('' if score > 0.93 else f'\n    said : {text}\n    heard: {got}')
    return line


jobs = [(lang, name, text, 7 + i) for lang in LANGS for i, (name, text) in enumerate(LINES[lang].items()) if not ONLY or name in ONLY]
with ThreadPoolExecutor(4) as pool:
    for line in pool.map(one, jobs):
        print(line)
