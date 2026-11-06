import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { z } from 'zod';
import { launchPtah } from '../../support/electron-launcher';
import { RpcBridge } from '../../support/rpc-bridge';
import { UiDriver } from '../../support/ui-driver';
import { visibleNewSessionTrigger } from '../../support/new-session-trigger';

test.skip(process.env['PTAH_E2E_LIVE'] !== '1', 'live paid run');

const ROOT = path.resolve(__dirname, '../../../../..');
const SHOTS = path.join(ROOT, '.ptah/specs/TASK_2026_884_sdk_queue/live');
// A tool call keeps the turn busy long enough to queue a follow-up.
const COUNT = 'Use the Bash tool to run the command: sleep 25. Then reply with exactly: FIRST-DONE';
const ONE = 'Reply with exactly: FOLLOWUP-ONE';
const TWO = 'Reply with exactly: FOLLOWUP-TWO';
const QUEUED_A = 'Reply with exactly: QUEUED-A';
const PROMOTED_B = 'Reply with exactly: PROMOTED-B';
const COMPOSER = 'ptah-chat-input textarea[role="combobox"]:visible';
const SEND = '[data-testid="chat-send-btn"]:visible';
const STOP = '[data-testid="chat-stop-btn"]:visible';
const QUEUE = '[aria-label="Queued messages"]';
const USER = '[data-testid="chat-user-message"]';
const ASSISTANT = '[data-testid="chat-tool-output"]';
const transcriptLine = z.object({ type: z.string() }).passthrough();
const responseSchema = z.object({ success: z.boolean(), data: z.unknown().optional(), error: z.string().optional() });
const modelsSchema = z.object({ models: z.array(z.object({
  id: z.string(), name: z.string(), providerModelId: z.string().nullish(),
})) });
const sessionsSchema = z.object({ sessions: z.array(z.object({ id: z.string() })) });

async function rpc(bridge: RpcBridge, method: string, params: Record<string, unknown>): Promise<unknown> {
  const reply = responseSchema.parse(await bridge.sendRpc('rpc', {
    type: 'rpc:call', payload: { method, params },
  }, 30_000));
  if (!reply.success) throw new Error(`${method}: ${reply.error ?? 'RPC failed'}`);
  return reply.data;
}

