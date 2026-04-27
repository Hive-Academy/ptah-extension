import { freezeTime } from './freeze-time';

describe('freezeTime', () => {
  let clock: ReturnType<typeof freezeTime>;

  afterEach(() => {
    clock?.restore();
  });

  it('pins Date.now() to the supplied instant', () => {
    clock = freezeTime('2026-01-01T00:00:00.000Z');
    expect(Date.now()).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(clock.now).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('accepts Date objects', () => {
    const d = new Date('2026-06-15T12:34:56.000Z');
    clock = freezeTime(d);
    expect(Date.now()).toBe(d.getTime());
  });

  it('advances by the requested amount and fires pending timers', () => {
    clock = freezeTime('2026-01-01T00:00:00.000Z');
    const cb = jest.fn();
    setTimeout(cb, 100);

    clock.advanceBy(100);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(Date.parse('2026-01-01T00:00:00.100Z'));
  });

  it('throws on invalid instants', () => {
    expect(() => freezeTime('not-a-date')).toThrow(TypeError);
  });

  it('restore() returns to real timers', () => {
    clock = freezeTime('2026-01-01T00:00:00.000Z');
    clock.restore();
    // After restore, Date.now() should be close to wall clock (not 2026).
    const realNow = Date.now();
    expect(realNow).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
  });
});
