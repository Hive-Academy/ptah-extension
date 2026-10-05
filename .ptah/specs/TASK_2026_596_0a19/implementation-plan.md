Revision: 3 + Gate 2 amendments (user APPROVED 2026-10-04)

# Implementation Plan - TASK_2026_596_0a19

## Gate 2 amendments (binding; override any conflicting text below)

Approved by the user at Gate 2 together with the plan. They close the two open blockers of the
final Codex review (`implementation-plan-review.md`, Revision 3, New blocking findings 1 and 2).

- **G1 — Req 2.1 amendment APPROVED.** The Claude `rate_limit_event` `utilization` value is not
  ingested. The section "Req 2.1 amendment" below is accepted as written; the rejection branch is void.
- **G2 — Native Claude account change.** There is no Claude account-change event; `authFileChanged`
  stays provider-scoped (Codex only) and is never treated as a Claude invalidation. Instead the native
  Claude probe re-reads `accountInfo()` at the start of EVERY query (bound: one read per query, not per
  session; replace the "at most one `accountInfo()` per session" claim). When the fingerprint differs
  from the previous query, the session's current owner becomes the new owner from that query on;
  earlier runs keep their recorded owner. F55/F77 drive this real per-query path (two queries with
  different `accountInfo()` results), not a synthetic event.
- **G3 — Restored run owner.** Persist the full minimal, non-secret owner reference per run, not only
  the opaque key: `CliSessionReference.quotaOwner?: { providerId; identityKind; key; label }` where
  `key` is the canonical hashed owner key and `label` is a generic non-secret label (e.g. "Claude
  account", "Codex account"). Replaces `quotaOwnerKey`. Validate it with zod when restoring; a
  malformed or legacy value restores as "Unknown owner", never as the current owner. Add a restart
  fixture: run A on account A with NO ledger evidence, session moves to account B, after restore run A
  still shows "Different owner".
- **Non-blocking notes (implement):** Component 10b assembles the provider snapshot that
  `resolveEffectiveAuthRoute` needs (`effective-route.ts:36-58`) and keeps the F81-F83 cases; when a
  running lane's owner changes from unknown to known, persist it immediately.

## Revision 3 changes

This revision answers `implementation-plan-review.md` (codex lane, Revision 2, REVISE). It is
the final round; any open items go to the user gate.

| Item | Change | Sections changed |
| --- | --- | --- |
| Finding 1 PARTIAL: Gate 2 rejection path | A rejection blocks only the Claude event-mapper batch, pending a focused plan revision. No heuristic is promised | "Req 2.1 amendment" section; Team-leader handoff, Verification points |
| New 1: S1 used cumulative `modelUsage` | S1 scope now comes from the current turn's frozen main-loop `message_start` models; subagents are excluded. Overage state resets per turn and billing is `'plan'` only from an in-turn event. Opus-then-Sonnet regression F75 and per-turn reset F76 added | Decision 4 (S1, S2 rows and rules); Component 4 (per-turn state, specs); fixtures F75-F76 |
| New 2: non-canonical proxy owner key | One canonical set of functions in `provider-owner.resolver.ts`: case-insensitive headers, one recognised scheme stripped, raw `x-api-key`, and the single fingerprint implementation. The proxy hook calls it. The agent-sdk fingerprint file is removed. F67b compares a proxy key with the resolver key for the same raw credential; F78 covers header parsing | Decision 3; Components 4, 5, 7 and 9; fixtures F67b and F78; Files affected |
| New 3: discovery could not build valid targets | Component 10b resolves the selected provider through `resolveEffectiveAuthRoute`, with a per-route target table covering `claude-cli`, direct Anthropic key, Codex home, OpenCode, Ollama and other providers, plus local CLI stores. `{kind:'session'}` becomes `sessionHandle`, a probe handle and never a secret. F81-F83 added; F71 kept | Components 4, 6 and 10b; fixtures F81-F83 |
| New 4: A1 account change versus lifecycle | New Decision 10: invalidation of the probe, Codex and credential owners; per-run owner retention via `CliSessionReference.quotaOwnerKey?` (minimal identity, `task-description.md:480-488`); no substitution of the current owner; `forgetOwner` removed in favour of reader-cache drop plus evidence retention. F55 rewritten as a full A→B flow including a restored run; F77 and F79 added | Decision 10; Components 1, 4, 5, 10, 14 and 15; fixtures F55, F77 and F79 |
| New 5: S4 billing and boundary | In-scope proxies enumerated (`openai-codex`, `opencode-go`, `opencode-zen`), all `'unknown'`. S4 now clears cooldowns only and is not a Req 3.8 producer. The ledger success signal fires only on 2xx; the gate's `< 400` clearing is unchanged. F80 covers 2xx, 3xx, credit/fallback and unknown owner | Decision 4 (S4 table); Component 9; Data flow; fixtures F66 and F80 |

## Revision 2 changes

This revision answers `implementation-plan-review.md` (codex lane, Revision 1, REVISE). It
follows the orchestrator's decisions for round 1.

| Finding | Change | Sections changed |
| --- | --- | --- |
| 1 (blocking): Req 2.1 `utilization` | The used value from the event is **deferred**. Event `utilization` is never ingested; reset and rejection evidence still ship, and percentages come from the full-table usage query. Recorded as an amendment pending user approval. The coverage claim now reads "Req 1-8 except the pending Req 2.1 amendment" | New section "Req 2.1 amendment — PENDING USER APPROVAL at Gate 2"; Inputs (missing input 2); Component 4; fixtures F13a; Architecture-level quality requirements |
| 2 (blocking): no success producer | Four production success producers are named, each with owner, allowance and billing resolution. `recordSuccess` clears only on `billing:'plan'` for the same owner and allowance. A regression matrix is added | Decision 4; Components 4, 5, 9 and 10; Data flow; fixtures F62-F66 |
| 3 (blocking): proxy 429 ownership | An opaque owner key is carried at the proxy response boundary through a minimal edit to `translation-proxy-base.ts`. Codex resolves it from its account owner and other providers from the request credential. Behaviour when identity is unavailable is specified. A test covers two same-provider accounts | Decision 3; Component 9 (rewritten); Component 5; 597 seam; fixtures F67-F68 |
| 4 (blocking): dashboard owner discovery and secrets | A new backend owner discovery service names the in-scope owners. A backend-only credential source resolves secrets; no secret crosses RPC. `provider:getPlanLimits` takes the dashboard's selected `providerId`, which keeps the current selection input | Components 6, 8, 10 (new 10b), 12, 13 and 16; Data flow; fixtures F69-F72 |
| 5 (blocking): Component 8 droppable | Component 8 is mandatory. The "can be dropped" text is removed | Team-leader handoff |
| 6 (blocking): expansion cap breaks A3 | Expansion state is provided per chat view and released with it. There is no global cap. A test crosses 200 entries in another view | Component 15; fixture F73 |
| 7 (non-blocking): Codex re-pin | Kept as planned | — |
| 8 (non-blocking): citations | Kept. The rule to reopen citations before editing stays | — |
| 9 (non-blocking): logging and eviction | Classifier matches are logged at debug only. Eviction never drops active or persisted evidence before its expiry | Decision 4; Component 5; Observability |

Plan-limit windows and reset detection for Claude, Codex, Antigravity, OpenCode and Ollama Cloud.
They are shown in the per-session stats grid, the dashboard card, `ptah_agent_list` and
`ptah_agent_spawn`.

All paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets` unless written in full. The
file lists in each component and in the handoff use absolute paths.

## Inputs and constraints

- **Requirements used**:
  - `task-description.md` Rev 3: Req 1-8, D1-D3, P1-P9. Approved at Gate 1.
  - `design-spec.md` Rev 5, including the binding §3.3 amendments A1-A3. Approved at Gate 1.7.
  - `context.md`: the "Rebase" and "User Decisions" sections.
  - `research-report.md`, `task-description-review.md`, `design-spec-review.md`.
  - `prototype/README.md`, for reference only. Its owner-identity fixture logic is not used (A1).
  - The TASK_2026_597 `batches.md` (Batches 11, 12, 13, 22, 26, 27) and its `implementation-plan.md` (lines 455-479, 921-933).
  - `CONVENTIONS.md`.
  - There is no root or per-library `CLAUDE.md` on this branch. `ls libs/*/*/CLAUDE.md` returns nothing, so `CONVENTIONS.md` is the governing instruction file.
- **Corrections applied**:
  - Design §3.3 A1-A3 override the prototype and the earlier §3.3 examples.
  - Gate 1.7 accepted these defaults: P3 = 90 %, P4 = variant A, P5 = 3 s, P6-P8 as listed, P9 = 15 min, T1 = local zone with abbreviation, T2 = short source labels.
- **Design handoff used**: `design-spec.md` §0-§9. The component and label names below follow it verbatim: "Plan limits", "Alternatives by limit state", "lane · not in totals", "Lanes · subtotal", the state chips, and the source labels in §1.
- **Missing decision-critical input**:
  1. No real Codex rollout `token_count.rate_limits` fixture exists. The 597 fixture `scripts/agent-usage/__fixtures__/rollout-2026-10-03T13-26-45-74-turn-lane.jsonl` contains 0 `rate_limits` keys (grep count 0). Its reader spec builds a synthetic `rate_limits` at `scripts/agent-usage/codex-rollout.reader.spec.ts:53`. Live rollout reads are not authorized.
     - Decision blocked: Req 2.4 capture of lane rollout quota.
     - Resolution: not built in this task. See Decision 6 and the 597 seam.
  2. The `SDKRateLimitInfo.resetsAt` units and the `utilization` scale are unstated (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5333-5337`).
     - Resolution: instants are normalised by magnitude under Req 1.3. Event `utilization` is **not ingested**; see "Req 2.1 amendment — PENDING USER APPROVAL at Gate 2".
  3. The Antigravity `GetUserStatus` and Ollama `/api/usage` payloads are third-party only.
     - Resolution: both readers are built as isolated, validating adapters that use the provisional shapes. Any mismatch returns `service-unavailable` (Req 2.5).

### Rule provenance

- **[user-requested]**:
  - D1, D2, D3 and the 2026-10-04 lane update: codex and opencode lanes only.
  - The P1-P9, T1 and T2 defaults.
  - Tiles instead of titled sections (Gate 1.7 caveat).
  - A1, A2, A3.
  - No settings-page edits.
  - 597 follow-ups not re-implemented, a single rollout module, and "not reported"/"unknown" never shown as 0.
  - No live checks.
  - Spawns warn and are never blocked.
  - A single failure-kind union.
  - The agent picker is out of scope.
- **[project-rule]**:
  - The `CONVENTIONS.md` §2-§9 shapes: tokens in `di/tokens.ts`, `Symbol.for`, one `register*Services`, sync idempotent `dispose()`, `*Service`/`*Store` suffixes, barrels of 150 lines or fewer.
  - Layer and tag rules (`eslint.config.mjs:254-388`).
  - The typed RPC registry (`libs/shared/src/lib/types/rpc.types.ts:742,3695`).
  - Standalone, OnPush, signal-input Angular components.
  - The guard specs `vendor-roster-drift.spec.ts` and `lane-rule-single-home.spec.ts`.
- **[lane-proposed]**: the codex review lane recorded these in design-spec §9:
  - `text-base-content/70` for new secondary text.
  - No semantic colour used as text colour.
  - The short source wording.
  - The Limits pill first in the collapsed row.
  - Every tile starts closed.
  - The lane-tile caption, dashed border and subtotal tile.
- **[orchestrator-decided, Revision 2]**:
  - Defer the event used value (pending user approval).
  - Component 8 is mandatory.
  - A minimal `translation-proxy-base.ts` edit is allowed for the owner key.
  - Keep the dashboard's provider-selection input.
  - Expansion state is scoped to the session view.
  - Classifier logging is debug only, and eviction never drops active or persisted evidence.
- **[architect-proposed]**: introduced here, each justified in a decision below:
  - Owner keys are opaque fingerprints (Decision 3).
  - Success counts as clearing evidence only when billing is `plan` (Decision 4).
  - One `PLAN_LIMITS_CHANGED` push carries a full snapshot (Decision 7).
  - The lane usage accumulator is computed before the segment cap (Decision 8).
  - The Codex protocol is re-pinned (Decision 9).

## Req 2.1 amendment — PENDING USER APPROVAL at Gate 2

- **Approved text (Req 2.1)**: a native Claude `rate_limit_event` records the window for its
  `rateLimitType`, carrying the event's `utilization` and `resetsAt` with source `stream-event`.
- **Proposed amendment**: record `rateLimitType`, `status` (`rejected` means exhaustion) and
  `resetsAt` (normalised under Req 1.3) with source `stream-event`. **Do not ingest
  `utilization`** until a provider-authored contract or a normally observed fixture pins its
  scale. The window's used value comes only from the full-table usage query (Req 2.2,
  `provider-api`, documented 0-100 at `sdk.d.ts:4036-4085`). Without that query, the used value is
  "unknown".
- **Why**:
  - `SDKRateLimitInfo.utilization` has no documented scale (`sdk.d.ts:5333-5337`).
  - Live fixture collection is not authorized.
  - A magnitude heuristic is ambiguous at `1`.
- **Effect on behaviour**:
  - A Claude event alone cannot raise "near limit". Only exhaustion (`rejected`) and resets come from events.
  - Room still requires the full table (Req 5, unchanged).
- **Recommended default**: the reviewer's (`implementation-plan-review.md`, Clarifications).
- **If the user rejects the amendment at Gate 2 (Revision 3)**:
  - Only the Component 4 **Claude event-mapper batch** is blocked, pending a focused plan revision. That revision would define the conversion and replace F13a and this coverage statement.
  - No heuristic is promised here.
  - Every other component proceeds: the full-table usage query, the ledger, lanes, the tools and the UI do not depend on the event's used value.
