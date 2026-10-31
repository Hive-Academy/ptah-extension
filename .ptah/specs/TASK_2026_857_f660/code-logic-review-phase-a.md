# Code Logic Review, Phase A: TASK_2026_857_f660

Reviewer: Claude subagent (code-logic-reviewer). Scope: commits B1..B11 at HEAD (4257a17ec), read file by file.
I did not run `npm run verify`. I relied on the team-leader's recorded cache-hit results.

## Verdict

REVISE, 6/10.

Failed, crashed and rate-limited lane runs now write rows, and a stale deliverable no longer counts as `delivered`. The kind-resolution order, the one insert path and the durable early-review hold are sound. Req 7, host review capture, has gaps that make it close to non-functional for real lane prompts (F1 to F3). The "classify at most once" guarantee leaks on a repeated `subagentEnded` (F4). I score 6/10 because the foundation is solid and the defects sit in two bounded areas that are cheap to fix.

## Findings

### Serious

**F1. Review capture refuses absolute deliverable paths and aborts the whole capture. Serious.**

- Location: `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:714-718` (also `:719-724`, `:727-732`).
- The escape check rejects any `isAbsolute(entry) || win32.isAbsolute(entry) || /^[A-Za-z]:/` entry. `resolveDeliverablePath` (`:142`) explicitly supports absolute entries, and lane prompts normally pass absolute paths.
- Scenario: a review lane declares `D:/.../code-logic-review.md`. Capture warns "outside lane directory" and `return`s. No verdict is ever recorded.
- The same loop aborts all capture on the first oversize file (`:720`). A first-file `stat` that throws ENOENT (declared but never written) is caught by the outer `catch` (`:727`), so a missing or oversize second file discards a valid first one.
- Fix: drop the three `isAbsolute*`/drive checks from the condition. Keep only the containment test on the resolved path (`rel === '..' || rel.startsWith('..'+sep) || isAbsolute(rel)`, where `isAbsolute(rel)` catches the cross-drive case). Use `continue`, not `return`, for out-of-root, oversize, missing and stale files. Join only what was read. Compare against `realpath` of the root if the file system provider exposes it (see F9).

**F2. Review capture has no freshness or verdict gate. Serious.**

- Location: `lane-completion-notifier.service.ts:365-372` and `:702-726`.
- `queueReviewCapture` runs on every terminal path. It ignores `signal.verdict`, `signal.deliverables[].writtenAfterSpawn` and `rateLimited`.
- Scenario A: a review lane crashes or hits a 429 and writes nothing. A review file from an earlier reviewer already sits at the declared path. It is parsed and attached under the new reviewer id, the dedupe key differs per reviewer run, and `reviseRounds` is incremented again.
- Scenario B: a continuation-capable lane ends twice. `key` is `${agentId}:${completedAt}`, so each ending is a new reviewer run id over the same unchanged file, which is a second `revise`.
- This contradicts the row's own `no-deliverable` verdict.
- Fix: pass `signal.deliverables` into `captureReview`. Read only entries with `exists && bytes > 0 && writtenAfterSpawn !== false`. Skip capture when `signal.verdict` is `failed` or `no-deliverable`. This also covers scenario B in practice, since a continuation that did not rewrite the file is stale by the same rule.

**F3. The `Reviewed-Run` target cannot be produced by any current actor. Serious.**

- Location: `libs/backend/lane-outcomes/src/lib/review-verdict.parser.ts:36-41`, `lane-outcome-recorder.service.ts:330-347`.
- A lane row's runId is `${agentId}:${completedAt}` (`lane-completion-notifier.service.ts:348`). It is not printed in the completion envelope and not known when the orchestrator briefs the reviewer. The parser's own docs example, `lane:abc123`, matches no real id.
- Prompt changes are out of scope (D-10), and a grep of libs, apps and md files finds no producer that instructs `Reviewed-Run:` outside specs.
- Net: even after F1 and F2, capture records `no-target` or holds a review under a runId that never exists, and the hold ends in the rejected ledger 24 h later.
- Fix (no prompt change needed): let `Reviewed-Run` also accept a bare agentId, the value the orchestrator does have. In `captureReview`, resolve a non-matching target via `store.get('subagent:'+id)` then `store.findLatestByAgent(id)`, the same logic as `outcome-report.tool.ts:109-127`. Use the resolved runId in `attachReview`.

**F4. A repeated `subagentEnded` classifies the same run twice. Serious.**

