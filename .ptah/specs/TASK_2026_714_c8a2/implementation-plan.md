# Implementation Plan - TASK_2026_714_c8a2

## Inputs and constraints

Final revision, round 2, 2026-10-22. Verified source HEAD: `0d5be6dae9fb315d2479baa7c7dd83e6e1dc96e2`. Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/`; task-document references are relative to this task folder. Current-source references use this HEAD, not the older plan's base.

Authority: latest user direction and `context.md:33-35`, then `task-description.md`, `decisions.md`, `parity-inventory.md`, `research-report.md`, and `plan-alignment-audit.md:143-169`. This replaces the former plan. Root CLAUDE.md applies. No UI handoff is needed: no new screen or runtime selector is proposed.

This revision changes only this document. No source change, binary execution, model call, test, build, git mutation or removal has been performed. Protocol names below are research candidates until the spike verifies the installed binary and exact payloads. This is architecture, not runtime certification or implementation approval.

**End state: one Codex App Server implementation, shared by chat, messaging gateways and lanes through three thin consumers.** The proxy and SDK lane paths are temporary migration sources. Gateway and lane migration are required within this plan, not eventual optional work (gateway scope approved in `decisions.md:40`). Claude behavior remains unchanged, including gateway turns. Electron chat rolls out first, gateways next, then lanes; other hosts retain compatible composition and their current interactive chat behavior. Actual deletions remain separate final user approvals with caller audits.

Coordination: TASK_2026_712 PR #808 lands its additive agent-adapter types first. Claim before editing:
- `libs/shared/src/lib/types/agent-adapter.types.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`

Reconcile with merged 712 code before implementation; preserve its account fields. The query builder remains read-only here unless a newly demonstrated input requirement receives a renewed claim/file-owner assignment. No SQLite migration: existing metadata detail JSON carries runtime identity. 0058 is taken by 712; use 0059+ only after demonstrating a real schema need. TASK_2026_715 will supply per-account CODEX_HOME selection through the normalized-home seam; this plan adds no account-selector UI/storage.

## Architecture decision

CREATE `libs/backend/codex-runtime`, Nx name `@ptah-extension/codex-runtime`, tags `scope:extension`, `type:feature`. It owns process lifecycle, protocol manifest/Zod validation, approval state machine, execution profiles, per-home auth contract and usage client, native history/control operations and normalized events. Three consumers:
- `CodexChatAdapter` in agent-sdk implements IAgentAdapter and projects core events into chat events/callbacks.
- `CodexGatewayAdapter` in gateway-chat-bridge supplies gateway context and projects core events into the bridge's stream contract, with an explicit `ApprovalSink` policy; no process/protocol/approval state machine is duplicated.
- `CodexAppServerLaneAdapter` in cli-agent-runtime implements CliAdapter.runSdk/SdkHandle and projects the same events into lane segments. The existing contract names do not imply use of the Codex SDK.

Dependency direction: composition -> auth-providers / agent-sdk / gateway-chat-bridge / cli-agent-runtime -> codex-runtime -> shared/platform-core. Core imports no app, Electron, VS Code, vscode-core, auth-providers, agent-sdk, gateway-chat-bridge or cli-agent-runtime. Auth-providers implements its auth port. Composition supplies IProcessSpawner, resolved executable path and presentation/storage ports. Runtime services do not call container.resolve.

One runtime implementation does not mean one OS process. Use one process per active execution context, including separate usage contexts. Never pool by CODEX_HOME alone. Home, cwd, MCP and instruction policy are immutable for a context; one active turn per context. Same-home contexts cannot affect each other through a process-wide reload. No writes to shared config.toml. End/idle/disposal closes the process and releases pending requests, watchers and timers.

Rejected ownership: auth-providers would conflate execution and credential integration; agent-sdk would couple the other native consumers to the Claude integration package; separate consumer implementations duplicate process/protocol/approval policy. Three immediate consumers justify the new boundary. No native logic is appended to protocol-dispatcher.ts, git-info.service.ts, tab-manager.service.ts or router.ts.

## Codebase evidence

Verified current-source anchors (including evidence carried from the independent audit):

| Evidence | Location | Consequence |
| --- | --- | --- |
| Chat resolves profiles before start/resume | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:872`, `:1578` | Select runtime before acquiring credentials/proxies. |
| Workspace resolver acquires pooled proxy | `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:99`, `:362` | A guard only in OAuthProxyStrategy is insufficient. |
| Shared alias and Electron wiring | `libs/backend/agent-sdk/src/lib/di/register.ts:942`; `apps/ptah-electron/src/di/phase-2-libraries.ts:300` | Route by session identity; old Electron :328 is stale. |
| Other hosts share alias | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:270`; `libs/backend/cli-engine/src/lib/container.ts:770` | Host-scoped capability, not global native activation. |
| Live controls use concrete SDK; YOLO maps to bypassPermissions | `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:81`, `:372`, `:706`, `:749` | Frontend levels must reach a runtime-neutral control contract. |
| Existing controls/callbacks | `libs/shared/src/lib/types/agent-adapter.types.ts:337`, `:343`, `:349`, `:354`, `:360` | Reuse behavior/types; isolate SDK aliases. |
| Restore/page use concrete SDK reader | `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:35`, `:72`, `:93` | Native history needs an explicit router and projection. |
| Rewind uses SDK and checks returned paths | `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:196`, `:1481`, `:1514` | Native file restore is distinct from thread rollback. |
| Question/plan/YOLO/edit/rules | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:557`, `:570`, `:590`, `:600`, `:637` | Preserve outcomes, not just approval method names. |
| Initial YOLO retains callback | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:772` | Native YOLO must preserve interactive questions/plan transitions. |
| Edited inputs cross Electron IPC | `apps/ptah-electron/src/ipc/ipc-bridge.ts:425` | Never approve original input after ignoring an edit. |
| Auth initialization/coalescing | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:334`, `:587`, `:617`; `libs/backend/auth-providers/src/lib/auth/auth-manager.ts:122`, `:178` | Propagate intent through the entire chain and partition incompatible flights. |
| Auth event has provider/timestamp, no path | `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts:28` | Use a new home-aware port; retain legacy event semantics. |
| Existing refresh owner/fixed temp file | `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts:111`, `:529` | One writer per home for both legacy and native. |
| Home override/env injection | `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts:18` | Resolve home outside core and pass normalized path. |
| Usage singleton state and caller | `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:114`, `:152`, `:156`, `:270`, `:295`; `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:57` | Partition eligibility/cache/flight/owner and propagate home through callers. |
| Chat profile inputs and HTTP overrides | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:429`, `:845`, `:884`, `:913` | Preserve prompt, MCP, images/files, effort and event delivery. |
| Prompt/MCP/output-style assembly | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:327`, `:403`, `:1100`, `:1301` | Enumerate native input mapping, without copying a Claude preset. |
| Metadata already stores detail JSON | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:300`, `:310`, `:692` | Add queued identity updates; no migration. |
| Lane selection hardcodes adapter | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:57` | Replace actual selection, not just register an unused class. |
| Lane auth/exec/Windows termination | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:419`, `:532`, `:559`, `:750` | Interim home correction; preserve terminal-event completion. |
| Lane handle/config | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:98`, `:127`, `:239`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts:104`, `:129`, `:165` | Preserve restrictions/budgets/role resend, not legacy bypass defaults. |
| Nx boundary rules | `eslint.config.mjs:294`, `:410`; `libs/backend/platform-core/project.json:6`; `libs/shared/project.json:6` | Extension/feature core can depend on shared/platform util without exceptions. |
| Binary packaging variants | `libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path.ts:17`, `:43` | Manifest is platform/arch/digest based, not a developer path. |
| Usage reader kills immediately and bounds accumulated bytes | `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:363`, `:405` | Do not call it a graceful shutdown or reuse its loop as chat execution. |
| Smoke tests stub old adapter | `apps/ptah-electron/src/di/container.smoke.spec.ts:263`, `:875`; `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:214` | Add real-router resolution tests. |
| Existing RPC declarations/surface | `libs/shared/src/lib/types/rpc.types.ts:788`, `:842`, `:955`, `:1200`; `apps/ptah-electron/src/di/rpc-surface.spec.ts:34` | Preserve public method names/results; verify transport delivery. |
| Additional proxy caller: curator | `libs/backend/auth-providers/src/lib/di/register.ts:165`, `:189` | Final removal audit must extend beyond chat. |

## Component specifications

The following signatures/types are PROPOSED contracts, not claims that they already exist. Reuse repository shared result/event types rather than creating parallel copies. Exact file ownership is in the handoff.

### 1. Pre-proxy runtime/profile seam

Owner: auth-providers provider resolution; rpc-handlers chat assembly; agent-sdk immutable identity.

Add shared SessionRuntimeIdentity: local sessionId, providerId, workspaceId, runtime ('claude-sdk' or 'codex-app-server'), Codex normalizedHome and identity version. Existing legacy Codex sessions without a native identity remain legacy; never infer runtime from the currently focused provider. A provider/home/workspace mismatch fails resume. No native identity is attached to a legacy transcript opportunistically.

In `workspace-provider-profile-resolver.ts`:
```ts
resolveExecutionProfile(input: {
  workspacePath: string; requestedModel: string;
  existingIdentity?: SessionRuntimeIdentity;
  hostCapabilities: RuntimeHostCapabilities;
  consumer: 'chat' | 'gateway' | 'lane';
}): Promise<
  | { runtime: 'claude-sdk'; providerProfile: ProviderProfile | undefined }
  | { runtime: 'codex-app-server'; seed: CodexProfileSeed }
