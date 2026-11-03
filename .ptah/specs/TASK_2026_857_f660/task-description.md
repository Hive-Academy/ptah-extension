# Task Description - TASK_2026_857_f660

Revision: r2

## Changes in r2

- Defined task-kind provenance, asynchronous post-insert classification, and the unclassified state without a fallback kind.
- Named review-run completion as the host verdict source and specified stop deduplication, routing defaults, and prior blending.
- Clarified the broader subagent stop event's prerequisites and updated the shared-contract and migration acceptance criteria.

## Problem

The production outcome sample in `context.md:16-22` has 108 rows, all `delivered`, no final reviews, about 23 null task kinds, and no subagent rows. A `delivered` verdict currently means declared files exist and contain bytes, not that a reviewer approved the work [A1]. Null task kinds are excluded from local learning [A2]. At five samples a local rate becomes a matrix cell ahead of the seed, so an all-delivered sample can produce a misleading score [A2, A3].

Static code does **not** show a missing terminal lane write path: exits, inactivity timeouts and user stops call the notifier, which enqueues the outcome before attempting chat delivery [A4]. The production distribution warrants a focused check of actual persistence and its failure modes, including an absent recorder or a failed write; it is not proof that these paths never record failures. Subagent outcomes do have a concrete coverage gap: Electron subscribes to a stop callback, but that callback is emitted only when the hook has a transcript path and derives both a child and parent session ID. A separate stop event can be emitted without those conditions, though it still requires a resolved session ID and cwd [A5].

The current `pre-flight` result supplies task type and depth only; the executor roster belongs to `gate-0.1` [A6]. Electron's chat start and continuation paths have host-side turn boundaries, and continuation inserts extra context before dispatch [A7]. This feature needs a per-turn scope decision and a subsequent routing reminder without turning the existing plan-approval gate into an early gate.

## Goals

- Make newly recorded lane and subagent outcomes trustworthy for learning: persist terminal failures and structured reviews, identify the source of any task kind, and exclude unclassified rows from derivation.
- Give the Electron assistant timely routing context after engineering scope is agreed or materially revised, while leaving the user's response path independent of the check.
- Keep local evidence influential in proportion to sample size and preserve the shipped seed as the prior.

## In scope

- Electron first: host-side user-turn scope assessment, pre-flight routing, a short next-turn reminder, disable control, and reuse of a valid pre-flight result by a later skill call.
- Shared outcome recording and routing contracts needed for terminal lane coverage, task-kind provenance, subagent persistence, host-observed reviews, and prior blending. This includes the record type, row schema, and SQLite migration for `taskKindSource`, plus nullable subagent stop metadata. Shared changes must keep VS Code and CLI compilation and existing host behavior intact.
- Focused verification using synthetic lane exit, timeout, crash, usage-limit and stop events; subagent stops with incomplete hook metadata; review events; and matrix samples.

## Out of scope

- Prompt or rule text changes on the other machine, including a new instruction telling the model to call `route_decide` itself; that work has a separate owner.
- VS Code or TUI host-side routing features; Electron is the requested first host.
- CI, pull request and merge quality signals unless an already structured host event can be consumed without a new integration.
- Backfilling historical null task kinds or claiming that old `delivered` rows were reviewed; their original evidence is insufficient.
- Changing the plan-approval timing or the model/skill ownership of `gate-0.1`; this task adds a reusable pre-flight result.

## Classification

**Type: FEATURE; estimate: Complex.** The task carrier and context classify the work as a feature and complex (`task.md:1-8`, `context.md:24-30`). It spans the SDK stop hook, process manager, outcome store, routing matrix and Electron turn dispatch, with observable behavior and cross-host shared contracts. No repository priority scale or user priority was supplied, so no priority is assigned.

## Requirements

### 1. Persist terminal lane outcomes

The host records one outcome for each accepted lane run that reaches a terminal state, even when the parent chat is unavailable.

