import { randomUUID } from 'crypto';
import { test, expect } from '../support/fixtures';
import type { UiDriver } from '../support/ui-driver';

/**
 * Pins the TASK_2026_382 "late post-turn event pins the tab into queue-only
 * mode" fix.
 *
 * ## The defect
 *
 * A subagent routinely outlives its parent turn, so `agent_progress` /
 * `agent_completed` events keep arriving for a session AFTER the root
 * `turn_state` phase `idle` settled the tab (status `loaded`,
 * `streamingState` cleared by `MessageFinalizationService`).
 *
 * `StreamingHandlerService.processStreamEventForTab` used to mint an EMPTY
 * `StreamingState` for any event routed to a tab that had none. Only
 * `message_start` ever sets `currentMessageId`, and
 * `MessageFinalizationService.finalizeCurrentMessage` early-returns on a null
 * `currentMessageId` — so that minted state was unfinalizable debris.
 *
 * The dispatch predicate then read `streamingState != null` as "busy", so
 * every following send went to the queue. The Stop button read only the
 * `_streamingTabIds` spinner set, which the injected events never touch, so it
 * stayed HIDDEN. Queue with no drain and no drain affordance: a dead tile
 * until reload.
 *
 * ## The fix (three parts, all exercised here)
 *
 * a. `streaming-handler.service.ts` `STORE_ONLY_EVENT_TYPES` — the six
 *    store-only event types run the accumulator on a scratch state and never
 *    create one on a tab that has none.
 * b. `message-dispatch.service.ts` `isTabBusyGenerating` — a tree with a null
 *    `currentMessageId` is debris, not a turn in flight.
 * c. `chat-input.component.ts` `isActiveTabStreaming` — the Stop button reads
 *    that same predicate, so the queue gate and its only manual drain cannot
 *    disagree.
 *
 * ## Falsifiability — what fails WITHOUT the fix
 *
 * With (a) reverted, the late `agent_progress` mints an empty
 * `StreamingState`. With (b) also reverted, `isTabBusyGenerating` reports
 * busy, so:
 *
 * 1. The follow-up send is queued — the literal "Message queued" banner
 *    (chat-view.component.html) renders and `toHaveCount(0)` fails.
 * 2. No `chat:continue` ever leaves the renderer, so
 *    `waitForObservedCall('chat:continue')` times out.
 * 3. The user bubble for the follow-up marker is appended by the SENDER, not
 *    by the queue path, so it never renders.
 *
 * With (c) alone reverted the Stop button would stay hidden while the send is
 * queued — the shape that made the pre-fix state unrecoverable. This spec's
 * Stop assertions are taken while the tab is genuinely idle, so they read the
 * predicate's negative side.
 *
 * ## Method
 *
 * `ui.pushEvent` injects `chat:chunk` payloads straight onto the `to-renderer`
 * IPC channel, the same seam `empty-assistant-envelope.spec.ts` uses. No
 * `tabId` is passed, so the fresh unbound canvas tile auto-binds to the first
 * event's `sessionId` (the `StreamingHandlerService` "hijack" branch) exactly
 * as a real first turn binds it. That binding is what makes the follow-up send
 * a `chat:continue` rather than a `chat:start`.
 */

const CHAT_CHUNK = 'chat:chunk';
const TURN_TEXT_MARKER = 'PTAH_E2E_382_TURN_TEXT_MARKER';
const FOLLOW_UP_MARKER = 'PTAH_E2E_382_FOLLOW_UP_MARKER';

const TEXTAREA = 'ptah-chat-input textarea[role="combobox"]';
const SEND_BUTTON = '[data-testid="chat-send-btn"]';
const STOP_BUTTON = '[data-testid="chat-stop-btn"]';
const ASSISTANT_BUBBLE = '[data-testid="chat-tool-output"]';
const USER_BUBBLE = '.chat-bubble-primary';
const QUEUED_BANNER_TEXT = 'Message queued';

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

function messageComplete(
  sessionId: string,
  messageId: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'message_complete',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
  });
}

function turnStateIdle(sessionId: string, timestamp: number, revision = 1) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'turn_state',
    timestamp,
    sessionId,
    messageId: `turn-state-${sessionId}`,
    phase: 'idle',
    revision,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: 'completed',
  });
}

