# Implementation Plan - TASK_2026_692_f748

Revision: 3 (addresses `implementation-plan-review.md` rounds 1 and 2; see `## Review Response`)

Idle compaction for Claude Agent SDK main sessions: one RxJS service in `libs/backend/agent-sdk`
that arms per session after a turn whose last request wrote a 1-hour cache, fires a streamed
`/compact` shortly before that cache expires, and coordinates with `CompactionCoordinator`, the
manual `/compact` route, settings and the chat compaction marker.

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md` (decisions 6-9 binding), `task-description.md`
  Revision 3, `task-description-review.md` (Round 3 APPROVED), `implementation-plan-review.md`
  (rounds 1 and 2, REVISE), repository `CLAUDE.md`.
- Corrections applied: AC 3.7 is amended per `decisions.md` decision 9 (option A): idle
  compaction skips only Codex-proxy sessions and ignores E2/`canAct`. D1 records the final rule.
- Design handoff used: none (no designer phase; `context.md` Strategy). The only UI is two settings
  rows rendered by the existing advanced-settings group and one text variant of the existing
  compaction marker.
- Missing decision-critical input:
  - Live CLI behaviour of a streamed `/compact` with a non-human origin (A2). Not in source; must be
    probed before the firing batch is accepted (see Assumptions).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Coordinator is a plain class built by a factory with a timer seam and logger error sink; one record per real SDK id; `dispose` is synchronous and idempotent | `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts:86-122,255-264`; `libs/backend/agent-sdk/src/lib/di/register.ts:476-494` | The new service follows the same "plain class + `instanceCachingFactory` + seams" pattern |
| Unref'd Node timer seam | `compaction-coordinator.ts:51-61` | Reference for the unref requirement; RxJS `timer` gets an equivalent unref'd `SchedulerLike` |
| `onPreCompact` only from IDLE/ARMED; `requestManualCompact` dedupes only TRIGGERED/COMPACTING | `compaction-coordinator.ts:166-179,247-253` | Enqueue-to-PreCompact gap is real; claim must be a separate field, not a state |
| `onPostCompact` moves the whole record object to the new id | `compaction-coordinator.ts:230-241` | A claim stored on the record follows a rebind for free |
| `ManualCompactDecision` union `send` / `deduped` | `compaction/compaction-state.types.ts:113-116` | Extend with `coalesced` |
| `COMPACTION_MAX_DWELL_MS = 300_000` | `compaction-state.types.ts:43` | Reused as the post-PreCompact bound of an idle attempt |
| `requestManualCompact` has no production caller | grep of `libs` (only the coordinator and its spec) | The manual `/compact` route must be wired to it for AC 2.5 |
| Every session class is registered with `e2Passed: null` → OBSERVE_ONLY | `session-lifecycle/session-query-executor.service.ts:613-622`; `compaction-coordinator.ts:69-72,117-120` | AC 3.7 as written never lets an attempt fire (D1); the service must track open compactions itself |
| Manual `/compact` route: router → `executeSlashCommand` → `executeSlashCommandQuery` (ends + relaunches) | `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:114-162`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1602-1705`; `helpers/session-lifecycle-manager.ts:730-759` | The coalescing gate belongs in the router before `executeSlashCommand` |
| Router awaits `resolveEnhancedPromptsContent` and `resolveProviderProfileForWorkspace` after interception and before `executeSlashCommand`; the adapter has no await before `executeSlashCommandQuery`, which awaits `endSession` (abort happens only after an awaited interrupt) | `chat-slash-command-router.service.ts:122-137`; `sdk-agent-adapter.ts:1602-1650`; `session-lifecycle-manager.ts:741-743`; `session-lifecycle/session-control.service.ts:245-275`; pump `assertAdmissible` checks only registry identity, abort, turn and queue (`session-stream-pump.service.ts:266-285`) | A one-time early check cannot order manual against idle; manual admission must be decided and reserved synchronously after the last await, and the reservation must block `claimIdle` while the old run tears down (Review Response R1) |
| PostCompact is a hook callback that rekeys then emits completion; `compact_boundary`/`result` are stream frames seen by the tap; no source orders the two channels | `compaction-hook-handler.ts:518-565`; `session-lifecycle/session-query-executor.service.ts:247-267` | The reducer must accept PostCompact before or after the boundary, and the claim must not be released by stream frames alone (R2, R4) |
| Router already depends on `@ptah-extension/agent-sdk` and `SDK_TOKENS` | `chat-slash-command-router.service.ts:18-22,53-54` | Injecting the coordinator by token adds no new dependency edge |
| `SlashCommandInterceptor` yields `commandName` (`compact`) | `helpers/slash-command-interceptor.ts:55-103` | Gate keys on `commandName === 'compact'` |
| Pump `sendMessage`: `require-idle` re-asserts synchronously then pushes; refusal is `SessionAdmissionRefusedError('busy'|'session-ended')` | `session-lifecycle/session-stream-pump.service.ts:198-258,266-279`; `errors/session-admission-refused.error.ts:15-33` | Add a synchronous `beforeEnqueue` hook between the second assert and the push to place the claim atomically |
| Facade `sendMessage` forwards to the pump; every live-session input goes through it | `session-lifecycle-manager.ts:702-719`; adapter `sdk-agent-adapter.ts:1582-1600` | Input/activity signal is emitted in the facade; the idle send uses a separate facade method that does not emit it |
| `setSessionModel` facade | `session-lifecycle-manager.ts:793` | Prompt-prefix-change signal source (AC 3.6) |
| Facade `dispose` stops sweep and threshold watch; called from adapter dispose | `session-lifecycle-manager.ts:475-479`; `sdk-agent-adapter.ts:737-751` | Service `dispose` is called from the facade `dispose` |
| Optional injections into the facade are the established pattern | `session-lifecycle-manager.ts:405-417` | Inject the service with `{ isOptional: true }` |
| `CompactionSessionTap`: per-run, keyed by real SDK id, sees every main-loop message, counts turns as `${runToken}:${turn}`, fire-and-forget `readAtTurnEnd`, releases every tracked id on abort/stream end | `session-query-executor.service.ts:186-210,235-276,359-390,414-450,615-632,862-863` | Single source for request usage, anchor, turn end, turn context, boundary, rate limit, session bound/released |
| The tap's main/sub split: messages with `parent_tool_use_id` go to the subagent monitor | `session-query-executor.service.ts:236-239` | Main-thread filter is already there |
| `onMessage` (tap) runs before transform in the same loop iteration | `helpers/stream-transformer.ts:536-548` (onMessage) and `:1027` (transform) | A boundary seen by the tap is visible to the `compaction_complete` stamp of the same message |
| `SDKAssistantMessage.message` is a `BetaMessage` (id, usage); `request_id` optional | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3405-3416` | Request identity = `message.id`; usage per request from `message.usage` |
| Usage parser reads `cache_creation.ephemeral_1h/5m_input_tokens` from `message.usage` | `compaction/subagent-budget-monitor.ts:152,210-237` | Reuse `readSubagentRequestUsage` (generic shape) for main-thread requests; do not duplicate |
| Main-thread transcript lines carry the 1h split on a subscription | `~/.claude/projects/D--projects-ptah-extension/22fe48f2-….jsonl` (`"isSidechain":false` lines with `ephemeral_1h_input_tokens>0, ephemeral_5m_input_tokens:0`) | The confirmed-1h-write rule (decisions #7) is observable on main-thread requests |
| Context reading per turn, `undefined` on failure, 5 s timeout | `compaction/context-usage.port.ts:15-20,32-33,41-47,52-72` | `turn-context` carries the reading of exactly one turn id, or none |
| PreCompact fan-out registry, resolved real id + trigger | `helpers/compaction-callback-registry.ts:22-60`; `compaction-hook-handler.ts:429-437` | Service subscribes for PreCompact without changing the hook handler |
| PostCompact: rekey targets list, then `emitCompactionComplete` (only when id and cwd resolved) | `compaction-hook-handler.ts:169-190,529-566`; `helpers/sdk-adapter-events.service.ts:160-166,224-229` | Service is a third rekey target; PostCompact arrives via `onCompactionComplete` after the rekey |
| `compact_boundary` transform builds `CompactionCompleteEvent` with `compact_metadata.pre_tokens` | `message-transform/system-message.transformer.ts:35-123` (event at `:109-121`) | Idle notice stamp is one optional field on this event; `<N>` = `pre_tokens` |
| Transformer helpers already hold `sessionLifecycle` | `message-transform/transformer-helpers.ts:12-23`; `sdk-message-transformer.ts:118-166` | Notice lookup goes through the facade; no transformer constructor change |
| Turn phase per session (`idle`, `awaiting-background`, …) | `helpers/session-turn-state.registry.ts:352-391,448-450`; token `di/tokens.ts:200`; registered `register.ts:648-651` | Fire-time idle / background-subagent check (AC 3.9) |
| Rate-limit status union `allowed`/`allowed_warning`/`rejected` on `rate_limit_event` | `sdk.d.ts:5333-5334`; `plan-limits/claude-rate-limit.mapper.ts:36,221-244` | Tap forwards `rate_limit_info.status` for main-loop events |
| Registry eviction skips live queries and notifies keys | `session-lifecycle/session-registry.service.ts:593-648` | Live sessions end via tap release; eviction listener only covers query-less records |
| Tab close sends `chat:abort` unless still shown elsewhere | `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.ts:49-65` | Open question 1 resolved: a closed tab's query ends, so it is never compacted |
| Settings: provider validates and warns once; `compaction.enabled` read at `:130` | `helpers/compaction-config-provider.ts:90-207` | Add `getIdleCompactionConfig()` with the same treat-as-unset rule |
| Advanced settings registry renders, validates and derives defaults | `libs/shared/src/lib/types/advanced-settings.types.ts:22-72,123-213,478-511`; `libs/backend/platform-core/src/file-settings-keys.ts:176-178,186-225,734,792`; `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:166-210`; `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts:282` | Two descriptors + two file keys give UI, validation, default and persistence with no UI code |
| Export key list | `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:52-63` | Add both keys (AC 5.5) |
| Live file-based setting changes surface through `IWorkspaceProvider.onDidChangeConfiguration` on every host | `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts:51-57`; `platform-vscode/src/implementations/vscode-workspace.spec.ts:98`; `platform-electron/src/implementations/electron-workspace-provider.ts:208-236`; `platform-cli/src/implementations/cli-workspace-provider.spec.ts:113`; usage pattern `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:248-253` | Subscribe there; `ConfigManager.watch` keeps one callback per key (`vscode-core/src/config/config-manager.ts:263-279`) and fires for file keys only on its own `set` (`:216-227`), so it is rejected |
| Frontend marker chain | `chat-streaming/src/lib/accumulator-core.service.ts:571-590`; `chat-streaming/src/lib/streaming-handler.service.ts:197-206,393-402,469-482`; `chat/src/lib/services/chat.store.ts:423-431`; `chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:353-362,505-521`; `chat-state/src/lib/conversation-registry.service.ts:39-47,275-319,368-387,445-463`; `chat/src/lib/components/templates/chat-view.component.html:90-97`; `chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:24,105-135` | The notice is a text variant of the existing marker, carried by one optional field end to end; tokens formatted with `toLocaleString()` (`:133-135`) |
| No UI labels a compaction as manual | `compaction-marker.component.ts:24,50`; grep of `chat-ui/.../notifications` | AC 6.2 holds by construction; a test pins it |
| `rxjs` 7.8.2 root, external in agent-sdk and CLI builds, declared by Electron; not declared by agent-sdk or CLI packages | `package.json:197`; `libs/backend/agent-sdk/project.json:17-22`; `apps/ptah-cli/project.json:59`; `apps/ptah-electron/package.json:47`; `libs/backend/agent-sdk/package.json:8-24`; `apps/ptah-cli/package.json:51-90` | Requirement 7 fix |
| `@nx/dependency-checks` is an error for agent-sdk | `libs/backend/agent-sdk/eslint.config.mjs:4-18` | Lint fails unless `rxjs` is declared in the same batch as the first import |
| `max-lines` 700 (warn), skip blanks/comments | `eslint.config.mjs:550-562` | New files stay well under; the facade (814) and executor (1024) already exceed it, so only thin call sites go there |
| SDK services are registered once in `registerSdkServices`, called by all three hosts | `register.ts:150,845-868`; callers `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts` | No composition-root edits; smoke specs gain a resolution assertion |
| `expected-resolvable.ts` lists RPC handler classes and a few lane tokens, no SDK services | `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:10-37` | No change (no new handler class) |
| Smoke specs assert SDK singletons resolve once | `apps/ptah-cli/src/di/container.smoke.spec.ts:347-353`, `:691-716`; `apps/ptah-electron/src/di/container.smoke.spec.ts:556-559`; `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:525-567` | Add one `SDK_IDLE_COMPACTION` assertion per host |
| `SDKMessageOrigin` includes `{ kind: 'coordinator' }` | `sdk.d.ts:5030-5080` | Non-human origin for the idle `/compact` (AC 2.3) |

## Architecture decision

- Chosen approach: one singleton `IdleCompactionService` (agent-sdk) that owns all sessions through
  one RxJS pipeline: a `Subject<IdleSignal>` → key resolution (alias index) → `groupBy(key,
  { duration })` closing each group on session release → per group `scan` over a pure reducer
  that emits a `step {signal, state, effects}` → one `switchMap` on the state's single
  `timer` spec (due or deadline) → the reducer's one-shot `fire` effect into `exhaustMap` for the
  guarded send. Every signal, including timer and feedback signals, enters through one
  trampolined `enqueue`, so each is fully reduced and dispatched before the next starts.
  Producers (tap, facade, hook handler, PreCompact registry, PostCompact bus, settings changes)
  only push typed signals; the decision logic is pure (request tracker, reducer, fire gate) and
  unit-tested without RxJS. The pending-idle claim is a state-independent field on the
  coordinator record, placed inside the pump's synchronous admission section and held until the
  matched PostCompact or a failure. Manual `/compact` admission is decided synchronously after
  the router's last await by `admitManualCompact`, which either returns `coalesced` (claim held)
  or reserves the record so a later `claimIdle` refuses; whichever of the two synchronous calls
  runs first wins. A matched PostCompact marks the coordinator's open record as finished
  (`postCompactSeen`), so manual admission after PostCompact answers `send` even while the
  coordinator still waits in TRIGGERED/COMPACTING for its boundary (D10).
- Rationale: matches the requested RxJS shape; O(1) work per event; at most one timer per
  session; groups end with the session so nothing leaks; time is injectable
  (`SchedulerLike` + wall clock) so specs use `VirtualTimeScheduler`/`TestScheduler`; the
  coordinator stays the single owner of compaction admission (decision #8) and keeps its
  state machine unchanged.
- Rejected alternatives:
  - A plain `Map` + `setTimeout` state machine (coordinator style): fits, but the user asked for
    RxJS and the groupBy/switchMap shape gives cancellation-by-construction for every new event.
  - Subclassing `AsyncScheduler`/`AsyncAction` to unref: needs `rxjs/internal/*` deep imports;
    rejected for a 50-line `SchedulerLike` built on public types (`SchedulerLike`,
    `SchedulerAction`, `Subscription`).
  - Claim as a new coordinator state (e.g. `IDLE_CLAIMED`): would change every transition guard and
    the OBSERVE_ONLY "never changes state" invariant; a separate field leaves the state machine as is.
  - Sending through `executeSlashCommandQuery`: ends and relaunches the query (spec AC 2.1).
  - Notice via a new push message (`session:idleCompacted`): races the `compaction_complete` that
    creates the marker; stamping that event is ordered by construction (`stream-transformer.ts:541`
    before `:1027`).
  - Adding the idle lookup to `TransformerHelpers`: changes the transformer constructor and
    `createIsolated` plus every spec that builds it; the facade is already a helper.
  - `ConfigManager.watch` for live settings: single callback per key and blind to `settings:set`
    file writes (`config-manager.ts:216-227,263-279`).
- Assumptions:
  - A1 (anchor). The CLI emits the frame that precedes a request (the tool_result user message or,
    for the first request, nothing after Ptah's own enqueue) before it sends that request, and the
    host observes that frame within `ANCHOR_SKEW_MS = 5_000` of the send. Check: in the tester's
    live run, log `anchorAt` and the first stream event's `ttft_ms` (`sdk.d.ts:5179`) for a few
    requests and confirm `anchorAt ≤ firstEventAt − ttft_ms`. If violated, raise the skew.
  - A2 (origin). A streamed `/compact` with `origin: { kind: 'coordinator' }` is executed by the CLI
    as the slash command (PreCompact `trigger: 'manual'`, `num_turns=0`), as the human-origin case
    is (`slash-command-interceptor.ts:11-19`). Check before accepting the firing batch: one live
    probe on a scratch session (send via `sendIdleCompact`, observe PreCompact/`compact_boundary`
    in the log). If the CLI treats it as a prompt, stop and escalate: the fallback is the human
    origin (verified to execute) with Ptah-side render suppression, which needs a decision.
  - A3 (ordering). For a streamed `/compact` turn the main loop emits `compact_boundary` before the
    turn's `result`. The relative order of the PostCompact hook and those stream frames is not
    assumed: the reducer defines both orders (component 4, "Completion orders"). Check with the
    live probe above and log which order occurred; `result` with neither boundary nor PostCompact
    is `compaction-failed`, so any order shows the generic marker, never a wrong idle notice.
  - A4 (main-thread usage). Streamed main-thread `assistant` frames carry `message.usage` with the
    `cache_creation` split, as the transcript does. Check: tap unit fixture plus the live probe log.
- Effect on existing code: no behaviour change for sessions that never arm (API key, Bedrock,
  Vertex, proxies, Codex proxy) and for the coordinator state machine. `requestManualCompact`
  gains its first production caller (plus the new `admitManualCompact`); its `deduped` answer can
  only occur for acting sessions, and none exist today, so the manual route is unchanged except
  while an idle claim is held (coalesced) or an idle send loses the race to a reserved manual
  (idle skipped). The `deduped` answer is narrowed: once PostCompact has been reported for the
  open compaction it is `send` (D10); this also affects a non-idle compaction of an acting
  session, and none exist today.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | **Final (`decisions.md` decision 9, option A; AC 3.7 amended).** Idle eligibility excludes Codex-proxy sessions only and does not require coordinator `canAct`/E2. The service tracks open compactions itself (PreCompact → boundary/PostCompact/turn end) and also refuses on coordinator TRIGGERED/COMPACTING/COOLDOWN/BACKOFF. The claim and the manual reservation work on any registered record, OBSERVE_ONLY included. | A (adopted); B keep AC 3.7 literally (rejected: feature inert); C set `e2Passed: true` for non-Codex classes (rejected: also turns on threshold ARMED behaviour) | `session-query-executor.service.ts:613-622`; `compaction-coordinator.ts:69-72`; E2 gates `autoCompactWindow` forwarding (TASK_2026_597 plan, git `12b721789^`), which idle compaction does not use | yes: one predicate in `idle-fire-gate.ts` |
| D2 | Claim timeout before PreCompact = `120_000` ms; after PreCompact the attempt is bounded by `COMPACTION_MAX_DWELL_MS` (300 000 ms); once the compaction turn has ended with a boundary but no PostCompact, the claim is held at most `IDLE_POSTCOMPACT_GRACE_MS = 30_000` more (WARN `postcompact-timeout`), never past the dwell bound | 60 s / 120 s / 300 s; grace 10 s / 30 s / dwell only | Streamed command yields at enqueue; PreCompact follows within seconds; measured summarization 213-216 s (`compaction-state.types.ts:37-43`); the PostCompact hook runs in the same CLI process right after summarization, so a 30 s grace after `result` only matters when the hook is lost (R2) | yes |
| D9 | Manual `/compact` admission is two calls: an early `requestManualCompact` (fast path, no side effect) and an authoritative `admitManualCompact` immediately before `executeSlashCommand` with no await in between; `send` there reserves the record until the router's `finally` or the record's unregister/reset/dispose | single early check (review R1 shows it races); serialize through a promise queue in the coordinator (adds async to a synchronous class) | `chat-slash-command-router.service.ts:122-137`; `compaction-coordinator.ts:111-130,247-253`; `session-stream-pump.service.ts:241-247` | yes |
| D10 | Round 2 finding: after the matched PostCompact, manual admission is `send`. `onPostCompact` sets `postCompactSeen` on a record that is TRIGGERED/COMPACTING (before its equal-id early return); every `transition` and `register` reset clears it; `requestManualCompact`/`admitManualCompact` dedupe only when open **and** not `postCompactSeen`. The hook calls `onPostCompact` whenever the PreCompact-resolved id exists, passing the payload id or that id. The reducer's PostCompact-first path keeps releasing the claim at PostCompact (AC 2.6), bounds `postcompacted` by the 30 s grace, and closes it on a new `pre-compact` or `session-bound` run so a later manual compaction never takes the idle notice | (a) hold the idle claim until the coordinator leaves TRIGGERED/COMPACTING (rejected: with no boundary that is up to the 300 s dwell, and the user command is coalesced into a finished compaction instead of run, against AC 2.6 "admitted normally"); (b) router coalesces with a "compaction just finished" message (rejected: drops a command the user issued after completion); (c) new coordinator transition PostCompact → COOLDOWN (rejected: changes the state machine and drops the boundary's token payload on the later `onCompactBoundary`, `:194-209`) | `compaction-coordinator.ts:211-223` (`onTurnEnd` cannot clear TRIGGERED), `:230-241` (`onPostCompact` rebind only), `:247-253` (dedupe on open), `:278-287` (dwell); `compaction-hook-handler.ts:518-540` (PostCompact calls the coordinator only when both ids exist); `task-description.md:193-197` | yes: one condition in two coordinator methods |
| D3 | Anchor = `max(turnStartAt, lastNonRequestFrameAt − 5_000)` | prev-frame rule; ttft-derived (`firstEventAt − ttft_ms`, partial messages only); turn start only | Spec definition of Anchor; A1 | yes |
| D4 | Notice is carried only by the authoritative `compaction_complete`; the PostCompact-only advisory fallback (`compaction-lifecycle.service.ts:651-679`) shows the generic marker | stamp both paths / boundary only | Fallback fires only when the boundary was lost (degraded path); AC 6.4 (no wrong idle notice) still holds | yes |
| D5 | Setting keys `compaction.idleCompactionEnabled` (boolean, default true) and `compaction.idleCompactionMinTokens` (integer 100 000-5 000 000, default 200 000), group `context-budgets`, apply `live` | nested `compaction.idleCompaction.*` / flat | `budgetDefault` throws for non-positive-integer budget keys and the file comment says `compaction.*` entries must stay positive integers (`file-settings-keys.ts:170-178`); the boolean is safe because only `BUDGET_KEYS` are checked (`compaction-config-provider.ts:50-55`), and flat names keep the table uniform | yes |
| D6 | Manual route answers `coalesced` and `deduped` with `{ success: true, sessionId }` and no relaunch | handle `coalesced` only | Coordinator contract: a deduped `/compact` "is not resent" (`compaction-coordinator.ts:17-18`); `deduped` is unreachable today (D1 evidence) | yes |
| D7 | Open question 1: a closed tab ends its query (`closed-tab-session-ender.service.ts:49-65`), so it is never compacted; a session still shown elsewhere stays eligible | — | cited | — |
| D8 | Open question 2: `<N>` = `compact_metadata.pre_tokens` of the matched boundary; when not finite, the arming turn's `totalTokens` | live tracker / boundary / reading | `system-message.transformer.ts:93-121`; resume baseline not needed | yes |

## Component specifications

### 1. CompactionCoordinator pending-idle claim

- Purpose: make manual-compact admission treat a session as TRIGGERED from idle enqueue until the
  claim is released (decision #8, AC 2.4-2.6).
- Responsibilities:
  - `claimIdle(sessionId, claimId): 'claimed' | 'unknown' | 'open' | 'held' | 'manual-reserved'`
    — `claimed` only for a registered record whose state is not TRIGGERED/COMPACTING, which holds
    no claim and no manual reservation; stores `claimId` on the record. The refusal literal lets
    the service log `manual-compact-reserved` vs `compaction-state`.
  - `releaseIdleClaim(sessionId, claimId): boolean` — clears only a matching claim.
  - `getIdleClaim(sessionId): string | undefined` (for the fire gate and tests).
  - `requestManualCompact`: a held claim returns `{ action: 'coalesced' }` before the existing
    open-state check; otherwise unchanged. Pure query, no side effect (router fast path).
  - `admitManualCompact(sessionId): { decision: ManualCompactDecision; reservationId?: string }`
    — the same decision as `requestManualCompact`; when it is `send` and the record exists, it
    also stores a fresh `manualReservationId` on the record and returns it. Synchronous, so it is
    totally ordered against `claimIdle` (D9, R1).
  - `releaseManualReservation(sessionId, reservationId): boolean` — clears only a matching one.
  - Post-PostCompact admission (D10, round 2): the record gains `postCompactSeen: boolean`.
    `onPostCompact(sessionId, postId)` first sets it when the record under `sessionId` is
    TRIGGERED/COMPACTING (also when `postId` equals `sessionId`), then rebinds as today; its
    return value is unchanged (`true` only on a rebind). Gate 2 amendment (user-approved, review
    Round 3 finding 1): the private `transition` keeps it on TRIGGERED→COMPACTING and clears it
    only when the record leaves the open states (COMPACTING/TRIGGERED → COOLDOWN, BACKOFF or
    IDLE) or a new PreCompact opens a TRIGGERED record from a closed state; `register` (reset)
    starts it `false`. Required test (coordinator + router specs): PreCompact → PostCompact →
    late `status: compacting` frame → manual `/compact` is admitted as `send`, and the router
    sends it. `requestManualCompact` and
    `admitManualCompact` answer `deduped` only when the state is open and `postCompactSeen` is
    false; open with `postCompactSeen` is `send` (and `admitManualCompact` reserves). `claimIdle`
    still refuses any open state (`open`). The dwell timer is untouched.
  - Claim, reservation and `postCompactSeen` move with the record on `onPostCompact` rebind
    (already moves the object), are dropped by `unregister`, `register` (reset) and `dispose`.
    No state transition and no listener emission for any of them.
  - Header comment: OBSERVE_ONLY still never changes state or dedupes by state; the Ptah idle
    claim and manual reservation are the admission rules that apply to every record (D1, final);
    dedupe ends at the compaction's PostCompact even before its boundary (D10).
- Verified contracts: `compaction-coordinator.ts:63-67` (record shape), `:111-130`, `:230-264`,
  `:295-322` (`transition`, the one place state changes); `compaction-state.types.ts:113-116`.
- Dependencies: none new.
- Integration points: `IdleCompactionService` (claim/release/get); router (requestManualCompact).
- Failure behaviour: unknown session → claim false / release false / manual `send`; never throws.
- Quality requirements: O(1) per call.
- Verification seam: `compaction-coordinator.spec.ts` — claim then manual → `coalesced`; release →
  `send`; rebind keeps claim under new id; unregister/dispose drop it; claim refused (`open`)
  while TRIGGERED/COMPACTING; mismatched claimId release is a no-op; `admitManualCompact` `send`
  then `claimIdle` → `manual-reserved`; `claimIdle` then `admitManualCompact` → `coalesced` with no reservation;
  reservation released (matching id) → `claimIdle` `claimed`; register reset drops the reservation;
  D10: acting record TRIGGERED (and COMPACTING) without PostCompact → `requestManualCompact`
  `deduped` (unchanged); `onPostCompact(id, id)` (equal ids) → `requestManualCompact` `send` and
  `admitManualCompact` `send` with a reservation while the state is still TRIGGERED;
  `onPostCompact(old, new)` → `send` under `new`; `postCompactSeen` cleared by the next transition
  (boundary → COOLDOWN → turn end → IDLE → `onPreCompact` → TRIGGERED → `deduped` again) and by
  register reset; `onPostCompact` on an IDLE/OBSERVE_ONLY record sets nothing.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\compaction-coordinator.ts`;
  MODIFY `...\agent-sdk\src\lib\helpers\compaction\compaction-state.types.ts` (add
  `{ readonly action: 'coalesced' }` to `ManualCompactDecision`); MODIFY
  `...\agent-sdk\src\lib\helpers\compaction\compaction-coordinator.spec.ts`.

### 2. Idle compaction contracts and constants

- Purpose: the shared vocabulary of the feature, so producers, pure logic and the service agree.
- Responsibilities (types and literals only):
  - Constants: `IDLE_CACHE_TTL_MS = 3_600_000`, `IDLE_FIRE_FRACTION = 0.9`,
    `IDLE_FIRE_LATENESS_MS = 60_000`, `IDLE_MIN_TOKENS_FLOOR = 100_000`,
    `IDLE_MIN_TOKENS_DEFAULT = 200_000`, `IDLE_CLAIM_TIMEOUT_MS = 120_000`,
    `IDLE_ANCHOR_SKEW_MS = 5_000`, `IDLE_POSTCOMPACT_GRACE_MS = 30_000` (D2),
    `IDLE_COMPACT_ORIGIN = { kind: 'coordinator' }`.
  - `CacheTtlClass = '1h' | 'not-1h'`; `LastRequestSnapshot { requestKey; anchorAt; ttl }`.
  - `IdleSignal` discriminated union (each carries `sessionId`): `session-bound {runToken,
    codexProxy}`, `request-started`, `turn-ended {turnId, endedAt, lastRequest | null}`,
    `turn-context {turnId, totalTokens | null}`, `input`, `prompt-prefix-changed`, `rate-limit
    {status}`, `pre-compact`, `compact-boundary {preTokens | null}`, `post-compact`, `rekey {toId}`,
    `session-released`, `settings-changed`, plus internal signals `attempt-due {attemptId}`,
    `deadline-elapsed {attemptId, phase}` (timer), `fire-skipped {attemptId, reason}`,
    `fire-sent {attemptId}`, `fire-failed {attemptId, reason}` (feedback). Every internal signal
    names its attempt; the reducer ignores one that does not name the current attempt.
  - `IdleStep { signal; state; effects }` — the `scan` output; `effects` include the one-shot
    `fire {attemptId, claimId}` and `IdleTimerSpec = { kind: 'due' | 'deadline'; attemptId;
    phase; at } | null` is a field of state (one timer per session at most).
  - Reason codes (string literal unions): no-arm DEBUG (`not-1h`, `no-reading`, `stale-turn`,
    `activity-since-turn`, `fire-time-passed`, `disabled`, `codex-proxy`, `in-flight`); fire-time
    skip INFO (`disabled`, `auto-compact-off`, `not-1h`, `lapsed`, `below-min-tokens`,
    `no-reading`, `activity-since-arm`, `prompt-prefix-changed`, `compaction-state`,
    `not-actable`, `rate-limited`, `not-idle`, `background-subagent`, `not-idle-at-send`,
    `lookup-failed`, `manual-compact-reserved`); WARN (`send-failed`, `claim-timeout`,
    `dwell-timeout`, `postcompact-timeout`, `compaction-failed`).
  - Ports: `IdleCompactionSignals` (the push surface producers call; one method per external
    signal, each `void` and never throwing), `IdleCompactSender { sendIdleCompact(sessionId,
    beforeEnqueue: () => void): Promise<void> }`, `IdleBoundaryNotice { preTokens: number }`,
    `IdleCompactionTiming { scheduler: SchedulerLike; now(): number }`.
- Verified contracts: `SchedulerLike` is public in rxjs 7.8.2 (Assumption until the import compiles:
  `import type { SchedulerLike } from 'rxjs'`); `SDKMessageOrigin` coordinator kind
  `sdk.d.ts:5030-5080`; origin type re-export `types/sdk-types/claude-sdk.types` (used at
  `session-lifecycle-manager.ts:38-43`).
- Dependencies: `rxjs` (types only), agent-sdk SDK types.
- Integration points: every other idle component.
- Failure behaviour: not applicable (declarations).
- Quality requirements: no `any`; readonly fields.
- Verification seam: compile (`npx nx typecheck agent-sdk`).
- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.types.ts`.

### 3. Main-request tracker and TTL classifier (pure)

- Purpose: per run, identify the last main-thread API request of each turn, its TTL class and its
  anchor, without emitting per-frame events.
- Responsibilities:
  - `classifyCacheTtl(usage: SubagentRequestUsage | undefined): CacheTtlClass` — `'1h'` iff
    `cacheWriteByTtl` present, `'1h' > 0` and `'5m' === 0`; everything else `'not-1h'`
    (read-only, mixed, missing split, missing usage, zero write).
  - `MainRequestTracker` (one per tap): `observe(message, at): 'request-started' | null` —
    main-thread only (caller already excludes `parent_tool_use_id`); a request starts at the first
    `stream_event` `message_start` or `assistant` frame whose `message.id` differs from the current
    request; anchor per D3; usage from `readSubagentRequestUsage(message)` on `assistant` frames,
    last value wins per request; any other frame updates `lastNonRequestFrameAt`.
    `endTurn(at): LastRequestSnapshot | null` returns the turn's last request and resets
    (`turnStartAt = at`, since the next request follows a later enqueue).
  - `startAt` = tap construction time (the initial prompt is queued before the tap exists,
    `session-query-executor.service.ts:590-627`, and the CLI is not yet spawned).
- Verified contracts: `readSubagentRequestUsage` / `SubagentRequestUsage`
  (`subagent-budget-monitor.ts:152,210-237`); `BetaMessage` id/usage on assistant frames
  (`sdk.d.ts:3405-3416`); `isStreamEvent`/`isMessageStart` guards already used in
  `stream-transformer.ts:557-560` (Assumption: they are exported from the same module the tracker
  can import; check the import site in `stream-transformer.ts` before use, else narrow locally).
- Dependencies: `subagent-budget-monitor.ts` (exported function), SDK types. No clock of its own.
- Integration points: `CompactionSessionTap` (component 8a).
- Failure behaviour: malformed frames classify as no request / `not-1h`; never throws.
- Quality requirements: O(1) per frame, no allocation per text delta beyond a field write.
- Verification seam: `idle-request-tracker.spec.ts` — all TTL classes in the spec risk row; AC 1.2
  (send t=0, response t=7 min → anchor ≤ t0); multi-request turn picks the last request; read-only
  last request after an earlier 1h write → `not-1h` (AC 1.1); subagent frames never reach it.
- Files: CREATE `...\agent-sdk\src\lib\helpers\compaction\idle\idle-request-tracker.ts`, CREATE
  `...\idle\idle-request-tracker.spec.ts`.

### 4. Idle session reducer (pure)

- Purpose: the per-session state machine as a total pure function, so every AC on arming,
  cancellation and attempt identity is a table test.
- Responsibilities:
  - `reduceIdleSession(state, signal, ctx): IdleStep` with `ctx = { now; settings:
    { enabled; autoCompactEnabled; minTokens } }` and effects `log(level, reason)`,
    `fire(attemptId, claimId)`, `release-claim(sessionId, claimId)`, `set-notice(noticeKey,
    preTokens)`, `clear-notice`. The returned step echoes the input `signal`.
  - `timer` (state field, `IdleTimerSpec | null`) is derived in every reduction: Pending →
    `{due, attemptId, at: fireAt}`; InFlight `enqueued`/`precompact`/`boundary-ended` →
    `{deadline, attemptId, phase, at: deadlineAt}`; InFlight `postcompacted` → the same deadline
  form; otherwise null. The service schedules only
    from this field (component 7).
  - State: `sessionId` (current id after rekey), `runToken`, `codexProxy`, `lastTurn {turnId,
    endedAt, request}`, `reading {turnId, totalTokens}`, `activitySinceTurnEnd`,
    `prefixChangedSinceTurnEnd`, `rateLimit`, `compactionOpen`, `idlePeriodClosed`, and
    `attempt = null | Pending {attemptId, turnId, anchorAt, fireAt, expiresAt, armedAt,
    contextTokens} | InFlight {attemptId, phase: 'sending'|'enqueued'|'precompact'|'boundary'|
    'boundary-ended'|'postcompacted', claimId, claimed, contextTokens, boundaryPreTokens?,
    deadlineAt, dwellAt?}`. `claimId` is minted at the `attempt-due` transition, so `finalize`
    can always release it (a release of a never-taken claim is a no-op).
  - Arming (AC 1.1, 1.3, 1.4, 1.5): only on `turn-context` whose `turnId === lastTurn.turnId`, with
    no activity or prefix change since that turn end, no in-flight attempt, not
    `idlePeriodClosed`, `request.ttl === '1h'`, a reading of that turn, settings enabled, not Codex
    proxy, and `fireAt = anchorAt + 0.9 × IDLE_CACHE_TTL_MS > now`. A new arm replaces a pending
    one (new `attemptId`). Each refusal emits one DEBUG `log` with its reason. `turn-ended` clears
    the previous turn's reading (no value of turn A survives turn B).
  - Cancellation (AC 4.1, 4.2, 4.5, 4.7): `input`, `request-started`, `prompt-prefix-changed`,
    `pre-compact`, `settings-changed` to disabled, and a `session-bound` with a new `runToken`
    drop a Pending attempt (no log line beyond DEBUG). `input` and `request-started` set
    `activitySinceTurnEnd` and clear `idlePeriodClosed`; they never touch an InFlight attempt.
    `rekey` updates `sessionId` only (one group, one attempt).
  - Firing lifecycle (AC 2.4-2.9): `attempt-due` naming the current Pending attempt moves it to
    InFlight `sending` in the same reduction (minting `claimId`) and emits exactly one `fire`
    effect; any other `attempt-due` is ignored, and no other signal emits `fire`, so one Pending
    attempt yields at most one fire (R3). `fire-sent` → `enqueued`, `claimed = true`,
    `deadlineAt = now + IDLE_CLAIM_TIMEOUT_MS`; first `pre-compact` → `precompact`,
    `dwellAt = deadlineAt = now + COMPACTION_MAX_DWELL_MS`. `turn-ended` in
    `enqueued`/`precompact` → WARN `compaction-failed`, release, closed; `fire-skipped` → INFO
    reason, `release-claim` (no-op if never taken), attempt null; `fire-failed` → WARN, release,
    closed.
  - Completion orders (R2, R4). The claim is released only by the matched `post-compact` or a
    failure/timeout; stream frames alone never release it.
    - Boundary first: `compact-boundary` in `precompact` → `boundary`, effect `set-notice`;
      `turn-ended` in `boundary` → `boundary-ended`, `deadlineAt = min(dwellAt, now +
      IDLE_POSTCOMPACT_GRACE_MS)` (claim still held; a manual `/compact` here is coalesced);
      `post-compact` in `boundary`/`boundary-ended` → completed: `release-claim`, closed;
      `deadline-elapsed` in `boundary-ended` → WARN `postcompact-timeout`, release, closed.
    - PostCompact first: `post-compact` in `precompact` → `postcompacted`: `release-claim` (the
      requirement's "until PostCompact" bound is met), `deadlineAt = min(dwellAt, now +
      IDLE_POSTCOMPACT_GRACE_MS)`, attempt still current for notice matching;
      `compact-boundary` in `postcompacted` → effect `set-notice`, completed, closed;
      `turn-ended` or `deadline-elapsed` in `postcompacted` → completed without a notice (generic
      marker, D4; DEBUG, not WARN: the compaction did finish), closed. A manual `/compact` in
      this interval is admitted (`send`) by the coordinator's `postCompactSeen` rule (D10); its
      relaunch emits `session-bound` with a new `runToken` and its own `pre-compact`, and either
      one in `postcompacted` → completed without a notice, closed, so the manual compaction's
      boundary can never take the idle notice (AC 6.4).
    - PostCompact without any boundary is the PostCompact-first path ending at `turn-ended`.
    - A `pre-compact` that arrives while no attempt is InFlight, or a second `pre-compact`/
      `compact-boundary` after completion, never matches (AC 2.4).
  - Notice: `set-notice(noticeKey, preTokens ?? contextTokens)` keys the entry by the
    `session_id` carried on the boundary frame (the id `transformCompactBoundary` looks up), so a
    PostCompact rekey before or after the boundary cannot misplace it; `clear-notice` is
    deferred to the next `turn-ended` after completion or `input` (the boundary's own transform
    has already read it). Completion always sets `idlePeriodClosed = true`.
  - `deadline-elapsed` in `enqueued` → WARN `claim-timeout`, in `precompact` → WARN
    `dwell-timeout`; both release and close.
  - `compactionOpen` set by `pre-compact`, cleared by `compact-boundary`, `post-compact`,
    `turn-ended`.
- Verified contracts: none beyond component 2 (pure).
- Dependencies: component 2 types, `COMPACTION_MAX_DWELL_MS` (`compaction-state.types.ts:43`).
- Integration points: `IdleCompactionService` `scan`.
- Failure behaviour: total over the union; an unknown signal returns the state unchanged.
- Quality requirements: no I/O, no clock reads (time comes in `ctx`).
- Verification seam: `idle-session.reducer.spec.ts` — table tests per AC 1.1-1.5, 2.4, 2.6, 2.8,
  2.9, 4.1, 4.2, 4.5, 4.7; stalled read A across interleaved sessions (AC 1.5); a second
  `attempt-due` for the same attempt and a stale `attempt-due` emit no `fire`; completion orders
  boundary→result→PostCompact (claim held through `boundary-ended`), PostCompact→boundary→result,
  PostCompact→result with no boundary, boundary→result→grace elapsed (`postcompact-timeout`);
  `postcompacted` + grace elapsed → closed without notice; `postcompacted` + new-run
  `session-bound` → closed, then `compact-boundary` sets no notice; `postcompacted` + `pre-compact`
  → closed, no notice (D10); `timer` field for every phase including `postcompacted`.
- Files: CREATE `...\idle\idle-session.reducer.ts`, CREATE `...\idle\idle-session.reducer.spec.ts`.

### 5. Fire gate (pure)

- Purpose: the Requirement 3 refusal list evaluated at fire time, in one place.
- Responsibilities: `evaluateFireGate(state, attempt, lookups): IdleSkipReason | null` with
  `lookups = { now; settings; coordinatorState(id); coordinatorClaim(id); turnPhase(id) }`, in this
  order: `disabled`/`auto-compact-off` (3.1), `not-1h` (3.2), `lapsed` when `now − fireAt >
  60_000` or `now ≥ expiresAt` (3.3), `no-reading`/`below-min-tokens` (3.4),
  `activity-since-arm` (3.5), `prompt-prefix-changed` (3.6), `compaction-state` for coordinator
  TRIGGERED/COMPACTING/COOLDOWN/BACKOFF, a held claim or `compactionOpen`, `not-actable` for Codex
  proxy only (3.7 as amended by decision 9; OBSERVE_ONLY is not a refusal), `rate-limited` for `allowed_warning`/`rejected`
  (3.8), `not-idle` when the turn phase is not `idle` and `background-subagent` when it is
  `awaiting-background` (3.9).
- Verified contracts: `CompactionState` values `compaction-state.types.ts:24-35`;
  `SessionTurnStateRegistry.get` `session-turn-state.registry.ts:448-450` and phases `:362-368`;
  rate-limit statuses `sdk.d.ts:5334`.
- Dependencies: types only; lookups are injected functions.
- Integration points: `IdleCompactionService` fire stage.
- Failure behaviour: a lookup that throws is caught by the caller and mapped to `lookup-failed`.
- Quality requirements: pure, O(1).
- Verification seam: `idle-fire-gate.spec.ts` — one case per AC 3.1-3.9, including the virtual
  sleep/wake `lapsed` case math.
- Files: CREATE `...\idle\idle-fire-gate.ts`, CREATE `...\idle\idle-fire-gate.spec.ts`.

### 6. Unref'd RxJS scheduler

- Purpose: production `SchedulerLike` whose timers never hold the Node process (NFR process
  lifetime). RxJS `timer` on `asyncScheduler` uses an interval handle that is not unref'd, hence
  this adapter.
- Responsibilities: `createUnrefScheduler(): SchedulerLike` — `now()` = `Date.now()`;
  `schedule(work, delay, state)` returns an action (extends `Subscription`, implements
  `SchedulerAction`) that sets `setTimeout(..., max(0, delay))`, calls `.unref?.()`, re-schedules on
  `action.schedule(state, delay)` (clearing the old handle), and clears the handle on unsubscribe.
  Public rxjs types only; no `rxjs/internal` imports.
- Verified contracts: unref pattern `compaction-coordinator.ts:51-61`. Assumption: `SchedulerLike`,
  `SchedulerAction`, `Subscription` are exported from `rxjs` 7.8.2 and `timer(ms, scheduler)` calls
  `scheduler.schedule(work, due)` with `this` bound to the returned action; check by the spec
  below with a real `timer(…, createUnrefScheduler())`.
- Dependencies: `rxjs`.
- Integration points: register.ts factory passes it to the service.
- Failure behaviour: a throwing `work` propagates to RxJS as today's async actions do (the service
  catches inside the pipeline).
- Quality requirements: one handle per scheduled action; zero handles after unsubscribe.
- Verification seam: `unref-scheduler.spec.ts` with jest fake timers: `unref` called; unsubscribe
  clears; `timer(1000, s)` emits once at 1000 ms.
- Files: CREATE `...\idle\unref-scheduler.ts`, CREATE `...\idle\unref-scheduler.spec.ts`.

### 7. IdleCompactionService (RxJS orchestration)

- Purpose: the single multi-session handler; implements `IdleCompactionSignals`.
- Responsibilities:
  - Pipeline (constructor): `signals$ = new Subject<IdleSignal>()` →
    `map(resolveKey)` + `filter(nonNull)` through an alias index (`session-bound` opens a key,
    `rekey` adds an alias, `session-released` routes then deletes the key and aliases; signals for
    unknown keys are dropped, so a late feedback signal never opens a group) →
    `groupBy(s => s.key, { duration: g => g.pipe(filter(isReleased)) })` → `mergeMap(group =>
    sessionPipeline(group))` → top-level `subscribe` that feeds emitted feedback signals back into
    `signals$`.
  - Entry and ordering (R3): producers, timers and feedback all call one private
    `enqueue(signal)`. It appends to a FIFO and, unless a drain is already running, drains it:
    each signal is `signals$.next`-ed and fully processed (reduce, effects, timer switch, fire
    dispatch) before the next is taken. A signal produced while processing (feedback from a
    synchronous refusal, a release effect) is therefore queued, never re-entered, so no
    subscriber can see step N+1 before step N. A throw inside a drain is caught, logged at WARN
    and the drain continues with the next signal.
  - `sessionPipeline(group)`: `step$ = group.pipe(scan((acc, s) => reduce(acc.state, s, ctx),
    seed), tap(runEffects), share())`; `latest` = a per-group mutable ref updated in the same
    `tap`, read by `fire` and `finalize`. Timer: `step$ → map(st => st.state.timer) →
    distinctUntilChanged(sameTimerSpec by kind+attemptId+phase+at) → switchMap(spec => spec ?
    timer(max(0, spec.at − now()), scheduler).pipe(map(() => spec)) : EMPTY)` → subscriber calls
    `enqueue(spec.kind === 'due' ? attempt-due : deadline-elapsed)`. Because every reduction
    recomputes `timer`, any signal that cancels or replaces the attempt (input, request,
    prefix change, settings off, new run, new arm, completion) changes or nulls the spec and the
    `switchMap` unsubscribes the old timer in the same drain step. Fire: `step$ →
    mergeMap(st => st.effects.filter(isFire)) → exhaustMap(fire)`; the reducer emits `fire`
    once per attempt, `exhaustMap` is a second guard. `catchError` (WARN, end this group only)
    and `finalize` (release `latest` claim via its `sessionId`/`claimId`, release nothing else,
    delete the notice entry). Note: with a duration selector the group completes before its
    consumer sees the release signal (`groupBy` subscribes the duration first), so release work
    lives in `finalize`, not in the reducer.
  - `fire({attemptId, claimId})`: read `latest`, run `evaluateFireGate` with lookups wrapped in
    try/catch; on refusal `enqueue(fire-skipped)` (INFO, AC 3.x); else `from(sender.sendIdleCompact(
    sessionId, beforeEnqueue))` where `beforeEnqueue` (synchronous, runs inside the pump's
    final admission section) checks the group is still live and `latest` still holds this
    `attemptId` in `sending`, then calls `coordinator.claimIdle(sessionId, claimId)`; it throws
    `IdleSendVetoedError(reason)` unless the result is `claimed`. Map resolve → `fire-sent`,
    `SessionAdmissionRefusedError` → `fire-skipped not-idle-at-send` (AC 2.2), veto
    `manual-reserved` → `fire-skipped manual-compact-reserved`, other veto →
    `fire-skipped compaction-state`, any other error → `fire-failed send-failed` (AC 2.9). All
    outcomes go through `enqueue`, which drops signals for released keys.
  - Pending promise across release (R3): unsubscribing `from(promise)` does not stop the pump's
    `createUserMessage` await (`session-stream-pump.service.ts:234-240`), so the `beforeEnqueue`
    liveness check is what prevents a claim or push after release; the promise's rejection is
    still handled by `from`'s attached handler, so no unhandled rejection is raised.
  - Producers' entry points (implement `IdleCompactionSignals`): `sessionBound`, `requestStarted`,
    `turnEnded`, `turnContext`, `input`, `promptPrefixChanged`, `rateLimit`, `compactBoundary`,
    `sessionReleased`, `rekey(from, to)` (also satisfies `PostCompactRekeyTarget`); each is
    `signals$.next(...)` guarded so it never throws into a caller; no-ops after `dispose`.
  - Subscriptions it owns: `CompactionCallbackRegistry.register` → `pre-compact`
    (`compaction-callback-registry.ts:32-37`); `SdkAdapterEvents.onCompactionComplete` →
    `post-compact` (`sdk-adapter-events.service.ts:224-229`);
    `IWorkspaceProvider.onDidChangeConfiguration` filtered on `ptah.compaction.enabled`,
    `ptah.compaction.idleCompactionEnabled`, `ptah.compaction.idleCompactionMinTokens` →
    one `settings-changed` per live key, synchronously (AC 4.5).
  - `boundaryNoticeFor(sessionId): IdleBoundaryNotice | undefined` — synchronous read of the
    notice map written by the `set-notice` effect (AC 6.1, 6.4).
  - `dispose()`: idempotent; completes `signals$` (finalize releases every claim), unsubscribes the
    three subscriptions, clears the alias index and notice map; later calls are no-ops (AC 4.6).
  - Logging through the injected `Logger` only: session id, attempt id, reason code, token counts;
    never message text.
- Verified contracts: `CompactionCallbackRegistry.register` `:32-37`; `SdkAdapterEvents.onCompactionComplete`
  `:224-229`; `IWorkspaceProvider.onDidChangeConfiguration` `workspace-provider.interface.ts:57` and
  `ConfigurationChangeEvent.affectsConfiguration` `platform-core/src/types/platform.types.ts:168-170`;
  `SessionAdmissionRefusedError` `errors/session-admission-refused.error.ts:15-33`;
  `SessionTurnStateRegistry.get` `:448-450`; `CompactionConfigProvider.getConfig().enabled` `:130,156-158`.
- Dependencies (constructor, plain class like the coordinator): `Logger`, `CompactionCoordinator`
  (claim/getState), `CompactionConfigProvider`, `SessionTurnStateRegistry`, optional
  `CompactionCallbackRegistry`, optional `SdkAdapterEvents`, optional `IWorkspaceProvider`,
  `IdleCompactSender` (lazy, see component 9), `IdleCompactionTiming`. Direction: agent-sdk
  internal only, no host imports.
- Integration points: producers in component 8; facade lookup for the notice; router reaches the
  coordinator, not the service.
- Failure behaviour: per-group `catchError` isolates one session; a producer call after dispose
  is ignored; send failure → WARN, no retry in that idle period (AC 2.9); missing optional
  collaborators degrade to "no live settings cancel / no PreCompact signal" with fire-time checks
  still applied.
- Quality requirements: work per signal O(1); at most one timer (due or deadline) per session; zero groups, aliases, notices and scheduler actions after every session is released.
- Verification seam: `idle-compaction.service.spec.ts` on a `VirtualTimeScheduler` (step with
  `maxFrames` + `flush`, read `scheduler.actions.length`) and a mutable wall clock: arm→fire→send
  with `require-idle`, coordinator origin and claim (AC 1.1, 2.1, 2.3, 2.4); busy at send (2.2);
  AC 2.7 both cases with a real `CompactionCoordinator` (manual via `admitManualCompact` →
  `coalesced`, one `/compact`, one notice; after release → `send`); manual admitted (reserved)
  before the idle `beforeEnqueue` → idle `fire-skipped manual-compact-reserved`, nothing pushed,
  no idle notice, and the inverse (claim first, then `admitManualCompact` → `coalesced`, idle
  notice) (R1); boundary → `result` → manual `/compact` → PostCompact on virtual time: manual
  coalesced, claim released only at PostCompact, one compaction, one idle notice (R2);
  PostCompact-before-boundary, PostCompact without boundary, boundary without PostCompact
  (`postcompact-timeout` after `IDLE_POSTCOMPACT_GRACE_MS`) (R4); round 2 (D10), with a real
  coordinator on an acting record (`e2Passed: true`) and on an OBSERVE_ONLY record: PostCompact
  first (claim released, coordinator still TRIGGERED) → manual `admitManualCompact` → `send`
  with a reservation, no virtual time advanced (not deferred to boundary or dwell) → old-run
  boundary → that boundary carries the idle notice, the relaunch's `session-bound` and the
  manual compaction's boundary carry none; PostCompact with no boundary ever → manual → `send`
  immediately, and after the grace the attempt closes with no notice and no WARN; `attempt-due`, `input` and a
  feedback signal in the same virtual frame in both orders → at most one `sendIdleCompact` call,
  and none when input wins (R3); `sendIdleCompact` held on an unresolved promise, session
  released, promise then resolves running `beforeEnqueue` → veto, no claim on the coordinator,
  no group recreated, `scheduler.actions.length === 0` (R3); late `fire-sent`/`deadline-elapsed`
  for a released key → no new group; claim timeout (2.6); BACKOFF/failed send (2.9); sleep/wake
  `lapsed` (3.3); cancellations 4.1-4.7; dispose; 1 000 sessions armed and released → zero
  actions, zero retained entries (NFR). If the file grows past ~500 lines,
  split the AC 2.7 and NFR cases into `idle-compaction.service.coalesce.spec.ts`.
- Files: CREATE `...\idle\idle-compaction.service.ts`, CREATE `...\idle\idle-compaction.service.spec.ts`,
  CREATE `...\idle\index.ts` (internal barrel).

### 8. Signal wiring in the session layer

8a. `CompactionSessionTap` (executor)
- Responsibilities: accept `idle: IdleCompactionSignals | null` (new last constructor parameter of
  `SessionQueryExecutor` and of the tap); own one `MainRequestTracker`; in `bind` call
  `sessionBound(id, runToken, codexProxy)`; in `handle` for main-loop frames feed the tracker and
  call `requestStarted` on a new request, `rateLimit` on `rate_limit_event`, `compactBoundary`
  after the coordinator guard; in `onTurnEnd` compute `turnId` before the `!port || !query` early
  return, call `turnEnded(sessionId, turnId, tracker.endTurn(now))`, and in the read `.then` call
  `turnContext(currentId, turnId, reading?.totalTokens ?? null)` before the existing early return;
  in `release` call `sessionReleased(id)` for every released id. All idle calls go through the
  tap's `guard`-style try/catch.
- Verified: `session-query-executor.service.ts:186-210,235-276,359-390,414-450,465-468,615-627`.
- Files: MODIFY `...\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts`;
  MODIFY `...\session-lifecycle\session-query-executor.service.spec.ts` (or CREATE
  `session-query-executor.idle-signals.spec.ts` to keep the spec focused).

8b. `SessionStreamPump.sendMessage`
- Responsibilities: new option `beforeEnqueue?: () => void`, honoured only with
  `admission: 'require-idle'`, called after the second `assertAdmissible` and before
  `markActive`/push (`:241-247`); if it throws, nothing is queued and the error propagates.
- Files: MODIFY `...\session-lifecycle\session-stream-pump.service.ts`; MODIFY
  `...\session-lifecycle\session-stream-pump.service.spec.ts`.

8c. `SessionLifecycleManager` facade
- Responsibilities: inject `SDK_TOKENS.SDK_IDLE_COMPACTION` `{ isOptional: true }` typed as
  `IdleCompactionSignals & { dispose(): void; boundaryNoticeFor(id): IdleBoundaryNotice |
  undefined }`; pass it to `SessionQueryExecutor`; `sendMessage` calls `idle.input(realId)` (via
  `_registry.find(...)?.realSessionId ?? sessionId`) before delegating; `setSessionModel` calls
  `promptPrefixChanged(realId)`; new `sendIdleCompact(sessionId, beforeEnqueue)` →
  `_streamPump.sendMessage(sessionId, '/compact', undefined, undefined, { origin:
  IDLE_COMPACT_ORIGIN, admission: 'require-idle', beforeEnqueue })` without the input signal; new
  `idleCompactionNoticeFor(sessionId)` delegate; `dispose()` also disposes the service.
- Verified: `session-lifecycle-manager.ts:405-454,475-479,702-719,793`.
- Files: MODIFY `...\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`; CREATE
  `...\helpers\session-lifecycle-manager.idle.spec.ts`. The file is already 814 lines (above the
  700 warn); additions are thin delegates only.

8d. `CompactionHookHandler`
- Responsibilities: optional `@inject(SDK_TOKENS.SDK_IDLE_COMPACTION)` and add
  `['idle-compaction', this.idleCompaction]` to the `rekeySessionState` targets. PostCompact
  (D10): call `coordinator.onPostCompact(postFallbackSessionId, postPayloadSessionId ??
  postFallbackSessionId)` whenever `postFallbackSessionId` is set, so a payload without
  `session_id` still marks the open record finished; `rekeySessionState` keeps today's
  both-ids condition.
- Verified: `compaction-hook-handler.ts:131-162,169-190,518-540`.
- Files: MODIFY `...\agent-sdk\src\lib\helpers\compaction-hook-handler.ts`; MODIFY
  `...\helpers\compaction-hook-handler.spec.ts`.

- Failure behaviour (all of 8): an idle call that throws is logged once at WARN and never breaks
  the stream, the send or the hook (existing fail-open rule, `session-query-executor.service.ts:225-233`).
- Verification seam: the four specs above; `npx nx test agent-sdk --parallel=1`.

### 9. DI registration and public surface

- Responsibilities:
  - Token `SDK_IDLE_COMPACTION: Symbol.for('SdkIdleCompaction')` with a doc comment.
  - `register.ts`: `container.register(SDK_TOKENS.SDK_IDLE_COMPACTION, { useFactory:
    instanceCachingFactory(c => new IdleCompactionService(...)) })` after the coordinator
    registration; resolve optional collaborators with `c.isRegistered(token, true)` (pattern
    `register.ts:461-473`); the sender is a lazy closure resolving
    `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER` at call time (pattern `register.ts:824-843`) to break
    the manager ↔ service cycle; timing = `{ scheduler: createUnrefScheduler(), now: () =>
    Date.now() }`.
  - `index.ts`: export `type ManualCompactDecision` and `type ManualCompactAdmission =
    Pick<CompactionCoordinator, 'requestManualCompact' | 'admitManualCompact' |
    'releaseManualReservation'>` for the router; nothing else public.
- Verified: `di/tokens.ts:69-84,200`; `register.ts:150,461-494,648-651,824-843`;
  `agent-sdk/src/index.ts:141-151,227-231`.
- Phased-DI guard specs: no composition-root change (all hosts call `registerSdkServices`).
  `expected-resolvable.ts` (VS Code, Electron, CLI): no change (handler classes only).
  `rpc-surface.spec.ts`: no change (no RPC method). `surface-composition.spec.ts`: no change (no
  surface). `container.smoke.spec.ts` (VS Code, Electron, CLI): add one assertion that
  `SDK_TOKENS.SDK_IDLE_COMPACTION` resolves to one instance after `registerSdkServices` in the
  existing child-container setups (`apps/ptah-cli/src/di/container.smoke.spec.ts:347-353` shape).
- Failure behaviour: a host without `PLATFORM_TOKENS.WORKSPACE_PROVIDER` or
  `SDK_ADAPTER_EVENTS` still constructs the service (degraded, logged once at DEBUG).
- Verification seam: the three smoke specs; `npx nx test ptah-cli --parallel=1`,
  `npx nx test ptah-electron --parallel=1`, `npx nx test ptah-extension-vscode --parallel=1`
  (one at a time).
- Files: MODIFY `...\agent-sdk\src\lib\di\tokens.ts`, MODIFY `...\agent-sdk\src\lib\di\register.ts`,
  MODIFY `...\agent-sdk\src\index.ts`, MODIFY
  `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\apps\ptah-cli\src\di\container.smoke.spec.ts`,
  MODIFY `...\apps\ptah-electron\src\di\container.smoke.spec.ts`, MODIFY
  `...\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts`.

### 10. Settings

- Responsibilities:
  - `ADVANCED_SETTINGS`: two descriptors in group `context-budgets` (D5): boolean
    `compaction.idleCompactionEnabled` (label "Compact idle chats", help "Before a long chat's prompt
    cache expires, Ptah compacts it so your next message costs less.", default true, `live`) and
    number `compaction.idleCompactionMinTokens` (label "Compact idle chats from", unit tokens,
    integer, min 100 000, max 5 000 000, default 200 000, `live`). UI, `settings:set` validation and
    defaults follow automatically (AC 5.1, 5.2).
  - `FILE_BASED_SETTINGS_KEYS`: add both keys next to the compaction budgets (write allow-list).
  - `KNOWN_CONFIG_KEYS`: add both keys after the compaction budget keys (AC 5.5).
  - `CompactionConfigProvider.getIdleCompactionConfig(): { enabled: boolean; minTokens: number }`:
    unset → defaults from `FILE_BASED_SETTINGS_DEFAULTS`; a non-boolean enabled → default true; a
    min that is not an integer ≥ 100 000 → default 200 000, never clamped; one WARN per distinct
    bad value through the existing `warnOnce` (AC 5.3). Read at arm and fire, so changes apply
    without restart (AC 5.4).
- Verified: `advanced-settings.types.ts:56-72,123-213,478-511`; `file-settings-keys.ts:176-178,186-225,734,792`;
  `settings-rpc.handlers.ts:166-210`; `settings-export.types.ts:52-63`;
  `compaction-config-provider.ts:35-55,107-112,186-207`; `advanced-settings-group.component.ts:282`.
- Failure behaviour: malformed persisted values never throw; defaults apply.
- Verification seam: `compaction-config-provider.spec.ts` (new cases); the existing shared
  advanced-settings spec and platform-core file-settings spec (new key assertions); settings
  export spec (keys present).
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\shared\src\lib\types\advanced-settings.types.ts`;
  MODIFY `...\libs\backend\platform-core\src\file-settings-keys.ts`; MODIFY
  `...\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts`; MODIFY
  `...\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts` and its spec; MODIFY the
  matching existing specs (`advanced-settings.types.spec.ts`, `file-settings-keys.spec.ts` —
  Assumption on exact names: locate with `ptah_search_files` `**/advanced-settings*.spec.ts`,
  `**/file-settings-keys*.spec.ts`).

### 11. Manual `/compact` admission (router)

- Purpose: coalesce a user `/compact` into a held idle claim (AC 2.5, 2.7), order it against the
  idle claim (R1, D9) and honour coordinator dedupe (D6).
- Responsibilities: in the `new-query` branch, when `interceptResult.commandName === 'compact'`
  and the optional `SDK_TOKENS.SDK_COMPACTION_COORDINATOR` (typed `ManualCompactAdmission`) is
  present:
  - Fast path: `requestManualCompact(sessionId)` before any provider resolution; `coalesced` or
    `deduped` → INFO log `{ sessionId, decision }` and return `{ success: true, sessionId }`.
  - Authoritative admission: after `resolveProviderProfileForWorkspace` resolves (the last
    await, `:131-135`) and with no await before the `executeSlashCommand` call, call
    `admitManualCompact(sessionId)`. `coalesced`/`deduped` → same INFO log and success return,
    no relaunch (an idle claim taken during the router's awaits). `send` → existing path, with
    `releaseManualReservation(sessionId, reservationId)` in a `finally` around
    `executeSlashCommand`. While reserved, any idle `beforeEnqueue` is refused, which covers the
    old run's teardown (`endSession` aborts only after its awaited interrupt). After release the
    old run is gone and the relaunched query's `session-bound` (new `runToken`) has already
    dropped any Pending attempt; the record's unregister/reset also drops the reservation.
- Verified: `chat-slash-command-router.service.ts:43-61,114-162` (awaits at `:122-124,131-135`);
  `sdk-agent-adapter.ts:1602-1650` (no await before `executeSlashCommandQuery`);
  `session-lifecycle-manager.ts:730-748`; `chat-session.service.ts:983-1009` (live sessions reach
  the router without an end).
- Dependencies: agent-sdk public types (component 9). Direction rpc-handlers → agent-sdk, already
  present.
- Failure behaviour: a throwing coordinator call is logged and treated as `send` (today's
  behaviour).
- Verification seam: CREATE `chat-slash-command-router.idle-coalesce.spec.ts`: claim held →
  `executeSlashCommand` not called and success returned; no claim → called once; claim taken
  while `resolveProviderProfileForWorkspace` is pending (deferred promise) → `admitManualCompact`
  answers `coalesced`, `executeSlashCommand` not called; `send` path → reservation released after
  `executeSlashCommand` resolves and after it rejects; D10 with a real coordinator: record
  TRIGGERED and PostCompact reported (claim released) → fast path and `admitManualCompact` both
  `send`, `executeSlashCommand` called once; record TRIGGERED without PostCompact → `deduped`,
  not called.
- Assumption A5: the webview tab settles on the idle `/compact` turn's own `result` when a
  coalesced `chat:continue` returns success without a stream. Check in the tester's live run.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`;
  CREATE `...\rpc-handlers\src\lib\chat\session\chat-slash-command-router.idle-coalesce.spec.ts`.

