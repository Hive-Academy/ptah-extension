/**
 * Batch 33's activation fragment: Python and Go dependency graphs and public
 * symbols (`import-resolution/python-import-resolver.ts`,
 * `import-resolution/go-import-resolver.ts`, the export queries of
 * `languages/python.language.ts` and `languages/go.language.ts`).
 *
 * Every key below is proved by an executing check in `HONESTY_CHECKS`
 * (`language-honesty.contract.spec.ts`), on the real parser and the real
 * `DependencyGraphService`:
 * - `graphEdges:python` — the python-app fixture's known edge is found,
 *   `os` counts external, nothing is unresolved; a missing relative module
 *   is counted `unresolvedInternal` and the answer is not clean;
 * - `graphEdges:go` — with a `go.mod`, a workspace package import links
 *   every non-`_test.go` file of the package and the coverage discloses
 *   `go:package-edges`;
 * - `publicSymbols:python|go` — module-level public declarations are
 *   exports (a private name never is) and reach the graph's symbol index.
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b33',
  keys: [
    'graphEdges:python',
    'publicSymbols:python',
    'graphEdges:go',
    'publicSymbols:go',
  ],
  /** A Go import names a package; its edges go to every file of it. */
  approximations: {
    'graphEdges:go': ['go:package-edges'],
  },
};
