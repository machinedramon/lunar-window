"""Contact sheet of recorded frames.  python tools/contact.py <dir> <out.jpg> [columns] [width]"""
import sys
from pathlib import Path
from PIL import Image

src, out = Path(sys.argv[1]), sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
width = int(sys.argv[4]) if len(sys.argv) > 4 else 640
files = sorted(src.glob('*.jpg'))
first = Image.open(files[0])
height = round(first.height * width / first.width)
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (width + 6) + 6, rows * (height + 6) + 6), (70, 70, 70))
for i, f in enumerate(files):
    sheet.paste(Image.open(f).resize((width, height), Image.LANCZOS), (6 + (i % cols) * (width + 6), 6 + (i // cols) * (height + 6)))
sheet.save(out, quality=88)
print(out, sheet.size, len(files), 'frames')
