/**
 * E2E: Advanced and Search & Voice scenes (TASK_2026_555 Batch 49; pattern-map-advanced-search-voice.md §2.2,
 * §3.2, §4). Three groups, both hosts:
 * - captures at 1024x768 in both themes (`current-advanced-*`, `current-search-voice-*`, and on Electron only
 *   `current-voice-drawer-*` and `current-go-vet-*`), with the fold budgets of map §2.2 / §3.2 asserted and
 *   their measured bottoms logged;
 * - focus: each drawer and inline confirm of the two tabs closes on Esc and returns focus to its opener;
 * - D15: a failed STT / TTS / web-search / output-style / effort write shows no "Saved", reverts its control
 *   and shows the fixed failure sentence, never the host's text.
 *
 * Kept apart from `settings-visual.e2e.spec.ts` so its smoke run (which rewrites the Providers and
 * Orchestration captures) and this one never overwrite each other's files.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { rpcError } from '../marketplace/marketplace.fixtures';
import { bootSettings, gotoSettingsTab, waitForSettled } from './settings.fixtures';
import { HOST_DETAIL } from './settings-advanced-search-voice.fixtures';
import {
  asvState, chooseVoiceProvider, dismissToast, expectEscReturnsFocus, expectFailedWrite, openVoiceDrawer, closeDrawers,
  promptDetailsButton, searchVoiceTab, styleRow,
} from './settings-advanced-search-voice.reach';

test.use({ useAppBuild: true });

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../../../../../../.ptah/specs/TASK_2026_555/screenshots/angular');
const HOSTS = ['vscode', 'electron'] as const;
type Host = (typeof HOSTS)[number];

const capturePath = (name: string, host: Host, theme: string): string => join(OUT_DIR, `current-${name}-${host}-${theme}-1024x768.png`);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

/** The fold line (px from the viewport top) every budget of map §2.2 / §3.2 is measured against. */
const FOLD = 660;

async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.first().boundingBox();
  expect(box, 'laid out').not.toBeNull();
  return Math.round((box?.y ?? 0) + (box?.height ?? 0));
}

async function heightOf(locator: Locator): Promise<number> {
  return Math.round((await locator.first().boundingBox())?.height ?? 0);
}

/** Nothing on the page or in its scroll containers is scrolled (the fold is measured on a fresh tab). */
async function scrollTops(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(window.scrollY, ...Array.from(document.querySelectorAll('*'))
    .filter((node) => node.scrollTop > 0).map((node) => node.scrollTop)));
}

/** Waits for the drawer's own entry animations, so a mid-slide frame is never captured. */
async function waitForDrawer(page: Page): Promise<void> {
  await page.locator('[data-testid="native-drawer-root"]').evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => animation instanceof CSSAnimation && animation.animationName.includes('ptah-drawer-'))
    .map((animation) => animation.finished)));
  await waitForSettled(page);
}

async function shoot(page: Page, name: string, host: Host, theme: string): Promise<void> {
  await page.screenshot({ path: capturePath(name, host, theme), animations: 'disabled' });
}

/**
 * Map §2.2: header, tab bar, the Membership card and the Agent behaviour card with all 4 rows end above the
 * fold; the Membership card is at most ~140 px in the community state.
 */
async function assertAdvancedFold(page: Page, host: Host, theme: string): Promise<void> {
  const membership = page.locator('ptah-license-status-card');
  const rows = page.locator('[data-testid^="agent-behaviour-row-"]');
  const measured = {
    scroll: await scrollTops(page),
    tabs: await bottomOf(page.locator('[data-testid="settings-tabs"]')),
    membership: await bottomOf(membership),
    membershipHeight: await heightOf(membership),
    behaviour: await bottomOf(page.locator('[data-testid="agent-behaviour-card"]')),
    rowHeights: await rows.evaluateAll((all) => all.map((row) => Math.round(row.getBoundingClientRect().height))),
  };
  console.log(`B49 fold advanced ${host}/${theme}: ${JSON.stringify(measured)}`);
  expect(measured.scroll).toBe(0);
  expect(measured.membershipHeight, 'Membership card height').toBeLessThanOrEqual(140);
  expect(measured.behaviour, 'Agent behaviour card bottom').toBeLessThanOrEqual(FOLD);
}

/**
 * Map §3.2: the Web search card (3 provider rows + policy bar) and, on Electron, the Voice engines heading
 * and both rows end above the fold; no provider row is taller than ~48 px.
 *
 * Ratchet (execution default 3): Batch 49 measured provider rows of 57-63 px and the Electron voice rows
 * ending at 686 px, so the budget was logged as `fold-pending`. Batch 50 made the rows compact (41 px; voice
 * rows end at 626 px) and turned enforcement on; it stays on from now on.
 */
