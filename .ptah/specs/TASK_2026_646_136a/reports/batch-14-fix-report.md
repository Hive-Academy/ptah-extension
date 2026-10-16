# Batch 14 fix report — TASK_2026_646_136a

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`
Scope: small fix round, exactly two files edited, nothing else touched.

## Change 1 — `libs/backend/rpc-handlers/package.json`

Deleted the dependency line `"@ptah-extension/lane-routing": "0.0.1",` (was line 21,
between `@ptah-extension/cli-agent-runtime` and `@ptah-extension/auth-providers`).
The preceding line (`"@ptah-extension/cli-agent-runtime": "0.0.1",`, now line 20)
keeps its trailing comma and is followed by `"@ptah-extension/auth-providers": "0.0.1",`
(now line 21), so the JSON stays well-formed. No `package.json` was added to
`lane-routing`.

### Verification

```
$ git diff -- libs/backend/rpc-handlers/package.json
(no output — exit 0)
```

Also checked against HEAD (covers a staged change too):

```
$ git diff HEAD -- libs/backend/rpc-handlers/package.json
(no output — exit 0)
```

Both diffs are empty: the file matches git HEAD exactly.

## Change 2 — `libs/backend/rpc-handlers/src/lib/services/lane-model-listing.adapter.spec.ts`

Added two `jest.mock` factories at the top of the spec, before the imports (after
`import 'reflect-metadata';`), following the pattern of
`cli-model-list.service.spec.ts:3-8` and `chat-ptah-cli.service.spec.ts:21-25`:

- `lane-model-listing.adapter.spec.ts:3-7` — mocks `@ptah-extension/cli-agent-runtime`
  with `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE: Symbol.for('SdkPtahCliConfigPersistence')`
- `lane-model-listing.adapter.spec.ts:9-15` — mocks `@ptah-extension/auth-providers`
  with `AUTH_PROVIDERS_TOKENS`:
  - `SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels')`
  - `SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth')`
  - `SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth')`

This stops the runtime load of the `@ptah-extension/cli-agent-runtime` index
(`lane-model-listing.adapter.ts:15`), which reaches tree-sitter (ESM,
`createRequireEsmError`) and prevented the suite from loading under Jest.

### Token audit (why these tokens, and why the factories are complete)

Every value the spec's runtime module graph uses from the two mocked packages:

| Token | Used at | Covered by factory |
| --- | --- | --- |
| `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE` | `lane-model-listing.adapter.ts:109` (import at `:15`) | yes — `spec:5` |
| `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS` | `lane-model-listing.adapter.ts:113` (import at `:16`) | yes — `spec:11` |
| `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH` | `cli-model-list.service.ts:25` (import at `:5-9`, loaded via the spec's `:25` import) | yes — `spec:12` |
| `AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH` | `cli-model-list.service.ts:27` | yes — `spec:13` |

`cli-model-list.service.ts` only type-imports from `@ptah-extension/cli-agent-runtime`
(`cli-model-list.service.ts:3`, erased at runtime). No other token or value from the
two packages appears anywhere in the spec's runtime graph.

Exact `Symbol.for` names verified against the package sources:

- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts:2` — `SDK_PTAH_CLI_CONFIG_PERSISTENCE: Symbol.for('SdkPtahCliConfigPersistence')`
- `libs/backend/auth-providers-tokens/src/lib/tokens.ts:4` — `SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels')`
- `libs/backend/auth-providers-tokens/src/lib/tokens.ts:38` — `SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth')`
- `libs/backend/auth-providers-tokens/src/lib/tokens.ts:36` — `SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth')`

All 11 existing test cases are untouched — `describe('LaneModelListingAdapter', ...)`
now starts at `spec:125` and the 11 `it` blocks run at lines 126, 155, 165, 195,
218, 243, 264, 284, 307, 357 and 377. Nothing was weakened or deleted.

## ESLint (single allowed run)

```
$ npx eslint libs/backend/rpc-handlers/src/lib/services/lane-model-listing.adapter.spec.ts
(no output — exit 0)
```

Clean pass, no warnings or errors.

## Constraints honored

- Only the two named files were edited; no other file touched.
- No Nx or Jest runs.
- No git commits, stash, restore, checkout, reset or clean — read-only `git diff` only.
- Strict TypeScript: no `any`, no `@ts-ignore` added.