async function shot(page: Page, step: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${step}.png`), fullPage: true });
}

async function newTab(page: Page): Promise<string> {
  const before = await page.locator('li[ptah-canvas-rail-card][data-tab-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-tab-id')),
  );
  await (await visibleNewSessionTrigger(page)).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const card = page.locator('li[ptah-canvas-rail-card][data-tab-id]:visible');
  await expect.poll(async () => card.count()).toBeGreaterThan(before.length);
  const ids = await card.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tab-id')));
  const id = ids.find((value) => value && !before.includes(value));
  if (!id) throw new Error('New canvas tab did not appear');
  await expect(page.locator(COMPOSER).first()).toBeVisible();
  return id;
}

async function send(page: Page, prompt: string): Promise<void> {
  await page.locator(COMPOSER).first().fill(prompt);
  await page.locator(SEND).first().click();
}

async function onlySessionId(bridge: RpcBridge, workspacePath: string, count: number): Promise<string> {
  let ids: string[] = [];
  await expect.poll(async () => {
    const data = sessionsSchema.parse(await rpc(bridge, 'session:list', { workspacePath, limit: 20 }));
    ids = data.sessions.map((session) => session.id);
    return ids.length;
  }, { timeout: 30_000 }).toBe(count);
  const id = ids[0];
  if (!id) throw new Error('Started session missing from session:list');
  return id;
}

/**
 * Passive delivery probe: read the Claude SDK transcript the backend writes
 * under ~/.claude/projects. Polling chat:resume would touch the live session.
 */
async function assistantHas(_bridge: RpcBridge, sessionId: string, _tabId: string, workspacePath: string, marker: string): Promise<boolean> {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const tag = path.basename(workspacePath).replace(/[^a-zA-Z0-9]/g, '-');
  if (!fs.existsSync(projects)) return false;
  for (const dir of fs.readdirSync(projects).filter((name) => name.includes(tag))) {
    const full = path.join(projects, dir);
    for (const file of fs.readdirSync(full).filter((name) => name.endsWith('.jsonl'))) {
      if (sessionId && !file.startsWith(sessionId) && !fs.readFileSync(path.join(full, file), 'utf8').includes(sessionId)) continue;
      for (const line of fs.readFileSync(path.join(full, file), 'utf8').split('\n')) {
        if (!line.includes('"assistant"') || !line.includes(marker)) continue;
        const parsed = transcriptLine.safeParse(JSON.parse(line));
        if (parsed.success && parsed.data.type === 'assistant') return true;
      }
    }
  }
  return false;
}

/** Visible chat history in DOM order, as role + text (evidence and order check). */
async function history(page: Page, step: string): Promise<{ role: string; text: string }[]> {
  const entries = await page.locator(`${USER}:visible, ${ASSISTANT}:visible`).evaluateAll((nodes) =>
    nodes.map((node) => ({
      role: node.getAttribute('data-testid') === 'chat-user-message' ? 'user' : 'assistant',
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    })));
  fs.writeFileSync(path.join(SHOTS, `${step}-history.json`), JSON.stringify(entries, null, 2));
  return entries;
}

/** Strict order: prompt, its own reply, the follow-up, then a separate reply with the marker. */
async function assertOrder(page: Page, prompt: string, marker: string, step: string): Promise<void> {
  await expect.poll(async () => (await history(page, step)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  const entries = await history(page, step);
  const roles = entries.map((entry) => entry.role);
  const firstUser = entries.findIndex((entry) => entry.role === 'user' && entry.text.includes(COUNT.slice(0, 30)));
  const followUser = entries.findIndex((entry) => entry.role === 'user' && entry.text.includes(prompt));
  expect.soft(firstUser, `history roles: ${roles.join(',')}`).toBeGreaterThanOrEqual(0);
  expect.soft(followUser, 'follow-up comes after the first prompt').toBeGreaterThan(firstUser);
  const between = entries.slice(firstUser + 1, followUser);
  expect.soft(between.some((entry) => entry.role === 'assistant'), 'first reply sits between the prompts').toBe(true);
  expect.soft(between.some((entry) => entry.text.includes(marker)), 'marker not in the first reply').toBe(false);
  const after = entries.slice(followUser + 1);
  expect.soft(after.some((entry) => entry.role === 'assistant' && entry.text.includes(marker)), 'follow-up reply after the follow-up').toBe(true);
}

async function selectHaiku(page: Page): Promise<void> {
  await page.locator('button[aria-label="Select model"]:visible').first().click();
  await page.locator('ptah-native-option:visible', { hasText: /haiku/i }).first().click();
  await expect(page.locator('button[aria-label="Select model"]:visible').first()).toContainText(/haiku/i);
}

test('@live backend follow-up queue delivers to a hidden tab and restores on Stop', async () => {
  test.setTimeout(360_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-live-queue-'));
  let app: ElectronApplication | undefined;
  try {
    // launchPtah isolates userDataDir and PTAH_DB_PATH; ambient HOME keeps Claude login.
    app = await launchPtah({ args: [scratch], timeout: 120_000 });
    const page = await app.firstWindow({ timeout: 120_000 });
    const ui = new UiDriver(app, page);
    const bridge = new RpcBridge(app);
    await ui.goto('chat');
    const firstTab = await page.locator('li[ptah-canvas-rail-card][data-tab-id]').first().getAttribute('data-tab-id');
    if (!firstTab) throw new Error('Initial canvas tab has no data-tab-id');

    const listed = modelsSchema.parse(await rpc(bridge, 'config:models-list', { workspacePath: scratch }));
    const haiku = listed.models.find((model) => model.id.toLowerCase().includes('haiku'));
    if (!haiku) throw new Error('No Claude/Anthropic Haiku model in config:models-list');
    await rpc(bridge, 'config:model-switch', { model: haiku.id, applyTo: 'workspace' });
    await selectHaiku(page);
    await shot(page, '00-haiku-selected');

    await send(page, COUNT);
    await expect(page.locator(STOP).first()).toBeVisible();
    const firstSession = await onlySessionId(bridge, scratch, 1);
    await shot(page, '01-first-turn-streaming');
    await send(page, ONE);
    await expect(page.locator(QUEUE)).toContainText(ONE);
    await shot(page, '02-follow-up-queued');

    await newTab(page);
    await shot(page, '03-first-tab-hidden');
    await expect.poll(() => assistantHas(bridge, firstSession, firstTab, scratch, 'FOLLOWUP-ONE'),
      { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).toBe(true);
    await shot(page, '04-hidden-delivery-complete');
    await expect.soft(page.locator(`li[ptah-canvas-rail-card][data-tab-id="${firstTab}"] ptah-compact-rail-card`), 'hidden tab must not show Error').not.toHaveAttribute('data-state', 'error');
    await page.locator(`li[ptah-canvas-rail-card][data-tab-id="${firstTab}"] ptah-compact-rail-card`).click();
    await assertOrder(page, ONE, 'FOLLOWUP-ONE', '05');
    await expect(page.locator(QUEUE)).toHaveCount(0);
    await shot(page, '05-first-tab-history');

    const secondTab = await newTab(page);
    await selectHaiku(page);
    await send(page, COUNT);
    await expect(page.locator(STOP).first()).toBeVisible();
    let secondSession: string | undefined;
    await expect.poll(async () => {
      const data = sessionsSchema.parse(await rpc(bridge, 'session:list', { workspacePath: scratch, limit: 20 }));
      secondSession = data.sessions.find((s) => s.id !== firstSession)?.id;
      return Boolean(secondSession);
    }, { timeout: 30_000 }).toBe(true);
    if (!secondSession) throw new Error('Second live session missing from session:list');
    const liveSecondSession = secondSession;
    await shot(page, '06-second-turn-streaming');
    await send(page, TWO);
    await expect(page.locator(QUEUE)).toContainText(TWO);
    await shot(page, '07-second-follow-up-queued');
    await page.locator(STOP).first().click();
    await expect(page.locator(COMPOSER).first()).toHaveValue(TWO);
    await expect(page.locator(QUEUE)).toHaveCount(0);
    await expect(page.locator(`${ASSISTANT}:visible`).first()).toBeVisible();
    await expect.soft(page.locator('[data-testid="chat-turn-interrupted"]:visible'), 'Stop marks the turn interrupted').toHaveCount(1, { timeout: 15_000 });
    await shot(page, '08-stop-restored-composer');
    await page.waitForTimeout(20_000);
    expect(await assistantHas(bridge, liveSecondSession, secondTab, scratch, 'FOLLOWUP-TWO')).toBe(false);
    await shot(page, '09-no-withdrawn-delivery');
    await page.locator(SEND).first().click();
    await expect.poll(() => assistantHas(bridge, liveSecondSession, secondTab, scratch, 'FOLLOWUP-TWO'),
      { timeout: 120_000, intervals: [1_000, 2_000] }).toBe(true);
    await assertOrder(page, TWO, 'FOLLOWUP-TWO', '10');
    await shot(page, '10-restored-message-sent');

    // Scenario C: Claude "Interrupt & send" promotes one queued item ahead of the others.
    await newTab(page);
    await selectHaiku(page);
    await send(page, COUNT);
    await expect(page.locator(STOP).first()).toBeVisible();
    await send(page, QUEUED_A);
    await send(page, PROMOTED_B);
    const items = page.locator('[data-testid="queued-follow-up-item"]:visible');
    await expect(items).toHaveCount(2);
    await shot(page, '11a-two-items-waiting');
    // Items stay local ("Waiting to queue") until the backend session exists.
    await expect(items.filter({ hasText: 'PROMOTED-B' })).toContainText('Queued for the next turn', { timeout: 60_000 });
    await shot(page, '11-two-items-queued');
    const promote = items.filter({ hasText: 'PROMOTED-B' }).locator('[data-testid="queued-follow-up-send-now"]');
    await expect(promote).toHaveText(/Interrupt & send/i);
    await promote.click();
    await shot(page, '12-interrupt-and-send-clicked');
    await expect.poll(async () => {
      const entries = await history(page, '13');
      const texts = entries.map((entry) => `${entry.role}:${entry.text}`);
      const b = texts.findIndex((t) => t.startsWith('assistant:') && t.includes('PROMOTED-B'));
      const a = texts.findIndex((t) => t.startsWith('assistant:') && t.includes('QUEUED-A'));
      return b >= 0 && a > b;
    }, { timeout: 180_000, intervals: [2_000, 3_000] }).toBe(true);
    const entries = await history(page, '13');
    const userOrder = entries.filter((entry) => entry.role === 'user').map((entry) => entry.text);
    expect(userOrder.findIndex((t) => t.includes('PROMOTED-B')), 'promoted item runs before the other queued item')
      .toBeLessThan(userOrder.findIndex((t) => t.includes('QUEUED-A')));
    expect(entries.filter((entry) => entry.role === 'assistant' && entry.text.includes('PROMOTED-B')), 'promoted item delivered once')
      .toHaveLength(1);
    await expect(items).toHaveCount(0);
    await expect.soft(page.locator('[data-testid="chat-turn-interrupted"]:visible'), 'Interrupt & send marks the turn interrupted').toHaveCount(1);
    await shot(page, '13-interrupt-and-send-history');
  } finally {
    await app?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('@live Codex Send now steers into the running turn (Luna)', async () => {
  test.setTimeout(360_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-live-codex-steer-'));
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-home-'));
  const codexHome = process.env['CODEX_HOME'] || path.join(os.homedir(), '.codex');
  const claudeHome = process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
  const firstPrompt = 'Run the shell command `sleep 20`, then reply with exactly: FIRST-DONE';
  const steerPrompt = 'Change of plan: when the command finishes, reply with exactly: STEERED-C and nothing else.';
  let app: ElectronApplication | undefined;
  try {
    // Provider selection writes Ptah settings; isolate both Node home aliases.
    app = await launchPtah({
      args: [scratch],
      env: { HOME: isolatedHome, USERPROFILE: isolatedHome, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome },
      timeout: 120_000,
    });
    const page = await app.firstWindow({ timeout: 120_000 });
    const bridge = new RpcBridge(app);
    const ui = new UiDriver(app, page);
    const selection = z.object({ success: z.boolean(), error: z.string().optional() }).parse(
      await rpc(bridge, 'auth:saveSettings', {
        authMethod: 'thirdParty', anthropicProviderId: 'openai-codex', applyTo: 'workspace',
      }),
    );
    if (!selection.success) throw new Error(`Could not select Codex provider: ${selection.error ?? 'unknown error'}`);
    const listed = modelsSchema.parse(await rpc(bridge, 'config:models-list', { workspacePath: scratch }));
    // Codex lists tier aliases; the provider model id carries the real name (haiku -> gpt-6-luna).
    const isLuna = (model: { id: string; name: string; providerModelId?: string | null }): boolean =>
      [model.id, model.name, model.providerModelId ?? ''].some((v) => v.toLowerCase().includes('luna'));
    const luna = listed.models.find(isLuna);
    if (!luna) throw new Error(`No Luna Codex model offered by config:models-list; offered: ${JSON.stringify(listed.models)}`);
    await rpc(bridge, 'config:model-switch', { model: luna.id, applyTo: 'workspace' });
    // The isolated home starts in Manual; without auto-approval Codex waits on the shell permission.
    await rpc(bridge, 'config:autopilot-toggle', { enabled: true, permissionLevel: 'yolo', sessionId: null });
    await page.reload();
    await ui.goto('chat');
    await page.locator('button[aria-label="Select model"]:visible').first().click();
    const option = page.locator('ptah-native-option:visible', { hasText: /luna/i }).first();
    await expect(option, `Luna ${luna.id} must appear in the model picker`).toBeVisible();
    await option.click();
    await expect(page.locator('button[aria-label="Select model"]:visible').first()).toContainText(/luna/i);

    await send(page, firstPrompt);
    await expect(page.locator(STOP).first()).toBeVisible();
    await send(page, steerPrompt);
    const item = page.locator('[data-testid="queued-follow-up-item"]:visible', { hasText: 'STEERED-C' });
    await expect(item).toContainText('Queued for the next turn', { timeout: 60_000 });
    const sendNow = item.locator('[data-testid="queued-follow-up-send-now"]');
    await expect(sendNow).toHaveText('Send now');
    await shot(page, '20-codex-queued');
    await sendNow.click();
    await shot(page, '21-codex-send-now-clicked');
    await expect(page.locator(QUEUE)).toHaveCount(0);
    await expect.poll(async () => (await history(page, '22')).some(
      (entry) => entry.role === 'assistant' && entry.text.includes('STEERED-C'),
    ), { timeout: 180_000, intervals: [2_000, 3_000] }).toBe(true);
    await expect(page.locator(STOP)).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(20_000);
    const entries = await history(page, '22');
    expect(entries.some((entry) => entry.role === 'user' && entry.text.includes(steerPrompt.slice(0, 35))),
      'steered user bubble appears in history').toBe(true);
    const steeredReplies = entries.filter((entry) => entry.role === 'assistant' && entry.text.includes('STEERED-C'));
    expect(steeredReplies, 'exactly one assistant entry contains STEERED-C').toHaveLength(1);
    expect(entries.filter((entry) => entry.role === 'assistant' && entry.text.includes('FIRST-DONE')),
      'the original turn did not finish before a separate queued turn').toHaveLength(0);
    const steeredIndex = entries.indexOf(steeredReplies[0]);
    expect(entries.slice(steeredIndex + 1).filter((entry) => entry.role === 'assistant'),
      'no second assistant turn starts after the steered reply').toHaveLength(0);
    await expect.soft(page.locator('[data-testid="chat-turn-interrupted"]:visible'), 'a Codex steer is not an interruption').toHaveCount(0);
    await shot(page, '22-codex-steer-history');
  } finally {
    await app?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});
