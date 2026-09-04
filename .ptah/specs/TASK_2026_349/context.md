# TASK_2026_349 — Do not send the 1M-context beta header when auth method is Claude CLI

## Evidence

From `tmp/logs/log.log` (single Electron boot, one chat session):

- `log.log:583` — `[AuthManager] Authentication configured: Claude CLI v2.1.247 (credentials managed by CLI at C:\Users\abdal\.local\bin\claude.exe)`
  The active strategy is `CliStrategy`, i.e. `authMethod: claudeCli`.
- `log.log:2312`, `log.log:2349` — `[SdkQueryOptionsBuilder] Enabling 1M context beta for Anthropic direct`
- `log.log:2331`, `log.log:2365` — `[SdkQueryOptionsBuilder] CLI stderr: Warning: Custom betas are only available for API key users. Ignoring provided betas.`

The warning follows each enable line by ~20 lines — the CLI receives `--betas context-1m-2025-08-07`, sees a subscription (OAuth) credential rather than an API key, and drops the beta. Ptah logs an INFO claiming a capability the session does not have, on every query launch.

## Root cause

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1031` — `buildBetas()`.

Its only gate is the _transport_ question:

```ts
const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
const isFirstParty = !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);
```

"Anthropic direct" in that method means **"the base URL points at api.anthropic.com"**, nothing more. It never asks the _credential_ question the CLI actually enforces.

Why an empty `AuthEnv` reads as first-party: `CliStrategy` (`libs/backend/auth-providers/src/lib/auth/strategies/cli.strategy.ts:41`) deliberately sets **no** auth env vars — the CLI reads its own credential store in `~/.claude/`. `AuthManager.doConfigureAuthentication` (`auth-manager.ts:158`) calls `clearAllAuthEnvVars()` first, deleting `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` from both the `AuthEnv` singleton **and** `process.env`. So under `claudeCli` the effective `AuthEnv` is `{}` — no base URL — which the `!baseUrl` branch classifies as first-party, and the beta is sent.

The condition the CLI enforces: betas require an API-key credential. In Ptah terms that is `ANTHROPIC_API_KEY` (ApiKeyStrategy direct path, `api-key.strategy.ts:514`) or `ANTHROPIC_AUTH_TOKEN` (per-provider auth-token path, `api-key.strategy.ts:640`). `claudeCli` supplies neither.

Note `ApiKeyStrategy.configureProxyProvider` writes `ANTHROPIC_API_KEY = ''` (empty string, `api-key.strategy.ts:452`), so blank must count as absent, not present.

## Files

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — the gate (`buildBetas`).
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.betas.spec.ts` — new, focused spec. A separate file rather than an addition to the 1589-line `sdk-query-options-builder.spec.ts`, matching the existing `sdk-query-options-builder.output-style.spec.ts` convention and avoiding conflicts with concurrent work in this lib.

## Plan

1. In `buildBetas`, keep the existing first-party base-URL check as the first gate (a third-party endpoint still gets no betas, for the existing reason: it 400s on Anthropic beta headers).
2. Add a second gate: a non-blank `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in the effective `AuthEnv`. Absent → return `undefined` and log a `debug` line naming the reason, not the misleading `info` "Enabling…" line.
3. Read the credential from the same `AuthEnv` value object every other predicate in the builder uses (`isFirstParty`, `settingSources`, tier env). `process.env` is deliberately **not** consulted as a fallback: `AuthManager` clears those three vars from `process.env` on every `configureAuthentication`, so an ambient key cannot survive a switch to `claudeCli`, and reading it would resurrect a credential the user's chosen auth method deleted.
4. No new shared util, no signature change, no other call site — `buildBetas` is the only beta producer in the repo (`grep 'betas'` over `libs`/`apps` returns this one site plus `experimentalBetaEnv`, which is an unrelated env var).

## Acceptance criteria

- `claudeCli` (empty `AuthEnv`): `options.betas` is `undefined`; no `Enabling 1M context beta` log line is emitted.
- `apiKey` (`ANTHROPIC_API_KEY` set, no base URL): `options.betas` is `['context-1m-2025-08-07']`.
- `ANTHROPIC_AUTH_TOKEN` set on a first-party base URL: `options.betas` is `['context-1m-2025-08-07']`.
- Blank / whitespace-only credential is treated as absent (the proxy path's `ANTHROPIC_API_KEY = ''`).
- Third-party base URL with a credential: still `undefined` (existing behaviour, unchanged).
- Explicit `https://api.anthropic.com` base URL with a credential: `['context-1m-2025-08-07']`.

