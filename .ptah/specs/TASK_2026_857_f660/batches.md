# Batches - TASK_2026_857_f660

Total tasks: 46 | Batches: 23 (B1-B21 with B10a/B10b/B10c; conditional B22 only if R9 fires) | Complete: 23/23

Source: implementation-plan.md r3 (Gate 2 approved, decisions.md row 11), task-description.md r2,
decisions.md rows 5, 9, 10, 11, context.md § CLI Lanes. The plan's 21-batch table
(implementation-plan.md:1303-1332) is kept with three corrections (see Decisions D-TL-1..3).

Root (abbreviated `$WT` below; every path is absolute once `$WT` is expanded):
`D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`

## Run constraints (repeat in every lane and subagent prompt)

- Work only in `$WT` (worktree, branch `feat/lane-learning-routing`). node_modules is a junction to
  the main checkout: never `npm install`.
- Verification is `npm run verify -- -p <projects>` only (memory-safe FIFO lock). Never
  workspace-wide, never `nx run-many` by hand, never `build`/`serve`/`dev`/`e2e`/`package`.
  Filter output with `| tail -40`; do not re-run to read it. Use full Nx names
  (`@ptah-extension/<lib>`); apps use bare names (`ptah-electron`, `ptah-extension-vscode`,
  `ptah-cli`, `ptah-tui`).
- Electron first; keep every host compiling. No VS Code or TUI feature work.
- No git of any kind (no add, commit, stash, checkout). The team-leader owns git.
- Do not edit `batches.md` or `task.md`. Report each task with evidence and every absolute path
  touched, plus how each listed risk was handled.
- Privacy (NFR): no request, prompt, brief, scope, assistant, deliverable or CLI output text in
  rows, journal, receipts or logs. Deliberate swallows carry `degradation-audit: reported`.
- No new lib-to-lib Nx edges; cross-lib calls through barrels only (plan F7).
- Lane selection (orchestrator, at spawn time): follow context.md § CLI Lanes and decisions.md
  row 9. Exclude any lane recorded AT LIMIT or rate-limited this run. Give the long lane batches
  (B2, B3, B6, B10b, B14) to the lane with confirmed room. Give lanes recorded near limit only the
  small pure batches (B4, B10a, B12, B17). Max 3 lanes at once.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Migration 0064 is free. Verified: latest on disk is 0063 and no ref of the 125 local/remote
  branches carries a `0064*` migration (2026-10-30). Re-checked in Task 1.2 and again before push.
- Every existing `LaneOutcomeRecord`/`LaneOutcomeRow` literal is on a batch list. Verified by grep:
  `agent-signals.spec.ts:4`, `lane-outcome-reader.service.spec.ts:13,98`, `subagent-join.spec.ts:8`,
  `store.test-support.ts:4`, `lane-outcome-recorder.service.ts:45,100` (B2),
  `outcome-report.tool.spec.ts:42` (B11). `subagent-join.ts:21` and `sqlite-lane-outcome.store.ts:74`
  spread an existing row/parse, so they need no edit. Task 11.1 re-greps before the required flip.
- `chat-session.service.spec.ts` does NOT exist (plan:1049-1050 flagged this). The service's
  specs are per concern (`chat-session.ptah-ui-flag.spec.ts`, `chat-session-auth.spec.ts`, ...).
  Resolved by D-TL-1.
- VS Code and CLI `expected-resolvable.ts` list selected tokens only, not every lib-owned token
  (`apps/ptah-cli/src/di/expected-resolvable.ts:8-60`). So B21 is Electron-only. Task 21.3 confirms
  this through the host tests.
- `continueConversation` is the only turn-restart site (`hasExited = false`,
  `agent-process-manager.service.ts:2206`). Unverified until Task 10c.0 greps it.
- `lane-completion-notifier.service.spec.ts` fixtures whose deliverable mtime precedes `startedAt`
  must be updated, not deleted, when the freshness rule lands. Task 10b.0 greps for them.
- `settings:set` accepts `agentOrchestration.hostRouting` only after B17 adds it to
  `isFileBasedSettingKey`. B20 depends on B17.

| Risk                                                                                                                                                                                                                     | Severity | Mitigation                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Parallel batches verify libs whose dependencies another batch is still editing (e.g. B2 verifies lane-outcomes → agent-sdk while B16 edits agent-sdk). A red check may be foreign.                                    | MEDIUM   | Executors report a failure located outside their own file list and do not fix it. The team-leader re-runs the batch command in Mode 2 after the concurrent batch is accepted. |
| R2 Plan host-typecheck list omits `ptah-tui`, which imports `@ptah-extension/shared` (31 sites) and `platform-core`                                                                                                      | MEDIUM   | `ptah-tui` added to the host typecheck of B1, B11 and B17 (D-TL-2)                                                                                                            |
| R3 Required-field flip (B11) misses a literal added after decomposition                                                                                                                                                  | HIGH     | Task 11.1 re-greps the four patterns from plan:1360-1362 before the flip. The host typecheck in B11 is the gate.                                                              |
| R4 Live defect (decisions.md row 10): verdict path ignores `writtenAfterSpawn`, so a 429 run with a stale file counts as `delivered`                                                                                     | HIGH     | B10a (rate-limit matcher), B10b (freshness rule plus downgrade), B10c (exit-0 capture), with stale-file, exit-0 429 and fresh-file integration cases                          |
| R5 Gate 2 carry-forward is binding on B18: per-tab cancellation epoch, `inFlight` identity guard, and off→on deferred tests                                                                                              | HIGH     | Tasks 18.2 and 18.3 carry it verbatim. The Phase B review checks it.                                                                                                          |
| R6 Admission on the reply hot path (B19) adds latency or an await                                                                                                                                                        | HIGH     | Task 19.2 requires a not-awaited call plus a spec asserting dispatch resolves before admission settles. Phase B review.                                                       |
| R7 B6 and B14 share `lane-routing` `di/tokens.ts`, `di/register.ts`, `route-decide.service.ts`; B2 and B7 share `lane-outcome-recorder.service.ts`; B1 and B11 share `lane-outcome.types.ts`; B5 and B16 share agent-sdk | MEDIUM   | Same-lib batches run in sequence (Depends on columns). The parallel waves below are file- and lib-disjoint.                                                                   |
| R8 Lanes near limit stall mid-batch                                                                                                                                                                                      | MEDIUM   | Fallback order per batch. Near-limit lanes get only small batches. A stalled lane is resumed (`resume_session_id`) or the batch restarts on the next lane.                    |
| R9 Hosts other than Electron break when a shared register function registers a new token                                                                                                                                 | MEDIUM   | B21 runs `ptah-extension-vscode` and `ptah-cli` typecheck+test. If a guard there must change, a B22 (those two apps only) is added.                                           |
| R10 Migration number collision with a PR merged to main first                                                                                                                                                            | LOW      | Re-check at Task 1.2 and at rebase before push                                                                                                                                |
| R11 Classifier and recorder are wired only in B21 (Phase B), so the Phase A review sees them unwired                                                                                                                     | LOW      | Phase A review uses the B7/B9 integration specs with real objects. The Phase B review covers composition.                                                                     |
| R12 Degradation baseline drifts with new deliberate swallows                                                                                                                                                             | MEDIUM   | `npm run verify -- -t lint -p degradation-audit` in B7, B8, B10b, B10c, B18, B19, B21                                                                                         |

Edge cases:

- Lane exit 0 with an API 429 and a pre-existing deliverable → `failed`/`usage-limit` — Tasks 10a.1, 10b.1, 10c.1
- Deliverable mtime precedes spawn → `no-deliverable` — Task 10b.1
- Continuation produces a second terminal event → no duplicate of a single ending (Req 1) — Task 10b.2
- Recorder absent or row rejected → diagnostic, no text (Req 1) — Tasks 8.1, 10b.2
- Review lane finishes before its implementer → review held, then joined on insert; expired after 24 h to the rejected ledger (Req 7) — Tasks 8.1, 8.2
- Subagent stop without transcript path or parent session → row still written (Req 3) — Tasks 5.1, 7.2, 9.2
- Same subagent stop from two producers → one row per `subagent:<agentId>` (Req 3) — Tasks 7.2, 9.2
- Unclassified run with no decision model → zero classification calls, row stays `unclassified` (Req 2, NFR cost) — Tasks 6.2, 7.1
- Vague first message → one nudge per scope revision, no repeat (Req 4/5) — Task 18.1
- Scope answers settling in reverse order → generation guard drops the stale one — Task 18.2
- Toggle off during an in-flight scope answer or pre-flight → no reminder, no cache entry; off→on before settle → only the new request is active — Tasks 18.2, 18.3
- Revision, model fingerprint or session differs → cache miss and a fresh pre-flight (Req 6) — Tasks 13.2, 14.2
- n = 0 local samples → seed score exactly. No seed → neutral prior (Req 8) — Task 12.1
- Decision model unset → toggle disabled with note, stored value unchanged — Task 20.1

## Decisions

| #      | Decision                                                                                                                                                           | Options                                                    | Evidence                                                                                                                                                   | Reversible |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D-TL-1 | B19 adds a new `chat-session.host-routing.spec.ts` (CREATE) instead of modifying `chat-session.service.spec.ts`                                                    | create per-concern spec; extend an unrelated existing spec | file absent; per-concern naming in `rpc-handlers/src/lib/chat/session/` (e.g. `chat-session.ptah-ui-flag.spec.ts`); plan:1049-1050 allows the nearest spec | yes        |
| D-TL-2 | Host typecheck after shared/platform-core changes includes `ptah-tui`                                                                                              | plan's 3 hosts; all 4 hosts                                | `apps/ptah-tui/src` imports `@ptah-extension/shared` and `platform-core`; CLAUDE.md "keep every host compiling"                                            | yes        |
| D-TL-3 | B21 is Electron-only; VS Code/CLI guard edits, if a host test proves them needed, go to a conditional B22 so no batch exceeds 2 projects                           | one 3-app batch; split                                     | guards enumerate selected tokens only (`apps/ptah-cli/src/di/expected-resolvable.ts:8-60`)                                                                 | yes        |
| D-TL-4 | Three phases: A learning integrity + review capture (Req 1, 2, 3, 7), B host routing + composition (Req 4, 5, 6), C prior blending + settings UI (Req 8, Req 4 UI) | per-plan single phase; user's A/B/C example                | review capture (Req 7) is built inside the outcome chain (B7, B8, B10b, B11), so it reviews with Phase A                                                   | yes        |
| D-TL-5 | `-p` uses full Nx names `@ptah-extension/<lib>`                                                                                                                    | short names                                                | each lib `project.json` `name` field                                                                                                                       | yes        |
| D-TL-6 | B20 "before" screenshots are captured from base commit `1d2fbd4b5` during Wave 1, before any batch lands                                                           | capture right before B20                                   | CLAUDE.md "before from the base commit"; decisions.md row 8                                                                                                | yes        |

