import 'reflect-metadata';
import { NullBootReadinessProvider } from './null-boot-readiness';

describe('NullBootReadinessProvider', () => {
  it('always answers ready and settled', () => {
    const provider = new NullBootReadinessProvider();

    const snapshot = provider.getReadiness();

    expect(snapshot.readiness).toBe('ready');
    expect(snapshot.phase).toBe('settled');
  });

  it('reports a finite startedAt', () => {
    const before = Date.now();
    const provider = new NullBootReadinessProvider();
    const after = Date.now();

    const { startedAt } = provider.getReadiness();

    expect(Number.isFinite(startedAt)).toBe(true);
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });

  it('keeps startedAt stable across reads', () => {
    // Captured at construction, not per call: the renderer shows elapsed boot
    // time from this value, and a per-call `Date.now()` would reset it to zero
    // on every poll.
    const provider = new NullBootReadinessProvider();

    const first = provider.getReadiness().startedAt;
    const second = provider.getReadiness().startedAt;

    expect(second).toBe(first);
  });

  it('carries no detail — a host with no staged boot has nothing to narrate', () => {
    expect(
      new NullBootReadinessProvider().getReadiness().detail,
    ).toBeUndefined();
  });
});
