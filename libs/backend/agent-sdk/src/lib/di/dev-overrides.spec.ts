import { createMockLogger } from '@ptah-extension/shared/testing';
import { readDevOverrides } from './dev-overrides';

describe('readDevOverrides', () => {
  const logger = createMockLogger();
  const warn = logger.warn;
  const env = {
    PTAH_DEV_IDLE_CACHE_TTL_MS: '10000',
    PTAH_DEV_IDLE_MIN_TOKENS: '1000',
    PTAH_DEV_SESSION_BUDGET_TOKENS: '2000',
  };

  beforeEach(() => warn.mockClear());

  it('ignores overrides in a production host', () => {
    expect(readDevOverrides(false, env, logger)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('applies bounded values in a development host and warns once', () => {
    expect(readDevOverrides(true, env, logger)).toEqual({
      idleCacheTtlMs: 10000,
      idleMinTokens: 1000,
      sessionBudgetTokens: 2000,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid and oversized values', () => {
    expect(readDevOverrides(true, {
      PTAH_DEV_IDLE_CACHE_TTL_MS: '0',
      PTAH_DEV_IDLE_MIN_TOKENS: '-1',
      PTAH_DEV_SESSION_BUDGET_TOKENS: '2000000001',
    }, logger)).toEqual({
      idleCacheTtlMs: undefined,
      idleMinTokens: undefined,
      sessionBudgetTokens: undefined,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
