# Batch 1 report — Codex refusal predicate

Status: passed

## Tasks

### Task 1.1: Add refusal constant and predicate, export them

Done. `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` is the exact text
`Codex chat requires a host with the native Codex runtime.`
`isCodexNativeRuntimeRefusal` is true only for an `AuthRequiredError` whose
`providerId` is `openai-codex` and whose `message` is that constant.
Both are exported from `errors/index.ts` and from `agent-sdk/src/index.ts`.
agent-sdk does not import auth-providers.

### Task 1.2: CREATE predicate spec

Done. `auth-required.error.spec.ts` passed inside `@ptah-extension/agent-sdk:test`.
True for a `codexNativeRuntimeRequired()`-shaped `AuthRequiredError` (including a
recovery hint). False for Codex id plus another message, another provider id plus
the refusal message, a plain `Error` with the message, and a `ProviderAuthError`-named
error. The spec builds that named error locally so the agent-sdk suite does not
import auth-providers.

### Task 1.3: Query runner uses the shared constant

Done. `sdk-query-runner.service.ts` throws `AuthRequiredError` with
`CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` and `providerId: 'openai-codex'`.
The thrown text is unchanged.

### Task 1.4: auth-providers re-exports the constant

Done. `codex-native-runtime-refusal.ts` re-exports
`CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` from `@ptah-extension/agent-sdk`.
`codexNativeRuntimeRequired` still builds the same `AuthRequiredError`.
Importers of the module were not edited. `@ptah-extension/auth-providers:test`
passed, including the existing refusal and provider-auth-resolver specs.

## Files

Created:

- `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/agent-sdk/src/lib/errors/auth-required.error.spec.ts`

Modified:

- `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/agent-sdk/src/lib/errors/auth-required.error.ts`
- `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/agent-sdk/src/lib/errors/index.ts`
- `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/agent-sdk/src/index.ts`
- `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
- `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/auth-providers/src/lib/auth/codex-native-runtime-refusal.ts`

## Verify

Command, from W:

`npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/auth-providers`

Header:

`NX   Running targets lint, test, typecheck for 2 projects:`

Projects: `@ptah-extension/agent-sdk`, `@ptah-extension/auth-providers`.

The first run exited 1. `@ptah-extension/agent-sdk:test` reported
`Test Suites: 7 failed, 2 skipped, 216 passed` and
`Tests: 3 failed, 7 skipped, 5291 passed`. `auth-required.error.spec.ts` passed.
The three failing tests and the other suite-load failures were outside this
batch: Jest's `marked` mapper pointed at a missing worktree `node_modules`, and
`payload-map.ts` imported `IndexingFailedEvent` while a peer edit had not
exported it yet. Lint and typecheck for agent-sdk passed, and auth-providers
test, typecheck and lint passed.

A `node_modules` symlink to the main checkout (the same link the sibling
worktree already uses) was added, and `IndexingFailedEvent` was present on the
retry. The retry exited 0.

Tail of the passing run:

```
✔  nx run @ptah-extension/agent-sdk:test
✔  nx run @ptah-extension/agent-sdk:lint
✔  nx run @ptah-extension/agent-sdk:typecheck
✔  nx run @ptah-extension/auth-providers:test
✔  nx run @ptah-extension/auth-providers:typecheck
✔  nx run @ptah-extension/auth-providers:lint

 NX   Successfully ran targets lint, test, typecheck for 2 projects

  Run duration:      13m 17s
  Cache:             0/6 hit (0%)
[verify 2026-11-04T22:38:17.579Z] lock released after 815.1s, exit code 0
```

Nx hid the per-task Jest counts on the passing run (`Output of 6 successful tasks were not shown`).

## Risks and edge cases

- Ordinary `AuthRequiredError` is not a refusal. The spec covers Codex id with
  another message, and another provider id with the refusal message.
- A `ProviderAuthError`-named error with the same message and provider id is
  not a refusal. Callers still match that class by `name`.
- agent-sdk does not import auth-providers, so the constant moved into agent-sdk
  and auth-providers re-exports it. The duplicate literals in
  `ptah-cli-registry.ts` and `routing-agent-adapter.ts` were left alone, as the
  plan requires.
- R4 and R5 do not apply to this batch. No wire text changed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Predicate is `instanceof AuthRequiredError` plus `providerId === 'openai-codex'` plus the exact message. No new field on the class. | provider id only; marker field | P8; `workspace-provider-profile-resolver.ts` throws Codex-id errors with other messages | yes |
| Spec constructs the refusal shape and a local `ProviderAuthError` instead of importing auth-providers | import `codexNativeRuntimeRequired` | Task 1.1 forbids an agent-sdk → auth-providers import | yes |
| Worktree `node_modules` symlinked to the main checkout so Jest's `marked` mapper resolves | leave the first failure recorded | Sibling worktree `decision-model-data-gaps` already has this link; the UMD file exists there | yes |

## Clarifications Needed

None.
