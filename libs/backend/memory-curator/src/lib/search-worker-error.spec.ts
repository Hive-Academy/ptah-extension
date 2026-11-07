import {
  rebuildWorkerError,
  serializedWorkerErrorSchema,
  serializeWorkerError,
} from './search-worker-error';

describe('search worker error serialization', () => {
  it('keeps name, message, stack and the cause chain, and rebuilds a real Error', () => {
    const inner = new TypeError('inner');
    const outer = new Error('outer', { cause: inner });
    outer.name = 'SqliteError';

    const serialized = serializeWorkerError(outer);
    expect(serializedWorkerErrorSchema.safeParse(serialized).success).toBe(true);

    const rebuilt = rebuildWorkerError(serialized);
    expect(rebuilt).toBeInstanceOf(Error);
    expect(rebuilt.name).toBe('SqliteError');
    expect(rebuilt.message).toBe('outer');
    expect(rebuilt.stack).toBe(outer.stack);
    expect(rebuilt.cause).toBeInstanceOf(Error);
    if (!(rebuilt.cause instanceof Error)) throw new Error('expected an Error cause');
    expect(rebuilt.cause.name).toBe('TypeError');
    expect(rebuilt.cause.message).toBe('inner');
  });

  it('never copies own properties such as SQL text or bound parameters', () => {
    const error = Object.assign(new Error('constraint failed'), {
      sql: 'INSERT INTO memories VALUES (?)',
      params: ['secret value'],
    });
    const serialized = serializeWorkerError(error);
    expect(Object.keys(serialized).sort()).toEqual(['message', 'name', 'stack']);
    expect(JSON.stringify(serialized)).not.toContain('secret value');
  });

  it('bounds the message, stack and cause depth so the schema always accepts it', () => {
    let error = new Error('x'.repeat(5_000));
    error.stack = 'y'.repeat(20_000);
    for (let depth = 0; depth < 6; depth++) error = new Error(`level ${depth}`, { cause: error });

    const serialized = serializeWorkerError(error);
    expect(serializedWorkerErrorSchema.safeParse(serialized).success).toBe(true);
    let depth = 0;
    for (let cause = serialized.cause; cause; cause = cause.cause) depth++;
    expect(depth).toBe(3);
  });

  it('keeps only the text of a primitive cause and the type of an object cause', () => {
    expect(serializeWorkerError(new Error('a', { cause: 'disk full' })).cause).toEqual({
      name: 'NonErrorCause',
      message: 'disk full',
    });
    expect(serializeWorkerError(new Error('b', { cause: { token: 'x' } })).cause).toEqual({
      name: 'NonErrorCause',
      message: 'non-Error cause (object)',
    });
  });
});
