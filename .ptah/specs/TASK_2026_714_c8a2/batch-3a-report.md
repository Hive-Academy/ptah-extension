# Batch 3a report — TASK_2026_714_c8a2

Implemented both tasks in the assigned worktree. Production Codex App Server routing remains disabled. No Claude code, registrations, runtime code, task state, or other lane's files changed. No git operations performed.

## Files

Relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`:

- Created `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`.
- Created `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts`.
- Modified `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts`.
- Modified `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts`.
- Created `.ptah/specs/TASK_2026_714_c8a2/batch-3a-report.md` (this report).

## Design and evidence

Code references below use `libs/backend/auth-providers/src/lib/providers/codex/` as their base.

- `codex-home-auth.service.ts:62` implements `CodexHomeAuthReader`, importing the port, home event, and usage eligibility types only through `@ptah-extension/codex-runtime`.
- `codex-home-auth.service.ts:69` supplies `forHost(logger, workspaceProvider)`. A WeakMap shares the owner between facades using the same host workspace-provider instance. This is the interim composition seam until batch 5c; registration files were not touched. The injected facade Logger is passed to the owner, with a structural logger type allowing strict test doubles.
- `codex-home-auth.service.ts:128` keys home state by absolute path. The runtime port requires already-normalized homes, so realpath/case/alias identity remains the runtime's responsibility. Each state owns its cache, generation, refresh flight, failed-token guard, and watcher.
- `codex-home-auth.service.ts:515` holds one flight from the fresh disk read through refresh and atomic persistence. Concurrent same-home calls join it; different homes run independently. `:559` retains the configured OAuth endpoint/client ID, sets a 30-second timeout, validates the response with Zod, and does not retry. An ambiguous failure suppresses retries with that same rotating token until external credentials change.
- `codex-home-auth.service.ts:609` re-reads validated auth immediately before persistence, rejects a changed refresh token or replacement API key, preserves unknown metadata, writes a UUID-named temporary file using `wx` and mode `0600`, renames it atomically, and attempts temporary-file cleanup. This detects external login before persistence; it is not an interprocess filesystem lock against Codex itself.
- `codex-home-auth.service.ts:700` validates auth.json with Zod, preserves the five-second cache behavior, and does not include file contents or raw parse errors in logs. Credentials stay inside private state and the existing backend authorization-header compatibility API. The runtime reader and its events never return credentials.
- `codex-home-auth.service.ts:96` makes cancellation local to the requesting waiter, so another consumer's token rotation can finish and persist safely. Abort listeners are removed on cancellation or completion.
- `codex-home-auth.service.ts:113` reference-counts subscriptions. Final disposal closes the watcher and clears its debounce timer. Events contain only `{home, generation, kind}`. Listener exceptions do not fail a refresh. The facade emits the existing provider-only SDK event only for external changes to its selected default home; self-refresh remains suppressed for legacy consumers.
- `codex-auth.service.ts:19` is the compatibility facade. It contains no credential cache, refresh mutex, or writer. Existing endpoint/model/header/status behavior was moved into the owner's private per-home state, without introducing another exported implementation.

## Home-resolution evidence

`codex-home-auth.service.ts:46` documents and implements one exported `resolveCodexHome`: trim CODEX_HOME, resolve it against the host cwd to an absolute path, otherwise use `os.homedir()/.codex`. It does not choose HOME ahead of the Windows OS profile. Resolution is captured when constructing the default facade.

Evidence used: the supplied `code-logic-review-batch-2c.md` findings 1–3 document Codex's OS-profile behavior and the existing inconsistent call sites. `libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:45` corroborates the homedir fallback and whitespace-only environment rejection; its actual implementation returns nonblank environment values without trimming them. The new resolver deliberately trims those values as explicitly requested. Its tests inject conflicting HOME/USERPROFILE values and an OS-home function, plus relative and whitespace-only CODEX_HOME.

The existing injected `CodexHomeResolver` constructor argument remains accepted. When it represents the current process default, the facade applies the new resolver; explicit injected homes retain their captured identity. This avoids modifying the resolver registration in the scope owned by 5c.

## Existing callers unchanged

The constructor's four dependencies and all `ICodexAuthService` methods remain available. The original 55 behavior tests still pass without relaxing their assertions; the spec adds only the unlink mock required by temporary-file cleanup and a regression test for retrying watcher startup after the default home appears.

Source evidence:

- `providers/codex/codex-translation-proxy.ts:78`, `:85`, `:94` still call `getApiEndpoint`, `getHeaders`, and `ensureTokensFresh` on the same injected facade. Proxy refresh therefore uses the same home flight and writer as the native port.
- `auth/provider-auth-resolver.ts:314` still calls `isAuthenticated` and `ensureTokensFresh`.
- `providers/codex/codex-account-usage.service.ts:159` still calls `getAccountUsageEligibility`.
- `providers/register-providers.ts:83` still registers `CodexAuthService` using the existing class binding. No new DI token is required in this batch.
- API key precedence, OAuth settings, model client-version selection, stale-token handling, header shape, cache clearing, and legacy event payload are covered by the retained facade specs.

## Specs

`codex-auth.service.spec.ts`: 56 tests (55 retained, one new regression for absent-home watcher retry).

`codex-home-auth.service.spec.ts`: seven tests covering trimmed/default home resolution; strict auth boundary and per-home cache isolation; same-home single-flight and cross-home disk isolation; timeout configuration and metadata preservation; no retry after ambiguous token rotation and sanitized logging; refusing external-login overwrite; cancellation isolation; and scoped credential-free events with subscription disposal. Some tests cover multiple related assertions.

## Verification

Commands ran sequentially, scoped to this project, with the requested concurrency. PowerShell `Select-Object -Last` / `Select-String` were used as the shell equivalents of tail/grep. Full output was retained under the OS temporary directory rather than the repository.

1. `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts --coverage=false --maxWorkers=2`
   - Final exit **0**; **2 suites passed, 63 tests passed**, no snapshots; **14.929 s**.
   - Existing Node warning about loading jest.config.ts as an ES module remains; it does not fail the run.
   - Initial verification found two strict test-double typing errors and a missing legacy re-login warning. Those were fixed before the passing runs. A later final run includes the watcher-startup regression.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/auth-providers --parallel=1 --output-style=static`
   - Final exit **1**. Typecheck passes; **only lint is listed as failed**.
   - Lint: **10 problems (1 error, 9 warnings)**. Sole error: `libs/backend/auth-providers/package.json:8` lacks the required `@ptah-extension/codex-runtime` dependency (`@nx/dependency-checks`). Package.json is outside the four authorized source/spec paths, so it was not modified. Existing warnings are outside the changed files.
