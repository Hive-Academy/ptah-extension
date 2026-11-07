# Batch 5 report: O2 host-origin effect and store precedence (TASK_2026_879_9809)

Executor: backend-developer subagent. I ran no git commands and did not edit `batches.md`.

## Tasks

### 5.1 `origin: 'host'`, `hostObserved`, `hostDeliverablesReportId` (done)

- `DeliverablesPayloadSchema` now has `origin: z.literal('host').optional()` inside the existing `.strict()` object. Any other value (`'agent'`, `'Host'`, `''`, `null`, `true`) fails to parse, so `reportEffectOf` returns `null` and the store records the report as `invalid`.
- When `origin === 'host'`, `reportEffectOf` adds `hostObserved: true` to the deliverables effect. Explicit reports do not carry the property.
- `hostDeliverablesReportId(runId)` returns `deliverables:host:${runId}`. It sits next to `deterministicReviewReportId`.
- Evidence: `write/report-effect.spec.ts` has a new `describe('host-origin deliverables')` with tests for the mapping, the five rejected origins, the id format and uniqueness per run, and `applyOutcomeEffect` skip/apply.

### 5.2 Precedence in `applyOutcomeEffect` (done)

- `OutcomeReportEffect` (deliverables variant) gains `readonly hostObserved?: true`.
- The first statement of the deliverables branch is now `if (effect.hostObserved && row.deliverablesDeclaredAt !== null) return row;`.
- An explicit report after a host one runs through the unchanged code path. On a subagent row the existing rule overwrites the verdict. On a failed lane row the failure verdict stays, which is the existing rule.
- Where it runs: `applyOutcomeEffect` is called only inside the store write units.
  - sqlite: `applyInTransaction`, under `db.transaction` in both `applyReportWithReceipt` and `insertStopWithHeldReports`.
  - in-memory: the synchronous bodies of `insertStopWithHeldReports` and `applyReportWithReceipt`, with no `await` between read and write.
  - key-value: `KeyValueLaneOutcomeStore extends InMemoryLaneOutcomeStore`, so it uses the same code.
  - So there is no check-then-write race, and an explicit report wins in either order.

### 5.3 In-memory store spec (done)

`store/in-memory-lane-outcome.store.spec.ts` has a new `describe('InMemoryLaneOutcomeStore host-observed deliverables')`:
- a host report on an undeclared row applies (`no-deliverable`, `deliverablesDeclaredAt` set);
- host then explicit: the explicit verdict (`delivered`) wins;
- explicit then host: the row is unchanged (`toEqual(before)`);
- an explicit report held before the stop joins at insert, and a later host report is a no-op;
- a repeated host report id returns `duplicate`, and the receipt exists;
- an unknown origin returns `invalid`, with no row change and no receipt.

### 5.4 sqlite store spec (done)

`store/sqlite-lane-outcome.store.spec.ts` has a new `describe('SqliteLaneOutcomeStore host-observed deliverables')` with the same six cases. It adds one more: a host report held before insert joins at insert, then yields to a later explicit report. The repeated-host case counts the `lane_outcome_report_receipts` rows for `deliverables:host:subagent:host` and asserts exactly 1. There is no schema migration; the receipts table and `deliverables_declared_at` already exist.

## Changed files

- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/write/report-effect.ts
- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/write/report-effect.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts
- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts

All changes are additive. Running prettier on the two store specs had reformatted older lines, so I rebuilt both files from HEAD plus only my new import and describe block. `git diff -U0` shows only my hunks.

I did not touch the Batch 2 files, `index.ts`, lane-routing or platform-core.

## Risks

- **R3, MCP cannot claim host origin.** `vscode-lm-tools/.../outcome-report.tool.ts:203-210` builds the payload field by field as `{checks, taskKind, taskId, routingSource}` from the strict `OutcomeReportArgsSchema`. `origin` is not among those fields, so the MCP path cannot pass it through. The only producer will be the recorder (Batch 7).
- **R4, precedence race.** The check runs inside the store write unit, as described in 5.2. Both orders are tested in both store specs.
- **Idempotency.** The receipt check (`receiptExists` / `receipts.has`) runs before the effect, so a repeated `deliverables:host:<runId>` returns `duplicate`.
- **Held payload holds no paths.** The host payload holds only stat facts plus `origin`.

## Verification

1. `npm run verify -- -p @ptah-extension/lane-outcomes` (first run): `NX 3 tasks: 2 succeeded, 1 failed`.
   - The test target failed on a TS2345 error in my new spec code: `outcomeRow()` returns a `LaneOutcomeRecord`, but `reportEffectOf` needs a `LaneOutcomeRow`.
   - I fixed it by adding `budgetStopped: false` to the spec row.
   - My `grep` filter had hidden the details, so I re-ran `-t test` once to read them.
2. `npm run verify -- -p @ptah-extension/lane-outcomes` (after the fix): lock held for 234 s, `NX 3 tasks: 2 succeeded, 1 failed`.
   - lint and typecheck passed; lint reported 1 warning in `outcome-write-pipeline.ts`, which is not my file.
   - test: `Tests: 1 failed, 318 passed, 319 total`.
   - The one failure was `KeyValueLaneOutcomeStore > expires holds including markers and keeps the 497 plus one capacity case` (Expected 497, Received 1). This is the known hold-TTL load flake: the suite took 51 s and the holds expire 1 s after `Date.now()`. That test does not use the Batch 5 code.
3. `npm run verify -- -t test -p @ptah-extension/lane-outcomes -- --testPathPatterns=key-value-lane-outcome.store.spec`: `NX 1 task: 1 succeeded`, `Test Suites: 1 passed`, `Tests: 10 passed, 10 total`.

The output did not print an explicit "Running target ... for N projects" header. The verify lock line names only `(@ptah-extension/lane-outcomes)`, and Nx ran 3 tasks (lint, test, typecheck) for that one project.

## Decisions

- **A host no-op still writes a receipt and returns `applied`.**
  - Options: (a) return the row unchanged inside `applyOutcomeEffect` and keep the receipt; (b) add a new store result such as `skipped`.
  - Choice: (a). It is what the plan states ("returns the row unchanged"). It needs no change to the store interface. The receipt makes later host repeats `duplicate`.
  - Reversible.
- **`deliverablesDeclaredAt` stays at the host time when an explicit report follows.** The existing `??` rule keeps the first declaration time, and the plan defines precedence by verdict only. Reversible.
- **`hostDeliverablesReportId` is not exported from `src/index.ts`.** `index.ts` is outside the Batch 5 files and is Batch 2's. The Batch 7 recorder lives in the same lib and can import it with a relative path. Add the export later if a consumer outside the lib needs it. Reversible.
- **The key-value store spec is not changed.** It is not in the Batch 5 file list. The class extends the in-memory store, so the in-memory spec covers the same `applyOutcomeEffect` path. Reversible.
