# Requirements - TASK_2026_714_c8a2

## Revision note (round 1)

Review findings applied in place. Scope is unchanged. No API or architecture was added.

1. Permissions. Decision 3 and requirement 2 preserve the explicitly selected outcome, including a user-selected full-access or never-approval equivalent when one exists and is scoped to that session. Silent elevation stays forbidden. A missing mapping fails visibly and is not a permanent ban.
2. Codex home. Decision 2 and requirement 4 resolve one home per account, session, and workspace context. Host `process.env` is not mutated. Two open workspaces with different homes must not cross credentials or cwd.
3. Legacy lane bypass. Requirement 2.3–2.4 and the parity rows for `danger-full-access` and `approval_policy=never` treat today's hardcoded lane values as a transitional compatibility fact of the existing adapter. Shared lanes honor the requested policy and do not receive that bypass automatically.
4. Unsupported errors. Decision 4, requirement 11, and the parity gap section treat a visible unsupported error as safety behavior only. It is not parity and it is not an approved reduction. The affected stage stays blocked until a native equivalent is verified or the user explicitly approves the reduced capability. No automatic proxy fallback is added.

Attribution: the old "Project-rule" bullets that made the lane bypass and a single universal home into repository rules are removed. Those items are labeled as current implementation facts or author-proposed constraints.

## Revision note (round 2)

Finding 2 now covers same-account, same-`CODEX_HOME` execution isolation. Findings 1, 3, and 4 stay closed as written above. Scope is unchanged. No API or architecture was added. This note does not prescribe one App Server process per Codex home.

Simultaneous workspaces and lanes that share one authenticated account and one Codex home, and that differ in MCP, instructions, cwd, or selected approval/sandbox policy, must not change each other's effective configuration through a reload or a turn. The architect chooses separate processes or an explicit compatibility predicate that is defined and tested before any sharing.

## Context

Electron interactive chat always resolves `IAgentAdapter` to `SdkAgentAdapter`. `apps/ptah-electron/src/di/phase-2-libraries.ts:328` calls `wireAgentAdapterAliases`, and `libs/backend/agent-sdk/src/lib/di/register.ts:942-945` binds `TOKENS.AGENT_ADAPTER` to that class. For an OpenAI Codex workspace, `OAuthProxyStrategy.configureCodexOAuth` (`libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:166-220`) reads file-based Codex auth and starts the Codex translation proxy. `ChatSessionService.launchSdkSession` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:842-918`) and the resume path (`:1573-1618`) then call `startChatSession` / `resumeSession` with a per-workspace `providerProfile`. The profile for a proxy provider pins `ANTHROPIC_BASE_URL` to a pooled local proxy (`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:356-393`). Interactive Codex therefore runs the Claude Agent SDK against that proxy. It does not run the Codex App Server.

Delegated Codex lanes are a second runtime. `CodexCliAdapter.runSdk` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:532-562`) uses `@openai/codex-sdk`, one `codex exec` per turn, `sandboxMode: 'danger-full-access'`, and `resumeThread`. `buildCodexLaneConfig` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts:103-168`) sets `approval_policy=never`, disables user MCP servers, plugins, apps, and skill instructions, and sets `agents.enabled=false`. Those values are hardcoded on the legacy lane adapter today. They are not chat defaults, and they are not the required policy of the later shared lane runtime.

A Codex App Server process already exists for account quota only. `CodexAccountUsageService` spawns `codex app-server`, calls `initialize` and `account/read`, and rejects the read when `codexHome` disagrees with `CodexHomeResolver` (`libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:251-276`, `codex-home-resolver.ts:25`). That client is not a chat runtime. The lane auth helper reads `~/.codex/auth.json` from `HOME` / `USERPROFILE` and does not consult `CODEX_HOME` (`codex-cli.adapter.ts:419-421`).

The user asked for internal provider routing to the native Codex App Server, shared later by Electron main chat and delegated lanes, with the Claude Agent SDK left in place and no new runtime selector. This document is the planning boundary. It does not choose protocol methods, classes, or file layout.

Line references were taken from this worktree (`feat/codex-sdk-main-chat`). Ptah symbol tools were not registered in this lane, so the reads were direct. `origin/main` has moved since the worktree base; this inventory does not rebase.

## Classification

- Type: FEATURE — the task contract type. The user asked for a new native execution route for Codex chat, later shared with lanes, not a bug fix in the proxy.
- Estimate: XL — the contract scale is XS, S, M, L, XL. The outcome crosses interactive chat, account identity, permissions, and a later lane runtime, while non-Codex providers must keep the Claude SDK path. One subsystem would be L; both surfaces plus the Claude boundary make it XL.
- Priority: not defined here. Neither the user nor the task contract states a priority scale.

## Constraint sources

### User-requested

- Route Codex so main chat uses the native App Server, not an SDK-first or translation-proxy-first chat implementation.
- One shared configuration and execution story for main chat and, eventually, delegated lanes, rather than a permanent second SDK/proxy path.
- Leave the working Claude Agent SDK in place.
- Do not add a runtime-selector control.
- Permissions, effort, authentication and account isolation, MCP, skills and instructions, streaming, interruption and resume, usage, subagent controls, and compaction must not become weaker or quieter.
- Where a Claude capability has no Codex equivalent, say so. Do not pretend it still works. Saying so is required safety behavior. It does not accept the loss of that capability (Decision 4).
- Electron first. This phase is planning only.
- Lane MCP, skill, plugin, and agent suppression stay on lanes. Chat must not inherit them (`context.md` preflight). This does not make the lane approval bypass a required future policy (Decision 3).

### Current implementation facts

These describe this worktree. They are not user-selected future policy.

- `buildCodexLaneConfig` hardcodes `approval_policy=never`, and `CodexCliAdapter.runSdk` hardcodes `sandboxMode: 'danger-full-access'` (`codex-lane-config.builder.ts:129`, `codex-cli.adapter.ts:559`). That is the legacy lane path's current behavior.
- `CodexHomeResolver` is a cached singleton built from process environment, and its path does not change after construction (`codex-home-resolver.ts:15-26`). It cannot by itself represent two accounts at once.
- `CodexAccountUsageService` speaks only `initialize` and `account/read`, and its home check compares that process with the resolver (`codex-account-usage.service.ts:251-276`). That check is not evidence that every workspace must share one account.

### Planning constraints (orchestration brief)

- Verification of later code stays on changed projects. No workspace-wide build, serve, or e2e from this plan. Nx `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time.
- No commits, pushes, or git cleanup from this planning task.
- The native-loop worktree is not part of this work.
- TUI and VS Code get no feature polish. Shared-code changes must not break those hosts.
- No capability is removed, and no approval semantic becomes weaker than the one the user selected, without an explicit user approval. This document authorizes none. A visible unsupported error is not that approval.
- Duplicate Codex chat execution paths are replaced only after Electron uses the native path and no supported caller remains. Stage 3 still needs a caller audit and a separate user approval before any deletion.

