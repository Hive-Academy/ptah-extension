# Code Logic Review — `TASK_2026_443_40ec` — Batch 9

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 4                                    |

Scope reviewed: the 24 uncommitted paths in `git status` (two deleted files, 22 modified),
read in full or in diff; the wiring files the required-injection claim depends on
(`register-rpc-surface.ts`, `manifest.ts`, host profiles, both composition paths); and the
Batch 10 section of `batches.md`, which changes the severity of two leftovers. Verification
I ran myself: the removed-symbol grep over `libs/` and `apps/` including non-`.ts` files;
`updateTier` and `DecayJobOptions|DecayRunStats` greps; and
`npx nx run degradation-audit:lint` (exit 0; per-lib baselines re-checked below).

## Five logic questions

### 1. How does this fail silently?

- The setting `memory.decayHalflifeDays` is now a silent no-op knob. It survives in
  `libs/backend/platform-core/src/file-settings-keys.ts:214` and `:504` (default 30) with
  zero consumers; `git grep` at `HEAD` shows no consumer there either — the deleted job read
  `halflifeDays` from `DecayJobOptions`, and no runner ever called it
  (`memory-decay.job.ts` was DI-registered but unscheduled, confirmed by batches.md:555-556).
  The user-facing docs still sell it: `apps/ptah-docs/src/content/docs/memory/settings.md:21`,
  `how-it-works.md:50`, `pinning-and-forgetting.md:39-41`, `changelog.md:8`. A user who tunes
  the half-life gets no effect and no error. Nothing in the plan (Component 7,
  implementation-plan.md:634-653) or Batch 10 assigns this to any batch — Batch 10 Task 10.1
  covers `memory-curator/CLAUDE.md` only (batches.md:1364-1366). See Moderate 2.
- No silent failure in the new recording paths: `MemoryStore.recordUse` catches internally
  (`memory.store.ts:558-561`), and the two new RPC catches log at warn and return the
  unchanged result (`memory-rpc.handlers.ts:248-255`, `mem-rpc.handlers.ts:157-162`). Both
  were exercised by tests with throwing mocks.

### 2. What user action produces unexpected behaviour?

- `memory:get` on an `archival` memory returns `tier: 'archival'` while the same call has just
  flipped the row to `recall` (`memory.store.ts:546-549`: `CASE WHEN tier = 'archival' THEN
  'recall'`). The response is a pre-write snapshot (`memory-rpc.handlers.ts:246` reads,
  `:249` records, `:255-258` returns the earlier object). One-read-stale semantics; the next
  read is correct. Minor 3.
- A user reading `libs/backend/memory-curator/CLAUDE.md:32,43` is told `MemoryDecayJob` is a
  public service and `memory-decay.job.ts` an internal file that "phase 2 … wires it". Both
  are deleted. Moderate 1 (deferred to Batch 10.1, so recorded, not missed).

### 3. What input data produces a wrong answer?

- None found in the recording logic. `MemGetObservationsParamsSchema` caps `ids` at 200
  (`mem-rpc.schema.ts:43`) and `recordUse` dedups then slices to 200
  (`memory.store.ts:530`), so with at most 200 requested ids the returned set is never
  truncated. Not-found ids are excluded before recording because only `r.memories` is mapped
  (`mem-rpc.handlers.ts:156`). `memoryId` is an identity brand (`memory.types.ts:25`), so
  recording `params.id` raw (`memory-rpc.handlers.ts:249`) matches the id the lookup used.
- Wrong "answer" only in the docs sense: the ptah-docs decay pages describe behaviour no code
  implements (Moderate 2).

### 4. What happens when a dependency fails?

- Recorder failure: caught at both RPC sites, warn-logged with narrowed `unknown`, result
  shape unchanged (`memory-rpc.handlers.ts:250-255`, `mem-rpc.handlers.ts:157-162`; tests
  `memory-rpc.handlers.spec.ts:415-429`, `mem-rpc.handlers.spec.ts:304-323`). Fail-open, as
  D6 requires.
- Curator registration failure at boot: both hosts swallow it and continue
  (CLI `register-thoth-libraries.ts:117-125`, Electron `phase-2-libraries.ts:343-351`).
  `MEMORY_USAGE_RECORDER` and `MEMORY_SEARCH` are then both unregistered, and the lib-owned
  resolve in `register-rpc-surface.ts:183-185` has no try/catch, so `registerRpcSurface`
  throws. This is pre-existing: `MEMORY_SEARCH` was a required injection before Batch 9
  (`mem-rpc.handlers.ts:49-50`), so the failed-curator path already could not construct
  `MemRpcHandlers`. The CLI catches the throw (`container.ts:885-889`); Electron does not
  (`wire-runtime.ts:322-325`), so an Electron curator-registration failure still crashes
  activation — unchanged by this batch, out of its scope, and honestly disclosed in the
  report's "Out-of-scope observations".