const SEARCH_VOICE_FOLD_ENFORCED = true;

async function assertSearchVoiceFold(page: Page, host: Host, theme: string): Promise<void> {
  const providerRows = page.locator('ptah-web-search-config tbody tr');
  const measured = {
    scroll: await scrollTops(page),
    webSearch: await bottomOf(page.locator('ptah-web-search-config')),
    providerRowHeights: await providerRows.evaluateAll((all) => all.map((row) => Math.round(row.getBoundingClientRect().height))),
    voiceRows: host === 'electron' ? await bottomOf(page.locator('[data-testid="voice-engine-row-tts"]')) : null,
  };
  console.log(`B49 fold search-voice ${host}/${theme}: ${JSON.stringify(measured)}`);
  expect(measured.scroll).toBe(0);
  const over = [
    ...measured.providerRowHeights.filter((height) => height > 48).map((height) => `provider row ${height}px > 48px`),
    ...(measured.webSearch > FOLD ? [`web search card bottom ${measured.webSearch}px > ${FOLD}px`] : []),
    ...(measured.voiceRows !== null && measured.voiceRows > FOLD ? [`voice rows bottom ${measured.voiceRows}px > ${FOLD}px`] : []),
  ];
  if (SEARCH_VOICE_FOLD_ENFORCED) expect(over, 'map §3.2 fold budget').toEqual([]);
  else if (over.length) test.info().annotations.push({ type: 'fold-pending', description: `${host}/${theme}: ${over.join('; ')}` });
}

/** Runs one scene step; a failure is collected (first line only) so every later step is still measured. */
async function attempt(findings: string[], name: string, body: () => Promise<void>, cleanup?: () => Promise<void>): Promise<void> {
  try {
    await test.step(name, body);
  } catch (error: unknown) {
    findings.push(`${name}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`);
    await cleanup?.().catch(() => undefined);
  }
}

async function captureAdvanced(page: Page, host: Host, theme: string): Promise<unknown> {
  await gotoSettingsTab(page, 'Advanced');
  await expect(page.locator('[data-testid="output-style-matrix"]')).toBeVisible();
  await expect(page.locator('[data-testid="vscode-lm-model-select"]')).toBeVisible();
  await waitForSettled(page);
  const fold = await test.step('fold §2.2', () => assertAdvancedFold(page, host, theme)).then(() => null, (error: unknown) => error);
  await shoot(page, 'advanced', host, theme);
  await (await promptDetailsButton(page)).click();
  await expect(page.locator('[data-testid="system-prompt-generated-at"]')).toBeVisible();
  await waitForDrawer(page);
  await shoot(page, 'advanced-system-prompt-drawer', host, theme);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="output-style-card"]').scrollIntoViewIfNeeded();
  await shoot(page, 'advanced-output-style', host, theme);
  await styleRow(page, 'concise-reviewer').locator('[data-testid="output-style-edit-button"]').click();
  await expect(page.locator('#output-style-name')).toHaveValue('concise-reviewer');
  await waitForDrawer(page);
  await shoot(page, 'advanced-output-style-drawer', host, theme);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="output-style-drawer"]')).toHaveCount(0);
  await page.locator('ptah-mcp-port-config').scrollIntoViewIfNeeded();
  await shoot(page, 'advanced-mcp', host, theme);
  await page.locator('[data-testid="settings-toggle-browser-allow-localhost"]').click();
  await expect(page.locator('[data-testid="allow-localhost-confirm"]')).toBeVisible();
  await page.locator('[data-testid="allow-localhost-confirm"]').scrollIntoViewIfNeeded();
  await shoot(page, 'advanced-mcp-localhost-confirm', host, theme);
  await page.locator('[data-testid="allow-localhost-cancel-btn"]').click();
  await page.locator('ptah-vscode-lm-config').scrollIntoViewIfNeeded();
  await shoot(page, 'advanced-vscode-lm', host, theme);
  return fold;
}