### Author-proposed design constraints

These are choices made while correcting this document. They are not repository project rules and they do not choose protocol methods or file layout.

- Do not treat `CodexAccountUsageService` as the chat execution API, and do not treat it as evidence that thread, turn, permission, image, compaction, or steer methods exist. Research has to establish those methods from the App Server protocol. Reusing the quota process is an architecture choice, not a requirement.
- A missing native mapping fails visibly and does not claim the setting applied. That failure does not roll out the affected stage and does not ban a later valid mapping (Decision 4, requirement 11).
- The legacy lane bypass stays only on the existing legacy adapter while that adapter remains callable. The shared layer does not adopt it as its policy (requirement 2).
- Each account, session, and workspace context carries its own Codex home. The host process environment is not the switch (requirement 4). Sharing one home does not allow those contexts to change each other's effective MCP configuration, instructions, cwd, or selected approval/sandbox policy (requirement 4.7).

## Scope

In scope:

- Requirements for Electron interactive sessions whose workspace provider is OpenAI Codex to execute on the native App Server.
- Requirements for a later stage in which delegated Codex lanes use that same execution and configuration story.
- Parity for permissions and approvals, model and effort, account and `CODEX_HOME`, workspace routing, MCP and skills and instructions, streaming and tools and images, cancellation and steer and resume, usage and compaction and subagents, and the Claude regression boundary.
- Same-home execution isolation: simultaneous workspaces and lanes on one authenticated account and one Codex home, with distinct MCP, instructions, cwd, or selected approval/sandbox policy, do not change each other's effective configuration through a reload or a turn (requirement 4.7).
- An explicit gap when a current behavior has no demonstrated Codex equivalent.
- Staging: Electron chat first; lanes second; deletion of an unused proxy or per-turn SDK exec only after a caller audit.

Out of scope:

- Choosing protocol methods, new types, class names, or file layout — software-architect after research. That choice includes separate App Server processes or a tested compatibility predicate for sharing. It does not include a requirement of one process per home.
- Implementing or editing application code in this task — planning only.
- A new settings control, model-picker entry, or other UI that lets a person choose "SDK" versus "App Server" — the user forbade a runtime selector. Provider choice stays the existing provider setting.
- TUI and VS Code feature work — Electron is the host that must show the native Codex path. Other hosts only need to keep working.
- Changing Claude, Copilot, Ollama, LM Studio, OpenRouter, or other non-Codex providers onto the App Server — they keep their current runtimes.
- Copying lane budgets (`model_auto_compact_token_limit` default 120000, `tool_output_token_limit` default 2500) onto interactive chat — those numbers are lane defaults, not a chat contract.
- Enabling mid-turn steer on lanes — lanes advertise `steer: false` and `interrupt: false` (`codex-cli.adapter.ts:354-360`). This task does not add that capability.
- The native-loop worktree and any in-flight loop experiment — a different line of work.
- Rebasing this worktree onto current `origin/main` — required before implementation, not during this inventory.
- Removing the translation proxy, `@openai/codex-sdk` lane client, or Claude SDK — no removal is authorized. See Proposed Removals in the parity inventory.

