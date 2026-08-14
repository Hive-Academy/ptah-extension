# Development Tasks — TASK_2026_180

**Agentic skill synthesis: queued execution, provider routing, session archaeologist, replay validation, proactive curator**

**Total Batches**: 34 | **Total Tasks**: 118 | **Commits**: 6 | **Status**: 0/34 complete

Source of truth: `.ptah/specs/TASK_2026_180/implementation-plan.md` (USER-APPROVED, 1,123 lines).
All paths below are **worktree-relative** to
`D:/projects/ptah-extension/.claude-worktrees/task180/`.

---

## 0. Delivery DAG

Six commits. **A batch belongs to exactly one commit; no batch straddles a commit
boundary.** Each commit is shippable without partial work from any later commit.

```
                   ┌──────────────────────────┐
                   │ C0 — Phase 0             │
                   │ queue + cron drain +     │
                   │ Tier A survival          │
                   │ B0.1 … B0.7              │
                   └────┬──────────────┬──────┘
                        │              │
      ┌─────────────────┘              └──────────────┐
      │                                               │
┌─────▼────────────────────┐                   ┌──────▼──────────────────┐
│ C1 — Phase 1             │                   │ C5 — Tier B tray        │
│ trust + lane routing     │                   │ Electron keep-alive     │
│ B1.1 … B1.11             │                   │ B5.1 … B5.2             │
└────┬───────────┬─────────┘                   └─────────────────────────┘
     │           │
     │           └──────────────┬──────────────────────┐
     │                          │                      │
┌────▼─────────────────┐ ┌──────▼──────────────┐ ┌─────▼───────────────┐
│ C2 — Phase 2         │ │ C3 — Phase 3        │ │ C4 — Phase 4        │
│ session archaeologist│ │ empirical gates     │ │ proactive curator   │
│ B2.1 … B2.4          │ │ B3.1 … B3.5         │ │ B4.1 … B4.5         │
└──────────┬───────────┘ └─────────────────────┘ └─────────────────────┘
           │  (soft: verdict shape)      ▲                    ▲
           └─────────────────────────────┴────────────────────┘
              C3/C4 consume C2's verdict WHEN PRESENT and
              ship + pass CI with the documented fallback when it is absent.
```

**Hard edges**

| Edge    | Reason                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| C0 → C2 | The archaeologist runs only from the queue, never inline (plan §4 Phase 2, criterion P2-4).     |
| C0 → C3 | Replay + judge-panel + trigger-eval are `weekly`-tier drain stages only (plan §4 Phase 3, R8).  |
| C0 → C4 | Digest sweeps are nightly/weekly drain stages (context.md Phase 4).                             |
| C0 → C5 | The tray gates on `skillSynthesis.trayKeepalive`, whose key + default-`false` ships in C0 (Q4). |
| C1 → C2 | The archaeologist runs on the `archaeologist` lane through `LaneRunner`.                        |
| C1 → C3 | Replay/comparator/judge-panel all run on lanes through `LaneRunner`.                            |
| C1 → C4 | Digest sweeps that call an LLM go through `LaneRunner`.                                         |

**Soft edges (fallback documented, CI green either way)**

| Edge    | Fallback                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C2 ⇢ C3 | Replay + trigger-eval prefer `skill_session_verdicts.routine` / `friction_map`; when the row is absent or `degraded_reason IS NOT NULL` they fall back to `ExtractedTrajectory.canonicalText` + `shortDescription` and set `payload.verdictFallback = true` (plan §4 Phase 3). |
| C2 ⇢ C4 | Win rate degrades gracefully: sessions with no verdict row count as `unknown`, and `winRate` is `null` — never `0` — when the denominator is 0 (plan §2.5).                                                                                                                    |

### 0.1 Recommended landing order

**C0 → C1 → C2 → C3 → C4 → C5.**

Phase 0 and Phase 1 are dependency-independent _at the design level_ — context.md
line 8 explicitly permits them in parallel — but **one Phase-1 acceptance
criterion (P1-7) is only assertable once the drain exists**: "a lane whose auth
cannot resolve leaves its queue item `queued` with a surfaced reason and does not
throw out of the drain." That criterion lives in batch **B1.7**, which therefore
carries a cross-commit dependency on **B0.4**.

Landing C0 first makes B1.7 buildable as written. If the orchestrator chooses to
land C1 first instead, B1.7 must be deferred to the front of C0 — see
**Questions for the user**, Q-A.

### 0.2 Decisions already made — do NOT re-litigate

Recorded in `context.md` § "Approved decisions (Checkpoint 2, user-approved)".

| #   | Decision                                                                                                                                           | Where it binds |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Q1  | ONE shared `'lane'` `ProviderTierScope` member. Not four. Not reused `'cliAgent'`.                                                                 | B1.3           |
| Q2  | Unresolvable lane auth **STALLS** — queue item back to `queued`, surfaced reason, 30-min backoff. **Never** falls back to the foreground provider. | B1.5, B1.7     |
| Q3  | Orchestrated multi-pass retrieval via `TranscriptWindowReader` driven from TypeScript. **NOT** SDK tool calling (correction C7).                   | B2.2, B2.3     |
| Q4  | Tier B Electron tray is a SEPARATE SIXTH COMMIT. C0 ships Tier A survival plus the `skillSynthesis.trayKeepalive` key defaulted `false`.           | B0.5, C5       |
| Q5  | Frequent drain cadence `*/15 * * * *`.                                                                                                             | B0.5, B0.6     |

---

## 1. Plan validation summary

**Validation status: PASSED WITH RISKS.** No blockers. The plan was
stress-tested against the worktree at `1064bcafb`; every assumption below was
checked by reading the cited file.

### 1.1 Assumptions verified against code

| #   | Assumption                                                                                            | Result                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Highest existing migration is `0031`; new work starts at `0032`.                                      | ✅ `libs/backend/persistence-sqlite/src/lib/migrations/` ends at `0031_task_specs_metadata.ts`.                                                          |
| A2  | `IPowerMonitor` exposes only `onResume`/`onSuspend` — battery gating is unbuildable without widening. | ✅ Confirmed by reading `libs/backend/cron-scheduler/src/lib/power-monitor.interface.ts` in full. Correction **C6** is real and load-bearing → **B0.2**. |
| A3  | `skillSynthesis.*` dotted settings keys already work (`skillSynthesis.triggers.*`).                   | ✅ `libs/backend/platform-core/src/file-settings-keys.ts:143-149`. The lane keys copy that proven shape.                                                 |
| A4  | `triggers/skill-trigger-config.ts` is the house pattern for dotted settings sub-trees.                | ✅ Present at `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts`. **B1.4** is a structural copy.                                    |
| A5  | `libs/frontend/ui/src/lib/native/` is the right home for the extracted picker.                        | ✅ Existing siblings: `autocomplete`, `card`, `drawer`, `dropdown`, `form`, `option`, `popover`, `shared`, `tab-group`.                                  |
| A6  | `CuratorModelPickerComponent` exists in the Electron-only lib and must be DELETED, not forked.        | ✅ `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/curator-model-picker.component.ts` (+ its spec) → **B1.10**.                          |
| A7  | Electron `window-all-closed` quits unconditionally and there is no tray.                              | ✅ `apps/ptah-electron/src/main.ts:161` (`window-all-closed`), `:166` (`will-quit`); zero `Tray` references. Tier B is genuinely net-new → **C5**.       |
| A8  | `apps/ptah-electron` has a `test` target, so the tray is unit-testable, not e2e-only.                 | ✅ Targets include `test`, `typecheck`, `lint`, `validate-deps`.                                                                                         |
| A9  | `skillSynthesis:` is already in `ALLOWED_METHOD_PREFIXES`.                                            | ✅ Confirmed (correction C11). **Do NOT add a redundant entry.** Only the compile-time half of dual-registration applies per new method.                 |

### 1.2 Risks carried into the batches

| #   | Risk                                                                                                                                                                                                                                     | Severity              | Mitigating batch                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | A background lane repoints the user's live chat session. `ProviderModelsService.applyPersistedTiers` (`:617-643`) writes `this.authEnv[k]` **and** `process.env[k]` with **no scope guard at all**.                                      | CRITICAL              | **B1.5** — byte-for-byte immutability spec + lib-scoped ESLint ban. Release-blocking on failure.                                                                         |
| R2  | Silent auth-strip breakage. `buildLaneEnv` blanks `CHAT_AUTH_KEYS` by **assigning `undefined`, never `delete`**. Any `structuredClone` / `JSON` round-trip / `z.record(z.string())` / truthiness filter re-leaks foreground credentials. | CRITICAL              | **B1.3** (type is `Readonly<Record<string, string \| undefined>>`) + **B1.5** (presence-with-`undefined` assertion).                                                     |
| R3  | Archaeologist cost scales linearly with session count.                                                                                                                                                                                   | HIGH                  | **B0.4** (per-item budget check, cheap-stages-first ordering above 80 % budget), **B2.4** (nightly tier only).                                                           |
| R4  | Drain starvation — one busy project monopolizes every tick.                                                                                                                                                                              | HIGH                  | **B0.4** — round-robin over `skill_synthesis_workspace_cursor`, `perWorkspaceBatch = 1`.                                                                                 |
| R5  | Stale-claim TTL mistuned — a live archaeologist run reaped mid-flight.                                                                                                                                                                   | MED-HIGH              | **B0.3** (`touchClaim` heartbeat), **B0.4** (startup assertion `staleClaimTtlMs >= 3 × max(lane.timeoutMs)`), **B2.3** (heartbeat between passes).                       |
| R6  | A lane pointed at a small-context or non-tool-use model loops to timeout.                                                                                                                                                                | MEDIUM                | **B1.5** (`tool-use-unsupported` degrades **once**), **B1.9** (picker warns off `supportsToolUse`/`contextLength`), **B2.3** (`maxPasses = 1` collapse).                 |
| R7  | Local-proxy lane mis-identified by hostname-substring matching.                                                                                                                                                                          | MEDIUM (pre-existing) | **B1.3** — lanes always set explicit `ANTHROPIC_DEFAULT_*_MODEL` via `buildTierValues` before identification. Fixing the matcher is out of scope; logged as a follow-up. |
| R8  | Judge-panel + replay quadruple promotion cost.                                                                                                                                                                                           | MEDIUM                | **B3.4** (second judge only on a `scored` first verdict; escalation only above threshold), weekly tier only.                                                             |
| R9  | SQLite `CHECK` constraints cannot be extended without a table rebuild.                                                                                                                                                                   | MEDIUM (designed out) | **B0.1** — `0032` enumerates **all eleven** stages and **all seven** statuses in one pass; spec asserts the full enum set.                                               |
| R10 | Suppressing `window-all-closed` without a working tray leaves an unkillable process.                                                                                                                                                     | LOW-MED               | **B5.1** — default `false`, unconditional "Quit Ptah" item, `will-quit` teardown unchanged.                                                                              |

### 1.3 Gaps found during decomposition — new tasks added

Two artefacts the plan requires **do not exist yet** in the worktree. Both are
carried as explicit tasks rather than assumed:

1. **`libs/backend/skill-synthesis/eslint.config.mjs` does not exist.** R1's
   mitigation (b) — an ESLint rule banning `setModelTier` / `applyPersistedTiers`
   inside the lib — needs the file created from scratch. The per-lib-config
   pattern is proven (`libs/web/members/eslint.config.mjs`, referenced at
   `eslint.config.mjs:9`). → **Task B1.5.5**.
2. **No `dependency-boundaries.spec.ts`-style check exists anywhere** (`find libs
-name "dependency-boundaries*"` → empty). Criterion P1-9 part (b) asks for one
   pinning `libs/frontend/ui` ↛ `@ptah-extension/core`. → **Task B1.9.4**.

### 1.4 Acceptance-criterion coverage

Every criterion in `context.md` § "Acceptance criteria (per phase)" maps to a
named spec through plan §6, and every one of those specs is owned by exactly one
batch below. **No criterion is orphaned.** Four criteria were flagged in §6 as
UNTESTABLE AS WRITTEN and restated by the architect — the restatement is what the
batch implements, and the batch says so:

| Criterion                                  | Why untestable as written                                | Restated into                                                    |
| ------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------- |
| P0-5 (battery)                             | No battery query existed on the port.                    | B0.2 + B0.4                                                      |
| P0-7 (`JobRun` rows "visible in Activity") | Spans backend + frontend; "visible" is not an assertion. | B0.5 (RPC half) + B0.7 (component half)                          |
| P1-9 (picker renders in BOTH hosts)        | Jest cannot distinguish the host.                        | B1.9 (injector-surface + boundary spec) + B1.11 (e2e both hosts) |
| P1-10 (no prompt-echo titles "anywhere")   | Unbounded negative.                                      | B1.6 (namer) + B1.10 (title fallback)                            |

---

# COMMIT 0 — Phase 0: queue, cron drain, Tier A survival

Commit message: `feat(skill-synthesis): phase 0 — durable synthesis queue drained by cron`

---

## Batch B0.1: Migration 0032 + shared SQLite error helper ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: none
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The `0032` DDL is the schema contract every later phase reads;
  R9 means a missed `CHECK` member costs a table rebuild later. The
  `isUniqueConstraintError` relocation is a cross-lib move that must not break
  `cron-scheduler`. Architecture-bearing, not boilerplate.

### Task B0.1.1: Create migration `0032_skill_synthesis_queue`

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/0032_skill_synthesis_queue.ts`
- **Spec**: `libs/backend/persistence-sqlite/src/lib/migrations/0032_skill_synthesis_queue.spec.ts`
- **Spec ref**: implementation-plan.md §2.2 (lines 80–130)
- **Pattern to follow**: `0030_skill_event_metrics.ts:13-24`, `0031_task_specs_metadata.ts:23-32`
- **Details**: Three tables — `skill_synthesis_queue`, `skill_synthesis_workspace_cursor`,
  `skill_synthesis_budget` — plus `idx_ssq_drain`, `idx_ssq_stale`, `idx_ssq_session`.
  SQL **must** be static text in `export const sql = \`...\``(ESLint`no-template-curly-in-migration`+ Semgrep`sql-injection-in-migration`,
`migrations/index.ts:14-18`).
- **Validation notes**: **R9.** Enumerate ALL ELEVEN stages
  (`prefilter`, `archaeology`, `synthesis`, `embedding`, `clustering`,
  `cluster-synthesis`, `judge`, `judge-panel`, `replay`, `trigger-eval`, `digest`)
  and ALL SEVEN statuses (`queued`, `claimed`, `running`, `done`, `failed`,
  `unscored`, `skipped`) even though C0 exercises only ~4 of each. The spec must
  assert the full enum set via `PRAGMA table_info` or an insert-per-member test.
  `UNIQUE(session_id, stage)` is load-bearing for idempotent enqueue.

### Task B0.1.2: Register `0032` in the migration registry

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
- **Spec**: covered by B0.1.1's spec + existing registry specs
- **Details**: Registry entry shape documented at `index.ts:62-110`. Version 32.

### Task B0.1.3: Move `isUniqueConstraintError` into `persistence-sqlite`

