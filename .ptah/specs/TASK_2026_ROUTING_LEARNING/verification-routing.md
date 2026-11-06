# Verification — routing and learning claims

Source note: a local maintainer comparison note (not in the repository), section "Routing and learning", items 1–8, plus the "Also worth knowing" paragraph. That note dates its evidence 2026-11-05 and cites abbreviated paths. This check is against the worktree `D:\projects\ptah-extension\.claude-worktrees\lane-control-model` on 2026-11-06. Read-only. No tests were run.

Method: `ptah_search_files` located the files. The symbol index returned `symbolCount: 0`, so literal lookups used Grep after that empty index. Claims below are **verified** by reading the cited lines unless marked **inferred**.

Settings pattern used for every new key below (verified on `agentOrchestration.hostRouting`):

- Declare the key and its default in `libs/backend/platform-core/src/file-settings-keys.ts` (`FILE_BASED_SETTINGS_KEYS`, `FILE_BASED_SETTINGS_DEFAULTS`).
- Allow export in `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`.
- Read with `IWorkspaceProvider.getConfiguration('ptah', key)` as `HostRoutingSetting` does in `libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts:12-30`.
- A key that must refresh a cached routing notice also joins `ROUTING_KEYS` in `libs/backend/platform-core/src/file-settings-manager.ts:49-52` (that set bumps `routingConfigurationGeneration`).
- Electron settings UI mounts under `isElectron` in `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:72-75`, beside `ptah-host-routing-setting`. Writes go through `settings:set`.

## Item 1 — Deterministic mode and visible rotation

Status: confirmed

Evidence:

- The closeness band is 5. `CLOSENESS_BAND = 5` in `libs/backend/lane-routing/src/lib/routing-constants.ts:36`. `spread` keeps every eligible candidate with `top - score <= CLOSENESS_BAND` (`libs/backend/lane-routing/src/lib/ranking/spread.ts:86-87`). `spread.spec.ts:143` pins the constant at 5.
- Inside that pool the pick is the cyclic successor of the last id, not a stable first (`spread.ts:96-98`, `successor` at `122-135`). The cited lines `97-105` then rotate the published ranking so that successor is first.
- The call updates rotation state. `spread` returns `rotation: withPick(...)` (`spread.ts:115`). `planRoutePhases` threads that cursor into the next phase (`libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts:125`, `162-174`). After the gate, `RouteDecideService.persistRotation` writes the **chosen** executor id (model, ranking, or pin) under `` `${phaseId}|${taskKind}` `` (`libs/backend/lane-routing/src/lib/route-decide.service.ts:310-326`). `RotationStore` is global: its header says every workspace shares the cursor (`libs/backend/lane-routing/src/lib/ranking/rotation.store.ts:4-8`). Storage key `laneRouting.rotation.v1` (`routing-constants.ts:85`).
- No setting turns this off. The only routing booleans found are `agentOrchestration.hostRouting` and the decision-model selection. Nothing reads a rotation flag.
- Nothing shows the last pick. The document is `{ version, entries: [{ key, candidateId }] }` (`rotation.store.ts:44-52`). No RPC or settings view reads it. `ptah_route_decide` returns the chosen roster, not the stored cursor.

Fix:

- New boolean `agentOrchestration.laneRotation`, default `true` (current behavior). Register it with the pattern above, including `ROUTING_KEYS`, so a flip refreshes a cached routing notice.
- `SpreadInput` gains `rotate: boolean` (default `true` so existing callers stay unchanged). When `false`, `successor` returns `natural[0]` and `rotationChangedChoice` is false. `natural[0]` is already prefer, then `preferredRank`, then executor kind, then id (`compareTieBreak`, `spread.ts:206-217`). That is "first in `prefer` order" when a prefer list exists, and the existing tie-break when it does not. Do not add a second order.
- Plumb the flag from `RouteDecideService` through `planRoutePhases` into `spread`. Read the setting once per decide call. A missing or non-boolean value stays `true`.
- Keep `persistRotation` as it is, so the stored id is still the last chosen executor. When rotation is off, `successor` ignores that id, so saving it does not change the next ranking pick.
- Show the last pick per key on the Electron orchestration settings page: a read-only RPC `routing:getRotation` that returns `RotationStore`'s entries (`key`, `candidateId` only). Mount it under the same `isElectron` block as host routing. No write from that view.

Tests:

