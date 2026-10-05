/* B-0 capture: drives the REAL webview bundle (base 21c27d17f) through the harness helpers. */
import { test, expect } from 'D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/frontend/webview-e2e-harness/src/lib/test-fixtures';
import { installPostMessageBridge } from 'D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/frontend/webview-e2e-harness/src/lib/postmessage-bridge';
import { installCspStub } from 'D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/frontend/webview-e2e-harness/src/lib/csp-stub';

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

async function responder(page: import('@playwright/test').Page, theme: string, extra: Record<string, unknown> = {}) {
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
  }, [JSON.stringify({ ...FIX, ...extra }), theme]);
}
async function setTheme(page: import('@playwright/test').Page, theme: string) {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.setAttribute('data-theme', t);
    r.setAttribute('data-theme-mode', t === 'anubis' ? 'dark' : 'light');
  }, theme);
}


const WS = 'C:\\ptah-e2e-ws';
const facets = (agents: string) => ({ skills: 'supported', commands: 'supported', agents, mcp: 'supported' });
const tgt = (target: string, over: Record<string, unknown> = {}) => ({
  target, detected: true, facets: facets('supported'), expected: 6, found: 6, missing: [], foreign: [], writeFailed: [],
  overwrittenLocalEdit: [], removed: [], localEdit: [], agentsInSync: [], ...over,
});
const HEALTH = {
  workspaceRoot: WS, generatedAt: '2026-10-04T09:00:00Z', mode: 'preflight', reason: 'b7', sources: 'ok', collisions: [],
  targets: [
    tgt('claude', { facets: facets('source-managed'), localEdit: ['.claude/agents/software-architect.md'] }),
    tgt('codex', {
      localEdit: ['.codex/agents/backend-developer.toml'],
      missing: ['.codex/agents/frontend-developer.toml'],
      agentsInSync: ['.codex/agents/software-architect.toml', '.codex/agents/code-logic-reviewer.toml'],
    }),
    tgt('copilot', {
      agentsInSync: ['.github/agents/backend-developer.agent.md', '.github/agents/frontend-developer.agent.md', '.github/agents/software-architect.agent.md'],
    }),
    tgt('cursor', { detected: false, expected: 0, found: 0 }),
    tgt('opencode', {
      writeFailed: [{ relPath: '.opencode/agent/frontend-developer.md', reason: 'EPERM: file is locked by another process' }],
      agentsInSync: ['.opencode/agent/backend-developer.md', '.opencode/agent/software-architect.md'],
    }),
    tgt('antigravity', { facets: facets('unsupported') }),
  ],
};
const HEALTH_RES = { health: HEALTH, cached: false, summary: { level: 'degraded', detectedTargets: 5, expected: 30, found: 26, missing: 1, writeFailed: 1, foreign: 0, removed: 0, collisions: 0, sources: 'ok', label: '1 missing, 1 failed across 5 targets' } };
const quarantine = (agentSync: string) => ({
  workspaceRoot: WS, agentSync, notOwned: ['senior-tester'],
  quarantined: [
    { slug: 'legacy-planner', state: 'quarantined', quarantinedAt: '2026-09-20T10:00:00Z', hasSnapshot: true, sourcePath: `${WS}\\.claude\\agents\\legacy-planner.md` },
    { slug: 'docs-writer', state: 'source-restored', quarantinedAt: '2026-09-21T10:00:00Z', hasSnapshot: true, sourcePath: `${WS}\\.claude\\agents\\docs-writer.md` },
    { slug: 'old-bot', state: 'quarantined', quarantinedAt: null, hasSnapshot: false, sourcePath: `${WS}\\.claude\\agents\\old-bot.md` },
  ],
});
const entries = (...ids: string[]) => ids.map((id) => ({ id }));
const MODELS = {
  workspaceRoot: WS,
  machine: { '*': { claude: 'sonnet' } },
  workspace: { 'backend-developer': { codex: 'gpt-5-codex', opencode: 'anthropic/claude-sonnet-4-5', copilot: 'made-up-model' } },
  lists: { claude: entries('opus', 'sonnet', 'haiku'), codex: entries('gpt-5-codex', 'gpt-5'), copilot: entries('gpt-4.1'), cursor: entries('auto'), opencode: entries('anthropic/claude-sonnet-4-5') },
  classification: { machine: { '*': { claude: 'listed' } }, workspace: { 'backend-developer': { codex: 'listed', opencode: 'listed', copilot: 'unlisted' } } },
  unsupportedProviders: ['cursor'],
};
const CLI_MODELS = { codex: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }], copilot: [{ id: 'gpt-4.1', name: 'GPT-4.1' }], cursor: [], antigravity: [], opencode: [{ id: 'anthropic/claude-sonnet-4-5', name: 'Sonnet 4.5' }], pi: [] };
const LANES = { codexModel: 'gpt-5', copilotModel: '', cursorModel: '', opencodeModel: '' };
const AGENTS_FIX = (sync = 'enabled') => ({
  'harness:health': HEALTH_RES, 'harness:reconcile': HEALTH_RES,
  'skillSynthesis:listQuarantinedAgents': quarantine(sync),
  'skillSynthesis:getAgentModels': MODELS, 'agent:listCliModels': CLI_MODELS, 'agent:getConfig': LANES,
});
const PREVIEW = {
  agents: [
    { agentId: 'backend-developer', files: [
      { relPath: '.claude/agents/backend-developer.md', target: 'claude', certainty: 'definite', willOverwrite: true },
      { relPath: '.codex/agents/backend-developer.toml', target: 'codex', certainty: 'definite', willOverwrite: false },
      { relPath: '.github/agents/backend-developer.agent.md', target: 'copilot', certainty: 'conditional', condition: 'GitHub Copilot is detected after generation', willOverwrite: true },
      { relPath: '.cursor/agents/backend-developer.md', target: 'cursor', certainty: 'conditional', condition: 'Cursor is detected after generation', willOverwrite: false },
    ] },
    { agentId: 'frontend-developer', files: [
      { relPath: '.claude/agents/frontend-developer.md', target: 'claude', certainty: 'definite', willOverwrite: false },
      { relPath: '.codex/agents/frontend-developer.toml', target: 'codex', certainty: 'definite', willOverwrite: false },
    ] },
  ],
};

