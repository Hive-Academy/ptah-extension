/**
 * Context Enrichment Service
 *
 * Generates .d.ts-style structural summaries of TypeScript/JavaScript files to
 * reduce token usage without losing API surface. Summaries are produced only
 * for declaration-only files: every top-level declaration is kept with its
 * signature and its bodies elided (see `declaration-summary.ts`). Any other
 * file — load-time code, CommonJS or global exports, prototype or reflection
 * writes, initialisers that are not functions or literals — gets the full
 * content with a `reason` instead.
 *
 * @module libs/backend/workspace-intelligence/context-analysis
 */

import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { SupportedLanguage } from '../ast/ast.types';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { parserFailureReason } from '../ast/parser-refusal';
import { hasCapability } from '../ast/language-registry';
import { TokenCounterService } from '../services/token-counter.service';
import { FileSystemService } from '../services/file-system.service';
import {
  DECLARATION_SUMMARY_QUERIES,
  summariseDeclarations,
} from './declaration-summary';

/**
 * Result of generating a structural summary for a file.
 *
 * Every result is built with `content` as its LAST key: an MCP tool serialises
 * the result with `JSON.stringify` and a result over the tool budget is cut at
 * its end, so `mode` and `reason` must come before the (possibly huge) content
 * to survive the cut.
 */
export interface StructuralSummaryResult {
  /** Whether this is a structural summary or full content fallback */
  mode: 'structural' | 'full';
  /**
   * Why a `mode: 'full'` result was returned instead of a summary; absent on
   * `mode: 'structural'`. Distinguishes "no summary was attempted" from "a
   * summary was attempted and failed":
   * - `unsupported-language`: the registry grants the language no
   *   `enrichSummary` (only TypeScript, JavaScript and TSX have it), or none
   *   was given, so no parse was attempted;
   * - `parse-failed`: the parse failed or needed error recovery (an ERROR or
   *   MISSING node, e.g. JSX parsed with the TypeScript grammar), so a
   *   summary could omit declarations;
   * - `grammar-unavailable`: the parser refused before parsing because the
   *   language's grammar (or the parser runtime) could not load on this host;
   * - `too-large`: the parser refused a source over 1 MiB before parsing;
   * - `unsupported-declarations`: the file is not declaration-only: a
   *   top-level statement other than an import/export or a declaration, an
   *   initialiser that is not a function or a literal, code that runs while
   *   the module loads, a runtime export channel (`exports`, `module`,
   *   `globalThis`, `window`, `self`, `global`, `prototype`,
   *   `Object.assign` / `defineProperty` / `setPrototypeOf`) anywhere, or a
   *   large literal that is not pure data;
   * - `no-declarations`: the file is not empty but declares nothing a
   *   summary would keep (only comments or imports);
   * - `summary-not-smaller`: the summary would cost at least as many tokens
   *   as the file (e.g. a .d.ts file);
   * - `read-failed`: the file could not be read (`content` is empty).
   */
  reason?:
    | 'unsupported-language'
    | 'parse-failed'
    | 'grammar-unavailable'
    | 'too-large'
    | 'unsupported-declarations'
    | 'no-declarations'
    | 'summary-not-smaller'
    | 'read-failed';
  /** Token count of the summary/content returned */
  tokenCount: number;
  /** Token count of the original full content */
  originalTokenCount: number;
  /** Percentage reduction in tokens (0-100) */
  reductionPercentage: number;
  /** The summary content (either structural declaration or full content) */
  content: string;
}

/** Why a full-content fallback was returned; see {@link StructuralSummaryResult.reason}. */
type FullContentReason = NonNullable<StructuralSummaryResult['reason']>;

/**
 * Context Enrichment Service
 *
 * Produces compact .d.ts-style structural summaries of TypeScript/JavaScript
 * declaration-only files from one tree-sitter parse. Falls back to full
 * content, with a reason, whenever the summary could not be guaranteed
 * complete.
 */
