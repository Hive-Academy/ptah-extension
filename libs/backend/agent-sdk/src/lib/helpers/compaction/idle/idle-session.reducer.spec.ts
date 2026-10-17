import { reduceIdleSession, type IdleReduceContext } from './idle-session.reducer';
import type { IdleSessionState, IdleSignal, IdleStep } from './idle-compaction.types';

const ctx: IdleReduceContext = {
  now: 100, settings: { enabled: true, autoCompactEnabled: true, minTokens: 200_000 },
};
const request = { requestKey: 'req', anchorAt: 0, ttl: '1h' as const };
const initial: IdleSessionState = {
  sessionId: 's', runToken: 'run', codexProxy: false, lastTurn: null, reading: null,
  activitySinceTurnEnd: false, prefixChangedSinceTurnEnd: false, rateLimit: null,
  compactionOpen: false, idlePeriodClosed: false, attempt: null, timer: null,
};
const turn = (turnId = 't'): IdleSignal => ({ type: 'turn-ended', sessionId: 's',
  turnId, endedAt: 10, lastRequest: request });
const context = (turnId = 't', totalTokens: number | null = 250_000): IdleSignal =>
  ({ type: 'turn-context', sessionId: 's', turnId, totalTokens });
const sig = (type: 'pre-compact' | 'post-compact' | 'input' | 'request-started' |
  'prompt-prefix-changed' | 'settings-changed'): IdleSignal => ({ type, sessionId: 's' });
const step = (state: IdleSessionState, signal: IdleSignal, now = 100,
  settings = ctx.settings): IdleStep => reduceIdleSession(state, signal, { now, settings });
const armed = (): IdleSessionState => step(step(initial, turn()).state, context()).state;
const sending = (): IdleSessionState => {
  const state = armed();
  return step(state, { type: 'attempt-due', sessionId: 's', attemptId: state.attempt!.attemptId }).state;
};
const enqueued = (): IdleSessionState => {
  const state = sending();
  return step(state, { type: 'fire-sent', sessionId: 's', attemptId: state.attempt!.attemptId }).state;
};
const precompact = (): IdleSessionState => step(enqueued(), sig('pre-compact')).state;
const boundary = (): IdleStep => step(precompact(),
  { type: 'compact-boundary', sessionId: 's', preTokens: 240_000 });
const postcompacted = (): IdleStep => step(precompact(), sig('post-compact'));