type Pg = import('@playwright/test').Page;
async function openAgents(page: Pg, fixtureServer: { url: string }, theme: string, extra: Record<string, unknown>) {
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await responder(page, theme, extra);
  await page.goto(fixtureServer.url);
  await bridge.inject({ type: 'switchView', payload: { view: 'thoth' } });
  await page.locator('#thoth-tab-skills').click();
  await page.locator('[data-testid="skills-subview-clones"]').click();
  await page.getByRole('tab', { name: 'Agents' }).click();
  await page.locator('[data-testid="clones-row"]').first().waitFor();
  await page.locator('[data-testid="quarantine-panel"]').waitFor();
  await page.locator('[data-testid="agent-model-editor"]').first().waitFor();
  await setTheme(page, theme);
  await page.waitForTimeout(800);
}
const shot = async (page: Pg, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

async function openWizardSelection(page: Pg, fixtureServer: { url: string }, theme: string, extra: Record<string, unknown>) {
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await responder(page, theme, extra);
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
  return gen;
}

for (const [label, theme] of [['dark', 'anubis'], ['light', 'anubis-light']] as const) {
  test(`after agents ${label}`, async ({ page, fixtureServer }) => {
    await openAgents(page, fixtureServer, theme, AGENTS_FIX());
    await shot(page, `after-agents-${label}`);
    const rows = page.locator('[data-testid="clones-row"]');
    await rows.nth(0).screenshot({ path: `${OUT}/after-agent-card-chips-edited-${label}.png` });
    await rows.nth(1).screenshot({ path: `${OUT}/after-agent-card-chips-missing-failed-${label}.png` });
    await page.locator('[data-testid="clones-agent-sync"]').screenshot({ path: `${OUT}/after-agent-sync-bar-${label}.png` });
    const notOwned = rows.filter({ hasText: 'senior-tester' }).first();
    await notOwned.scrollIntoViewIfNeeded();
    await notOwned.screenshot({ path: `${OUT}/after-agent-card-not-owned-${label}.png` });
    const inherit = rows.filter({ hasText: 'visual-reviewer' }).first();
    await inherit.scrollIntoViewIfNeeded();
    await inherit.locator('[data-testid="agent-model-editor"]').screenshot({ path: `${OUT}/after-agent-model-inherited-${label}.png` });
    await rows.nth(0).locator('[data-testid="agent-model-editor"]').screenshot({ path: `${OUT}/after-agent-model-overrides-${label}.png` });
    await inherit.locator('[data-testid="agent-model-edit-btn"]').nth(1).click();
    await page.waitForTimeout(300);
    await inherit.locator('[data-testid="agent-model-editor"]').screenshot({ path: `${OUT}/after-agent-model-edit-form-${label}.png` });
    await inherit.locator('[data-testid="agent-model-cancel-btn"]').click();
    const panel = page.locator('[data-testid="quarantine-panel"]');
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: `${OUT}/after-quarantine-panel-${label}.png` });
    await shot(page, `after-quarantine-panel-viewport-${label}`);
    await page.locator('[data-testid="quarantine-restore-btn"]').first().click();
    await page.waitForTimeout(400);
    await shot(page, `after-quarantine-restore-confirm-${label}`);
    await page.locator('[data-testid="quarantine-restore-cancel"]').click();
    await page.locator('[data-testid="clones-agent-sync-btn"]').scrollIntoViewIfNeeded();
    await page.locator('[data-testid="clones-agent-sync-btn"]').click();
    await page.locator('[data-testid="reconcile-guard-body"]').waitFor();
    await page.waitForTimeout(400);
    await shot(page, `after-reconcile-guard-${label}`);
    await page.locator('[data-testid="reconcile-guard-cancel"]').click();
  });
  test(`after quarantine gate-disabled ${label}`, async ({ page, fixtureServer }) => {
    await openAgents(page, fixtureServer, theme, AGENTS_FIX('disabled'));
    const panel = page.locator('[data-testid="quarantine-panel"]');
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: `${OUT}/after-quarantine-gate-disabled-${label}.png` });
    await page.locator('[data-testid="quarantine-restore-btn"]').first().click();
    await page.waitForTimeout(400);
    await shot(page, `after-quarantine-restore-confirm-gate-disabled-${label}`);
  });
  test(`after wizard ${label}`, async ({ page, fixtureServer }) => {
    const gen = await openWizardSelection(page, fixtureServer, theme, { 'wizard:preview-generation': PREVIEW });
    await page.screenshot({ path: `${OUT}/after-wizard-${label}.png` });
    await gen.click();
    await page.locator('[data-testid="conditional-files"]').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-wizard-preview-modal-${label}.png` });
  });
  test(`after wizard preview warning ${label}`, async ({ page, fixtureServer }) => {
    const gen = await openWizardSelection(page, fixtureServer, theme, {
      'wizard:preview-generation': { agents: [PREVIEW.agents[1]], warning: 'Other CLI paths could not be worked out; only Claude files are listed.' },
    });
    await gen.click();
    await page.getByText('Preview agent generation').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/after-wizard-preview-warning-${label}.png` });
  });
}
