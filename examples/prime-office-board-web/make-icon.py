#!/usr/bin/env python3
"""ボードのアイコン（ホーム画面・タブのマーク）を作る。

アイコンは会社ごとに違うので、icon-192.png / icon-512.png を直に置き換えず、
icon-192.<名前>.png / icon-512.<名前>.png として作る。build-site.sh が
公開のときに、その会社のぶんを icon-192.png / icon-512.png に写す。
<名前>.png が無い会社は、リポジトリに入っている元のアイコンのまま。

    python3 make-icon.py libregate L "#1A56DB" "#FFFFFF"

字は1〜2文字まで。16px のタブでも読めるのは1文字。
"""
import sys
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
SIZES = (192, 512)


def draw(size, text, bg, fg):
    img = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(img)
    # 字の高さが辺の 58% になるところを二分探索で探す（字によって高さが違うため）
    lo, hi, best = 1, size * 2, None
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(FONT, mid)
        box = d.textbbox((0, 0), text, font=f)
        h = box[3] - box[1]
        if h <= size * 0.58:
            best, lo = (f, box), mid + 1
        else:
            hi = mid - 1
    f, box = best
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, font=f, fill=fg)
    return img


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 1
    name, text = argv[1], argv[2]
    bg = argv[3] if len(argv) > 3 else "#1A56DB"
    fg = argv[4] if len(argv) > 4 else "#FFFFFF"
    for s in SIZES:
        out = f"icon-{s}.{name}.png"
        draw(s, text, bg, fg).save(out)
        print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
