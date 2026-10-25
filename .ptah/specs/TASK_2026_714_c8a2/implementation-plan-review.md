# Implementation Plan Review — `TASK_2026_714_c8a2`

- **Gate:** Gate 2 final re-review round 2
- **Author:** Codex CLI
- **Reviewer:** Grok CLI
- **Source checked:** `implementation-plan.md` (453 lines) against `plan-alignment-audit.md`, `context.md` user direction 2026-10-22, `task-description.md:271` and `:275`, and current source at HEAD `0d5be6dae`. Read-only. No binary, test, or git mutation.
- **Verdict:** **APPROVED**

## Prior rounds

Round 1 (in-process reviewer) approved the previous plan only as a bounded evidence spike and disabled-route handoff, not as production routing. The Codex alignment audit then found G1–G13 (five Blocking: G1–G5) and this review judges the rewrite that followed.

## Answers

1. **Single runtime, not fully delivered.** The target in `implementation-plan.md:11` and `:23-31` is one Codex App Server core (`@ptah-extension/codex-runtime`) and two thin adapters (`CodexChatAdapter`, `CodexAppServerLaneAdapter`). Protocol, process, approval, profile, and per-home auth stay in the core; chat and lane files only project events (`:237-243`). Proxy and `@openai/codex-sdk` stay migration sources until separate, user-confirmed removal (`:411-433`). That is not a designed third permanent path. It is incomplete for main chat: slash relaunch still calls `resolveProviderProfileForWorkspace` and `SdkAgentAdapter.executeSlashCommand` in a file the handoff does not own (finding 1). Until that entry uses the same core, Electron chat still has the translation-proxy path beside the new runtime.

2. **G1 and G11 are PARTIAL. G2–G10, G12, and G13 are CLOSED** as architecture (runtime proof stays a gate, which the plan states at `:307`). Spot-checks of the five Blocking anchors match current source; see the gap table. The rewrite’s own test for G1 (`chat-runtime-profile.service.spec.ts`) never constructs the slash router, so it can pass while that path still acquires a proxy.

3. **The new lib is justified and the tags fit.** Two real consumers are `cli-detection.service.ts:57` (hardcoded `CodexCliAdapter`) and agent-sdk registration (`di/register.ts`, plan `:42`). Putting the core in agent-sdk or auth-providers would couple the lane to Claude integration or mix execution with credentials; the plan rejects both (`:32`). Tags `scope:extension` and `type:feature` match `libs/backend/agent-sdk/project.json:6`, `libs/backend/auth-providers/project.json:6`, and `libs/backend/cli-agent-runtime/project.json:6`. `eslint.config.mjs:294-296` allows `scope:extension` to depend on `scope:shared` and `scope:extension`. `:410-416` allows `type:feature` to depend on `type:feature`, `type:util`, and `type:core`. `libs/backend/platform-core/project.json:6` is `scope:shared`, `type:util`. Stated direction (composition → auth-providers / agent-sdk / cli-agent-runtime → codex-runtime → shared / platform-core, with no app, Electron, VS Code, or consumer imports inside the core) is acyclic under those rules. The boundary linter was not executed.

4. **Listed ownership units are file-disjoint and respect TASK_2026_712’s claim-first files.** No path is under two owners. `agent-adapter.types.ts` is additive and only after PR #808 (`:14`, `:355`). `sdk-query-options-builder.ts` is not in any MODIFY list (`:18`). `session-metadata-store.ts` and `sdk-agent-adapter.ts` belong only to the chat-runtime owner; `chat-session.service.ts` belongs only to the chat-RPC owner; all three are behind the claim-before preamble (`:13-18`, `:371`, `:378`). The architect correctly does not write `batches.md`. The slash router is unlisted, which is missing coverage, not a second owner.

