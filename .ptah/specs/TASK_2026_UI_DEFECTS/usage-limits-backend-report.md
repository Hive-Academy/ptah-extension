# Usage limits backend report

## 1. Codex usage is `service-unavailable`

Root cause: this was not an `account/usage/read` Zod-shape mismatch. A redacted local App Server probe completed `initialize`, `account/read`, `account/rateLimits/read`, and `account/usage/read`; its structural response matches the schemas. The reader instead first spawned a separate `codex --version` process before starting App Server. That stale preflight could fail independently and was classified as unavailable before the readable App Server response was used. The same obsolete probe also inflated each read to two processes. Former call site: `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:161` (now App Server is spawned directly there); status mapping is at `:137-156`.

Fix: removed the version preflight and its process-output helper. `cli-version-unsupported` is now reserved for an App Server JSON-RPC `method not found` response. A direct App Server spawn failure is explicitly classified as `cli-unavailable` at `codex-account-usage.service.ts:160-168`.

## 2. Codex `unknown (cli version unsupported)`

Root cause: a second, independent version probe remained in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:325-335`. `detect()` ran `probeCliVersion()` merely to populate detection metadata, so an otherwise usable CLI could still acquire the stale version-derived state.

Fix: `detect()` now establishes installation from `resolveCliPath('codex')` only. The only remaining `cli-version-unsupported` usage path is an App Server capability failure, not an executable version string.

## 3. Account owners

Codex root cause: `account/read` supplies the ChatGPT email, but `CodexAccountUsageService` used it only to create an internal hashed owner key (`codex-account-usage.service.ts:178-187`). Discovery previously asked synchronously for that key before the first account read, producing unknown.

Fix: `ProviderOwnerResolver.resolveCodexHomeOwner()` (`libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:474-478`) primes the cached/single-flight usage read, then returns the hashed account owner. `PlanLimitOwnerDiscovery` awaits it for selected Codex and detected Codex lanes (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:308,355`). Emails remain absent from RPC/display data by design.

Claude: an owner can be derived only from an active native-session account read (`provider-owner.resolver.ts:449-455`); the stored auth path does not expose a separately safe email read. Ollama Cloud: its credential can create a hashed credential owner, but no email is available from the stored key. No email was added to shared/UI types because their owner labels intentionally reject email material.

## 4. Antigravity and Ollama Cloud

Confirmed expected states; no change made. Antigravity is retryable `service-unavailable` when its local language-server/process usage endpoint is unavailable. Ollama Cloud reports `unsupported-config` when no configured credential exists; its reader is `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts` (credential boundary and endpoint handling). These are not account-plan defects.

## Files changed

- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.spec.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.spec.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.spec.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.spec.ts`

## Checks

- Passed: `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts --coverage=false --maxWorkers=2` — 2 suites, 82 tests.
- Started: the equivalent scoped `cli-agent-runtime` Jest command. It did not return a completion summary within the tool window, so it is not reported as passed.
- Diagnostics were requested for all eight changed source/spec files. The scoped TypeScript service had not completed after 45 seconds; it reported all eight as unchecked, not errors.

## Decisions

- Kept identity privacy-preserving: derive and display generic hashed owner references, never return or log email/token values.
- Did not widen the usage schema: the current App Server structural response matched the existing Zod schema, so a schema change would be speculative.
- Treated Antigravity local-service absence and an unconfigured Ollama Cloud credential as expected states rather than masking them as plan data.
