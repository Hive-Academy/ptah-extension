import { randomUUID } from 'crypto';
import { test, expect } from '../../support/fixtures';

/**
 * Pins the "empty assistant bubble" defect (cause chain verified across 23
 * real transcripts, 265/612 signature-only-empty thinking blocks):
 *
 * 1. The Claude Agent SDK delivers one assistant message PER CONTENT BLOCK —
 *    a single logical turn arrives as several deliveries sharing one
 *    `messageId`.
 * 2. A delivery whose only content block is a signature-only thinking block
 *    (`{ type: 'thinking', thinking: '', signature: '...' }`) produces no
 *    renderable sub-event. Before the fix,
 *    `assistant-message.transformer.ts` still emitted `message_start` +
 *    `message_complete` for that delivery with NOTHING between them. After
 *    the fix it emits nothing at all for a content-free delivery.
 * 3. `execution-tree-builder.service.ts`'s `buildMessageNode` builds a node
 *    for ANY `message_start` it can find, regardless of child count — it has
 *    no empty-node guard and none is being added here (that would be a
 *    `libs/backend` change, out of scope for this spec). So the ONLY thing
 *    standing between "no visible node" and a permanent "Assistant response"
 *    bubble is whether the naked envelope reaches the frontend at all.
 * 4. `message-summary.utils.ts` falls back to the literal title
 *    'Assistant response' for a finalized message with no text content.
 *
 * Method: this harness has no way to drive the real SDK, so these specs
 * inject `chat:chunk` (`MESSAGE_TYPES.CHAT_CHUNK`) payloads directly on the
 * `to-renderer` IPC channel via `ui.pushEvent` — the same seam
 * `streaming-message-handlers.spec.ts` uses for `session:*` payloads, applied
 * here to the flat `FlatStreamEventUnion` stream `ChatMessageHandler.
 * handleChatChunk` forwards to `ChatStore.processStreamEvent`. No `tabId` is
 * ever passed on the payload: `StreamingHandlerService.processStreamEvent`
 * auto-binds a fresh, unbound active tab to the first event's `sessionId`
 * (its "hijack" branch, `streaming-handler.service.ts` ~line 142), which is
 * exactly how a brand-new canvas chat tile picks up its first turn in
 * production.
 *
 * Observable: `[data-testid="chat-tool-output"]` is the assistant bubble's
 * own stable test id (`message-bubble.component.html`); the two things
 * checked on it are (a) literal visible text — the real assistant reply —
 * and (b) the literal fallback title string `'Assistant response'`
 * (`message-summary.utils.ts`'s only fallback branch, shown once the
 * message is finalized and its collapsible header renders). Both are
 * evidence a human reading the UI can also see, not an implementation
 * artifact.
 */

const CHAT_CHUNK = 'chat:chunk';
const REAL_TEXT_MARKER = 'PTAH_E2E_REAL_ASSISTANT_TEXT_MARKER';
const ASSISTANT_BUBBLE = '[data-testid="chat-tool-output"]';

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

test.describe('Empty assistant-bubble envelope (backend fix, TASK_2026_366)', () => {
  test('a naked message_start/message_complete envelope sharing a message id with a real text delivery renders one visible bubble, not an empty "Assistant response" placeholder', async ({
    ui,
  }) => {
    const page = ui.page;
    await ui.goto('chat');

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const t0 = Date.now();

    // Delivery A: the signature-only-empty-thinking delivery, reproduced
    // exactly as the pre-fix transformer emitted it — message_start and
    // message_complete for `messageId`, nothing pushed between them.
    await ui.pushEvent(messageStart(sessionId, messageId, t0));
    await ui.pushEvent(messageComplete(sessionId, messageId, t0 + 1));

    // Delivery B: the SAME logical turn's real text, sharing `messageId`.
    await ui.pushEvent(messageStart(sessionId, messageId, t0 + 2));
    await ui.pushEvent(
      textDelta(sessionId, messageId, t0 + 3, REAL_TEXT_MARKER),
    );
    await ui.pushEvent(messageComplete(sessionId, messageId, t0 + 4));

    // Assertion 2 (the one that matters most): the text from the FOLLOWING
    // delivery is not lost — it renders, live, before the turn even ends.
    const bubble = page.locator(ASSISTANT_BUBBLE);
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toContainText(REAL_TEXT_MARKER);

    // Finalize the turn so the collapsible header (which would show the
    // 'Assistant response' fallback title, were this message empty) renders.
    await ui.pushEvent(turnStateIdle(sessionId, t0 + 5));

    // Assertion 1: no separate/leftover empty assistant node exists — there
    // is exactly one bubble, sharing `messageId`'s single root, and it is
    // the real one, not the fallback placeholder.
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toContainText(REAL_TEXT_MARKER);
    await expect(bubble).not.toContainText('Assistant response');

    await ui.goto('dashboard');
    await expect(page.locator('ptah-dashboard-grid')).toBeVisible();
  });

  test('the naked envelope alone (no follow-up ever) reproduces the pre-fix empty "Assistant response" bubble — proving the assertions above are falsifiable', async ({
    ui,
  }) => {
    const page = ui.page;
    await ui.goto('chat');

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const t0 = Date.now();

    // Only the content-free envelope — no other delivery ever arrives for
    // this messageId. This is the exact pre-fix wire shape the transformer
    // no longer emits (`assistant-message.transformer.ts`'s
    // `events.length === 0` guard now returns `[]` for it instead).
    await ui.pushEvent(messageStart(sessionId, messageId, t0));
    await ui.pushEvent(messageComplete(sessionId, messageId, t0 + 1));

    const bubble = page.locator(ASSISTANT_BUBBLE);
    await expect(bubble).toHaveCount(1);
    await expect(bubble).not.toContainText(REAL_TEXT_MARKER);

    // Finalize — this is the moment the historical bug report describes: "a
    // message group with no text, no tools and no files, titled 'Assistant
    // response'".
    await ui.pushEvent(turnStateIdle(sessionId, t0 + 2));

    await expect(bubble).toContainText('Assistant response');
    await expect(bubble).not.toContainText(REAL_TEXT_MARKER);

    await ui.goto('dashboard');
    await expect(page.locator('ptah-dashboard-grid')).toBeVisible();
  });
});
