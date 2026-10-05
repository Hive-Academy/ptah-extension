Revision: 3

# Requirements - TASK_2026_596_0a19

## Context

Ptah runs a main agent (Claude Agent SDK, natively or with an upstream provider behind a
translation proxy) and background CLI lanes (Claude, Codex, Antigravity, OpenCode, and ptah-cli
agents such as Glm on Ollama Cloud). Each vendor meters use differently. Most have a rolling or
fixed 5-hour window and a weekly window. Claude also has per-model weekly windows
(`seven_day_opus`, `seven_day_sonnet`) and overage. OpenCode Go meters dollars across 5-hour,
weekly and monthly windows. Ollama reports percentages. The vendors do not share one window model.
The spec therefore treats a window as provider-declared, not as a fixed pair. Today the user
cannot see how much of any window is used or when it resets, except for Codex on the dashboard.
The spawn workflow cannot tell that a lane is exhausted until a run fails or times out.

What exists:

- `provider:getAccountUsage` returns `status` plus `quota.primary` / `quota.secondary`
  (`usedPercent`, `windowDurationMins`, `resetsAt`). The status union is `available`,
  `unsupported-auth`, `unsupported-config`, `provider-unsupported`, `cli-unavailable`,
  `cli-version-unsupported`, `service-unavailable` and `stale`
  (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts:154-191`). The result has no source field
  and no semantic window kind.
- The handler returns `provider-unsupported` for every provider except Codex
  (`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:155-170`). The Codex
  reader caches for 30 s, binds to its resolved `CODEX_HOME`, accepts ChatGPT auth only, and
  returns stale cache on read failure (`codex-account-usage.service.ts:96-134,138-203`).
- The dashboard card prints "Primary used: N%" and "Secondary used: N%", with no reset time and no
  window name
  (`libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:21-36`).
- The Claude SDK `rate_limit_event` has a type guard
  (`libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:400`). The event carries
  `status`, `resetsAt`, `rateLimitType` and `utilization`. Nothing in the repository consumes it
  (research-report.md, Evidence).
- `providerQuotaStore` is an in-memory **retry cooldown**. A translation proxy writes it on an
  upstream 429, and `ProviderAuthResolver` gates internal queries with it (curator, commit message,
  skill-synthesis lanes). When retry-after is absent it substitutes 15 minutes, clamps the value to
  between 1 second and 6 hours, and keeps the later deadline. It records no provenance
  (`libs/backend/auth-providers/src/lib/auth/provider-quota.store.ts:52-119,172`;
  `provider-auth-resolver.ts:105-150`). It is not a plan-window reset.
- CLI lane failures end as `failed` or `timeout`, with no limit classification
  (`libs/shared/src/lib/types/agent-process.types.ts:443-475`). `summarizeCliSdkError`
  recognises only Codex's "usage limit ... try again at <clock time>" wording
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:20-55`).
- `ptah_agent_list` shows the columns Agent, Type, Status and Capabilities. The `ptah_agent_spawn`
  result shows the id, CLI, tier and status
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1734-1830`).
- The per-session stats grid (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`)
  shows context, tokens, cost and per-model usage. It shows no plan limits and no lanes.
  TASK_2026_575 left CLI lane cost out of scope. TASK_2026_513 owns an existing leak of lane usage
  into the session tile header.
- The only existing durable per-run record of a lane is `CliSessionReference`, stored in
  `ptah.sessionMetadata[parent].cliSessions`
  (`libs/shared/src/lib/types/agent-process.types.ts:375-401`). It is written by
  `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:398-442` when the lane spawns and
  again when it exits. It holds the `cli`, `agentId`, `task`, `startedAt`, final `status`, and
  optional output, plus `ptahCliId` / `sdkSessionId` for ptah-cli lanes. It holds no model, token
  or cost field.

The user wants one predictable way to know, for the main agent and each lane, how much of each
window is used and when it resets. It must be shown clearly in the stats grid, on the dashboard,
and in `ptah_agent_list` / `ptah_agent_spawn`. Per-lane tokens, cost and model also go in the stats
grid, kept apart from the main session totals. Already done in this task: the stats label "Main
context" is now "Context" (`session-stats-summary.component.ts:86,243`, spec updated).

## Classification

- Type: FEATURE. This adds a new capability across backend data capture, MCP tool output and two
  UI surfaces.
- Estimate: XL. The size comes from five providers with different (partly undocumented) sources, a
  shared contract change, main-agent and lane evidence capture, quota identity and precedence
  rules, three consumer surfaces, and lane usage capture.
- Priority: not defined here.

## Decisions and proposals

User decisions (context.md "User Decisions"; binding):

- **D1 Lane stats scope.** Show the quota windows of each lane and per-lane tokens, cost and model
  in the stats grid. TASK_2026_535 keeps the full `lane_runs` ledger and model discovery.
