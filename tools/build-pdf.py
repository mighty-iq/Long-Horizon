#!/usr/bin/env python3
"""Long-Horizon: build the guide PDF from docs/guide/guide.html with Playwright Chromium. MIT licence.

    python3 tools/build-pdf.py [--out docs/Long-Horizon-Guide.pdf] [--repo URL] [--preview DIR] [--strict]

Needs Python 3.9+, Playwright with Chromium (pip install playwright && python3 -m playwright install chromium)
and pypdf (pip install pypdf). Optional: fontTools (pip install fonttools) for compact TrueType font embedding
(see FONT_FACES), and poppler-utils (pdftotext, pdffonts, pdftoppm) for the layout checks, the font list and
page previews.

What it does, with ONE headless Chromium that is always closed at the end:
  1. Opens guide.html from disk with print media. Screenshot slots (<figure class="shot" data-shot="NAME">) get
     docs/guide/assets/shots/NAME.png when that file exists; missing shots are listed and keep their placeholder.
     --repo URL fills the repository links (otherwise <meta name="long-horizon-repo"> or the Discord fallback).
  2. Measures every figure, box, table row and code block against the A4 content box: anything taller than a
     page would be split whatever the CSS says.
  3. Prints a first pass, reads the PDF's named destinations to find the page of every chapter, writes those
     page numbers into the contents list, then prints the final pass (A4, backgrounds, tagged PDF, document
     outline, clickable links) and adds title/author metadata.
  4. Checks the result: page count, external and internal link annotations, no heading left alone at the
     bottom of a page, no screenshot placeholder separated from its caption, no blank page, embedded fonts.
Exit code 1 on a failed run, or with --strict when a layout check fails.
"""
import argparse
import io
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUIDE = ROOT / 'docs' / 'guide' / 'guide.html'
SHOTS_DIR = ROOT / 'docs' / 'guide' / 'assets' / 'shots'
DEFAULT_OUT = ROOT / 'docs' / 'Long-Horizon-Guide.pdf'

# Keep in step with the @page rule in docs/guide/guide.css (millimetres).
PAGE_MM = {'w': 210.0, 'h': 297.0, 'top': 19.0, 'right': 23.0, 'bottom': 21.0, 'left': 23.0}
PX_PER_MM = 96 / 25.4
PT_PER_MM = 72 / 25.4
CONTENT_W_PX = round((PAGE_MM['w'] - PAGE_MM['left'] - PAGE_MM['right']) * PX_PER_MM)
CONTENT_H_PX = (PAGE_MM['h'] - PAGE_MM['top'] - PAGE_MM['bottom']) * PX_PER_MM
FOOTER_TOP_PT = (PAGE_MM['h'] - PAGE_MM['bottom'] + 1.0) * PT_PER_MM   # text below this line is the running footer

METADATA = {
    '/Title': 'Long-Horizon: the guide',
    '/Author': 'Long-Horizon contributors (Chimera community)',
    '/Subject': 'Long-Horizon, a free working memory trainer with a built-in lab. Hold more in mind. Keep it straight. What it does, how to use it, and what the research says. Built by the Chimera community on Discord: https://discord.gg/chmr',
    '/Keywords': 'working memory, n-back, executive n-back, relational integration, transfer, Long-Horizon, Chimera',
}


def say(msg=''):
    print(msg, flush=True)


# ---------------------------------------------------------------- browser side
JS_PREPARE = r"""
([repo, shots]) => {
  const out = { filled: [], missing: [] };
  if (repo) {
    const meta = document.querySelector('meta[name="long-horizon-repo"]');
    if (meta) meta.setAttribute('content', repo);
    const shown = repo.replace(/^https?:\/\//, '').replace(/\/$/, '');
    document.querySelectorAll('a[data-repo]').forEach(a => { a.setAttribute('href', repo); a.textContent = shown; });
  }
  document.querySelectorAll('figure.shot[data-shot]').forEach(f => {
    const name = f.dataset.shot, img = f.querySelector('img');
    if (!img) return;
    if (img.getAttribute('src')) { out.filled.push(name); return; }
    if (shots[name]) { img.setAttribute('src', shots[name]); out.filled.push(name); } else out.missing.push(name);
  });
  return out;
}
"""