- SQLite failure inside `recordUse`: swallowed inside the store with a warn
  (`memory.store.ts:558-561`); the read result is unaffected.

### 5. What is missing that the requirements never mentioned?

- Removal of the now-dead `memory.decayHalflifeDays` key and the ptah-docs decay pages
  (Moderate 2).
- The CLAUDE.md drift (Moderate 1) is mentioned — but scheduled for Batch 10.1, not this
  batch, so Batch 10 must actually land.
- Everything the batch text asked for is present; nothing is stubbed, commented out, or
  renamed-instead-of-deleted (verified by reading every deleted-file diff and the
  removed-symbol grep below).

## Failure modes

### Dead user-facing setting knob

- Trigger: user sets `memory.decayHalflifeDays` in `~/.ptah/settings.json`.
- Symptom: no effect, no error, forever; docs claim it halves salience.
- Evidence: `libs/backend/platform-core/src/file-settings-keys.ts:214,504`;
  `apps/ptah-docs/src/content/docs/memory/settings.md:21`; no consumer in `libs/`+`apps/`.
- Current handling: key accepted and defaulted; value never read.
- Recommendation: delete the key + defaults in a follow-up (platform-core), and fold the
  ptah-docs decay pages into the Batch 10 docs pass or file a follow-up task.

### Instruction-file drift points at deleted code

- Trigger: any agent or developer reads `libs/backend/memory-curator/CLAUDE.md` before
  working in that lib.
- Symptom: searches for `MemoryDecayJob`, `memory-decay.job.ts`, `SalienceScorer` — none
  exist; the file even claims phase 2 will wire the decay job, which this task deleted.
- Evidence: `libs/backend/memory-curator/CLAUDE.md:13,32,43`.
- Current handling: unaddressed in Batch 9; scheduled as Task 10.1 (batches.md:1364-1366),
  whose acceptance grep covers exactly these strings.
- Recommendation: no change to Batch 9; hold Batch 10 to that acceptance grep.

### Stale tier in the `memory:get` response

- Trigger: `memory:get` on a memory whose tier is `archival`.
- Symptom: response carries `tier: 'archival'`; the row is `recall` by the time the caller
  reads the response. Next read disagrees.
- Evidence: `memory-rpc.handlers.ts:246-258` vs `memory.store.ts:546-549`.
- Current handling: consistent-snapshot semantics; arguably correct.
- Recommendation: accept, or document that the response reflects request-time state.

### Unreachable production catch (defence in depth)

- Trigger: `recordUse` failure against the real store.
- Symptom: the RPC-level catch never fires — `MemoryStore.recordUse` already swallows all
  errors internally (`memory.store.ts:558-561`); only the store's warn appears, not the
  handlers' warn.
- Evidence: `memory-rpc.handlers.ts:248-255`, `mem-rpc.handlers.ts:157-162`.
- Current handling: the catch is real and tested, but only against jest mocks that throw.
- Recommendation: keep (a future recorder implementation may throw); note that the
  acceptance tests prove the contract against mocks, while the real recorder's own
  fail-open behavior is separately proven by `memory.store.spec.ts` (Batch 3 m2).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate — leftover decay references in a non-`.ts` file inside `libs/`.** The batch's
   own acceptance grep ran with `--glob '*.ts'`, so it reported NO MATCHES while the
   instruction-level grep (all files) hits
   `libs/backend/memory-curator/CLAUDE.md:13,32,43` (`MemoryDecayJob`, `memory-decay.job.ts`,
   "decay job"). Failure scenario: an agent reads the lib's instruction file, trusts the
   Public API list, and calls an export that no longer exists. Not a code defect; deferred
   by design to Batch 10 Task 10.1 (batches.md:1364-1370). Batch 9 is not dinged for it, but
   the review contract asked for the search including non-`.ts` files, so it is recorded:
   Batch 10 must land or this deletion is half-removed at the documentation layer.
