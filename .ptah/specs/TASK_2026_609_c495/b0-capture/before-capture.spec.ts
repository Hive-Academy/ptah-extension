/* B-0 capture: drives the REAL webview bundle (base 21c27d17f) through the harness helpers. */
import { test, expect } from 'D:/projects/ptah-extension/.claude-worktrees/task-609-before/libs/frontend/webview-e2e-harness/src/lib/test-fixtures';
import { installPostMessageBridge } from 'D:/projects/ptah-extension/.claude-worktrees/task-609-before/libs/frontend/webview-e2e-harness/src/lib/postmessage-bridge';
import { installCspStub } from 'D:/projects/ptah-extension/.claude-worktrees/task-609-before/libs/frontend/webview-e2e-harness/src/lib/csp-stub';

const OUT = process.env['B0_OUT'] as string;
test.use({ useAppBuild: true });

const clone = (slug: string, cloneStatus: string, extra: Record<string, unknown> = {}) => ({
  slug, kind: 'agent', cloneStatus, diverged: cloneStatus === 'diverged', invocationCount: 12,
  successRate: 0.83, lastEnhancedAt: 1_760_000_000_000, historyCount: 2, pendingSourceHash: null,
  enhanceMinInvocations: 5, enhanceCooldownUntil: null, orphaned: false, ...extra,
});
const CLONES = [
  clone('backend-developer', 'clone'),
  clone('frontend-developer', 'diverged', { pendingSourceHash: 'abc123' }),
  clone('software-architect', 'authored'),
  clone('code-logic-reviewer', 'synth'),
  clone('visual-reviewer', 'clone', { invocationCount: 0, successRate: 0, lastEnhancedAt: null, historyCount: 0 }),
  clone('senior-tester', 'clone'),
];
const SCORECARDS: Record<string, unknown> = {};
for (const c of CLONES.slice(0, 4)) {
  SCORECARDS[c.slug] = {
    slug: c.slug, totalInvocations: 12, gradedCount: 6, gradedSuccessRate: 0.83,
    avgInputTokens: 12000, avgOutputTokens: 3200, avgCacheReadTokens: 9000, totalInputTokens: 144000,
    totalOutputTokens: 38400, avgCostUsd: 0.12, avgDurationMs: 95000, avgToolCount: 14, winRate: 0.75,
    recentVerdicts: [{ taskId: 'T1', succeeded: true, reconciledAt: 1_760_000_000_000 }],
  };
}
const REC = (id: string, name: string, score: number, cat: string) => ({
  agentId: id, agentName: name, relevanceScore: score, matchedCriteria: ['Angular', 'Nx monorepo'],
  category: cat, recommended: score >= 75, description: `${name} agent tailored to this workspace`,
});
const RECS = [
  REC('backend-developer', 'Backend Developer', 95, 'development'),
  REC('frontend-developer', 'Frontend Developer', 92, 'development'),
  REC('software-architect', 'Software Architect', 88, 'planning'),
  REC('senior-tester', 'Senior Tester', 84, 'qa'),
  REC('code-logic-reviewer', 'Code Logic Reviewer', 80, 'qa'),
  REC('ui-ux-designer', 'UI/UX Designer', 60, 'creative'),
  REC('devops-engineer', 'DevOps Engineer', 45, 'specialist'),
];
const MULTI = {
  isMultiPhase: true,
  manifest: { version: 3, runId: 'r1', slug: 'angular-nx-monorepo', analyzedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', lifecycle: 'completed', model: 'sonnet', totalDurationMs: 120000, phases: {} },
  phaseContents: {}, analysisDir: 'C:\\ptah-e2e-ws\\.ptah\\analysis\\angular-nx-monorepo',
};
const FIX: Record<string, unknown> = {
  'workspace:getInfo': { folders: ['C:\\ptah-e2e-ws'], activeFolder: 'C:\\ptah-e2e-ws' },
  'workspace:switch': { success: true },
  'skillSynthesis:listCandidates': { candidates: [] },
  'skillSynthesis:stats': { totalCandidates: 0, totalPromoted: 0, totalRejected: 0, totalInvocations: 0, activeSkills: 0 },
  'skillSynthesis:listClones': { clones: CLONES },
  'skillSynthesis:getScorecards': { scorecards: SCORECARDS },
  'wizard:list-analyses': { analyses: [{ filename: 'angular-nx-monorepo', savedAt: '2026-10-01T00:00:00Z', projectType: 'Angular Nx Monorepo', phaseCount: 4, model: 'sonnet', durationMs: 120000 }] },
  'wizard:load-analysis': MULTI,
  'wizard:recommend-agents': RECS,
  'wizard:list-agent-packs': [],
};

async function responder(page: import('@playwright/test').Page, theme: string) {
  await page.addInitScript(([ser, th]: string[]) => {
    const fixtures = JSON.parse(ser);
    const w = window as any;
    if (typeof w.acquireVsCodeApi !== 'function') return;
    const api = w.acquireVsCodeApi();
    const orig = api.postMessage.bind(api);
    api.postMessage = (msg: any) => {
      orig(msg);
      if (msg?.type !== 'rpc:call' || !msg.payload?.method) return;
      const { method, correlationId } = msg.payload;
      if (!Object.prototype.hasOwnProperty.call(fixtures, method)) return;
      const data = fixtures[method];
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'rpc:response', correlationId, success: true, data } })));
    };
    w.vscode = api;
    w.ptahConfig = { isVSCode: false, isElectron: true, theme: th, workspaceRoot: 'C:\\ptah-e2e-ws', workspaceName: 'ptah-e2e-ws', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'e2e-harness', platform: 'win32', initialView: 'chat' };
  }, [JSON.stringify(FIX), theme]);
}
async function setTheme(page: import('@playwright/test').Page, theme: string) {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.setAttribute('data-theme', t);
    r.setAttribute('data-theme-mode', t === 'anubis' ? 'dark' : 'light');
  }, theme);
}

for (const [label, theme] of [['dark', 'anubis'], ['light', 'anubis-light']] as const) {
  test(`before agents ${label}`, async ({ page, fixtureServer }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    await responder(page, theme);
    await page.goto(fixtureServer.url);
    await bridge.inject({ type: 'switchView', payload: { view: 'thoth' } });
    await page.locator('#thoth-tab-skills').click();
    await page.locator('[data-testid="skills-subview-clones"]').click();
    await page.getByRole('tab', { name: 'Agents' }).click();
    await page.locator('[data-testid="clones-row"]').first().waitFor();
    await setTheme(page, theme);
    await page.waitForTimeout(600);
    expect(await page.locator('[data-testid="clones-row"]').count()).toBeGreaterThan(3);
    await page.screenshot({ path: `${OUT}/before-agents-${label}.png` });
  });
  test(`before wizard ${label}`, async ({ page, fixtureServer }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    await responder(page, theme);
    await page.goto(fixtureServer.url);
    await bridge.inject({ type: 'switchView', payload: { view: 'setup-wizard' } });
    await page.locator('[data-testid="wizard-step"][data-step="welcome"]').waitFor();
    await page.getByRole('button', { name: /use/i }).first().click();
    await page.locator('[data-testid="wizard-step"][data-step="analysis"]').waitFor();
    await page.getByRole('button', { name: /Yes, Continue/i }).click();
    await page.locator('[data-testid="wizard-step"][data-step="selection"]').waitFor();
    const gen = page.getByRole('button', { name: /Generate/i }).last();
    await gen.waitFor();
    await setTheme(page, theme);
    await gen.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/before-wizard-${label}.png`, fullPage: false });
  });
}
