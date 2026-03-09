#!/usr/bin/env python3

from pathlib import Path

from PIL import Image


PNG_SIZES = [1024, 512, 256, 128, 64, 32, 16]
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]


def get_square_crop_box(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("Icon image is fully transparent.")

    left, top, right, bottom = bbox
    crop_size = max(right - left, bottom - top)
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2

    crop_left = int(round(center_x - (crop_size / 2)))
    crop_top = int(round(center_y - (crop_size / 2)))
    crop_left = max(0, min(crop_left, image.width - crop_size))
    crop_top = max(0, min(crop_top, image.height - crop_size))

    return (
        crop_left,
        crop_top,
        crop_left + crop_size,
        crop_top + crop_size,
    )


def resized_icon(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    icon_dir = Path(__file__).resolve().parents[1] / "icons"
    master_path = icon_dir / "coview_master.png"

    master = Image.open(master_path).convert("RGBA")
    crop_box = get_square_crop_box(master)
    cropped_master = master.crop(crop_box)
    cropped_master.save(master_path)

    print(
        f"Cropped {master_path.name}: {master.width}x{master.height} -> "
        f"{cropped_master.width}x{cropped_master.height} using box {crop_box}"
    )

    rendered_icons: dict[int, Image.Image] = {}
    for size in PNG_SIZES:
        rendered = resized_icon(cropped_master, size)
        rendered.save(icon_dir / f"coview_{size}.png", format="PNG")
        rendered_icons[size] = rendered
        print(f"Wrote coview_{size}.png")

    rendered_icons[1024].save(icon_dir / "coview.icns", format="ICNS")
    rendered_icons[1024].save(icon_dir / "coview.ico", format="ICO", sizes=ICO_SIZES)
    print("Wrote coview.icns")
    print("Wrote coview.ico")


if __name__ == "__main__":
    main()
