import { CompactionState } from '../compaction-state.types';
import type { IdleAttempt, IdleSessionState } from './idle-compaction.types';
import { evaluateFireGate, type FireGateLookups } from './idle-fire-gate';

const attempt: Extract<IdleAttempt, { kind: 'pending' }> = {
  kind: 'pending', attemptId: 'a', turnId: 't', anchorAt: 0,
  fireAt: 3_240_000, expiresAt: 3_600_000, armedAt: 1, contextTokens: 250_000,
};
const state: IdleSessionState = {
  sessionId: 's', runToken: 'r', codexProxy: false,
  lastTurn: { turnId: 't', endedAt: 1, request: { requestKey: 'req', anchorAt: 0, ttl: '1h' } },
  reading: { turnId: 't', totalTokens: 250_000 }, activitySinceTurnEnd: false,
  prefixChangedSinceTurnEnd: false, rateLimit: null, compactionOpen: false,
  idlePeriodClosed: false, attempt, timer: null,
};
const lookups: FireGateLookups = {
  now: attempt.fireAt,
  settings: { idleCompactionEnabled: true, autoCompactEnabled: true, minTokens: 200_000 },
  coordinatorState: () => CompactionState.OBSERVE_ONLY,
  coordinatorClaim: () => null,
  turnPhase: () => 'idle',
};
const gate = (s: IdleSessionState = state, l: FireGateLookups = lookups) => evaluateFireGate(s, attempt, l);

describe('evaluateFireGate', () => {
  it('AC 3.1: checks both switches first', () => {
    expect(gate(state, { ...lookups, settings: { ...lookups.settings, idleCompactionEnabled: false } })).toBe('disabled');
    expect(gate(state, { ...lookups, settings: { ...lookups.settings, autoCompactEnabled: false } })).toBe('auto-compact-off');
  });
  it('AC 3.2: requires last request 1h write', () => {
    expect(gate({ ...state, lastTurn: { ...state.lastTurn!, request: { requestKey: 'x', anchorAt: 0, ttl: 'not-1h' } } })).toBe('not-1h');
  });
  it('AC 3.3: drops lapsed fire after sleep and at expiry', () => {
    expect(gate(state, { ...lookups, now: attempt.fireAt + 60_000 })).toBeNull();
    expect(gate(state, { ...lookups, now: attempt.fireAt + 60_001 })).toBe('lapsed');
    expect(gate(state, { ...lookups, now: attempt.expiresAt })).toBe('lapsed');
  });
  it('AC 3.4: requires a current reading above threshold', () => {
    expect(gate({ ...state, reading: null })).toBe('no-reading');
    expect(gate({ ...state, reading: { turnId: 't', totalTokens: 199_999 } })).toBe('below-min-tokens');
  });
  it('AC 3.5: refuses activity', () => expect(gate({ ...state, activitySinceTurnEnd: true })).toBe('activity-since-arm'));
  it('AC 3.6: refuses prompt prefix changes', () => expect(gate({ ...state, prefixChangedSinceTurnEnd: true })).toBe('prompt-prefix-changed'));
  it('AC 3.7: refuses open compaction and Codex proxy, but allows OBSERVE_ONLY', () => {
    expect(gate(state, { ...lookups, coordinatorState: () => CompactionState.TRIGGERED })).toBe('compaction-state');
    expect(gate(state, { ...lookups, coordinatorClaim: () => 'held' })).toBe('compaction-state');
    expect(gate({ ...state, compactionOpen: true })).toBe('compaction-state');
    expect(gate({ ...state, codexProxy: true })).toBe('not-actable');
    expect(gate()).toBeNull();
  });
  it('AC 3.8: refuses warning or rejected rate limits', () => {
    expect(gate({ ...state, rateLimit: 'allowed_warning' })).toBe('rate-limited');
    expect(gate({ ...state, rateLimit: 'rejected' })).toBe('rate-limited');
  });
  it('AC 3.9: requires idle with a distinct background reason', () => {
    expect(gate(state, { ...lookups, turnPhase: () => 'awaiting-background' })).toBe('background-subagent');
    expect(gate(state, { ...lookups, turnPhase: () => 'generating' })).toBe('not-idle');
  });
});
