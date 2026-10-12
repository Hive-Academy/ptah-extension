# Batch 20 report: retention, ranking and snapshot audits

The executor was a backend-developer sub-agent working in the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`.

- It ran no git command that changes state, committed nothing, and left the working tree dirty.
- It launched no bench host and did not run `bench-memory-skills` or `nx run mcp-bench:test`.
- It did not call `withPinnedCorpus`, did not read the real `~/.ptah`, and did not open the private snapshot.
- It edited no 619-owned file (`scorecard/`, `transport/`, `corpus/`, `bench-data.ts`).

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\`.

| File | Status | Task | Role |
|---|---|---|---|
| `suites\memory\retention.suite.ts` | CREATED | 20.1 | Host-suite wiring: `createRetentionSuites({ portOf })`. It parses options, loads the seed, picks the per-suite workspace key and writes the result. |
| `suites\memory\retention-support.ts` | CREATED | 20.1 | `RetentionPort` contract, `installSimulatedClock`, epochs, `retentionOptionsSchema`, `loadRetentionSeed`, `CallLedger`, `seedRows`, `runNaReason`. |
| `suites\memory\retention-lifecycle.ts` | CREATED | 20.1 | `mem.retention.lifecycle`, plus the pure `simulatePolicy` and `summarizeLifecycle`. |
| `suites\memory\retention-growth.ts` | CREATED | 20.1 | `mem.retention.growth`: observation load, the 9-day stall and DB bytes per day. |
| `suites\memory\retention-roster.ts` | CREATED | 20.1 | `mem.ranking.roster`: roster NDCG@10 against recency only. |
| `suites\memory\retention-seed.ts` | CREATED | 20.1 | Deterministic seed rows: hash draws, kinds, question days and usage distribution. |
| `suites\memory\retention-port.ts` | CREATED | 20.1 | **Host-only** product adapter `hostRetentionPort(context)`. |
| `suites\memory\retention.suite.spec.ts` | CREATED | 20.1 | 12 tests over an in-memory port that models today's product. |
| `suites\audits\snapshot-audits.suite.ts` | CREATED | 20.2 | `mem.liveness.audit` and `skill.backlog.audit`, exported as `SNAPSHOT_AUDIT_SUITES`. |
| `suites\audits\snapshot-audits.suite.spec.ts` | CREATED | 20.2 | 13 tests over a small synthetic SQLite DB in a temp dir, built from the product's real `MIGRATIONS`. |
| `host\memory-skills-host.entry.ts` | MODIFIED | both | Registration in `HOST_SUITES` (see Registration). |
| `host-only-imports.spec.ts` | MODIFIED | 20.1 | Adds `suites/memory/retention-port.ts` to `HOST_ONLY_MODULES`. |

## Design

### 20.1: retention, lifecycle and roster (host suites)

**Port.** The three suites drive one narrow `RetentionPort`, the same pattern as Batch 19's `ReadSidePort`.

- The suites themselves never value-import the memory-curator barrel.
- `retention-port.ts` is the host-only adapter. It is wired in by the host entry only.

The adapter builds or resolves these pieces:

- **Retention service.** A suite-local `MemoryRetentionService`, constructed positionally from the host's own singletons. These are the logger, workspace provider, SQLite connection, page reclaimer, `OBSERVATION_RETENTION_STORE`, `MEMORY_RETENTION_LIMITS` and `MEMORY_LIFECYCLE_SERVICE`.
  - The governor is passed as `null`. That parameter is optional in the product. A real governor defers batches on real time, which the simulated clock cannot reproduce.
  - The service is built when the port is built, before the clock is installed. The product's boot-deferral gate therefore measures from real time.
- **Memory store.** `MemoryStore.insertMemoryWithChunks` and `recordUse`.
- **Observation queue.** `ObservationQueueStore.enqueue`, `flush` and `countUnprocessed`.
- **Read-only SQL on the bench DB.** It reads two things:
  - `memories` tier by exact `workspace_root`;
  - the `observation_queue` row count per session.
- **DB size.** `SqlitePageReclaimer.readPageStats()`, as `pageCount * pageSize`.
- **Roster.** `MemoryPromptInjector.buildSessionStartBlock`.
- **Curation.** The Batch 17 liveness harness (`hostLivenessParts` and `invokeObservationPass`), which runs the real `MemoryTriggerService.invokeCurate`. A stall day sets the scripted curator's `'stalled'` fault. That fault is reproduced through `RecordedCuratorLlm`'s own fault arm, so the replay double returns the stall outcome (provider-unreachable). No model is called.

**Injected `nowMs`, days 0..180.** Each day `T = epoch + day × 24 h`:

- The day's retention run is `run({ now: () => T, isOnBattery: () => false, msSinceForegroundActivity: () => ∞ })`.
- `Date.now` is replaced by the same simulated clock for the suite's whole duration (`installSimulatedClock`) and restored in `finally`. The product stamps the following from `Date.now()`:
  - `created_at` and `last_used_at`, in both insert and `recordUse` (`memory.store.ts:199,665`);
  - `captured_at` (`observation-queue.store.ts:355`);
  - `processed_at`;
  - the roster's rank instant (`memory.store.ts:517`).
- Day 0 of each suite lies in the 2100s: lifecycle `2100-01-01`, growth `2101`, roster `2102`.
  - The boot-deferral gate compares the injected clock with the real construction time, so a past epoch would defer every run. The product's own `memory-retention.integration.spec.ts:59-60` uses a far-future `NOW` for the same reason.
  - The suites' epochs are a year apart, so a later suite in the same host is never `not-due` behind an earlier one.
- A spec proves `Date.now` is restored after success and after a port that throws.

**Seed (`retention-seed.ts`).** The default seed comes from the committed `gt-memory@v1` fixtures:

- **Useful rows: 9.** Every fact except the abstention fact F-009, whose statement is never stored by design.
  - Kind: `preference` if any tag contains "preference", `event` for the `temporal` category, otherwise `fact`.
  - Each gets a question day drawn from `1..days`.
- **Disposable rows: 7.** The `distractor` records. Their kind is drawn over fact, preference, event and entity.
- **Usage.** `last_used_at` age, `hits` and `salience` are drawn by `sha256(seed, id, field)`, so the draw is deterministic and independent of row order. The draw does not depend on the label unless the plan gives the two labels different distributions.
- **Labelled rows file.** `options.rowsFile` (in `retentionSeedRowSchema` lines) replaces the fixture-derived seed with the labeller's seed.
- Seeding goes through the product: the clock is set to `epoch - age`, then `insertMemoryWithChunks` runs, then `recordUse` runs once per hit. No raw SQL writes.

**`mem.retention.lifecycle`.** Each day has a retention run at `T`, then the DB bytes, then a snapshot of the stored rows. At `T + 12 h` the day's held-out questions are asked: the row's state is recorded as `kept`, `archived` or `removed`, and a stored row is used through `recordUse`.

Metrics, each written as `<name>`, `.num` and `.den` through `rate()`:

- **`falseDelete`**: useful rows already removed (deleted or evicted) when their question came, over useful rows.
- **`falseRetain`**: disposable rows still stored at day `days`, over disposable rows. Disposable rows get no use events, so at day 180 they have been idle longer than `archiveAfterDays + deleteAfterDays` = 90.
- **`archivedThenNeeded`**: useful rows found archived on their question day.
- **By kind**: `byKind.<kind>.falseDelete` and `.falseRetain`.
- **`ageOnlyAgreement`**: the share of rows whose fate matches the pure age-only baseline. This is a cross-check of the baseline against the product.
- Run counts by status.

Baselines (design :190) are the pure `noLifecyclePolicy`, `ageOnlyPolicy` and `oracleRetentionPolicy`, simulated over the same rows, days and questions with the same use semantics.

- Their thresholds come from the product at run time (`readMemoryLifecycleSettings(workspace)` and `limits.capEvictionGraceMs`), so the baselines match the run's effective settings.
- Each case record `row/<id>` carries `baselineOutcomes` for all three policies.
- Verdict: `pass` requires `falseDelete.num = 0` and `falseRetain.num = 0`. It is `na` when any run was `skipped` or `failed` (`retention-run-<status>: <reason>`), or when the lifecycle reported `vec-unavailable` or `disabled` (`lifecycle-<note>`). Without vec, nothing is deleted, which would pass falsely.

**`mem.retention.growth`.** Each day, in order:

1. The retention run at `T`.
2. Unprocessed observations deleted by that run. This is the unprocessed count of the pending sessions before the run minus the count after it. Retention never writes `processed_at` (`memory-retention.service.ts:29-30`).
3. DB bytes after the run's reclaim step.
4. At `T + 1 h`, 4 sessions × 10 observations are enqueued: 1 user prompt with an `LV-g…` marker plus 9 tool-use rows of 2,048 B. The per-session count stays below the trigger's 20-turn threshold.
5. At `T + 2 h`, one curation pass runs per session. Days 20-28 are stall days.

Metrics and verdict:

- `unprocessedDeleted` as a rate over enqueued observations;
- `unprocessedObservationsDeleted`;
- `observationRowsAtEnd`;
- `dbBytes.{day0,mid,final,max}` and `bounded`. Bounded means `bytes(days) ≤ bytes(days/2) × 1.05` (`GROWTH_TOLERANCE`);
- pass counts by outcome;
- `details.dbBytesByDay`, with 181 entries.
- The baseline is `no-retention`: 0 deleted, and every enqueued row kept.
- Verdict: `pass` requires 0 unprocessed deleted and a bounded DB. It is `na` on a skipped or failed run, on a curate that threw (`curate-threw: n`), or when no pass ran.
- There is one case per day (`day/NNN`).

**`mem.ranking.roster`.** Rows are seeded at day 0. At `T`, `buildSessionStartBlock` runs and its numbered list is parsed (`parseRosterSubjects`). Subjects map back to seed ids; an unknown subject throws.

- Scoring uses 619's `ndcgAtK` and `recallAtK` with k = 10 (`memory-prompt-injector.ts:71`), against the useful ids.
- The baseline is recency only: last use, newest first, with ties broken by id.
- There is one case per useful row: is it in the top 10?
- Verdict: `pass` only when product NDCG@10 is strictly greater than recency. An equal score is "no effect" and fails.

**Shared contract.**

- Every rate metric has `value === num / den`, or `null` when `den = 0`. A spec helper checks this for the product metrics and for every baseline.
- `inputSha256` and `observed` hold no run path. The per-suite workspace key `<runDir>/workspaces/<id>` is never printed.
- A spec runs each suite twice in different temp dirs and gets an identical `projectionSha256` through `toScorecardSuite`, with `cost.source = 'none'` (`modelCalls` is 0).
- The runner records the per-case JSONL as `620.case.curation.v1`, because all three suites are kind `curation`.

### 20.2: snapshot audits (local host suites)

These are host suites because only the host has the isolated home.

**Safety.**

- The plan lists the snapshot as a `file` fixture. The fixture seeder copies and hash-checks it before boot.
- The suite resolves the copy with `resolveHomeFile`, which refuses an absolute path or anything outside the home. The original in the bench data folder is never opened.
- The suite opens the copy with `withReadonlySnapshot` (`data/candidate-row-diff.ts`). That helper opens it readonly with `fileMustExist`, checks the expected sha256 first, and fails if the hash changed or a sidecar appeared.
- Only `SELECT` is used. Ground truth is the rows of `observation_queue`, `memories`, `skill_synthesis_queue` and `skill_candidates`. The suite never reads the product's counters (`memory_retention_state`, `skill_backlog_cleanup_state`).
- The defaults are the frozen copy `snapshots/ptah-20261006-pre-retention.sqlite` with sha256 `82cd16ac…d575a`.
- "As of" is the newest timestamp in the snapshot (or `options.asOf`), never the wall clock. It is also recorded as `groundTruth.frozenAt`.

**`mem.liveness.audit`** (kind `liveness`, `source: 'snapshot-audit'`).

- `unprocessedAgeP95Ms`, by nearest rank over unprocessed rows.
- `sessionsWithObservationsNoMemories`, as a rate. The denominator is sessions whose newest observation is more than 24 h old; the numerator is the subset with no `memories` row carrying that `session_id`.
- `sessions.processedNoMemories`: the silent-consume proxy, meaning fully processed sessions with no memory.
- `memories.sessionIdPopulated`, as a rate. This checks the join assumption on the data itself.
- Observation totals.
- Two invariant cases:
  - p95 ≤ 24 h;
  - orphaned sessions = 0.
- Two metrics are **not measurable** from a DB and are reported as `null`, never as a pass: `extractionPassErrorShare` and `ranPassesWithError`. Curator passes live only in an in-memory ring buffer (`curator-llm/curator-activity-log.ts:1-15`).

**`skill.backlog.audit`** (kind `funnel`). It reads four stages: `prefilter`, `archaeology`, `judge-panel` and `trigger-eval`.

- **Per stage**, over rows with status `queued`:
  - queued count;
  - age p95 in days;
  - rows older than 14 days.
- **Weekly net backlog slope.** The mean of `enqueued − finished` over the last `slopeWeeks` complete weeks (default 4). A finished row has status `done`, `skipped`, `failed` or `unscored`.
- **Candidate shares:**
  - judged share (`judge_status IS NOT NULL`);
  - share rejected by backlog cleanup with no judge row (`rejected_reason LIKE 'backlog-cleanup:%'`).
- Invariant cases per stage: age p95 ≤ 14 days, and net slope ≤ 0. Judged share is reported but not gated (see Deviation 8).
- The details hold one `backlog-drain` stage carrying the 8 invariants, plus `backlog[]` rows per stage and a `candidates` row for the judged share.

**Baselines.**

- **Recorded.** Only figures the sources state, never guessed:

  | Baseline id | Source | Figures |
  |---|---|---|
  | `471` | `forensics.md:162,:280` | prefilter queued 605; candidates 2,433 |
  | `forensics-copy-2026-10-06` (backlog) | `forensics.md:151,:171,:280` | prefilter 1,193; archaeology 132; judge-panel 152; trigger-eval 152; queued >14 d 677; candidates 2,587; unjudged 2,347; judged share 240/2,587 as num/den; cleanup-rejected 1,869 |
  | `forensics-copy-2026-10-06` (liveness) | `forensics.md:14-15,:72` | observations 91,783; unprocessed 59,614 |

- **Previous release.** `options.previousSnapshot {file, sha256, label}` is audited with the same SQL and becomes the `previous-release` baseline.
- `deltas` cover every baseline.

## Assumption check: `observation_queue.session_id` + `memories.session_id` (design :203)

**HOLDS at the schema level.**

- `observation_queue.session_id TEXT NOT NULL`: `libs/backend/persistence-sqlite/src/lib/migrations/0016_observation_queue.ts:19`. Its index `idx_obs_queue_session(session_id, processed_at, captured_at)` is at `:32`.
- `memories.session_id TEXT` (nullable): `libs/backend/persistence-sqlite/src/lib/migrations/0002_memory.ts:14`. Its index `idx_memories_session` is at `:30`.
- Extracted rows carry the session id:
  - the curator inserts with `sessionId: input.sessionId` (`libs/backend/memory-curator/src/lib/memory-curator.service.ts:864-866`);
  - the store writes `session_id: blankToNull(insert.sessionId)` (`libs/backend/memory-curator/src/lib/memory.store.ts:214`).
- Migration 0051 (`0051_skill_lifecycle.ts`) touches neither table. It only creates `skill_backlog_purge_state` (`:37`).
- The spec test "pins the schema assumption" checks `PRAGMA table_info` on a DB built from all product `MIGRATIONS`: `observation_queue.session_id` has `notnull = 1` and `memories.session_id` has `notnull = 0`.
- Whether the data actually populates the column is measured on every run by `memories.sessionIdPopulated` (num/den). A snapshot where the join cannot hold shows it there.

## Expected failures today

These are recorded, not hidden. Entries for `known-failures.v1.json` belong to that file's owner.

The figures below come from the spec double that models today's product. The real values exist only after a host run.

- **`mem.retention.lifecycle`** (forensics M4):
  - `falseDelete` 5/9;
  - `archivedThenNeeded` 3/9;
  - `falseRetain` 0/7;
  - verdict `fail`.

  On the baselines: oracle `falseDelete` is 0/9 and `falseRetain` is 1/7 (a disposable row with `hits > 0` is protected); no-lifecycle `falseRetain` is 7/7. The spec pins all of these.
- **`mem.retention.growth`** (forensics M2):
  - `unprocessedObservationsDeleted` 360 (9 stall days × 4 sessions × 10 observations);
  - `unprocessedDeleted` 360/7,240;
  - cases `day/035`…`day/043` fail;
  - verdict `fail`.

  Without a stall the suite passes, and the spec covers that case too.
- **`mem.ranking.roster`.** No claim is made. On the double (product `rankSalience`), NDCG@10 is 0.664 against 0.674 for recency only, which is `fail` ("no effect"). This matches forensics M7, where salience has no label.
- **`mem.liveness.audit`** and **`skill.backlog.audit`.** Their real values exist only after the local run. On the synthetic DB, both fail as designed and a clean DB passes.

## Registration (done)

In `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`:

```ts
import { SNAPSHOT_AUDIT_SUITES } from '../suites/audits/snapshot-audits.suite';
import { hostRetentionPort } from '../suites/memory/retention-port';
import { createRetentionSuites } from '../suites/memory/retention.suite';
// HOST_SUITES:
  ...createRetentionSuites({ portOf: hostRetentionPort }),
  ...SNAPSHOT_AUDIT_SUITES,
