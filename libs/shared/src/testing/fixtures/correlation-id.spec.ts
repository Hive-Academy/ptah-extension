import { makeCorrelationId, resetCorrelationIdCounter } from './correlation-id';

describe('makeCorrelationId', () => {
  beforeEach(() => resetCorrelationIdCounter());

  it('produces a monotonically-increasing, zero-padded id', () => {
    expect(makeCorrelationId()).toBe('test-corr-0001');
    expect(makeCorrelationId()).toBe('test-corr-0002');
    expect(makeCorrelationId()).toBe('test-corr-0003');
  });

  it('honours custom prefix and width', () => {
    expect(makeCorrelationId({ prefix: 'xyz', width: 2 })).toBe('xyz-01');
    expect(makeCorrelationId({ prefix: 'xyz', width: 2 })).toBe('xyz-02');
  });

  it('resets back to 1 on demand', () => {
    makeCorrelationId();
    makeCorrelationId();
    resetCorrelationIdCounter();
    expect(makeCorrelationId()).toBe('test-corr-0001');
  });
});