- Location: `lane-outcome-recorder.service.ts:379-385` and `:397-411`, `:457-460`.
- `stashBrief` runs before the `subagentRuns.has` check. The first `classifyTaskKind` deletes the brief before the async call.
- A second `subagentEnded` re-stashes (the map no longer has the key) and calls `enrichSubagentRun`. After `flush`, `store.get` still reports `unclassified` (call in flight, or classifier returned null). It calls `classifyTaskKind`, which sends a second decision-model request.
- The store guard (`setClassifiedTaskKind ... AND task_kind IS NULL`) keeps the data safe. The cost and the "exactly once" guarantee are not. The B7 note describes this.
- Fix: keep a bounded `Set<string>` (use `rememberBounded`) of run ids for which classification was attempted. Check it in `classifyTaskKind` and in `stashBrief`.

### Moderate

**F5. A later producer never fills `role` or the mapped kind. Moderate.**

- Location: `lane-outcome-recorder.service.ts:397-419`, `sqlite-lane-outcome.store.ts:303-336`.
- `fillMissingSubagentJoin` only fills the three join columns. If `SubagentStop` wins with `agentType === null` and `subagentEnded` carries `backend-developer`, the row stays `unclassified` with `role` null for good.
- It then costs an LLM classification on a brief that is the subagent's result text.
- Fix: in `enrichSubagentRun`, when the stored `taskKindSource` is `unclassified` and the new row is `mapped`, call a guarded store method that sets `role`, `taskKind` and `source='mapped'`. The guard is `WHERE task_kind IS NULL`.

**F6. Task-kind classification is unbounded and its input for subagents is the result, not the task. Moderate.**

- Location: `lane-outcome-recorder.service.ts:246`, `:457-473`.
- `general-purpose` and `Explore` subagents are unmapped and frequent. Each ending fires its own decision-model request, with no concurrency cap. A burst of N parallel subagents means N requests.
- The brief sent is `lastAssistantMessage` (up to 4000 chars), which can include private output, to a possibly remote decision model (`ollama-cloud`, `custom`).
- Fix: cap in-flight classifications at 2, or drop when the cap is hit (the row stays unclassified, which is documented). Say in the decision log that the subagent brief is the result text.

**F7. Closed-store review refusal, judged (B8 D-B8-1). Moderate, defer.**

- Location: `outcome-write-pipeline.ts:187-195`.
- Rule: a review is admitted while the store is closed only if the journal index or a pending report covers the run. Otherwise it is refused with a retry hint.
- It is consistent with plan :410-413. The store is open for essentially the whole session, so the window is short.
- Neither the host path (`captureReview` logs "not applied" and drops) nor the tool retries. A host-captured verdict in that window is lost.
- Accept, with one change: have `captureReview` retry once on the `onDidOpen` signal, or admit a review while closed. The only cost of admitting is a bogus "held" ack for a typo'd run id, which expires to the ledger.
- Same-family note: the refusal logic is Claude-authored (B8).

**F8. Exit-0 429 detection depends on the CLI putting the text in an `error` segment. Moderate.**

- Location: `agent-process-manager.service.ts:2865-2873`, `limits/lane-rate-limit-classifier.ts:23-30`.
- For `code === 0` only the current turn's `error` segments are read. This is deliberate, so a lane summary that mentions 429 is not misread.
- If the CLI prints the 429 to stdout (the decision 10 evidence is a signal, not a captured stream), the match fails open. A stale pre-existing deliverable then still ends as `no-deliverable`/`bad-output`, not `failed`/`usage-limit`, but only if the deliverable is stale. A fresh one is `delivered` by design.
- Evidence gap: I found no spec using a captured real exit-0 stream.
- Fix: add a fixture from the actual 80ddc78e output. If the text sits in stdout, also match the last ~2 KB of stdout, anchored to a line start.

**F9. Review capture follows symlinks. Moderate/Minor.**

- Location: `lane-completion-notifier.service.ts:713` uses a lexical `relative`.
- A symlink inside the worktree that points outside is read, and 64 KiB is handed to the parser. Only identifiers and a verdict leave the parser, so the leak is nil. It is still an unvalidated read.
- Fix: realpath check, as in F1.

**F10. Heldruns index can be overwritten with a stale copy. Moderate.**

- Location: `outcome-write-pipeline.ts:469-485` (final acknowledge), `:497-519` (`expireHolds` updates `heldRuns` mid-drain via `applyReport`).
- `start` is snapshotted before the loop. If `applyReport` calls `expireHolds` mid-loop, the journal's `heldRuns` is rewritten. The final `journal.update` then writes `next.heldRuns`, derived from the older snapshot, and re-adds the expired expiries.
- Effect: the closed-store admission check can see a hold that the store has dropped. `prune` by time bounds it, so it self-heals.
- Fix: in the final update merge into `current.heldRuns`, or reread `snapshot()` after the loop.