>;
```

Resolve provider/workspace/account identity BEFORE materializing authentication. Native branch returns a credential-safe seed without proxyPool.acquire, global proxy start, AuthManager.configureAuthentication or SDK auth-env mutation. Only the legacy branch calls existing profile materialization. Failed workspace resolution never falls back to process-global credentials.

New rpc-handlers `chat-runtime-profile.service.ts`: `prepare(config, identity): Promise<ResolvedChatExecution>` invokes that seam and combines authorized cwd with complete chat inputs. ChatSessionService delegates at BOTH start and resume. The separate ChatSlashCommandRouterService owns slash relaunch (`libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:163-167`, `:196-218`) and must also call `ChatRuntimeProfileService.prepare` before materializing a profile, including manual compact. Native slash/compact never calls the old workspace resolver or concrete SDK adapter. Workspace access/unsafe-path checks precede process creation. The existing legacy resolver remains callable only for legacy callers.

Core `buildCodexExecutionProfile(input): CodexExecutionProfile` validates/freezes contextId, consumer, home, account/provider identity, workspace/cwd, model/effort, frontend level, selected sandbox/network policy, enhanced/system/developer prompts, output style, skills/instruction sources, effective MCP transports/auth references, images/files, lane-only restrictions/budgets, and a non-secret config fingerprint.

Precedence: explicit session input > resolved workspace/provider settings > app/global defaults. Resume identity/home/workspace are fixed; explicit model/effort updates create a new turn revision. Home: explicit account/context override (715) > captured CODEX_HOME > default resolver. Normalize existing paths with realpath, missing paths with resolve; preserve platform case semantics and reject unresolved alias ambiguity. Do not read focused-workspace account state for another session.

Enumerate instruction sources separately from MCP. Preserve Ptah prompt additions and output style without importing the Claude preset. Preserve actual HTTP/OAuth/Smithery overrides and .mcp.json forms; a stdio fixture alone is insufficient. Missing MCP registration on resume keeps the existing continue-without-MCP behavior with an honest diagnostic. Secrets resolve only at the process boundary and stay out of fingerprints/logs. Lane suppression is never a chat default.

Tests: native start/resume/slash acquire neither proxy; invalid workspace fails before spawn; complete input mapping and attachments; same-home contexts retain distinct immutable configuration; legacy input snapshots remain unchanged.

### 2. Shared process/protocol/runtime

Owner: codex-runtime, files codex-runtime.ts, codex-app-server-process.ts, codex-protocol-validator.ts and codex-execution-profile.ts.

```ts
interface CodexRuntime {
  open(profile: CodexExecutionProfile, resume?: CodexThreadIdentity): Promise<CodexContext>;
}
interface CodexContext {
  readonly identity: CodexThreadIdentity;
  events(signal: AbortSignal): AsyncIterable<CodexRuntimeEvent>;
  startTurn(input: CodexTurnInput): Promise<CodexTurnReceipt>;
  interrupt(turnId: string): Promise<boolean>;
  updateNextTurn(patch: CodexTurnSettings): Promise<AppliedSettings>;
  compact(): Promise<void>;
  close(): Promise<void>;
}
```

Injected process spawner uses argument arrays, no shell, and a fresh child env with this profile's CODEX_HOME. Core receives the resolved executable path; it does not import agent-sdk's binary resolver. One initialization handshake per process generation. Zod validates envelope AND method-specific params/results before correlation or approval dispatch. Unknown/invalid messages fail visibly and dispose safely.

Manifest: platform/arch, binary SHA256, schema SHA256, version output, generation commands, method directions and request/result/approval variants. Reviewed artifacts cover supported distributions. Runtime verifies digests before handshake, never generates code, imports generated executable TS, or regenerates on mismatch. Developer absolute paths are diagnostic-only, not manifest identity.

Incremental UTF-8 JSONL framing, one-MiB frame cap and bounded queued bytes. Bounded request map. Ten-second handshake timeout, thirty-second ordinary request timeout, five-minute approval timeout; turns terminate on cancellation/terminal event/process exit rather than the ordinary RPC deadline. Close stops sends, rejects requests, invalidates approvals, closes stdin, waits one second, then kills and awaits exit. All exit/error/abort/dispose paths are idempotent and release listeners/timers. Never retry a mutating turn after ambiguous acceptance.

Serialize operations per context; uncertain interruption cannot start a second turn. Persist thread identity before first turn. Failed persistence closes child; orphan thread is not adopted. Exit after commit marks inactive while retaining threadId. Restart treats active metadata as dead; explicit resume reconstructs the exact thread. End-token compare protects newer registrations. No automatic proxy fallback.

Tests: UTF-8 fragmentation/oversize, method/result mismatch, binary/platform mismatch, request timeout and crash, persisted identity ordering, stale token, terminal-before-exit, cleanup, and same-home chat/chat, chat/lane and lane/lane isolation.

### 3. Single per-home credential owner and usage

Owner: core port/usage client; auth-providers credential implementation and compatibility facades.

CodexHomeAuthReader always accepts a normalized home:
`isAuthenticated(home): Promise<boolean>`;
`ensureTokensFresh(home, signal?): Promise<boolean>`;
`getUsageEligibility(home): Promise<CodexUsageEligibility>`;
`watch(home, listener): Disposable`.
Native events are `{home, generation, kind}`, never credentials.

New CodexHomeAuthService owns reads, refresh flights, atomic writes, watcher refcounts and invalidation by normalized home. Extract existing behavior into it. CodexAuthService becomes a default-home facade delegating to the SAME owner, including legacy proxy refresh. It cannot retain a second mutex/writer. Writes use unique temporary files and atomic rename under the per-home lock. Refresh has an explicit timeout and no blind retry of ambiguous rotating-token responses. Final unsubscription releases the watcher.

Keep the existing provider-only SDK auth-change event for legacy consumers. The default-home facade emits it only for that home. Native contexts use the new home-aware port and mark matching auth stale for revalidation before next turn. Do not add a fictional path filter to the old event.

Core CodexAccountUsageClient: `read(home, {refresh?, signal?}): Promise<CodexAccountUsageResult>`, using the shared process/protocol implementation in a short-lived usage context. Key eligibility, cache, misses, flights, generation, ownerKey and invalidation by normalized home. Verify server home echo where the manifest supports it; mismatch fails. Old-generation responses cannot populate a new account's cache.

Existing CodexAccountUsageService delegates via `getAccountUsage({home?, refresh?, signal?})` and `currentOwnerKey(home?)`; omitted home explicitly resolves default home, never last-focused account. `createCodexPlanUsageReader(usage, now = Date.now, homeSource?)` preserves its current clock argument (`codex-plan-usage.reader.ts:51-58`) and captures an optional context home supplier, forwarding home each read. Default registration supplies the default resolver; future 715 binds account contexts through the same API. Update ICodexAccountUsageService and ICodexOwnerKeySource in codex-provider.types.ts:110/:121, including clearCache(home?). ProviderOwnerResolver (quota/provider-owner.resolver.ts:458) must resolve owner identity with the same home, never the last successful singleton read. Move the usage DTO definition into core codex-account-usage.types.ts and re-export it from the old provider types to preserve callers; core cannot import an auth-providers DTO.

Required interim legacy-lane correction: credential reads in CodexCliAdapter use the SAME explicit/env home as execution and usage, replacing unconditional HOME/.codex. Retain old permission policy until lane migration. This closes requirement 4.5 and supersedes the old ban on all legacy-lane edits.

Tests: concurrent distinct-home auth/usage results, default native+proxy one refresh writer, stale-response invalidation, per-home eligibility/owner, default-event compatibility, alternate home never reading default credentials, and no process.env mutation.

### 4. Legacy auth intent and proxy lifecycle

Owner: auth-providers codex-proxy-policy.ts, auth-manager.ts, auth-strategy.types.ts and oauth-proxy.strategy.ts; agent-sdk initialization chain.

Proposed AuthOperationContext: reason ('startup' | 'provider-selection' | 'reauth' | 'auth-file-changed' | 'legacy-session-start'), hostNativeCodex, providerId and optional normalizedHome. Pass through `configureAuthentication(provider, context?)` into strategies and `SdkAgentAdapter.initialize(context?) -> doInitialize(context) -> configureAuthentication`, including callback and legacy start paths. Composition supplies host default; omitted context on marker-absent hosts preserves current behavior.

Auth flights compare provider, home, reason and host policy; incompatible operations serialize but do not share results. Native-enabled Electron's global Codex selection/status/recovery uses the home service and returns BEFORE clearing auth env, tearing down other-provider auth, or starting a proxy. Explicit legacy-session-start remains permitted during migration. Native start never calls configureAuthentication. Copilot and other providers retain their current branches.

This global policy AND the pre-profile pooled-proxy seam are both necessary. Tests exercise simultaneous selection/recovery/legacy starts, native auth-file changes, mixed Claude/Codex operation without restart, Copilot proxy, and native-disabled VS Code/CLI.

### 5. Session identity routing and runtime-neutral controls

Owner: new shared contract; agent-sdk session-runtime-router.ts / legacy-session-controls.ts; config RPC and ChatSlashCommandRouterService caller updates.

```ts
interface SessionRuntimeControls {
  setPermission(sessionId: SessionId, level: PermissionLevel): Promise<AppliedSettings>;
  setModel(sessionId: SessionId, model: string): Promise<AppliedSettings>;
  setEffort(sessionId: SessionId, effort: EffortLevel | undefined): Promise<AppliedSettings>;
  interrupt(sessionId: SessionId): Promise<boolean>;
  compact(sessionId: SessionId): Promise<void>;
}
```

PermissionLevel is frontend ask/plan/auto-edit/yolo. AppliedSettings distinguishes effective-now from next-turn, with revision. Dispatch uses immutable live/persisted identity, never focused workspace or process-global provider. Config RPC removes mapPermissionToSdkMode and its direct SDK calls. SDK aliases, including the current live yolo -> bypassPermissions mapping, exist ONLY in LegacySessionControls. Initial Claude mapping remains callback-preserving as today. Native YOLO receives yolo and must work.

Model/effort use validated turn settings; undefined clears effort. No unproved max -> xhigh conversion. Permission updates pause new side effects, settle/invalidate pending approvals and apply after server acknowledgement or safe interruption/reconfiguration. Never report immediate application while the old permission continues. Unsupported transition fails and remains a parity blocker.

Preserve existing RPC names/result shapes. Apply live changes before claiming saved/effective success; if persistence/application cannot commit together, roll back persisted settings and surface failure. Do not repeat current swallowed-sync-failure behavior for native. Audit all model, permission, effort, auth/provider/config-scope concrete-adapter callers; native controls must not bypass this port.

RoutingAgentAdapter implements existing IAgentAdapter over this same identity router. Internal host-injected rollout capability is not a UI selector. Before rollout, retained legacy execution is explicit; after native selection, failures never fall back to proxy. Native/legacy history remains distinguished; continuing an old legacy session cannot be counted as native parity.

Slash relaunch dispatches the prepared execution through the runtime-neutral session router. Native `/compact` calls `SessionRuntimeControls.compact(sessionId)` -> core `thread/compact/start` (wire shape remains evidence-gated); legacy slash and compact retain SDK `executeSlashCommand`. Preserve compact admission/coalescing and settled RPC replies currently at `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:130-141`, `:169-185`, with reservation release at `:243-249`: legacy retains its SDK coordinator; native admission uses the core context's serialized control lifecycle, releases on completion/error/disposal, and never invokes the SDK coordinator. Other native slash relaunches use verified command mappings through the same router, never a blanket rejection or SDK fallback. The Chat-RPC owner supplies `chat-slash-command-router.native.spec.ts` for native slash/compact zero global/pooled proxy calls, correct runtime dispatch, admission/release and unchanged legacy execution.

Tests: frontend YOLO live RPC works natively; model/effort clear/max, save rollback, focused-provider mismatch, stale token, mixed providers, and failed interruption prevents follow-up send.

### 6. Shared approval bridge with consumer presentation adapters

Owner: core codex-approval-bridge.ts / codex-permission-policy.ts; agent-sdk session-approval-router.ts / codex-chat-approval-sink.ts; core codex-permission-rule-store.ts; gateway and lane adapters supply their respective sinks.

`ApprovalSink.request(request, signal): Promise<ApprovalOutcome>` is the only presentation port. Outcomes: deny(reason), allowOnce, allowWithInput(validated replacement), alwaysAllow(scoped rule). Native rules are retained by the core owner across turns and child-process restarts, until explicitly cleared or the host runtime is disposed. Correlation key: contextId + processGeneration + threadId + turnId + requestId. Exactly one manifest-validated response; ignore stale/duplicate UI replies. Timeout/disposal denies if writable, otherwise ends the process, and removes the UI prompt without inventing approval.

Electron IPC routes request ownership to SessionApprovalRouter and preserves modifiedInput. Claude requests continue to the existing SDK handler. Native requests go to the shared bridge. Cancellation uses a typed session-scoped message through existing MESSAGE_HANDLERS; cancelPrompt does not post a response.

Lane sink receives explicit lane policy and handle/agent routing identity. Use the host's existing permission presentation where available. A headless host without a needed prompt sink fails visibly; it never implicitly grants never/full access. That failure is not lane parity: supported unattended policies and required interactive decisions need positive proof before rollout.

Gateway contexts require an explicit `ApprovalSink` and selected gateway policy even when headless. A missing sink fails before a turn starts; an unroutable required interaction denies/fails and never auto-allows. Preserve gateway permission defaults and notices (`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:336-354`, `:874-888`); a notice is not an approval response. The sink only presents/returns scoped outcomes to the shared bridge. Core owns timeouts, modifiedInput validation and rule scope. Claude gateway permission handling stays unchanged. A refusal without a usable required interaction remains a gateway parity blocker.

| Selected policy | Required approval semantics | Sandbox/network and positive gate |
| --- | --- | --- |
| ask | Preserve safe-read classification; ordinary side effects wait for the scoped decision. | Baseline workspace-write/no network until explicit scoped authorization. Prove permitted write/command/network outcomes as well as denial; never silently grant full access/never. |
| plan | Read/planning only; no mutation/execution before approved exit. Questions and exit remain interactive. | Baseline read-only/no network; prove entry, answer, exit and transition. A refusal is not plan parity. |
| auto-edit | Auto-approve only the current edit class; commands, remote MCP and network keep required decisions. | Workspace-write without implicit network widening. A file approval must not authorize a command or MCP effect. |
| yolo | Auto-approve ordinary classes while preserving AskUserQuestion and ExitPlanMode interaction. | Session-scoped full-access mapping only if proven to preserve the selected outcome AND interactive exceptions; otherwise gate requests and grant their allowed scope. No alias rejection, unconditional never shortcut, or permanently restrictive sandbox counted as parity. Prove network/outside-workspace behavior where selected policy permits it. |
| Explicit lane full-access/never | Honor only a policy explicitly supplied by the caller and supported by evidence. | Distinct profile field; never inferred merely from being a lane and never copied to chat. Prove same-home policy isolation. |

| User outcome | Core behavior | Positive proof |
| --- | --- | --- |
| Deny/cancel | Deny the exact action, settle lifecycle. | Command/file/MCP markers absent. |
| Allow once | Authorize that action/scope only. | One effect; a new request prompts again where policy requires. |
| modifiedInput | Validate and execute replacement only through a proven wire path. Unsupported replacement denies BEFORE original execution and blocks parity. | Original marker absent, replacement marker present; invalid edit rejected. |
| Always Allow | Remember provider/workspace/home/tool/action-scoped rule in the core RuleStore; no universal session bypass and no new disk persistence. | Survives child-process restart in intended scope; host restart clears it; cannot affect another account/workspace/tool; only matching pending prompts settle. |
| Question/plan exit | Dedicated interaction, not allow/deny coercion. | Answer/transition actually affects subsequent behavior. |
| Crash/timeout | Cancel generation and its prompts; no approval replay. | Delayed reply cannot authorize a new turn/process. |

RuleStore is a narrow core-owned in-memory store in codex-permission-rule-store.ts. Current PermissionRuleStore is explicitly in-memory, library-private and composed by the SDK handler (`libs/backend/agent-sdk/src/lib/permission/permission-rule-store.ts:2-10`, `:21`; `sdk-permission-handler.ts:188`). Do not claim existing disk persistence or import this private SDK class into core. Keep Claude's existing store unchanged. Native lifetime is explicitly host-runtime lifetime, with process-restart retention and explicit clear; durable grants across host restart would require a separate approved behavior change.

Every required command/file/MCP/other tool class needs evidence of a gate BEFORE side effects. Killing after an unapproved effect is containment, not preservation. Existing permission and question UI behavior remains the presentation boundary.

### 7. History, pagination, stats, rewind and metadata

Owner: core codex-session-history.ts / codex-file-history.ts / codex-subagent-controls.ts; agent-sdk history/rewind routers and metadata; RPC delegation.

Add optional codexExecution metadata: version, runtime, status, threadId, processGeneration, normalizedHome, workspaceId, providerId, profileFingerprint and endToken. No credentials. `updateCodexExecution(sessionId, updater)` is sole writer through existing enqueueWrite/toSessionRecordInput. save preserves omitted runtime metadata; cannot convert a legacy row on resume. Persist identity before turn/start; write failure closes child. Crash after write marks inactive but retains threadId.

SessionHistoryRouter preserves existing readSessionHistory/readSessionEvents return types and stats contract, dispatching by identity. Native `CodexHistoryReader.read(identity, cursor?, limit?)` gets manifest-validated native history and projects through the same event translator as live delivery. Stable turn/item IDs and cursor snapshots prevent omissions/duplicates while appending. Preserve includeBlockOwners and compaction boundaries. Native subagents cannot be invented from Claude registries. Cache by identity/revision, not focused workspace.

ChatHistoryReadService injects the router at BOTH resume/page paths; session RPC history/stats handlers use it too. Native history works after host restart through verified native read/resume APIs; never parse Codex as Claude JSONL. Usage stats retain reported input/output/cache-read only; absent usage remains absent, never zero or invented cache_creation. Availability of history APIs is a spike gate, not inferred from thread/resume.

SessionRewindRouter.rewindFiles preserves existing RPC args/results and path authorization. CodexFileHistory exposes `checkpoint(identity, boundary)`, `preview(identity, checkpoint)`, `restore(identity, checkpoint)`, returning affected paths/conflicts. Conversation rollback is NOT file restoration. Spike must prove native file-history semantics and coverage. If absent, snapshots would need complete reliable pre-effect capture for every covered tool. Post-effect notifications or git reset do not prove that. Do not implement speculative rewind: native file-history support and chat rollout remain blocked until evidence supports actual restoration or the user approves reduction.

CodexSubagentControls owns native list/background/interrupted-context projection from verified native events/operations. Claude routes remain unchanged. Missing equivalents enter the harness handoff and block required parity; no fabricated running/started agents.

Tests: inactive restore, page with live append, compaction/history boundaries, stats omission, stable IDs after restart, mixed legacy/native reads, correct inactive-session rewind, actual restored content, path/conflict rejection, and no conversation-rollback substitution.

### 8. Thin consumers, events and composition

Core CodexEventTranslator emits a discriminated CodexRuntimeEvent union: ordered text deltas/final text, tool lifecycle with stable IDs, reasoning, files/images, sanitized errors, reported usage, compaction, subagents and terminal state. Chat codex-chat-events.ts projects into FlatStreamEventUnion and result/live/compaction callbacks; lane codex-lane-events.ts projects into CliOutputSegment. Consumer mappings do not parse protocol payloads. Exactly one terminal result. Keep final-only text honestly, but missing required partial behavior remains a gate. Manual compact uses the control port/existing slash entry; do not reject every slash command.

Lane profile preserves suppression of user MCP/plugins/apps/skills, Ptah MCP attachment, zero-omits-budget behavior, role resend and continuation. It does not copy legacy approval_policy=never or danger-full-access defaults. Prove replace/append-safe role resend on native resume before migration; no growing duplicate instruction. Preserve steer:false and interrupt:false (current capability evidence at `codex-cli.adapter.ts:354`); handle abort cancels/disposes context. Terminal events settle done/idle without waiting for process exit, including Windows. Retain old exec workaround until deletion.

CliDetectionService receives a composed Codex adapter factory instead of direct construction at :57. Internal migration capability selects new lanes; existing handles keep their runtime. Both implementations remain callable until approved retirement. Native failure never retries through SDK. Final default is native, with no user selector.

Gateway preparation currently resolves a proxy profile at `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:689-697`, then starts/resumes through the agent adapter at `:794-865`. Replace only the native Codex branch with `CodexGatewayProfile` -> the same `resolveExecutionProfile(consumer: 'gateway')` seam and core profile builder -> `CodexGatewayAdapter`. The thin adapter projects normalized core events into `FlatStreamEventUnion` for the existing bridge stream boundary (`:801`) and uses shared identity/history ports to persist and resume the exact native context. Route native interrupt/end through that context; an ambiguous resume failure must not trigger the bridge's legacy new-session fallback (`:835-845`) or SDK retry. Preserve gateway prompt/MCP inputs (`:705-753`), per-turn policy (`:874-888`), conversation routing and cleanup. Legacy identities remain explicit during migration; Claude preparation/execution stays unchanged. No rpc-handlers dependency, SDK query building, protocol parsing or process ownership is added to the gateway adapter.

Electron registers shared ports and native-chat capability. VS Code/CLI register compatible ports and keep legacy-chat default; native lane capability is composed in supported lane hosts with an actual approval sink or an honest presentation failure. No host switch inside core.

DI tests must resolve the REAL router native-on/native-off and exercise handlers/transports with a fake App Server spawner. Review expected-resolvable, smoke, RPC surface and surface-composition for Electron/VS Code/CLI. Old SDK stubs alone are insufficient. Preserve existing RPC names/results and typed frontend routing.

## Evidence spike and protocol gates

The first implementation batch is **manifest/schema tooling and isolated evidence harness only**, after this revision is reviewed. It does not enable production or build a large disabled integration before protocol feasibility is known.

The user approved a bounded real-model spike (`decisions.md:41`): at most **8 model turns total across all experiment processes/children**, including failed attempts, continuations and retries; no automatic retries or budget reset between cases. Use a cheap supported model on the user's Codex account and a bounded output budget recorded before execution. Create an isolated experiment root with a temporary workspace and temporary CODEX_HOME containing a COPY of auth only; never run against the user's real home or copy/read shared config.toml into the experiment. Child env overrides only; no host env mutation or user-config writes. Treat copied auth as secret, exclude it from artifacts and delete it during cleanup. Side effects are harmless marker files only, confined to that experiment root (a sibling scratch directory permits outside-workspace sandbox checks). No network MCP, production tools or external side effects; network access is limited to the authorized model/auth service. No codex binary run during this planning correction. Record executable/platform/arch/digests/commands. Outputs: full schema and manifest, sanitized fixture transcripts, protocol coverage ledger, approval outcome matrix, effective-config readbacks, cleanup results, and populated harness table. Distinguish schema facts, mock tests and real-runtime observations.

**Behavioral evidence is authorized within those bounds and required from the first spike.** Hold real command/file/MCP approval requests pending and observe marker absence before responding; prove deny leaves the original marker absent and modifiedInput creates only the validated replacement marker. Exercise ask, plan, auto-edit and yolo sandbox boundaries with positive and negative local marker cases; use a separate local stdio MCP marker fixture per child to prove transport/config isolation and approval-before-effect. Populate every row of the harness-capability-gap table with observations, sanitized evidence and explicit unverified/unsupported gaps. Schema extraction and mocks do not substitute for these proofs. Stop at the turn cap, any isolation breach or unsupported gate; record incomplete proofs and leave production disabled. Remote HTTP/OAuth/Smithery configuration can be inspected with offline fixtures but no network MCP call is authorized; unproved remote behavior remains a rollout blocker. Further experiments beyond these limits require a separately approved scope, not an implicit extension of the cap.

Required observations before respective consumer rollout:
1. Exact handshake, method-specific schemas, approval outcomes and binary/platform manifest matching; experimental settings are not assumed.
2. Positive AND negative side-effect gates for command/file/MCP, modifiedInput, scoped Always Allow, every level including YOLO, questions/plan transitions.
3. Complete effective profile: HTTP/OAuth/Smithery and stdio MCP, skills/instructions/output style, images/files, model/effort including max, resume role semantics.
4. Same-home chat/chat, chat/gateway, gateway/lane, chat/lane and lane/lane config isolation; different-home auth/usage isolation; no shared-home config writes.
5. Partial/final stream, honest usage, interrupt/follow-up, resume/history/pages/stats, real file rewind, compaction and required subagent controls.
6. Lane restrictions/budgets/role resend/headless policy/Windows completion and abort.
7. Manifest lookup with supported packaged binaries. A development digest is insufficient.

Schema-supported names do not prove behavior. A failed gate remains a blocker, not authorization to build refusal-only parity. Update any disproved contract before dependent implementation.

## Harness capability gaps (handoff to follow-up task)

Measurement inventory only; provider-neutral tool design is outside this task. No native equivalent below is certified. Spike fills observed equivalents and evidence. A candidate existing tool is not proof of identical Claude semantics.

| Capability | Claude mechanism file:line | Codex App Server equivalent or none | Candidate Ptah-native mechanism / measurement |
| --- | --- | --- | --- |
| Plan entry/read-only planning | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:534`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:772` | None verified; read-only sandbox alone insufficient. | Existing plan-mode UI/message flow; future neutral tool candidate, not an asserted ptah_plan API. Measure entry/edit prohibition. |
| AskUserQuestion | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:557`; `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:540` | None verified; inspect pinned schema's user-input requests. | Existing question service/presentation could back a future MCP tool. Measure answers and cancel. |
| ExitPlanMode | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:570` | None verified. | Existing exit-plan presentation/service; measure actual transition, not acknowledgement. |
| Subagent spawn/list/background | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1372`, `:1020` | Native controls unverified. | ptah_agent_spawn/list transports tested at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limits.transport.spec.ts:245`, `:513`; candidate, not parity proof. |
| Agent reporting/interrupted context | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1020` | None verified for injected/background context. | ptah_agent_report described at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:70`; measure ownership/lifecycle differences. |
| Edited input/remembered permissions | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:637`; `apps/ptah-electron/src/ipc/ipc-bridge.ts:425` | Wire outcomes unverified. | Existing permission UI/storage through this task's approval port; broader neutral harness is follow-up. |
| Compact/file rewind | `libs/shared/src/lib/types/agent-adapter.types.ts:360`; `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1481` | Research candidates thread/compact/start and thread/rollback; not file-restore proof. | Existing session RPC front doors; measure boundaries and file contents separately. |
| Skills/instruction harness | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:327`, `:1100`, `:1301` | Research candidates skills/config and instruction fields only. | Existing profile/MCP sources; measure each source's actual effect. |

If a necessary capability requires the follow-up task, this task's affected rollout remains blocked until that work lands or the user approves reduction. Merely putting it in this table does not defer away an acceptance requirement.

## Requirements traceability and acceptance

| Requirement | Implementation owner | Positive acceptance |
| --- | --- | --- |
| 1 native interactive | Profile seam, chat adapter, Electron composition | Native start/resume with zero global/pooled proxy calls; no fallback. |
| 2 permissions | Shared approval/policy, sinks, controls | Real outcome/level matrix; working YOLO; no cross-session elevation. |
| 3 model/effort | Profile and SessionRuntimeControls | Selected values/clear applied to start/resume/next turn; max mapping proved. |
| 4 account/home | HomeAuthService, usage client, legacy-home fix | Auth/execution/quota same home, different-home and same-home concurrency. |
| 5 workspace | Pre-profile authorization and identity | Unsafe cwd refused before spawn; focus cannot retarget. |
| 6 MCP/skills/instructions | Complete profile and isolated process | All inputs effective; no lane suppression in chat; isolated reload. |
| 7 stream/tools/attachments | Core translator and three consumer projections | Ordered partial/final/tool/error, attachments honored, no fabricated usage. |
| 8 interrupt/resume/rewind | Lifecycle, identity, history/file history | Stop before follow-up, exact resume, stale token, actual scoped restoration. |
| 9 usage/compact/subagents | Usage/events/control ports | Honest counts and proven compact/subagent behavior where necessary. |
| 10 Claude/non-Codex | Legacy wrappers and host policy | Existing Claude controls/MCP/slash/rewind and Copilot proxy unchanged; hosts compile. |
| 11 stages | Consumer parity gates and removal audits | All three consumers converge; no retained path becomes permanent by omission. |

**Unconditional stage-1 acceptance:** Electron Codex chat must meet requirements 1 through 10 for the interactive surface; EVERY necessary interactive capability must have a verified native equivalent or explicit user approval of reduction; retained lanes must pass legacy tests, including the home correction. A visible unsupported error does not meet this criterion (`task-description.md:271`).

When any necessary capability in requirements 2 through 9 lacks a verified equivalent, fail visibly/record the gap but do not claim preservation. The owning stage remains blocked until equivalence or explicit user-approved reduction. This document approves no reduction and no automatic translation-proxy fallback (`task-description.md:275`).

Stage 2 requires native chat, gateways AND lanes on the same core, distinct selected policies, gateway/lane parity and cross-consumer isolation (gateway scope: `decisions.md:40`). Stage 3 requires zero-production-caller audits and separate deletion approval (`task-description.md:272-274`). A spike, disabled skeleton or chat-only integration does not complete this plan.

## Audit gap closure register

Architectural closure only; runtime verification remains open. Specs are owned with their implementation files in the handoff.

| Gap | Named owner, contract and files | Test / gate |
| --- | --- | --- |
| G1 | WorkspaceProviderProfileResolver.resolveExecutionProfile + ChatRuntimeProfileService.prepare; workspace-provider-profile-resolver.ts, chat-runtime-profile.service.ts, chat-session.service.ts AND chat-slash-command-router.service.ts | chat-runtime-profile.service.spec.ts: start/resume zero global/pooled proxy calls; chat-slash-command-router.native.spec.ts loads the real slash owner: native slash/compact bypass both proxies and SDK execution; legacy unchanged. |
| G2 | SessionRuntimeControls / SessionRuntimeRouter / LegacySessionControls; new shared contract, controls, config-rpc.handlers.ts | session-runtime-router.spec.ts, config-runtime-controls.spec.ts: native live YOLO, aliases legacy-only, failed apply not saved as success. |
| G3 | SessionHistoryRouter, CodexHistoryReader, SessionRewindRouter, CodexFileHistory; core history, chat-history-read.service.ts, session RPC | codex-session-history.spec.ts, codex-file-history.spec.ts, session-native-history.spec.ts: restore/page/stats and actual scoped rewind. |
| G4 | CodexApprovalBridge/Policy, SessionApprovalRouter/RuleStore; IPC/cancel handling | codex-approval-bridge.spec.ts, codex-permission-policy.spec.ts plus real side-effect evidence for modifiedInput, Always Allow and all levels. |
| G5 | Unconditional acceptance and per-consumer CodexParityGate | codex-parity-gate.spec.ts: absent positive evidence cannot enable consumer; unsupported is not pass. |
| G6 | AuthOperationContext, CodexProxyPolicy, keyed AuthManager flights, SDK initialize chain | codex-proxy-policy.spec.ts, auth-manager.spec.ts, legacy-runtime-auth.spec.ts: simultaneous reasons/homes, host scope, Copilot. |
| G7 | CodexAccountUsageClient.read(home), home-bound quota reader and facade | codex-account-usage-client.spec.ts, codex-plan-usage.reader.spec.ts: simultaneous distinct data; all state partitioned. |
| G8 | CodexHomeAuthService implements normalized-home port; default facade delegates | codex-home-auth.service.spec.ts: single native/legacy writer, correct old event semantics, no cross-home invalidation. |
| G9 | CodexExecutionProfile, chat/lane builders with provenance | codex-execution-profile.spec.ts, chat-runtime-profile.service.spec.ts, codex-lane-profile.spec.ts: all inputs including HTTP MCP/skills/instructions. |
| G10 | CliDetectionService factory, thin native adapter, interim legacy home fix | codex-native-selection.spec.ts, codex-app-server-lane.adapter.spec.ts, old adapter tests: selected policy, sink, restrictions/role, Windows terminal. |
| G11 | CodexEventTranslator, chat/gateway/lane projections and controls; ChatSlashCommandRouterService -> SessionRuntimeControls.compact -> core thread/compact/start | codex-event-translator.spec.ts, codex-chat-events.spec.ts, codex-gateway-adapter.spec.ts, codex-lane-events.spec.ts: ordered partial/final, usage omission, files/images, terminal; chat-slash-command-router.native.spec.ts: real compact caller, admission/release, no proxy/SDK native call, legacy unchanged. |
| G12 | Host composition, exports, shared RPC contracts | Real-router on/off tests, expected-resolvable/smoke/RPC/surface tests and dependent-host typechecks. |
| G13 | Manifest generator/evidence harness owner and approved isolated experiment with an 8-turn total cap | evidence-harness.spec.ts proves safety only; real approval-before-effect, modifiedInput/deny, per-level sandbox and per-child stdio MCP observations plus the populated harness table are required; failure keeps production disabled. |
| Additional item 14 | Process lifecycle/protocol validator/platform manifest | codex-app-server-process.spec.ts, codex-protocol-validator.spec.ts: payload schemas, bounded frames, shutdown, packaging identity. |

## Team-leader handoff

Complexity HIGH: shared execution, security-sensitive approvals, persistence, per-home auth and multiple hosts. The following are file-disjoint ownership units from which the team-leader assigns batches; this document does not create batches.md or change task states.

First batch: evidence unit only. Then reviewed shared contracts/core/auth; chat integration and Electron parity gate; gateway integration and gateway parity gate; native lane cutover and lane parity gate; separately approved removals. Gateways migrate after chat and before lanes: their existing session stream/start/resume boundary (`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:794-865`) reuses the proven core chat semantics while the separate gate proves headless approval delivery before further consumer rollout. Lane adapter development may proceed against the same core before chat rollout, but production migration is after chat, preserving `task-description.md:103`. Fewer lane controls (`codex-cli.adapter.ts:354`) make it a useful core test consumer, not a reason to bypass profile/approval proof.

Exact files follow. Prefixes are literal repository-relative directories. “With same-stem spec” means exactly that .ts and .spec.ts in the same directory, not a glob. Each implementation file has one owner. Final deletions necessarily revisit migrated files; they are sequential, separately approved transactions, not parallel-disjoint work.

### Evidence owner — first batch; new Nx project @ptah-extension/codex-runtime

Prefix C = `libs/backend/codex-runtime/`.
CREATE C+`project.json`, `package.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`, `eslint.config.mjs`.
CREATE C+`tools/generate-protocol-manifest.mjs`, `tools/evidence-harness.ts`, `tools/evidence-harness.spec.ts`, `tools/evidence-cases.json`.
Future generated/reviewed artifacts: C+`src/lib/protocol/codex-app-server-protocol.schema.json`, `src/lib/protocol/codex-app-server-protocol.manifest.json`, `src/lib/protocol/codex-app-server.fixture.jsonl`. Manifest includes a platform/arch artifact table.
MODIFY root `tsconfig.base.json` for the package alias. No production consumer imports it before the core owner supplies its exports. Run evidence stays in the isolated output and is attached for review; never fabricate successful fixture provenance.

### Core owner — @ptah-extension/codex-runtime

CREATE C+`src/index.ts`, `src/lib/codex-runtime.types.ts`, `src/lib/codex-account-usage.types.ts`, `src/lib/codex-home-auth-reader.ts`, `src/lib/codex-runtime-ports.ts`, `src/lib/di/tokens.ts`, `src/lib/di/registration.ts`.
CREATE under C+`src/lib/`, each with same-stem spec:
`codex-runtime.ts`, `codex-app-server-process.ts`, `codex-protocol-validator.ts`, `codex-execution-profile.ts`, `codex-approval-bridge.ts`, `codex-permission-policy.ts`, `codex-permission-rule-store.ts`, `codex-account-usage-client.ts`, `codex-event-translator.ts`, `codex-session-history.ts`, `codex-file-history.ts`, `codex-subagent-controls.ts`, `codex-parity-gate.ts`.
History/rewind/subagent implementation depends on positive spike evidence; this is not approval to ship refusal-only placeholders.

### Shared-contract owner — @ptah-extension/shared

Prefix S = `libs/shared/src/`.
CREATE S+`lib/types/session-runtime.types.ts` and `lib/types/session-runtime.types.spec.ts`.
MODIFY S+`index.ts`, `lib/types/agent-adapter.types.ts` (712 #808 first, additive only), `lib/types/rpc.types.ts`, `lib/types/messages/message-constants.ts`.
New contracts live in their own file; rpc.types.ts imports/reuses them only as needed and retains public method names/result shapes. No new monolithic RPC domain.

### Auth/profile owner — @ptah-extension/auth-providers

Prefix A = `libs/backend/auth-providers/src/`.
CREATE A+`lib/providers/codex/codex-home-auth.service.ts` with same-stem spec; A+`lib/auth/codex-proxy-policy.ts` with same-stem spec.
MODIFY A+`lib/providers/codex/codex-auth.service.ts`, `lib/providers/codex/codex-account-usage.service.ts`, `lib/providers/codex/codex-provider.types.ts`, `lib/auth/workspace-provider-profile-resolver.ts`, `lib/auth/auth-manager.ts`, `lib/auth/auth-strategy.types.ts`, `lib/auth/strategies/oauth-proxy.strategy.ts`, `lib/providers/register-providers.ts`, `lib/di/register.ts`, `lib/quota/readers/codex-plan-usage.reader.ts`, `lib/quota/provider-owner.resolver.ts`, `index.ts`.
Update/create same-stem specs for codex-auth.service, codex-account-usage.service, workspace-provider-profile-resolver, auth-manager, oauth-proxy.strategy, codex-plan-usage.reader and provider-owner.resolver in their respective directories. Existing registration specs are regression checks. CodexHomeResolver is reused unchanged; normalization belongs at the new boundary. Core DTO extraction must preserve existing auth-provider type exports.

### Chat-runtime owner — @ptah-extension/agent-sdk

Prefix D = `libs/backend/agent-sdk/src/`.
CREATE under D+`lib/codex-app-server/`, each with same-stem spec:
`routing-agent-adapter.ts`, `codex-chat-adapter.ts`, `codex-chat-events.ts`, `session-runtime-router.ts`, `legacy-session-controls.ts`, `session-history-router.ts`, `session-rewind-router.ts`, `session-approval-router.ts`, `codex-chat-approval-sink.ts`.
CREATE D+`lib/legacy-runtime-auth.spec.ts`.
MODIFY D+`lib/session-metadata-store.ts`, `lib/session-metadata-store.spec.ts`, `lib/sdk-agent-adapter.ts`, `lib/di/tokens.ts`, `lib/di/register.ts`, `index.ts`.
The large SDK adapter changes only for typed legacy-auth propagation; native concerns live in bounded owners. Existing SDK permission/query behavior remains unchanged. No App Server process/protocol code here.

### Chat-RPC owner — @ptah-extension/rpc-handlers

Prefix R = `libs/backend/rpc-handlers/src/`.
CREATE R+`lib/chat/session/chat-runtime-profile.service.ts` with same-stem spec; R+`lib/chat/session/chat-slash-command-router.native.spec.ts`; R+`lib/handlers/config-runtime-controls.spec.ts`; R+`lib/handlers/session-native-history.spec.ts`.
MODIFY R+`lib/chat/session/chat-session.service.ts`, `lib/chat/session/chat-slash-command-router.service.ts`, `lib/chat/session/chat-history-read.service.ts`, `lib/handlers/config-rpc.handlers.ts`, `lib/handlers/session-rpc.handlers.ts`.
Host composition owns constructor registration. Existing RPC method manifest remains stable. The concrete-adapter caller audit must cover auth/provider/config-scope handlers too; a newly discovered native-control bypass is a blocker requiring explicit reassignment, not an unlisted opportunistic edit.

### Gateway owner — @ptah-extension/gateway-chat-bridge

Nx name and tags verified in `libs/backend/gateway-chat-bridge/project.json:2`, `:6`: `@ptah-extension/gateway-chat-bridge`, `scope:extension`, `type:feature`. Prefix G = `libs/backend/gateway-chat-bridge/src/`.
CREATE G+`lib/codex-gateway-adapter.ts`, `lib/codex-gateway-profile.ts`, `lib/codex-gateway-approval-sink.ts`, each with same-stem spec; G+`lib/gateway-chat-bridge.native.spec.ts` for integration through the actual bridge.
MODIFY G+`lib/gateway-chat-bridge.ts`, `lib/gateway-chat-bridge.spec.ts`, `lib/di/tokens.ts`, `lib/di/register.ts`, `index.ts`. Existing registration/export seams are `lib/di/register.ts:15-24` and `src/index.ts:7-11` under this project. Register/export only thin consumer bindings; core process/protocol/approval code stays in C. Host-composition owner supplies runtime capability, shared identity/storage ports and explicit ApprovalSink policy in its already-owned host files; no second owner edits them. Auth/profile owner alone extends the common resolver; no gateway-owned edits to peer claim-first files.
Gateway parity gate after chat and before lanes: real bridge native start/resume acquire neither global nor pooled proxy and never execute SDK turns; exact identity/home/workspace survives continuation; stream/tool/usage/terminal, MCP/instructions, interruption/end and cleanup preserve gateway behavior; required approvals work through the explicit sink and missing/unroutable sinks fail without side effects; same-home chat/gateway and gateway/lane contexts stay isolated; existing Claude gateway regression suite remains unchanged in behavior. Required capabilities without positive proof keep the gateway disabled and block Removal A; safe refusal alone is not parity. No transport UI redesign or protocol duplication.

### Lane owner — @ptah-extension/cli-agent-runtime

Prefix L = `libs/backend/cli-agent-runtime/src/`.
CREATE under L+`lib/cli-agents/cli-adapters/codex/`, each with same-stem spec: `codex-app-server-lane.adapter.ts`, `codex-lane-profile.ts`, `codex-lane-events.ts`.
CREATE L+`lib/cli-agents/codex-native-selection.spec.ts`.
MODIFY L+`lib/cli-agents/cli-detection.service.ts`, `lib/cli-agents/cli-adapters/cli-adapter.interface.ts` (explicit optional Codex context/policy without changing other providers), `lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (interim home correction), `lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`, `index.ts`.
Legacy codex-lane-config.builder.ts and its tests remain unchanged until approved retirement. New profile mapping preserves required semantics, not SDK argv representation. New lane adapter imports no Codex SDK.

