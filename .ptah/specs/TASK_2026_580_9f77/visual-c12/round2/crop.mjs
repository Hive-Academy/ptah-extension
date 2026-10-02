import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const D = 'D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-c12/';
const b = await chromium.launch(); const p = await b.newPage(); await p.setViewportSize({ width: 460, height: 130 });
const f = (x) => 'data:image/png;base64,' + readFileSync(D + x).toString('base64');
await p.setContent('<body style="margin:0;background:#888"><div style="display:flex;gap:6px"><div style="width:224px;height:110px;overflow:hidden;position:relative"><img src="' + f('before-vscode-anubis-800-sidebar.png') + '" style="position:absolute;top:-870px"></div><div style="width:224px;height:110px;overflow:hidden;position:relative"><img src="' + f('round2/r2-vscode-anubis-800-sidebar.png') + '" style="position:absolute;top:-870px"></div></div>');
await p.screenshot({ path: D + 'round2/vscode-bottom-before-vs-r2.png' }); await b.close();