### 12. Idle compaction notice

- Purpose: the chat marker reads `Compacted while idle to save usage before the prompt cache
  expired (was <N> tokens).` for a compaction matched to an idle attempt, and only then (AC 6.1-6.4).
- Responsibilities:
  - Shared contract: `CompactionCompleteEvent.idleCompaction?: { readonly preTokens: number }`
    (`stream.ts:288-300`).
  - Backend stamp: `SystemMessageTransformer.transformCompactBoundary` sets the field from
    `helpers.sessionLifecycle.idleCompactionNoticeFor?.(sdkMessage.session_id ?? resolvedSessionId)`
    (optional call: transformer specs use partial lifecycle fakes).
  - Frontend pass-through of the one field: accumulator result → streaming-handler result types and
    forwarding → `chat.store` → `CompactionLifecycleService.handleCompactionComplete` →
    `ConversationRegistry.setCompactionMarkerTokens` (new `idleCompaction` on
    `CompactionMarkerRecord`, persisted, validated in `readPersisted` as finite ≥ 0, dropped when a
    new boundary has none) → `chat-view` binds `[idleCompaction]` → `CompactionMarkerComponent`
    renders the idle sentence (tokens via its `format`) in place of "Context compacted" when set.
  - No manual label anywhere (AC 6.2): the marker keeps no trigger text; a spec pins it.
