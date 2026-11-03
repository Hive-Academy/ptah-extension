# Code Style Review - Phase A (B1-B11), TASK_2026_857_f660

Scope: `git diff 7392023df^..4257a17ec` (111 files). Read in full: shared types, lane-outcomes barrel, `di/{tokens,register,start}.ts`, `task-kind-mapping.ts`, `review-verdict.parser.ts`, migration 0064 + index, lane-routing `task-kind/` classifier and its DI, the recorder header and pipeline diff, the notifier / process-manager / tracked-agent diffs. Added non-spec lines were grepped for `as any`, `@ts-ignore`, `as unknown as`, `eslint-disable`, `: any` and deep `/src/` imports: zero hits. Diagnostics and lint were not run (read-only brief).

## Verdict

REVISE, 7/10. Boundaries, DI shape, type precision and the migration are sound. Two Serious items (unformatted code in the notifier, and review-capture I/O logic sitting in an already 768-line service with duplicated limits) and a handful of Moderate/Minor ones need a pass. No Blocking items.

## Findings

1. **Serious - review-capture file I/O and limits live inline in `LaneCompletionNotifier`.**
   `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:702-731` (`captureReview`) adds a 30-line path-containment + size-capped reader to a service whose job is signalling. The cap `64 * 1024` (line 720) and `.slice(0, 3)` duplicate `REVIEW_DELIVERABLE_MAX_CHARS = 3 * 64 * 1024` in `libs/backend/lane-outcomes/src/lib/review-verdict.parser.ts`, which is not exported. The two limits can drift silently, and the parser's doc says "the host reads at most 3 files of 64 KiB", so the contract is stated in prose in one place and hard-coded in another.
   Fix: extract `readReviewDeliverables(info, fileSystem)` into a sibling file (e.g. `cli-agents/review-deliverable.reader.ts`) that returns `{ text } | { refusal }`; export `REVIEW_DELIVERABLE_MAX_FILES` / `REVIEW_DELIVERABLE_MAX_FILE_BYTES` from lane-outcomes (or the shared lib) and use them in both places. Also check whether `resolveDeliverablePath`'s existing containment can be reused instead of the hand-rolled `isAbsolute || win32.isAbsolute || /^[A-Za-z]:/ || '..'` chain at lines 713-716. `queueReviewCapture` (lines ~365-372) with its `taskKind === 'review' || taskKindForRole(...) === 'review'` predicate should call a single named predicate, because the same rule is also encoded in `resolveTaskKind` in the recorder.

2. **Serious - new code is not in repo format.**
   `lane-completion-notifier.service.ts` (the `captureReview` block, the `allFresh` expression in `verdictOf`, lines ~365 and ~713-731), `libs/backend/lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.ts` (`questions: [{` literal, the long `answer.cause !== null || ...` condition), `lane-routing/src/lib/di/register.ts` (`c.resolve<DecisionModelConfig>(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG)` on one line), `libs/shared/src/lib/types/lane-outcome.types.ts` (`classify(input: ...): Promise<OutcomeTaskKind | null>;` over 80 columns). Formatting is owned by the repo tooling, so this is reported only because it makes the diff noisy and suggests lint-staged was bypassed or not run on these files.
   Fix: run `prettier --write` on the listed files (scoped), commit as a style fixup.

3. **Moderate - barrel surface wider than the consumers need.**
   `libs/backend/lane-outcomes/src/index.ts:50-59`. `parseReviewDeliverable` has no consumer outside lane-outcomes (only the recorder and its spec import it). `LaneCompletionTransient` has no consumer outside the lib either. `taskKindForRole` (used by the notifier), `reportedSubagentStopRow` and `deterministicReviewReportId` (used by `outcome-report.tool.ts:196,203`) are real.
   Fix: drop `parseReviewDeliverable` and `LaneCompletionTransient` from the barrel until a second lib needs them. If B12+ will consume them, leave and note it in decisions.

4. **Moderate - `reportedSubagentStopRow` is a row factory exported from the recorder service file.**
   `lane-outcome-recorder.service.ts:~104` (function) and barrel line 50. The consumer imports a service file's helper to build a persistence row, and the recorder file (475 lines) also holds `resolveTaskKind`, `rememberBounded`, `errorCode`. It is the base of every subagent producer row.
   Fix: move `reportedSubagentStopRow`, `resolveTaskKind` and `rememberBounded` to `lib/lane-outcome-rows.ts` (kebab, role suffix) or `task-kind-mapping.ts` for the resolver; keep the service to orchestration. Not blocking at 475 lines, but this is the next place to split when B12+ add to it.

