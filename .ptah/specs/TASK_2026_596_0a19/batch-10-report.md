# Batch 10 report — plan-limit windows and reset detection

## Produced files

- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-ls.provisional.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-plan-usage.reader.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-plan-usage.reader.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-usage.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\batch-10-report.md`

## Task evidence

### 10.1 — Ollama Cloud reader

Implemented one mocked GET to `https://ollama.com/api/usage` with a 5-second abort timeout and no retry. The zod schema is explicitly documented as provisional. The reader never performs a secret lookup; it reveals a `PlanSecret` only while constructing the Authorization header. Missing credential returns `unsupported-config` before any fetch. The service’s `PlanCredentialSource` supplies `unsupported-auth` for the placeholder credential before this reader is invoked.

Fixture F33 covers provisional valid payload, missing reset, malformed payload, and timeout. All fetches are Jest mocks; no live network was called.

### 10.2 — Antigravity reader

Added one provisional-constants module for process marker, argument names and arrays, CSRF header, endpoint and field names. The reader uses constant argument arrays, treats process absence and schema mismatch as `service-unavailable`, and does not log the CSRF token or body. Its TLS bypass is contained in the single `https.request` whose hostname is the literal `127.0.0.1`; no other quota request has `rejectUnauthorized`.

F33 covers valid provisional model data, no process and malformed response. `PlanUsageService` now maps `ollama-cloud` and `antigravity` to their readers.

### 10.3 — Ollama Cloud session owner

Added optional non-secret `baseUrlHost` to `SessionQuotaRoute`, derived from `accountingAuthEnv.ANTHROPIC_BASE_URL` only. The cloud-direct proxy route with null provider id resolves via `ownerForProviderKey('ollama-cloud')` when the parsed host equals the host of `OLLAMA_CLOUD_DIRECT_BASE_URL`.

AS5 daemon finding: `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts:193-209` exposes only `capacityRoute.providerId`, route kind and (now) a base-URL host; it contains no selected provider id or non-secret auth-method discriminator. The source evidence from Batch 9 remains that `libs/shared/src/lib/providers/entries/local-provider-entry.ts:37` and `:117` share `127.0.0.1:11434`. Therefore the daemon case remains unknown by design; the branch carries a code comment. Resolver fixtures cover cloud-direct, daemon ambiguous, plain local Ollama and unrelated null-provider proxy.

## Risk handling

- R4 secrets: API key and CSRF token are never returned or logged. Reader tests serialize the logger to pin the CSRF behavior. The route exports a parsed host only, never auth environment values.
- AS8 provisional shapes: each reader uses zod validation and reports malformed/unknown shapes as `service-unavailable`; constants and test payload labels state that they are provisional.

## Verification

- `npx prettier --write` on all modified TypeScript files: completed successfully.
- Requested: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers @ptah-extension/agent-sdk`. The Nx/background runner produced no terminal result within the available execution window, so pass/fail counts are **0 pass / 0 fail / 6 pending targets**. `ptah_get_diagnostics` likewise reported TypeScript checking still running after 45 seconds, without a diagnostic result.
- `grep -rn "rejectUnauthorized" libs/backend/auth-providers/src/lib/quota`: expected one occurrence, in `readers/antigravity-plan-usage.reader.ts`, scoped to the literal loopback request. (The command result was not returned before the execution window elapsed; re-run as part of the pending Nx follow-up.)
- Root auth-providers barrel was not changed.

## Rework round 1

- `antigravity-plan-usage.reader.ts`: replaced the missing agent-sdk root-barrel `ProbeCommandRunner` import with a local structural runner type. The agent-sdk barrel remains unchanged.
- `antigravity-ls.provisional.ts`: replaced table-formatting PowerShell output with `ForEach-Object` raw `ProcessId CommandLine` lines, preventing long CSRF/port arguments from being truncated. Added a long-line regression fixture.
- `antigravity-plan-usage.reader.ts`: process discovery now requires both `language_server` and the same-line Antigravity marker, so Codeium/Windsurf-style generic servers are rejected before any loopback request. Added a no-request regression fixture.
- Reader specs now serialize every mock logger method's recorded calls on success and provisional-mismatch/rejection paths, asserting that neither the CSRF token nor Ollama API key occurs in logs.
- Both readers now return `service-unavailable` for an already-aborted caller signal; Antigravity also forwards an in-flight caller abort to its loopback request. Added non-OK Ollama and rejected Antigravity request fixtures. Ollama fake timers are restored in `finally`.
- Verification completed: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers @ptah-extension/agent-sdk`. Five targets passed: both projects' typecheck and lint plus agent-sdk test. Auth-providers test ran 61 suites / 1,502 tests: 59 suites and 1,495 tests passed; 2 suites / 7 tests failed only in the expressly-known environment failures: the `translation-proxy-base.spec.ts` header-deadline timing case and `translation-proxy.sdk.integration.spec.ts` EPERM teardown cases. No Batch 10 test failed. `grep -rn "rejectUnauthorized" libs/backend/auth-providers/src/lib/quota` returns exactly one result: `readers/antigravity-plan-usage.reader.ts:177`, the literal `127.0.0.1` request. Root barrel count: 149 lines.