- `libs/backend/lane-routing/src/lib/ranking/spread.spec.ts` — with `rotate: false`, two calls with the same band and a stored last id both pick `natural[0]`; `rotationChangedChoice` is false. With `rotate: true`, the existing 7.1–7.6 cases stay.
- `libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts` — setting false keeps the same ranking pick across two decides; setting true still advances. The persisted entry is the chosen id in both modes.
- `libs/backend/platform-core/src/file-settings-keys.spec.ts` — the new key is file-based and defaults to `true`.
- New handler spec beside `agent-outcome-rpc.handlers.spec.ts` for `routing:getRotation` (entries only, empty document when the store read fails).
- `orchestration-settings.component.spec.ts` — the rotation control and the last-pick list render only when `isElectron` is true.

Risk/Effort: medium / M

The ranking pick changes for every tied band once the setting is off. Effort is the settings, DI read, and the small settings view, not the spread branch.

## Item 2 — Keep the decision model inside the band

Status: confirmed

Evidence:

- `laneQuestion` offers every ranked candidate, rotation pick first (`phase-plan.ts:209-214`, `toOption` at `389-396`). The comment on `LaneQuestion.options` says the fit slices that list (`libs/backend/lane-routing/src/lib/pipeline/model-refine.ts:49`).
- The slice width starts at `OPTIONS_PER_PHASE_CAP` (4) and shrinks only to stay under the byte cap, stopping at 2 (`routing-constants.ts:95-96`, `model-refine.ts:217-253`). It slices the ranking prefix. It does not slice the closeness band.
- The ranking is the rotated in-band pool, then everyone else by score (`spread.ts:102-114`). When the in-band pool has fewer than 4 members, the prefix includes lower-scored candidates from outside the band.
- `resolvePhase` accepts any offered label whose lane id is in `plan.ranked` (`phase-resolve.ts:64-81`). It does not re-check `top - score <= 5`. The model's choice replaces the ranking pick (`source: 'model'`).
- `isSendable` only requires two ranked candidates (`phase-resolve.ts:16-21`). A one-member band plus any lower candidate is still sent to the model.

Fix:

- In `laneQuestion`, pass only candidates inside the closeness band: `top - score <= CLOSENESS_BAND`, using the same top as `spread` (the best score among eligible ranked rows). Export that predicate from `spread.ts` or compute it next to `toOption` so the two cannot drift.
- `fitLane` / `sliceOptions` then cap that shorter list at 4. No new setting.
- `resolvePhase` keeps accepting only an offered id. Filtering the offer is the guard. If the band has fewer than `MIN_OPTIONS_PER_PHASE` (2) members, `isSendable` already falls back to the ranking pick (`phase-resolve.ts:37`). That is the right fallback: do not pad the offer with out-of-band rows to reach 2.
- Do not also restrict by limit class. The band in the claim is the score band. Limit class already decides the rotation pool inside `spread`.

Tests:

- There is no `phase-resolve.spec.ts` or `phase-plan.spec.ts`. Add the cases to `libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts`, which already asserts "accepts only an offered option".
- One phase whose scores are 80, 76, 70: the payload options are the two inside the band (80 and 76). A model answer of the 70 row is `bad-output` and the ranking pick stands.
- A band of one candidate and three others: the lane request is not sent and the resolution source is `ranking`.

Risk/Effort: medium / S

More phases will skip the decision model and keep the ranking pick. That is the intended narrowing. The code change is local to `laneQuestion` and the gate spec.

## Item 3 — Do not score capacity failures as capability

Status: confirmed

Evidence:

- `LaneOutcomeSummary` includes `failureClass` (`libs/shared/src/lib/types/lane-outcome.types.ts:117-132`). The classes are `usage-limit`, `auth`, `crash`, `timeout`, `bad-output` (`lane-outcome.types.ts:34-40`).
- `countSummary` (`libs/backend/lane-routing/src/lib/matrix/local-derivation.ts:173-209`) never reads `failureClass`. Every `verdict: 'failed'` increments `bucket.failed` and is pushed onto `bucket.delivery`.
- The delivery rate is `delivered / (delivered + noDeliverable + failed)` (`local-derivation.ts:29-31`, `276`). A `usage-limit`, `auth`, or `timeout` row with verdict `failed` lowers that rate and therefore the blended score (`scoreBucket`, `294-323`).
- The same function leaves limit state alone. Limit class is a separate input to `spread` (`INSIDE_BAND_LIMIT_ORDER`, `routing-constants.ts:43-47`). Dropping these rows from the quality rate does not remove the at-limit exclusion.
- `local-derivation.spec.ts:100-113` pins "one seeded failure" at score 73 with no `failureClass`. That test uses a capability failure, not a capacity failure. It must stay.

