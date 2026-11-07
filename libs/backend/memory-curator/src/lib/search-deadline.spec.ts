import { BudgetExceededError, remainingMs, withinBudget } from './search-deadline';

describe('search deadline budget', () => {
  afterEach(() => jest.useRealTimers());

  it('has no bound without a deadline', async () => {
    expect(remainingMs(undefined)).toBe(Infinity);
    await expect(withinBudget(Promise.resolve(7), Infinity, 'work')).resolves.toBe(7);
  });

  it('answers the work when it finishes inside the budget', async () => {
    jest.useFakeTimers();
    let release: (value: number) => void = () => undefined;
    const pending = withinBudget(new Promise<number>((resolve) => (release = resolve)), 1_000, 'work');
    jest.advanceTimersByTime(999);
    release(3);
    await expect(pending).resolves.toBe(3);
  });

  it('stops waiting at the budget and absorbs the late failure of the abandoned work', async () => {
    jest.useFakeTimers();
    let fail: (error: Error) => void = () => undefined;
    const work = new Promise<number>((_, reject) => (fail = reject));
    const pending = withinBudget(work, 100, 'vector search');
    jest.advanceTimersByTime(100);
    await expect(pending).rejects.toThrow(BudgetExceededError);
    await expect(pending).rejects.toThrow('vector search did not finish within 100 ms');
    // No unhandled rejection: the abandoned work already has a handler.
    fail(new Error('late'));
    await Promise.resolve();
  });

  it('rejects at once when no time is left', async () => {
    await expect(withinBudget(new Promise<number>(() => undefined), -5, 'rerank')).rejects.toThrow(
      'rerank did not finish within 0 ms',
    );
  });
});
