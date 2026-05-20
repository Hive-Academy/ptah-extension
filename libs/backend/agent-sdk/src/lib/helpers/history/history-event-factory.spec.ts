/**
 * history-event-factory — unit specs.
 *
 * Covers `HistoryEventFactory`, the pure-function event constructors behind
 * session replay. No DI, no file I/O — each method takes primitives and
 * returns a `FlatStreamEventUnion` variant.
 *
 * Asserted invariants:
 *   - Every event carries `source: 'history'` (so the frontend can distinguish
 *     replayed events from live stream events).
 *   - Per-message-variant shape: eventType, id, sessionId, messageId, role,
 *     timestamp, blockIndex, delta where applicable.
 *   - Agent-scoped events include `parentToolUseId` in the event id to avoid
 *     collisions when multiple agents spawn inside one message block
 *.
 *   - `createMessageComplete` + `createAgentMessageComplete` surface
 *     `tokenUsage`, `cost`, `model` ONLY when provided (usageData guards).
 *   - `extractTextContent` handles string, ContentBlock[], and unknown shapes.
 */

import 'reflect-metadata';
import { HistoryEventFactory } from './history-event-factory';

describe('HistoryEventFactory', () => {
  let factory: HistoryEventFactory;

  beforeEach(() => {
    factory = new HistoryEventFactory();
  });

  // -------------------------------------------------------------------------
  // Message events
  // -------------------------------------------------------------------------

  describe('createMessageStart', () => {
    it('produces a message_start event tagged as history-sourced', () => {
      const evt = factory.createMessageStart('s1', 'm1', 'assistant', 0, 1000);
      expect(evt).toMatchObject({
        eventType: 'message_start',
        sessionId: 's1',
        messageId: 'm1',
        role: 'assistant',
        timestamp: 1000,
        source: 'history',
      });
      expect(evt.id).toBe('evt_0_1000');
    });

    it('propagates imageCount only when provided and non-zero', () => {
      const withImages = factory.createMessageStart('s', 'm', 'user', 1, 2, 3);
      expect(withImages.imageCount).toBe(3);

      const zero = factory.createMessageStart('s', 'm', 'user', 1, 2, 0);
      expect(zero.imageCount).toBeUndefined();

      const none = factory.createMessageStart('s', 'm', 'user', 1, 2);
      expect(none.imageCount).toBeUndefined();
    });
  });

  describe('createMessageComplete', () => {
    it('emits a bare complete event when no usageData is supplied', () => {
      const evt = factory.createMessageComplete('s', 'm', 0, 10);
      expect(evt.eventType).toBe('message_complete');
      expect(evt.tokenUsage).toBeUndefined();
      expect(evt.cost).toBeUndefined();
      expect(evt.model).toBeUndefined();
    });

    it('only attaches usage fields that are defined (not null/undefined)', () => {
      const withUsage = factory.createMessageComplete('s', 'm', 0, 10, {
        tokenUsage: { input: 5, output: 3 },
        cost: 0.001,
        model: 'claude-sonnet-4-20250514',
      });
      expect(withUsage.tokenUsage).toEqual({ input: 5, output: 3 });
      expect(withUsage.cost).toBe(0.001);
      expect(withUsage.model).toBe('claude-sonnet-4-20250514');

      const partial = factory.createMessageComplete('s', 'm', 0, 10, {
        tokenUsage: { input: 1, output: 1 },
      });
      expect(partial.cost).toBeUndefined();
      expect(partial.model).toBeUndefined();

      const zeroCost = factory.createMessageComplete('s', 'm', 0, 10, {
        cost: 0, // explicitly zero should still be surfaced
      });
      expect(zeroCost.cost).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Delta events
  // -------------------------------------------------------------------------

  describe('text/thinking deltas', () => {
    it('builds text_delta with blockIndex and delta payload', () => {
      const evt = factory.createTextDelta('s', 'm', 'hello', 2, 7, 5000);
      expect(evt).toMatchObject({
        eventType: 'text_delta',
        sessionId: 's',
        messageId: 'm',
        blockIndex: 2,
        delta: 'hello',
        timestamp: 5000,
        source: 'history',
      });
    });

    it('builds thinking_delta with the same shape', () => {
      const evt = factory.createThinkingDelta('s', 'm', 'pondering', 0, 1, 2);
      expect(evt.eventType).toBe('thinking_delta');
      expect(evt.delta).toBe('pondering');
    });
  });

  // -------------------------------------------------------------------------
  // Tool events
  // -------------------------------------------------------------------------

  describe('tool events', () => {
    it('flags Task/Agent dispatch tools via isTaskTool', () => {
      const taskTool = factory.createToolStart(
        's',
        'm',
        't1',
        'Task',
        { subagent_type: 'research', description: 'x', prompt: 'y' },
        0,
        0,
      );
      expect(taskTool.isTaskTool).toBe(true);

      const regularTool = factory.createToolStart(
        's',
        'm',
        't2',
        'Read',
        undefined,
        1,
        1,
      );
      expect(regularTool.isTaskTool).toBe(false);
    });

    it('builds tool_result events with error state preserved', () => {
      const success = factory.createToolResult(
        's',
        'm',
        't1',
        'ok',
        false,
        0,
        0,
      );
      expect(success.eventType).toBe('tool_result');
      expect(success.isError).toBe(false);
      expect(success.output).toBe('ok');

      const failure = factory.createToolResult(
        's',
        'm',
        't1',
        'fail',
        true,
        0,
        0,
      );
      expect(failure.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Agent events
  // -------------------------------------------------------------------------

  describe('createAgentStart', () => {
    it('extracts subagent_type/description/prompt from Task input', () => {
      const evt = factory.createAgentStart(
        's',
        'm',
        't1',
        { subagent_type: 'research', description: 'find X', prompt: 'go' },
        0,
        0,
        't1',
        'agent-abc',
      );
      expect(evt).toMatchObject({
        eventType: 'agent_start',
        agentType: 'research',
        agentDescription: 'find X',
        agentPrompt: 'go',
        parentToolUseId: 't1',
        agentId: 'agent-abc',
        source: 'history',
      });
    });

    it('defaults agentType to "unknown" when input fails isTaskToolInput', () => {
      const evt = factory.createAgentStart(
        's',
        'm',
        't1',
        { garbage: true },
        0,
        0,
      );
      expect(evt.agentType).toBe('unknown');
      expect(evt.agentDescription).toBeUndefined();
    });
  });

  describe('agent-scoped events include parentToolUseId in id (TASK_2025_096)', () => {
    it('createAgentMessageStart id is namespaced by parentToolUseId', () => {
      const evt = factory.createAgentMessageStart(
        's',
        'agent-msg',
        0,
        123.456,
        'parent-tool',
      );
      expect(evt.id).toBe('evt_agent_parent-tool_0_123');
      expect(evt.parentToolUseId).toBe('parent-tool');
      expect(evt.role).toBe('assistant');
    });

    it('createAgentTextDelta id includes parentToolUseId', () => {
      const evt = factory.createAgentTextDelta(
        's',
        'am',
        'txt',
        0,
        1,
        1000,
        'parent-tool',
      );
      expect(evt.id).toContain('evt_agent_parent-tool_');
      expect(evt.parentToolUseId).toBe('parent-tool');
    });

    it('createAgentMessageComplete propagates usage data when supplied', () => {
      const evt = factory.createAgentMessageComplete(
        's',
        'am',
        0,
        0,
        'parent-tool',
        { tokenUsage: { input: 1, output: 2 }, cost: 0.05, model: 'x' },
      );
      expect(evt.tokenUsage).toEqual({ input: 1, output: 2 });
      expect(evt.cost).toBe(0.05);
      expect(evt.model).toBe('x');
      expect(evt.parentToolUseId).toBe('parent-tool');
    });
  });

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  describe('generateId', () => {
    it('returns a unique msg_-prefixed id on each call', () => {
      const ids = new Set(
        Array.from({ length: 20 }, () => factory.generateId()),
      );
      expect(ids.size).toBe(20);
      for (const id of ids) expect(id.startsWith('msg_')).toBe(true);
    });
  });

  describe('extractTextContent', () => {
    it('returns string content as-is', () => {
      expect(factory.extractTextContent('hello')).toBe('hello');
    });

    it('joins text blocks from an array with newlines', () => {
      const content = [
        { type: 'text', text: 'line a' },
        { type: 'tool_use', id: 't1', name: 'Read' }, // not a text block
        { type: 'text', text: 'line b' },
      ];
      expect(factory.extractTextContent(content)).toBe('line a\nline b');
    });

    it('returns empty string for unknown content shapes', () => {
      expect(factory.extractTextContent(null)).toBe('');
      expect(factory.extractTextContent(undefined)).toBe('');
      expect(factory.extractTextContent(42)).toBe('');
      expect(factory.extractTextContent({ nope: true })).toBe('');
    });
  });
});
