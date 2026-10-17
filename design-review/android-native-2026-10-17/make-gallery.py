"""Assemble actual emulator captures; no synthetic UI or business data is generated."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "emulator" / "412-default"
FONT = Path("C:/Windows/Fonts/msyh.ttc")


def gallery(name, cells, columns=4):
    width, height, gap = 250, 542, 18
    rows = (len(cells) + columns - 1) // columns
    result = Image.new("RGB", (columns * (width + gap) + gap, rows * (height + 58 + gap) + gap), "#E9E7E1")
    draw = ImageDraw.Draw(result)
    font = ImageFont.truetype(str(FONT), 17)
    for i, (label, path) in enumerate(cells):
        x, y = gap + (i % columns) * (width + gap), gap + (i // columns) * (height + 58 + gap)
        draw.text((x, y + 5), label, fill="#262621", font=font)
        with Image.open(path) as source:
            source = source.convert("RGB")
            source.thumbnail((width, height), Image.Resampling.LANCZOS)
            result.paste(source, (x + (width - source.width) // 2, y + 42))
    result.save(ROOT / name, optimize=True)


if __name__ == "__main__":
    gallery("android-native-day-night.png", [
        (f"{theme_label} · {label}", SHOTS / f"{theme}-{key}.png")
        for theme, theme_label in [("light", "日间"), ("dark", "夜间")]
        for key, label in [("records", "记录"), ("library", "资料库"), ("tasks", "任务"), ("account", "我的")]
    ])
    gallery("android-native-reading-sharing.png", [
        (label, SHOTS / f"{key}.png") for label, key in [
            ("原生阅读", "light-reader"), ("夜间代码与表格", "dark-reader-code-table"),
            ("富文本编辑与键盘", "light-record-editor"), ("分享存为记录", "light-share-record")]
    ])
