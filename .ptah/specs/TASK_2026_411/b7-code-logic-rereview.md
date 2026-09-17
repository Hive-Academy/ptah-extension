# Code Logic Re-Review — `TASK_2026_411` Batch B7 (post-fix)

## Summary

| Metric | Value |
| --- | --- |
| Verdict | DEFECTS (non-blocking; all original findings genuinely fixed) |
| Original findings re-verified fixed | 7/7 |
| New / residual issues found | 4 (0 Blocking, 1 Serious, 2 Moderate, 1 Minor) |

All seven items in `b7-fixes-report.md` are fixed and regression-covered exactly as
claimed. This re-review's job past that point is to look for what the fix pass
introduced or left behind; it found one user-visible defect in code that was already
part of B7 (not touched by the fix commit) and three narrow, bounded timing quirks in
the new concurrency code.

## Verification of each original finding

### 1. Concurrency: single-flight, active/closing sets, closeChild scoping

**Fixed**, `codex-account-usage.service.ts:49-51,75-84,178-192`.

- `readInFlight` is set synchronously in the same turn the cache/readInFlight checks
  run (no `await` between the check and the assignment once eligibility resolves), so
  two calls arriving in the same microtask batch cannot both start a read — verified by
  reading the code, not just trusting the test: `getAccountUsage` awaits
  `getAccountUsageEligibility()` once, then the rest of the function is synchronous
  until the next `await read`, which is exactly what JS's single-threaded continuation
  model guarantees is race-free. `codex-account-usage.service.spec.ts:171-187` proves
  three overlapping callers (including one `refresh: true`) collapse into one
  `app-server` spawn and get the identical result object (`toBe`, not `toEqual`).
- `readInFlight` is cleared in a `finally` regardless of outcome
  (`codex-account-usage.service.ts:78-80`), and `performRead` itself never rejects (all
  errors are caught and turned into a status result), so a failure cannot wedge future
  reads — confirmed by inspection, no test needed to add confidence here since the
  invariant is structural.
- `closeChild` is scoped to the specific `SpawnedProcessHandle` passed in, not a shared
  field, and is idempotent via the `closing` map keyed by the same handle
  (`codex-account-usage.service.ts:178-192`). `codex-account-usage.service.spec.ts:189-200`
  drives two coalesced callers through `close()` and asserts the owned child's `kill()`
  fires exactly once — this is a genuine regression spec: reverting to the old
  `this.active`-field version of `closeChild` would make this assertion fail because the
  second caller's `finally` would try to kill whatever child happens to be in the shared
  field at that time.
- No orphan on the success, timeout, abort, external-close, or close-during-version-check
  paths: `readProcessOutput`'s `fail()` always calls `child.kill()` before rejecting
  (`codex-account-usage.service.ts:199-203`), `assertVersion`'s `--version` child is now
  tracked in `active` via `spawn()` (`codex-account-usage.service.ts:149-158`), and
  `close()` closes everything still in `active` (`codex-account-usage.service.ts:83-85`).
  `codex-account-usage.service.spec.ts:202-210` pins the version-child case specifically.
- Bounded collections: `active` entries are removed on the child's own `close` event
  (`codex-account-usage.service.ts:156`) or explicitly in `closeChild`
  (`codex-account-usage.service.ts:182`); `closing` entries are removed via
  `.finally()` (`codex-account-usage.service.ts:189`). No path adds without a
  corresponding remove.
- "Refresh joining a read cannot return data older than the refresh intent": since the
  joined read always talks to a live App Server process (not a snapshot), the auth file
  is read fresh regardless of which caller's `refresh` flag started the spawn — this
  holds structurally, not by luck.

**Residual (new) findings on this code, below**: a first-caller-wins `AbortSignal`
problem, and a narrow non-orphaning timing gap in `assertVersion`.

### 2. Provider-switch staleness guard