describe('reduceIdleSession', () => {
  it('arms from the matching ended turn, deriving a due timer', () => {
    const state = armed();
    expect(state.attempt).toMatchObject({ kind: 'pending', turnId: 't',
      contextTokens: 250_000, fireAt: 3_240_000, expiresAt: 3_600_000 });
    expect(state.timer).toEqual({ kind: 'due', phase: 'sending',
      attemptId: state.attempt!.attemptId, at: 3_240_000 });
    expect(step(state, context()).state.attempt!.attemptId).not.toBe(state.attempt!.attemptId);
  });

  it.each([
    ['stale-turn', step(initial, context('other')).state, context()],
    ['not-1h', step(initial, { type: 'turn-ended', sessionId: 's', turnId: 't',
      endedAt: 10, lastRequest: { ...request, ttl: 'not-1h' } }).state, context()],
    ['no-reading', step(initial, turn()).state, context('t', null)],
    ['activity-since-turn', step(step(initial, turn()).state, sig('input')).state, context()],
    ['codex-proxy', { ...step(initial, turn()).state, codexProxy: true }, context()],
    ['in-flight', precompact(), context()],
  ] as const)('refuses %s with one debug reason', (reason, state, signal) => {
    expect(step(state, signal).effects).toEqual([{ type: 'log', level: 'debug', reason }]);
  });

  it('refuses disabled and elapsed anchors', () => {
    expect(step(step(initial, turn()).state, context(), 100,
      { ...ctx.settings, enabled: false }).effects).toEqual([
      { type: 'log', level: 'debug', reason: 'disabled' },
    ]);
    expect(step(step(initial, turn()).state, context(), 3_240_000).effects).toEqual([
      { type: 'log', level: 'debug', reason: 'fire-time-passed' },
    ]);
  });

  it('keeps readings scoped to their turn across interleaved sessions', () => {
    const state = step(armed(), turn('next')).state;
    expect(state.reading).toBeNull();
    expect(step(state, context('t')).state.attempt).toBeNull();
    expect(step(state, context('next', null)).state.attempt).toBeNull();
    expect(step(state, { type: 'turn-context', sessionId: 'other', turnId: 'next',
      totalTokens: 250_000 }).state.attempt).toBeNull();
  });

  it('cancels Pending on activity, prefix, disable, new run, and precompact', () => {
    for (const signal of [sig('input'), sig('request-started'),
      sig('prompt-prefix-changed'), sig('pre-compact'),
      { type: 'session-bound', sessionId: 's', runToken: 'new', codexProxy: false } as const]) {
      expect(step(armed(), signal).state.timer).toBeNull();
    }
    expect(step(armed(), sig('settings-changed'), 100,
      { ...ctx.settings, autoCompactEnabled: false }).state.attempt).toBeNull();
  });

  it('fires only the current Pending attempt once and mints its claim', () => {
    const state = armed();
    const due: IdleSignal = { type: 'attempt-due', sessionId: 's',
      attemptId: state.attempt!.attemptId };
    expect(step(state, { ...due, attemptId: 'stale' }).effects).toEqual([]);
    const fired = step(state, due);
    expect(fired.effects).toEqual([{ type: 'fire', attemptId: due.attemptId,
      claimId: `${due.attemptId}:claim` }]);
    expect(fired.state.timer).toBeNull();
    expect(step(fired.state, due).effects).toEqual([]);
  });

  it('tracks enqueue, dwell, skip, failure, and deadline timers', () => {
    const sent = enqueued();
    expect(sent.timer).toMatchObject({ kind: 'deadline', phase: 'enqueued', at: 120_100 });
    expect(precompact().timer).toMatchObject({ kind: 'deadline', phase: 'precompact', at: 300_100 });
    for (const [signal, reason] of [
      [{ type: 'fire-skipped', sessionId: 's', attemptId: sent.attempt!.attemptId,
        reason: 'not-idle' }, 'not-idle'],
      [{ type: 'fire-failed', sessionId: 's', attemptId: sent.attempt!.attemptId,
        reason: 'send-failed' }, 'send-failed'],
    ] as const) {
      const result = step(sent, signal);
      expect(result.effects).toContainEqual({ type: 'log',
        level: signal.type === 'fire-skipped' ? 'info' : 'warn', reason });
      expect(result.effects).toContainEqual({ type: 'release-claim', sessionId: 's',
        claimId: (sent.attempt as Extract<typeof sent.attempt, { kind: 'in-flight' }>).claimId });
      expect(result.state.timer).toBeNull();
    }
    for (const [state, reason] of [[sent, 'claim-timeout'], [precompact(), 'dwell-timeout']] as const) {
      const timer = state.timer!;
      const result = step(state, { type: 'deadline-elapsed', sessionId: 's',
        attemptId: timer.attemptId, phase: timer.phase }, timer.at);
      expect(result.effects).toContainEqual({ type: 'log', level: 'warn', reason });
      expect(result.state.idlePeriodClosed).toBe(true);
    }
  });

  it('holds the claim through boundary -> result -> PostCompact', () => {
    const atBoundary = boundary();
    expect(atBoundary.effects).toContainEqual({ type: 'set-notice', noticeKey: 's', preTokens: 240_000 });
    expect(atBoundary.state.timer).toBeNull();
    const ended = step(atBoundary.state, turn());
    expect(ended.state.attempt).toMatchObject({ phase: 'boundary-ended', claimed: true });
    expect(ended.state.timer).toMatchObject({ phase: 'boundary-ended', at: 30_100 });
    expect(ended.effects.some(effect => effect.type === 'release-claim')).toBe(false);
    const finished = step(ended.state, sig('post-compact'));
    expect(finished.effects).toContainEqual({ type: 'release-claim', sessionId: 's',
      claimId: (ended.state.attempt as Extract<typeof ended.state.attempt,
        { kind: 'in-flight' }>).claimId });
    expect(finished.state.attempt).toBeNull();
    expect(finished.state.idlePeriodClosed).toBe(true);
  });

  it('warns postcompact-timeout after boundary and result', () => {
    const ended = step(boundary().state, turn()).state;
    const timer = ended.timer!;
    const result = step(ended, { type: 'deadline-elapsed', sessionId: 's',
      attemptId: timer.attemptId, phase: timer.phase }, timer.at);
    expect(result.effects).toContainEqual({ type: 'log', level: 'warn', reason: 'postcompact-timeout' });
    expect(result.effects.some(effect => effect.type === 'release-claim')).toBe(true);
  });

  it('handles live PreCompact -> PostCompact -> boundary -> result', () => {
    const post = postcompacted();
    expect(post.effects.some(effect => effect.type === 'release-claim')).toBe(true);
    expect(post.state.timer).toMatchObject({ phase: 'postcompacted', at: 30_100 });
    const atBoundary = step(post.state,
      { type: 'compact-boundary', sessionId: 's', preTokens: null });
    expect(atBoundary.effects).toContainEqual({ type: 'set-notice',
      noticeKey: 's', preTokens: 250_000 });
    expect(atBoundary.state.idlePeriodClosed).toBe(true);
    expect(atBoundary.state.timer).toBeNull();
    expect(step(atBoundary.state, turn()).effects).toContainEqual({ type: 'clear-notice' });
  });

  it('keeps same-run init harmless in precompact and postcompacted', () => {
    for (const state of [precompact(), postcompacted().state]) {
      const rebound = step(state, { type: 'session-bound', sessionId: 's',
        runToken: 'run', codexProxy: false });
      expect(rebound.state).toEqual(state);
      const atBoundary = step(rebound.state,
        { type: 'compact-boundary', sessionId: 's', preTokens: 20 });
      expect(atBoundary.effects).toContainEqual({ type: 'set-notice', noticeKey: 's', preTokens: 20 });
    }
  });

  it('closes PostCompact without boundary on result or grace expiry', () => {
    const state = postcompacted().state;
    for (const signal of [turn(), { type: 'deadline-elapsed', sessionId: 's',
      attemptId: state.attempt!.attemptId, phase: 'postcompacted' } as const]) {
      const result = step(state, signal, 30_100);
      expect(result.state.idlePeriodClosed).toBe(true);
      expect(result.effects.some(effect => effect.type === 'set-notice')).toBe(false);
      expect(result.effects.some(effect => effect.type === 'release-claim')).toBe(false);
    }
  });

  it('closes PostCompact on a new run or manual PreCompact before its boundary', () => {
    for (const signal of [
      { type: 'session-bound', sessionId: 's', runToken: 'manual', codexProxy: false } as const,
      sig('pre-compact'),
    ]) {
      const closed = step(postcompacted().state, signal).state;
      expect(closed.attempt).toBeNull();
      expect(closed.idlePeriodClosed).toBe(true);
      const after = step(closed, { type: 'compact-boundary',
        sessionId: 's', preTokens: 20 });
      expect(after.effects.some(effect => effect.type === 'set-notice')).toBe(false);
    }
  });
});