**F11. Expired-hold ledger entry is lazy. Moderate.**

- Location: `outcome-write-pipeline.ts:393-395` (`lastSweep`), drain trigger.
- Expiry is swept only when something drains (new op, store open). An idle session leaves an expired hold unreported past 24 h. Insertion correctly ignores expired reports (`expires_at > nowMs`), so there is no wrong join.
- Fix: one unref'd interval timer, or accept and document.

**F12. `ptah_outcome_report`: no self-review guard, and two paths can double-count. Moderate/Minor.**

- Location: `outcome-report.tool.ts:194-198`.
- `reviewerRunId === runId` is not refused (the parser refuses it, the tool does not).
- If the host capture and the reviewer's own tool call both report, the ids differ (`agentId:completedAt` vs the run tag), so `revise` can count twice.
- Fix: refuse equal ids. Document that the tool path is the fallback when host capture is unavailable.

**F13. `void this.laneCompletion.signal(...)` is unobserved. Moderate/Minor.**

- Location: `agent-process-manager.service.ts:3033`.
- `signal()` awaits `buildSignal` before `enqueueLaneCompletionOutcome`. `checkOne` swallows read errors, so it is unlikely to throw. A rejection would drop the row silently as an unhandled rejection.
- Fix: `.catch` with a coded warn. Optionally enqueue the outcome before awaiting the delivery steps (already the case after `buildSignal`).

### Minor

- F14. `rateLimited` and `allFresh` with an unparsable `startedAt`: `writtenAfterSpawn` is omitted (`:128`), so a stale file passes as fresh. Edge only. Add a log line.
- F15. The external `ptah_outcome_report` path enqueues an `unverified` subagent row before `submit` (`outcome-report.tool.ts:200-204`). If `submit` refuses, the row stays. This is plan-allowed and harmless (unverified rows should not count as signal). Confirm the capability matrix excludes `unverified`; I did not trace it.
- F16. `fillMissingSubagentJoin` is called in `apply` for every non-inserting subagent stop (`outcome-write-pipeline.ts:~620`). That is one extra UPDATE per duplicate. Fine.
- F17. `reviewerRunId` uniqueness: the parser compares to the reviewer's own id only, not to the `agentId` form. Covered by F3's resolution step.

## Answers to the focus questions

1. **Lane outcomes.** Yes. Every terminal path calls `signalLaneCompletion`, and the notifier dedupes per ending. `verdictOf` (`:686-700`) makes a stale or empty deliverable `no-deliverable`. Exit 0 with a matched 429 and a non-fresh deliverable gives `failed`, then `usage-limit` through `classifyLaneFailureClass` (`:23`). `failureKind` stays undefined and `recordLaneLimits` gets `limit === null`, so nothing reaches the limit ledger (`agent-process-manager.service.ts:2752-2777`). Residual risk: F8. A fresh deliverable plus a 429 is `delivered` on purpose.
2. **Resolution order.** Explicit, mapped, classified after insert (`setClassifiedTaskKind`, source `classified`), then unclassified (`recorder:67-75`, `:457-473`). The classifier is optional at every use. A double `subagentEnded` classifies twice (F4).
3. **Subagent exactly-once.** The recorder's in-memory first-writer map and the store's insert-if-absent give one row in either order. The insert callback fires only when `inserted` is true (`pipeline:~626`, `notifyInserted`), and a replay after a crash does not re-fire it. Eviction (200) re-enqueues and is absorbed by insert-if-absent. A later producer does not fill role or kind (F5).
4. **Early reviews.** They are held durably (journal index plus table), joined inside the insert transaction (`sqlite store:196-217`), expired to the ledger (`:393-415`, receipt dedupe `ledger`), and replay-safe through `report_receipts` and `deterministicReviewReportId`. In-memory and KV stores mirror the logic. Gaps: F7, F10, F11.
5. **Review capture.** It is not working for real prompts. See F1 to F3, F9. Severities and fixes are above.
6. **Privacy.** Rows, journal and logs carry ids and codes only (`Review capture refused` logs the refusal code). `brief` stays transient. Swallows carry `degradation-audit: reported` (`recorder:461`, `notifier:728`, `pipeline:244,277`, classifier `:60`). Existing path logging (`Could not read a declared deliverable`) is pre-existing. The brief goes to the decision model (F6).
7. **Silent failures, races, stubs.** No stubs or TODOs in the reviewed files. Silent paths: F1, F2, F13. Races: F4, F10.