- When a spawned lane exits successfully, fails, crashes, reaches a usage limit, times out, or is stopped by the caller, the system shall persist one row for that terminal run with its status-derived verdict and applicable failure class.
- When a completion signal cannot be delivered to chat, the system shall still persist or durably queue the outcome; a missing recorder, rejected row, or exhausted queue shall produce a diagnostic without request text.
- When a continuation produces another terminal event, the system shall preserve that event under its existing terminal-event identity without duplicating a single ending.
- When the known terminal paths are exercised in an integration fixture, the system shall expose a corresponding row for each case; the test shall distinguish a genuine failure row from `delivered` and shall cover the optional-recorder path. Existing exit/timeout/stop wiring is evidence to verify, not assumed missing [A4].

### 2. Classify task kinds with recorded provenance

The outcome writer records the best supported kind without inventing a fallback. Resolution order is explicit spawn argument, known lane role or subagent type mapping, asynchronous System One classification, then unclassified.

- When a spawn supplies a valid `taskKind`, the resulting row shall retain that kind with `taskKindSource: explicit`; when the kind is omitted and a known lane role or `subagent_type` maps to a kind, it shall store that kind with `taskKindSource: mapped` [A13].
- When neither explicit kind nor mapping exists, the host shall insert the outcome without waiting for classification, with `taskKind: null` and `taskKindSource: unclassified`; spawn completion shall make no classification request.
- When the configured System One model can classify the bounded task brief after insertion, the recorder shall update the same row to a valid kind and `taskKindSource: classified`, following the asynchronous pattern of `LaneOutcomeRecorder.onLaneRecordInserted` [A14]. It shall make at most one bounded request per run using the existing per-request timeout; when the model is unset, times out, fails, or gives no valid kind, the row shall remain unclassified.
- When a deliverables report supplies a valid kind later, the system shall record its explicit source without erasing a previously known kind based on a lower-priority source; it shall never overwrite a known kind with null.
- When new rows are written or read, the shared `LaneOutcomeRecord` contract, write-edge row schema, SQLite migration, and other persistent stores shall expose `taskKindSource` as `explicit | mapped | classified | unclassified`; tests shall distinguish the four sources. Pre-migration rows whose provenance cannot be reconstructed shall remain readable with a null source, while every new row shall have one of the four source values [A10, A12, A15].
- When local derivation reads an unclassified row, it shall exclude that row while its kind is null; when a valid classification later arrives, the row shall become eligible for derivation [A2].

### 3. Record subagent stops in the production store

The Electron host needs a row for each observed subagent stop, including a stop that lacks a transcript path or a resolvable parent session.

- When either stop producer reports an agent ID, the system shall identify the row by `subagentRunId(agentId)` and persist one `subagent` outcome in Electron's production store. When both producers fire, whichever arrives first shall create the row, and the later one shall enrich missing metadata or be ignored; it shall not create a second row [A5, A16].
- When transcript or parent-session metadata is absent, the system shall retain the stop outcome and mark the missing telemetry join as unavailable or unmatched; it shall not discard the record. The SDK stop payload shall permit null `subagentSessionId`, `parentSessionId`, `workspaceRoot`, and `transcriptPath` where a producer cannot supply them; the shared outcome record, write-edge schema, and persistence adapters shall accept null for the three stored join fields while keeping `agentId` required [A15, A17].
- When a later deliverables or review report arrives before or after the stop, the existing held-report join shall attach it to the same subagent run.
- When Electron initializes, both stop producers and the outcome recorder shall be wired to the same store instance; an integration fixture shall demonstrate one persisted row with either producer first and with missing transcript metadata. Shared payload/schema changes shall keep VS Code and CLI compiling.

### 4. Assess engineering scope once per user turn

The Electron host supplies a typed background System One decision for the main conversation.

