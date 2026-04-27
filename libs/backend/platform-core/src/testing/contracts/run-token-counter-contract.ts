/**
 * `runTokenCounterContract` — behavioural contract for `ITokenCounter`.
 *
 * Impls vary wildly in accuracy (VS Code native LM, gpt-tokenizer BPE, simple
 * whitespace), so the contract only asserts invariants that every plausible
 * tokenizer must satisfy: non-negative counts, monotonicity under
 * concatenation, and numeric-or-null max limit.
 */

import type { ITokenCounter } from '../../interfaces/token-counter.interface';

export function runTokenCounterContract(
  name: string,
  createProvider: () => Promise<ITokenCounter> | ITokenCounter,
  teardown?: () => Promise<void> | void,
): void {
  describe(`ITokenCounter contract — ${name}`, () => {
    let counter: ITokenCounter;

    beforeEach(async () => {
      counter = await createProvider();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('countTokens on empty string resolves to 0', async () => {
      expect(await counter.countTokens('')).toBe(0);
    });

    it('countTokens on single word resolves to a positive integer', async () => {
      const count = await counter.countTokens('hello');
      expect(count).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(count)).toBe(true);
    });

    it('countTokens is monotonic: more text never decreases count', async () => {
      const a = await counter.countTokens('hello');
      const b = await counter.countTokens('hello world goodbye world');
      expect(b).toBeGreaterThanOrEqual(a);
    });

    it('countTokens is pure: repeated calls return the same value', async () => {
      const first = await counter.countTokens('deterministic input');
      const second = await counter.countTokens('deterministic input');
      expect(first).toBe(second);
    });

    it('getMaxInputTokens resolves to a positive number or null', async () => {
      const max = await counter.getMaxInputTokens();
      if (max !== null) {
        expect(Number.isFinite(max)).toBe(true);
        expect(max).toBeGreaterThan(0);
      }
    });

    it('countTokens never returns a negative number', async () => {
      const count = await counter.countTokens('\n\t\t  ');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('countTokens handles multi-byte / emoji input without throwing', async () => {
      await expect(counter.countTokens('hello — 🌍')).resolves.toBeGreaterThan(
        0,
      );
    });
  });
}
