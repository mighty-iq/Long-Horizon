// Minimal test runner: node tests/unit/run.mjs [filter]
// Each *.test.mjs exports default async function(t) using t.test(name, fn), t.eq, t.ok, t.near.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs') && f.includes(filter)).sort();

let pass = 0, fail = 0;
const failures = [];

function makeT(file) {
  const t = {
    async test(name, fn) {
      try { await fn(); pass++; }
      catch (e) { fail++; failures.push(`${file} › ${name}: ${e && e.message ? e.message : e}`); }
    },
    ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); },
    eq(a, b, msg) {
      const sa = JSON.stringify(a), sb = JSON.stringify(b);
      if (sa !== sb) throw new Error((msg ? msg + ': ' : '') + `expected ${sb}, got ${sa}`);
    },
    near(a, b, tol, msg) {
      if (!(Math.abs(a - b) <= (tol ?? 1e-9))) throw new Error((msg ? msg + ': ' : '') + `expected ${b} ± ${tol}, got ${a}`);
    },
    throws(fn, msg) { let threw = false; try { fn(); } catch (e) { threw = true; } if (!threw) throw new Error(msg || 'expected throw'); }
  };
  return t;
}

for (const f of files) {
  const mod = await import(pathToFileURL(path.join(here, f)).href);
  if (typeof mod.default === 'function') await mod.default(makeT(f));
}

console.log(`unit: ${pass} passed, ${fail} failed (${files.length} files)`);
if (failures.length) { for (const x of failures.slice(0, 50)) console.log('  FAIL ' + x); process.exit(1); }