- **Coverage statement**: this plan covers Req 1-8 **except the pending Req 2.1 amendment**.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `provider:getAccountUsage` result: a status union of 8 values, `quota.primary/secondary {usedPercent, windowDurationMins?, resetsAt?}`, `account`, `activity` | `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:154-194` | Extend additively and keep these fields (Req 2.10, compatibility NFR) |
| RPC registry entry and method list | `libs/shared/src/lib/types/rpc.types.ts:1131-1134, 3695, 3797` | A new RPC needs both entries. `'provider:'` is already an allowed prefix (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:51`) |
| The handler returns `provider-unsupported` for every non-Codex id | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:171-187` | Replace with a provider-dispatching service |
| Codex reader: 30 s cache, eligibility gate, stale-on-failure, `CODEX_HOME` binding, and cache cleared on `authFileChanged` | `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:17, 89-91, 96-136, 146` | Reuse as the Codex source. The owner-scoped stale rule is added (Req 2.9) |
| Codex protocol pinned to `0.147.0`. The version check is `output.trim().endsWith(pin)` | `codex-account.schemas.ts:8`; `codex-account-usage.service.ts:191-203` | See the next row |
| Installed `@openai/codex` is `0.155.1`, pulled in by `@openai/codex-sdk ^0.155.1` | `node_modules/@openai/codex/package.json:3`; `package.json:126` | The pin check most likely fails on this branch, so Codex always reads `cli-version-unsupported` (Decision 9, Assumption A1) |
| `RateLimitWindow {usedPercent, windowDurationMins: number\|null, resetsAt: number\|null}`. The snapshot carries `rateLimitReachedType`; the response carries `rateLimitsByLimitId` | `libs/backend/auth-providers/src/lib/providers/codex/protocol/codex-account.generated.ts:22-44` | Window kind comes from duration (Req 2.3). `rateLimitReachedType` is window evidence when present |
| `CodexHomeResolver`: `override \|\| env.CODEX_HOME \|\| ~/.codex`. Production builds it with no override | `codex-home-resolver.ts:15-27`; `register-providers.ts:67` | Codex lanes inherit `process.env` (`codex-cli.adapter.ts:494-498`), so lane and reader resolve the same home. This is the A1 Codex identity basis |
| `ProviderQuotaStore`: cooldown only, a 15-minute default, clamped to 1 s-6 h, later deadline wins, no listener | `libs/backend/auth-providers/src/lib/auth/provider-quota.store.ts:52-62, 71-91, 108-120, 172` | Cooldown evidence must be read before the clamp (Req 3.6). The gate behaviour stays unchanged (out of scope) |
| Proxy 429 path: `noteUpstreamQuota` gets `getProviderId()` (registry id) and the raw `retry-after`. The body is discarded | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:261, 271-290, 1109-1139` | Upstream attribution is available (Req 3.2). The proxy is not DI-built, so the module-level store is the reachable seam |
| `SDKRateLimitInfo {status, resetsAt?, rateLimitType?, utilization?, overage*}`. Units are unstated | `sdk.d.ts:5320-5354` | Partial, change-driven evidence (Req 2.1) |
| `SDKAPIRetryMessage {type:'system', subtype:'api_retry', error, error_status, retry_delay_ms}`; `SDKAssistantMessageError` includes `'rate_limit'` | `sdk.d.ts:3384-3391, 3484` | Captures the SDK's internal retries before any terminal failure (Req 3.1, 3.2) |
| `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors})` returns `rate_limits_available`, ISO `resets_at`, `utilization` 0-100, `model_scoped[]` and `extra_usage`. `Query.accountInfo()` returns `{email?, organization?, subscriptionType?, apiKeySource?, apiProvider?}` | `sdk.d.ts:2856-2874, 4012-4104, 20-32, 2928` | Full-table Claude source (Req 2.2) and the Claude A1 identity. The SDK is pinned exactly at `0.3.278` (`package.json:103`) |
| `rate_limit_event` matches no branch and fails the forwarding filter, so it is dropped. `isRateLimitEvent` is unused | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:412, 799-812`; `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:400` | A new branch in the existing loop |
| The session-scoped push pattern: `SessionMcpStatusCallbackRegistry extends CallbackRegistryBase`, fed by `StreamTransformer`, broadcast by `ChatSessionService.publishMcpStatus` | `session-mcp-status-callback-registry.ts:77`; `callback-registry.base.ts:12-52`; `stream-transformer.ts:503`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:275-294` | The precedent for the Claude evidence channel |
| The live `Query` stays open between turns, held in `SessionRecord.query`. Control calls are guarded through `registry.find` | `session-registry.service.ts:62, 177, 395`; `session-control.service.ts:422, 467` | The usage query and `accountInfo()` can run on the open query |
| Per-session route: `capacityRoute {kind:'native', providerId:'anthropic'}`, or a proxy `providerId`, or null | `session-query-executor.service.ts:83-130, 228`; `session-registry.service.ts:107-115` | Session owner resolution for proxied main agents (Req 3.2) |
| `AgentStatus` = running, completed, failed, timeout, stopped. No `claude` CLI type: Claude and Glm lanes are `ptah-cli` with `providerId` | `libs/shared/src/lib/types/agent-process.types.ts:42-43, 58-69, 107-149`; `libs/shared/src/lib/types/ptah-cli.types.ts:13-32` | Lane owner depends on the ptah-cli provider |
| No `failureKind` or `stopReason` union for CLI lanes exists on main. 597 planned `stopReason?: 'tool-call-budget' \| 'repeat-call' \| string` (not merged) | grep `libs`; `.ptah/specs/TASK_2026_597_ab22/implementation-plan.md:452` | 596 defines the single union (Decision 5) |
| `handleExit` sets `completed`/`failed` from the exit code; `tracked.stdoutBuffer` and `accumulatedSegments` are available until `outputBuffer.discard` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1654-1710`; `tracked-agent.ts:16, 42` | Quota classification point (Req 3.3) |
| `summarizeCliSdkError` knows only the Codex wording (`/usage limit/i`, `/try again at\s+…/i`) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:20-22, 58-90` | Wordings move to one classifier; the summary keeps its display role |
| The ptah-cli stream loop emits usage only as an `info` text line (`Completed: N input, …`) | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:473-490` | Claude and Glm lanes report no structured tokens or cost today (Req 8.2) |
| `cliSessions` persisted on spawn and exit via `SessionMetadataStore.addCliSession`. `CliSessionReference` has no usage or failure field | `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:171-213, 309-445`; `agent-process.types.ts:378-402` | Restored rows show what that store holds (Req 8.4). No field is added |
| `AgentMonitorStore` holds `MonitoredAgent {cli, model?, parentSessionId?, segments}`, filtered by `agentsForSession`. Segments are capped at 500+100 | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:86-161, 447, 839-867`; `agent-output-retention.ts:209` | Lane tiles derive from it. Usage must be accumulated before the cap (Decision 8) |
| `extractCliAgentStats` sums tokens; last `costUsd` wins | `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:33-62` | The 597 Batch 22.1 target. It becomes the one usage fold (seam) |
| Stats component: signal inputs `snapshot`, `liveModelStats`, `compactionCount`; collapsed strip; 2-column card grid; Models toggle has `aria-expanded` but no `aria-controls` | `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:54-58, 60-211, 212-414, 669-685` | Add optional inputs. The harness-builder host passes none (`harness-builder-view.component.ts:400-403`) |
| Stats host binding | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:27-31`; `chat-view.component.ts:773-792` | View models are built here |
| Dashboard card gated `isCodex()`; no inputs; state service loads only for `openai-codex` | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:11-52`; `provider-account-state.service.ts:15-43` | Rewrite for every owner (Req 6.6) |
| Push routing: `MESSAGE_HANDLERS` multi-provider (`useExisting`) | `libs/frontend/core/src/lib/services/message-router.types.ts:33-49`; `apps/ptah-extension-webview/src/app/app.config.ts:173-176` | Frontend store registration. Electron builds the same webview (`apps/ptah-electron/project.json:7, 278`) |
| Shared listeners resolved once per host by `activateSessionLifecycleNotifier` | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:49-80`; `apps/ptah-electron/src/activation/bootstrap.ts:415`; `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:93` | The broadcaster activates here, with no app edits |
| Formatter: `formatAgentList(agents, roles?)` and `formatAgentSpawn(result, {modelTier?})`. No failed-spawn or refused formatting. Spawn failures surface as `toolErrorResponse`/`toolError` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1734-1829`; `protocol-dispatcher.ts:1101-1132`; `mcp-stdio/agent-tool.dispatcher.ts:329-422` | Limit text is appended on success and on failure, in both transports |
| Shared agent tool logic: `buildAgentNamespace(deps)` with optional deps; `list` builds rows from detection plus the ptah-cli registry | `namespace-builders/agent-namespace.builder.ts:152-170, 355-411`; `ptah-api-builder.service.ts:657-764` | Add an optional `getLaneLimits` dependency |
| Deadline helper `settledWithin(promise, ms)` | `protocol-dispatcher.ts:2901-2916` | Precedent for the P5 lookup deadline |
| `IStateStorage {get, update, keys}` under `PLATFORM_TOKENS.STATE_STORAGE`, with adapters in all three platforms | `libs/backend/platform-core/src/interfaces/state-storage.interface.ts`; `libs/backend/platform-core/src/di/tokens.ts:16` | P6 persistence needs no new port |
| Process-probe pattern: an injected `ProbeCommandRunner` over `cross-spawn` | `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts:75-80` | Antigravity process discovery follows it. No new port |
| Antigravity CLI root is `~/.gemini` (HOME/USERPROFILE first) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:426-434` | `cli-store` identity material |
| OpenCode data dir is `XDG_DATA_HOME or ~/.local/share` plus `/opencode` | `scripts/agent-usage/opencode-db.reader.ts:57-60` | `cli-store` identity material |
| A Codex rollout reader already exists as a dev script. It reads `rate_limits.primary.used_percent` only. Nothing in `libs/` or `apps/` imports `scripts/` | `scripts/agent-usage/codex-rollout.reader.ts:1-26, 107-109, 219-226` | Do not create a second reader (Decision 6) |
| Tags: shared and platform-core are `scope:shared,type:util`; backend libs are `scope:extension,type:feature`; chat-ui, chat, dashboard and chat-streaming are `scope:webview,type:feature`; core is `type:core` | `project.json` files; `eslint.config.mjs:254-388` | Shared code must not import extension libs. chat-ui may import core but not chat (`chat` imports `chat-ui`) |
| Backend import graph: auth-providers → agent-sdk; cli-agent-runtime → agent-sdk and auth-providers; vscode-lm-tools → cli-agent-runtime and agent-sdk; agent-sdk → neither | import counts per lib (grep of `from '@ptah-extension/…'`) | Places the ledger in auth-providers (Decision 2) |
| Guard specs: no vendor brand in agent-facing strings or in `formatAgentList([])`; Type in column 2 and Status in column 3 | `vscode-lm-tools/.../vendor-roster-drift.spec.ts:48-94`; `lane-rule-single-home.spec.ts:21-86` | New column appended last. No brand in new static strings |

## Architecture decision

- **Chosen approach**: one provider-neutral evidence model, as pure shared types and logic. Every
  evidence channel writes into one backend ledger. One snapshot is read by every surface:
  - **Contract and rules (libs/shared)**: types, instant normalisation, the design §2 state
    engine, precedence, and time formatting. Pure, with no zod and no extension imports.
  - **Evidence ledger (auth-providers)**: one `PlanLimitLedgerService` keyed by quota owner. It
    holds allowances, owner-level evidence and cooldowns, and applies Req 3.7/3.8/4.4. It persists
    only known-reset exhaustion (P6).
  - **Full-table readers (auth-providers)**: `PlanUsageService` dispatches to one reader per
    provider. Codex uses the existing service. Claude uses an agent-sdk probe on the open Query.
    Ollama Cloud and Antigravity use isolated provisional adapters. OpenCode returns
    `no-usage-source`. Results are merged with ledger evidence into a `PlanLimitOwnerSnapshot`.
  - **Evidence capture**:
    - Claude stream signals go from `StreamTransformer` (main) and `PtahCliStreamLoop` (Claude and
      Glm lanes) through one mapper and a session callback registry.
    - Proxy 429s reach the ledger through an observer on `ProviderQuotaStore`.
    - Lane exits go through a wording classifier in `AgentProcessManager.handleExit`.
  - **Surfaces**:
    - `provider:getPlanLimits` RPC plus a `planLimits:changed` push feed a root
      `PlanLimitsStore` (frontend core). The stats grid (chat-ui tiles, composed in chat-view) and
      the dashboard card read that store.
    - The MCP tools read through `LaneLimitLookupService` (cli-agent-runtime), with the 3 s
      deadline.
- **Rationale**:
  - The state semantics (design §2) must be identical in UI and tool text. One pure engine in
    shared is the only place both layers can import (tags: `scope:shared`).
  - The ledger must be reachable by three writers: agent-sdk, auth-providers and
    cli-agent-runtime. agent-sdk cannot import auth-providers (auth-providers → agent-sdk), so
    agent-sdk publishes and auth-providers subscribes. That follows the existing precedent:
    `CodexAccountUsageService` subscribes to agent-sdk's `SdkAdapterEvents`
    (`codex-account-usage.service.ts:89`).
- **Rejected alternatives**:
  1. **Ledger in agent-sdk**: rejected because agent-sdk is a lower layer than the readers that
     must enrich it (Codex, Ollama). It would also pull provider knowledge into the SDK lib.
  2. **A new `quota-contracts` lib**: rejected. There is a single implementation and no second
     consumer of a separate contract. The interface types already fit in shared (simplicity rule).
  3. **Separate per-provider RPCs**: rejected. Req 6.6 and 7 need all owners plus session
     ownership in one view.
  4. **Extending `SdkAdapterEvents` instead of a callback registry**: rejected. 597 Batch 27.2
     edits `sdk-adapter-events.service.ts`, and the session-scoped push precedent is the registry
     (`stream-transformer.ts:503`).
- **Assumptions**: see "Assumptions to resolve" under Integration architecture (A1-A9).
- **Effect on existing code**:
  - `provider:getAccountUsage` keeps every field. It gains additive fields and the
    `no-usage-source` status.
  - The dashboard Codex-only state service is deleted and replaced.
  - `ProviderQuotaStore` gate semantics are unchanged; only an observer is added.
  - `summarizeCliSdkError` output is unchanged.
  - The existing stats cards, per-model table and context bar are unchanged. The uncommitted
    "Context" rename (`session-stats-summary.component.ts:86-87, 243`) is kept.

### Decision 1: one shared engine for design §2 (Req 1, 5, 7; design §2)

- **Chosen**: pure functions in `libs/shared/src/lib/utils/plan-limits/`:
  - `classifyWindow(window, ctx) → WindowState`, with these states in first-match order: `limit-reached`, `reset-usage-unknown`, `usage-unknown`, `estimate-only`, `aged`, `not-confirmed`, `near-limit`, `ok`.
  - `classifyOwnerEvidence(e, now) → active | expired`.
  - `classifyLaneState(applicable, ctx) → {state: at-limit | near-limit | confirmed-room | unknown, reasons[]}`.
  - `groupAlternatives(rows)`.
  - `ctx = {now, nearLimitPercent: 90, freshnessMs: 15*60_000, status}`.
- **Evidence**:
  - Design §2.1-2.2 defines exact ordering.
  - The webview cannot import extension libs (tags), and the tool formatter cannot import Angular.
- **Rejected**: computing state in the backend and shipping it pre-classified. State depends on
  `now` (expiry, freshness, Req 1.7, Req 3.7), so a pushed classification would go stale between
  pushes. The frontend instead evaluates the engine against one clock signal.

### Decision 2: the ledger lives in auth-providers and is fed by publish/subscribe (Req 3, 4)

- **Chosen**: `PlanLimitLedgerService` in `libs/backend/auth-providers/src/lib/quota/`, token `AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER`. It is written by:
  - **agent-sdk**: through `SessionPlanLimitCallbackRegistry`. The ledger registers a callback.
  - **auth-providers proxies**: through `providerQuotaStore.onRateLimit`.
  - **cli-agent-runtime**: directly, since it already imports auth-providers.
- **Evidence**: the import graph in Codebase evidence.
- **Rejected**: writing evidence onto `SdkAdapterEvents`. That would conflict with 597 Batch 27.2
  edits to the same file.

### Decision 3: quota owner identity (A1, Req 4)

- **Owner key**: `QuotaOwnerRef.key = "<providerId>#<identityKind>:<fp>"`.
  - `fp` = the first 16 hex characters of SHA-256 over `"ptah-quota-owner\0" + identity material`.
  - `identityKind` is one of:
    - `account`: a provider-verified account id.
    - `credential`: an API key fingerprint.
    - `cli-store`: the resolved credential store of a CLI.
    - `unknown`: identity cannot be determined. The key is then `"<providerId>#unknown:<fp(route material)>"`, where the route material is a proxy instance id, a `CODEX_HOME` path, or a run id when nothing else exists.
      - An unknown key is never treated as shared: `ownerRelation` returns `unknown` whenever either side's kind is `unknown`, even if the keys are equal.
      - A session always shows the snapshot of **its own** owner key, unknown or not. That is not borrowing.
  - The fingerprint is opaque. It is never logged with its material, and the material is never sent.
- **Identity per provider**:

| Provider / route | Identity material | Kind |
| --- | --- | --- |
| Claude main session (native) and Claude ptah-cli lane | `accountInfo().email + "\0" + organization` from that session's or lane's own `Query` | `account`, or `unknown` when `email` is absent |
| Claude via API key (`apiKeySource` set, `rate_limits_available=false`) | none | status `unsupported-auth` (Req 2.2) |
| Codex (main via proxy, or a codex lane) | resolved `CODEX_HOME` path plus the `account/read` email from that home | `account` once read; `unknown` before the first read or after the auth file changes |
| Ollama Cloud (main session with key, or a Glm ptah-cli lane with a real key) | the API key | `credential`. A placeholder key (local daemon) gives `unknown` |
| OpenCode lane | `XDG_DATA_HOME or ~/.local/share` plus `/opencode` | `cli-store` |
| OpenCode main session via proxy | the API key | `credential` |
| Antigravity lane | the account field from a validated `GetUserStatus` payload, else the `~/.gemini` root | `account`, else `cli-store` |

- **Relation rule**: `ownerRelation(a, b)` returns:
  - `same` only when both kinds are known, the kinds are equal, and the keys are equal.
  - `different` when both are known and the providers differ, or the kinds are equal and the keys differ.
  - `unknown` otherwise, including two known identities of different kinds for one provider.
