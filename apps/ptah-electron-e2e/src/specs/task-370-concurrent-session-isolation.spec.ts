import { randomUUID } from 'crypto';
import { test, expect } from '../support/fixtures';

/**
 * TASK_2026_370 — two chat sessions that stream at the same time must each
 * render only their own assistant text.
 *
 * ## What this spec does NOT cover
 *
 * The defect was in the BACKEND. `SdkMessageTransformer` was a tsyringe
 * singleton whose per-stream maps were keyed by `parent_tool_use_id` with no
 * session dimension, so two concurrent sessions overwrote each other's root
 * message, and a `compaction_complete` in one session called
 * `clearStreamingState()` and wiped the others. The fix routes the interactive
 * path through `createIsolated()`. Reproducing THAT needs two real SDK streams
 * running at once; this harness has no fake provider, so the backend half is
 * not drivable here and is reported as not-observable.
 *
 * ## What this spec DOES cover
 *
 * The renderer-side half of the same invariant: given per-session events, the
 * canvas must keep two live transcripts apart, and a compaction in one session
 * must not disturb the other. That is the property a user reads off the screen,
 * and it is the property that would have made the backend defect visible.
 *
 * ## Method
 *
 * Two Rail panes (the first session opened beside the second via "Open
 * beside"; each pane is a former "tile"), each bound to its own session through the documented
 * "hijack" branch of `StreamingHandlerService.processStreamEvent`
 * (`streaming-handler.service.ts` ~line 142): an event carrying no `tabId`
 * binds the ACTIVE tab when that tab is unbound and fresh/draft/streaming. So
 * each pane is clicked to make it active immediately before its session's
 * first event is pushed. The binding is then VERIFIED (each tile shows its own
 * marker and not the other's) rather than assumed.
 *
 * Deltas for the two sessions are interleaved, not batched per session, so an
 * accumulator keyed without a session dimension would visibly cross the
 * streams.
 *
 * Falsifiability: the first assertion pair is itself the control — a tile that
 * rendered nothing would fail `toContainText` before the isolation assertion
 * could pass vacuously. The compaction step adds a second control: session A's
 * tile MUST visibly change (its transcript is cleared and reloaded by
 * `CompactionLifecycleService.handleCompactionComplete`), which proves the
 * compaction event was delivered and acted upon, so B keeping its marker is a
 * real isolation result and not a dropped event.
 */

const CHAT_CHUNK = 'chat:chunk';
const A_MARKER = 'PTAH_E2E_A_MARKER';
const B_MARKER = 'PTAH_E2E_B_MARKER';
const BUBBLE = '[data-testid="chat-tool-output"]';
const COMPOSER = 'ptah-chat-input textarea[role="combobox"]';

function chunk(sessionId: string, event: Record<string, unknown>) {
  return { type: CHAT_CHUNK, payload: { sessionId, event } };
}

function messageStart(sessionId: string, messageId: string, timestamp: number) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'message_start',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    role: 'assistant',
  });
}

function textDelta(
  sessionId: string,
  messageId: string,
  timestamp: number,
  delta: string,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'text_delta',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    delta,
    blockIndex: 0,
  });
}

function compactionComplete(
  sessionId: string,
  messageId: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'compaction_complete',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    trigger: 'auto',
    preTokens: 120_000,
    postTokens: 20_000,
    durationMs: 4_200,
  });
}

test.describe('Concurrent session isolation on the canvas (TASK_2026_370)', () => {
  test('two tiles streaming at once each render only their own session text, and a compaction in one leaves the other intact', async ({
    ui,
  }) => {
    const page = ui.page;

    // The compaction reload path calls session:load then chat:resume. Answer
    // both with an empty history so the reload settles instead of throwing —
    // an empty reload is also what makes the cleared tile observable.
    await ui.mockRpc({
      'session:load': { session: null },
      'chat:resume': { events: [] },
      'session:list': { sessions: [], total: 0, hasMore: false },
    });

    await ui.goto('chat');

    // Second session: the Rail footer New session button, then the create dialog's Create
    // button. The Rail shows one focused pane, and the new session takes it.
    await page.locator('[data-testid="canvas-footer-new-session"]').first().click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const cards = page.locator('ptah-canvas-rail [data-rail-card]');
    await expect(cards).toHaveCount(2);
    await expect(ui.canvasPanes()).toHaveCount(1);

    // Show both sessions at once: open the first card beside the new one. Its
    // session (A) takes the opposite pane and becomes the active one; the new
    // session (B) keeps its pane. The two panes are the former "tiles".
    const { opened: tileA, kept: tileB } = await ui.openRailCardBeside(
      cards.first(),
    );
    await expect(ui.canvasPanes()).toHaveCount(2);

    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const messageA = randomUUID();
    const messageB = randomUUID();
    const t0 = Date.now();

    // Bind pane A. Clicking inside a pane makes it the active one (the board's
    // activatePane -> canvasStore.focusTile -> tabManager.switchTab), which is
    // what makes it the hijack target. The pane label ends ", active" while it is.
    // Panes have no header row, so click the pane's own composer: it has no
    // side effect beyond activating the pane.
    await tileA.locator(COMPOSER).click();
    await expect(tileA).toHaveAttribute('aria-label', /, active$/);
    await ui.pushEvent(messageStart(sessionA, messageA, t0));
    await ui.pushEvent(textDelta(sessionA, messageA, t0 + 1, `${A_MARKER}-1 `));
    await expect(tileA.locator(BUBBLE)).toContainText(A_MARKER);

    // Bind pane B the same way.
    await tileB.locator(COMPOSER).click();
    await expect(tileB).toHaveAttribute('aria-label', /, active$/);
    await ui.pushEvent(messageStart(sessionB, messageB, t0 + 2));
    await ui.pushEvent(textDelta(sessionB, messageB, t0 + 3, `${B_MARKER}-1 `));
    await expect(tileB.locator(BUBBLE)).toContainText(B_MARKER);

    // Now interleave. A single shared accumulator keyed without a session
    // dimension crosses the streams exactly here.
    await ui.pushEvent(textDelta(sessionA, messageA, t0 + 4, `${A_MARKER}-2 `));
    await ui.pushEvent(textDelta(sessionB, messageB, t0 + 5, `${B_MARKER}-2 `));
    await ui.pushEvent(textDelta(sessionA, messageA, t0 + 6, `${A_MARKER}-3 `));
    await ui.pushEvent(textDelta(sessionB, messageB, t0 + 7, `${B_MARKER}-3 `));

    // Each tile shows all three of its own deltas and none of the other's.
    await expect(tileA.locator(BUBBLE)).toContainText(`${A_MARKER}-3`);
    await expect(tileB.locator(BUBBLE)).toContainText(`${B_MARKER}-3`);
    await expect(tileA.locator(BUBBLE)).not.toContainText(B_MARKER);
    await expect(tileB.locator(BUBBLE)).not.toContainText(A_MARKER);

    // Compaction on session A only. The visible effect (compaction-lifecycle.
    // service.ts `handleCompactionComplete`) is: every tab bound to A is
    // cleared and reloaded from the backend. B is bound to another session and
    // must be untouched.
    await ui.pushEvent(compactionComplete(sessionA, messageA, t0 + 8));

    await expect(tileA.locator(BUBBLE)).toHaveCount(0);
    // Control: A really did change, so the event was delivered and applied.
    await expect(tileB.locator(BUBBLE)).toContainText(`${B_MARKER}-3`);
    await expect(tileB.locator(BUBBLE)).not.toContainText(A_MARKER);
  });
});