Fix:

- In `countSummary`, before the verdict switch, if `summary.verdict === 'failed'` and `failureClass` is `usage-limit`, `auth`, or `timeout`, return without touching delivery or review counters. `crash` and `bad-output` still count as capability failures. A `failed` row whose `failureClass` is still `null` (classification is async, `lane-outcome-recorder.service.ts:168-186`) still counts; do not guess.
- Name the set `CAPACITY_FAILURE_CLASSES` next to the blend helpers in `local-derivation.ts`. No new setting.

Tests:

- `libs/backend/lane-routing/src/lib/matrix/local-derivation.spec.ts` — a `failed` row with each of `usage-limit`, `auth`, and `timeout` does not create a cell and does not change the score of a sibling `delivered` row. A `failed` row with `crash`, `bad-output`, or `failureClass: null` still lowers the score as the existing failure cases do.

Risk/Effort: medium / S

Scores move up for lanes that mostly die on quota, auth, or timeout. Routing will treat them as unrated until a real delivery or review lands. Effort is one branch and the spec rows.

## Item 4 — Scope outcomes to the workspace, or fix README.md:76

Status: confirmed

Evidence:

- The sentence is not on line 76. Line 76 is the Classify step. The workspace claim is step 3 on line 78: "Outcomes from the last 90 days in this workspace become a matrix…" (`README.md:78`). **Verified** the line moved; the quoted phrase is present.
- Lane completions discard the root. `LaneCompletionOutcomeInput` still has `workspaceRoot` (it is not in the `Omit` list, `lane-outcome-recorder.service.ts:37-46`). `recordLaneCompletion` then forces `workspaceRoot: null` (`:158`). The type comment says the field is for subagent joins and is null for lanes (`lane-outcome.types.ts:77-80`).
- Subagent rows do store a root: `recordSubagentStop` copies `payload.workspaceRoot` (`lane-outcome-recorder.service.ts:210`) and `recordSubagentEnded` copies `event.cwd` (`:231`). Specs expect that (`lane-outcome-recorder.service.spec.ts:499-504`).
- The routing query is machine-wide. `SqliteLaneOutcomeStore.listByLane` filters `lane_id` and `ended_at` only (`sqlite-lane-outcome.store.ts:357-367`). `InMemoryLaneOutcomeStore.listByLane` matches (`in-memory-lane-outcome.store.ts:201-209`). `LaneOutcomeReader.recentOutcomes` adds no workspace predicate (`lane-outcome-reader.service.ts:40-49`). `deriveLocalMatrix` never sees `workspaceRoot` (it is not on `LaneOutcomeSummary`). `lane-routing` has no `workspaceRoot` reference.
- `listByRoles` (Agents tab signals) is the same shape: role and `ended_at` only (`sqlite-lane-outcome.store.ts:370-387`).

Fix:

- Stop overwriting lane `workspaceRoot` in `recordLaneCompletion`. Persist `input.workspaceRoot` when it is a non-empty string, otherwise null. Callers that already pass a root start sticking. This report did not find a lane caller that passes one; the spawn path has to pass the active workspace root into `recordLaneCompletion`. That write is part of this fix, in the lane-completion producer that builds `LaneCompletionOutcomeInput` (search `recordLaneCompletion(`). Do not invent a root.
- Add an optional `workspaceRoot: string | null` argument to `listByLane` and `listByRoles` on `LaneOutcomeStore`, and the same filter in the sqlite and in-memory implementations. `recentOutcomes` and `agentSignals` pass the reader's workspace root.
- Transition rule, so the matrix does not go empty: a row with `workspaceRoot === null` still matches every workspace. New rows match only their root. Null lane rows age out through the existing 90-day window (`OUTCOME_WINDOW_MS`). Document that in a comment on the SQL, not in the README. Leave `README.md:78` as the contract.
- Do not add a setting. The README already states the scope.

Tests:

- `lane-outcome-recorder.service.spec.ts` — a lane completion with `workspaceRoot: '/ws'` stores `/ws`; one without stores null.
- `sqlite-lane-outcome.store.spec.ts` and `in-memory-lane-outcome.store.spec.ts` — `listByLane(id, since, '/ws')` returns that root plus null-root rows, and hides `/other`.
- `lane-outcome-reader.service.spec.ts` — `recentOutcomes` forwards the root.