- **Evidence**: A1 text; `codex-home-resolver.ts:25`; `sdk.d.ts:20-32`; `ptah-cli-registry.ts:210-225, 1470-1500` (lane key source); `antigravity-cli.adapter.ts:426-434`.
- **One resolver, one canonical credential function (Revisions 2-3)**: everything lives in
  `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`.
  - **Module-level pure functions**. They are module-level because the proxy base is not
    DI-built.
    - `ownerFingerprint(material: string): string`: SHA-256 over
      `"ptah-quota-owner\0" + material`, first 16 hex characters. This is the **only**
      fingerprint implementation; the agent-sdk copy proposed in Revision 1 is removed.
    - `credentialFromHeaders(headers): string | null`:
      - Header-name lookup is case-insensitive.
      - `x-api-key` wins and is taken raw (trimmed).
      - Otherwise the `authorization` value has exactly one recognised scheme stripped (`Bearer` or `Basic`, case-insensitive, followed by whitespace).
      - A value with no recognised scheme is used raw. An empty result returns `null`.
    - `credentialOwnerKey(providerId, rawCredential): string`:
      `"<providerId>#credential:" + ownerFingerprint(rawCredential.trim())`.
    - `accountOwnerKey(providerId, accountMaterial): string`: `#account:`.
    - `cliStoreOwnerKey(providerId, path): string`: `#cli-store:` over the resolved, lower-cased-on-win32 path.
    - `unknownOwnerKey(providerId, routeMaterial): string`.
  - **The `ProviderOwnerResolver` class** (DI) wraps these. Its methods are:
    - `ownerForProviderKey(providerId)`: reads `getProviderKey(providerId)`.
    - `ownerForPtahCli(ptahCliId, providerId)`: reads `getProviderKey('ptahCli.<id>')`.
    - `ownerForClaudeAccount(accountInfo)`.
    - `ownerForCodexHome()`: delegates to `currentOwnerKey()`.
    - `ownerForCliStore(cli)`.
    - `ownerForSession(sessionId)`: Component 10b's route table.
  - **Callers**: the ledger, the readers, the proxy hook (Component 9), session routes, lanes and discovery. No other file hashes or parses a credential.
  - **Why the keys agree**: the stored raw key `K` and a proxy request carrying `Authorization: Bearer K` (`opencode-proxy.factory.ts:31-33`) produce the same `credentialOwnerKey(providerId, K)`.
  - **Proxied main sessions**: these sessions carry only a placeholder in their auth env (`session-query-executor.service.ts:83-130`). Their owner is therefore `ownerForProviderKey(route.providerId)`: the same stored key the proxy sends, so the same owner key.
- **Rejected**: provider-family equality, the prototype's rule. A1 forbids it explicitly.

### Decision 4: evidence precedence and lifetime (Req 3.5-3.8, 4.4)

- **Precedence**: `supersedes(next, prev)` in shared, applied per allowance (owner + window key + model scope):
  - Newer non-stale evidence wins.
  - `estimated` never supersedes non-estimated evidence observed after the window's last reset.
  - Stale API data never clears a newer `stream-event` or `error-derived` exhaustion.
- **Expiry**:
  - Exhaustion with a known reset expires at the reset. The engine computes this at read time, so no timer is needed.
  - Exhaustion with an unknown reset clears only when one of these happens:
    - a full-table read shows the same allowance below its limit and was observed after the exhaustion;
    - a success is recorded against the same allowance and model scope, with `billing:'plan'` (see below);
    - the provider's longest window has elapsed, after which the window reads as unknown usage;
    - the host restarts.
- **Success producers (Revision 2, Req 3.8)**: `ledger.recordSuccess({ownerKey, modelScope, billing, observedAt})`, where `billing` is `'plan' | 'overage' | 'fallback' | 'unknown'`. Only `'plan'` clears anything.

| # | Success event | Production caller | Owner | Model scope | Billing |
| --- | --- | --- | --- | --- | --- |
| S1 | Main Claude session success `result` (`isSuccessResult`) | `StreamTransformer` result branch (`stream-transformer.ts:513-794`) → `SessionPlanLimitCallbackRegistry` signal `{kind:'success', sessionId, turnScopes}` | session owner (Decision 3) | **Per-turn, frozen.** The Claude families of the **main-loop** models seen in this turn's `message_start` events, tracked as `currentStreamModel` (`stream-transformer.ts:401-403`). Subagent partials are excluded, matching the existing gauge rule at `:418-426` (`!sdkMessage.parent_tool_use_id`). The set is reset after each `result`. **Never** taken from `result.modelUsage`, which is cumulative per query (`stream-transformer.ts:684-687, 769-773`) | **Per-turn overage state.** Reset to `unseen` at the start of each turn (the first SDK message after the previous `result`). Within the turn, the latest `rate_limit_event` wins. Billing is `'plan'` only when an event **in this turn** had `isUsingOverage !== true`, `overageInUse !== true` and `status !== 'rejected'`. It is `'overage'` when either flag is true, and `'unknown'` when no event arrived in the turn, in which case nothing clears |
| S2 | Claude or Glm lane success `result` | `PtahCliStreamLoop` result branch (`ptah-cli-stream-loop.service.ts:473-490`) → `onPlanLimitSignal` | the lane's recorded owner (`AgentProcessInfo.quotaOwnerKey`, captured per run; Component 10) | the same per-turn main-loop rule as S1, applied to the lane's own stream | Claude: same per-turn rule as S1. `ollama-cloud`: `'plan'`; Ollama documents no overage, credit or fallback billing (research rows 33-34) |
| S3 | System CLI lane exits `completed` (antigravity, codex, opencode) | `AgentProcessManager.handleExit` when the status becomes `completed` (`agent-process-manager.service.ts:1666`). ptah-cli is excluded because S2 covers it | the run's recorded `quotaOwnerKey` | from `info.model` | antigravity: `'plan'`; codex: `'unknown'` (credits can bill after a limit; `codex-account.generated.ts:34`); opencode: `'unknown'` (Go can fall back to Zen balance; research row 31) |

- **S4 (proxy success) is not a Req 3.8 producer (Revision 3)**. These are the in-scope translation-proxy providers and their billing:

| Proxy (registry id) | Source | Billing classification | Reason |
| --- | --- | --- | --- |
| `openai-codex` (`CodexTranslationProxy`) | `codex-translation-proxy.ts:27-49` | `'unknown'` | Credits can bill after a plan limit (`codex-account.generated.ts:34`) |
| `opencode-go` (`OpenCodeTranslationProxy`) | `opencode-proxy.factory.ts:16-37` | `'unknown'` | Go can fall back to Zen balance (research row 31) |
| `opencode-zen` (same class) | same | `'unknown'` | Pay-as-you-go balance, not a plan window |

  - Ollama Cloud uses no translation proxy: direct mode goes through `LocalNativeStrategy`.
    `LocalModelTranslationProxy` serves LM Studio (`local-native.strategy.ts:55`), which is out
    of scope. The other proxies (Copilot, OpenRouter, Sakana, custom) are out of scope and
    default to `'unknown'`.
  - Since no in-scope proxy provider is provably plan-billed, an S4 success **clears only that
    owner's ledger cooldown**. It never clears exhaustion or owner evidence.
  - The ledger signal fires only when `200 <= statusCode < 300` (Component 9). The existing
    `< 400` gate-clearing call is unchanged.

- **Rules applied by the ledger**:
  - A `'plan'` success clears unknown-reset exhaustion for `five_hour`, `weekly` and `weekly_model:<that scope>` of the **same owner**.
  - It clears owner-level unknown-reset evidence whose recorded `modelScope` equals the success scope, or is null.
  - A turn whose scope set holds several families clears only those families' `weekly_model:*` windows, plus the shared unscoped `five_hour` and `weekly`.
  - It never clears `overage` or `monthly`, other scopes, another owner, or anything with a known reset (that expires at its reset).
  - A fallback success arrives under the fallback provider's owner key, so it cannot touch the original owner.
- **Eviction (Revision 2, finding 9)**:
  - Entries are removed only once they have expired: past their known reset, past the provider's longest window when the reset is unknown, or superseded.
  - Active exhaustion, active owner evidence, active cooldowns and persisted known-reset entries are **never** evicted before their contractual expiry.
  - Owners with no remaining entries are dropped. There is no fixed owner cap.
- **Persistence**: only known-reset exhaustion and owner evidence with a known reset are persisted (P6). They are stored under `IStateStorage` key `ptah.planLimits.exhaustion.v1` and pruned on load once past their reset. There is no count cap: their number is bounded by owners × windows, since each allowance keeps one current entry.
- **Longest window per provider**: `anthropic` 7 d, `openai-codex` the largest `windowDurationMins` read (else 7 d), `ollama-cloud` 7 d, `antigravity` 7 d, `opencode` 30 d (Assumption A7).

### Decision 5: one failure-kind union (Req 3.3, user constraint 4)

- **Chosen**: `export type AgentFailureKind = 'quota'` in `agent-process.types.ts`, plus `AgentProcessInfo.failureKind?: AgentFailureKind`.
  - `status` stays `failed`, so existing `AgentStatus` consumers are untouched.
  - The doc comment makes this the only failure/stop-kind union. 597's planned budget, repeat and blocked-model stops must join it as new members, not a parallel `stopReason`.
  - `'quota'` maps one-to-one to TASK_2026_535 `failure_kind: quota`.
- **Distinct from `SkillLaneFailureKind`**: `libs/backend/skill-synthesis/src/lib/lanes/lane.types.ts:116-145` (`'quota-exhausted'`) belongs to internal skill lanes and is not changed.
- **Rejected**:
  - A new `AgentStatus` member `'quota'`: it would touch every status switch in both apps for no requirement gain.
  - Pre-declaring 597 members: no requirement or implementation here (simplicity rule).

### Decision 6: Codex lane stream evidence and the single rollout module (Req 2.4, user constraint 2)

- **Chosen**: 596 builds no lane rollout capture and no second rollout reader.
  - The only rollout reader is `scripts/agent-usage/codex-rollout.reader.ts` (597 Batch 10, merged).
  - Codex lane windows come from the account reader for the same `CODEX_HOME` owner, which the research recommends: "best read from the account-level source of that lane's vendor".
  - Codex lane `turn.completed` token telemetry (`codex-cli.adapter.ts:1151-1172`) is never turned into a window.
- **Evidence**:
  - The Req 2.4 gate ("when the fixture verifies…") is unmet: the fixture has 0 `rate_limits` keys and live reads are not authorized.
  - Codex SDK events carry no rate-limit fields (research row 28; adapter `:126-141`).
- **597 seam**: when a verified fixture exists, see the 597 seam section below.

### Decision 7: transport to the webview (Req 7.3, 8.3)

- **Chosen**: the RPC `provider:getPlanLimits` for pull and refresh, plus a push `MESSAGE_TYPES.PLAN_LIMITS_CHANGED = 'planLimits:changed'` carrying the full `PlanLimitsSnapshot`. The snapshot is small: one entry per owner, a handful of owners.
  - The push is debounced to at most one per 500 ms.
  - Like `SESSION_MCP_STATUS`, this is not turn state, so the ordering constraint documented at `message-constants.ts:144-154` does not apply.
- **Rejected**: an id-only push followed by a re-read. That adds an RPC round trip per evidence event, and the payload is already bounded.

### Decision 8: lane tokens, cost and model (Req 8, D1, user constraint 2)

- **Data path**: lane tiles derive from `AgentMonitorStore`.
- **One usage fold**: `addCliUsage(total, usage)`, moved into `libs/shared/src/lib/utils/cli-usage.utils.ts`.
  - `extractCliAgentStats` (`stats-bar.utils.ts:38-62`) delegates to it, with behaviour preserved.
  - `AgentMonitorStore` folds each incoming usage segment into `MonitoredAgent.usageTotals` before `capSegments` runs. Without this, long lanes would silently undercount.
- **Values**:
  - Cost uses only an adapter-reported `costUsd`. Nothing is priced locally.
  - An absent value renders "unknown". Tokens never show 0 when no usage segment arrived.
- **ptah-cli lanes**: `PtahCliStreamLoop` additionally emits a structured usage segment on a successful `result`: `{type:'info', content: <existing line>, usage:{model, inputTokens, outputTokens, costUsd}}`. This is the existing `info` line with `usage` attached, so the agent card shows the same text.
- **Restored runs (Req 8.4)**: tokens and cost are "unknown", as in design storyboard step 4. No field is added to `CliSessionReference`.
- **Rejected**:
  - Pricing Codex locally: 597 Batch 13 redefines `inputTokens` as non-cached, so a price computed now would be wrong after that lands.
  - Persisting usage on `CliSessionReference`: not identity (Req 8.4).

### Decision 9: Codex protocol re-pin (Req 2.3, 2.10)

- **Chosen**: regenerate the selected shapes in `codex-account.generated.ts` from the installed CLI.
  - Command: `node node_modules/@openai/codex/bin/codex.js app-server generate-ts`. This is local and makes no account call.
  - Bump `CODEX_ACCOUNT_PROTOCOL_VERSION` to the installed version only when the selected types are unchanged or additive.
  - If a selected shape changed incompatibly, the executor stops and reports. The schemas are not adjusted by guesswork.
- **Evidence**: the pin (`codex-account.schemas.ts:8`) and the installed `0.155.1`.
- **Rejected**: relaxing the version check to a range. The pin exists so the schemas match the binary.

### Decision 10: owner lifecycle, account change and per-run owner retention (A1, Req 4.3, 8.4) — Revision 3

- **Session owner invalidation**: the current owner can change from A to B. Each route
  invalidates as follows:
  - **Claude (native)**:
    - The probe caches `accountInfo()` per session **and per `Query` instance**.
    - The cache is dropped when:
      - `SessionRegistry.setSessionQuery` replaces the query (`session-registry.service.ts:395`, on resume or restart);
      - `SdkAdapterEvents` emits `authFileChanged` or `configChanged` (`sdk-adapter-events.service.ts:95-105`; the probe only subscribes, the file is not edited);
      - an assistant `error` of `authentication_failed`, `oauth_org_not_allowed` or `account_on_hold` arrives (`sdk.d.ts:3484`).
    - The next `ownerForSession` call re-reads it, and the ledger's `setSessionOwner` moves the session to B.
  - **Codex**: `currentOwnerKey()` becomes `null` on `authFileChanged` (`codex-account-usage.service.ts:89-91`). The next read sets B.
  - **Credential routes**: the resolver reads the stored secret at call time, so a changed key yields a new owner on the next call. No fingerprint is cached across calls.
- **Per-run owner retention**:
  - `AgentProcessInfo.quotaOwnerKey` is set at spawn, or when it first becomes known. It may only be upgraded from an `unknown` kind to a known one. It is **never overwritten** by a later owner.
  - It is persisted as a new optional field `CliSessionReference.quotaOwnerKey?: string`, written by `persistCliSessionReference` (`agent-events.ts:398-413`).
  - Justification under `task-description.md:480-488`: this is the minimal retained identity that A1 needs ("earlier runs keep the owner identity recorded at their run"). It is opaque and holds no secret.
- **No substitution**:
  - A restored run without a recorded key (written before this change, or never resolved) reads `unknown`, rendered as "Limit unknown · owner not recorded".
  - The current owner is never substituted for a historical one.
- **Old-owner evidence**: there is no `forgetOwner`. On account change:
  - The old owner's **reader cache** is dropped, so nothing stale is served for it or for the new owner (the cache is keyed by owner key).
  - Its **ledger evidence** is retained until its contractual expiry (Decision 4).
  - The old owner is shown only where something references it: a run that recorded it, or an RPC `ownerKeys` request from the view. In those places it is rendered from ledger evidence only, with "no current read for this account".
  - It is never shown as the new owner, and never reused by `ownerRelation` as `same`.

## Component specifications

### 1. Plan-limit contract (shared types, RPC, message, lane fields)

- **Purpose**: the one data shape every layer reads.
- **Responsibilities**:
  - Declare:
    - `PlanLimitSource` (5 values).
    - `PlanWindowKind`: `five_hour`, `weekly`, `weekly_model`, `monthly`, `overage`, `other`.
    - `PlanLimitUsed`: `{kind:'percent', percent}` or `{kind:'amount', amount, limit, unit}`.
    - `PlanLimitWindow`, with these fields:
      - `key` (stable: `five_hour`, `weekly`, `weekly_model:<scope>`, `monthly`, `overage`, `other:<label>`), `kind`, `label`, `modelScope?`, `durationMins?`;
      - `used?`, `usedSource?`, `usedObservedAt?`;
      - `resetsAt?`, `resetSource?`, `lastResetAt?`;
      - `exhaustion? {observedAt, source, resetsAt?, resetSource?}`;
      - `observedAt`.
    - `QuotaOwnerRef {key, providerId, identityKind, label}`.
    - `OwnerLimitEvidence {observedAt, source, resetsAt?, resetSource?}`.
    - `PlanLimitCooldown {until, observedAt, rawUntil?}`.
    - `PlanLimitOwnerSnapshot`:
      - `owner`, `status`, `fetchedAt?`, `staleSince?`;
      - `windowSetEstablished`, `windows[]`, `ownerEvidence[]`, `cooldown?`;
      - `account?`, `activity?`, `unavailableReason?`.
    - `PlanLimitsSnapshot {generatedAt, owners[], sessionOwners: Record<sessionId, {ownerKey: string|null, modelScope: string|null}>}`.
  - Add `'no-usage-source'` to `ProviderAccountUsageStatus`.
  - Add optional `owner`, `windows`, `ownerEvidence`, `cooldown` and `windowSetEstablished` to `ProviderGetAccountUsageResult`.
  - Declare `ProviderGetPlanLimitsParams {providerId?: string; sessionIds?: string[]; refresh?: boolean}` and `ProviderGetPlanLimitsResult = PlanLimitsSnapshot`.
    - `providerId` is the dashboard's selected provider.
    - No credential and no credential reference is ever a parameter or a result field.
  - Add `AgentFailureKind`, plus `AgentProcessInfo.failureKind?` and `AgentProcessInfo.quotaOwnerKey?`.
  - Add `CliSessionReference.quotaOwnerKey?: string` (Decision 10) at `agent-process.types.ts:378-402`.
  - `ProviderGetPlanLimitsParams` also takes `ownerKeys?: string[]`: opaque keys of runs shown in the view, for owners that discovery no longer lists.
  - Add `MESSAGE_TYPES.PLAN_LIMITS_CHANGED` and its payload-map entry.
