# Batch 10 documentation report — Task 10.1

## Scope and outcome

Completed the documentation and dead-setting cleanup for `TASK_2026_443_40ec`, Batch 10 Task 10.1. The stale decay/scorer documentation is replaced with the shipped query-time salience ranking and lifecycle behavior. The unused `memory.decayHalflifeDays` setting is removed after confirming that it had no consumer.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle`

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\CLAUDE.md` — documents `salience-ranking.ts`, lifecycle services/config/tokens, usage recording, retention ordering and budgets, exemptions, sqlite-vec pause behavior, R1 drift, and request-time `memory:get` tier snapshot semantics.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\platform-core\src\file-settings-keys.ts` — removes the dead key and default for `memory.decayHalflifeDays`.
- INSPECTED, NOT MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\platform-core\src\file-settings-keys.spec.ts` — the dead key was not named in this spec, so no edit was required.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\apps\ptah-docs\src\content\docs\memory\settings.md` — replaces the dead setting with the four shipped lifecycle settings and behavior.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\apps\ptah-docs\src\content\docs\memory\how-it-works.md` — replaces mutable salience decay with immutable base salience, query-time ranking, age lifecycle, cap behavior, exemptions, restoration, and safe deletion behavior.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\apps\ptah-docs\src\content\docs\memory\pinning-and-forgetting.md` — replaces half-life pruning with the shipped lifecycle and enumerates recorded-use paths.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\apps\ptah-docs\src\content\docs\reference\changelog.md` — adds a new memory lifecycle update entry without rewriting the existing Hermes history entry.

## Pre-edit dead-setting grep

Command:

```text
rg -n --hidden --glob '!.git/**' "decayHalflifeDays" libs apps docs
```

Result before edits (exit 0):

```text
apps\ptah-docs\src\content\docs\memory\settings.md:21:| `memory.decayHalflifeDays`      | `30`                       | Half-life of unused memories' salience                                                                                        |
apps\ptah-docs\src\content\docs\memory\pinning-and-forgetting.md:41:Unpinned memories decay exponentially. The half-life is `memory.decayHalflifeDays` (default `14`). After several half-lives without retrieval hits, a memory's salience drops below the cutoff and it's pruned from the active store.
apps\ptah-docs\src\content\docs\memory\how-it-works.md:50:Each memory carries a salience score. The score increases when a memory is **retrieved and used** in subsequent turns, and decays exponentially when it's not. The half-life is `memory.decayHalflifeDays` (default 30 days).
libs\backend\platform-core\src\file-settings-keys.ts:214:  'memory.decayHalflifeDays',
libs\backend\platform-core\src\file-settings-keys.ts:504:  'memory.decayHalflifeDays': 30,
```

Conclusion: the key had no consumer. Its only source occurrences were the registry/default and stale docs; `file-settings-keys.spec.ts` did not name it. The key and default were therefore deleted.

## Behavior and number provenance

Every lifecycle number added to the documentation was taken from the shipped configuration source:

| Documented value | Source |
| --- | --- |
| Archive unused recall after 30 days | `libs/backend/memory-curator/src/lib/retention/memory-lifecycle-config.ts`: `MEMORY_LIFECYCLE_DEFAULTS.archiveAfterDays = 30` |
| Delete archival rows 60 days after `archived_at` | `libs/backend/memory-curator/src/lib/retention/memory-lifecycle-config.ts`: `MEMORY_LIFECYCLE_DEFAULTS.deleteAfterDays = 60`; cutoff use verified in `memory-lifecycle.service.ts` and `memory-lifecycle.store.ts` |
| Per-workspace cap of 25,000 evictable rows | `libs/backend/memory-curator/src/lib/retention/memory-lifecycle-config.ts`: `MEMORY_LIFECYCLE_DEFAULTS.maxPerWorkspace = 25_000` |
| 7-day cap-eviction grace | `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts`: `RETENTION_CAP_EVICTION_GRACE_MS = 7 * DAY_MS` |
| 25,000 memory rows per retention run | `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts`: `RETENTION_MAX_MEMORY_ROWS_PER_RUN = 25_000` |
| Initial delete batch of 200 | `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts`: `RETENTION_MEMORY_DELETE_BATCH_SIZE = 200` |
| Stored base salience range `[0,1]` | Required behavior, verified in `libs/backend/memory-curator/src/lib/salience-ranking.ts`: `baseSalience` clamps to 0 through 1 |