5. **The spike blocker is honest, and stage-1 acceptance is unconditional.** The first batch is manifest, schema, and an isolated harness only (`:251-253`, `:336-342`), on a temp workspace and temp `CODEX_HOME`, with no copied auth and no host env writes. Behavioral command/file/MCP proofs are explicitly blocked until a supported no-model trigger or an approved bounded experiment (`:255-256`); mocks must not be marked passed. That is the G13 fix. Acceptance at `:301-305` requires Electron Codex chat to meet requirements 1–10, requires a verified native equivalent or an explicit user-approved reduction for every necessary interactive capability, cites `task-description.md:271` (a visible unsupported error is not acceptance), and refuses automatic proxy fallback (`task-description.md:275`). A spike or chat-only skeleton does not finish the plan (`:305`).

6. **Removals are not authorized, and the named caller audit is not complete.** `:411-413` forbids deletion now and separates end-state approval from deletion approval. Removal A names the curator registrations at `auth-providers/src/lib/di/register.ts:165` and `:189` (verified: `SDK_CURATOR_CODEX_PROXY` / `CodexTranslationProxy`). It also says a remaining caller blocks deletion. The start list still omits two verified Codex proxy callers (finding 2). Nothing in this plan deletes code without a later user confirmation.

7. **The rewrite introduces one Blocking defect and one Moderate defect.** No new Serious defect beyond finding 1. The file count tracks G1–G13 rather than speculative layers: the core exists because chat and lanes are both in scope, and the in-memory rule store matches `permission-rule-store.ts:1-10` instead of inventing disk persistence.

## Gap closure table

