import 'reflect-metadata';
import { z } from 'zod';
import { createMockConfigManager } from './config-manager.mock';

describe('createMockConfigManager', () => {
  it('returns typed getters whose values come from seeded overrides', async () => {
    const mock = createMockConfigManager({
      values: { 'ptah.apiKey': 'sk-test', 'ptah.timeout': 42 },
    });

    expect(mock.get<string>('ptah.apiKey')).toBe('sk-test');
    expect(mock.getWithDefault<number>('ptah.timeout', 0)).toBe(42);
    expect(mock.getWithDefault<string>('ptah.missing', 'fallback')).toBe(
      'fallback',
    );
    expect(mock.get.mock.calls.length).toBeGreaterThan(0);
  });

  it('round-trips values through set/get and honors zod validation', async () => {
    const mock = createMockConfigManager();
    await mock.set('ptah.logLevel', 'debug');
    expect(mock.__snapshot()).toEqual({ 'ptah.logLevel': 'debug' });

    const schema = z.enum(['debug', 'info', 'warn', 'error']);
    await mock.setTyped('ptah.logLevel', 'info', schema);
    expect(mock.getTyped('ptah.logLevel', schema)).toBe('info');

    mock.__seed({ 'ptah.extra': true });
    expect(mock.__snapshot()['ptah.extra']).toBe(true);
  });
});
