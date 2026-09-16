# Code Logic Review — `TASK_2026_443_40ec` (Batch 10, Task 10.1)

## Summary

| Metric              | Value                                      |
| ------------------- | ------------------------------------------ |
| Overall score       | 6/10                                       |
| Assessment          | NEEDS_REVISION                              |
| Blocking issues     | 0                                          |
| Serious issues      | 2                                          |
| Moderate issues     | 2                                          |
| Failure modes found | 7                                          |

Review type: documentation accuracy. Every claim written into the diff was checked
against the code, not against the implementer report. The diff's own content is
accurate: every number traces to a config file, the dead setting is gone from every
source tree, the changelog is additive, and the `memory-curator/CLAUDE.md` drift the
Batch 9 review named is fixed. The revision verdict comes from what the batch did
NOT touch: one docs page in the same section still states the deleted salience-decay
behaviour, and the settings table the batch edited still carries three dead
`tierLimits` rows that claim a demotion behaviour no code performs.

## Five logic questions

### 1. How does this fail silently?

Documentation that states behaviour the code does not have fails silently by design —
nothing errors, the reader just acts on false information. Two confirmed instances
survive this batch:

- `apps/ptah-docs/src/content/docs/memory/index.mdx:20` still says "Salience scoring
  decides which memories rise to `core` and which decay out of `archival`". No code
  does either. `rankSalience` only orders query results
  (`libs/backend/memory-curator/src/lib/salience-ranking.ts:18-28`); the only tier
  transition writer is `MemoryLifecycleStore.archiveBatch`
  (`memory-lifecycle.store.ts:22-23`), and nothing promotes to `core` by salience.
- `apps/ptah-docs/src/content/docs/memory/settings.md:18-20` documents
  `memory.tierLimits.core/recall/archival` with "the weakest memory is demoted when
  full". A source-wide grep for `tierLimits` over `libs` and `apps` (all `.ts`/`.html`)
  returns only the registry entries in
  `libs/backend/platform-core/src/file-settings-keys.ts:211-213,500-502`. No consumer
  exists. It also had no consumer at commit `d2fa6b8e1`, before this task started.
  The claim describes behaviour that has never been wired.

### 2. What user action produces unexpected behaviour?

A user sets `memory.tierLimits.core: 10` in `~/.ptah/settings.json` because
`settings.md:18` promises "the weakest memory is demoted when full". Nothing reads
the key, so nothing happens, and no error or log tells them why. The batch removed
the sibling dead setting (`memory.decayHalflifeDays`) from this exact table but left
these three rows in place.

### 3. What input data produces a wrong answer?

A stale `memory.decayHalflifeDays` value in an existing user's `settings.json` is
inert after the removal: `FILE_BASED_SETTINGS_KEYS` is a routing set
(`platform-core/src/interfaces/workspace-provider.interface.ts:44` — keys in it
route to the file store), not a validation whitelist, and the file store keeps
arbitrary JSON. A key removed from the set simply stops routing; nothing rejects it.
The removal is safe. Residual note: `.nx/cache/**` build artifacts still contain the
old key in previously built bundles (`dist/apps/ptah-extension-vscode/main.mjs`
copies). Those are stale caches regenerated on the next build, not source
references — not a finding, recorded for completeness.

### 4. What happens when a dependency fails?

The docs' dependency-failure claim was verified true of the code: when sqlite-vec
is unavailable and the `memory_chunks_vec_ad` trigger exists, `canDelete()` returns
`allowed: false` and the delete and eviction loops are skipped while archival
continues (`memory-lifecycle.store.ts:141-152`; `memory-lifecycle.service.ts:102-127,151`).
One edge is stated too broadly — see Moderate/minor finding M3/M-2.

### 5. What is missing that the requirements never mentioned?

The four `memory.retention.*` settings (`enabled`, `processedDays` 7, `stuckDays`
14, `batchSize` 500 — `memory-retention-config.ts:22-34`, registered at
`file-settings-keys.ts:335-338,597-600`) are user-facing file-based settings and are
documented nowhere in `apps/ptah-docs`. `settings.md`'s own description line says
"Every memory tunable". The batch added the sibling `Lifecycle` table one heading
below and left this gap beside it. Pre-existing, but the batch owned this page.

## Failure modes

### FM1 — Surviving salience-decay claim contradicts the corrected pages

