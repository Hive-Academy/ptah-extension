import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
let s = readFileSync('.ptah/specs/TASK_2026_580_9f77/visual-c22/run.mjs', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a); s = s.replace(a, b); };
rep("return { phase: d.dataset.phase, w: rect.width,", "const ringOver = over(bc, bg[3] > 0 ? over(bg, cardBg) : cardBg); return { phase: d.dataset.phase, w: rect.width, ringOverFill: +cr(ringOver, cardBg).toFixed(2), ringVsCard: +cr(over(bc, cardBg), cardBg).toFixed(2),");
rep("r.phaseTruncated = txt.scrollWidth > txt.clientWidth + 1;", "r.phaseTruncated = txt.scrollWidth > txt.clientWidth + 1; const ov = row.querySelector('[data-testid=\"task-card-session-overflow\"]'); r.overflow = ov ? { text: ov.textContent.trim(), label: ov.getAttribute('aria-label') } : null; r.phaseH = txt.getBoundingClientRect().height; r.countText = cnt.textContent.trim(); r.line1Overflow = cnt.parentElement.scrollWidth - cnt.parentElement.clientWidth;");
rep("visual-c22')", "visual-c22/round1')");
mkdirSync('.ptah/specs/TASK_2026_580_9f77/visual-c22/round1', { recursive: true });
writeFileSync('.ptah/specs/TASK_2026_580_9f77/visual-c22/run2.mjs', s);
