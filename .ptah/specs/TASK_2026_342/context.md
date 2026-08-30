# TASK_2026_342 — Cache/dedupe auth:getAuthStatus; fix codexTokenStale contradiction

## Evidence (D:\projects\ptah-extension\tmp\logs\log.log)

- 646-697: first auth:getAuthStatus; 13 sequential AuthSecretsService reads (648-660) then a long gap until the result at 695; slow handler 3589ms (696). Event-loop lag 1733ms at 666 (SDK launch, TASK_2026_341) overlaps it.
- 704, 719, 772: three handlers in flight at once; results 798-803; slow handler 3580ms / 5347ms (800-801); a fifth call at 807 -> 832 (3751ms).
- 699, 1122, 1540, 1727, 1994, 2082, 2214: every workspace:switch is followed within a few lines by another auth:getAuthStatus (704, 1149, 1549, 1737, 2004, 2092, 2221). 14 calls total, identical payload every time.
- 911, 1297: "[CliDetection] codex credential refresh: fresh". 695, 1006, 1188, 2244: every status response still says codexAuthenticated:true, codexTokenStale:true.
- Real ~/.codex/auth.json on this machine: auth_mode=chatgpt, OPENAI_API_KEY=null, last_refresh=2026-08-27T22:49Z, access_token JWT exp=2026-09-06T22:49Z.

## Root cause

Two independent defects.

**(A) Slow + duplicated `auth:getAuthStatus`.** The handler
(`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`) had no cache and
no in-flight coalescing, and on EVERY call it read the `apiKey` secret plus one
secret per registered provider sequentially, awaited `copilotAuth.isAuthenticated()`

- `getGitHubUsername()`, awaited `codexAuth.getTokenStatus()`, and awaited
  `cliDetector.performHealthCheck()`. `performHealthCheck`
  (`libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:169-226`) memoises
  only `findExecutable()`; it spawns `claude --version` (5s timeout, through a Windows
  `.cmd` shim) on every invocation — that spawn is the bulk of the 2-5s. The three
  probes were also run sequentially. Concurrency came from three separate frontend
  callers that each hit the RPC directly at boot: `ChatLifecycleService.bootstrap ->
authState.loadAuthStatus()`, an `AppShellComponent` effect calling
  `rpcService.call('auth:getAuthStatus')`, and `ChatInputComponent.ngOnInit ->
fetchAuthMethodLabel()`. The `AuthStateService` single-flight guard only dedupes
  `loadAuthStatus` callers, so the two direct callers bypassed it. Every
  `workspace:switch` then triggers
  `WorkspaceCoordinatorService.refreshWorkspaceProviderState ->
authState.refreshAuthStatus()` plus a chat-input re-init.

