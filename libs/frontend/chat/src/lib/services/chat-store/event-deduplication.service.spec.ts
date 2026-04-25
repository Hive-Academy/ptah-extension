/**
 * EventDeduplicationService specs — source-priority replacement and
 * per-session processed-id tracking.
 *
 * The service is a pure (no-DI) utility that the streaming handler relies on
 * to prevent duplicate agent/tool/message cards when the SDK ships the same
 * event via multiple paths (stream + complete + history + hook).
 */

import { TestBed } from '@angular/core/testing';
import { EventDeduplicationService } from './event-deduplication.service';
import type {
  EventSource,
  FlatStreamEventUnion,
  MessageStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';

function makeState(): StreamingState {
  return {
    events: new Map(),
    messageEventIds: [],
    toolCallMap: new Map(),
    textAccumulators: new Map(),
    toolInputAccumulators: new Map(),
    agentSummaryAccumulators: new Map(),
    agentContentBlocksMap: new Map(),
    currentMessageId: null,
    currentTokenUsage: null,
    eventsByMessage: new Map(),
    pendingStats: null,
  };
}

function addEvent(
  state: StreamingState,
  event: FlatStreamEventUnion & { source?: EventSource },
): void {
  state.events.set(event.id, event);
  if ('messageId' in event && event.messageId) {
    const bucket = state.eventsByMessage.get(event.messageId) ?? [];
    bucket.push(event);
    state.eventsByMessage.set(event.messageId, bucket);
  }
}

describe('EventDeduplicationService', () => {
  let service: EventDeduplicationService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [EventDeduplicationService] });
    service = TestBed.inject(EventDeduplicationService);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('source priority', () => {
    it('orders history > hook > complete > stream > undefined', () => {
      expect(service.getSourcePriority('history')).toBe(4);
      expect(service.getSourcePriority('hook')).toBe(3);
      expect(service.getSourcePriority('complete')).toBe(2);
      expect(service.getSourcePriority('stream')).toBe(1);
      expect(service.getSourcePriority(undefined)).toBe(0);
    });

    it('shouldReplaceEvent returns true when new priority >= existing', () => {
      expect(service.shouldReplaceEvent('stream', 'complete')).toBe(true);
      expect(service.shouldReplaceEvent('stream', 'stream')).toBe(true);
      expect(service.shouldReplaceEvent('complete', 'stream')).toBe(false);
      expect(service.shouldReplaceEvent('history', 'complete')).toBe(false);
    });
  });

  describe('replaceStreamEventIfNeeded', () => {
    it('returns undefined when no existing event for that toolCallId/type', () => {
      const state = makeState();
      const result = service.replaceStreamEventIfNeeded(
        state,
        'tool-1',
        'tool_start',
        'complete',
      );
      expect(result).toBeUndefined();
    });

    it('removes the existing stream event and allows the new complete event', () => {
      const state = makeState();
      const existing = {
        id: 'evt-1',
        eventType: 'tool_start',
        toolCallId: 'tool-1',
        source: 'stream',
      } as unknown as FlatStreamEventUnion & { source: EventSource };
      addEvent(state, existing);

      const result = service.replaceStreamEventIfNeeded(
        state,
        'tool-1',
        'tool_start',
        'complete',
      );

      expect(result).toBeUndefined();
      expect(state.events.has('evt-1')).toBe(false);
    });

    it('returns the existing event when its priority is higher (skip new)', () => {
      const state = makeState();
      const existing = {
        id: 'evt-1',
        eventType: 'tool_start',
        toolCallId: 'tool-1',
        source: 'history',
      } as unknown as FlatStreamEventUnion & { source: EventSource };
      addEvent(state, existing);

      const result = service.replaceStreamEventIfNeeded(
        state,
        'tool-1',
        'tool_start',
        'stream',
      );

      expect(result).toBe(existing);
      expect(state.events.has('evt-1')).toBe(true);
    });
  });

  describe('replaceAgentStartByAgentId', () => {
    it('returns undefined immediately when agentId is falsy', () => {
      const state = makeState();
      const result = service.replaceAgentStartByAgentId(
        state,
        undefined,
        'complete',
      );
      expect(result).toBeUndefined();
    });

    it('finds agent_start by agentId and removes it when new priority wins', () => {
      const state = makeState();
      const existing = {
        id: 'agent-evt-1',
        eventType: 'agent_start',
        agentId: 'agent-7',
        toolCallId: 'uuid-from-hook',
        source: 'stream',
      } as unknown as FlatStreamEventUnion & {
        source: EventSource;
        agentId: string;
      };
      addEvent(state, existing);

      const result = service.replaceAgentStartByAgentId(
        state,
        'agent-7',
        'complete',
      );

      expect(result).toBeUndefined();
      expect(state.events.has('agent-evt-1')).toBe(false);
    });

    it('skips non-matching agent_start events', () => {
      const state = makeState();
      const existing = {
        id: 'agent-evt-1',
        eventType: 'agent_start',
        agentId: 'agent-7',
        source: 'stream',
      } as unknown as FlatStreamEventUnion & {
        source: EventSource;
        agentId: string;
      };
      addEvent(state, existing);

      const result = service.replaceAgentStartByAgentId(
        state,
        'different-agent',
        'complete',
      );

      expect(result).toBeUndefined();
      expect(state.events.has('agent-evt-1')).toBe(true);
    });
  });

  describe('findMessageStartEvent', () => {
    it('returns undefined when no eventsByMessage bucket exists', () => {
      const state = makeState();
      expect(service.findMessageStartEvent(state, 'missing')).toBeUndefined();
    });

    it('returns the message_start in the bucket', () => {
      const state = makeState();
      const evt = {
        id: 'msg-evt-1',
        eventType: 'message_start',
        messageId: 'msg-1',
        role: 'assistant',
      } as unknown as FlatStreamEventUnion;
      addEvent(state, evt as FlatStreamEventUnion & { source?: EventSource });

      expect(service.findMessageStartEvent(state, 'msg-1')).toBe(evt);
    });
  });

  describe('processed ID tracking', () => {
    it('lazily creates per-session sets for messages and tools', () => {
      const msgs = service.getProcessedMessageIds('sess-1');
      const tools = service.getProcessedToolCallIds('sess-1');
      expect(msgs).toBeInstanceOf(Set);
      expect(tools).toBeInstanceOf(Set);
      // Returns the same reference on subsequent calls (so callers can mutate).
      expect(service.getProcessedMessageIds('sess-1')).toBe(msgs);
      expect(service.getProcessedToolCallIds('sess-1')).toBe(tools);
    });

    it('isMessageAlreadyFinalized true when id tracked and not in current streaming buffer', () => {
      const state = makeState();
      service.getProcessedMessageIds('sess-1').add('msg-1');
      expect(service.isMessageAlreadyFinalized('sess-1', 'msg-1', state)).toBe(
        true,
      );
    });

    it('isMessageAlreadyFinalized false when id still appears in streaming buffer', () => {
      const state = makeState();
      state.messageEventIds.push('msg-1');
      service.getProcessedMessageIds('sess-1').add('msg-1');
      expect(service.isMessageAlreadyFinalized('sess-1', 'msg-1', state)).toBe(
        false,
      );
    });

    it('isToolAlreadyFinalized true when tool tracked and not in streaming map', () => {
      const state = makeState();
      service.getProcessedToolCallIds('sess-1').add('tool-1');
      expect(service.isToolAlreadyFinalized('sess-1', 'tool-1', state)).toBe(
        true,
      );
    });

    it('isToolAlreadyFinalized false when tool still active', () => {
      const state = makeState();
      state.toolCallMap.set('tool-1', []);
      service.getProcessedToolCallIds('sess-1').add('tool-1');
      expect(service.isToolAlreadyFinalized('sess-1', 'tool-1', state)).toBe(
        false,
      );
    });
  });

  describe('handleDuplicateMessageStart', () => {
    it('returns skip=false when no existing message_start is found', () => {
      const state = makeState();
      const event = {
        id: 'evt-new',
        eventType: 'message_start',
        messageId: 'msg-new',
        role: 'assistant',
        source: 'stream',
      } as MessageStartEvent;

      const result = service.handleDuplicateMessageStart(state, event);
      expect(result).toEqual({ skip: false });
    });

    it('skips the new event when the existing source has higher priority', () => {
      const state = makeState();
      const existing = {
        id: 'evt-old',
        eventType: 'message_start',
        messageId: 'msg-1',
        source: 'history',
      } as unknown as MessageStartEvent & { source: EventSource };
      addEvent(state, existing);

      const incoming = {
        id: 'evt-new',
        eventType: 'message_start',
        messageId: 'msg-1',
        source: 'stream',
      } as MessageStartEvent;

      const result = service.handleDuplicateMessageStart(state, incoming);
      expect(result.skip).toBe(true);
      expect(result.existingEvent).toBe(existing);
      expect(state.events.has('evt-old')).toBe(true);
    });

    it('removes the existing event and returns existingEvent when new wins', () => {
      const state = makeState();
      const existing = {
        id: 'evt-old',
        eventType: 'message_start',
        messageId: 'msg-1',
        source: 'stream',
      } as unknown as MessageStartEvent & { source: EventSource };
      addEvent(state, existing);

      const incoming = {
        id: 'evt-new',
        eventType: 'message_start',
        messageId: 'msg-1',
        source: 'complete',
      } as MessageStartEvent;

      const result = service.handleDuplicateMessageStart(state, incoming);
      expect(result.skip).toBe(false);
      expect(result.existingEvent).toBe(existing);
      expect(state.events.has('evt-old')).toBe(false);
      const bucket = state.eventsByMessage.get('msg-1');
      expect(bucket ?? []).not.toContain(existing);
    });
  });

  describe('cleanupSession', () => {
    it('clears both processed-id sets for the session', () => {
      const msgs = service.getProcessedMessageIds('sess-1');
      const tools = service.getProcessedToolCallIds('sess-1');
      msgs.add('m');
      tools.add('t');

      service.cleanupSession('sess-1');

      // Fresh calls return new, empty sets.
      const freshMsgs = service.getProcessedMessageIds('sess-1');
      const freshTools = service.getProcessedToolCallIds('sess-1');
      expect(freshMsgs).not.toBe(msgs);
      expect(freshTools).not.toBe(tools);
      expect(freshMsgs.size).toBe(0);
      expect(freshTools.size).toBe(0);
    });
  });
});