| Gap | Status | Evidence |
| --- | --- | --- |
| G1 | PARTIAL | Start and resume still resolve a profile before the adapter: `chat-session.service.ts:872-876` and `:1578-1582`. Pooled acquire is still `workspace-provider-profile-resolver.ts:362`. The plan’s seam (`:79-94`, register row `:313`) covers those two call sites via `ChatRuntimeProfileService` and the owned `chat-session.service.ts`. Slash relaunch does not go through that service. `chat-slash-command-router.service.ts:163-167` calls `resolveProviderProfileForWorkspace`, then `:197` calls `sdkAdapter.executeSlashCommand`. That file is absent from the chat-RPC MODIFY list (`:376-378`). Plan `:95` says ChatSessionService includes slash relaunch. It does not. |
| G2 | CLOSED | `config-rpc.handlers.ts:81` injects `SDK_AGENT_ADAPTER` (parameter at `:82`). Permission sync is `:372`, effort sync is `:706`, and `yolo` maps to `bypassPermissions` at `:749`. Swallowed sync failure is `:381` and `:711`. Model sync is the same file at `:205`. Plan `:168-188` defines `SessionRuntimeControls` with frontend levels, puts SDK aliases only in `LegacySessionControls`, and assigns `config-rpc.handlers.ts` plus `config-runtime-controls.spec.ts` (`:314`, `:377-378`). |
| G3 | CLOSED | `chat-history-read.service.ts:35-36` injects `SDK_SESSION_HISTORY_READER`; `:72` calls `readSessionHistory`; `:93` calls `readSessionEvents`. Resume uses that service at `chat-session.service.ts:1096-1098`. Rewind injects `SDK_AGENT_ADAPTER` at `session-rpc.handlers.ts:196-197`, calls `rewindFiles` at `:1481`, and checks returned paths at `:1514`. Stats use `SessionStatsReaderService` in the same handler (`:187`, `:1270`). Plan `:221-235` routes history, page, stats, and file restore, and both RPC files are owned (`:378`). |
| G4 | CLOSED | `sdk-permission-handler.ts:557` (AskUserQuestion), `:570` (ExitPlanMode), and the edited-input / Always Allow region cited by the audit remain the Claude behavior to preserve. `ipc-bridge.ts:425` still forwards `modifiedInput` into `handleResponse`. Plan `:190-217` defines one `ApprovalSink`, deny-before-original when an edit cannot be applied, per-level proofs, and an in-memory core `RuleStore` whose lifetime matches `permission-rule-store.ts:1-10` (private, in-memory, no disk). `ipc-bridge.ts` is on the host MODIFY list (`:392`). Positive side-effect proof stays a rollout gate (`:259`, `:313` G4 row), not an architectural hole. |
| G5 | CLOSED | `:301-305` copies the unconditional rule. A missing equivalent blocks the owning stage and is not preservation. No reduction is approved in this document. |
| G6 | CLOSED | Plan `:156-164` adds `AuthOperationContext` through `configureAuthentication` and `SdkAgentAdapter.initialize`, partitions flights by provider, home, reason, and host policy, and returns native Electron selection before env clear, teardown, or proxy start. Tests named at `:318`. Copilot stays on its current branch. |
| G7 | CLOSED | Plan `:146-154` keys eligibility, cache, flight, generation, and owner by normalized home; `createCodexPlanUsageReader` keeps the clock argument and adds a home supplier; `ProviderOwnerResolver` must use that home. Tests at `:319`. |
| G8 | CLOSED | Plan `:137-146` makes `CodexHomeAuthService` the only writer per home. `CodexAuthService` is a default-home facade on that owner, including legacy proxy refresh. The old auth-change event stays provider/timestamp only and is emitted for the default home. Tests at `:320`. |
| G9 | CLOSED | Plan `:96-100` freezes home, cwd, model, effort, prompts, output style, skills, MCP (HTTP/OAuth/Smithery and stdio), images, and files, with explicit precedence. Lane suppression is not a chat default. Builders and specs are named at `:319`. Slash inputs miss this profile only because the caller is unowned (G1 / finding 1), not because the profile contract is thin. |
| G10 | CLOSED | Plan `:241-243` and `:381-387` replace `CliDetectionService` construction at `:57` with a factory, keep the old adapter callable, correct legacy home to the execution home (`:152`), and refuse `approval_policy=never` / `danger-full-access` as lane defaults. Headless missing-sink failure is not parity (`:198`). |
| G11 | PARTIAL | `CodexEventTranslator` and the two projections are owned (`:237-239`, `:323`). Manual compact’s live entry is the unowned slash router: compact admission at `chat-slash-command-router.service.ts:130-141` and `:169-174`, then SDK `executeSlashCommand` at `:197`. Plan `:239` says compact uses “the control port/existing slash entry” and does not assign that file, so the control port has no main-chat caller. |
| G12 | CLOSED | Plan `:389-398` and `:324` name real-router on/off specs plus smoke, RPC surface, expected-resolvable, and surface-composition for Electron, VS Code, and CLI. `apps/ptah-electron/src/di/surface-composition.spec.ts` and `libs/backend/cli-engine/src/lib/surface-composition.spec.ts` exist. `apps/ptah-cli/src/di/expected-resolvable.ts` exists. VS Code and CLI keep legacy chat (`:393-394`). |
| G13 | CLOSED | Plan `:255-256` and `:325` split harness safety (`evidence-harness.spec.ts`) from real-runtime proof and refuse a mock pass. Behavioral evidence stays blocked until a no-model trigger or an approved experiment. Schema names are not behavior (`:266`). |

## Findings

1. **Blocking.** Main-chat slash relaunch, including manual compact, still acquires a pooled proxy and executes on the concrete SDK adapter, and the handoff does not assign the file. Plan `:95` claims `ChatSessionService` delegates start, resume, and slash relaunch. Source: `chat-slash-command-router.service.ts:163-167` calls `resolveProviderProfileForWorkspace` (the method whose proxy branch is `workspace-provider-profile-resolver.ts:356-362`), then `:197` calls `this.sdkAdapter.executeSlashCommand`. `chat-session.service.ts` owns only `:872` and `:1578`. The chat-RPC file list (`implementation-plan.md:376-378`) has `chat-session.service.ts`, `chat-history-read.service.ts`, `config-rpc.handlers.ts`, and `session-rpc.handlers.ts`, not the slash router. G1’s named spec (`:313`) never loads this caller, and plan `:239` leaves compact on that same entry while `SessionRuntimeControls.compact` (`:176`) has no assigned RPC caller. A native `/compact` or other slash relaunch therefore remains the translation-proxy path. **Fix:** add `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts` and its specs to the chat-RPC owner. Native sessions must call `ChatRuntimeProfileService.prepare` before any profile materialization and must not call `resolveProviderProfileForWorkspace` or `SdkAgentAdapter.executeSlashCommand`. Manual compact on a native session must call `SessionRuntimeControls.compact`. Add a test that native slash relaunch and native compact acquire neither a global nor a pooled proxy.