JS_MEASURE = r"""
([contentH]) => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const describe = el => {
    const sec = el.closest('section');
    const shot = el.dataset && el.dataset.shot ? ' ' + el.dataset.shot : '';
    const label = el.querySelector && el.querySelector('.label, figcaption, caption, th, td');
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + shot +
      ' in #' + (sec ? sec.id : '?') + (label ? ' (“' + norm(label.textContent).slice(0, 48) + '”)' : '');
  };
  const tall = [];
  document.querySelectorAll('figure, .box, pre, .closing, .ch-head, tr, .shots').forEach(el => {
    if (el.closest('.cover')) return;
    const h = el.getBoundingClientRect().height;
    if (h > contentH - 2) tall.push({ what: describe(el), mm: +(h / (96 / 25.4)).toFixed(1) });
  });
  const heads = [...document.querySelectorAll('h2, h3, h4')]
    .filter(h => !h.closest('.cover, .toc-page, .box, .closing, figure'))
    .map(h => ({ tag: h.tagName.toLowerCase(), text: norm(h.textContent), section: (h.closest('section') || {}).id || '' }));
  const figs = [...document.querySelectorAll('figure')].map(f => ({
    shot: f.dataset.shot || null,
    ph: f.querySelector('img[src]') ? null : norm((f.querySelector('.ph b') || {}).textContent),
    caption: norm((f.querySelector('figcaption') || {}).textContent),
  }));
  const toc = [...document.querySelectorAll('.toc a[href^="#"]')].map(a => a.getAttribute('href').slice(1));
  return { tall, heads, figs, toc };
}
"""

JS_SET_TOC = r"""
([pages]) => {
  const toc = document.querySelector('.toc');
  let set = 0;
  document.querySelectorAll('.toc a[href^="#"]').forEach(a => {
    const id = a.getAttribute('href').slice(1), p = a.querySelector('.p');
    if (p && pages[id]) { p.textContent = String(pages[id]); set++; }
  });
  if (toc) toc.classList.toggle('no-pages', set === 0);
  return set;
}
"""


# ---------------------------------------------------------------- fonts
# Chromium's PDF backend embeds CFF-based .otf fonts and variable fonts as Type 3 glyph procedures (large files,
# poorer screen rendering). With fontTools installed, the build makes static, subset TrueType copies of the guide's
# fonts in memory (variable fonts instanced, CFF outlines converted to quadratic curves) and injects them as
# @font-face data URIs, so the PDF embeds ordinary TrueType subsets. Nothing is written to the repository. All
# three families are under the SIL Open Font License, which allows embedding in documents.
FONT_FACES = [  # (CSS family, weight, style, file names to look for, variable-font axis values)
    ('Lora', 400, 'normal', ['Lora-Variable.ttf', 'Lora[wght].ttf', 'Lora-Regular.ttf'], {'wght': 400}),
    ('Lora', 600, 'normal', ['Lora-Variable.ttf', 'Lora[wght].ttf', 'Lora-SemiBold.ttf'], {'wght': 600}),
    ('Lora', 400, 'italic', ['Lora-Italic-Variable.ttf', 'Lora-Italic[wght].ttf', 'Lora-Italic.ttf'], {'wght': 400}),
    ('Lora', 600, 'italic', ['Lora-Italic-Variable.ttf', 'Lora-Italic[wght].ttf', 'Lora-SemiBoldItalic.ttf'], {'wght': 600}),
    ('Inter', 400, 'normal', ['Inter-Regular.ttf', 'Inter-Regular.otf'], None),
    ('Inter', 400, 'italic', ['Inter-Italic.ttf', 'Inter-Italic.otf'], None),
    ('Inter', 600, 'normal', ['Inter-SemiBold.ttf', 'Inter-SemiBold.otf'], None),
    ('Inter', 700, 'normal', ['Inter-Bold.ttf', 'Inter-Bold.otf'], None),
    ('Inter Display', 700, 'normal', ['InterDisplay-Bold.ttf', 'InterDisplay-Bold.otf'], None),
]
FONT_DIRS = ['/usr/share/fonts', '/usr/local/share/fonts', '~/.local/share/fonts', '~/.fonts', '/Library/Fonts',
             '~/Library/Fonts', '/System/Library/Fonts', 'C:/Windows/Fonts']


def find_font_files():
    index = {}
    for d in FONT_DIRS:
        root = pathlib.Path(os.path.expanduser(d))
        if root.is_dir():
            for f in root.rglob('*'):
                if f.suffix.lower() in ('.ttf', '.otf'):
                    index.setdefault(f.name, f)
    return index