- **D2 Spawn rule.** Warn and list alternatives; the spawn still runs. `ptah_agent_list` and the
  spawn result both show the window, the reset time and the lanes with room. Estimated data never
  blocks.
- **D3 Lanes for this task.** Use only codex lanes and Claude subagents. Antigravity, opencode and
  Glm are at their limits (context.md "CLI Lanes", update of 2026-10-03).

Proposals for Gate 1 / Gate 1.7. These are not user decisions. Each one has a default, and the
user confirms or changes it at the gate:

- **P1 `orchestrator-proposed`: fifth provenance value `provider-unofficial`.** It applies to data
  read from an undocumented provider endpoint (Antigravity `GetUserStatus`, Ollama `/api/usage`).
  It is distinct from `provider-api` (documented or vendor-typed) and from `estimated` (local
  computation). Undocumented provider data is not an estimate.
- **P2 `orchestrator-proposed`: a retry cooldown is separate from a plan-window reset.** The two
  need not agree. A cooldown is never shown as a plan reset (Req 3.6).
- **P3 `orchestrator-proposed`: near-limit threshold.** Default: a window counts as near its limit
  at **90 % used or more**. This is resolved at Gate 1.7, before implementation.
- **P4 `orchestrator-proposed`: collapsed-grid indicator.** Default: the collapsed stats grid shows
  a compact indicator whenever any applicable window is exhausted or near its limit from
  non-`estimated` evidence. This is resolved at Gate 1.7.
- **P5 `pm-proposed`: limit lookup deadline for agent tools.** Default: **3 seconds** per lookup.
  This is resolved at Gate 1.7 (Req 5.4).
- **P6 `pm-proposed`: exhaustion with a known reset survives a host restart.** Exhaustion with an
  unknown reset does not survive a restart (Req 3.8).
- **P7 `pm-proposed`: no reset notifications or alerts in this task.**
- **P8 `pm-proposed`: no OpenCode budget estimation from local lane cost in this task.** It needs
  per-run cost history, which TASK_2026_535 owns.
- **P9 `orchestrator-proposed`: freshness bound for confirmed room.** Default: a window's used value
  counts as fresh for **15 minutes** after its observation instant, and only if it was observed
  after the window's last reset. Older values are aged. Aged values still display, with their
  observation time, but cannot confirm room (Req 5). This is resolved at Gate 1.7.

## Scope

In scope:

- One shared, provider-neutral description of a plan-limit window. It covers the main agent's
  provider and each CLI lane: Claude, Codex, Antigravity, OpenCode, and ptah-cli lanes including
  Ollama Cloud / Glm.
- Provider-declared window kinds: 5-hour session, weekly, per-model weekly, monthly, overage.
- Provenance on every value: `provider-api`, `provider-unofficial` (P1), `stream-event`,
  `error-derived`, `estimated`.
- An explicit status for each provider that has no proactive data source.
- Capture of limit evidence from the main agent (native and proxied) and from CLI lanes.
- Exhausted-until state per window, with an expiry and a supersession rule.
- Quota ownership identity, and precedence between competing evidence.
- Display in four places: the per-session stats grid, the dashboard provider account card, the
  `ptah_agent_list` output, and the `ptah_agent_spawn` result.
- Per-lane tokens, cost and model in the stats grid of the spawning session, separate from the
  main session totals.
- Done: the "Main context" → "Context" rename.

Dependencies (not out of scope):

- Provider source selection is delegated to `research-report.md`. Implementing the chosen sources
  is in scope. Unverified payload shapes are risks (see Risks).

Out of scope:

- Settings page changes. A separate refactor PR is in flight (session
  `ptah-ptah-extension-settings-last-round-df90180000eo82pxnz8p901`). No settings-page file is
  edited in this task.
- The full `lane_runs` ledger, persisted lane outcome history, and lane model discovery in
  `ptah_agent_list` belong to TASK_2026_535. This task's limit classification is compatible with
  that task's `failure_kind: quota` (Req 3.3) but does not build the ledger.
- Lanes-first routing, ordered fallback and skill or orchestration changes belong to
  TASK_2026_441_7825. This task supplies the data and the warnings only.
- Blocking or auto-rerouting `ptah_agent_spawn` on quota data (D2).
- Fixing the existing session tile header attribution leak belongs to TASK_2026_513_a7c2. This
  task only guarantees that its own new capture path adds nothing to the main totals (Req 8.5).
- Changing the existing `ProviderAuthResolver` cooldown gate for internal queries (curator, commit
  message, skill synthesis). Its behaviour is unchanged.
- The agent picker. The request did not name it as a surface; see Clarifications Needed.
- Reset notifications (P7) and OpenCode local budget estimation (P8).

## Requirements

### 1. Plan-limit window data with per-field provenance

Requirement: the backend describes each provider, for the main agent or any lane, as zero or more
self-describing windows. Every consumer reads one shape.

