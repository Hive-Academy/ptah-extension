// Builds cassette-stats.json and cassette-charts.html from the extraction
// cassette recorded by `extraction-record-v1` (TASK_2026_620).
//
// Usage: node generate-cassette-charts.mjs [path/to/extraction.v1.jsonl]
// Default path: %LOCALAPPDATA%/ptah-mcp-bench/cassettes/memory/extraction.v1.jsonl
//
// Only aggregates are written. The cassette itself is private bench data and
// stays outside the repository. The numbers are descriptive: the suite never
// scored this cassette, so nothing here is an accuracy result.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cassettePath =
  process.argv[2] ??
  join(
    process.env.LOCALAPPDATA ?? '',
    'ptah-mcp-bench',
    'cassettes',
    'memory',
    'extraction.v1.jsonl',
  );

const entries = readFileSync(cassettePath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const drafts = entries.flatMap((e) => e.response?.drafts ?? []);

const countBy = (items, keyOf) => {
  const counts = new Map();
  for (const item of items) {
    for (const key of [keyOf(item)].flat()) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
};
const sortedDesc = (counts) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([label, value]) => ({ label: String(label), value }));

const perCall = countBy(entries, (e) => (e.response?.drafts ?? []).length);
const maxPerCall = Math.max(...perCall.keys());
const draftsPerCall = Array.from({ length: maxPerCall + 1 }, (_, n) => ({
  label: String(n),
  value: perCall.get(n) ?? 0,
}));

const salience = drafts.map((d) => d.salienceHint).sort((a, b) => a - b);
const quantile = (p) => salience[Math.floor(p * (salience.length - 1))];
const binWidth = 0.05;
const salienceBins = Array.from({ length: 20 }, (_, i) => ({
  label: `${(i * binWidth).toFixed(2)}–${((i + 1) * binWidth).toFixed(2)}`,
  value: salience.filter(
    (s) => s >= i * binWidth && (i === 19 ? s <= 1 : s < (i + 1) * binWidth),
  ).length,
}));

const stats = {
  source: 'extraction-record-v1 cassette (extraction.v1.jsonl), unscored',
  model: [...new Set(entries.map((e) => e.model))].join(', '),
  calls: entries.length,
  drafts: drafts.length,
  distinctSubjects: new Set(drafts.map((d) => d.subject)).size,
  draftsWithFiles: drafts.filter((d) => (d.files ?? []).length > 0).length,
  responseStatus: sortedDesc(countBy(entries, (e) => e.response?.status)),
  salience: { p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9) },
  draftsPerCall,
  kind: sortedDesc(countBy(drafts, (d) => d.kind)),
  type: sortedDesc(countBy(drafts, (d) => d.type)),
  salienceBins,
  topConcepts: sortedDesc(countBy(drafts, (d) => d.concepts ?? [])).slice(0, 12),
};

writeFileSync(
  join(here, 'cassette-stats.json'),
  JSON.stringify(stats, null, 2) + '\n',
);

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