### Host-composition and frontend transport owner

MODIFY:
- ptah-electron: `apps/ptah-electron/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts` (all five under that di directory), and `apps/ptah-electron/src/ipc/ipc-bridge.ts`. CREATE `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts`.
- ptah-extension-vscode: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts` (same directory). Compatible bindings/tests only, no native chat UI rollout.
- @ptah-extension/cli-engine: `libs/backend/cli-engine/src/lib/container.ts`, `surface-composition.spec.ts` in that directory. CREATE `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts`.
- ptah-cli: `apps/ptah-cli/src/di/expected-resolvable.ts`.
- @ptah-extension/chat: `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` and same-directory `chat-message-handler.service.spec.ts`.
- @ptah-extension/chat-streaming: update/create `libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts` for cancel/edited-input behavior; existing presentation implementation remains.

No changes to protocol-dispatcher.ts, git-info.service.ts, tab-manager.service.ts or router.ts. IPC routes ownership only; core owns policy/process. No frontend direct transport calls.

### Verification scope and consumer gates

After implementation, test/typecheck only changed projects and affected dependent hosts. Required project set: @ptah-extension/codex-runtime, shared, auth-providers, agent-sdk, rpc-handlers, gateway-chat-bridge, cli-agent-runtime, cli-engine, chat, chat-streaming (each with the @ptah-extension/ prefix), plus ptah-electron, ptah-extension-vscode and ptah-cli. Check dependent webview/TUI types if the affected graph includes them, without feature work.

One heavy foreground run globally, Nx --parallel=1 and Jest --maxWorkers=2. Explicit run-many project list, not positional nx test A B. No workspace-wide tests, build, serve, e2e or packaging unless requested. Retain existing sdk-permission-handler, Codex adapter/builder, auth-manager, RPC allowlist and host smoke/surface suites. Record results and evidence per consumer. Unit fixtures do not certify real permissions or packaged artifacts; packaging validation needs separate authorization later.

Chat cutover gate: full requirement matrix, no proxy acquisition, all native live controls, history/rewind, required harness outcomes, two-home/two-workspace isolation, mixed Claude regression and compatible dependent hosts.
Gateway cutover gate: third thin consumer on the same core, no proxy/SDK native turn, explicit approval sink with positive interaction evidence, exact continuation and stream/lifecycle parity, cross-consumer isolation, Claude gateway unchanged.
Lane cutover gate: shared core proven with chat AND lanes, selected lane policy, suppression/budget/role parity, continuation/abort/Windows terminal behavior, headless/presentation semantics and same-home cross-consumer isolation.
Removal gate: all three cutovers plus each zero-caller audit, exact reviewable deletion diff and explicit approval.

## Proposed Removals

No deletion is authorized now. These are separate final approval packages, after positive consumer parity. End-state approval is not deletion approval. Each package presents exact files/exports/callers, positive evidence, test results, historical-session disposition and rollback impact. If withheld or blocked, report migration incomplete with named retained callers.

### Final removal approval A: Codex translation-proxy path

Propose deleting `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts` and Codex-only files/specs established by its import closure. Remove only the Codex branch of `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts`, pooled Codex profile acquisition, Codex proxy DI tokens/registrations/exports and obsolete tests. Preserve Copilot proxy/strategy, credential services, Claude SDK and other providers.

Caller audit starts at `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:362`, `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:166` and curator `libs/backend/auth-providers/src/lib/di/register.ts:189`. The required current-source search `rg -n "CodexTranslationProxy|resolveProviderProfileForWorkspace" libs apps --type ts -g '!**/*.spec.ts'` additionally identifies every location below; repeat it before deletion and trace the runtime callers, not only symbol names:

| Current reference | Audit obligation |
| --- | --- |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:873`, `:1579` | Start/resume profile callers; retain legacy continuation until approved disposition. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:164` | Slash/compact profile caller; migrate through the owned seam. |
| `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:693` | Gateway profile caller; native migration is required in this task. |
| `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:82`, `:500` | Import and actual CodexTranslationProxy constructor; remove only Codex pool branch after zero consumers. |
| `libs/backend/auth-providers/src/lib/di/register.ts:28`, `:166` | Import and curator registration. |
| `libs/backend/auth-providers/src/lib/providers/register-providers.ts:38`, `:89` | Import and provider registration. |
| `libs/backend/auth-providers/src/index.ts:99`; `libs/backend/auth-providers/src/lib/providers/codex/index.ts:8` | Public/barrel re-exports; follow import closure. |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts:30` | Class declaration, not a separate caller; deletion target. |
| `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:30`, `:99` | Documentation link and resolver declaration, not extra callers; audit remaining materialization users. |

