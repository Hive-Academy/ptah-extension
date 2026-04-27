import * as barrel from './index';

describe('@ptah-extension/shared/testing barrel', () => {
  it('re-exports every documented utility', () => {
    const expected: readonly string[] = [
      'createMockLogger',
      'createFakeAsyncGenerator',
      'createTestContainer',
      'resetTestContainer',
      'registerMatchers',
      'toBeSessionId',
      'toMatchRpcSuccess',
      'toMatchRpcError',
      'makeCorrelationId',
      'resetCorrelationIdCounter',
      'freezeTime',
      'expectNormalizedPath',
      'toPosixPath',
    ];

    for (const name of expected) {
      expect(barrel).toHaveProperty(name);
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