Risk/Effort: medium / M

Strict filtering with no null exception would drop every historical lane row, because they were stored as null. The transition rule avoids that. Until producers pass a root, new lane rows stay null and the query stays machine-wide. The producer change is what makes the README true.

## Item 5 — Use reviseRounds in the review rate

Status: confirmed

Evidence:

- A `revise` effect only increments the counter and returns. It does not set `finalReview` (`libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:84-86`). `approved` and `rejected` set `finalReview` and leave `reviseRounds` unchanged (`:86`).
- The matrix review rate is `approved / (approved + rejected)` (`local-derivation.ts:31-32`, `277`). `countSummary` (`194-209`) never reads `reviseRounds`. `local-derivation.ts` has no `reviseRounds` identifier. The field is on the summary (`lane-outcome.types.ts:127`) and the spec fixture defaults it to 0 (`local-derivation.spec.ts:35`).
- The Agents-tab ratio is the same definition: `reviewPass` counts `finalReview === 'approved'` over rows with a non-null `finalReview` (`libs/backend/lane-outcomes/src/lib/agent-signals.ts:46-50`). `reviseRounds` is averaged separately as `avgReviseRounds` (`:51-56`) and shown on the clone card (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-outcome-signals.ts:124-129`). The rate ignores it. The average does not.

Fix:

- In `countSummary`, when `finalReview` is null and `reviseRounds > 0`, count the row as one unresolved review: add 1 to a new `unresolvedRevise` bucket and push it onto `review`. Do not add `reviseRounds` itself (a row with three revises is one open review, not three failures). An `approved` or `rejected` row keeps today's numerator and denominator even if `reviseRounds > 0`, so a later approval is still a pass.
- `reviewTotal` becomes `approved + rejected + unresolvedRevise`. `blendedRate` still uses `approved` as the successes. No new setting.
- Leave `agent-signals.ts` `reviewPass` on the documented Req 9.1 ratio. The routing score is what the claim names. The card already shows `avgReviseRounds`.

Tests:

- `local-derivation.spec.ts` — one `finalReview: null`, `reviseRounds: 1` row beside one approval yields review successes 1 and total 2. A row with `reviseRounds: 3` and `finalReview: 'approved'` stays a single success. `reviseRounds: 0` and `finalReview: null` still contributes nothing.

Risk/Effort: low / S

Only open revises move the score. Closed approvals do not get a second penalty.

## Item 6 — Feed or remove pastOutcomes

Status: confirmed

Evidence:

- Both decision-model builds pass `outcomeFigures: []` (`model-refine.ts:158` for the fixed pre-flight request, `:231` for the lane request).
- `buildDecisionPayload` writes `state.pastOutcomes` only from `input.outcomeFigures` (`libs/backend/lane-routing/src/lib/decision-model/decision-payload.ts:78-81`, `111-116`). An empty list leaves `pastOutcomes: {}`.
- The field is a real contract. `SystemOneState.pastOutcomes` is in `system-one.schema.ts:59`. `decision-payload.spec.ts:36-55` and `:111-115` show a non-empty figure becomes `pastOutcomes['codex/implement']`. `:134-138` pins the empty list to `{}`. `model-call.spec.ts:40` expects `pastOutcomes: {}`.
- No production caller constructs a `DecisionOutcomeFigures` value. The only non-empty literal is the payload spec.

Fix:

- Feed the figures. Do not delete the field. The payload builder, schema, and spec already define `{ delivered, failed }` per `laneId/taskKind`.
- Add `outcomeFiguresFrom(summaries)` beside `deriveLocalMatrix` (same 90-day window, same verdict counts, and the same capacity-failure exclusion as item 3 once that batch has landed). Return `DecisionOutcomeFigures` for each lane id and task kind that has at least one counted run.
- `runLaneRequest` and `runFixedRequest` take `outcomeFigures` instead of hard-coding `[]`. `RouteDecideService.runPass` passes the figures gathered for that call. Cap the list at the lanes actually offered, so the byte fit in `fitLane` still shrinks options rather than growing past outcomes without bound.
- Fixed questions (task type and depth) can take the same figures or stay empty. Prefer the same figures: the pre-flight model is the one the schema gave `pastOutcomes` to. If the added bytes trip `payload-too-large`, the existing shrink loop does not apply to fixed questions (`model-refine.ts:164-168` returns immediately). For the fixed request, omit figures when `bodyBytes` would exceed `maxRequestBytes` and send the request anyway. Lane requests keep today's shrink loop with figures included in the measured body.

Tests:

- `decision-payload.spec.ts` already covers the mapping. Extend `model-call.spec.ts` so a non-empty `outcomeFigures` argument appears in `state.pastOutcomes`.
- `route-decide.gate.spec.ts` — a gathered delivered row for an offered lane shows `delivered: 1` on that lane's key; a `usage-limit` failure does not increment `failed` after item 3's rule. An empty history still sends `pastOutcomes: {}`.

Risk/Effort: low / M

The model starts seeing counts it was already told it would see. The size guard on the fixed request is the part that needs a test, because that path cannot shrink.

## Item 7 — Show the matrix

Status: confirmed

Evidence:

- The seed is one row: `SEED_MATRIX_ROWS` contains only `z-ai` / `glm-5` / implement label `strong` (`libs/backend/lane-routing/src/lib/matrix/seed-matrix.ts:58-66`). Every other cell that builder emits is `unknown` (`seed-matrix.ts:85-100`).
- Local cells carry `sampleCount` (`local-derivation.ts:284-291`). Unknown cells have no score. Merge order is user, then local, then seed (`capability-matrix.store.ts:186-190`). The first value cell wins (`mergedCell`, `:448-462`).
- The merged view is written to `~/.ptah/routing/capability-matrix.view.json` (`capabilityMatrixViewPath`, `capability-matrix.store.ts:64-69`; `writeViewIfChanged` at `:316-328`). The comment at `:327` says the routing decision does not read that file. Nothing in RPC types, handlers, or Angular templates reads `capability-matrix` or `sampleCount` (the frontend `sampleCount` hits are an audio recorder, not this matrix).
- What the UI does show is a different object. `agent:outcomeSignals` (`libs/shared/src/lib/types/rpc.types.ts:1820-1827`) returns per-slug delivery and review ratios for the Agents tab. Handler: `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.ts`. Reader: `LaneOutcomeReader.agentSignals`. Renderer: `agent-outcome-signals.ts`. No family, model, task-kind cell, source, or sample count.
- `ptah_route_decide` returns one chosen row per phase with a `score` and a `reason`. The reason text can include `provenance local, sample count N` (`compile-reasons.ts:247`). That is one phase's explanation to the orchestrator, not a matrix page.
- Fresh-install round-robin is **inferred** from the formula, and one step is **verified** by the spec. A neutral prior is 50 (`NEUTRAL_SCORE`, `routing-constants.ts:21`). One delivered run blends to 55 (`local-derivation.spec.ts:135-142`). `55 - 50 = 5`, which is still inside `CLOSENESS_BAND` (`top - score <= 5`). A second delivered run against the same prior is `round(100 * (2 + 10 * 50 / 100) / 12) = 58` by the formula in `local-derivation.ts:362-376` with `BLEND_PRIOR_WEIGHT = 10`. `58 - 50 = 8 > 5`, so a neutral peer leaves the band. This two-run value was not executed. The seed row does not change that for any family other than `z-ai` / `glm-5` / `implement`.

Fix:

- One read-only RPC `routing:getCapabilityMatrix`. Params: none. Result: the merged view the store already serializes (`family`, `model`, per-kind `kind`, `score`, `source`, `asOf`, `stale`, `sampleCount`, `note`). Unknown cells stay `kind: 'unknown'` so the page can show "unrated".
- Handler in a new `libs/backend/rpc-handlers/src/lib/handlers/routing-matrix-rpc.handlers.ts`. It resolves `CapabilityMatrixStore` and calls `load` with the current lane ids (the same queries `gather` already builds) or, when no lanes are installed, returns the seed view. Register the method on `RpcHandler` and add `routing:getCapabilityMatrix: true` next to `agent:outcomeSignals` in `rpc.types.ts` (the allow-map around `:3680`). Follow the `agent:` comment there: if the new prefix is not already in `ALLOWED_METHOD_PREFIXES`, use an `agent:` name instead (`agent:getCapabilityMatrix`) so this fix does not widen the prefix list. Prefer `agent:getCapabilityMatrix` for that reason.
- Electron settings page: a table under the host-routing block in `orchestration-settings.component.ts`, component `capability-matrix-setting.component.ts`, OnPush, `inject()`, `ClaudeRpcService`. Columns: family, model, task kind, score or "unrated", source, sample count, stale. Read-only. No editor for `capability-matrix.json` in this fix.
- The Agents tab does not gain a second matrix. Its outcome signals stay. The settings table is the roster of families and models. Linking a clone card to the table is out of this minimal fix; the card has no family/model key today.

Tests:

- `capability-matrix.store.spec.ts` already covers the view document. Add a handler spec that a seed-only load returns the one `z-ai` / `glm-5` implement value and `unknown` for the other five kinds, and that a local cell's `sampleCount` is passed through.
- `orchestration-settings.component.spec.ts` — the table is absent when `isElectron` is false, and an `unknown` cell renders as unrated rather than as 50.

Risk/Effort: low / M

The store and the view file already exist. The new surface is a read. Effort is the RPC registration, the Electron component, and the empty-lane case.

## Item 8 — Server-side guards for skill Enhance

Status: partly

Evidence:

- Constants exist and are described as historical. `ENHANCE_COOLDOWN_MS` is 24 hours and `MIN_INVOCATIONS_TO_ENHANCE` is 5 (`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:78-81`). `generateProposal` never returns `cooldown` or `below-threshold`. Those skip reasons are only on the type (`:102-103`).
- The live RPC bypasses both gates on purpose. `skillSynthesis:previewEnhancement` calls `generateProposal` with `manual: true` and the comment "a user-initiated preview bypasses the auto-enhance cooldown and invocation floor" (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:363-373`). `applyProposal` writes whatever proposal id it is given (`skill-enhancer.service.ts:489-508`) with no second check.
- The UI does enforce both. `cloneActionModel` disables Enhance when `invocationCount < enhanceMinInvocations` or the cooldown has not elapsed (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts:272-295`). The listing fills those fields from the same constants (`skills-synthesis-rpc.handlers.ts:1237-1241`). A direct RPC call does not pass through that function.
- Judge policy at the cited lines is split. `scoredPass` requires `status === 'scored'` and `score >= settings.minJudgeScore` (`skill-enhancer.service.ts:411-414`). Automatic callers use only `scoredPass` (`:417`). Manual callers use `decision.status !== 'scored' || scoredPass` (`:415-416`), so `unscored` and `disabled` pass. `SkillJudgeService` documents that `disabled` "does not block anything" and that the caller chooses (`skill-judge.service.ts:19-25`). `MANUAL_PREVIEW_JUDGE_SETTINGS` is `judgeEnabled: true`, `minJudgeScore: 6` (`skill-judge.service.ts:55-58`).
- Automatic enhancement is retired. `isEligible` returns false (`skill-enhancer.service.ts:273-280`). `generateProposal` returns `paused` unless `options.manual` (`:309`). The branch that already rejects `unscored` and `disabled` does not run for the Enhance button.
- No cross-family judge. The judge lane is `skillSynthesis.judge`, `provider: ''` (inherit the active provider), `defaultTier: 'haiku'` (`skill-lane-config.ts:127-136`). `LaneRunnerService` resolves that lane and does not compare families (`lane-runner.service.ts:377`). A skill clone has no author family on the enhance path.

Fix:

- In `generateProposal`, before `generateCandidate`, when `options.manual` is set: if the clone's invocation count is below `MIN_INVOCATIONS_TO_ENHANCE`, return `below-threshold`; if `lastEnhancedAt + ENHANCE_COOLDOWN_MS > Date.now()`, return `cooldown`. The enhancer needs the same stats the listing RPC already reads (`SkillScorecardService.getInvocationStats` and `registry.getBySlug(...).lastEnhancedAt`). Fail closed when the stats read throws (return `error`, do not generate).
- Change the manual judge line to `scoredPass` as well. `unscored` and `disabled` return `judge-rejected`. Keep `minJudgeScore` at 6.
- Repeat the threshold and cooldown check in `applyProposal` before the write. A proposal cached just before a second click, or a proposal minted by an old process, must not land inside the window.
- Do not require a different judge family in this fix. There is no author family to compare, and the judge lane is already a separate configured lane the user can point at another provider. Forcing a family here would block Enhance on every host whose judge inherits the chat provider.

Tests:

- `skill-enhancer.service.spec.ts` — manual preview with 4 invocations returns `below-threshold` and does not call the judge; invocation 5 inside the cooldown returns `cooldown`; invocation 5 after the cooldown with `unscored` or `disabled` returns `judge-rejected` and does not cache a proposal; `scored` at 6 caches one. `applyProposal` of a cached id inside a cooldown throws or returns not-applied and does not call `writeEnhancedSkill`.
- `skills-synthesis-rpc.handlers.spec.ts` — `previewEnhancement` surfaces those skip reasons. The spec at the handlers file already mentions `below-threshold` as a skip reason the service can return; pin that the handler no longer forces `manual` past the gates.

Risk/Effort: medium / S

This reverses the comment at `skills-synthesis-rpc.handlers.ts:363-364`. The button's own disabled states stay the same. A caller that posts `skillSynthesis:previewEnhancement` directly loses the bypass. The UI tests in `clone-action-gating.spec.ts` do not need a behavior change.

## Also worth knowing

Status: confirmed

Evidence:

- Gate 0.1 is a prompt step. `plugins/ptah-core/skills/orchestration/references/lane-assignment.md:18-29` tells the orchestrator to call `ptah_route_decide` with `stage:'gate-0.1'` when the tool is listed, and to skip it silently when it is not. No handler refuses a spawn that skipped that call.
- `taskKind` and `routingSource` are optional spawn fields. `AgentSpawnArgsSchema` accepts them and leaves them unset (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:98-103`; spec at `agent-spawn-args.schema.spec.ts:193-197`). The agent namespace forwards them when present (`agent-namespace.builder.ts:416`). `README.md:80` says the fields are optional. The column is `routing_source` (`sqlite-lane-outcome.store.ts:43`).
- A read-only count is possible and does not exist. `routingSource` is on every row (`lane-outcome.types.ts:102`) and on `LaneOutcomeSummary` (`:130`). No RPC groups `COUNT(*)` by `routing_source`. `agent:outcomeSignals` does not return it.