- **Verified contracts and entry points**:
  - `rpc-providers.types.ts:154-194`;
  - `rpc.types.ts:742, 1131-1134, 3695, 3797`;
  - `agent-process.types.ts:107-149`;
  - `message-constants.ts:132-155`;
  - `libs/shared/src/lib/types/messages/payload-map.ts:286`;
  - barrel `libs/shared/src/index.ts`, 90 lines, under the 150-line limit.
- **Dependencies**: none. This is L0 and stays zod-free (barrel comment, `libs/shared/src/index.ts:30-34`).
- **Integration points**: every other component.
- **Failure behaviour**: not applicable (types only).
- **Quality requirements**:
  - The compatibility NFR: every existing field of `ProviderGetAccountUsageResult` is kept with its meaning. `quota.primary` and `quota.secondary` stay populated for Codex.
- **Verification seam**:
  - Three-app typecheck: `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli`.
  - `npx nx test shared`.
  - `rpc-allowlist.spec.ts` stays green.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\plan-limit.types.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\rpc\rpc-providers.types.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\rpc.types.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\agent-process.types.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\messages\message-constants.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\messages\payload-map.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\index.ts`

### 2. Plan-limit engine (shared pure rules and time formatting)

- **Purpose**: implement Req 1.3, 1.5-1.7, 3.4, 3.6, 4.4 and 5, and design §2 and §0.4, once.
- **Responsibilities**:
  - **`instants.ts`**:
    - `normaliseInstant(value)`: seconds (`< 1e11`), milliseconds, or ISO-8601 → epoch ms UTC, or `undefined`.
    - `parseRetryAfterDeadline(header, now)`: delta-seconds or HTTP-date, **unclamped**; `undefined` on absent or invalid input.
    - `resolveClockTimeReset(text, observedAt, tz)`: the next occurrence after the observation, local zone.
    - `resolveRelativeReset("144h24m50s", observedAt)`.
    - `windowKindFromDuration(mins)`: 300 → `five_hour`, 10080 → `weekly`, 43200 or 44640 → `monthly`, otherwise `other`, labelled by position.
  - **`evidence-precedence.ts`**: `supersedes(next, prev, lastResetAt)`.
  - **`window-state.ts`** and **`lane-state.ts`**: Decision 1, `ownerRelation` (Decision 3), and `applicableWindows(owner, modelScope)`. A `weekly_model:<scope>` window applies only to the same scope (Req 4.5).
  - **`plan-limit-format.ts`**:
    - Local absolute times: "today 15:10 CEST" or "Thu 8 Oct 09:00 CEST", using `Intl.DateTimeFormat` with `timeZoneName:'short'` (T1).
    - Relative times: "in 3h 10m" / "22m ago".
    - Tool UTC: `YYYY-MM-DD HH:MM UTC (in 3h 10m)`.
    - Short source labels (design §1) and the tool source text `[used+reset provider-api; limit error-derived]`.
  - **Constants**: `NEAR_LIMIT_PERCENT = 90`, `FRESHNESS_MS = 900_000`, `LIMIT_LOOKUP_DEADLINE_MS = 3_000`.
- **Verified contracts**:
  - Clamping in the existing store (`provider-quota.store.ts:62, 89-91`) is the reason for the separate unclamped parser. The store itself is unchanged.
  - Precedent for pure shared utils: `libs/shared/src/lib/utils/pricing.utils.ts`.
- **Dependencies**: shared only.
- **Failure behaviour**: never throws. Unparseable input returns `undefined`, which renders "unknown".
- **Quality requirements**:
  - Deterministic: every function takes `now` (and a time zone for formatting) as a parameter.
  - No `Date.now()` inside the engine.
- **Verification seam**: unit specs with an injected clock. They are the fixture list under "Test fixtures": F1-F12, F17-F22 and F25.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\instants.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\evidence-precedence.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\window-state.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\lane-state.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\plan-limit-format.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\index.ts`
  - Each file gets a `.spec.ts` beside it.
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\index.ts`

### 3. CLI usage fold (shared seam)

- **Purpose**: one definition of "sum lane usage". It serves the agent card, the lane tiles and the 597 Batch 22.1 change.
- **Responsibilities**:
  - `addCliUsage(total: CliUsageTotals | null, usage: CliOutputSegment['usage']) → CliUsageTotals | null`.
  - The semantics are identical to today's `extractCliAgentStats`: tokens summed, and the latest model, cost and duration kept. The existing spec is the oracle.
  - Return `null` while no usage has been seen.
- **Verified contracts**:
  - `stats-bar.utils.ts:38-62`.
  - `CliOutputSegment.usage {model?, inputTokens?, outputTokens?, totalTokens?, costUsd?, durationMs?}` at `agent-process.types.ts:341-348`.
- **Dependencies**: shared only.
- **Integration points**: Component 14 (`AgentMonitorStore`) and `stats-bar.utils.ts`.
- **Failure behaviour**: pure; no failure path.
- **Verification seam**:
  - The existing `stats-bar.utils` spec stays green unchanged.
  - A new spec covers the fold-before-cap equivalence.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\cli-usage.utils.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts`

### 4. Claude signal capture and session quota probe (agent-sdk)

- **Purpose**: turn Claude SDK signals into evidence and give the readers access to the open Query.
- **Responsibilities**:
  - **`claude-rate-limit.mapper.ts`** (pure). It maps:
    - `SDKRateLimitInfo` → `{windowKey, modelScope?, status, resetsAt (normalised), source:'stream-event'}`. `utilization` is **never ingested** (Req 2.1 amendment, pending Gate 2). `isUsingOverage` and `overageInUse` are kept per stream so that success billing can be decided (Decision 4, S1).
    - `rateLimitType`: `seven_day_opus` → `weekly_model:opus`, `seven_day_sonnet` → `weekly_model:sonnet`, `seven_day_overage_included` and `overage` → `overage`.
    - `status==='rejected'` → exhaustion.
    - `assistant.error==='rate_limit'`, and a `system/api_retry` with `error==='rate_limit'` or `error_status===429`, → owner-level evidence with an unknown window and reset. `retry_delay_ms` becomes cooldown evidence, never a reset.
  - **`SessionPlanLimitCallbackRegistry`**: extends `CallbackRegistryBase<SessionPlanLimitSignal>`. The payload is `{sessionId, signal}`.
  - **`StreamTransformer`**: in the existing `for await` loop (`stream-transformer.ts:412`) it gains one early branch for `rate_limit_event`, `api_retry` and an assistant with `error==='rate_limit'`. That branch calls the mapper and `notifyAll`. The existing success-`result` handling also emits the S1 success signal (Decision 4). All other forwarding is unchanged.
  - **`SessionQuotaProbeService`**:
    - `readAccount(sessionId)` calls `query.accountInfo()`. The result is cached per session and per `Query` instance, and invalidated as in Decision 10.
      - It returns `AccountInfo` in process only, to `ProviderOwnerResolver.ownerForClaudeAccount`, which hashes it.
      - It is never logged or serialized.
    - `readPlanUsage(sessionId?)` calls `usage_EXPERIMENTAL_…({skipBehaviors:true})` on the given session's query or, if none is given, on any live native session.
    - `sessionRoute(sessionId)` returns `{providerId, routeKind: 'native' | 'proxy' | 'direct-key' | 'unknown'}` from `capacityRoute`. **No credential and no fingerprint**: owner keys for credential routes are built by the resolver from the stored key (Decision 3).
    - `{kind:'session'}` in a plan target is a **handle for this probe**: it selects which session's query to call. It is never a secret lookup.
    - The query lookup uses `SessionRegistry.find`, mirroring `session-control.service.ts:422`.
    - Every call has a 3 s timeout and returns `null` on timeout, rejection or a missing query.
  - **Per-turn S1 state** inside each `StreamTransformer` iteration:
    - `turnScopes`: a set of Claude families from main-loop `message_start` models.
    - `turnOverage`: `unseen`, `plan` or `overage`.
    - Both reset at the turn boundary (Decision 4).
- **Verified contracts**:
  - `sdk.d.ts:2872, 2928, 3384-3391, 3484, 5320-5354`;
  - `stream-transformer.ts:316, 345, 412, 503, 799-812`;
  - `callback-registry.base.ts:22, 51`;
  - `session-registry.service.ts:62, 395`;
  - `session-query-executor.service.ts:83-130, 228`;
  - `claude-sdk.types.ts:400`.
- **Dependencies**: agent-sdk internals and shared. Agent-sdk does not import auth-providers. All hashing lives in the auth-providers resolver.
- **Integration points**:
  - The ledger (Component 5) registers on the registry.
  - The Claude reader (Component 6) calls the probe.
  - `PtahCliStreamLoop` (Component 10) reuses the mapper.
- **Failure behaviour**:
  - Mapper exceptions are caught in the branch and logged at debug with no payload. The stream continues.
  - Probe failures return `null`, and the caller falls back to Req 2.1 data (Req 2.2).
- **Quality requirements**:
  - At most one `accountInfo()` per session (cached).
  - `usage_EXPERIMENTAL` runs only on demand (RPC refresh, dashboard open, or tool lookup), never per turn.
  - Nothing is logged from `accountInfo` except presence flags.
- **Verification seam**:
  - Mapper unit specs (F13-F16, F13a).
  - The S1 success-signal specs:
    - F62.
    - F75: Opus-then-Sonnet across two turns.
    - F76: overage state reset per turn.
  - Probe cache invalidation on query replacement and `authFileChanged` (F77).
  - A `StreamTransformer` spec: a `rate_limit_event` in the iterable produces one registry notification and no forwarded flat event.
  - A probe spec with a fake registry covering null query, timeout and API-key (`rate_limits_available=false`).
  - Scoped command: `npx nx run-many -t test,lint,typecheck -p agent-sdk`.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\claude-rate-limit.mapper.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-plan-limit-callback-registry.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.ts`
  - Each file gets a spec. Revision 3 removes `quota-owner-fingerprint.ts` from agent-sdk; hashing lives only in `provider-owner.resolver.ts`.
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\di\tokens.ts`: adds `SDK_SESSION_PLAN_LIMIT_REGISTRY: Symbol.for('SdkSessionPlanLimitRegistry')` and `SDK_SESSION_QUOTA_PROBE: Symbol.for('SdkSessionQuotaProbe')`.
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\di\register.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\index.ts`

### 5. Plan-limit ledger (auth-providers)

- **Purpose**: hold all limit evidence per quota owner and apply ownership, precedence and lifetime rules.
- **Responsibilities**:
  - **Writes**:
    - `recordWindowEvidence(ownerRef, windowEvidence)`;
    - `recordOwnerEvidence(ownerRef, evidence)`;
    - `recordCooldown(ownerRef, {until, rawUntil, observedAt})`;
    - `recordSuccess({ownerKey, modelScope, billing, observedAt})`, with the rules in Decision 4;
    - `setSessionOwner(sessionId, ownerRef | null, modelScope | null)`;
    - There is no `forgetOwner`. Account change follows Decision 10: the reader cache is dropped and the evidence is retained until expiry.
  - **Reads**:
    - `snapshotFor(ownerKey)`;
    - `knownOwners()`, which Component 10b uses for owner discovery;
    - `onChange(listener) → unsubscribe`.
  - **Subscriptions**:
    - **`SessionPlanLimitCallbackRegistry`**: it resolves the session owner with `ProviderOwnerResolver.ownerFor(route.providerId, {sessionId, credential fingerprint from the probe})`, then records evidence (S1 success included).
    - **`providerQuotaStore.onRateLimit`**: the event carries the **owner key captured at the proxy response boundary** (Component 9).
      - It records a cooldown on exactly that owner, with `rawUntil` from `parseRetryAfterDeadline`, which keeps a seven-day value as seven days (Req 3.6).
      - When the event carries no owner key (the identity was unavailable at the boundary), it records under `"<providerId>#unknown:<fp(proxy instance id)>"`. That key never relates as `same` to any lane, and it is only shown for a session whose own route resolved to it. Nothing is borrowed.
    - **`providerQuotaStore.onSuccess`**: S4 success, on the carried owner key only.
  - **Persistence**: Decision 4.
  - **`dispose()`**: sync and idempotent. It removes all three subscriptions.
- **Verified contracts**:
  - `provider-quota.store.ts:108-120` (writer timing);
  - `IStateStorage` (`state-storage.interface.ts`), token `PLATFORM_TOKENS.STATE_STORAGE` (`platform-core/src/di/tokens.ts:16`);
  - the precedent subscription in `codex-account-usage.service.ts:89`.
- **Dependencies**:
  - auth-providers → agent-sdk (registry, probe, fingerprint), platform-core (storage) and shared (engine).
  - Direction verified from the import graph.
- **Integration points**:
  - Component 6 merges ledger evidence into snapshots.
  - Component 10 writes lane evidence.
  - Component 12 subscribes to `onChange`.
- **Failure behaviour**:
  - A storage read that fails or returns a corrupt entry is dropped with a sanitized warning. The ledger starts empty.
  - A failed storage write is logged; memory remains authoritative.
  - A listener exception is isolated, following the `safeEmit` style.
- **Quality requirements**:
  - Memory: at most one current entry per allowance, and the last 3 owner-evidence entries per owner.
  - Expired or superseded entries are removed on access.
  - Active or persisted entries are never removed before expiry (Decision 4, eviction).
  - No timers.
- **Verification seam**: an injected-clock spec with fake storage and a fake registry. It covers:
  - F17-F24.
  - P6: a restart with a known reset keeps the exhaustion; with an unknown reset it drops it.
  - The success matrix F62-F66 and F75-F76.
  - F74: 100 owners with active known-reset exhaustion all survive. Nothing active is evicted.
  - F79: on account change A→B, A's evidence is retained, its reader cache is dropped, and nothing of A is attributed to B.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.service.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts` (+ spec). This is Decision 3's resolver and the **single** owner of hashing and credential canonicalisation:
    - Codex uses `CodexAccountUsageService.currentOwnerKey()` (Component 7).
    - Credential providers use `credentialOwnerKey`.
    - Claude uses `ownerForClaudeAccount(probe.readAccount(...))`.
    - The spec covers F67b (canonical equality) and F78 (header-parsing cases).
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers-tokens\src\lib\tokens.ts`: adds `PLAN_LIMIT_LEDGER: Symbol.for('PlanLimitLedger')` and `PLAN_USAGE_SERVICE: Symbol.for('PlanUsageService')`.
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\di\register.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\index.ts`

### 6. Plan usage service and core readers: Claude, Codex, OpenCode (auth-providers)