/** Vertical column chart, one series. */
function columnChart(id, rows, xTitle, yTitle) {
  const w = 640;
  const h = 260;
  const m = { top: 16, right: 12, bottom: 44, left: 44 };
  const pw = w - m.left - m.right;
  const ph = h - m.top - m.bottom;
  const max = Math.max(...rows.map((r) => r.value));
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const tickStep =
    [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  const niceMax = Math.ceil(max / tickStep) * tickStep || 1;
  const ticks = Array.from(
    { length: Math.round(niceMax / tickStep) + 1 },
    (_, i) => i * tickStep,
  );
  const step = pw / rows.length;
  const barW = Math.max(4, step - 3);
  const y = (v) => m.top + ph - (v / niceMax) * ph;
  const labelEvery = rows.length > 10 ? 2 : 1;
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${m.left}" x2="${w - m.right}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="tick" x="${m.left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  }
  rows.forEach((r, i) => {
    const x = m.left + i * step + (step - barW) / 2;
    const top = y(r.value);
    const bh = m.top + ph - top;
    const radius = Math.min(4, bh / 2, barW / 2);
    // Rounded data-end only; flat at the baseline.
    const path =
      bh > 0
        ? `M${x},${m.top + ph}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + barW - radius}Q${x + barW},${top} ${x + barW},${top + radius}V${m.top + ph}Z`
        : '';
    svg += `<g class="hit" tabindex="0" data-tip="${escapeHtml(`${xTitle} ${r.label}: ${r.value}`)}">`;
    svg += `<rect x="${m.left + i * step}" y="${m.top}" width="${step}" height="${ph}" fill="transparent"/>`;
    if (path) svg += `<path class="mark" d="${path}"/>`;
    svg += `</g>`;
    if (i % labelEvery === 0) {
      svg += `<text class="tick" x="${x + barW / 2}" y="${m.top + ph + 16}" text-anchor="middle">${escapeHtml(r.label)}</text>`;
    }
  });
  svg += `<line class="axis" x1="${m.left}" x2="${w - m.right}" y1="${m.top + ph}" y2="${m.top + ph}"/>`;
  svg += `<text class="axis-title" x="${m.left + pw / 2}" y="${h - 6}" text-anchor="middle">${escapeHtml(xTitle)}</text>`;
  svg += `<text class="axis-title" transform="translate(12 ${m.top + ph / 2}) rotate(-90)" text-anchor="middle">${escapeHtml(yTitle)}</text>`;
  return svg + `</svg>`;
}

/** Horizontal bar chart, one series, direct value labels. */
function barChart(id, rows, valueTitle) {
  const w = 640;
  const rowH = 26;
  const m = { top: 8, right: 56, bottom: 8, left: 150 };
  const h = m.top + m.bottom + rows.length * rowH;
  const pw = w - m.left - m.right;
  const max = Math.max(...rows.map((r) => r.value));
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title">`;
  rows.forEach((r, i) => {
    const yTop = m.top + i * rowH + 4;
    const bh = rowH - 8;
    const bw = (r.value / max) * pw;
    const radius = Math.min(4, bh / 2, bw / 2);
    const path = `M${m.left},${yTop}H${m.left + bw - radius}Q${m.left + bw},${yTop} ${m.left + bw},${yTop + radius}V${yTop + bh - radius}Q${m.left + bw},${yTop + bh} ${m.left + bw - radius},${yTop + bh}H${m.left}Z`;
    svg += `<g class="hit" tabindex="0" data-tip="${escapeHtml(`${r.label}: ${r.value} ${valueTitle}`)}">`;
    svg += `<rect x="0" y="${m.top + i * rowH}" width="${w}" height="${rowH}" fill="transparent"/>`;
    svg += `<path class="mark" d="${path}"/></g>`;
    svg += `<text class="label" x="${m.left - 8}" y="${yTop + bh / 2 + 4}" text-anchor="end">${escapeHtml(r.label)}</text>`;
    svg += `<text class="value" x="${m.left + bw + 6}" y="${yTop + bh / 2 + 4}">${r.value}</text>`;
  });
  svg += `<line class="axis" x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${h - m.bottom}"/>`;
  return svg + `</svg>`;
}

function table(rows, labelTitle, valueTitle) {
  return `<details><summary>Table view</summary><table><thead><tr><th>${escapeHtml(labelTitle)}</th><th>${escapeHtml(valueTitle)}</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr><td>${escapeHtml(r.label)}</td><td>${r.value}</td></tr>`,
    )
    .join('')}</tbody></table></details>`;
}

function figure(id, title, note, svg, rows, labelTitle, valueTitle) {
  return `<figure><h2 id="${id}-title">${escapeHtml(title)}</h2><p class="note">${note}</p>${svg}${table(rows, labelTitle, valueTitle)}</figure>`;
}

const tile = (value, label) =>
  `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memory extraction cassette: descriptive statistics</title>
