# Completion report - TASK_2026_646_136a (team-leader Mode 3, 2026-10-16, session 11)

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR #731. HEAD at review: `392ce5e2f`. This run changed no code and no git state. It ran no tests, typecheck, lint
or build. Evidence comes from committed reports and reviews, the orchestrator's session 11 checks, and read-only
`git log` and `git show`.

## Verdict

**NOT COMPLETE: one write-path gap blocks completion.** All 59 committed batches are verified by SHA. The final
code-logic review chain ends APPROVED 8/10 (41h), and the visual reviews are APPROVED in dark and light themes. The
write-path trace found one defect. In the VS Code host, saving a decision model selection cannot persist (W1 below), so
acceptance criterion 1.6 is not met in VS Code. This defect is recorded as **Batch 41i (PENDING)** in `batches.md`. When
41i is committed and its scoped review accepts it, the remaining step is the one in the last section.

## Summary

The task adds an optional decision model for orchestration routing and a lane evaluation loop:

- a "Decision model" background role (Ollama `/v1/systemone`, TypeSafe Jev, or a structured-output model);
- the `ptah_route_decide` MCP tool, with a Pre-flight stage and a Gate 0.1 stage;
- deterministic ranking: hard constraints, the capability matrix as data, a spread rule with persisted rotation, and
  reasons and confidence compiled by code;
