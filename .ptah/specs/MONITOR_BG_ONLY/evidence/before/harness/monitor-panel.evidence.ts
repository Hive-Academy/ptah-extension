import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../support/fixtures';

/**
 * MONITOR_BG_ONLY evidence capture (NOT part of the normal e2e suite).
 * Real Electron renderer; backend RPC mocked. Subagents are injected through
 * the REAL push path: `chat:chunk` (ChatMessageHandler -> StreamRouter ->
 * AccumulatorCore -> AgentMonitorStore / BackgroundAgentStore) and
 * `agent-monitor:spawned` (CLI lane agent).
 * Env: EVIDENCE_OUT (abs dir), EVIDENCE_COMMIT.
 */
const OUT = process.env['EVIDENCE_OUT'] as string;
const SID = '7d2c1f0e-5b3a-4c8d-9e1f-2a3b4c5d6e7f';
const NOW = Date.now();
const THEMES = [
  { key: 'dark', theme: 'anubis' },
  { key: 'light', theme: 'anubis-light' },
] as const;

test('monitor panel: foreground + background subagents + CLI lane', async ({
  ui,
  electronApp,
}) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 950);
    w.center();
  });
  await ui.mockRpc({
    'session:list': { sessions: [], total: 0, hasMore: false },
    'chat:agent-sessions': { sessions: [] },
  });
  await ui.prepare();
  await ui.goto('chat');
  const page = electronApp.windows().find((x) => x.url().startsWith('file:'));
  if (!page) throw new Error('renderer window not found');
  await page.waitForTimeout(2_500);

  const raw = await page.evaluate(() =>
    JSON.stringify(
      Object.keys(localStorage)
        .filter((k) => k.startsWith('ptah.tabs'))
        .map((k) => localStorage.getItem(k)),
    ),
  );
  const m = /\bid\W{1,6}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(raw);
  const tabId = m?.[1];
  expect(tabId, 'parent tab id found').toBeTruthy();

  let n = 0;
  const base = (eventType: string) => ({
    id: `evt-${++n}`,
    eventType,
    timestamp: NOW + n,
    sessionId: SID,
    messageId: 'msg-assistant-1',
  });
  const chunk = (event: Record<string, unknown>) =>
    ui.pushEvent({ type: 'chat:chunk', payload: { tabId, sessionId: SID, event } });

  await ui.pushEvent({
    type: 'session:id-resolved',
    payload: { tabId, realSessionId: SID },
  });
  await page.waitForTimeout(500);

  await chunk({ ...base('message_start'), role: 'assistant' });
  await chunk({ ...base('text_delta'), delta: 'Launching two subagents: one foreground, one background.', blockIndex: 0 });

  const spawn = (id: string, agentId: string, name: string, type: string, desc: string) => [
    {
      ...base('tool_start'),
      toolCallId: id,
      toolName: 'Task',
      isTaskTool: true,
      agentType: type,
      agentDescription: desc,
      toolInput: { subagent_type: type, description: desc, prompt: desc, name },
    },
    {
      ...base('agent_start'),
      toolCallId: id,
      agentType: type,
      agentDescription: desc,
      agentId,
      teammateName: name,
    },
  ];
  for (const e of spawn('toolu_fg_0001', 'fg1a2b3', 'fg-reviewer', 'code-logic-reviewer', 'Review the diff (foreground)')) await chunk(e);
  for (const e of spawn('toolu_bg_0002', 'bg4d5e6', 'bg-watcher', 'Explore', 'Watch the build (background)')) await chunk(e);
  await chunk({
    ...base('background_agent_started'),
    toolCallId: 'toolu_bg_0002',
    agentType: 'Explore',
    agentDescription: 'Watch the build (background)',
    agentId: 'bg4d5e6',
    teammateName: 'bg-watcher',
    outputFilePath: 'C:\ptah-e2e-ws\.tmp\bg4d5e6.output',
    tabId,
  });
  await ui.pushEvent({
    type: 'agent-monitor:spawned',
    payload: {
      agentId: 'cli-lane-0001',
      cli: 'codex',
      task: 'CLI lane agent: run the test suite',
      workingDirectory: 'C:\ptah-e2e-ws',
      status: 'running',
      startedAt: new Date(NOW).toISOString(),
      parentSessionId: SID,
      displayName: 'Codex',
    },
  });
  await page.waitForTimeout(2_500);

  const panel = page.locator('ptah-agent-monitor-panel').first();
  const probe = async () =>
    page.evaluate(() => {
      const p = document.querySelector('ptah-agent-monitor-panel') as HTMLElement | null;
      const chips = [...(p?.querySelectorAll('button') ?? [])].map((b) => (b as HTMLElement).innerText.trim()).filter(Boolean);
      const countBadge = p?.querySelector('.badge-neutral') as HTMLElement | null;
      const badges = [...(p?.querySelectorAll('.badge') ?? [])].map((b) => (b as HTMLElement).innerText.trim());
      return {
        panelPresent: !!p,
        panelVisible: !!p && p.offsetWidth > 0 && p.offsetHeight > 0,
        panelText: p?.innerText ?? null,
        listedChips: chips,
        totalCountBadge: countBadge?.innerText.trim() ?? null,
        badges,
        canvasTiles: document.querySelectorAll('[data-testid="canvas-grid"] gridstack-item').length,
        chatTextHasFgDesc: document.body.innerText.includes('Review the diff'),
        chatTextHasBgDesc: document.body.innerText.includes('Watch the build'),
      };
    });

  // Open the panel via the AGENTS rail tab if it did not auto-open.
  let facts = await probe();
  if (!facts.panelVisible || !facts.panelText) {
    const tab = page.locator('ptah-sidebar-tab button').first();
    if (await tab.count()) await tab.click();
    await page.waitForTimeout(1_500);
    facts = await probe();
  }

  const per: Record<string, unknown> = {};
  for (const t of THEMES) {
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), t.theme);
    await page.waitForTimeout(700);
    per[t.key] = await probe();
    await page.screenshot({ path: path.join(OUT, `monitor-panel-window-${t.key}.png`) });
    if (await panel.isVisible().catch(() => false)) {
      await panel.screenshot({ path: path.join(OUT, `monitor-panel-${t.key}.png`) });
    }
  }
  fs.writeFileSync(
    path.join(OUT, 'facts.json'),
    JSON.stringify(
      {
        commit: process.env['EVIDENCE_COMMIT'] ?? 'unknown',
        sessionId: SID,
        tabId,
        injected: {
          foreground: { toolCallId: 'toolu_fg_0001', via: 'chat:chunk tool_start + agent_start' },
          background: { toolCallId: 'toolu_bg_0002', via: 'chat:chunk tool_start + agent_start + background_agent_started' },
          cliLane: { agentId: 'cli-lane-0001', via: 'agent-monitor:spawned' },
        },
        observed: per,
      },
      null,
      2,
    ),
  );
});