- Verified: see Codebase evidence (frontend marker chain row) and `system-message.transformer.ts:35-123`.
- Failure behaviour: no notice data → the existing generic marker (never a wrong idle text).
- Quality requirements: OnPush unchanged; no new timers or listeners; text is plain, no ARIA change
  beyond the existing chip.
- Verification seam: `system-message.transformer` spec (stamp only when lookup returns a notice);
  `accumulator-core` spec; `conversation-registry` spec (persist/read/clear); `compaction-lifecycle`
  spec (field forwarded); `compaction-marker.component.spec.ts` (idle sentence with formatted N,
  generic text otherwise, never "manual").
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\shared\src\lib\types\execution\stream.ts`;
  MODIFY `...\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.ts` (+ spec);
  MODIFY `...\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts` (+ spec);
  MODIFY `...\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts`;
  MODIFY `...\libs\frontend\chat\src\lib\services\chat.store.ts`;
  MODIFY `...\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.ts` (+ spec);
  MODIFY `...\libs\frontend\chat-state\src\lib\conversation-registry.service.ts` (+ spec);
  MODIFY `...\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`;
  MODIFY `...\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-marker.component.ts` (+ spec).

### 13. RxJS runtime dependency

- Responsibilities: add `"rxjs": "7.8.2"` to `libs/backend/agent-sdk/package.json` dependencies and
  to `apps/ptah-cli/package.json` dependencies (alphabetical, between `reflect-metadata` and
  `sqlite-vec`), in the same batch as the first `rxjs` import (component 6 or 7). Electron
  (`apps/ptah-electron/package.json:47`) and VS Code bundling stay unchanged (AC 7.1).
- Failure behaviour: without it `nx lint agent-sdk` fails (`@nx/dependency-checks`) and an
  npm-installed ptah-cli fails on `require('rxjs')`.
- Verification seam: `npx nx lint agent-sdk`; `npx nx lint ptah-cli` (one at a time).
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\package.json`,
  MODIFY `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\apps\ptah-cli\package.json`.