/** Every required field of `AgentProgressEvent` (stream-background.ts). */
function agentProgress(
  sessionId: string,
  timestamp: number,
  parentToolUseId: string,
  taskId: string,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'agent_progress',
    timestamp,
    sessionId,
    source: 'complete',
    messageId: randomUUID(),
    parentToolUseId,
    taskId,
    description: 'Still working after the turn ended',
    totalTokens: 12,
    toolUses: 1,
    durationMs: 250,
  });
}

/** Every required field of `AgentCompletedEvent` (stream-background.ts). */
function agentCompleted(
  sessionId: string,
  timestamp: number,
  parentToolUseId: string,
  taskId: string,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'agent_completed',
    timestamp,
    sessionId,
    source: 'complete',
    messageId: randomUUID(),
    parentToolUseId,
    taskId,
    status: 'completed',
    summary: 'done',
    outputFile: '',
  });
}

/** Diagnostic dump used only when an expectation about routing fails. */
async function describeSendCalls(ui: UiDriver): Promise<string> {
  const starts = await ui.getObservedCalls('chat:start');
  const continues = await ui.getObservedCalls('chat:continue');
  return JSON.stringify({ 'chat:start': starts, 'chat:continue': continues });
}

test.describe('Late post-turn event does not pin the tab busy (TASK_2026_382)', () => {
  test('a stray agent_progress / agent_completed arriving after the root turn settled leaves the tile idle, and the next send dispatches as chat:continue instead of queuing', async ({
    ui,
  }) => {
    const page = ui.page;

    await ui.mockRpc({
      // The tab is bound by the hijack below, so the follow-up send takes the
      // continue path — which validates the session on disk first. Without
      // this mock the validator reports "missing" and the send silently
      // degrades to a fresh `chat:start`, testing nothing.
      'session:validate': { exists: true },
      'chat:continue': { success: true },
    });

    await ui.goto('chat');

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const t0 = Date.now();

    // A complete root turn, injected exactly as the SDK would deliver it.
    await ui.pushEvent(messageStart(sessionId, messageId, t0));
    await ui.pushEvent(
      textDelta(sessionId, messageId, t0 + 1, TURN_TEXT_MARKER),
    );
    await ui.pushEvent(messageComplete(sessionId, messageId, t0 + 2));
    await ui.pushEvent(turnStateIdle(sessionId, t0 + 4));

    const assistantBubble = page.locator(ASSISTANT_BUBBLE);
    await expect(assistantBubble).toContainText(TURN_TEXT_MARKER);

    // Sanity: the turn is over, so the busy predicate is false.
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0);

    // The stray post-turn traffic. Both event types are store-only, so
    // neither may create a StreamingState on this settled tab.
    const parentToolUseId = `toolu_late_${randomUUID().replace(/-/g, '')}`;
    const taskId = 'task_late';
    await ui.pushEvent(
      agentProgress(sessionId, t0 + 5, parentToolUseId, taskId),
    );
    await ui.pushEvent(
      agentCompleted(sessionId, t0 + 6, parentToolUseId, taskId),
    );

    // Give the renderer a beat by waiting on a real condition rather than
    // sleeping: the transcript is still settled after both events.
    await expect(assistantBubble).toContainText(TURN_TEXT_MARKER);
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0);

    const textarea = page.locator(TEXTAREA).first();
    const sendButton = page.locator(SEND_BUTTON).first();
    await textarea.fill(FOLLOW_UP_MARKER);
    await sendButton.click();

    let continueCall: { method: string; params: unknown };
    try {
      continueCall = await ui.waitForObservedCall('chat:continue');
    } catch (error: unknown) {
      const detail = await describeSendCalls(ui);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\nObserved send RPCs at failure: ${detail}\n` +
          'A queued send makes no RPC at all; a chat:start instead of a ' +
          'chat:continue means the tab lost its session binding.',
      );
    }

    const params = continueCall.params as {
      prompt?: string;
      sessionId?: string;
    };
    expect(params.prompt).toBe(FOLLOW_UP_MARKER);
    expect(params.sessionId).toBe(sessionId);

    // Exactly ONE new send RPC left the renderer, and it was the continue.
    expect(await ui.getObservedCalls('chat:continue')).toHaveLength(1);
    expect(await ui.getObservedCalls('chat:start')).toHaveLength(0);

    // The sender appends the user bubble; the queue path does not.
    await expect(
      page.locator(USER_BUBBLE).filter({ hasText: FOLLOW_UP_MARKER }),
    ).toHaveCount(1);

    await expect(page.getByText(QUEUED_BANNER_TEXT)).toHaveCount(0);
  });
});