Non-numeric behavior was checked against `memory-retention.service.ts`, `memory-lifecycle.service.ts`, `memory-lifecycle.store.ts`, `memory.store.ts`, the usage-recorder call sites, and migration trigger behavior. In particular: lifecycle runs after quarantine; each lifecycle batch waits on the shared governor; age deletion is measured from `archived_at`; deletion of a memory and its chunks is transactional; chunk FTS and vector rows follow via triggers; cap eviction is archival-first; pinned/core/corpus rows are excluded; sqlite-vec unavailability pauses deletes; `recordUse` restores archival rows; curator merge restores through `appendChunks`; and stored salience is not updated after insert.

R1 is documented as an explicit caveat: a drifted real database may have contentless `memory_concepts_fts`, where `memory_id` reads NULL and the delete trigger cannot remove concept entries. The lifecycle documentation does not claim that this out-of-scope, write-only index is repaired.

## Verification

All commands ran from `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle`. Nx 22.6.5 printed singular one-project headers in this version; each exact header is recorded below with the requested project count.

### Platform-core test

Command:

```text
npx nx run-many -t test -p @ptah-extension/platform-core
```

Header:

```text
NX   Running target test for project @ptah-extension/platform-core:
- @ptah-extension/platform-core
```

Result: PASS, exit 0, 1 project. 41 test suites passed; 781 tests passed, 4 todo, 785 total. No R-TL8 file-settings bench flake occurred, so no serial rerun was needed.

### Platform-core typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/platform-core
```

Header:

```text
NX   Running target typecheck for project @ptah-extension/platform-core:
- @ptah-extension/platform-core
```

Result: PASS, exit 0, 1 project. `tsc --noEmit --project libs/backend/platform-core/tsconfig.lib.json` completed successfully.

### Platform-core lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/platform-core
```

Header:

```text
NX   Running target lint for project @ptah-extension/platform-core:
- @ptah-extension/platform-core
```

Result: PASS, exit 0, 1 project. 0 errors and 9 pre-existing warnings.

### Documentation build

Command:

```text
npx nx run-many -t build -p ptah-docs
```

Header:

```text
NX   Running target build for project ptah-docs:
- ptah-docs
```

Result: PASS, exit 0, 1 project. Astro built 156 pages. The existing diagnostics reported one unreferenced screenshot (`file-tree-panel.png`) while all 32 documentation screenshot references resolved, plus the existing fallback from unknown `gitignore` highlighting to `txt`.

### Degradation audit

Command:

```text
npx nx run degradation-audit:lint
```

Header:

```text
> nx run degradation-audit:lint
```

Result: PASS, exit 0. The audit scanned 2,848 files and reported 303 unsuppressed sites within baselines. No baseline was raised; notably `apps/ptah-extension-vscode` remained 8 against baseline 9, and `libs/backend/platform-core` remained 7 against baseline 7.

### Acceptance searches

Command and result:

```text
rg -n "SalienceScorer|MemoryDecayJob|decay job|salience-scorer" libs/backend/memory-curator/CLAUDE.md
NO MATCHES
```

Command and result:

```text
rg -n --hidden --glob '!.git/**' "decayHalflifeDays" libs apps docs
NO MATCHES
```

Command and result:

```text
rg -ni "half-life|halflife" apps/ptah-docs
NO MATCHES
```

The last result is stricter than required: there is no lifecycle-pruning use, and the ranking documentation describes recency without half-life terminology.

Additional check:

```text
git diff --check
PASS: no whitespace errors
```

## Stack observed

Nx 22.6.5 monorepo on Node 24 with TypeScript 5.9. Product-side DI is tsyringe; memory configuration is read through the `IWorkspaceProvider` boundary and file-based settings registry. The documentation app is Astro 6 with Starlight. Values and behavior were verified against the existing memory-curator source; no new framework, dependency, registration, or validation boundary was introduced.

## Plan deviations

None. The changelog path on disk is `apps/ptah-docs/src/content/docs/reference/changelog.md` (not under `docs/memory`); the requested existing history line was preserved and a new entry was added. The current Nx version rendered the one-project headers in singular form rather than the literal `for 1 project` wording; the project list confirms one project in each run.

## Out-of-scope observations

- Existing platform-core lint warnings remain unchanged (9 warnings, 0 errors).
- The docs build continues to report the existing unreferenced screenshot and `gitignore` syntax-highlighting fallback.
- The R1 contentless `memory_concepts_fts` drift remains explicitly out of scope and is now documented.

