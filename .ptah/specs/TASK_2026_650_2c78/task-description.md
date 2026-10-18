# Split Setup Wizard generation into independent workflows

## Summary

**Type:** FEATURE, Full depth (task decision D1). **Estimate:** L (existing carrier scale). The change adds two independent, user-started chat-tab workflows and replaces the forced generation sequence while retaining its controls, persistence, and finalization. This size reflects frontend workflow changes plus two backend generation paths and their recovery behavior. Priority is unspecified; no repository priority scale was supplied.

Agents and the enhanced project system prompt can each be generated for the active, authorized workspace without first running the four-phase analysis. Each workflow uses a verified fresh analysis when available and gathers current workspace context itself otherwise. The analysis run remains a separate entry point and artifact. The Setup Hub home keeps its existing design.

## Current behavior

- `wizard-view.component.ts:83-134` renders a single step sequence: welcome, scan, analysis, selection, generation, enhancement, completion. `wizard-analysis-runner.service.ts:176-213,245-279` discovers a resumable analysis, runs deep analysis, then requests agent recommendations before showing selection.
- `wizard-phase-generation.ts:88-113` advances generation completion to enhancement. `prompt-enhancement.component.ts:269-307` starts enhancement automatically and errors when `multiPhaseResult` is absent, despite the backend being able to discover workspace context.
- Agent selection, preview, community packs and installation live at `agent-selection.component.ts:601-1148`; generation progress, retry and completion live at `generation-progress.component.ts:334-565` and `completion.component.ts:97-170`. The RPC boundary already separates `wizard:deep-analyze`, `wizard:submit-selection`, and `enhancedPrompts:runWizard` (`setup-rpc.handlers.ts:272-276`; `wizard-generation-rpc.handlers.ts:223-227`; `enhanced-prompts-rpc.handlers.ts:209-213`).
- `wizard-generation-rpc.handlers.ts:251-355,980-992` authorizes the workspace and analysis directory, checks freshness, and gates both the analysis directory and client `analysisData` on the trusted directory; its response does not currently expose the freshness result. `orchestrator.service.ts:372-410` discovers workspace context without precomputed analysis. The prompt service checks freshness for `analysisDir` (`enhanced-prompts.service.ts:980-1000`), but `enhanced-prompts-rpc.handlers.ts:248-348` converts client `analysisData` into `preComputedInput` without that check, causing `enhanced-prompts.service.ts:406-418` to skip discovery. `prompt-enhancement.component.ts:290-307` also blocks the fallback at the UI.
- `analysis-freshness.service.ts:19,48-90,93-206` qualifies only the latest run by `analyzedAt`, measuring its seven-day age from `manifest.updatedAt`; it checks completed verified phases, workspace fingerprint, and output hashes. Its validated manifest is read through `analysis-storage.service.ts:327-357`.
- `setup-hub.component.ts:1295-1297` opens the monolithic wizard route. Chat's setup widget also invokes `setup-wizard:launch` (`setup-status-widget.component.ts:194-217`; `setup-rpc.handlers.ts:236-269`), which opens a separate VS Code webview with `initialView: 'setup-wizard'` (`setup-wizard.service.ts:53-90`; `webview-lifecycle.service.ts:109-156`). The separate panel has its own tab manager, so a local tab there is not a main-chat tab. Normal chat has workflow-tagged tabs (`workflow-tab-launcher.service.ts:40-49`; `chat-types.ts:873-878`).

## In scope

