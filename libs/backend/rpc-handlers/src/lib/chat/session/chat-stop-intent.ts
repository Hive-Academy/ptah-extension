/**
 * Stop-intent detector.
 *
 * Free function extracted from `ChatRpcHandlers.hasStopIntent` so that
 * `ChatSessionService` can use it without taking a callback dependency on
 * the handler. The handler keeps a `static hasStopIntent` shim that
 * delegates here so any breadcrumbs / external callers referencing
 * `ChatRpcHandlers.hasStopIntent` keep working.
 *
 * The regex set is byte-identical to the pre-extraction handler version.
 */

/**
 * Detect clear stop/cancel intent in a user message.
 *
 * Used in autopilot mode to decide whether to interrupt the current turn.
 * Conservative matching — only triggers on unambiguous stop phrases to avoid
 * false positives on steering messages like "stop using semicolons" or
 * "cancel the old approach and try X instead".
 *
 * Patterns matched:
 * - Standalone commands: "stop", "cancel", "abort", "halt", "quit"
 * - Polite variants: "please stop", "stop please", "stop now"
 * - Targeted: "stop it", "stop this", "stop that", "stop execution"
 * - Descriptive: "stop what you're doing", "don't continue"
 */
export function hasStopIntent(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (
    /^(stop|cancel|abort|halt|quit|enough|nevermind|nvm)[.!]*$/.test(trimmed)
  ) {
    return true;
  }
  if (trimmed.length <= 60) {
    const stopPhrases = [
      /\b(please\s+)?(stop|cancel|abort|halt)\s*(please|now|it|this|that|execution|running|everything|immediately)?[.!]*$/,
      /\bstop\s+what\s+you'?re?\s+(doing|running)/,
      /\bdon'?t\s+continue[.!]*$/,
      /\bstop\s+the\s+(execution|agent|process|task)/,
    ];
    return stopPhrases.some((pattern) => pattern.test(trimmed));
  }

  return false;
}