## Revision 1

Revision 1 applies the seven fixes in `batches.md` after `code-logic-review-batch-10.md` returned `NEEDS_REVISION` (6/10). The machine hold was observed throughout: no test, build, audit, Nx, Jest, npm, or Git command was run. All evidence below came from `rg` reads; changes were made with patch edits only.

### Per-item diff summary

1. **S1 — Memory landing page:** `apps/ptah-docs/src/content/docs/memory/index.mdx` no longer publishes dead tier caps or describes salience-driven promotion, demotion, or pruning. The tier table now describes writer-assigned tiers, the body states that salience is query-time ranking only, and the section card points to ranking plus the age lifecycle. The resolver diagram in `how-it-works.md` was also brought into agreement by replacing promotion/demotion wording with merge/forget behavior.
2. **S2 — Dead tier-limit settings:** removed `memory.tierLimits.core`, `memory.tierLimits.recall`, and `memory.tierLimits.archival` from both the key registry and defaults in `libs/backend/platform-core/src/file-settings-keys.ts`; removed their rows and enforcement claims from `settings.md`; removed the landing-page cap column. `file-settings-keys.spec.ts` does not name these keys, so it required no edit.
3. **M1 — Retention and lifecycle settings:** added all four `memory.retention.*` settings and completed all four `memory.lifecycle.*` rows in `settings.md`, including defaults and every numeric clamp range from the two config modules.
4. **M2 — Public API accuracy:** `CuratorCallOptions` has no consumer importing it from the memory-curator barrel. Internal memory-curator code imports it through the local interface re-export backed by `memory-contracts`, and `memory-contracts/src/index.ts` is its public barrel. The inaccurate claim was removed from memory-curator's Public API list; `src/index.ts` was not changed.
5. **m3 — Archival writer wording:** `memory-curator/CLAUDE.md` now distinguishes archival inserts (which stamp `archived_at`) from lifecycle movement: `MemoryLifecycleStore.archiveBatch` is the only statement that moves an existing row to archival.
6. **m4 — Exact vector-pause condition:** `memory-curator/CLAUDE.md`, `settings.md`, `how-it-works.md`, `pinning-and-forgetting.md`, and the new changelog entry now say deletion pauses only when sqlite-vec is unavailable **and** `memory_chunks_vec_ad` exists; without the trigger, deletion proceeds.
7. **m5 — Pinned archival restoration:** `pinning-and-forgetting.md` no longer claims pinning locks the tier. It states that pinning exempts lifecycle archival, deletion, and cap eviction, while recorded use restores any archival row to recall. One real-SQLite case was added to `memory.store.spec.ts`: it seeds a pinned archival row, records use, asserts recall + NULL `archived_at` + pinned storage flag, invokes `archiveBatch` with config-derived time/batch values, and confirms the row is not archived again.

The enforced-key check also exposed four pre-existing registered keys with no runtime consumer: `memory.curatorEnabled`, `memory.embeddingModel`, `memory.searchTopK`, and `memory.searchAlpha`. Revision 1 did not delete them because item 2 authorizes deletion only for the three `tierLimits` keys. Their `settings.md` rows now explicitly call them legacy registered keys with no current runtime consumer, so they are not falsely documented as enforced.

### Grep evidence gathered under the machine hold

Pre-edit `tierLimits` evidence gathered while reading the revision inputs showed only the three registry entries, three defaults, and their documentation rows; the review independently recorded the same zero-consumer result. After deletion:

```text
rg -n "decayHalflifeDays|tierLimits" libs apps docs
NO MATCHES (rg exit 1)
```

Deleted lifecycle-language sweep after the fixes:

```text
rg -ni "salience[ -]?(scor|decay)|decay(s)? out of|promote[sd]? (a memory )?to .?core|demot" apps/ptah-docs/src/content/docs/memory apps/ptah-docs/src/content/docs/reference/changelog.md
apps\ptah-docs\src\content\docs\memory\index.mdx:20:... Salience affects query-time ranking only; it never promotes or demotes a memory. ...
```

This sole memory-section match is the explicitly allowed ranking-only statement; it denies rather than describes salience-driven lifecycle behavior. The pre-fix `how-it-works.md` resolver promotion/demotion match was removed.

```text
rg -ni "prune|pruning" apps/ptah-docs/src/content/docs/memory
NO MATCHES (rg exit 1)
```

