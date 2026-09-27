/**
 * Batch 31's activation fragment: PHP, Ruby and C++ get their grammars
 * (`languages/php.language.ts`, `languages/ruby.language.ts`,
 * `languages/cpp.language.ts`; `tree-sitter-php.wasm`,
 * `tree-sitter-ruby.wasm`, `tree-sitter-cpp.wasm`). C has no grammar of its
 * own: `.c` and `.h` are `cpp` (User Decision 19), so every cpp key is proved
 * on a real `.c`, a real `.h` and a real `.cpp` file.
 *
 * Every key below is proved by an executing check:
 * - `parse:php|ruby|cpp` — `HONESTY_CHECKS` in
 *   `language-honesty.contract.spec.ts`: the real parser analyses the file
 *   (PHP inside HTML; each of the three C/C++ files) with `parseStatus: 'ok'`
 *   and finds its declarations, and a broken file (for C: valid C the C++
 *   grammar rejects) is not `ok`;
 * - `outline:php|ruby|cpp` — `MCP_HONESTY_CHECKS` in vscode-lm-tools
 *   `mcp-language-coverage.spec.ts` (listed in `CHECKED_ELSEWHERE`): the
 *   real `TreeSitterCodeOutliner` outlines each file instead of refusing,
 *   directly and through the real dispatcher, and refuses a broken one;
 * - `codeIndex:php|ruby|cpp` — `HONESTY_CHECKS`: the real
 *   `CodeSymbolIndexer` stores the declarations under distinct subjects and
 *   counts the file as analysed; a `.c`/`.h` answer names
 *   `c:parsed-as-cpp` and a `.cpp` one does not;
 * - `syntaxDiagnostics:php|ruby|cpp` — `HONESTY_CHECKS`: the real
 *   `LanguageAwareDiagnosticsProvider` reports a syntax error in a broken
 *   file and discloses `<id>:syntax-only` (and, for a `.c` file,
 *   `c:parsed-as-cpp`).
 *
 * `publicSymbols` and `graphEdges` stay off (Batch 36).
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b31',
  keys: [
    'parse:php',
    'outline:php',
    'codeIndex:php',
    'syntaxDiagnostics:php',
    'parse:ruby',
    'outline:ruby',
    'codeIndex:ruby',
    'syntaxDiagnostics:ruby',
    'parse:cpp',
    'outline:cpp',
    'codeIndex:cpp',
    'syntaxDiagnostics:cpp',
  ],
  /**
   * The syntax check is Tier 0 (a parse, no compiler), as for py/go/cs and
   * java/rust. C sources are parsed with the C++ grammar, so every cpp key
   * carries `c:parsed-as-cpp`.
   */
  approximations: {
    'syntaxDiagnostics:php': ['syntax-only'],
    'syntaxDiagnostics:ruby': ['syntax-only'],
    'parse:cpp': ['c:parsed-as-cpp'],
    'outline:cpp': ['c:parsed-as-cpp'],
    'codeIndex:cpp': ['c:parsed-as-cpp'],
    'syntaxDiagnostics:cpp': ['syntax-only', 'c:parsed-as-cpp'],
  },
};
