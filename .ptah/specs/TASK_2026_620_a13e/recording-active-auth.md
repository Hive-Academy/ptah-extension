# Record-mode active Codex auth

## Active-auth trace

`ActiveProviderResolver.resolveActiveAuth()` reads the ambient workspace scope
with `scope.read('authMethod', true)` and, unless it is `apiKey` or
`claudeCli`, resolves `scope.read('anthropicProviderId', true)`:
`libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:25-41`.

The required isolated product settings are therefore:

```json
{
  "ptah": {
    "authMethod": "thirdParty",
    "anthropicProviderId": "openai-codex"
  }
}
```

`AuthManager` maps `thirdParty` through that resolver and selects the provider
strategy (`libs/backend/auth-providers/src/lib/auth/auth-manager.ts:254-277`).
For `openai-codex`, `OAuthProxyStrategy` verifies the copied file-based Codex
login and starts the Codex translation proxy
(`libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:163-248`).

`SdkAgentAdapter.doInitialize()` resolves the active auth and immediately calls
`configureAuthentication(active.authMethod)`
(`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:455-478`); a false result
publishes error health. The bench host calls the readiness gate only after
`boot()` returns (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:281-341`).
Thus a post-boot setting write would be too late for the initial pass and would
need a re-initialize/config-change event. The selected settings are instead
seeded before engine boot.

## Change

Record mode now writes `authMethod: "thirdParty"` and
`anthropicProviderId: "openai-codex"` beside the existing unreachable OAuth
endpoint in the isolated `<userDataPath>/config.json`, under `ptah`
(`tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts:57-103`).
The host calls this before engine boot only when `cassetteMode === 'record'`
(`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:285-293`). This
is the same isolated `config.json` product-settings route already used by the
recording bootstrap; it is not `settings.json`, and no auth value is placed in
a plan, cassette, or repository.

No plan JSON change is required for the orchestrator. The plan settings remain
the curator choices such as `memory.curatorProvider` and
`memory.curatorModel`; the active-auth selection is fixed bootstrap
configuration derived from the copied Codex OAuth login.

Fatal failures after the plan is accepted now write redacted message/stack text
to `<runDir>/host-error.txt` before rethrowing
(`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:101,397,473-486`).
This covers boot failures and the SDK readiness gate without changing the
619-owned completion schema or runner code.

## Specs

- `memory-skills-host.spec.ts`: record-mode pre-engine config contains both
  active-auth keys; replay still creates no isolated config; SDK error/timeout
  reaches `host-error.txt` and suites do not run.
- Existing bootstrap specs remain fake-only; no live Codex auth or model call
  was made.

The host-wide record-mode bootstrap applies equally to B18, scope-write, and
funnel suites because all run through the same host and `beforeEngineBoot`
path. They need no separate change.

## Checks

- PASS — `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts --coverage=false --maxWorkers=2` (2 suites, 30 tests).
- PASS — `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`.
- PASS — `npx prettier --check` on the three changed TypeScript files.
- PASS — `git diff --check`.

## Decisions

- Seed configuration before engine initialization; do not add a post-boot
  re-initialize path.
- Keep credentials out of plans and the repository; only the existing isolated
  copied `CODEX_HOME/.codex/auth.json` is used.
- Keep host failure reporting as a separate redacted artifact rather than
  extending the 619-owned completion schema.

## Round 3 — where authMethod is read

### Trace

Probe 4's `No Anthropic API key configured` text is the failure returned by
the API-key strategy at
`libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:535`.
That confirms the active method reached the default `apiKey`, rather than the
intended third-party selection.

`ActiveProviderResolver.resolveActiveAuth()` reads `authMethod` through
`scope.read('authMethod', true)` at
`libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:25-28`.
For `thirdParty`, it reads `anthropicProviderId` through the same scoped reader
at `active-provider-resolver.ts:37-41`.

Both names are entries in `FILE_BASED_SETTINGS_KEYS`
(`libs/backend/platform-core/src/file-settings-keys.ts:174-176`), with fallback
defaults `apiKey` and `openrouter` at `file-settings-keys.ts:490-492`. The CLI
constructs `PtahFileSettingsManager` using its `globalStoragePath`
(`libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:50-53`)
and `getConfiguration('ptah', key)` directs file-routed keys to that manager
(`cli-workspace-provider.ts:84-96`). `PtahFileSettingsManager` reads
`{dirPath}/settings.json` (`libs/backend/platform-core/src/file-settings-manager.ts:88-92`).
For the bench CLI host, that directory is the isolated
`<isolation.home>/.ptah` / `isolation.userDataPath`, not the real home.

The earlier seed placed both selectors under `ptah` in `config.json`; the CLI
reader therefore ignored them. The Codex OAuth endpoint is different: it is not
file-routed and remains `ptah.provider.openai-codex.oauthTokenEndpoint` in
`config.json`.

No secret-store seed is needed. Once `providerId` is `openai-codex`,
`OAuthProxyStrategy` dispatches to `configureCodexOAuth`
(`libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:51-56,
166-188`), which checks and refreshes the copied Codex auth file through
`codexAuth`; it does not read a Ptah provider API-key secret.

### Fix

`seedRecordModeOAuthEndpoint` now preserves the non-file-routed endpoint in
`<isolation.userDataPath>/config.json`, but writes these top-level values to
`<isolation.userDataPath>/settings.json`:

```json
{
  "authMethod": "thirdParty",
  "anthropicProviderId": "openai-codex"
}
```

The implementation is in
`tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts:74-110`.
It is invoked only inside the existing record-mode branch before the engine
boots (`host/memory-skills-host.ts:292-293`), so replay neither creates nor
changes either settings file. No plan JSON change is required, and no token or
other secret is written.

### Spec

`host/recording-bootstrap.spec.ts:154-185` seeds a temporary isolated
`.ptah` directory then constructs the real `CliWorkspaceProvider`. Its routed
`getConfiguration('ptah', ...)` calls resolve `thirdParty` and
`openai-codex`; the spec also proves those keys are absent from `config.json`.
The host spec was adjusted to assert the two separate files during
pre-engine record-mode setup.

### Checks

- PASS — focused Jest command from the task: 2 suites, 35 tests passed.
  The expected stderr line from the existing retained-log failure test was
  present: `Unable to retain redacted host log.`
- PASS — `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`.
- PASS — Prettier check for the three changed host/bootstrap files.
- PASS — `git diff --check`.

## Decisions

- Follow the product's file-routing table rather than duplicating active-auth
  settings into `config.json`.
- Keep the existing copied `CODEX_HOME/.codex/auth.json` as the sole OAuth
  credential source; do not create a Ptah secret-store entry.

## Round 2 — initialize + review fixes

The probe-3 timeout was caused by `bench-host-boot` deliberately booting with
`requireSdk: false`: the adapter remained at its initial `initializing` health
because no bench-host caller invoked `initialize()`. Record mode now calls
`SdkAgentAdapter.initialize()` exactly once, races that one call against the
existing 60-second readiness deadline, clears the deadline timer, and then
requires `getHealth().status === 'available'`. A false result or error health
uses the redacted adapter error detail; replay never enters the gate
(`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:107,343,409-466`).

`host-error.txt` and retained host logs now share `redactSecrets`, which covers
quoted JSON key/value tokens, single-quoted API keys, cookie and API-key
headers, Bearer credentials, and JWT-shaped values
(`host/redact-secrets.ts:1-20`; used by
`memory-skills-host.ts:89,448-497` and
`doubles/recorded-curator-llm.ts:41,252-255`). `retainHostLog` wraps its whole
body and writes only a one-line stderr diagnostic if retention itself fails,
so its caller's `finally` still reaches `host.stop()`
(`memory-skills-host.ts:395-396,469-488`).

`caseLimit` is rejected when the extraction suite is invoked in CI/replay
context. Outside CI it is explicitly an incomplete diagnostic: its result
includes `details.caseLimit` and `details.truncationNote`, with verdict `na`
and `naReason: "truncated-probe"`, so it cannot pass
(`suites/memory/extraction.suite.ts:622-623,652-656,691-704,799`; schema
extension `memory-skills-suite-kinds.ts:57-58`).

### Specs

- `host/memory-skills-host.spec.ts`: exactly-one initialization;
  initialize-to-available success; false/error and non-resolving initialization
  failures; replay does not initialize; and log-retention failure still stops
  the host.
- `host/redact-secrets.spec.ts`: table coverage for all reviewed secret forms
  and unchanged ordinary text.
- `suites/memory/extraction.suite.spec.ts`: truncated probe result and CI
  refusal.

### Checks

- PASS — focused Jest command covering host, doubles, recorded curator, and
  the new redaction spec: 4 suites / 64 tests. The intentional failing-write
  retention test emits `Unable to retain redacted host log.` to stderr.
- PASS — `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`.
- PASS — Prettier check on all changed `memory-skills` TypeScript files.
- PASS — `git diff --check`.
- The optional extraction suite command was started but did not complete within
  the shell's 30-second foreground limit; its process was stopped rather than
  leaving a background test. No result is claimed for that command.