**Fixed**, `provider-account-state.service.ts:11,18-30`. `loadGeneration` and the
captured `providerId` are both checked before `_result.set(...)`
(`provider-account-state.service.ts:25`), and `_loading` is only cleared when the
generation still matches (`provider-account-state.service.ts:30`), so a stale call's
`finally` cannot clobber a newer call's loading flag. `provider-account-state.service.spec.ts:28-47`
is a genuine regression spec: it defers the RPC response, flips the provider signal
before resolving, and asserts `result()` stays `null` — reverting to the unconditional
`_result.set(response.data)` would make this fail.

**However**, see Serious finding below: this guard stops a stale write, but nothing in
this component tree re-issues `load()` when the provider changes, so switching *to*
Codex after the initial load can leave the card showing an unrelated status
indefinitely. That is a different gap than the one the original review flagged and
remains open.

### 3. int64 precision preservation

**Fixed and scoped correctly.** `preserveAccountUsageInt64`
(`codex-account-usage.service.ts:34-39`) is applied only to the raw line when
`pendingMethod === 'account/usage/read'` (`codex-account-usage.service.ts:241-242`),
i.e. only to the one response object keyed by that pending request's `id`, never to
`account/read` or `account/rateLimits/read` payloads and never to unrelated App Server
notifications. Checked the regex against the failure modes the task called out:

- Nested/unrelated JSON: scoped by method, so a `tokens`-named field inside a different
  RPC method's response is untouched — verified by reading `createRpcClient`, which only
  substitutes the parsed envelope for the one method.
- Strings containing digits that merely *look* like the pattern: the regex requires the
  literal key name in quotes immediately followed by `:` and only digits (`-?\d+`); a
  string value such as `"note":"tokens: 5"` does not match because the field name token
  itself is `note`, not `tokens`.
- Negative numbers: handled (`-?`). Exponents: not handled, but int64 JSON integers are
  never wire-serialized in exponential form, and the schema (`int64Decimal`) would reject
  a non-digit-string. Decimals: not addressed and not expected for a token-count int64.
  Fine as scoped.
- Zod projects to decimal strings end-to-end: `codex-account.schemas.ts:12-15`
  (`int64Decimal`, accepts either a pre-quoted digit string or a JS-safe integer,
  `.transform(String)`), and `ProviderGetAccountUsageResult.activity.lifetimeTokens` /
  `.tokens` are `string` in `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:172-175`
  — dashboard and card both consume the string (`provider-account-card.component.ts:30`
  interpolates it directly, no numeric coercion).
- `codex-account-usage.service.spec.ts:212-221` is a genuine regression: it injects raw
  unquoted digits above `2^53` (`9007199254740993` / `...995`) into the wire line before
  `JSON.parse`, and asserts the exact string round-trips. Without the fix, `JSON.parse`
  on the raw line would silently round both values before Zod ever saw them.

One scope question worth naming, not a defect: the regex list
(`lifetimeTokens|peakDailyTokens|longestRunningTurnSec|currentStreakDays|longestStreakDays|tokens`)
must exactly track the schema's `int64Decimal` fields
(`codex-account.schemas.ts:58-65`) — it does today, but the two lists are maintained by
hand in two files with no shared source. A future int64 field added to the schema
without updating the regex would parse-fail cleanly (Zod would reject the now-imprecise
number if it exceeds `.safe()`), not silently corrupt — so the failure mode of drift is
loud, not silent. Minor, not counted as a defect.

### 4. Version-check child closable exactly once

**Fixed**, tracked in `active` via `spawn()` (`codex-account-usage.service.ts:149-158`),
verified by `codex-account-usage.service.spec.ts:202-210`. See the residual timing note
below for the one narrow gap this still leaves.

### 5. Resolver seams unreachable from production