## Decisions

1. Electron Codex chat moves to the native App Server before lanes do.
   Options: ship chat and lanes together; ship lanes first; ship Electron chat first.
   Evidence: the user said Electron first and "eventually" for delegated lanes (`context.md`).
   Reversible: yes, until the first implementation stage starts. After chat ships, lanes can still stay on `CodexCliAdapter` until stage 2.

2. Each account, session, and workspace execution context uses one Codex home consistently for auth, execution, and usage. Different contexts may use different homes at the same time. The native session profile carries that home. The host process environment is not mutated to switch it.
   Options: one process-wide home; a home per account/workspace context; the lane helper's unconditional `HOME`/`USERPROFILE` `.codex/auth.json`.
   Evidence: the user asked for authentication, account isolation, and workspace context (`context.md`). `CodexHomeResolver` is a process-env singleton (`codex-home-resolver.ts:15-26`) and the usage client's `samePath` check only compares that one client with the resolver (`codex-account-usage.service.ts:264-275`). Those are current limits, not a requirement that every workspace share an account. The lane helper at `codex-cli.adapter.ts:419-421` ignores `CODEX_HOME` today.
   Reversible: yes. How a context's home is chosen can change. Dropping per-context isolation would need a new user decision.

3. The native route preserves the permission outcome the user selected for that session. It never silently applies `approval_policy=never`, `bypassPermissions`, or `danger-full-access` when the user did not select that outcome. When the user did select a full-access or never-approval outcome and a native equivalent exists, that equivalent is applied only to that session. Where no equivalent exists yet, the turn fails visibly and does not claim the setting applied. That absence is not a ban on a later valid mapping.
   Options: preserve the selected outcome, including a real full-access equivalent when the user selected it; forbid every full-access mapping forever; copy the legacy lane bypass into every Codex turn.
   Evidence: `sdk-query-options-builder.ts:772-778` maps `yolo` to SDK mode `default` so `canUseTool` still runs (`sdk-permission-handler.ts:503-520`). That is today's `yolo`, not a denial of every user-selected broad outcome. The lane values at `codex-cli.adapter.ts:559` and `codex-lane-config.builder.ts:126-134` are hardcoded and were not selected per turn. The user asked to preserve configurable permissions, not to remove a legitimately selected full-access outcome.
   Reversible: yes, for which native mode maps to which selected level, once research verifies the mapping. Silent elevation is not reversible by an implementer.

4. If the native runtime cannot apply a requested permission level, effort, attachment, interrupt, compaction, or subagent control, it fails visibly and does not proceed as though the request was honored. That error is safety behavior. It does not remove the capability, does not satisfy parity, and does not approve a reduced capability. The stage that owns the capability does not roll out until a native equivalent is verified or the user explicitly approves the reduction. No automatic translation-proxy fallback is added. This document does not approve any reduction.
   Options: block the affected stage until an equivalent is verified or the user approves the reduction; add an automatic proxy fallback; treat a visible error as stage completion.
   Evidence: requirements 1.1 and 1.3 keep Codex chat turns off the proxy. The user required those controls preserved (`context.md`). No user approval of a reduced capability is in this task.
   Reversible: the block lifts when research verifies an equivalent or the user approves that reduction. The fallback option stays closed unless the user later asks for it.

5. The Claude Agent SDK remains the implementation for every non-Codex provider. Codex does not get a user-visible runtime switch.
   Options: always SDK; provider-selected native Codex with Claude unchanged; a selector.
   Evidence: `phase-2-libraries.ts:328` and `register.ts:942-945` are the current single binding. The user required both "unchanged Claude" and "no runtime selector".
   Reversible: adding a selector later would be a new product decision.

6. Stage 3 may delete the Codex translation proxy or the per-turn SDK exec path only after a caller audit shows no remaining caller. Stage 1 and stage 2 do not delete them.
   Options: delete in the same change that adds App Server chat; keep until unused; keep forever.
   Evidence: project rule against silent removal. Lanes still call the SDK exec path today. Copilot still uses the OAuth proxy strategy (`oauth-proxy.strategy.ts:4-6`).
   Reversible: yes, until a deletion change is actually made.