5. **Moderate - `observeSubagentEnded` option is a bag of one boolean threaded through two start functions.**
   `libs/backend/lane-outcomes/src/lib/di/start.ts:64,185` (`options: { observeSubagentEnded?: boolean }` duplicated inline on `startLaneOutcomes` and `startAndRegisterLaneOutcomes`). It makes the DI start helper host-aware: hosts differ on whether the same event is already observed (decision per batches 21.1). It is a legitimate composition-root toggle and the `container.resolve` usage is fine because `start.ts` is the lib's own start helper (it already resolved the registries before this change), but the inline type is declared twice.
   Fix: `export interface StartLaneOutcomesOptions { readonly observeSubagentEnded?: boolean }` once in `start.ts`. Note that nothing sets the flag yet (batches 21.1 PENDING), so the branch at `start.ts:111-121` is dead until Phase B; record that in Decisions.

6. **Moderate - magic numbers and lone constants in the process manager.**
   `agent-process-manager.service.ts` `matchLaneRateLimit` / `turnErrorTexts` (~2858-2895) re-implement the "newest N error segments, each sliced to M chars, reversed" logic that `laneFailureTexts` (next method) already has with the same constants, differing only by the `turnSegmentStart` slice. Two near-identical bounded-text builders in a 3246-line file is duplication with drift risk.
   Fix: give `laneFailureTexts` an optional `fromSegment = 0` parameter and have `turnErrorTexts` disappear; or move both into `limits/lane-failure-texts.ts` next to `lane-rate-limit-classifier.ts` and keep only a one-line call in the manager. Growth in this file is +49 lines and sits behind the existing `limits/` classifier facade, which is the right place; just do not add a third builder.

7. **Minor - new token JSDoc says "supplied by the host" but the lib has a lib-owned classifier.**
   `lane-outcomes/src/lib/di/tokens.ts:12` and `lane-routing/src/lib/di/tokens.ts:34`. Mirrors the existing `FAILURE_CLASSIFIER` wording, so consistent; the alias registration is Phase B (21.1). No change needed beyond making sure the three composition roots (electron, vscode, `cli-engine/lane-outcomes-wiring.ts`) all get the alias, as they do for `FAILURE_CLASSIFIER` (`apps/ptah-electron/src/di/phase-2-libraries.ts:295`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:153`, `libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts:18`). Track `cli-engine` explicitly: the batches list names only apps.

8. **Minor - repo comment density.**
   New JSDoc blocks in `task-kind-mapping.ts`, `review-verdict.parser.ts`, `tracked-agent.ts` explain the why and cite requirements; acceptable and consistent with siblings. The `degradation-audit:` comments follow the existing convention.

9. **Minor - migration 0064 conventions (B1).**
   `0064_lane_outcome_task_kind_source.ts` is a bare `ALTER TABLE ... ADD COLUMN`, no CHECK constraint, nullable, static SQL, header explains NULL for history, registered at `migrations/index.ts` as version 64 with matching `name`. This matches 0055/0060-0063. The header lacks the `(TASK_2026_857)` marker 0063 uses; add it. The 20+ older migration specs touched (0028-0063) only bump a version/count assertion, which is the established pattern, but it shows each new migration costs ~20 spec edits; leave.

## Decisions

- Boundary compliance: PASS. `lane-routing` imports only from `@ptah-extension/shared` and its own lib for the classifier; `lane-outcomes` consumes `LaneTaskKindClassifier` from `@ptah-extension/shared` and resolves it via its own token, so there is no lane-outcomes -> lane-routing edge. `cli-agent-runtime` -> `lane-outcomes` already existed (type import); `taskKindForRole` makes it a value import but adds no Nx edge. No `eslint-disable`, no deep imports.
- The shared port is correctly an interface in `libs/shared/src/lib/types/lane-outcome.types.ts`, adjacent to `LaneFailureClassifier`, with the privacy comment amended to scope the transient `brief`. Naming (`LaneTaskKindClassifier`, `OUTCOME_TASK_KIND_SOURCES` const array + derived union) matches the file's existing style.
- DI: `Symbol.for` tokens in `di/tokens.ts`, factories in `di/register.ts` using `instanceCachingFactory`, optional resolution gated by `isRegistered`. Consistent with `FAILURE_CLASSIFIER`. `start.ts` using `container.resolve` is accepted: it is the library's own start helper called by composition roots, and pre-dated this phase.
- Growth of `agent-process-manager.service.ts` (+49) and `lane-completion-notifier.service.ts` (+74) is acceptable only if finding 1 and 6 are applied; `outcome-write-pipeline.ts` (771 lines) net-simplified its insert path (one `insertStopWithHeldReports` path, `holdable` predicate) and needs no split now, but it is the largest lane-outcomes file and should be split by hold/expiry responsibility if B12+ add more.
- Type precision: no `any`, no unsafe casts in added production lines; catch uses `unknown` with `errorCode`/`loggableErrorName`; Zod stays at the write edge (`LaneOutcomeRowSchema`, `lane-outcome.schema.ts` +3).
- Recommendation: fix findings 1 and 2 (and ideally 3, 5, 6) in a single fixup commit before Phase B proceeds.