```

- `HOST_ONLY_MODULES` gains `suites/memory/retention-port.ts`. It value-imports the barrel and the liveness harness, and only the host entry imports it.
- `retention.suite.ts` and its split modules import only types from the port side.
- The audit suite imports no host-only module.
- No `OFFLINE_SUITES` entry: all five suites need the host, either for the product services or for the isolated home.

## Pending live recording

**No cassette is needed.**

- The retention suites call no model: the curation passes use the scripted curator and the double's stall arm, so `modelCalls` is 0.
- The audits are pure SQL.

What is pending is one **local host run** of each group, which I did not do (instructed). The plan below is an example to write at `<benchData>/plans/batch-20.local.json`. Paths in angle brackets are placeholders.

```json
{
  "fixtures": [
    { "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl", "target": "memory-skills/memory-facts.v1.jsonl" },
    { "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl", "target": "memory-skills/distractors.v1.jsonl" },
    { "kind": "file", "source": "C:/Users/abdal/AppData/Local/ptah-mcp-bench/snapshots/ptah-20261006-pre-retention.sqlite", "target": "snapshots/ptah-20261006-pre-retention.sqlite" }
  ],
  "hostSuites": [
    { "id": "mem.liveness.audit" },
    { "id": "skill.backlog.audit" },
    { "id": "mem.ranking.roster" },
    { "id": "mem.retention.lifecycle" },
    { "id": "mem.retention.growth" }
  ]
}
```

Command, not run: `npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/batch-20.local.json`

- The audits are listed first because the retention suites age every row in the isolated DB.
- The CI plan must omit the two audits and the snapshot fixture (R-M1a).
- The measured usage histogram for `options.usage` (last-use age and hits) should come from the same snapshot. Measuring it is pending too: the default `DEFAULT_USAGE_DISTRIBUTION` is provisional (see Deviation 5).

## Checks (exact output)

- **Scoped jest.** `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` → `Test Suites: 44 passed, 44 total` / `Tests: 500 passed, 500 total`.
- **Typecheck and lint.** `npx nx run-many -t typecheck,lint -p mcp-bench` → `√ nx run mcp-bench:lint`, `√ nx run mcp-bench:typecheck`, `Successfully ran targets typecheck, lint for project mcp-bench`. Nx Cloud printed its "organization disabled (FREE plan)" notice, which does not affect the local run.
- **Prettier.** `npx prettier --check --ignore-unknown <12 changed files>` → `All matched files use Prettier code style!`
- **Host build.** `npx nx run mcp-bench:build-host-memory-skills` → `Successfully ran target build-host-memory-skills for project mcp-bench and 33 tasks it depends on`.
- **Eslint on the 12 changed files.** `npx eslint <12 changed files>` exits 0 with no output.
  - A first pass flagged `max-lines` (1,066 > 700) on a single `retention.suite.ts` and an unused `WEEK` constant in the audit spec.
  - Both were fixed by the split described in Deviation 1.

## Deviations

1. **Seven files for 20.1 instead of two.** The batch names `retention.suite.ts` and its spec. One file broke the project's `max-lines: 700` rule, so it is split by responsibility:
   - wiring (`retention.suite.ts`);
   - shared contract and clock (`retention-support.ts`);
   - one module per suite (`retention-lifecycle.ts`, `retention-growth.ts`, `retention-roster.ts`);
   - the seed (`retention-seed.ts`);
   - the host-only product adapter (`retention-port.ts`).

   It is the same port pattern Batch 19 used.
2. **`Date.now` is replaced process-wide for each suite's duration.** The product has no clock seam for `recordUse`, `enqueue`, `insertMemoryWithChunks` or `listAll`; they call `Date.now()` directly. The host contract allows suite-scoped process state that the suite restores. The clock is restored in `finally`, and a spec covers the throw path.
   - Residual risk: a real host timer that fires during the suite would see simulated time. Idle curation (10 min) and the hourly retention cron are both longer than the expected suite runtime.
3. **No background-work governor in the suite-local retention service.** See Design.
4. **The 9-day stall uses the liveness harness's scripted curator.** It does not use the plan's cassette double. The stall outcome itself is `RecordedCuratorLlm`'s own `'stalled'` fault arm, the same choice and rationale as Batch 17: the observation path's transcript is only known inside the trigger.
5. **The default usage distribution is provisional.** It is a 3-bucket shape taken from the forensics M4 aggregates (`forensics.md:103`), not a histogram measured on the snapshot. The plan overrides it through `options.usage`.
6. **Interpretations of the design wording:**
   - false-retain is "still stored (any tier) at day `days`";
   - growth "bounded" is a 5% tolerance between mid and final bytes;
   - `no-retention` is count-only, because bytes cannot be measured without a second DB;
   - the roster passes only on a strict NDCG improvement.
7. **`groundTruth.method` is `generated` for the snapshot audits.** The core enum has no `snapshot` value (see Requests to 619). For the growth suite it is also `generated` (a synthetic load). For lifecycle and roster it is `seeded` (`gt-memory-retention@v1`).
8. **The backlog audit gates only age p95 and net slope.** The design S4 metric names exactly these two. Judged share and cleanup-without-judge share are reported, not gated. The funnel `backlog[]` adds a `candidates` row so the renderer shows the judged share.
9. **`baselines/retention-policy-defaults.ts` is not used by the suites.** Product thresholds are read at run time by the host port, which is more exact than the default constants. The spec uses `DEFAULT_RETENTION_POLICY_SETTINGS`.

## Requests to 619

- Optional: add a `groundTruth.method` value for a frozen release snapshot (for example `snapshot`). The audits currently report `generated`.

## Out-of-scope observations

- **Plan composition affects the retention suites.** They mutate global DB state: every row in the isolated DB is archived or deleted on the simulated clock. Their DB-bytes series also depends on what earlier suites left in the DB. The projection is stable for the same plan, but not across different plans. A plan should run them last, or alone.
- **Two liveness figures cannot be measured from a snapshot.** The extraction-pass error share and the count of `'ran'` passes with an error have no persistent store. The future liveness fix should add a durable pass ledger if these are to be audited per release.

## Phase 3.5 fixes (review `code-logic-review-phase3-5.md`, findings 4 and 5)

Plan ordering is now enforced in code, not only documented. The out-of-scope note above about plan composition is superseded by this section.

**The model.** `MemorySkillsHostSuite` has an optional `placement: 'any' | 'first' | 'last'` (default `any`):

- `first`: the suite must be the first host suite. `mem.scope.write` declares it, because it measures a database no other suite has written.
- `last`: only other `last` suites may follow it. `mem.retention.lifecycle`, `mem.retention.growth` and `mem.ranking.roster` declare it, because they archive and delete every row.

The rules live in one pure module, `tools/mcp-bench/src/memory-skills/host/suite-placement.ts`:

- `suitePlacementProblems(ids, placementOf)` returns every violation with the offending index.
- `HOST_SUITE_PLACEMENTS` is the same id-to-placement table for the runner parent, which cannot load the host suites.
- This is the one file outside the listed set. It is new, and no other agent touches it.

**Where a bad plan is refused, before any suite runs:**

- `runner/runner-plan.ts` (`hostSuites`), as a zod issue at `hostSuites[i].id`;
- `host/plan.schema.ts` (`suites`), as an issue at `suites[i].id`;
- `host/memory-skills-host.ts`, before boot, as `MemorySkillsPlanError: the plan orders host suites unsafely: …`. This check uses each registered suite's declared `placement`.

**Defence in depth (finding 4).** `scope-write.suite.ts` now returns `na` with reason `shared-db-not-fresh: <n> pre-existing rows` whenever `preexistingRows > 0`. That covers a seeded `database` fixture too, which the order check cannot see.

**Specs:**

- `host/suite-placement.spec.ts` (new):
  - the rules: valid order accepted, a second `first` refused, and every non-`last` suite after the first `last` refused;
  - a drift guard: the placement each registered suite declares equals `HOST_SUITE_PLACEMENTS`.
- `runner/runner-plan.spec.ts` (new): a valid plan is accepted, scope-write after another suite is refused, a suite after a retention suite is refused, and offline suites are excluded from the ordering.
- `host/plan.schema.spec.ts`: one valid plan and the two violations.
- `host/memory-skills-host.spec.ts`: both violations are refused before boot, and no suite runs.
- `suites/memory/scope-write.suite.spec.ts`: a pre-existing row gives `na` with that reason, and the suite declares `first`.

**Checks:**

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host tools/mcp-bench/src/memory-skills/runner tools/mcp-bench/src/memory-skills/suites/memory/scope-write.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/retention.suite.spec.ts --runInBand` → `Test Suites: 15 passed, 15 total` / `Tests: 150 passed, 150 total`.
- `npx nx run-many -t typecheck,lint -p mcp-bench` → `Successfully ran targets typecheck, lint for project mcp-bench`.
- `npx nx run mcp-bench:build-host-memory-skills` → `Successfully ran target build-host-memory-skills for project mcp-bench and 33 tasks it depends on`.
- `npx eslint <12 touched files>` → exit 0, no output.
- `npx prettier --check --ignore-unknown <12 touched files>` → `All matched files use Prettier code style!`

**Plan consequence.** The example local plan above is valid only without `mem.scope.write`. If it is added, it must be the first host suite, ahead of the audits.

The snapshot audits stay `any`. They read a snapshot copy, not the shared DB, but the simple rule still requires them to run before the retention suites.
