// Long-Horizon — summarise simulation JSON outputs (node tests/sim/summarize.mjs <dir with *.json>) as Markdown tables.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '.';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
const f3 = x => (typeof x === 'number' && isFinite(x)) ? x.toFixed(3) : '—';
const rows = [], checks = [], levels = [];
for (const f of files) {
  const rep = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const c of rep.checks || []) checks.push(`| ${rep.scenario} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.name} | ${String(c.detail || '').replace(/\|/g, '/').slice(0, 220)} |`);
  for (const [k, r] of Object.entries(rep.results || {})) {
    const s = r.settle || (r.free && r.free.onLevel);
    if (s) rows.push(`| ${k} | ${rep.n} × ${rep.days} d | ${f3(s.mean)} | ${s.n} | ${Object.entries(s.byTask || {}).map(([t, v]) => `${t} ${f3(v)}`).join(', ')} | ${f3(s.perLearnerMedian)} | ${r.model ? f3(r.model.rmse) : '—'} | ${r.seconds != null ? r.seconds.toFixed(0) + ' s' : ''} |`);
    if (r.summary && r.summary.medianLevel) levels.push(`| ${k} | ${r.summary.blocksMedian} | ${r.summary.countedMedian} | ${Object.entries(r.summary.medianLevel).slice(0, 8).map(([t, v]) => `${t}: ${v}`).join('; ')} |`);
  }
}
console.log('| scenario | learners × days | settled BA | blocks | by task | per-learner median | model RMSE | time |\n|---|---|---|---|---|---|---|---|\n' + rows.join('\n'));
console.log('\n| scenario | median blocks | median counted sessions | median level (tracks with ≥ 6 rated blocks) |\n|---|---|---|---|\n' + levels.join('\n'));
console.log('\n| scenario | result | check | detail |\n|---|---|---|---|\n' + checks.join('\n'));