def _cff_to_truetype(font):
    """Convert a CFF-flavoured OpenType font to TrueType outlines in place (quadratic curves)."""
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import newTable
    order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyphs = {}
    for name in order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyphs[name] = pen.glyph()
    font['loca'] = newTable('loca')
    font['glyf'] = glyf = newTable('glyf')
    glyf.glyphOrder = order
    glyf.glyphs = glyphs
    for tag in ('CFF ', 'CFF2', 'VORG'):
        if tag in font:
            del font[tag]
    glyf.compile(font)
    hmtx = font['hmtx']
    for name, g in glyf.glyphs.items():
        if hasattr(g, 'xMin'):
            hmtx[name] = (hmtx[name][0], g.xMin)
    font['maxp'] = maxp = newTable('maxp')
    maxp.tableVersion = 0x00010000
    for attr in ('maxZones', 'maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs',
                 'maxStackElements', 'maxSizeOfInstructions'):
        setattr(maxp, attr, 1 if attr == 'maxZones' else 0)
    maxp.maxComponentElements = max([len(getattr(g, 'components', []) or []) for g in glyf.glyphs.values()] + [0])
    maxp.compile(font)
    post = font['post']
    post.formatType, post.extraNames, post.mapping, post.glyphOrder = 2.0, [], {}, order
    font.sfntVersion = '\x00\x01\x00\x00'


def prepare_fonts(texts):
    """CSS @font-face rules with static TrueType subsets, or ('', reason) when that is not possible."""
    try:
        import base64
        from fontTools import subset
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
    except ImportError:
        return '', 'fontTools is missing (pip install fonttools); using the system fonts'
    index = find_font_files()
    chars = {c for t in texts for c in t} | {chr(c) for c in range(0x20, 0x7f)} | set('…’‘“”–—·×≈≥≤→←↔≠√−′²')
    unicodes = sorted(ord(c) for c in chars if ord(c) >= 0x20)
    rules, made = [], 0
    for family, weight, style, names, axes in FONT_FACES:
        path = next((index[n] for n in names if n in index), None)
        if path is None:
            return '', f'font file for {family} {weight} {style} not found; using the system fonts'
        font = TTFont(str(path), fontNumber=0)
        if 'fvar' in font:
            font = instancer.instantiateVariableFont(font, axes or {}, inplace=False)
        opts = subset.Options()
        opts.layout_features, opts.name_IDs, opts.name_languages = ['*'], ['*'], ['*']
        opts.notdef_outline, opts.glyph_names, opts.hinting = True, False, False
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        if 'CFF ' in font or font.sfntVersion == 'OTTO':
            _cff_to_truetype(font)
        buf = io.BytesIO()
        font.save(buf)
        data = base64.b64encode(buf.getvalue()).decode('ascii')
        rules.append(f'@font-face {{ font-family: "{family}"; font-weight: {weight}; font-style: {style}; '
                     f'src: url(data:font/ttf;base64,{data}) format("truetype"); }}')
        made += 1
    return '\n'.join(rules), f'{made} static TrueType faces prepared'


JS_FONTS_OK = r"""
() => [...document.fonts].filter(f => f.status === 'loaded' || f.status === 'error')
  .map(f => f.family.replace(/["']/g, '') + ' ' + f.weight + ' ' + f.style + ': ' + f.status)
"""


def shot_map():
    """{name: relative URL} for every screenshot file that exists."""
    out = {}
    if SHOTS_DIR.is_dir():
        for f in sorted(SHOTS_DIR.iterdir()):
            if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
                out.setdefault(f.stem, 'assets/shots/' + f.name)
    return out


def print_pdf(page):
    return page.pdf(print_background=True, prefer_css_page_size=True, tagged=True, outline=True)


