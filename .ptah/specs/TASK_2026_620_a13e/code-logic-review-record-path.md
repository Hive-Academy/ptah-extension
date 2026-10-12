# Code-logic review — Record Path (62213ce8d & 770210092)

Reviewer: antigravity gemini-3.1-pro

## Verdict: REVISE (5/10)
Some major issues from the previous review have been fixed, but silent failures and architectural flaws in provenance recording remain.

## Defects 1-6 Status
1. **[Blocking] SDK adapter initialization is never triggered.**
   - **Status:** **Fixed**. `waitForSdkReady` now races `adapter.initialize()` against a timeout and verifies `initialized` and health status.
2. **[Blocking] Redaction regex leaks JSON-formatted secrets.**
   - **Status:** **Fixed** (mostly). The regex was updated in `redactSecrets` to handle JSON quotes around values, cookies, and JWTs, addressing the specific JSON leakage concern.
3. **[Serious] Exceptions in `retainHostLog` mask errors and leak resources.**
   - **Status:** **Fixed**. `retainHostLog` is now wrapped in a `try-catch` block, and errors during log file operations emit a stderr diagnostic instead of throwing, allowing `await host.stop()` to safely execute.
4. **[Serious] `caseLimit` can silently shrink CI benchmark plans.**
   - **Status:** **Fixed**. `caseLimit` is explicitly rejected in CI mode. Outside CI, it adds a `truncationNote` and produces `verdict: 'na'` with `naReason: 'truncated-probe'`.
5. **[Moderate] SDK readiness gate may observe the wrong provider.**
   - **Status:** **Fixed**. The record-mode bootstrap now seeds `authMethod: 'thirdParty'` and `anthropicProviderId: 'openai-codex'` into the isolated `settings.json`, aligning the primary SDK adapter configuration with the Codex proxy requested by the curator.
6. **[Moderate] Untested core logic.**
   - **Status:** **Fixed**. Unit tests have been added for `waitForSdkReady`, `retainHostLog` failures, and the new `redactSecrets` logic.

## Logic Analysis

### How does each change fail silently?
1. **`retainHostLog` ignores unreadable files:** Inside `retainHostLog`, the inner `try-catch` block around `readFileSync` has an empty `catch`. If an individual log file cannot be read, it is silently skipped without warning (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:480-482`).
2. **`attachProvenanceTap` bails out silently:** If `SDK_TOKENS.SDK_QUERY_RUNNER` is not registered in the container, `attachProvenanceTap` silently returns without throwing an error, leaving the tap detached (`tools/mcp-bench/src/memory-skills/host/doubles-override.ts:178`).

### Could the tap double-count or miss dispatches?
1. **Double-counting via shared runner:** The tap is attached to the singleton `SdkQueryRunner` instance in the container (`tools/mcp-bench/src/memory-skills/host/doubles-override.ts:187`). Any other service using the SDK (such as a funnel lane-runner) will trigger `onModelDispatched`, mixing their dispatches with the curator's.
2. **Double-counting via retries:** If the SDK runner implements internal retries and invokes `scheduleProvenance` multiple times for a single logical curator request, the tap will double-count the dispatches for that entry.
3. **Missing dispatches in replay mode:** Replay mode correctly misses dispatches because `attachProvenanceTap` is only executed when `mode === 'record'` (`tools/mcp-bench/src/memory-skills/host/doubles-override.ts:203`). 

### Could the runner be a different instance from the one the curator uses?
**Yes.** `attachProvenanceTap` resolves the runner directly from the `BenchHostContainer`. If the curator is resolved from a child container that registers a transient or separate instance of `SdkQueryRunner`, the tap will only attach to the parent's runner, causing the curator's dispatches to be missed entirely.

### Any secret leak path left in redactSecrets?
**Yes.** Unquoted secrets containing spaces (e.g., `Authorization: Secret part1 part2`) are only redacted up to the first space because the unquoted matcher `[^\\s,;}\"'\\]\\r\\n]+` explicitly stops at whitespace (`tools/mcp-bench/src/memory-skills/host/redact-secrets.ts:15`). Additionally, space-separated secrets (e.g., `apiKey mysecret` instead of `apiKey: mysecret`) will fail to match the `\s*[:=]\s*` constraint and leak completely.

### Any record-mode path that can still produce a success-looking result with an incomplete or unprovenanced cassette?
**Yes.** If a suite produces exactly 0 cases (e.g., due to an empty fixtures list or filtering), 0 cassette entries are generated and 0 dispatches are collected. This perfectly satisfies the acceptance gate (`dispatches === entries`), and `allPass = records.every(...)` evaluates to true for an empty array. The suite produces `verdict: 'pass'` despite being completely empty and unprovenanced (`tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.ts:689`).

## Checked and OK
- `caseLimit` appropriately refuses CI execution.
- Redaction successfully covers quoted JSON keys and basic tokens.
- Record mode safely aligns auth settings for the SDK initialization gate.
- Exceptions during log retention no longer leak the MCP server connection.
- `attachProvenanceTap` properly avoids mutating replay-mode behavior.

## Orchestrator disposition (2026-10-09)

- **Empty suite → vacuous pass — accepted (minor).** `extraction.suite.ts:689` `records.every(...)` is true for
  `[]`. Real exposure is low (the case set comes from the committed fixture, pinned to F-001..F-130 minus F-038 by
  `fixture-manifest.spec.ts`), but the guard is cheap: fixed in the follow-up round.
- **`attachProvenanceTap` silent return — rejected.** An unregistered runner leaves 0 dispatches, and the gate at
  `recorder/provider-provenance.ts:236-241` then rejects any non-empty cassette loudly. Not a silent failure.
- **Double-count via the shared runner / retries — rejected as silent failure.** Curator entries allow at most one
  dispatch each (`provider-provenance.ts:234-236`); any extra dispatch fails acceptance loudly. A spurious extra
  dispatcher would show up as a rejected recording, not a success.
- **Child container with a different runner — rejected (untraced).** `SDK_QUERY_RUNNER` is registered once as a
  root singleton (`libs/backend/agent-sdk/src/lib/di/register.ts:375-377`); nothing in the bench re-registers it in a
  child container.
- **`redactSecrets` space-separated / multi-word values — accepted (minor hardening).**
- **`retainHostLog` per-file empty catch — accepted (minor visibility).**
