/**
 * SdkStreamProcessor — unit specs (TASK_2025_294 W6.B1).
 *
 * Surface under test:
 *   - SDK message consumption order: system → stream_event → assistant → user →
 *     result. The processor walks whatever the source async iterable yields and
 *     must dispatch each message to the correct handler in the order received.
 *   - Event-kind fan-out: each SDK event variant MUST produce exactly the
 *     right StreamEvent `kind` on the emitter (text, thinking, tool_start,
 *     tool_input, tool_result) with correctly-shaped metadata (toolName,
 *     toolCallId, isError, timestamp).
 *   - Aborted stream: when the source iterable cooperatively stops after the
 *     AbortSignal fires, the processor exits cleanly. No trailing events are
 *     emitted, no timeout handler fires, and the returned `structuredOutput`
 *     is null because no result message arrived.
 *   - Source errors propagate: if the underlying iterator throws, the
 *     processor does NOT swallow it — the error bubbles out of `process()`
 *     and the timeout timer is released in the `finally` block.
 *
 * Mocking posture:
 *   - Direct construction with a minimal config. No tsyringe container.
 *   - Logger is `createMockLogger()` bridged to the production `Logger` type.
 *   - Emitter is a plain `jest.fn` wrapped in the `StreamEventEmitter` shape.
 *   - Source streams are built from `createFakeAsyncGenerator` (supports
 *     abort-aware iteration + in-process yielding without real timers).
 *   - Time is frozen via `freezeTime` to make the 100 ms delta-throttle
 *     deterministic — we advance the clock only when we want the throttle
 *     gate to reopen.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts`
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  createFakeAsyncGenerator,
  freezeTime,
  type FrozenClock,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkStreamProcessor } from './sdk-stream-processor';
import type {
  SdkStreamProcessorConfig,
  StreamEvent,
  StreamEventEmitter,
  PhaseTracker,
} from './sdk-stream-processor.types';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';

// ---------------------------------------------------------------------------
// Typed bridges — production Logger is a nominal class, bridge at the seam.
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

// ---------------------------------------------------------------------------
// SDKMessage builders (typed to the minimal surface the processor reads).
// We cast through `unknown` to avoid `as any` while matching the shape the
// processor's type guards check at runtime.
// ---------------------------------------------------------------------------

function systemInit(sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function streamEventContentBlockStart(
  index: number,
  block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'thinking'; thinking: string },
): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: block,
    },
  } as unknown as SDKMessage;
}

function streamEventTextDelta(index: number, text: string): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text },
    },
  } as unknown as SDKMessage;
}

function streamEventThinkingDelta(index: number, thinking: string): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking },
    },
  } as unknown as SDKMessage;
}

function streamEventJsonDelta(index: number, partialJson: string): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    },
  } as unknown as SDKMessage;
}

function streamEventContentBlockStop(index: number): SDKMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_stop', index },
  } as unknown as SDKMessage;
}

function assistantMessage(
  textBlocks: Array<{ text: string }> = [],
): SDKMessage {
  return {
    type: 'assistant',
    message: {
      content: textBlocks.map((b) => ({ type: 'text', text: b.text })),
      stop_reason: 'end_turn',
    },
  } as unknown as SDKMessage;
}

function userToolResultMessage(args: {
  toolUseId: string;
  content: string;
  isError?: boolean;
}): SDKMessage {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: args.toolUseId,
          content: args.content,
          is_error: args.isError ?? false,
        },
      ],
    },
  } as unknown as SDKMessage;
}

function successResultMessage(
  opts: {
    structuredOutput?: unknown;
    resultText?: string;
    turns?: number;
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
  } = {},
): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    num_turns: opts.turns ?? 1,
    total_cost_usd: opts.cost ?? 0.001,
    usage: {
      input_tokens: opts.inputTokens ?? 10,
      output_tokens: opts.outputTokens ?? 20,
    },
    structured_output: opts.structuredOutput,
    result: opts.resultText,
  } as unknown as SDKMessage;
}

function errorResultMessage(subtype = 'error_during_execution'): SDKMessage {
  return {
    type: 'result',
    subtype,
    errors: ['boom'],
  } as unknown as SDKMessage;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  processor: SdkStreamProcessor;
  logger: MockLogger;
  emitter: StreamEventEmitter;
  emit: jest.Mock<void, [StreamEvent]>;
  phaseTracker?: PhaseTracker;
}

function makeProcessor(
  overrides: Partial<SdkStreamProcessorConfig> = {},
  phaseTracker?: PhaseTracker,
): Harness {
  const logger = createMockLogger();
  const emit = jest.fn<void, [StreamEvent]>();
  const emitter: StreamEventEmitter = { emit };

  const config: SdkStreamProcessorConfig = {
    emitter,
    logger: asLogger(logger),
    serviceTag: '[TestProcessor]',
    phaseTracker,
    ...overrides,
  };

  const processor = new SdkStreamProcessor(config);
  return { processor, logger, emitter, emit, phaseTracker };
}

function makePhaseTracker(): jest.Mocked<PhaseTracker> {
  return {
    onToolStart: jest.fn(),
    onToolStop: jest.fn(),
    onThinking: jest.fn(),
  };
}

describe('SdkStreamProcessor', () => {
  let clock: FrozenClock;

  beforeEach(() => {
    // Freeze at a known instant so the 100 ms throttle gate is deterministic.
    clock = freezeTime('2026-01-01T00:00:00Z');
  });

  afterEach(() => {
    clock.restore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Event ordering — system → stream events (text/tool) → result
  // -------------------------------------------------------------------------

  describe('event ordering (system → message stream → result)', () => {
    it('processes SDK messages in the order the source yields them and returns structured output from the result', async () => {
      const h = makeProcessor();

      // Advance clock so throttle gates permit the first delta emit.
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>([
        systemInit('sess-1'),
        streamEventContentBlockStart(0, { type: 'text', text: '' }),
        streamEventTextDelta(0, 'hello'),
        streamEventContentBlockStop(0),
        assistantMessage([{ text: 'hello' }]),
        successResultMessage({
          structuredOutput: { ok: true },
          turns: 2,
          inputTokens: 5,
          outputTokens: 7,
        }),
      ]);

      const result = await h.processor.process(stream);

      expect(result.structuredOutput).toEqual({ ok: true });
      expect(result.resultMeta).toEqual({
        turns: 2,
        cost: 0.001,
        inputTokens: 5,
        outputTokens: 7,
      });

      // Emitted events should only be the 'text' delta — system messages are
      // not surfaced as StreamEvents, and the result message terminates the
      // loop without emitting.
      const kinds = h.emit.mock.calls.map(([e]) => e.kind);
      expect(kinds).toEqual(['text']);
    });

    it('handles a full agent cycle: text → tool_start → tool_input → tool_result, in that exact order', async () => {
      const tracker = makePhaseTracker();
      const h = makeProcessor({}, tracker);

      // Advance past the throttle gate before the first text delta.
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>([
        systemInit(),
        streamEventContentBlockStart(0, { type: 'text', text: '' }),
        streamEventTextDelta(0, 'Let me call a tool.'),
        streamEventContentBlockStop(0),
        streamEventContentBlockStart(1, {
          type: 'tool_use',
          id: 'toolu_abc',
          name: 'search',
          input: {},
        }),
        streamEventJsonDelta(1, '{"q":'),
        streamEventJsonDelta(1, '"ptah"}'),
        streamEventContentBlockStop(1),
        userToolResultMessage({
          toolUseId: 'toolu_abc',
          content: 'result JSON',
        }),
        successResultMessage({ structuredOutput: null, resultText: 'done' }),
      ]);

      const result = await h.processor.process(stream);
      expect(result.structuredOutput).toBeNull(); // no structured, resultText is not JSON-parseable object but 'done' is invalid JSON

      const kinds = h.emit.mock.calls.map(([e]) => e.kind);
      // Ordering matters — any reshuffle would break downstream UI assumptions.
      expect(kinds).toEqual([
        'text',
        'tool_start',
        'tool_input',
        'tool_result',
      ]);

      // Tool-input event should carry the accumulated JSON buffer.
      const toolInputEvent = h.emit.mock.calls
        .map(([e]) => e)
        .find((e) => e.kind === 'tool_input');
      expect(toolInputEvent?.content).toBe('{"q":"ptah"}');
      expect(toolInputEvent?.toolName).toBe('search');
      expect(toolInputEvent?.toolCallId).toBe('toolu_abc');

      // Tool-result event should correlate by the same toolCallId.
      const toolResultEvent = h.emit.mock.calls
        .map(([e]) => e)
        .find((e) => e.kind === 'tool_result');
      expect(toolResultEvent?.toolCallId).toBe('toolu_abc');
      expect(toolResultEvent?.toolName).toBe('search');
      expect(toolResultEvent?.isError).toBe(false);

      // Phase tracker should see start → stop in order.
      expect(tracker.onToolStart).toHaveBeenCalledWith(1, 'search');
      expect(tracker.onToolStop).toHaveBeenCalledWith(
        'toolu_abc',
        '{"q":"ptah"}',
      );
    });

    it('falls back to JSON-parsing the result text when structured_output is absent', async () => {
      const h = makeProcessor();
      const stream = createFakeAsyncGenerator<SDKMessage>([
        successResultMessage({ resultText: '{"fallback":true}' }),
      ]);

      const result = await h.processor.process(stream);
      expect(result.structuredOutput).toEqual({ fallback: true });
    });

    it('returns null when skipStructuredOutput is set (markdown pipeline)', async () => {
      const h = makeProcessor({ skipStructuredOutput: true });
      const stream = createFakeAsyncGenerator<SDKMessage>([
        successResultMessage({ structuredOutput: { would: 'use' } }),
      ]);

      const result = await h.processor.process(stream);
      expect(result.structuredOutput).toBeNull();
      expect(result.resultMeta).toBeDefined();
    });

    it('returns null structuredOutput for error result messages', async () => {
      const h = makeProcessor();
      const stream = createFakeAsyncGenerator<SDKMessage>([
        errorResultMessage('error_max_turns'),
      ]);

      const result = await h.processor.process(stream);
      expect(result.structuredOutput).toBeNull();
      expect(h.logger.error).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Event-kind fan-out — each SDK event variant produces the right kind.
  // -------------------------------------------------------------------------

  describe('event-kind fan-out', () => {
    it('emits kind=text for text_delta events with non-empty trimmed content', async () => {
      const h = makeProcessor();
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventTextDelta(0, 'chunk one'),
      ]);
      await h.processor.process(stream);

      expect(h.emit).toHaveBeenCalledTimes(1);
      const [event] = h.emit.mock.calls[0] as [StreamEvent];
      expect(event.kind).toBe('text');
      expect(event.content).toBe('chunk one');
    });

    it('throttles text deltas below 100 ms between emissions', async () => {
      const h = makeProcessor();
      clock.advanceBy(200); // open the gate

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventTextDelta(0, 'a'), // emitted
        streamEventTextDelta(0, 'b'), // throttled
        streamEventTextDelta(0, 'c'), // throttled
      ]);
      await h.processor.process(stream);

      // All three deltas arrive at the same frozen instant → only the first
      // passes the gate.
      expect(h.emit).toHaveBeenCalledTimes(1);
    });

    it('ignores whitespace-only text deltas (trimmed length zero)', async () => {
      const h = makeProcessor();
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventTextDelta(0, '   \n\t  '),
      ]);
      await h.processor.process(stream);
      expect(h.emit).not.toHaveBeenCalled();
    });

    it('emits kind=thinking with the raw thinking text and notifies the phase tracker', async () => {
      const tracker = makePhaseTracker();
      const h = makeProcessor({}, tracker);
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventThinkingDelta(
          0,
          'Thinking through the approach carefully...',
        ),
      ]);
      await h.processor.process(stream);

      expect(h.emit).toHaveBeenCalledTimes(1);
      const [event] = h.emit.mock.calls[0] as [StreamEvent];
      expect(event.kind).toBe('thinking');
      expect(event.content).toBe('Thinking through the approach carefully...');
      // Tracker sees the truncated preview.
      expect(tracker.onThinking).toHaveBeenCalledTimes(1);
    });

    it('emits kind=tool_start with toolName + content_block id as the default toolCallId', async () => {
      const h = makeProcessor();

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventContentBlockStart(0, {
          type: 'tool_use',
          id: 'toolu_from_sdk',
          name: 'read_file',
          input: {},
        }),
      ]);
      await h.processor.process(stream);

      const event = h.emit.mock.calls[0][0];
      expect(event.kind).toBe('tool_start');
      expect(event.toolName).toBe('read_file');
      expect(event.toolCallId).toBe('toolu_from_sdk');
      expect(event.content).toBe('Calling read_file');
    });

    it('applies a custom toolCallIdFactory when provided', async () => {
      const factory = jest.fn(
        (name: string, index: number, id: string) =>
          `custom-${name}-${index}-${id}`,
      );
      const h = makeProcessor({ toolCallIdFactory: factory });

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventContentBlockStart(3, {
          type: 'tool_use',
          id: 'toolu_x',
          name: 'grep',
          input: {},
        }),
      ]);
      await h.processor.process(stream);

      expect(factory).toHaveBeenCalledWith('grep', 3, 'toolu_x');
      expect(h.emit.mock.calls[0][0].toolCallId).toBe('custom-grep-3-toolu_x');
    });

    it('emits kind=tool_result with the tool_use_id and correlates toolName from earlier start', async () => {
      const h = makeProcessor();

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventContentBlockStart(0, {
          type: 'tool_use',
          id: 'tid-1',
          name: 'edit',
          input: {},
        }),
        streamEventContentBlockStop(0),
        userToolResultMessage({
          toolUseId: 'tid-1',
          content: 'file edited',
          isError: false,
        }),
      ]);
      await h.processor.process(stream);

      const resultEvent = h.emit.mock.calls
        .map(([e]) => e)
        .find((e) => e.kind === 'tool_result');
      expect(resultEvent).toBeDefined();
      expect(resultEvent?.toolCallId).toBe('tid-1');
      expect(resultEvent?.toolName).toBe('edit');
      expect(resultEvent?.content).toBe('file edited');
    });

    it('propagates isError=true on error tool results and defaults toolName to "tool" when correlation is missing', async () => {
      const h = makeProcessor();

      const stream = createFakeAsyncGenerator<SDKMessage>([
        userToolResultMessage({
          toolUseId: 'tid-unknown',
          content: 'something broke',
          isError: true,
        }),
      ]);
      await h.processor.process(stream);

      const event = h.emit.mock.calls[0][0];
      expect(event.kind).toBe('tool_result');
      expect(event.isError).toBe(true);
      expect(event.toolName).toBe('tool'); // default when tid not tracked
    });

    it('stringifies structured tool_result.content arrays before emitting', async () => {
      const h = makeProcessor();
      const msg = {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tid',
              content: [{ nested: 'value' }],
              is_error: false,
            },
          ],
        },
      } as unknown as SDKMessage;

      await h.processor.process(createFakeAsyncGenerator<SDKMessage>([msg]));
      const event = h.emit.mock.calls[0][0];
      expect(event.content).toBe(JSON.stringify([{ nested: 'value' }]));
    });

    it('swallows emitter exceptions (fire-and-forget dispatch)', async () => {
      const boom = new Error('subscriber died');
      const h = makeProcessor();
      h.emit.mockImplementation(() => {
        throw boom;
      });
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>([
        streamEventTextDelta(0, 'ping'),
        successResultMessage({ structuredOutput: { ok: true } }),
      ]);

      await expect(h.processor.process(stream)).resolves.toEqual({
        structuredOutput: { ok: true },
        resultMeta: expect.any(Object),
      });
    });
  });

  // -------------------------------------------------------------------------
  // Aborted stream — clean exit, no trailing events
  // -------------------------------------------------------------------------

  describe('aborted stream', () => {
    it('surfaces the abort cleanly when the source generator is signal-aware', async () => {
      const h = makeProcessor();
      const ac = new AbortController();
      clock.advanceBy(200);

      const stream = createFakeAsyncGenerator<SDKMessage>(
        [
          streamEventTextDelta(0, 'before abort'),
          // The abort below fires before this message is pulled, so the
          // fake generator's next() will throw AbortError and the processor
          // should propagate it — without ever emitting for these later
          // messages.
          streamEventTextDelta(0, 'after abort — should never surface'),
          successResultMessage({ structuredOutput: { leaked: true } }),
        ],
        { signal: ac.signal },
      );

      // Pump one event, then abort, then continue.
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      ac.abort();

      // Re-wrap into a fresh async-iterable that replays what's left of the
      // aborted generator (the processor expects an AsyncIterable).
      const wrapped: AsyncIterable<SDKMessage> = {
        [Symbol.asyncIterator]: () => iterator,
      };

      await expect(h.processor.process(wrapped)).rejects.toMatchObject({
        name: 'AbortError',
      });

      // Zero events must have been emitted from the aborted segment.
      expect(h.emit).not.toHaveBeenCalled();
    });

    it('logs a warning and returns null when the stream ends without a result message', async () => {
      const h = makeProcessor();
      const stream = createFakeAsyncGenerator<SDKMessage>([systemInit()]);
      const result = await h.processor.process(stream);

      expect(result).toEqual({ structuredOutput: null });
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stream ended without result'),
      );
    });

    it('releases the timeout timer in the finally block when the source is aborted', async () => {
      const abortController = new AbortController();
      const h = makeProcessor({
        timeout: { ms: 60_000, abortController },
      });

      const stream: AsyncIterable<SDKMessage> = {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw Object.assign(new Error('aborted mid-iter'), {
            name: 'AbortError',
          });
        },
      };

      await expect(h.processor.process(stream)).rejects.toMatchObject({
        name: 'AbortError',
      });
      // The timeout handler must not have fired — the abortController
      // should still report false.
      expect(abortController.signal.aborted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Source errors propagate
  // -------------------------------------------------------------------------

  describe('source errors', () => {
    it('re-throws iterator errors instead of swallowing them', async () => {
      const h = makeProcessor();
      const boom = new Error('upstream died');
      const stream: AsyncIterable<SDKMessage> = {
        async *[Symbol.asyncIterator]() {
          yield systemInit();
          throw boom;
        },
      };

      await expect(h.processor.process(stream)).rejects.toBe(boom);
    });

    it('clears the timeout timer even when the iterator throws', async () => {
      const abortController = new AbortController();
      const h = makeProcessor({ timeout: { ms: 60_000, abortController } });

      const stream: AsyncIterable<SDKMessage> = {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new Error('bang');
        },
      };

      await expect(h.processor.process(stream)).rejects.toThrow('bang');
      // Timer released → abort was never fired from the timeout path.
      expect(abortController.signal.aborted).toBe(false);
    });

    it('fires the timeout abort and tags the correct reason when the clock exceeds timeout.ms', async () => {
      // The processor registers the setTimeout once at the top of process().
      // We assert the timer is wired with the configured ms and that firing
      // it calls abortController.abort('analysis_timeout'). `freezeTime()`
      // already enabled jest fake timers — we just need to advance them.
      const abortController = new AbortController();
      const abortSpy = jest.spyOn(abortController, 'abort');
      const h = makeProcessor({ timeout: { ms: 500, abortController } });

      // Start processing an indefinitely-pending stream.
      const pending: AsyncIterable<SDKMessage> = {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<SDKMessage>>(() => {
              /* never resolves */
            }),
        }),
      };
      const processPromise = h.processor.process(pending).catch(() => {
        /* swallow — we only care about the side effect */
      });

      // Let the pending microtask queue drain so `process()` registers its
      // setTimeout before we advance the fake clock.
      await Promise.resolve();

      clock.advanceBy(501);

      expect(abortSpy).toHaveBeenCalledWith('analysis_timeout');

      // Ensure the pending promise is resolved so Jest exits cleanly
      // (the wrapping catch() above swallows the never-resolving iterator).
      void processPromise;
    });
  });
});
