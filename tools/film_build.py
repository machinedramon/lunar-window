"""Assembles the demo film of one language from its recorded frames and its soundtrack, with its subtitle file.

    python -X utf8 tools/film_build.py [en|pt|es]

Reads video/frames (English) or video/frames-<lang>, video/audio.<lang>.wav and video/voice/<lang>/marks.json;
writes video/lunar-window-demo.<lang>.mp4, a light 720p copy beside it and video/lunar-window-demo.<lang>.srt.
A frame that film_check.py reports as a one-frame dip is rebuilt from its two neighbours first (the original is
kept in video/replaced/). Needs ffmpeg, numpy and Pillow.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
lang = sys.argv[1] if len(sys.argv) > 1 else 'en'
# FRAMES=video/frames-4k TAG=.4k builds video/lunar-window-demo.<lang>.4k.mp4 from frames recorded with SCALE=2.5.
tag = os.environ.get('TAG', '')
frames = ROOT / os.environ.get('FRAMES', 'video/frames' if lang == 'en' else f'video/frames-{lang}')
marks = json.loads((ROOT / f'video/voice/{lang}/marks.json').read_text(encoding='utf-8'))
seconds = marks['cuts']['end']
count = round(seconds * 30)
files = [frames / f'{i:05d}.jpg' for i in range(count)]
missing = [f.name for f in files if not f.exists()]
assert not missing, f'{len(missing)} frames missing, first {missing[:3]}'

# ----- one-frame dips: a single frame much darker or brighter than both neighbours, which agree with each other
levels = []
for f in files:
    a = np.asarray(Image.open(f).convert('L').resize((192, 108))).astype(float)
    levels.append([a.mean(), a[:54, :96].mean(), a[:54, 96:].mean(), a[54:, :96].mean(), a[54:, 96:].mean()])
m = np.array(levels)
fixed = []
# KEEP=515,516 leaves those frames as they were recorded: a fast zoom can look like a dip to this test.
keep = {int(x) for x in os.environ.get('KEEP', '').split(',') if x}
for i in range(1, len(m) - 1):
    if i not in keep and any(abs(m[i, k] - m[i - 1, k]) > 4 and abs(m[i, k] - m[i + 1, k]) > 4 and abs(m[i - 1, k] - m[i + 1, k]) < 2 for k in range(m.shape[1])):
        (ROOT / 'video/replaced').mkdir(exist_ok=True)
        shutil.copy(files[i], ROOT / f'video/replaced/{lang}_{i:05d}_original.jpg')
        Image.blend(Image.open(files[i - 1]), Image.open(files[i + 1]), 0.5).save(files[i], quality=95)
        fixed.append(i)
print(f'{lang}: {count} frames, {seconds} s; frames rebuilt from their neighbours: {fixed or "none"}')

# ----- the film
note = {
    'en': 'Narration: AI-generated voice (OpenAI text-to-speech); its radio effect and tones are added by code. Music synthesised by code. Every picture is the tool itself running.',
    'pt': 'Narração: voz gerada por IA (OpenAI text-to-speech). Música sintetizada por código. Toda imagem é a própria ferramenta em funcionamento.',
    'es': 'Narración: voz generada por IA (OpenAI text-to-speech). Música sintetizada por código. Toda imagen es la propia herramienta en funcionamiento.',
}[lang]
out = ROOT / f'video/lunar-window-demo.{lang}{tag}.mp4'
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', '30', '-start_number', '0', '-i', str(frames / '%05d.jpg'), '-i', str(ROOT / f'video/audio.{lang}.wav'),
                '-frames:v', str(count), '-c:v', 'libx264', '-preset', 'medium' if tag else 'slow', '-crf', '16' if tag else '15', '-pix_fmt', 'yuvj420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
                '-metadata', 'title=Lunar Window', '-metadata', f'comment={note}', '-metadata', f'language={lang}', '-t', str(seconds), str(out)], check=True)
small = ROOT / f'video/lunar-window-demo.{lang}{tag}.preview.mp4'
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(out), '-vf', 'scale=1280:720', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(small)], check=True)


# ----- the subtitles, for the player
def stamp(x: float) -> str:
    ms = round(x * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


rows = [(a, b, text) for a, b, text in marks['subtitles']]
closing = marks['closing']
rows.append((closing['name'], closing['end'] + 0.3, f'Lunar Window. {closing["text"]}'))
(ROOT / f'video/lunar-window-demo.{lang}{tag}.srt').write_text(''.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{text}\n\n' for i, (a, b, text) in enumerate(rows, 1)), encoding='utf-8', newline='\n')
print(out.name, f'{out.stat().st_size / 1e6:.1f} MB;', small.name, f'{small.stat().st_size / 1e6:.1f} MB')