- **File**: `libs/backend/persistence-sqlite/src/lib/` (new module; export from the lib's `index.ts`)
- **Spec**: `libs/backend/persistence-sqlite/src/lib/<module>.spec.ts` (new)
- **Details**: Move from `libs/backend/cron-scheduler/src/lib/run.store.ts:49-53`.
  It is a pure better-sqlite3 concern.
- **Validation notes**: This is what lets `skill-synthesis` reuse the helper
  **without depending on `cron-scheduler`** — a hexagonal boundary requirement,
  not a tidy-up.

### Task B0.1.4: Re-point `cron-scheduler` at the moved helper

- **File**: `libs/backend/cron-scheduler/src/lib/run.store.ts`
- **Spec**: existing `run.store` spec — update the import, assert behaviour unchanged
- **Details**: Delete the local copy; import from `persistence-sqlite`. `cron-scheduler`
  already depends on `persistence-sqlite`, so no new edge is introduced.

**Acceptance**:
`nx test @ptah-extension/persistence-sqlite` — `0032` spec green, all 11 stage
members and all 7 status members insertable, every non-member rejected by the
`CHECK`; **and** `nx test @ptah-extension/cron-scheduler` — `run.store` specs
green against the relocated helper; **and** `nx lint @ptah-extension/persistence-sqlite`
passes (static-SQL rules).

---

## Batch B0.2: Widen `IPowerMonitor` with `isOnBattery()` (correction C6) ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: none
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: A port widening that ripples into every implementer across two
  libs and an app. Small but cross-cutting; a missed implementer is a build break.

### Task B0.2.1: Add `isOnBattery(): boolean` to the port

- **File**: `libs/backend/cron-scheduler/src/lib/power-monitor.interface.ts`
- **Spec**: `libs/backend/cron-scheduler/src/lib/power-monitor.interface.spec.ts` (new)
- **Spec ref**: implementation-plan.md §4 Phase 0 "Modified"; correction C6 (lines 979–987)
- **Details**: Widen `IPowerMonitor`; `NoopPowerMonitor.isOnBattery()` returns `false`.
- **Validation notes**: **Without this, criterion P0-5 is unbuildable** — the port
  exposes only `onResume`/`onSuspend` today (verified in full). Spec asserts
  `NoopPowerMonitor.isOnBattery() === false`.

### Task B0.2.2: Implement `isOnBattery()` in the Electron adapter

- **File**: `apps/ptah-electron/src/services/platform/electron-power-monitor.ts`
- **Spec**: co-located spec (create if absent)
- **Details**: `powerMonitor.isOnBatteryPower()`.

### Task B0.2.3: Sweep for any other `IPowerMonitor` implementer or stub

- **File**: repo-wide — any spec fake, VS Code stub, or CLI adapter implementing the port
- **Details**: Every implementer gains `isOnBattery()`. A missed one is a
  compile error, so `typecheck` is the gate.

**Acceptance**:
`nx test @ptah-extension/cron-scheduler` — `NoopPowerMonitor.isOnBattery() === false`;
**and** `nx typecheck ptah-electron` **and** `npm run typecheck:all` clean (proves
no implementer was missed).

---

## Batch B0.3: Queue store, budget store, types, DI tokens ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: B0.1
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The CAS claim is the at-most-once primitive for the whole
  feature. Concurrency-correctness work with a subtle guarded-re-open UPDATE —
  the opposite of mechanical.

### Task B0.3.1: Queue types

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-queue.types.ts`
- **Spec**: exercised by B0.3.2's specs
- **Details**: `SkillQueueStage`, `SkillQueueStatus`, `SkillQueueRow`, `EnqueueInput`.
  Stage/status unions must be exactly the eleven + seven members from `0032`.

### Task B0.3.2: `SkillQueueStore`

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-queue.store.ts`
- **Specs**:
  - `libs/backend/skill-synthesis/src/lib/queue/skill-queue.store.spec.ts` (enqueue idempotency + guarded re-open)
  - `libs/backend/skill-synthesis/src/lib/queue/skill-queue.store.claim.spec.ts` (**P0-2**)
  - `libs/backend/skill-synthesis/src/lib/queue/skill-queue.store.reap.spec.ts` (**P0-3**)
- **Spec ref**: implementation-plan.md §2.2 (lines 132–198), §6 P0-2 / P0-3
- **Details**: `enqueue`, `tryClaim` (CAS), `touchClaim`, `markDone` / `markFailed` /
  `markUnscored` / `markSkipped`, `reapStale`, `listEligibleWorkspaces`,
  `listEligible(root, limit)`, `listRecent(limit)`.
- **Validation notes**:
  - **Enqueue is NOT the at-most-once primitive.** One `db.transaction`: plain
    `INSERT`; on `isUniqueConstraintError` fall through to the guarded re-open
    `UPDATE … WHERE session_id=? AND stage=? AND status IN ('done','failed','unscored','skipped') AND turn_count < ?`.
    **No `INSERT OR IGNORE`, no UPSERT** (rule at `run.store.ts:6-9`).
  - **Correction C5**: today's `analyzedSessions` is a `Map<string, number>` of
    highest-analyzed turn count (`skill-synthesis.service.ts:111`, `:365-372`),
    **not a Set**. The `turn_count` column + guarded re-open must preserve
    "re-analyze only once the session grew" — durably and cross-window.
  - **Claiming IS the primitive**: CAS `UPDATE … SET status='claimed' … WHERE id=:id AND status IN ('queued','unscored')`
    inside `BEGIN IMMEDIATE`. `changes === 0` ⇒ another worker won ⇒ treat as
    success-by-other-worker and move on, exactly as `JobRunner` treats
    `SlotAlreadyClaimedError` (`job-runner.ts:119-125`). **Never throw.**
  - P0-2 spec uses ONE `better-sqlite3` **file** DB and TWO store instances with
    distinct `claimed_by`.
  - P0-3 spec: claim → rewind `claimed_at` to `now - ttl - 1` → `reapStale(ttl)`
    ⇒ `status='queued'`, `claimed_by IS NULL`. Companion case: `touchClaim`
    before the rewind leaves the row claimed (**R5**).

### Task B0.3.3: `SkillBudgetStore`

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-budget.store.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/queue/skill-budget.store.spec.ts` (**P0-6**, store half)
- **Details**: `spentToday()`, `record(usage)`, UTC `day_key` rollover.
- **Validation notes**: Spec must assert rollover **at UTC midnight**, not local.

### Task B0.3.4: DI tokens + registration

- **Files**: `libs/backend/skill-synthesis/src/lib/di/tokens.ts`,
  `libs/backend/skill-synthesis/src/lib/di/register.ts`
- **Spec**: extend the existing register spec if present
- **Details**: `SKILL_QUEUE_STORE = Symbol.for('PtahSkillSynthesisQueueStore')`,
  `SKILL_BUDGET_STORE = Symbol.for('PtahSkillSynthesisBudgetStore')`.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P0-2 spec proves exactly one of two
concurrent `tryClaim` calls returns a row (the other `null`); P0-3 proves reap +
`touchClaim` behaviour; budget spec proves UTC rollover.

---

## Batch B0.4: Foreground tracker + drain service + gate order ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: B0.2, B0.3
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The drain is the single highest-complexity unit in the commit —
  gate ordering, round-robin fairness, per-item budget accounting, and a
  never-throws contract. Tightly coupled business logic.

### Task B0.4.1: `ForegroundActivityTracker`

- **File**: `libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.spec.ts`
- **Details**: Subscribes to `SessionActivityRegistry`
  (`Symbol.for('SdkSessionActivityRegistry')`, `agent-sdk/src/lib/di/tokens.ts:46`),
  exposes `msSinceLastActivity()`. Cross-lib token declared locally the same way
  `INTERNAL_QUERY_SERVICE_TOKEN` is (`di/tokens.ts:17-19`), injected `{isOptional: true}`.
- **Validation notes**: The registry is **push-only** (`session-activity-registry.ts:55-57`)
  — it has no "is active" query, which is why this small stateful tracker exists.
  **No new port.**

### Task B0.4.2: `SkillDrainService`

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`
- **Specs**:
  - `libs/backend/skill-synthesis/src/lib/queue/skill-drain.gates.spec.ts` (**P0-4, P0-5, P0-6**)
  - `libs/backend/skill-synthesis/src/lib/queue/skill-drain.idempotency.spec.ts` (**P4-3**, second half — lands here because it tests the drain, not the digest)
- **Spec ref**: implementation-plan.md §4 Phase 0 (lines 504–511, 562–564), §6 P0-4…P0-6
- **Details**: Signature
  `drain(opts: { tier: 'frequent'|'nightly'|'weekly'; signal: AbortSignal; onBattery: boolean }): Promise<DrainSummary>`
  — **never throws**.
  Gate order, each yielding a `skipped` summary with a reason:
  `enabled` → `budget.spentToday >= maxTokensPerDay` → `pauseOnBattery && onBattery`
  → `msSinceLastActivity() < foregroundBackoffMs` → reap stale → per-workspace
  round-robin → per-item CAS claim → stage dispatch.
- **Validation notes**:
  - **R4**: never `ORDER BY enqueued_at` globally. Read distinct eligible
    `workspace_root` ordered by `skill_synthesis_workspace_cursor.last_drained_at ASC`
    (missing cursor = 0 = highest priority), take ≤ `perWorkspaceBatch` from each,
    stop at `maxItemsPerRun`, bump each visited cursor. Spec: three workspaces
    with 10/1/1 queued items yield **1/1/1** in the first tick.
  - **R3**: the budget check runs **per item**, not per drain, so cheap stages
    continue after an expensive one exhausts the budget. Once ≥ 80 % of budget is
    consumed, order the eligible set cheap-stages-first.
  - **R5**: assert at startup that `staleClaimTtlMs >= 3 × max(lane.timeoutMs)`;
    log a warning otherwise. Reaping runs at the head of every drain **and** at
    `SkillSynthesisService.start()`.
  - P0-4 spec: stub `msSinceLastActivity() → 1000` with `foregroundBackoffMs = 300000`
    ⇒ `{skipped: true, reason: 'foreground-active'}` and `tryClaim` **never called**.
  - P0-5 spec (restated per C6): `pauseOnBattery: true` + monitor stub `isOnBattery() → true`
    ⇒ `{skipped: true, reason: 'on-battery'}`, zero claims.
  - P0-6 spec: seed `spentToday = maxTokensPerDay`
    ⇒ `{skipped: true, reason: 'daily-token-budget-exhausted'}`, zero claims.

### Task B0.4.3: Register drain + tracker tokens

- **Files**: `libs/backend/skill-synthesis/src/lib/di/tokens.ts`,
  `libs/backend/skill-synthesis/src/lib/di/register.ts`
- **Details**: `SKILL_DRAIN_SERVICE = Symbol.for('PtahSkillSynthesisDrainService')`,
  `FOREGROUND_ACTIVITY_TRACKER = Symbol.for('PtahSkillForegroundActivityTracker')`.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — all four gate specs return the exact
documented `reason` strings with zero claims; the fairness spec yields 1/1/1;
`drain()` **resolves** in every failure path (assert no rejection).

---

## Batch B0.5: Settings keys + `skillSynthesis:queue` RPC ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: B0.3
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Dual-registration is order-dependent (contract before handler)
  and one missing allow-map entry silently 404s the method at runtime.

### Task B0.5.1: Eleven new settings keys + defaults

- **File**: `libs/backend/platform-core/src/file-settings-keys.ts`
- **Spec**: extend the existing `file-settings-keys` spec
- **Spec ref**: implementation-plan.md §4 Phase 0 "New settings" (lines 539–556)
- **Details**: Add to BOTH the key list (~`:114-133`, alongside the proven
  `skillSynthesis.triggers.*` block at `:143-149`) and `FILE_BASED_SETTINGS_DEFAULTS`
  (~`:266+`):

  | Key                                        | Default                                         |
  | ------------------------------------------ | ----------------------------------------------- |
  | `skillSynthesis.drain.cronExpr`            | `'*/15 * * * *'` (Q5)                           |
  | `skillSynthesis.drain.nightlyCronExpr`     | `'0 3 * * *'`                                   |
  | `skillSynthesis.drain.weeklyCronExpr`      | `'0 4 * * 0'`                                   |
  | `skillSynthesis.drain.maxItemsPerRun`      | `4`                                             |
  | `skillSynthesis.drain.perWorkspaceBatch`   | `1`                                             |
  | `skillSynthesis.drain.foregroundBackoffMs` | `300000`                                        |
  | `skillSynthesis.drain.pauseOnBattery`      | `true`                                          |
  | `skillSynthesis.drain.maxAttempts`         | `5`                                             |
  | `skillSynthesis.drain.staleClaimTtlMs`     | `900000`                                        |
  | `skillSynthesis.budget.maxTokensPerDay`    | `2000000` (`0` = unlimited)                     |
  | `skillSynthesis.trayKeepalive`             | `false` (Q4 — key ships here, tray ships in C5) |

- **Validation notes**: There is **no** `queueEnabled` flag. Phase 0 _replaces_
  the inline path; a dual path is exactly the parallel-implementation pattern the
  brief forbids. `skillSynthesis.enabled` remains the master switch.

### Task B0.5.2: Extend `SkillSynthesisSettingsSchema`

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
- **Spec**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts` (extend)
- **Details**: Adding to the schema is sufficient — the schema-driven `getSettings`
  loop at `skills-synthesis-rpc.handlers.ts:428-441` picks the keys up automatically.

### Task B0.5.3: `skillSynthesis:queue` wire contract

- **File**: `libs/shared/src/lib/types/rpc.types.ts`
- **Details**: Method map (~`:1631`) **and** allow-map (~`:2990`).
- **Validation notes**: **Correction C11** — `'skillSynthesis:'` is ALREADY in
  `ALLOWED_METHOD_PREFIXES`. **Do NOT add a redundant runtime-guard entry.** Only
  the compile-time half applies.

### Task B0.5.4: `skillSynthesis:queue` handler

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
- **Spec**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.queue.spec.ts` (new — **P0-7 part (a)**)
- **Details**: Returns `{ items: QueueRow[]; recentRuns: JobRunSummary[] }`.
- **Validation notes**: P0-7 was UNTESTABLE AS WRITTEN ("visible in Activity");
  this is the backend half of the restatement. `job_runs` rows already record
  status/duration/error (`0004_cron.ts`); surface them, do not re-derive them.

**Acceptance**:
`nx test @ptah-extension/rpc-handlers` — the queue spec returns seeded rows in
both arrays; **and** `nx test @ptah-extension/platform-core` (defaults present);
**and** `npm run typecheck:all` clean (proves the compile-time contract half).

---

## Batch B0.6: Enqueue-instead-of-analyze + cron registration ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: B0.4, B0.5
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: This is the behavioural switch-over — the moment the inline
  pipeline dies. Cross-file, cross-lib, and it must preserve the `turn_count`
  re-open semantic. Highest-regression-risk batch in C0.

### Task B0.6.1: Session end enqueues; it no longer analyzes

- **File**: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.enqueue.spec.ts` (new — **P0-1**)
- **Spec ref**: implementation-plan.md §4 Phase 0 "Modified" (lines 515–517)
- **Details**:
  - `:222-233` — the session-end callback **enqueues** instead of calling `analyzeSession`.
  - `:249-264` — `backfillEmbeddings` loses its `setTimeout(…, 5000)`; it becomes
    an `embedding`-stage drain item.
  - `:111`, `:277`, `:354-372` — `analyzedSessions` is **demoted to a same-process
    fast path only**; correctness moves to `UNIQUE(session_id, stage)` + `turn_count`.
- **Validation notes**: P0-1 spec fires the session-end callback with a stub
  `IInternalQuery` and asserts `internalQuery.execute` has **0** calls and
  `SkillQueueStore.enqueue` has exactly **1**, with `stage='prefilter'`.
  Do **not** delete `analyzedSessions` — demote it. Correction C5 applies.

### Task B0.6.2: Register three drain handlers + three jobs in `thoth-runtime`

- **File**: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`
- **Spec**: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts` (extend — **P0-extra**)
- **Details**: Exact shape of the daily-backup block at `:76-131`. The handler
  closure resolves `CRON_TOKENS.CRON_POWER_MONITOR` and
  `SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE` from the container and calls
  `drain({ tier, signal: ctx.signal, onBattery: monitor.isOnBattery() })`.
  - `@ptah/skills-drain-frequent`, `*/15 * * * *`, `handler:skills:drain:frequent`
  - `@ptah/skills-drain-nightly`, `0 3 * * *`, `handler:skills:drain:nightly`
  - `@ptah/skills-drain-weekly`, `0 4 * * 0`, `handler:skills:drain:weekly`
- **Validation notes**: **`skill-synthesis` must NEVER import `cron-scheduler`** —
  `thoth-runtime` is the seam, exactly as it already is for backups. Spec: call
  `startThothCron` twice; assert `handlerRegistry.register` called **once** per
  handler name (guarded by `has()`, as at `:77`) and `jobStore.upsert` called with
  the three fixed ids.

### Task B0.6.3: Same registration for the CLI tier

- **File**: `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` (~`:366-380`)
- **Spec**: `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts` (extend)

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P0-1 proves **zero** LLM calls at
session end; **and** `nx test @ptah-extension/thoth-runtime` — double-invocation
registers each handler once and upserts three fixed job ids; **and**
`nx test @ptah-extension/cli-engine` green.

---

## Batch B0.7: Activity surface for drain runs ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C0 (Phase 0)
- **Depends on**: B0.5
- **Recommended Executor**: `frontend-developer`
- **Execution Mode**: sequential
- **Rationale**: Angular signals + OnPush component work in the Skills tab; the
  only frontend batch in C0.

### Task B0.7.1: Render drain runs in the pipeline-status component

- **File**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts`
- **Spec**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts` (new — **P0-7 part (b)**)
- **Details**: Given N runs in state, render N `[data-testid="skills-drain-run"]`
  elements carrying status + duration. Replaces the bare rate-limit banner.
- **Validation notes**: `ChangeDetectionStrategy.OnPush` mandatory; signals +
  `inject()`. **R3**: ship a per-stage token counter here from day one so real
  cost is observable before it is tuned.

### Task B0.7.2: `skillSynthesis:queue` client method + state wiring

- **Files**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts`,
  `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`
- **Specs**: the co-located existing specs (extend)

**Acceptance**:
`nx test @ptah-extension/skill-synthesis-ui` — N seeded runs render N
`[data-testid="skills-drain-run"]` nodes with status + duration text.

---

# COMMIT 1 — Phase 1: trust + per-stage provider routing

Commit message: `feat(skill-synthesis): phase 1 — unscored verdicts + provider-agnostic lanes`

**CLI delegation is scoped to this commit only** (context.md line 11:
`cli_delegation: allowed for Phase 1 grunt work only`). Exactly one batch below
(B1.1) is recommended for a CLI executor. No batch outside C1 recommends one.

---

## Batch B1.1: Migration 0033 — judge columns + `display_name` ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B0.1 (registry ordering: 0032 must be registered first)
- **Recommended Executor**: `ptah-cli` CLI agent (`ptah-cli > gemini > codex > copilot`)
- **Fallback Executor**: `backend-developer`
- **Execution Mode**: sequential (single-file scaffolding)
- **Rationale**: Pure mechanical scaffolding — a structural copy of
  `0030_skill_event_metrics.ts` / `0031_task_specs_metadata.ts` with a fixed,
  fully-specified column list and static SQL. Zero architecture decisions. This is
  the Phase-1 grunt work the delegation allowance exists for. The CLI prompt must
  be fully self-contained with absolute paths and the verbatim DDL from plan §2.3.

### Task B1.1.1: Create `0033_skill_candidate_verdicts`

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/0033_skill_candidate_verdicts.ts`
- **Spec**: `libs/backend/persistence-sqlite/src/lib/migrations/0033_skill_candidate_verdicts.spec.ts`
- **Spec ref**: implementation-plan.md §2.3 (lines 202–219)
- **Details**: Eleven `ALTER TABLE skill_candidates ADD COLUMN` statements
  (`judge_score`, `judge_status`, `judge_reason`, `judge_novelty`,
  `judge_actionability`, `judge_scope`, `judge_generalization`,
  `judge_trigger_clarity`, `judge_panel_rationales`, `judged_at`, `display_name`)
  plus `idx_skill_candidates_judge ON skill_candidates(status, judge_status)`.
- **Validation notes**: Every column nullable or DEFAULTed, so `registerCandidate`'s
  fixed 14-column INSERT (`skill-candidate.store.ts:130-137`) is **untouched** —
  the same guarantee `pinned` (`0011_skills_v2.ts:2`) and `residency`
  (`0026_skill_residency.ts:11`) already rely on. `judge_panel_rationales` is
  created here, not in `0035`, because it is a judge column; Phase 3 only starts
  writing it. `skill_suggestions.judge_score` stays `REAL NOT NULL`
  (`0025_skill_suggestions.ts:16`) — **only the candidate score is nullable**.

### Task B1.1.2: Register `0033` in the registry

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`

**Acceptance**:
`nx test @ptah-extension/persistence-sqlite` — `0033` applies to a DB already at
version 32, all eleven columns present via `PRAGMA table_info`, and an existing
14-column `registerCandidate` INSERT still succeeds unchanged; **and**
`nx lint @ptah-extension/persistence-sqlite` (static-SQL rules) passes.

---

## Batch B1.2: `SkillCandidateStore` — read the new columns, write verdicts ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.1
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Reads use `SELECT *`, so a column is **invisible** to the store
  until both `RawCandidateRow` and `toCandidateRow` are updated — a silent-data-loss
  trap, not boilerplate.

### Task B1.2.1: Extend the row types

- **File**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.spec.ts` (extend)
- **Details**: `RawCandidateRow` (`:37-54`) + `toCandidateRow` (`:871-899`).

### Task B1.2.2: `recordJudgeVerdict(id, verdict)` and `setDisplayName(id, name)`

- **File**: same
- **Spec**: same
- **Details**: Use the dynamic-fragment style of `updateStatus` (`:304-323`).
- **Validation notes**: Add **sibling** methods — do **not** overload `updateStatus`.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — round-trip spec: write a verdict with
all five criteria, read the candidate back, assert every field survives; assert a
`NULL` `judge_score` reads back as `null` and not `0`.

---

## Batch B1.3: Generalize the curator auth resolver → provider auth resolver ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: none
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: A cross-lib rename touching `agent-sdk`, `auth-providers` and
  `libs/shared` with **no compatibility alias**. One missed call site is a build
  break; one wrong `scope` value is risk R1. Architecture-bearing — explicitly
  not CLI work.

### Task B1.3.1: Move + rename the port

- **File**: `libs/backend/agent-sdk/src/lib/auth/provider-auth-resolver.port.ts` (moved from `curator-llm-adapter/curator-auth-resolver.port.ts`)
- **Spec**: covered by B1.3.5's call-site specs
- **Spec ref**: implementation-plan.md §3.3 (lines 410–453); correction C1
- **Details**: `ICuratorAuthResolver` → `IProviderAuthResolver`. Signature widens
  by **one optional parameter**:
  `resolve(providerId: string, scope?: ProviderTierScope): Promise<OneShotAuthOverride | null>`.
- **Validation notes**: **Correction C1** — the _port_ lives in `agent-sdk`, the
  _impl_ in `auth-providers`. That direction is what keeps the dependency one-way
  and the generalization must preserve it. Because the new parameter is optional,
  the existing curator call site (`sdk-internal-query.curator-llm.ts:80`) compiles
  unchanged and behaves identically. **Do NOT add a second parallel resolver.**

### Task B1.3.2: Rename the DI token

- **File**: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (~`:77`)
- **Details**: `SDK_TOKENS.SDK_CURATOR_AUTH_RESOLVER` = `Symbol.for('SdkCuratorAuthResolver')`
  → `SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER` = `Symbol.for('SdkProviderAuthResolver')`.
  **No compatibility alias.**

### Task B1.3.3: Rename the implementation, error and helpers

- **File**: `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts` (renamed from `curator-auth-resolver.ts`)
- **Spec**: the co-located existing spec (rename + extend)
- **Details**:
  - `CuratorAuthResolver` → `ProviderAuthResolver` (five-way dispatch off
    `resolveStrategy('thirdParty', provider)` unchanged: direct-anthropic / cli /
    proxy / local-native / third-party-key).
  - `CuratorAuthError` (name `'CuratorAuthError'`) → `ProviderAuthError`
    (name `'ProviderAuthError'`); update the name check at
    `sdk-internal-query.curator-llm.ts:36,86`.
  - `buildCuratorEnv` → `buildLaneEnv` (`:317-323`) — **semantics unchanged**.
  - `buildTierValues(providerId)` → `buildTierValues(providerId, scope)` (`:255-279`),
    forwarding `scope` to `getModelTiers`.
- **Validation notes**: **R2 (CRITICAL, subtle).** `buildLaneEnv` blanks
  `CHAT_AUTH_KEYS` by **assigning `undefined`, never `delete`**, because
  `SdkQueryRunner` re-spreads the whole ambient `process.env` first (`:295`) and
  the override lands last — a _deleted_ key lets the chat provider's value survive
  into the lane. **Move the `buildCuratorEnv` doc comment (`:289-316`) verbatim to
  `buildLaneEnv`.** Never serialize, Zod-parse, `structuredClone`, or
  truthiness-filter a lane env.

### Task B1.3.4: `ProviderTierScope` gains `'lane'`

- **File**: `libs/shared/src/lib/types/rpc/rpc-providers.types.ts` (`:23`)
- **Spec**: co-located / consumer specs
- **Details**: `'mainAgent' | 'cliAgent'` → `'mainAgent' | 'cliAgent' | 'lane'`.
- **Validation notes**: **This is the cheapest correct move in the whole plan.**
  `ProviderModelsService.setModelTier` already guards its
  `this.authEnv[envVar] = …; process.env[envVar] = …` writes with
  `if (scope === 'mainAgent')` (`provider-models.service.ts:495-500`), so `'lane'`
  is **inert with respect to globals by construction**, not by discipline.
  `getModelTiers(id, 'lane')` reads `provider.<id>.lane.modelTier.<tier>`; with
  nothing persisted it returns all-nulls and `buildTierValues` falls back to
  `provider.defaultTiers` (`:266-268`) — precisely the "haiku tier of the selected
  provider" semantics, **with no hardcoded model id anywhere**.
  **Correction C2**: the method is `setModelTier` (singular) at
  `provider-models.service.ts:473-508`. There is no `setModelTiers`.
  **Q1 is settled**: ONE shared `'lane'` member. Per-lane model pinning is
  expressed by the lane's own `model` setting, not by four tier scopes.

### Task B1.3.5: Update every call site + DI registration

- **Files**: `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`,
  `libs/backend/auth-providers/src/lib/di/register.ts` (`:143-147`)
- **Specs**: the co-located existing specs
- **Details**: Register `ProviderAuthResolver` under `SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER`.
- **Validation notes**: The memory curator's **fallback** behaviour
  (`sdk-internal-query.curator-llm.ts:84-91`) is unchanged by this batch. Lanes
  deliberately diverge (Q2 — they stall); that divergence is implemented in B1.5
  and documented in B1.6.

**Acceptance**:
`nx test @ptah-extension/agent-sdk @ptah-extension/auth-providers @ptah-extension/shared`
green; **and** `npm run typecheck:all` clean; **and**
`grep -r "ICuratorAuthResolver\|SDK_CURATOR_AUTH_RESOLVER\|CuratorAuthError\|buildCuratorEnv" libs apps`
returns **zero** hits (proves no compatibility alias survived).

---

## Batch B1.4: Lane contract — types, config, resolver, widened `IInternalQuery` ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.3
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The lane contract is the abstraction every later phase is written
  against. Getting `LaneAuthOverride`'s type wrong re-leaks foreground credentials
  (R2). Architecture-bearing.

### Task B1.4.1: `lane.types.ts`

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/lane.types.ts`
- **Spec**: exercised by B1.4.3 / B1.5 specs
- **Spec ref**: implementation-plan.md §3.1 (lines 309–365)
- **Details**: `SkillLaneId = 'archaeologist' | 'synthesis' | 'judge' | 'replay'`;
  `SkillLaneConfig` (`id`, `provider`, `model`, `defaultTier`, `structuredOutput`,
  `toolUse`, `timeoutMs`, `maxInputChars`, `maxPasses`); `LaneAuthOverride`;
  `ResolvedSkillLane`; `SkillLaneFailureKind`; `SkillLaneFailure`; `SkillLaneResolution`.
- **Validation notes**: **R2** —
  `LaneAuthOverride.env: Readonly<Record<string, string | undefined>>`.
  The `| undefined` is **LOAD-BEARING**; typing it `Record<string, string>` is a
  defect. **No provider id may appear as a literal anywhere in this file** — the
  `provider` field's doc comment must say so.

### Task B1.4.2: `skill-lane-config.ts`

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.spec.ts`
- **Details**: `SKILL_LANE_KEYS`, `SKILL_LANE_DEFAULTS`, `SKILL_LANE_PREFIXES`,
  `readSkillLanes(ws)`, `flattenSkillLanes(partial)`.
- **Pattern to follow**: **Direct structural copy** of
  `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts`
  (`:6-24`, `:26-44`, `:46-54`, `:73-140`, `:142-166`) — the house pattern for
  dotted settings sub-trees (verified present).

### Task B1.4.3: `LaneResolverService`

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts`
- **Specs**:
  - `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.spec.ts` (**P1-3**, resolver half)
  - `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.providers.spec.ts` (**P1-4**)
- **Spec ref**: implementation-plan.md §3.3 (lines 455–489), §6 P1-3 / P1-4
- **Details**: `resolve(laneId): Promise<SkillLaneResolution>`. Injects
  `PROVIDER_AUTH_RESOLVER_TOKEN` `{isOptional: true}` (no-op in CLI/e2e, matching
  `sdk-internal-query.curator-llm.ts:47`). Model resolution is exactly three lines:
  ```ts
  if (cfg.model.trim()) return cfg.model.trim();
  if (!cfg.provider.trim()) return resolveJudgeModel(settings.judgeModel, ws); // legacy inherit
  return cfg.defaultTier; // bare tier alias
  ```
- **Validation notes**:
  - Line 2 is the **untouched-existing-installs guarantee** (`model-resolver.ts:20-35`).
    With both lane `provider` and `model` at `''` the resolver returns
    `{auth: undefined, model: resolveJudgeModel(...)}` — **byte-identical to today's
    call** (`skill-judge.service.ts:59`, `skill-synthesizer.service.ts:107-110`).
  - A **bare tier alias is the correct value to send**: per
    `sdk-internal-query.curator-llm.ts:38-55` it resolves through both
    `ANTHROPIC_DEFAULT_<TIER>_MODEL` and the provider entry's `defaultTiers`,
    whereas a pinned dated Claude id 404s against a non-Anthropic endpoint.
  - **R7**: always set explicit `ANTHROPIC_DEFAULT_*_MODEL` values via
    `buildTierValues` **before** any provider identification happens, so the tier
    lookup never depends on `getActiveProviderId`'s known-defective hostname-substring
    match (`curator-auth-resolver.ts:236-253`). Log the resolved
    `(providerId, baseUrl, tier models)` triple per lane run.
  - **P1-4 spec is parameterized over the registry, and its body must contain
    ZERO provider-id literals**: `it.each(ANTHROPIC_PROVIDERS.map(p => p.id))`.
    For each id assert `auth.env.ANTHROPIC_BASE_URL === getProviderBaseUrl(id)`
    (or the proxy handle url), that `ANTHROPIC_API_KEY` is present-with-`undefined`
    or `''`, and that no key of `auth.env` equals a chat-tier value seeded into
    `process.env`.
  - `requiresProxy: true` providers work unchanged via
    `resolveProxyProvider` → `CuratorProxyManager.ensureProxy`
    (`curator-auth-resolver.ts:167-186`). **Lanes must never bypass the resolver.**

### Task B1.4.4: Widen the local `IInternalQuery`

- **File**: `libs/backend/skill-synthesis/src/lib/internal-query.interface.ts`
- **Spec**: exercised by B1.5 specs
- **Spec ref**: implementation-plan.md §3.2 (lines 367–408)
- **Details**: Add `auth?: LaneAuthOverride`, `outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }`,
  and on the stream: `structured_output?`, `usage?`, `total_cost_usd?`.
- **Validation notes**: **KEEP THE FILE LOCAL** — its header at `:1-9` explains why
  (no circular dep). `libs/backend/skill-synthesis` keeps **ZERO direct SDK
  imports**. Assignability is already verified: `InternalQueryConfig` declares
  `outputFormat?: OutputFormat` (`internal-query.types.ts:61`) and
  `auth?: OneShotAuthOverride` (`:69`); `InternalQueryService.execute` is a pure
  field-by-field forward to `SdkQueryRunner.runOneShot`.

### Task B1.4.5: Lane DI tokens

- **Files**: `libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `di/register.ts`

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P1-3 asserts
`IProviderAuthResolver.resolve` is called once per lane with that lane's id and
`scope === 'lane'`; P1-4 passes for **every** id in `ANTHROPIC_PROVIDERS` with no
provider-id literal in the spec body; a lane with `provider: ''` and `model: ''`
resolves to `{auth: undefined}` and the legacy model string.

---

## Batch B1.5: `LaneRunner` + the R1/R2 guards ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.4, B0.3 (budget store)
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: **The single highest-risk batch in the task.** It owns the
  structured-output→manual-parse ladder, the four failure modes, and the
  byte-for-byte env-immutability guard against R1. A failure here is
  release-blocking.

### Task B1.5.1: `LaneRunnerService`

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.spec.ts`
- **Spec ref**: implementation-plan.md §3.4 (lines 470–489), §4 Phase 1 (line 593)
- **Details**: **One place** owns: build `AbortController` + `cfg.timeoutMs` timer;
  call `internalQuery.execute` with `auth` / `outputFormat`; drain the stream;
  apply the structured-output→manual-parse ladder; record usage into
  `SkillBudgetStore`; map thrown/aborted outcomes to `SkillLaneFailure`.
  **Every stage goes through it; no stage builds its own timeout again.**
  The four failure modes:

  | Kind                            | Detection                                                                                                                                       | Behaviour                                                                                                                                                                                                            |
  | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `auth-unresolvable`             | resolver throws `ProviderAuthError` for a **non-empty** configured provider                                                                     | queue row → `queued`, `not_before = now + 30 min`, `reason = "Lane <id>: <message>"`. **Never** falls back to the active provider (Q2).                                                                              |
  | `structured-output-unsupported` | lane declares `'parse'`; **or** `'sdk'` declared but the `result` message carried no `structured_output` and `JSON.parse(message.result)` threw | re-run the same prompt **without** `outputFormat`, parse with the manual extractors. **At most ONE re-run per item per drain.** If the fallback also fails: stage → `unscored`, candidate `judge_status='unscored'`. |
  | `tool-use-unsupported`          | lane declares `toolUse: 'none'`; **or** pass 1 ends with `subtype === 'error_max_turns'` or returns no parseable `requestTurns`                 | collapse to a **single tail-window pass** (`maxPasses = 1`), persist `degraded_reason`. **Never loop to timeout.** Degrade **once**.                                                                                 |
  | `timeout`                       | per-lane `AbortController` fires after `cfg.timeoutMs`                                                                                          | `abort()`, `handle.close()`, queue → `queued`, `not_before = now + min(2^attempt × 60s, 6h)`. At `attempt_count >= maxAttempts` (5) → `failed` + `last_error` + one Activity event.                                  |

- **Validation notes**: `timeoutMs` and `maxInputChars` become **parameters**,
  replacing the module constants `JUDGE_TIMEOUT_MS = 15_000`
  (`skill-judge.service.ts:26`), `SYNTHESIS_TIMEOUT_MS = 30_000`
  (`skill-synthesizer.service.ts:15`), the `8000`/`3000` slices
  (`skill-synthesizer.service.ts:193,151`) and the `3000` body slice
  (`skill-judge.service.ts:69`). On truncation append a `…(truncated)…` marker and
  set `payload.truncated = true`.

### Task B1.5.2: Env-immutability spec (**P1-5** — release-blocking)

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.env-immutability.spec.ts`
- **Details**: Snapshot `JSON.stringify(process.env)` and a deep clone of the
  injected `AuthEnv` singleton **before** the run; execute a full lane run against
  a fake `IInternalQuery`; assert both compare **strictly equal** afterwards. Run
  once per lane id **and** once for a `requiresProxy` provider.
- **Validation notes**: **This is the guard against R1.** `ProviderModelsService`
  has TWO global-mutating paths: `setModelTier` (`:495-500`, scope-guarded) and
  **`applyPersistedTiers` (`:617-643`, NO scope guard at all — correction C4)**.
  Any lane path touching either is a defect. Treat a failure here as
  release-blocking.

### Task B1.5.3: Parse-fallback spec (**P1-6**)

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.parse-fallback.spec.ts`
- **Details**: Case 1 — lane declares `'parse'`: assert `internalQuery.execute`
  was called **without** `outputFormat`; feed a stream whose assistant text wraps
  JSON in prose + a code fence; assert `extractJsonObject` recovered it. Case 2 —
  lane declares `'sdk'` but the `result` message has no `structured_output` and a
  non-JSON `result`: assert **exactly one** re-run without `outputFormat`.
- **Validation notes**: **KEEP the manual parsers.** `extractJsonObject`
  (`skill-synthesizer.service.ts:210-231`) and the judge's `/\{[^{}]*\}/`
  (`skill-judge.service.ts:118`) are **load-bearing and MUST NOT be deleted** —
  they are the only path for a `'parse'` lane.

### Task B1.5.4: Limits spec (**P1-8**)

- **File**: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.limits.spec.ts`
- **Details**: Fake timers — a stream that never yields is aborted at exactly
  `cfg.timeoutMs`, producing `{kind: 'timeout'}`. Separately, a 50,000-char
  trajectory with `maxInputChars: 6000` yields a prompt of length ≤ 6000 + marker
  and `payload.truncated === true`.

### Task B1.5.5: Lib-scoped ESLint ban on the global-mutating methods ⚠️ NET-NEW FILE

- **File**: `libs/backend/skill-synthesis/eslint.config.mjs` (**does not exist — create it**)
- **Details**: `no-restricted-syntax` / `no-restricted-imports` banning
  `applyPersistedTiers` and `setModelTier` anywhere in the lib.
- **Validation notes**: **Gap found during decomposition** (§1.3 item 1). The plan
  (R1 mitigation b) assumes this file exists; it does not. The per-lib-config
  pattern is proven by `libs/web/members/eslint.config.mjs`, referenced at the
  root `eslint.config.mjs:9`. Add a fixture proving the rule actually fires.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P1-5 passes for all four lane ids and
for a `requiresProxy` provider; P1-6 both cases; P1-8 both cases; **and**
`nx lint @ptah-extension/skill-synthesis` fails on a deliberately-added
`setModelTier(` call and passes once removed.

---

## Batch B1.6: Judge unscored + promotion + lane-routed synthesis + naming ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.2, B1.5
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Changes the judge's return **shape**, which ripples into promotion
  semantics. Tightly coupled cross-file business logic — the core trust fix.

### Task B1.6.1: Judge returns a status, never a fabricated score

- **File**: `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/skill-judge.service.spec.ts` (extend — **P1-1, P1-11**)
- **Spec ref**: implementation-plan.md §4 Phase 1 "Modified" (lines 598–604); correction C8
- **Details**: Return type becomes
  `{ status: 'scored'|'unscored'|'disabled'; score: number | null; criteria: JudgeCriteria | null; reason: string }`.
  All **three** sites that currently `return { passed: true, score: 10, … }` —
  `:124` (no JSON match), **`:152` (invalid score values)**, `:176` (thrown error)
  — return `status: 'unscored', score: null` with a **distinct** `reason`.
  Delete `JUDGE_TIMEOUT_MS` in favour of the lane's `timeoutMs`.
- **Validation notes**: **Correction C8** — context.md cites only two fail-open
  sites (`:124`, `:176`); the third is **`:152`**. All three must convert.
  P1-11 adds a regression assertion that the literal `score: 10` **never** appears
  in a judge-verdict result. `unscored` is **neither pass nor block**: the
  candidate stays `candidate`, its queue row goes to `status='unscored'` with
  backoff, and the next drain retries.
  **Do not conflate the two `unscored` meanings** (plan §2.2):
  `skill_candidates.judge_status='unscored'` = no trustworthy score (the UI badge);
  `skill_synthesis_queue.status='unscored'` = the stage produced no usable verdict
  and the row stays re-eligible.

### Task B1.6.2: Promotion consumes the new decision shape

- **File**: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.spec.ts` (extend)
- **Details**: Persist via `SkillCandidateStore.recordJudgeVerdict`. P1-1 asserts
  a rate-limited judge leaves `status='candidate'`.

### Task B1.6.3: Synthesizer routes through `LaneRunner`

- **File**: `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.spec.ts` (extend)
- **Details**: Take `maxInputChars` from the lane; route through `LaneRunner`; add
  `outputFormat` (JSON Schema mirroring `SynthesizedSkillSchema`, `:17-21`).
- **Validation notes**: **KEEP `extractJsonObject` (`:210-231`)** — it is the
  `'parse'` lane's only path.

### Task B1.6.4: Curator routes through `LaneRunner`

- **File**: `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts` (extend)
- **Details**: Its own `internalQuery.execute` calls move onto the `synthesis`
  lane; `CURATOR_TIMEOUT_MS` becomes lane config.

### Task B1.6.5: `CandidateNamerService`

- **File**: `libs/backend/skill-synthesis/src/lib/naming/candidate-namer.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/naming/candidate-namer.service.spec.ts` (**P1-10 part (a)**)
- **Details**: A cheap `{name, description}`-only pass on the `judge` lane; writes
  `display_name`.
- **Validation notes**: P1-10 was UNTESTABLE AS WRITTEN (unbounded negative).
  Restated: given a 400-char first user message, the produced `display_name` is
  ≠ `trajectory.slug` and ≤ 60 chars; when the naming lane is unavailable,
  `display_name` stays `NULL`. The slugified first message
  (`trajectory-extractor.ts:136-138`) is retained as an internal id **ONLY**.

### Task B1.6.6: Document the deliberate divergence from the memory curator

- **File**: `libs/backend/skill-synthesis/CLAUDE.md`
- **Details**: Record that lanes **stall** on unresolvable auth while the memory
  curator **falls back** (`sdk-internal-query.curator-llm.ts:84-91`), and why:
  falling back here would put background work straight back onto the foreground
  quota — the exact defect Phase 1 exists to fix (Q2).

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — all three former fail-open paths
return `{status:'unscored', score:null}` with distinct reasons and **no** case
returns `score: 10`; promotion leaves a rate-limited candidate at
`status='candidate'`; the namer spec passes both branches.

---

## Batch B1.7: Lane failures inside the drain (**P1-7**) ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.5, B1.6, **B0.4 (cross-commit — see §0.1)**
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The only Phase-1 criterion that cannot be asserted without the
  Phase-0 drain. Small, but it is the seam where Q2's stall semantics become real.

### Task B1.7.1: Map `SkillLaneFailure` onto queue-row transitions

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/queue/skill-drain.failures.spec.ts` (**P1-7**)
- **Spec ref**: implementation-plan.md §3.4, §6 P1-7
- **Details**: `auth-unresolvable` → row back to `queued`, `not_before = now + 30 min`,
  `reason = "Lane <id>: <message>"`. **The drain catches this and continues to the
  next item — it must NEVER propagate out of `drain()`.**
- **Validation notes**: Spec asserts `drain()` **resolves** (does not reject), the
  row is `status='queued'` with `not_before > now` and a non-empty `reason`
  containing the lane id, **and that a following eligible item in the same tick
  still ran**. No fallback to the foreground provider, ever (Q2).

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — `skill-drain.failures.spec.ts` green,
including the "next item still ran" assertion.

---

## Batch B1.8: Lane settings keys + `getLanes` / `setLanes` RPC ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.4, B1.2
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Order-dependent dual-registration plus a wire-contract widening
  the frontend batches consume. Mirrors an existing pair, but the summary-type
  change ripples into the UI.

### Task B1.8.1: 28 lane settings keys + defaults

- **File**: `libs/backend/platform-core/src/file-settings-keys.ts`
- **Spec**: extend the existing spec
- **Details**: Four lanes × seven fields, dotted under
  `skillSynthesis.<lane>.{provider,model,defaultTier,structuredOutput,toolUse,timeoutMs,maxInputChars}`
  (+ `maxPasses` where applicable). Added to BOTH the key list and
  `FILE_BASED_SETTINGS_DEFAULTS`.
- **Validation notes**: Dotted keys are proven — `skillSynthesis.triggers.*`
  already lives at `:143-149`. Every lane default is `provider: ''`, `model: ''`
  ⇒ "Inherit from active provider" ⇒ byte-identical to today's behaviour.

### Task B1.8.2: `skillSynthesis:getLanes` / `setLanes`

- **Files**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
- **Specs**: `skills-synthesis-rpc.handlers.spec.ts`, `skills-synthesis-rpc.schema.spec.ts` (extend)
- **Pattern to follow**: the existing `getTriggers` / `setTriggers` pair —
  structurally identical.

### Task B1.8.3: Widen `SkillSynthesisCandidateSummary`

- **File**: `libs/shared/src/lib/types/rpc.types.ts` (`:1908-1920`, plus method map and allow-map)
- **Details**: Add `displayName: string | null`, `judgeScore: number | null`,
  `judgeStatus: 'scored'|'unscored'|'disabled'|null`, `judgeReason: string | null`,
  `judgeCriteria: {novelty;actionability;scope;generalization;triggerClarity} | null`.
- **Validation notes**: **Correction C11** — compile-time half only. `skillSynthesis:`
  is already in `ALLOWED_METHOD_PREFIXES`; do NOT add a runtime-guard entry.

**Acceptance**:
`nx test @ptah-extension/rpc-handlers @ptah-extension/platform-core` green —
`getLanes` round-trips through `setLanes` with all 28 keys; **and**
`npm run typecheck:all` clean.

---

## Batch B1.9: Extract `ptah-provider-model-picker` into `libs/frontend/ui` ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: none (frontend-only; independent of the backend batches)
- **Recommended Executor**: `frontend-developer`
- **Execution Mode**: sequential
- **Rationale**: The injected-loader port is an Nx **boundary requirement**, not a
  style choice — getting it wrong is a lint error, not a preference. Architecture-bearing.

### Task B1.9.1: `provider-models-loader.port.ts`

- **File**: `libs/frontend/ui/src/lib/native/provider-model-picker/provider-models-loader.port.ts`
- **Details**: `PROVIDER_MODELS_LOADER` `InjectionToken` + `ProviderModelsLoader` interface.
- **Validation notes**: **Why the picker MUST take an injected loader**:
  `libs/frontend/ui` is tagged `["scope:webview","type:ui"]` and the Nx boundary
  rule at `eslint.config.mjs:232-234` restricts `type:ui` to `['type:ui','type:util']`.
  `@ptah-extension/core` (which owns `VSCodeService`) is `type:core` — **importing
  it from `ui` is a lint error**. `@ptah-extension/shared` is `type:util`, so
  `ANTHROPIC_PROVIDERS` / `ProviderModelInfo` are legal.

### Task B1.9.2: `ProviderModelPickerComponent`

- **File**: `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts`
- **Spec**: `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.spec.ts` (**P1-9 part (a)**)
- **Details**: Inputs `{provider, model, label}`, a change output. Enumerates
  `ANTHROPIC_PROVIDERS`. Signals + `inject()`, `ChangeDetectionStrategy.OnPush`.
- **Validation notes**:
  - **R6 mitigation layer 1**: surface `ProviderModelInfo.supportsToolUse` and
    `contextLength` (`rpc-providers.types.ts:34-36`) — **warn** when a model chosen
    for a `toolUse: 'required'` lane reports `supportsToolUse: false`, and
    **suggest** `maxInputChars` from `contextLength`. **Zero provider-id branching.**
  - P1-9 (a) restatement: the component mounts with **only** `PROVIDER_MODELS_LOADER`
    provided, and the spec asserts the injector requests **no other token** — no
    `VSCodeService`, no `isElectron` gate.

### Task B1.9.3: Export from the native barrel

- **Files**: `libs/frontend/ui/src/lib/native/provider-model-picker/index.ts`,
  `libs/frontend/ui/src/lib/native/index.ts`

### Task B1.9.4: Dependency-boundary spec (**P1-9 part (b)**) ⚠️ NET-NEW PATTERN

- **File**: `libs/frontend/ui/src/lib/dependency-boundaries.spec.ts` (**no such spec exists anywhere — create it**)
- **Details**: Assert `libs/frontend/ui` does not depend on `@ptah-extension/core`.
- **Validation notes**: **Gap found during decomposition** (§1.3 item 2). The plan
  says the rule is "already enforced by `eslint.config.mjs:232-234`, pinned by a
  `dependency-boundaries.spec.ts`-style check" — the ESLint rule exists; the spec
  does not (`find libs -name "dependency-boundaries*"` → empty). This task creates
  the first one.

**Acceptance**:
`nx test @ptah-extension/ui` — the picker mounts with only `PROVIDER_MODELS_LOADER`
and the boundary spec passes; **and** `nx lint @ptah-extension/ui` clean (proves
no `type:core` import crept in).

---

## Batch B1.10: Re-point consumers, DELETE the forked picker, render trust UI ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.8, B1.9
- **Recommended Executor**: `frontend-developer`
- **Execution Mode**: sequential
- **Rationale**: A deletion plus two consumer rewrites across two libs. The delete
  is the point — a fork would strand VS Code users.

### Task B1.10.1: DELETE the local curator picker and re-point `memory-curator-ui`

- **Files to DELETE**:
  - `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/curator-model-picker.component.ts`
  - `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/curator-model-picker.component.spec.ts`
- **File to modify**: `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts`
- **Spec**: `memory-diagnostics-accordion.component.spec.ts` (extend)
- **Details**: Provide `PROVIDER_MODELS_LOADER` → `MemoryDiagnosticsRpcService`
  (its `listModels` at `memory-diagnostics-rpc.service.ts:79-95` already calls the
  generic `provider:listModels`) and render
  `<ptah-provider-model-picker label="Curator model">`.
- **Validation notes**: **DELETE, do not fork.** Also delete the stale footer note
  at the old `curator-model-picker.component.ts:105` ("full provider routing coming
  soon") — routing has shipped.

### Task B1.10.2: Lanes section + Phase-0 knobs in the Skills settings panel

- **File**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts`
- **Spec**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.spec.ts` (new)
- **Details**: Four picker instances (archaeologist / synthesis / judge / replay),
  each defaulting to **"Inherit from active provider"**, plus the Phase-0 knobs:
  daily token budget, foreground backoff, battery gating, tray-keepalive toggle
  (Electron only), drain schedule.
- **Validation notes**: The general Settings view **LINKS** to the Thoth settings
  tab rather than duplicating the controls. One source of truth.

### Task B1.10.3: `listModels` on the Skills RPC service

- **File**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts`
- **Spec**: `skill-synthesis-rpc.service.spec.ts` (extend)
- **Details**: `listModels(providerId?)`, provided as `PROVIDER_MODELS_LOADER`.

### Task B1.10.4: Unscored badge, scorecard, and non-echo titles

- **File**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.ts`
- **Spec**: `skill-candidates-table.component.spec.ts` (extend — **P1-1, P1-2, P1-10 part (b)**)
- **Details**:
  - `judgeStatus:'unscored', judgeScore:null` ⇒ `[data-testid="skills-candidate-judge-badge"]`
    with text `unscored` and **NO** numeric score node.
  - A `scored` summary ⇒ five `[data-testid="skills-candidate-criterion"]` nodes
    with correct labels/values.
  - Title renders `displayName` when set, `Captured workflow · {formattedDate}`
    when `null` — **NEVER** the raw `name` slug. Assert the slug string does not
    appear in the title node for a summary whose `displayName` is `null`.

**Acceptance**:
`nx test @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui`
green; **and** `git status` shows the two `curator-model-picker.component.*` files
**deleted**; **and** `grep -rn "curator-model-picker" libs apps` returns zero hits.

---

## Batch B1.11: Cross-host e2e for the extracted picker (**P1-9 part (c)**) ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C1 (Phase 1)
- **Depends on**: B1.10
- **Recommended Executor**: `senior-tester`
- **Execution Mode**: parallel (the two assertions are file-disjoint and target different harnesses)
- **Rationale**: Pure test authoring against two existing harnesses; no production
  code. The Jest half of P1-9 cannot distinguish the host, so this is the only
  place the "BOTH hosts" criterion is genuinely proved.

### Task B1.11.1: Electron e2e — Skills > Settings lane pickers render

- **File**: `apps/ptah-electron-e2e/src/**` (extend the Skills-tab spec)

### Task B1.11.2: Webview harness — the same pickers render in the VS Code webview

- **File**: `libs/frontend/webview-e2e-harness/src/**`

**Acceptance**:
`nx e2e ptah-electron-e2e` (Skills-tab spec) **and**
`nx test @ptah-extension/webview-e2e-harness` — the four lane pickers are present
and enumerate providers in both hosts.

---

# COMMIT 2 — Phase 2: session archaeologist

Commit message: `feat(skill-synthesis): phase 2 — session archaeologist replaces the regex verdict`

**Depends on C0 + C1.** Q3 is settled: orchestrated multi-pass retrieval driven
from TypeScript via `TranscriptWindowReader`, **NOT** SDK tool calling
(correction C7 — `OneShotRunInput` has no `allowedTools`/`disallowedTools` and
`buildOneShotOptions` hardcodes `tools: { type: 'preset', preset: 'claude_code' }`
at `:284-287`).

---

## Batch B2.1: Migration 0034 + verdict types + verdict store ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C2 (Phase 2)
- **Depends on**: B1.1 (registry ordering)
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The verdict row's nullability contract is the graceful-degradation
  record; getting it wrong makes the drain retry indefinitely.

### Task B2.1.1: Migration `0034_skill_session_verdicts`

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/0034_skill_session_verdicts.ts`
- **Spec**: `libs/backend/persistence-sqlite/src/lib/migrations/0034_skill_session_verdicts.spec.ts`
- **Spec ref**: implementation-plan.md §2.4 (lines 244–270)
- **Details**: `skill_session_verdicts` + `idx_ssv_ws` + `idx_ssv_evidence`.
  `evidence_class` `CHECK IN ('tests-green','user-accepted','no-correction','explicit-confirmation','unverified')`.
- **Validation notes**: **Nullability contract** — `intent`, `outcome`,
  `evidence_class`, `routine` are ALL nullable. A row with
  `degraded_reason NOT NULL` and `intent IS NULL` is the graceful-degradation
  record: it exists so the drain does not re-attempt indefinitely and so the UI
  can say _why_ there is no verdict. Register in `migrations/index.ts`.

### Task B2.1.2: Verdict types + output schema

- **File**: `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.types.ts`
- **Details**: `SessionVerdict`, `EvidenceClass`, `FrictionEntry`, `RoutineDraft`,
  plus `SESSION_VERDICT_JSON_SCHEMA` (the `outputFormat` schema).

### Task B2.1.3: `SessionVerdictStore`

- **File**: `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.store.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.store.spec.ts` (**P2-1**, store half)
- **Details**: Round-trip through the store preserves JSON shape for
  `friction_map` and `routine`.

**Acceptance**:
`nx test @ptah-extension/persistence-sqlite @ptah-extension/skill-synthesis` —
`0034` applies at version 33; all five `evidence_class` members insertable and
every non-member rejected; a degraded row (`intent IS NULL`,
`degraded_reason NOT NULL`) persists and round-trips.

---

## Batch B2.2: `TranscriptWindowReader` ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C2 (Phase 2)
- **Depends on**: none (pure function over an existing reader)
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Pure, deterministic, fully unit-testable — and it is the whole of
  Q3's answer. Isolating it makes the archaeologist batch tractable.

### Task B2.2.1: Windowed, turn-index-addressed transcript reader

- **File**: `libs/backend/skill-synthesis/src/lib/archaeology/transcript-window.reader.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/archaeology/transcript-window.reader.spec.ts`
- **Spec ref**: implementation-plan.md §4 Phase 2 "Created" (line 666)
- **Details**: `head(n)`, `tail(n)`, `range(from, to)`, `search(regex)` — all
  turn-index addressed and `maxInputChars`-bounded, over
  `JsonlReaderService.readJsonlMessages` (`jsonl-reader.service.ts:124`).
- **Validation notes**: **Pure and deterministic — no LLM, no I/O beyond the
  reader.** This is what makes the archaeologist work on a lane with no tool
  calling at all. Spec must cover the `maxInputChars` re-bound on an
  over-large requested range.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — all four accessors return
turn-index-correct slices; an over-large `range()` is re-bounded to
`maxInputChars` with the truncation marker.

---

## Batch B2.3: `SessionArchaeologistService` — orchestrated multi-pass ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C2 (Phase 2)
- **Depends on**: B2.1, B2.2, B1.5
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: The multi-pass loop with heartbeating, degradation, and a hard
  pass ceiling. Complex control flow; the highest-risk batch in C2.

### Task B2.3.1: The multi-pass analyzer

- **File**: `libs/backend/skill-synthesis/src/lib/archaeology/session-archaeologist.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/archaeology/session-archaeologist.service.spec.ts` (**P2-1**)
- **Spec ref**: implementation-plan.md §4 Phase 2 (lines 669–689)
- **Details**:
  - **Pass 1** — tail window (default 40 % of `maxInputChars`) + head window (10 %),
    with an `outputFormat`-constrained reply carrying optional
    `requestTurns: Array<{from:number;to:number}>` and `requestSearch: string[]`.
  - **Passes 2..`maxPasses`** — `TranscriptWindowReader` serves exactly the
    requested ranges / search hits, re-bounded by `maxInputChars`.
  - **Terminal pass** — a verdict with no further requests, or `maxPasses` reached.
  - Between passes call `SkillQueueStore.touchClaim(id)`.
- **Validation notes**: **R5** — the heartbeat is what makes a legitimate long run
  self-defending regardless of TTL. **R6** — `toolUse: 'none'` forces
  `maxPasses = 1`: **one code path, two configurations, no provider branching.**
  P2-1 spec: given a scripted two-pass stream, the stored row has `intent`,
  `evidence_class`, `friction_map` with **integer** `turnIndex` values, and
  `routine.citations` as a non-empty `number[]`.

### Task B2.3.2: Graceful null degradation

- **Spec**: `libs/backend/skill-synthesis/src/lib/archaeology/session-archaeologist.degraded.spec.ts` (**P2-3**)
- **Details**: Case 1 — with `INTERNAL_QUERY_SERVICE_TOKEN` unregistered, a verdict
  row exists with `intent === null` and `degraded_reason === 'no-query-path'`, the
  call **resolves** (no throw), and synthesis fell back to the extractor path.
  Case 2 — `toolUse:'none'` lane ⇒ `passes === 1` and
  `degraded_reason === 'tool-use-unsupported'`.
- **Validation notes**: **No exception, no retry storm.**

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P2-1 and both P2-3 cases green;
assert `touchClaim` was called between passes.

---

## Batch B2.4: Demote the regex, feed the verdict to synthesis, wire the stage ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C2 (Phase 2)
- **Depends on**: B2.3
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Changes what "success" **means** across the pipeline. Cross-file
  semantic change — the payoff of the whole phase.

### Task B2.4.1: Demote `SUCCESS_MARKERS` to prefilter signal only

- **File**: `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/archaeology/regex-demotion.spec.ts` (**P2-2**)
- **Details**: `SUCCESS_MARKERS` (`:17-26`) and `hasSuccessMarker` (`:269-281`)
  are removed from **every** promotion/eligibility decision.
  `ExtractedTrajectory.hasSuccessMarker` is already documented "Informational
  signal" (`:49`) — this makes that true. **Also: the dead `void minTurns;` at
  `:106` is deleted and `minTurns` is honoured, or the parameter is removed —
  pick one, do not leave it dead.**
- **Validation notes**: P2-2 spec — a trajectory whose final assistant turn matches
  `SUCCESS_MARKERS` (`:19`) gives `hasSuccessMarker === true`; the archaeologist
  returns `evidence_class: 'unverified'`; assert promotion/ranking treats the
  session as unverified **and that no code path reads `hasSuccessMarker` to decide
  success** (assert via the injected verdict, not via the flag).

### Task B2.4.2: Synthesis consumes the verdict, not the 8k slice

- **File**: `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts`
- **Spec**: `skill-synthesizer.service.spec.ts` (extend)
- **Details**: `buildPrompt` (`:187-196`) consumes `intent` + `routine` + turn
  citations instead of `canonicalText.slice(0, 8000)`. **`canonicalText` stays —
  for embedding/dedup only.**

### Task B2.4.3: Widen prefilter eligibility to friction-rich sessions

- **File**: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (`passesPrefilter`, `:711-727`)
- **Spec**: `skill-synthesis.service.spec.ts` (extend)
- **Details**: `passesPrefilter` becomes eligibility-to-spend-tokens only.
  **Failure sessions with eventual success become ELIGIBLE** — a friction-rich
  verdict is valuable material. This deliberately widens today's
  smooth-success-only harvest.

### Task B2.4.4: Wire the `archaeology` stage into the drain

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`
- **Spec**: `skill-synthesis.service.enqueue.spec.ts` (extend — **P2-4**)
- **Details**: `archaeology` is a **nightly**-tier stage (R3), never frequent.
  Canonical chain: `prefilter → archaeology → synthesis → embedding`.
- **Validation notes**: P2-4 — assert `SessionArchaeologistService.analyze` has
  **0** calls after a session-end event, and **≥ 1** call after `drain()` processes
  the `archaeology` stage.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P2-2 proves a `"done."` tail no longer
suffices against an `unverified` verdict; P2-4 proves zero inline invocations and
≥ 1 from the drain; the synthesizer spec proves the prompt is built from the
verdict, not from a `canonicalText` slice.

---

# COMMIT 3 — Phase 3: empirical gates

Commit message: `feat(skill-synthesis): phase 3 — replay confidence, measured trigger score, judge panel`

**Depends on C0 + C1. Consumes C2's verdict when present, with a documented
fallback — C3 ships and passes CI whether or not C2 has landed.**

---

## Batch B3.1: Migration 0036 + store writers + gate settings ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C3 (Phase 3)
- **Depends on**: B1.2
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Same `SELECT *` invisibility trap as B1.2 — the columns are dark
  until both row types are updated.

### Task B3.1.1: Migration `0036_skill_empirical_gates`

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/0036_skill_empirical_gates.ts`
- **Spec**: `.../0036_skill_empirical_gates.spec.ts`
- **Spec ref**: implementation-plan.md §2.3 (lines 221–230)
- **Details**: `replay_confidence`, `replay_holdout_session_id`, `replay_at`,
  `trigger_score`, `trigger_precision`, `trigger_recall`, `trigger_eval_at`.
  Register in `migrations/index.ts`.
- **Validation notes**: `judge_panel_rationales` is NOT here — it shipped in
  `0033`. Phase 3 only starts writing it.

### Task B3.1.2: Store readers + writers

- **File**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- **Spec**: `skill-candidate.store.spec.ts` (extend)
- **Details**: Extend `RawCandidateRow` + `toCandidateRow`; add sibling
  `recordReplay(id, …)` and `recordTriggerEval(id, …)` in the `updateStatus`
  dynamic-fragment style. **Do not overload `updateStatus`.**

### Task B3.1.3: Five gate settings keys + defaults

- **Files**: `libs/backend/platform-core/src/file-settings-keys.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
- **Details**: `skillSynthesis.replay.enabled` (`true`),
  `skillSynthesis.replay.minConfidence` (`0.5`),
  `skillSynthesis.triggerEval.enabled` (`true`),
  `skillSynthesis.judgePanel.enabled` (`true`),
  `skillSynthesis.judgePanel.disagreementThreshold` (`3`).

**Acceptance**:
`nx test @ptah-extension/persistence-sqlite @ptah-extension/skill-synthesis @ptah-extension/platform-core`
— `0036` applies at version 35; a `NULL` `replay_confidence` reads back as `null`,
not `0`.

---

## Batch B3.2: `ReplayValidatorService` + the verdict-absent fallback ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C3 (Phase 3)
- **Depends on**: B3.1, B1.5
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Hold-out selection plus a plan-only safety contract; the fallback
  is what decouples C3 from C2.

### Task B3.2.1: Replay validator

- **File**: `libs/backend/skill-synthesis/src/lib/gates/replay-validator.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/gates/replay-validator.service.spec.ts` (**P3-1**, replay half)
- **Spec ref**: implementation-plan.md §4 Phase 3 (line 718)
- **Details**: Hold out one cluster member; give a fresh `replay`-lane call the
  drafted skill + the held-out session's **opening user prompt**; a comparator
  call scores plan-vs-actual alignment 0–1. Persist `replay_confidence` +
  `replay_holdout_session_id`.
- **Validation notes**: **PLAN-ONLY, NO FILE WRITES** — enforced by the prompt
  contract **and** by setting `cwd` to `os.homedir()`, exactly as the judge already
  does at `skill-judge.service.ts:99`. **R8**: weekly tier only; gated by
  `replay.enabled`.

### Task B3.2.2: Verdict-absent fallback

- **Spec**: `libs/backend/skill-synthesis/src/lib/gates/verdict-fallback.spec.ts` (**P3-extra**)
- **Details**: With no `skill_session_verdicts` row (or `degraded_reason NOT NULL`),
  replay and trigger-eval fall back to `ExtractedTrajectory.canonicalText` +
  `shortDescription` and set `payload.verdictFallback = true` on the queue row.
- **Validation notes**: **This is the C2 ⇢ C3 soft edge.** It is what lets C3 ship
  and pass CI whether or not C2 has landed, and it lets the Activity tab show that
  the gate ran on weaker evidence.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — a scripted replay stream yields a 0–1
confidence written to `replay_confidence` with `replay_holdout_session_id` set to
the excluded member; the fallback spec passes with the verdict table empty.

---

## Batch B3.3: `TriggerEvalService` — measured, zero-LLM retrieval eval ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C3 (Phase 3)
- **Depends on**: B3.1
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Self-contained scoring logic over local embeddings; no lane
  dependency for the retrieval itself.

### Task B3.3.1: Trigger retrieval eval

- **File**: `libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.spec.ts` (**P3-1**, trigger half)
- **Spec ref**: implementation-plan.md §4 Phase 3 (line 719)
- **Details**: Generate ~5 should-trigger + ~5 near-miss prompts; run
  **description-only retrieval against the ACTIVE library using local embeddings**
  (`IEmbedder` + `SkillCandidateStore.searchActiveByEmbedding`, `:784`). Persist
  `trigger_precision`, `trigger_recall`, `trigger_score`. Also emit
  description-collision findings that cosine dedup misses.
- **Validation notes**: **Zero LLM cost for the retrieval itself** — only the
  prompt generation touches a lane. Spec uses a stub embedder.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — trigger-eval over a stub embedder
yields precision/recall and a derived `trigger_score`; a deliberate description
collision is reported.

---

## Batch B3.4: `JudgePanelService` + the new promotion rule ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C3 (Phase 3)
- **Depends on**: B3.2, B3.3, B1.6
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Escalation logic plus a promotion-rule change — the gate that
  decides what ships to users.

### Task B3.4.1: Two-judge panel with disagreement escalation

- **File**: `libs/backend/skill-synthesis/src/lib/gates/judge-panel.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/gates/judge-panel.service.spec.ts` (**P3-2**)
- **Details**: **Two plain `IInternalQuery` calls on the `judge` lane.** On any
  per-criterion delta > `disagreementThreshold` (3), escalate that candidate to
  the `synthesis` lane with both rationales; persist all rationales to
  `judge_panel_rationales`.
- **Validation notes**: **NO `tribunal` import** (hard constraint). P3-2 spec:
  judge A `novelty: 9`, judge B `novelty: 4` (delta 5 > 3) ⇒ a **third**
  `internalQuery.execute` call whose lane is `synthesis`, whose prompt contains
  both rationales, and all three rationales land in `judge_panel_rationales`.
  Control case delta 2 ⇒ **exactly two** calls. **Also assert
  `@ptah-extension/tribunal*` is not imported anywhere in
  `libs/backend/skill-synthesis`.** **R8**: the second judge only runs when the
  first produced a `scored` verdict.

### Task B3.4.2: Promotion rule + measured ranking

- **File**: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`
- **Spec**: `skill-promotion.service.spec.ts` (extend)
- **Details**: `promoted` requires
  `judgeStatus === 'scored' && judgeScore >= minJudgeScore`
  **AND** (`replayConfidence >= minReplayConfidence` **OR** `replayConfidence IS NULL`).
  Ranking uses the **measured** `trigger_score` in place of the judged
  `triggerClarity` (which is still persisted, for comparison).
- **Validation notes**: **Replay is an evidence booster, never a hard blocker**,
  until telemetry proves it stable.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — P3-2 both cases; a candidate with
`replayConfidence === null` still promotes on a passing judge score; a candidate
with `replayConfidence` below `minConfidence` does not.

---

## Batch B3.5: Weekly stage wiring + gate results in the UI ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C3 (Phase 3)
- **Depends on**: B3.4
- **Recommended Executor**: `frontend-developer`
- **Execution Mode**: sequential
- **Rationale**: One small backend wiring task plus the display half of P3-1;
  frontend-dominant.

### Task B3.5.1: Wire `judge-panel`, `replay`, `trigger-eval` into the weekly drain

- **File**: `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`
- **Spec**: `skill-drain.gates.spec.ts` (extend)
- **Details**: Cluster chain
  `clustering → cluster-synthesis → judge → judge-panel → replay`
  with `workspace_root = ''` (clustering is cross-project — Phase 0 item 8).
  `trigger-eval` is a dependency-free weekly root.

### Task B3.5.2: Render replay confidence + measured trigger score

- **File**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.ts`
- **Spec**: `skill-candidates-table.component.spec.ts` (extend — **P3-1**, display half)
- **Details**: Both values render, and render as **"not measured"** when `null`.

### Task B3.5.3: Extend the candidate summary contract

- **File**: `libs/shared/src/lib/types/rpc.types.ts`
- **Details**: `replayConfidence: number | null`, `triggerScore: number | null`,
  `judgePanelRationales` on `SkillSynthesisCandidateSummary`. Compile-time half
  only (correction C11).

**Acceptance**:
`nx test @ptah-extension/skill-synthesis-ui @ptah-extension/skill-synthesis` —
`null` gate values render "not measured" and never `0` or `0.0`; the weekly drain
spec dispatches the three new stages.

---

# COMMIT 4 — Phase 4: proactive gap-detection curator

Commit message: `feat(skill-synthesis): phase 4 — win-rate join and ranked weekly digest`

**Depends on C0 + C1. Win rate degrades gracefully without C2.**

---

## Batch B4.1: Migration 0037 + the workspace-root thread-through (correction C10) ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C4 (Phase 4)
- **Depends on**: B3.1 (registry ordering)
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Fixes a live silent-data-loss bug (C10) and adds the index the
  whole phase's join depends on.

### Task B4.1.1: Migration `0037_skill_invocation_session_join`

- **File**: `libs/backend/persistence-sqlite/src/lib/migrations/0037_skill_invocation_session_join.ts`
- **Spec**: `.../0037_skill_invocation_session_join.spec.ts`
- **Spec ref**: implementation-plan.md §2.5 (lines 272–303); correction C10
- **Details**: `ALTER TABLE skill_invocation_events ADD COLUMN workspace_root TEXT;`
  - `CREATE INDEX idx_skill_inv_events_session ON skill_invocation_events(session_id);`
    Register in `migrations/index.ts`.
- **Validation notes**: `session_id` already exists (`0021:5`, `TEXT NOT NULL`) but
  carries **no index** — the only indexes are on `skill_slug`, `context_id`,
  `(skill_slug, source, reconciled_at)` and `(skill_slug, task_id)`.

### Task B4.1.2: Stop dropping `workspaceRoot`

- **File**: `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts` (`:45-55`)
- **Spec**: `skill-invocation-recorder.spec.ts` (extend)
- **Details**: `RecordSkillEventInput` declares `workspaceRoot` (`:10-22`) and the
  recorder **silently discards it** before calling the store. Forward it.
- **Validation notes**: **Correction C10.** context.md's Phase 4 assumed the join
  was only missing the session outcome; it is also missing workspace scoping and
  the `session_id` index. Spec asserts the value reaches the store.

### Task B4.1.3: Store INSERT + `getWinRates()`

- **File**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/digest/win-rate.spec.ts` (**P4-2**)
- **Details**: `recordSkillEvent` INSERT (`:451-475`) gains `workspace_root`; add
  `getWinRates()` implementing the §2.5 query.
- **Validation notes**: `winRate = wins / (invocations - unknown)`, and it is
  **`null` when the denominator is 0 — never `0`**, so an unmeasured skill is not
  ranked below a measured loser. `no-correction` counts as **neither** win nor
  unknown. P4-2 spec: seed 3 invocation rows (one session with no verdict) and two
  verdicts (`tests-green`, `unverified`); assert
  `invocations: 3, wins: 1, unknown: 2` and `winRate === 1`. A slug with only
  unverified/absent sessions yields `winRate === null`, **not `0`**.

**Acceptance**:
`nx test @ptah-extension/persistence-sqlite @ptah-extension/skill-synthesis` —
`0037` applies at version 36; P4-2 exact numbers; the recorder spec proves
`workspaceRoot` is no longer dropped.

---

## Batch B4.2: `SkillGapCuratorService` — the four sweeps ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C4 (Phase 4)
- **Depends on**: B4.1
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Four interacting sweeps producing one ranked output; the analytic
  core of the phase.

### Task B4.2.1: Digest types

- **File**: `libs/backend/skill-synthesis/src/lib/digest/digest.types.ts`
- **Details**: `DigestItem { kind; title; rationale; score; evidence: { sessionIds: string[]; counts: Record<string, number>; winRate: number | null } }`.

### Task B4.2.2: The gap curator

- **File**: `libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.ts`
- **Spec**: `libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.spec.ts`
- **Spec ref**: implementation-plan.md §4 Phase 4 (line 753)
- **Details**: (a) succeeded sessions where a relevant skill existed but was never
  invoked → description-rewrite suggestion via the **existing**
  `SkillSuggestionStore.updatePending` path; (b) friction clusters with no success
  → skill opportunities from failure; (c) per-skill win rate (§2.5);
  (d) memory-conditioned relevance via
  `IMemoryReader.search(query, topK, workspaceRoot)`
  (`memory-contracts/src/lib/memory-reader.port.ts:30-36`), injected
  `{isOptional: true}`.
- **Validation notes**: `skill-synthesis` **already depends on `memory-contracts`**
  — no new edge. Sweep (b) depends on C2's `friction_map`; when the verdict table
  is empty the sweep yields zero items rather than throwing (C2 ⇢ C4 soft edge).
  **Autonomy boundary preserved**: the system ranks, evidences and nudges; the
  user still accepts/dismisses.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — all four sweeps produce `DigestItem`s
with non-empty `evidence.sessionIds`; with the verdict table empty the service
still resolves and sweep (b) returns `[]`.

---

## Batch B4.3: Win rate feeds scorecard, enhancer and dormancy ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C4 (Phase 4)
- **Depends on**: B4.1
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Three consumers of one new signal; each changes a ranking or
  eligibility decision, so `null` handling must be identical in all three.

### Task B4.3.1: Scorecard exposes win rate

- **File**: `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts`
- **Spec**: `skill-scorecard.service.spec.ts` (extend)

### Task B4.3.2: Win rate as an auto-enhance eligibility input

- **File**: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`
- **Spec**: `skill-enhancer.service.spec.ts` (extend)
- **Details**: Alongside the existing `MIN_INVOCATIONS_TO_ENHANCE`.

### Task B4.3.3: Dormancy demotion orders by win rate ascending, **nulls last**

- **File**: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`
- **Spec**: `skill-promotion.service.spec.ts` (extend)
- **Validation notes**: **Nulls last** is the whole point — an unmeasured skill
  must not be demoted ahead of a measured loser.

**Acceptance**:
`nx test @ptah-extension/skill-synthesis` — a `null`-win-rate skill sorts **after**
a `0.2`-win-rate skill in the demotion order; the enhancer spec covers both a
`null` and a numeric win rate.

---

## Batch B4.4: `skillSynthesis:digest` RPC ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C4 (Phase 4)
- **Depends on**: B4.2
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential

### Task B4.4.1: Wire contract

- **File**: `libs/shared/src/lib/types/rpc.types.ts`
- **Details**: Method map + allow-map + `DigestItem` wire type.
- **Validation notes**: Correction C11 — compile-time half only.

### Task B4.4.2: Handler + schema

- **Files**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`,
  `.../skills-synthesis-rpc.schema.ts`
- **Spec**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.digest.spec.ts` (**P4-1**)
- **Details**: P4-1 — seeded DB; the result is sorted by `score` **descending** and
  every item carries a non-empty `evidence.sessionIds`, a `counts` map, and a
  `winRate` that is `number | null`.

**Acceptance**:
`nx test @ptah-extension/rpc-handlers` — P4-1 green, including the descending-sort
assertion; **and** `npm run typecheck:all` clean.

---

## Batch B4.5: "This week" panel + nudges ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C4 (Phase 4)
- **Depends on**: B4.4
- **Recommended Executor**: `frontend-developer`
- **Execution Mode**: sequential

### Task B4.5.1: Digest panel on the Activity sub-view

- **File**: `libs/frontend/skill-synthesis-ui/src/lib/components/` (new `skill-digest-panel.component.ts`)
- **Spec**: co-located spec (new)
- **Details**: Ranked items, each rendering its evidence links (session ids,
  counts, win-rate). Signals + OnPush.

### Task B4.5.2: Nudges ride the existing event push

- **Files**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-live.service.ts`,
  `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (`:600-620`)
- **Spec**: `skill-synthesis-live.service.spec.ts` (extend)
- **Validation notes**: Ride the existing `pushEvent` →
  `MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT` broadcast. **NO new notification channel.**

**Acceptance**:
`nx test @ptah-extension/skill-synthesis-ui` — the panel renders N ranked items in
score-descending order with evidence links; a `null` win rate renders as
"not measured".

---

# COMMIT 5 — Tier B: Electron tray keep-alive

Commit message: `feat(electron): tray keep-alive for background skill synthesis`

**Depends on C0** (the `skillSynthesis.trayKeepalive` key and its `false` default
ship there). **Purely additive** — with the flag off, `window-all-closed`
behaviour is byte-identical to today (Q4, R10).

---

## Batch B5.1: Tray surface + gated quit suppression ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C5 (Tray)
- **Depends on**: B0.5
- **Recommended Executor**: `backend-developer`
- **Execution Mode**: sequential
- **Rationale**: Net-new Electron main-process surface touching the quit path.
  Platform-specific and risk-bearing (R10) — not delegable.

### Task B5.1.1: Tray service

- **File**: `apps/ptah-electron/src/services/tray/tray.service.ts` (new)
- **Spec**: `apps/ptah-electron/src/services/tray/tray.service.spec.ts` (new)
- **Spec ref**: implementation-plan.md §4 Phase 0 "Tier B" (lines 571–578); Q4
- **Details**: A `Tray` with a **"Pause background learning"** checkbox and
  **"Quit Ptah"**. Verified: there is currently **no `Tray` anywhere** in the app.
- **Validation notes**: **R10** — the tray menu always carries an **unconditional**
  "Quit Ptah" item. Without it, suppressing `window-all-closed` leaves an
  unkillable background process.

### Task B5.1.2: Gate `window-all-closed` on the setting

- **File**: `apps/ptah-electron/src/main.ts` (`:161-165`)
- **Spec**: `apps/ptah-electron/src/main.spec.ts` or a co-located quit-path spec (new)
- **Details**: When `skillSynthesis.trayKeepalive` is `false` (the default),
  behaviour is **byte-identical to today** — `app.quit()` on non-darwin. When
  `true`, suppress the quit and keep the tray alive.
- **Validation notes**: The `will-quit` teardown chain (`:166+`) is **unchanged**.
  Spec must assert the default-off path calls `app.quit()` exactly as today.

### Task B5.1.3: "Pause background learning" toggles the master switch

- **File**: `apps/ptah-electron/src/services/tray/tray.service.ts`
- **Details**: The checkbox writes `skillSynthesis.enabled`, which the drain's
  first gate already reads (B0.4). No new pause mechanism.

**Acceptance**:
`nx test ptah-electron` — with `trayKeepalive: false`, `window-all-closed` calls
`app.quit()` on non-darwin (identical to the pre-change assertion); with `true`,
it does not and the tray exists with an enabled "Quit Ptah" item; **and**
`nx typecheck ptah-electron` clean.

---

## Batch B5.2: Tray e2e — default-off parity and explicit-on survival ⏸️ PENDING

- **Status**: PENDING
- **Commit**: C5 (Tray)
- **Depends on**: B5.1
- **Recommended Executor**: `senior-tester`
- **Execution Mode**: sequential
- **Rationale**: Test-only authoring against the existing Electron harness; the
  quit-path regression is only observable end-to-end.

### Task B5.2.1: Default-off quit parity

- **File**: `apps/ptah-electron-e2e/src/**` (new spec)
- **Details**: With the shipped default, closing all windows quits the app on
  non-darwin — proving R10's "byte-identical default path".

### Task B5.2.2: Flag-on keep-alive + tray quit

- **File**: same
- **Details**: With `trayKeepalive: true`, closing all windows leaves the process
  alive and the tray's "Quit Ptah" terminates it.

**Acceptance**:
`nx e2e ptah-electron-e2e` — both specs green; no orphaned process after the
flag-on spec.

---

## 2. Batch index

| Batch | Commit | Depends on           | Executor                 | Mode         | Tasks |
| ----- | ------ | -------------------- | ------------------------ | ------------ | ----- |
| B0.1  | C0     | —                    | backend-developer        | sequential   | 4     |
| B0.2  | C0     | —                    | backend-developer        | sequential   | 3     |
| B0.3  | C0     | B0.1                 | backend-developer        | sequential   | 4     |
| B0.4  | C0     | B0.2, B0.3           | backend-developer        | sequential   | 3     |
| B0.5  | C0     | B0.3                 | backend-developer        | sequential   | 4     |
| B0.6  | C0     | B0.4, B0.5           | backend-developer        | sequential   | 3     |
| B0.7  | C0     | B0.5                 | frontend-developer       | sequential   | 2     |
| B1.1  | C1     | B0.1                 | **`ptah-cli` CLI agent** | sequential   | 2     |
| B1.2  | C1     | B1.1                 | backend-developer        | sequential   | 2     |
| B1.3  | C1     | —                    | backend-developer        | sequential   | 5     |
| B1.4  | C1     | B1.3                 | backend-developer        | sequential   | 5     |
| B1.5  | C1     | B1.4, B0.3           | backend-developer        | sequential   | 5     |
| B1.6  | C1     | B1.2, B1.5           | backend-developer        | sequential   | 6     |
| B1.7  | C1     | B1.5, B1.6, **B0.4** | backend-developer        | sequential   | 1     |
| B1.8  | C1     | B1.4, B1.2           | backend-developer        | sequential   | 3     |
| B1.9  | C1     | —                    | frontend-developer       | sequential   | 4     |
| B1.10 | C1     | B1.8, B1.9           | frontend-developer       | sequential   | 4     |
| B1.11 | C1     | B1.10                | senior-tester            | **parallel** | 2     |
| B2.1  | C2     | B1.1                 | backend-developer        | sequential   | 3     |
| B2.2  | C2     | —                    | backend-developer        | sequential   | 1     |
| B2.3  | C2     | B2.1, B2.2, B1.5     | backend-developer        | sequential   | 2     |
| B2.4  | C2     | B2.3                 | backend-developer        | sequential   | 4     |
| B3.1  | C3     | B1.2                 | backend-developer        | sequential   | 3     |
| B3.2  | C3     | B3.1, B1.5           | backend-developer        | sequential   | 2     |
| B3.3  | C3     | B3.1                 | backend-developer        | sequential   | 1     |
| B3.4  | C3     | B3.2, B3.3, B1.6     | backend-developer        | sequential   | 2     |
| B3.5  | C3     | B3.4                 | frontend-developer       | sequential   | 3     |
| B4.1  | C4     | B3.1                 | backend-developer        | sequential   | 3     |
| B4.2  | C4     | B4.1                 | backend-developer        | sequential   | 2     |
| B4.3  | C4     | B4.1                 | backend-developer        | sequential   | 3     |
| B4.4  | C4     | B4.2                 | backend-developer        | sequential   | 2     |
| B4.5  | C4     | B4.4                 | frontend-developer       | sequential   | 2     |
| B5.1  | C5     | B0.5                 | backend-developer        | sequential   | 3     |
| B5.2  | C5     | B5.1                 | senior-tester            | sequential   | 2     |

**34 batches, 118 tasks.** One CLI-delegated batch (B1.1), inside Phase 1, as
context.md scopes it. One parallel batch (B1.11 — two file-disjoint e2e specs
against different harnesses).

---

## 3. Global invariants — every batch must preserve these

Carried verbatim into each affected batch's Validation Notes. Any violation is a
review rejection regardless of test status.

1. **No provider id in any code path.** Lanes differ only by capability fields
   (`structuredOutput`, `toolUse`, `timeoutMs`, `maxInputChars`). If a code path
   names a provider id, it is wrong. P1-4's spec body must itself contain zero
   provider-id literals.
2. **A lane MUST NOT mutate global `AuthEnv` or `process.env`.** R1's live hazard
   is `ProviderModelsService.applyPersistedTiers` (`:617-643`), which writes both
   **unconditionally, with no scope guard**. B1.5's byte-for-byte immutability
   spec is the guard; treat a failure as release-blocking.
3. **`libs/backend/skill-synthesis` keeps ZERO direct SDK imports.** Widen the
   local `IInternalQuery` in place (`internal-query.interface.ts` — keep the file
   local; its header at `:1-9` explains why).
4. **Generalize `ICuratorAuthResolver`; do not add a second resolver.** Port in
   `agent-sdk`, impl in `auth-providers` — that direction keeps the dependency
   one-way (correction C1). No compatibility alias.
5. **Extract `CuratorModelPickerComponent` into `libs/frontend/ui` and DELETE the
   local copy.** Do not fork it — `skill-synthesis-ui` ships to VS Code AND
   Electron, and a fork strands VS Code users.
6. **Keep the manual JSON parsers.** `extractJsonObject`
   (`skill-synthesizer.service.ts:210-231`) and the judge's `/\{[^{}]*\}/`
   (`skill-judge.service.ts:118`) are the **only** path when a lane declares
   `structuredOutput: 'parse'`.
7. **`skillSynthesis:` is ALREADY in `ALLOWED_METHOD_PREFIXES`** — no runtime-guard
   change. The **compile-time** half of dual-registration still applies per new
   method (`rpc.types.ts` method map + allow-map).
8. **`skill-synthesis` NEVER imports `cron-scheduler`.** `thoth-runtime` is the
   seam, exactly as it already is for backups. This is why
   `isUniqueConstraintError` moves to `persistence-sqlite` in B0.1.
9. **No tribunal import** anywhere in `libs/backend/skill-synthesis`. "Panel" is
   two internal-query calls (asserted in B3.4).
10. **No new frontend lib.** The picker goes into the existing `libs/frontend/ui`;
    everything else stays inside `skill-synthesis-ui`.
11. **`drain()` never throws.** Every gate and every failure mode yields a
    `DrainSummary`.
12. **No `INSERT OR IGNORE`, no UPSERT** in the queue store (rule at
    `run.store.ts:6-9`).

---

## 4. Out of scope — do NOT build here

Recorded so no batch quietly absorbs them (context.md § Follow-ups):

- **Tier C daemon** — `ptah daemon` drain mode on `cli-engine` + OS autostart.
  `cli-engine` is `scope:cli` and `ptah-extension-vscode` is lint-forbidden from
  depending on it.
- **Codex lane adapter** — the lane contract must not assume the one-shot
  Claude-SDK path, so adding one later is additive; building it is a follow-up.
- **Ollama Cloud free-tier verification** — the ~30K req/mo figure is a
  source-comment assertion (correction C12). Nothing in this plan depends on it:
  capacity is governed by `maxTokensPerDay` and cron cadence.
- **Fixing `getActiveProviderId`'s hostname-substring matcher** (R7,
  `curator-auth-resolver.ts:236-253`) — mitigated here, fixed in a follow-up.
- **Correcting the root `CLAUDE.md`'s stale claim that `ProviderModelsService`
  lives in `agent-sdk`** (correction C3) — it lives in `auth-providers`. Follow-up
  doc pass.
- **SDK tool restriction** on the one-shot path (correction C7 / Q3 Option C) —
  the plan is structured so it is purely additive later, never a rewrite.

---

## 5. Questions for the user

Neither blocks decomposition. Both batches below are written under the stated
assumption and labelled as such.

### Q-A — Confirm the C0-before-C1 landing order

**Assumption taken**: C0 lands before C1.

context.md line 8 permits Phase 0 and Phase 1 in parallel, and they are genuinely
dependency-independent at the design level. But criterion **P1-7** ("a lane whose
auth cannot resolve leaves its queue item `queued` ... and does not throw out of
the drain") is only assertable once the drain exists. Batch **B1.7** therefore
carries a cross-commit dependency on **B0.4**.

- **Option A (assumed)** — land C0 → C1. B1.7 is buildable exactly as written. No
  batch changes.
- **Option B** — land C1 → C0. B1.7 moves to the front of C0 as a new batch B0.0,
  and C1 ships with P1-7 unproven until C0 lands. Requires the orchestrator to
  renumber and to accept a temporarily-unproven Phase-1 criterion.

Only Option B requires action; Option A is already reflected above.

### Q-B — Where should the "Pause background learning" tray checkbox write?

**Assumption taken**: it writes `skillSynthesis.enabled` (task B5.1.3).

That key is already the drain's first gate (B0.4), so no new pause mechanism is
needed and the tray control is honoured by every runtime, not just Electron.

- **Option A (assumed)** — write `skillSynthesis.enabled`. Zero new machinery; the
  pause is global and persists across restarts. _Trade-off:_ pausing from the tray
  also stops synthesis for a VS Code window running against the same
  `~/.ptah/settings.json`.
- **Option B** — a separate Electron-local `skillSynthesis.trayPaused` key that the
  drain gates on in addition. Keeps the tray pause host-local. _Trade-off:_ a
  twelfth settings key, a second pause concept, and two ways to mean "off" — the
  kind of dual path the brief forbids elsewhere.

If Option B is preferred, B0.4's gate order and B0.5's key table both need one
addition; say so before C0 is implemented, since the key list ships there.

---

## 6. Orchestrator hand-off notes (added during execution)

Findings raised by a completed batch that change what a LATER batch must build.
Read the note for your batch before starting it.

### → B1.5: add `requeue(id, notBefore, reason)` to `SkillQueueStore`

Raised by B0.3. B1.5's lane-timeout path needs "queue row back to `queued` with
`not_before = now + backoff`" — a **requeue**, not a terminal mark. B0.3
deliberately did not add it (it was not in B0.3's method list, and `markFailed`
is terminal by design with no backoff parameter). **Do not reuse `markUnscored`
for this** — `unscored` is Phase 1's judge verdict and overloading it would
conflate a judge outcome with a transport failure. Add the method.

### → whoever owns `persistence-sqlite` next: `isUniqueConstraintError` is binding-specific

Raised by B0.3. `isUniqueConstraintError` matches
`err.code === 'SQLITE_CONSTRAINT_UNIQUE'` (`sqlite-errors.ts:26`), which is
better-sqlite3's shape. Node's built-in `node:sqlite` reports the identical
violation as `code: 'ERR_SQLITE_ERROR'` with the detail in the message.

This is CORRECT for production — the app ships better-sqlite3. It only bites in
specs, because `better-sqlite3` in this worktree is built against Electron's ABI
and cannot load under Node, so every native-gated spec falls back to
`node:sqlite`. B0.3 handled it by re-labelling that one error case inside
`queue/queue-db.test-support.ts`, keeping the store under test calling the real
production predicate. **Do not "fix" this by widening the production predicate**
unless the app actually starts using the built-in binding; widening it would add
a production code path that nothing exercises.

### → B0.6 and later: queue semantics established by B0.3

- `touchClaim(id, now)` returns `boolean`. `false` means this worker lost the row
  and MUST stop writing.
- `markFailed` is terminal, no backoff. A failed row re-opens only via `enqueue`
  once the session grows.
- `enqueue` is idempotent: a plain INSERT whose `UNIQUE(session_id, stage)`
  violation becomes a guarded re-open gated on `turn_count`. Never
  `INSERT OR IGNORE`, never UPSERT.
- `markWorkspaceDrained(root, at)` exists for B0.4's round-robin; without bumping
  the cursor, `listEligibleWorkspaces` never advances and R4 is unmitigated.
- `enqueue`/`tryClaim` use explicit `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK` via
  `db.exec` rather than better-sqlite3's `db.transaction()`. The CAS requires
  `BEGIN IMMEDIATE` anyway, it matches `migration-runner.ts:221`, and
  `db.transaction()` does not exist on the fallback binding — using it would make
  P0-2 unassertable on any machine where better-sqlite3 cannot load.

### → B1.4 / B1.8: `lane` is missing from the file-settings tier routing regex — ✅ RESOLVED by B1.4

**RESOLVED.** B1.4 landed `|lane` in the alternation; `file-settings-keys.ts:409-410`
now reads `(mainAgent|cliAgent|lane)` and the round-trip is pinned through two
manager instances against the on-disk JSON. B1.8 needs to do nothing here.
Original note preserved below for context.

Raised by B1.3, verified directly. `libs/backend/platform-core/src/file-settings-keys.ts:360`:

```ts
const PROVIDER_SCOPED_TIER_PATTERN = /^provider\.[a-z0-9-]+\.(mainAgent|cliAgent)\.modelTier\.(sonnet|opus|haiku)$/;
```

`lane` is not in that alternation, so `provider.<id>.lane.modelTier.<tier>` is
**not routed to `~/.ptah/settings.json`**.

B1.3 is unaffected — reads return null and `buildTierValues` falls through to
`defaultTiers`, which is the documented Phase-1 behaviour and what its tests
assert. The break appears the moment anything **writes** a lane tier: the write
silently does not persist. Whichever of B1.4 (lane config) or B1.8 (lane
settings keys + `setLanes` RPC) lands the write path MUST add `|lane` to that
alternation and to the doc comment above it at `:354`. Add a spec pinning that a
`provider.<id>.lane.modelTier.haiku` key round-trips through the file settings
store, or this regresses silently.

### → consolidation pass after B0.4 releases `skill-synthesis` (do before B1.6)

Raised by B1.2, which was file-scoped to `skill-candidate.store.ts` + spec while
B0.4 held `types.ts`, `di/*` and `index.ts`. Four items it could not land:

1. **Fold `JudgeVerdictFields` into `SkillCandidateRow`** in `src/lib/types.ts`.
   B1.2 expressed it as the intersection `JudgedCandidateRow` instead —
   behaviourally identical today, but the field block belongs on the row type.
2. **Export the new judge symbols from `src/index.ts`**: `JUDGE_STATUSES`,
   `JudgeStatus`, `JudgeCriterionScores`, `JudgeVerdict`, `JudgeVerdictFields`,
   `JudgedCandidateRow`. B1.6 and the RPC handler batch need them. No DI token
   required.
3. **`RegisterCandidateResult.candidate`** stays typed `SkillCandidateRow` (it
   lives in `types.ts`). Harmless — a fresh candidate has all-null judge fields —
   but re-point it when (1) lands.
4. **`skill-synthesis/CLAUDE.md`** needs a line on the `unscored` verdict and the
   rule that the TS union is the ONLY enforcement of `judge_status` (migration
   `0033` deliberately carries no `CHECK`).

### → B1.6 and the RPC batch: the judge write path already rejects the old defect

`recordJudgeVerdict` throws on `scored` with a non-finite/null score, and on any
non-`scored` status carrying a number. `{status:'unscored', score:10}` — the
exact fail-open shape this phase exists to remove — throws at the store boundary.
Do not add a second validation layer above it; do not catch and downgrade.

On read, `toJudgeStatus` maps `null`/`''` to `null` ("never judged") and
downgrades any unrecognised stored string to `'unscored'` with a `logger.warn`.

`recordJudgeVerdict` writes the nine judge columns as ONE fixed UPDATE, not a
dynamic fragment. This is deliberate and must not be "optimised" into a partial
update: a fragment-style write leaves the previous pass's per-criterion scores
sitting beside a new headline score, which is the same class of quietly-wrong
verdict the phase exists to remove. Pinned by a spec that re-judges a 9/9/9/9/9/9
candidate as `unscored` and asserts all five criteria read back `null`.

`judge_panel_rationales` is deliberately NOT written here — phase 3 owns it.

### → anyone reading a red `agent-sdk` suite: one failure is environment, not code

`agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:368` ("derives env /
settingSources / beta flag from the override, not this.authEnv") asserts
`expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()`. A shell that exports
`ANTHROPIC_AUTH_TOKEN=""` / `ANTHROPIC_API_KEY=""` / `ANTHROPIC_BASE_URL=""`
delivers `""` instead, and the test fails. Pre-existing, unrelated to this task.
Reproduce green with those three unset. Worth a separate fix — an empty string is
not a credential, and the spec should treat it as absent.

### → any batch writing a spec that needs a real database

Reuse `src/lib/queue/queue-db.test-support.ts`. `better-sqlite3` here is built
against Electron's ABI (`NODE_MODULE_VERSION 143` vs Node's `137`), so copying
the house native-gated pattern makes specs skip **silently** — they report green
while asserting nothing. Migrations `0032` and `0033` both use a `node:sqlite`
fallback for the same reason.

### → B1.7: what B1.5 and B1.6 deliberately left for you

Raised by B1.5 and B1.6. Three things, all intentional:

1. **The terminal mark is yours.** `LaneRunner` does NOT `markFailed` at
   `attempt_count >= maxAttempts` (5). Plan §3.4's timeout row asks for the
   terminal mark **and** one Activity event together; B1.5 owns neither the
   drain nor the Activity surface, and landing the mark without the event would
   ship a row that dies silently. Land both, in `skill-drain.service.ts`.
2. **`requeue` is opt-in via `LaneRunRequest.queueItemId`.** The runner writes
   the queue transition for `timeout` and `auth-unresolvable` **only when handed
   a row id**, and does nothing when not — the judge also runs at the foreground
   promotion gate, which has no row. If you instead map `SkillLaneFailure` onto
   row transitions inside the drain, simply **do not pass `queueItemId`** or the
   row is written twice. `requeue` is idempotent under repeat application, so
   either seam works; pick one and be consistent.
3. **`structured-output-unsupported` deliberately does NOT write the queue.**
   That transition also sets the candidate's `judge_status`, and splitting a row
   write from its candidate write across two owners is how the two end up
   disagreeing. Both halves are yours.

Also inherited, not introduced: `requeue`'s guard is on `status IN
('claimed','running')`, not on `claimed_by` — the same bar `touchClaim` set in
B0.3. A reaped-then-re-claimed row can still be stomped by the stale worker.
Widening only `requeue` would create a second, inconsistent contract; close both
together or not at all. Logged as a follow-up, not a blocker.

### → B1.10 (UI): `PromotionDecision` gained a `judge-unscored` reason

Raised by B1.6. Promotion now returns `reason: 'judge-unscored'` when the judge
could not produce a trustworthy score. The frontend's `promoteReasonText` switch
has a `default`, so this does **not** break — it renders as "not eligible" until
you add the case. That is a real UI gap, not a cosmetic one: "not eligible"
reads as a verdict when the truth is "we do not know". Pair it with the unscored
badge in task B1.10.4.

### → follow-up (not a batch): four container-construction sites in one RPC spec

Raised by B0.5. `skills-synthesis-rpc.handlers.spec.ts` builds its tsyringe
container in **four** places — two named builders plus two ad-hoc inline
containers at `:719` and `:1138`. Every new constructor parameter on
`SkillsSynthesisRpcHandlers` therefore breaks the spec in four places, which is
exactly how B0.5 arrived with 23 DI failures. B0.5 fixed all four sites but was
explicitly told not to consolidate them inside a batch that is not about that.
Worth one small cleanup task of its own; do not fold it into a feature batch.

### → follow-up (NOT this task): the same `<select>` binding bug is latent in `json-schema-form`

Found while fixing the provider picker. `libs/frontend/ui/src/lib/native/form/json-schema-form.component.ts:74-87` uses the identical construction the picker had — `[value]` on a `<select>` with no `[selected]` on its `@for` options.

**The bug**: `[value]` is a property binding applied during the update pass, in
which the `@for` options are still materialising. The browser silently rejects a
`<select>` value matching no existing option, and Angular never re-applies it
because the bound expression itself never changed. Net effect: a pre-set value
renders as the first option instead.

`json-schema-form`'s options are synchronous and schema-derived, so it may render
correctly today **by ordering luck** rather than by construction. The picker's
model select — whose options arrive from an async loader — failed _every_ time,
which is why that one was caught. Same class, different odds.

Fix is one line per option (`[selected]="opt === value()"`), and the house
precedent is `chat/.../voice-config.component.ts:93-101`. Out of scope for
TASK_2026_180; worth its own small task, because a form that silently discards a
pre-set value is the kind of defect users report as "it didn't save".

### → whoever wires the `judge` / `synthesis` stage handlers: hand the failure over, do not flatten it

Raised by B1.7. The drain now maps `SkillLaneFailure` onto row transitions, and a
stage hands its failure over **verbatim** through the `SkillStageResult` variant
`{ outcome: 'lane-failed'; failure: SkillLaneFailure }`.

**Today that channel has no production producer.**
`SkillSynthesisService.registerStageHandlers()` registers only `prefilter` and
`embedding` (B0.9), so nothing can currently emit a `SkillLaneFailure` to the
drain. The mapping is complete and exercised against real SQL, but P1-7 is proven
against a synthetic handler rather than a live one until those handlers exist.

When you wire them: **return `{outcome: 'lane-failed', failure}`. Do NOT flatten
the failure into `unscored` / `failed` inside the handler.** Only the drain reads
`maxAttempts`, so a handler that pre-decides the outcome is re-deciding the
ceiling and the backoff in a place that cannot see either.

**The single-owner seam, and why it is not a coin flip.** `LaneRunner` writes
`requeue` only when handed `LaneRunRequest.queueItemId`; **no production caller
passes it**, so the drain is the sole owner of every queue transition. This is
not stylistic: `requeue` releases the claim, so a runner-side requeue would let
another worker take the row before the drain's terminal mark landed — and
`requeue` being idempotent **hides** that race rather than fixing it. Pinned
mechanically: `skill-drain.failures.spec.ts` scans every production `.ts` under
`skill-synthesis/src` and asserts the only file naming `queueItemId` is
`lanes/lane-runner.service.ts`, which declares it.

**Mapping**: transport (`timeout`, `auth-unresolvable`) → `requeue`; capability
(`structured-output-unsupported`, `tool-use-unsupported`) → `markUnscored`.

### → the attempt ceiling is asymmetric on purpose — USER-DECIDED

Decided by the user on 2026-08-13, after B1.7 proposed the opposite.

`maxAttempts` (default 5) terminates **`timeout` only**. **`auth-unresolvable`
stalls indefinitely** behind its 30-minute backoff and never reaches
`markFailed`.

B1.7 originally applied the ceiling to both, reasoning that an unbounded requeue
loop on a permanently misconfigured lane is a leak — a fair argument, and it does
not weaken Q2, since dying visibly is not a fallback. It was overruled on
recoverability: `markFailed` is terminal and a row re-opens **only** via
`enqueue` once the session grows, so ~2.5 hours of misconfiguration (5 × 30 min)
would permanently kill every row queued in that window. A **finished** session
never grows again, so that work is unrecoverable even after the user fixes the
provider config — and there is no manual re-enqueue affordance today.

The asymmetry is the point: a timeout is a transport fault that may never clear;
unresolvable auth is a **user-fixable configuration** fault, and killing the row
means the fix arrives too late to matter. Pinned by a spec asserting an
`auth-unresolvable` row **above** the ceiling still returns to `queued` — so a
future re-widening breaks a test instead of passing quietly.

If the ceiling is ever wanted on both, land the re-open affordance first (lane
settings change makes terminal rows eligible again). That is its own batch.

### → B1.10 (and any frontend batch consuming the candidate summary): fixture drift

Raised by B1.8. Widening `SkillSynthesisCandidateSummary` with five required
fields left two frontend spec fixtures describing a shape that no longer exists:

- `libs/frontend/skill-synthesis-ui/.../skill-invocations-panel.component.spec.ts:9` (`const CANDIDATE`)
- `libs/frontend/skill-synthesis-ui/.../skill-candidates-table.component.spec.ts:12` (the `candidate()` factory)

Add `displayName: null, judgeScore: null, judgeStatus: null, judgeReason: null,
judgeCriteria: null` to both.

**Neither fails today, and that is the hazard, not a reassurance.** Angular libs
typecheck through `tsconfig.lib.json`, which **excludes specs**, and
`jest-preset-angular` here does not hard-fail on missing members. Verified green:
`skill-synthesis-ui` 21 suites / 208 passed, `dashboard` 2 suites / 23 passed. So
this class of drift is invisible to both CI gates in this repo — the only way it
surfaces is someone reading the fixture. Worth remembering whenever a shared DTO
grows a required field.

### → B1.8: it is 32 lane settings keys, not the 28 the batch text says

The batch text ("four lanes × seven fields, + `maxPasses` where applicable")
predates the committed lane config. `SKILL_LANE_FIELDS`
(`lanes/skill-lane-config.ts:34-43`) is **eight** fields; `laneKeys()` gives all
eight to all four lanes; `readSkillLane` reads `maxPasses` unconditionally for
every lane (`:227`) and `flattenSkillLanes` writes it for every lane (`:272`).

Routing only 28 would leave `skillSynthesis.{synthesis,judge,replay}.maxPasses`
unrouted, and **an unrouted key fails in the write direction only** — the read
falls through to the default and looks correct while the write is handed to a
store that does not own the key and is dropped with no error. Same failure mode
`PROVIDER_SCOPED_TIER_PATTERN` already documents. B1.8 routed all 32 and pinned
the count in two specs. The number here wins over the batch text.

### → anyone adding a lane field: `platform-core` CANNOT import `skill-lane-config.ts`

`platform-core` is the leaf that `skill-synthesis` depends on (`readSkillLane`
takes an `IWorkspaceProvider`), so importing the lane config from it closes a
dependency cycle. B1.8 therefore **restates** the lane defaults in
`file-settings-keys.ts`, following the house precedent set by
`KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` (`:17-20`) and the Phase-0 `SKILL_DRAIN_DEFAULTS`
table (`:305-310`).

The restatement is guarded **mechanically, not by a lockstep comment**: a spec in
`rpc-handlers` (which legally imports both sides) derives all 32 keys from the
real `SKILL_LANE_IDS` × `SKILL_LANE_FIELDS` and asserts each is present in
`FILE_BASED_SETTINGS_KEYS`, passes `isFileBasedSettingKey`, matches
`SKILL_LANE_DEFAULTS` value-for-value, and that no stray `skillSynthesis.<lane>.*`
key exists in `platform-core` that `SKILL_LANE_KEYS` lacks. **Add a lane field and
that spec goes red** — which is the intended behaviour. Do not "fix" it by
loosening the spec; update both tables.

### → NEW BATCH B0.9 (C0): nothing drains, and the inline pipeline never died — USER-APPROVED

Raised by B0.6, verified by the orchestrator, decided by the user on 2026-08-13.
**A hole in the decomposition, not a defect in any batch's code.**

Two facts, both confirmed by direct grep over the worktree AND over all 34
batches in this file:

1. **`registerStageHandler` (`queue/skill-drain.service.ts:297`) is never called
   in production** — only from spec files. `SkillDrainService` marks an item
   whose stage has no handler as `skipped`. The ONLY stage-wiring task in the
   entire plan is **B2.4.4** (`archaeology`, Commit 2). `prefilter` and
   `embedding` had no owner at all.
2. **`triggers/skill-trigger.service.ts:592` and `:629` still call
   `analyzeSession` inline**, and **no batch anywhere owns that file.** Grep the
   decomposition: `skill-trigger` appears only twice, both times referring to
   `skill-trigger-config.ts` as a settings pattern to copy.

**Why this mattered enough to add a batch.** After B0.6, session end enqueues
instead of analyzing. With no handler registered, those rows go `skipped` — so
session-end analysis and the embedding backfill both go **dark from C0 onward**,
while the trigger service keeps running the inline pipeline Phase 0 exists to
replace. Embeddings feed clustering and retrieval, so that is not a cosmetic
gap. It also makes the DAG's own contract at line 15 untrue: _"Each commit is
shippable without partial work from any later commit."_

**B0.9 scope**: register the `prefilter` and `embedding` stage handlers
(dispatching to the existing, still-public `analyzeSession` / `backfillEmbeddings`
workers — B0.6 left them public for exactly this), re-point both trigger call
sites to `enqueue`, and pin the round trip end to end with zero rows left
`skipped` for want of a handler.

**The invariant it establishes**: after B0.9 there is exactly ONE path to
`analyzeSession` — through the `prefilter` stage handler. Any future batch that
adds a second inline caller is reintroducing the dual path `context.md` forbids.
Guard it with a grep in review.

**The `turn_count` trap, inherited from B0.6** — `enqueue`'s guarded re-open
fires only on `turn_count < ?`, so enqueuing `0` compiles, passes a naive test,
and permanently wedges every finished row. B0.6 solved it by calling
`extractor.extract(...)` first (pure local JSONL + regex, zero LLM) and
enqueuing `trajectory.turnCount`. Every new enqueue site must do the same, and
its spec must assert the real number, not just that `enqueue` was called.

**Sequencing**: B0.9, B0.8 and B1.7 all touch `skill-drain.service.ts`. Run them
strictly in series — B0.9 → B0.8 → B1.7 — never concurrently.

### → NEW BATCH B0.8 (C0): make the per-stage counter measure tokens — USER-APPROVED

Raised by B0.7, decided by the user on 2026-08-13. **This is a scope addition to
C0, not a re-litigation.**

**The defect in the plan.** Task B0.7.1 assigned R3's mitigation ("ship a
per-stage token counter here from day one so real cost is observable before it
is tuned") to `libs/frontend/skill-synthesis-ui` — a lib that has no access to
token data. Verified directly: `skill_synthesis_queue` (migration `0032`) has
**no token columns**, and the only token storage is `skill_synthesis_budget`,
whose primary key is `day_key` **alone** — day-level, not per-stage, and on no
RPC the frontend can reach. The only token figure that crosses the boundary
today is the cap, `budget.maxTokensPerDay`. A cap with no spend beside it is
worse than nothing.

**What B0.7 shipped instead.** Dispatches-per-stage (`attemptCount` summed by
`stage`), plus rows / in-flight / failed, bars scaled to the heaviest stage. It
is an honest proxy — one dispatch of an LLM-backed stage is one model call, so a
stage whose dispatches outrun its rows is retrying — and it answers R3's actual
question today. It is NOT a token counter and must not be described as one.

**What B0.8 must do.** Land before C0 closes, so cost is observable before C2's
archaeologist (B2.3) becomes the thing spending it:

1. **Migration `0035`** — add a `stage` column to `skill_synthesis_budget` and
   re-key it `(day_key, stage)`. Adding a column via `ALTER TABLE` is fine; do
   NOT edit the already-shipped `0032`.
2. **`SkillBudgetStore`** — `record(usage)` takes a stage; `spentToday()` keeps
   its current day-level meaning so **B0.4's budget gate is unchanged**. Add a
   per-stage read.
3. **The write site** — attribution must happen where the stage is known. The
   `LaneRunner` knows only the lane id (`archaeologist|synthesis|judge|replay`),
   which is a DIFFERENT taxonomy from the eleven queue stages. Thread the stage
   from the drain; do not try to infer stage from lane.
4. **Wire + UI** — one token field on `SkillSynthesisQueueItem` (or a per-stage
   spend array on the queue response), then one extra `+=` in the component's
   `stageCosts()`. B0.7 wrote `StageCostView` so this lands as one field and
   nothing else moves.

**Migration renumber, consequent and mandatory**: B0.8 takes `0035`, so
**B3.1's migration becomes `0036`** and **B4.1's becomes `0037`**. Both batch
texts still say the old numbers — the numbers here win. Update the batch text
when you pick each up, and remember every new migration requires bumping the
version ratchets in older migration specs (run the FULL `persistence-sqlite`
suite to find them; the wording differs between specs so grep misses some).

**Sequencing**: B0.8 touches `skill-drain.service.ts`, which **B1.7 also owns**.
Run them in series, never concurrently, and whichever lands second rebases onto
the first.

### → C0/C1 landing state as of the lane-runner commit

Committed working commits so far, newest first: `1bd2a0e74` (C1 — B1.5 + B1.6),
`c9b2fe4e5` (C0 — B0.5), `79f28c1e8` (C2 — B2.2), `ca04e3446` (C1 — B1.4),
`bb97255a5` (C2 — B2.1), `964c668c6` (C1 — B1.3), `3e8f6ef19` (C0 — B0.4),
`4fa288f6a` (C0 — B0.1/B0.2/B0.3), `d4c0153e9` (docs).

**Working commits are interleaved across phases by design** — the six-commit
contract is honoured at the END by collapsing each phase with
`git reset --soft <phase-base>`, not by committing in phase order along the way.
No single commit mixes two phases, which is the property the collapse depends
on. Preserve that: stage by path (`libs/backend/skill-synthesis/**` has been C1
so far; `platform-core` + `rpc-handlers` + `libs/shared` were C0) and never let
one commit straddle.

### → THE SIX-COMMIT COLLAPSE IS NOT ACHIEVABLE AS SPECIFIED — resolved 2026-08-15

§0's delivery DAG and §2's commit note both say the six-commit contract is
honoured at the end by collapsing each phase with `git reset --soft <phase-base>`,
relying on the property that **no single commit mixes two phases**. That property
does hold — every working commit was staged by path to preserve it — but **it is
not sufficient**, and the method does not work.

Measured directly across the phase commit sets:

| overlap | files  | examples                                                          |
| ------- | ------ | ----------------------------------------------------------------- |
| C0 ∩ C1 | **27** | `skill-drain.service.ts`, `file-settings-keys.ts`, `rpc.types.ts` |
| C0 ∩ C2 | 10     | `skill-synthesis.service.ts`, `di/tokens.ts`                      |
| C1 ∩ C2 | 11     | `skill-synthesizer.service.ts`, `src/index.ts`                    |

**A soft reset plus path-staging commits each file's FINAL content.** Stage
`skill-drain.service.ts` into C0 and B1.7's Phase-1 work goes in with it; stage
it into C1 and C0 loses B0.8, B0.9 and B0.10. `di/tokens.ts`, `src/index.ts`,
`migrations/index.ts` and this lib's `CLAUDE.md` are each touched by **all
three** phases. There is no path partition that separates them, because the unit
that straddles is the **file**, not the commit.

It is achievable by cherry-picking each phase's commits onto the base and
squashing per phase — but that means real conflict resolution across 27 files
and, more importantly, each resulting commit would be a tree **that was never
tested in that exact form**. "Each commit is shippable" asserted from an
untested reconstruction is worse than not asserting it.

**Resolved by the user on 2026-08-15: merge the working commits as-is.** The
tested artifact and the merged artifact are then the same object. The
six-commit shape was a planning aspiration that interleaved execution on shared
files made unreachable — and the interleaving was itself deliberate and correct,
because it is what let 3–4 agents run concurrently.

**For any future task that wants a phase-shaped history**: the constraint is not
"no commit straddles a phase", it is **"no FILE is edited by two phases"**. That
is a much stronger property, and it must be designed into the decomposition —
batch ownership would have to partition files by phase, not just by batch. Say
so up front or do not promise the collapse.

### → NEW BATCH B0.10 (C0): the nightly tier was starving — USER-APPROVED

Raised by a corpus measurement on 2026-08-14, approved and landed the same day.
**A hole in the plan's throughput model, not a defect in any batch's code.**

Measured against **849 real sessions**: nightly demand is ~30 rows/day and
supply was **one**. The old `select()` visited each eligible workspace once and
took `perWorkspaceBatch` (1) rows, so a single-workspace install drained **one
row per tick** whatever `maxItemsPerRun` said — that knob only ever bound with
≥4 eligible workspaces and was **near-vestigial**. `archaeology` is
nightly-only and the nightly cron is `0 3 * * *`, so the queue grew
monotonically while the token budget sat at **4%** of its ceiling.

**Raising the cap alone would have bought nothing** — the governor was
`perWorkspaceBatch × workspace count`. So the deal step now repeats in
**rounds** (nightly only), which turns `perWorkspaceBatch` from a throughput
ceiling into a **fairness quantum**: one workspace reaches the whole cap, two
busy ones split it evenly.

**Raising `perWorkspaceBatch` instead would have been actively harmful.** Every
workspace visited on a tick is stamped with the same `last_drained_at`, so
`ELIGIBLE_WORKSPACES_SQL`'s tiebreak falls to `workspace_root ASC`
**permanently** — at one tick a day the alphabetically first project would eat
the entire nightly budget every night. That is R4, and it is why the 1 is there.
**It stays 1 on every tier.**

Pinned by a mutation the orchestrator re-ran: keep the cap at 40, remove the
rounds, and **5 tests go red**. That is exactly the "raising one number is
sufficient" mistake, and without that spec the suite would pass against an
implementation that ships the settings key and still delivers 1 row/night.

**Weekly has the identical defect and is deliberately NOT fixed** — one tick a
week, single round, cap 4. Harmless today because it has no producers, but
**B4.x lands `judge-panel` / `replay` / `trigger-eval` and MUST revisit
`DRAIN_TIER_LIMITS.weekly`.** Note three existing specs (`failures`,
`idempotency`, `budget`) drain `tier: 'weekly'` while setting `maxItemsPerRun`,
so changing which key weekly reads breaks them.

### → B2.4 found three things wrong in its own batch text — all verified

**a. B2.4.4 names the wrong file.** `skill-drain.service.ts` needed **zero**
changes: `archaeology` was already in `NIGHTLY_ONLY_STAGES`,
`TOKEN_SPENDING_STAGES` and `STAGE_COST_RANK`. The wiring seam is
`SkillSynthesisService.registerStageHandlers()`, exactly as the lib CLAUDE.md
says. The file every batch has had to serialize on was never in play.

**b. B2.4.4 says nothing about who ENQUEUES an `archaeology` row**, without
which the stage is wired and permanently unreachable. It is chained from the
**successful end of the prefilter handler**, because the plan's own R3
mitigation keeps the regex prefilter as the gate on spending: enqueuing it
beside `prefilter` in `enqueueAnalyze` would pay the most expensive per-session
stage for every session the prefilter was about to reject.

**`dependsOn` is deliberately NULL on that chained row**, against the canonical-
chain phrasing. `ELIGIBLE_SQL` (`skill-queue.store.ts:117`) is
`AND (q.depends_on IS NULL OR d.status = 'done')`, so pointing it at the
prefilter row adds a wedge rather than a guarantee: the first time that session
re-opens and prefilter ends `skipped`, the archaeology row is permanently
ineligible while still being scanned every tick. The ordering is already
enforced by construction — the row does not exist until prefilter succeeded.

**c. B2.4.1's headline premise was already true.** `hasSuccessMarker` had
**zero** promotion/eligibility readers at HEAD; `passesPrefilter` never touched
it. Its one production read in the monorepo was the `successMarker=` line in the
synthesis prompt — i.e. B2.4.1's actual substance lived inside B2.4.2. The flag
stays computed (the batch says make "informational signal" true, not delete it)
and the demotion is pinned by a **source scan** rather than a deletion, which is
what makes it stay demoted.

**The source scan is a substring scan over file TEXT and cannot tell code from
prose.** Doc comments naming `hasSuccessMarker` / `successMarker=` failed it —
the same trap `queueItemId` set in B2.3. Production prose now describes the
field as "the extractor's tail-regex success flag" without naming it. Two
separate agents hit this in one session; assume the next one will too.

### → `minTurns` is honoured now, and that NARROWED the enhancer — pinned

`extract`'s `minTurns` was `void`-ed (added deliberately in `2991b72bf` when
arithmetic curation gates were replaced), so the gate was
`turns.length < MIN_ROLE_TURNS_FLOOR` — a hard **2**, whatever the caller
passed. It is now `< max(2, minTurns)`.

Honouring it as-written would have **narrowed the harvest in the same batch that
widens it**: the default was `MIN_TURNS_FOR_TRAJECTORY` (5), which drops every
2–4-turn session and turns `trajectory-extractor.spec.ts:65` red, directly
contradicting B2.4.3. Removing the parameter — the other sanctioned option —
forces arity edits in three files outside B2.4's ownership. So the default moved
**down** to `MIN_ROLE_TURNS_FLOOR` (2), clamped up. The extractor now answers
"is there a readable session here"; `eligibilityMinTurns` is spent in
`passesPrefilter`, where the decision to spend tokens is actually made.

**The consequence, which the batch report understated:** `skill-enhancer.service.ts:733`
passes `TRAJECTORY_MIN_TURNS` (5) explicitly, so **the enhancer now genuinely
requires 5 role turns where it used to get 2.** Enhancement candidates with 2–4
turns are rejected where they previously passed. That is deliberate — it
restores the constant's plainly stated intent — but it was **unpinned**, making
it indistinguishable from an accident.

It is now pinned in `trajectory-extractor.spec.ts`, NOT in
`skill-enhancer.service.spec.ts`, because that spec stubs `trajectories.extract`
with a jest mock (`:168-169`) so the real gate never executes there — pinning it
in the obvious place would assert only that the argument was passed. The guard
**regex-extracts the threshold out of `skill-enhancer.service.ts`** rather than
copying the number, and asserts the enhancer still passes it into `extract(`, so
it defends the caller's real value instead of a copy that can drift. Four cases,
including the paired positive (5 turns extracts) and a check that the same
4-turn session still extracts for callers passing nothing — so a future
re-widening of the default goes red too.

### → B2.3.2 case 2 understates the contract — USER-DECIDED

Raised by B2.3, decided by the user on 2026-08-14.

The batch text says a `toolUse:'none'` lane ⇒ `passes === 1` **and**
`degraded_reason === 'tool-use-unsupported'`, which reads as one condition
producing both. **It is two independent facts**, and conflating them is a real
defect:

- The collapse to `passes === 1` is **unconditional** on the capability (R6).
- The reason is written **only when the collapse left the analyst's requests
  unserved** — i.e. the terminating reply still carried `requestTurns` /
  `requestSearch`. A `toolUse:'none'` pass that reaches a **terminal verdict
  with no further requests** writes `degraded_reason: null`.

**Why.** `hasUsableVerdict` is `row !== null && row.degradedReason === null`
(`session-verdict.store.ts:208-211`), so implementing the batch text literally
makes Phase 3 discard **every** verdict produced on a non-tool-use lane — which
is exactly the cheap-provider lane Phase 1's routing exists to move background
work onto. The archaeologist would spend tokens there nightly and buy nothing.
The signal that matters is whether the analyst wanted more evidence, not what
the lane was capable of; the capability flag was standing in as a proxy for
incompleteness and on a clean single-pass verdict that proxy is simply wrong.

Fixed at the **write site**, deliberately NOT by loosening the predicate —
`session-verdict.store.ts` is untouched. Pinned by a two-way mutation test: the
gate made unconditional fails exactly the two terminal-verdict tests, and the
gate hard-wired off fails exactly the insatiable-reply test. Running it from
both directions matters, because the first mutation alone also passes against
an implementation that never writes the reason at all.

**Open, NOT decided, and pre-existing:** a lane with `toolUse: 'required'` that
exhausts a deliberately configured `maxPasses` while its reply still asks for
more is by the same reasoning an incomplete verdict, but it writes
`degraded_reason: null` and reads as fully usable. The gate is
`collapsed && unservedRequests`, and that case is not `collapsed` — its tool use
was never in question, so `tool-use-unsupported` would be a lie in a field the
user reads. It probably wants its own open-vocabulary member
(`pass-budget-exhausted`). **Phase 3's fallback logic will meet this** — decide
it there rather than discovering it.

### → B1.11's acceptance command is wrong: there is no `test` target on the harness

`nx test @ptah-extension/webview-e2e-harness` **does not exist** — that project
defines `lint`, `typecheck` and `e2e` only, and the command fails with
`Cannot find configuration for task ...:test`. The real command is
`nx e2e @ptah-extension/webview-e2e-harness`. The batch text is wrong; this
wins.

**And a full-suite run there is NOT a clean gate.** It reports `37 passed, 32
failed`; all 32 are pre-existing `chat/*` and `sessions/session-create`
scenarios failing on **real network fetches to `fonts.gstatic.com`** and
"browser has been closed". Confirmed pre-existing by re-running with the new
`thoth/` folder moved out — same failures. Anyone treating that suite's exit
code as a gate will read it as their own breakage. Grep your own scenario out
and assert on that.

### → the picker's cross-host rationale is currently moot: VS Code CANNOT REACH the Skills settings

Raised by B1.11, verified directly by the orchestrator. Three gates, all real:

- `thoth-shell.component.ts:241` lists `skills` with **`electronOnly: true`**,
  alongside memory/cron/gateway.
- `skill-synthesis-tab.component.ts:82` independently gates its **entire**
  template — Settings subview included — behind `isElectron()`
  (`:689-690`, `config()?.isElectron === true`).
- The real VS Code host never sets `ptahConfig.isElectron`
  (`webview-html-generator.ts:399-401`), so it is falsy for a genuine webview.

**This directly contradicts `libs/frontend/skill-synthesis-ui/CLAUDE.md:16`**,
which claims the tab "**works in both Electron and VS Code** — skills are not
desktop-only". One of the two is wrong and neither is load-bearing on this
task, so **do not fix it here** — filed as `TASK_2026_238`.

What it means for **global invariant #5**: extracting the picker into
`libs/frontend/ui` and deleting the fork remains correct (single definition,
and `libs/frontend/ui` has other consumers). But its stated rationale — "a fork
strands VS Code users" — is **currently vacuous**, because those users are
already stranded one layer up. Do not cite that rationale as evidence the
cross-host path works; it does not.

Consequently B1.11.2 proves what it can actually prove, and its spec header says
so: the extracted `ProviderModelPickerComponent` **survives being bundled into
the `ptah-extension-webview` app** and driven purely over the generic
`postMessage` transport, with no Electron IPC and no native module. That is the
real regression risk for the extraction. It does **not** prove an unmodified VS
Code user can navigate to these pickers today, because they cannot.

### → `nx e2e ptah-electron-e2e` needs the whole backend to typecheck, including in-flight work

B1.11 could not run the plain command: the dependency chain
(`build-dev` → `thoth-runtime:build`) failed on TS errors inside another
agent's **in-progress** `archaeology/**` edits. It worked around this with
`nx run ptah-electron:build-preload` + `copy-renderer.js` + a pre-existing
`main.mjs`, which is sound **only** because `ui.mockRpc` intercepts the
`ipcMain` RPC channel so the stale main process never executes the real
backend path.

Two lessons. First, the Electron e2e is **not** isolated from backend
compilation — never schedule it concurrently with a backend batch and expect a
clean run. Second, when it is worked around this way, the run proves the
**renderer**, not the backend; say which one you proved.
