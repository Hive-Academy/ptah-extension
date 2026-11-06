# Code logic review: CodeRabbit fix round

Review family: reviewer codex; implementer claude.

## Verdict

REVISE — 6/10 (Round 1). Both original findings are corrected, but a stale skip can leave the indexing panel showing a finished run as active. Round 0's verdict and evidence remain below.

## Findings

1. **Serious — A completion for another workspace clears this workspace's failure notice.** At `libs/frontend/core/src/lib/services/back-office-activity.service.ts:240`, `INDEXING_COMPLETE` still goes directly to `mapIndexingComplete`; `projectFailure` at :191–202 then resolves the notice keyed to the active workspace. The new filter at :242–251 covers only `INDEXING_FAILED`. Reproduce: select A, receive an indexing failure for A, then receive a completion push for B. A's notice disappears. Filter completion by the same normalized workspace root and test B's completion after A's failure. The added test sends only failure pushes.

2. **Moderate — A stale successful census can still masquerade as recovery.** `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1026` returns `true` when the older `lastRun` write is skipped; `settleCensus` at :943–963 treats that as a saved success and emits `INDEXING_COMPLETE`. A background census can finish symbols work but remain live behind a joined manual participant; a newer census can fail before the old manual participant aborts, causing the old record to settle under rule 2. Its background success did not clear `last_error`, while the newer `lastRun` remains failed, yet the push resolves the failure notice via `back-office-activity.service.ts:197`. Distinguish a stale skip from saved success and refresh status without a recovery signal. Add an ordered-settlement test with an aborted manual participant and a newer failed census.

## Disputes

- **Thread 3 — Agree.** `indexing-control.service.ts:918–932` uses the record's first-joiner origin and start time together. Approved P12 says origin is the first joiner. Changing only origin would mix metadata from two participants.
- **Thread 10 — Agree.** `implementation-plan.md:298` requires “Nothing new to harvest” when `harvested` is zero; the same line includes the nonzero reconciled count.
- **Thread 12 — Disagree.** Triage explains the manual-success case, where `last_indexed_at` and `last_error` are updated. Its conceded rule-2 background-success case is reachable and leaves a failed saved state while emitting a recovery completion (finding 2).

## Fix assessment

- **Thread 1:** Pending manual state is set before setup awaits, cleared after joining and in `finally`; controller identity prevents stale entries. Both new status tests would fail before the change. `resume()` setup remains outside their scope.
- **Threads 2, 4, 5, 6:** Template copy distinguishes manual errors and shows the background summary. Refund executes once per stalled pass; the limiter floors counts at zero, and dispatched failures retain their slots. Error and cause text are redacted before logging. The key regex covers `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DB_PASSWORD`, `client_secret_value`; leaves `author` and `tokens`; and has a bounded suffix with no nested unbounded search. The new tests exercise these defects.
- **Threads 7, 8, 11:** Document-review classification uses only the name before `-review`. `parseReviewVerdict` at `spec-extractor.ts:113–155` is unchanged and remains strict: bare bold `**APPROVED — 8/10**` is not a verdict. Migration 0071 is static, idempotent `CREATE INDEX IF NOT EXISTS` on `task_id` with `reconciled_at IS NULL`, matching the query; its test covers registration, repeat application and query planning. Existing migration specs only ratchet the latest version from 70 to 71, plus explanatory comments. Workspace-indexing filters complete and failed pushes by normalized active root; its test covers both and trailing-slash equivalence.
- **Error handling:** No new catch silently converts an error to a success-shaped sentinel. The completion handler's existing `.catch(() => undefined)` at `workspace-indexing.service.ts:299` is unchanged.

## Five logic questions

1. **Silent failure:** Findings 1–2 clear a failure notice without active-workspace recovery, while persisted `lastRun` can say failed.
2. **User action:** Switching workspaces while indexing runs, then receiving the old workspace's completion, can dismiss the new workspace's notice.
3. **Wrong input:** A stale successful background result after a newer failure produces a false recovery signal. Credential names and ordinary words behave as the new redaction tests assert.
4. **Dependency failure:** Dispatched failures retain their hourly slot; failed status reads use an existing logged failure path. No new silent catch was added.
5. **Missing requirement:** Completion events need the same workspace ownership check as failures; stale persistence needs a separate refresh signal.

## Decisions

- **REVISE:** Options were accept the disputes or require correction. The cited code and P12 settlement rules support the reachable stale background case. The correction is reversible.

## Verification

Read the fix patch, triage, cited source and targeted tests; inspected root instructions and P12. No git, nx, npm, build or test command was run, per scope. Coordinator reported passing typechecks and tests except a real-SQLite retention timeout under low memory, plus 10 pre-existing lint errors in untouched 0057/0058 files. Scoped `ptah_get_diagnostics` was unavailable after 45 seconds and returned three files unchecked; this review claims no independent compiler pass. No review skill loader was exposed in this host.

## Round 1

### Verdict

REVISE — 6/10. The two round 0 failures are fixed and the new tests exercise both regressions. The remaining panel state error is reproducible from the same ordered settlement, keeping this below the sound 7–8 band. It is above 3–4 because persistence ordering, notice ownership, and the failure signal now behave correctly.

### Findings

