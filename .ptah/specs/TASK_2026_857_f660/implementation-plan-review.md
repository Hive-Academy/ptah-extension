# Implementation Plan Review — Gate 2

- **Author:** subagent `software-architect`
- **Reviewer:** kimi code lane
- **Revision reviewed:** r1
- **Verdict:** REVISE
- **Findings:** 2 Blocking, 4 Serious, 2 Moderate
- **Checks run:** none. This was a document and source review. The task forbade builds and wide checks.

## Coverage

| Requirement                       | Components and batches         | Result                                                                                                                          |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Terminal lane outcomes         | C6 and C10; B6 and B9          | Covered. The plan keeps the existing terminal paths and adds recorder diagnostics and integration cases.                        |
| 2. Task-kind provenance           | C1–C4, C6, C8; B1–B6           | Partial. The four sources and post-insert classification are present. F8 identifies a required-type and batch-verification gap. |
| 3. Subagent stops                 | C4–C7, C9, C11; B3–B10         | Covered. Both producers use one run ID. The later producer enriches null join fields.                                           |
| 4. Per-turn scope assessment      | C13, C16–C18; B12, B15b–B18    | Partial. The typed decision and model gates exist. F4 and F5 identify context and settings gaps.                                |
| 5. Agreed-scope routing           | C15 and C16; B15–B17           | Not covered as specified. F2 makes repeated nudges possible. F3 permits duplicate pre-flight calls.                             |
| 6. Plan gate and pre-flight reuse | C13, C14, C16; B12–B14, B16    | Partial. `gate-0.1` remains unchanged. F6 permits stale cache reuse.                                                            |
| 7. Host review verdicts           | C3, C6, C7, C9–C11; B2, B6–B10 | Not covered as specified. F1 rejects an early review for a lane target.                                                         |
| 8. Prior blending                 | C12; B11                       | Covered. The formula, constants, schema minimum, reasons minimum, and test table agree with the requirements.                   |

## Citation spot-checks

| #   | Plan claim                                                               | Result                                                        | Evidence                                                                                                                                        |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `UserPromptSubmit` returns main-thread `additionalContext`.              | Confirmed.                                                    | `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts:87-103` gates subagents and returns `additionalContext`.             |
| 2   | Chat admission can follow `launchSdkSession` and `sendMessageToSession`. | Confirmed.                                                    | `chat-session.service.ts:697-714` and `chat-session.service.ts:1189-1195`. Both sites can start background work without a new await.            |
| 3   | Held-report logic needs a change for review-before-row.                  | Confirmed, but the proposed scope is wrong.                   | `outcome-write-pipeline.ts:281-332` and `:654-669` reject missing lane targets. F1 explains the requirement conflict.                           |
| 4   | The first stop producer requires transcript and session metadata.        | Confirmed.                                                    | `subagent-hook-handler.ts:508-559` skips fan-out when those values are absent.                                                                  |
| 5   | The second producer needs session ID and cwd, and carries review text.   | Confirmed.                                                    | `subagent-stop-hook-handler.ts:56-72,98-107`.                                                                                                   |
| 6   | Migration 0063 is latest, so 0064 is next.                               | Confirmed in this worktree.                                   | `libs/backend/persistence-sqlite/src/lib/migrations/index.ts:448-452`.                                                                          |
| 7   | `buildRouteCandidateSource` supplies rows, limits, and roles.            | Confirmed. It is private today and needs the proposed export. | `route-namespace.builder.ts:79-99`.                                                                                                             |
| 8   | The new setting fits the file-settings registry.                         | Confirmed for storage only.                                   | `file-settings-keys.ts:98-140,323-355`. The registry does not create a visible settings control. See F5.                                        |
| 9   | The proposed blend fits the existing integer helpers.                    | Confirmed.                                                    | `local-derivation.ts:247-335` defines the current gates and the `roundPercent` and `roundMean` semantics used by C12.                           |
| 10  | Classification already has a post-insert recorder seam.                  | Confirmed.                                                    | `lane-outcome-recorder.service.ts:81-97`. Subagent rows currently bypass that callback in `outcome-write-pipeline.ts:605-639`.                  |
| 11  | A1 needs verification for the key-value store.                           | A1 fails as written, but the contingency is valid.            | `key-value-lane-outcome.store.ts:94-114,158-195` overrides each mutation. The two new methods also need overrides. B3 already allows this file. |
| 12  | All backend libraries have `scope:extension`.                            | Wrong, but no boundary violation follows.                     | `libs/backend/platform-core/project.json:6` has `scope:shared` and `type:util`. The other inspected feature libraries have `scope:extension`.   |
| 13  | The coordinator can use the built-in role set from `phase-plan.ts`.      | Incomplete.                                                   | `phase-plan.ts:37-50` keeps `DEFAULT_ROLE` and `BUILTIN_ROLES` private. The lane-routing barrel does not export them. See F7.                   |

