/**
 * Tool-result budget (TASK_2026_559, User Decisions 2 and 7).
 *
 * Every text result an MCP tool returns goes through
 * {@link applyToolResultBudget}, which applies this server's per-tool policy
 * to the shared output budget engine (`applyOutputBudget` in
 * `@ptah-extension/tool-output-reducers`, moved there by TASK_2026_597 D8):
 *
 * - the tool's budget: {@link TOOL_RESULT_BUDGET_OVERRIDES}, else the default
 *   of {@link DEFAULT_TOOL_RESULT_BUDGET_TOKENS} tokens and
 *   {@link DEFAULT_TOOL_RESULT_BUDGET_CHARS} chars;
 * - the content kind: the caller's hint, else {@link TOOL_CONTENT_HINTS},
 *   else sniffing;
 * - the JSON keys kept verbatim and first: {@link PRESERVED_RESULT_KEYS}.
 *
 * Under the budget the raw text comes back byte-for-byte; over it the engine
 * reduces, cuts, spools the raw text to `<spoolRoot>/.ptah/tmp/mcp-out/` and
 * appends a trailer, keeping the whole answer within both limits. It never
 * throws. See the engine's module header for the full contract.
 */
import type { IOutputChannel } from '@ptah-extension/platform-core';
import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  applyOutputBudget,
  reduceOutput,
  type CodeOutliner,
  type ContentKind,
  type OutputBudgetOutcome,
  type SpoolRequestId,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';

export {
  relativeSpoolLocator,
  spoolToolText,
  type SpoolOutcome,
} from '@ptah-extension/tool-output-reducers';

/** Default token budget: the token equivalent of User Decision 2's 8,000 chars (~4 chars/token). */
export const DEFAULT_TOOL_RESULT_BUDGET_TOKENS = 2000;
/** Default hard char ceiling; what `_meta['anthropic/maxResultSizeChars']` declares. */
export const DEFAULT_TOOL_RESULT_BUDGET_CHARS = 8000;

/** Chars per token used to express a char-denominated override in tokens. */
const CHARS_PER_TOKEN = 4;

/**
 * `formatBrowserContent` caps the page text at 32 KiB
 * (`mcp-response-formatter.ts`, `MAX_TEXT_LENGTH`); 1 KiB more covers its
 * Markdown header, fences and truncation marker. The text section comes
 * first, so the cut keeps the whole capped text.
 */
const BROWSER_CONTENT_CHARS = 32 * 1024 + 1024;

/**
 * `ptah_session_read` returns a transcript tail of 32 KiB of text by default
 * (`SESSION_READ_DEFAULT_TAIL_KIB` in cli-agent-runtime's
 * `session-spawner.service.ts`, which slices it to that many UTF-16 units).
 * The value is restated here, not imported: the cli-agent-runtime barrel
 * pulls tsyringe into every light consumer of this module, and
 * `session-tools.spec.ts` fails if the two drift apart. The default budget on
 * top holds the reply's header line and the held-completion block (one
 * `<agent-lane-completed>` envelope per child, at most
 * `agentSessions.maxConcurrent` live children), exactly the room any other
 * tool's whole answer gets. The held block comes before the transcript, so a
 * larger `tailKiB` (up to 256 KiB) is cut from the transcript's end and
 * spooled, never the held completions.
 */
const SESSION_READ_DEFAULT_TAIL_CHARS = 32 * 1024;
const SESSION_READ_CHARS =
  SESSION_READ_DEFAULT_TAIL_CHARS + DEFAULT_TOOL_RESULT_BUDGET_CHARS;

function charBudget(chars: number): TextBudget {
  return Object.freeze({ tokens: Math.ceil(chars / CHARS_PER_TOKEN), chars });
}

/**
 * Tools whose own description documents a larger bound. Nothing else is
 * overridden. `ptah_surface_get_state` promises that the whole answer stays
 * within `maxStateReadBytes` UTF-8 bytes; a UTF-16 length never exceeds the
 * UTF-8 byte length of the same text, so the byte bound is a valid char bound.
 */
export const TOOL_RESULT_BUDGET_OVERRIDES: Readonly<
  Record<string, TextBudget>
> = Object.freeze({
  ptah_browser_content: charBudget(BROWSER_CONTENT_CHARS),
  ptah_session_read: charBudget(SESSION_READ_CHARS),
  ptah_surface_get_state: charBudget(SURFACE_LIMITS.maxStateReadBytes),
});