3. `npx prettier --write` on all four changed source/spec files, after the checks: **exit 0**. Final owner files unchanged by this last format pass; facade and its spec formatted.
4. Required scoped `ptah_get_diagnostics`: **unavailable**, TypeScript still running after 45 seconds, two files unchecked. This was not treated as a pass; the required scoped Nx typecheck subsequently completed successfully.

No workspace-wide checks, build, e2e, dependency installation, or git commands ran.

## Decisions

- **Shared host owner via `forHost` until 5c.** Options: per-facade independent owner or shared owner keyed by the existing workspace-provider dependency. Chose shared ownership to preserve one refresh writer and existing constructor/registration contracts. Evidence: batch 3a explicitly defers registration changes. Reversible when 5c installs a single registered owner using this same seam.
- **Preserve legacy backend authorization headers; keep the native port credential-free.** Removing getHeaders would break the authorized compatibility contract. No new credential DTO or raw-auth accessor is exported. Evidence: unchanged translation-proxy callers and runtime port. Reversible only when legacy routing is explicitly removed in a later batch.
- **Waiter-local abort and conservative refresh-failure latch.** Options: abort the shared rotation for every consumer or detach only the cancelled waiter; retry the same rotating token or require changed credentials after an ambiguous failure. Chose isolated cancellation and no blind retry. Evidence: plan section 3 and batch 3a concurrency/rotating-token requirements. Internal policy is reversible with new protocol evidence.
- **Do not modify package.json to silence lint.** Options: breach the explicit file boundary or report the missing dependency. Chose reporting; the required public runtime import is retained. This is the only verification blocker.

## Follow-ups

1. Coordinating lane must authorize/update `libs/backend/auth-providers/package.json` with `@ptah-extension/codex-runtime: 0.0.1`, then rerun scoped lint. The current batch cannot be reported as fully green until this is done.
2. Switch `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` home resolution to the shared resolver. Ensure the resolved absolute home is passed to the spawned Codex process so relative paths cannot diverge with spawn cwd.
3. Switch `libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts` default resolution to the shared resolver while retaining its explicit test override semantics. Both migrations were explicitly excluded from this batch.
4. Batch 5c must expose/register the shared owner and resolver without creating a second owner alongside `forHost`; align the existing CodexHomeResolver/usage-service identity with the canonical resolver, particularly for whitespace CODEX_HOME. Registration, public barrel, and provider-owner files remain untouched here.