- When an interactive user turn is admitted and routing is enabled with a configured decision model, the host shall issue at most one bounded scope-check request answering: engineering request, scope settled, new task versus continuation, and material change since the last routed scope.
- When the turn is not an engineering request or is a continuation with no material scope change, the system shall emit no new routing reminder.
- When the model returns malformed answers or confidence below the existing `CONFIDENCE_THRESHOLD` of 0.5, the system shall treat scope as unresolved and shall not claim that the user agreed to a scope [A13].
- When a decision model is configured, the user-facing host-side routing setting in Electron settings shall default ON; when none is configured, it shall default OFF. When the user turns the setting OFF, the host shall make zero automatic routing model calls, including scope checks and pre-flight, and chat dispatch shall remain usable. An unset decision model shall likewise make no automatic routing model calls.

### 5. Route only agreed or materially changed scope

The host gives the assistant a concise routing result after the scope decision.

- When an engineering scope is settled for a new task, or materially changes from the last routed scope, the host shall call `route_decide` at `pre-flight` on a bounded summary of that scope once per scope revision.
- When engineering scope remains unclear, the host shall queue a short scope-confirmation nudge based on the unresolved scope decision rather than invoking pre-flight; it shall show at most once per scope revision and shall not repeat on unchanged continuation turns.
- When a pre-flight result is available, the next eligible model turn shall receive one short `Routing:` system reminder containing task type, depth, and suggested executors drawn only from currently installed and enabled lanes or available subagent roles; absent candidates shall be omitted.
- When scope changes again before delivery, the host shall discard the stale reminder and use only the latest scope revision. It shall not insert a reminder into an already dispatched turn.
- When pre-flight returns only task type and depth, the host shall obtain any executor suggestions from a current available-candidate source rather than mislabeling a `gate-0.1` roster as a pre-flight result [A6].

### 6. Preserve plan-approval routing and reuse pre-flight

The later orchestration skill remains responsible for the plan gate.

- When a plan is approved, `gate-0.1` shall still run at the existing model/skill-driven point with its phases and preferences; the host shall not trigger that gate during initial scope assessment.
- When a skill later requests pre-flight for the same session and unchanged agreed scope, the system shall return the host's validated result without a second model request.
- When the scope revision, model configuration, or session differs, the system shall reject the cached result and perform a fresh eligible pre-flight request.

### 7. Capture structured review verdicts on the host

The host attaches reviewer evidence to the run reviewed, regardless of whether the model calls `ptah_outcome_report`. The architect shall identify the completion event of a review-kind lane or subagent run and a deliverable format with a parsable verdict line plus an explicit reviewed-run reference; this is the candidate host event and must be implemented or replaced with another concrete host-observed event that meets the same criteria [A8].

- When a review-kind run completes with a parsable verdict line and an explicit reviewed `runId`, the host shall capture the verdict from that run's deliverable without depending on a `ptah_outcome_report` call.
- When the captured verdict says `revise`, the system shall increment the reviewed run's `reviseRounds` once; when it says `approved` or `rejected`, it shall set that run's `finalReview` accordingly, including when the review arrives before the reviewed outcome row.
- When a review has no unambiguous target run or no structured verdict, the system shall leave all outcome rows unchanged and surface a diagnostic; it shall not infer approval from file existence or free-form praise.
- When the same review event is replayed or both host capture and `ptah_outcome_report` report it, the system shall deduplicate by `(reviewed runId, reviewer runId)` and apply it once. The existing model-call report path shall remain usable [A8].
- When a review-kind run finishes with a valid reviewed-run reference and verdict and makes **no** `ptah_outcome_report` call, an integration fixture shall show the reviewed run's `finalReview` or `reviseRounds` updated; a review with no target shall change neither.

### 8. Blend local observations with the prior

Routing uses the shipped seed where one exists and the existing neutral score otherwise.