## Findings

### 1. Blocking — Early reviews for lane runs are rejected

**Evidence:** Requirement 7 requires a review to apply when it arrives before the reviewed outcome row (`task-description.md:105-109`). C7 deliberately holds only reviews for missing `subagent:` targets. It rejects missing lane targets (`implementation-plan.md:343-346`). The current code has that rejection at `outcome-write-pipeline.ts:654-661`.

**Impact:** A fast reviewer can finish before the reviewed lane's terminal insert. The host then loses a valid verdict. This is the exact race that Requirement 7 names.

**Required change:** Specify a durable hold for reviews of missing lane and subagent targets. Add a lane-insert join path, not only an admission-rule change. Add integration cases for approved, rejected, and revise reviews before a lane row.

### 2. Blocking — Unrouted continuations receive repeated nudges

**Evidence:** C16 increments `revision` whenever `routedScope` is absent (`implementation-plan.md:639-653`). An unsettled first turn leaves `routedScope` absent. An unchanged continuation therefore increments the revision again and passes the `nudgedRevision` check again. Requirement 5 forbids that repeat (`task-description.md:87-90`). The proposed test at `implementation-plan.md:696-699` contradicts the algorithm.

**Impact:** Every unchanged, unresolved turn can enqueue another nudge. Each turn also invalidates the pre-flight cache.

**Required change:** Separate first-scope initialization from revision changes. Increment a revision only for a new task or a material change. Keep an unresolved revision stable across unchanged continuations. Make the specified no-repeat test exercise the real state machine.

### 3. Serious — One scope revision can start multiple pre-flight calls

**Evidence:** C16 discards stale generations and starts pre-flight whenever `routedRevision !== revision` (`implementation-plan.md:641-650`). It defines no in-flight revision. A second unchanged turn can arrive before the first pre-flight completes. The first result becomes stale, and the second turn starts another call. This violates the one-call budget at `implementation-plan.md:693-695` and `task-description.md:124-125`.

**Impact:** Quick successive turns duplicate model cost. They can also delay the current reminder.

**Required change:** Track an in-flight scope revision. Share one pre-flight promise across unchanged turns. Deliver its result only through the latest generation. Add a test with two turns and a deferred pre-flight promise.

### 4. Serious — Multi-turn scope agreement lacks conversation input

**Evidence:** `ScopeCheckService.assess` receives only the current turn and the last routed scope (`implementation-plan.md:532-547`). Pre-flight also receives only the current turn (`implementation-plan.md:647-650`). No pending scope or recent assistant exchange reaches either decision.

**Impact:** A user can describe scope on one turn and answer “yes, use that approach” on the next. The second request has no evidence of the agreed engineering scope. Routing then depends on self-contained prompts rather than agreed scope.

**Required change:** Define a bounded conversation or pending-scope input for the scope check and pre-flight. Preserve the text limits. Add a multi-turn acceptance test where agreement occurs after an assistant clarification.

### 5. Serious — The disable control is not a user-facing Electron setting

**Evidence:** Requirement 4 names a user-facing setting in Electron settings (`task-description.md:81`). C17 adds only storage keys. D-6 explicitly excludes UI (`implementation-plan.md:715-729,840`). File-based defaults do not create a settings row (`file-settings-keys.ts:79-88`). Existing advanced settings UI consumes the separate `ADVANCED_SETTINGS` table.

**Impact:** A user cannot discover or change the control through Electron settings. A direct settings RPC is not the requested user-facing control.

**Required change:** Add a visible Electron settings toggle backed by `agentOrchestration.hostRouting`. Keep the conditional default and zero-call behavior. Add the corresponding frontend and integration tests, and update the batch plan.

### 6. Serious — Cache reuse survives unknown or disabled scope state

**Evidence:** `PreflightReuseCache.get` checks only session and model fingerprint (`implementation-plan.md:549-555,573-577`). The coordinator does nothing on an unavailable assessment (`implementation-plan.md:643-646`). It also defines no invalidation when routing is disabled. Requirement 6 limits reuse to unchanged agreed scope (`task-description.md:98-99`).

**Impact:** The user can change scope while routing is disabled or a scope answer is malformed. A later skill call can receive the old result without a fresh request.

**Required change:** Invalidate reuse on disable and on any turn whose scope continuity is unknown. Validate the revision on `get`, or prove continuity before every hit. Add disabled, malformed-answer, and scope-change cache tests.

