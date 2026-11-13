// Loads Long-Horizon's pure modules into globalThis.HF for node tests, in dependency order.
// Usage: import { HF, load } from './load.mjs'; load('js/tasks/nback/gen.js');
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

// Pure modules that every test gets, in load order. Add new pure modules here as they appear.
const BASE = [
  'js/core/rng.js',
  'js/core/stats.js',
  'js/core/util.js',
  'js/core/schema.js',
];

export function load(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return false;
  require(abs);
  return true;
}

for (const rel of BASE) load(rel);

/** Load every pure module listed in js/manifest.json ("pure" array) — keeps node and browser order identical. */
export function loadAllPure() {
  const manPath = path.join(ROOT, 'js', 'manifest.json');
  if (!fs.existsSync(manPath)) return;
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  for (const rel of man.pure || []) load(rel);
}

export const HF = globalThis.HF;
