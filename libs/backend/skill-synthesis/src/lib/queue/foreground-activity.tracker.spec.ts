/**
 * The tracker exists because `SessionActivityRegistry` is push-only, so the two
 * things worth pinning are (a) the "nothing seen yet" answer is Infinity rather
 * than 0 — a fresh process must not look busy — and (b) a host with no registry
 * at all still resolves and answers.
 */
import 'reflect-metadata';
import {
  ForegroundActivityTracker,
  type ForegroundActivityPayload,
  type ForegroundActivitySource,
} from './foreground-activity.tracker';
import { noopLogger } from './queue-db.test-support';

/** A stand-in for the push-only registry. */
class FakeActivitySource implements ForegroundActivitySource {
  readonly callbacks: Array<(p: ForegroundActivityPayload) => void> = [];
  disposeCalls = 0;

  register(callback: (p: ForegroundActivityPayload) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.disposeCalls++;
    };
  }

  emit(payload: ForegroundActivityPayload): void {
    for (const cb of this.callbacks) cb(payload);
  }
}

describe('ForegroundActivityTracker', () => {
  it('reports Infinity before any activity is observed', () => {
    const tracker = new ForegroundActivityTracker(
      noopLogger,
      new FakeActivitySource(),
    );
    tracker.start();

    expect(tracker.msSinceLastActivity(1_000)).toBe(Number.POSITIVE_INFINITY);
    expect(tracker.lastActivityTimestamp).toBeNull();
  });

  it('reports the elapsed time since the last event timestamp', () => {
    const source = new FakeActivitySource();
    const tracker = new ForegroundActivityTracker(noopLogger, source);
    tracker.start();

    source.emit({ timestamp: 10_000 });

    expect(tracker.msSinceLastActivity(11_000)).toBe(1_000);
    expect(tracker.lastActivityTimestamp).toBe(10_000);
  });

  it('keeps the newest timestamp when events arrive out of order', () => {
    const source = new FakeActivitySource();
    const tracker = new ForegroundActivityTracker(noopLogger, source);
    tracker.start();

    source.emit({ timestamp: 10_000 });
    source.emit({ timestamp: 5_000 });

    expect(tracker.lastActivityTimestamp).toBe(10_000);
  });

  it('never reports a negative age for a future timestamp', () => {
    const source = new FakeActivitySource();
    const tracker = new ForegroundActivityTracker(noopLogger, source);
    tracker.start();

    source.emit({ timestamp: 20_000 });

    expect(tracker.msSinceLastActivity(10_000)).toBe(0);
  });

  it('falls back to the wall clock when the payload carries no timestamp', () => {
    const source = new FakeActivitySource();
    const tracker = new ForegroundActivityTracker(noopLogger, source);
    tracker.start();

    const before = Date.now();
    source.emit({});
    const after = Date.now();

    const stamped = tracker.lastActivityTimestamp;
    expect(stamped).not.toBeNull();
    expect(stamped as number).toBeGreaterThanOrEqual(before);
    expect(stamped as number).toBeLessThanOrEqual(after);
  });

  it('subscribes at most once however often start() is called', () => {
    const source = new FakeActivitySource();
    const tracker = new ForegroundActivityTracker(noopLogger, source);

    tracker.start();
    tracker.start();
    tracker.start();

    expect(source.callbacks).toHaveLength(1);
  });

  it('disposes the subscription on stop() and can restart', () => {
    const source = new FakeActivitySource();
    const tracker = new ForegroundActivityTracker(noopLogger, source);

    tracker.start();
    tracker.stop();
    expect(source.disposeCalls).toBe(1);

    tracker.start();
    expect(source.callbacks).toHaveLength(2);
  });

  it('answers Infinity and does not throw when no registry is present', () => {
    const tracker = new ForegroundActivityTracker(noopLogger, undefined);

    expect(() => {
      tracker.start();
      tracker.stop();
    }).not.toThrow();
    expect(tracker.msSinceLastActivity(1_000)).toBe(Number.POSITIVE_INFINITY);
  });
});