Audit global initialization/recovery, workspace profile resolution, all hosts, background/curator callers and resumable legacy Codex sessions. Zero Electron callers is insufficient.

If curator or a marker-absent host still needs the proxy, deletion stays BLOCKED. Present the caller and a migration/host-scope decision; do not silently remove it or claim the one-runtime end state is achieved. Electron-first scope does not authorize changing other hosts' chat behavior to force the audit to zero.

Evidence: all chat/gateway/lane positive parity, no global/pooled acquisitions, mixed Claude/Codex operation, historical data readability, explicit approved disposition of every legacy continuation and remaining host/curator caller, then zero production callers. Do not replay old conversations into a new thread under the old identity. Runtime-history migration beyond proven continuation needs an explicit user decision in this final package.

### Final removal approval B: Codex SDK lane execution

Propose deleting `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`, `codex/codex-exec-args.ts`, `codex/codex-config-rejection.ts` and obsolete specs under the same adapters directory, only after import audit confirms no shared/native user. Evaluate codex-lane-config.builder.ts separately: delete only when native mapping positively covers all required semantics and it has no caller. Remove legacy detection-factory branch and exports.

Audit detection, launch/continue/resume/auth/model discovery, direct SDK imports, all host composition and test helpers. Evidence: native lane positive policy/presentation, all segments/usage, terminal/Windows/abort/resume, restrictions/budgets/role resend, two-home and same-home chat+lane/lane+lane tests, and zero production per-turn codex exec callers.

