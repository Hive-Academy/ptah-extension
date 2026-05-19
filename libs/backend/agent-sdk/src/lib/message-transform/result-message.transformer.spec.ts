import 'reflect-metadata';
import { ResultMessageTransformer } from './result-message.transformer';
import type { TransformerHelpers } from './transformer-helpers';

describe('ResultMessageTransformer', () => {
  it('always returns an empty event array', () => {
    const transformer = new ResultMessageTransformer();
    const helpers = {
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      subagentRegistry: {
        markPendingBackground: jest.fn(),
        setTaskId: jest.fn(),
        pruneSession: jest.fn(),
      },
      modelResolver: { resolveForPricing: jest.fn() },
      sessionLifecycle: { getActiveSessionIds: jest.fn() },
      usageTracker: {
        recordSessionUsage: jest.fn(),
        getCumulativeTokens: jest.fn(),
        clearSessionTokenSnapshot: jest.fn(),
      },
    } as unknown as TransformerHelpers;
    const msg = { type: 'result', subtype: 'success' } as never;
    expect(transformer.transform(msg, helpers)).toEqual([]);
  });
});