## Integration architecture

- Data flow:
  1. Main-loop frames → `CompactionSessionTap.observe` → `MainRequestTracker` → `requestStarted`
     (once per request), `rateLimit`, `compactBoundary`; `result` → `turnEnded(turnId,
     lastRequest)`; port read → `turnContext(turnId, tokens)`.
  2. Facade `sendMessage` → `input`; `setSessionModel` → `promptPrefixChanged`; PreCompact hook →
     callback registry → `pre-compact`; PostCompact → rekey target (`rekey`) then adapter bus →
     `post-compact`; tap release → `session-released`; settings change → `settings-changed`.
  3. Service: alias index → group per session → reducer → arm timer (unref'd scheduler) → at due,
     fire gate → `sendIdleCompact` → pump `require-idle` → `beforeEnqueue` claims the coordinator →
     push → CLI runs `/compact` → PreCompact → boundary (notice map set; transformer stamps
     `compaction_complete`) and PostCompact in either order → claim released at PostCompact (or
     failure/timeout), idle period closed.
  4. Manual `/compact`: router fast path `requestManualCompact`, then after the last await
     `admitManualCompact` → `coalesced` (claim held, no relaunch) or `send` with a reservation
     that refuses any idle claim until the relaunch has replaced the run. After the matched
     PostCompact the answer is `send` even if the coordinator has not yet seen the boundary (D10).
- State or persistence: per-session reducer state lives in the RxJS group and ends with it; the
  alias index and notice map are owned by the service and emptied on release and dispose; the
  claim lives on the coordinator record. Persisted: the marker's `idleCompaction` in the existing
  localStorage marker record; settings in `~/.ptah/settings.json`.
- External boundaries: settings values are validated at the provider (component 10) and at
  `settings:set` by descriptor; SDK usage/rate-limit fields are read defensively (finite-number
  guards, literal-union checks); no new RPC input.
- Failure and rollback: refusal at any step sends nothing; a claim is released on the first of
  the matched PostCompact, turn end with neither boundary nor PostCompact (failure), claim/dwell/
  post-compact-grace deadline, session release, dispose (never by boundary or `result` alone);
  a manual reservation is released by the router's `finally`, unregister, reset or dispose; no retry within an idle period; one group's error never stops others.
- Observability: INFO per fire-time skip (reason code), INFO per send and coalesced manual, WARN for
  `send-failed`/`claim-timeout`/`dwell-timeout`/`postcompact-timeout`/`compaction-failed`, DEBUG
  per no-arm reason, DEBUG with the observed completion order (boundary-first/PostCompact-first)
  for the A3 probe; all with session id and attempt id, never content.

## Architecture-level quality requirements

- Functional: every AC of Requirements 1-7 maps to a spec named in the Team-leader handoff table.
- Performance: one subject, O(1) per signal; timers ≤ 1 per session and 0 for an idle-ineligible
  session; no interval or polling; settings broadcast O(live sessions) only on a settings change.
- Security: no secrets or message text in logs; settings writes stay behind the descriptor
  validation and file-key allow-list.
- Maintainability: no `vscode`/`electron` import in agent-sdk; only public `rxjs` and workspace
  barrels; new files < 500 lines each; coordinator state machine unchanged; producers hold no idle
  logic beyond a call.
- Testability: virtual time for every timer path; pure reducer, gate and tracker tested without
  RxJS; the 1 000-session leak test is mandatory.

## Team-leader handoff

- Recommended executors: backend-developer for components 1-11 and 13 (agent-sdk, rpc-handlers,
  shared/platform-core settings, package.json); frontend-developer for the frontend part of
  component 12; senior-tester for the service spec suite (AC 2.7, 3.3, NFR) and the live probes A1-A5;
  code-logic review by a different model family than the implementer (`context.md` CLI lanes).
- Complexity: HIGH — concurrency across async signals, a cross-library admission rule and a
  frontend chain, although each unit is small.
- Dependencies and ordering:
  - Component 2 before 3, 4, 5, 7; component 6 and 13 together (first `rxjs` import).
  - Component 1 before 7 (claim API) and 11.
  - Components 3-6 before 7; 7 before 8 and 9; 8b before the service's send path is exercised
    end to end.
  - Component 10 is independent of 2-9 except `getIdleCompactionConfig` must exist before 7 is
    wired (7 can use a fake in its spec).
  - Component 12 shared field and backend stamp after 8c (`idleCompactionNoticeFor`); frontend
    part after the shared field only.
  - Live probes A2/A3 before accepting the batch that turns on the send path; an A2 failure
    (CLI treats `/compact` as prompt text) stops the rollout and is escalated, not worked around.
- Parallel-safe work: {1}, {2→3,4,5}, {6+13}, {10}, {12 frontend after shared field}, {11 after 1}
  touch disjoint files. 8a-8d and 9 touch four different agent-sdk files plus register/tokens/index
  and can be one batch.
- Files affected:
  - CREATE: `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/` → `idle-compaction.types.ts`,
    `idle-request-tracker.ts` (+spec), `idle-session.reducer.ts` (+spec), `idle-fire-gate.ts`
    (+spec), `unref-scheduler.ts` (+spec), `idle-compaction.service.ts` (+spec, optional
    `.coalesce.spec.ts`), `index.ts`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.idle.spec.ts`;
    `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.idle-coalesce.spec.ts`.
  - MODIFY (agent-sdk): `helpers/compaction/compaction-coordinator.ts` (+spec),
    `helpers/compaction/compaction-state.types.ts`, `helpers/session-lifecycle/session-query-executor.service.ts`
    (+spec), `helpers/session-lifecycle/session-stream-pump.service.ts` (+spec),
    `helpers/session-lifecycle-manager.ts`, `helpers/compaction-hook-handler.ts` (+spec),
    `helpers/compaction-config-provider.ts` (+spec), `message-transform/system-message.transformer.ts`
    (+spec), `types/settings-export.types.ts`, `di/tokens.ts`, `di/register.ts`, `src/index.ts`,
    `package.json`.
  - MODIFY (other): `libs/shared/src/lib/types/advanced-settings.types.ts` (+spec),
    `libs/shared/src/lib/types/execution/stream.ts`, `libs/backend/platform-core/src/file-settings-keys.ts`
    (+spec), `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`,
    `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts` (+spec),
    `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`,
    `libs/frontend/chat/src/lib/services/chat.store.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts` (+spec),
    `libs/frontend/chat-state/src/lib/conversation-registry.service.ts` (+spec),
    `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`,
    `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts` (+spec),
    `apps/ptah-cli/package.json`, `apps/ptah-cli/src/di/container.smoke.spec.ts`,
    `apps/ptah-electron/src/di/container.smoke.spec.ts`,
    `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`.
  - REWRITE: none.
- AC → test map:

| AC | Spec |
| --- | --- |
| 1.1, 1.2 | `idle-request-tracker.spec.ts`, `idle-session.reducer.spec.ts`, service spec |
| 1.3, 1.4, 1.5 | `idle-session.reducer.spec.ts` (stalled read, interleaved sessions), service spec |
| 2.1, 2.3 | `session-lifecycle-manager.idle.spec.ts` (origin, require-idle, no relaunch), service spec |
| 2.2 | service spec (pump refusal), `session-stream-pump.service.spec.ts` (beforeEnqueue veto) |
| 2.4, 2.5, 2.7 | `compaction-coordinator.spec.ts` (claim vs reservation order), service spec with real coordinator (manual before/after claim, boundary→result→manual→PostCompact, both completion orders, PostCompact-first + manual in the gap and PostCompact without boundary + manual → `send`), router coalesce spec (incl. D10 `send` after PostCompact) (claim during router awaits) |
| 2.6 | service spec (claim-timeout, dwell-timeout, release list) |
| 2.8, 2.9 | `idle-session.reducer.spec.ts`, service spec |
| 3.1-3.9 | `idle-fire-gate.spec.ts`; 3.3 sleep/wake in service spec |
| 4.1-4.7 | reducer spec + service spec (settings-changed, release, dispose, rekey via hook-handler spec) |
| 5.1-5.5 | advanced-settings spec, file-settings-keys spec, config-provider spec, settings-export spec |
| 6.1-6.4 | transformer spec, accumulator/registry/lifecycle specs, marker component spec |
| 7.1-7.2 | lint of agent-sdk and ptah-cli; package.json diff review |
| NFR leak/perf | service spec, 1 000 sessions on virtual time |

- Verification points:
  - Re-open before coding: `compaction-coordinator.ts:230-253,295-322`, `session-stream-pump.service.ts:241-247`,
    `session-query-executor.service.ts:431-450`, `compaction-hook-handler.ts:169-190,518-540`,
    `stream-transformer.ts:541` vs `:1027`, `register.ts:476-494,824-843`.
  - Resolve assumptions: A1-A5 (live probe by senior-tester; A2/A3 gate the send-path batch), the
    `isStreamEvent`/`isMessageStart` import site, the rxjs public type exports, the settings spec
    file names.
  - D1 is final (decision 9): `idle-fire-gate.ts` refuses Codex proxy only; no `canAct` guard on
    `claimIdle`. AC 3.7 is checked as amended by decision 9.
  - Router: no `await` between `admitManualCompact` and the `executeSlashCommand` call
    (`chat-slash-command-router.service.ts:131-137`).
  - Commands, one at a time, only for changed projects (repo `CLAUDE.md`):
    `npx nx test agent-sdk --parallel=1`, `npx nx typecheck agent-sdk`, `npx nx lint agent-sdk`;
    `npx nx test rpc-handlers --parallel=1`; `npx nx test shared --parallel=1`;
    `npx nx test platform-core --parallel=1`; `npx nx test chat --parallel=1`,
    `npx nx test chat-state --parallel=1`, `npx nx test chat-streaming --parallel=1`,
    `npx nx test chat-ui --parallel=1`; `npx nx test ptah-cli --parallel=1`,
    `npx nx test ptah-electron --parallel=1`, `npx nx test ptah-extension-vscode --parallel=1`;
    `npx nx lint ptah-cli`. For several projects in one go use
    `npx nx run-many -t test -p <A> <B> --parallel=1` and confirm the header count. No build,
    serve, e2e or package targets.

## Review Response

Round 1 (`implementation-plan-review.md`, codex, REVISE). Each finding was re-checked against
source before acceptance.

| # | Finding | Verdict | Evidence re-checked | What changed |
| --- | --- | --- | --- | --- |
| R1 | Serious: manual admission passes before the idle claim and executes after it | Accepted | Router awaits at `chat-slash-command-router.service.ts:122-124,131-135` sit between interception and `executeSlashCommand`; `endSession` aborts only after an awaited interrupt (`session-control.service.ts:245-275`), and the pump's `assertAdmissible` does not see a teardown in progress (`session-stream-pump.service.ts:266-285`) | Component 1 adds `admitManualCompact` (reserves on `send`), `releaseManualReservation`, and a refusal literal from `claimIdle`; component 11 makes the authoritative check after the last await with no await before `executeSlashCommand` and releases in `finally`; new skip reason `manual-compact-reserved`; D9; tests for both orders and notice attribution (components 1, 7, 11) |
| R2 | Serious: claim released at boundary + turn end, before PostCompact | Accepted | Requirement 2.5/2.6 (`task-description.md:186-197`) holds the claim to PostCompact or failure; boundary/`result` are stream frames (`session-query-executor.service.ts:247-267`), PostCompact is a separate hook (`compaction-hook-handler.ts:518-565`) | Component 4: `turn-ended` after a boundary moves to `boundary-ended` and keeps the claim; release only on matched `post-compact`, failure, or the new bounded `IDLE_POSTCOMPACT_GRACE_MS` (30 s, WARN `postcompact-timeout`, D2); integration failure list corrected; virtual-clock test boundary → result → manual → PostCompact (component 7) |
| R3 | Serious: RxJS due/feedback trigger can miss or repeat a fire | Accepted | Plan rev 1 derived `fire$` from state alone and used a separate `fire-started` signal; the pump awaits `createUserMessage` before its final check (`session-stream-pump.service.ts:234-247`) | Reducer output is `IdleStep {signal, state, effects}`; `attempt-due` transitions Pending → `sending` and emits the single `fire` effect in one reduction (`fire-started` removed; `claimId` minted there); one `timer` spec in state recomputed on every reduction drives one `switchMap`; all signals pass a trampolined FIFO `enqueue` (no re-entrancy); `beforeEnqueue` liveness check covers a pending send promise across release; same-frame and pending-promise tests (component 7) |
| R4 | Moderate: completion and notice identity depend on unverified hook ordering | Accepted | No source orders the PostCompact hook against `compact_boundary` (`compaction-hook-handler.ts:529-565` vs `session-query-executor.service.ts:247-257`) | Component 4 "Completion orders" defines boundary-first, PostCompact-first and PostCompact-without-boundary, with which event sets the notice and when the claim clears; notice keyed by the boundary frame's `session_id` so rekey order cannot misplace it; A3 narrowed to boundary-before-result with the order logged; tests in reducer and service specs |
| — | Decision 9 makes D1 final | Applied | `decisions.md` row 9 | D1 marked final; the AC 3.7 clarification removed from Inputs; option-B branches removed from components 1 and 5 and from the handoff; AC 3.7 is amended per decision 9 |
| — | Coverage note: A2 failure must stop rollout | Applied | review "Silent failure" | Handoff ordering states that an A2 failure stops the rollout and is escalated |

Round 2 (`implementation-plan-review.md` § Round 2, REVISE: R1-R4 resolved, one new Serious).

| # | Finding | Verdict | Evidence re-checked | What changed |
| --- | --- | --- | --- | --- |
| N1 | Serious: PostCompact-first releases the idle claim while the coordinator stays TRIGGERED/COMPACTING, so a manual `/compact` in that gap is `deduped` (success, never sent) until the boundary or the 300 s dwell | Accepted | `onPostCompact` only rebinds and returns early on equal ids (`compaction-coordinator.ts:230-241`); `requestManualCompact` dedupes on any open state (`:247-253`); `onTurnEnd` accepts only COOLDOWN/BACKOFF (`:211-223`); only the dwell timer leaves an open state without a boundary (`:278-287`, `COMPACTION_MAX_DWELL_MS = 300_000` at `compaction-state.types.ts:43`); the hook calls the coordinator only when both ids exist (`compaction-hook-handler.ts:529-540`). Reachable only for acting records (OBSERVE_ONLY never opens, `:111-121`), none today, but the plan must still meet AC 2.6 (`task-description.md:193-197`) | D10: the coordinator marks an open record `postCompactSeen` on PostCompact and dedupes only open records without it, so the manual command after PostCompact is admitted and relaunched normally (manual notice). The claim is still released at PostCompact (AC 2.6). Rejected: holding the claim until the coordinator leaves the open state, which turns the drop into a coalesce of up to 300 s. Hook passes the fallback id when the payload has none (8d). Reducer bounds `postcompacted` by the grace deadline and closes it on a new run's `session-bound` or `pre-compact`, so the manual compaction never takes the idle notice. Tests in the coordinator, reducer, service (PostCompact-first + manual in the gap; PostCompact without boundary + manual) and router specs; AC map updated |
