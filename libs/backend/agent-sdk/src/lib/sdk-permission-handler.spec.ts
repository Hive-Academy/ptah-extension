/**
 * sdk-permission-handler — unit specs.
 *
 * Scope (TASK_2026_109_FOLLOWUP_QUESTIONS): the AskUserQuestion emission path
 * must always stamp `tabId` on the broadcast when a routing identity is
 * available. The frontend stream router (`stream-router.service.ts`'s
 * `routeQuestionPrompt`) uses `tabId` to narrow question delivery to the
 * originating tab; if it's missing/empty, the router falls back to
 * broadcasting to every tab bound to the conversation — which is the
 * "question card on every tile" regression.
 *
 * These specs lock in:
 *   - `AskUserQuestion` stamps `tabId` from the session/routing context the
 *     callback was created with (no explicit `tabId` arg — main path).
 *   - `AskUserQuestion` prefers an explicit `tabId` argument over the
 *     fallback session id.
 *   - When neither tabId nor sessionId is available (sub-agent / no-tab
 *     path), the handler logs a structured warning so the missing-routing
 *     case is traceable in production.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { SdkPermissionHandler } from './sdk-permission-handler';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface SentMessage {
  viewType: string;
  type: string;
  payload: Record<string, unknown>;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface AskUserQuestionPayload {
  id: string;
  toolName: 'AskUserQuestion';
  sessionId?: string;
  tabId?: string;
  questions: ReadonlyArray<{ header: string; options: { label: string }[] }>;
}

function makeHandler(): {
  handler: SdkPermissionHandler;
  logger: MockLogger;
  sent: SentMessage[];
} {
  const logger = createMockLogger();
  const sent: SentMessage[] = [];

  const webviewManager = {
    sendMessage: jest.fn(
      async (
        viewType: string,
        type: string,
        payload: Record<string, unknown>,
      ) => {
        sent.push({ viewType, type, payload });
        return true;
      },
    ),
  };

  // Reset container state for hermetic test runs and register the optional
  // WEBVIEW_MANAGER token so SdkPermissionHandler's lazy resolver picks it up.
  container.clearInstances();
  container.registerInstance(TOKENS.WEBVIEW_MANAGER, webviewManager);

  const subagentRegistry = {
    getToolCallIdByAgentId: jest.fn().mockReturnValue(null),
    get: jest.fn().mockReturnValue(undefined),
  };

  const handler = new SdkPermissionHandler(
    asLogger(logger),
    subagentRegistry as unknown as ConstructorParameters<
      typeof SdkPermissionHandler
    >[1],
  );

  return { handler, logger, sent };
}

function makeAskInput() {
  return {
    questions: [
      {
        header: 'Pick a strategy',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ],
  };
}

async function flushMicrotasks(): Promise<void> {
  // The handler's `sendMessage(...).then(...)` chain queues microtasks; allow
  // them to settle before asserting on `sent`.
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler — AskUserQuestion tabId stamping', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('askUserQuestion stamps tabId from session context when available', async () => {
    const { handler, sent } = makeHandler();

    // Main session path: caller passes `routingId` (== frontend tabId) as the
    // first argument of createCallback. Our signature treats this as both
    // sessionId-for-cleanup AND tabId fallback when no explicit tabId is
    // supplied — matching `sdk-query-options-builder.ts` real-world usage.
    const ROUTING_ID = 'tab-abc-123';
    const callback = handler.createCallback(ROUTING_ID);

    const ac = new AbortController();
    // Fire-and-forget — handleAskUserQuestion blocks awaiting a webview
    // response. We abort after the request is emitted to drain it.
    const pending = callback('AskUserQuestion', makeAskInput(), {
      signal: ac.signal,
      toolUseID: 'tool-use-1',
    });

    // Allow the synchronous request build + sendMessage promise to dispatch.
    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    if (!broadcast) throw new Error('test setup failed: broadcast missing');
    const payload = broadcast.payload as unknown as AskUserQuestionPayload;
    expect(payload.tabId).toBe(ROUTING_ID);
    expect(payload.sessionId).toBe(ROUTING_ID);

    // Drain — abort the pending awaitQuestionResponse promise.
    ac.abort();
    await pending;
  });

  it('askUserQuestion logs warning when tabId is unavailable (sub-agent / no-tab path)', async () => {
    const { handler, logger, sent } = makeHandler();

    // No routing context at all — simulates a sub-agent or CLI-only flow
    // where no originating tab exists. createCallback() is called with
    // undefined sessionId AND undefined tabId.
    const callback = handler.createCallback(undefined, undefined, undefined);

    const ac = new AbortController();
    const pending = callback('AskUserQuestion', makeAskInput(), {
      signal: ac.signal,
      toolUseID: 'tool-use-2',
    });

    await flushMicrotasks();

    // The warning must be emitted so production traces show why the frontend
    // fell back to broadcasting on every tab.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('emitted without tabId'),
      expect.objectContaining({
        questionId: expect.any(String),
        sessionId: undefined,
      }),
    );

    // The broadcast still happens (the agent still needs an answer) but with
    // no tabId — frontend falls back to all-tabs routing.
    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    if (!broadcast) throw new Error('test setup failed: broadcast missing');
    const payload = broadcast.payload as unknown as AskUserQuestionPayload;
    expect(payload.tabId).toBeUndefined();

    ac.abort();
    await pending;
  });

  it('askUserQuestion prefers explicit tabId argument over sessionId fallback', async () => {
    const { handler, sent } = makeHandler();

    // CLI sub-agent path: sessionId is the real SDK UUID (not a tab), but
    // the caller knows the originating tab and passes it explicitly. The
    // explicit tabId must win over the sessionId-as-tabId fallback.
    const REAL_SESSION_UUID = '11111111-2222-3333-4444-555555555555';
    const EXPLICIT_TAB_ID = 'tab-xyz-999';
    const callback = handler.createCallback(
      REAL_SESSION_UUID,
      undefined,
      EXPLICIT_TAB_ID,
    );

    const ac = new AbortController();
    const pending = callback('AskUserQuestion', makeAskInput(), {
      signal: ac.signal,
      toolUseID: 'tool-use-3',
    });

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    if (!broadcast) throw new Error('test setup failed: broadcast missing');
    const payload = broadcast.payload as unknown as AskUserQuestionPayload;
    expect(payload.tabId).toBe(EXPLICIT_TAB_ID);
    expect(payload.sessionId).toBe(REAL_SESSION_UUID);

    ac.abort();
    await pending;
  });
});

// ---------------------------------------------------------------------------
// Fix 6: auto-timeout answers keyed by q.question, not q.header
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler — AskUserQuestion idle-timeout answer keying (Fix 6)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('keys auto-timeout answers by q.question not q.header', async () => {
    const { handler } = makeHandler();

    const callback = handler.createCallback('sess-timeout');

    const questions = [
      {
        question: 'Which deployment strategy should I use?',
        header: 'Strategy',
        options: [{ label: 'Blue-Green' }, { label: 'Canary' }],
        multiSelect: false,
      },
      {
        question: 'Which database should I migrate first?',
        header: 'DB',
        options: [{ label: 'Postgres' }, { label: 'Redis' }],
        multiSelect: false,
      },
    ];

    const ac = new AbortController();

    // Fire-and-forget — will resolve after the idle timeout fires
    const pending = callback(
      'AskUserQuestion',
      { questions },
      { signal: ac.signal, toolUseID: 'tool-fix6' },
    );

    await flushMicrotasks();

    // Advance past the 5-minute idle timeout
    jest.runAllTimers();

    // Allow the resolve microtask to propagate
    await Promise.resolve();
    await Promise.resolve();

    const result = await pending;

    // The PermissionResult for AskUserQuestion is:
    //   { behavior: 'allow', updatedInput: { ...input, answers: {...} } }
    // The answers must be keyed by q.question (full text) not q.header (chip label).
    expect(result).not.toBeNull();
    const permResult = result as unknown as {
      behavior: string;
      updatedInput?: { answers?: Record<string, string> };
    };
    expect(permResult.behavior).toBe('allow');
    const answers = permResult.updatedInput?.answers ?? {};

    // Correct keys — full question text
    expect(answers['Which deployment strategy should I use?']).toBe(
      'Blue-Green',
    );
    expect(answers['Which database should I migrate first?']).toBe('Postgres');

    // Wrong keys — short chip labels must NOT appear
    expect(answers['Strategy']).toBeUndefined();
    expect(answers['DB']).toBeUndefined();
  });
});
