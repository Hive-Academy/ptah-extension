import { RepeatedWarningLimiter } from './repeated-warning-limiter';

describe('RepeatedWarningLimiter', () => {
  function build(maxKeys?: number) {
    let now = 0;
    const limiter = new RepeatedWarningLimiter({
      intervalMs: 1_000,
      maxKeys,
      now: () => now,
    });
    return {
      limiter,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('admits the first warning for a key with no suppressed count', () => {
    const { limiter } = build();

    expect(limiter.admit('a')).toBe(0);
  });

  it('suppresses repeats inside the interval and reports them on the next write', () => {
    const { limiter, advance } = build();

    expect(limiter.admit('a')).toBe(0);
    advance(400);
    expect(limiter.admit('a')).toBeNull();
    advance(400);
    expect(limiter.admit('a')).toBeNull();
    advance(200);
    expect(limiter.admit('a')).toBe(2);
    expect(limiter.admit('a')).toBeNull();
  });

  it('tracks keys independently', () => {
    const { limiter } = build();

    expect(limiter.admit('a')).toBe(0);
    expect(limiter.admit('b')).toBe(0);
    expect(limiter.admit('a')).toBeNull();
  });

  it('drops the least recently written key past the key limit', () => {
    const { limiter } = build(2);

    limiter.admit('a');
    limiter.admit('b');
    limiter.admit('c');

    // 'a' was evicted, so it is written again at once; 'c' is still limited.
    expect(limiter.admit('a')).toBe(0);
    expect(limiter.admit('c')).toBeNull();
  });
});
