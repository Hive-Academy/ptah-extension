import { createEvent } from './event-emitter';

describe('createEvent', () => {
  it('returns a [event, fire] tuple', () => {
    const [event, fire] = createEvent<string>();
    expect(typeof event).toBe('function');
    expect(typeof fire).toBe('function');
  });

  it('fires registered listeners with the emitted data', () => {
    const [event, fire] = createEvent<number>();
    const received: number[] = [];

    event((v) => received.push(v));
    fire(42);

    expect(received).toEqual([42]);
  });

  it('fires all registered listeners on each emit', () => {
    const [event, fire] = createEvent<string>();
    const a: string[] = [];
    const b: string[] = [];

    event((v) => a.push(v));
    event((v) => b.push(v));
    fire('hello');

    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  it('delivers multiple successive fires in order', () => {
    const [event, fire] = createEvent<number>();
    const received: number[] = [];

    event((v) => received.push(v));
    fire(1);
    fire(2);
    fire(3);

    expect(received).toEqual([1, 2, 3]);
  });

  it('dispose() removes the listener so it does not fire after disposal', () => {
    const [event, fire] = createEvent<string>();
    const received: string[] = [];

    const handle = event((v) => received.push(v));
    fire('before');
    handle.dispose();
    fire('after');

    expect(received).toEqual(['before']);
  });

  it('dispose() does not affect other listeners on the same event', () => {
    const [event, fire] = createEvent<string>();
    const a: string[] = [];
    const b: string[] = [];

    const handleA = event((v) => a.push(v));
    event((v) => b.push(v));

    handleA.dispose();
    fire('value');

    expect(a).toEqual([]);
    expect(b).toEqual(['value']);
  });

  it('double-dispose() is safe (idempotent)', () => {
    const [event, fire] = createEvent<string>();
    const received: string[] = [];

    const handle = event((v) => received.push(v));
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();

    fire('x');
    expect(received).toEqual([]);
  });

  it('works with object payloads', () => {
    const [event, fire] = createEvent<{ id: number; name: string }>();
    const received: Array<{ id: number; name: string }> = [];

    event((v) => received.push(v));
    fire({ id: 1, name: 'Alice' });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ id: 1, name: 'Alice' });
  });

  it('fires no listeners when none are registered', () => {
    const [, fire] = createEvent<string>();
    expect(() => fire('no-one-listening')).not.toThrow();
  });
});