Remove @openai/codex-sdk from root package.json/package-lock.json only if no other user remains. Current executable distribution follows its dependency chain (`package-lock.json:11862`). The final proposal must preserve binary delivery through a reviewed direct @openai/codex dependency at the proved version or another approved distribution; removing the SDK must not remove App Server. Validate binary resolver and packaged manifests in the approved removal check.

Final deletion transactions may revisit migrated files and are serialized after implementation. They are not part of the parallel file-disjoint work claim. Temporary retention is never redefined as a permanent third runtime.

## Decisions

| Decision | Options | Evidence/reason | Reversible |
| --- | --- | --- | --- |
| New core, three thin consumers | Core in agent-sdk; auth-providers; dedicated library | User one-runtime direction; consumers at cli-detection.service.ts:57 and agent-sdk di/register.ts:942; gateway scope decisions.md:40; Nx rules eslint.config.mjs:410 | Yes before implementation. |
| Chat first; gateways then lanes required | Lanes first; simultaneous; chat then gateway then lanes | Settled task-description.md:103; latest direction makes gateway and lane migration mandatory, not optional | Yes before rollout if direction changes. |
| Process per active context | One per home; compatibility pool; isolated contexts | task-description.md:187/:213 requires same-home isolation; research identifies process-wide MCP reload | Only with an explicit tested sharing predicate. |
| Single per-home credential owner with legacy facade | Two writers; extend old event; facade over home service | codex-auth.service.ts:529 and sdk-adapter-events.service.ts:28 | Internal implementation reversible; 715 normalized-home seam stays. |
| SDK aliases only legacy | Mixed alias contract; frontend levels | config-rpc.handlers.ts:749 versus callback-preserving initial mapping sdk-query-options-builder.ts:772 | Internally; outcomes cannot regress. |
| Always Allow is explicitly scoped in-memory retention | Claim existing disk persistence; introduce durable grants; match lifecycle with scoped native store | permission/permission-rule-store.ts:2-10/:21 and sdk-permission-handler.ts:188; current store is private/in-memory | Durable grants would be a separate behavior/security decision. |
| Preserve quota reader clock argument, add home supplier; extract DTO downward | Break now argument; core imports auth; additive home and core DTO | codex-plan-usage.reader.ts:51-58; codex-provider.types.ts:110; provider-owner.resolver.ts:458 | Yes; no cycle or hidden default-home owner allowed. |
| Item 4: approved bounded real-model spike, hard cap 8 turns | Static-only spike; unbounded experiment; bounded account experiment | User approval decisions.md:41 supersedes earlier no-model constraints; copied auth only in temp home, marker-only side effects and per-child local stdio MCP produce required behavior evidence and harness gaps | Cap may only expand with approval; failure leaves production disabled. |
| File rewind needs positive content proof | Treat rollback as restore; speculative snapshots; gate on coverage | session-rpc.handlers.ts:1481/:1514; research rollback is not file evidence | After evidence, not by silent reduction. |
| No SQLite migration | New table; detail JSON | session-metadata-store.ts:300/:310; peer owns 0058 | Only a demonstrated need warrants 0059+. |
| Harness follow-up is separate, cannot waive parity | Build neutral harness now; silently drop; measure and gate | Latest direction; task-description.md:275 | Scheduling can change; reduction remains user-reserved. |
| Sequential removals are exception to disjoint implementation ownership | Pretend all stages disjoint; omit required fixes; serialize final removals | Requirement 4.5 needs legacy-home edit; G6 changes proxy lifecycle before retirement | Scheduling reversible; approval requirement fixed. |
| Audit curator/other hosts before removal | Chat-only audit; retain forever; zero-caller gate | auth-providers/src/lib/di/register.ts:165/:189 and host wiring cited above | Migration scope decision remains with user. |
| Item 1: slash relaunch has its own owner; native compact uses runtime controls | Assume ChatSessionService owns slash; leave SDK path; route real slash owner | libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:164/:196 and admission :130/:174; G1/G11 need a real caller spec | Internal routing reversible; native no-proxy and legacy behavior remain required. |
| Item 2: gateway is the third thin consumer, after chat before lanes | Defer gateway; duplicate runtime; share core with explicit ApprovalSink | User approval decisions.md:40; libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:693/:794/:855 and project.json:2/:6; shared session semantics justify order | Scheduling reversible; gateway scope and no implicit approval are fixed. |
| Item 3: Removal A names every current search hit and classifies non-callers | Audit only direct chat calls; exhaustive named closure | Current rg audit above, especially libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:693 and libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:500 | Refresh list at deletion; approval still required. |
| Item 5: keep ownership file-disjoint and peer claims unchanged | Broaden shared edits; assign focused owner additions | Existing coordination list and decisions.md:29/:33; gateway owns only G files, Chat-RPC owns slash, existing core/auth/host owners retain shared seams | Reassignment requires coordination; 712 PR #808 and claim-first rules remain. |

Planning limitations: source-only revision. No installed-binary behavior, schema, model call, packaging, typecheck or test result is asserted. G1-G13 and additional protocol/disposal issue have named owners/contracts/tests; evidence gates remain open. This document completes the requested plan revision, not the migration or its approval.