Fix: none in the eight items. A later read-only query can group `lane_outcome_records.routing_source` in the sqlite store and return the counts from the same matrix RPC as item 7. It is not required to verify these claims.

Risk/Effort: — / —

## Batch proposal

File-disjoint. Batches do not share a source file. Specs stay with the batch that owns the production file.

| Batch | Items | Files | Why together |
| --- | --- | --- | --- |
| A. Decision offer | 1, 2, 6 | `spread.ts`, `phase-plan.ts`, `phase-resolve.ts`, `model-refine.ts`, `route-decide.service.ts`, `decision-payload.ts` only if a helper must live there, `file-settings-keys.ts`, `file-settings-manager.ts` (`ROUTING_KEYS`), `settings-export.types.ts`, `host-routing-setting.ts` or a sibling reader, `orchestration-settings.component.ts`, new rotation RPC handler, `spread.spec.ts`, `route-decide.gate.spec.ts`, `model-call.spec.ts`, `file-settings-keys.spec.ts`, `orchestration-settings.component.spec.ts` | Items 1 and 2 both edit `phase-plan.ts`. Items 1 and 6 both edit `route-decide.service.ts`. Item 6's figures must be in the body that item 2's band filter already shrinks. |
| B. Matrix rates | 3, 5 | `local-derivation.ts`, `local-derivation.spec.ts` | Both change `countSummary` / `reviewTotal`. Item 6's figure helper should call the same exclusion; implement B first and have A import the exported classifier, or duplicate the three-class set in A's new helper if the batches run in parallel. The duplicate is a named constant copied once, not a shared edit. |
| C. Workspace scope | 4 | `lane-outcome-recorder.service.ts`, the lane-completion producer that calls it, `lane-outcome.store.ts` (optional filter argument), `sqlite-lane-outcome.store.ts`, `in-memory-lane-outcome.store.ts`, `lane-outcome-reader.service.ts`, and those four specs | Store signature and both implementations move together. Does not touch `local-derivation.ts` or the routing pipeline. |
| D. Matrix view | 7 | `rpc.types.ts`, new `routing-matrix-rpc.handlers.ts` and its spec, `capability-matrix-setting.component.ts` and its spec, `orchestration-settings.component.ts` only if batch A has not taken it | If A is in flight, D adds the table component and A only mounts the rotation control; the mount lines in `orchestration-settings.component.ts` then belong to whichever batch lands second, as a three-line registration. To stay disjoint, D owns `orchestration-settings.component.ts` and A exposes the rotation control as its own component that D's mount file imports. A's batch list above includes that mount file; drop it from A and keep it in D. |
| E. Enhance guards | 8 | `skill-enhancer.service.ts`, `skill-enhancer.service.spec.ts`, `skills-synthesis-rpc.handlers.ts`, `skills-synthesis-rpc.handlers.spec.ts` | No lane-routing file. The Angular gate already matches the constants. |