7. Simultaneous contexts that share one authenticated Codex account and one Codex home do not change each other's effective configuration. The architect chooses the mechanism. This decision does not prescribe one App Server process per home.
   Options: separate App Server processes for contexts that differ in effective configuration; one shared process only where an explicit compatibility predicate is defined and tested. One process per home is not a permitted choice: two contexts can share a home and still differ in effective configuration.
   Evidence: `research-report.md` records that a home separates accounts but not workspace or lane policy, and that MCP reload is process-wide. Requirements 4.1-4.6 isolate different homes, credentials, and cwd. They do not stop two contexts on the same home from changing each other's MCP, instructions, cwd, or selected approval/sandbox policy through a reload or a turn.
   Reversible: the mechanism is reversible until implementation of that stage. The isolation outcome is not. One process per home is not the requirement. It is insufficient when two contexts share a home and differ in effective configuration.

## Requirements

### 1. Codex interactive execution

Requirement: Electron main chat, when the session's workspace provider is OpenAI Codex, runs that session on the native Codex App Server and produces the same chat stream the webview already consumes.

Acceptance criteria:

1. When an Electron chat session starts or resumes for a workspace whose resolved provider is OpenAI Codex, the system shall execute the turn through the native App Server path and shall not send that turn through the Codex translation proxy or the Claude Agent SDK.
2. When the resolved provider is not OpenAI Codex, the system shall keep the current `SdkAgentAdapter` path, including Copilot and other translation-proxy providers.
3. When the App Server process cannot start, exits before the turn is accepted, or returns an auth failure, the system shall surface a user-visible error and shall not fall back to the translation proxy for that turn.
4. When this stage is complete, the existing provider setting is the only control that selects Codex versus another provider. The system shall not add a runtime-selector setting or control.

### 2. Permissions and approvals

Requirement: a Codex session preserves the permission outcome the user selected for that session. The system never silently elevates. A user-selected full-access or never-approval outcome is honored when a scoped native equivalent exists. The legacy lane bypass is not the policy of shared lanes.

Acceptance criteria:

1. When a Codex interactive session is at `ask`, `plan`, `auto-edit`, or `yolo`, a tool that today waits on `canUseTool` (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:490`, mode mapping `sdk-query-options-builder.ts:772-777`) shall either wait for the same user decision or, for `yolo` and `auto-edit`, auto-approve only the tool classes those levels already auto-approve. Today's `yolo` still goes through `canUseTool`. That fact does not forbid a different level the user explicitly selected as full access.
2. When the user has explicitly selected a full-access or never-approval outcome and a native equivalent exists, the system shall apply that equivalent only to that session. When the selected level is not that outcome, the system shall not apply `approval_policy=never`, `bypassPermissions`, or `danger-full-access`. When no equivalent exists for the selected level, the system shall fail visibly and shall not claim the setting applied. That absence is not a permanent ban on a later valid mapping. The visible failure alone does not complete the affected stage (requirement 11).
3. When the existing legacy `CodexCliAdapter` path is still the caller, that path may still pass its current hardcoded `sandboxMode: 'danger-full-access'` and `approval_policy=never` (`codex-cli.adapter.ts:559`, `codex-lane-config.builder.ts:129`). That is transitional compatibility for the legacy adapter, not the required policy of stage 2.
4. When the shared execution and configuration layer runs a lane, it shall represent that lane's selected policy separately from the chat session's selected policy, shall honor the policy the lane requested, and shall not automatically grant the legacy bypass to a newly created or shared-lane execution. The legacy bypass remains only where the existing legacy lane path still requires it. One side's policy shall not overwrite the other.
5. When `setSessionPermissionLevel` is invoked for a live Codex session (`sdk-agent-adapter.ts:1814-1825`), a later tool call in that session shall observe the new level, or the call shall fail visibly without leaving the previous level claimed as changed. A visible failure does not complete the affected stage by itself (requirement 11).

### 3. Model and effort

Requirement: the chat's selected model and reasoning effort are the model and effort the Codex turn uses. Lane defaults do not replace them.

Acceptance criteria:

1. When Electron starts or resumes a Codex chat with a selected model (`chat-session.service.ts:853-854` and `:1570-1571`), the system shall run that model, or fail the turn visibly, and shall not substitute the lane default `gpt-6-sol` (`codex-cli.adapter.ts:372`).
2. When the user sets an effort on start, resume, or `setSessionEffort` (`agent-adapter.types.ts:345-352`, `chat-session.service.ts:897` and `:1600`, `sdk-agent-adapter.ts:1841-1845`), the system shall apply that effort for later turns or fail visibly. It shall not start the turn on a different effort.
3. When effort is cleared (`undefined`), the system shall return to the provider default rather than keep a stale override.
4. When a lane names its own model and an effort in `low`, `medium`, `high`, or `xhigh`, the lane stage shall preserve that lane selection (`codex-cli.adapter.ts:66`, `codex-lane-config.builder.ts:131-133`). An unknown lane effort shall keep today's behavior of omitting the override until the lane stage explicitly changes it.
5. When `setSessionModel` is invoked for a live Codex session, the next turn shall use the new model or the call shall fail visibly.

### 4. Account, auth, and CODEX_HOME

Requirement: each account, session, and workspace execution context uses one resolved Codex home for auth, execution, and usage. Contexts do not share a universal home. A missing or stale login still blocks that context's session. Contexts that share one home still do not change each other's effective MCP configuration, instructions, cwd, or selected approval/sandbox policy.

Acceptance criteria:

1. When a context has a Codex home, auth material, the App Server usage read for that context (`codex-account-usage.service.ts:269-271`), and Codex execution for that context shall all use that same home.
2. When two workspaces are open at the same time with different Codex homes or accounts, each context shall keep its own home, credentials, and cwd. A turn in one shall not read the other's credentials or cwd.
3. When the user is not authenticated for that context, or that context's Codex token is stale, Electron shall still refuse to start a Codex chat for that context with a visible re-login error, matching today's `configureCodexOAuth` refusal (`oauth-proxy.strategy.ts:174-198`).
4. When that context's home has no usable credentials, the system shall not start a turn with another account's credentials from a different home.
5. When a lane still uses `CodexCliAdapter` before the lane stage, its credential read for that context shall use the same home as that context's usage and execution, not an unconditional `HOME`/`USERPROFILE` `.codex/auth.json` (`codex-cli.adapter.ts:419-421`).
6. The native session profile shall carry the home for that context. The system shall not mutate host `process.env`, including `CODEX_HOME`, to switch accounts or homes.
7. When two execution contexts are active at the same time, share one authenticated Codex account and one Codex home, and differ in MCP overrides, instructions, cwd, or selected approval/sandbox policy, neither a configuration reload nor a turn in one context shall change the other's effective MCP configuration, instructions, cwd, or selected approval/sandbox policy. The contexts are two Electron workspaces, a workspace and a lane, and two lanes. The architect shall meet this by separate App Server processes, or by an explicit compatibility predicate that states when sharing a process is allowed and that this test covers. Sharing without that tested predicate shall not occur. This criterion does not require one process per home. A test that only opens two different homes does not satisfy it. Two workspaces satisfy it in stage 1. A workspace and a lane, and two lanes, satisfy it in stage 2.

### 5. Workspace routing and isolation

Requirement: a chat session runs as the provider of its own workspace folder, inside an authorized folder, even when another workspace is focused.

Acceptance criteria:

1. When two workspaces are open and only one of them is Codex, a session for the Codex workspace shall use Codex, and a session for the other workspace shall use that workspace's provider (`active-provider-resolver.ts:51-63`, `chat-session.service.ts:867-876` and `:1574-1581`).
2. When the session folder and the focused workspace differ, resume and continue shall use the session folder (`chat-session.service.ts:939-942`), not the focused root.
3. When `workspaceRoot` or `cwd` is outside an open folder, or the cwd fails the existing unsafe-workspace check, the system shall refuse with the current access-denied outcome (`chat-session.service.ts:803-829`) before any App Server turn starts.
4. When the workspace provider cannot be resolved, the system shall return the current auth-required failure and shall not run the turn on the process-global provider.
5. When a Codex session no longer needs a translation-proxy URL, the system shall still isolate that session from another workspace's credentials and working directory.
6. When two Electron workspaces are open with different Codex accounts or homes, their sessions shall be able to run without credential or cwd crossover and without a change to host `process.env` (requirement 4.2 and 4.6).

### 6. MCP, skills, and instructions

Requirement: interactive Codex keeps the MCP servers, skills, and instructions the chat session already supplies. Lane suppression stays on lanes. A same-home context shall not replace another active context's MCP servers or instructions.

Acceptance criteria:

1. When a Codex chat starts or resumes with enhanced prompts, a system prompt, output style, or MCP server overrides (`chat-session.service.ts:845-911` and `:1553-1611`), those inputs shall be in effect for that turn, or the turn shall fail visibly. They shall not be silently dropped.
2. When the chat `.mcp.json` registration is absent, resume shall keep today's behavior of continuing without MCP and logging that fact (`chat-session.service.ts:943-957`), not crash and not pretend MCP is connected.
3. When a Codex chat runs, the system shall not apply the lane keys `agents.enabled=false`, `features.plugins=false`, `features.apps=false`, `skills.include_instructions=false`, or the user-MCP `enabled=false` table (`codex-lane-config.builder.ts:103-141`).
4. When a lane runs, those lane restrictions shall remain in effect for the lane until a reviewed lane change says otherwise.
5. When a lane resumes a thread, role text shall still be present on the resumed turn for as long as `CODEX_RESUME_RESENDS_ROLE` is the lane behavior (`codex-lane-config.builder.ts:42` and `:165-168`). Research has not shown whether Codex replaces or appends that text. The lane stage shall not change that resend behavior until that fact is known, and it shall not duplicate the role into an ever-growing instruction without that finding being recorded.
6. When two same-home contexts named in requirement 4.7 supply distinct MCP overrides or instructions, a reload, including a process-wide MCP reload, or a turn in one shall leave the other's effective MCP servers and instructions unchanged. Requirement 4.7 is the acceptance test for that outcome and for cwd and selected approval/sandbox policy. The architect chooses separate processes or a tested compatibility predicate there. This criterion does not require one process per home.

### 7. Streaming, tools, and images

Requirement: a Codex chat turn still produces ordered user-visible text, tool activity, and errors on the existing webview stream, and image or file attachments are honored or rejected.

Acceptance criteria:

1. When a Codex turn produces assistant text, a tool call, or a failure, the system shall deliver that outcome on the stream `streamEventsToWebview` already consumes (`chat-session.service.ts:913-918`).
2. When the native runtime emits no partial deltas, the completed turn shall still contain the final assistant text, and the system shall not report partial streaming as available for that turn. Claude sessions shall keep `includePartialMessages` (`agent-adapter.types.ts:194-199`). Missing Codex partials are a safety disclosure. They do not by themselves satisfy streaming parity, and they do not complete the affected stage (requirement 11).
3. When the user attaches images or files (`chat-session.service.ts:863-893` and `:1054-1058`), the Codex turn shall include them, or the send shall fail with a visible error and shall not drop the attachment and continue as text-only.
4. When a lane is still on `CodexCliAdapter`, command, file-change, MCP tool, reasoning, and error events shall still map into lane segments (`codex-cli.adapter.ts:140-160` and `:961`).
5. When the native runtime emits a tool or reasoning item the chat UI cannot render, the system shall surface a visible non-secret error or a plain-text representation, and shall not discard the turn without a trace.

### 8. Cancellation, steer, and resume

Requirement: chat interruption and session resume stay at least as safe as today. Lane messaging limits stay explicit.

Acceptance criteria:

1. When a Codex chat follow-up has stop intent under the current autopilot rule, the system shall interrupt the current turn before sending the follow-up, or return the current failure and not send the follow-up (`chat-session.service.ts:1026-1051`).
2. When `interruptCurrentTurn` or `interruptSession` cannot stop a Codex turn safely, the system shall report failure and leave the session recoverable. It shall not start a second concurrent turn for the same session id.
3. When a Codex session is resumed by its session id, the system shall continue that session's conversation and workspace, or fail visibly. It shall not open a new empty thread and present it as the old session (`agent-adapter.types.ts:296-300`, `chat-session.service.ts:1593-1618`).
4. When `endSessionIfTokenMatches` is called with a stale token, the system shall not tear down a newer registration of that id (`agent-adapter.types.ts:311-321`).
5. When a lane is still on the SDK exec path, aborting the lane shall cancel that turn's `AbortSignal` (`codex-cli.adapter.ts:647` and `:674`), and the lane shall keep advertising `steer: false`, `interrupt: false`, and `continuation: true` (`:359-360`). The lane stage shall not advertise steer or mid-turn interrupt unless the runtime actually provides them.
6. When a lane turn on the exec path receives `turn.completed` or `turn.failed`, the lane shall become idle without waiting for process exit. The Windows case where `codex.exe` outlives stdout (`codex-cli.adapter.ts:750-766`) shall keep that early completion until the exec path is retired.
7. When rewind needs a live session (`chat-session.service.ts:1407-1436`), a Codex session shall resume that same session or return the existing error. It shall not rewind a different workspace's session.

### 9. Usage, compaction, and subagents

Requirement: reported usage stays honest, compaction behavior is either preserved or named as a gap, and Claude subagent controls are not claimed on Codex unless they exist.

Acceptance criteria:

1. When a Codex turn completes and the runtime reports token counts, the system shall record input and output counts on the existing stats path. When the runtime also reports cached input, the system shall record that as cache read. The system shall not invent `cache_creation` counts the runtime did not send.
2. When the runtime sends no usage, the system shall omit usage rather than write zeros that look like a measured empty turn. Claude `message_start` zeros on the proxy path are not a native-path requirement.
3. When a Codex chat compacts, and the runtime emits a compaction boundary, the system shall surface that boundary through the existing compaction callback channel (`agent-adapter.types.ts:360`). When the runtime does not emit one, the system shall not fake a compaction event and shall not claim compaction worked. That disclosure does not remove compaction and does not complete the stage that owns it (requirement 11). The system shall not apply the lane default of 120000 tokens to interactive chat as part of this task.
4. When a lane is on the lane stage, its configured `model_auto_compact_token_limit` and `tool_output_token_limit` (`codex-lane-config.builder.ts:61-64` and `:109-124`) shall still be applied to the lane, or the lane shall fail visibly. Zero shall still mean "omit the key", as today.
5. When the provider is Claude, subagent listing, background-agent listing, and interrupted-subagent context injection shall keep working (`chat-session.service.ts:1020-1025` and `:1372-1394`).
6. When the provider is Codex and research has not shown an equivalent of those subagent controls, the system shall not report a Codex subagent as started, running, or interrupted. Claude controls shall remain available for Claude sessions in the same app. The negative report is safety behavior. It does not remove the control and does not complete the stage that owns it (requirement 11).

### 10. Claude and non-Codex regression boundary

Requirement: any session whose provider is not OpenAI Codex keeps today's runtime, proxy, and permission behavior.

Acceptance criteria:

1. When the provider is Anthropic direct (`apiKey` or `claudeCli`, `active-provider-resolver.ts:30-31`), a chat start shall still go through `SdkAgentAdapter` and shall not spawn the Codex App Server for that turn.
2. When the provider is GitHub Copilot or another non-Codex proxy provider, `OAuthProxyStrategy` shall still start that provider's translation proxy (`oauth-proxy.strategy.ts:150-159` for Copilot). Changes to the Codex branch shall not stop that proxy.
3. When a Claude session uses permission prompts, partial messages, effort, MCP overrides, slash commands, or rewind, those behaviors shall stay on the Claude SDK path.
4. When Electron, the CLI host, and the VS Code host compose `TOKENS.AGENT_ADAPTER`, a non-Codex resolution shall still be the Claude SDK adapter. This task does not require those other hosts to grow Codex App Server UX.

### 11. Staged delivery

Requirement: the work lands in three observable stages. Later stages do not start by deleting the earlier path.

Acceptance criteria:

1. Stage 1 is complete when Electron Codex chat meets requirements 1 through 10 for the interactive surface, every necessary interactive capability in those requirements has a verified native equivalent or an explicit user approval of the reduction (criterion 5), and delegated lanes still pass their current legacy-adapter tests on `CodexCliAdapter`. A visible unsupported error does not meet this criterion.
2. Stage 2 is complete when a delegated Codex lane and an Electron Codex chat can both run on the shared execution story, the lane's selected policy and the chat's selected policy stay distinct (requirements 2.4, 6.3, 6.4, and 8.5), and the shared lane honors the policy it was given rather than the legacy hardcoded bypass. Same-home workspace-and-lane and lane-and-lane isolation in requirement 4.7 and requirement 6.6 holds. Necessary lane capabilities follow criterion 5.
3. Stage 3 is complete only when a caller audit lists no remaining production caller of the Codex translation proxy and, separately, of per-turn `codex exec` through `@openai/codex-sdk`, and a user approval covers any deletion. Until that audit, both implementations shall remain callable.
4. When stage 1 ships, a Codex chat and a Claude chat in one Electron session shall be able to run one after another without a restart and without a new selector. Two Codex workspaces with different homes shall also be able to stay open together (requirement 4.2). Two Codex workspaces that share one home and differ in MCP, instructions, cwd, or selected approval/sandbox policy shall keep those effective settings isolated across a reload and across turns (requirement 4.7).
5. When a necessary capability in requirements 2 through 9 has no verified native equivalent, the system shall fail visibly or record the gap instead of reporting a false success. That result shall not be treated as the capability being preserved. Rollout of the stage that owns the capability stays blocked until a native equivalent is verified or the user explicitly approves the reduced capability. This document does not approve any reduction. The system shall not add an automatic translation-proxy fallback to cover the gap. A retained path may stay only when it preserves the capability and does not misrepresent which runtime served it. Keeping the legacy lane adapter callable during stage 1 is that kind of retained path for lanes. It is not a proxy fallback for Codex chat.

## Non-functional requirements

- Security: a Codex turn shall not include auth tokens, proxy tokens, or `auth.json` contents in user-visible errors or lane warning text. Unauthorized workspace paths shall be refused before a turn starts (requirement 5.3). Approval shall not silently widen beyond the outcome the user selected (requirement 2). Host `process.env` shall not be mutated to switch Codex homes (requirement 4.6). Two same-home contexts shall not change each other's effective MCP configuration, instructions, cwd, or selected approval/sandbox policy through a reload or a turn (requirement 4.7).
- Compatibility: non-Codex providers stay on their current runtimes (requirement 10). While the lane exec path exists, a completed Windows lane turn shall not stay running after `turn.completed` or `turn.failed` (requirement 8.6). TUI and VS Code shall keep their current chat behavior; this task adds no screens there.
- Performance: no new latency budget. None was requested.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Electron user on Codex | Chat uses the native Codex runtime without a new switch, and permissions, effort, attachments, and resume still match what they asked for | A Codex workspace chat runs without the translation proxy; a refused permission or missing image is visible |
| Electron user on Claude or Copilot | No change to how those providers run | A non-Codex chat still uses the Claude SDK or that provider's proxy |
| User of delegated Codex lanes | The legacy adapter keeps its current bypass only while that adapter is the caller. A shared lane uses the policy it was given, stays distinct from chat, and keeps MCP limits and Windows turn completion | Existing legacy-adapter specs stay green in stage 1. Stage 2 shows the lane's requested policy and the chat's selected policy together, without copying the hardcoded bypass onto a new shared lane |
| Account owner | Each workspace or account keeps its own home for usage, login, and execution, including two homes open at once. Two contexts that share one home still keep distinct effective MCP, instructions, cwd, and selected approval/sandbox policy | A context's usage read, credentials, and turn share that context's home. A second workspace's home does not appear in the first, and host `process.env` is unchanged. A same-home pair with different MCP, instructions, cwd, and approval inputs does not change the other through a reload or a turn |
| Reviewer | Every current capability is kept, moved, or listed for approval | `parity-inventory.md` has no authorized removal, and each acceptance criterion is observable |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Chat or a shared lane silently applies `approval_policy=never` or `danger-full-access` when the user did not select that outcome | MEDIUM | HIGH | Requirement 2. Tests show an unapproved `ask` tool does not run, and those modes appear only for an explicitly selected full-access outcome scoped to that session, or on the legacy adapter path. Owner: implementer of stage 1. Reviewer blocks the stage on a miss. |
| Two workspaces share one process-wide home, so one account's credentials or cwd are used for the other | HIGH | HIGH | Requirement 4. A test runs two contexts with different homes at once and checks auth, execution, and usage per context, with no host `process.env` write. Owner: implementer of stage 1. |
| Two same-home contexts share one App Server process, so a reload or a turn changes the other's effective MCP, instructions, cwd, or approval policy | HIGH | HIGH | Requirement 4.7 and 6.6. A test runs two concurrent same-home workspaces, and in stage 2 a same-home workspace and lane, with distinct MCP, instructions, cwd, and selected approval/sandbox policy. Neither a reload nor a turn changes the other. The architect chooses separate processes or a tested compatibility predicate. One process per home is not the requirement. A two-home test does not close this risk. Owner: software-architect for the mechanism; implementer of the stage that owns each pair. |
| A visible "unsupported" error is treated as permission to ship stage 1 without compaction, attachments, interruption, or subagent controls | MEDIUM | HIGH | Requirement 11.5 blocks the affected stage until a native equivalent is verified or the user approves the reduction. No automatic proxy fallback. Owner: orchestrator. This document does not approve the reduction. |
| Rebinding `TOKENS.AGENT_ADAPTER` sends Claude sessions to Codex | MEDIUM | HIGH | Requirement 10 tests a non-Codex start against the SDK adapter and asserts no App Server spawn. Owner: implementer of stage 1. |
| Lane MCP and skill suppression is applied to chat instructions | MEDIUM | HIGH | Requirement 6.3 test: a Codex chat config does not contain those lane disable keys. Owner: implementer of stage 1. |
| Removing the Windows early return while `codex exec` remains leaves lanes `running` | MEDIUM | MEDIUM | Keep the `turn.completed` completion test in `codex-cli.adapter.spec.ts` until stage 3 retires exec. Owner: whoever next edits that adapter. |
| Implementing on a stale worktree base drops or double-applies `main` changes | HIGH | MEDIUM | Orchestrator reconciles this worktree with `origin/main` before the first code stage. This inventory does not rebase. Owner: orchestrator. |

## Open questions

These do not block research. They must be answered before the architect treats a gap as implemented. This lane did not choose a protocol mapping for any of them.

- Which App Server methods cover turn start, tool approval, effort, images, compaction boundaries, subagents, and mid-turn interrupt? Owner: researcher-expert. The quota client's `initialize` and `account/read` are not that list.
- Does Codex replace or append `developer_instructions` on thread resume? Owner: researcher-expert. Lane resend stays as it is until then (`CODEX_RESUME_RESENDS_ROLE`).
- Does the App Server emit a compaction signal the chat can show, and what is its default window? Owner: researcher-expert. Do not copy the lane 120000 default onto chat.
- Which selected permission levels, including a user-selected full-access or never-approval level, have a native equivalent that preserves that selected outcome without granting it to a level the user did not select? Owner: researcher-expert. Until that equivalent is verified, requirement 11 blocks the affected stage. The missing mapping is not a ban on a later valid one.

## Handoff

- Next specialist: researcher-expert.
- Why: the acceptance criteria depend on which App Server operations exist, and this worktree does not contain a chat execution protocol, only an account-usage client.
- After that research is reviewed, software-architect writes the implementation plan. The plan chooses separate App Server processes or an explicit compatibility predicate for sharing, and the same-home test in requirement 4.7 proves the choice. The plan does not prescribe one process per home as the requirement. No application code follows from this document alone.
