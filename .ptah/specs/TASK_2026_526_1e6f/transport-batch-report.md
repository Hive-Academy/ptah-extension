## Changes

Implemented the approved Transport contract in place. `resolveUpstreamProtocol(modelId)` returns the approved string union (`messages`, `chat/completions`, `responses`, or `undefined`); the old boolean hook is removed completely. `undefined` returns HTTP 400 before credentials or upstream access.

| File | Change | file:line |
| --- | --- | --- |
| `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts` | Three-lane selector and dispatch, envelope validation, optional native path, allowlisted protocol headers, byte-preserving JSON/SSE relay through the existing transport, error hooks and guarded success handling. | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:64`, `:68`, `:387`, `:502`, `:508`, `:516`, `:541`, `:790` |
| `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts` | Migrated fake selector; named Codex/Copilot/OpenRouter lane assertions; Codex forced-SSE regression; native JSON/SSE fidelity, validation, header filtering, alias preservation, errors, timeout, truncation, cancellation and concurrent routing under both versioned bases. | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:75`, `:787`, `:854`, `:859`, `:864`, `:869`, `:882`, `:1030` |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts` | Replaced boolean override with Responses; retained host-specific forced SSE. | `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts:130` |
| `libs/backend/auth-providers/src/lib/providers/copilot/copilot-translation-proxy.ts` | Replaced boolean override with Chat Completions. | `libs/backend/auth-providers/src/lib/providers/copilot/copilot-translation-proxy.ts:108` |
| `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.ts` | Replaced boolean override with Chat Completions. | `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.ts:102` |
| `libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.ts` | Replaced boolean override with Chat Completions. | `libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.ts:107` |
| `libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.spec.ts` | Migrated existing protected-hook wrapper and both Fugu lane assertions. | `libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.spec.ts:37`, `:83` |
| `libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.ts` | Updated documentation of the inherited Chat selector. | `libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.ts:27` |
| `libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.spec.ts` | Migrated existing protected-hook wrapper and inherited Chat assertion. | `libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.spec.ts:42`, `:224` |

Native forwarding preserves concrete-model request bytes and all response bytes. Alias replacement serializes the original object with only `model` changed. Node piping applies backpressure; only `anthropic-version` and `anthropic-beta` can come from the client, and bound provider credentials own authentication. Response headers are limited to `content-type`, `cache-control`, and `request-id`. All lanes retain the shared auth retry, timeout, cancellation and quota lifecycle.

Stack observed: Node 24 and TypeScript 6.0.3 (`package.json` and `package-lock.json`); built-in Node HTTP transport (`translation-proxy-base.ts:27`), existing constructor/tsyringe wiring (`codex-translation-proxy.ts:17`), Zod 4.6.5 validation using the established translation-layer dependency (`translation-proxy-helpers.ts:12`). No registrations or dependencies were added. Repository rules were read from `CONTRIBUTING.md`, `CONVENTIONS.md`, `eslint.config.mjs`, and the auth-providers project configuration. LSP returned main-checkout references, so local worktree text search also verified the complete migration; final source search found no old hook.

## Lane pinning

| Provider | Spec file | Test name | Protocol pinned |
| --- | --- | --- | --- |
| Codex | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:854` | `pins Codex to Responses for every model` | `responses` |
| Copilot | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:859` | `pins Copilot to Chat Completions for every model` | `chat/completions` |
| OpenRouter | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:864` | `pins OpenRouter to Chat Completions for every model` | `chat/completions` |
| Sakana | `libs/backend/auth-providers/src/lib/providers/sakana/sakana-translation-proxy.spec.ts:83` | `routes through Chat Completions (never the Responses API)` | `chat/completions` |
| custom-openai | `libs/backend/auth-providers/src/lib/providers/custom/custom-openai-translation-proxy.spec.ts:224` | `always routes through Chat Completions, never the Responses API` | `chat/completions` |

## Verification

`npx nx typecheck @ptah-extension/auth-providers` — exit 0:

```text
 NX   Successfully ran target typecheck for project @ptah-extension/auth-providers
```

`npx nx test @ptah-extension/auth-providers` — exit 0:

```text
Test Suites: 41 passed, 41 total
Tests:       777 passed, 777 total
Snapshots:   2 passed, 2 total
Time:        27.594 s, estimated 45 s
Ran all test suites.
 NX   Successfully ran target test for project @ptah-extension/auth-providers
```

The full suite also emitted this warning; no test failed:

```text
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
```

`npx nx lint @ptah-extension/auth-providers` — exit 0:

```text
✖ 5 problems (0 errors, 5 warnings)
 NX   Successfully ran target lint for project @ptah-extension/auth-providers
```

Warnings concern existing non-null assertions, the existing large base (extended by this approved native transport change), `provider-models.service.ts` size, and `copilot-file-auth.ts` assignment. Nx also emitted executor deprecation warnings, and Jest emitted a module-loading configuration warning. These were not changed.

Scoped Ptah diagnostics before and after production edits:

```text
Errors: 0 | Warnings: 0 — No issues found.
```

Additional teardown check of all three touched spec files:

`npx nx test @ptah-extension/auth-providers --runInBand --detectOpenHandles --testPathPatterns='translation-proxy-base.spec.ts|sakana-translation-proxy.spec.ts|custom-openai-translation-proxy.spec.ts'` - exit 0, no open handles reported:

```text
Test Suites: 3 passed, 3 total
Tests:       89 passed, 89 total
Snapshots:   0 total
Time:        55.533 s
Ran all test suites matching translation-proxy-base.spec.ts|sakana-translation-proxy.spec.ts|custom-openai-translation-proxy.spec.ts.
 NX   Successfully ran target test for project @ptah-extension/auth-providers
```

The full-suite worker warning's origin was not established; the scoped teardown check completed cleanly.

## Not done

none
