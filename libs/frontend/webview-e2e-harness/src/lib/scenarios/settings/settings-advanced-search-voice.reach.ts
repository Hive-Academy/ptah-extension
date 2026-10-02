/**
 * Reach helpers for the Advanced and Search & Voice Gate G entries and scenes (TASK_2026_555 Batch 49):
 * tab switching and remounting, the save toast (D15: "Saved" only after the write's own result), the
 * fixture state of the two tabs, and a second-page boot for states the shared session cannot show.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { installCspStub } from '../../csp-stub';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { baseSettingsFixtures, getFixtureState, gotoSettingsTab, installHost, installRpcAutoResponder, type RecordedCall } from './settings.fixtures';
import { asvStateFor, HOST_DETAIL, withAdvancedSearchVoice, type AsvState } from './settings-advanced-search-voice.fixtures';
import { advancedTab, visibleEnabled } from './settings-drawer.reach';

export const searchVoiceTab = (page: Page) => gotoSettingsTab(page, 'Search & Voice');

/** The Advanced / Search & Voice fixture state of the boot `page` belongs to. */
export const asvState = (page: Page): AsvState => asvStateFor(getFixtureState(page));

export const isElectron = async (page: Page): Promise<boolean> => (await page.locator('ptah-electron-shell').count()) > 0;

/**
 * Leaves and re-enters a tab so its components mount again and re-read the fixture state (each tab lives
 * in an `@if` in `settings.component.html`, so leaving it destroys it).
 */
export async function remountTab(page: Page, tab: 'Advanced' | 'Search & Voice'): Promise<void> {
  await gotoSettingsTab(page, tab === 'Advanced' ? 'Search & Voice' : 'Advanced');
  await gotoSettingsTab(page, tab);
}

/** Footer buttons that close the two tabs' drawers (D-SP, D-OS, D-VOICE). */
const DRAWER_CLOSERS = ['system-prompt-drawer-close', 'output-style-cancel-button', 'voice-details-close'];

/**
 * Closes whichever of the two tabs' drawers is open through its footer button, and waits until no drawer is
 * left. Esc is not used here: it goes to a focused control first (a `<select>`, a busy button), and a drawer
 * left open makes the page inert for every entry after it (Batch 49 Gate G run 3). Best-effort, for `finally`.
 */
export async function closeDrawers(page: Page): Promise<void> {
  for (const testId of DRAWER_CLOSERS) {
    const closer = page.locator(`[data-testid="${testId}"]`);
    if (await closer.count()) await closer.first().click({ timeout: 5000 }).catch(() => undefined);
  }
  await expect(page.locator('[data-testid="native-drawer-panel"]')).toHaveCount(0);
}

/** Changes the fixture state, remounts `tab`, runs `body`, then restores the state and remounts again. */
export async function withAsvChange(page: Page, tab: 'Advanced' | 'Search & Voice', change: (state: AsvState) => () => void,
  body: () => Promise<void>): Promise<void> {
  const restore = change(asvState(page));
  try {
    await remountTab(page, tab);
    await body();
  } finally {
    await closeDrawers(page).catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
    restore();
    await remountTab(page, tab);
  }
}

export const toast = (page: Page): Locator => page.locator('[data-testid="settings-toast"]');
export const toastMessage = (page: Page): Locator => page.locator('[data-testid="settings-toast-message"]');

/**
 * Closes the save toast, so it neither covers nor answers for the next step: it sits over the bottom-right
 * corner, where the drawers' footer Close is (Batch 49 finding). After a write, pass the `expected` message:
 * the toast renders after the write settles, and dismissing before it exists would leave it on screen.
 */
export async function dismissToast(page: Page, expected?: string): Promise<void> {
  if (expected !== undefined) await expect(toastMessage(page)).toHaveText(expected);
  const dismiss = page.locator('[data-testid="settings-toast-dismiss"]');
  if (await dismiss.count()) await dismiss.click().catch(() => undefined);
  await expect(toast(page)).toHaveCount(0);
}

/** Calls of `method` recorded after `before`. */
export const callsOf = (page: Page, before: number, method: string): RecordedCall[] =>
  getFixtureState(page).calls.slice(before).filter((call) => call.method === method);

/** Waits until a `method` call recorded after `before` matches `params` (a partial match). */
export async function expectWrite(page: Page, before: number, method: string, params: Record<string, unknown>): Promise<void> {
  await expect.poll(() => callsOf(page, before, method).map((call) => call.params))
    .toContainEqual(expect.objectContaining(params));
}

/**
 * Asserts the success toast "Saved {label}." after a write, then takes its Undo and asserts the Undo is a
 * second, real write (`undo` params) that toasts again. Dismisses the toast at the end.
 */
