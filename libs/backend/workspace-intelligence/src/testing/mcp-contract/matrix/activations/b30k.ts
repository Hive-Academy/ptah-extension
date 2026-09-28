/**
 * Batch 30k's activation fragment: Kotlin gets its grammar
 * (`languages/kotlin.language.ts`; the vendored
 * `assets/tree-sitter/tree-sitter-kotlin.wasm`,
 * `@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0, provenance in
 * `assets/tree-sitter/PROVENANCE.kotlin.json`). `.kt` and `.kts` are both
 * Kotlin.
 *
 * Every key below is proved by an executing check on real Kotlin:
 * - `parse:kotlin` — `HONESTY_CHECKS` in `language-honesty.contract.spec.ts`:
 *   the real parser analyses a `.kt` file with `parseStatus: 'ok'` and finds
 *   its declarations, and a broken file is not `ok`;
 * - `outline:kotlin` — `MCP_HONESTY_CHECKS` in vscode-lm-tools
 *   `mcp-language-coverage.spec.ts` (listed in `CHECKED_ELSEWHERE`): the real
 *   `TreeSitterCodeOutliner` outlines the file instead of refusing, directly
 *   and through the real dispatcher, and refuses a broken one;
 * - `codeIndex:kotlin` — `HONESTY_CHECKS`: the real `CodeSymbolIndexer`
 *   stores the declarations under distinct subjects (same-named members of
 *   two classes included) and counts the file as analysed;
 * - `syntaxDiagnostics:kotlin` — `HONESTY_CHECKS`: the real
 *   `LanguageAwareDiagnosticsProvider` reports a syntax error in a broken
 *   file and discloses `kotlin:syntax-only`.
 *
 * There is no `publicSymbols:kotlin` or `graphEdges:kotlin` key: Kotlin graph
 * support is not required (User Decision 19).
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b30k',
  keys: [
    'parse:kotlin',
    'outline:kotlin',
    'codeIndex:kotlin',
    'syntaxDiagnostics:kotlin',
  ],
  /** The syntax check is Tier 0 (a parse, no compiler), as for java/rust. */
  approximations: {
    'syntaxDiagnostics:kotlin': ['syntax-only'],
  },
};
