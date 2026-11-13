// Texts (js/content/*.js except sets.js): plain and honest — no banned words, no hash links, research numbers only
// from PLAN §1 (whitelist below), the glossary covers the terms the texts use, How to play covers every track,
// the strategy cards the planner names exist, and the claims match PLAN §6.
import { HF, loadAllPure } from './load.mjs';

loadAllPure();

const C = () => HF.content;
const FILES = ['lessons', 'glossary', 'howto', 'strategy', 'claims', 'research'];

/** Every user-facing string in HF.content.<name> (data only: functions are called with sample arguments). */
function strings(obj, out = [], seen = new Set()) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === 'string') { out.push(obj); return out; }
  if (typeof obj === 'function') {
    try { const v = obj(2, 'letter'); if (typeof v === 'string') out.push(v); } catch (e) { /* not a text function */ }
    return out;
  }
  if (typeof obj !== 'object' || seen.has(obj)) return out;
  seen.add(obj);
  if (typeof obj.kind === 'string' && typeof obj.effect === 'string') { out.push(obj.kind + ' \u2014 ' + obj.effect + ' (' + (obj.source || '') + ')'); return out; }
  for (const k of Object.keys(obj)) {
    if (k === 'SEQ' || k === 'items' || k === 'cells' || k === 'expect') continue;   // stimuli, not prose
    strings(obj[k], out, seen);
  }
  return out;
}
const BANNED = [/\biq boost/i, /boost (your|the) iq/i, /(raise|increase|improve)s? (your )?iq\b/i, /\bmastered\b/i, /\bsmarter\b/i, /\bgenius\b/i,
  /\bguarantee(d|s)?\b/i, /scientifically proven/i, /\bproven to\b/i, /supercharge/i, /limitless/i, /brain age/i, /\bstreaks?\b(?! (cut|repair))/i,
  /\bmissed\b/i, /\bfailed\b/i, /unlock your potential/i, /\bmiracle\b/i, /!/];