## Test projects

`@ptah-extension/agent-sdk` — `npx nx run-many -t test -p @ptah-extension/agent-sdk`

## Implementation notes

**The gate.** `buildBetas` now asks two questions in sequence instead of one. The base-URL check is unchanged and stays first (a third-party endpoint 400s on an Anthropic beta header — that gate is about the transport, and it must keep standing on its own). A second check, `hasApiCredential(env)`, follows: a non-blank `ANTHROPIC_API_KEY` **or** `ANTHROPIC_AUTH_TOKEN` on the effective `AuthEnv`. Absent → `undefined`, plus a `debug` line naming the reason. The `info` "Enabling 1M context beta for Anthropic direct" line now fires only when a beta is actually sent, so the log stops asserting a 1M window the session does not have.

`hasApiCredential` is a file-local module function, not a method and not a new `shared` util. It is pure, it has one caller, and exporting it would widen the lib barrel for nothing. `libs/shared`'s `auth-env.utils.ts` was the other candidate home; it was left alone deliberately — nothing outside this builder needs to predict the answer, unlike `includesUserSettingSource`, which exists there precisely because `output-styles` must agree with the builder.

**Blank means absent, and that is load-bearing.** `ApiKeyStrategy.configureProxyProvider` clears the direct key by _assigning_ `ANTHROPIC_API_KEY = ''` rather than deleting it, so a bare presence check (`'ANTHROPIC_API_KEY' in env`) would read a cleared slot as a credential. Both the API key and the auth token are `.trim()`-checked. Two specs pin it.

**No `process.env` fallback, on purpose.** The merged `Options.env` the CLI receives is `{ ...process.env, ...effectiveAuthEnv }`, so it was tempting to gate on the merge instead. `AuthManager.doConfigureAuthentication` deletes all three auth vars from `process.env` as well as the `AuthEnv` singleton before any strategy runs, so an ambient `ANTHROPIC_API_KEY` cannot survive a switch to `claudeCli` — and reading it back would resurrect a credential the user's chosen auth method had just removed. Reading `AuthEnv` alone also keeps this predicate on the same source as every other one in the builder (`isFirstParty`, `settingSources`, the tier env). The reasoning is recorded in the method docblock so the next reader does not re-litigate it silently.

**Scope.** `buildBetas` is the only producer of `Options.betas` in the repo (`grep 'betas'` over `libs`/`apps` returns this call site plus `experimentalBetaEnv`, an unrelated env var on `build-safe-env.ts`). No signature changed; no caller was touched.

**Tests** — `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.betas.spec.ts`, 10 cases, all asserting through `build()` rather than the private helper (the defect was in which questions the option was gated on, so what matters is `betas` reaching `Options`):

- Claude CLI (empty `AuthEnv`) — no beta, **and** no `Enabling 1M context beta` info line, **and** the debug skip line is present.
- `ANTHROPIC_API_KEY` set — beta sent + info line present.
- `ANTHROPIC_AUTH_TOKEN` set — beta sent.
- Explicit `https://api.anthropic.com` + key — beta sent.
- `''` and `'   '` API key, `'  '` auth token — treated as absent.
- Third-party (`openrouter.ai`) **with** a credential — still no beta (regression guard: the credential gate is additional, not a replacement).
- Local proxy (`127.0.0.1:4000`) with a placeholder token — still no beta.

A separate spec file rather than an addition to the 1589-line `sdk-query-options-builder.spec.ts`: it matches the existing `sdk-query-options-builder.output-style.spec.ts` convention and keeps this work off a file other agents are editing concurrently.

**Verification.**

- `npx nx run-many -t test -p @ptah-extension/agent-sdk --skip-nx-cache` — header read `Running target test for project @ptah-extension/agent-sdk` (1 project). 81 passed / 1 skipped of 82 suites, 1212 passed / 1 skipped of 1213 tests.
- `npx nx test @ptah-extension/agent-sdk sdk-query-options-builder.betas` — 1 suite, 10 tests, all passed.
- `npx nx typecheck @ptah-extension/agent-sdk` — clean.

**Pre-existing failure, not caused here and not fixed here.** `tsc --project libs/backend/agent-sdk/tsconfig.spec.json` reports 6 errors in `internal-query/internal-query.service.spec.ts` (`AcquireRequest` / arity). `internal-query.service.ts` and `internal-query.types.ts` are modified in the shared working tree by concurrent work that changed `acquire(...)` to take a request object without updating that spec. Nothing in that path is touched by this task; `grep betas` over the same tsc output is empty.