- Trigger: a reader opens the Memory section index page.
- Symptom: `index.mdx:20` states salience scoring moves memories between tiers and
  prunes `archival` — the exact behaviour this umbrella task deleted.
  `index.mdx:30` repeats "salience scoring" in the card text. This contradicts
  `how-it-works.md:50` ("it does not rewrite salience as a maintenance step") in the
  same section.
- Evidence: `apps/ptah-docs/src/content/docs/memory/index.mdx:20,30`; code
  `salience-ranking.ts:18-28` (query-time ranking only), `memory-lifecycle.store.ts:22-23`
  (age-based archival is the only tier writer).
- Current handling: the page was not edited; Task 10.1's file list named only the
  four pages `settings.md`, `how-it-works.md`, `pinning-and-forgetting.md`,
  `changelog.md` (batches.md:1388-1425), so the executor followed the task letter.
- Recommendation: fix `index.mdx:20` and `:30` in this batch before commit, or
  record the page as a follow-up with the same status as the Batch 9 moderates.

### FM2 — Dead `tierLimits` rows claim enforced demotion

- Trigger: a user reads the Core settings table this batch edited.
- Symptom: `settings.md:18-20` promises tier caps with demotion-when-full. No code
  reads `memory.tierLimits.*`. `index.mdx:14-18` adds a second, different set of
  caps (50/500/5000) that also match nothing — the two pages disagree with each
  other and with the code.
- Evidence: `settings.md:18-20`; grep over `libs`+`apps` `.ts`/`.html` returns only
  `file-settings-keys.ts:211-213,500-502`; `git grep -l tierLimits d2fa6b8e1` shows
  no consumer at any point in history.
- Current handling: untouched; out of the task's named scope but inside the table
  the batch edited, and inside this review's failure class.
- Recommendation: delete the three rows (and the `index.mdx` cap column), or keep
  the keys and document them as inert. Do not leave "demoted when full" standing.

### FM3 — `memory.retention.*` settings undocumented

- Trigger: a user wants to tune observation-queue retention.
- Symptom: no docs page names any `memory.retention.*` key; `settings.md` claims
  completeness ("Every memory tunable").
- Evidence: `memory-retention-config.ts:22-34`; `file-settings-keys.ts:335-338`;
  grep `memory.retention` over `apps/ptah-docs` returns nothing.
- Current handling: pre-existing gap from TASK_2026_440, not introduced here.
- Recommendation: add a Retention table beside the new Lifecycle table.

### FM4 — `CuratorCallOptions` named in Public API but absent from the barrel

- Trigger: a maintainer imports `CuratorCallOptions` from
  `@ptah-extension/memory-curator`.
- Symptom: compile error. The barrel re-exports `ICuratorLLM`,
  `ExtractedMemoryDraft`, `ResolvedMemoryDraft`
  (`libs/backend/memory-curator/src/index.ts:99-105`) but not `CuratorCallOptions`
  (it exists only in `memory-contracts`, `memory-contracts/src/index.ts:12`).
- Evidence: `libs/backend/memory-curator/CLAUDE.md` Public API section,
  "Re-exports `ICuratorLLM`, `CuratorCallOptions`, ..."; `src/index.ts:99-105`.
- Current handling: pre-existing sentence, unchanged by the diff — but Task 10.1's
  acceptance criterion says "every symbol named in `memory-curator/CLAUDE.md`
  exists in `src/index.ts`", and this one does not.
- Recommendation: add it to the barrel or drop it from the sentence.

### FM5 — "Only writer of `tier = 'archival'`" is overbroad

- Trigger: a maintainer adds an insert path that passes `tier: 'archival'`.
- Symptom: the CLAUDE.md invariant reads as a guarantee; in fact
  `MemoryStore.insertMemoryWithChunks` writes `tier='archival'` (and stamps
  `archived_at`) whenever a caller passes it (`memory.store.ts:193,205`). No live
  caller does today (grep for `tier: 'archival'` finds only lifecycle types), and
  the claim is true of every `UPDATE` statement (verified: the only `UPDATE
  memories` writers are `setPinned`, `recordUse`, `appendChunks`,
  `ARCHIVE_UPDATE_SQL`).
- Evidence: `memory-curator/CLAUDE.md` lifecycle bullet; `memory.store.ts:205`.
- Recommendation: word it as the task did — "the only `SET tier = 'archival'`
  writer is `archiveBatch`".