export default async function (t) {
  await t.test('all content modules load', () => { FILES.forEach(f => t.ok(C()[f], 'HF.content.' + f)); });

  await t.test('no banned words or hype in any text', () => {
    FILES.forEach(f => {
      strings(C()[f]).forEach(s => {
        BANNED.forEach(re => {
          if (f === 'research' && /streak/i.test(s) && re.source.indexOf('streak') >= 0) return; // the research page reports the streak study
          t.ok(!re.test(s), `${f}: banned ${re} in "${s.slice(0, 120)}"`);
        });
      });
    });
  });

  await t.test('no hash links or HTML in texts', () => {
    FILES.forEach(f => strings(C()[f]).forEach(s => {
      t.ok(s.indexOf('#/') < 0 && !/href=/.test(s) && !/<[a-z]/i.test(s), `${f}: no links or markup in "${s.slice(0, 80)}"`);
    }));
  });

  await t.test('IQ is only mentioned to say it is not promised', () => {
    FILES.forEach(f => strings(C()[f]).forEach(s => {
      if (/\bIQ\b/.test(s)) t.ok(/(no|not|cannot|about zero|instead of promising|never)/i.test(s), `${f}: IQ in a negative claim: "${s}"`);
    }));
  });

  await t.test('research numbers all come from PLAN §1 (and §0)', () => {
    // every number used in PLAN §1 that the research page may quote
    const ALLOWED = ['2026', '2025', '2024', '2023', '2022', '2020', '2019', '2018', '2017', '2016', '2015', '2014', '2013', '2012', '2011', '2009', '2008',
      '1991', '30', '15', '6', '27', '3', '.005', '.25', '.069', '.9', '131', '29', '28', '5', '20', '.62', '.2', '.3', '.01', '.06', '.42', '.29',
      '.038', '85', '.72', '.27', '107', '.5', '116', '0.3', '8', '2', '1', '4', '57', '50', '9', '33', '38', '24', '77', '145', '1029', '1052', '36',
      '.028'];   // .028: Cao 2026 letters recalled at follow-up (research/08 §6.3; Phase 4, SC-10)
    const R = C().research;
    const texts = strings({ s: R.SECTIONS, l: R.LIMITS, lead: R.LEAD });
    texts.forEach(s => {
      const nums = s.match(/\d*\.?\d+/g) || [];
      nums.forEach(n => t.ok(ALLOWED.indexOf(n) >= 0, `number ${n} in "${s.slice(0, 100)}" is not from PLAN §1`));
    });
    const all = texts.join(' ');
    ['p = .005', '.069', 'g = .62', 'g = .42', '.29', '.038', '.72', '.27', '107 children', '29 students', '28 students', '15 per group'].forEach(x => t.ok(all.indexOf(x) >= 0, 'cites ' + x));
    t.ok(/Cao/.test(all) && /Wang/.test(all), 'cites Cao 2026 and Wang 2025');
    t.ok(/no untrained control group/.test(all), 'states Cao had no untrained control');
    t.ok(/EEG changes alone/.test(all), 'states Wang’s reasoning claim rests on EEG alone');
    t.ok(R.LIMITS.length >= 3, 'limits listed');
    // Phase 4 science review: fidelity "as closely as each paper allows" (SC-03), the precise Cao follow-up (SC-10),
    // the Lab's own tests for Cao's two abilities (SC-11)
    t.ok(!/\bexactly as\b|as published/i.test(all), 'no "exactly as" / "as published" claim (SC-03)');
    t.ok(/as closely as/.test(all) && /choices are listed in the guide/.test(all), 'fidelity stated with its limits (SC-03)');
    t.ok(/letters recalled still favoured the executive group \(p = \.028, post-test and follow-up pooled\)/.test(all), 'Cao follow-up stated precisely (SC-10)');
    t.ok(/Long-Horizon calls it Equal Steps/.test(all), 'Wang trained a number-stream task, named Equal Steps by Long-Horizon (SC-10)');
    t.ok(!/both of their main outcomes/.test(all) && /spatial complex span/.test(all), 'the Lab measures the same abilities with its own tests (SC-11)');
  });

  await t.test('glossary covers the required terms and every term the texts use', () => {
    const G = C().glossary;
    ['match', 'lure', 'false press', 'level', 'tier', 'step', 'balanced accuracy', 'd′', 'near transfer', 'mid transfer', 'far transfer', 'noise band',
      'n-back', 'memory tape', 'working memory', 'rule card', 'warm-up', 'baseline', 'block', 'session', 'horizon']
      .forEach(term => t.ok(G.find(term), 'glossary: ' + term));
    const ids = G.ids();
    t.eq(new Set(ids).size, ids.length, 'unique ids');
    G.TERMS.forEach(x => (x.see || []).forEach(id => t.ok(G.get(id), x.id + ' see ' + id)));
    // terms that appear in lessons, How to play, strategy and research must be in the glossary
    const corpus = FILES.filter(f => f !== 'glossary').map(f => strings(C()[f]).join(' ')).join(' ').toLowerCase();
    const TECH = ['lure', 'false press', 'balanced accuracy', 'tier', 'warm-up', 'rule card', 'memory tape', 'baseline', 'noise band', 'near transfer',
      'mid transfer', 'far transfer', 'retest', 'active control', 'relational integration', 'complex span', 'updating', 'working memory', 'd′', 'horizon'];
    TECH.forEach(term => { if (corpus.indexOf(term) >= 0) t.ok(G.find(term) || G.find(term + 's') || (term === 'retest' && G.get('retest-gain')), 'used and defined: ' + term); });
    G.TERMS.forEach(x => t.ok(x.text.length > 40 && x.text.length < 420, x.id + ' definition length'));
  });

  await t.test('How to play covers every track, with the one key scheme', () => {
    const H = C().howto;
    HF.catalog.ids().forEach(id => t.ok(H.forTrack(id), 'how to play: ' + id));
    H.TASKS.forEach(x => {
      t.ok(x.goal && x.see && x.press.length && x.tips.length, x.id + ' complete');
      x.press.forEach(p => { if (!p.none) t.ok(['J', 'K', 'F'].indexOf(p.key) >= 0, x.id + ' key ' + p.key); });
      t.ok(H.text(x.trackIds[0]).indexOf(x.title) === 0, x.id + ' text()');
    });
    const dual = H.get('nback.dual');
    t.ok(dual.press.some(p => p.key === 'K') && dual.press.some(p => p.key === 'J'), 'Dual: J position, K sound');
    t.ok(H.get('rel.grid').press.some(p => p.key === 'F'), 'Grid: F = no');
    t.ok(!H.get('nback.plain').press.some(p => p.key === 'F'), 'Plain: no F key (doing nothing is the answer)');
  });

  await t.test('Long-Horizon copy (13 Nov 2026): the Horizon entry and one tie-in line per task, the same in How to play and the lessons', () => {
    const G = C().glossary, H = C().howto, L = C().lessons;
    t.eq(G.get('horizon').text, 'How many steps you can hold in mind and still work with. In n-back and Equal Steps it is how far back you compare (the n); in the relation grid, how many symbols you relate at once; in a complex span, the length of the list.', 'glossary: Horizon');
    t.eq(G.find('your horizon').id, 'horizon');
    const NB = 'n is your horizon: you keep the last n items in mind and update them with every new one.';
    const EX = 'You don’t just hold the steps, you work on them: ';
    const RE = 'You hold several items and the relation between them at once.';
    const SP = 'You hold a list while you do something else in between.';
    const want = { 'nback.plain': 'Here ' + NB, 'nback.dual': 'Here ' + NB, 'nback.transform': EX + 'each one changes by a rule before you compare.',
      'nback.arith': EX + 'each one changes by a rule before you compare.', 'nback.switch': EX + 'the cue says which feature to compare.',
      'rel.steps': RE, 'rel.grid': RE, 'rel.stream': RE, span: SP };
    H.TASKS.forEach(x => t.eq(x.horizon || null, want[x.id] || null, 'How to play ' + x.id));
    t.ok(H.text('nback.plain').split('\n')[2] === 'Here ' + NB, 'text() carries the line after the goal');
    const first = id => L.STEPS[id].find(st => st.type === 'page');
    t.eq(first('lesson.nback').body[1], 'That ' + NB, 'tutorial: n is your horizon');
    [['lesson.transform', 'nback.transform'], ['lesson.arith', 'nback.arith'], ['lesson.switch', 'nback.switch'], ['lesson.steps', 'rel.steps'],
      ['lesson.grid', 'rel.grid'], ['lesson.stream', 'rel.stream'], ['lesson.span', 'span']]
      .forEach(([lid, hid]) => t.eq(first(lid).body[1], want[hid], lid + ': the same line as How to play'));
    t.ok(!/long-horizon|horizon/i.test(first('lesson.dual').body.join(' ')), 'Dual: the tutorial already said it');
  });

  await t.test('strategy cards: the planner’s ids exist; Laine 2018 grouping is tested, the RI routine untested', () => {
    const S = C().strategy;
    const g = S.get('nback-grouping'), ri = S.get('ri-scan');
    t.ok(g && ri, 'nback-grouping and ri-scan exist (used by the Sprint planner)');
    t.eq(g.evidence, 'tested', 'grouping is tested');
    t.eq(g.source, 'Laine et al. 2018', 'grouping cites Laine 2018');
    t.ok(/faded/.test(g.note) && /did not carry over/.test(g.note), 'grouping states its limits');
    t.eq(ri.evidence, 'untested', 'RI scanning routine marked untested');
    S.CARDS.forEach(cd => { t.ok(cd.steps.length >= 2 && cd.example && cd.note, cd.id + ' complete'); cd.trackIds.forEach(id => t.ok(HF.catalog.get(id), cd.id + ' track ' + id)); });
    S.CARDS.filter(cd => cd.evidence === 'untested').forEach(cd => t.ok(!cd.source, cd.id + ' untested cards cite no study'));
  });

  await t.test('claims match PLAN §6 "Honest claims" and say what cannot be claimed', () => {
    const CL = C().claims;
    t.eq(CL.SUMMARY, 'You will get much better at the trained tasks, often better at very similar untrained ones, and maybe slightly better at other memory tasks. Most controlled studies find no effect on IQ or reasoning, and one person’s Lab change cannot show cause.', 'the PLAN §6 sentence');
    t.ok(CL.CAN.length >= 3 && CL.CANNOT.length >= 3, 'can and cannot lists');
    t.ok(CL.CANNOT.some(x => /IQ/.test(x.title + x.text)), 'cannot promise IQ gains');
    t.ok(CL.CANNOT.some(x => /cause/.test(x.title + x.text)), 'one person cannot show cause');
    t.eq(CL.can, CL.CAN, 'About alias can');
    t.eq(CL.cannot, CL.CANNOT, 'About alias cannot');
    t.ok(/not a medical device/.test(CL.NOT_MEDICAL) && /stays on this device/.test(CL.PRIVACY), 'medical and privacy notes');
  });
}
