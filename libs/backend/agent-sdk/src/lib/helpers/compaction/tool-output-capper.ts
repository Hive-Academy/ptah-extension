/**
 * ToolOutputCapper — caps what a built-in or third-party tool hands back to
 * the model at `compaction.toolOutputBudgetTokens` (TASK_2026_597 A3,
 * component 18).
 *
 * Scope: `Bash`, `PowerShell`, `Grep`, `Read` and every MCP tool except
 * Ptah's own (`mcp__ptah__*`), whose server already budgets each answer with
 * the same engine. Any other tool passes through untouched.
 *
 * The rewrite is shape-preserving (AS9): only the text fields the model reads
 * change — Bash/PowerShell `stdout`/`stderr`, Grep `content`, Read
 * `file.content`, MCP `content[].text` — and every other field is copied as
 * is. A response of any other shape is returned unchanged.
 *
 * - Under the budget → the same response object, unchanged.
 * - A whole-file Read (no `offset`, no `limit`) over the budget → an outline
 *   (the code reducer over the optional {@link SDK_TOKENS.SDK_CODE_OUTLINER},
 *   the Markdown reducer for Markdown files, else the log reducer) and a
 *   trailer naming the file path and "read with offset/limit". Nothing is
 *   spooled: the file itself is the full copy.
 * - Everything else over the budget → `applyOutputBudget` (reduced form, cut
 *   to fit, raw text spooled under `<cwd>/.ptah/tmp/mcp-out/`, trailer naming
 *   the spool path).
 *
 * Several text fields of one response share the budget: a field that fits an
 * equal share keeps its raw text, and the rest of the budget is split equally
 * among the fields that do not.
 *
 * Failure: fail-open. Any error returns the original response unchanged and
 * logs one line naming the tool and the error type (never its message, which
 * can carry content or paths).
 */
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  applyOutputBudget,
  countTokensPiecewise,
  fitsBudget,
  fittingPrefixLength,
  reduceOutput,
  type CodeOutliner,
  type ContentKind,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import { SDK_TOKENS } from '../../di/tokens';
import { CompactionConfigProvider } from '../compaction-config-provider';

/** Chars per token used to derive the char ceiling from the token budget (as `tool-result-budget.ts`). */
const CHARS_PER_TOKEN = 4;
/** Tokens kept free where the outline and the Read trailer join. */
const BOUNDARY_TOKEN_SLACK = 8;
/** Separates a reduced body from its trailer. */
const TRAILER_SEPARATOR = '\n\n';
/** Longest file path a Read trailer prints; a longer one keeps its end. */
const MAX_TRAILER_PATH_CHARS = 512;
/** MCP tools whose server already budgets every answer. */
const PTAH_MCP_PREFIX = 'mcp__ptah__';
const MCP_PREFIX = 'mcp__';
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell']);
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.mdx',
  '.markdown',
]);
/** Error classes the failure line names; a custom `name` is arbitrary text and never printed. */
const LOGGED_ERROR_CLASSES: ReadonlyArray<readonly [string, ErrorConstructor]> =
  [
    ['TypeError', TypeError],
    ['RangeError', RangeError],
    ['SyntaxError', SyntaxError],
    ['ReferenceError', ReferenceError],
  ];

type JsonObject = Record<string, unknown>;

/** One text field of a response and the content kind its tool implies. */
interface TextSlot {
  readonly text: string;
  readonly hint?: ContentKind;
}