Acceptance criteria:

1. When usage is requested for a quota owner (Req 4), the system shall return a list of windows.
   Each window has:
   - a kind: `five_hour`, `weekly`, `weekly_model` (with the model family named), `monthly`,
     `overage`, or another provider-declared kind with a human label;
   - a window duration when known;
   - a used value when known;
   - a reset instant when known;
   - an observation instant.
2. When the used value is known, it shall be a percent (0-100), or an absolute amount with its
   unit and limit (for example dollars spent of $12). It shall never be a bare number with no unit.
3. When reset and observation instants are returned, they shall be normalised to one unit
   (epoch milliseconds, UTC). A provider value in seconds and one in milliseconds for the same
   instant shall normalise to the same result (fixture required). An ISO-8601 value shall normalise
   to the same result as well.
4. When the used value and the reset come from different evidence, each field shall carry its own
   source. The source set is `provider-api`, `provider-unofficial`, `stream-event`,
   `error-derived` or `estimated`. For example, an API used percentage can sit beside an
   `estimated` reset (fixture required).
5. When the used value is not known, the window shall carry no used value (not `0`), and every
   surface shall render it as unknown, never as 0 %.
6. When the reset is not known, the window shall carry no reset, and every surface shall say the
   reset is unknown. A reset is never invented unless it is labelled `estimated`.
7. When a window's reset has passed and no newer observation exists, the system shall render the
   window as "reset, current usage unknown". It shall not show the old used value as current, and
   it shall not show a fresh 0 % or confirmed room (injected-clock test).

### 2. Per-provider data sources

Requirement: each provider gets the best available source, and the provenance label is honest
about that source.

Acceptance criteria:

1. When a native Claude main-agent session receives a `rate_limit_event`, the system shall record
   the window for its `rateLimitType`. The record carries the event's `utilization` and `resetsAt`
   with source `stream-event`. Windows the event did not mention stay as they were, or unknown. The
   event is change-driven and partial, so it never implies that other windows are clear.
2. When the Claude account supports the SDK's experimental usage query, the system shall fill the
   full Claude window table from it with source `provider-api`. The table covers 5-hour, 7-day,
   per-model and extra usage. When the query is unavailable, the system shall fall back to
   Req 2.1-only data. The query is unavailable for an API key, Bedrock or Vertex, when it returns
   null, or when no query is open. With API-key auth, the status shall say the account has no plan
   windows (`unsupported-auth`), not unknown usage.
3. When Codex is queried, windows shall come from the account usage source with `provider-api`.
   Each window's kind shall come from its `windowDurationMins`, not from its position as primary
   or secondary. For example, a 300-minute window is `five_hour` and a 10 080-minute window is
   `weekly`. When the duration is absent, the kind shall be unknown, labelled by position only.
4. For Codex lane stream evidence: the architect's handoff shall verify a real Codex lane event
   fixture captured through a codex lane (D3), such as the `token_count.rate_limits` snapshot. When
   the fixture verifies that quota fields exist, the system shall capture them with source
   `stream-event`. A fixture whose events carry token counts but no quota fields shall produce no
   window. Token telemetry is never turned into availability.
5. When Antigravity or Ollama Cloud usage is read from an undocumented endpoint (Antigravity
   `GetUserStatus`, Ollama `/api/usage`), the values shall carry source `provider-unofficial`
   (P1). If the payload has no reset field, the reset shall be unknown. A reset derived from
   assumed bucket boundaries shall be labelled `estimated`.
   - The payload shapes in `research-report.md` are third-party **provisional examples**, not
     verified fixtures.
   - When a payload does not match the shape the implementation validates, the provider shall
     return `service-unavailable`, or stale under Req 2.9. No window is built from a partial guess.
   - Collecting real fixtures is **pending**. Tests may use the provisional examples only if they
     label them as such. No test or developer shall fabricate provider evidence or force a 429
     against a live account to obtain one.
6. When OpenCode is queried, the system shall return the explicit "no proactive source" status
   (Req 2.8). The only plan-limit evidence for OpenCode is error-derived (Req 3).
7. When a source's response cannot be parsed, the system shall log a sanitised diagnostic: the
   provider, the field path and the reason, with no raw body and no credentials. That provider
   then returns its stale or failure status (Req 2.9), and other providers are unaffected.
8. When a provider has no proactive source, the result shall carry an explicit status that differs
   from `available`, `stale` and `service-unavailable`.
   - With no passive evidence from Req 3, the surfaces render "no usage source" alone.
   - With passive evidence, they render "no usage source", followed by that evidence as recorded,
     for example "· limit hit <time>, resets <time | unknown>".
   - Tests cover an OpenCode owner with no recorded limit and one with a recorded limit hit.
