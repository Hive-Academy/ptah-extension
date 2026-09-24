# TASK_2026_538 — Batch B report (backend-developer)

Cursor CLI adapter reads its API key from env `CURSOR_API_KEY` or the injected
secrets resolver; the `~/.ptah/settings.json` read is gone.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:9-11` — header comment now says the key comes from env or the injected resolver (secrets store), not `provider.cursor.apiKey` in settings.json.
- `cursor-cli.adapter.ts:17` — removed the `readFileSync`/`homedir`/`join` imports (module no longer touches the filesystem for the key).
- `cursor-cli.adapter.ts:178-182` — constructor takes `resolveApiKey?: () => Promise<string | undefined>` after the optional logger.
- `cursor-cli.adapter.ts:192-208` — `resolveCursorApiKey()` is now a private async method: env key (trimmed, non-blank) first, then the resolver value (trimmed, non-blank); a resolver throw is caught, logged as a fixed text only, and treated as no key.
- `cursor-cli.adapter.ts:213` — `detect()` awaits the new resolution.
- `cursor-cli.adapter.ts:234` — `ensureTokensFresh()` awaits the new resolution.
- `cursor-cli.adapter.ts:261` — `listModels()` awaits the new resolution.
- `cursor-cli.adapter.ts:310-313` — `runSdk()`'s `runTurn` awaits the new resolution; missing-key error message now says "Set CURSOR_API_KEY or save the key in Ptah settings (stored in the secrets store)".
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:10-13` — imports `IAuthSecretsService` from `@ptah-extension/vscode-core`.
- `cli-detection.service.ts:53-54` — constructor injects `@inject(TOKENS.AUTH_SECRETS_SERVICE) authSecrets: IAuthSecretsService`.
- `cli-detection.service.ts:66-70` — passes `() => this.authSecrets.getProviderKey('cursor')` to `new CursorCliAdapter(...)`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.spec.ts` — resolver mock wired into construction; new resolution-order tests; fs module mocked so any reintroduced settings read fails the suite; run-path key assertions; five abort/interrupt tests got a third microtask tick (see constraints).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts` — 4th constructor argument (authSecrets mock) added to direct construction; new wiring test.

## Read-path trace

Former callers of `resolveCursorApiKey()` (the function was module-private; a repo-wide grep found no caller outside `cursor-cli.adapter.ts`):

- `detect()` gate → `await this.resolveCursorApiKey()` (`cursor-cli.adapter.ts:213`)
- `ensureTokensFresh()` (called by `CliDetectionService.refreshCliTokens`) → `await this.resolveCursorApiKey()` (`cursor-cli.adapter.ts:234`)
- `listModels()` (called by `CliDetectionService.listModelsForAll`) → `await this.resolveCursorApiKey()` (`cursor-cli.adapter.ts:261`)
- `runSdk()` → `runTurn()` (spawn/continue path) → `await this.resolveCursorApiKey()` (`cursor-cli.adapter.ts:310`)

Resolver source: `CliDetectionService` → `authSecrets.getProviderKey('cursor')` via `TOKENS.AUTH_SECRETS_SERVICE` (`cli-detection.service.ts:66-70`). Both DI smoke specs (`register.ptah-cli-registry.smoke.spec.ts:73`, `register.agent-process-manager.smoke.spec.ts:60`) already register that token, so container resolution is unchanged. No other spec in `cli-agent-runtime` constructs `CliDetectionService` or `CursorCliAdapter` directly (the other service specs mock `CliDetectionService`), so no further construction fixes were needed.

## Tests

New/updated in `cursor-cli.adapter.spec.ts`:

- prefers CURSOR_API_KEY over the resolver value
- uses the resolver value (trimmed) when CURSOR_API_KEY is unset
- reports no key when both env and resolver values are blank
- treats a throwing resolver as no key and logs only a fixed text
- logs a fixed text without error detail when the resolver throws
- never reads ~/.ptah/settings.json for the key (fs module mocked; readFileSync must not be called)
- reports installed when CURSOR_API_KEY is set / NOT installed when no key is resolvable (detect gating)
- ensureTokensFresh() reflects API key presence
- passes the resolver-provided key to Agent.create when env is unset (run path)
- resolves done with 1 and emits an error segment on missing API key (run path, new message)

New in `cli-detection.service.spec.ts`:

- constructs the Cursor adapter with a resolver over getProviderKey("cursor")

## Verification

Command: `npx nx run-many -t test lint typecheck -p @ptah-extension/cli-agent-runtime --skip-nx-cache`

- Header: `Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime` (1 project)
- `@ptah-extension/cli-agent-runtime:test` — pass: Test Suites: 64 passed, 64 total; Tests: 1 skipped, 1024 passed, 1025 total
- `@ptah-extension/cli-agent-runtime:lint` — pass
- `@ptah-extension/cli-agent-runtime:typecheck` — pass

## Lane-introduced constraints

- The adapter's key resolution is now async on every path (env hit included), which adds one microtask hop before `Agent.create`/`send` wiring in `runSdk()`. Five existing spec tests (`cancels the run on abort…`, `closes the agent on abort…`, `reports supportsInterrupt() true`, `cancels the active run…`, `rejects when cancel() fails…`) raced that wiring with two `await Promise.resolve()` ticks and were bumped to three. Test-only; no production behaviour changed by this.
- `CursorCliAdapter`'s resolver parameter is optional so the constructor stays backward-compatible with logger-only construction, but `CliDetectionService` is now the only production wiring and always passes the secrets-backed resolver.
- The spec mocks the whole `fs` module (`readFileSync` becomes a no-op jest.fn); if a future transitive import in this spec's module graph legitimately needs `readFileSync` at test time, that mock must be revisited.

## git status

```
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts
```