/**
 * Tools whose formatter already owns a documented reduction: no content
 * reducer runs on them, only the cut (so the diagnostics requested-files-first
 * order of Batch 1 is never undone by a generic reducer). The paged tools keep
 * their own page unit.
 *
 * The `ptah_agent_*` tools return an agent's own curated reply under a short
 * Markdown header. The outline reducer would keep the header and drop the
 * reply's body (a 20 KB `agent_message` detail came back as 312 chars with no
 * detail), so their text is cut to a prefix instead, on the HTTP and the
 * stdio surface alike. The `ptah_session_*` tools follow the same rule.
 */
export const TOOL_CONTENT_HINTS: Readonly<Record<string, ContentKind>> =
  Object.freeze({
    ptah_get_diagnostics: 'preformatted',
    ptah_get_symbol_index: 'preformatted',
    ptah_agent_spawn: 'preformatted',
    ptah_agent_status: 'preformatted',
    ptah_agent_read: 'preformatted',
    ptah_agent_message: 'preformatted',
    ptah_agent_report: 'preformatted',
    ptah_agent_stop: 'preformatted',
    ptah_agent_list: 'preformatted',
    // Child sessions (TASK_2026_584): a short header, then a child's own
    // text (status lines, transcript tail, held completion envelopes) that
    // the outline reducer would drop.
    ptah_session_start: 'preformatted',
    ptah_session_send: 'preformatted',
    ptah_session_status: 'preformatted',
    ptah_session_read: 'preformatted',
    ptah_session_stop: 'preformatted',
    ptah_task_list: 'preformatted',
  });

/**
 * Top-level result keys the JSON reducer keeps verbatim and first (Batch
 * 24r): the status blocks of the language-bound tools. A reduced answer must
 * still show `coverage.clean` and every `null` (unknown) field, and a later
 * cut of the text reaches them last.
 */
export const PRESERVED_RESULT_KEYS: readonly string[] = Object.freeze([
  'coverage',
  'status',
  'index',
  'parseStatus',
]);

const DEFAULT_BUDGET: TextBudget = Object.freeze({
  tokens: DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  chars: DEFAULT_TOOL_RESULT_BUDGET_CHARS,
});

/** The budget of `toolName`: its override, else the default. */
export function getToolResultBudget(toolName: string): TextBudget {
  return Object.hasOwn(TOOL_RESULT_BUDGET_OVERRIDES, toolName)
    ? TOOL_RESULT_BUDGET_OVERRIDES[toolName]
    : DEFAULT_BUDGET;
}

export interface ApplyToolResultBudgetInput {
  /** The tool's formatted success text. */
  readonly text: string;
  readonly toolName: string;
  /** JSON-RPC id of the call; only names the spool file. */
  readonly requestId: SpoolRequestId;
  /**
   * Absolute directory the spool tree goes under (the caller's workspace
   * root, else the workspace root, else `os.tmpdir()`, resolved by the
   * caller). A relative or empty value falls back to `os.tmpdir()`.
   */
  readonly spoolRoot: string;
  /**
   * Content kind the caller knows for this text (the browser page's own
   * HTML); wins over {@link TOOL_CONTENT_HINTS} and over sniffing.
   */
  readonly hint?: ContentKind;
  /**
   * Language of the text when it is source code (a language id or extension,
   * e.g. `tsx`, `.py`), known to the caller from the tool's own input, never
   * guessed from the producer. The code reducer needs it to call `outliner`;
   * without it source takes the log fallback (Batch 29b r1 R29b-02).
   */
  readonly languageHint?: string;
  readonly outliner?: CodeOutliner;
  /** Receives one line when a reducer throws or the budget step fails. */
  readonly output?: IOutputChannel;
}

/** What the model gets, and how it was made (the engine's outcome). */
export type ToolResultBudgetOutcome = OutputBudgetOutcome;

export function applyToolResultBudget(
  input: ApplyToolResultBudgetInput,
): Promise<ToolResultBudgetOutcome> {
  const hint =
    input.hint ??
    (Object.hasOwn(TOOL_CONTENT_HINTS, input.toolName)
      ? TOOL_CONTENT_HINTS[input.toolName]
      : undefined);
  return applyOutputBudget({
    text: input.text,
    budget: getToolResultBudget(input.toolName),
    requestId: input.requestId,
    spoolRoot: input.spoolRoot,
    reduce: (limit) =>
      reduceOutput(input.text, {
        budgetTokens: limit.tokens,
        budgetChars: limit.chars,
        hint,
        preserveKeys: PRESERVED_RESULT_KEYS,
        languageHint: input.languageHint,
        outliner: input.outliner,
        output: input.output,
      }),
    logLabel: `[tool-result-budget] ${input.toolName}`,
    output: input.output,
  });
}