- **Purpose**: produce one `PlanLimitOwnerSnapshot` per owner from the best source, merged with ledger evidence.
- **Responsibilities**:
  - `PlanUsageService.getOwnerSnapshot(target: PlanOwnerTarget, {refresh?, signal?})`.
    - `PlanOwnerTarget = {providerId, ownerRef, credentialRef?: PlanCredentialRef, sessionId?}`.
    - Targets come from the discovery service (Component 10b) or from `ProviderOwnerResolver`. There is no free-form provider list.
  - **Credential boundary (Revision 2, finding 4)**:
    - `PlanCredentialRef` is a backend-only value: `{kind:'provider-key', providerId}` or `{kind:'ptah-cli-key', ptahCliId}`.
      - Targets that need no secret carry **no** credential reference: Claude subscription, Codex account home, and local CLI stores.
      - `{kind:'session', sessionId}` is a **separate field**, `PlanOwnerTarget.sessionHandle`: a probe/query handle (Component 4), never a credential.
    - `PlanCredentialSource.resolve(ref)` reads the secret at read time, through `IAuthSecretsService.getProviderKey(providerId)` (`provider-auth-resolver.ts:251`) or `getProviderKey('ptahCli.<id>')` (`ptah-cli-registry.ts:210-225`). Nothing else.
    - The secret is passed in memory to a single reader call and never stored, cached, logged or returned.
    - A missing credential maps to `unsupported-config` (Ollama with no key); a placeholder key maps to `unsupported-auth`.
    - A changed secret changes the owner key, so the old owner's cache is never served (Req 4.3). The cache is keyed by owner key.
  - Dispatch to an internal `PlanUsageReader` record keyed by provider id. This is a plain map of functions, not a plugin registry. The keys are:
    - `anthropic` (Claude);
    - `openai-codex`;
    - `ollama-cloud` and `antigravity` (Component 8);
    - `opencode-go` / `opencode-zen`, which return `no-usage-source`;
    - everything else returns `provider-unsupported`.
  - **Claude reader**:
    - It calls `probe.readPlanUsage()` and maps `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps` (`other`), `model_scoped[]` (`weekly_model:<display_name lowercased>`) and `extra_usage` (`overage`, amount `used_credits` of `monthly_limit` in `currency`).
    - The source is `provider-api`, and `windowSetEstablished=true`.
    - When `rate_limits_available===false`, the status is `unsupported-auth`.
    - When the probe returns `null`: `status:'service-unavailable'`, `unavailableReason:'no-open-session'`, with ledger evidence still attached.
  - **Codex reader**: it adapts `ICodexAccountUsageService`.
    - Windows come from `primary`/`secondary` with the kind taken from `windowDurationMins` (Req 2.3); unknown durations are labelled "Window 1" / "Window 2".
    - `resetsAt` goes through `normaliseInstant`.
    - `planType` and `activity` are passed through (Req 2.10).
  - **Stale rule (Req 2.9)**: a cached snapshot is returned as `stale` only on a transient failure for an unchanged owner. Eligibility and configuration statuses carry no windows. The owner key changes on account change.
  - **Diagnostics**: a parse failure logs `{providerId, fieldPath, reason}` only (Req 2.7).
  - **Merge**: `windows = merge(readWindows, ledger.allowances(owner))` via `supersedes`. `ownerEvidence` and `cooldown` come from the ledger.
- **Verified contracts**:
  - `ICodexAccountUsageService.getAccountUsage({refresh, signal})` (`codex-provider.types.ts:108-112`);
  - `CodexAccountUsageResult` (`:92-106`);
  - `sdk.d.ts:4012-4104`.
- **Dependencies**: auth-providers internals, agent-sdk probe and shared engine.
- **Integration points**: Component 12 RPC; Component 10 lookup.
- **Failure behaviour**:
  - Every reader call is wrapped. A thrown error maps to `service-unavailable` (or `stale` under the rule above).
  - One provider's failure never affects another's snapshot (Req 2.7).
- **Quality requirements**:
  - A 30 s per-owner cache, reusing Codex's cache.
  - Single-flight per owner, following the existing Codex pattern (`codex-account-usage.service.ts:106-111`).
  - The caller's `AbortSignal` is honoured.
- **Verification seam**: specs with fake readers and probe covering F26-F33 (Req 2.2, 2.3, 2.8, 2.9 matrix).
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-usage.service.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\claude-plan-usage.reader.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\codex-plan-usage.reader.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\plan-usage-reader.types.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-credential.source.ts` (+ spec, F71)

### 7. Codex account reader hardening and protocol re-pin (auth-providers/codex)

- **Purpose**: make the existing Codex source usable on this branch and give it an owner identity.
- **Responsibilities**:
  - Decision 9 re-pin.
  - Expose an owner key for the last successful read: `accountOwnerKey('openai-codex', codexHome.path + "\0" + email)` from `provider-owner.resolver.ts`, with `email` from `account/read` (`codex-account-usage.service.ts:148-156`). It goes on an internal, non-RPC field `ownerKey` of `CodexAccountUsageResult`. It is also exposed as a synchronous `currentOwnerKey(): string | null`, which returns null before the first read and after `clearCache`. `ProviderOwnerResolver` and the Codex proxy boundary use it (Component 9).
  - Pass `rateLimitReachedType` through when present, as window evidence (`codex-account.generated.ts:37`).
  - The stale fallback (`:132`) is kept. It applies only while `authFileChanged` has not fired since the cache was written. That is already true via `clearCache` at `:89-91`; it is pinned with the A→B and sign-out tests.
- **Verified contracts**: `codex-account-usage.service.ts:96-203`; `codex-account.schemas.ts:8, 55-64`.
- **Dependencies**: unchanged.
- **Failure behaviour**: unchanged status mapping (`:124-134`).
- **Verification seam**:
  - The existing `codex-account-usage.service.spec.ts`, with its version mock updated from `'0.147.0'` at spec `:67`.
  - New cases: account A cached, then account B; sign-out; same-account transient failure gives stale.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-provider.types.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account.schemas.ts`
  - REWRITE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\protocol\codex-account.generated.ts` (regenerated)

### 8. Unofficial readers: Ollama Cloud and Antigravity (auth-providers, provider-unofficial)

- **Purpose**: read the two undocumented sources conservatively (Req 2.5, P1).
- **Responsibilities**:
  - **Ollama Cloud reader**:
    - One GET to `https://ollama.com/api/usage` with `Authorization: Bearer <key>`, a 5 s `AbortSignal.timeout`, and no retry.
    - The response is validated with a zod schema of the **provisional** shape: session and weekly percentages, and optional `resets_at`.
    - Values carry source `provider-unofficial`.
    - When the payload has no reset, the reset is unknown. Reset estimation from bucket boundaries is **not** implemented: no requirement asks for it, and Req 2.5 only says it must be labelled if done.
    - A mismatch returns `service-unavailable` with a sanitized `{fieldPath, reason}` log.
    - The key arrives in memory from `PlanCredentialSource` (Component 6) for the target's `credentialRef`: a provider key, a ptah-cli key or a session credential. The reader never looks secrets up itself. The owner is `credential`.
    - No key gives `unsupported-config`. A placeholder key (`OLLAMA_AUTH_TOKEN_PLACEHOLDER`) gives `unsupported-auth`. Neither makes a network call.
  - **Antigravity reader**:
    - **Discovery**: an injected `ProbeCommandRunner`, following `process-start-time.probe.ts:75-80`. It runs a constant argument array (`ps -ax -o pid=,args=`, or PowerShell `Get-CimInstance Win32_Process`) and finds the language-server process plus its `--csrf_token` and port arguments.
    - **Request**: a POST to `https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus` with `rejectUnauthorized:false` scoped to that loopback request only, and a 3 s timeout.
    - **Validation**: zod, using the provisional per-model `remainingFraction`/`resetTime` shape. Used = `(1 - remainingFraction) * 100`, source `provider-unofficial`.
    - **Failure**: no process, no token, or a mismatch returns `service-unavailable`.
    - **Constants**: every provisional name (process pattern, argument names, header name, field paths) lives in one `antigravity-ls.provisional.ts` constants file with a "provisional, unverified" header.
  - The CSRF token, API key and response bodies are never logged or returned.
- **Verified contracts**:
  - `ollama-cloud-metadata.service.ts:61-65` (timeout and base-URL precedent);
  - `process-start-time.probe.ts:75-80` (runner seam);
  - `ptah-cli-registry.ts:210-225` (lane key source);
  - `local-provider-entry.ts:17, 114-138` (ollama-cloud entry).
- **Dependencies**: auth-providers internals, plus `zod` (already used, `codex-account.schemas.ts`).
- **Integration points**: registered in Component 6's reader map.
- **Failure behaviour**:
  - Any failure returns `service-unavailable`, or `stale` under the Component 6 rule.
  - Never throws past the reader.
- **Quality requirements**:
  - Security NFR: no credentials in logs or results.
  - The loopback-only TLS bypass is restricted to host `127.0.0.1`.
- **Verification seam**:
  - Specs with the provisional example payloads **labelled as provisional** (Req 2.5): valid, missing reset, shape mismatch, timeout, no process.
  - No live call. No forced 429.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-plan-usage.reader.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-ls.provisional.ts`

### 9. Proxy owner key at the response boundary and store observers (auth-providers) — rewritten in Revision 2

- **Purpose**: attribute upstream 429s and successes from translation proxies to the **exact quota
  owner** whose credential served the request (Req 3.2, 3.6, 3.8, A1). The cooldown gate itself is
  unchanged.
- **Responsibilities**:
  - **`translation-proxy-base.ts`** (minimal edit, allowed by the orchestrator in Revision 2):
    - A new protected hook `resolveQuotaOwnerKey(headers): Promise<string | null>`.
    - **Default behaviour (Revision 3, canonical)**: take the headers that `getHeaders()` returned
      for this request (`:979`) and return
      `credentialOwnerKey(getProviderId(), credentialFromHeaders(headers))`, both from
      `provider-owner.resolver.ts` (Decision 3). It returns `null` when `credentialFromHeaders`
      returns `null`.
      - `Authorization: Bearer K` and a stored raw `K` therefore give the same key.
      - The proxy never hashes or parses on its own.
    - **Timing**: it is called once per request, right after `getHeaders()` succeeds, inside the
      same try/catch. A throw or rejection becomes `null`. The resulting key is held in a request
      local.
    - **Plumbing**: `noteUpstreamQuota(rateLimited, retryAfter?, ctx?: {ownerKey: string | null; model?: string; statusCode: number})`
      passes `ctx` to `providerQuotaStore.recordRateLimit` and `recordSuccess`. Both call sites
      (`:1124`, `:1179`) pass the request local, the request's model id and the upstream
      `statusCode`.
    - **Success boundary**: the existing call at `:1179` runs for every status below 400,
      including 3xx (`:1140, 1175-1179`). The gate-clearing behaviour stays exactly as it is. The
      store emits the ledger `onSuccess` signal **only when `200 <= statusCode < 300`**. A 3xx
      clears the gate as today but emits no ledger success.
    - The response path, status codes, headers and timing records are otherwise unchanged.
  - **`CodexTranslationProxy`**:
    - Overrides the hook to return `CodexAccountUsageService.currentOwnerKey()` (Component 7):
      the account of the shared `CODEX_HOME`.
    - The OAuth bearer rotates on refresh, so it is not an identity.
    - When `currentOwnerKey()` is null, the hook returns null (identity unavailable).
    - The service is injected as `@inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE)`. The
      proxy is container-built (`register-providers.ts:88-89`; `di/register.ts:151-152`), and the
      service depends only on Codex auth, so there is no cycle.
  - **`ProviderQuotaStore`**:
    - Adds `onRateLimit(listener)` and `onSuccess(listener)`, each returning an unsubscribe
      function.
    - `recordRateLimit(providerId, retryAfter?, now?, ctx?)` and `recordSuccess(providerId, ctx?)`
      notify listeners with `{providerId, ownerKey: ctx?.ownerKey ?? null, model, retryAfterRaw, observedAt, gateUntil}`
      after the map update.
    - Listener errors are caught.
    - The gate stays keyed by provider id. `cooldownFor`, the clamp and the
      `ProviderAuthResolver` behaviour are unchanged (out of scope).
- **When identity is unavailable** (`ownerKey === null`):
  - The ledger records the cooldown under `"<providerId>#unknown:<fp(proxy instance id)>"`
    (Component 5).
  - It is never applied to any lane or another session. A session shows it only when that
    session's own route resolved to the same unknown key.
  - An unattributed success clears nothing.
- **What an attributed 2xx success does**: it clears that owner's **ledger cooldown** only. Every in-scope proxy provider is `'unknown'` billing (Decision 4 table), so S4 is not a Req 3.8 exhaustion-clearing producer.
- **Verified contracts**:
  - `translation-proxy-base.ts:261, 271-290, 976-985, 1109-1139, 1179`;
  - `codex-translation-proxy.ts:27-49`;
  - `provider-quota.store.ts:93-164`.
- **Dependencies**: auth-providers internals only (`provider-owner.resolver.ts` pure functions).
- **Failure behaviour**:
  - A hook or listener failure never affects the proxied response or the gate. The evidence is
    then unattributed or dropped and logged at debug.
- **Verification seam**:
  - Store spec additions.
  - Proxy spec: a 429 and a 2xx carry the owner key computed from the request headers.
  - Two same-provider proxies with different keys produce two owner keys. A session bound to
    key A never shows key B's cooldown (F67).
  - F67b: a proxy 429 carrying `Authorization: Bearer K` has an owner key **equal to**
    `ProviderOwnerResolver.ownerForProviderKey(providerId)` when the stored key is `K`. The same
    holds for an `X-Api-Key: K` header (mixed-case name).
  - Codex proxy with `currentOwnerKey()` null produces an unattributed cooldown that no lane
    shows (F68).
  - F80, the S4 boundary:
    - A 2xx emits a ledger success and clears only the owner's cooldown.
    - A 3xx clears the gate but emits no ledger success.
    - A credit or fallback provider's 2xx (`openai-codex`, `opencode-go`) never clears exhaustion.
    - A 2xx with a null owner key clears nothing.
  - The existing proxy, store and resolver specs stay green.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\auth\provider-quota.store.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-translation-proxy.ts` (+ spec)

### 10. Lane limit classification, owner resolution and lookup (cli-agent-runtime)

- **Purpose**: lane-side evidence (Req 3.3-3.5, 3.9), lane owner identity (A1) and the lookup the tools use (Req 5.4).
- **Responsibilities**:
  - **`lane-limit-classifier.ts`** (pure): `classifyLaneLimit({cliOrProvider, texts, observedAt, tz}) → {failureKind:'quota', windowKey?, resetsAt?, resetSource:'error-derived'} | null`. One pattern per wording:
    - Claude "limit reached ∙ resets <clock>" (window from "5-hour" or "weekly" when named);
    - Codex "usage limit … try again at <clock>";
    - Antigravity "RESOURCE_EXHAUSTED … reset after <duration>";
    - OpenCode "Free usage exceeded";
    - Ollama "429".
  - `MODEL_CAPACITY_EXHAUSTED`, timeouts and auth errors return `null` (Req 3.9).
  - `USAGE_LIMIT_REGEX` and `RETRY_AT_REGEX` move here. `sdk-error-summary.ts` imports them, and its output is unchanged.
  - **`AgentProcessManager.handleExit`** (`:1654-1710`): when the status becomes `failed`, and **before** `outputBuffer.discard`:
    - It classifies the last 16 KB of `tracked.stdoutBuffer` plus `error` segments from `accumulatedSegments`.
    - On a match it sets `info.failureKind='quota'` and records ledger evidence for `info.quotaOwnerKey`: window evidence if the window is named, owner evidence otherwise.
    - Timeouts are not classified.
  - **S3 success producer (Decision 4)**: when `handleExit` sets `completed` for a non-ptah-cli lane, it calls `ledger.recordSuccess({ownerKey: info.quotaOwnerKey, modelScope: scopeOf(info.model), billing: S3 table})`.
    - It is skipped when `quotaOwnerKey` is absent or its kind is `unknown`.
  - **`lane-owner.resolver.ts`**: implements Decision 3 for lane rows and spawned runs. It delegates key construction to `ProviderOwnerResolver`:
    - codex: the `CodexAccountUsageService` owner key for the shared home, else `unknown`.
    - ptah-cli `claude-cli`: the key captured from the lane's own `accountInfo()`.
    - ptah-cli `ollama-cloud`: the fingerprint of the lane secret, or `unknown` for the placeholder.
    - opencode and antigravity: `cli-store` (antigravity upgrades to `account` when its reader returned one).
    - Sets `AgentProcessInfo.quotaOwnerKey` at spawn and may only upgrade it from `unknown` to known. It is never overwritten afterwards (Decision 10).
    - `persistCliSessionReference` (`agent-events.ts:398-413`) copies it into `CliSessionReference.quotaOwnerKey`.
  - **`PtahCliStreamLoop`**:
    - Adds a usage-bearing info segment on a success result (Decision 8).
    - Emits the S2 success signal on a success `result` through `onPlanLimitSignal`, with that lane stream's overage state.
    - Forwards `rate_limit_event`, `api_retry` and `assistant.error` rate-limit signals through the Component 4 mapper to a new optional config callback `onPlanLimitSignal`. The registry wires it to the ledger with the lane owner.
    - After `isSystemInit`, the registry calls `sdkQuery.accountInfo()` once (3 s timeout) and stores the lane owner.
  - **`LaneLimitLookupService.lookup(rows, {deadlineMs = 3000, signal})`**:
    - For each row: resolve the owner, call `PlanUsageService.getOwnerSnapshot`, then `classifyLaneState`.
    - Each lane has its own `settledWithin`-style race. A late lane becomes `{lookup:'timeout'}` (unknown, "limit lookup timed out"). A throw becomes `{lookup:'failed'}`.
    - Never rejects.