9. When any source fails, the system shall keep the existing distinctions: `unsupported-auth`,
   `unsupported-config`, `provider-unsupported`, `cli-unavailable`, `cli-version-unsupported`,
   `service-unavailable` and `stale`.
   - Cached windows are returned as `stale` with `staleSince` only when two conditions both hold:
     the quota owner (Req 4.1) is still eligible and unchanged, and the read failed transiently
     (timeout, process or network error, unparseable response).
   - An eligibility or configuration failure is returned with no cached windows attached. This
     covers `unsupported-auth`, `unsupported-config`, `cli-unavailable` and
     `cli-version-unsupported`.
   - On sign-out or account change, the old owner's cache shall not be returned for the new
     owner (Req 4.3).
   - Tests: a same-account transient failure with a cache (stale), a transient failure with no
     cache, unsupported auth, unsupported CLI version, cached account A then signed in as
     account B, and cached account A then sign-out.
10. When Codex usage is requested, the existing Codex fields shall still be returned: plan type,
    both windows, reset times, activity and stale state.

### 3. Limit evidence capture and exhausted-until state

Requirement: real limit evidence from the main agent and from lanes marks the affected windows
exhausted until their reset, so the next spawn knows before it runs.

Acceptance criteria:

1. When a native Claude main agent emits a `rate_limit_event` with status `rejected`, or an
   assistant error of kind `rate_limit`, the system shall record limit evidence with source
   `stream-event`. The event or error decides what is recorded:
   - When it names a window, that window is marked exhausted.
   - When it names no window (an assistant error), the evidence is kept at the owner level under
     Req 3.5. This covers the case where the SDK keeps retrying and the turn has not
   failed. The session grid and the agent tools shall show it without a manual refresh or restart.
2. When a main agent runs through a translation proxy and the upstream returns a 429 before any
   terminal failure, the system shall attribute the evidence to the upstream provider (for example
   Codex or Ollama Cloud), never to Claude. The evidence shall be visible in the session grid and
   the agent tools without a restart.
3. When a lane run ends because its CLI reported a usage or plan limit, the system shall classify
   the run as a quota failure. That class is distinct from `timeout` and generic `failed`, and its
   name maps one-to-one to TASK_2026_535's `failure_kind: quota`. One fixture per CLI wording is
   required:
   - Claude: "limit reached ∙ resets <clock time>";
   - Codex: "usage limit ... try again at <clock time>";
   - Antigravity: "RESOURCE_EXHAUSTED ... reset after <duration>";
   - OpenCode: "Free usage exceeded";
   - Ollama: a 429.
   The Antigravity, OpenCode and Ollama wordings come from secondary sources. Their fixtures are
   provisional examples until real output is collected (pending). A failure that matches no
   recognised wording stays `failed` (Req 3.9).
4. When a usage-limit message (not a bare HTTP header) states when the limit lifts, the system
   shall record that time as the limit's reset, with source `error-derived`. All instants are
   normalised to epoch milliseconds UTC.
   - A clock time with no date resolves to the next occurrence of that local time after the
     observation instant. The test covers a time across midnight.
   - A relative duration resolves to the observation instant plus the duration.
5. When limit evidence is recorded, the system shall keep each known fact independently. Fixtures
   are required for all four combinations:
   - Window known, reset known: that window is exhausted until the reset.
   - Window known, reset unknown: that window is exhausted, with "reset unknown".
   - Window unknown, reset known: owner-level "limit hit at <time>, window unknown, resets
     <time>". This is, for example, Codex's "try again at 5:05 PM". The known reset is kept.
   - Window unknown, reset unknown: owner-level "limit hit at <time>, window unknown, reset
     unknown".
   No reset is invented, and no specific window is marked exhausted unless the evidence names it.
   A generic 429 alone never establishes that a plan window is exhausted.
6. A `Retry-After` value, and any `providerQuotaStore` cooldown, is **cooldown evidence**. It is
   never a plan reset unless the same evidence names a plan window.
   - Surfaces may show an active cooldown as "retrying after <time> (cooldown)", separately from
     the plan windows.
   - `Retry-After` delta-seconds and `Retry-After` HTTP-date shall each be parsed and normalised to
     epoch milliseconds, and each has its own test.
   - A store fallback deadline (the 15-minute default, or a clamped value) shall never fill a
     window's reset.
   - Tests cover an absent and an invalid `Retry-After`.
   - A seven-day retry instruction stays a seven-day cooldown in the evidence, rather than being
     truncated to 6 hours in the display. It does not become a weekly plan reset (test).
   - Simultaneous five-hour and weekly windows with different resets are tracked independently
     (test).
7. When the recorded reset of an exhausted window passes, that window's exhaustion shall expire
   without user action. Other exhausted windows of the same owner stay exhausted until their own
   resets (injected-clock test).
