# Task description review

- **Author:** Claude project-manager subagent
- **Reviewer:** codex
- **Revision reviewed:** 1
- **Verdict:** REVISE

## Findings

1. **Serious — Requirements 1.1, 1.3 and 3.2: the TTL gate cannot implement the stated cache-read case.** The criterion arms after a last request that *wrote or read* a one-hour cache, but the named `ContextUsagePort.getLast()` exposes only token totals, maximum and source, with no TTL or request timestamp (`libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.ts:41-47, 193-212`). The existing split parser reads `usage.cache_creation.ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` (`libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:222-235`); a cache-read-only response does not identify the read entry's TTL by those write counters. Revise the acceptance criteria to specify a trustworthy per-request TTL source and its behavior for read-only, mixed-TTL and zero-write responses. If no such source exists, explicitly narrow eligibility to confirmed one-hour writes and acknowledge that many warm turns will not arm. Also require the TTL observation to belong to the *last main-thread request*, rather than a prior successful reading: the context port preserves the prior reading after a failed read (`context-usage.port.ts:15-20, 110-115`).

2. **Serious — Context and Requirements 2.1/6.1-6.2: the proposed `/compact` route and completion attribution are underspecified against current behavior.** The existing user slash-command method ends the session and starts a resumed query (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:721-748`), contrary to AC 2.1's no-relaunch rule. A direct `sendMessage('/compact')` can use the persistent stream, and its `require-idle` admission checks immediately before enqueue (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:194-247`), but that is a distinct route to name in the spec. The PostCompact hook reports only `manual` or `auto` triggers (`libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:507-516, 559-562`), so an idle slash command can look manual. Require an explicit idle-attempt identity/correlation rule from admitted send through PreCompact, boundary and PostCompact; the notice must appear only for that matching completed attempt, including when a user manual `/compact` races it. This also gives AC 6.2 a testable implementation contract.

3. **Serious — Requirements 1.1-1.2 and 4.1: asynchronous turn-end data can arm an obsolete timer.** The existing turn-end context read is asynchronous (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:431-450`), while `ContextUsagePort` can take up to five seconds and keeps a per-turn promise (`libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.ts:32-33, 98-120, 163-178`). AC 4.1 cancels a *pending* timer on a new message or turn, but says nothing about a still-pending read that later creates one. Require a turn/request generation or equivalent check before arming, and cover: turn A ends, its read stalls, turn B starts, A's read resolves; no A timer or stale TTL/context may survive. This is needed for multi-session correctness as well as the same-session race.

4. **Moderate — Requirements 1.1 and 3.3: the expiry formula uses response arrival as if it were cache creation time.** `expiresAt = lastActivity + 3,600,000` is specified with `lastActivity` equal to receipt of the final response (AC 1.1). The repository's raw usage is read from assistant messages (`libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:207-227`), so this timestamp follows the API request that created or refreshed a cache entry. A request that takes over six minutes could make the nominal 90% fire time fall after the real one-hour expiry, while AC 3.3's lateness test still sees an on-time timer. Define how expiry is measured or conservatively bounded from the request/cache-write time; include a long request and sleep/wake virtual-clock case.

5. **Moderate — Requirement 5.2: invalid-setting behavior is internally inconsistent.** AC 5.2 says advanced settings *reject* a below-floor or fractional value, then says the handler uses `100,000` or the default respectively. The existing compaction provider treats an invalid persisted threshold as unset rather than clamping it (`libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts:114-140`), and advanced settings declare integer/minimum constraints (`libs/shared/src/lib/types/advanced-settings.types.ts:124-137`). State separately what the UI rejects, what persisted malformed data falls back to, and whether the last valid setting remains active. This makes import and direct-file edits testable without silently changing a rejected value to the floor.

6. **Minor — Clarifications Needed / Decisions: the default-on question is already decided.** `decisions.md:9` records ON by default, and the spec itself states default on in AC 5.1 (`task-description.md:183-187`) and its decisions table (`task-description.md:262-269`), but `Clarifications Needed` still asks the same question (`task-description.md:272-276`). Remove the stale question before handoff. This is editorial and does not change the verdict.

## Five logic checks

1. **Silent failure:** missing/failed TTL or context reads can look like valid last-known state unless eligibility is tied to the current request and turn (findings 1 and 3).
2. **User action:** manual `/compact` or a message at the fire tick can race the idle send and produce a wrongly attributed notice (finding 2).
3. **Wrong answer from input:** cache-read-only or mixed-TTL usage can be misclassified as a one-hour cache (finding 1).
4. **Dependency failure/late result:** a delayed `getContextUsage()` result can schedule work after the session has resumed; a slow API response can make the cache-expiry estimate late (findings 3 and 4).
5. **Unspecified requirement:** the exact live-query send route and correlation of its completion to the notice need an acceptance rule (finding 2).

## Scope and verification

Read `task-description.md`, `context.md`, `decisions.md` and the cited repository paths. The feature scope fits the user's request; RxJS declarations cited by the spec are accurate: root `package.json:197`, `libs/backend/agent-sdk/project.json:17-22`, `apps/ptah-cli/project.json:52-60`, while neither `libs/backend/agent-sdk/package.json:8-24` nor `apps/ptah-cli/package.json:51-85` declares it. Registry eviction also skips live queries (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:593-612`). No build or test was run, as requested. The gate is REVISE because findings 1-3 leave core acceptance criteria unsafe or impossible to implement as written.