## Phases and reviews

| Phase                    | Batches                                                   | Review due after                                        | Review                                                                                                   | Reviewer family                                                                                                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Learning integrity     | B1, B2, B3, B4, B5, B6, B7, B8, B9, B10a, B10b, B10c, B11 | last Phase A commit (B10c or B11, whichever lands last) | code-logic + style (new shared port, new lane-outcomes/shared exports)                                   | a CLI lane of a family that implemented none of Phase A's lane batches. This is also cross-family to the Claude subagent batches (B7, B8, B10c). With no such lane, a code-logic-reviewer subagent covers the lane batches, and the exception is recorded for B7/B8/B10c. |
| B Host routing           | B13, B14, B15, B16, B17, B18, B19, B21                    | B21 commit                                              | code-logic + style (new lane-routing, agent-sdk, rpc-handlers exports)                                   | same rule. B18/B19 are Claude subagent batches, so a non-Claude lane is preferred.                                                                                                                                                                                        |
| C Blending + settings UI | B12, B20                                                  | B20 commit (or B12 if B20 is held)                      | code-logic (B12) + visual-reviewer (B20: Electron, dark+light, model set/unset, before from `1d2fbd4b5`) | B12 lane → a different-family lane or subagent. B20 subagent → a non-Claude lane for the code-logic part.                                                                                                                                                                 |

The phase review reads the phase's commit SHAs (listed on each batch header), not a contiguous
range: the phases interleave in time.

### Phase A commits (review due now: every Phase A batch is COMPLETE)

| Batch | Commit    | Subject                                                                       |
| ----- | --------- | ----------------------------------------------------------------------------- |
| B1    | 7392023df | feat(shared,persistence-sqlite): batch 1 - task kind source column            |
| B2    | ee54e55e8 | feat(lane-outcomes,vscode-lm-tools): batch 2 - task kind source on rows       |
| B3    | 4f366911b | feat(lane-outcomes): batch 3 - stores, report effect and report id            |
| B4    | 78247787b | test(lane-outcomes): batch 4 - schema, effect and store specs                 |
| B5    | 1aa81ab58 | feat(agent-sdk,skill-synthesis): batch 5 - ungated subagent stop fan-out      |
| B6    | d3ed06092 | feat(lane-routing): batch 6 - shared decision caller, task-kind classifier    |
| B7    | 4795efff9 | feat(lane-outcomes): batch 7 - kind resolution, producers, review capture     |
| B8    | 45416c4f4 | feat(lane-outcomes): batch 8 - held review join, one insert path              |
| B9    | 26780cb0c | feat(lane-outcomes): batch 9 - classifier token, subagentEnded hookup         |
| B10a  | 38278e050 | feat(cli-agent-runtime): batch 10a - api rate-limit failure class             |
| B10b  | 6df757192 | fix(cli-agent-runtime): batch 10b - fresh deliverables, rate-limit verdict    |
| B10c  | 56ba63c39 | fix(cli-agent-runtime): batch 10c - flag exit-0 api rate limits               |
| B11   | 4257a17ec | feat(vscode-lm-tools,shared): batch 11 - review pairing, required kind source |

Review each SHA with `git show <sha>`. The commits are not contiguous: Phase B/C commits
(e.g. 0189199e6, 3d87596ac, e60d665c3, e008c1d3c, 7402fb558, 46a3d5873) are interleaved and are out
of Phase A scope.

### Phase A fix round 1 — COMPLETE (commit 8ee2e1afb)

- Scope: decisions.md row 25 (F1, F2, F3, F9, F4, B10c `authMatched` reset, F12, style 1, 2, 3, 5).
  Executor report: phase-a-fix-report.md.
- Commit 8ee2e1afb `fix(cli-agent-runtime,lane-outcomes): phase a review fix round 1`, 19 files
  staged by explicit path. The rpc-handlers files (B18) and this task folder stay uncommitted.
