/**
 * Contract shared by every tool-output reducer (TASK_2026_559, User Decision 7).
 *
 * A reducer is a pure, deterministic function: the same input and context
 * always produce the same output, it performs no I/O and it does not log.
 * The pipeline that selects and runs reducers owns spooling and logging.
 */

/**
 * The content family a tool result belongs to. `preformatted` marks output
 * whose formatter already owns a documented reduction (for example the
 * diagnostics list); no content reducer runs on it, only the final cut.
 */
export type ContentKind =
  'html' | 'json' | 'log' | 'code' | 'markdown' | 'text' | 'preformatted';

export interface ReduceContext {
  /** Token budget the reduced text should fit in (gpt-tokenizer count). */
  readonly budgetTokens: number;
  /**
   * Char budget (`string.length`) the reduced text should fit in, when the
   * caller has one. Reducers that fit a budget honour it with the tokens.
   */
  readonly budgetChars?: number;
  /** Source language or file extension of the content, when the caller knows it. */
  readonly languageHint?: string;
  /** Symbol the caller cares about most; reducers that can keep it in full should. */
  readonly focusSymbol?: string;
  /**
   * Top-level object keys whose values a structured reducer keeps verbatim
   * (no empty-field dropping, no table rendering) and places first, in this
   * order. Status blocks a caller must never lose to reduction go here.
   * Reducers for unstructured content ignore it.
   */
  readonly preserveKeys?: readonly string[];
}

export interface ReduceResult {
  /** The reduced text. */
  readonly text: string;
  /** Name of the reducer that produced `text`, shown in the result trailer. */
  readonly reducer: string;
  /** Short remarks about what was dropped or which fallback ran. */
  readonly notes?: string[];
}

export type OutputReducer = (input: string, ctx: ReduceContext) => ReduceResult;

/**
 * A reducer that waits on an injected collaborator (the code outliner, whose
 * parser loads its grammars asynchronously). Same input/output contract as
 * {@link OutputReducer}; a caller that `await`s the result handles both.
 */
export type AsyncOutputReducer = (
  input: string,
  ctx: ReduceContext,
) => Promise<ReduceResult>;