Corrected ownership of `orchestration-settings.component.ts`: batch D. Batch A adds `lane-rotation-setting.component.ts` only. D imports it next to the matrix table. That keeps A and D file-disjoint.

Suggested order: B, then A, then C, D, and E in parallel. B's capacity-failure set is the one A should count in `pastOutcomes`. C, D, and E share nothing with that pair.

## Decisions

### Item 1 off-mode order

- Decision: `rotate: false` returns `natural[0]` from the existing tie-break.
- Options: (1) prefer-list order only, ids missing from `prefer` sorted by id; (2) existing T order, which already puts `prefer` first.
- Evidence: `compareTieBreak` at `spread.ts:206-217` is the order the rotation pool is sorted into before `successor` runs. A second order would disagree with requirement 7's tie-break specs.
- Reversible: yes. The flag is an argument.

### Item 1 setting key

- Decision: `agentOrchestration.laneRotation`, boolean, default `true`.
- Options: a new key; overload `agentOrchestration.hostRouting` (that flag already means "send routing suggestions", `host-routing-setting.ts:12-30`).
- Evidence: host routing and rotation answer different questions. Turning suggestions off must not silently freeze the cursor.
- Reversible: yes.

### Item 4 scope

- Decision: make new rows workspace-scoped and keep `workspaceRoot === null` rows visible in every workspace until they age out. Do not edit `README.md:78`.
- Options: (1) that transition; (2) strict filter, which hides every current lane row because `recordLaneCompletion` stores null; (3) change the README to say "on this machine" and leave the query.
- Evidence: `README.md:78` states the workspace contract. `sqlite-lane-outcome.store.ts:357-367` does not filter. `lane-outcome-recorder.service.ts:158` forces null for lanes, so a strict filter empties the matrix on the day it ships. Null rows remaining visible is a 90-day bridge (`OUTCOME_WINDOW_DAYS` is 90, `routing-constants.ts:169`), not a permanent machine-wide mode.
- Reversible: yes. The filter argument can go back to "no predicate". This is a scope choice. Recommendation above is what the batches assume. A spawner that wants option 3 instead should drop batch C and change one README sentence.