1. Expose separate **Generate agents** and **Generate project guidance** actions from the Setup Hub home using its existing card/button styles, and from the existing wizard launch paths. Open the main chat surface in VS Code and Electron, then open or return to a workspace-bound tab with existing tags `setup-agent-generation` and `setup-project-prompt` respectively. Workflow-specific controls sit beside shared chat messages/input.
2. Let either action start for an authorized workspace with no analysis, a stale analysis, or the latest fresh completed analysis. Apply the same workspace-bound freshness result to analysis directories **and client-supplied `analysisData`** in both generator RPCs; ignored analysis data triggers workspace discovery. Expose the source and safe reason to the UI; the current agent RPC needs a response/status contract change to do so.
3. Preserve agent recommendation/catalog, provider/model choice, selection, community pack install, preview/confirmation, per-item progress/retry with its existing cap/backoff, cancellation, checkpoint/resume including old wizard checkpoints, validated writes/sync, and completion results. Without analysis, return the existing static recommendation catalog from an explicit workspace-catalog request, while generation itself gathers workspace context.
4. Preserve enhanced prompt generation, detected-stack/summary/result, retry, optional skip, trace/state/cache/enablement and later regeneration. Remove the UI prerequisite for `multiPhaseResult`; offer project guidance as its own workflow. Preserve the existing wizard's one-flow continuation into guidance while making independent agent starts finish independently. Add effective Stop/cancel for an active project-guidance run.
5. Keep analysis browse/load/hide, four-phase files, the current analysis checkpoint, results-page Continue/Let Me Adjust, and analysis-to-recommendations hand-off. The hand-off becomes optional and verified rather than a required step transition. Existing `setup-wizard` routes and VS Code panels must land on working pages.
6. Use shared chat-tab behavior for the two generation workflows: streaming messages, advanced input, reopen/continue, and workflow identity. Preserve the generation finalization boundary and failure states. The architect may choose persisted chat history or a live stream with checkpoint/result recovery, provided the observable recovery criteria below hold.

## Out of scope

- Moving the four analysis phases to chat sessions or introducing/changing per-phase manifest schema, version, session ID, attempt, and verification fields: TASK_2026_651_2fb8. Existing freshness implementation may read the manifest already present in this checkout; this task does not own its format.
- Opening flagged sessions inside their builder page: TASK_2026_680_bc6c. PR #736 review follow-ups: TASK_2026_682_f705.
- Redesigning the Setup Hub home, AI Team Builder, New Project builder, or unrelated chat pages: they are separate surfaces and the home design is fixed by decision D10/D12.
- Removing analysis, recommendations, community packs, output validation, prompt state, or any other user-visible capability: the keep-and-fix rule requires explicit approval for such removal.

## User stories

- A workspace owner can start agent generation from Setup Hub, inspect recommendations and targets, choose agents, and review the finished files even if no four-phase analysis was run.
- A workspace owner can start project guidance generation separately, see how context was obtained, and use or retry the generated prompt without first generating agents.
- A returning user can reopen each workflow's normal chat tab, continue the conversation, and recover a paused generation without losing checkpointed outcomes.
- The backend can reject an unauthorized workspace or analysis path and can decline a stale artifact without blocking generation from current authorized workspace context.

## Acceptance criteria