### FM6 — Vec-pause claim simplified past the code condition

- Trigger: a fresh database on a host where sqlite-vec never loaded.
- Symptom: docs in three pages say deletes pause when sqlite-vec is unavailable.
  The code pauses only when vec is unavailable AND the `memory_chunks_vec_ad`
  trigger exists (`memory-lifecycle.store.ts:141-152`); without the trigger, deletes
  proceed — correctly, because no vector rows exist, but the doc sentence as
  written is false on that database.
- Evidence: `settings.md:37`, `how-it-works.md:54`, `pinning-and-forgetting.md:43`;
  `memory-lifecycle.store.ts:141-152`.
- Recommendation: acceptable simplification for user docs; optional precision.

### FM7 — Restore-on-use has no pinned guard, against "Locks its tier"

- Trigger: a user pins an `archival` memory, then it is retrieved and used
  (`memory:get`, injected hit, etc.).
- Symptom: `recordUse` flips any listed row from `archival` to `recall` with no
  `pinned = 0` guard (`memory.store.ts:544-551`), so the pinned row leaves
  `archival`. `pinning-and-forgetting.md:15` ("Locks its tier") is contradicted on
  this path, and the new restore text (`pinning-and-forgetting.md:43`) does not
  scope the restore to unpinned rows because the code does not either.
- Evidence: `memory.store.ts:544-551`; `pinning-and-forgetting.md:15,43`.
- Current handling: pre-existing line 15; the lifecycle itself does respect pinned
  everywhere (`ARCHIVE_SELECT_SQL`, `DELETE_ARCHIVED_SELECT_SQL`, `EVICT_*_SELECT_SQL`
  all carry `pinned = 0`).
- Recommendation: either guard the restore with `pinned = 0` in code or drop the
  "Locks its tier" absolute. Docs-only fix acceptable for this batch.

## Blocking issues

None.

## Serious issues

### S1 — Surviving deleted-behaviour claim in `index.mdx`

- File: `apps/ptah-docs/src/content/docs/memory/index.mdx:20`
- Scenario: a reader of the Memory section landing page reads that salience
  scoring promotes to `core` and prunes `archival`.
- Impact: the reader is wrong on both counts, and the page contradicts the
  corrected `how-it-works.md` one click away. This is the exact failure class the
  umbrella task exists to fix, and check 5 of this review explicitly asks that no
  contradiction survive.
- Fix: rewrite lines 20 and 30 to match the shipped lifecycle.

### S2 — Dead `tierLimits` settings documented as enforced

- File: `apps/ptah-docs/src/content/docs/memory/settings.md:18-20`
- Scenario: a user sets a tier limit expecting demotion when full.
- Impact: nothing reads the key; the promised behaviour never runs; no feedback is
  given. The batch removed one dead setting from this table and left three.
- Fix: remove or correct the rows; reconcile `index.mdx:14-18`.

## Moderate and minor issues

- **M1 (moderate)** — `memory.retention.*` settings undocumented anywhere in
  `apps/ptah-docs` while `settings.md` claims "Every memory tunable"
  (`memory-retention-config.ts:22-34`, `file-settings-keys.ts:335-338`).
- **M2 (moderate)** — `CuratorCallOptions` named in the Public API re-export list
  but absent from `libs/backend/memory-curator/src/index.ts:99-105`; violates Task
  10.1's own acceptance criterion ("every symbol named ... exists in src/index.ts").
- **m3 (minor)** — FM5: "only writer of `tier = 'archival'`" overbroad vs the
  insert path (`memory.store.ts:205`).
- **m4 (minor)** — FM6: vec-pause claim simplified past the trigger-existence
  condition (`memory-lifecycle.store.ts:141-152`).
- **m5 (minor)** — FM7: pinned archival rows restore to `recall` on use
  (`memory.store.ts:544-551`), contradicting `pinning-and-forgetting.md:15`.

## Data flow — claim-to-code verification (all OK unless noted)

1. `archiveAfterDays` 30 — `memory-lifecycle-config.ts:14` ✓ (docs: how-it-works.md:52,
   pinning-and-forgetting.md:41, settings.md:33, CLAUDE.md).