2. **Moderate.** Removal A’s named caller list can miss live Codex proxy users. Plan `:419` starts at `workspace-provider-profile-resolver.ts:362`, `oauth-proxy.strategy.ts:166`, `register-providers.ts:88`, and curator `register.ts:165` and `:189`. It does not name `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:693`, which calls `resolveProviderProfileForWorkspace` and then runs an SDK turn (`:689-697`), or `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:500`, which constructs `CodexTranslationProxy` for the acquire at resolver `:362`. The prose says to audit all hosts and to block deletion while any caller remains (`:419-421`), so this is not permission to delete. A zero-caller report that only walks the start list can still miss them. **Fix:** add both files to the removal A caller audit. Do not migrate the gateway in this task unless the user expands scope; do not report zero production callers while either reference remains.

## Open items for the user

- Behavioral spike: approve a bounded model/account experiment, or supply a supported no-model trigger, before command/file/MCP side-effect proofs can run. The plan correctly does not run that experiment (`implementation-plan.md:255-256`).
- Messaging gateway: Codex turns that enter through `gateway-chat-bridge.ts:693` are outside the owned chat and lane adapters. Say whether this task must move them onto the App Server, or whether they stay legacy until a later task. Removal A must stay blocked while they still construct the Codex proxy.
- Removals A (translation proxy) and B (`@openai/codex-sdk` lane) still need a separate confirmation after positive parity. This review does not approve either deletion. No capability reduction is approved.

## Bounded fix re-check

Scoped to the post-cap plan edits (486 lines). Source checked at the cited lines on HEAD `0d5be6dae`. Prior CLOSED gaps were not reopened. Findings 1 and 2 are the same items, now closed. No new Blocking or Serious finding.

### 1. Finding 1 — closed

The slash router is owned. Chat-RPC MODIFY at `implementation-plan.md:385` includes `chat-slash-command-router.service.ts`. The native spec is created at `:384`. The seam at `:95-96` requires `ChatRuntimeProfileService.prepare` before profile materialization, including manual compact, and forbids native calls to the old workspace resolver or the concrete SDK adapter. Routing at `:169` and `:189` sends native `/compact` through `SessionRuntimeControls.compact` (`:176`) to core `thread/compact/start` (`:119`, G11 at `:330`). Legacy slash and compact keep SDK `executeSlashCommand`. G1 at `:320` names `chat-slash-command-router.native.spec.ts` for zero global and pooled proxy calls and unchanged legacy execution.

Current source is still the bypass this edit replaces:

- Admission to preserve: `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:130-141` (`requestManualCompact`, settled return without send) and `:169-174` (`admitManualCompact`).
- Proxy acquire: `:163-167` calls `resolveProviderProfileForWorkspace`.
- SDK execution: `:197` calls `this.sdkAdapter.executeSlashCommand`.
- Reservation release to preserve: `:243-249`.

### 2. Finding 2 — closed

Removal A at `implementation-plan.md:430-452` lists both missed callers and the other production hits of `CodexTranslationProxy|resolveProviderProfileForWorkspace` under `libs` and `apps`, excluding specs as the search at `:434` states. `apps` has no hits. Deletion stays a later user confirmation (`:427-428`, decision at `:483`).