- When a local bucket has at least one delivery observation or one review observation, the system shall produce a local cell; `MINIMUM_SAMPLE_COUNT` shall no longer gate whether the cell exists. With no observations of either type, it shall produce no local cell [A2].
- When scoring a delivery rate, the system shall use successes `s = delivered` and denominator `n = delivered + noDeliverable + failed`; when scoring a review rate, it shall use `s = approved` and `n = approved + rejected`. Each available rate shall be blended separately as `(s + k * prior / 100) / (n + k)`, where `prior` is a 0–100 score and `k` is one named exported `BLEND_PRIOR_WEIGHT = 10` in `routing-constants.ts` [A13].
- When a matching seed exists, the prior shall be that seed score; when none exists, the prior shall be the neutral score. Explicit user-authored matrix cells shall retain precedence.
- When only one denominator is nonzero, the local score shall be that rate scaled to the integer matrix range; when both are nonzero, it shall be the mean of the two blended rates, preserving the existing combination rule [A2].
- When one or five observations strongly differ from the prior, the local score shall move toward the observed rate without jumping to that raw rate; as sample size grows, observed evidence shall dominate. Tests shall cover both directions, no seed, rounding, zero denominators, and the two separate rates.
- When a review exists, review approval or rejection shall affect the review rate as such; an artifact merely being `delivered` shall contribute only to the delivery rate and shall not be treated as an approval.

## Non-functional

- **Turn latency:** The scope check and pre-flight work shall never await on the reply dispatch path. Each System One request shall use the existing 3,000 ms per-request abort bound; a pre-flight call shall respect the routing service's overall bounded call budget [A9]. Expiry leaves the current turn uninterrupted.
- **Cost:** At most one scope-check model request per eligible user turn, at most one new pre-flight per unchanged scope revision, and at most one asynchronous task-kind classification request per unclassified run. Classification shall run only after row insertion, never on the spawn path, and shall use the existing per-request timeout; an explicit or mapped kind shall require no classification call. A disabled host-side routing setting or unset decision model shall cause zero host-side routing calls; an unset decision model shall also cause zero task-kind classification calls [A9, A14].
- **Privacy:** Persistent outcome rows and diagnostics shall contain no request text, prompt text or file contents. Existing workspace identifiers used to join subagent evidence may remain. The task brief and agreed-scope summary may be used transiently for decision calls; only the classified kind and its source shall be persisted from a task-kind classification, never its input or response text [A10].
- **Failure behavior:** A model timeout, malformed answer, unavailable store, or missing candidate listing shall fail open for chat and produce no misleading routing recommendation. Outcome write failures shall follow the existing durable queue/rejection diagnostics rather than silently count as successful evidence [A11].
- **Compatibility:** Changes to shared record, schema, or routing libraries shall preserve VS Code and CLI host compilation and the existing Electron-first host contract.

## Stakeholders

- **Electron user:** receives a normal reply promptly, a scope nudge when needed, and a concise routing hint after agreement.
- **Assistant and orchestration skill:** receive one current pre-flight decision and retain the plan-approval gate.
- **Outcome and routing operators:** receive trustworthy failure, subagent and review evidence for ranking and diagnostics.
- **VS Code and CLI maintainers:** retain compiling shared contracts without receiving a new host-side routing feature.

## Risks

- **False scope agreement or stale hint:** typed low-confidence handling and revision-keyed one-time reminder delivery prevent an early or outdated recommendation.
- **Review applied to the wrong run:** require an explicit unique run identity; hold or refuse ambiguous events and deduplicate replays.
- **Failure rows still missing in production:** exercise real terminal-to-store wiring and surface recorder/queue failures, rather than relying on notifier unit tests alone.
- **Small-sample ranking bias:** preserve explicit user overrides and blend delivery and review rates independently with a seed or neutral prior.
- **Decision-model cost or delay:** one request per eligible turn, bounded timeouts, no retries on the user path, and a disable setting.

## Open questions

None reserved for the user. The architect shall settle the scope-cache location, available-candidate source, role mapping, and the exact host completion event and parsable review deliverable contract against the observable criteria above. The prior weight and routing default are settled here.