2. `deleteAfterDays` 60, counted FROM `archived_at` —
   `memory-lifecycle-config.ts:15`; `DELETE_ARCHIVED_SELECT_SQL` filters
   `m.archived_at < @cutoff` (`memory-lifecycle.store.ts:12-15`;
   `memory-lifecycle.service.ts:113-116`) ✓.
3. `maxPerWorkspace` 25,000 — `memory-lifecycle-config.ts:16` ✓.
4. Cap grace 7 days — `RETENTION_CAP_EVICTION_GRACE_MS = 7 * DAY_MS`
   (`memory-retention-config.ts:61`), applied to archival eviction
   (`EVICT_ARCHIVAL_SELECT_SQL`, `memory-lifecycle.store.ts:33-37`) ✓.
5. 25,000 memory rows per run — `RETENTION_MAX_MEMORY_ROWS_PER_RUN`
   (`memory-retention-config.ts:57`) ✓; delete batch 200 —
   `RETENTION_MEMORY_DELETE_BATCH_SIZE` (`memory-retention-config.ts:59`) ✓.
6. Retention processedDays 7 / stuckDays 14 —
   `memory-retention-config.ts:31-32` ✓ (CLAUDE.md retention bullet, unchanged,
   accurate); 24 h due rule — `RETENTION_INTERVAL_MS`
   (`memory-retention-config.ts:84`) and the not-due gate with backlog override
   (`memory-retention.service.ts:252-256`) ✓; hourly budgets 50,000 rows / 60 s /
   32,768 pages (`memory-retention-config.ts:55,63,78`) ✓.
7. Lifecycle runs after quarantine — quarantine loop then `lifecycle.runStep`
   (`memory-retention.service.ts:343-378`) ✓.
8. Delete of memory + chunks in one transaction — `deletePair` inside
   `inTransaction` (`memory-lifecycle.store.ts:154-169,281-286`) ✓; FTS and vec
   rows via triggers `memory_chunks_ad` (`migrations/0002_memory.ts:56`),
   `memory_chunks_vec_ad` (`migrations/0019_memory_chunks_vec_cleanup.ts:16`),
   concepts via `memories_concepts_ad` (`migrations/0017_memory_schema_v2.ts:42`) ✓.
9. Pinned/core/corpus exempt — `pinned = 0`, `tier <> 'core'`, `NOT EXISTS
   corpus_memories` in every lifecycle select (`memory-lifecycle.store.ts:12-42,44-50`) ✓.
10. Deletes pause when vec unavailable — `canDelete` +
    `memory-lifecycle.service.ts:102-127` ✓ (edge: FM6).
11. "Used" paths — injected hits `agent-sdk/.../memory-prompt-injector.ts:138`;
    MCP search `vscode-lm-tools/.../memory-namespace.builder.ts:234`; `memory:get`
    `rpc-handlers/.../memory-rpc.handlers.ts:249`; `mem:getObservations`
    `mem-rpc.handlers.ts:156`; curator merge `memory-curator.service.ts:654` →
    `appendChunks` restore `memory.store.ts:601` ✓. RPC `memory:search` records
    nothing, and the docs correctly omit it.
12. Use restores archival → recall — `recordUse` (`memory.store.ts:544-551`) ✓
    (edge: FM7).
13. Only `SET tier='archival'` writer is `archiveBatch` — verified against every
    `UPDATE memories` statement ✓ (nuance: FM5).
14. Nothing writes salience after insert — the only `UPDATE memories` writers are
    `setPinned`, `recordUse`, `appendChunks`, `ARCHIVE_UPDATE_SQL`; none touches
    `salience` ✓.
15. Every lifecycle batch waits on the governor — `beforeBatch` →
    `budget.waitForGovernor()` before each batch
    (`memory-lifecycle.service.ts:249-272`; `retention-run-budget.ts:61`) ✓.
16. Salience immutable base in [0,1] — `baseSalience` clamp
    (`salience-ranking.ts:13-16`); ranking is query-time
    (`rankSalience`, `salienceRankOrderBy`) ✓.
17. `memory:get` tier snapshot — handler reads the memory before `recordUse`
    (`memory-rpc.handlers.ts:241-263`), so the response carries the request-time
    tier and a restore shows on the next read ✓ — CLAUDE.md sentence accurate.