@injectable()
export class ContextEnrichmentService {
  constructor(
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly parser: TreeSitterParserService,
    @inject(TOKENS.TOKEN_COUNTER_SERVICE)
    private readonly tokenCounter: TokenCounterService,
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Generate a structural summary for a file.
   *
   * Reads the file (or uses provided content), parses it once, and produces a
   * .d.ts-style declaration summary. Returns the full content with a `reason`
   * instead whenever the summary could drop API: a language without the
   * registry's `enrichSummary` capability, a failed or error-recovered parse,
   * a file that is not declaration-only, nothing to summarise, or a summary
   * that costs no fewer tokens than the file.
   *
   * @param filePath - Absolute path to the source file
   * @param language - The file's language; only languages granted `enrichSummary` ('typescript', 'javascript', 'tsx') are summarised
   * @param fullContent - Optional pre-read file content to avoid redundant I/O
   * @returns Structural summary result with token metrics
   */
  async generateStructuralSummary(
    filePath: string,
    language: SupportedLanguage | undefined,
    fullContent?: string,
  ): Promise<StructuralSummaryResult> {
    let content: string;
    if (fullContent !== undefined) {
      content = fullContent;
    } else {
      try {
        content = await this.fileSystem.readFile(filePath);
      } catch {
        this.logger.error(
          'ContextEnrichmentService.generateStructuralSummary() - Failed to read the file; returning an empty full-content result (reason: read-failed)',
        );
        return this.createFullContentResult('', 'read-failed', 0);
      }
    }
    if (!content.trim()) {
      this.logger.debug(
        `ContextEnrichmentService.generateStructuralSummary() - Empty file: ${filePath}`,
      );
      const emptyHeader = `// Structural summary: ${this.toRelativePath(
        filePath,
      )}\n// Empty file\n`;
      const [headerTokens, originalTokens] = await Promise.all([
        this.tokenCounter.countTokens(emptyHeader),
        this.tokenCounter.countTokens(content),
      ]);
      return {
        mode: 'structural',
        tokenCount: headerTokens,
        originalTokenCount: originalTokens,
        reductionPercentage: this.calcReduction(originalTokens, headerTokens),
        content: emptyHeader,
      };
    }
    if (language === undefined || !hasCapability(language, 'enrichSummary')) {
      this.logger.debug(
        'ContextEnrichmentService.generateStructuralSummary() - Language without a structural summary; returning full content (reason: unsupported-language)',
      );
      return this.createFullContentResult(content, 'unsupported-language');
    }
    const matchesResult = await this.parser.queryMulti(content, language, [
      ...DECLARATION_SUMMARY_QUERIES,
    ]);
    if (matchesResult.isErr() || !matchesResult.value) {
      // A parser refusal keeps its own reason; anything else is a parse failure.
      const failure = parserFailureReason(matchesResult.error);
      const reason: FullContentReason =
        failure === 'grammar-unavailable' || failure === 'too-large'
          ? failure
          : 'parse-failed';
      this.logger.warn(
        `ContextEnrichmentService.generateStructuralSummary() - Parse failed; returning full content (reason: ${reason})`,
      );
      return this.createFullContentResult(content, reason);
    }

    const summary = summariseDeclarations(
      content,
      matchesResult.value,
      this.toRelativePath(filePath),
    );
    if (summary.kind === 'syntax-errors') {
      this.logger.warn(
        'ContextEnrichmentService.generateStructuralSummary() - Parse needed error recovery; returning full content (reason: parse-failed)',
      );
      return this.createFullContentResult(content, 'parse-failed');
    }
    if (summary.kind !== 'summary') {
      this.logger.debug(
        `ContextEnrichmentService.generateStructuralSummary() - No complete summary; returning full content (reason: ${summary.kind})`,
      );
      return this.createFullContentResult(content, summary.kind);
    }
    const declaration = summary.text;
    // Characters are an early rejection; tokens decide (a summary with fewer
    // characters can still cost more tokens, e.g. a whitespace-heavy body).
    const counts =
      declaration.length < content.length
        ? await Promise.all([
            this.tokenCounter.countTokens(declaration),
            this.tokenCounter.countTokens(content),
          ])
        : undefined;
    if (counts === undefined || counts[0] >= counts[1]) {
      this.logger.debug(
        'ContextEnrichmentService.generateStructuralSummary() - Summary is not smaller than the file; returning full content (reason: summary-not-smaller)',
      );
      return this.createFullContentResult(
        content,
        'summary-not-smaller',
        counts?.[1],
      );
    }
    const [summaryTokens, originalTokens] = counts;

    return {
      mode: 'structural',
      tokenCount: summaryTokens,
      originalTokenCount: originalTokens,
      reductionPercentage: this.calcReduction(originalTokens, summaryTokens),
      content: declaration,
    };
  }

  /**
   * Create a full-content fallback result carrying why no summary was returned.
   */
  private async createFullContentResult(
    content: string,
    reason: FullContentReason,
    precomputedTokenCount?: number,
  ): Promise<StructuralSummaryResult> {
    const tokenCount =
      precomputedTokenCount ?? (await this.tokenCounter.countTokens(content));
    return {
      mode: 'full',
      reason,
      tokenCount,
      originalTokenCount: tokenCount,
      reductionPercentage: 0,
      content,
    };
  }

  /**
   * Calculate reduction percentage.
   */
  private calcReduction(original: number, reduced: number): number {
    if (original <= 0) {
      return 0;
    }
    return Math.round(((original - reduced) / original) * 100);
  }

  /**
   * Convert an absolute file path to a workspace-relative path for display.
   *
   * AUDIT VERDICT — TASK_2026_200, task 3.5: this reads the raw, process-global
   * `IWorkspaceProvider` rather than a session-scoped root, but it is
   * **display-string only and deliberately left as-is**. The value never
   * selects, filters or reads a file: it only shortens an already-resolved
   * absolute path for a token-reduction summary, and when the root does not
   * match it degrades to the harmless 3-segment tail below. A wrong root here
   * produces a slightly longer label, never another workspace's contents — so
   * it is NOT in the silent-wrong-answer defect class the task targets.
   * Rewriting it is explicitly out of scope (tasks.md "Out of scope — do not
   * implement"). Please do not re-litigate this without new evidence that a
   * caller consumes the string as a lookup key rather than as a label.
   */
  private toRelativePath(filePath: string): string {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot) {
      const normalizedFile = filePath.replace(/\\/g, '/');
      const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
      if (normalizedFile.startsWith(normalizedRoot)) {
        const relative = normalizedFile.slice(normalizedRoot.length);
        return relative.startsWith('/') ? relative.slice(1) : relative;
      }
    }
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.slice(-3).join('/');
  }
}