# ---------------------------------------------------------------- PDF side
def dest_pages(pdf_bytes):
    """{named destination: 1-based page} from the PDF (Chromium names them after the link targets)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    reader = PdfReader(io.BytesIO(pdf_bytes))
    out = {}
    try:
        for name, dest in reader.named_destinations.items():
            try:
                out[str(name).lstrip('/')] = reader.get_destination_page_number(dest) + 1
            except Exception:
                pass
    except Exception:
        pass
    return out


def norm_text(s):
    s = unicodedata.normalize('NFKC', s or '')
    s = s.replace('­', '').replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    s = s.replace('–', '-').replace('—', '-')
    return re.sub(r'\s+', ' ', s).strip().lower()


def pdf_lines(pdf_path):
    """[(page, y_top_pt, y_bottom_pt, text)] for every text line above the running footer, or None."""
    if not shutil.which('pdftotext'):
        return None
    xml = subprocess.run(['pdftotext', '-bbox-layout', str(pdf_path), '-'], capture_output=True, text=True, check=True).stdout
    xml = re.sub(r'<!DOCTYPE[^>]*>', '', xml)
    xml = re.sub(r'\sxmlns="[^"]+"', '', xml, count=1)
    root = ET.fromstring(xml)
    lines = []
    for pno, page in enumerate(root.iter('page'), start=1):
        for line in page.iter('line'):
            words = [w.text or '' for w in line.iter('word')]
            y0, y1 = float(line.get('yMin')), float(line.get('yMax'))
            if y0 >= FOOTER_TOP_PT:
                continue
            lines.append((pno, y0, y1, ' '.join(words)))
    lines.sort(key=lambda t: (t[0], t[1]))
    return lines


def find_text(lines, start, target, min_prefix=14):
    """Index of the first line at or after start that begins `target` (a normalised string), else -1."""
    key = target[:max(min_prefix, min(len(target), 40))]
    for i in range(start, len(lines)):
        t = norm_text(lines[i][3])
        if not t:
            continue
        if t.startswith(key) or (len(t) >= min_prefix and key.startswith(t)) or (len(t) >= 10 and target.startswith(t)):
            return i
    return -1


def check_layout(lines, heads, figs, n_pages):
    errors, warnings = [], []
    # 1. headings: something must follow on the same page
    cursor = 0
    for h in heads:
        target = norm_text(h['text'])
        i = find_text(lines, cursor, target)
        if i < 0:
            warnings.append(f"heading not found in the PDF text: {h['tag']} “{h['text']}”")
            continue
        page = lines[i][0]
        consumed, j = norm_text(lines[i][3]), i
        while len(consumed) < len(target) and j + 1 < len(lines) and lines[j + 1][0] == page and \
                target.startswith((consumed + ' ' + norm_text(lines[j + 1][3])).strip()[:len(target)]):
            j += 1
            consumed = (consumed + ' ' + norm_text(lines[j][3])).strip()
        after = [l for l in lines[j + 1:] if l[0] == page]
        if not after:
            errors.append(f"orphaned heading at the bottom of page {page}: {h['tag']} “{h['text']}”")
        elif len(after) < 2 and h['tag'] != 'h2':
            warnings.append(f"only one line after heading on page {page}: “{h['text']}”")
        cursor = j + 1
    # 2. screenshot placeholders: the slot name (a line of its own) and the caption on the same page
    for f in figs:
        if not f['ph'] or not f['caption']:
            continue
        ph = norm_text(f['ph'])
        i = next((n for n, l in enumerate(lines) if norm_text(l[3]) == ph), -1)
        k = find_text(lines, max(i, 0), norm_text(f['caption']))
        if i < 0 or k < 0:
            warnings.append(f"figure text not found in the PDF: {f['shot'] or f['caption'][:40]}")
        elif lines[i][0] != lines[k][0]:
            errors.append(f"figure split across pages {lines[i][0]}–{lines[k][0]}: {f['shot']}")
    # 3. blank pages (cover excepted)
    with_text = {l[0] for l in lines}
    for p in range(2, n_pages + 1):
        if p not in with_text:
            warnings.append(f"page {p} has no text (blank?)")
    return errors, warnings


def link_report(pdf_path):
    from pypdf import PdfReader
    reader = PdfReader(str(pdf_path))
    uris, internal = [], 0
    for page in reader.pages:
        for annot in page.get('/Annots') or []:
            a = annot.get_object()
            if a.get('/Subtype') != '/Link':
                continue
            action = a.get('/A')
            action = action.get_object() if action is not None else None
            if action is not None and action.get('/URI'):
                uris.append(str(action.get('/URI')))
            elif a.get('/Dest') is not None or (action is not None and action.get('/S') == '/GoTo'):
                internal += 1
    return len(reader.pages), uris, internal, bool(reader.outline)


def set_metadata(pdf_path):
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return False
    writer = PdfWriter(clone_from=PdfReader(str(pdf_path)))
    writer.add_metadata(METADATA)
    tmp = pdf_path.with_suffix('.tmp.pdf')
    with open(tmp, 'wb') as fh:
        writer.write(fh)
    os.replace(tmp, pdf_path)
    return True


def font_list(pdf_path):
    if not shutil.which('pdffonts'):
        return None
    out = subprocess.run(['pdffonts', str(pdf_path)], capture_output=True, text=True).stdout.splitlines()[2:]
    names = set()
    for row in out:
        name = row.split()[0] if row.split() else ''
        names.add(re.sub(r'^[A-Z]{6}\+', '', name))
    return sorted(n for n in names if n)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=str(DEFAULT_OUT), help='output PDF (default docs/Long-Horizon-Guide.pdf)')
    ap.add_argument('--repo', default='', help='repository URL for the "Get Long-Horizon" links')
    ap.add_argument('--preview', default='', help='also write low-resolution PNG previews of every page into this folder')
    ap.add_argument('--strict', action='store_true', help='exit 1 when a layout check fails')
    ap.add_argument('--system-fonts', action='store_true', help='skip the static TrueType conversion (fonts may embed as Type 3)')
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('build-pdf: Playwright is missing: pip install playwright && python3 -m playwright install chromium')
    if not GUIDE.is_file():
        sys.exit(f'build-pdf: {GUIDE} not found')
    out = pathlib.Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    shots = shot_map()
    if args.system_fonts:
        font_css, font_note = '', 'system fonts (--system-fonts)'
    else:
        try:
            font_css, font_note = prepare_fonts([GUIDE.read_text(encoding='utf-8'),
                                                 (GUIDE.parent / 'guide.css').read_text(encoding='utf-8')])
        except Exception as e:  # never let font preparation break the build
            font_css, font_note = '', f'font preparation failed ({e!r}); using the system fonts'

    def open_guide(page, with_fonts):
        page.goto(GUIDE.as_uri(), wait_until='load')
        if with_fonts:
            page.add_style_tag(content=font_css)
        prepared = page.evaluate(JS_PREPARE, [args.repo.strip(), shots])
        page.evaluate('document.fonts.ready.then(() => true)')
        return prepared

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': CONTENT_W_PX, 'height': 1123})
            page.emulate_media(media='print')
            prep = open_guide(page, bool(font_css))
            if font_css:
                status = page.evaluate(JS_FONTS_OK)
                if not status or any(x.endswith('error') for x in status):
                    font_note = 'embedded fonts did not load (' + '; '.join(status or ['none']) + '); using the system fonts'
                    prep = open_guide(page, False)
            page.wait_for_function('Array.from(document.images).every(i => !i.getAttribute("src") || i.complete)', timeout=20000)
            info = page.evaluate(JS_MEASURE, [CONTENT_H_PX])
            pass1 = print_pdf(page)
            pages = dest_pages(pass1)
            toc_set = 0
            if pages is None:
                say('note: pypdf is missing, so the contents list has no page numbers (pip install pypdf)')
            else:
                toc_set = page.evaluate(JS_SET_TOC, [{k: v for k, v in pages.items() if k in info['toc']}])
            final = print_pdf(page)
        finally:
            browser.close()

    tmp = out.with_suffix('.part.pdf')
    tmp.write_bytes(final)
    os.replace(tmp, out)
    meta_ok = set_metadata(out)

    # ---- report
    say(f'build-pdf: wrote {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out} ({out.stat().st_size / 1024:.0f} KB)')
    say(f'screenshots: {len(prep["filled"])} filled, {len(prep["missing"])} placeholders' +
        (f' ({", ".join(prep["missing"])})' if prep['missing'] else ''))
    say(f'contents: {toc_set} of {len(info["toc"])} page numbers set' + ('' if meta_ok else '; metadata not set (pypdf missing)'))
    say('font embedding: ' + font_note)
    errors, warnings = [], []
    for t in info['tall']:
        errors.append(f"taller than a page ({t['mm']} mm), will be split: {t['what']}")
    try:
        n_pages, uris, internal, has_outline = link_report(out)
        hosts = sorted({re.sub(r'^https?://([^/]+).*$', r'\1', u) for u in uris})
        say(f'pages: {n_pages}; links: {len(uris)} external ({len(set(uris))} unique; hosts: {", ".join(hosts)}), '
            f'{internal} internal; outline: {"yes" if has_outline else "no"}')
        if not any('discord.gg/chmr' in u for u in uris):
            errors.append('no link to https://discord.gg/chmr in the PDF')
        if internal == 0:
            warnings.append('no internal links (the contents list should link to the chapters)')
    except ImportError:
        n_pages = None
        say('note: pypdf is missing, so links and pages were not checked')
    lines = pdf_lines(out)
    if lines is None:
        say('note: pdftotext is missing, so headings and figures were not checked')
    elif n_pages:
        e, w = check_layout(lines, info['heads'], info['figs'], n_pages)
        errors += e
        warnings += w
    fonts = font_list(out)
    if fonts is not None:
        say('fonts: ' + ', '.join(fonts))
    if args.preview and shutil.which('pdftoppm'):
        prev = pathlib.Path(args.preview)
        prev.mkdir(parents=True, exist_ok=True)
        subprocess.run(['pdftoppm', '-r', '40', '-png', str(out), str(prev / 'page')], check=True)
        say(f'previews: {prev}')
    for w in warnings:
        say('warning: ' + w)
    for e in errors:
        say('ERROR: ' + e)
    say('layout checks: ' + ('passed' if not errors else f'{len(errors)} problem(s)'))
    if errors and args.strict:
        sys.exit(1)


if __name__ == '__main__':
    main()