<style>
  :root {
    --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --grid: #e1e0d9;
    --mark: #2a78d6; --tile: #f3f2ee;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --grid: #2c2c2a;
      --mark: #3987e5; --tile: #242423;
    }
  }
  body { background: var(--surface); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  .note, .lede { color: var(--ink-2); }
  .status { border-left: 3px solid var(--ink-2); padding: .5rem .75rem; color: var(--ink-2); background: var(--tile); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .75rem; margin: 1.5rem 0; }
  .tile { background: var(--tile); border-radius: 8px; padding: .75rem; }
  .tile-value { font-size: 1.5rem; font-weight: 600; }
  .tile-label { color: var(--ink-2); font-size: .85rem; }
  figure { margin: 2.5rem 0; }
  svg { width: 100%; height: auto; overflow: visible; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .axis { stroke: var(--ink-2); stroke-width: 1; }
  .tick, .label, .value, .axis-title { fill: var(--ink-2); font-size: 11px; }
  .label, .value { fill: var(--ink); font-size: 12px; }
  .mark { fill: var(--mark); }
  .hit { cursor: default; outline: none; }
  .hit:hover .mark, .hit:focus .mark { opacity: .8; }
  #tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--surface); padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none; }
  details { margin-top: .5rem; color: var(--ink-2); }
  table { border-collapse: collapse; margin-top: .5rem; }
  td, th { padding: 2px 12px 2px 0; text-align: left; border-bottom: 1px solid var(--grid); }
</style>
</head>
<body>
<h1>Memory extraction cassette: descriptive statistics</h1>
<p class="lede">${escapeHtml(stats.calls)} recorded <code>extract</code> calls to <code>${escapeHtml(stats.model)}</code> from the <code>extraction-record-v1</code> run of the Ptah memory/skills benchmark (TASK_2026_620).</p>
<p class="status"><strong>Status: unscored.</strong> The recording stopped at the runner's 4-hour host timeout before the suite scored any case, and the fact matcher is not validated yet. These charts describe what the model returned. They do not measure accuracy, recall or precision.</p>
<div class="tiles">
${tile(stats.calls, 'recorded calls')}
${tile(stats.drafts, 'memory drafts')}
${tile(stats.distinctSubjects, 'distinct subjects')}
${tile(stats.draftsWithFiles, 'drafts that cite a file')}
${tile(stats.salience.p50.toFixed(2), 'median salience hint')}
</div>
${figure('per-call', 'Drafts per call', 'How many memory drafts each extraction call returned.', columnChart('per-call', stats.draftsPerCall, 'Drafts', 'Calls'), stats.draftsPerCall, 'Drafts', 'Calls')}
${figure('kind', 'Draft kind', 'The <code>kind</code> field of each draft.', barChart('kind', stats.kind, 'drafts'), stats.kind, 'Kind', 'Drafts')}
${figure('type', 'Draft type', 'The <code>type</code> field of each draft.', barChart('type', stats.type, 'drafts'), stats.type, 'Type', 'Drafts')}
${figure('salience', 'Salience hint', `The model's own importance estimate per draft, in bins of 0.05. p10 ${stats.salience.p10}, p50 ${stats.salience.p50}, p90 ${stats.salience.p90}.`, columnChart('salience', stats.salienceBins, 'Salience', 'Drafts'), stats.salienceBins, 'Salience bin', 'Drafts')}
${figure('concepts', 'Top 12 concepts', 'Concept tags across all drafts. The seeded sessions are fixture data, so these tags reflect the fixtures.', barChart('concepts', stats.topConcepts, 'drafts'), stats.topConcepts, 'Concept', 'Drafts')}
<div id="tip" role="status"></div>
<script>
  const tip = document.getElementById('tip');
  const show = (g, x, y) => { tip.textContent = g.dataset.tip; tip.style.display = 'block'; tip.style.left = (x + 12) + 'px'; tip.style.top = (y + 12) + 'px'; };
  for (const g of document.querySelectorAll('.hit')) {
    g.addEventListener('mousemove', (e) => show(g, e.clientX, e.clientY));
    g.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); show(g, r.left, r.top); });
    g.addEventListener('blur', () => { tip.style.display = 'none'; });
  }
</script>
</body>
</html>
`;

writeFileSync(join(here, 'cassette-charts.html'), html);
console.log(
  `wrote cassette-stats.json and cassette-charts.html (${stats.calls} calls, ${stats.drafts} drafts)`,
);