async function captureSearchVoice(page: Page, host: Host, theme: string): Promise<unknown> {
  await searchVoiceTab(page);
  await expect(page.locator('[data-testid="settings-web-search-key-status-tavily"]')).toContainText('Key set');
  if (host === 'electron') {
    await expect(page.locator('[data-testid="voice-engine-model-tts"]')).toHaveText('Sarah');
    await expect(page.locator('[data-testid="go-vet-consent-card"]')).toBeVisible();
  }
  await waitForSettled(page);
  const fold = await test.step('fold §3.2', () => assertSearchVoiceFold(page, host, theme)).then(() => null, (error: unknown) => error);
  await shoot(page, 'search-voice', host, theme);
  if (host !== 'electron') return fold;
  await openVoiceDrawer(page, 'stt');
  await expect(page.locator('[data-testid="local-stt-panel-table"]')).toBeVisible();
  await waitForDrawer(page);
  await shoot(page, 'voice-drawer-local', host, theme);
  await closeDrawers(page);
  await openVoiceDrawer(page, 'tts');
  await expect(page.locator('[data-testid="elevenlabs-voice-select"]')).toBeVisible();
  await waitForDrawer(page);
  await shoot(page, 'voice-drawer-elevenlabs', host, theme);
  await closeDrawers(page);
  await chooseVoiceProvider(page, 'tts', 'local');
  await dismissToast(page, 'Saved text-to-speech provider.');
  await openVoiceDrawer(page, 'tts');
  await expect(page.locator('[data-testid="local-tts-voice-select"]')).toBeVisible();
  await waitForDrawer(page);
  await shoot(page, 'voice-drawer-local-tts', host, theme);
  await closeDrawers(page);
  await chooseVoiceProvider(page, 'tts', 'elevenlabs');
  await dismissToast(page, 'Saved text-to-speech provider.');
  await page.locator('[data-testid="go-vet-consent-card"]').scrollIntoViewIfNeeded();
  await shoot(page, 'go-vet', host, theme);
  return fold;
}

