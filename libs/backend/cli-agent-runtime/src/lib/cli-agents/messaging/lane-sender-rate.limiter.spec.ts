import {
  LANE_SENDER_RATE_LIMIT,
  LANE_SENDER_RATE_WINDOW_MS,
  LaneSenderRateLimiter,
} from './lane-sender-rate.limiter';

describe('LaneSenderRateLimiter', () => {
  const NOW = 1_000_000;

  it('allows 10 sends per 60 s and limits the 11th', () => {
    const limiter = new LaneSenderRateLimiter();
    expect(LANE_SENDER_RATE_LIMIT).toBe(10);
    expect(LANE_SENDER_RATE_WINDOW_MS).toBe(60_000);
    for (let i = 0; i < 10; i++) {
      expect(limiter.isLimited('a', NOW + i)).toBe(false);
      limiter.record('a', NOW + i);
    }
    expect(limiter.isLimited('a', NOW + 10)).toBe(true);
  });

  it('slides: sends older than the window stop counting', () => {
    const limiter = new LaneSenderRateLimiter(2, 1_000);
    limiter.record('a', NOW);
    limiter.record('a', NOW + 500);
    expect(limiter.isLimited('a', NOW + 999)).toBe(true);
    expect(limiter.isLimited('a', NOW + 1_000)).toBe(false);
  });

  it('keeps senders independent', () => {
    const limiter = new LaneSenderRateLimiter(1, 1_000);
    limiter.record('a', NOW);
    expect(limiter.isLimited('a', NOW)).toBe(true);
    expect(limiter.isLimited('b', NOW)).toBe(false);
  });

  it('drops a key once its window empties and on forget', () => {
    const limiter = new LaneSenderRateLimiter(5, 1_000);
    limiter.record('a', NOW);
    limiter.record('b', NOW);
    expect(limiter.size).toBe(2);
    expect(limiter.isLimited('a', NOW + 2_000)).toBe(false);
    expect(limiter.size).toBe(1);
    limiter.forget('b');
    expect(limiter.size).toBe(0);
  });
});