1. **When** the Setup Hub home is shown, **the system shall** offer distinct agent and project-guidance starts using its existing card/button styles and retain the workspace-analysis start.
2. **When** either action starts from the Hub, old wizard route, or VS Code setup widget, **the system shall** open the main chat surface in VS Code and Electron with a tab bound to that workspace, tagged `setup-agent-generation` or `setup-project-prompt`, and show shared chat input/streaming with specific controls. On reopen it shall restore workflow identity and either persisted conversation or a recovered result/progress view; it need not reconstruct unpersisted live tokens.
3. **When** no analysis exists, **the system shall** gather current authorized workspace context for the selected generator, allow generation to proceed, and show that workspace discovery supplied the context.
4. **When** the requested analysis is missing, older than the latest run, stale, incomplete, unreadable, outside the tab workspace, or freshness lookup fails, **the system shall** ignore both its phase files and any client `analysisData`, use current workspace discovery, and show the mapped reason from the freshness table. Both generator RPCs shall return or expose enough source/status information for that message; a foreign directory is rejected before fallback.
5. **When** the latest completed analysis passes freshness and workspace checks, **the system shall** let both generators consume only that verified run's directory and matching client analysis data, identify the run used, and avoid rerunning the four phases.
6. **When** no trusted analysis is available for recommendations, **the system shall** accept an explicit workspace-catalog request with no analysis payload, bind it to the authorized tab workspace, and return the same agent IDs, categories, and score-100 static catalog currently returned for multi-phase input by `wizard:recommend-agents`. It shall still show selection, community packs, and target preview; agent content generation shall gather current workspace facts separately.
7. **When** previewed definite target paths change before confirmation, **the system shall** require renewed confirmation; **when** confirmation succeeds, it shall preserve current validation/fallback and write behavior and report written, unchanged, failed, and rejected **sections** distinctly.
8. **When** an agent generation is cancelled, fails, or is interrupted, **the system shall** stop or recover the run using its existing checkpoint semantics, retain completed files/outcomes, and expose resume or per-item retry where applicable.
9. **When** independent agent generation completes, **the system shall** show its completion data and offer a separate project-guidance start without starting it implicitly. **When** the user follows the existing wizard's combined flow, **the system shall** retain its agent-to-guidance continuation as two distinct workflows. The UI shall recommend running project guidance first when the user wants agents to consume it, since agents capture saved guidance at submit time.
10. **When** project-guidance generation starts with no trusted analysis, **the system shall** derive its project type, stack, dependencies and relevant guidance inputs from the authorized workspace, generate a prompt, and show a result/summary or actionable failure.
11. **When** project-guidance generation succeeds, **the system shall** persist its trace before marking success, retain generated state/cache/enablement behavior, and allow retry/regeneration; skipping it shall not prevent agent completion.
12. **When** a user opens a saved analysis or an existing analysis run, **the system shall** retain browse/load, phase result, and analysis resume/cancel access independently of either generation workflow.
13. **When** the tab workspace differs from the workspace resolved by the host RPC, or a foreign analysis directory is supplied, **the system shall** reject the start before reading analysis or writing output; the generator workspace shall equal the tab workspace in both VS Code and Electron.
14. **When** a generation's stream ends without successful agent checkpoint/finalization or prompt trace/state write, **the system shall** show failure or retry instead of success. On tab reopen it shall recover completed outcomes and current state from persisted chat history or checkpoint/result state, whichever the architect chooses.
15. **When** both generators start in one workspace, **the system shall** allow both workflows to progress independently. A second start of the same active workflow shall focus/show its running tab rather than a raw lock error. A start for another workspace while that generator's process-wide lock is held shall show a clear blocked/running state and shall not bind to the first workspace's run.
16. **When** project guidance is saved before agent submit, **the system shall** record whether that guidance was consumed in agent completion data; guidance created after submit shall not be claimed as used by that run.
17. **When** a pre-split generation checkpoint exists without a chat tab, **the system shall** query `wizard:get-resumable-run` on first agent-workflow open, offer resume there, bind or create its workflow tab, and preserve completed outcomes. **When** a persisted `setup-wizard` view or old VS Code panel opens, **the system shall** show a working entry to analysis and the two workflows.
18. **When** the user presses Stop in an active project-guidance tab, **the system shall** request cancellation of the backend run, stop further progress, avoid marking an unfinished trace/state successful, and show a cancellable or retryable outcome. Reopening shall show the last committed prompt state and the cancelled run status.
19. **When** a user selects provider or model for either workflow, **the system shall** show the effective selection before submit and persist the model with the run/checkpoint; reopening or resuming shall use that selection unless the user changes it explicitly.
20. **When** an agent item retry is offered, **the system shall** retain the current three-attempt cap, duplicate-retry guard, remaining-attempt display, and exponential delay; successful items shall not be retried.

## Freshness definition proposal

Use `AnalysisFreshnessService.getStatus` as the shared gate (`analysis-freshness.service.ts:48-90,93-206`). It selects the **latest run by `analyzedAt` only**; an older saved analysis is not trusted even if independently intact. The latest run must have a readable supported manifest for the authorized workspace, completed lifecycle and four verified phase outputs, age no more than seven days measured from **`manifest.updatedAt`** (`:170-174`), current workspace fingerprint (`:176-182`), and matching phase-file hashes (`:183-205`). Both RPCs must compare any requested directory to this latest fresh directory and gate client `analysisData` with the same result. A source/status contract to the UI is required, because the agent submit response does not provide it today (`wizard-generation-rpc.handlers.ts:335-355`). Missing or failed checks use workspace discovery; unauthorized foreign paths are rejected.

| Freshness result / case | User message |
| --- | --- |
| `no-analysis` | No saved analysis found. Gathering current workspace context. |
| `unreadable` | Saved analysis could not be read. Gathering current workspace context. |
| `legacy-v3` | Saved analysis uses an older format. Gathering current workspace context. |
| `incomplete` | Saved analysis is incomplete. Gathering current workspace context. |
| `expired` | Saved analysis is too old. Gathering current workspace context. |
| `workspace-changed` | Workspace changed since analysis. Gathering current context. |
| `output-mismatch` | Saved analysis files no longer match. Gathering current workspace context. |
| Requested analysis is not the latest run | Selected analysis is not the latest. Gathering current workspace context. |
| Freshness lookup failed | Analysis status is unavailable. Gathering current workspace context. |
| `ok` (fresh) | Using the latest verified workspace analysis. |