```text
rg -n "SalienceScorer|MemoryDecayJob|decay job|salience-scorer|CuratorCallOptions" libs/backend/memory-curator/CLAUDE.md
NO MATCHES (rg exit 1)
```

`CuratorCallOptions` usage grep before the documentation correction:

```text
libs/backend/memory-contracts/src/lib/curator-llm.port.ts:122:export interface CuratorCallOptions {
libs/backend/memory-contracts/src/index.ts:12:  CuratorCallOptions,
libs/backend/memory-curator/src/lib/memory-curator.service.ts:37:  CuratorCallOptions,
libs/backend/memory-curator/src/lib/memory-curator.service.ts:116:type CurateInput = CuratorCallOptions & {
libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts:15:  CuratorCallOptions,
libs/backend/memory-curator/src/lib/curator-llm/curator-llm.interface.ts:3:  CuratorCallOptions,
```

The complete grep also found only memory-curator internal/spec uses and the memory-contracts declaration/barrel; it found no app or other library importing this type from `@ptah-extension/memory-curator`. That supports documenting it as internal here rather than expanding the barrel.

### Two-way settings check

**List A — `memory.*` keys documented as actively enforced in `settings.md` / `index.mdx`:**

```text
memory.enabled
memory.curatorModel
memory.curatorProvider
memory.symbolInjectionEnabled
memory.retention.enabled
memory.retention.processedDays
memory.retention.stuckDays
memory.retention.batchSize
memory.lifecycle.enabled
memory.lifecycle.archiveAfterDays
memory.lifecycle.deleteAfterDays
memory.lifecycle.maxPerWorkspace
memory.triggers.preCompact
memory.triggers.idleMs
memory.triggers.turnThreshold
memory.triggers.bootScan
memory.triggers.userPromptSubmit.enabled
memory.triggers.userPromptSubmit.cueList
memory.triggers.userPromptSubmit.minPromptLength
memory.triggers.postToolUse.enabled
memory.triggers.maxCuratesPerHour
```

**List B — registered keys with consumers outside `file-settings-keys.ts`:**

```text
memory.enabled
memory.curatorModel
memory.curatorProvider
memory.symbolInjectionEnabled
memory.retention.enabled
memory.retention.processedDays
memory.retention.stuckDays
memory.retention.batchSize
memory.lifecycle.enabled
memory.lifecycle.archiveAfterDays
memory.lifecycle.deleteAfterDays
memory.lifecycle.maxPerWorkspace
memory.triggers.preCompact
memory.triggers.idleMs
memory.triggers.turnThreshold
memory.triggers.bootScan
memory.triggers.userPromptSubmit.enabled
memory.triggers.userPromptSubmit.cueList
memory.triggers.userPromptSubmit.minPromptLength
memory.triggers.postToolUse.enabled
memory.triggers.maxCuratesPerHour
```

The sets match exactly (21 keys each). Registration/default evidence is in `libs/backend/platform-core/src/file-settings-keys.ts`. Consumer evidence is concentrated in:

- `memory-trigger-config.ts` for `memory.enabled`, curator provider/model, and every documented `memory.triggers.*` key;
- `memory-retention-config.ts` for all four `memory.retention.*` keys;
- `memory-lifecycle-config.ts` for all four `memory.lifecycle.*` keys;
- `code-symbol-prompt-injector.ts` for `memory.symbolInjectionEnabled`.

The four explicitly labeled legacy/inert keys are intentionally excluded from both enforced sets because the source grep found no runtime consumer.

**Retention/lifecycle registry list:**

```text
memory.retention.enabled
memory.retention.processedDays
memory.retention.stuckDays
memory.retention.batchSize
memory.lifecycle.enabled
memory.lifecycle.archiveAfterDays
memory.lifecycle.deleteAfterDays
memory.lifecycle.maxPerWorkspace
```

**Retention/lifecycle `settings.md` list:**

```text
memory.retention.enabled
memory.retention.processedDays
memory.retention.stuckDays
memory.retention.batchSize
memory.lifecycle.enabled
memory.lifecycle.archiveAfterDays
memory.lifecycle.deleteAfterDays
memory.lifecycle.maxPerWorkspace
```

These sets also match exactly (8 keys each).

### Number provenance for Revision 1

Every user-facing number added or retained in the revised lifecycle/retention documentation comes from an allowed source:

| Value | Source |
| --- | --- |
| Retention processed default `7`, clamp `1–365` | `memory-retention-config.ts`: `MEMORY_RETENTION_DEFAULTS.processedDays`; `MEMORY_RETENTION_SETTING_RANGES.processedDays` |
| Retention stuck default `14`, clamp `7–365` | `memory-retention-config.ts`: `MEMORY_RETENTION_DEFAULTS.stuckDays`; `MEMORY_RETENTION_SETTING_RANGES.stuckDays` |
| Retention batch default `500`, clamp `50–5000` | `memory-retention-config.ts`: `MEMORY_RETENTION_DEFAULTS.batchSize`; `MEMORY_RETENTION_SETTING_RANGES.batchSize` |
| Lifecycle archive default `30`, clamp `7–365` | `memory-lifecycle-config.ts`: `MEMORY_LIFECYCLE_DEFAULTS.archiveAfterDays`; `MEMORY_LIFECYCLE_SETTING_RANGES.archiveAfterDays` |
| Lifecycle delete default `60`, clamp `7–730` | `memory-lifecycle-config.ts`: `MEMORY_LIFECYCLE_DEFAULTS.deleteAfterDays`; `MEMORY_LIFECYCLE_SETTING_RANGES.deleteAfterDays` |
| Lifecycle workspace cap default `25000`, clamp `1000–1000000` | `memory-lifecycle-config.ts`: `MEMORY_LIFECYCLE_DEFAULTS.maxPerWorkspace`; `MEMORY_LIFECYCLE_SETTING_RANGES.maxPerWorkspace` |
| Cap-eviction grace `7` days | `memory-retention-config.ts`: `RETENTION_CAP_EVICTION_GRACE_MS = 7 * DAY_MS` |

The new spec introduces no invented operational budget: it uses `DAY_MS` and `MEMORY_RETENTION_DEFAULTS.batchSize` from `memory-retention-config.ts`. Its pinned storage flag (`1`) and zero archived-row expectation are the exact database-state assertions mandated by revision item 7, not user-facing configuration figures.

### Verification status

No test, build, typecheck, lint, degradation-audit, Nx, Jest, npm, or Git command was run for Revision 1 because the machine hold explicitly reserved the machine for another session. The orchestrator must run the complete verification block after the hold is released, including the new memory-curator spec case.

## Revision 2

Revision 2 applies all three items in the final fix list and changes documentation only. No TypeScript source or spec was edited in this revision.

### Per-item diff summary

1. **Corrected `searching.md`:** removed the false `memory.searchAlpha` blend control and `memory.searchTopK` tuning advice. The page now documents fixed RRF `k = 25`, the query-length-dependent BM25/vector weights, and the actual per-call result-count paths.
2. **Made legacy status explicit:** added one sentence stating that the search knobs are fixed in code and that `memory.searchAlpha` and `memory.searchTopK` survive only as legacy registered keys with no runtime consumer.
3. **Swept the complete docs content tree:** checked every page returned by the `memory.` sweep. Concrete keys occur only in `docs/memory/settings.md`, `docs/memory/searching.md`, and `docs/memory/how-it-works.md`; the other matches are the `memory.*` prefix in `docs/memory/index.mdx`, `docs/reference/file-locations.md`, and `docs/reference/changelog.md`, plus ordinary prose (“answer from memory”) in `docs/providers/web-search.md`. No other page documents a legacy `memory.*` key as enforced.

### Grep evidence

Concrete keys named under `apps/ptah-docs/src/content`:

```text
$ rg -n -o "memory\.[A-Za-z][A-Za-z0-9.]*" apps/ptah-docs/src/content
apps/ptah-docs/src/content\docs\memory\searching.md:19:memory.searchAlpha
apps/ptah-docs/src/content\docs\memory\searching.md:19:memory.searchTopK
apps/ptah-docs/src/content\docs\memory\how-it-works.md:17:memory.triggers.idleMs
apps/ptah-docs/src/content\docs\memory\how-it-works.md:18:memory.triggers.turnThreshold
apps/ptah-docs/src/content\docs\memory\how-it-works.md:23:memory.triggers.maxCuratesPerHour
apps/ptah-docs/src/content\docs\memory\how-it-works.md:44:memory.curatorProvider
apps/ptah-docs/src/content\docs\memory\how-it-works.md:44:memory.curatorModel
apps/ptah-docs/src/content\docs\memory\how-it-works.md:44:memory.curatorProvider
apps/ptah-docs/src/content\docs\memory\settings.md:16:memory.enabled
apps/ptah-docs/src/content\docs\memory\settings.md:17:memory.curatorEnabled
apps/ptah-docs/src/content\docs\memory\settings.md:18:memory.embeddingModel
apps/ptah-docs/src/content\docs\memory\settings.md:19:memory.curatorModel
apps/ptah-docs/src/content\docs\memory\settings.md:20:memory.curatorProvider
apps/ptah-docs/src/content\docs\memory\settings.md:21:memory.searchTopK
apps/ptah-docs/src/content\docs\memory\settings.md:22:memory.searchAlpha
apps/ptah-docs/src/content\docs\memory\settings.md:23:memory.symbolInjectionEnabled
apps/ptah-docs/src/content\docs\memory\settings.md:29:memory.retention.enabled
apps/ptah-docs/src/content\docs\memory\settings.md:30:memory.retention.processedDays
apps/ptah-docs/src/content\docs\memory\settings.md:31:memory.retention.stuckDays
apps/ptah-docs/src/content\docs\memory\settings.md:32:memory.retention.batchSize
apps/ptah-docs/src/content\docs\memory\settings.md:38:memory.lifecycle.enabled
apps/ptah-docs/src/content\docs\memory\settings.md:39:memory.lifecycle.archiveAfterDays
apps/ptah-docs/src/content\docs\memory\settings.md:40:memory.lifecycle.deleteAfterDays
apps/ptah-docs/src/content\docs\memory\settings.md:41:memory.lifecycle.maxPerWorkspace
apps/ptah-docs/src/content\docs\memory\settings.md:51:memory.triggers.preCompact
apps/ptah-docs/src/content\docs\memory\settings.md:52:memory.triggers.idleMs
apps/ptah-docs/src/content\docs\memory\settings.md:53:memory.triggers.turnThreshold
apps/ptah-docs/src/content\docs\memory\settings.md:54:memory.triggers.bootScan
apps/ptah-docs/src/content\docs\memory\settings.md:55:memory.triggers.userPromptSubmit.enabled
apps/ptah-docs/src/content\docs\memory\settings.md:56:memory.triggers.userPromptSubmit.cueList
apps/ptah-docs/src/content\docs\memory\settings.md:57:memory.triggers.userPromptSubmit.minPromptLength
apps/ptah-docs/src/content\docs\memory\settings.md:58:memory.triggers.postToolUse.enabled
apps/ptah-docs/src/content\docs\memory\settings.md:59:memory.triggers.maxCuratesPerHour
```

Pages checked by the content-wide `memory.` sweep:

```text
$ rg -l "memory\." apps/ptah-docs/src/content
apps/ptah-docs/src/content\docs\memory\settings.md
apps/ptah-docs/src/content\docs\memory\searching.md
apps/ptah-docs/src/content\docs\memory\index.mdx
apps/ptah-docs/src/content\docs\reference\file-locations.md
apps/ptah-docs/src/content\docs\memory\how-it-works.md
apps/ptah-docs/src/content\docs\reference\changelog.md
apps/ptah-docs/src/content\docs\providers\web-search.md
```

Legacy search-key sweep after the fix:

```text
$ rg -ni "memory\.(searchAlpha|searchTopK)" apps/ptah-docs/src/content
apps/ptah-docs/src/content\docs\memory\searching.md:19:The search knobs are fixed in code; `memory.searchAlpha` and `memory.searchTopK` survive only as legacy registered keys with no runtime consumer.
apps/ptah-docs/src/content\docs\memory\settings.md:21:| `memory.searchTopK`             | `20`                       | Legacy registered key; no current runtime consumer                                                                            |
apps/ptah-docs/src/content\docs\memory\settings.md:22:| `memory.searchAlpha`            | `0.5`                      | Legacy registered key; no current runtime consumer                                                                            |
```

All four registered-but-unconsumed memory keys are described only as legacy:

```text
$ rg -ni "memory\.(curatorEnabled|embeddingModel|searchAlpha|searchTopK)" apps/ptah-docs/src/content
apps/ptah-docs/src/content\docs\memory\settings.md:17:| `memory.curatorEnabled`         | `true`                     | Legacy registered key; no current runtime consumer                                                                            |
apps/ptah-docs/src/content\docs\memory\settings.md:18:| `memory.embeddingModel`         | `Xenova/bge-small-en-v1.5` | Legacy registered key; no current runtime consumer                                                                            |
apps/ptah-docs/src/content\docs\memory\settings.md:21:| `memory.searchTopK`             | `20`                       | Legacy registered key; no current runtime consumer                                                                            |
apps/ptah-docs/src/content\docs\memory\settings.md:22:| `memory.searchAlpha`            | `0.5`                      | Legacy registered key; no current runtime consumer                                                                            |
apps/ptah-docs/src/content\docs\memory\searching.md:19:The search knobs are fixed in code; `memory.searchAlpha` and `memory.searchTopK` survive only as legacy registered keys with no runtime consumer.
```

