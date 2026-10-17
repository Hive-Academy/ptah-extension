# Requirements - TASK_2026_692_f748

Revision: 3 (addresses `task-description-review.md` rounds 1 and 2; see `## Review Response`)

## Context

Claude Code CLI 2.1.299+ compacts a large conversation while it sits idle, shortly before its
1-hour prompt cache expires, so the next user message starts from a small summary instead of
re-reading the whole context uncached. The bundled CLI only arms this for interactive and
allowlisted entrypoints (`sdk-ts` is not one), behind a server flag that defaults off, and SDK
0.3.302 only adds an `idleCompaction` off switch (see `context.md`, `decisions.md` #2-#3). Ptah
sessions therefore never get it. The user asked for an equivalent built in Ptah: a performant,
multi-session aware handler in `libs/backend/agent-sdk`, using RxJS if possible.

What exists today:

- Compaction state per session is owned by `CompactionCoordinator`
  (`libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts:1-32`), a pure
  state machine (IDLE/ARMED/TRIGGERED/COMPACTING/COOLDOWN/BACKOFF) that dedupes manual
  `/compact`, sends nothing itself, and holds one unref'd timer per session (`:51-60`).
  PreCompact/PostCompact hooks feed it (`compaction-hook-handler.ts:344-410`, `:507-562`);
  PostCompact reports only a `manual` or `auto` trigger (`:507-516`, `:559-562`), so a
  Ptah-sent `/compact` is indistinguishable from a user's by trigger alone. The coordinator
  enters TRIGGERED only on PreCompact (`compaction-coordinator.ts:166-179`) and
  `requestManualCompact` dedupes only in TRIGGERED/COMPACTING (`:243-252`), so between a
  `/compact` enqueue and its PreCompact a second manual `/compact` is admitted today.
- Two routes put `/compact` into a session today. The user slash-command route
  `executeSlashCommandQuery` ends the session and starts a resumed query
  (`session-lifecycle-manager.ts:721-748`). `sendMessage` pushes onto the live persistent input
  stream (`session-lifecycle/session-stream-pump.service.ts:198-250`), takes an explicit
  `origin` so the message does not render as the user's words, and with
  `admission: 'require-idle'` re-checks idleness synchronously right before the enqueue
  (`:229-247`). A streamed slash command executes on the persistent stream
  (`slash-command-interceptor.ts:11-19`, TASK_2026_472 experiment).
- Per-turn context size comes from `ContextUsagePort` (`compaction/context-usage.port.ts`). The
  turn-end read is asynchronous and fire-and-forget (`session-query-executor.service.ts:431-450`),
  may take up to 5 s (`context-usage.port.ts:32-33`), and on failure `getLast` still returns the
  previous successful reading (`:15-20`). A reading carries token totals, maximum and source only
  — no TTL and no request timestamp (`:41-47`). The cache-write TTL split
  (`cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`) is parsed only for
  subagents and only describes cache *writes*; a cache-read-only response does not say which TTL
  the read entry has (`compaction/subagent-budget-monitor.ts:210-236`).
- Turn end is observed in `SessionLifecycleManager.onTurnTerminal`
  (`session-lifecycle-manager.ts:460-466`); messages enter a live session through
  `sendMessage` (`:702-718`); sessions end via `endSession` / `disposeAllSessions`
  (`:620-649`); idle records without a live query are evicted after 30 min by the registry sweep
  (`session-lifecycle/session-registry.service.ts:182-183`, `:593-612`) with an
  `onSessionEvicted` subscription (`session-lifecycle-manager.ts:471`). A session with a live
  query is never evicted (`session-registry.service.ts:596`).
- Compaction settings are read by `CompactionConfigProvider`
  (`compaction-config-provider.ts:130`, `compaction.enabled`; budgets `:50-55`) and rendered from
  the `ADVANCED_SETTINGS` registry, group `context-budgets`, which supports `number` and
  `boolean` kinds (`libs/shared/src/lib/types/advanced-settings.types.ts:56-66`, `:124-176`);
  file-based keys are listed in `libs/backend/platform-core/src/file-settings-keys.ts:220-225`.
- Rate-limit state per session arrives as mapped `rate_limit_event`s
  (`plan-limits/claude-rate-limit.mapper.ts:35`, `:225`).

Finding — prompt cache TTL (gates whether this works at all): Ptah never sets the main
conversation's `promptCacheTtl` or `CLAUDE_CODE_PROMPT_CACHE_TTL`; it only sets the subagent TTL
(`sdk-query-options-builder.ts:1182-1192`, setting `agentOrchestration.subagentPromptCacheTtl`).
Per the installed SDK typings (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:8536`), an
unset main TTL is 1 hour on a Claude subscription within its usage limits and 5 minutes on an API
key, Bedrock, Vertex or Foundry. So the feature can work today for subscription sessions; for
API-key and third-party-provider sessions the cache is 5 min and idle compaction must stay
inactive. The TTL must be taken from observed usage of the last main-thread request, not assumed.

Finding — RxJS: `rxjs` 7.8.2 is a root dependency (`package.json:197`), already listed as
`external` in the agent-sdk build (`libs/backend/agent-sdk/project.json:21`), packaged by Electron
(`apps/ptah-electron/package.json:47`) and bundled by the VS Code extension (`thirdParty: true`).
No backend runtime code imports it yet. `apps/ptah-cli` lists `rxjs` as external
(`apps/ptah-cli/project.json:59`) but does NOT declare it in `apps/ptah-cli/package.json`
dependencies, and `libs/backend/agent-sdk/package.json` does not declare it either. RxJS is usable
from agent-sdk only if those declarations are fixed (see Requirement 7).

## Classification

- Type: FEATURE — a new background capability, plus one setting group and one chat notice.
- Estimate: M — one new handler wired to existing lifecycle, usage, coordinator and settings
  signals, plus a notice path to the chat; no SDK upgrade and no new UI surface.
- Priority: not defined here.

## Scope

In scope:

- An idle compaction handler in `libs/backend/agent-sdk` covering every live Claude Agent SDK
  main session in the process at once.
- Arming at main-thread turn end, firing shortly before the 1-hour prompt cache expires, and
  sending a `/compact` into the session's live persistent input stream (not the relaunching
  slash-command route).
- Refusal conditions that mirror the CLI (listed in Requirement 3).
- Cancellation on new input, turn start, manual/auto compaction, session end, eviction, setting
  change and dispose.
- An on/off setting and a minimum-context-size setting in the existing advanced
  `context-budgets` settings group, applied live.
- A chat notice that tells the user the session was compacted while idle.
- Declaring `rxjs` where the runtime resolves it (agent-sdk package, ptah-cli package) if the
  handler uses it.
- Unit tests with a controllable clock/scheduler.

Out of scope:

- `compact_on_return` mode (precompute the summary while idle, swap it in on return) — the SDK
  has no API to stage a summary and apply it later; would need a separate task once an SDK
  surface exists.
- Upgrading `@anthropic-ai/claude-agent-sdk` 0.3.278 to 0.3.302 — the new `idleCompaction` key is
  an off switch only and changes nothing here; separate dependency task.
- Spoofing `CLAUDE_CODE_ENTRYPOINT` to unlock the CLI's own idle compaction — rejected
  (`decisions.md` #3).
- Changing the main-thread prompt cache TTL (e.g. forcing 1h for API-key users) — a billing
  decision with its own trade-off; separate task if wanted.
- Subagents, workflows, CLI lanes (Codex, Copilot, Gemini, etc.) and Codex-proxy sessions — they
  have their own TTL/budget handling (`subagent-budget-monitor.ts`) or no Anthropic cache.
- Exposing the fire fraction (0.9) or the lateness window (60 s) as settings — CLI constants, no
  user request.
- New UI beyond the two settings and the notice.

## Requirements

### 1. Arming and timer math

Requirement: the idle compaction handler — after each completed main-thread turn of an eligible
session — schedules one compaction attempt shortly before the prompt cache expires — so the next
user message does not pay for an uncached full context.

Definitions used below:

- *Last request*: the last main-thread API request of the turn that just ended, identified by
  that turn — never a reading or usage carried over from an earlier turn or an earlier query.
- *TTL class* of the last request, from its own usage block:
  - `1h`: a confirmed 1-hour cache write — `cache_creation.ephemeral_1h_input_tokens > 0` and
    `ephemeral_5m_input_tokens` 0 or absent.
  - `not-1h`: anything else — a read-only request (cache read, no write), any 5-minute write
    (including mixed 1h + 5m), no `cache_creation` split, no usage block, or no cache activity.
    Cache-read counts carry no TTL, so an earlier request's write never makes the last request
    `1h` (`decisions.md` #7).
- *Anchor*: a timestamp for the last request that is no later than the moment that request was
  sent to the API and no earlier than the start of the turn. Response-receipt time does not
  qualify. `expiresAt = anchor + 3 600 000 ms`.

Acceptance criteria:

1. When a main-thread turn ends, its last request is class `1h`, and a context reading for that
   same turn exists, the system shall schedule exactly one attempt at
   `anchor + 0.9 × 3 600 000 ms` (3 240 000 ms after the anchor). When the last request is
   read-only, even after an earlier `1h` write in the same query, the system shall not arm.
2. When the last request took longer than the response-receipt view suggests (test: request
   sent at t=0, response received at t=7 min), the scheduled fire time shall be at most
   3 240 000 ms after t=0, not after t=7 min.
3. When a session already has a pending attempt and another turn ends, the system shall replace
   it, so at most one attempt per session is pending at any time.
4. When the last request is class `not-1h`, or the context read for that turn failed, timed out
   or returned no counts (even though an earlier reading exists), or the computed fire time is
   not after the arm time, the system shall not schedule an attempt and shall log one DEBUG
   line naming the reason.
5. When a turn-end result arrives for a turn that is no longer the session's latest (test: turn
   A ends, its context read stalls, turn B starts, A's read then resolves), the system shall
   create no attempt from A and keep no TTL, anchor or context value from A; only B's own turn
   end may arm. This holds per session with many sessions interleaved.

### 2. Firing

Requirement: the handler — when an attempt is due and no refusal applies — sends `/compact`
into that session's live persistent input stream — so the compaction runs on the warm cache
without relaunching the query.

Acceptance criteria:

1. When an attempt fires and no condition in Requirement 3 applies, the system shall deliver one
   `/compact` onto the session's live persistent input stream, admitted only if the session is
   still live and idle at the moment of enqueue (the existing `require-idle` admission or an
   equivalent check with no await between check and enqueue), and shall not end, abort or
   relaunch the SDK query. `executeSlashCommandQuery` shall not be used.
2. When the admission is refused at enqueue (session became busy or ended), the system shall
   send nothing, log one INFO line with reason code `not-idle-at-send`, and treat the attempt
   as skipped.
3. When the `/compact` is sent, it shall carry a non-human origin so it never renders as a
   message typed by the user.
4. Attempt identity and pending-idle claim: each admitted send shall open one idle-attempt
   identity for that session and, at the same enqueue, place a pending-idle claim on the
   session's compaction coordinator. The identity shall be matched to exactly one compaction —
   the next PreCompact, boundary and PostCompact of that session (following a session-id
   rebind). A compaction that started before the send, or a second compaction after the
   matched one, shall not match. The existing coordinator dedupe does not cover the interval
   from enqueue to PreCompact (Context); the claim is what covers it.
5. While a pending-idle claim is held, manual-compact admission for that session shall treat
   the session as TRIGGERED: a user manual `/compact` arriving at any point from the idle
   enqueue until PostCompact or failure shall be coalesced into the idle compaction — exactly
   one compaction runs, the manual `/compact` is not sent as a second command and does not end
   or relaunch the query, and exactly one compaction notice appears, the idle notice of AC 6.1.
   When a user manual `/compact` or an automatic compaction is already running at fire time,
   the system shall not send (Requirement 3.7).
6. The pending-idle claim and the attempt identity shall be released on the first of: the
   matched PostCompact, compaction failure or BACKOFF, session end, abort or eviction, handler
   dispose, or a claim timeout. The architect states the timeout value in the plan; when it
   elapses with no PreCompact, the system shall log one WARN line with reason code
   `claim-timeout`, release the claim, and a later manual `/compact` shall be admitted normally.
7. Test (required): on a virtual clock — idle `/compact` enqueued, then a user manual
   `/compact` submitted before PreCompact, then PreCompact and PostCompact — the test shall
   assert exactly one `/compact` delivered to the stream, exactly one compaction, exactly one
   notice and that notice is the idle notice, and that a manual `/compact` after the release
   is admitted and shows the existing manual notice. A second case shall cover the manual
   `/compact` arriving between PreCompact and PostCompact with the same assertions.
8. When the matched compaction completes (PostCompact / `compact_boundary`), the system shall
   not arm a new attempt for that idle period.
9. When sending fails or the coordinator reports the compaction went to BACKOFF, the system shall
   log one WARN line with the session id and reason, shall not retry in that idle period, and
   shall arm normally after the next turn end.

### 3. Refusal conditions (mirror the CLI)

Requirement: the handler re-checks eligibility at fire time and skips the attempt when compacting
would not save usage or would be unsafe.

Acceptance criteria — at fire time the system shall skip the attempt, log one INFO line with the
reason code, and send nothing, when any of the following holds:

1. Idle compaction is turned off by its setting, or automatic compaction is off
   (`compaction.enabled` is false).
2. The TTL class recorded for the arming turn's last request is `not-1h` (Requirement 1).
3. The timer fired more than 60 000 ms after its scheduled time, or wall-clock `now ≥ expiresAt`
   ("lapsed"). Test on a virtual clock: arm, advance wall time past `expiresAt` without the
   timer running (sleep/wake), then let it run — no send, reason `lapsed`.
4. The context reading of the arming turn is below the configured minimum (default 200 000
   tokens), or the arming turn has no reading of its own.
5. A turn started, a message was sent, or a request was made on the session after the attempt was
   armed.
6. The session's prompt prefix changed since the last turn: at least a model change
   (`setSessionModel`) or a session relaunch under the same id.
7. The coordinator's state for the session is TRIGGERED, COMPACTING, COOLDOWN or BACKOFF, or the
   session is one the coordinator may not act on (Codex proxy, OBSERVE_ONLY, or not E2-passed).
8. The session's latest Claude rate-limit status is `allowed_warning` or `rejected`.
9. The session is not idle by `SessionTurnStateRegistry`, or a background subagent of the session
   is still running.

### 4. Cancellation and lifetime

Requirement: a pending attempt never outlives the condition it was armed for.

Acceptance criteria — the system shall cancel the pending attempt of a session (no send, timer
cleared, per-session state released where noted) when:

1. A user or host message is sent to the session, or a new turn starts — including the case
   where the earlier turn's turn-end data is still in flight, which shall then never arm
   (Requirement 1.5).
2. A manual `/compact` or an automatic compaction starts (PreCompact) for the session.
3. The session ends, is aborted, or is disposed (state released).
4. The session record is evicted by the registry sweep (state released).
5. Idle compaction is turned off in settings (all sessions' attempts cancelled within the same
   settings-change handling, without a restart).
6. The handler is disposed (all attempts cancelled, all state released; later calls are no-ops).
7. When a session's id is rebound (PostCompact reports a new `session_id`), the system shall keep
   at most one pending attempt, keyed to the new id.

### 5. Settings

Requirement: as a Ptah user, I want to turn idle compaction off and choose how large a session
must be before it is compacted while idle, so that I control when background usage is spent.

Acceptance criteria:

1. When the user opens the advanced settings, the `context-budgets` group shall show an on/off
   setting for idle compaction (default on) and a minimum context size setting (unit tokens,
   integer, default 200 000, minimum 100 000).
2. When a user enters a minimum below 100 000 or a non-integer in the advanced settings UI, the
   UI shall reject it with the existing advanced-settings validation, shall not persist it, and
   the last valid value shall stay in effect.
3. When a persisted value is malformed (below 100 000, non-integer, non-number — e.g. from a
   direct file edit or an import), the handler shall treat it as unset and use the default
   200 000, never clamp it, and log one WARN line once per distinct bad value — the same rule
   `CompactionConfigProvider` applies to `compaction.threshold`
   (`compaction-config-provider.ts:114-140`). A malformed on/off value shall be treated as
   unset (default on).
4. When either setting changes, the next arm or fire shall use the new value without a restart.
5. When the settings are exported/imported, both keys shall be included like the existing
   `compaction.*` budget keys (`settings-export.types.ts:59-63`).

### 6. Chat notice

Requirement: as a Ptah user, when my session was compacted while I was away, I want the chat to
say so, so that a smaller context on return is not a surprise.

Acceptance criteria:

1. When a compaction matched to an idle-attempt identity (Requirement 2.4) completes, and only
   then, the chat of that session shall show a notice with the text
   `Compacted while idle to save usage before the prompt cache expired (was <N> tokens).`, where
   `<N>` is the pre-compaction context size formatted the way existing compaction notices format
   token counts.
2. When the chat shows the compaction, it shall not label it as a user-requested (manual)
   compaction.
3. When an attempt is skipped or cancelled, the system shall show no chat notice.
4. When a user manual `/compact` or an automatic compaction completes with no matching
   idle-attempt identity (one that ran before the idle enqueue or after the claim was
   released), the chat shall show its existing notice unchanged and no idle notice. A manual
   `/compact` coalesced under AC 2.5 adds no notice of its own.

### 7. Runtime dependency (RxJS)

Requirement: if the handler uses RxJS, every host that loads agent-sdk resolves it at runtime.

Acceptance criteria:

1. When the handler imports `rxjs`, `libs/backend/agent-sdk/package.json` and
   `apps/ptah-cli/package.json` shall list `rxjs` with the root version (7.8.2), and the Electron
   and VS Code builds shall keep their current rxjs handling.
2. When no RxJS import is added, these files shall stay unchanged.

## Non-functional requirements

- Performance / multi-session: pending timers equal at most the number of eligible idle sessions;
  no interval or per-tick polling; work per turn end is O(1) per session. Checkable by a test
  that arms and ends 1 000 sessions on a virtual clock and asserts zero pending timers and zero
  retained per-session entries afterwards.
- Process lifetime: every timer the handler creates is unref'd (as `compaction-coordinator.ts:51-60`
  does), so it never keeps a host process alive.
- Testability: time and scheduling are injectable so tests run on a virtual clock without real
  waits.
- Logging: only through the injected `Logger`; never logs message or transcript text.
- Code: strict TypeScript (`libs/backend/agent-sdk/tsconfig.json:7`), no `any`; each non-spec file
  under the repository `max-lines` ceiling of 700 (`eslint.config.mjs:558-561`).
- Compatibility: VS Code extension, Electron app and ptah-cli keep starting; sessions on API key
  or third-party providers behave exactly as before (no attempt armed).

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Subscription user with long sessions | Lower usage when returning after a break | Returning after ~1 h costs a small context, and a notice explains why |
| API-key / third-party provider user | No behaviour change, no extra spend | No idle compactions or notices appear |
| agent-sdk maintainers | One bounded handler that does not fight the coordinator | Coordinator dedupe still holds and the pending-idle claim closes the enqueue-to-PreCompact gap; no leaked timers or claims in tests |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Idle `/compact` races a user message sent at fire time and compacts mid-reply | MEDIUM | HIGH | `require-idle`-style admission at enqueue (AC 2.1-2.2); tester adds a race test (user send at the fire tick) |
| Compaction spends usage on a session the user never returns to | MEDIUM | LOW | Min-tokens gate and off switch; open question below on closed tabs |
| ptah-cli crashes on `require('rxjs')` when installed from npm | HIGH if RxJS is used | HIGH | Requirement 7; team-leader verifies both package.json entries in the batch that adds the import |
| TTL misread arms on a 5 m cache (read-only, mixed or missing split) | LOW | MEDIUM | TTL classes in Requirement 1; tester covers read-only after 1h write (no arm), read-only with no prior write, mixed 1h+5m, zero-write and missing `cache_creation` |
| Confirmed-write-only rule leaves some warm turns unarmed (a turn whose last request is read-only) | LOW | LOW | Accepted trade-off (`decisions.md` #7): no arm is the safe failure, and a normal turn's last request writes new tokens; architect reports in the plan which observed signal carries the per-request split for main-thread messages |
| Idle and manual `/compact` both run, or the wrong notice shows, when a manual `/compact` lands between idle enqueue and PostCompact | MEDIUM | MEDIUM | Pending-idle claim (AC 2.4-2.6); tester writes the AC 2.7 enqueue → manual → PreCompact/PostCompact test |
| A claim that never sees PreCompact blocks manual `/compact` | LOW | MEDIUM | Claim timeout and release list (AC 2.6); tester covers the `claim-timeout` path |
| Stale turn-end read arms after the user resumed | MEDIUM | MEDIUM | AC 1.5; tester adds the stalled-read test across two interleaved sessions |

## Open questions

- Should a session whose chat tab is closed but whose SDK query is still live be compacted? —
  architect, from how tab close maps to `endSession`.
- Exact pre-token source for the notice when the live usage tracker has no figure (resumed
  session) — architect, using `live-usage-tracker.ts` resume baseline.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `compact_on_return` out of scope | in / out | No SDK API to stage a summary for later | yes |
| SDK upgrade separate | bundle / separate | 0.3.302 adds only an off switch (`context.md`) | yes |
| Setting default on | on / off | `decisions.md` #6 (closes the revision-1 clarification); CLI default on; user: "crucial for saving usage" | yes |
| Send route: live persistent stream, not `executeSlashCommandQuery` | stream / relaunch | Relaunch ends the session (`session-lifecycle-manager.ts:721-748`); streamed commands run (TASK_2026_472) | yes |
| Expiry anchored at request send, not response receipt | send / receipt | Cache entry is written when the request is processed; receipt can be minutes later | yes |
| Fire fraction 0.9, lateness 60 s, floor 100K fixed | constants / settings | CLI constants (`context.md`); no request to tune | yes |
| Notice text as in AC 6.1 | — | No CLI text recorded; wording follows existing compaction notices | yes |
| Arm only on a confirmed 1h write; no `1h-inherited` class | confirmed write / inherit from earlier write | `decisions.md` #7; read counts carry no TTL (`subagent-budget-monitor.ts:222-235`) | yes |
| Pending-idle claim at enqueue; manual `/compact` coalesced into the idle compaction | claim + coalesce / rely on existing dedupe | `decisions.md` #8; dedupe starts only at PreCompact (`compaction-coordinator.ts:166-179, 243-252`) | yes |

## Handoff

- Next specialist: software-architect
- Why: the requirements are settled; the open question is the shape — how one handler joins
  turn-end, usage, coordinator, settings and session-end signals per session (RxJS or not),
  where the per-request TTL split and anchor time are observed for main-thread requests, how
  turn generations and attempt identity are carried, and how the notice reaches the chat.

## Review Response

Round 1 (`task-description-review.md`), each finding checked against the cited code:

1. Accepted. `ContextUsageReading` has no TTL or timestamp (`context-usage.port.ts:41-47`), the
   split only covers writes (`subagent-budget-monitor.ts:222-235`), and `getLast` keeps the prior
   reading after a failure (`:15-20`). Requirement 1 now defines TTL classes (read-only,
   mixed, zero-write), ties data to the arming turn, and the narrowing is listed as a risk.
2. Accepted. `executeSlashCommandQuery` ends and relaunches
   (`session-lifecycle-manager.ts:721-748`); PostCompact has only `manual`/`auto`
   (`compaction-hook-handler.ts:507-516`). AC 2.1-2.5 name the live-stream route with enqueue-time admission and an attempt identity; AC 6.1/6.4
   use it.
3. Accepted. The turn-end read is async (`session-query-executor.service.ts:431-450`) and can
   take 5 s. AC 1.5 and 4.1 add the stale-turn rule and the stalled-read test.
4. Accepted. Expiry is now anchored no later than request send (Requirement 1 definitions,
   AC 1.2) and AC 3.3 adds the sleep/wake virtual-clock case.
5. Accepted. AC 5.2 (UI rejects, last valid stays) and AC 5.3 (persisted malformed = unset,
   default, no clamp) mirror `compaction-config-provider.ts:114-140`.
6. Accepted. The clarification is removed; `decisions.md` #6 is cited in Decisions.

Round 2 (`task-description-review.md` § Round 2), resolved per the orchestrator's decisions:

1. Finding 1 accepted (`decisions.md` #7). `1h-inherited` is removed. Only a last request with a
   confirmed 1-hour write (`ephemeral_1h_input_tokens > 0`, no 5-minute write) is `1h`; a
   read-only or mixed last request is `not-1h` and does not arm (Requirement 1 definitions,
   AC 1.1). The accepted-risk row and the TTL test list are updated.
2. Findings 2 and 7 accepted (`decisions.md` #8). The false claim that existing coordinator
   dedupe covers enqueue → PreCompact is removed (old AC 2.5) and the gap is stated in Context.
   AC 2.4-2.6 now require a pending-idle claim at enqueue that manual-compact admission treats
   as TRIGGERED, coalescing a manual `/compact` into the idle compaction (one compaction, one
   idle notice), with release on PostCompact, failure, session end/eviction, dispose or a
   timeout. AC 2.7 adds the required enqueue → manual → PreCompact/PostCompact test; AC 6.4
   is aligned. The mechanism stays with the architect. Former AC 2.6-2.7 are now 2.8-2.9.
