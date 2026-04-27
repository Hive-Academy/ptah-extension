/**
 * Stop-intent detector (Wave C7e cleanup pass 2).
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

  // Standalone stop words (entire message is just a stop command)
  // [.!]* allows multiple punctuation: "stop!!!", "cancel!!", "abort."
  if (
    /^(stop|cancel|abort|halt|quit|enough|nevermind|nvm)[.!]*$/.test(trimmed)
  ) {
    return true;
  }

  // Short messages (≤60 chars) with clear stop phrases.
  // Length gate avoids false positives in longer steering messages like
  // "stop using semicolons and switch to the new API pattern".
  if (trimmed.length <= 60) {
    const stopPhrases = [
      // "stop", "please stop", "stop now", "stop it", etc. — must be at end of message
      /\b(please\s+)?(stop|cancel|abort|halt)\s*(please|now|it|this|that|execution|running|everything|immediately)?[.!]*$/,
      // "stop what you're doing"
      /\bstop\s+what\s+you'?re?\s+(doing|running)/,
      // "don't continue" — must be at end to avoid "don't continue with X, do Y instead"
      /\bdon'?t\s+continue[.!]*$/,
      // "stop the execution/agent/process"
      /\bstop\s+the\s+(execution|agent|process|task)/,
    ];
    return stopPhrases.some((pattern) => pattern.test(trimmed));
  }

  return false;
}
