#!/usr/bin/env python3

from pathlib import Path

from PIL import Image, ImageDraw


SIZE = 1024
CORNER_RADIUS = 220
PADDING = 56


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def build_gradient_background() -> Image.Image:
    start = (20, 79, 255)
    end = (11, 24, 67)
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        color = (
            lerp(start[0], end[0], t),
            lerp(start[1], end[1], t),
            lerp(start[2], end[2], t),
            255,
        )
        for x in range(SIZE):
            pixels[x, y] = color
    return image


def apply_rounded_mask(image: Image.Image) -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (PADDING, PADDING, SIZE - PADDING, SIZE - PADDING),
        radius=CORNER_RADIUS,
        fill=255,
    )
    image.putalpha(mask)
    return image


def draw_coview_mark(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    outer_ring = (240, 240, 784, 784)
    inner_ring = (300, 300, 724, 724)
    center_dot = (432, 432, 592, 592)
    highlight = (620, 338, 708, 426)

    draw.ellipse(outer_ring, fill=(255, 255, 255, 32), outline=(255, 255, 255, 244), width=66)
    draw.ellipse(inner_ring, outline=(255, 255, 255, 210), width=12)
    draw.ellipse(center_dot, fill=(255, 255, 255, 245))
    draw.ellipse(highlight, fill=(255, 255, 255, 220))


def main() -> None:
    output_dir = Path(__file__).resolve().parents[1] / "build"
    output_dir.mkdir(parents=True, exist_ok=True)

    icon_image = build_gradient_background()
    icon_image = apply_rounded_mask(icon_image)
    draw_coview_mark(icon_image)

    png_path = output_dir / "icon.png"
    icns_path = output_dir / "icon.icns"

    icon_image.save(png_path, format="PNG")
    icon_image.save(icns_path, format="ICNS")

    print(f"Generated {png_path}")
    print(f"Generated {icns_path}")


if __name__ == "__main__":
    main()