**Confirmed.** `CODEX_HOME_OVERRIDE` / `CODEX_ENV_OVERRIDE` / `CODEX_HOMEDIR_OVERRIDE`
(`auth-providers-tokens/src/lib/tokens.ts:26-28`) are referenced only as
`{ isOptional: true }` injections in `codex-home-resolver.ts:12-17` and are never
registered anywhere in `register-providers.ts` or any other non-spec file (grepped the
whole `auth-providers` + `auth-providers-tokens` trees, zero non-spec matches beyond the
declaration and the resolver itself). Production always falls through to `process.env`
and `homedir()` (`codex-home-resolver.ts:19-21`). `codex-home-resolver.spec.ts` has the
four cases the fix report claims: override precedence, `CODEX_HOME` env, homedir
fallback, and resolve-once-on-construction.

### 6. Windows case-insensitive home comparison

**Fixed and correctly scoped to `win32` only** — `samePath`
(`codex-account-usage.service.ts:29-32`) compares lowercased only when
`process.platform === 'win32'`, exact-cased otherwise, so this cannot false-match two
genuinely different paths on Linux/macOS that merely differ in case (e.g. a
case-sensitive filesystem with two distinct directories). `codex-account-usage.service.spec.ts:223-226`
covers only the drive-letter-case scenario on the synthetic path; no test asserts the
*negative* (that two actually-different paths still fail the check on Windows), but the
implementation is straightforward enough that this is a Minor coverage gap, not a logic
defect.

### 7. `staleSince` on refresh failure

