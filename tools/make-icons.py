"""Long-Horizon app icons from the logo mark (the horizon drawn by HF.ui.c.mark() in js/ui/components.js).

Writes assets/icons/: icon-192.png, icon-512.png (purpose "any"), icon-maskable-512.png (mark inside the central
80 % safe zone), apple-touch-icon.png (180 px, opaque) and favicon-32.png. Deep ink background #0F2A3A
(--hf-deep), strokes #E4EDF0 (dark-theme ink), the half sun in the accent #E69F00 (--hf-accent).
Run: python3 tools/make-icons.py   (Chromium via Playwright; one browser, closed at the end)
"""
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'icons'
BG, INK, BULB = '#0F2A3A', '#E4EDF0', '#E69F00'
# Same geometry as mark() in js/ui/components.js (viewBox 0 0 32 32, stroke 2, round caps and joins): the horizon line,
# a half sun resting on it, three rungs that lengthen toward the viewer.
MARK = ('<path d="M3.5 14.5h25" stroke-width="2.25"/>'
        f'<path d="M10 14.5a6 6 0 0 1 12 0z" fill="{BULB}" stroke="none"/>'
        '<path d="M12.5 18.5h7"/>'
        '<path d="M9.5 22h13"/>'
        '<path d="M6.5 25.5h19"/>')
# (file, pixels, viewBox): the mark spans about 27 × 18 units around (16, 17.5); a larger viewBox = more margin.
# The viewBoxes are centred on the mark (y 8.5 to 26.5 with the stroke), not on the 32-unit box.
ICONS = [
    ('icon-192.png', 192, '-3 -1.5 38 38'),
    ('icon-512.png', 512, '-3 -1.5 38 38'),
    ('icon-maskable-512.png', 512, '-8 -6.5 48 48'),
    ('apple-touch-icon.png', 180, '-4 -2.5 40 40'),
    ('favicon-32.png', 32, '-1 0.5 34 34'),
]


def page_html(px, view):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{px}" height="{px}" fill="none" '
           f'stroke="{INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{MARK}</svg>')
    return (f'<!doctype html><html><body style="margin:0;background:{BG}">'
            f'<div style="width:{px}px;height:{px}px;background:{BG}">{svg}</div></body></html>')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            page = b.new_page(device_scale_factor=1)
            for name, px, view in ICONS:
                page.set_viewport_size({'width': max(px, 64), 'height': max(px, 64)})
                page.set_content(page_html(px, view))
                page.screenshot(path=str(OUT / name), clip={'x': 0, 'y': 0, 'width': px, 'height': px})
                print(f'{name}: {px}×{px}, {(OUT / name).stat().st_size} bytes')
        finally:
            b.close()


if __name__ == '__main__':
    main()
