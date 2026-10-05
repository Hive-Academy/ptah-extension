# Phase 2 fix report — TASK_2026_596_0a19

Scope: only the Moderate finding in `phase-2-code-review.md` (finding 1: `restoreQuotaOwner`
throws on a non-object `cliSessions` entry). Findings 2-4 (Minor) were not touched.

## Change

`libs/backend/agent-sdk/src/lib/session-metadata-store.ts`, in `restoreQuotaOwner` (about line 315):

- Added the guard `if (typeof ref !== 'object' || ref === null) return ref;` before the
  `in` checks. A non-object entry (`null`, a string, a number) now passes through
  unchanged.
- Extended the doc comment to explain why: the `in` operator throws a TypeError on
  primitives and `null`, and G3 requires that restore never throws.
- Lines changed: 5 added (1 guard line, 4 comment lines). No other code changed.

Caller behaviour kept: `getCliSessionsForRestore` is just
`(metadata?.cliSessions ?? []).map(restoreQuotaOwner)`. Before Batch 5 it returned the
persisted array as-is. Returning the entry unchanged keeps that behaviour: the same
array length and order, with the bad entry left in its position. The fix does not filter
or rewrite entries, which keeps it inside the scope of the finding.

## Tests added

`libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts`, in the
`getCliSessionsForRestore quotaOwner validation` describe: one `it.each` with 3 cases
(`null`, `'cli-orphan'`, `42`). Each case:

1. Persists two valid runs (`cli-1` owned by `OWNER_A`, `cli-2` owned by `OWNER_B`) and flushes.
2. Corrupts the persisted `ptah.sessionMetadata` blob by putting the bad entry between them
   (`storage.__state.seed`).
3. Reloads a fresh `SessionMetadataStore` and calls `getCliSessionsForRestore`.
4. Asserts that the call resolves without throwing, returns 3 entries, leaves the bad entry
   unchanged in the middle, and restores both valid siblings with their own owners.

Without the guard, all 3 cases throw, because the `in` checks run on a primitive or `null`.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts -t "quotaOwner validation"`
  → 12 passed (9 existing + 3 new), 70 skipped by the filter.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk --parallel=2`
  → "Successfully ran targets typecheck, test, lint for project @ptah-extension/agent-sdk"
  (0/3 cache hits, so all three targets ran fresh). The Nx Cloud 401 notice (organization
  disabled) is unrelated, and the run still succeeded locally.

## Out-of-scope observation

`countReferencesWithBulk` (same file, about line 303) runs `ref[field]` on each
`cliSessions` entry, so a persisted `null` entry would throw there as well. Whether that
path can see such an entry was not checked. It was left alone, as the scope required.

batches.md was not edited. Nothing was staged or committed.
