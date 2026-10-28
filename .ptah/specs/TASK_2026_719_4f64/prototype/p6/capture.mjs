// P6 prototype screenshot harness (static HTML only).
// Usage: node capture.mjs [--ids=M4a,A12] [--solo]
//   default      : fixture frames (all, or only --ids) at their gallery width; LIVE frames skipped
//   --solo       : the r-* frames rendered alone in a REAL viewport of 245 / 260 (device scale 2 = 200% zoom of 520) / 320 / 360 px
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire('D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/package.json');
const { chromium } = require('@playwright/test');
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const out = path.join(dir, 'shots');
fs.mkdirSync(out, { recursive: true });
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const only = idsArg ? idsArg.slice(6).split(',') : null;
const solo = process.argv.includes('--solo');
const url = (q) => 'file:///' + path.join(dir, 'index.html').replace(/\\/g, '/') + q;
const b = await chromium.launch();
for (const [name, theme] of [['dark', ''], ['light', 'theme=light']]) {
  if (!solo) {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    await p.goto(url(theme ? '?' + theme : ''));
    for (const f of await p.$$('figure')) {
      const id = await f.getAttribute('data-id');
      if (id.startsWith('r-') || id.startsWith('live-')) continue;
      if (only && !only.includes(id)) continue;
      await (await f.$('.frame')).screenshot({ path: path.join(out, `${id}-${name}.png`) });
    }
    await p.close();
  } else {
    for (const [w, dsf] of [[245, 1], [260, 2], [320, 1], [360, 1]]) {
      for (const key of ['r-list', 'r-detail', 'r-main', 'r-lane', 'r-lane-open']) {
        const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: dsf });
        await p.goto(url(`?solo=${key}${theme ? '&' + theme : ''}`));
        const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        console.log(name, w, key, 'scrollWidth', m.sw, 'clientWidth', m.cw, m.sw > m.cw ? 'OVERFLOW' : 'ok');
        await p.screenshot({ path: path.join(out, `${key}-${w}${dsf === 2 ? 'z200' : ''}-${name}.png`), fullPage: true });
        await p.close();
      }
    }
  }
}
await b.close();