## Decisions

| Decision                                                                                                                                  | Options considered                                                                                                       | Evidence                                                                                                             | Reversible                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Treat all-`delivered` production rows as an integrity signal, not proof of absent failure writes.                                         | Declare terminal wiring missing; verify the existing path and close any persistence gaps. Chosen: verify and close gaps. | `context.md:16-22`; notifier enqueues before chat at [A4].                                                           | Yes                                                    |
| Resolve task kind as explicit → mapped → asynchronous classified → unclassified; record `taskKindSource`, with no fallback kind.          | Fabricate a default kind; preserve null and provenance. Chosen: preserve null and provenance.                            | Null rows are excluded [A2]; spawn kind is optional [A12]; a guessed implement kind would bias seed cells [A3].      | Yes, after the shared schema and migration are updated |
| Classify only after outcome insertion, at most once per run, with no request when the model is unset.                                     | Spawn-path classification; post-insert classification. Chosen: post-insert.                                              | Existing recorder has an asynchronous after-insert failure-classifier seam [A14].                                    | Yes                                                    |
| Deduplicate subagent stops by `subagentRunId(agentId)` and allow missing join metadata.                                                   | Keep callback-only recording; write both producers independently; merge under one stable run identity. Chosen: merge.    | [A5, A16, A17]                                                                                                       | Yes                                                    |
| Keep `gate-0.1` at plan approval and do not invent a pre-flight roster.                                                                   | Move gate earlier; host pre-flight plus separate available suggestions. Chosen: latter.                                  | [A6]; user scope in `context.md:9-13`.                                                                               | Yes                                                    |
| Default host-side routing ON with a configured decision model and OFF without one; the user setting can disable it.                       | Always on; always off; conditional default. Chosen: conditional default.                                                 | The request calls for a per-turn check and a disable setting (`context.md:9-13`); an unset model cannot answer [A9]. | Yes                                                    |
| Blend delivery and review separately with `BLEND_PRIOR_WEIGHT = 10`, then mean when both exist; remove the five-sample cell gate.         | Raw local replacement; single blended aggregate; separate blended rates. Chosen: separate rates.                         | Existing rates and combination rule [A2]; seed precedence [A3]; user scope in `context.md:12-13`.                    | Yes                                                    |
| Capture completion of a review-kind run with a parsable verdict and reviewed-run reference; deduplicate by reviewed and reviewer run IDs. | Rely only on model reports; infer from prose; parse a structured review deliverable. Chosen: structured deliverable.     | Existing report path alone [A8] cannot demonstrate host capture.                                                     | Yes                                                    |

## Survey appendix

Evidence references below are repository-relative `file:line`; ranges identify the relevant code section. The production counts are a prior observation in the task context, not a database query made for this document.