The table is a user-facing mapping, not an exposure of raw paths or exceptions. A later manifest-version redesign belongs to 651. A second age threshold and model-change invalidation are lane proposals, recorded below.

## Self-gather behavior

- **Agents:** `orchestrator.service.ts:372-410` detects project type/frameworks and builds `AgentProjectContext` without precomputed analysis before selecting templates. This is distinct from `wizard:recommend-agents`, which currently throws on absent input and returns an all-score-100 static catalog for `isMultiPhase: true` (`setup-rpc.handlers.ts:502-648`). The no-analysis recommendation input contract is an explicit `{ source: 'workspace-catalog' }` request scoped by the authorized tab workspace; it returns that same catalog, without fabricating a `ProjectAnalysisResult` or pretending analysis exists. Existing multi-phase input remains supported. Preview and generation target the same workspace. Agent `analysisData` is passed only for a matching fresh directory (`wizard-generation-rpc.handlers.ts:980-992`).
- **Project guidance:** `enhanced-prompts.service.ts:425-495` gathers project/workspace information, language mix, dependencies, monorepo signals and configuration for `PromptDesignerInput`; `:496-500,980-1014` optionally adds verified phase context. Today `enhanced-prompts-rpc.handlers.ts:248-348` also accepts client `analysisData`, builds `preComputedInput`, and skips discovery without checking freshness. Gate that input on the same fresh latest matching analysis result, or ignore it and invoke discovery; retain prompt trace and state ordering (`:541-574`).
- In both flows, bind the RPC's authorized workspace to the tab workspace; reject a mismatch. User steering in chat may add context, but output persistence still uses the generator's validated finalization path.

## Non-functional constraints

- Every generation and analysis-directory request must be bound to an open authorized workspace, as `wizard-generation-rpc.handlers.ts:251-263` and `enhanced-prompts-rpc.handlers.ts:223-243` require.
- Cancellation must stop active work and prevent a late completion from advancing state; agent checkpoint/resume and per-item retry must continue to expose already committed outcomes (`wizard-generation-run.supervisor.ts:172-298`; `wizard-generation-checkpoint.service.ts:126-168,241-314`). Project-guidance Stop needs a backend cancellation path because `enhanced-prompts-rpc.handlers.ts:76-81,107-125` registers none today.
- Existing generated agent files, manifest records, prompt trace, and prompt state must not be discarded or overwritten by merely opening/reopening a tab or by freshness fallback. A generated output is reported successful only after its existing validation/write or trace/state boundary completes.
- Angular workflow surfaces use the repository's standalone, OnPush, signal/store and RPC message-handler patterns. Chat text and errors must use the shared safe rendering path.

## UI impact

The Setup Hub home receives action wiring and labels using its existing card/button styles and layout. Internal wizard pages **do** change: the forced step indicator/landing (`wizard-view.component.ts:83-134`) becomes a choice of independent workflows; agent selection/generation/completion and prompt enhancement/result work as adjacent panels around main-chat tabs; a status view explains fresh analysis versus workspace discovery. The old VS Code panel and persisted wizard route remain working entry points and route generation into main chat. This requires a designer phase and visual review for internal pages. Preserve analysis result pages pending task 651.

## Dependency on PR #736

**Conditional yes.** The required `Tab.workflow` and `ptah-session-embed` are already in the 648 base (`libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:34-47`). A wizard-local tab adapter or bare embed host could reuse the analogous builder-local adapter and `chrome="bare"` host from PR #736, but those pieces are not yet in this branch. If the architect chooses that reuse, implementation must wait for #736 to merge and then integrate `main`; this document does not require the builder sidebar or a redesign of Hub home. No dependency on 649's builder AI actions.

## Stakeholders and risks