8. When exhaustion has an unknown reset, it shall be cleared only in one of these cases:
   - Newer evidence applicable to the same allowance (Req 4.1) supersedes it. Examples are a
     provider read showing that window below its limit, or a successful run billed against that
     same window and model scope.
   - The provider's longest known window duration has elapsed since the observation. The window
     then becomes **unknown usage**, not confirmed room.
   - The host restarts (P6).
   A success on an unrelated model or window, on overage, or through a fallback provider shall not
   clear it (test). Exhaustion with a known reset survives a host restart until that reset (P6).
9. When a lane fails for any other reason (timeout, crash, auth, or Antigravity
   `MODEL_CAPACITY_EXHAUSTED`), the system shall not mark it exhausted.

### 4. Quota ownership and evidence precedence

Requirement: evidence is shared only between consumers that are known to draw on the same
allowance, and competing evidence resolves predictably.

Acceptance criteria:

1. When evidence is recorded, the system shall attach it at one of two levels:
   - **Quota owner**: the provider plus the account identity where it can be determined (for
     Codex, the resolved `CODEX_HOME` account). Evidence that names no window, such as owner-level
     limit hits (Req 3.5) and cooldowns, attaches here.
   - **Allowance**: the owner plus the window kind, plus the model scope for per-model windows.
     Evidence for a specific window attaches here.
2. When a main agent and a lane, or two lanes, resolve to the same owner, they shall show the same
   windows. When they cannot be shown to share an owner, for example because the lane's account is
   undeterminable, the lane shall show its limit state as unknown rather than borrow another
   owner's data. Fixtures are required for a shared account and for a different account.
3. When the account identity of an owner changes (sign-out, or a different account), evidence for
   the old identity shall not be shown for the new one.
4. When evidence competes for the same window, precedence shall follow these rules:
   - newer non-stale evidence supersedes older evidence;
   - `estimated` never supersedes non-estimated evidence that was observed after the window's last
     reset;
   - stale API data never clears a newer `stream-event` or `error-derived` exhaustion.
   A fixture exercises each rule.
5. When a model-specific window (for example `seven_day_opus`) is exhausted, only lanes and
   sessions using that model scope shall show it exhausted. Other models on the same account stay
   unaffected (fixture required).

### 5. `ptah_agent_list` and `ptah_agent_spawn` output

Requirement: the orchestrating agent sees limit state and the lanes with room both before and after
a spawn, and the spawn is never blocked (D2).

Definitions for this requirement. The four states are mutually exclusive, evaluated in this order:

- A lane is **at its limit** when any applicable window, or its owner, has active exhaustion from a
  non-`estimated` source.
- A lane is **near its limit** when it is not at its limit, and any applicable window has a fresh
  (P9) non-`estimated` used value at or above the near-limit threshold (P3).
- A lane has **confirmed room** when all of the following hold:
  1. Its applicable window set is established and non-empty. The set is established when it is
     declared by a full-table source for that owner (a `provider-api` or `provider-unofficial`
     read). A partial `stream-event` alone never establishes it.
  2. Every window in that set has a fresh (P9) non-`estimated` used value below P3.
  3. There is no active exhaustion or cooldown.
- Every other lane is **unknown**. That covers:
  - an unestablished or empty window set;
  - a window that is missing or aged;
  - a last reset that cannot be determined;
  - estimated-only evidence;
  - stale data;
  - a lookup that failed or timed out.

Fixtures cover:

- an empty window set (unknown);
- a single partial Claude event (unknown);
- an aged snapshot observed after the last reset (unknown);
- a fresh 95 % window with no exhaustion (near limit, with P3 at 90 %);
- a full fresh set below the threshold (confirmed room).

Acceptance criteria:

1. When `ptah_agent_list` runs, each lane row shall show its limit state. For each known window
   that is the kind, the used value or "unknown", the reset or "reset unknown", and the source.
   Otherwise it shows "exhausted until <time | unknown> (<source>)", "cooldown until <time>", or
   "no usage source".
2. When `ptah_agent_list` runs, the output shall include an alternatives section grouping the
   lanes into four lists: confirmed room, near limit, unknown and at limit. Each lane shows its
   reset where known. Unknown and near-limit lanes are never listed as having room.
3. When `ptah_agent_spawn` returns, every result shall carry the target lane's state and the
   alternatives section from Req 5.2, whatever the state of the target. The spawn shall still run.
   - When the target is at or near its limit, the result shall also carry a warning naming the
     window, the reset (or "reset unknown") and the source.
4. When the limit lookup for a lane takes longer than the lookup deadline (P5), or fails, the tool
   shall return the remaining rows, or the spawn result, with that lane marked unknown. Neither
   tool fails because of the lookup.
5. When the only evidence of a limit is `estimated`, the spawn result shall at most show an
   informational note labelled as an estimate. That note is never a warning.
6. When no lane has confirmed room, the output shall say "no lane has confirmed room". It shall
   still list the near-limit and unknown lanes and every known reset. It shall not say "no lane has
   room" unless every lane is at its limit.