## Minor-notes disposition

| Batch | Note                                                                              | Decision     | Reason                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B7    | Repeated `subagentEnded` after a null classification classifies again             | fix-now (F4) | Violates the focus-2 rule; a short set guard.                                                                                                                       |
| B7    | Brief stashed for a duplicate lane completion lingers until eviction (200)        | defer        | Bounded and in-memory; no row or log impact.                                                                                                                        |
| B8    | Early review while the store is closed and unindexed is refused with a retry hint | defer        | Judged under F7: acceptable. Add a one-shot retry in `captureReview` in the fix round if cheap.                                                                     |
| B8    | `store.hasHeldDeliverables` is unused by the pipeline                             | defer        | Dead port method; separate cleanup.                                                                                                                                 |
| B8    | `backlog.spec.ts:26-30` BusyStore override is inert                               | defer        | Test hygiene only.                                                                                                                                                  |
| B8    | `pendingHolds` counts holdable pending reports only                               | defer        | A narrowing of plan :416 with the same cap effect.                                                                                                                  |
| B9    | Untargeted-message case asserts only that the target stays `approved`             | defer        | Test-strength nit.                                                                                                                                                  |
| B9    | Review case flushes once after the second emit                                    | defer        | Test-only.                                                                                                                                                          |
| B9    | SDK logger cast in the fixture                                                    | defer        | Test-only.                                                                                                                                                          |
| B10b  | Capture reads declared review files with no freshness or verdict gate             | fix-now (F2) | Wrong data in a row, `reviseRounds` double-counted.                                                                                                                 |
| B10b  | Absolute deliverable paths are refused by the copied escape rule                  | fix-now (F1) | Disables Req 7 for the normal prompt shape.                                                                                                                         |
| B10b  | One oversize or escaping file aborts the whole capture                            | fix-now (F1) | Same loop; use `continue`.                                                                                                                                          |
| B10b  | `recorderUnavailableWarned` is module-level                                       | defer        | Debug-line ordering only.                                                                                                                                           |
| B10c  | `tracked.authMatched` is not reset in `continueConversation`                      | fix-now      | One line next to `rateLimitMatched = undefined` (`agent-process-manager.service.ts:2211`). A stale auth match mislabels a continuation's stop or timeout as `auth`. |
| B10c  | `laneFailureTexts` reads error segments from all turns                            | defer        | Quota and auth wording behaviour pre-dates this task; reading only the current turn needs its own tests. Track for Phase C.                                         |
| B11   | The external-caller path enqueues the stop row before `submit`                    | defer        | Confirmed intended by the plan ordering; the row is `unverified` (F15).                                                                                             |

## Review family

| Batch               | Implementer family                                                  | Reviewer family                                                                                              |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| B1                  | codex lane (decisions row 12)                                       | Claude (cross-family)                                                                                        |
| B2, B3, B4, B9, B11 | CLI lanes per batches.md (executor not individually verified by me) | Claude                                                                                                       |
| B5                  | antigravity lane                                                    | Claude (cross-family)                                                                                        |
| B6                  | codex lane e87b387a                                                 | Claude (cross-family)                                                                                        |
| B7                  | Claude subagent                                                     | Claude subagent (SAME FAMILY; findings F4, F5, F6 are same-family evidence; the Glm lane gives cross-family) |
| B8                  | Claude subagent                                                     | Claude subagent (SAME FAMILY; F7, F10, F11 same-family)                                                      |
| B10a                | Glm lane                                                            | Claude (cross-family)                                                                                        |
| B10b                | codex CLI lane                                                      | Claude (cross-family)                                                                                        |
| B10c                | Claude subagent                                                     | Claude subagent (SAME FAMILY; F8 and the B10c disposition rows)                                              |

## Decisions

1. **REVISE, not APPROVED.** The host review capture (Req 7) fails on the normal path (F1 to F3) and a "must not" rule in focus 2 is not enforced (F4). Evidence: the code lines cited above. Reversible: yes.
2. **Fix-before-push set:** F1, F2, F3, F4, the B10c `authMatched` reset. Everything else is deferred to a named follow-up or noted. Options: fix all now (more churn), or fix none (leaves Req 7 inert). Chosen: the minimal set that makes Req 7 and the dedupe rule true.
3. **Closed-store refusal (D-B8-1) is accepted** as a Moderate with a recommended retry, not a Blocking issue. The store is closed only briefly. A refusal carries a hint. Reversible: yes.
4. **No Blocking finding.** There is no data loss or corruption on any traced path. Failures degrade to a missing evidence row or a duplicated `reviseRounds`.
