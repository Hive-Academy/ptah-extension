import 'reflect-metadata';
import { ConversationTurnTracker } from './turn-activity-tracker';
import { ConversationKey } from './types';

describe('ConversationTurnTracker', () => {
  const keyA = ConversationKey.for('discord', 'chan-1', 'thread-1');
  const keyB = ConversationKey.for('discord', 'chan-1', 'thread-2');

  let tracker: ConversationTurnTracker;

  beforeEach(() => {
    tracker = new ConversationTurnTracker();
  });

  it('is not busy for an untracked key', () => {
    expect(tracker.isBusy(keyA)).toBe(false);
  });

  it('is busy between begin and end', () => {
    tracker.begin(keyA);
    expect(tracker.isBusy(keyA)).toBe(true);

    tracker.end(keyA);
    expect(tracker.isBusy(keyA)).toBe(false);
  });

  it('stays busy while a queued turn waits behind a running one', () => {
    tracker.begin(keyA);
    tracker.begin(keyA);

    tracker.end(keyA);
    expect(tracker.isBusy(keyA)).toBe(true);

    tracker.end(keyA);
    expect(tracker.isBusy(keyA)).toBe(false);
  });

  it('isolates keys — one conversation never blocks another', () => {
    tracker.begin(keyA);

    expect(tracker.isBusy(keyA)).toBe(true);
    expect(tracker.isBusy(keyB)).toBe(false);

    tracker.begin(keyB);
    tracker.end(keyA);

    expect(tracker.isBusy(keyA)).toBe(false);
    expect(tracker.isBusy(keyB)).toBe(true);
  });

  it('does not go negative on an unmatched end', () => {
    tracker.end(keyA);
    expect(tracker.isBusy(keyA)).toBe(false);

    tracker.begin(keyA);
    expect(tracker.isBusy(keyA)).toBe(true);

    tracker.end(keyA);
    expect(tracker.isBusy(keyA)).toBe(false);
  });
});