1. **Moderate — A stale skip can leave the panel indexing indefinitely.** At `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:947`, the old census leaves `liveCensuses` before `settleCensus` returns without a push. In the added test's sequence, the newer failure emits `INDEXING_FAILED` while the old background census is still live. `getStatus()` at :375/:400 therefore reports `running` and `state: 'indexing'` despite the newer persisted failure. The frontend refreshes on that failed push (`libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:303–307`) and derives its panel state from the saved running snapshot (:220–226). The old census then settles with no message; only a workspace change, manual action, or another push causes a later status read. Its progress can also remain stale. Emit a status-only refresh signal on stale settlement and handle it by clearing progress and reading status, without mapping it to a completion or failure notice. No existing indexing push has those semantics: `INDEXING_PROGRESS` only updates progress, while complete/failed also change activity and notices. Add a frontend test that leaves an old census live during a newer failed push, then settles it and checks the panel moves from indexing to the persisted error without user action.

### Fix assessment

- **Round 0 finding 1 fixed:** `back-office-activity.service.ts:234–248` gates both completion and failure by the same normalized active root. The new test at `back-office-activity.service.spec.ts:299–330` sends A failure, B completion, then A completion; it would fail without the gate.
- **Round 0 finding 2 fixed:** `indexing-control.service.ts:944–948` distinguishes `'stale-skipped'` and suppresses the false recovery push. The new test at `indexing-control.service.spec.ts:1433–1467` would fail without that branch, since it asserts zero completions after the old background success. It checks the newer failed `lastRun` remains stored, but does not inspect a frontend snapshot taken before the old run exits.
- **Persistence contract retained:** `persistLastRun` returns `'written' | 'stale-skipped' | 'failed'` at `indexing-control.service.ts:1006–1010`; it reads before writing, returns failed without a write on a failed read (:1013–1019), retains three compare-and-set attempts (:1012/:1036–1043), and distinguishes an older sequence from a conflict. A failed write remains logged (:1073–1079). No new silent error swallowing was introduced by this round.

### Five logic questions

1. **Silent failure:** The backend silently skips only the stale push, which leaves a previously delivered running snapshot stale in the UI (finding 1).
2. **User action:** Reopening the panel or switching workspace forces a status read; leaving the panel open does not.
3. **Wrong input:** B's completion no longer clears A's notice; the same-workspace test covers it.
4. **Dependency failure:** A failed persistence read returns `'failed'` and never reaches compare-and-set; write failures are warned.
5. **Missing requirement:** A stale settlement needs a refresh notification that carries neither recovery nor failure semantics.

### Decisions and verification

- **REVISE:** Options were to accept the missing push as a delayed refresh or require an immediate refresh signal. `runningView` includes the still-live old census when the newer failure push is handled, and no automatic later read exists. Requiring a refresh is reversible.
- Read the changed service methods, both new tests, triage, and the frontend panel state path. The coordinator reports scoped checks passing. No git, nx, npm, build, or test command was run in this review. No skill loader is exposed in this host; no skill instructions were reconstructed.

## Round 2

### Verdict

APPROVED — 8/10. The stale settlement now prompts a status read after the old census leaves the live set, so the panel can replace its stale indexing snapshot with the persisted failure. No new code-logic defect found in this round.

### Findings

None.

### Fix assessment

- `indexing-control.service.ts:944–965` distinguishes a stale-skipped write and emits one `INDEXING_COMPLETE` with `refreshOnly: true`; it preserves the newer `lastRun` and emits no success or failure result for the old census.
- `workspace-indexing.service.ts:295–305` applies the active-root filter before clearing progress and re-reading status. The refresh can therefore remove the old `running` view without replacing another workspace's panel.
- `back-office-activity.service.ts:234–249,496–507` retains the active-workspace filter and maps `refreshOnly` to no activity item. Since notice resolution follows activity projection, the newer failure notice remains.
- The other readers of `WorkspaceIndexingService.completedAt()` (`memory-curator-tab.component.ts:456–467` and `workspace-vitals.store.ts:358–363`) use its change to reload stats, symbols, or status. They do not announce a completion or resolve a failure. Reloading stats after the old symbol work settles is consistent with this signal's refresh purpose.
- `indexing-control.service.spec.ts:1435–1475` would fail without the new backend push. `workspace-indexing.service.spec.ts:556–604` verifies the stale-running-to-error transition when that push is delivered; alone it simulates the push and does not prove backend delivery. `back-office-activity.service.spec.ts:335–353` would fail if the refresh were mapped to completion and resolved the notice.

### Five logic questions

1. **Silent failure:** The stale skip now broadcasts a refresh; failed persistence reads and writes still use the existing logged failure path. No new catch silently returns a sentinel.
2. **User action:** The panel refreshes on the push, without a workspace switch or manual action.
3. **Wrong input:** The active-root check rejects a refresh for another workspace; the same-root notice remains failed.
4. **Dependency failure:** If the refresh status RPC fails, the existing status read path warns and retains its last snapshot. This is an existing read-failure behavior, outside the stale-settlement fix.
5. **Missing requirement:** The emitted signal carries status-refresh semantics through all `INDEXING_COMPLETE` consumers; no consumer turns it into a recovery notice.

### Decisions and verification

- **APPROVED:** The backend push closes Round 1 finding 1. The shared `refreshOnly?: true` contract is additive, and the two direct consumers preserve workspace isolation and failure ownership.
- Read the round 2 diff, triage, service implementations, relevant tests, and all `INDEXING_COMPLETE` references in `libs/` and `apps/`, including indirect `completedAt()` readers. No git, nx, npm, build, or test command was run. Skill discovery found no locally invocable review skill in this host.