### Item 5 formula

- Decision: an open revise (`finalReview === null` and `reviseRounds > 0`) counts as one non-success in the review denominator. The integer `reviseRounds` is not added again. A later `approved` stays one success.
- Options: (1) that; (2) add `reviseRounds` into the denominator even after approval; (3) leave the rate and only keep `avgReviseRounds` on the card.
- Evidence: `applyOutcomeEffect` stores a revise as a counter without a final review (`lane-outcome.store.ts:84-85`). Adding the raw counter would punish a row three times for one open review, and would punish an approval that already recorded the repair. Option 3 leaves the claim unfixed.
- Reversible: yes. The bucket is local to `countSummary`.

### Item 6 feed rather than remove

- Decision: pass real `outcomeFigures` into both payload builds.
- Options: feed; delete `pastOutcomes` from the schema and the builder.
- Evidence: `decision-payload.ts:111-116` and `decision-payload.spec.ts` already define the wire shape. The only production defect is the two hard-coded empty arrays (`model-refine.ts:158`, `:231`).
- Reversible: yes. The arguments can go back to `[]`.

### Item 8 manual bypass

- Decision: the server enforces the 5-use floor, the 24-hour cooldown, and a `scored` verdict on manual preview and on apply. It does not require a different judge family.
- Options: (1) that enforcement; (2) keep the bypass documented at `skills-synthesis-rpc.handlers.ts:363-364` and treat the UI gate as enough; (3) also refuse a judge whose provider family equals the clone's author.
- Evidence: the UI gate is real (`clone-action-gating.ts:272-295`) and the RPC comment states the bypass is intentional. The note's cited lines (`skill-enhancer.service.ts:415-417`) are that bypass for judge status. Option 3 has no author family to compare (`skill-lane-config.ts:127-136` inherits the active provider).
- Reversible: yes. `options.manual` can take the old expression again. This reverses a written comment, so it is the one policy change in the eight items.

### Item 7 surface

- Decision: one Electron settings table via `agent:getCapabilityMatrix`. The Agents tab keeps `agent:outcomeSignals`.
- Options: settings table; also render cells on each clone card; only document the view file path.
- Evidence: the view file is already written (`capability-matrix.store.ts:316-328`) and no RPC reads it. Clone cards render slug ratios, not family/model cells (`agent-outcome-signals.ts`).
- Reversible: yes. The RPC is read-only.
