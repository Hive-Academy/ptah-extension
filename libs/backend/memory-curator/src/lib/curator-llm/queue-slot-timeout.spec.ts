/**
 * Recognising an internal-query queue timeout through the wrapper the curator
 * adapter puts around it — TASK_2026_376 F4.
 */
import {
  isQueueSlotTimeout,
  QueueSlotRetryBudget,
  QUEUE_SLOT_TIMEOUT_ERROR_NAME,
  CURATOR_QUEUE_RETRY_BUDGET,
} from './queue-slot-timeout';

function queueTimeout(): Error {
  const error = new Error(
    'Internal query waited longer than 60000ms for a concurrency slot.',
  );
  error.name = QUEUE_SLOT_TIMEOUT_ERROR_NAME;
  return error;
}

describe('isQueueSlotTimeout', () => {
  it('recognises the error itself', () => {
    expect(isQueueSlotTimeout(queueTimeout())).toBe(true);
  });

  it('recognises it through the curator adapter wrapper', () => {
    // Exactly what `SdkInternalQueryCuratorLlm.runQuery` throws.
    const wrapped = new Error(
      'The memory curator could not complete its language-model query.',
      { cause: queueTimeout() },
    );
    wrapped.name = 'CuratorLlmQueryError';

    expect(isQueueSlotTimeout(wrapped)).toBe(true);
  });

  it('does not mistake another failure for congestion', () => {
    expect(isQueueSlotTimeout(new Error('provider returned 500'))).toBe(false);
    expect(
      isQueueSlotTimeout(
        new Error('outer', { cause: new Error('inner, unrelated') }),
      ),
    ).toBe(false);
    expect(isQueueSlotTimeout('a string')).toBe(false);
    expect(isQueueSlotTimeout(undefined)).toBe(false);
  });

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(isQueueSlotTimeout(a)).toBe(false);
  });
});

describe('QueueSlotRetryBudget', () => {
  it('spends the default allowance and then refuses', () => {
    const budget = new QueueSlotRetryBudget();

    for (let i = 0; i < CURATOR_QUEUE_RETRY_BUDGET; i++) {
      expect(budget.tryConsume()).toBe(true);
    }

    expect(budget.tryConsume()).toBe(false);
    expect(budget.spent).toBe(CURATOR_QUEUE_RETRY_BUDGET);
  });

  it('is ONE allowance shared by every query of a pass', () => {
    const budget = new QueueSlotRetryBudget(1);

    expect(budget.tryConsume()).toBe(true);
    // A second call site asking the same object gets the refusal, which is the
    // property that stops a pass waiting `budget × queries` times.
    expect(budget.tryConsume()).toBe(false);
  });
});