- lane and subagent outcome records, through SQLite or KeyValue stores, a durable journal, and `ptah_outcome_report`;
- lane failure classes;
- Agents-tab outcome signals that replace "Success" (approved, #13);
- orchestration skill integration.

New libraries: `@ptah-extension/lane-routing` and `@ptah-extension/lane-outcomes`. Migrations: 0054 and 0055. The work
is wired into the VS Code, Electron and CLI hosts.

Batches: 46 headed batches, plus 39a-39d, 41a-41h, 41-ci and the session 11 E2E fix. Each one is committed; the commit
ledger is in `batches.md` under `## Mode 3 completion`. Phase reviews:

- P1: APPROVED.
- P2: ACCEPTED (#85).
- P3: ACCEPTED by the user (#96).
- P4, P5 and P6: the final reviews returned NEEDS_REVISION. The user said "Fix all, then merge", which became Batch 41.
- Batch 41 review chain: 5.5, then 7 (41f), then 7 (41g), then **APPROVED 8/10** (41h, codex/OpenAI reviewing
  Anthropic implementers, so reviewer and implementer are from different families).
- Visual: `reviews/p4-final-visual-review.md` APPROVED 9/10 and `reviews/batch-41-visual-review.md` APPROVED 8/10, both
  with dark and light screenshots. The P5 visual NEEDS_FIX was closed by 41c and re-checked in the batch 41 review.

## Write-path trace

The inputs come from `reports/batch-30-report.md` (W3, W5, W7, W8). The trace adds the plan's other persisted writes
(W1, W2, W4, W6), from `implementation-plan-part-a.md:250-253` and `implementation-plan.md:403-405,464,666`. No write
sets an environment variable.

| # | What / where | Writer | Runtime reader | Test reference | Commit(s) | Result |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Decision model selection, `ptah` / `agentOrchestration.decisionModel`, global (`decision-model.types.ts:98-99`) | `DecisionModelConfig.setSelection` via `IWorkspaceProvider.setConfiguration` (`decision-model.config.ts:163-167`), called from `agent-rpc.handlers.ts:864,884` | `getSelection` (`decision-model.config.ts:129-145`), used by route decide, the probe and `agent:getConfig` (`agent-rpc.handlers.ts:546`) | `decision-model.config.spec.ts:662-668`, `agent-rpc.handlers.decision-model.spec.ts`; both **mock** `setConfiguration` | abf0d2b31, d2de2093f, 41a/41f/41g/41h | **GAP (VS Code)**. The key is not file-based: it is missing from `FILE_BASED_SETTINGS_KEYS`, and `isFileBasedSettingKey` is at `libs/backend/platform-core/src/file-settings-keys.ts:772-779`. It is also not contributed in `apps/ptah-extension-vscode/package.json` (0 matches for "decision"). So the VS Code provider calls `config.update(key, value, Global)` (`libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:110-119`), and VS Code rejects that for an unregistered key. Electron and CLI persist the value in their own host config (`electron-workspace-provider.ts:212-233`, `cli-workspace-provider.ts:104-125`). That works there, but the value is outside `~/.ptah/settings.json`, where the sibling role keys live (`file-settings-keys.ts:263-264,289`). Fix: Batch 41i |
| W2 | Jev API key, `ISecretStorage` `ptah.laneRouting.jevApiKey` (`decision-model.types.ts:102`) | `decision-model.config.ts:202-205` (delete or store) | `decision-model.config.ts:182,193,218` (status, client) | `decision-model.config.spec.ts:604,728`; rpc decision-model spec (key-first order, rollback, stored-selection read-back) | abf0d2b31, 86c2954a7, dbccd23e4, cda1eb30e, d4dcdc6c1, f0dee00e1 | OK. Never in settings and never returned |
| W3 | Unsupported mark, `ptah.decisionModel.unsupported.v1` on global `STATE_STORAGE` (`decision-model.types.ts:90-91`) | `persistMark` / `clearMark` (`decision-model.config.ts:664`, serialised by `markChain`) | `loadMark` in the constructor (`:621`); status and probe | `decision-model.config.spec.ts:31` (key), restart helper `:142-150` | abf0d2b31, 8d29af556, 623644993, f5d28d2f4 | OK. A selection change clears the mark (`setSelection`). Known Moderate LT-P3-5 (a failed clear is swallowed) is in `future-enhancements.md` |
| W4 | Rotation state, `laneRouting.rotation.v1` on global `STATE_STORAGE` (`routing-constants.ts:84-85`) | `RotationStore` `:236` | `RotationStore` `:161`; spread (`spread.ts:96,115`) | `rotation.store.spec.ts:104` (one global document), `:123` (continues after restart, Req 7.5) | 5ed3d9092, 8d29af556 | OK. LT-P3-4 (same-key concurrency) is a later task |
| W5 | Capability matrix user file `{ptahHomeDir}/routing/capability-matrix.json` and view `capability-matrix.view.json` (`capability-matrix.store.ts:64-69`) | User edits the file; the store writes the view | `CapabilityMatrixStore` load, on each route decision | `capability-matrix.store.spec.ts` (view assertions; malformed and unreadable keep the last valid matrix, `:476,:734`) | 55a58c96b, 004195ee9 | OK |
| W6 | SQLite `lane_outcome_records`, `lane_outcome_report_receipts`, `lane_outcome_held_reports` (0054) and `skill_invocation_events.run_id` (0055) | `SqliteLaneOutcomeStore` (atomic `update`, Batch 36) and the skill invocation recorder | `LaneOutcomeReader` behind the routing alias and `agent:outcomeSignals`; subagent join | `sqlite-lane-outcome.store.spec.ts`, `0054_lane_outcome_records.spec.ts`, `0055_skill_invocation_run_id.spec.ts`, `subagent-join.spec.ts` | 3ada54c23, 8fc9278e9, 2493f2dd5, 8cd5cc212, 2f7833b8f | OK (Electron and CLI). Starts after SQLite registration (batch-30 decision 1) |
| W7 | Outcome journal `ptah.laneOutcomes.journal.v1` and dead letter `ptah.laneOutcomes.journal.rejected.v1` (`key-value-outcome-journal.ts:4-5`) | `OutcomeWritePipeline` (when no store is ready, or when it fails) | Pipeline drain at start and at shutdown (`lane-outcomes/src/lib/di/start.ts`); the drain is bounded and never rejects (38c, 41d) | `key-value-outcome-journal.spec.ts:95` (restart, FIFO), `outcome-write-pipeline.durability.spec.ts`, `.backlog.spec.ts`, `start.spec.ts` | f4425ce5c, 8cd5cc212, bfae43c3c, d8675a544, f4cd90768, e6c030f5b | OK. LT-P2-15..18 (ordering and edge cases, no loss on typed paths) are later tasks |
| W8 | VS Code record snapshot `ptah.laneOutcomes.records.v1` (`key-value-lane-outcome.store.ts:13`) | `KeyValueLaneOutcomeStore` | The same store, as the VS Code reader (`isPersistent() === true`) | `key-value-lane-outcome.store.spec.ts:49-73`; VS Code `container.smoke.spec.ts:371-422` (resolves over `STATE_STORAGE`) | 8fc9278e9, 2493f2dd5, e082c0cbe | OK |

Shutdown ordering is checked by `deactivate-order.spec.ts`, Electron `shutdown.spec.ts` and CLI
`shutdown-host-runtime.spec.ts`. On each host, the drain runs before the store closes.

## Acceptance criteria (`task-description.md` revision 3)

Status key:

- **Met**: the code is committed and a named test covers it.
- **Met (process)**: the criterion is about skill behaviour, and the skill text carries it.
- **Not met**: there is a gap, and it has file:line evidence.

| Req | Criteria | Status | Evidence |
| --- | --- | --- | --- |
| 1 Decision-model setting | 1.1, 1.2, 1.4, 1.5, 1.7, 1.8 | Met in the UI (all hosts) | `provider-consumer-rows.spec.ts:311,326,408,419,443`; `provider-consumer-assignments.component.spec.ts:446`; `decision-model-row.component.spec.ts:157,241,265,278`; visual P4 final 9/10 and batch 41 8/10 |
| | 1.3 (unset sends nothing) | Met | `route-decide.preflight.spec.ts:124`; `route-decide.gate.spec.ts:337`; `decision-model-failure-classifier.spec.ts:111` |
| | **1.6 restore after restart** | **Not met in VS Code**; met in Electron and CLI | W1. In VS Code a non-unset save is rejected, so the selected kinds of 1.2, 1.4, 1.5 and 1.8 cannot be stored there. The UI states render, and a failed save is reported as failed (41a-41h). Fix: Batch 41i |
| 2 Routing tool contract | 2.1-2.7 | Met | 2.1: `surface-tools.spec.ts`, `route-tools.spec.ts`, stdio specs, CLI e2e `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts` (12 tools, 758f96fdc). 2.2-2.4: `contracts.spec.ts`, gate and preflight specs. 2.5: `route-decide.gate.spec.ts:357`. 2.6: `:368,:397`. 2.7: `contracts.spec.ts`, gate spec `:464` |
| 3 Hard constraints | 3.1-3.7 | Met | `hard-constraints.spec.ts`; gate spec `:368` (invented lane and model), `:425` (reviewer family, including after request 1 fails), `:464`, `:729` (pin model); 3.5: no batch field in the schema (`contracts.spec.ts`) |
| 4 Non-blocking fallback | 4.1-4.6 | Met | 4.1: gate spec `:318` and `system-one.client.spec.ts` (timeout). 4.2: `system-one.client.spec.ts`, `model-call.spec.ts`. 4.3: gate spec `:536`. 4.4: preflight `:124`, gate `:337`. 4.5: gate spec `:749`, `:596`. 4.6: gate and preflight cause tables |
| 5 Outcome record | 5.1-5.9 | Met | `lane-outcome-recorder.service.spec.ts` (dedup), `lane-outcome.schema.spec.ts` (null, never 0; no text), `subagent-join.spec.ts` (two-run join, unmatched and ambiguous), `report-effect.spec.ts` and `outcome-report.tool.spec.ts` (5.5, 5.6), stores and journal specs (5.7), `lane-completion-notifier.service.spec.ts` (5.9) |
| 6 Capability matrix | 6.1-6.9 | Met | `seed-matrix.spec.ts` (6.2, 6.3), `score.spec.ts` (6.4 "no profile"), `capability-matrix.store.spec.ts` (6.5, 6.7, 6.8 view), `local-derivation.spec.ts` (6.6); 6.9: the skill text in 4b2da5a97 removes the vendor tables (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/{orchestration/SKILL.md,orchestration/references/lane-assignment.md,agent-lanes/SKILL.md}`) |
| 7 Spread rule | 7.1-7.8 | Met | `spread.spec.ts:69-260` (7.1-7.4, 7.6, B-1/B/B+1); `rotation.store.spec.ts:123` (7.5); 7.7 and 7.8: gate spec `:413-423`. That test runs with the model set and the harness default reply, which always picks option `o1` (`:237-243`), and it still rotates codex, grok, opencode |
| 8 Skill integration | 8.1-8.7 | Met (process) | Skill text in 4b2da5a97 (paths above); `reports/batch-31-report.md` |
| 9 Agents tab signals | 9.1-9.5 | Met | `agent-outcome-signals.spec.ts`, `clone-card.component.spec.ts`, `clone-detail-drawer.component.spec.ts`; parity rows (see Parity); visual batch 41 APPROVED |
| 10 Lane failure class | 10.1-10.3 | Met | `lane-failure-class.spec.ts`, `lane-auth-classifier.spec.ts` (39c: no bare 401 match); `decision-model-failure-classifier.spec.ts:111,128,157,175,224,242,326` (one request; below threshold or outside the 5 classes gives null) |
| 11 Lane model discovery | 11.1-11.5 | Met | `lane-model-listing.adapter.spec.ts` (provenance); gate spec `:596` (a slow sibling stays within budget), `:729`, `:368` (unlisted model gives `bad-output`) |
| 12 Pipeline and budget | 12.1-12.9 | Met | Gate spec `:425` (12.4), `:552` (12.6 payload cap), `:566` (12.9: 70 phases, Q = 32, at most 2 requests, `question-limit`); preflight spec (12.8); classifier spec (12.5, one per run) |
| 13 Reasons and confidence | 13.1-13.5 | Met | `compile-reasons.spec.ts` (13.2-13.4 consistency), `confidence.spec.ts` and gate spec `:629`, `:694` (13.5, including the structured null path) |
| NFR | Security payload field set; secrets; compatibility; token cost | Met, except VS Code selection (W1) | `decision-payload.spec.ts:155`, classifier spec `:242`; Jev key in secret storage (W2); host wiring e082c0cbe + DI guards (Electron 59/59, VS Code 62/62) |

**Parity** (`parity-inventory.md`). The only surface replaced is the Agents-tab "Success" figure. Its removal is approved
by the user (2026-10-14, #13). The kept rows are:

- invocations, last enhanced, history and the scorecard badge;
- Skills/Commands "Success";
- `CloneSummary.successRate`.

They are held by `clone-card.component.spec.ts`, `clone-detail-drawer.component.spec.ts` and
`skill-synthesis-tab.component.spec.ts`, and the visual reviews show them unchanged. Result: no capability is missing.

## Verification evidence

- Session 11 (orchestrator, after merge `6be388a9e` with no conflicts):
  - `nx test`, typecheck and lint for vscode-lm-tools and shared;
  - rpc-handlers decision-model spec 35/35, plus typecheck and lint;
  - DI guards: Electron 59/59 and VS Code 62/62;
  - degradation audit TOTAL 297. That equals clean `origin/main`; the extra site comes from `main`, and no baseline
    changed.
- E2E expectations updated in 758f96fdc:
  - CLI `mcp-serve` now lists 12 tools, including `route_decide` and `outcome_report`;
  - the settings specs expect 7 roles.
- 41h (f0dee00e1) has one bounded correction. Its review (`reviews/batch-41h-code-logic-review.md`, 392ce5e2f) is
  APPROVED 8/10, and that review ran the focused Jest suite (35/35).
- Per-batch scoped checks are recorded on each batch header in `batches.md`.
- Visual evidence: `visual/` (git-ignored PNGs; before and after, dark and light) and the visual reviews named above.
- CI on HEAD `392ce5e2f`: not yet read in this run.

## Validation risks

| Risk | Resolution |
| --- | --- |
| R-1 B4 too big for one lane | Split into Batches 6, 15, 20 (+34, 35, 36, 36b), all committed |
| R-2 Second critical path | Ran first in each wave; done |
| R-3 Commitlint scopes | `lane-routing` and `lane-outcomes` added (Batches 1, 6) |
| R-4 Hold capacity counting expired rows | Handled in Task 6.1 and the Batch 15 fixtures |
| R-5 / R-6 RPC and DI guard drift | Guard specs pass after the merge (Electron 59/59, VS Code 62/62) |
| R-7 `validate-deps` / di-lint | Wired in Batch 30; build externals fixed in 8253977e8 |
| R-8 Library cycles | `nx lint` per library passed in each batch |

## User decisions (final, not reopened)

- **#12**: with no decision model, deterministic code ranking chooses lanes; a decision model, when set, refines that
  ranking.
- **#13**: replace the Agents-tab "Success" figure with outcome signals. Skills/Commands "Success" and
  `CloneSummary.successRate` stay.
- **#18 as amended by #22**: keep and fix in place. There is no carve-out to a new home, and `skillsLoaded` stays.
  New-skill suggestions are deleted (the purge is TASK_2026_662_3eea's).
- **#19**: TASK_2026_535 and TASK_2026_537 are merged as duplicates. The 535 §D/§E fixes and decision #8 move to
  TASK_2026_663_50d4.
- **#96**: P3 accepted with LT-P3-5 deferred ("Accept P3, defer").

## Later tasks

All of them are consolidated in `future-enhancements.md`:

- the P2c, P3c, P4c, P5c and P6c lists;
- HANDOFF open problem 4;
- the visual findings;
- the two 41h Minors.

LT-P2-19 and LT-P6-3 are closed.

## Remaining steps

1. Batch 41i (see `batches.md`). Add `agentOrchestration.decisionModel` to `FILE_BASED_SETTINGS_KEYS`, and add a
   platform-core spec. Then run the scoped checks for platform-core, get one code-logic review from a different model
   family, and commit.
2. Push, then wait for CI to pass on the new HEAD.
3. Run `gh pr ready 731`.
4. The user merges the PR, or asks for it to be merged.