for (const host of HOSTS) {
  for (const theme of ['anubis', 'anubis-light'] as const) {
    test(`advanced + search & voice captures and fold (${host}, ${theme})`, async ({ page, fixtureServer }) => {
      test.setTimeout(120_000);
      await bootSettings(page, fixtureServer.url, host, theme);
      await page.setViewportSize({ width: 1024, height: 768 });
      // A fold failure is reported after every capture was taken (a red fold must not hide them).
      const folds = [await captureAdvanced(page, host, theme), await captureSearchVoice(page, host, theme)];
      const failure = folds.find((fold) => fold !== null);
      if (failure) throw failure;
    });
  }

  test(`drawers, popovers and inline confirms close on Esc and return focus (${host})`, async ({ page, fixtureServer }) => {
    test.setTimeout(180_000);
    await bootSettings(page, fixtureServer.url, host);
    await page.setViewportSize({ width: 1024, height: 768 });
    const findings: string[] = [];
    const by = (testId: string) => page.locator(`[data-testid="${testId}"]`);
    const escape = (name: string, opener: () => Promise<Locator> | Locator, opened: Locator, cleanup?: () => Promise<void>) =>
      attempt(findings, name, async () => expectEscReturnsFocus(page, await opener(), opened), cleanup);
    await escape('Advanced: system prompt drawer (D-SP)', () => promptDetailsButton(page), by('system-prompt-drawer'));
    await escape('Advanced: membership key popover', () => by('membership-key-trigger'), by('membership-key-popover'));
    await escape('Advanced: import confirm', () => page.getByRole('button', { name: 'Import settings' }), by('import-confirm'),
      () => by('import-confirm').getByRole('button', { name: 'Cancel' }).click());
    await escape('Advanced: effort popover', () => by('agent-behaviour-effort-value'), by('agent-behaviour-effort-choice-high'));
    await escape('Advanced: new output style drawer (D-OS)', () => by('output-style-new-button'), by('output-style-drawer'));
    await escape('Advanced: edit output style drawer (D-OS)',
      () => styleRow(page, 'concise-reviewer').locator('[data-testid="output-style-edit-button"]'), by('output-style-drawer'));
    await escape('Advanced: output style delete confirm',
      () => styleRow(page, 'team-house-style').locator('[data-testid="output-style-delete-button"]'), by('output-style-delete-confirm'),
      () => by('output-style-delete-confirm').getByRole('button', { name: 'Cancel' }).click());
    await escape('Advanced: allow localhost confirm', () => by('settings-toggle-browser-allow-localhost'), by('allow-localhost-confirm'),
      () => by('allow-localhost-cancel-btn').click());
    await searchVoiceTab(page);
    await escape('Search: web search key popover', () => by('settings-web-search-key-btn-serper'), by('settings-web-search-key-input'));
    await escape('Search: web search clear confirm', () => by('settings-web-search-clear-btn-tavily'),
      by('settings-web-search-clear-group-tavily'), () => by('settings-web-search-clear-cancel-tavily').click());
    if (host === 'electron') {
      await escape('Voice: provider popover', () => by('voice-provider-btn-stt'), by('voice-provider-option-stt-local'));
      for (const direction of ['stt', 'tts'] as const) {
        await escape(`Voice: details drawer (${direction})`, () => by(`voice-engine-details-${direction}`), by('voice-details-drawer'));
      }
      await attempt(findings, 'Voice: ElevenLabs clear confirm', async () => {
        await openVoiceDrawer(page, 'tts');
        await expectEscReturnsFocus(page, by('elevenlabs-key-clear'), by('elevenlabs-clear-group'));
      });
      await closeDrawers(page).catch(() => undefined);
      await escape('go vet: enable confirm', () => by('go-vet-consent-toggle'), by('go-vet-consent-confirm'),
        () => by('go-vet-consent-cancel').click());
    }
    console.log(`B49 focus ${host}: ${findings.length ? findings.join(' | ') : 'all pass'}`);
    expect(findings, 'Esc must close each overlay and return focus to its opener').toEqual([]);
  });

  test(`D15: failed writes show no "Saved", revert, and show the fixed sentence (${host})`, async ({ page, fixtureServer }) => {
    test.setTimeout(120_000);
    await bootSettings(page, fixtureServer.url, host);
    const failures = asvState(page).failures;
    const findings: string[] = [];
    await gotoSettingsTab(page, 'Advanced');
    await attempt(findings, 'effort (transport failure)', async () => {
      const value = page.locator('[data-testid="agent-behaviour-effort-value"]');
      await expect(value).toContainText('Medium');
      failures.set('config:effort-set', rpcError(HOST_DETAIL));
      await value.click();
      await page.locator('[data-testid="agent-behaviour-effort-choice-high"]').click();
      await expectFailedWrite(page, 'Could not save the chat reasoning effort.');
      await expect(value).toContainText('Medium');
    });
    await dismissToast(page);
    await attempt(findings, 'output style ({success:false})', async () => {
      failures.set('outputStyle:activate', { success: false, decision: { path: 'none' }, error: { code: 'WRITE_FAILED', message: HOST_DETAIL } });
      await styleRow(page, 'Learning').getByRole('radio').click();
      await expectFailedWrite(page, 'Could not change the active output style.');
      await expect(page.locator('[data-testid="output-style-error"]')).toContainText('Could not change the active output style.');
      await expect(styleRow(page, 'Learning').getByRole('radio')).not.toBeChecked();
      await expect(styleRow(page, 'concise-reviewer').getByRole('radio')).toBeChecked();
    });
    await dismissToast(page);
    await attempt(findings, 'output style: a cancelled parity confirm keeps the saved style on screen', async () => {
      await page.locator('[data-testid="output-style-parity-details"] summary').click();
      await page.locator('[data-testid="output-style-parity-checkbox"]').check();
      await styleRow(page, 'Learning').getByRole('radio').click();
      await page.locator('[data-testid="parity-cancel-button"]').click();
      await expect(styleRow(page, 'Learning').getByRole('radio')).not.toBeChecked();
      await expect(styleRow(page, 'concise-reviewer').getByRole('radio')).toBeChecked();
    });
    await searchVoiceTab(page);
    await attempt(findings, 'web search ({success:false})', async () => {
      const serper = page.locator('[data-testid="settings-toggle-web-search-provider-serper"]');
      failures.set('webSearch:setConfig', { success: false, error: HOST_DETAIL });
      await serper.click();
      await expectFailedWrite(page, 'Could not save the web search providers.');
      await expect(serper).not.toBeChecked();
    });
    await dismissToast(page);
    if (host === 'electron') {
      await attempt(findings, 'STT model ({ok:false})', async () => {
        await openVoiceDrawer(page, 'stt');
        const select = page.locator('[data-testid="local-stt-model-select"]');
        failures.set('voice:setConfig', { ok: false, error: HOST_DETAIL });
        await select.selectOption('small.en');
        await expectFailedWrite(page, 'Could not save the voice configuration.');
        await expect(select).toHaveValue('base.en');
        await expect(page.locator('[data-testid="local-stt-panel-error"]')).toContainText('Could not save the voice configuration.');
      });
      await dismissToast(page);
      await closeDrawers(page).catch(() => undefined);
      await attempt(findings, 'TTS voice ({ok:false})', async () => {
        await chooseVoiceProvider(page, 'tts', 'local');
        await dismissToast(page, 'Saved text-to-speech provider.');
        await openVoiceDrawer(page, 'tts');
        const select = page.locator('[data-testid="local-tts-voice-select"]');
        await expect(select).toHaveValue('af_heart');
        failures.set('voice:setTtsConfig', { ok: false, error: HOST_DETAIL });
        await select.selectOption('am_michael');
        await expectFailedWrite(page, 'Could not save the text-to-speech configuration.');
        await expect(select).toHaveValue('af_heart');
      });
      await dismissToast(page);
      await closeDrawers(page).catch(() => undefined);
    }
    console.log(`B49 D15 ${host}: ${findings.length ? findings.join(' | ') : 'all pass'}`);
    expect(findings, 'D15: no "Saved", control reverted, fixed sentence').toEqual([]);
  });
}