The broader stale-behaviour sweeps remained clean for memory documentation:

```text
$ rg -ni "salience[ -]?(scor|decay)|decay(s)? out of|promote[sd]? (a memory )?to .?core|demot" apps/ptah-docs/src/content
apps/ptah-docs/src/content\docs\memory\index.mdx:20:... Salience affects query-time ranking only; it never promotes or demotes a memory. ...
apps/ptah-docs/src/content\docs\skill-synthesis\index.mdx:57:... the weakest resident is demoted to **`dormant`** ...
apps/ptah-docs/src/content\docs\skill-synthesis\how-it-works.mdx:55:residency cap check (may demote the weakest active skill to dormant)
apps/ptah-docs/src/content\docs\skill-synthesis\how-it-works.mdx:134:... the weakest resident is demoted to **`dormant`** ...
apps/ptah-docs/src/content\docs\skill-synthesis\settings.md:28:... is demoted to `dormant` ...
apps/ptah-docs/src/content\docs\skill-synthesis\settings.md:143:- **`maxActiveSkills`** is a soft governance cap; demotion is to `dormant`, never deletion.

$ rg -ni "prune|pruning" apps/ptah-docs/src/content/docs/memory
(no matches; exit 1)

$ rg -n "decayHalflifeDays|tierLimits" libs apps docs
(no matches; exit 1)

$ rg -ni "half-life|halflife" apps/ptah-docs
(no matches; exit 1)
```

### Enforced-or-legacy inventory

Every concrete `memory.*` key named anywhere under `apps/ptah-docs/src/content` is accounted for below. “Enforced” means a production consumer exists outside `file-settings-keys.ts`; “legacy” means the key remains registered but has no runtime consumer.

