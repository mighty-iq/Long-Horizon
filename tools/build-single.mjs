#!/usr/bin/env node
// Long-Horizon — single-file build: inline every stylesheet and script of index.html into dist/long-horizon.html. MIT licence.
//
//   node tools/build-single.mjs [--out dist/long-horizon.html] [--force]
//
// - Checks first that the <script>/<link> order in index.html matches js/manifest.json (same resolution as
//   tools/sync-index.mjs); a mismatch is an error (run sync-index) unless --force.
// - Inlines manifest.css in order as <style> (a missing CSS file is a warning, not an error), then pure modules,
//   asset scripts (assets/audio/*.js, e.g. letter clips) and dom modules as <script>; '</script' inside a script
//   becomes '<\/script' (likewise '</style' in CSS).
// - Drops the <!-- hf:pages-only --> block (web manifest, apple-touch-icon: GitHub Pages only); inlines local
//   <link rel="icon"> files as data: URIs and drops other local links, so the file needs nothing beside it.
// - Sets window.HF_SINGLE_FILE = true first, so app.js never registers the service worker from this file.
// - Prints the output size.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readManifest, resolveLists, replaceBlock } from './sync-index.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const outArg = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : 'dist/long-horizon.html';
const OUT = path.resolve(ROOT, outArg);

function fail(msg) { console.error('build-single: ' + msg); process.exit(1); }
function between(html, name) {
  const m = new RegExp(`<!-- hf:${name}:start -->([\\s\\S]*?)<!-- hf:${name}:end -->`).exec(html);
  if (!m) fail(`index.html has no hf:${name} markers`);
  return m[1];
}
const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const man = readManifest();
const { css, scripts, missing } = resolveLists({});
const missingCss = (Array.isArray(man.css) ? man.css : []).filter(c => missing.includes(c));
const missingJs = missing.filter(m => !missingCss.includes(m));
for (const c of missingCss) console.warn(`build-single: warning: stylesheet ${c} is missing (skipped)`);
for (const s of missingJs) console.warn(`build-single: warning: script ${s} is listed in the manifest but missing (skipped)`);

// 1. index.html must match the manifest
const pageScripts = [...between(indexHtml, 'scripts').matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);
const pageCss = [...between(indexHtml, 'css').matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g)].map(m => m[1]);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
if (!same(pageScripts, scripts) || !same(pageCss, css)) {
  const msg = 'index.html does not match js/manifest.json (run: node tools/sync-index.mjs)\n' +
    `  scripts in page: ${pageScripts.length}, expected: ${scripts.length}\n` +
    `  first difference: page "${pageScripts.find((s, i) => s !== scripts[i]) || '-'}" vs manifest "${scripts.find((s, i) => s !== pageScripts[i]) || '-'}"\n` +
    `  css in page: [${pageCss.join(', ')}], expected: [${css.join(', ')}]`;
  if (!force) fail(msg);
  console.warn('build-single: warning (--force): ' + msg);
}

// 2. inline
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let unsafe = 0;
const styleBlock = css.map(rel => `<style data-file="${rel}">\n${read(rel).replace(/<\/style/gi, '<\\/style')}\n</style>`).join('\n');
// marks the single file: js/app.js never registers the service worker from it
const scriptBlock = '<script>window.HF_SINGLE_FILE = true;</script>\n' + scripts.map(rel => {
  let code = read(rel);
  if (/<!--/.test(code)) { unsafe++; console.warn(`build-single: warning: ${rel} contains "<!--" (harmless unless followed by <script)`); }
  code = code.replace(/<\/script/gi, '<\\/script');
  return `<script data-file="${rel}">\n${code}\n</script>`;
}).join('\n');

let html = indexHtml;
html = replaceBlock(html, 'pages-only', '');
html = replaceBlock(html, 'css', styleBlock);
html = replaceBlock(html, 'scripts', scriptBlock);
html = html.replace(/<link\b[^>]*>/gi, tag => {
  const href = /href="([^"]+)"/i.exec(tag);
  if (!href || /^(https?:|data:)/i.test(href[1])) return tag;
  if (/rel="(shortcut )?icon"/i.test(tag)) {
    const file = path.join(ROOT, href[1]);
    if (fs.existsSync(file)) {
      const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return tag.replace(href[0], `href="data:${mime};base64,${fs.readFileSync(file).toString('base64')}"`);
    }
  }
  console.warn(`build-single: dropped local link ${tag}`);
  return '';
});
const stamp = `<!-- Long-Horizon single-file build ${new Date().toISOString().slice(0, 10)} · code MIT, texts CC BY-SA 4.0 · https://discord.gg/chmr -->`;
html = html.replace(/^<!doctype html>/i, m => m + '\n' + stamp);

// 3. verify nothing local is still referenced
const leftovers = [...html.matchAll(/<script\b[^>]*\ssrc="(?!https?:)[^"]*"/gi), ...html.matchAll(/<link\b[^>]*\srel="stylesheet"[^>]*\shref="(?!https?:|data:)[^"]*"/gi)];
if (leftovers.length) fail('local references left in the build: ' + leftovers.map(m => m[0]).join(', '));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
const bytes = Buffer.byteLength(html);
console.log(`build-single: ${path.relative(ROOT, OUT)} — ${css.length} stylesheet(s), ${scripts.length} script(s), ` +
  `${bytes.toLocaleString('en-US')} bytes (${(bytes / 1024).toFixed(1)} KB)${unsafe ? `, ${unsafe} warning(s)` : ''}`);