- **Verified contracts**:
  - `agent-process-manager.service.ts:1654-1710, 1045`;
  - `tracked-agent.ts:16, 42`;
  - `sdk-error-summary.ts:20-22, 80-90`;
  - `ptah-cli-stream-loop.service.ts:168-178, 212, 325, 473-497`;
  - `ptah-cli-registry.ts:875-896`;
  - `agent-namespace.builder.ts:355-411` (row shape `CliDetectionResult`, `agent-process.types.ts:285-316`).
- **Dependencies**: cli-agent-runtime → auth-providers (ledger, `PlanUsageService`, Codex usage, resolver) and agent-sdk (mapper). Both edges already exist.
- **Integration points**:
  - Component 11 consumes `LaneLimitLookupService` through `CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP`.
  - `failureKind` and `quotaOwnerKey` ride the existing `AGENT_MONITOR_SPAWNED`/`EXITED` payloads (`agent-events.ts:171-213`).
  - `CliSessionReference` gains only `quotaOwnerKey?` (Decision 10). There is still no usage or failure field.
- **Failure behaviour**:
  - A classifier miss leaves the run as `failed` (Req 3.9).
  - A ledger write failure is logged and never alters exit handling.
  - An `accountInfo` failure leaves the owner `unknown`.
- **Quality requirements**:
  - The classifier runs once per exit over at most 16 KB.
  - No new timers per lane beyond the existing ones.
- **Verification seam**:
  - Classifier specs (F34-F40).
  - A `handleExit` spec: a quota failure sets `failureKind` and calls the ledger; a timeout does not. An antigravity `completed` exit calls `recordSuccess` with `billing:'plan'`, while a codex one uses `'unknown'` (F65).
  - A stream-loop spec: a usage segment; a signal forwarded on `rate_limit_event`; an S2 success signal carrying the overage flag (F63).
  - A discovery spec (Component 10b): F69, F70, F72.
  - Lookup spec: a 3 s deadline with a fake slow reader (F41).
  - Scoped command: `npx nx run-many -t test,lint,typecheck -p cli-agent-runtime`.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-classifier.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-owner.resolver.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-lookup.service.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\sdk-error-summary.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-stream-loop.service.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\wiring\agent-events.ts` (+ spec): persist `quotaOwnerKey`.
  - MODIFY the cli-agent-runtime `di/tokens.ts`, `di/register.ts` and `src/index.ts`. Assumption A9 covers their exact paths.
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.ts` (+ spec). This is Component 10b.

### 10b. Plan-limit owner discovery (cli-agent-runtime) — new in Revision 2

- **Purpose**: define, in the backend, which quota owners the dashboard and a session view show
  (Req 6.6, 7, 8). It also builds their credential references without any secret crossing RPC.
- **Responsibilities**:
  - `discoverTargets({selectedProviderId?, sessionIds?, ownerKeys?}) → PlanOwnerTarget[]`,
    deduplicated by owner key, from these sources in this order:
    1. **The dashboard's selected provider, resolved through the effective route (Revision 3)**.
       - `selectedProviderId` is a UI provider id, not a credential discriminator. Discovery
         resolves it with the established route logic `resolveEffectiveAuthRoute`
         (`libs/backend/auth-providers/src/lib/auth/effective-route.ts:55-103`).
       - That logic maps `authMethod` `claudeCli` → driver `claude-cli`, `apiKey` → `anthropic`,
         and `thirdParty` → the selected provider.
       - It reads the current config through the existing `ActiveProviderResolver.resolveActiveAuth`
         (`active-provider-resolver.ts:25`) when the selection equals the active provider.
       - Targets are built per route:

| Route (driver provider / auth) | Target | Credential | Expected status |
| --- | --- | --- | --- |
| `claude-cli` (subscription, `authType:'none'`, `claude-cli-provider-entry.ts:23-33`) | provider `anthropic`, owner `ownerForClaudeAccount` | **none**. `sessionHandle` = any live native session (a probe handle) | `available` (full table), or `service-unavailable` with `unavailableReason:'no-open-session'` when no session is open |
| `anthropic` with `authMethod:'apiKey'` (direct API key) | provider `anthropic`, owner `ownerForProviderKey('anthropic')` | used only for the owner fingerprint, never sent to a reader | `unsupported-auth` (no plan windows, Req 2.2). No read |
| `openai-codex` | Codex account home, owner `ownerForCodexHome()` | **none** (the app-server uses `CODEX_HOME`) | from the Codex reader |
| `opencode-go` / `opencode-zen` | owner `ownerForProviderKey(id)` | `{kind:'provider-key'}`, used for the owner only | `no-usage-source` |
| `ollama-cloud` with a stored key | owner `ownerForProviderKey('ollama-cloud')` | `{kind:'provider-key'}` (A10) | from the Ollama reader; `unsupported-config` when there is no key |
| any other provider | — | — | a `provider-unsupported` card, as today |

    1b. **Local CLI stores**: installed `opencode` and `antigravity` lanes become targets with
        owner `ownerForCliStore(cli)` and **no** credential.
    1c. **`ownerKeys`** from the view (runs that recorded an owner, Decision 10): ledger-only
        snapshots for keys that are not otherwise listed.
    2. **The owners of the requested sessions**: `ledger.setSessionOwner` entries, plus the probe
       route.
    3. **In-scope lane owners from detection**:
       - `CliDetectionService.detectAll()` (`agent-namespace.builder.ts:356` uses the same call):
         installed `codex`, `antigravity` and `opencode`.
       - Enabled ptah-cli agents (registry `listAgents`, `agent-namespace.builder.ts:374-385`)
         whose `providerId` is `claude-cli` or `anthropic` (Claude owner via the lane account,
         when known) or `ollama-cloud` (`{kind:'ptah-cli-key', ptahCliId}`).
    4. **Owners with active evidence**: `ledger.knownOwners()`. They stay visible even when the
       CLI is no longer detected.
  - Providers outside scope are not listed.
  - A target whose credential is missing still appears and reads `unsupported-config`, so every
    in-scope card is reachable.
  - Account change follows Decision 10: owner keys come from `ProviderOwnerResolver` at call time,
    so a new account yields a new target. The old owner is listed only via `ownerKeys` or active
    evidence, labelled with its own owner caption and "no current read for this account".
- **Verified contracts**:
  - `agent-namespace.builder.ts:355-411` (detection and registry sources);
  - `ptah-cli-registry.ts:210-225` (key name);
  - `local-provider-entry.ts:114-138`.
- **Dependencies**:
  - cli-agent-runtime → auth-providers (`PlanUsageService`, ledger, resolver).
  - cli-agent-runtime → its own detection and registry.
  - rpc-handlers consumes it (existing edge, `provider-rpc.handlers.ts:62` already imports
    `@ptah-extension/cli-agent-runtime`).
- **Failure behaviour**:
  - A detection or registry throw drops that source only, logged at debug. The other sources still
    return.
- **Verification seam**:
  - F69: every in-scope provider is reachable with fake detection and registry: Claude, Codex,
    Antigravity, OpenCode and Ollama Cloud, each one card.
  - F70: a selected-provider change switches the primary target.
  - F72: account change.
  - F81: selected `claude-cli` gives a Claude subscription target with no credential reference, read via the probe handle.
  - F82: selected `anthropic` with `authMethod:'apiKey'` gives `unsupported-auth` with no reader call.
  - F83: selected `openai-codex` gives a Codex account-home target with no credential reference.
  - F71 still applies: no secret appears anywhere in the serialized result.
- **Files**: listed under Component 10.

### 11. MCP agent tool output (vscode-lm-tools)

- **Purpose**: Req 5, D2 and design §5. Limit state and alternatives on list and on every spawn result, including failures.
- **Responsibilities**:
  - **`agent-limit.formatter.ts`** (pure, uses the Component 2 engine and the UTC formatter):
    - `formatLimitColumn(row)`;
    - `formatPlanLimitsSection(rows)`;
    - `formatAlternatives(rows, {targetRowKey?})`;
    - `formatSpawnLimitBlock(target, rows)`, which produces the `**Limit state:**` line, an optional `> WARNING: … The spawn was still started.` (or "…still attempted." on failure), an optional `> Note (estimate, not a warning): …`, and an optional `**Cooldown:** …`.
  - **Sentences, exactly as in design §5**:
    - "No lane has confirmed room…";
    - "No lane has room: every lane is at its limit…", only when the near and unknown groups are empty and the roster is non-empty;
    - the empty-roster and single-lane sentences, followed by all four groups printed as `none`.
  - **`formatAgentList(agents, roles?, limits?)`**:
    - Appends a `Limit state` column last. Type stays in column 2 and Status in column 3.
    - Then the roles line, `### Plan limits`, and `### Alternatives by limit state`.
    - With no `limits` argument the output is byte-identical to today.
  - **`formatAgentSpawn(result, options?, limits?)`**: appends after `CLI Session ID`.
  - **`AgentNamespaceDependencies.getLaneLimits?: (rows, opts) => Promise<LaneLimitRow[]>`**, injected from `ptah-api-builder.service.ts` via `@inject(CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP, {isOptional:true})`.
  - **Handlers** (HTTP `protocol-dispatcher.ts:1076-1150, 1284-1304`; stdio `agent-tool.dispatcher.ts:329-422, 673-703`):
    - list: after `agent.list()`, call `agent.limits(rows)`.
    - spawn: **after** `agent.spawn` resolves or rejects (it is never awaited before), call `agent.limits(rows, {target})`.
    - In the error branches (`AgentRoleError`, `CliCommandLineTooLongError`, and the generic rethrow path converted to a tool error), append the same block to the error text. A lookup failure never changes the success or error outcome.
- **Verified contracts**:
  - `mcp-response-formatter.ts:1700-1829`;
  - `agent-namespace.builder.ts:152-170`;
  - `protocol-dispatcher.ts:1101-1149, 2901-2916`;
  - `agent-tool.dispatcher.ts:190-216`;
  - `tool-result-budget.ts:119, 125` ('preformatted').
- **Dependencies**: vscode-lm-tools → cli-agent-runtime (existing edge) and shared.
- **Failure behaviour**:
  - The lookup is bounded by 3 s (P5).
  - On timeout or failure the rows are marked unknown. The tool never fails because of the lookup (Req 5.4, 5.7).
- **Quality requirements**:
  - No vendor brand in any **static** new string (`vendor-roster-drift.spec.ts:48-94`). Provider labels come only from row data.
  - Estimates never produce `WARNING` (Req 5.5).
- **Verification seam**:
  - Formatter snapshot specs for each design §5 variant (F42-F52).
  - Both handlers: a lookup that times out still returns the spawn result.
  - The guard specs and `agent-spawn-surface-parity.spec.ts` stay green.
  - Scoped command: `npx nx run-many -t test,lint,typecheck -p vscode-lm-tools`.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\agent-tool.dispatcher.ts`

### 12. RPC and push (rpc-handlers)

- **Purpose**: expose snapshots to the webview and push changes.
- **Responsibilities**:
  - **`provider:getAccountUsage`**: delegates to `PlanUsageService.getOwnerSnapshot` and maps back to the existing result shape plus the additive fields. Codex `quota.primary/secondary` stay populated.
  - **New `provider:getPlanLimits`**: zod-validated in `provider-rpc.schema.ts`, added to `METHODS` (`provider-rpc.handlers.ts:105-116`). The handler calls `PlanLimitOwnerDiscoveryService.discoverTargets({selectedProviderId: params.providerId, sessionIds})` (Component 10b), then `PlanUsageService.getOwnerSnapshot` per target, in parallel with the 3 s per-owner deadline. It returns `{generatedAt, owners, sessionOwners}`. Credential references are resolved inside the backend and never serialized. A spec walks the JSON result for the fake secret strings (F71).
  - **`PlanLimitsBroadcaster`**:
    - Subscribes to `ledger.onChange`.
    - Debounces with a single 500 ms timer.
    - Broadcasts `PLAN_LIMITS_CHANGED` with the same discovery-based snapshot (`refresh:false`, last selected provider id remembered from the most recent `provider:getPlanLimits` call), using `WebviewBroadcaster` as `SessionLifecycleNotifier` does (`session-lifecycle-notifier.ts:43-80`).
    - `dispose()` clears the timer and unsubscribes.
    - Registered in `registerSharedRpcHandlers` and resolved in `activateSessionLifecycleNotifier` (`register-shared-rpc-handlers.ts:49-80`).
- **Verified contracts**:
  - `provider-rpc.handlers.ts:118-187`;
  - `rpc.types.ts` registry;
  - `chat-session.service.ts:275-294` (broadcast catch-and-debug pattern);
  - host activation at `bootstrap.ts:415` and `phase-3-handlers.ts:93`.
- **Dependencies**: rpc-handlers → auth-providers (existing edge).
- **Failure behaviour**:
  - RPC errors return the existing failure shape. The frontend falls back to `service-unavailable` (`provider-account-state.service.ts:37-39` behaviour, moved into the store).
  - A broadcast failure is logged at debug level and not retried.
- **Verification seam**:
  - Handler spec: a non-Codex provider no longer returns `provider-unsupported` when a reader exists.
  - Broadcaster spec with a fake timer.
  - `rpc-allowlist.spec.ts` stays green.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.schema.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\plan-limits-broadcaster.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\index.ts`

### 13. Frontend `PlanLimitsStore` (libs/frontend/core)

- **Purpose**: the one webview source of plan-limit snapshots and the shared clock.
- **Responsibilities**:
  - A root `@Injectable` that implements `MessageHandler` for `PLAN_LIMITS_CHANGED`.
  - Signals: `snapshot()`, `ownerByKey(key)`, `sessionOwner(sessionId)`, and `now()`.
  - `load({providerId?, sessionIds?, refresh?})` via `ClaudeRpcService.call('provider:getPlanLimits', …)`, with a generation guard as in `provider-account-state.service.ts:27-43`.
  - **One** `setInterval` of 30 s drives `now`. It starts on the first `load` and is cleared through `DestroyRef`. No per-tile timers.
- **Verified contracts**:
  - `ClaudeRpcService.call` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:129-133`);
  - `MessageHandler` (`message-router.types.ts:33-49`);
  - registration site `app.config.ts:173-176`.
- **Dependencies**: core → shared.
- **Failure behaviour**:
  - An RPC failure sets an empty snapshot. Surfaces then render "Usage / Unavailable", never 0.
  - A malformed push payload is ignored and logged.
- **Quality requirements**: a single interval, released on destroy (runtime-cost rule).
- **Verification seam**: store spec covering push replacement, generation guard and the interval cleared on destroy.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\lib\services\plan-limits.store.ts` (+ spec)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\index.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\apps\ptah-extension-webview\src\app\app.config.ts`

### 14. Lane run accounting in `AgentMonitorStore` (libs/frontend/chat-streaming)

- **Purpose**: keep lane usage correct for the life of the view and carry the lane quota fields.
- **Responsibilities**:
  - Add `usageTotals: CliUsageTotals | null`, `role?`, `failureKind?` and `quotaOwnerKey?` to `MonitoredAgent`.
  - `onAgentOutput` folds the usage of each incoming segment with `addCliUsage` **before** `capSegments`.
  - `onAgentSpawned` and `onAgentExited` copy `role`, `failureKind` and `quotaOwnerKey` from `AgentProcessInfo`.
  - `loadCliSessions` sets `usageTotals:null` and `restoredHistory` as today, so restored tokens and cost read "unknown".
  - It copies `ref.quotaOwnerKey` into `MonitoredAgent.quotaOwnerKey`, which may be absent (Decision 10).
- **Verified contracts**: `agent-monitor.store.ts:86-161, 698, 839-867, 1090-1150`; `agent-output-retention.ts:209`.
- **Dependencies**: chat-streaming → shared.
- **Failure behaviour**: none new.
- **Verification seam**:
  - Retention spec extension: more than 600 segments with usage, and the totals equal the full sum.
  - Restore spec: `usageTotals` is null.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts` (+ spec, `agent-monitor.retention.spec.ts`)

### 15. Stats grid tiles (libs/frontend/chat-ui) and chat-view wiring (libs/frontend/chat)

