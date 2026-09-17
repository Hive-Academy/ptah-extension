import { test, expect } from '../support/fixtures';
import type { UiDriver } from '../support/ui-driver';

/**
 * Pins the TASK_2026_360 "dead tab after a failed start" fix.
 *
 * ## The defect
 *
 * `MessageSenderService.startNewConversation` (message-sender.service.ts)
 * marks the tab busy OPTIMISTICALLY — `applyNewConversationStreaming` +
 * `markTabStreaming(tabId)` — BEFORE the `chat:start` RPC is issued. Those are
 * two separate stores: `status` and the `_streamingTabIds` spinner set.
 *
 * When `chat:start` fails STRUCTURALLY (transport succeeded, the backend
 * rejected the turn — here with `errorCode: 'AUTH_REQUIRED'`), the failure exit
 * used to call `markLoaded(tabId)` only. `markLoaded` writes `status` and
 * nothing else, so the tab stayed in `_streamingTabIds`. Nothing downstream
 * could ever repair that: the turn never created a broadcaster, so no
 * `turn_state` and no `CHAT_ERROR` event was ever going to arrive for it.
 *
 * `isTabBusyGenerating` (message-dispatch.service.ts) ORs the spinner set in,
 * so every following send was routed to `ConversationService.queueOrAppendMessage`
 * instead of the sender — and the only drains for that queue are a root
 * turn-end (which cannot happen: there is no turn) and the Stop button. The
 * tile was a dead end until reload.
 *
 * ## The fix
 *
 * `markTabIdle(activeTabId)` after `markLoaded` on BOTH pre-stream exits of
 * `startNewConversation` — the structural-failure branch and the `catch`
 * branch — mirroring what `runContinueConversation` already did.
 *
 * ## Falsifiability — what fails WITHOUT the fix
 *
 * The tab stays in `_streamingTabIds`, so `isTabBusyGenerating` returns true
 * and three assertions below break:
 *
 * 1. `[data-testid="chat-stop-btn"]` is rendered (the Stop button reads the
 *    same predicate), so `toHaveCount(0)` fails.
 * 2. The second send is queued, so the literal "Message queued" banner
 *    (chat-view.component.html) appears and `toHaveCount(0)` fails.
 * 3. No second RPC leaves the renderer, so the observed send-call total stays
 *    at 1 instead of reaching 2.
 *
 * ## Method
 *
 * `UiDriver`'s fake main-process 'rpc' listener answers every renderer RPC
 * from a mock map, wrapping the mocked value as
 * `{ type: 'rpc:response', success: true, data: V }`. Mocking `chat:start` to
 * `{ success: false, errorCode: 'AUTH_REQUIRED' }` is therefore a STRUCTURAL
 * failure, not a transport failure — `result.success` is true and
 * `result.data.success` is false, which is exactly the branch the fix lives
 * in. The `ptah-auth-required-banner` assertion proves the run really took
 * that AUTH_REQUIRED path (`handleAuthRequired` ->
 * `AuthStateService.flagAuthRequired`) rather than some other exit.
 */

const FIRST_MARKER = 'PTAH_E2E_360_FIRST_SEND_MARKER';
const SECOND_MARKER = 'PTAH_E2E_360_SECOND_SEND_MARKER';

const TEXTAREA = 'ptah-chat-input textarea[role="combobox"]';
const SEND_BUTTON = '[data-testid="chat-send-btn"]';
const STOP_BUTTON = '[data-testid="chat-stop-btn"]';
const QUEUED_BANNER_TEXT = 'Message queued';

interface ObservedCall {
  method: string;
  params: unknown;
}

/**
 * Every RPC that carries a user's message to the backend, in order. A send is
 * `chat:start` on an unbound tab and `chat:continue` on a bound one; the
 * failure under test leaves the tab unbound, so both are counted rather than
 * assumed.
 */
async function sendCalls(ui: UiDriver): Promise<ObservedCall[]> {
  const starts = await ui.getObservedCalls('chat:start');
  const continues = await ui.getObservedCalls('chat:continue');
  return [...starts, ...continues];
}

function promptOf(call: ObservedCall): string {
  const params = call.params as { prompt?: string } | null;
  return params?.prompt ?? '';
}

test.describe('Failed chat:start leaves the tab idle (TASK_2026_360)', () => {
  test('a chat:start that fails before any stream (AUTH_REQUIRED) leaves the tile with no Stop button and the next send dispatches instead of queuing', async ({
    ui,
  }) => {
    const page = ui.page;

    // Mocked BEFORE the send, so the very first `chat:start` takes the
    // structural-failure exit.
    await ui.mockRpc({
      'chat:start': {
        success: false,
        errorCode: 'AUTH_REQUIRED',
        error: 'Authentication required.',
      },
    });

    await ui.goto('chat');

    const textarea = page.locator(TEXTAREA).first();
    const sendButton = page.locator(SEND_BUTTON).first();

    await textarea.fill(FIRST_MARKER);
    await sendButton.click();

    const firstStart = await ui.waitForObservedCall('chat:start');
    expect(promptOf(firstStart)).toBe(FIRST_MARKER);

    // The failure really was the AUTH_REQUIRED structural path: only
    // `handleAuthRequired` raises this banner. Scoped to the canvas tile
    // because the banner reads GLOBAL `AuthStateService` state, so every
    // mounted `ptah-chat-view` renders one — including the shell's own
    // non-canvas instance, which is never visible in Electron.
    await expect(
      page
        .locator('[data-testid="canvas-tile"] ptah-auth-required-banner')
        .first(),
    ).toBeVisible();

    // The tab settled idle. `toHaveCount(0)` waits, so this is not a race
    // against the button appearing late.
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0);
    await expect(page.getByText(QUEUED_BANNER_TEXT)).toHaveCount(0);

    await textarea.fill(SECOND_MARKER);
    await expect(sendButton).toBeEnabled();

    await sendButton.click();

    // A NEW RPC left the renderer immediately. Pre-fix the dispatcher queued
    // this content and the total stayed at 1.
    await expect
      .poll(async () => (await sendCalls(ui)).length, { timeout: 10_000 })
      .toBe(2);

    const calls = await sendCalls(ui);
    expect(promptOf(calls[calls.length - 1])).toBe(SECOND_MARKER);

    await expect(page.getByText(QUEUED_BANNER_TEXT)).toHaveCount(0);
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0);
  });
});