7. When a spawn targets a lane whose provider has an active `providerQuotaStore` cooldown, or any
   exhaustion, or a failed lookup, the spawn shall still be attempted (one acceptance test per
   case). This task adds no pre-dispatch gate to `ptah_agent_spawn`.
8. When `ptah_agent_list` and `ptah_agent_spawn` are called, existing columns and fields shall
   remain, and `vendor-roster-drift.spec.ts` and `lane-rule-single-home.spec.ts` shall stay green.

### 6. Dashboard provider account card

Requirement: as a user on the dashboard, I want each provider's windows named, with their resets
and sources, so that I know what is left and when I can use it again.

Acceptance criteria:

1. When a provider has windows, the card shall show each window by name in place of "Primary" and
   "Secondary", for example "5-hour session", "Weekly", "Weekly · Opus" or "Monthly". Each window
   shows its used value or "unknown", in percent or amount with its unit, and its reset as both an
   absolute time and a relative one (for example "resets in 2h 10m"), or "reset unknown".
2. When values are shown, every value's source shall be shown as a text label. `estimated` and
   `provider-unofficial` values shall be visibly distinct from `provider-api` and `stream-event`
   values, by text and not by colour alone.
3. When a window is exhausted, the card shall show "Limit reached — resets <time | unknown>" with
   its source. An active cooldown shall be shown separately as a cooldown (Req 3.6).
4. When a provider has no proactive source, the card shall show the combined rendering from
   Req 2.8, never 0 % or an empty bar.
5. When a failure status from Req 2.9 applies, the card shall name that specific status. The
   existing stale notice shall remain.
6. The card shall be available for every provider in scope, not only Codex.

### 7. Per-session stats grid: plan limits

Requirement: as a user in a chat session, I want to see the plan limits of the session's provider
and of the lanes it spawned, so I can tell what is left.

Acceptance criteria:

1. When the session's quota owner has windows, the stats grid shall show them with the same naming,
   unknown handling, reset rendering and source labels as Req 6.1-6.3.
2. When the session's provider has no proactive source, the grid shall show the Req 2.8 rendering,
   not 0.
3. When new limit evidence arrives during the session (Req 3.1-3.2), the grid shall update without
   reload.
4. When the grid is collapsed, the indicator defined by P4 shall be shown, as resolved at
   Gate 1.7.
5. The "Context" label (already renamed) shall stay, and the existing stats-summary spec shall stay
   green.

### 8. Per-session stats grid: lane usage

Requirement: the spawning session shows each lane run's model, tokens, cost and limit state,
separate from the session's own totals (D1).

Acceptance criteria:

1. When a lane is spawned, its run shall belong to the session recorded as its parent at spawn
   time. The run appears only in that session's grid, even if the user switches to another session
   while it runs. The isolation case uses two sessions, each with its own lanes.
2. When a session has lane runs, the grid shall show one row per run with the following fields.
   The same CLI run twice gives two rows, plus a lane subtotal kept apart from the main totals.
   - the CLI or label;
   - the model, or "unknown";
   - the tokens, or "unknown";
   - the cost, or "unknown" when not reported or not priceable;
   - the run status;
   - the limit state (Req 7.1).
3. When a running lane reports usage, its row shall update without reload. When the run ends, the
   row shall keep its final figures for the life of the session view.
4. When a session is reopened after a reload or a host restart, the grid shall list every lane run
   recoverable from the existing durable source, the parent's `cliSessions` (`CliSessionReference`).
   - Each row shows what that source holds: the CLI or label, the start time and the final status.
   - The model, tokens and cost show as "unknown", never 0, unless they are recoverable from data
     that is already persisted.
   - Runs that the source cannot recover, for example a reference that never landed, are not
     reconstructed. That history belongs to TASK_2026_535.
   - No new persisted run ledger is introduced, and no field is added to `CliSessionReference`
     unless the architect shows that it is the minimal retained identity this criterion needs.
5. When lane usage is captured by this task's new path, it shall not be added to the session's
   context, token or cost totals, or to the session tile header. An existing leak through other
   paths is TASK_2026_513's to fix, and its tests are not part of this task's acceptance.

## Non-functional requirements

- Compatibility: the `provider:getAccountUsage` contract change shall keep the existing callers
  working, namely the dashboard state service and the Codex fields. Both the VS Code extension and
  the Electron app shall render the new surfaces.
- Security: credentials used to read usage shall never appear in RPC results, tool output or logs.
  This covers API keys, CSRF tokens taken from process arguments, and OAuth tokens. Parse failures
  log sanitised diagnostics only (Req 2.7).
- Accessibility: source, exhaustion and cooldown states shall be conveyed in text, not by colour
  alone.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| User running sessions and lanes | Usage and reset per window per provider | The stats grid and dashboard show named windows, resets and sources, with no fake 0 % |