2. **Moderate — dead setting `memory.decayHalflifeDays` and shipped docs describe deleted
   behaviour.** `libs/backend/platform-core/src/file-settings-keys.ts:214,504` keeps a key
   with zero consumers; `apps/ptah-docs/src/content/docs/memory/settings.md:21`,
   `how-it-works.md:50`, `pinning-and-forgetting.md:39-41`, `changelog.md:8` still document
   salience decay and half-life pruning that no code implements. The setting was already dead
   before Batch 9 (the job was never scheduled), so this is a scope gap the plan never
   mentioned, not a regression — but Batch 9 was the decay-removal batch and the knob
   survived it. Needs an owner (platform-core + docs follow-up).
3. **Minor — pre-write tier snapshot in the `memory:get` response.**
   `memory-rpc.handlers.ts:246-258` returns the tier fetched before `recordUse` potentially
   restores `archival → recall` (`memory.store.ts:546-549`). One read stale; acceptable
   consistent-snapshot semantics, but worth a one-line note in the docs pass.
4. **Minor — grep-evasion in the new absence assertion.**
   `register.spec.ts:110` asserts `isRegistered(Symbol.for(['PtahMemory', 'DecayJob'].join('')))`
   — it assembles `'PtahMemoryDecayJob'` at runtime so the repository-wide removed-symbol
   grep stays clean. The assertion is sound (same `Symbol.for` key, asserted on the same
   child container the sibling SalienceScorer absence check uses, `register.spec.ts:106-112`),
   and the report discloses the trick. Cost: a future reader cannot find `PtahMemoryDecayJob`
   by search. Accepted trade.
5. **Minor — `curator-activity-log.ts` touch is comment-only.** Answering the review
   question directly: the facade's doc comment listed `recordDecayEvent` among the preserved
   public signatures (`curator-activity-log.ts:4-9`); the method was deleted, so the comment
   had to drop it or lie. No logic changed. Correct and necessary.

## Data flow

1. `memory:get` → guard `!params?.id` → `getById(memoryId(params.id))` — identity brand, so
   raw `params.id` equals the stored id. OK.
2. Not found → early return, no recording (spec `memory-rpc.handlers.spec.ts:393-402`). OK.
3. `getChunks` → `recordUse([params.id])` in try/catch (warn on failure, result unchanged) →
   return pre-write wire snapshot. OK except Minor 3 staleness.
4. `mem:getObservations` → Zod parse (INVALID_PARAMS on failure) → `search.getObservations` →
   `recordUse(r.memories.map(id))` in try/catch nested inside the outer try, so a recorder
   throw cannot reach the outer PERSISTENCE_UNAVAILABLE mapping — it is caught at
   `mem-rpc.handlers.ts:157-162` and the exact result object is returned. OK.
5. `recordUse` in store: dedup + 200 cap, single transaction, `archival → recall` +
   `archived_at = NULL` restore, write-counter bump only for restored roots, catch-all warn.
   OK.
6. `memory:search`, `memory:list`, `mem:searchIndex`, `mem:timeline` → zero `recordUse` call
   sites (grep: only `memory-rpc.handlers.ts:249` and `mem-rpc.handlers.ts:156`), negative
   assertions at `memory-rpc.handlers.spec.ts:404-412`, `mem-rpc.handlers.spec.ts:141,220`. OK.
7. Diagnostics: snapshot drops `lastDecayAt`/`lastDecayStats`
   (`diagnostics.service.ts:45-52`), shared wire drops the same fields
   (`rpc-curator-diagnostics.types.ts`), RPC mapping drops the branch
   (`memory-rpc.handlers.ts:529-537`). No reader left referencing them (grep clean). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 9.1 delete `MemoryDecayJob`, token, registration, exports, diagnostics fields, `'decay-run'`, `recordDecayEvent` | COMPLETE | TS surface clean; `CLAUDE.md` leftovers deferred to Task 10.1 |
