"""
qr-generator.py - create a print-ready QR code for the deployed AR experience.

Usage:
    pip install "qrcode[pil]"
    python qr-generator.py https://your-name.github.io/WebXR-AR/
    python qr-generator.py https://your-name.github.io/WebXR-AR/ -o poster.png --label "Scan to awaken the artifact"

Output: a PNG (default: qr-code.png) with the QR code and a short label
underneath, at a resolution suitable for printing (about 10 cm wide at 300 dpi).
"""

import argparse
import sys

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit('Missing packages. Install them with:  pip install "qrcode[pil]"')


def load_font(size):
    """Return a scalable font if one is available, else Pillow's default font."""
    for name in ("arial.ttf", "DejaVuSans.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10.1
    except TypeError:
        return ImageFont.load_default()


def make_qr(url, output, label):
    # 1. Build the QR code. Error correction "H" survives ~30 % damage,
    #    which helps with glossy prints, folds or bad lighting.
    qr = qrcode.QRCode(
        version=None,            # pick the smallest size that fits the URL
        error_correction=ERROR_CORRECT_H,
        box_size=30,             # pixels per QR "module"
        border=4,                # quiet zone (4 modules is the standard)
    )
    qr.add_data(url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    # 2. Add a white strip with a label and the URL below the code.
    width = qr_img.width
    title_font = load_font(width // 16)
    url_font = load_font(width // 32)
    strip = width // 5
    poster = Image.new("RGB", (width, qr_img.height + strip), "white")
    poster.paste(qr_img, (0, 0))

    draw = ImageDraw.Draw(poster)
    y = qr_img.height - width // 40
    for text, font, color in ((label, title_font, "#0b0f1a"), (url, url_font, "#4a5160")):
        text_width = draw.textlength(text, font=font)
        draw.text(((width - text_width) / 2, y), text, font=font, fill=color)
        y += int(font.size * 1.5) if hasattr(font, "size") else 20

    poster.save(output, dpi=(300, 300))
    print(f"QR code saved to {output}  ({poster.width}x{poster.height} px)")
    print(f"It opens: {url}")


def main():
    parser = argparse.ArgumentParser(description="Generate a printable QR code for the WebXR AR experience.")
    parser.add_argument("url", help="The deployed HTTPS URL, e.g. https://your-name.github.io/WebXR-AR/")
    parser.add_argument("-o", "--output", default="qr-code.png", help="Output PNG file (default: qr-code.png)")
    parser.add_argument("--label", default="Scan to enter AR", help="Text printed under the QR code")
    args = parser.parse_args()

    if not args.url.startswith("https://"):
        print("Warning: WebXR AR only works over HTTPS. Use your deployed https:// URL.")

    make_qr(args.url, args.output, args.label)


if __name__ == "__main__":
    main()
