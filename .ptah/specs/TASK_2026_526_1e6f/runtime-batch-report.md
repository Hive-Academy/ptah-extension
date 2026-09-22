# OpenCode runtime batch — TASK_2026_526_1e6f

## Changes

Implemented the approved runtime, registration, workspace/catalog and CLI groups. No shared catalog, translation transport, existing provider proxy, frontend, dependency or task-state files were changed. No git commands were run.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/fix-task-2026-525-opencode-models-c54bbd082c39`.

| File | Change | file:line |
| --- | --- | --- |
| opencode-provider.types.ts | CREATED auth contract and local placeholder | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-provider.types.ts:2` |
| opencode-auth.service.ts | CREATED immutable subscription secret reader, trimming and Bearer headers | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-auth.service.ts:10` |
| opencode-translation-proxy.ts | CREATED one proxy class with per-request shared-table routing and sanitized product-specific errors | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-translation-proxy.ts:20` |
| opencode-proxy.factory.ts | CREATED independent key-bound instances with caller-owned lifetimes | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-proxy.factory.ts:12` |
| opencode/index.ts | CREATED internal named exports | `libs/backend/auth-providers/src/lib/providers/opencode/index.ts:2` |
| opencode-auth.service.spec.ts | CREATED key isolation, trimming, missing-key and rotation assertions | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-auth.service.spec.ts:6` |
| opencode-translation-proxy.spec.ts | CREATED route-table, six destination/both stream modes, native fidelity, translated tools/usage, rejection, concurrent isolation and error tests | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-translation-proxy.spec.ts:126` |
| opencode-proxy.factory.spec.ts | CREATED product/key binding and independent real-listener lifecycle tests | `libs/backend/auth-providers/src/lib/providers/opencode/opencode-proxy.factory.spec.ts:7` |
| auth-providers/src/index.ts | MODIFIED public factory and placeholder exports for CLI consumers | `libs/backend/auth-providers/src/index.ts:130` |
| auth-providers-tokens/tokens.ts | MODIFIED four subscription tokens and one binding-collection token | `libs/backend/auth-providers-tokens/src/lib/tokens.ts:37` |
| register-providers.ts | MODIFIED cached per-product auth/proxy factories and four strategy bindings; construction performs no network/server startup | `libs/backend/auth-providers/src/lib/providers/register-providers.ts:142` |
| register-providers.spec.ts | CREATED registration identity, complete bindings and stable Symbol.for assertions | `libs/backend/auth-providers/src/lib/providers/register-providers.spec.ts:11` |
| auth-strategy.types.ts | MODIFIED readonly ApiKeyProxyBinding contract | `libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts:19` |
| api-key.strategy.ts | MODIFIED seven-dependency constructor, injected bindings, OpenCode missing-key guidance and refusal to use direct upstream when its binding is absent | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:88` |
| api-key.strategy.spec.ts | MODIFIED harness, five legacy-provider regression pins and OpenCode key/switch/teardown assertions | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts:272` |
| provider-proxy-pool.ts | MODIFIED product/key fingerprints, isolated OpenCode creation, reuse and key rotation | `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:169` |
| provider-proxy-pool.spec.ts | MODIFIED real workspace/product port isolation, reuse, rotation, scope disposal and missing-key fallback tests | `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.spec.ts:574` |
| provider-models.service.ts | MODIFIED authoritative static OpenCode branch before dynamic, cached or persisted resolution | `libs/backend/auth-providers/src/lib/provider-models.service.ts:247` |
| provider-models.opencode.spec.ts | CREATED exact reviewed-set, tool filter, unknown metadata and no-discovery assertions | `libs/backend/auth-providers/src/lib/provider-models.opencode.spec.ts:14` |
| ptah-cli-registry.ts | MODIFIED both subscription factories; added cleanup if setup throws after starting a proxy | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1289`; cleanup at `:927` |
| ptah-cli-registry-opencode-proxy.spec.ts | CREATED real spawn-boundary environment/tier, per-agent key/port, completion, stream-error, setup-error and cancellation tests | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-opencode-proxy.spec.ts:174` |

Observed stack: Node 24 and TypeScript 6.0.3 in `package.json`; tsyringe 4.10.0 in `package-lock.json:37246`; existing Node HTTP transport and Zod envelope validation in `translation-proxy-base.ts:352`. Wiring follows `register-providers.ts` and the Sakana trio. Package-barrel and dependency boundaries follow `CONVENTIONS.md` and `eslint.config.mjs`. No new environment reads were added.

Two source/plan details were resolved from the actual implementation: the CLI secret prefix is `ptahCli` (`ptah-cli-registry.utils.ts:19`), and the existing Responses transport omits `stream` for non-streaming requests. Tests use the real prefix and assert the effective streaming choice. The setup-error cleanup is necessary to satisfy the planned CLI lifecycle guarantee; existing completion/error/cancellation ownership remains in the stream path.

## Strategy pinning

All five assertions are in `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts`, under `ApiKeyStrategy > existing provider regression pins`. Parameterized cases produce these distinct Jest test names:

| Provider | Spec file | Test name | Behaviour pinned |
| --- | --- | --- | --- |
| openrouter | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts:274` | `openrouter retains its singleton proxy and placeholder` | Starts the existing singleton once; SDK gets its local URL, OpenRouter placeholder and empty API key; model service receives the real provider key. |
| moonshot | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts:307` | `moonshot retains native passthrough and starts no proxy` | SDK gets the registry base URL and provider-specific auth variable; no built-in proxy starts and no custom proxy is created. |
| z-ai | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts:307` | `z-ai retains native passthrough and starts no proxy` | SDK gets the registry base URL and provider-specific auth variable; no built-in proxy starts and no custom proxy is created. |
| sakana | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts:274` | `sakana retains its singleton proxy and placeholder` | Starts the existing singleton once; SDK gets its local URL, Sakana placeholder and empty API key; model service receives the real provider key. |
| requesty | `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts:307` | `requesty retains native passthrough and starts no proxy` | Its non-proxy registry entry keeps native base URL/auth passthrough; all four built-in start calls and custom creation remain uncalled. |

## Routing

`OpenCodeTranslationProxy` has an immutable `OpenCodeProviderId`. After normalizing only `default`, `sonnet`, `opus` and `haiku`, it calls `getOpenCodeModelProtocol(this.providerId, modelId)` through `@ptah-extension/shared`. There is no copied table, name inference, model-only lookup or mutable current lane. The base dispatches to the fixed subscription root plus `/messages`, `/chat/completions` or `/responses`.

The HTTP specs exercise all six subscription/root/suffix combinations in streaming and non-streaming mode. Native request and response bytes, protocol headers and error SSE survive; translated paths preserve tested text/tool/usage semantics. Concurrent `minimax-m3`, `minimax-m2.7` and `minimax-m2.5` requests use Zen Chat and Go Messages with distinct credentials.

Unknown, foreign-subscription, excluded and inherited-property IDs resolve to `undefined`. The existing base returns HTTP 400 `invalid_request_error` before reading auth or making an upstream request, with no fallback:

```text
Model '<id>' is not supported by OpenCode Zen/Go in this Ptah version. Choose a listed model or update Ptah.
```

The actual message names the selected product. See the excluded-protocol wording limitation under Not done.

Auth reads only the bound subscription's secret slot. Factory instances retain only their own trimmed supplied key. Explicit tests prove that a Zen key cannot authenticate Go and vice versa. Missing workspace keys preserve the documented undefined/global-auth fallback; the global OpenCode strategy cannot fall through to a direct OpenCode endpoint. Upstream 401 never refreshes or retries; 403/other 4xx/5xx errors are sanitized. Rate-limit state remains keyed by product.

Discovery always returns the 66 Zen or 31 Go reviewed static models, independent of keys, dynamic fetchers or persisted IDs. Unknown capability metadata remains `contextLength: 0` and `supportsToolUse: false`; tool-only lists are empty. Go retains `pricingModel: 'subscription'`. No Go pricing entries are added: the existing shared `seedStaticModelPricing` subscription guard at `libs/shared/src/lib/providers/provider-registry.ts:900` remains intact, and the new catalog branch performs no pricing updates.

## Verification

All five requested commands exited 0. Verbatim summary lines from the final relevant runs:

`npx nx typecheck @ptah-extension/auth-providers`

```text
 NX   Successfully ran target typecheck for project @ptah-extension/auth-providers