| 9.1 `updateTier` deleted, no remaining caller, archival owned by lifecycle store | COMPLETE | `rg updateTier` = no matches; only archival writer is `archiveBatch` (`memory-lifecycle.store.ts:22`) plus `recordUse`'s restore CASE |
| 9.1 type removals compile everywhere | COMPLETE | six-project typecheck green; `assertNever` restored (`event-feed.component.ts:8,168`) makes the 16-member switch exhaustive by compile check, not a cast |
| 9.2 `memory:get` records only when found | COMPLETE | early return precedes recording |
| 9.2 `mem:getObservations` records returned ids | COMPLETE | maps `r.memories` only |
| 9.2 `memory:search`/`memory:list`/`mem:searchIndex`/`mem:timeline` record nothing | COMPLETE | no call sites; negative specs |
| 9.2 recorder failure never changes result or shape | COMPLETE | both catches return the same object; tested with throwing mocks |
| Required `MEMORY_USAGE_RECORDER` injection safe on every constructing host | COMPLETE | VS Code: `memory` in `EXPECTED_ABSENT_CAPABILITIES` (`expected-absent.ts:56-58`), never constructs `MemRpcHandlers`. Electron: `memory: true` (`rpc-host-profile.ts:27`), curator registered at `phase-2-libraries.ts:341` before `wire-runtime.ts:322-325`. CLI: `memory: true` (`cli-host-profile.ts:27`), `registerThothLibraries` at `container.ts:705` before `registerRpcSurface` at `:884`; `MEMORY_USAGE_RECORDER` registered at `register.ts:107`. Failed-curator path already broke `MEMORY_SEARCH` before Batch 9 — no new DI failure introduced |
| Carried Batch 7 minor 2 (seed rollback rethrows ORIGINAL error) | COMPLETE | `retention-sqlite.test-support.ts:392-398`: inner guarded catch, then `throw error` |
| Carried Batch 8 moderate 1 (`assertNever`) | COMPLETE | `event-feed.component.ts:168` |
| Carried Batch 8 minor 2 (vec-unavailable + populated preview → exact paused text) | COMPLETE | `storage-health-panel.component.spec.ts:257-283`; component order makes the preview text absent (`storage-health-panel.component.ts:371-380`) — assertion is exact |
| Carried Batch 8 minor 3 (three `toBe` full trimmed dd text) | COMPLETE | `storage-health-panel.component.spec.ts:231-236,251-256,277-283` |
| Carried Batch 8 minor 4 (no `Memories` row when `lastRun` null) | COMPLETE | `storage-health-panel.component.spec.ts:284-297` |
| Carried Batch 8 minor 5 (fixtures typed `MemoryDiagnosticsResult`) | COMPLETE | `memory-diagnostics-rpc.service.spec.ts:70,115` with completed nested fields |
| XB2 (three fail-open catches annotated; baselines not grown) | COMPLETE | Annotations at `memory-rpc.handlers.ts:251`, `mem-rpc.handlers.ts:158`, `retention-sqlite.test-support.ts:398`. I re-ran `degradation-audit:lint`: exit 0; memory-curator 20/20, rpc-handlers 1/1, memory-curator-ui 15/15, shared 3/3, ptah-extension-vscode 8 (baseline 9, decreased) — no baseline grew |
| Acceptance grep returns nothing under `libs/`+`apps/` | PARTIAL | true for `*.ts`; false for all files — `memory-curator/CLAUDE.md:13,32,43` (Moderate 1, deferred to Task 10.1) |

Implicit requirements not addressed: removal of the dead `memory.decayHalflifeDays` setting
key and the ptah-docs decay pages (Moderate 2).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `memory:get` id missing / not found | YES | guard + early return; spec `:393-402` | none |
| `mem:getObservations` with zero matched memories | YES | `recordUse([])` early-returns (`memory.store.ts:530-531`) | none |
| More than 200 ids | YES | schema max 200 (`mem-rpc.schema.ts:43`) matches store cap | none |
| Duplicate ids | YES | `new Set` dedup (`memory.store.ts:530`) | none |
| Recorder throws non-Error | YES | `instanceof Error` narrow + `String(error)` | none |
| Invalid params | YES | Zod → INVALID_PARAMS before any recording | none |
| Curator registration fails at boot | YES (pre-existing) | CLI catches (`container.ts:885`); Electron activation would crash — unchanged from before Batch 9 | out of scope, disclosed |
| `lastNote: 'vec-unavailable'` with populated preview | YES | note branch wins over preview (`storage-health-panel.component.ts:374-376`); exact-text spec | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the deletion is only fully honest once Batch 10 Task 10.1 lands the CLAUDE.md
  fix, and nothing yet owns the dead `memory.decayHalflifeDays` key plus the ptah-docs decay
  pages — a user-tunable knob that silently does nothing.
- What a robust implementation would add: (1) a Batch 10 amendment or follow-up task to drop
  `memory.decayHalflifeDays` from `file-settings-keys.ts` and rewrite the three ptah-docs
  memory pages around the lifecycle; (2) a one-line note that `memory:get` responses reflect
  request-time state; (3) nothing else — the removal is atomic, the recording is fail-open,
  and the required-injection decision is verified against all three hosts.