| Key | Status | Consumer/evidence |
| --- | --- | --- |
| `memory.enabled` | Enforced | `memory-trigger-config.ts` / trigger service master gate |
| `memory.curatorEnabled` | Legacy | No consumer outside registration |
| `memory.embeddingModel` | Legacy | No consumer outside registration |
| `memory.curatorModel` | Enforced | `memory-trigger-config.ts`; `sdk-internal-query.curator-llm.ts` |
| `memory.curatorProvider` | Enforced | `memory-trigger-config.ts`; `sdk-internal-query.curator-llm.ts` |
| `memory.searchTopK` | Legacy | No consumer outside registration |
| `memory.searchAlpha` | Legacy | No consumer outside registration |
| `memory.symbolInjectionEnabled` | Enforced | `code-symbol-prompt-injector.ts` |
| `memory.retention.enabled` | Enforced | `memory-retention-config.ts` / retention service |
| `memory.retention.processedDays` | Enforced | `memory-retention-config.ts` / retention service |
| `memory.retention.stuckDays` | Enforced | `memory-retention-config.ts` / retention service |
| `memory.retention.batchSize` | Enforced | `memory-retention-config.ts` / retention service |
| `memory.lifecycle.enabled` | Enforced | `memory-lifecycle-config.ts` / lifecycle service |
| `memory.lifecycle.archiveAfterDays` | Enforced | `memory-lifecycle-config.ts` / lifecycle service |
| `memory.lifecycle.deleteAfterDays` | Enforced | `memory-lifecycle-config.ts` / lifecycle service |
| `memory.lifecycle.maxPerWorkspace` | Enforced | `memory-lifecycle-config.ts` / lifecycle service |
| `memory.triggers.preCompact` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.idleMs` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.turnThreshold` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.bootScan` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.userPromptSubmit.enabled` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.userPromptSubmit.cueList` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.userPromptSubmit.minPromptLength` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.postToolUse.enabled` | Enforced | `memory-trigger-config.ts` / trigger service |
| `memory.triggers.maxCuratesPerHour` | Enforced | `memory-trigger-config.ts` / trigger service |

The inventory and the content sweep match: all 21 enforced keys have production consumers, and all 4 keys without consumers are labeled legacy wherever they appear.

### Number provenance

Every number written into `searching.md` in Revision 2 comes from the shipped source:

```text
$ rg -n -C 2 "RRF_K_DEFAULT|topK = 10|tokenCount|bm25Weight|topK = 20|Math\.min\(100" libs/backend/memory-curator/src/lib/memory-search.service.ts
159-/** Default k for RRF — lowered from 60 to 25 for tighter ranking at memory scales of 100-5000 chunks. */
160:const RRF_K_DEFAULT = 25;
241:    topK = 10,
266:    topK = 10,
278:    topK = 10,
307:    const tokenCount = trimmed.split(/\s+/).filter((t) => t.length > 0).length;
308:    const bm25Weight = tokenCount < 4 ? 0.6 : 0.3;
309:    const weights = { bm25: bm25Weight, vec: 1 - bm25Weight };
310-    let fused = this.rrfFuse(bm25Rows, vecRows, limit * 4, { k: 25, weights });
554:    const limit = Math.max(1, Math.min(100, filter.topK ?? 20));
```

Thus: RRF `25`; short-query boundary `4`; BM25/vector weights `0.6`/`0.4` and `0.3`/`0.7`; `search` default `10`; `mem:searchIndex` clamp `1–100` and default `20`.

```text
$ rg -n -C 2 "MAX_HITS|search\(" libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts
59:const MAX_HITS = 5;
110:      const result = await this.memoryReader.search(
111-        query,
112:        MAX_HITS,
```

This is the source for prompt injection asking for `5`.

The first MCP lookup used a stale path and correctly failed:

```text
$ rg -n -C 2 "maxResults|reader\.search" libs/backend/mcp-server/src/lib/namespaces/memory.namespace.ts
rg: libs/backend/mcp-server/src/lib/namespaces/memory.namespace.ts: IO error for operation on libs/backend/mcp-server/src/lib/namespaces/memory.namespace.ts: The system cannot find the path specified. (os error 3)
```

The source-location sweep and the corrected lookup found the live namespace builder:

```text
$ rg -l "maxResults" libs apps
... includes libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builder.ts

$ rg -n -C 3 "maxResults|reader\.search|memoryReader\.search" libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builder.ts
41: * - `maxResults` — maximum hits to return (default: 10, capped to 50 by service).
62: * - `maxResults` is capped at 50 (same as the RPC handler's `topK` limit).
67:  maxResults: z.number().int().positive().max(50).optional(),
226:      const maxResults =
229:          : (validatedOpts?.maxResults ?? 10);
232:        const result = await reader.search(query, maxResults, workspaceRoot);
```

The docs deliberately state only the requested behaviour: MCP passes the caller's `maxResults`.

### Verification

The single permitted build command ran once:

```text
$ npx nx run-many -t build -p ptah-docs
NX   Running target build for project ptah-docs:
- ptah-docs
...
[screenshots] 1 unreferenced file(s): file-tree-panel.png
[screenshots] 32 reference(s) across the docs all resolve.
...
[build] 156 page(s) built
[build] Complete!
NX   Successfully ran target build for project ptah-docs
```

Exit code: `0`. The pre-existing unreferenced screenshot warning did not fail the build. No other test, build, lint, audit, Jest, npm, or Nx command was run.

### Name-only diff evidence

```text
$ git diff --name-only
.ptah/specs/TASK_2026_443_40ec/batches.md
apps/ptah-docs/src/content/docs/memory/how-it-works.md
apps/ptah-docs/src/content/docs/memory/index.mdx
apps/ptah-docs/src/content/docs/memory/pinning-and-forgetting.md
apps/ptah-docs/src/content/docs/memory/searching.md
apps/ptah-docs/src/content/docs/memory/settings.md
apps/ptah-docs/src/content/docs/reference/changelog.md
libs/backend/memory-curator/CLAUDE.md
libs/backend/memory-curator/src/lib/memory.store.spec.ts
libs/backend/platform-core/src/file-settings-keys.ts
warning: in the working copy of '.ptah/specs/TASK_2026_443_40ec/batches.md', CRLF will be replaced by LF the next time Git touches it
```

This is the accumulated uncommitted Batch 10 worktree, so it still lists the two `.ts` files required by Revision 1 (`memory.store.spec.ts` and `file-settings-keys.ts`) and the orchestrator-owned `batches.md`. Revision 2 itself edited only `apps/ptah-docs/src/content/docs/memory/searching.md`; it made no `.ts` or spec change.
