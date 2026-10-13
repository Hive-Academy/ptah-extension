# Code Style Re-review - TASK_2026_652_7284, Batch 16 (commit 678f0d632)

Review family: claude subagent (implementer: codex)

Scope: `git diff 678f0d632^..678f0d632 -- libs/` (5 files). Files were read in full:
`harness-proposal-store.service.ts` and its spec, `merge-harness-config-updates.ts` and its spec,
`rpc-harness.schemas.ts` (changed region). Compared against `harness-sync/src/lib/lock/file-lock.ts`,
`harness-sync/src/index.ts`, `shared/src/schemas.ts` and sibling `rpc-handlers` services. No test
runs (the team-leader's runs are taken as given). FU-1..FU-6 were not re-raised.

## Result

- Score: 8/10. Verdict: APPROVED. There are no Blocking or Serious findings and four Minor ones.
  The Minors are optional and cost seconds to fix.
- Why not 9: the committed files fail `prettier --check`. The class JSDoc is attached the wrong way
  round relative to the decorator. `prune` got denser.
- Why not 7: the Serious finding from the first review is closed with the primitives it asked for,
  and the error surface leaves no dangling reference.

## Disposition

| Item                                                          | Status                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 reuse `serializeByKey` + `withFileLock` through the barrel | Closed                                | `harness-proposal-store.service.ts:6` imports both from `@ptah-extension/harness-sync`. They are exported at `harness-sync/src/index.ts:113-122`. Used at `:63` (queue, keyed by the data file) and `:66-85` (lock on `${file}.lock`, options `staleAfterMs`/`maxWaitMs`, both valid `FileLockOptions`). The static `queues` map, `acquireLock`, `LOCK_*` constants and `fs.open('wx')` code are gone. Only `isErrno`, still used at `:121,157,171,182,190`, remains. Constants at `:21-23` carry rationale comments. |
| S2 class JSDoc lists rejections                               | Closed (as scoped)                    | `:40-45` lists `HarnessProposalWorkspaceError` with its code, `ZodError`, `FileLockTimeoutError` (with its package) and file system errors. The port and barrel docs in platform-core are FU-2, deferred by the disposition. See finding 1 for the placement.                                                                                                                                                                                                                                                         |
| Finding 6 (`HarnessSessionIdSchema`)                          | Closed as scoped (second use is FU-6) | Exported at `rpc-harness.schemas.ts:462`. Used at `:468` and in the store at `:59,90`. `harness-rpc.schema.ts:196` still repeats the literal, which the disposition already defers as FU-6. Nothing got worse.                                                                                                                                                                                                                                                                                                        |
| Finding 9 (static queue on a singleton)                       | Closed                                | `serializeByKey` owns the module-level map, keyed with `normalizeLockKey` (`file-lock.ts:130-132`). The store no longer has per-class static state.                                                                                                                                                                                                                                                                                                                                                                   |

### Public error surface

- `HarnessProposalLockError` has no remaining reference outside `.ptah/specs` documents. A repo-wide
  search covered the code under `libs/` and `apps/`. Those documents are the original review, the logic
  review, and `batches.md` text that describes the removal.
- `config/index.ts` exports only `HarnessProposalStore`. It never exported either error class, so the
  removal changes no public symbol. `HarnessProposalWorkspaceError` stays service-local, as before. That
  gap is the unchanged part of S2 and belongs to FU-2.
- Callers on `save` now see `FileLockTimeoutError`. The class is exported from the harness-sync barrel
  (`index.ts:117`) with `isFileLockTimeoutError` (`:118`) for narrowing.
- Callers on `save` and `get` also see `ZodError` from `HarnessSessionIdSchema.parse` (`:59,90`).
  Callers that need the message text can still use `error.message`.
- The old `code` string `HARNESS_PROPOSAL_LOCK_TIMEOUT` no longer exists. The new error has no `code`
  property. Nothing in the repo matches on it, so this is clean today. The `vscode-lm-tools` consumer is
  not built yet. It will have to use `isFileLockTimeoutError` or `instanceof`. This fits FU-2, which
  documents the port.

### Nx boundaries

- `rpc-handlers` already imports `@ptah-extension/harness-sync` in about 13 non-spec files, for example
  `harness-health-rpc.service.ts:28`, `harness-mcp-install.service.ts:23` and `harness-rpc.handlers.ts:38`.
  The import goes through the barrel, never a deep path. `harness-sync` does not depend on `rpc-handlers`
  (its own docs say so), so there is no cycle. The new edge is the same dependency those files use, so
  `@nx/enforce-module-boundaries` has nothing new to say. The team-leader's lint run agrees.
- `@ptah-extension/shared/schemas` is the correct entry for a schema. It is re-exported at
  `shared/src/schemas.ts:28`, so `HarnessSessionIdSchema` is reachable without further wiring.

## New findings

1. **Minor - `@injectable()` precedes the JSDoc.** `harness-proposal-store.service.ts:39-45`.
   Sibling services put the decorator directly above `export class`, with any doc comment above the
   decorator (`harness-health-rpc.service.ts:~37`, `harness-mcp-install.service.ts:~50`). Here the
   `/** */` sits between the decorator and the class. TypeScript probably still attaches it, but IDE
   hover and the convention are both fragile. Fix: move the comment above `@injectable()`.

2. **Minor - the files are not prettier-clean, though the repo runs `nx format:write` in lint-staged.**
   `prettier --check` fails on `harness-proposal-store.service.ts` and `merge-harness-config-updates.ts`.
   It also fails on `harness-proposal-store.service.spec.ts`, `merge-harness-config-updates.spec.ts` and
   `rpc-harness.schemas.ts`. Visible symptoms: the stray blank line at `harness-proposal-store.service.ts:47`
   (left where `queues` was removed), the unwrapped lines at `merge-harness-config-updates.ts:22,56`, the
   `isErrno` wrapping at `:35-36`, and a long `writeFile` line in the spec near `:117`. Formatting is
   owned by tooling, so this is a note, not a style rule. I did not check whether the hook ran. Fix: run
   `npx nx format:write --files=<the five files>`.

3. **Minor - `prune` is three nested `try` blocks with `continue` in a `catch`.**
   `harness-proposal-store.service.ts:166-192`. A `valid` flag (`:173`) is threaded across the nesting.
   The correctness fixes (L3) are fine, but the control flow is hard to read. A new reader will not see
   at a glance that an ENOENT race `continue`s while a SyntaxError falls through to the mtime branch.
   Recommendation: extract `pruneRecord(file, cutoff): Promise<void>` holding the lock check, parse and
   expiry. Keep the per-file `try/catch` in the loop. This also makes the later throttle (FU-3) a
   one-place change.

4. **Minor - the specs reach into collaborator internals.** `harness-proposal-store.service.spec.ts:117,129`
   hard-code harness-sync's private `{ pid, at }` lock payload and the store's private 10 s stale value
   (`11_000`, `+60_000`). `:165-175` uses an inline `require('fs/promises') as typeof import(...)` to
   spy on `rename`, with no comment on why. `jest.spyOn(fs, 'rename')` cannot work on the
   `import * as fs` namespace under the CJS transform. There is precedent for `require` in rpc-handlers
   specs, and lint passes, so this is acceptable. Recommendation: one comment line saying why, and name
   the stale value in the test title or a local constant. If `LockPayload` changes, these tests fail
   with an unrelated-looking timeout, not a clear error.

## Five style questions

1. Six months out: `vscode-lm-tools` becomes the second consumer and string-matches nothing. It must
   learn `FileLockTimeoutError` and `ZodError` from the class JSDoc only (FU-2 covers the port).
   `HarnessGetProposalParamsSchema` can still drift from `HarnessSessionIdSchema` until FU-6 lands.
2. A new reader could misread the `sessionId = ...parse(sessionId)` parameter reassignment at
   `:59,90` (it trims, so the hashed id can differ from the caller's). They could also misread why
   `prune` runs before the lock at `:65`. The lock check at `:168` makes that safe, but nothing says so.
3. Maintenance cost fell. About 60 lines of lock and queue code are gone and fixes in harness-sync now
   reach this store. `prune` grew by about 8 lines of nested logic (finding 3).
4. Consistency: lock use now matches the other `withFileLock` callers, and the barrel import matches
   the sibling services. The one remaining inconsistency is finding 1 (decorator and JSDoc order).
5. I would have extracted `pruneRecord`, and put the JSDoc above the decorator. I would also have set
   the rejection list on the port, which is already queued as FU-2.

## Pattern compliance

| Rule or convention                                             | Status       | Evidence                                        |
| -------------------------------------------------------------- | ------------ | ----------------------------------------------- |
| Reuse existing primitives instead of copying (first-review S1) | PASS         | `harness-proposal-store.service.ts:6,63,66`     |
| Cross-lib import through the barrel, no deep path              | PASS         | `:6`, `spec:9`                                  |
| Nx module boundaries (new `harness-sync` edge)                 | PASS         | Same dependency as ~13 sibling files            |
| No dangling references after a removed export                  | PASS         | No remaining `HarnessProposalLockError` in code |
| Schema exported from `@ptah-extension/shared/schemas`          | PASS         | `schemas.ts:28`, `rpc-harness.schemas.ts:462`   |
| Decorator above the class, JSDoc above the decorator           | FAIL (Minor) | `service.ts:39-45`                              |
| Files pass the repo formatter                                  | FAIL (Minor) | `prettier --check` on 5 files                   |
| One regression test per fix                                    | PASS         | `spec:165-221` (store), `merge spec:119-146`    |

## Maintenance debt

- Introduced: the nested `prune` flow, and tests coupled to the lock payload shape.
- Retired: the hand-rolled lock, the static queue map and the duplicate error class, about 60 lines
  with a policy that diverged from harness-sync.
- Net: down.