**Fixed.** `performRead`'s catch branch returns
`{ ...this.cached, status: 'stale', staleSince: Date.now() }`
(`codex-account-usage.service.ts:101`), the shared type carries it
(`rpc-providers.types.ts:166`), and the card renders it
(`provider-account-card.component.ts:34`, `date:'medium'` pipe). No regression spec
targets this exact branch directly (the fix report cites "full auth-provider/dashboard
suites and Angular compilation" rather than a scenario-specific spec), but the shape is
simple enough that this is a Minor test-coverage note, not a logic gap.

## New / residual findings

### Serious: provider switch to Codex after initial load does not refresh the card

- File: `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:47`
  (`ngOnInit(): void { void this.state.load(); }`), consumed once by
  `analytics-card.component.ts:70` (`ngOnInit` → `loadDashboardData()`, no watcher on
  provider identity anywhere in this component tree).
- Trigger: the dashboard/analytics card mounts once while some other provider (e.g.
  `anthropic`) is active. `ProviderAccountCardComponent.ngOnInit` calls `load()`, which
  captures `providerId = 'anthropic'` and gets back
  `{ status: 'provider-unsupported', providerId: 'anthropic' }` from the RPC handler
  (`provider-rpc.handlers.ts:159-161` returns early for any non-Codex `providerId`). The
  user then switches the active provider to Codex without navigating away from — or
  recreating — the dashboard.
- Symptom: `state.isCodex()` flips to `true` so the section now renders, but
  `state.result()` still holds the stale `provider-unsupported` record from the earlier
  load. The template's status branch (`provider-account-card.component.ts:35-37`) renders
  "Account usage unavailable: provider-unsupported" — a message that is actively wrong,
  not merely blank, for a Codex account that is in fact reachable. Nothing re-triggers
  `load()`; the user must notice and click "Refresh" themselves to see real data.
- Evidence: no `effect()`, no `computed`-driven reload, and no subscription to
  `auth.persistedProviderId()` anywhere in `provider-account-state.service.ts` or
  `provider-account-card.component.ts` beyond the one `isCodex` computed used purely for
  template visibility.
- Current handling: none. The B7 staleness-guard fix (finding 2 above) protects against
  a stale RPC *response* overwriting fresher state, but does not address a stale
  *request* — i.e., no request for the new provider was ever issued.
- Impact: this is user-visible and plausible (switching providers is a normal action,
  and nothing forces a full page/component reload afterward in an SPA shell) — it is not
  a hidden edge case. Rated Serious rather than Moderate because the symptom is an
  incorrect status message shown with no indication of staleness, on a path the batch's
  own review explicitly named ("provider switch") — the fix addressed the write-race half
  of that requirement but not the trigger half.
- Fix: add an `effect()` (or a `computed` + subscription) in
  `ProviderAccountStateService` or the card component that calls `load()` whenever
  `auth.persistedProviderId()` transitions to `'openai-codex'` from something else (and
  ideally resets `_result` to `null` on any provider change so the card shows the
  loading spinner rather than a stale/wrong status while the new load is in flight).

### Moderate: joined callers' `AbortSignal` is silently ignored

- File: `codex-account-usage.service.ts:75-77` (`if (this.readInFlight) return this.readInFlight;` — no `signal` handling) vs. `codex-account-usage.service.ts:87` (`performRead(signal)` — only the *first* caller's signal is ever wired into `readFromAppServer`/`createRpcClient`/`readProcessOutput`).
- Trigger: caller A starts a read with no signal (or a long-lived one); caller B joins
  the same `readInFlight` a moment later with its own `AbortSignal` (e.g. a webview panel
  passing a signal tied to component destruction).
- Symptom: if caller B's signal later fires, nothing observes it — the underlying
  request keeps running under caller A's signal (or none), and caller B's returned
  promise still resolves normally with whatever the shared read produces. A caller that
  expected "abort" to mean "I will not receive/use this result" instead silently
  receives it late. This does not leak a process (A's signal or the timeout still governs
  cleanup) and does not corrupt data — it is a control-flow gap, not a data-integrity one,
  which is why this is Moderate rather than Serious.
- Evidence: `getAccountUsage` never merges/collects signals from joiners; `performRead`
  is invoked once, with only the first caller's `options.signal`.
- Current handling: none.
- Fix: either document that only the initiating caller's signal is honored while a read
  is shared (acceptable if intentional), or track all joined signals and reject the
  joined promise locally (without killing the shared read) when a given caller's own
  signal fires.

### Moderate: `assertVersion`'s narrow untracked-cleanup window

- File: `codex-account-usage.service.ts:160-176`, specifically the inner
  `finally { this.active.delete(child); }` at line 167, which runs as soon as
  `readProcessOutput` settles.
- Trigger: `readProcessOutput`'s `fail()` path (timeout, abort, stream error) calls
  `child.kill()` and rejects synchronously in the same tick
  (`codex-account-usage.service.ts:199-203`); `assertVersion`'s `finally` then removes
  the child from `active` immediately, before the OS has necessarily delivered the
  process's actual `close` event.
- Symptom: if the public `close()` API is invoked in that narrow window (e.g. host
  shutdown racing a version-check timeout), the version-check child is no longer in
  `active`, so `close()` will not await/track it — though `kill()` was already issued
  moments earlier by `fail()`, so this is not an orphan in the sense of "never killed,"
  only "not awaited by a concurrent external `close()` call." Bounded and low-impact, but
  it is the same shape of gap the original review flagged for this method, now narrowed
  rather than eliminated.
- Evidence: `codex-account-usage.service.spec.ts:202-210` only exercises the case where
  `close()` races a *silent* (never-responding) version child, which is still in
  `active` at that point — it does not exercise the fail()-already-fired-kill() race, so
  this narrower window has no regression coverage either way.
- Current handling: harmless in practice (kill already issued) but undocumented.
- Fix: either remove the child from `active` only on the child's own `close` event (relying
  solely on the listener registered in `spawn()`, and dropping the extra `finally`
  deletion), or explicitly document that the early removal is deliberate and safe because
  `kill()` always precedes it on every path that removes early.

### Minor: `preserveAccountUsageInt64` field list and schema `int64Decimal` fields are two hand-maintained lists

- Files: `codex-account-usage.service.ts:34-39` vs. `codex-account.schemas.ts:58-65`.
- Already covered under finding 3 above; recorded here only for the issue list. Failure
  mode is loud (Zod rejection on an oversized plain number), not silent, so this is
  Minor.

## New risk checks (fix-pass diff, package.json, secrets)

- `libs/backend/auth-providers/package.json`: adds `"@openai/codex": "0.147.0"` as a
  direct dependency (used by `packagedCodexScript()` via
  `require.resolve('@openai/codex/package.json')`,
  `codex-account-usage.service.ts:41-44`). `package-lock.json` has **zero diff** — this
  package was already resolved in the lockfile as a dependency of the already-present
  `@openai/codex-sdk` (root `package.json:117`), confirmed at
  `package-lock.json:11907-11985` (`@openai/codex-sdk` → `dependencies: { "@openai/codex": "0.147.0" }`).
  Making an existing transitive dependency explicit is safe and does not add a new
  runtime dependency to the tree; no `exports`/`sideEffects` field was touched
  (`git diff` shows only the one added line).
- `.ptah/specs/TASK_2026_411/agent-output-root.md`: three short status lines, no paths
  outside the repo, no secrets, no real account data.
- No `libs/backend/auth-providers/src/lib/translation/**` file appears in the actual
  `git status` diff for this worktree beyond what B6 already owns — confirmed the fix
  pass did not touch that tree.
- DI resolvability: `CodexAccountUsageService`'s constructor
  (`codex-account-usage.service.ts:53-59`) has every parameter `@inject`-decorated
  explicitly (`TOKENS.LOGGER`, `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH`,
  `AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER`, `SDK_TOKENS.SDK_PROCESS_SPAWNER`,
  `SDK_TOKENS.SDK_ADAPTER_EVENTS`) — no bare-`Object` TypeInfo risk.
  `CodexHomeResolver`'s three constructor params are also all `@inject(..., { isOptional: true })`
  decorated (`codex-home-resolver.ts:11-17`). `register-providers.ts:42-46` registers
  `SDK_CODEX_HOME_RESOLVER` before `SDK_CODEX_AUTH`/`SDK_CODEX_ACCOUNT_USAGE`, consistent
  with the file's own "register before AuthManager resolves" ordering rule.
- Angular: `ProviderAccountCardComponent` and `ProviderAccountStateService` are both
  `standalone`, `OnPush` (`provider-account-card.component.ts:9`), signals +
  `inject()`, no `[innerHTML]`, plain interpolation only for AI-adjacent but
  numeric/string account data (not markdown, so the markdown chokepoint rule doesn't
  apply here).
- `catch (error: unknown)`: not applicable in the reviewed files — `performRead`'s catch
  uses `error: unknown` correctly (`codex-account-usage.service.ts:92`) and narrows via
  `instanceof AppServerError`.
- No credential/token/raw-response logging: `performRead`'s `logger.warn` call only logs
  `{ status }` (`codex-account-usage.service.ts:100`); `codex-account-usage.service.spec.ts:124,145,151`
  assert the logger output never contains the raw error text or spawn failure message.

## Verdict

- Recommendation: the Serious finding (provider-switch reload gap) and the two Moderate
  findings (joined-signal handling, narrow version-child cleanup window) are real and
  should be looked at, but none of them reopens the original Serious concurrency defect
  or the original staleness-write defect — both of those are genuinely fixed with
  regression specs that would fail on a revert. This is not a request to redo the fix
  pass; it is a request to close the one user-visible gap (provider-switch reload) before
  sign-off, with the two Moderate items as fast follow-ups if time is short.
- Confidence: HIGH on the concurrency/staleness/int64/version-child verification (read
  every changed line and the tests that pin them); MEDIUM on the provider-switch-reload
  finding's real-world reachability (depends on whether the dashboard component tree is
  ever kept mounted across a provider switch in the actual app shell, which this review
  did not runtime-verify — but nothing in the code prevents it, and nothing forces a
  remount).
- Top risk: a user who switches their active provider to Codex from an existing
  dashboard session sees an incorrect "Account usage unavailable: provider-unsupported"
  message instead of their real quota/activity, with no visual cue that a reload would
  fix it.