export async function expectSavedThenUndo(page: Page, label: string, method: string, undo: Record<string, unknown>): Promise<void> {
  await expect(toast(page)).toHaveAttribute('role', 'status');
  await expect(toastMessage(page)).toHaveText(`Saved ${label}.`);
  const before = getFixtureState(page).calls.length;
  const undoButton = page.locator('[data-testid="settings-toast-undo"]');
  await visibleEnabled(undoButton);
  await undoButton.click();
  await expectWrite(page, before, method, undo);
  await expect(toastMessage(page)).toHaveText(`Saved ${label}.`);
  await dismissToast(page);
}

/**
 * D15 after a failed write: the toast is an alert carrying exactly `sentence` (a fixed sentence: no "Saved",
 * no host text), and nothing on the page shows the fixture's raw host text.
 */
export async function expectFailedWrite(page: Page, sentence: string): Promise<void> {
  await expect(toast(page)).toHaveAttribute('role', 'alert');
  await expect(toastMessage(page)).toHaveText(sentence);
  await expect(toastMessage(page)).not.toContainText('Saved');
  await expect(page.locator('body')).not.toContainText(HOST_DETAIL);
}

/** Opens a drawer or inline confirm with `opener`, asserts `opened`, closes it with Esc and asserts focus is back on `opener`. */
export async function expectEscReturnsFocus(page: Page, opener: Locator, opened: Locator): Promise<void> {
  await visibleEnabled(opener);
  await opener.click();
  await expect(opened).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opened).toHaveCount(0);
  await expect(opener).toBeFocused();
}

/** Advanced tab, then the Agent behaviour card's System prompt Details button (opener of drawer D-SP). */
export async function promptDetailsButton(page: Page): Promise<Locator> {
  await advancedTab(page);
  const button = page.locator('[data-testid="agent-behaviour-prompt-details"]');
  await visibleEnabled(button);
  return button;
}

/** A row of the Output style matrix by style name. */
export const styleRow = (page: Page, name: string): Locator => page.locator(`[data-testid="output-style-row-${name}"]`);

/** Search & Voice tab, then a voice direction's Details: returns the open drawer D-VOICE. */
export async function openVoiceDrawer(page: Page, direction: 'stt' | 'tts'): Promise<Locator> {
  await searchVoiceTab(page);
  const details = page.locator(`[data-testid="voice-engine-details-${direction}"]`);
  await visibleEnabled(details);
  await details.click();
  const drawer = page.locator('[data-testid="voice-details-drawer"]');
  await expect(drawer).toBeVisible();
  return page.locator('[data-testid="native-drawer-panel"]');
}

/** Chooses a voice provider for `direction` in the matrix popover (a save on selection). */
export async function chooseVoiceProvider(page: Page, direction: 'stt' | 'tts', providerId: string): Promise<void> {
  await searchVoiceTab(page);
  await page.locator(`[data-testid="voice-provider-btn-${direction}"]`).click();
  const option = page.locator(`[data-testid="voice-provider-option-${direction}-${providerId}"]`);
  await visibleEnabled(option);
  await option.click();
}

/**
 * Boots a SECOND page in the same browser context, with the two tabs' fixture state changed by `configure`
 * (for reads the app fetches once and caches: `license:getStatus` at start, `llm:getProviderStatus` in
 * `LlmProviderStateService`), opens `tab` and runs `assertion` with the variant's recorded calls. The shared
 * session page is untouched.
 */
export async function throughAsvVariant(page: Page, configure: (state: AsvState) => void, tab: 'Advanced' | 'Search & Voice',
  assertion: (variantPage: Page, calls: RecordedCall[]) => Promise<void>): Promise<void> {
  const electron = await isElectron(page);
  const variantPage = await page.context().newPage();
  const owner = { calls: [] as RecordedCall[] };
  // The CSP stub re-fetches every asset (`route.fetch`) under the 10 s action timeout; loading the 3.3 MB
  // bundle a second time, while the session page is open, exceeded it under load (Batch 49 Gate G run 2).
  variantPage.setDefaultTimeout(30_000);
  try {
    await installCspStub(variantPage);
    const bridge = await installPostMessageBridge(variantPage);
    await installHost(variantPage, electron ? 'electron' : 'vscode', 'chat');
    await installRpcAutoResponder(variantPage, withAdvancedSearchVoice(owner, baseSettingsFixtures(), configure));
    await variantPage.goto(page.url());
    await expect(variantPage.locator(electron ? 'ptah-electron-shell' : 'ptah-app-shell').first()).toBeVisible({ timeout: 15000 });
    await bridge.inject({ type: 'switchView', payload: { view: 'settings' } });
    await expect(variantPage.locator('[data-testid="settings-back"]')).toBeVisible({ timeout: 15000 });
    await gotoSettingsTab(variantPage, tab);
    await assertion(variantPage, owner.calls);
  } finally {
    await variantPage.close();
  }
}