| Ref | Evidence                                                                                                                                                                                                                                                                                                                                                                             | Finding                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:658-678`                                                                                                                                                                                                                                                                                      | Completed or host-stopped runs with nonempty declared files become `delivered`; crashes, timeouts and caller stops become `failed`.                                                                                                                   |
| A2  | `libs/backend/lane-routing/src/lib/matrix/local-derivation.ts:124-135,247-274,277-306`; `libs/backend/lane-routing/src/lib/routing-constants.ts:151-152`                                                                                                                                                                                                                             | Null task kinds are skipped; five delivery or review observations create a raw local cell.                                                                                                                                                            |
| A3  | `libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts:173-195`; `libs/backend/lane-routing/src/lib/matrix/seed-matrix.ts:81-102`                                                                                                                                                                                                                                      | User, local and seed layers are ordered; the shipped seed currently populates implement cells.                                                                                                                                                        |
| A4  | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:2315-2328,2555-2574,2741-2776,2970-3000`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:331-360`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:11-69`; `libs/backend/cli-agent-runtime/src/lib/di/register.ts:300-313` | Terminal paths signal; the notifier enqueues before chat delivery, but the recorder is optional and the enqueue helper returns when absent.                                                                                                           |
| A5  | `apps/ptah-electron/src/di/phase-2-libraries.ts:219,290-299,406`; `libs/backend/lane-outcomes/src/lib/di/start.ts:84-106`; `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:507-559`; `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-hook-handler.ts:49-106`; `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:99-136`                    | Electron registers SDK, store and callback subscription. The recorder callback requires transcript and session derivation; the separate stop event needs a resolved session ID and cwd but no transcript. Current subagent row starts with null kind. |
| A6  | `libs/backend/lane-routing/src/lib/contracts/route-decide-args.schema.ts:36-59`; `libs/backend/lane-routing/src/lib/contracts/route-decide-result.schema.ts:218-244`; `libs/backend/lane-routing/src/lib/route-decide.service.ts:114-169`                                                                                                                                            | Pre-flight returns task type/depth; gate-0.1 accepts phases and returns a roster.                                                                                                                                                                     |
| A7  | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:592-615,1012-1025,1056-1220`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts:96-101`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:838-860`                                                                                               | Host chat start/continue dispatches SDK turns, with an existing continuation context-injection seam.                                                                                                                                                  |
| A8  | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:77-95,100-123,168-190`; `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:180-197`; `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:45-64`                                                                                                             | Model-invoked reports supply reviews; `revise` increments and final review sets approved/rejected.                                                                                                                                                    |
| A9  | `libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts:10-17,107-125`; `libs/backend/lane-routing/src/lib/routing-constants.ts:109-139`                                                                                                                                                                                                                              | System One and route-decision request bounds already exist.                                                                                                                                                                                           |
| A10 | `libs/shared/src/lib/types/lane-outcome.types.ts:1-12,61-104`                                                                                                                                                                                                                                                                                                                        | The contract's privacy comment forbids request or prompt text and file contents. The type also carries `workspaceRoot`, so paths are not universally excluded.                                                                                        |
| A11 | `libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts:1-9,35-55`; `libs/backend/lane-outcomes/src/lib/di/register.ts:24-44`                                                                                                                                                                                                                                            | Outcome writes have a journal, retry/rejection path, and SQLite or key-value backing.                                                                                                                                                                 |
| A12 | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:75-99`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:819`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:40-42`; `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:34-48`                                   | Spawn kind is optional, the process copies it, the outcome falls back to null, and the row schema permits null.                                                                                                                                       |
| A13 | `libs/backend/lane-routing/src/lib/routing-constants.ts:16-27,141-152`; `libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts:36-47,349-370`                                                                                                                                                                                                                                     | Scores use 0–100, neutral 50 and seed labels; confidence falls back below 0.5, and the current local cell gate is five samples. The phase plan has a phase-to-kind mapping.                                                                           |
| A14 | `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:43-97`; `libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts:10-17,107-125`                                                                                                                                                                                                                   | Failure classification is scheduled after a lane row is inserted; the decision client has a bounded request timeout.                                                                                                                                  |
| A15 | `libs/shared/src/lib/types/lane-outcome.types.ts:61-82`; `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:34-47`; `libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts:17-45,69-82`                                                                                                                                                                      | The shared record and row schema currently have nullable task kind and optional/nullable subagent join fields, but no task-kind source. SQLite maps named columns and decodes them through the row schema.                                            |
| A16 | `libs/backend/lane-outcomes/src/lib/subagent-join.ts:8-10`; `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:99-103`                                                                                                                                                                                                                                             | `subagentRunId(agentId)` supplies the stable subagent row identity.                                                                                                                                                                                   |
| A17 | `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts:8-16`; `libs/shared/src/lib/types/lane-outcome.types.ts:68-72`; `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:38-41`                                                                                                                                                                         | The SDK callback payload currently requires session IDs, workspace root and transcript path; the shared row contract already permits missing join fields. The new broader producer needs a compatible nullable payload.                               |
