import { randomUUID } from 'crypto';
import { test, expect } from '../support/fixtures';

/**
 * TASK_2026_374 — after the user aborts a turn, the session must not stay
 * "busy" forever, and the NEXT turn on that session must drive the UI normally.
 *
 * ## What this spec does NOT cover
 *
 * The backend leak — `SessionTurnStateRegistry` keeping a record after an abort
 * (`libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts`,
 * `chat-stream-broadcaster.service.ts`) — needs a real SDK turn to abort. This
 * harness has no fake provider, so that half is not drivable here and is
 * reported as not-observable.
 *
 * ## What this spec DOES cover
 *
 * The renderer contract the backend fix exists to keep working, end to end
 * through the real app: Stop appears while a turn generates, clicking Stop
 * really issues `chat:abort` for that session, the ordered terminal
 * `turn_state` the broadcaster sends on abort clears Stop, and the NEXT turn
 * on the SAME session lights Stop again and clears it at idle.
 *
 * ## Method
 *
 * `turn_state` is intercepted before the accumulator and before the hijack
 * branch (`streaming-handler.service.ts`), so a `turn_state` alone can never
 * bind a tab. The tile is therefore bound first by an ordinary `message_start`
 * on the session, exactly as production does, and only then driven by
 * `turn_state` events.
 *
 * The terminal event is modelled on `SessionTurnStateRegistry.forceIdle`,
 * which `ChatStreamBroadcaster` calls on a user abort: `phase: 'idle'`,
 * `terminalReason: 'aborted_streaming'`, empty `backgroundTasks` and
 * `sessionCrons`.
 *
 * Revisions are monotonic per SESSION (`TabManagerService.acceptsTurnState`),
 * so each event below carries a higher revision than the last.
 *
 * ## Falsifiability
 *
 * The last step is the control: a `generating` event carrying an OLD revision,
 * pushed after the tab has settled at a higher one, must be dropped and must
 * NOT re-light Stop. Without that control, "Stop is visible after a
 * generating" would pass for a renderer that lit the button on any event at
 * all. The abort assertion is likewise checked against the RPC the renderer
 * actually made and its parameters, not against a UI state change alone.
 */

const CHAT_CHUNK = 'chat:chunk';
const TILE = '[data-testid="canvas-tile"]';
/**
 * Scoped to the canvas tile on purpose. Electron mounts a second chat input
 * outside the canvas grid, so an unscoped test id matches two buttons and
 * Playwright's strict mode refuses it. The tile's own button is the one a user
 * on the Orchestra Canvas clicks.
 */
const STOP_BUTTON = '[data-testid="chat-stop-btn"]';

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

function turnState(
  sessionId: string,
  phase: 'generating' | 'idle',
  revision: number,
  timestamp: number,
  terminalReason: string | null = null,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'turn_state',
    timestamp,
    sessionId,
    messageId: `turn-state-${sessionId}`,
    phase,
    revision,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason,
  });
}

test.describe('Abort then next turn on the same session (TASK_2026_374)', () => {
  test('Stop issues chat:abort, clears on the aborted turn terminal state, and the next turn lights it again — while a stale generating does not', async ({
    ui,
  }) => {
    const page = ui.page;

    await ui.mockRpc({
      // No running sub-agents, so `abortWithConfirmation` aborts immediately
      // instead of opening its confirmation dialog.
      'chat:running-agents': { agents: [] },
      'chat:abort': { resumableSubagents: [] },
    });

    await ui.goto('chat');

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const t0 = Date.now();
    const tile = page.locator(TILE).first();
    const stop = tile.locator(STOP_BUTTON);

    // Bind the tile to the session. `turn_state` cannot do this itself.
    await ui.pushEvent(messageStart(sessionId, messageId, t0));

    // Turn 1 starts.
    await ui.pushEvent(turnState(sessionId, 'generating', 1, t0 + 1));
    await expect(stop).toBeVisible();

    // The user aborts.
    await stop.click();
    const abortCall = await ui.waitForObservedCall('chat:abort');
    expect(abortCall.params).toMatchObject({ sessionId });

    // The RPC succeeded, so the renderer deliberately does NOT idle the tab
    // itself — it waits for the backend's ordered terminal event.
    await expect(stop).toBeVisible();

    // The terminal state the broadcaster emits for a user abort.
    await ui.pushEvent(
      turnState(sessionId, 'idle', 2, t0 + 2, 'aborted_streaming'),
    );
    await expect(stop).toHaveCount(0);

    // Turn 2 on the SAME session must drive the UI normally.
    await ui.pushEvent(turnState(sessionId, 'generating', 3, t0 + 3));
    await expect(stop).toBeVisible();

    await ui.pushEvent(turnState(sessionId, 'idle', 4, t0 + 4, 'completed'));
    await expect(stop).toHaveCount(0);

    // Control: a stale `generating` at a revision the tab has already passed
    // must be dropped. If this re-lit Stop, every assertion above would be
    // satisfied by a renderer that ignores revisions entirely.
    await ui.pushEvent(turnState(sessionId, 'generating', 2, t0 + 5));
    await expect(stop).toHaveCount(0);

    // A FRESH generating still works after the stale one — proving the drop
    // above was a revision decision, not a dead session.
    await ui.pushEvent(turnState(sessionId, 'generating', 5, t0 + 6));
    await expect(stop).toBeVisible();
  });
});