- **Purpose**: Req 7 and 8 and design §3, with A1-A3.
- **Responsibilities**:
  - **`stats-limit-view-model.ts`** (pure, in chat-ui): `buildStatsLimitViewModel({sessionId, sessionOwnerKey, sessionModelScope, owners, laneRuns, now}) → {indicator?, planTiles[], laneTiles[], subtotal?, lanesCount}`.
    - Plan tiles cover the session owner's windows applicable to the session's model scope. They also include the "No usage source", "Stale", "Unavailable", owner-evidence (active or expired) and "Cooldown" tiles.
    - Lane tiles: one per CLI + role. Runs are split into subgroups by **owner key + model scope**.
    - Each subgroup gets `ownerRelation` to the session owner (A1).
    - For a `same` subgroup, only windows that a session plan tile renders (same owner, window key and scope) become "see plan tiles" chips. Every other applicable window keeps its full detail (A2).
    - An `unknown` subgroup shows "Limit unknown · quota owner cannot be determined; no other account's windows are borrowed".
    - Tokens and cost come from `usageTotals`. A missing value reads "unknown". The subtotal tile lists known sums and the count of unknown costs.
    - **Restored runs (Revision 3, Decision 10)** use the owner key **recorded at their run** (`CliSessionReference.quotaOwnerKey`).
      - A restored run with no recorded key is in an "Unknown owner" subgroup that reads "Limit unknown · owner not recorded".
      - The lane's current owner is never substituted.
      - The view passes the recorded keys as `ownerKeys` to `provider:getPlanLimits`, so their snapshots are available.
  - **`StatsTileExpansionState`**: a **view-scoped** service in chat-ui (Revision 2, finding 6), a `Map` signal keyed `${sessionId}::${tileId}`. Tile ids are `plan:<ownerKey>:<windowKey>`, `plan-evidence:<ownerKey>`, `plan-cooldown:<ownerKey>`, `plan-status:<ownerKey>`, `lane:<cli>:<role|none>` and `lanes-subtotal`.
    - Every tile starts closed.
    - It is not `providedIn: 'root'`.
      - `ChatViewComponent` lists it in its own `providers`, so there is one instance per session view, released when that view is destroyed.
      - `SessionStatsSummaryComponent` injects it with `{optional: true}` and otherwise creates a component-local instance (the harness-builder host).
    - The map is never reset by a refresh, a push or a collapse/expand re-render (A3).
    - It has **no size cap and no eviction**. Entries for other sessions shown earlier in the same view stay until the view is destroyed; they are bounded by the sessions visited in that view times their tiles.
    - Activity in another view cannot touch this view's state.
  - **Components** (standalone, OnPush, signal inputs, `<button type="button" aria-expanded aria-controls>` with the panel as the next sibling):
    - `ptah-plan-limit-tile`, `ptah-lane-usage-tile`, `ptah-lane-subtotal-tile`, `ptah-limits-alert`;
    - classes exactly as in design §3.1-3.3 and §8.
  - **`SessionStatsSummaryComponent`**:
    - New optional inputs: `limits = input<StatsLimitViewModel | null>(null)` and `sessionId = input<string | null>(null)`.
    - Collapsed: the `ptah-limits-alert` wrapping line goes **above** the scrolling strip (variant A), and the "LANES n" pill goes after Cost.
    - Expanded: the tiles are appended after the existing cards in DOM order. No `grid-auto-flow: dense`.
    - With `limits` null the output equals today's. The harness-builder host is unaffected.
    - The "Context" rename is kept.
  - **`chat-view.component.ts/.html`**:
    - Builds `limits` from `PlanLimitsStore` and `AgentMonitorStore.agentsForSession(sessionId)`, with the session model scope from `resolvedLiveModelStats().model`.
    - Calls `planLimits.load({sessionIds: [sessionId]})` when the session id changes.
    - Adds `providers: [StatsTileExpansionState]` to `ChatViewComponent`.
- **Verified contracts**:
  - `session-stats-summary.component.ts:54-58, 60-211, 212-414, 669-685`;
  - `chat-view.component.html:27-31`; `chat-view.component.ts:773-792`;
  - `agent-monitor.store.ts:447`;
  - chat-ui → core allowed and chat-ui → chat forbidden (Codebase evidence, tags row).
- **Dependencies**: chat-ui → shared and core; chat → chat-ui, core and chat-streaming (existing edges).
- **Failure behaviour**: an empty or absent snapshot renders "Usage / Unavailable" or nothing. Unknown values are never 0.
- **Quality requirements**:
  - Accessibility per design §8: text first, `role="status"` on the alert, `role="meter"` bars, the 2px info focus ring, and keyboard toggling with Enter and Space.
  - No horizontal overflow at 280, 360 and 440 px.
  - No new timers (the clock comes from the store).
- **Verification seam**:
  - View-model specs F53-F60, including the A1, A2 and A3 fixtures.
  - Component specs: the existing stats spec stays green, plus tile toggling and an open tile surviving a re-render.
  - A visual review at 280 and 440 px.
- **Files**:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-limit-view-model.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-tile-expansion.state.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-usage-tile.component.ts` (+ spec)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-subtotal-tile.component.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\limits-alert.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts` (+ spec)
  - MODIFY the chat-ui barrel `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\index.ts`, if the view-model type is exported for chat-view
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`

### 16. Dashboard provider account card (libs/frontend/dashboard)

- **Purpose**: Req 6 and design §4, for every owner in scope.
- **Responsibilities**:
  - One `<section>` per owner in `PlanLimitsStore.snapshot().owners`, replacing the `isCodex()` gate.
  - Window rows show the name, state chip, a `role="meter"` bar with a P3 tick (only when a used value exists), the used value or "Used: unknown", "Resets <local absolute> · in …" or "Reset unknown", and source chips.
  - "Limit reached — resets …"; Cooldown shown separately; the Req 2.8 combined rendering; the raw failure status name; the existing stale notice.
  - The Codex Activity block is kept unchanged from `owner.activity`.
  - **Selection input kept (Revision 2, finding 4)**: the card reads `AuthStateService.persistedProviderId()`, the same input `provider-account-state.service.ts:15` uses today.
    - An `effect` calls `PlanLimitsStore.load({providerId})` whenever it changes, with the same generation guard. The selected provider's owner is the first section; lane owners follow.
    - The Refresh button calls `load({providerId, refresh: true})`.
  - `ProviderAccountStateService` is deleted and its barrel export removed. Its only consumers are the card and `dashboard/src/index.ts` (grep). Its selection behaviour moves into the card effect described above.
- **Verified contracts**: `provider-account-card.component.ts:1-52`; `provider-account-state.service.ts`; `analytics-card.component.html:73`.
- **Dependencies**: dashboard → core and shared.
- **Failure behaviour**: an empty snapshot shows "Account usage unavailable".
- **Verification seam**: rewritten card spec covering 16 design states (F61). Visual review.
- **Files**:
  - REWRITE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts` (+ spec)
  - DELETE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\services\provider-account-state.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\index.ts`

## Integration architecture

### Data flow per provider

1. **Claude, main session (native)**:
   - **Proactive**: RPC or lookup → `PlanUsageService` → Claude reader → `SessionQuotaProbeService.readPlanUsage` on the open `Query`. Windows come back as `provider-api`, a full table.
   - **Passive**: `StreamTransformer` sees `rate_limit_event`, `api_retry` (rate_limit/429) or an assistant `error==='rate_limit'` → mapper → `SessionPlanLimitCallbackRegistry` → the ledger. The ledger resolves the owner through `readAccount(sessionId)` and records `stream-event` evidence → `onChange` → broadcaster → `planLimits:changed` → `PlanLimitsStore` → stats tiles and the dashboard. No reload or refresh is needed (Req 3.1, 7.3).
2. **Claude lane (ptah-cli `claude-cli`)**:
   - `PtahCliStreamLoop` uses the same mapper, so the same evidence is recorded with the lane owner from that lane's `accountInfo()`.
   - On exit, the wording classifier applies (Claude wording).
   - Lane windows come from the owner snapshot. "Same account" applies only when the keys are equal (A1).
3. **Codex**:
   - **Proactive**: `CodexAccountUsageService` app-server read, same `CODEX_HOME` as the lanes → windows by duration (`provider-api`).
   - **Main via the Codex proxy**:
     - An upstream 429 → the proxy boundary computes the owner key from `currentOwnerKey()` → `providerQuotaStore.onRateLimit` → cooldown evidence on exactly that owner (Req 3.2).
     - With no owner key, the evidence is unattributed (Component 9).
     - Proxy successes → `onSuccess` (S4, billing `'unknown'` for Codex, so nothing clears).
   - **Lane success**: S3 with billing `'unknown'`. Unknown-reset Codex exhaustion clears only through a full-table read below the limit, or through elapse.
   - **Lane**: on a failed exit, "try again at …" → `error-derived` owner evidence with the next-occurrence reset (Req 3.4, 3.5).
   - Lane token telemetry never produces windows (Decision 6).
4. **Ollama Cloud (main with key, or a Glm lane)**:
   - **Proactive**: `/api/usage` (`provider-unofficial`). A provisional schema mismatch returns `service-unavailable`.
   - **Passive**: an SDK `api_retry` with `error_status` 429 in the main or lane stream → owner evidence for the credential owner.
   - A local daemon or placeholder key gives an unknown owner, so the lane state is unknown.
5. **Antigravity lane**:
   - **Proactive**: the local language server `GetUserStatus` (`provider-unofficial`).
   - **Passive**: "RESOURCE_EXHAUSTED … reset after <dur>" → `error-derived`. `MODEL_CAPACITY_EXHAUSTED` is ignored.
6. **OpenCode**:
   - `no-usage-source` status.
   - **Passive**: "Free usage exceeded" → owner evidence on the `cli-store` owner. Rendered as "no usage source · limit hit <time>, resets <time | unknown>" (Req 2.8).
7. **Dashboard**:
   - The card's selected `providerId` (`AuthStateService.persistedProviderId()`) → `provider:getPlanLimits({providerId})` → `PlanLimitOwnerDiscoveryService` (selected provider, session owners, detected lanes, active-evidence owners) → `PlanCredentialSource` resolves secrets in the backend → readers → snapshots carrying owner keys only → the webview.
8. **Successes**:
   - S1-S3 (Decision 4) → `ledger.recordSuccess` → only `'plan'` billing, for the current turn's frozen main-loop scope on the same owner, clears unknown-reset exhaustion.
   - S4 (a proxy 2xx only) clears that owner's cooldown only.
9. **Tools**: `ptah_agent_list`/`spawn` → `agent.limits(rows)` → `LaneLimitLookupService` with a 3 s deadline per lane → the engine → `agent-limit.formatter.ts`. A spawn always runs before the lookup.

### State and persistence

- **Ledger**: process-wide singleton memory, owned by auth-providers.
- **Persisted** (P6): only known-reset exhaustion and owner evidence with a known reset, under `IStateStorage` `ptah.planLimits.exhaustion.v1`. Pruned when the reset passes.
- **Never persisted**:
  - reader caches (30 s, in memory);
  - session-to-owner map (in memory, rebuilt from the probe);
  - lane usage totals (frontend memory, life of the view);
  - expansion state (one instance per chat view, life of that view).

### External boundaries

- **`ollama.com/api/usage`**: HTTPS, Bearer key, 5 s timeout, one attempt, zod-validated.
- **Antigravity language server**: loopback-only HTTPS. The TLS bypass is limited to `127.0.0.1`. The CSRF token is read from process arguments via a constant command argument array; it is never logged.
- **Codex app-server**: unchanged spawn with a 10 s request timeout (`codex-account-usage.service.ts:18`).
- **Claude SDK**: control requests with a 3 s timeout.
- **Credentials**: every credential becomes only a fingerprint. Logs carry `{providerId, fieldPath, reason}` only.

### Failure and rollback

- Each reader fails independently, into its Req 2.9 status.
- Evidence capture failures are logged and dropped. They never break the stream, exit handling or a tool call.
- Spawn is never gated (Req 5.7). The lookup failure path marks rows unknown.
- **Rollback**: every change is additive except the dashboard card rewrite and the Codex re-pin. Reverting the branch restores the old behaviour, and the persisted key is ignored by old code.

### Observability

- `[PlanLimits]` lines, all at **debug** level (Revision 2, finding 9):
  - evidence recorded (provider, window key, source, owner kind; never the material);
  - reader status transitions, one per change, not per call;
  - classifier matches (`cli`, pattern id).
- Nothing is logged at info per match or per call.
- The existing `[CodexAccountUsage]` warning is kept.

### Assumptions to resolve

| # | Assumption | Check the implementer runs |
| --- | --- | --- |
| A1 | `codex --version` prints a line ending in the package version, so the 0.147.0 pin fails today | Run `node node_modules/@openai/codex/bin/codex.js --version` locally. It is offline and needs no account |
| A2 | The regenerated `account/read`, `account/rateLimits/read` and `account/usage/read` shapes at 0.155.1 are unchanged or additive | Run `app-server generate-ts` and diff the selected types. If a change is incompatible, stop and report |
| A3 | The `rate_limit_event.utilization` scale and `resetsAt` unit are unknown. Instants are normalised by magnitude; `utilization` is not ingested | Governed by the Req 2.1 amendment, pending user approval at Gate 2 |
| A10 | The main-session Ollama Cloud key is stored under `getProviderKey('ollama-cloud')` | Read `ApiKeyStrategy` and `LocalNativeStrategy` (`api-key.strategy.ts:356`; `strategies/local-native.strategy.ts`) before writing `PlanCredentialSource` |
| A4 | `ollama-cloud` main sessions resolve `capacityRoute.providerId='ollama-cloud'` | Read `resolveCapacityRoute` (`session-query-executor.service.ts:83-130`). If it is null, resolve from the provider registry base URL `https://ollama.com` (`local-provider-entry.ts:17`) |
| A5 | The Antigravity LS process name, argument names, CSRF header and payload fields are provisional (research rows 29-30) | Not verifiable here (no live checks). Keep them in `antigravity-ls.provisional.ts`; validation failure gives `service-unavailable` |
| A6 | Ollama `/api/usage` shape and reset fields (research rows 34-35) | Same as A5 |
| A7 | Longest window per provider (Decision 4) | These constants come from research and the vendor docs that were cited. Revisit when real fixtures land |
| A8 | `api_retry` arrives for 429s on direct (non-proxy) Ollama Cloud routes | This is the SDK contract (`sdk.d.ts:3384-3391`). Confirm by spec only |
| A9 | The cli-agent-runtime DI token and register file paths | Locate with `ptah_search_files libs/backend/cli-agent-runtime/src/**/tokens.ts`. The existing `CLI_AGENT_RUNTIME_TOKENS.AGENT_REPORT_ROUTER` (`ptah-api-builder.service.ts:469`) shows the token object exists |

## 597 seam (what 596 does not build, and where 597 plugs in)

- **Not built in 596**:
  - Batch 11: lane capture entries.
  - Batch 12: the Ollama window, `isProxiedProviderBaseUrl`, and the Responses translator.
  - Batch 13: OpenCode config and the Codex/OpenCode usage split.
  - Batch 22: usage displays.
  - Batches 26-27: the A8 compaction coordinator.
  - 596 does not edit `codex-cli.adapter.ts`, `opencode-cli.adapter.ts`, `responses-request-translator.ts`, `sdk-adapter-events.service.ts`, `session-query-executor.service.ts` or any compaction file.
  - **Revision 2 exception**: 596 makes a minimal edit to `translation-proxy-base.ts` (Component 9: the owner-key hook and the `noteUpstreamQuota` context).
    - 597 Task 12.3 also edits that file, adding the proxy INFO line near `:966-976`. The regions differ.
    - Whichever lands second rebases. There is no semantic conflict, because neither changes the other's behaviour.
- **Usage seam**:
  - `addCliUsage` (Component 3) is the single place lane usage is folded.
  - 597 Task 13.1 adds `cacheReadTokens?`, `cacheCreationTokens?` and `contextTokens?` to `CliOutputSegment.usage`.
  - 597 Task 22.1 must change `addCliUsage` (not `stats-bar.utils.ts`, which now delegates) to sum `cacheReadTokens` separately. The lane tiles then pick it up with no 596 change.
  - Until then the tiles show input and output only. Fields not reported render "not reported", never 0.
- **Cost seam**: lane cost uses only an adapter `costUsd`. When 597 Batch 14 lands `costUsd: number | null`, null already renders "unknown".
- **Stats component overlap**:
  - 597 Task 22.2 edits `session-stats-summary.component.ts` to show "not reported" for cache. 596 also edits that file, in other regions: new inputs, the alert slot and the tile block.
  - Whichever lands second rebases. No semantic conflict.
