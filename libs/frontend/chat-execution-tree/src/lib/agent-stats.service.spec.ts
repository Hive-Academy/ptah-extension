/**
 * AgentStatsService — per-agent stat aggregation coverage.
 *
 * TASK_2026_105 Wave G1.
 */

import { TestBed } from '@angular/core/testing';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import type {
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageStartEvent,
} from '@ptah-extension/shared';
import { AgentStatsService } from './agent-stats.service';

function setEvent(
  state: ReturnType<typeof createEmptyStreamingState>,
  event: FlatStreamEventUnion,
): void {
  state.events.set(event.id, event);
}

describe('AgentStatsService', () => {
  let svc: AgentStatsService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AgentStatsService] });
    svc = TestBed.inject(AgentStatsService);
  });

  it('returns empty result when no events match the toolCallId', () => {
    const state = createEmptyStreamingState();
    const result = svc.aggregateAgentStats('toolu_missing', state);
    expect(result).toEqual({
      agentModel: undefined,
      tokenUsage: undefined,
      cost: undefined,
      duration: undefined,
    });
  });

  it('aggregates model, token usage, cost, and duration across child message events', () => {
    const state = createEmptyStreamingState();
    const parentToolUseId = 'toolu_agent_1';
    const sessionId = 'session_a';

    // Linked message_start (timestamp 100) — should set earliestStart.
    setEvent(state, {
      id: 'evt_msg_start_1',
      eventType: 'message_start',
      timestamp: 100,
      sessionId,
      messageId: 'msg_1',
      parentToolUseId,
      role: 'assistant',
    } as MessageStartEvent);

    // Linked message_complete with model + token usage + cost.
    setEvent(state, {
      id: 'evt_msg_complete_1',
      eventType: 'message_complete',
      timestamp: 250,
      sessionId,
      messageId: 'msg_1',
      parentToolUseId,
      model: 'claude-opus-4-7',
      tokenUsage: { input: 100, output: 50 },
      cost: 0.0015,
    } as MessageCompleteEvent);

    // Second linked message_complete — model already set, so should be ignored;
    // tokens & cost accumulate; latestEnd advances.
    setEvent(state, {
      id: 'evt_msg_complete_2',
      eventType: 'message_complete',
      timestamp: 400,
      sessionId,
      messageId: 'msg_2',
      parentToolUseId,
      model: 'claude-haiku-4-7',
      tokenUsage: { input: 30, output: 20 },
      cost: 0.0005,
    } as MessageCompleteEvent);

    // Unrelated event under a different toolCallId — must NOT influence result.
    setEvent(state, {
      id: 'evt_msg_complete_other',
      eventType: 'message_complete',
      timestamp: 999,
      sessionId,
      messageId: 'msg_other',
      parentToolUseId: 'toolu_other',
      model: 'other-model',
      tokenUsage: { input: 1000, output: 1000 },
      cost: 99,
    } as MessageCompleteEvent);

    const result = svc.aggregateAgentStats(parentToolUseId, state);

    expect(result.agentModel).toBe('claude-opus-4-7'); // first-seen wins
    expect(result.tokenUsage).toEqual({ input: 130, output: 70 });
    expect(result.cost).toBeCloseTo(0.002, 6);
    expect(result.duration).toBe(300); // 400 - 100
  });

  it('returns undefined for token usage when no message_complete carries tokenUsage', () => {
    const state = createEmptyStreamingState();
    const parentToolUseId = 'toolu_no_tokens';
    const sessionId = 'session_b';

    setEvent(state, {
      id: 'evt_msg_complete',
      eventType: 'message_complete',
      timestamp: 500,
      sessionId,
      messageId: 'msg_x',
      parentToolUseId,
      // no tokenUsage, no cost, no model
    } as MessageCompleteEvent);

    const result = svc.aggregateAgentStats(parentToolUseId, state);
    expect(result.tokenUsage).toBeUndefined();
    expect(result.cost).toBeUndefined();
    expect(result.agentModel).toBeUndefined();
    // Only message_complete (no message_start) → earliestStart undefined → no duration.
    expect(result.duration).toBeUndefined();
  });

  it('returns undefined duration when latestEnd does not advance past earliestStart', () => {
    const state = createEmptyStreamingState();
    const parentToolUseId = 'toolu_eq_ts';
    const sessionId = 'session_c';

    setEvent(state, {
      id: 'evt_msg_start',
      eventType: 'message_start',
      timestamp: 200,
      sessionId,
      messageId: 'msg_eq',
      parentToolUseId,
      role: 'assistant',
    } as MessageStartEvent);

    setEvent(state, {
      id: 'evt_msg_complete',
      eventType: 'message_complete',
      timestamp: 200, // same timestamp — latestEnd === earliestStart
      sessionId,
      messageId: 'msg_eq',
      parentToolUseId,
    } as MessageCompleteEvent);

    const result = svc.aggregateAgentStats(parentToolUseId, state);
    expect(result.duration).toBeUndefined();
  });

  it('caches results within a build cycle and returns the same object on subsequent calls', () => {
    const state = createEmptyStreamingState();
    const parentToolUseId = 'toolu_cached';
    const sessionId = 'session_d';

    setEvent(state, {
      id: 'evt_msg_complete',
      eventType: 'message_complete',
      timestamp: 100,
      sessionId,
      messageId: 'msg_cached',
      parentToolUseId,
      model: 'claude-sonnet-4-7',
      tokenUsage: { input: 10, output: 5 },
    } as MessageCompleteEvent);

    const a = svc.aggregateAgentStats(parentToolUseId, state);
    const b = svc.aggregateAgentStats(parentToolUseId, state);
    expect(a).toBe(b); // same object reference — cache hit

    // Add a new event that would change the result, but cached entry is stale.
    setEvent(state, {
      id: 'evt_msg_complete_new',
      eventType: 'message_complete',
      timestamp: 200,
      sessionId,
      messageId: 'msg_cached_2',
      parentToolUseId,
      tokenUsage: { input: 999, output: 999 },
    } as MessageCompleteEvent);

    const stillCached = svc.aggregateAgentStats(parentToolUseId, state);
    expect(stillCached).toBe(a);
  });

  it('resetPerBuildCache() clears cached entries so the next call recomputes', () => {
    const state = createEmptyStreamingState();
    const parentToolUseId = 'toolu_reset';
    const sessionId = 'session_e';

    setEvent(state, {
      id: 'evt_msg_complete',
      eventType: 'message_complete',
      timestamp: 100,
      sessionId,
      messageId: 'msg_reset',
      parentToolUseId,
      tokenUsage: { input: 1, output: 1 },
    } as MessageCompleteEvent);

    const before = svc.aggregateAgentStats(parentToolUseId, state);
    expect(before.tokenUsage).toEqual({ input: 1, output: 1 });

    setEvent(state, {
      id: 'evt_msg_complete_2',
      eventType: 'message_complete',
      timestamp: 200,
      sessionId,
      messageId: 'msg_reset_2',
      parentToolUseId,
      tokenUsage: { input: 4, output: 4 },
    } as MessageCompleteEvent);

    svc.resetPerBuildCache();
    const after = svc.aggregateAgentStats(parentToolUseId, state);
    expect(after.tokenUsage).toEqual({ input: 5, output: 5 });
    expect(after).not.toBe(before);
  });
});