### 7. Moderate — Two specified cross-library calls lack public exports

**Evidence:** C6 calls `taskKindForRole` the mapping module's only consumer (`implementation-plan.md:257-269`). C10 calls it from `cli-agent-runtime` (`implementation-plan.md:424-430`). C9 does not export it (`implementation-plan.md:398-399`). C16 also uses the built-in role set, but `BUILTIN_ROLES` is private at `phase-plan.ts:50` and absent from `libs/backend/lane-routing/src/index.ts:10-71`.

**Impact:** B9 and B16 cannot use the named helpers through the package barrels. Deep imports would bypass the library boundaries.

**Required change:** Export the mapping helper through `lane-outcomes`. Export a supported available-role source through `lane-routing`, or move that filtering behind an existing public service. Include every changed barrel and owner file in the batches.

### 8. Moderate — The required record field breaks the recorder input and early batch checks

**Evidence:** C1 adds required `taskKindSource` to `LaneOutcomeRecord` (`implementation-plan.md:131-135`). `LaneCompletionOutcomeInput` currently omits only four other fields (`lane-outcome-recorder.service.ts:24-29`). It will therefore require the new source from callers. The existing caller has no such field (`lane-completion-outcome.ts:28-63`). Other record literals also lack it in `lane-outcome-reader.service.spec.ts:13` and `agent-signals.spec.ts:4`. The plan does not name these changes. It nevertheless requests host typechecks after B1 (`implementation-plan.md:899-902`).

**Impact:** The recorder API contradicts the provenance resolution design. B1 and subsequent early batches cannot pass the stated compile checks without unstated edits.

**Required change:** Exclude `taskKindSource` from `LaneCompletionOutcomeInput` and set it inside the recorder. Name every record fixture that needs the field. Reorder the affected work or change the verification points so each batch has a compiling contract.

## Failure-mode assessment

- **Two subagent producers:** The single-row design is sound. `insertStopWithHeldReports` inserts the first row. The later operation fills null join fields. The existing duplicate-insert behavior supports this design.
- **Review before the reviewed row:** The subagent case has a proposed hold. The lane case fails under F1.
- **Reminder tab-ID rekey:** The queue design covers both resolution orders. It migrates pending entries and keeps aliases. The proposed tests name both orders.
- **Fail-open model behavior:** Scope, pre-flight, and candidate-list failures produce no routing recommendation. The design logs IDs and codes without prompt text.
- **Non-blocking reply path:** The two admission calls are fire-and-forget. The cited chat methods already return after dispatch at `chat-session.service.ts:697-714,1189-1195`. No new await is proposed.

## Module boundaries and host compatibility

No proposed import creates a library cycle. `rpc-handlers` already imports `vscode-lm-tools`, including `chat-session.service.ts:52`. The inspected Nx tags permit the planned directions. The nullable stop payload has two consumers, and C5 adds the needed `skill-synthesis` guard.

The VS Code key-value store uses the row schema default for old JSON. Its two new mutations need explicit persistence overrides, as B3 anticipates. F8 still leaves shared-contract compilation and batch verification incomplete.

## Blending assessment

C12 preserves the prior weight `k = 10`. Its formulas match the requirement after scaling to the 0–100 matrix range. The existing `roundPercent` and `roundMean` helpers implement the stated rounding. All nine numeric rows are arithmetically correct. The delivery and review denominators remain separate. User cells retain precedence.

## Batch-plan assessment

The listed batches are file-disjoint. Each has at most six files and two libraries. The dependency chains sequence shared files such as DI tokens and barrels. The subagent marks for B6, B7, B16, and B17 are justified by cross-component state and durability rules. F7 and F8 require corrections to exports, file ownership, and early verification points.

## Decisions

| Decision                                                                                   | Options                                                                                      | Evidence                                                                                | Reversible |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| Apply the early-review rule to lane and subagent targets.                                  | Keep the plan's subagent-only hold; apply the unqualified requirement to both. Chosen: both. | `task-description.md:105-109` does not restrict the reviewed run kind.                  | Yes        |
| Treat “user-facing Electron setting” as a visible settings control.                        | Accept a file key and RPC only; require a settings control. Chosen: visible control.         | `task-description.md:81`; the file registry only supplies storage and defaults.         | Yes        |
| Treat an unavailable scope assessment as unknown continuity, not proof of unchanged scope. | Reuse the old result; require fresh validation. Chosen: fresh validation.                    | `task-description.md:80,98-99` requires unresolved answers to avoid unsupported claims. | Yes        |
