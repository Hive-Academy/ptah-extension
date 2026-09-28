/**
 * Batch 34's activation fragment (Task 34.1 only, User Decision 27): the C#
 * dependency graph and public symbols
 * (`import-resolution/csharp-import-resolver.ts`,
 * `import-resolution/csharp-context.ts`, `csharp-public-symbols.ts` and the
 * export query of `languages/csharp.language.ts`). Task 34.2 (Java) is
 * deferred: `graphEdges:java` and `publicSymbols:java` stay unactivated.
 *
 * Every key below is proved by an executing check in `HONESTY_CHECKS`
 * (`language-honesty.contract.spec.ts`), on the real parser and the real
 * `DependencyGraphService`:
 * - `graphEdges:csharp` — `using N` links every file declaring namespace N
 *   and the coverage discloses `csharp:namespace-edges`; a `global using`
 *   reaches the other files of its project; `System` counts external; a
 *   missing workspace namespace is `unresolvedInternal`; Java and Kotlin
 *   files beside it are counted unsupported and the answer is not clean;
 * - `publicSymbols:csharp` — `public` declarations are exports (an
 *   `internal` or `private` one never is) and reach the graph's symbol index.
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b34',
  keys: ['graphEdges:csharp', 'publicSymbols:csharp'],
  /** A `using` names a namespace; its edges go to every file declaring it. */
  approximations: {
    'graphEdges:csharp': ['csharp:namespace-edges'],
  },
};
