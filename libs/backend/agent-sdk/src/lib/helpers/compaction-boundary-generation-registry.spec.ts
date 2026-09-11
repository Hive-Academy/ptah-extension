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

    registry.consumeExpectation('session-d');
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
    registry.consumeExpectation('overflow-b');

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
    registry.consumeExpectation('reused');
    registry.observeBoundaryCount('reused', 2);
    registry.recordExpectedBoundary('reused');

    expect(registry.capturePendingExpectation('reused')).toEqual({
      kind: 'verified',
      expectedCount: 3,
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
