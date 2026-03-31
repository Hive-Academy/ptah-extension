/**
 * ITokenCounter - Platform-agnostic token counting interface.
 *
 * Replaces: vscode.lm.selectChatModels() -> model.countTokens()
 *
 * VS Code: Uses native VS Code LM API for accurate model-specific counting.
 * Electron/Other: Uses gpt-tokenizer npm package for BPE tokenization.
 */
export interface ITokenCounter {
  /**
   * Count tokens in the given text.
   *
   * @param text - Text to tokenize
   * @returns Token count
   */
  countTokens(text: string): Promise<number>;

  /**
   * Get the maximum input token count for the active model.
   *
   * @returns Max input tokens, or null if unknown
   */
  getMaxInputTokens(): Promise<number | null>;
}
