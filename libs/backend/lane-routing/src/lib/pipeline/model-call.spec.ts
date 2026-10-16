import type { LaneRoutingLogger } from '../lane-routing-logger';
import type { StructuredDecisionCompleter } from '../decision-model/structured-decision.port';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_RETURN_MARGIN_MS,
} from '../routing-constants';
import { callStructured } from './model-call';

const BUDGET = DECISION_REQUEST_TIMEOUT_MS + DECISION_RETURN_MARGIN_MS;

function quietLogger(): LaneRoutingLogger {
  return {
    debug() {
      return undefined;
    },
    info() {
      return undefined;
    },
    warn() {
      return undefined;
    },
    error() {
      return undefined;
    },
  };
}

function completer(
  complete: StructuredDecisionCompleter['complete'],
): StructuredDecisionCompleter {
  return { isReady: async () => true, complete };
}

describe('callStructured deadline', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns timeout when the structured completer never settles', async () => {
    jest.useFakeTimers();
    const clear = jest.spyOn(global, 'clearTimeout');
    const pending = callStructured(
      {
        kind: 'structured',
        completer: completer(() => new Promise(() => undefined)),
        providerId: 'ollama',
        model: 'nimble',
        signal: new AbortController().signal,
      },
      'prompt',
      { type: 'object' },
      new Map(),
      [],
      quietLogger(),
    );

    await jest.advanceTimersByTimeAsync(BUDGET + 1);
    const outcome = await pending;

    expect(outcome).toMatchObject({
      sent: true,
      succeeded: false,
      requestCause: 'timeout',
      notFoundDetail: null,
    });
    expect(clear).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    clear.mockRestore();
  });
});
