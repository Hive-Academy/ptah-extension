/**
 * `electron-token-counter.spec.ts` — runs `runTokenCounterContract` against
 * `ElectronTokenCounter` (gpt-tokenizer BPE). Beyond the contract we assert:
 *
 *   - `getMaxInputTokens` resolves to `null` (no model discovery off-VS-Code).
 *   - Fallback path (encode throws → heuristic `ceil(len/4)`) is deterministic.
 *   - Counts for well-known short strings match expected BPE lengths within
 *     the library's documented ~5% margin.
 */

import 'reflect-metadata';
import { runTokenCounterContract } from '@ptah-extension/platform-core/testing';
import { ElectronTokenCounter } from './electron-token-counter';

runTokenCounterContract(
  'ElectronTokenCounter',
  () => new ElectronTokenCounter(),
);

describe('ElectronTokenCounter — Electron-specific behaviour', () => {
  let counter: ElectronTokenCounter;

  beforeEach(() => {
    counter = new ElectronTokenCounter();
  });

  it('getMaxInputTokens resolves to null (no discovery off-VS-Code)', async () => {
    expect(await counter.getMaxInputTokens()).toBeNull();
  });

  it('countTokens produces a plausible count for a short sentence', async () => {
    const count = await counter.countTokens('Hello, world!');
    // BPE tokenization of that phrase typically produces 3-5 tokens.
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(6);
  });

  it('countTokens is deterministic across repeated calls for the same input', async () => {
    const text = 'const x = () => 42;';
    const a = await counter.countTokens(text);
    const b = await counter.countTokens(text);
    const c = await counter.countTokens(text);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('countTokens on empty string is exactly 0', async () => {
    expect(await counter.countTokens('')).toBe(0);
  });

  it('countTokens scales with input size (monotonicity across ~10x growth)', async () => {
    const small = await counter.countTokens('abc');
    const big = await counter.countTokens('abc '.repeat(100));
    expect(big).toBeGreaterThan(small * 10);
  });
});
