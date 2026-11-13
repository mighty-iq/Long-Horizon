#!/usr/bin/env node
// Long-Horizon — rewrite the generated blocks of index.html and sw.js from js/manifest.json. MIT licence.
//
//   node tools/sync-index.mjs            write index.html and sw.js (missing files are skipped with a warning)
//   node tools/sync-index.mjs --check    exit 1 if index.html or sw.js is out of date (writes nothing)
//   node tools/sync-index.mjs --strict   exit 1 if any listed file is missing
//   node tools/sync-index.mjs --all      list missing files too (they will 404 until they exist)
//
// index.html blocks:
//   <!-- hf:head -->        theme-color (light/dark) and the favicon (kept in every build)
//   <!-- hf:pages-only -->  <link rel="manifest"> + apple-touch-icon (GitHub Pages; dropped by build-single)
//   <!-- hf:css -->         manifest.css → <link rel="stylesheet">
//   <!-- hf:scripts -->     manifest.pure, then asset scripts, then manifest.dom → <script src>
// Asset scripts = manifest.assets if present, else every assets/audio/*.js (sorted), e.g. the letter clips.
// sw.js block (// hf:sw:start … // hf:sw:end): VERSION = content hash of every precached file (the new
// index.html included) and PRECACHE = ['./', 'index.html', 'manifest.webmanifest', css…, scripts…, icons…].
// Exported for tools/build-single.mjs: ROOT, readManifest(), resolveLists({ all }), replaceBlock().
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CSS = ['css/app.css', 'css/tasks.css'];
const THEME = { light: '#EEF2F1', dark: '#0B1D29' }; // --hf-bg of the light and dark themes (css/app.css)

export function readManifest(root = ROOT) {
  const p = path.join(root, 'js', 'manifest.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function assetScripts(root, man) {
  if (Array.isArray(man.assets)) return man.assets.slice();
  const dir = path.join(root, 'assets', 'audio');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => 'assets/audio/' + f);
}

/** → { css: [rel], scripts: [rel], missing: [rel] } in load order */
export function resolveLists({ root = ROOT, all = false } = {}) {
  const man = readManifest(root);
  const css = Array.isArray(man.css) ? man.css : DEFAULT_CSS;
  const scripts = [...(man.pure || []), ...assetScripts(root, man), ...(man.dom || [])];
  const missing = [];
  const keep = rel => {
    if (fs.existsSync(path.join(root, rel))) return true;
    missing.push(rel);
    return all;
  };
  const seen = new Set();
  const uniq = list => list.filter(x => (seen.has(x) ? false : (seen.add(x), true)));
  return { css: uniq(css).filter(keep), scripts: uniq(scripts).filter(keep), missing };
}

export function replaceBlock(html, name, inner) {
  const re = new RegExp(`(<!-- hf:${name}:start -->)([\\s\\S]*?)(<!-- hf:${name}:end -->)`);
  if (!re.test(html)) throw new Error(`index.html has no <!-- hf:${name}:start --> … <!-- hf:${name}:end --> markers`);
  return html.replace(re, (_, a, _old, b) => `${a}\n${inner}${inner ? '\n' : ''}${b}`);
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel));
function icons(root) {
  const dir = path.join(root, 'assets', 'icons');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => 'assets/icons/' + f);
}

function headBlock(root) {
  const out = [
    `<meta name="theme-color" content="${THEME.light}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${THEME.dark}" media="(prefers-color-scheme: dark)">`
  ];
  if (exists(root, 'assets/icons/favicon-32.png')) out.push('<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32.png">');
  return out.join('\n');
}

function pagesBlock(root) {
  const out = [];
  if (exists(root, 'manifest.webmanifest')) out.push('<link rel="manifest" href="manifest.webmanifest">');
  if (exists(root, 'assets/icons/apple-touch-icon.png')) out.push('<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">');
  return out.join('\n');
}

/** generated sw.js block for the given (new) index.html text */
export function swBlock(root, css, scripts, indexHtml) {
  const files = ['index.html', ...(exists(root, 'manifest.webmanifest') ? ['manifest.webmanifest'] : []), ...css, ...scripts, ...icons(root)];
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f + '\0');
    h.update(f === 'index.html' ? indexHtml : fs.readFileSync(path.join(root, f)));
    h.update('\0');
  }
  const version = h.digest('hex').slice(0, 12);
  const list = ['./', ...files];
  return { version, count: list.length, text: `var VERSION = '${version}';\nvar PRECACHE = ${JSON.stringify(list, null, 2).replace(/"/g, "'")};` };
}

function replaceSw(text, inner) {
  const re = /(\/\/ hf:sw:start[^\n]*\n)([\s\S]*?)(\/\/ hf:sw:end)/;
  if (!re.test(text)) throw new Error('sw.js has no // hf:sw:start … // hf:sw:end markers');
  return text.replace(re, (_, a, _old, b) => `${a}${inner}\n${b}`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const { css, scripts, missing } = resolveLists({ all: args.has('--all') });
  const file = path.join(ROOT, 'index.html');
  const before = fs.readFileSync(file, 'utf8');
  let html = before;
  html = replaceBlock(html, 'head', headBlock(ROOT));
  html = replaceBlock(html, 'pages-only', pagesBlock(ROOT));
  html = replaceBlock(html, 'css', css.map(h => `<link rel="stylesheet" href="${h}">`).join('\n'));
  html = replaceBlock(html, 'scripts', scripts.map(s => `<script src="${s}"></script>`).join('\n'));

  const swFile = path.join(ROOT, 'sw.js');
  let swBefore = null, swAfter = null, sw = null;
  if (fs.existsSync(swFile)) {
    swBefore = fs.readFileSync(swFile, 'utf8');
    sw = swBlock(ROOT, css.filter(c => exists(ROOT, c)), scripts.filter(s => exists(ROOT, s)), html);
    swAfter = replaceSw(swBefore, sw.text);
  }

  if (missing.length) {
    console.warn(`sync-index: ${missing.length} listed file(s) missing${args.has('--all') ? ' (listed anyway)' : ' (skipped)'}:`);
    for (const m of missing) console.warn('  - ' + m);
  }
  if (args.has('--strict') && missing.length) process.exit(1);
  if (args.has('--check')) {
    const stale = [];
    if (html !== before) stale.push('index.html');
    if (swAfter !== null && swAfter !== swBefore) stale.push('sw.js');
    if (stale.length) { console.error(`sync-index: ${stale.join(' and ')} out of date (run node tools/sync-index.mjs)`); process.exit(1); }
    console.log('sync-index: index.html and sw.js are up to date');
    return;
  }
  if (html !== before) fs.writeFileSync(file, html);
  if (swAfter !== null && swAfter !== swBefore) fs.writeFileSync(swFile, swAfter);
  console.log(`sync-index: ${css.length} stylesheet(s), ${scripts.length} script(s)${html === before ? ' (index.html unchanged)' : ' written'}` +
    (sw ? `; sw.js ${sw.count} precached, version ${sw.version}${swAfter === swBefore ? ' (unchanged)' : ''}` : '; no sw.js'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