## Round 2

- **Revision reviewed:** 2
- **Verdict:** REVISE

### Status of Round 1 findings

1. **Open (Serious), Requirement 1 definitions and AC 1.1.** The spec now rejects missing and mixed write splits and stale turn data (`task-description.md:125-155`). But `1h-inherited` classifies a *read-only* last request as one-hour solely because an earlier request in the same query wrote one-hour tokens (`task-description.md:130-134`). The last request's `cache_read_input_tokens` gives a count, not the TTL of entries read; `cache_creation` describes writes only (`libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:222-235`). The earlier write therefore cannot establish the last request's read TTL, especially where the query has held entries with different TTLs. This contradicts the spec's own observed-last-request rule (`task-description.md:62, 125-134`). Treat read-only requests as unconfirmed unless a trustworthy per-request read-TTL signal is identified; otherwise arm only on confirmed one-hour writes. The stale-reading part of this finding is resolved by AC 1.4-1.5.
2. **Open (Serious), Requirements 2.4-2.5 and 6.1-6.4.** The live-stream route and enqueue-time admission are now explicit (`task-description.md:166-175`), and the notice is conditional on an identity (`:267-277`). The identity rule still equates the next PreCompact after an idle send with that send (`:176-181`), while AC 2.5 asserts that a later manual `/compact` is deduped by the coordinator (`:182-185`). The coordinator enters TRIGGERED only on PreCompact (`libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts:166-179`) and `requestManualCompact` dedupes only in TRIGGERED/COMPACTING (`:243-252`): between enqueue and PreCompact it can return `send`. Hooks expose only `manual`/`auto`, with no send identity (`libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:344-355, 507-516`). Specify admission/queue ownership or another observable correlation that handles a manual command in that interval, and require a test for idle enqueue -> manual admission -> PreCompact/PostCompact with correct notice attribution.
3. **Resolved.** AC 1.5 rejects a late result from turn A after turn B starts, including its TTL, anchor and context (`task-description.md:153-156`); AC 4.1 explicitly covers an in-flight read (`:225-227`).
4. **Resolved.** The anchor is bounded by request send rather than response receipt, with a seven-minute request case (`task-description.md:135-146`); AC 3.3 covers a late sleep/wake timer (`:203-205`).
5. **Resolved.** UI rejection preserves the valid setting, while malformed persisted data falls back to 200,000 without clamping (`task-description.md:244-255`), matching the existing provider pattern (`libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts:114-140`).
6. **Resolved.** The redundant clarification is removed, and the default-on decision is recorded (`task-description.md:333-340`).

### New finding

7. **Serious, AC 2.5: coordinator dedupe is claimed before its state permits it.** The assertion that an idle send followed by a manual `/compact` leaves one compaction through *existing* dedupe (`task-description.md:182-185`) is false until PreCompact: `requestManualCompact` returns `send` outside TRIGGERED/COMPACTING (`libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts:243-252`). The ordinary user slash-command route can also end and relaunch the live query (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:721-748`). Define the expected behavior for this interval and the concrete gate that enforces it. This is the same race that keeps finding 2 open, stated separately because Revision 2 adds a false implementation claim.

No builds or tests were run. Only this review file was changed.

## Round 3

- **Revision reviewed:** 3
- **Verdict:** APPROVED

### Status of Round 2 open findings

1. **Finding 1 — Resolved.** The last request is `1h` only for a confirmed one-hour write with no five-minute write; read-only, mixed, missing-split and missing-usage requests are `not-1h` (`task-description.md:128-136`). AC 1.1 explicitly excludes a read-only last request after an earlier one-hour write (`:143-146`), and the accepted loss of some warm turns is recorded (`:340-341`). This implements `decisions.md:10`.
2. **Finding 2 — Resolved at requirements level.** AC 2.1 names the live persistent stream and forbids relaunch (`task-description.md:163-176`). AC 2.4-2.6 require a per-session identity and enqueue-time pending-idle claim, coalesce manual `/compact` through completion, and release the claim on completion, failure, lifetime end or timeout (`:179-197`). The enqueue-to-PreCompact and PreCompact-to-PostCompact races have explicit assertions (`:198-203`); the idle notice requires a matching completed attempt (`:285-296`). This implements `decisions.md:11`; the exact claim mechanism remains for the architect.
3. **Finding 7 — Resolved.** The spec now states that existing coordinator dedupe starts only at PreCompact (`task-description.md:23-26, 184-185`) and requires the new claim to make manual admission behave as TRIGGERED from idle enqueue (`:186-190`). It no longer relies on the previous false dedupe claim; the required race test is at `:198-203`.

### New findings and logic checks

No new Blocking or Serious finding in the Revision 3 changes. The key silent-failure and wrong-answer cases—an unconfirmed read TTL or stale turn data—are excluded from arming (`task-description.md:128-159`). A manual `/compact` during the pending idle claim is specified to coalesce without a second send or manual notice (`:179-203, 285-296`). Failed admission, compaction failure, and a claim that never reaches PreCompact have skip, release, logging, and timeout rules (`:174-176, 193-208`). The remaining implementation question is how to carry attempt identity through the stream and hooks; the spec assigns that mechanism to the architect (`:367-373`).

Scope: compared Revision 3 with the Round 2 findings and orchestrator decisions 7-8. This is a requirements review; no build or test was run, as requested.
