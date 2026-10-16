// Delta 3 contrast pairs (design-spec.md Delta 3 section 7). `node contrast-delta3.mjs` prints every pair measured.
// Reuses the helpers of contrast-check.mjs; colours are the same anubis / anubis-light values (tokens.css).
import { hex, oklch, ratio, mix } from './contrast-check.mjs';

const themes = {
  anubis: {
    b1: hex('#131317'), b2: hex('#1a1a20'), bc: hex('#e8e6e1'), bcm: oklch([0.66509856, 0.007403, 31.090978]),
    gold: hex('#d4af37'), need: hex('#f97316'), err: hex('#ef4444'), done: hex('#16a34a'), run: hex('#3b82f6'),
  },
  'anubis-light': {
    b1: oklch([0.97788, 0.004, 56.375]), b2: oklch([0.93982, 0.007, 61.449]), bc: oklch([0.23574, 0.066, 313.189]),
    bcm: oklch([0.48955188, 0.044796, 348.478612]), gold: oklch([0.58, 0.132, 75]), need: hex('#8f5200'),
    err: hex('#b4232a'), done: hex('#13713a'), run: hex('#2a56c6'),
  },
};
let fail = 0;
for (const [name, t] of Object.entries(themes)) {
  const s0 = t.b1, s1 = mix(t.b2, 88, t.b1), s2 = t.b2;
  const rows = [];
  const text = (n, fg, bg) => rows.push([n, ratio(fg, bg), 4.5]);
  const ui = (n, fg, bg) => rows.push([n, ratio(fg, bg), 3]);
  text('value text (base-content) on tile surface-1', t.bc, s1);
  text('label / caption / reset line (muted) on tile surface-1', t.bcm, s1);
  text('label / caption (muted) on surface-0 (section header meta)', t.bcm, s0);
  text('state word Near limit / warn (need ink) on tile surface-1', t.need, s1);
  text('state word At limit / failed (err ink) on tile surface-1', t.err, s1);
  text('state word Room / Completed (done ink) on tile surface-1', t.done, s1);
  text('state word Running (run ink) on tile surface-1', t.run, s1);
  text('alert text (need ink) on surface-0', t.need, s0);
  ui('fill gold (bar, ring arc) vs tile surface-1', t.gold, s1);
  ui('fill need ink (80-94 %) vs tile surface-1', t.need, s1);
  ui('fill err ink (>= 95 %) vs tile surface-1', t.err, s1);
  ui('header toggle ring arc, gold vs surface-0', t.gold, s0);
  ui('header toggle ring arc, need ink vs surface-0', t.need, s0);
  ui('header toggle ring arc, err ink vs surface-0', t.err, s0);
  ui('toggle dot, err ink vs surface-0', t.err, s0);
  console.log(`\n== ${name} ==`);
  for (const [n, r, need] of rows) { const ok = r >= need; if (!ok) fail++; console.log(r.toFixed(2).padStart(6) + ':1  ' + (ok ? 'pass' : 'FAIL') + ' (>= ' + need + ')  ' + n); }
  const trk = mix(t.bc, 22, s1);
}
console.log(fail ? `\n${fail} pair(s) below the criterion` : '\nall pairs pass');
process.exitCode = fail ? 1 : 0;