**(B) `codexTokenStale` contradiction.** Two different code paths defined "fresh".
`"[CliDetection] codex credential refresh: fresh"` came from
`CliDetectionService.refreshCliTokens` calling `CodexCliAdapter.ensureTokensFresh`,
which merely checked that `~/.codex/auth.json` contains an api key or an
`access_token` — no staleness check and no refresh, so "fresh" there meant
"present". The RPC's `codexTokenStale` came from `CodexAuthService.getTokenStatus ->
isTokenStale`, which flagged stale whenever `last_refresh` was older than
`TOKEN_MAX_AGE_MS = 50 min`. Verified against the real file on this machine:
`auth_mode=chatgpt`, `OPENAI_API_KEY=null`, `last_refresh` ~20h before the log, while
the `access_token` JWT carries `exp` 10 days after `iat`. The 50-minute heuristic is
therefore a false positive: the token is valid for days, nothing ever refreshes it,
and every status response for the whole session reported `codexTokenStale:true` and
the settings UI showed a re-login warning.

## Files

- `libs/shared/src/lib/utils/codex-token-freshness.ts` (new) + `.spec.ts`, exported from the shared utils barrel
- `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts` (+ `.spec.ts`)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (+ `codex-cli-adapter.spec.ts`)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts` (+ `.spec.ts`)
- `libs/frontend/core/src/lib/services/auth-state.service.ts` (+ `.spec.ts`)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`
- `libs/backend/rpc-handlers/CLAUDE.md`, `libs/backend/auth-providers/CLAUDE.md`

## Plan

1. Shared freshness rule (`libs/shared`): pure `decodeJwtExpiry` (base64url payload,
   Zod `{ exp: z.number() }`, never throws) and `isCodexAccessTokenStale`: if the JWT
   decodes, stale = `exp*1000 - now < 5 min skew`; otherwise fall back to the existing
   `last_refresh > 50 min` heuristic (missing/unparseable `last_refresh` = stale).
2. `CodexAuthService`: replace `isTokenStale(lastRefresh)` with the shared helper at
   all three call sites, passing `auth.tokens?.access_token` and `auth.last_refresh`.
3. `cli-agent-runtime`: `CodexCliAdapter.ensureTokensFresh` uses the same shared
   helper (presence AND not stale); `CliDetection` log wording becomes "credential
   check" because the adapter never refreshes.
4. `AuthRpcHandlers.getAuthStatus`: TTL cache + in-flight coalescing keyed by
   `(active path, providerId param)`, parallel probes via `Promise.all`, separately
   memoised Claude-CLI health, and `invalidateAuthStatusCache()` wired into every
   auth-mutating method plus the `onAuthFileChanged` event.
5. Frontend: one path through `AuthStateService` — new `hasAnyProviderKey`,
   `hasAnyAuth`, `authMethodLabel`, `isLoaded`; `AppShellComponent` and
   `ChatInputComponent` stop calling the RPC directly.
6. Docs + tests.

## Acceptance criteria

1. Unit: two concurrent `auth:getAuthStatus` calls with identical params and active path invoke `cliDetector.performHealthCheck`, `copilotAuth.isAuthenticated`, `codexAuth.getTokenStatus` and the secret-store reads exactly once and both resolve to deep-equal payloads.
2. Unit: a second `auth:getAuthStatus` within `AUTH_STATUS_CACHE_TTL_MS` performs zero probe or secret-store invocations; after the TTL elapses (fake timers) it re-probes.
3. Unit: `auth:saveSettings`, `auth:setApiKey`, `auth:copilotLogin`, `auth:copilotLogout`, `auth:codexLogin`, `auth:clearWorkspaceOverride` and an `onAuthFileChanged` event each invalidate the cache.
4. Unit: cache entries keyed by (active workspace path, providerId param).
5. Unit: Claude CLI health memoised for `CLAUDE_CLI_HEALTH_TTL_MS` independently; existing "tolerates failure" specs still pass with `Promise.all`.
6. Unit (auth-providers): JWT `exp` days ahead + old `last_refresh` -> `stale:false`; `exp` past -> `stale:true` and `ensureTokensFresh` attempts a refresh; opaque tokens keep the 50-minute fallback.
7. Unit (cli-agent-runtime): `CodexCliAdapter.ensureTokensFresh` false for a present-but-expired JWT, true for a present-and-unexpired one.
8. Unit (shared): `decodeJwtExpiry` never throws; `isCodexAccessTokenStale` covers the four branches.
9. Frontend: `AppShellComponent` / `ChatInputComponent` no longer call the RPC directly; `AuthStateService` exposes `hasAnyProviderKey`, `hasAnyAuth`, `authMethodLabel` with specs.
10. Runtime (manual): boot handler count at most 2, no slow-handler warning after the first call, `codexTokenStale:false` for a valid token.
11. Tests green across the six projects; lint passes; no `@ts-ignore`, `catch (error: unknown)` with `instanceof` narrowing, Zod on the JWT payload.

## Test projects

`@ptah-extension/rpc-handlers`, `@ptah-extension/auth-providers`,
`@ptah-extension/cli-agent-runtime`, `@ptah-extension/shared`,
`@ptah-extension/core`, `@ptah-extension/chat`

## Overlap risk with sibling tasks

Moderate. TASK_2026_348 (DEP0190 `shell:true` spawns) will likely edit
`claude-cli-detector.ts` and the `cli-agent-runtime` spawn code; this task
deliberately does NOT touch `claude-cli-detector.ts` (the health memo lives in
`AuthRpcHandlers`) and only edits `refreshCliTokens`' log line plus
`ensureTokensFresh` in `codex-cli.adapter.ts`. TASK_2026_341 (SDK `query()`
main-thread lag) explains part of the measured durations but edits `agent-sdk`.
TASK_2026_353 / TASK_2026_345 may touch `app-shell.component.ts`,
`workspace-coordinator.service.ts` or `libs/frontend/core` state services.
TASK_2026_343 (git handler coalescing) is a different handler file.

## Implementation notes

### What changed

**1. One freshness rule (`libs/shared`).** New pure module
`src/lib/utils/codex-token-freshness.ts`: `decodeJwtExpiry(token)` (base64url
payload via `atob`, Zod `{ exp: z.number() }`, total — returns `null` on any
malformed input and never throws) and `isCodexAccessTokenStale({accessToken,
lastRefresh, now})`. Precedence: the token's own `exp` when it decodes (stale
within `CODEX_TOKEN_EXPIRY_SKEW_MS = 5 min`), otherwise the pre-existing
`CODEX_TOKEN_MAX_AGE_MS = 50 min` `last_refresh` heuristic (missing or
unparseable = stale). Exported from the shared utils barrel. Signature
verification is deliberately absent — this is a "should we refresh" decision
about the user's own file, not an authorization decision.

**2. `CodexAuthService` (auth-providers).** `isTokenStale` now takes the whole
`CodexAuthFile` and delegates to the shared helper; the local
`TOKEN_MAX_AGE_MS` constant is gone. All three call sites (`getTokenStatus`,
`ensureTokensFresh`, `resolveAccessToken`) go through it. Existing specs use
opaque token strings, so they still exercise the fallback branch unchanged.

**3. `CodexCliAdapter.ensureTokensFresh` (cli-agent-runtime).** Was
presence-only ("a credential exists"). Now: API key → true; access token →
`!isCodexAccessTokenStale(...)`. Its docblock states that this adapter never
refreshes anything. `CliDetectionService.refreshCliTokens` log wording changed
from `"<cli> credential refresh: fresh|stale/unavailable"` to
`"<cli> credential check: usable|stale/unavailable"` — no spec asserted the old
string. This is what removes the contradiction: both sides of the log now come
from one rule.

**4. `AuthRpcHandlers.getAuthStatus` (rpc-handlers).**

- `statusCache` + `statusInFlight`, keyed by
  `${scopeResolver.getActivePath() ?? ''}|${params.providerId ?? ''}`.
  `AUTH_STATUS_CACHE_TTL_MS = 15_000`.
- Body extracted to `computeAuthStatus`, with the three probes (`probeSecrets`,
  `probeCopilot`, `probeCodex`, `probeClaudeCli`) run under one `Promise.all`;
  each swallows its own failure, so the existing "tolerates X failure" specs
  hold and one slow source no longer serialises behind another.
- `probeClaudeCli` memoises separately for `CLAUDE_CLI_HEALTH_TTL_MS = 5 min`.
  A _failure_ is deliberately not memoised.
- `invalidateAuthStatusCache()` clears all three and is called from
  `auth:saveSettings`, `auth:setApiKey`, `auth:copilotLogin`,
  `auth:copilotLogout`, `auth:codexLogin`, `auth:clearWorkspaceOverride`, and
  from an `SdkAdapterEvents.onAuthFileChanged` subscription wired in
  `register()` (new LAST constructor param, `{ isOptional: true }`).
- **Deviation from the plan, deliberate:** `auth:testConnection` does NOT
  invalidate. It mutates nothing, and every path that reaches it already went
  through `saveSettings` or `setApiKey`; invalidating there would throw away the
  Claude-CLI memo and re-spawn `claude --version` on a method whose whole job is
  to poll SDK health. Recorded in `rpc-handlers/CLAUDE.md`.

**5. Frontend — one caller.** `AuthStateService` gains `_hasAnyProviderKey`
(populated from the response, previously dropped), `hasAnyProviderKey`,
`isLoaded` (the `_isLoaded` guard became a signal so consumers can tell "not
fetched yet" from "no auth"), `hasAnyAuth` (the redirect rule lifted verbatim
out of `AppShellComponent`), and `authMethodLabel` (the badge rule lifted out of
`ChatInputComponent`, null until loaded). `_isLoaded` is now set in
`populateFromResponse` so a `refreshAuthStatus`-first path also counts as
loaded. `AppShellComponent` calls `authState.loadAuthStatus()` and reads
`hasAnyAuth()`; `ChatInputComponent.ngOnInit` calls `loadAuthStatus()` (no-op
after the first) and binds the badge to `authState.authMethodLabel`. Its
`fetchAuthMethodLabel` and local signal are deleted. `grep 'auth:getAuthStatus'
libs/frontend/chat/src` now returns only two comments.
`WorkspaceCoordinatorService` is untouched — the backend path-keyed cache
absorbs its repeats.

**6. Docs.** `rpc-handlers/CLAUDE.md` gained a Guidelines bullet (cache key,
both TTLs, the invalidation list, why `testConnection` is excluded, why
path-keying replaces switch-invalidation). `auth-providers/CLAUDE.md` gained a
bullet stating staleness is JWT-`exp` based with `last_refresh` as fallback
only.

### Tests added

- `libs/shared/.../codex-token-freshness.spec.ts` (new, 9 tests) — malformed
  input never throws, and the four freshness branches.
- `codex-auth.service.spec.ts` — 4 new: JWT `exp` days out + 20h-old
  `last_refresh` → `stale:false`; `exp` past + 1-minute-old `last_refresh` →
  `stale:true`; `ensureTokensFresh` skips the refresh for the former and issues
  exactly one `axios.post` for the latter.
- `codex-cli.adapter.tokens.spec.ts` (new, 6 tests) — separate file because it
  is the only adapter test needing `fs/promises` mocked.
- `auth-rpc.handlers.spec.ts` — new `auth:getAuthStatus caching` block (13
  tests): concurrent coalescing to one probe set with deep-equal payloads;
  second call in TTL does zero work; re-probe after TTL (fake timers); CLI
  health memo outliving the status TTL and expiring on its own; providerId and
  active-path keying (including "switch back is free"); one test per
  invalidating method; `codexLogin` and `onAuthFileChanged` reflecting changed
  state. Harness gained an `MockAdapterEvents` stub and a `probeCounts` helper.
- `auth-state.service.spec.ts` — new block (17 tests) for
  `hasAnyProviderKey`, `isLoaded`, every `hasAnyAuth` source including the three
  "provider needs no key" shapes, and every `authMethodLabel` branch.

### Results

`npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/auth-providers @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/core @ptah-extension/chat`
→ **"Running target test for 6 projects"**, "Successfully ran target test for 6
projects". shared 1204/1204; core 565/565; auth-providers 635/635;
cli-agent-runtime 500/500; chat 872 passed + 2 skipped; rpc-handlers 2518 passed

- 31 skipped. 0 failed.

`npx nx run-many -t typecheck -p <same six>` → "Running target typecheck for 6
projects". Five pass. `@ptah-extension/chat` fails on three
`TS2339: Property 'agentId' does not exist` errors in
`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1253/1285/1317` —
a concurrent agent's uncommitted work in a lib this task does not touch. No
error in any file changed here.

Lint: 0 errors across all six (warnings only). `auth-rpc.handlers.ts` carries a
pre-existing `max-lines` warning (1009 raw lines at HEAD, 1216 now); left as-is
— the class is one method per RPC method and the facade rule offers no
nameable collaborator to extract.

Not verified here: acceptance criterion 10 (manual Electron boot with two
folders). Everything it asserts is pinned mechanically by the unit specs above.

## Revision (round 2)

Judge returned FAIL on three defects. Two were real, one was wording.

### Defect 1 (CRITICAL) — cache-poisoning race: fixed

The invalidation was only half-built. `invalidateAuthStatusCache()` cleared both
maps, but a `computeAuthStatus` that was ALREADY IN FLIGHT when the clear
happened still resolved afterwards, and its `.then` wrote the pre-change payload
into the freshly-emptied cache with a full 15s TTL. The concrete sequence: boot
caller starts, `codexAuth.getTokenStatus()` reports `authenticated:false`; a
terminal `codex login` finishes and `onAuthFileChanged` fires; the original
probe then answers `false` and becomes everyone's cached answer for 15s. The
invalidation ran and was undone by the probe it raced — the exact concurrent-boot
condition this task was filed for, and directly against the doc comment that
says the cache "can be dropped immediately instead of waiting out its TTL".

Fix, using the idiom already in the codebase
(`WorkspaceCoordinatorService.refreshWorkspaceProviderState`'s
`switchGeneration`): a monotonic `cacheGeneration` field, bumped inside
`invalidateAuthStatusCache()`, captured before the first await, re-checked
before every write-back.

Three write-backs are now guarded, not one:

1. `statusCache.set` in the `.then` — the defect as filed.
2. `claudeCliHealth` in `probeClaudeCli(generation)` — the SAME bug with a worse
   blast radius. That memo lives 5 minutes, twenty times the status TTL, so a
   verdict written back after an invalidation is the longest-lived stale value
   this handler can hold. `generation` is threaded through `computeAuthStatus`
   for this.
3. `statusInFlight.delete` in the `.finally` now deletes BY IDENTITY
   (`if (statusInFlight.get(key) === pending)`), not by key. After an
   invalidation a newer computation can already own that key, and a blind
   `delete(key)` evicts it — the next caller in the burst then starts a third
   probe set instead of joining, un-coalescing the burst the cache exists to
   absorb. Verified: reverting to `delete(key)` makes the new spec report 3
   `getTokenStatus` calls where 2 are expected.

The superseded caller still RECEIVES its own payload — that is the honest answer
to a question asked before the change. What it no longer does is publish it.

Four new specs in the `auth:getAuthStatus caching` block, each proven to fail
against the pre-fix code before being kept:

- `does not repopulate the cache with a payload computed before an external
auth-file change` — the exact `codex login` interleaving above.
- `does not repopulate the cache with a payload computed before a mutating RPC
call` — same, with `auth:setApiKey` landing mid-probe.
- `does not memoise a Claude CLI verdict computed before an invalidation` —
  covers the 5-minute memo.
- `a superseded computation settling does not evict the in-flight entry that
replaced it` — covers the identity delete.

They need two harness helpers, both new: `createDeferred<T>()` (spec-controlled
promise, so one probe can be held open while something else mutates auth state)
and `flushUntil(predicate)` (bounded microtask drain — beats a fixed count of
`await Promise.resolve()`, which rots the moment an `await` is added to the
handler). The reason none of the six pre-existing "invalidates after X" specs
caught this is structural: every one of them `await`s the mutating call to
completion BEFORE re-calling `auth:getAuthStatus`, so no probe is ever in flight
across the invalidation.

`rpc-handlers/CLAUDE.md` now states that clearing the maps is only half of the
invalidation, that every write-back is generation-conditional, and that the
in-flight map is deleted by identity.

### Defect 3 (minor) — criterion 9's grep wording: fixed

`chat-input.component.ts:391` carried a comment quoting the literal
`auth:getAuthStatus`, so the criterion's "grep returns only the
workspace-coordinator comment" was false by one line. Reworded to "the
auth-status RPC". `grep -rn "auth:getAuthStatus" libs/frontend/chat` now returns
exactly one hit, `workspace-coordinator.service.ts:191`. No functional change —
both components already read `AuthStateService` signals.

### Defect 2 — criterion 10 (runtime Electron boot): still NOT verified

Stated plainly rather than papered over. See "Runtime verification" below.

### Results (round 2)

`npx nx run-many -t test -p @ptah-extension/rpc-handlers
@ptah-extension/auth-providers @ptah-extension/cli-agent-runtime
@ptah-extension/shared @ptah-extension/core @ptah-extension/chat` →
**"Running target test for 6 projects"**, "Successfully ran target test for 6
projects". shared 1204/1204; core 565/565; auth-providers 635/635;
cli-agent-runtime 500/500; chat 872 passed + 2 skipped; rpc-handlers 2522 passed

- 31 skipped (+4 from round 1). 0 failed.

Lint: "Successfully ran target lint for 6 projects", 0 errors. `auth-rpc.handlers.ts`
keeps its pre-existing `max-lines` warning (945 counted lines, was already over
the 700 soft ceiling at round 1 and at HEAD, alongside five sibling handler
files). Not split: a concurrency guard is not a nameable collaborator, and the
facade rule's guardrails say do not mint a fragment to satisfy the cap.

Typecheck: five of six pass. `@ptah-extension/chat` fails on the same three
foreign `TS2339: Property 'agentId' does not exist` errors in
`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1253/1285/1317`
reported in round 1 — still another agent's uncommitted work in a lib this task
does not touch (`git diff` shows the three `event.agentId ??` lines as their
addition), still not reverted by this task. Chat's own sources produce no error.

### Runtime verification (criterion 10) — open

Criterion 10 requires an interactive Electron boot with two open folders and a
real, unexpired `~/.codex/auth.json`. It was not performed in round 1 and is not
performed here. Nothing in a unit harness substitutes for it; per the task's
default-to-fail rule it is an open gap, and this section exists so the next
reader does not have to re-derive that.

It was ATTEMPTED in this round and is blocked by the working tree, not by
choice. `npx nx build ptah-extension-webview --configuration=development` (the
first half of `copy-renderer-dev`, and a hard prerequisite of both
`electron:serve` and the `ptah-electron-e2e` harness) fails with the same three
`TS2339: Property 'agentId' does not exist` errors from the concurrent agent's
uncommitted `chat-streaming/agent-monitor.store.ts` edit — the Angular compiler
plugin rejects them at build time exactly as `nx typecheck` does. No Electron
renderer can be produced from this tree until that edit lands or is reverted by
its owner, and reverting another agent's in-progress work is out of bounds here.
So the gap is: unrunnable now, runnable the moment the tree compiles.

What the unit layer DOES pin, so the residual runtime risk is scoped:
handler-invocation count (coalescing + TTL + path/providerId keying specs),
absence of repeat probe work after the first call (the "zero probe or
secret-store work" spec, plus the 5-minute CLI memo which was the bulk of the
measured 2-5.3s duration), and `codexTokenStale` for an unexpired JWT (the
shared `isCodexAccessTokenStale` specs plus both call sites). What it cannot
pin is the boot fan-out ORDER in a real two-workspace session and the actual
`[RPC] slow handler` threshold behaviour.

Procedure for whoever runs it:

1. `npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron`,
   then `npm run electron:serve`.
2. Open a folder, then open a second folder, matching the session in
   `tmp/logs/log.log`.
3. In the resulting log: count `RPC: auth:getAuthStatus called` lines with
   `cacheHit: false` (expect at most 2 — initial plus one per distinct
   workspace path); confirm no `[RPC] slow handler` line names
   `auth:getAuthStatus` after the first; with a valid token confirm the
   `auth:getAuthStatus result` line reports `codexTokenStale: false` and the
   settings UI shows no codex re-login warning.

The `cacheHit` / `coalesced` / `cacheHit:false` debug fields were added for
exactly this measurement.

## Live verification (smoke 2026-08-29)

Criterion 10 was finally exercised on a real Electron boot
(`tmp/logs/log-after.log`, 1288 lines, two workspace folders). **The cache and
dedupe work. The probe underneath them did not.**

### What the log proves worked

- `auth:getAuthStatus` was handled **6 times** across the whole session, against
  **16** on the baseline (`tmp/logs/log.log`). Every workspace switch that used
  to fan a fresh call now hits a path-keyed entry.
- `:612` reports `cacheHit:false` and `:674` reports `coalesced:true` — two boot
  callers sharing ONE computation, which is the mechanism this task added.
- `:725` reports `codexTokenStale:false` for a valid token. Defect (B) is closed
  on real data: the whole baseline session had reported `true`.

### Root cause of the 22s (auth)

`:727` `slow handler auth:getAuthStatus 22736.4ms` and `:729` `19911.2ms` — the
same 20s of work, correctly shared by two callers. Slow **by design**, then
amplified by contention. Two independent defects in `ClaudeCliDetector`
(`libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts`):

1. **`findExecutable()` had no single-flight.** `cachedInstallation` is written
   only when the whole strategy chain finishes, so concurrent callers each ran
   the entire chain — spawns included — before any of them populated the cache.
   This is a DI singleton (`register.ts:164`, `Lifecycle.Singleton`) with FOUR
   boot-time consumers, and the log shows all four inside the 22s window:
   `AuthRpcHandlers.probeClaudeCli` (:612), `CliStrategy` (:711),
   `SdkAgentAdapter` (:716-717), `SdkModuleLoader` (:746).
2. **`performHealthCheck()` re-spawned `--version` on a binary
   `findExecutable()` had just verified.** `verifyInstallation` runs
   `claude --version` and parses that exact output; the health check then ran it
   again. Two spawns per caller to answer one question.

`claude.exe` is 253 MB and `child_process.spawn` is synchronous inside libuv, so
each spawn is a ~1.9s `CreateProcessW` freeze of the Electron main thread
(TASK_2026_341's measurement). Four callers x up to two spawns is the 22s, and
the log carries the matching signature beside it — `[event-loop] lag` of 1000.9,
1053.3, 2357.2, 2081.4 and 2183.1 ms at `:699,707,709,710,724`.

**Separating "by design" from "contended":** the machine was under build load,
and that inflated each spawn. But contention does not create six redundant
spawns; it only makes each one cost more. The redundancy is unconditional and
reproducible on an idle machine, which is why the fix is deduplication rather
than a bigger timeout.

### What changed (auth)

**`claude-cli-detector.ts`** — the fix belongs here, not in the handler, because
three of the four victims are not RPC callers at all:

- `findExecutable()` is single-flight via `detectionInFlight`, released **by
  identity** so a `clearCache()` mid-detection cannot evict the run that
  replaced it.
- New `probeVersion(command, timeout)`: every `--version` call
  (`verifyInstallation`, `performHealthCheck`, `detectInSystemPath`) goes
  through it. It shares the settled result for `VERSION_PROBE_TTL_MS` (30s) and
  shares the running spawn with any concurrent caller. **Successes only** — a
  failed probe is not evidence the CLI is absent, and retrying costs one spawn.
- `clearCache()` drops the version results too. Keeping them would answer a
  caller that asked for a fresh detection from the evidence it asked to discard.

The 30s window is deliberately short and is NOT a health cache; the handler's
5-minute memo remains the health cache. `OffThreadProcessSpawner` was considered
and rejected for this path: its worker uses raw `child_process.spawn`, which
would break the Windows `.cmd` shim resolution the detector depends on
(`cross-spawn` is load-bearing here per TASK_2026_348), and with the spawns
deduplicated there is one left rather than six.

**`auth-rpc.handlers.ts`** — a hard per-probe ceiling, because the parallel
`Promise.all` removed the SUM of the probe latencies but not the MAX:

- `AUTH_PROBE_TIMEOUT_MS` (5s) caps `probeCopilot`, `probeCodex` and
  `probeClaudeCli`. A probe that trips it is **not cancelled** — a spawn is
  already running, and letting it finish is what populates the memo so the next
  caller is fast instead of paying the same timeout again.
- The Claude-CLI fallback is the **last known verdict**, not a fabricated
  `false`. An expired memo is still the best answer available; reporting "not
  installed" on the evidence of a slow spawn flips the auth badge and can bounce
  the user to a setup screen. `false` is used only when nothing was ever known.
- `probeSecrets` is deliberately NOT capped: a local secret-store read with no
  cheap fallback, where a timeout would fabricate "no credentials" — the one
  answer that changes which screen the user sees.
- New `claudeCliProbe` single-flights the health check so a caller arriving
  while one is stuck joins it. `invalidateAuthStatusCache()` drops it alongside
  `statusInFlight`, for the same reason.
- The `cacheGeneration` design is untouched. Every write-back stays
  generation-conditional and the in-flight map is still deleted by identity.

This addresses (c) — "a slow probe must not block the first render" — by
bounding it at 5s with a truthful last-known answer, not by returning a partial
payload and pushing an update later. That would need a push channel and is a
redesign the review did not ask for.

### Root cause (git) — `log-after.log:997`

`[ERROR] [GitInfoService] getGitInfo failed` with a trailing space and nothing
after it. **Not a race in TASK_2026_343's new code.** Audited and cleared:
`isMutatingGitCommand(['status', ...])` returns `false`, so a status read cannot
invalidate the entry it is filling; `coalesce()` deletes by identity;
`cachedRead` is generation-guarded; and `getGitInfo` is deliberately
coalesce-only with no settled entry, so there is nothing stale to serve.

The caller is `GitWatcherService.fetchAndPush` (`git-watcher.service.ts:746`) —
the watcher started at `:975` and this is its bootstrap fetch. The watcher's own
`catch` logs a WARN with different wording, so this line came from
`computeGitInfo`'s internal catch, which means `execGit(['status', ...])`
**rejected**: either a spawn `error` event or the 10s `DEFAULT_GIT_TIMEOUT_MS`.

**Which one is unknowable from this log, and that is the actual defect.**
`Logger.error`'s console transport renders only `context.error` (the slot for a
real `Error` instance) and `context.metadata` (`logger.ts:348-352`). This call
passed `{ workspacePath, error }` as a plain object cast
`as unknown as Error`, so at runtime it landed in `actualContext` and the
console dropped it whole — no folder, no reason. The user-visible consequence is
worse than a missing log line: the degraded return says
`isGitRepo:true, branch:'', files:[]`, so the watcher broadcast a
"clean tree, no branch" status indistinguishable from a real one.

Leading candidate is the timeout, and it links back to the auth root cause:
`execGitBuffer`'s timer and the git child's `close` event are both delivered on
the same main-process event loop that the `claude.exe` spawns were freezing in
1-2.3s bursts. A fast `git status` can pass 10s of wall clock without git being
slow at all. Fixing the spawn storm reduces the pressure that produces it.

### What changed (git)

`git-info.service.ts` `computeGitInfo`: the message now carries the workspace
path and the failure inline, and the `Error` instance is passed in the slot the
console transport actually renders. `catch (error: unknown)` with narrowing. The
sibling `as unknown as Error` casts elsewhere in this file are left alone — same
latent defect, out of scope here, and the comment at the fixed site names the
rule for whoever touches them next.

### Results

`npx nx run-many -t test -p @ptah-extension/rpc-handlers
@ptah-extension/auth-providers @ptah-extension/cli-agent-runtime
@ptah-extension/vscode-core` -> **"Running target test for 4 projects"**,
"Successfully ran target test for 4 projects". vscode-core 476/476;
auth-providers 635/635; cli-agent-runtime 500/500; rpc-handlers 2539 passed + 31
skipped. 0 failed.

`@ptah-extension/agent-sdk` is not in that set but holds the detector change, so
it was run separately: 1268 passed + 1 skipped, 0 failed.

Typecheck across all five: **"Successfully ran target typecheck for 5
projects"**. The foreign `chat-streaming` `TS2339` errors that blocked round 2
are not in this set (that lib is not a dependency of any of the five).

Lint across the three edited projects: 0 errors, warnings only — all pre-existing
`max-lines`.

### Tests added

- `claude-cli-detector.spec.ts`, new `probe coalescing` block (5): concurrent
  `findExecutable` callers share one detection; `performHealthCheck` after
  `findExecutable` spawns nothing; concurrent health checks share one spawn; a
  FAILED probe is not reused; `clearCache` drops the version evidence.
- `auth-rpc.handlers.spec.ts`, new `probe timeouts` block (4): a wedged Codex
  probe does not hold the rest of the payload; a timed-out CLI probe answers
  from the last known verdict rather than `false`; a timed-out probe still
  populates the memo for the next caller; a caller arriving while a probe is
  stuck joins it instead of spawning again. The first of these needed a bounded
  microtask drain before stepping the clock — one `advanceTimersByTime` expires
  every probe's timer at once, so a spec that steps it mid-chain times all four
  out and proves nothing about isolating the slow one.
- `git-info.service.spec.ts`, new `failure logging` block (1): the message names
  the workspace and the reason, the second argument is a real `Error`, and the
  call still returns degraded rather than throwing.

### Still open

The fix is verified by unit specs, not by a second smoke boot — this round
diagnosed one and did not produce another. What a re-run should show at
`auth:getAuthStatus`: one `claude --version` spawn for the whole boot instead of
six, no `slow handler` line for the method, and no `[event-loop] lag` run in the
1-2.3s band attributable to CLI detection. If `getGitInfo` fails again, the log
line will now say which folder and why.