- Team-leader checks: `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools,@ptah-extension/lane-routing`
  gave 12 tasks: 12 succeeded (12/12 cache hits on the executor's run), exit 0.
  `npx prettier --check` on all 19 files passed. Host typecheck (ptah-electron,
  ptah-extension-vscode, ptah-cli, ptah-tui: 4/4) and degradation-audit lint (1/1) are
  executor-reported and were not re-run by the team-leader.
- F12 judgment: in scope. Row 25 says "F12 (check, then fix if real)". F12 was real: self-review
  and a double `revise` count when a lane omits `reviewerRunId`. Taking the reviewer from
  `getCallerAgentId() ?? args.reviewerRunId` in outcome-report.tool.ts fixes both. The per-agent
  review report id (report-effect.ts) is part of F2. Dropping `taskKindForRole` from the barrel
  is part of style 3. No new decisions.md row is needed.
- The re-review (codex, cross-family, scoped to the fix commit plus B7, B8 and B10c per row 25)
  is still due.

### Phase A fix round 2 — COMPLETE (commit f4a4e5f33)

- Scope: decisions.md row 26 (findings 2, 4, 3 of code-logic-review-phase-a-round2.md; finding 1
  deferred). Executor report: phase-a-fix-round2-report.md.
- Commit f4a4e5f33 `fix(lane-outcomes,vscode-lm-tools): phase a review fix round 2`, 9 files
  staged by explicit path (cli-agent-runtime is named in the body; the 3-scope subject would be
  80 chars). The task folder stays uncommitted.
- Team-leader checks (all exit 0, all cache hits on the current inputs from the executor's runs):
  `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools`
  9/9 succeeded; host typecheck (ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui) 4/4;
  degradation-audit lint 1/1; `npx prettier --check` on all 9 files passed.
- On-disk checks: no report-effect.ts change (finding 1 deferred). Review path: every review now
  has a reviewer (caller agent, `reviewerRunId`, or `session:<id>`), or it is refused, so
  `outcome-report.tool.ts:221` `randomUUID()` is reached only for deliverables. The recorder's
  `attachReview` `reportId ?? randomUUID()` fallback is unchanged, and its only production
  caller (`lane-outcome-recorder.service.ts:330`) passes a deterministic id. The stream-loop error
  log carries only `errorClass`, never SDK message text.
- The one codex re-review of the fixed code (row 26) is still due.

### Phase A review — CLOSED (round 3, code-logic-review-phase-a-round3.md)

- Round 3 (codex, cross-family) re-reviewed f4a4e5f33: REVISE 6/10. Findings 2, 4 and 3 were
  confirmed fixed. One new Moderate defect stays open by decision (decisions.md row 27, revise cap
  exhausted): an identical bare-agent `ptah_outcome_report` review sent before and after the
  implementer row lands gets two report ids and counts `reviseRounds` twice. It goes to
  future-enhancements.md. Phase A is closed with this defect open and recorded.

### Phase B fix round 1 — COMPLETE (commit d5cf5bb72)

- Scope: decisions.md row 28 (codex F1 off->on with no admitted turn, codex F2 queued reminder
  after toggle-off, the `will-quit` lifecycle in `phase-4-handlers.ts`, prettier on B13-B17).
  Executor report: phase-b-fix-report.md.
- Commit d5cf5bb72 `fix(rpc-handlers,agent-sdk,lane-routing): phase b review fix round 1`,
  20 files staged by explicit path (electron is named in the body). The task folder stays
  uncommitted.
- Team-leader checks (all exit 0, all cache hits on the current inputs from the executor's runs):
  rpc-handlers + agent-sdk + lane-routing lint/test/typecheck 9/9; ptah-electron 9/9;
  vscode/cli/tui typecheck 3/3; degradation-audit lint 1/1; `npx prettier --check` on all 20
  files passed.
- On-disk checks: `phase-4-handlers.ts` has no `will-quit` block and no `electron` import. The
  coordinator is captured eagerly in `wire-runtime.ts` (`isRegistered` first, warn on failure
  with the error name only) into `BootRefs.hostRouting`, and disposed through
  `nonFatal('Host routing dispose', ...)` in `shutdown.ts`, so it is never built at quit.
  No new Nx lib-to-lib edge: agent-sdk adds only an intra-lib import; lane-routing's
  platform-core import already exists on main.
- The re-review scoped to the fix commit is still due.

### Phase B fix round 2 — COMPLETE (commit 87d090bfa)

- Scope: decisions.md row 29, the three findings of code-logic-review-phase-b-round2.md
  (F1 Serious: configuration tracked by live value, not event timing; F2 Serious: owner gate
  re-checked after the awaited hook pointer; F3 Moderate: owner-scoped keyed discard).
  Executor report: phase-b-fix-round2-report.md.
- Commit 87d090bfa `fix(rpc-handlers,agent-sdk): phase b review fix round 2`, 7 files staged
  by explicit path: `host-routing-config-tracker.ts` (new), `host-routing.coordinator.ts` and
  its spec, `next-turn-reminder.queue.ts` and its spec, `user-prompt-submit-hook-handler.ts`
  and its spec. The task folder stays uncommitted.
- Team-leader checks (all exit 0, all cache hits from the executor's runs): rpc-handlers +
  agent-sdk lint/test/typecheck 6/6; electron/vscode/cli/tui typecheck 4/4; degradation-audit
  lint 1/1; `npx prettier --check` on the 7 files passed.
- On-disk checks: the diff matches the report; no caller of the removed one-arg
  `NextTurnReminderQueue.discard(key)` remains (the coordinator's two calls pass
  `REMINDER_OWNER`; other `.discard(` hits belong to unrelated classes).
- Remaining open items: future-enhancements.md "Open defects" 3-4 (3: unseen off-then-on
  toggle window and settings writes that fire no change event; 4, Minor: the now-unread
  `HostRoutingSettingChange.switchChanged`).
- The re-review scoped to this fix commit is still due.

### Phase B final review (round 3) — REVISE 6/10, cap exhausted, disclosed

- decisions.md row 31; code-logic-review-phase-b-round3.md; future-enhancements.md
  "Open defects" 3-5. No further fix rounds.

### Merge origin/main — COMPLETE (88c0128ee + spec fix 65b14cc72)

- decisions.md row 32. Code complete at 65b14cc72.

## Execution waves (file- and lib-disjoint within a wave)

| Wave | Run together                                                                                           | Gate to start                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1    | B1, B5, B10a, plus visual-reviewer "before" screenshots of the Context Management tab from `1d2fbd4b5` | none                                                                                     |
| 2    | B2, B6, B16                                                                                            | B1 (B2, B6); B5 (B16)                                                                    |
| 3    | B3, B12, B17                                                                                           | B2; B6; B16                                                                              |
| 4    | B4, B13, B20                                                                                           | B3; B12; B17                                                                             |
| 5    | B7, B14                                                                                                | B4+B5; B13                                                                               |
| 6    | B8                                                                                                     | B7                                                                                       |
| 7    | B9                                                                                                     | B8                                                                                       |
| 8    | B10b                                                                                                   | B9 + B10a                                                                                |
| 9    | B10c, B11                                                                                              | B10b (both); B9 (B11). Disjoint files. R1 applies (vscode-lm-tools → cli-agent-runtime). |
| 10   | B15                                                                                                    | B14 + B11                                                                                |
| 11   | B18                                                                                                    | B14 + B15 + B17                                                                          |
| 12   | B19                                                                                                    | B18                                                                                      |
| 13   | B21                                                                                                    | every backend batch (B1-B19)                                                             |

The first commit of each wave lands before the next wave's dependents start. Mode 2 verify and
commit runs per batch.

---

## Batch 1: Shared contracts + migration 0064 — COMPLETE (7392023df)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: exact contracts given in the plan. The field is optional, so every host compiles.
- Tasks: 2 | Depends on: none | Parallel with: B5, B10a
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/shared/src/lib/types/lane-outcome.types.ts`
  - CREATE `$WT/libs/backend/persistence-sqlite/src/lib/migrations/0064_lane_outcome_task_kind_source.ts`
  - CREATE `$WT/libs/backend/persistence-sqlite/src/lib/migrations/0064_lane_outcome_task_kind_source.spec.ts`
  - MODIFY `$WT/libs/backend/persistence-sqlite/src/lib/migrations/index.ts`

### Task 1.1: Optional `taskKindSource` field, nullable subagent stop metadata, classifier port — COMPLETE

- File: `$WT/libs/shared/src/lib/types/lane-outcome.types.ts`
- Plan reference: implementation-plan.md:196-220 (Component 1)
- Pattern to follow: existing optional fields in the same file (`telemetryJoin` at :99)
- Quality requirements: field OPTIONAL in this batch (the required flip is B11); no text-bearing fields
- Validation notes: R2, R7
- Implementation details: add the `TaskKindSource` union and port type exactly as specified. Export through the shared barrel already used.

### Task 1.2: Migration 0064 `task_kind_source` — COMPLETE

- Files: the three persistence-sqlite paths above
- Plan reference: implementation-plan.md:221-237 (Component 2)
- Pattern to follow: `0060_provider_account_lease_epoch.ts:21-28` (bare ALTER); `0063_session_auto_links.spec.ts`
- Quality requirements: register `{ version: 64, name: '0064_lane_outcome_task_kind_source', sql }` after `index.ts:448-452`
- Validation notes: R10. First confirm 0063 is still the latest in `index.ts`. If not, stop and report.
- Implementation details: spec applies 0054 then 0064. An old row reads `task_kind_source IS NULL`. A new insert stores each source value.

### Batch 1 verification

- Acceptance: Req 2 (provenance column exists), Compatibility NFR (all hosts compile)
- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/persistence-sqlite`
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
- Result (team-leader, 2026-10-30): shared + persistence-sqlite tests and typecheck pass; persistence lint fails only on 10 pre-existing `no-restricted-syntax` errors in 0057/0058 (no diff vs 1d2fbd4b5). Host typecheck 4/4 pass. Commit includes the 22 latest-version spec bumps (decisions.md row 13).

## Batch 2: Outcome row schema + recorder interim source + fixtures — COMPLETE (ee54e55e8)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: mechanical: one field on every listed literal
- Tasks: 2 | Depends on: B1 | Parallel with: B6, B16
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/store.test-support.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/agent-signals.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/lane-outcome-reader.service.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/subagent-join.spec.ts`

### Task 2.1: Schema field + recorder input Omit and interim source — COMPLETE

- Files: `lane-outcome.schema.ts`, `lane-outcome-recorder.service.ts`
- Plan reference: implementation-plan.md:238-264 (Component 3 schema), :322-398 (Component 6, input Omit and interim source only)
- Pattern to follow: `lane-outcome.schema.ts:60` (`telemetryJoin` enum)
- Quality requirements: the Omit keeps `cli-agent-runtime/.../lane-completion-outcome.ts` compiling with no edit
- Validation notes: R1, R7 (recorder is rewritten fully in B7; keep this change minimal)
- Implementation details: literals at recorder :45 and :100 set the interim source.

### Task 2.2: Fixture literals carry the field — COMPLETE

- Files: the four spec/test-support files above
- Plan reference: implementation-plan.md:57-118 (Codebase evidence literal list)
- Validation notes: R3
- Implementation details: add the field to every literal; no behaviour change.

### Batch 2 verification

- Acceptance: Req 2
- `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools`
- Result (team-leader, 2026-10-30): 9/9 tasks pass (lint, test, typecheck × 3 projects), exit 0. No host typecheck listed. Commit adds `vscode-lm-tools/.../outcome-report.tool.spec.ts` (reviewerRunId expectation), giving 7 files across 2 libs (decisions.md row 15). Shared `taskKindSource` stays optional until B11. No `â€` mojibake.

## Batch 3: Stores, report effect and report id — COMPLETE (4f366911b)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: the plan gives the SQL. The interface and every implementer land in one batch so it compiles.
- Tasks: 2 | Depends on: B2 | Parallel with: B12, B17
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts` (fixture table column only; decisions.md row 16)
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/key-value-lane-outcome.store.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/write/pipeline.test-support.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/write/report-effect.ts`

### Task 3.1: Store column, conditional classification setter, join enrichment — COMPLETE

- Files: the four store files
- Plan reference: implementation-plan.md:265-295 (Component 4)
- Pattern to follow: `sqlite-lane-outcome.store.ts:106-179` (`values`, `insertIfAbsent`)
- Quality requirements: `setClassifiedTaskKind` only updates an `unclassified` row (no overwrite of explicit/mapped)
- Validation notes: R7
- Implementation details: every implementer of the interface changes in this batch.

### Task 3.2: Report effect precedence and deterministic report id — COMPLETE

- Files: `write/report-effect.ts`, `write/pipeline.test-support.ts`
- Plan reference: implementation-plan.md:238-264 (Component 3 effect, report id)
- Implementation details: host-observed review precedence as specified. Deterministic id from reviewed+reviewer runId (decisions.md row 7).

### Batch 3 verification

- Acceptance: Req 2, Req 3 (enrichment), Req 7 (effect, dedupe)
- `npm run verify -- -p @ptah-extension/lane-outcomes`

## Batch 4: Schema, effect and store specs — COMPLETE (78247787b)

- COMPLETE (Mode 2, 2026-10-30): read all 5 spec diffs on disk. They assert real values:
  every source round-trips; legacy null and omitted source decode to null; an unknown
  source is rejected; reviewerRunId is accepted at lengths 1 and 200, rejected at 0 and
  201, and rejected on a deliverables report. Report-effect precedence keeps an explicit
  kind and promotes the others to explicit; a report with no kind keeps the prior values.
  Guarded classification and null-only join enrichment are covered in the in-memory, KV
  (across reload) and SQLite stores. `review:<reviewed>|<reviewer>` is checked as
  deterministic and distinct. The SQLite case runs the registered 0054 and 0064 SQL. These
  are the only migrations that touch `lane_outcome_records`, so this is the table's full
  chain. 0 `â€` sequences. `git diff --stat` showed spec files only. Scoped verify:
  3/3 targets passed. Only the 5 B4 files were committed. The phase review is covered by
  Phase A.

- Recommended executor: CLI lane (tests)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: bounded test cases listed in the plan. Small, so it suits a near-limit lane.
- Tasks: 1 | Depends on: B3 | Parallel with: B13, B20
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/lane-outcome.schema.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/write/report-effect.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/store/key-value-lane-outcome.store.spec.ts`

### Task 4.1: Cases for source round-trip, conditional classification, effect precedence — COMPLETE

- Plan reference: implementation-plan.md:238-295 (Components 3, 4 verification seams)
- Quality requirements: assert a genuine value, not only "defined". The SQLite spec runs the real migration chain through 0064.
- Validation notes: edge case "unclassified row, no decision model"

### Batch 4 verification

- Acceptance: Req 2, Req 7
- `npm run verify -- -p @ptah-extension/lane-outcomes`

## Batch 5: SDK stop payload + ungated fan-out — COMPLETE (1aa81ab58)

- COMPLETE (Mode 2, third check, 2026-10-30): the orchestrator applied the bounded encoding
  correction (agent-lanes §6) to `subagent-hook-handler.ts`. Checked independently: 0 `â€`
  sequences, no BOM, and `git diff` shows only the fan-out logic hunk (lines 505-550). Scoped
  verify for agent-sdk and skill-synthesis: 5/6 targets passed. The one failure is
  skill-synthesis lint on the pre-existing `skill-registry-catalog.service.ts:53` prefer-const,
  which is unchanged from HEAD. Host typecheck for ptah-electron, ptah-extension-vscode and
  ptah-cli: 3/3 passed. Only the 5 B5 files were committed; the B2/B6 lane files stay unstaged.
  The phase review is covered by Phase A.

- FAILED (Mode 2, 2026-10-30): the fan-out is still gated. `subagent-hook-handler.ts:523-526`
  requires `workspacePath && (derivedSessionId || resolvedParentSessionId)`, and
  `SubagentStopPayload.workspaceRoot` (`subagent-stop-callback-registry.ts:13`) is still `string`.
  Plan Component 5 (implementation-plan.md:303-307) and Req 3 (task-description.md:67-70) need
  `notifyAll` whenever `input.agent_id` is non-empty, with `workspaceRoot: workspacePath || null`.
  The Task 5.1 quality line below was wrong; it is corrected now. Nothing committed; the
  files stay uncommitted in the worktree for the fix round. The skill-synthesis lint error
  (`skill-registry-catalog.service.ts:53` prefer-const) is pre-existing: no diff vs base 1d2fbd4b5.

- FAILED again (Mode 2 after fix round, 2026-10-30): the logic is now correct. `notifyAll` fires
  for any non-empty `agent_id` with `workspaceRoot: workspacePath || null`
  (`subagent-hook-handler.ts:508-532`). The payload is nullable
  (`subagent-stop-callback-registry.ts:9-17`). The spec has all 4 cases (no transcript,
  unparseable name, no parent, nothing at all). skill-trigger guards `workspaceRoot` and has a
  spec case for it. lane-outcome-recorder.service.ts:99-111 reads the nullable fields directly.
  Rejected because the fix lane re-encoded `subagent-hook-handler.ts`: 8 lines it did not need to
  touch have `—` (U+2014) turned into mojibake `â€”`. One of them is a runtime warn string
  ("Subagent NOT registered â€” ..."), so the diff carries unrelated changes and a corrupted log
  message. Fix: restore the original UTF-8 em dashes on those 8 lines and keep the logic as is.
  Afterwards `git diff | grep 'â€'` must show nothing for this file.
  (`skill-trigger.service.ts` already has one `â€` line on base 7392023df; it is not new, so leave
  it.) Nothing committed. Scoped verify was not re-run because of this rejection; re-run both
  commands after the fix.

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: bounded, 5 files, 2 libs
- Tasks: 2 | Depends on: none | Parallel with: B1, B10a
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts`
  - MODIFY `$WT/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`
  - MODIFY `$WT/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts`

### Task 5.1: Nullable stop metadata, callback emitted without transcript path/parent session — COMPLETE

- Files: the three agent-sdk files
- Plan reference: implementation-plan.md:296-321 (Component 5)
- Quality requirements: notify whenever `input.agent_id` is non-empty — no session-id or cwd
  gate. `workspaceRoot` becomes `string | null` (`workspacePath || null`). Payload carries no
  text. (Corrected: the earlier "still requires a resolved session ID and cwd" contradicted the plan.)
- Validation notes: edge case "stop without transcript path or parent session"

### Task 5.2: Skill trigger tolerates the nullable payload — COMPLETE

- Files: the two skill-synthesis files
- Fix-round note: also guard non-null `workspaceRoot` (plan :308-309); the current guard checks
  only `transcriptPath`, `subagentSessionId` and `agentType`.
- Implementation details: existing skill behaviour unchanged when metadata is absent (spec case).

### Batch 5 verification

- Acceptance: Req 3
- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/skill-synthesis`
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli`

## Batch 6: Shared decision caller + task-kind classifier — COMPLETE (d3ed06092)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: refactor with an existing spec net (`route-decide.gate.spec.ts`, `route-decide.preflight.spec.ts`)
- Tasks: 2 | Depends on: B1 | Parallel with: B2, B16
- Phase: A | Phase review: covered by Phase A
- Files:
  - CREATE `$WT/libs/backend/lane-routing/src/lib/decision-model/decision-caller.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/route-decide.service.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.spec.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/di/tokens.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/di/register.ts`

### Task 6.1: Extract the decision caller from `route-decide.service.ts` — COMPLETE

- Plan reference: implementation-plan.md:446-472 (Component 8)
- Quality requirements: existing route-decide specs pass unchanged. 3000 ms per-request abort kept.

### Task 6.2: Task-kind classifier implementing the shared port, DI token + factory — COMPLETE

- Depends on: Task 6.1
- Quality requirements: unset decision model → zero calls. Confidence < `CONFIDENCE_THRESHOLD` 0.5 → unclassified. Brief text is used transiently and never logged.
- Validation notes: R7 (B14 edits the same DI files later). No barrel edit here (B14 owns the barrel).

### Batch 6 verification

- Acceptance: Req 2, NFR cost/privacy
- `npm run verify -- -p @ptah-extension/lane-routing`
- Result (team-leader re-run): 3/3 targets succeeded (lint, test, typecheck), exit 0. No host
  typecheck is listed for B6; host checks stay with B21. No mojibake in the six files.
  Implementer: codex lane e87b387a. Phase A review still to come.

## Batch 7: Recorder: kind resolution, classifier hook, subagent producers, review capture — COMPLETE (4795efff9)

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: subagent backend-developer -> CLI lane (TypeScript implementation, capable model) with the full Component 6 text
- Subagent reason: cross-lib payloads (SDK stop, lane completion, outcome-report args), privacy rules and async post-insert classification ordering (plan handoff:1295-1297)
- Review family: Phase A reviewer is a non-Claude lane (cross-family to this Claude subagent)
- Rationale: one coherent service rewrite plus two new pure helpers
- Tasks: 3 | Depends on: B4, B5, B6 | Parallel with: B14
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts`
  - CREATE `$WT/libs/backend/lane-outcomes/src/lib/task-kind-mapping.ts`
  - CREATE `$WT/libs/backend/lane-outcomes/src/lib/review-verdict.parser.ts`
  - CREATE `$WT/libs/backend/lane-outcomes/src/lib/review-verdict.parser.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts`

### Task 7.1: Task-kind resolution explicit → mapped → classified (async after insert) → unclassified — COMPLETE

- Plan reference: implementation-plan.md:322-398 (Component 6); decisions.md row 7
- Quality requirements: no fallback kind. Classification is never on the spawn path. Briefs are bounded at 200 and dropped after use.
- Implementation details: `task-kind-mapping.ts` owns `taskKindForRole` (plan D-19). The recorder depends on the shared classifier port only (no lane-routing import).

### Task 7.2: Subagent producers, one row per `subagent:<agentId>`, second producer enriches — COMPLETE

- Quality requirements: dedupe on `subagentRunId`. A stop with incomplete metadata still yields a row.

### Task 7.3: Review capture via strict verdict-line parser + explicit reviewed-run reference — COMPLETE

- Files: `review-verdict.parser.ts` and spec, recorder spec
- Quality requirements: strict line grammar only; ≤ 64 KiB per file, ≤ 3 files; malformed → `Review capture refused` with code, no text

### Batch 7 verification

- Acceptance: Req 2, Req 3, Req 7, NFR privacy
- `npm run verify -- -p @ptah-extension/lane-outcomes`
- `npm run verify -- -t lint -p degradation-audit`
- Result (team-leader re-run): lane-outcomes 3/3 targets succeeded (lint, test, typecheck),
  exit 0. degradation-audit lint succeeded, exit 0 (the B6 failure was fixed in 7402fb558,
  decisions.md row 18). No host typecheck is listed for B7. No mojibake in the five files.
  Implementer: Claude backend-developer subagent. Phase A review still to come.
- Executor decisions accepted: `onLaneRecordInserted` keeps its name (rename belongs with
  B8/B9, which own `outcome-write-pipeline.ts` and `di/register.ts`);
  `parseReviewDeliverable(text, reviewerRunId)` so the parser owns `self-review`; the extra
  `too-large` refusal (3 x 64 KiB) enforces the Task 7.3 bound; `reportedSubagentStopRow`
  built here as the base row of both producers.
- Hand-off: B8 must fire the insert callback for `subagent-stop` rows when `inserted` is true
  (today only lane rows reach it, `outcome-write-pipeline.ts:608-619`), and may do the rename
  with B9. B9 must export `taskKindForRole`, `reportedSubagentStopRow`,
  `parseReviewDeliverable` and `LaneCompletionTransient` from the barrel, pass
  `TASK_KIND_CLASSIFIER` as the recorder's 5th argument, and subscribe `recordSubagentEnded`
  to `SdkAdapterEvents.subagentEnded`.
- Phase A review notes (Minor, not fixed): a repeated `subagentEnded` for the same run after a
  null classification could stash and classify a second time; a brief stashed for a duplicate
  lane completion lingers until map eviction (bounded at 200).

## Batch 8: Write pipeline: held-report join, durable review holds — COMPLETE (45416c4f4)

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: subagent backend-developer -> CLI lane (TypeScript implementation, capable model)
- Subagent reason: durability and admission semantics across the journal, the held-reports table and the KV snapshot (plan F1)
- Review family: Phase A reviewer is a non-Claude lane
- Rationale: one file plus two specs, with high semantic risk
- Tasks: 2 | Depends on: B7
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.spec.ts`
  - CREATE `$WT/libs/backend/lane-outcomes/src/lib/write/outcome-early-review.integration.spec.ts`

### Task 8.1: One insert path `insertStopWithHeldReports`, hold lane and subagent reviews, 24 h expiry to rejected ledger — COMPLETE

- Plan reference: implementation-plan.md:399-445 (Component 7)
- Quality requirements: `onRecordInserted` fires once per inserted row. Recorder absent or rejected → existing diagnostics, never counted as success.
- Validation notes: existing `outcome-write-pipeline.backlog.spec.ts` and `.durability.spec.ts` must stay green

### Task 8.2: Early-review integration spec with real recorder/pipeline/store — COMPLETE

- Implementation details: review lands before its target; target insert joins it. Missing target expires.

### Batch 8 verification

- Acceptance: Req 1 (durable queue), Req 7
- `npm run verify -- -p @ptah-extension/lane-outcomes`
- `npm run verify -- -t lint -p degradation-audit`
- Result (team-leader re-run): lane-outcomes 3/3 targets succeeded (lint, test, typecheck;
  Nx cache hit on the executor's identical inputs), exit 0. degradation-audit lint succeeded,
  exit 0. No mojibake in the six files. Implementer: Claude backend-developer subagent.
  Phase A review still to come.
- Scope exceptions accepted (test-only, no production change outside the pipeline):
  decisions.md row 20 (`backlog.spec.ts` x3, `durability.spec.ts` x1 assertions moved to held
  semantics; the missing-target case asserts the 24 h `held-report-expired` ledger entry) and
  row 21 (fault fixtures retargeted to `insertStopWithHeldReports`; each fault test still
  proves its fault fired through journal residue, warn counts or a stall counter; the recorder
  case asserts `classify` called exactly once).
- Executor decisions accepted: D-B8-1 (closed-store review admitted only when the journal
  held-run index has an unexpired entry or a pending holdable report covers the run, else the
  existing retry refusal). Verdict: consistent with implementation-plan.md:410-413 and :428-430
  ("unchanged retry/rejection semantics"; "the journal heldRuns index covers the not-yet-open
  store"); a closed store cannot tell an unindexed run from a stored row, and the refusal
  carries a retry hint. D-B8-2 (expired report holds write the ledger with the single
  `Outcome hold expired` warning; budget-stop expiry stays log-only). D-B8-3 (no rename of
  `onLaneRecordInserted`; belongs with B9). D-B8-4 (`fillMissingSubagentJoin` on a non-inserting
  subagent stop, plan :408-409).
- Hand-off to B9: rename `onLaneRecordInserted` -> `onRecordInserted` there if done (pipeline
  ctor, recorder method, `di/register.ts`, recorder and integration specs). The pipeline now
  fires the insert callback for `subagent-stop` rows, so subscribing `recordSubagentEnded`
  needs no extra wiring.
- Phase A review notes (Minor, not fixed): early reviews arriving while the store is still
  closed and unindexed are refused with a retry hint, so callers must retry after open;
  `store.hasHeldDeliverables` is no longer called by the pipeline but stays on the port
  (separate cleanup); `backlog.spec.ts:26-30` BusyStore override of `insertIfAbsent` is now
  inert; `pendingHolds` counts holdable pending reports only (lane deliverables are excluded
  because they are refused, a narrowing of plan :416 with the same cap effect).

## Batch 9: Outcome DI wiring, barrel, second producer subscription — COMPLETE (26780cb0c)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: bounded wiring. Owns the lane-outcomes barrel (F7).
- Tasks: 2 | Depends on: B8
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/di/tokens.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/di/register.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/di/start.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/lib/di/start.spec.ts`
  - MODIFY `$WT/libs/backend/lane-outcomes/src/index.ts`
  - CREATE `$WT/libs/backend/lane-outcomes/src/lib/subagent-stop.integration.spec.ts`

### Task 9.1: `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` (optional), subscription, barrel exports incl. `taskKindForRole` — COMPLETE

- Plan reference: implementation-plan.md:473-500 (Component 9)

### Task 9.2: Subagent-stop integration spec (incomplete metadata, two producers, one row) — COMPLETE

### Batch 9 verification

- Acceptance: Req 1 (optional recorder path), Req 3
- `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime`
- Result (team-leader re-run): lane-outcomes 3/3 targets succeeded (lint, test, typecheck;
  Nx cache hit on the executor's identical inputs), exit 0. degradation-audit lint succeeded,
  exit 0. ptah-electron typecheck succeeded (barrel gained exports), exit 0. cli-agent-runtime
  not run: B9 touches no file in it. No mojibake, no `any`/`@ts-ignore`, no new Nx edge
  (agent-sdk and platform-core already imported by the lib), no message text in logs.
  Implementer: codex CLI lane. Phase A review still to come.
- Seam coverage (plan :492-496): hook-first and event-first each give one row; null transcript
  gives `telemetryJoin 'unavailable'`; held deliverables report joins on stop; review-kind
  subagent with a targeted `lastAssistantMessage` and no outcome report sets the lane row's
  `finalReview`; an untargeted message leaves it unchanged. All covered.
- Executor decisions accepted: `observeSubagentEnded` stays opt-in (plan :481, D-11; Electron
  passes it in B21, plan :1080); `onLaneRecordInserted` keeps its name (rename optional, the
  pipeline file is outside B9); the existing agent-sdk barrel import is reused.
- Phase A review notes (Minor, not fixed): the untargeted-message case asserts only that the
  target stays `approved`, not that no other row changed; the review case flushes once after
  the second emit (no second `setImmediate` + flush as in the first case); the SDK logger cast
  in the integration fixture (`ConstructorParameters<typeof SdkAdapterEvents>[0]`) is test-only.

## Batch 10a: Rate-limit matcher + failure class — COMPLETE (commit 38278e050)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: pure functions. Patterns and precedence are given. Small.
- Tasks: 1 | Depends on: none | Parallel with: B1, B5
- Phase: A | Phase review: covered by Phase A
- Files:
  - CREATE `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-rate-limit-classifier.ts`
  - CREATE `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-rate-limit-classifier.spec.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-failure-class.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-failure-class.spec.ts`

### Task 10a.1: API rate-limit wording matcher; `classifyLaneFailureClass` optional `rateLimited` → `usage-limit` — COMPLETE

- Plan reference: implementation-plan.md:501-651 (Component 10, r3 matcher and failure class)
- Pattern to follow: `limits/lane-limit-classifier.ts`, `limits/lane-auth-classifier.ts`
- Quality requirements: new field optional (barrel export compatibility). Covers the decisions.md row 10 wording (`429 ... API rate limit`).
- Validation notes: R4

### Batch 10a verification

- Acceptance: Req 1 (usage-limit failure class)
- `npm run verify -- -p @ptah-extension/cli-agent-runtime`
- `npm run verify -- -t typecheck -p @ptah-extension/vscode-lm-tools,ptah-electron`

## Batch 10b: Verdict freshness, rate-limit downgrade, lane review capture, terminal integration — COMPLETE (6df757192)

- Recommended executor: CLI lane (TypeScript implementation, capable model; the lane with confirmed room)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: bounded 4-file batch with fixed context field and synthetic-context integration cases
- Tasks: 3 | Depends on: B9, B10a
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts`
  - CREATE `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-terminal-outcomes.integration.spec.ts`

### Task 10b.0: Pre-check stale fixtures — COMPLETE

- Grep `lane-completion-notifier.service.spec.ts` for deliverable fixtures whose mtime precedes `startedAt`. Update them to the new rule and list each one in the report.

### Task 10b.1: `verdictOf` honours `writtenAfterSpawn` (stale → `no-deliverable`), `rateLimited` downgrade → `failed`/`usage-limit` — COMPLETE

- Plan reference: implementation-plan.md:501-651; decisions.md row 10; envelope precedent `lane-completion-notifier.service.ts:180-186`
- Quality requirements: optional `LaneCompletionContext.rateLimited` (default false). Kind via `taskKindForRole` from the lane-outcomes barrel.
- Validation notes: R4

### Task 10b.2: Lane review capture + terminal integration spec (exit, fail, crash, usage-limit, timeout, stop, continuation, stale file, exit-0 429, fresh file, optional recorder) — COMPLETE

- Quality requirements: the spec distinguishes a genuine failure row from `delivered`. A continuation keeps its terminal-event identity with no duplicate.

### Batch 10b verification

- Acceptance: Req 1, Req 7 (lane review capture)
- `npm run verify -- -p @ptah-extension/cli-agent-runtime`
- `npm run verify -- -t lint -p degradation-audit`

### Batch 10b result (team-leader, Mode 2)

- Commit: 6df757192 (4 files, +337/-14; lint-staged made no formatting change).
- Executor: codex CLI lane. Report: batch-10b-report.md. The lane's single verify failed
  (8 assertions); it fixed them without a rerun. Team-leader verify on the committed content:
  - `npm run verify -- -p @ptah-extension/cli-agent-runtime`: 3/3 succeeded (cache hit), exit 0.
  - `npm run verify -- -t lint -p degradation-audit`: 1/1 succeeded, exit 0.
  - `npm run verify -- -t typecheck -p ptah-electron`: 1/1 succeeded, exit 0.
- Verified on disk: `verdictOf` gates `allFresh` on `writtenAfterSpawn !== false` (stale →
  `no-deliverable`; row 10 live defect closed); `rateLimited && !allFresh` → `failed`, classifier
  maps it to `usage-limit`; `failureKind` stays `info.failureKind ?? null`, no ledger write;
  `LaneCompletionContext.rateLimited?` optional, defaulted `?? false` at both call sites;
  `taskKindForRole` imported from the `@ptah-extension/lane-outcomes` barrel over the existing edge
  (no project.json/tsconfig change); recorder-null warns once per process + debug per run;
  `{ brief: info.task }` transient arg per plan. Integration spec covers exit, failed exit/crash,
  quota usage-limit, timeout, caller stop, continuation (dedupe + own id), stale file, exit-0 429,
  fresh file, fresh file after 429, absent recorder, review before/after target with replay,
  no-target review, APPROVED/REJECTED. No mojibake, `any`, `@ts-ignore` or new `as unknown as`;
  logs carry `runId`/error name only.
- 10b.0 fixtures: two stale-mtime lane expectations moved to `no-deliverable` (one newly asserted,
  one changed from `delivered`); the `applies the exported disk check` case asserts only the flag;
  the unparsable-`startedAt` case keeps `delivered` (absent flag = compatibility rule). No test
  weakened; two mock expectations gained the plan's transient brief argument.
- Decisions: decisions.md row 23 (failureKind asserted at recorder input, no schema expansion).
  Path-escape rule copies `outcome-report.tool.ts:132-142` as the plan requires, so absolute
  declared review paths are refused (not captured).
- Minor notes for the Phase A review (not fixed here):
  1. `captureReview` reads declared review files without checking freshness or the run verdict,
     so a stale review file left by an earlier reviewer is captured under the new reviewer run id
     (dedupe is per reviewer run) and could add a second `reviseRounds`. Consider gating capture
     on `writtenAfterSpawn !== false`.
  2. Absolute review deliverable paths (the norm in lane prompts) are refused by the copied
     escape rule, so capture may be skipped in practice; consider resolving absolute paths and
     applying only the inside-root check.
  3. Capture reads files sequentially and aborts the whole capture on the first oversize or
     escaping file instead of skipping it.
  4. `recorderUnavailableWarned` is module-level state; spec ordering relies on it only for the
     debug line.
- Hand-off: B10c (sets `rateLimited` from exit-path segments; this batch only consumes it) and
  B11 (outcome report tool pairing) run next in parallel; both are file-disjoint from 10b.

## Batch 10c: Exit-path rate-limit capture (process manager + ptah-cli stream loop) — COMPLETE (56ba63c39)

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: subagent backend-developer -> CLI lane (TypeScript implementation, capable model)
- Subagent reason: exit-path ordering before `outputBuffer.discard`, per-turn segment index across continuations, hot stream loop (plan handoff:1295-1297)
- Review family: Phase A reviewer is a non-Claude lane
- Rationale: correctness depends on event ordering inside a 2000+ line service
- Tasks: 2 | Depends on: B10a, B10b | Parallel with: B11
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/tracked-agent.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts`
  - MODIFY `$WT/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts`

### Task 10c.0: Confirm the single turn-restart site — COMPLETE

- Grep `hasExited = false` and confirm `agent-process-manager.service.ts:2206` (`continueConversation`) is the only site that must reset `turnSegmentStart`. If there is another, report it before you edit.

### Task 10c.1: `rateLimitMatched` + `turnSegmentStart` on `TrackedAgent`; `handleExit` sets it from bounded current-turn error segments (exit 0) or `laneFailureTexts`; stream loop turns `is_error` 429 into the fixed marker — COMPLETE

- Plan reference: implementation-plan.md:501-651 (r3 capture); :1166-1174
- Quality requirements: the marker is a fixed string, never provider text. Debug log `{ agentId, cli, exitCode }` only. The flag is set before `outputBuffer.discard`.
- Validation notes: R4

### Batch 10c verification

- Acceptance: Req 1 (exit-0 429 → failed/usage-limit)
- `npm run verify -- -p @ptah-extension/cli-agent-runtime`
- `npm run verify -- -t lint -p degradation-audit`

### Batch 10c result (team-leader, Mode 2)

- Commit: 56ba63c39 (5 files, +346/-0). Executor: Claude backend-developer subagent. Report:
  batch-10c-report.md. B11 files (vscode-lm-tools outcome-report tool, shared
  lane-outcome.types.ts) stayed unstaged.
- Team-leader verify (B11's libs/shared change was in the working tree; no failure from it):
  - `npm run verify -- -p @ptah-extension/cli-agent-runtime`: 3/3 succeeded (cache hit of the
    executor's run on identical inputs), exit 0.
  - `npm run verify -- -t lint -p degradation-audit`: 1/1 succeeded (cache hit), exit 0.
- 10c.0: `hasExited = false` has one site (`continueConversation`); spawn literal sets
  `turnSegmentStart: 0`; the restore path builds exited records and reads `?? 0`.
- Verified on disk: `rateLimitMatched` is set in the `running` branch of `handleExit` before
  `signalLaneCompletion`, `flushDelta` and `outputBuffer.discard`; the spec pins the order with a
  `discard` spy. The marker is the fixed `PTAH_API_RATE_LIMIT_SEGMENT` constant; the stream loop
  never copies `result` into a segment; the debug log carries `{ agentId, cli, exitCode }` only.
  The match never touches `limit`, `failureKind` or `recordLaneLimits`. The stream-loop work is
  limited to `is_error` result messages and a 4 KiB slice. Exit-path texts are bounded (8 error
  segments x 4 KiB, 16 KiB tail). Added lines have no mojibake, `any`, `@ts-ignore`,
  `as unknown as` or eslint-disable; the classifier import is relative within the project (no
  new Nx edge).
- Departure verdicts:
  (a) `rateLimited: true` only on a match — ACCEPTED. Semantically identical to the plan's
  `?? false`, because the notifier defaults `context.rateLimited ?? false` at both call sites
  (B10b), and it matches the sibling conditional spreads.
  (b) Failed exit reads current-turn error segments + stdout tail instead of `laneFailureTexts`
  — ACCEPTED. Same bounds as `laneFailureTexts`, and it implements the plan's own "reset per
  turn" rule (N1) more faithfully: an earlier turn's 429 error segment cannot mark a later
  failed turn. Quota/auth still use `laneFailureTexts` unchanged.
  (c) Flag cleared at continuation start — ACCEPTED. Required by "reset per turn": a stop or
  timeout in turn 2 signals without entering the `running` branch and would otherwise carry
  turn 1's flag. Covered by specs 6 and 7.
- Minor notes for the Phase A review (not fixed here):
  1. `tracked.authMatched` is not reset in `continueConversation`, so a stop/timeout in a
     continuation turn carries the previous turn's auth match.
  2. Quota and auth classification (`laneFailureTexts`) read error segments from all turns, not
     only the current one.

## Batch 11: Outcome report tool pairing + required field flip — COMPLETE (4257a17ec)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase A rule
- Rationale: the last literal is fixed in the same batch as the flip (F8)
- Tasks: 2 | Depends on: B9, B10b | Parallel with: B10c
- Phase: A | Phase review: covered by Phase A
- Files:
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts`
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts`
  - MODIFY `$WT/libs/shared/src/lib/types/lane-outcome.types.ts`

### Task 11.1: Re-grep literals, then flip `taskKindSource` to required — COMPLETE

- Re-grep `LaneOutcomeRecord = {`, `: LaneOutcomeRecord`, `LaneOutcomeRow = {`, `telemetryJoin:` across `libs/` and `apps/`. Any literal outside this batch's files → stop and report (R3).

### Task 11.2: Reviewer pairing and external-caller subagent rows (`reportedSubagentStopRow`) — COMPLETE

- Plan reference: implementation-plan.md:652-677 (Component 11)
- Quality requirements: zod validation at the boundary (`outcome-report.tool.ts:94`)

### Batch 11 verification

- Acceptance: Req 3, Req 7, Compatibility NFR
- `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/shared`
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
- Earlier note found here (it duplicates the Batch 1 result line; kept verbatim): shared + persistence-sqlite tests and typecheck pass; persistence lint fails only on 10 pre-existing `no-restricted-syntax` errors in 0057/0058 (no diff vs 1d2fbd4b5). Host typecheck 4/4 pass. Commit includes the 22 latest-version spec bumps (decisions.md row 13).
- Result (team-leader, 2026-10-30, Batch 11, commit 4257a17ec; executor: codex CLI lane):
  - `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/shared`: 6 tasks (2 projects x lint/test/typecheck), 6 succeeded, exit 0.
  - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/lane-outcomes`: 5 tasks, 5 succeeded, exit 0. Team-leader added `lane-outcomes` because it holds most `LaneOutcomeRecord` literals, and the host typechecks do not cover its specs.
  - `npm run verify -- -t lint -p degradation-audit`: exit 0.
  - R3 re-grep (team-leader): 32 hits for `LaneOutcomeRecord = {|: LaneOutcomeRecord|LaneOutcomeRow = {` across libs/ and apps/. All of them are in lane-outcomes or in this batch's spec. Every object literal (agent-signals.spec:4, lane-outcome-reader.service.spec:13, store.test-support:4, subagent-join.spec:8, recorder:165/367) carries `taskKindSource`. `subagent-join.ts:22` spreads the row. No hit is out of scope.
  - Checked: zod `OutcomeReportArgsSchema.parse` at `outcome-report.tool.ts:98`, with no casts. `reportedSubagentStopRow` and `deterministicReviewReportId` come from the existing `@ptah-extension/lane-outcomes` barrel, so there is no new Nx edge. The diff has no `any`, `@ts-ignore`, `as unknown as` or mojibake, and it adds no log text.
  - Decisions (executor, accepted): the report id is deterministic only when `reviewerRunId` is supplied. An external-caller row is enqueued only for an `agentId` target with no subagent row, no lane row and no `getCallerSessionId()`. The field flips to required now.
  - Minor (recorded, not fixed):
    - The new spec uses `{} as Logger`, a spec-only cast.
    - The reportId equality assertions in the pairing spec are hard to read.
    - The external-caller path enqueues the reported stop row before `submit`, so the row stays even when `submit` later refuses (for example, when every deliverable is missing). The plan's ordering allows this; the Phase A review should confirm that it is intended.

## Batch 12: Prior-blended local cells — COMPLETE (3d87596ac)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase C rule
- Rationale: pure, test table given
- Tasks: 1 | Depends on: B6 (same lib) | Parallel with: B3, B17
- Phase: C | Phase review: covered by Phase C
- Files:
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/routing-constants.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/matrix/local-derivation.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/matrix/local-derivation.spec.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/matrix/matrix.schema.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/reasons/compile-reasons.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/reasons/compile-reasons.spec.ts`

### Task 12.1: Per-rate blend `(s + k·prior/100)/(n + k)`, `BLEND_PRIOR_WEIGHT = 10`, replace `MINIMUM_SAMPLE_COUNT` gate; unclassified rows excluded — COMPLETE

- Plan reference: implementation-plan.md:678-720 (Component 12); decisions.md row 7; `routing-constants.ts:142,152`
- Quality requirements: n = 0 → prior exactly. No seed → neutral score. Every row of the plan's test table is a spec case.

### Batch 12 verification

- Acceptance: Req 8, Req 2 (unclassified excluded from derivation)
- `npm run verify -- -p @ptah-extension/lane-routing`
- Result (team-leader, 2026-10-30): lane-routing lint/test/typecheck 3/3 pass. Typecheck of vscode-lm-tools and ptah-electron passes. All 9 blend-table rows are spec cases. The commit includes 2 out-of-list specs (seed-matrix, capability-matrix.store) per decisions.md row 17: 8 files, 1 lib. The Phase C review runs after B20, or now if B20 is held.

## Batch 13: Scope check, pre-flight reuse cache, host routing setting (classes) — COMPLETE (e60d665c3)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase B rule
- Rationale: bounded classes with the caps and cache rules given. No wiring.
- Tasks: 3 | Depends on: B12 (same lib) | Parallel with: B4, B20
- Phase: B | Phase review: covered by Phase B
- Files:
  - CREATE `$WT/libs/backend/lane-routing/src/lib/scope/scope-check.service.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/scope/scope-check.service.spec.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/scope/preflight-reuse-cache.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/scope/preflight-reuse-cache.spec.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts`
  - CREATE `$WT/libs/backend/lane-routing/src/lib/scope/host-routing-setting.spec.ts`

### Task 13.1: `ScopeCheckService` (typed decision, ≤ 3000 ms, bounded conversation, fail-open) — COMPLETE

- Plan reference: implementation-plan.md:721-810 (Component 13)

### Task 13.2: `PreflightReuseCache` (100 entries; session + revision + model fingerprint; `beginTurn`/`confirmRevision`/`put`/`get`) — COMPLETE

- Quality requirements: the fingerprint carries no secret. A different session, revision or model → miss.

### Task 13.3: `HostRoutingSetting` (live read; default ON only with a configured decision model; unset model → off) — COMPLETE

### Batch 13 verification

- Acceptance: Req 4, Req 6, NFR cost
- `npm run verify -- -p @ptah-extension/lane-routing`
- Result (team-leader, 2026-10-30): lane-routing lint/test/typecheck 3/3 pass (cache hit on the lane run's inputs). On disk: one `runFixedRequest` through the B6 `DecisionCaller` (3000 ms `AbortSignal.timeout`), zero requests when the model is unset or routing is disabled (checked again after `openCaller`), and answers below 0.5 confidence come back null (spec case 0.49). The five fields are truncated to their caps, nothing is logged or persisted, and `assess` never rejects. The cache `get` checks enablement, `known` continuity, revision and fingerprint. A disabled `get` or `put` clears the cache, and `markUnknown` or a malformed revision drops the entry. `HostRoutingSetting.isEnabled()` follows the plan rule exactly, and a read failure means off. B18 has synchronous `invalidate`, `markUnknown` and `clear` for the epoch guard. No mojibake. Commit: 6 files, 1 lib.

## Batch 14: Lane-routing DI, barrel, roles, pre-flight reuse in `route_decide` — COMPLETE (7402fb558)

- Recommended executor: CLI lane (TypeScript implementation, capable model; the lane with confirmed room)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase B rule
- Rationale: owns the lane-routing barrel (F7)
- Tasks: 2 | Depends on: B13 | Parallel with: B7
- Phase: B | Phase review: covered by Phase B
- Files:
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/di/tokens.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/di/register.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/index.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/route-decide.service.ts`
  - MODIFY `$WT/libs/backend/lane-routing/src/lib/route-decide.preflight.spec.ts`

### Task 14.1: Tokens/factories for the B13 classes and classifier; barrel exports incl. `BUILTIN_SUBAGENT_ROLES` — COMPLETE

- Plan reference: implementation-plan.md:721-810 (Component 13 DI/barrel/roles), :787, :809; D-19

### Task 14.2: `route_decide` pre-flight consults the cache (hit → no model request; miss → normal pre-flight); gate-0.1 untouched — COMPLETE

- Plan reference: implementation-plan.md:811-839 (Component 14)

### Batch 14 verification

- Acceptance: Req 6
- `npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/agent-sdk`
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli`
- Result (team-leader, 2026-10-30): lane-routing+agent-sdk 6/6 pass, hosts typecheck 3/3 pass, and `npm run verify -- -t lint -p degradation-audit` 1/1 pass with the baseline unchanged. On disk: the three B13 classes are registered with `instanceCachingFactory` and exported, and `scope/` is unchanged. `BUILTIN_SUBAGENT_ROLES` is public as `ReadonlySet<string>`. The cache lookup sits only in the parsed `pre-flight` branch before `decidePreflight`. A hit returns a `PreflightResultSchema`-validated copy with usage `{requests:0,...null}` and the reason `reused host pre-flight result`, with no caller opened. A miss falls through. gate-0.1 is untouched. The fingerprint is `JSON.stringify(config.getSelection())`, as in the plan. No mojibake. Commit: 7 files, 1 lib, including the B6 classifier degradation-audit comment (decisions.md row 18).

## Batch 15: Pre-flight reuse in lm-tools (session key through dispatcher) — COMPLETE (aab77cbea)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase B rule
- Rationale: bounded
- Tasks: 1 | Depends on: B14, B11 (same lib)
- Phase: B | Phase review: covered by Phase B
- Files:
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/route-namespace.builder.ts`
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts`
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.spec.ts`
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
  - MODIFY `$WT/libs/backend/vscode-lm-tools/src/index.ts`

### Task 15.1: Thread the dispatcher session key into `route_decide` pre-flight; spec hit/miss — COMPLETE

- Plan reference: implementation-plan.md:811-839 (Component 14, lm-tools)

### Batch 15 verification

- Acceptance: Req 6
- `npm run verify -- -p @ptah-extension/vscode-lm-tools`
- Result (team-leader, 2026-10-30): commit aab77cbea, 5 files, 1 lib.
  - Prettier: route-namespace.builder.ts, route-tool-handlers.spec.ts and protocol-dispatcher.ts failed `--check` and were fixed with `--write` before staging. All 5 files pass after the commit.
  - Verify: the first lm-tools run had 1 failure out of 3306, in http-server.handler.spec.ts (a real-port collision, 50991 vs 50992, while other worktrees were running checks). This batch does not touch that file. The spec passed alone, and the full re-run passed 3/3 (Nx flagged it as a flaky task). ptah-electron typecheck passed 1/1.
- On-disk review:
  - `routeDecideResponse` computes `getSessionTabId?.(id) ?? id` from the trimmed `getCallerSessionId()`, mirroring the artifact path.
  - The handler, then the namespace, then `RouteDecideService.decide(args, source, context)` forward the context.
  - A call with no key uses the original one-argument call.
  - The key is not a tool argument, is not in the output, and is not logged. The specs assert it is absent from the output.
  - The lane-routing barrel import already existed, so there is no new Nx edge.
  - No `any`, `@ts-ignore`, `as unknown as` or mojibake, and no prompt or rule text changed.
- Decisions:
  - (1) Accepted prettier's formatting-only changes to 3 lines in protocol-dispatcher.ts that were already unformatted at HEAD (two import blocks and the artifact-publish ternary). The alternative was hand-reverting them, which would leave the file failing `--check`. Reversible.
  - (2) Did not fix the http-server port flake. It is out of scope and environmental, recorded for the Phase B review.
- Hand-off to B18: the host coordinator stores its validated pre-flight result under the same key, `getSessionTabId(trimmedCallerId) ?? trimmedCallerId`. Revision confirmation and invalidation stay in B13's `PreflightReuseCache`. `buildRouteCandidateSource` is now exported from `@ptah-extension/vscode-lm-tools`.

## Batch 16: Next-turn reminder queue + UserPromptSubmit drain — COMPLETE (15a10bc5f)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase B rule
- Rationale: bounded. Includes the alias-aware `discard` B18 needs.
- Tasks: 2 | Depends on: B5 (same lib) | Parallel with: B2, B6
- Phase: B | Phase review: covered by Phase B
- Files:
  - CREATE `$WT/libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts`
  - CREATE `$WT/libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.spec.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/di/tokens.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/di/register.ts`

### Task 16.1: Queue (200 entries, aliases, `put`/`take`/`discard`), token `SDK_NEXT_TURN_REMINDER_QUEUE` — COMPLETE

- Plan reference: implementation-plan.md:840-868 (Component 15)

### Task 16.2: Synchronous drain in the UserPromptSubmit hook → `additionalContext` — COMPLETE

- Quality requirements: no await is added; an empty queue leaves the hook output unchanged

### Batch 16 verification

- Acceptance: Req 5 (next-turn reminder)
- `npm run verify -- -p @ptah-extension/agent-sdk`
- Result (team-leader re-run): agent-sdk 3/3 passed (lint, test, typecheck); host typecheck
  ptah-electron, ptah-extension-vscode, ptah-cli 3/3 passed. Commit 15a10bc5f, six files only.
  The DI guard entry for `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE` stays with Task 21.2.
  expected-resolvable.ts is a positive list, so it does not block this batch.

## Batch 17: Host routing setting storage + agent-sdk barrel — COMPLETE (0189199e6)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase B rule
- Rationale: small. Owns the agent-sdk barrel.
- Tasks: 1 | Depends on: B16 | Parallel with: B3, B12
- Phase: B | Phase review: covered by Phase B
- Files:
  - MODIFY `$WT/libs/backend/platform-core/src/file-settings-keys.ts`
  - MODIFY `$WT/libs/backend/platform-core/src/file-settings-keys.spec.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
  - MODIFY `$WT/libs/backend/agent-sdk/src/index.ts`

### Task 17.1: `agentOrchestration.hostRouting` file-based key, settings export, queue export — COMPLETE

- Plan reference: implementation-plan.md:1052-1073 (Component 17)
- Validation notes: R2 (platform-core is imported by ptah-tui)

### Batch 17 verification

- Acceptance: Req 4 (setting persisted)
- `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/agent-sdk`
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
- Result (team-leader, 2026-10-30): platform-core + agent-sdk lint/test/typecheck 6/6 pass; host typecheck (electron, vscode, cli, tui) 4/4 pass. Effective enablement (`!== false && decision model set`) stays in the consumer `HostRoutingSetting` (Component 13, B13). The boolean key carries no secret. The barrel export uses an intra-lib file path, the same pattern as the existing helper exports.

## Batch 18: Host routing coordinator (state machine) — COMPLETE (20dffd75e)

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: subagent backend-developer -> CLI lane (TypeScript implementation, capable model) with Component 16 and the Gate 2 carry-forward pasted in full
- Subagent reason: concurrent state machine (F2-F4), generation-guarded `applyAssessment`, settle-time enablement check, Disable reset, and the binding Gate 2 carry-forward
- Review family: Phase B reviewer is a non-Claude lane
- Rationale: the highest-risk logic in the task
- Tasks: 3 | Depends on: B14, B15, B17
- Phase: B | Phase review: covered by Phase B
- Files:
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts`
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.spec.ts`
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.multi-turn.spec.ts`
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.ts`
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.spec.ts`
  - MODIFY `$WT/libs/backend/rpc-handlers/src/lib/chat/tokens.ts`

### Task 18.1: Coordinator `admitUserTurn`/`onTurnEnded`, scope state machine, one pre-flight per revision, one nudge per revision, reminder format — COMPLETE

- Plan reference: implementation-plan.md:869-1051 (Component 16)
- Quality requirements: tab state 200, alias map 200. Fail-open on every stage (`Host routing step failed` + stage, no text). gate-0.1 is never triggered.

### Task 18.2: Gate 2 carry-forward (binding) — COMPLETE

- Plan reference: implementation-plan.md:1382-1393
- Requirements: increment a per-tab cancellation epoch on Disable reset. Capture it when each assessment and each pre-flight starts. Discard a result whose epoch changed BEFORE any state, cache or queue mutation. Guard `inFlight` cleanup by promise identity.
- Validation notes: R5

### Task 18.3: Deferred specs — COMPLETE

- Files: `host-routing.coordinator.spec.ts` (no new file), `host-routing.multi-turn.spec.ts`
- Cases: reverse-order scope answers; toggle-off during an in-flight assessment and during a pre-flight; off→on before an old assessment settles; off→on before an old pre-flight settles, including a new same-revision pre-flight. Assert no old reminder and no cache entry, and that only the new request stays active. Multi-turn acceptance: vague → nudge once → agreed → routed → reminder next turn.

### Batch 18 verification

- Acceptance: Req 4, Req 5, Req 4 disable transition, Gate 2 carry-forward
- `npm run verify -- -p @ptah-extension/rpc-handlers`
- `npm run verify -- -t lint -p degradation-audit`
- Result (team-leader, 2026-10-31): rpc-handlers lint/test/typecheck 3/3 succeeded (exit 0, 0/3
  cache hits); degradation-audit lint 1/1 succeeded (exit 0, cache hit); prettier --check clean on
  all 6 files. Gate 2 carry-forward verified on disk: epoch bumped in `disableReset`, captured at
  admission and passed to `startPreflight`, checked before any mutation in `applyAssessment` and
  `settlePreflight`; `inFlight` cleared only on promise identity; specs cover off->on before an
  old assessment and an old pre-flight settles (incl. new same-revision pre-flight and a late old
  failure). Report issue R1 (`resolveTaskKind`) was resolved by 8ee2e1afb.

## Batch 19: Coordinator wiring into chat turn admission — COMPLETE (5c062d374)

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: subagent backend-developer -> CLI lane (TypeScript implementation, capable model)
- Subagent reason: sensitive reply hot path in `chat-session.service.ts` (start/continue/slash/resume branches at :592-714, :1057-1195)
- Review family: Phase B reviewer is a non-Claude lane
- Rationale: small diff, high blast radius
- Tasks: 2 | Depends on: B18
- Phase: B | Phase review: covered by Phase B
- Files:
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/host-routing/register-host-routing.ts`
  - MODIFY `$WT/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  - CREATE `$WT/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.host-routing.spec.ts` (D-TL-1)
  - MODIFY `$WT/libs/backend/rpc-handlers/src/index.ts`

### Task 19.1: `registerHostRouting` (Electron-only by registration), barrel export — COMPLETE

- Plan reference: implementation-plan.md:869-1051 (Component 16 wiring, :1043-1050)

### Task 19.2: `admitUserTurn` after dispatch, not awaited, on start and continue only (not slash, not resume) — COMPLETE

- Quality requirements: optional coordinator (absent in VS Code/CLI → no-op). A spec asserts dispatch resolves before admission settles, and a thrown admission does not reject the turn.
- Validation notes: R6

### Batch 19 verification

- Acceptance: Req 4, Req 5, NFR turn latency
- `npm run verify -- -p @ptah-extension/rpc-handlers`
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli`
- `npm run verify -- -t lint -p degradation-audit`
- Result (team-leader, 2026-10-31): rpc-handlers lint/test/typecheck 3/3 succeeded (exit 0);
  host typecheck electron/vscode/cli 3/3 succeeded (exit 0); degradation-audit lint 1/1
  succeeded (exit 0); all three were cache hits on the current inputs from the executor's runs.
  prettier --check clean on all 4 files. On disk: admission runs after `launchSdkSession` (start)
  and `sendMessageToSession` (continue), not awaited; Ptah-CLI returns earlier on both paths;
  native/slash turns excluded; no admission in resume. The swallow carries
  `degradation-audit: reported` and logs only the error class (no prompt text). Accepted
  deviations: the try/catch around admission, and the precondition check in `registerHostRouting`.

## Batch 20: Host routing settings toggle (Electron) — COMPLETE (e008c1d3c)

- Recommended executor: subagent (frontend-developer)
- Execution mode: sequential
- Fallback order: subagent frontend-developer -> CLI lane (Angular implementation, capable model)
- Subagent reason: UI change, no new surface. Angular rules (standalone, OnPush, signals, `ClaudeRpcService` only) and the save/read-back/Undo pattern. Visual evidence is required.
- Review family: Phase C rule (non-Claude lane for code-logic; visual-reviewer for rendering)
- Rationale: one self-contained component plus its mount
- Tasks: 2 | Depends on: B17 | Parallel with: B4, B13
- Phase: C | Phase review: covered by Phase C (plus visual)
- Files:
  - CREATE `$WT/libs/frontend/chat/src/lib/settings/ptah-ai/host-routing-setting.component.ts`
  - CREATE `$WT/libs/frontend/chat/src/lib/settings/ptah-ai/host-routing-setting.component.spec.ts`
  - MODIFY `$WT/libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`
  - MODIFY `$WT/libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts`

### Task 20.1: `HostRoutingSettingComponent` (`ptah-host-routing-setting`) — COMPLETE

- Plan reference: implementation-plan.md:1100-1163 (Component 19)
- Pattern to follow: `copilot-auto-approve-toggle.component.ts:31-126`; `decision-model-row.component.ts:440`; `settings-save-feedback.service.ts:44-51,157`
- Quality requirements: `effective = modelConfigured && stored !== false`. Model unset → disabled with the note and no write. Read failure → Retry. `aria-label` = visible label, note linked by `aria-describedby`.

### Task 20.2: Mount after `<ptah-lane-guards-settings />` under `@if (isElectron)` — COMPLETE

- Implementation details: `isElectron = inject(VSCodeService).isElectron === true`. The spec covers both branches.

### Batch 20 verification

- Acceptance: Req 4 (user-facing Electron setting)
- `npm run verify -- -p @ptah-extension/chat`
- Visual evidence (UI change, no new surface): visual-reviewer before shots from base `1d2fbd4b5` (taken in Wave 1) and after shots from this batch, Electron only, Context Management tab, dark + light, decision model set and unset

### Batch 20 result

- Commit e008c1d3c, `feat(chat)`. It stages only the 4 B20 files; B7, B14 and the task folder stay unstaged.
- Verified on disk:
  - Standalone, OnPush, `inject()`, signals and `computed`. Self-contained, with no inputs or outputs, like the copilot toggle.
  - No `@Input`, constructor injection or `[innerHTML]`. The host is reached only through `ClaudeRpcService`.
  - No stored value reads as `true`. With no decision model the toggle is natively disabled, shows the note and writes nothing.
  - A failed read shows Retry. A save goes through `saveGeneric` with Undo and a `settings:get` re-read.
  - It mounts under `@if (isElectron)` after Lane guards. There is no `â€` mojibake.
- `npm run verify -- -p @ptah-extension/chat`: 3/3 succeeded, cached on the current inputs.
- `npm run verify -- -t typecheck -p ptah-extension-webview`: passed.
- Visual evidence (before/after, dark + light, model set and unset) is not part of this commit. The orchestrator runs it with the visual-reviewer in the Phase C review. The navigation path is in batch-20-report.md:114-120.
- Phase C (B12 3d87596ac and B20 e008c1d3c) is now committed in full. Phase C review requested: code-logic from a non-Claude lane, plus visual-reviewer. No new public API, so no style review.

#### Fix round (Phase C F1)

- Commit 46a3d5873, `fix(chat): batch 20 - trust the read-back in routing toggle`. It stages only `host-routing-setting.component.ts` and its spec; the B8 files and the task folder stay unstaged.
- Fix: "Saved" only when the `settings:get` read-back equals the requested value and `settings:set` did not refuse. A failed read-back is unconfirmed. A mismatch or refusal is a failure without Undo. Undo follows the same rules.
- `npm run verify -- -p @ptah-extension/chat`: lint, test, typecheck 3/3 succeeded, exit 0, re-run by team-leader before commit (cached on the current inputs). No `â€` mojibake.
- Review: code-logic-review-b20-fix.md (codex, a different family from the implementer). Round 1 REVISE 7/10, two findings fixed; round 2 APPROVED 10/10. decisions.md row 22.

## Batch 21: Electron composition root + DI guards — COMPLETE (6a7429833)

- Recommended executor: CLI lane (TypeScript implementation)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: Phase B rule
- Rationale: bounded wiring of tokens named in the plan
- Tasks: 3 | Depends on: B1-B19
- Phase: B (last) | Phase review: Phase B code-logic + style due after this commit
- Files:
  - MODIFY `$WT/apps/ptah-electron/src/di/phase-2-libraries.ts`
  - MODIFY `$WT/apps/ptah-electron/src/di/phase-4-handlers.ts`
  - MODIFY `$WT/apps/ptah-electron/src/di/expected-resolvable.ts`

### Task 21.1: Classifier alias (`LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` → lane-routing classifier), `observeSubagentEnded`, `registerHostRouting` — COMPLETE

- Plan reference: implementation-plan.md:1074-1099 (Component 18)

### Task 21.2: `expected-resolvable.ts` adds `CHAT_TOKENS.HOST_ROUTING_COORDINATOR`, `LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING`, `LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER`, `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER`, `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE` — COMPLETE

### Task 21.3: Confirm VS Code/CLI guards need no change — COMPLETE

- Run the host tests below. If a VS Code or CLI guard must change, do not edit it: report it, and the team-leader adds conditional B22 (D-TL-3, R9).

### Batch 21 verification

- Acceptance: Req 1-7 composed in Electron
- `npm run verify -- -p ptah-electron` (container smoke, rpc-surface, surface-composition)
- `npm run verify -- -t typecheck,test -p ptah-extension-vscode,ptah-cli`
- `npm run verify -- -t lint -p degradation-audit`
- Live checks in Electron after commit (plan:1373-1381): exit-0 429 with a pre-existing deliverable → `failed`/`usage-limit`. Stale deliverable → `no-deliverable`. Toggle off mid-turn → no reminder next turn. A Ptah-session subagent stop writes a row and a later report returns `applied`. A review lane finishing before its implementer lands its verdict. The reminder appears after a settled engineering request. A vague request gets one nudge. Toggle off → zero decision-model requests.
- Result (team-leader, 2026-10-31): commit 6a7429833, 4 files by explicit path (incl. the accepted
  `container.smoke.spec.ts` fixture/assertion update). `npm run verify -- -p ptah-electron` 9/9
  succeeded (9/9 cache hits on the executor's final run), exit 0; vscode + cli typecheck,test
  44/44 succeeded (42 cached), exit 0; degradation-audit lint 1/1, exit 0; prettier --check clean
  on the 4 files. R9 did not fire (no VS Code/CLI edits; both hosts pass), so no B22. The live
  Electron checks above (plan:1373-1381) are not run yet: they belong to Mode 3 / QA.
  For the Phase B review: `phase-4-handlers.ts` resolves the coordinator inside the `will-quit`
  handler, so a never-resolved coordinator is constructed at quit only to be disposed.

### Next action: orchestrator runs Wave 1 (B1, B5, B10a as three CLI lanes, plus visual-reviewer "before" screenshots from base 1d2fbd4b5), using the batch executor prompt with each batch's Recommended executor and Execution mode, then re-invokes team-leader in Mode 2 per returned batch.