| Orchestrating agent (main agent using `ptah_agent_*`) | Which lanes have confirmed room, before and after a spawn | The list and spawn output show the alternatives, and the spawn always runs |
| TASK_2026_441 / 535 owners | A reusable quota-failure class and exhaustion signal | The quota class maps to `failure_kind: quota`, and the exhaustion state can be read |
| Settings refactor PR owner | No conflicting edits | This branch touches no settings page file |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The Claude `rate_limit_event` is change-driven and partial, and its cadence is unverified | HIGH | MEDIUM | Req 2.1 never infers unmentioned windows. The architect makes the experimental usage query the full-table source (Req 2.2) |
| The Claude experimental usage query is marked "may change" and needs an open `Query` | MEDIUM | MEDIUM | The architect pins the SDK version and specifies the fallback to Req 2.1. The senior-tester covers the null/unavailable path |
| Antigravity `GetUserStatus` is undocumented. It relies on reading process arguments, scanning ports and self-signed HTTPS, and it changes when the language server updates | HIGH | MEDIUM | Isolate it so failure yields a Req 2.9 status. Label its data `provider-unofficial`. Treat the research shapes as provisional examples. A payload that cannot be validated yields `service-unavailable` (Req 2.5). The architect records fixture collection as pending. D3 forbids spawning the lane, but it does not settle whether a read-only local call is possible; the architect records that access as unestablished |
| Ollama `/api/usage` is undocumented, its reset fields are disputed, and its 429 body is unknown | HIGH | MEDIUM | Use `provider-unofficial`. Keep the reset unknown unless the payload has one. Use the conservative fallback of Req 2.5. Fixture collection is pending, and whether read-only credentials are available is unestablished (separate from D3's no-spawn rule). No 429 is forced |
| OpenCode has no programmatic source | HIGH | LOW | "No proactive source" status plus error-derived exhaustion only (Req 2.6). Estimation deferred (P8) |
| Limit texts differ per CLI (clock time, relative duration, none) and change between versions | HIGH | MEDIUM | The senior-tester pins one fixture per wording (Req 3.3). Unrecognised text stays `failed` (Req 3.9) |
| A clock-time-only reset ("resets 2am") resolves to the wrong day or time zone | MEDIUM | MEDIUM | The next-occurrence rule (Req 3.4), with an injected-clock test across midnight |
| The SDK retries internally and swallows limit signals, so a limit is visible only late or never | MEDIUM | HIGH | Req 3.1 / 3.2 capture events and proxy 429s before terminal failure. The architect maps which process (extension host, proxy, lane subprocess) can see each signal |
| Codex lane `token_count.rate_limits` field names are third-party only | MEDIUM | LOW | Req 2.4 needs a real fixture through a codex lane before capture. The no-quota-fields fixture prevents misreading telemetry |
| The account behind a lane cannot be determined, so data is wrongly shared | MEDIUM | HIGH | Req 4.2 defaults to unknown. Fixtures cover shared and different accounts |
| The new lane usage path adds to the main totals | MEDIUM | HIGH | Req 8.5 isolation test |
| Merge conflict with the settings refactor PR | LOW | MEDIUM | The team-leader checks the diff for settings paths before each commit |

## Open questions

- Should a weekly reset be shown as a fixed weekday or as a relative time? The UI shows the
  provider-reported instant, and the ui-ux-designer proposes the format at Gate 1.7.

## Clarifications Needed

1. Should the agent picker also show limit state? The request named the stats grid, the dashboard
   card and the agent tools, not the picker.
   - Not in this task; file a follow-up (Recommended)
   - Yes, add a compact limit indicator per lane in the picker
   (Non-blocking: work proceeds with the picker out of scope.)

## Handoff

- Next specialist: ui-ux-designer (Gate 1.7 proposals P3-P5 and P9, Reqs 6-8), then
  software-architect.
- Why: the provider facts are now researched. The remaining questions are the presentation of the
  proposals and the shape of the window, ownership and evidence model.

## Revision 2 changes

| Finding | Change |
| --- | --- |
| 1 (blocking) | Context now describes `providerQuotaStore` as a retry cooldown, and no longer claims the vendors share one window model. Old Req 3.5 ("agree") was removed. The new Req 3.6 separates cooldown from plan reset and adds the absent, invalid and seven-day retry-after tests plus the dual-window test. Req 3.5 says a generic 429 never establishes plan exhaustion. Added P2 |
| 2 (blocking) | New Req 3.1 covers native main-agent events and errors, including during SDK retries. New Req 3.2 covers proxied main-agent 429s, attributed to the upstream provider. Req 3.3 covers CLI lanes. Reqs 7.3 / 8.3 add live propagation. Added a risk for SDK-swallowed signals and process visibility |
| 3 (blocking) | New Req 4 covers the quota-owner key, sharing only on established identity, account change, precedence rules, and model-scoped windows, each with fixtures. Req 3.7 clears only the windows that reset |
| 4 | New Req 2.4 requires a verified Codex lane fixture, `stream-event` capture, and a no-quota-fields fixture. Added a risk |
| 5 (blocking) | Req 5 defines confirmed room, at limit and unknown. Req 5.2 adds alternatives to the list output. Req 5.4 adds the lookup deadline (P5). Req 5.6 wording becomes "no confirmed room". Req 5.7 adds spawn-still-attempted cases, including an active cooldown, and states that no gate is added |
| 6 | Req 2.8 separates "no proactive source" from passive evidence and defines their joint rendering. Tool and card text allow "reset unknown". Req 3.8 adds the unknown-reset lifecycle and restart behaviour (P6). Req 4.3 covers account change. Req 1.7 adds the injected-clock expiry rule |
| 7 | Req 1.2 adds the unit and limit. Req 1.3 adds normalised instants with a seconds-versus-milliseconds fixture. Req 1.4 adds per-field provenance with a mixed-evidence fixture. Req 6.2 / 7.1 require every source label |
| 8 | Req 8 adds parent-session attribution, one row per run plus a subtotal, live update and retention, reload behaviour, the two-session isolation case, and the TASK_2026_513 boundary (Req 8.5). Req 3.3 maps to `failure_kind: quota` |
| 9 | Req 2.9 preserves every existing status, with stale-cache, no-cache, auth and CLI-version tests. Req 2.10 keeps the Codex fields. Req 2.7 requires sanitised diagnostics. The security NFR was extended |
| 10 | Added the "Decisions and proposals" section, separating D1-D3 from P1-P8. The collapsed indicator and threshold became Gate 1.7 proposals with defaults (P3, P4). The picker clarification is kept without citing `task.md`. Endpoint selection was moved to Dependencies. No settings work was added |
| Research | Folded into Reqs 2.1-2.6 and 3.3-3.4 and the Risks table |
| D3 | User lane constraint recorded. Live checks of Antigravity and Ollama are marked blocked in Risks |

## Revision 3 changes

| Finding (review Revision 2) | Change |
| --- | --- |
| 1 PARTIAL (blocking) | Req 3.4 now covers only reset times stated in usage-limit messages. Req 3.6 makes `Retry-After` and store cooldowns cooldown evidence, never a plan reset unless a window is named. Delta-seconds and HTTP-date are parsed separately, normalised to epoch ms, and each has a test. The seven-day retry stays a cooldown and does not become a weekly reset |
| 3 PARTIAL | Req 4.1 separates the quota owner (account level, where unscoped evidence and cooldowns attach) from the allowance (owner + window + model). Req 3.8 clears exhaustion only through newer evidence for the same allowance. An unrelated model or window, overage, or a fallback success does not clear it, and longest-duration expiry yields unknown usage, not room |
| 5 PARTIAL (blocking) | Req 5.3 puts the target state and the alternatives on every spawn result. Confirmed room now needs an established, non-empty window set from a full-table source plus freshness (new P9, default 15 min). Unknown is defined explicitly. Added fixtures for an empty set, a partial event, an aged snapshot, a near-limit lane and confirmed room |
| 6 PARTIAL | Resolved via New findings 1-2 (Req 3.5 and Req 2.8). The P6 proposal is kept |
| 8 PARTIAL | Context names `CliSessionReference` in `cliSessions` (`agent-process.types.ts:375-401`, written at `agent-events.ts:398-442`). It holds the CLI, agent id, task, start time and status, but no model, tokens or cost. Req 8.4 limits restart reconstruction to runs that source can recover, shows the other figures as unknown, and leaves the remaining history to TASK_2026_535. No new ledger is added |
| 9 PARTIAL | Req 2.9 serves stale cache only for an eligible, unchanged owner after a transient failure. Eligibility and configuration failures carry no cached windows. Sign-out or account change never reuses the old cache. Added tests for account A to account B, for sign-out, and for a same-account transient failure |
| New 1 (blocking) | Req 3.5 keeps window and reset as independent facts, with fixtures for all four combinations. Req 3.1 records an error that names no window at the owner level |
| New 2 | Req 2.8 renders "no usage source" alone when there is no passive evidence. Tests cover an OpenCode owner with no recorded limit and one with a recorded limit hit |
| New 3 (blocking) | Same change as finding 9 (Req 2.9) |
| New 4 | Req 5 adds a distinct near-limit state, separate from unknown. It is listed in its own group in the list and spawn alternatives (Req 5.2, 5.6) and has a fixture of a fresh 95 % window |
| New 5 | Req 2.5 and Req 3.3 call the Antigravity, OpenCode and Ollama shapes and wordings provisional examples and state that fixture collection is pending. A payload that cannot be validated yields `service-unavailable`. No fabricated evidence and no forced 429. The Risks table separates D3's no-spawn rule from unestablished read-only access |
| Scope | No scope added. The only new proposal is P9 (freshness), which the reviewer's finding 5 requires |