18. `decayHalflifeDays` removal — zero matches in `libs`/`apps`/`apps/ptah-docs`
    source (only `.nx/cache` build artifacts and `.ptah` task records); the key was
    routing-only, so a stale user value is inert; `file-settings-keys.spec.ts` needs
    no edit — it enumerates the sets generically (lines 9-10, 163-168) and pins the
    lifecycle defaults in a dedicated block (lines 174-178), so deletion keeps it
    green ✓.
19. Changelog — `git diff` shows additions only; the Hermes history line
    (changelog.md:15) is untouched, as required ✓.
20. CLAUDE.md drift — `SalienceScorer`/`MemoryDecayJob`/`salience-scorer`/
    `memory-decay` return zero matches in the file; `salience-ranking.ts` and all
    named `retention/` files exist; the R1 caveat is present and matches the
    migration comment in `memory.store.ts:696-701` ✓.

## Requirements fulfilment

| Requirement (review request) | Status | Gap |
| --- | --- | --- |
| 1. Every number matches config source | COMPLETE | No invented number found in the diff |
| 2. Behavioural statements true of code | COMPLETE | All 17 statements verified; three nuances (FM5-FM7) |
| 3. `memory:get` request-time tier note | COMPLETE | Handler verified; note accurate |
| 4. Dead-setting removal complete and safe | COMPLETE | Routing-set semantics make it safe; spec needs no edit |
| 5. No deleted behaviour left in docs | PARTIAL | `index.mdx:20` survives; `tierLimits` rows survive (S1, S2) |
| 6. Changelog additive, history untouched | COMPLETE | Additions only |
| 7. CLAUDE.md accuracy | PARTIAL | `CuratorCallOptions` absent from barrel (M2) |

Implicit requirements not addressed: none beyond the gaps above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Fresh DB, vec never loaded | YES (code) | No trigger → deletes proceed, no vec rows to orphan | Docs sentence overbroad (FM6) |
| Stale `decayHalflifeDays` in user settings | YES | Routing set, not a whitelist; value inert | None |
| Pinned archival memory used | YES (code) | `recordUse` restores it | Contradicts "Locks its tier" (FM7) |
| Recall row restored from archival, then cap eviction | YES | `archived_at` is NULL → excluded from archival grace select | None |
| Backlog overrides 24 h due rule | YES | `not-due` requires no backlog (`memory-retention.service.ts:252-256`) | None |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `index.mdx` still teaches the deleted salience-decay model, so the docs
  section contradicts itself after this batch.
- What a robust implementation would add:
  1. Rewrite `index.mdx:20` and `:30` to the shipped lifecycle.
  2. Remove or correct the `memory.tierLimits.*` rows in `settings.md:18-20` (and
     the `index.mdx:14-18` cap column).
  3. Export `CuratorCallOptions` from the barrel or drop it from the CLAUDE.md
     re-export sentence.
  4. Optionally: document the four `memory.retention.*` settings; scope the restore
     claim or guard it with `pinned = 0`.

Scope examined: the full uncommitted diff (6 files, read whole), the task folder
(batches.md Task 10.1 and the Batch 9 result block, batch-10-docs-report.md), the
lifecycle/retention config, store and service sources, `memory.store.ts`,
`salience-ranking.ts`, the RPC handlers, the migration triggers, the platform-core
settings registry and its spec, and a decay/half-life/salience sweep over
`apps/ptah-docs`.

## Not verified by execution

Constraint: another session runs a performance baseline on this machine, so this
review ran no `nx`, `jest`, or build command. All checks used file reads, grep,
and `git diff` only. The following report claims remain unverified by execution:

1. Platform-core test run (41 suites, 781 tests, batch-10-docs-report.md:76).
2. Platform-core typecheck run (batch-10-docs-report.md:93).
3. Platform-core lint run (0 errors, 9 warnings, batch-10-docs-report.md:110).
4. Docs build (156 pages, batch-10-docs-report.md:127).
5. Degradation audit (303 sites in baseline, batch-10-docs-report.md:143).

Static evidence makes failure unlikely: the diff touches no executable code
except the settings registry, and `file-settings-keys.spec.ts` enumerates the
key sets generically rather than naming `decayHalflifeDays`. The report's
recorded outputs agree with the spec content read for this review. The verdict
does not rest on these runs.

Residual uncertainty: the test suite, typecheck, lint, and docs build pass as
reported, but no reviewer executed them.