Workspace owners need independent starts and accurate results; returning users need resumable tabs and files; extension/desktop hosts need workspace-bound RPCs and correct cancellation. The main risks are a UI path that still requires analysis, the prompt `analysisData` bypass, a VS Code panel opening isolated tabs, cross-workspace run confusion, and chat turns reporting success before generator finalization. Mitigate by exercising missing/stale/fresh and foreign-tab cases through both hosts and entry points, gating all client analysis input, routing generation to main chat, and retaining checkpoint/trace and write-validation success gates. A second risk is divergence from PR #736's embed pattern; resolve it at architecture time after its merge status is known.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Classify as FEATURE, Full, estimate L | REFACTORING or FEATURE; smaller size | Task `decisions.md` D1 and carrier estimate L; new entry points and behavior | Yes |
| Make both generation actions independently startable | Preserve forced scan → generation → enhancement sequence or separate starts | User request; `wizard-view.component.ts:112-132`; `wizard-phase-generation.ts:88-113` | Yes |
| Reuse the existing freshness service; fall back to workspace discovery | Require a completed analysis or reanalyze all four phases | User decision 4; `analysis-freshness.service.ts:147-206`; `orchestrator.service.ts:372-399`; `enhanced-prompts.service.ts:425-500` | Yes |
| Preserve generation finalization and checkpoint/trace semantics beside chat | Treat streamed chat output as committed output | `wizard-generation-checkpoint.service.ts:126-168`; `enhanced-prompts.service.ts:541-574` | Yes |
| Keep Hub home design; redesign internal wizard panels | Redesign Hub home too | Task `context.md` D10/D12 | Yes |
| Defer phase-chat and manifest-schema work | Include it in this task | Task `context.md` scope boundary names 651 | Yes |
| Use existing `setup-agent-generation` and `setup-project-prompt` tags; Hub-home starts reuse current styles | Invent tags or redesign Hub home | `chat-types.ts:873-878`; task `context.md` D10/D12 | Yes |
| Give no-analysis recommendations the existing static catalog through explicit `{ source: 'workspace-catalog' }` input | Require analysis, fabricate `ProjectAnalysisResult`, or score workspace discovery | `setup-rpc.handlers.ts:502-648` already returns the catalog with score 100; orchestrator discovery yields `AgentProjectContext`, not `ProjectAnalysisResult` | Yes |
| Keep agent and prompt execution independent; make duplicate/cross-workspace starts visible, and recommend guidance first when agents should use it | Serialize both generators or imply a late prompt was used | Separate process-wide locks at `wizard-generation-rpc.handlers.ts:240-249` and `enhanced-prompts.service.ts:389-394`; agent prompt captured at `wizard-generation-rpc.handlers.ts:921-936` | Yes |
| Defer chat-history versus checkpoint/result recovery mechanism to architect, with durable outcome and reopening requirements under either model | Mandate chat-session persistence or rely on transient stream | `wizard-generation-rpc.handlers.ts:1021-1037` broadcasts an unpersisted generation stream; checkpoint persists outcomes | Yes |
| Add project-guidance Stop that cancels backend work | Leave Stop inert or hide it | Chat workflow shows Stop; `enhanced-prompts-rpc.handlers.ts:107-125` has no cancel registration | Yes |

## Lane-proposed constraints

The following details were introduced by this lane and are offered for Gate 1 to accept or drop; they are not fixed user decisions: keep the current seven-day freshness threshold without a second age threshold or model-change invalidation; show safe status text without raw paths/errors; bind generator RPC workspace to the authorized tab workspace rather than a chat message or selected analysis directory; end automatic chaining for **independent** starts while retaining the existing wizard continuation; render chat text/errors through the shared safe path; avoid overwriting generated files merely by opening/reopening a tab. The explicit workspace-catalog request shape, guidance-first recommendation, and project-guidance cancellation requirement are also lane choices. Each is reversible; the cited code and ACs above state the reason and observable effect.

## Clarifications Needed

None. The user has fixed the scope and keep-and-fix rule. No user-visible removal is proposed.

## Revision log

| Review item | Resolved in |
| --- | --- |
| 1. Missing parity rows | Parity inventory rows for chat/widget and VS Code panel, provider/model, resume offer, saved analysis hand-off/hide, result buttons, retry cap |
| 2. Drifted rows | Parity inventory validated writes/propagation and completion rows |
| 3. Prompt `analysisData` bypass | Current behavior, In scope 2, AC4-5, Self-gather, parity prompt-input row |
| 4. No-analysis recommendation contract | In scope 3, AC6, Self-gather, Decisions, parity recommendation row |
| 5. Concurrency, migration, hosts, Stop | AC2, AC13, AC15-20, UI impact, Decisions, parity launch/resume rows |
| 6. Freshness semantics/messages | Current behavior, AC4-5, Freshness definition and mapping table |
| 7. Execution model | In scope 6, AC2/14, Decisions, parity transcript row |
| 8. Tags, Hub style, sections | In scope 1, AC1/2/7, UI impact, Decisions |
| 9. Lane proposals | Lane-proposed constraints |