- **Failure-kind seam**: `AgentFailureKind` (Decision 5) is the single union. 597's budget, repeat and blocked-model stops add members there, not a `stopReason` string.
- **Rollout seam (single module)**:
  - The existing reader `scripts/agent-usage/codex-rollout.reader.ts` stays the only rollout reader.
  - When a runtime consumer is needed (Req 2.4, once a verified fixture exists), whichever task lands it moves the per-record parsing into `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex/codex-rollout-records.ts`. The script then imports it, the same relative-import pattern the script already uses for `codexHomeDir`.
  - Its contract:
    - `parseRolloutRecord(raw: unknown): CodexRolloutRecord | null`, a discriminated union over `session_meta`, `turn_context`, `task_started`, `token_count` and `compacted`;
    - `token_count` carries `info.total_token_usage`, `info.last_token_usage` and `rateLimits?: {primary?, secondary?}`, each `{usedPercent, windowMinutes?, resetsInSeconds?}`;
    - plus `rateLimitWindowEvidence(record, eventTimestamp) → PlanLimitWindow[]`, which returns `[]` when `rate_limits` is absent.
  - 596 does not create this file.

## Test fixtures (all synthetic or labelled provisional; none collected live)

- **Engine (shared)**:
  - F1: seconds vs milliseconds vs ISO normalise equal (Req 1.3).
  - F2: API used beside an `estimated` reset gives per-field sources (Req 1.4).
  - F3: unknown used never shows 0 % (Req 1.5).
  - F4: reset passed with no newer observation gives "reset, usage unknown" (Req 1.7, injected clock).
  - F5: clock time across midnight resolves to the next day (Req 3.4).
  - F6: relative duration `144h24m50s`.
  - F7: Retry-After delta-seconds.
  - F8: Retry-After HTTP-date.
  - F9: absent and invalid Retry-After.
  - F10: seven-day Retry-After stays seven days and is not a weekly reset.
  - F11: five-hour and weekly windows with different resets tracked independently.
  - F12: duration → kind (300 → `five_hour`, 10080 → `weekly`, null → positional label).
- **Mapper (agent-sdk)**:
  - F13: `rate_limit_event` `seven_day_opus` rejected → `weekly_model:opus` exhausted, other windows untouched (Req 2.1).
  - F14: `allowed` gives no exhaustion.
  - F15: `api_retry` with 429 → owner-level evidence; `retry_delay_ms` → cooldown, not a reset.
  - F16: assistant `error:'rate_limit'` → owner level.
  - F13a: a `rate_limit_event` with `utilization: 0.82` or `82` leaves the window's used value **unset** (unknown), keeping only reset and status (Req 2.1 amendment).
- **Ledger and precedence**:
  - F17: window known, reset known.
  - F18: window known, reset unknown.
  - F19: window unknown, reset known (Codex "try again at 5:05 PM").
  - F20: window unknown, reset unknown (Req 3.5).
  - F21: the three precedence rules, one fixture each (Req 4.4).
  - F22: Opus-only exhaustion does not affect the Sonnet scope (Req 4.5).
  - F23: unknown-reset exhaustion is not cleared by an unrelated model, overage or fallback success; it is cleared by a same-allowance read below limit; longest-window elapse gives unknown usage (Req 3.8).
  - F24: P6 restart, with and without a known reset.
  - F25: per-window expiry with the injected clock (Req 3.7).
- **Readers**:
  - F26: Claude full table from `usage_EXPERIMENTAL`.
  - F27: Claude probe null → event-only data.
  - F28: Claude API key → `unsupported-auth`.
  - F29: Codex windows by duration, with the existing fields kept (Req 2.10).
  - F30: Req 2.9 matrix: same-account transient with cache → stale; transient without cache; unsupported auth; unsupported CLI version; A then B; A then sign-out.
  - F31: OpenCode with no evidence → "no usage source" alone.
  - F32: OpenCode with a recorded hit → combined rendering (Req 2.8).
  - F33: Ollama and Antigravity provisional valid, missing-reset and mismatch → `service-unavailable` (Req 2.5).
- **Lane classifier**:
  - F34: Claude "5-hour limit reached ∙ resets 2am".
  - F35: Codex "usage limit … try again at 5:05 PM".
  - F36: Antigravity "RESOURCE_EXHAUSTED … reset after 144h24m50s" (provisional).
  - F37: OpenCode "Free usage exceeded" (provisional).
  - F38: Ollama 429 (provisional).
  - F39: `MODEL_CAPACITY_EXHAUSTED` and timeout → not quota (Req 3.9).
  - F40: Codex `turn.completed` token-count events with no quota fields → no window (Req 2.4, no-quota-fields fixture).
- **Lookup**:
  - F41: one reader slower than 3 s → that lane is unknown "limit lookup timed out"; the others are returned (Req 5.4).
- **Tool text, design §5 variants**:
  - F42: empty window set gives unknown.
  - F43: single partial Claude event gives unknown.
  - F44: aged snapshot observed after the last reset gives unknown.
  - F45: fresh 95 % gives near limit and a warning.
  - F46: full fresh set below the threshold gives confirmed room.
  - F47: no confirmed room.
  - F48: every lane at limit.
  - F49: empty roster.
  - F50: single-lane roster.
  - F51: spawn with cooldown, estimate-only note, at limit, failed spawn plus alternatives.
  - F52: Req 5.7, spawn attempted under cooldown, exhaustion and failed lookup (one case each).
- **Stats view model and components (A1, A2, A3 required)**:
  - F53 (A1): same provider, account A session vs account B lane → "Different owner", full detail. Same provider and same account → "Same account as this session".
  - F54 (A1): unknown session owner (no `accountInfo`) → the lane is "Unknown owner" and borrows nothing.
  - F55 (A1, complete A→B, Revision 3). This is an integration spec across the probe, ledger, resolver, `agent-events` persistence, `AgentMonitorStore` restore and the view model:
    1. The session owner is A, and lane run 1 records A.
    2. `authFileChanged` fires and the probe re-reads B, so the session owner becomes B.
    3. Run 1 still shows A, now as "Different owner". A new run 2 records B and shows "Same account".
    4. After a reload, the restored run 1 still carries A from `CliSessionReference`.
    5. A restored run with no recorded key shows "owner not recorded" and never B.
  - F56 (A2): Sonnet main session, Opus lane on the same account, Opus-only exhaustion. The lane keeps full "Weekly · Opus" detail (used, reset, passed vs next, sources). The other windows show "see plan tiles" chips. No session plan tile is created for Opus.
  - F57 (A3): an opened lane tile and an opened plan tile stay open after a snapshot push and after usage deltas. Ids are keyed by session id plus tile id, never index.
  - F58: two sessions, each with its own lanes. Neither shows the other's runs (Req 8.1).
  - F59: lane usage never changes the Tokens or Cost cards (Req 8.5). Restored runs show "unknown" (Req 8.4).
  - F60: collapsed indicator appears only for at-limit or near-limit, including owner-level exhaustion with zero windows (P4 A).
- **Dashboard**:
  - F61: the 16 design §4 states, including stale plus a live limit, cooldown separate from limit, and failure status names.
- **Revision 2 additions**:
  - **Success producers and clearing (Req 3.8)**:
    - F62 (S1): a main-session success `result` on Sonnet, with the last event showing no overage, clears unknown-reset `weekly_model:sonnet` and `five_hour` exhaustion on the same owner. It does not clear `weekly_model:opus`.
    - F63 (S2): a Claude lane success while `isUsingOverage:true` gives `billing:'overage'` and clears nothing.
    - F64 (fallback): a success recorded under the fallback provider's owner key leaves the original owner's exhaustion intact.
    - F65 (S3): an antigravity `completed` exit clears same-scope unknown-reset exhaustion. Codex and opencode `completed` exits (billing `'unknown'`) clear nothing.
    - F66 (S4, revised in Revision 3): a proxy 2xx with an owner key clears **only that owner's cooldown**. It never clears exhaustion, because every in-scope proxy provider is `'unknown'` billing. With a null owner key it clears nothing. The full boundary matrix is F80.
  - **Proxy owner attribution (A1, Req 3.2)**:
    - F67: two same-provider proxies with keys A and B each 429. Two owner keys are recorded, and a session bound to A never shows B's cooldown.
    - F68: Codex proxy 429 with `currentOwnerKey()` null gives an unattributed cooldown that no lane shows and that clears nothing on success.
  - **Discovery and secrets (Req 6.6)**:
    - F69: discovery returns one target for each of Claude, Codex, Antigravity, OpenCode and Ollama Cloud (selected provider, detected lanes, ptah-cli Glm).
    - F70: changing the selected provider changes the first owner.
    - F71: a `provider:getPlanLimits` result serialized to JSON contains none of the fake secrets (provider key, ptah-cli key, CSRF token). A missing Ollama key gives `unsupported-config`, still listed.
    - F72: after an account change, the new owner key is listed and the old owner's cache is not served.
  - **Expansion and eviction**:
    - F73 (A3): view 1 has an open tile. View 2 records more than 200 expansion entries. View 1's tile stays open. Destroying view 1 releases its state.
    - F74: 100 owners with active known-reset exhaustion all survive. Nothing active or persisted is evicted before its expiry.
- **Revision 3 additions**:
  - **Per-turn S1 scope and billing**:
    - F75, Opus-then-Sonnet regression:
      - Turn 1 on Opus records unknown-reset exhaustion of `weekly_model:opus`.
      - Turn 2's main-loop model is Sonnet. It has an in-turn `rate_limit_event` with no overage and ends in a success `result` whose cumulative `modelUsage` still lists Opus.
      - The success clears `five_hour`, `weekly` and `weekly_model:sonnet` unknown-reset exhaustion only. `weekly_model:opus` stays exhausted.
      - A subagent partial on Opus during turn 2 does not add Opus to the scope.
    - F76, overage reset per turn:
      - Turn 1 sees `isUsingOverage:true` and its success is `'overage'`.
      - Turn 2 sees no `rate_limit_event`, so its success is `'unknown'` and clears nothing. The turn-1 flag is not carried over.
      - Turn 3 sees an event with no overage, so its success is `'plan'`.
  - **Owner lifecycle**:
    - F77: probe `accountInfo` cache invalidation on query replacement, on `authFileChanged`, and on assistant `authentication_failed`.
    - F79: account change keeps A's evidence, drops A's reader cache, and attributes nothing of A to B.
  - **Canonical credentials**:
    - F67b: a proxy owner key equals the resolver owner key for the same raw credential (`Bearer K` vs stored `K`; `X-Api-Key` mixed case).
    - F78, `credentialFromHeaders` cases:
      - `authorization: bearer K` and `Authorization: Bearer  K` give `K`.
      - `Basic X` gives `X`.
      - A raw `Authorization: K` gives `K`.
      - `x-api-key` takes precedence.
      - Missing or empty gives `null`.
      - `Bearer Bearer K` strips one scheme only and gives `Bearer K`.
  - **S4 boundary**: F80 (2xx, 3xx, credit or fallback provider, unknown owner).
  - **Route-based discovery**: F81 (`claude-cli`), F82 (direct Anthropic key gives `unsupported-auth`), F83 (Codex account home).

## Architecture-level quality requirements

- **Functional**:
  - Req 1-8 acceptance criteria **except the pending Req 2.1 amendment**, through the fixtures above. Req 2.1's `utilization` capture is deferred pending user approval at Gate 2.
  - Spawns are never gated.
  - Unknown values are never rendered as 0.
  - Lane usage is never added to session totals.
- **Performance**:
  - At most one Claude usage control request per refresh.
  - A 30 s reader cache.
  - Tool lookups add at most 3 s and run after the spawn.
  - One webview clock interval.
  - Push debounced to 500 ms.
  - No timer, observer or poll per lane or tile.
- **Security**:
  - No API key, OAuth token, CSRF token or account email in RPC results, tool output or logs. Only opaque fingerprints are used.
  - The loopback-only TLS bypass is restricted to `127.0.0.1`.
  - Commands are constant argument arrays.
  - zod validation at every external payload.
- **Maintainability**:
  - Layer direction: shared ← agent-sdk ← auth-providers ← cli-agent-runtime ← vscode-lm-tools and rpc-handlers. No new `vscode-core` import into an agnostic lib.
  - No new platform port: `IStateStorage` already has adapters in VS Code, Electron and CLI.
  - Barrels stay at 150 lines or fewer.
  - `Symbol.for` tokens in `di/tokens.ts`.
  - Sync, idempotent `dispose()` on the ledger and the broadcaster.
- **Testability**:
  - Every rule is pure and takes `now` as a parameter.
  - Every external source is behind an injectable reader or runner.
  - Every requirement fixture is listed, and each one is a unit or integration spec at the boundary it guards.

## Clarifications Needed

None for this plan. No requirement needs a settings-page change:

- P3, P5 and P9 are code constants.
- The Ollama key comes from existing secret storage.
- The agent picker stays out of scope.

The Req 2.1 amendment is an open **user approval at Gate 2**, not an architecture clarification. See its own section.

## Team-leader handoff

### Recommended executors

- backend-developer: Components 1-12, including 10b.
- frontend-developer: Components 13-16.
- senior-tester: the fixture sweep F1-F83 after each phase.
- visual-reviewer: Components 15-16 at 280, 360 and 440 px, in dark and light themes.
- code-logic-reviewer: the ledger and engine (state machine and precedence).
- code-style-reviewer: layer, tag and DI conventions.

### Complexity

HIGH. Five providers, three evidence channels, a cross-layer contract, ownership and precedence rules, and three surfaces.

### Dependencies and ordering

These are component-level constraints only:

- 1 → 2 → 3, which are the shared foundation.
- 4 needs 1-2.
- 7 needs 1.
- 9 needs 7 (`currentOwnerKey`) and 4 (fingerprint).
- 5 needs 2, 4 and 9. Its `provider-owner.resolver.ts` needs 7.
- 6 needs 5 and 7.
- 8 needs 6's reader type file and `plan-credential.source.ts`.
- 10 needs 4, 5 and 6. 10b needs 10's resolver and 6.
- 11 needs 10.
- 12 needs 6 and 10b.
- 13 needs 1 and 12's RPC contract.
- 14 needs 3.
- 15 needs 2, 13 and 14.
- 16 needs 13.

### Parallel-safe work

These sets are file-disjoint:

- {4, 7} after 1-2, then 9.
- {8} alongside {10, 10b} after 6.
- {11} alongside {12} after 10b.
- {13, 14} after 12.
- {15, 16} after 13.
- **Component 8 is mandatory for this task** (Req 2.5, 6.6; orchestrator decision, Revision 2). It is file-disjoint from the others, so it can be its own batch, but it is not optional.

### Files affected

- **CREATE**: listed per component.
  - shared: 8 files.
  - agent-sdk: 3. Revision 3 removed the fingerprint file.
  - auth-providers: 10, adding `provider-owner.resolver.ts` and `plan-credential.source.ts`.
  - cli-agent-runtime: 4, adding `plan-limit-owner-discovery.service.ts`.
  - vscode-lm-tools: 1.
  - rpc-handlers: 1.
  - core: 1.
  - chat-ui: 6.
- **MODIFY**: listed per component. Shared-file hotspots:
  - `agent-process.types.ts`, also touched by 597 Task 13.1;
  - `session-stats-summary.component.ts`, also touched by 597 Task 22.2;
  - `stats-bar.utils.ts`, the 597 Task 22.1 target, now delegating;
  - `translation-proxy-base.ts`, also touched by 597 Task 12.3 (Revision 2, Component 9);
  - `agent-process.types.ts` `CliSessionReference.quotaOwnerKey?` and `agent-events.ts` (Revision 3, Decision 10).
- **REWRITE**: `codex-account.generated.ts` and `provider-account-card.component.ts`.
- **DELETE**: `provider-account-state.service.ts`.
- **Never touch**:
  - `libs/frontend/chat/src/lib/settings/**`, `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings`, `apps/ptah-electron-e2e/src/specs/settings`, `apps/ptah-tui/src/components/settings`;
  - the 597 deferred files listed in the 597 seam.
  - Check every batch diff against these paths before commit.

### Verification points

- Every cited `file:line` is reopened before editing.
- A1/A2 run before Component 7. A4 runs before Component 6's session-owner path. A9 runs before Component 10. A10 runs before `plan-credential.source.ts`.
- Gate 2 must record the user's answer on the Req 2.1 amendment before the Component 4 Claude event-mapper batch is accepted.
  - If the answer is a rejection, only that batch is blocked, pending a focused plan revision.
  - Every other batch proceeds.
- Commands that must pass:
  - Per lib: `npx nx run-many -t test,lint,typecheck -p shared agent-sdk auth-providers cli-agent-runtime vscode-lm-tools rpc-handlers core chat-streaming chat-ui chat dashboard`.
  - Three-app typecheck: `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli`.
  - `vendor-roster-drift.spec.ts`, `lane-rule-single-home.spec.ts`, `agent-spawn-surface-parity.spec.ts`, `rpc-allowlist.spec.ts`, and the existing `session-stats-summary.component.spec.ts` (11/11) stay green.
- No live provider call, forced 429 or rollout read in any test or check.
