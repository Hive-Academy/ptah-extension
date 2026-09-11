import 'reflect-metadata';
import { CompactionBoundaryGenerationRegistry } from './compaction-boundary-generation-registry';

describe('CompactionBoundaryGenerationRegistry', () => {
  it('records a verified next count after the baseline has been observed', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-a', 2);
    registry.recordExpectedBoundary('session-a');

    expect(registry.capturePendingExpectation('session-a')).toEqual({
      kind: 'verified',
      expectedCount: 3,
    });
    expect(registry.inspect('session-a')).toEqual({
      baselineObserved: true,
      observedCount: 2,
      pendingExpectation: { kind: 'verified', expectedCount: 3 },
    });
  });

  it('records an explicitly unverified expectation when the baseline is absent', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.recordExpectedBoundary('session-b');

    expect(registry.capturePendingExpectation('session-b')).toEqual({
      kind: 'unverified',
    });
    expect(registry.inspect('session-b')).toEqual({
      baselineObserved: false,
      observedCount: 0,
      pendingExpectation: { kind: 'unverified' },
    });
  });

  it('keeps a baseline-absent expectation unverified even after a later observation', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.recordExpectedBoundary('session-b');
    registry.observeBoundaryCount('session-b', 5);

    expect(registry.capturePendingExpectation('session-b')).toEqual({
      kind: 'unverified',
    });
    expect(registry.inspect('session-b')).toEqual({
      baselineObserved: true,
      observedCount: 5,
      pendingExpectation: { kind: 'unverified' },
    });
  });

  it('captures pending expectation before updating observation', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-c', 1);
    registry.recordExpectedBoundary('session-c');

    const captured = registry.capturePendingExpectation('session-c');
    expect(captured).toEqual({ kind: 'verified', expectedCount: 2 });

    registry.observeBoundaryCount('session-c', 2);
    expect(registry.inspect('session-c')).toEqual({
      baselineObserved: true,
      observedCount: 2,
      pendingExpectation: { kind: 'verified', expectedCount: 2 },
    });
  });

  it('claims an already observed persisted boundary when history reads before stream transformation', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-race', 1);

    // An ordinary history read sees the newly persisted boundary before the
    // SDK stream emits the matching compact_boundary into the transformer.
    registry.observeBoundaryCount('session-race', 2, 'boundary-2');
    registry.recordExpectedBoundary('session-race', 'boundary-2');

    expect(registry.capturePendingExpectation('session-race')).toBeUndefined();
    expect(registry.inspect('session-race')).toEqual({
      baselineObserved: true,
      observedCount: 2,
      pendingExpectation: null,
    });
  });

  it('consumes expectation only on explicit consume call', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-d', 0);
    registry.recordExpectedBoundary('session-d');
    expect(registry.capturePendingExpectation('session-d')).toEqual({
      kind: 'verified',
      expectedCount: 1,
    });

    registry.consumeExpectation('session-d', 'satisfied');
    expect(registry.capturePendingExpectation('session-d')).toBeUndefined();
    expect(registry.inspect('session-d')).toEqual({
      baselineObserved: true,
      observedCount: 0,
      pendingExpectation: null,
    });
  });

  it('is per-session: one session expectation does not leak to another', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-x', 5);
    registry.recordExpectedBoundary('session-x');

    expect(registry.capturePendingExpectation('session-y')).toBeUndefined();
    expect(registry.inspect('session-y')).toBeUndefined();
  });

  it('advances the expected count once per distinct boundary recorded before the next observation', () => {
    // PR #493 review B: two distinct boundaries used to both write
    // observedCount + 1, so a transcript holding only the first new boundary
    // satisfied the second expectation.
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-stack', 1);
    registry.recordExpectedBoundary('session-stack', 'boundary-1');
    registry.recordExpectedBoundary('session-stack', 'boundary-2');

    expect(registry.capturePendingExpectation('session-stack')).toEqual({
      kind: 'verified',
      expectedCount: 3,
    });
  });

  it('treats a duplicate delivery of the same boundary id as idempotent', () => {
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-dup', 1);
    registry.recordExpectedBoundary('session-dup', 'boundary-1');
    registry.recordExpectedBoundary('session-dup', 'boundary-1');

    expect(registry.capturePendingExpectation('session-dup')).toEqual({
      kind: 'verified',
      expectedCount: 2,
    });
  });

  it('keeps an already pending expectation alive when a later boundary claims the observed one', () => {
    // A history read observes boundary-0 with no expectation pending, then
    // boundary-1 is recorded, then boundary-0's stream event finally arrives
    // and claims the observed generation. boundary-1's expectation must
    // survive the claim.
    const registry = new CompactionBoundaryGenerationRegistry();
    registry.observeBoundaryCount('session-claim', 1);
    registry.observeBoundaryCount('session-claim', 2, 'boundary-0');
    registry.recordExpectedBoundary('session-claim', 'boundary-1');
    registry.recordExpectedBoundary('session-claim', 'boundary-0');

    expect(registry.capturePendingExpectation('session-claim')).toEqual({
      kind: 'verified',
      expectedCount: 3,
    });
  });

  it('bounds the number of sessions and evicts the oldest', () => {
    const registry = new CompactionBoundaryGenerationRegistry(2);
    registry.observeBoundaryCount('session-1', 1);
    registry.observeBoundaryCount('session-2', 1);
    registry.observeBoundaryCount('session-3', 1);

    expect(registry.inspect('session-1')).toBeUndefined();
    expect(registry.inspect('session-2')).toEqual({
      baselineObserved: true,
      observedCount: 1,
      pendingExpectation: null,
    });
    expect(registry.inspect('session-3')).toEqual({
      baselineObserved: true,
      observedCount: 1,
      pendingExpectation: null,
    });
  });

  it('does not evict the oldest pending expectation when later observations exceed capacity', () => {
    const registry = new CompactionBoundaryGenerationRegistry(2);
    registry.observeBoundaryCount('pending-oldest', 1);
    registry.recordExpectedBoundary('pending-oldest');
    registry.observeBoundaryCount('ordinary-1', 1);
    registry.observeBoundaryCount('ordinary-2', 1);
    registry.observeBoundaryCount('ordinary-3', 1);

    expect(registry.capturePendingExpectation('pending-oldest')).toEqual({
      kind: 'verified',
      expectedCount: 2,
    });
    expect(registry.inspect('ordinary-1')).toBeUndefined();
    expect(registry.inspect('ordinary-2')).toBeUndefined();
    expect(registry.inspect('ordinary-3')).toEqual({
      baselineObserved: true,
      observedCount: 1,
      pendingExpectation: null,
    });
  });

  it('records an explicit unverified expectation when all primary capacity is pending', () => {
    const registry = new CompactionBoundaryGenerationRegistry(2);
    for (const sessionId of ['pending-a', 'pending-b']) {
      registry.observeBoundaryCount(sessionId, 1);
      registry.recordExpectedBoundary(sessionId);
    }

    registry.recordExpectedBoundary('overflow-c');

    expect(registry.capturePendingExpectation('pending-a')).toEqual({
      kind: 'verified',
      expectedCount: 2,
    });
    expect(registry.capturePendingExpectation('pending-b')).toEqual({
      kind: 'verified',
      expectedCount: 2,
    });
    expect(registry.capturePendingExpectation('overflow-c')).toEqual({
      kind: 'unverified',
    });
  });

  it('captures and consumes an overflow fail-stale expectation without crossing sessions', () => {
    const registry = new CompactionBoundaryGenerationRegistry(1);
    registry.observeBoundaryCount('pending-a', 1);
    registry.recordExpectedBoundary('pending-a');
    registry.recordExpectedBoundary('overflow-b');

    expect(registry.capturePendingExpectation('overflow-b')).toEqual({
      kind: 'unverified',
    });
    registry.consumeExpectation('overflow-b', 'stale');

    expect(registry.capturePendingExpectation('overflow-b')).toBeUndefined();
    expect(registry.capturePendingExpectation('pending-a')).toEqual({
      kind: 'verified',
      expectedCount: 2,
    });
  });

  it('reuses a consumed pending session for its next expected generation', () => {
    const registry = new CompactionBoundaryGenerationRegistry(1);
    registry.observeBoundaryCount('reused', 1);
    registry.recordExpectedBoundary('reused');
    registry.consumeExpectation('reused', 'satisfied');
    registry.observeBoundaryCount('reused', 2);
    registry.recordExpectedBoundary('reused');

    expect(registry.capturePendingExpectation('reused')).toEqual({
      kind: 'verified',
      expectedCount: 3,
    });
  });

  describe('PreCompact expectations (TASK_2026_414 Gap 2)', () => {
    it('recordPreCompact creates a verified expectation from the observed baseline', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('pre', 2);
      registry.recordPreCompact('pre');

      expect(registry.capturePendingExpectation('pre')).toEqual({
        kind: 'verified',
        expectedCount: 3,
      });
    });

    it('recordPreCompact without a baseline is explicitly unverified', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.recordPreCompact('pre-no-baseline');

      expect(registry.capturePendingExpectation('pre-no-baseline')).toEqual({
        kind: 'unverified',
      });
    });

    it('a live boundary after recordPreCompact claims it without advancing the expected count', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('pre', 2);
      registry.recordPreCompact('pre');
      registry.recordExpectedBoundary('pre', 'boundary-3');

      expect(registry.capturePendingExpectation('pre')).toEqual({
        kind: 'verified',
        expectedCount: 3,
      });
    });

    it('a history read that satisfies the PreCompact expectation followed by the live boundary does not create a new expectation', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('pre', 2);
      registry.recordPreCompact('pre');
      registry.observeBoundaryCount('pre', 3, 'boundary-3');
      registry.consumeExpectation('pre', 'satisfied');
      registry.recordExpectedBoundary('pre', 'boundary-3');

      expect(registry.capturePendingExpectation('pre')).toBeUndefined();
    });

    it('a stale read keeps a verified PreCompact expectation so the retry is still verified', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('pre', 2);
      registry.recordPreCompact('pre');
      registry.observeBoundaryCount('pre', 2);
      registry.consumeExpectation('pre', 'stale');

      expect(registry.capturePendingExpectation('pre')).toEqual({
        kind: 'verified',
        expectedCount: 3,
      });

      registry.observeBoundaryCount('pre', 3, 'boundary-3');
      registry.consumeExpectation('pre', 'satisfied');
      registry.recordExpectedBoundary('pre', 'boundary-3');
      expect(registry.capturePendingExpectation('pre')).toBeUndefined();
    });

    it('a stale consumption of an unverified PreCompact expectation resets the claim so the later live boundary re-establishes an expectation', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.recordPreCompact('pre');
      registry.observeBoundaryCount('pre', 2);
      registry.consumeExpectation('pre', 'stale');
      expect(registry.capturePendingExpectation('pre')).toBeUndefined();

      registry.recordExpectedBoundary('pre', 'boundary-3');

      expect(registry.capturePendingExpectation('pre')).toEqual({
        kind: 'verified',
        expectedCount: 3,
      });
    });

    it('a stale consume without a PreCompact claim still clears the expectation', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('boundary-only', 1);
      registry.recordExpectedBoundary('boundary-only', 'boundary-2');
      registry.consumeExpectation('boundary-only', 'stale');

      expect(
        registry.capturePendingExpectation('boundary-only'),
      ).toBeUndefined();
    });

    it('two distinct compactions (Pre, Pre, boundary, boundary) expect +2 then settle', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('two', 1);
      registry.recordPreCompact('two');
      registry.recordPreCompact('two');
      expect(registry.capturePendingExpectation('two')).toEqual({
        kind: 'verified',
        expectedCount: 3,
      });

      registry.recordExpectedBoundary('two', 'boundary-2');
      registry.recordExpectedBoundary('two', 'boundary-3');
      expect(registry.capturePendingExpectation('two')).toEqual({
        kind: 'verified',
        expectedCount: 3,
      });

      registry.observeBoundaryCount('two', 3, 'boundary-3');
      registry.consumeExpectation('two', 'satisfied');
      expect(registry.capturePendingExpectation('two')).toBeUndefined();
    });

    it('rekey moves a tabId entry onto the real id when the real id has no entry', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.recordPreCompact('tab-1');
      registry.rekey('tab-1', 'real-1');

      expect(registry.capturePendingExpectation('tab-1')).toBeUndefined();
      expect(registry.capturePendingExpectation('real-1')).toEqual({
        kind: 'unverified',
      });
    });

    it('rekey moves a tabId entry onto the real id without overwriting real-id evidence', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('real-2', 4);
      registry.recordExpectedBoundary('real-2', 'boundary-5');
      registry.recordPreCompact('tab-2');

      registry.rekey('tab-2', 'real-2');

      expect(registry.inspect('tab-2')).toBeUndefined();
      expect(registry.inspect('real-2')).toEqual({
        baselineObserved: true,
        observedCount: 4,
        pendingExpectation: { kind: 'verified', expectedCount: 5 },
      });
      // The carried PreCompact claim absorbs its own live boundary.
      registry.recordExpectedBoundary('real-2', 'boundary-6');
      expect(registry.capturePendingExpectation('real-2')).toEqual({
        kind: 'verified',
        expectedCount: 5,
      });
    });

    it('rekey ignores blank ids, equal ids and a missing source', () => {
      const registry = new CompactionBoundaryGenerationRegistry();
      registry.observeBoundaryCount('real-3', 1);
      registry.recordPreCompact('real-3');

      registry.rekey('', 'real-3');
      registry.rekey('real-3', '');
      registry.rekey('real-3', 'real-3');
      registry.rekey('missing', 'real-3');

      expect(registry.capturePendingExpectation('real-3')).toEqual({
        kind: 'verified',
        expectedCount: 2,
      });
    });
  });

  it('refreshes LRU order on access so active sessions survive', () => {
    const registry = new CompactionBoundaryGenerationRegistry(2);
    registry.observeBoundaryCount('session-1', 1);
    registry.observeBoundaryCount('session-2', 1);
    registry.observeBoundaryCount('session-1', 2);
    registry.observeBoundaryCount('session-3', 1);

    expect(registry.inspect('session-1')).toEqual({
      baselineObserved: true,
      observedCount: 2,
      pendingExpectation: null,
    });
    expect(registry.inspect('session-2')).toBeUndefined();
    expect(registry.inspect('session-3')).toEqual({
      baselineObserved: true,
      observedCount: 1,
      pendingExpectation: null,
    });
  });
});
