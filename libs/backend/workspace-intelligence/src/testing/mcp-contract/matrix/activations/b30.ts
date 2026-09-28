/**
 * Batch 30's activation fragment: Java and Rust get their grammars
 * (`languages/java.language.ts`, `languages/rust.language.ts`;
 * `tree-sitter-java.wasm`, `tree-sitter-rust.wasm`).
 *
 * Every key below is proved by an executing check on real Java and Rust:
 * - `parse:java|rust` — `HONESTY_CHECKS` in
 *   `language-honesty.contract.spec.ts`: the real parser analyses a file with
 *   `parseStatus: 'ok'` and finds its declarations, and a broken file is not
 *   `ok`;
 * - `outline:java|rust` — `MCP_HONESTY_CHECKS` in vscode-lm-tools
 *   `mcp-language-coverage.spec.ts` (the outliner lives in that project,
 *   which this one may not import; listed in `CHECKED_ELSEWHERE`): the real
 *   `TreeSitterCodeOutliner` outlines the file instead of refusing, directly
 *   and through the real dispatcher;
 * - `codeIndex:java|rust` — `HONESTY_CHECKS`: the real `CodeSymbolIndexer`
 *   stores the declarations and counts the file as analysed, not
 *   unsupported;
 * - `syntaxDiagnostics:java|rust` — `HONESTY_CHECKS`: the real
 *   `LanguageAwareDiagnosticsProvider` reports a syntax error in a broken
 *   file and discloses `<id>:syntax-only`.
 *
 * `publicSymbols` and `graphEdges` stay off (Batches 34 and 35).
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b30',
  keys: [
    'parse:java',
    'outline:java',
    'codeIndex:java',
    'syntaxDiagnostics:java',
    'parse:rust',
    'outline:rust',
    'codeIndex:rust',
    'syntaxDiagnostics:rust',
  ],
  /** The syntax check is Tier 0 (a parse, no compiler), as for py/go/cs. */
  approximations: {
    'syntaxDiagnostics:java': ['syntax-only'],
    'syntaxDiagnostics:rust': ['syntax-only'],
  },
};