```

`npx nx test @ptah-extension/auth-providers`

```text
Test Suites: 46 passed, 46 total
Tests:       824 passed, 824 total
Snapshots:   2 passed, 2 total
 NX   Successfully ran target test for project @ptah-extension/auth-providers
```

`npx nx lint @ptah-extension/auth-providers`

```text
✖ 5 problems (0 errors, 5 warnings)
 NX   Successfully ran target lint for project @ptah-extension/auth-providers
```

Warnings: the model service exceeds the soft line limit (749 counted lines); untouched Copilot auth has an unused assignment; untouched Responses translator has a non-null assertion; untouched base transport has a non-null assertion and exceeds the line limit. No lint errors.

`npx nx typecheck @ptah-extension/cli-agent-runtime`

```text
 NX   Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime
```

`npx nx test @ptah-extension/cli-agent-runtime`

```text
Test Suites: 64 passed, 64 total
Tests:       1 skipped, 1011 passed, 1012 total
Snapshots:   0 total
 NX   Successfully ran target test for project @ptah-extension/cli-agent-runtime
```

The existing live connector-catalog spec is opt-in and skipped. No unrelated failing test was changed. Both normal suite runs emitted this non-failing diagnostic:

```text
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
```

Follow-up checks exited 0 and reported no open handles:

`npx nx test @ptah-extension/cli-agent-runtime --runInBand --detectOpenHandles --testPathPatterns=ptah-cli-registry-opencode-proxy.spec.ts`

```text
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
 NX   Successfully ran target test for project @ptah-extension/cli-agent-runtime
```

`npx nx test @ptah-extension/auth-providers --runInBand --detectOpenHandles --testPathPatterns='opencode|api-key.strategy|register-providers|provider-proxy-pool'`

```text
Test Suites: 46 passed, 46 total
Tests:       824 passed, 824 total
Snapshots:   2 passed, 2 total
 NX   Successfully ran target test for project @ptah-extension/auth-providers
```

The latter pattern matched the worktree's `opencode` path, so it ran the complete auth suite. The worker-exit warning was not reproduced in either follow-up; its cause is not established. The post-edit scoped Ptah TypeScript diagnostics reported `Errors: 0 | Warnings: 0 — No issues found.`

## Not done

- The plan requires excluded Gemini/Jev IDs to additionally name their unsupported protocol. They are safely rejected with the required generic 400 message, but the extra `generateContent`/`systemone` explanation cannot be supplied through the approved subclass hooks. `TranslationProxyBase.handleMessages` hardcodes the rejection text at `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:389`, and all transport files are explicitly off-limits. No workaround that rewrites model IDs or duplicates the transport was introduced. A transport-owner change adding a rejection-message hook is needed for exact wording parity.
- Paid-provider inference and extension/Electron/CLI live smoke tests were not performed; local fake-upstream tests establish Ptah behavior, not vendor entitlement or live model/tool compatibility. The plan explicitly leaves these as later credentialed release validation.
- Frontend work remains deferred as requested. No frontend files were touched.