| Current reference | Plan row | Verified |
| --- | --- | --- |
| `gateway-chat-bridge.ts:693` | `:440` | `prepareTurn` calls `resolveProviderProfileForWorkspace` at `:693` |
| `provider-proxy-pool.ts:82`, `:500` | `:441` | import at `:82`; `new CodexTranslationProxy` at `:500` |
| `chat-session.service.ts:873`, `:1579` | `:438` | rg hits |
| `chat-slash-command-router.service.ts:164` | `:439` | call at `:164` |
| `di/register.ts:28`, `:166` | `:442` | import `:28`; `useClass: CodexTranslationProxy` at `:166`. `:189` is the factory `resolve` of that token and is named in the start sentence at `:434` |
| `register-providers.ts:38`, `:89` | `:443` | import `:38`; `useClass` `:89` |
| `auth-providers/src/index.ts:99`; `providers/codex/index.ts:8` | `:444` | barrel exports |
| `codex-translation-proxy.ts:30` | `:445` | class declaration |
| `workspace-provider-profile-resolver.ts:30`, `:99` | `:446` | doc link and method. Acquire `proxyPool.acquire` at `:362` is the extra start anchor at `:434`, not a regex hit |

### 3. Gateway consumer — accepted

Thin. `implementation-plan.md:26-27`, `:203`, `:250`, and `:392` add `CodexGatewayAdapter` as a projection onto the shared core. No process, protocol, or approval state machine is copied. No rpc-handlers dependency and no SDK query building. The explicit `ApprovalSink` at `:203` and the parity gate at `:393` fail a missing sink before a turn and deny or fail an unroutable interaction, and they never auto-allow. Claude gateway turns stay on the existing path (`:11`, `:203`, `:250`, `:393`).

Exact files at `:390-392`: create `codex-gateway-adapter.ts`, `codex-gateway-profile.ts`, `codex-gateway-approval-sink.ts`, each with a same-stem spec, plus `gateway-chat-bridge.native.spec.ts`; modify `gateway-chat-bridge.ts`, `gateway-chat-bridge.spec.ts`, `di/tokens.ts`, `di/register.ts`, and `index.ts`. Nx name and tags match `libs/backend/gateway-chat-bridge/project.json:2` and `:6`: `@ptah-extension/gateway-chat-bridge`, `scope:extension`, `type:feature`. Direction at plan `:29` stays acyclic (gateway depends on codex-runtime; core does not import the gateway).

File-disjoint. The gateway owner touches only the `gateway-chat-bridge` prefix. The slash router stays with Chat-RPC (`:385`). Claim-first files are not gateway-owned (`:392`). Host wiring stays on the host-composition files. Order is Electron chat, then gateways, then lanes (`:11`, `:339`, `:393`). The live entry to replace is `gateway-chat-bridge.ts:689-697`. Notices to preserve are `:336-354`.

### 4. Spike — bounds stated and enforced

`implementation-plan.md:260-262`, decision `:475`, and G13 `:332` state the approved experiment from `decisions.md:41`. Hard cap is 8 model turns total, including failed attempts, continuations, and retries, with no automatic retry and no budget reset. The run uses a temporary workspace and a temporary `CODEX_HOME` that holds a copy of auth only, never the user's real home, and it never copies or reads shared `config.toml` into the experiment. Child env overrides only. Side effects are marker files inside that experiment root. No network MCP; a local stdio marker fixture is the only MCP. Stop at the cap, any isolation breach, or an unsupported gate, and leave production disabled (`:262`, `:332`). The first batch still does not enable production (`:258`).

### 5. New defects

None. These edits add no Blocking or Serious defect. G2–G10, G12, and G13 stay CLOSED. Removals A and B remain unapproved.

### Updated gap status

| Gap | Was | Now |
| --- | --- | --- |
| G1 | PARTIAL | CLOSED. Slash router is owned. Native slash and compact use `ChatRuntimeProfileService.prepare` and `SessionRuntimeControls`; legacy execution stays (`:95-96`, `:189`, `:320`, `:385`). |
| G11 | PARTIAL | CLOSED. The compact caller is `ChatSlashCommandRouterService` to `SessionRuntimeControls.compact` to core `thread/compact/start`, with admission and release preserved (`:189`, `:330`; source `:130-141`, `:169-174`, `:243-249`). |
