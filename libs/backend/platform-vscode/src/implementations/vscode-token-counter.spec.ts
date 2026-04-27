/**
 * `VscodeTokenCounter` — contract against the shared `ITokenCounter` suite.
 *
 * Production flow prefers VS Code's `lm.selectChatModels` output when
 * available, falling back to `gpt-tokenizer`. For tests the mock returns an
 * empty model list by default so the fallback path (which is deterministic)
 * exercises the contract. A dedicated block seeds a scripted model to assert
 * the selectChatModels branch.
 */

import 'reflect-metadata';
import { runTokenCounterContract } from '@ptah-extension/platform-core/testing';
import { VscodeTokenCounter } from './vscode-token-counter';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runTokenCounterContract('VscodeTokenCounter', () => new VscodeTokenCounter());

describe('VscodeTokenCounter — VS Code-specific behaviour', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('prefers vscode.lm.selectChatModels when a model is available', async () => {
    __vscodeState.setChatModels([
      {
        countTokens: jest.fn(async (text: string) => text.length * 7),
        maxInputTokens: 128_000,
      },
    ]);
    const counter = new VscodeTokenCounter();
    // "hello" -> 5 * 7 = 35 via the seeded model (not gpt-tokenizer).
    expect(await counter.countTokens('hello')).toBe(35);
  });

  it('getMaxInputTokens returns the model limit when lm provides a model', async () => {
    __vscodeState.setChatModels([
      {
        countTokens: async () => 0,
        maxInputTokens: 200_000,
      },
    ]);
    const counter = new VscodeTokenCounter();
    expect(await counter.getMaxInputTokens()).toBe(200_000);
  });

  it('getMaxInputTokens returns null when no lm models are available', async () => {
    // Default: empty model list.
    const counter = new VscodeTokenCounter();
    expect(await counter.getMaxInputTokens()).toBeNull();
  });
});