@injectable()
export class ToolOutputCapper {
  /** Reducer and budget-step diagnostics, routed to the logger. */
  private readonly reducerOutput: IOutputChannel;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly config: CompactionConfigProvider,
    // Optional: `registerSdkServices` passes it only when a host bound
    // `SDK_TOKENS.SDK_CODE_OUTLINER`.
    private readonly outliner?: CodeOutliner,
  ) {
    this.reducerOutput = {
      name: 'ToolOutputCapper',
      appendLine: (message: string) => this.logger.warn(message),
      append: (message: string) => this.logger.warn(message),
      clear: () => undefined,
      show: () => undefined,
      dispose: () => undefined,
    };
  }

  /** Whether `toolName` is one this capper rewrites. */
  static appliesTo(toolName: string): boolean {
    if (
      SHELL_TOOLS.has(toolName) ||
      toolName === 'Grep' ||
      toolName === 'Read'
    ) {
      return true;
    }
    return (
      toolName.startsWith(MCP_PREFIX) && !toolName.startsWith(PTAH_MCP_PREFIX)
    );
  }

  /**
   * The response to hand the model: `toolResponse` itself (same reference)
   * when nothing changed, else a copy of the same shape with its text fields
   * capped. Never throws.
   */
  async cap(
    toolName: string,
    toolInput: unknown,
    toolResponse: unknown,
    cwd: string,
  ): Promise<unknown> {
    if (!ToolOutputCapper.appliesTo(toolName)) {
      return toolResponse;
    }
    try {
      const budgetTokens = this.config.getConfig().toolOutputBudgetTokens;
      const budget: TextBudget = {
        tokens: budgetTokens,
        chars: budgetTokens * CHARS_PER_TOKEN,
      };
      return await this.capByShape(
        toolName,
        toolInput,
        toolResponse,
        cwd,
        budget,
      );
    } catch (error) {
      this.logger.warn(
        `[ToolOutputCapper] capping ${toolName} failed with ${errorName(error)}; passing the output through`,
      );
      return toolResponse;
    }
  }

  private async capByShape(
    toolName: string,
    toolInput: unknown,
    toolResponse: unknown,
    cwd: string,
    budget: TextBudget,
  ): Promise<unknown> {
    if (SHELL_TOOLS.has(toolName)) {
      return this.capFields(
        toolName,
        toolResponse,
        ['stdout', 'stderr'],
        cwd,
        budget,
      );
    }
    if (toolName === 'Grep') {
      return this.capFields(
        toolName,
        toolResponse,
        ['content'],
        cwd,
        budget,
        'log',
      );
    }
    if (toolName === 'Read') {
      return this.capRead(toolInput, toolResponse, cwd, budget);
    }
    return this.capMcp(toolName, toolResponse, cwd, budget);
  }

  /** Caps the named string fields of an object response; other shapes pass through. */
  private async capFields(
    toolName: string,
    toolResponse: unknown,
    keys: readonly string[],
    cwd: string,
    budget: TextBudget,
    hint?: ContentKind,
  ): Promise<unknown> {
    if (!isObject(toolResponse)) {
      return toolResponse;
    }
    const present = keys.filter((key) => typeof toolResponse[key] === 'string');
    if (present.length === 0) {
      return toolResponse;
    }
    const capped = await this.capSlots(
      toolName,
      present.map((key) => ({ text: toolResponse[key] as string, hint })),
      cwd,
      budget,
    );
    if (capped === null) {
      return toolResponse;
    }
    const next: JsonObject = { ...toolResponse };
    present.forEach((key, i) => {
      next[key] = capped[i];
    });
    return next;
  }

  /** MCP `content[].text`, for a bare block array or a `{ content: [...] }` result. */
  private async capMcp(
    toolName: string,
    toolResponse: unknown,
    cwd: string,
    budget: TextBudget,
  ): Promise<unknown> {
    const blocks = Array.isArray(toolResponse)
      ? toolResponse
      : isObject(toolResponse) && Array.isArray(toolResponse['content'])
        ? (toolResponse['content'] as unknown[])
        : null;
    if (blocks === null) {
      return toolResponse;
    }
    const textIndexes = blocks
      .map((block, i) => (isTextBlock(block) ? i : -1))
      .filter((i) => i >= 0);
    if (textIndexes.length === 0) {
      return toolResponse;
    }
    const capped = await this.capSlots(
      toolName,
      textIndexes.map((i) => ({ text: (blocks[i] as { text: string }).text })),
      cwd,
      budget,
    );
    if (capped === null) {
      return toolResponse;
    }
    const nextBlocks = blocks.slice();
    textIndexes.forEach((blockIndex, i) => {
      nextBlocks[blockIndex] = {
        ...(blocks[blockIndex] as JsonObject),
        text: capped[i],
      };
    });
    return Array.isArray(toolResponse)
      ? nextBlocks
      : { ...(toolResponse as JsonObject), content: nextBlocks };
  }

  /**
   * Read `file.content`. A whole-file read gets the outline and the
   * path trailer; a ranged read takes the generic reduce-and-spool path.
   */
  private async capRead(
    toolInput: unknown,
    toolResponse: unknown,
    cwd: string,
    budget: TextBudget,
  ): Promise<unknown> {
    if (!isObject(toolResponse) || !isObject(toolResponse['file'])) {
      return toolResponse;
    }
    const file = toolResponse['file'];
    const content = file['content'];
    if (typeof content !== 'string' || fitsBudget(content, budget)) {
      return toolResponse;
    }
    const input = isObject(toolInput) ? toolInput : {};
    const wholeFile =
      input['offset'] === undefined && input['limit'] === undefined;
    const filePath =
      typeof input['file_path'] === 'string'
        ? input['file_path']
        : typeof file['filePath'] === 'string'
          ? file['filePath']
          : '';
    let next: string | null;
    let describesReturnedText = false;
    if (wholeFile && filePath !== '') {
      next = await this.outlineWholeFile(content, filePath, budget);
      describesReturnedText = true;
    } else {
      const capped = await this.capSlots(
        'Read',
        [{ text: content }],
        cwd,
        budget,
      );
      next = capped === null ? null : capped[0];
    }
    if (next === null || next === content) {
      return toolResponse;
    }
    const nextFile: JsonObject = { ...file, content: next };
    if (describesReturnedText) {
      // The outline replaces the file text, so the metadata must describe the
      // returned text, not the file: it starts at 1 and has its own line
      // count. `totalLines` stays the real file length. Only keys the response
      // already had are touched.
      if ('startLine' in file) nextFile['startLine'] = 1;
      if ('numLines' in file) {
        // Outline lines only: the trailer is not part of the file's lines.
        const trailerAt = next.lastIndexOf(`${TRAILER_SEPARATOR}[outline: `);
        const outline =
          trailerAt >= 0
            ? next.slice(0, trailerAt)
            : next.startsWith('[outline: ')
              ? ''
              : next;
        const lines = outline.split('\n');
        if (outline.endsWith('\n')) lines.pop();
        nextFile['numLines'] = outline === '' ? 0 : lines.length;
      }
    }
    return { ...toolResponse, file: nextFile };
  }

  /**
   * The outline of an over-budget file plus a trailer naming the file and
   * "read with offset/limit", within `budget`. The body is reduced within the
   * room the trailer leaves, then cut at its end if a reducer returned more.
   */
  private async outlineWholeFile(
    content: string,
    filePath: string,
    budget: TextBudget,
  ): Promise<string> {
    const extension = path.extname(filePath).toLowerCase();
    const shownPath =
      filePath.length > MAX_TRAILER_PATH_CHARS
        ? `…${filePath.slice(-MAX_TRAILER_PATH_CHARS)}`
        : filePath;
    let hint: ContentKind = 'log';
    if (MARKDOWN_EXTENSIONS.has(extension)) {
      hint = 'markdown';
    } else if (this.outliner !== undefined && extension !== '') {
      hint = 'code';
    }
    const trailerFor = (
      reducer: string,
      shown: number,
      total: number,
    ): string =>
      `[outline: ${reducer} — showing ${shown} of ${total} tokens — full file: ` +
      `${shownPath} — line positions in this outline are not file line numbers; ` +
      `read with offset/limit for exact lines]`;

    const widest =
      TRAILER_SEPARATOR +
      trailerFor('code-fallback:log', 999_999_999, 999_999_999);
    const window: TextBudget = {
      tokens: Math.max(
        1,
        budget.tokens - countTokensPiecewise(widest) - BOUNDARY_TOKEN_SLACK,
      ),
      chars: Math.max(1, budget.chars - widest.length),
    };
    const reduced = await reduceOutput(content, {
      budgetTokens: window.tokens,
      budgetChars: window.chars,
      hint,
      languageHint: hint === 'code' ? extension : undefined,
      outliner: hint === 'code' ? this.outliner : undefined,
      output: this.reducerOutput,
    });
    const body = fitsBudget(reduced.text, window)
      ? reduced.text
      : reduced.text.slice(0, fittingPrefixLength(reduced.text, window));
    const trailer = trailerFor(
      reduced.reducer === 'none' ? 'cut' : reduced.reducer,
      countTokensPiecewise(body),
      reduced.rawTokens,
    );
    const joined =
      body === '' ? trailer : `${body}${TRAILER_SEPARATOR}${trailer}`;
    if (fitsBudget(joined, budget)) {
      return joined;
    }
    return fitsBudget(trailer, budget)
      ? trailer
      : trailer.slice(0, fittingPrefixLength(trailer, budget));
  }

  /**
   * The capped text of each slot, or `null` when every slot already fits.
   * Slots that fit an equal share of the budget keep their raw text; the
   * remaining budget is split equally among the others, each of which goes
   * through `applyOutputBudget` (reduce, cut, spool, trailer).
   */
  private async capSlots(
    toolName: string,
    slots: readonly TextSlot[],
    cwd: string,
    budget: TextBudget,
  ): Promise<string[] | null> {
    const measured = slots.map((slot, index) => ({
      slot,
      index,
      tokens: countTokensPiecewise(slot.text, budget.tokens + 1),
      chars: slot.text.length,
    }));
    const totalTokens = measured.reduce((sum, m) => sum + m.tokens, 0);
    const totalChars = measured.reduce((sum, m) => sum + m.chars, 0);
    if (totalTokens <= budget.tokens && totalChars <= budget.chars) {
      return null;
    }

    const shares = new Map<number, TextBudget>();
    let tokensLeft = budget.tokens;
    let charsLeft = budget.chars;
    const bySize = measured.slice().sort((a, b) => a.tokens - b.tokens);
    bySize.forEach((m, position) => {
      const remaining = bySize.length - position;
      const share: TextBudget = {
        tokens: Math.max(1, Math.floor(tokensLeft / remaining)),
        chars: Math.max(1, Math.floor(charsLeft / remaining)),
      };
      if (m.tokens <= share.tokens && m.chars <= share.chars) {
        tokensLeft -= m.tokens;
        charsLeft -= m.chars;
        return;
      }
      shares.set(m.index, share);
      tokensLeft -= share.tokens;
      charsLeft -= share.chars;
    });

    const results = await Promise.all(
      measured.map(async ({ slot, index }) => {
        const share = shares.get(index);
        if (share === undefined) {
          return slot.text;
        }
        const outcome = await applyOutputBudget({
          text: slot.text,
          budget: share,
          requestId: toolName,
          spoolRoot: cwd,
          reduce: (limit) =>
            reduceOutput(slot.text, {
              budgetTokens: limit.tokens,
              budgetChars: limit.chars,
              hint: slot.hint,
              output: this.reducerOutput,
            }),
          logLabel: `[ToolOutputCapper] ${toolName}`,
          output: this.reducerOutput,
        });
        return outcome.text;
      }),
    );
    return results.every((text, i) => text === slots[i].text) ? null : results;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    isObject(block) &&
    block['type'] === 'text' &&
    typeof block['text'] === 'string'
  );
}

/**
 * A fixed classification of `error`: a built-in error class name, `Error`, or
 * the `typeof`. Decided by `instanceof` only, so no getter of the error runs
 * (a throwing `name` getter cannot break the fail-open path).
 */
function errorName(error: unknown): string {
  for (const [name, ctor] of LOGGED_ERROR_CLASSES) {
    if (error instanceof ctor) {
      return name;
    }
  }
  return error instanceof Error ? 'Error' : typeof error;
}
