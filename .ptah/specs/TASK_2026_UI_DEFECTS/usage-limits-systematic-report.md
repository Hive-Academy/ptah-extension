# Plan-usage systematic report

## Outcome

Codex plan usage is now read successfully through the same production account-usage
service used by the app. The live reader, the Analytics RPC projection, and the chat
plan-limits RPC projection all contain the same Weekly value. The App Server did not
return a five-hour window in this account response, so the UI cannot truthfully display
one yet; the parser and presentation mapping now label it `5-hour` whenever Codex
returns its 300-minute window.

## Diagnostic harness

Harness: `D:\projects\ptah-extension\scripts\agent-usage\probe-plan-usage.ts`

Run from the repository root:

```powershell
npx ts-node --transpile-only --project scripts/agent-usage/tsconfig.json -r tsconfig-paths/register scripts/agent-usage/probe-plan-usage.ts
```

It instantiates the production Codex account-usage service and plan-usage reader, plus
the Antigravity, Ollama Cloud, Claude, and OpenCode paths. Output is deliberately
redacted: it prints only provider state, reason, window label/percent/reset time, and
failure step/error class/message if a call fails. It never prints credentials, account
IDs, emails, or raw App Server payloads. The small VS Code module shim is limited to
running the existing reader outside the extension host; provider logic is not mocked.

## Live results

### Before the fix

| Provider     | Observed state                | Evidence                                                                                                  |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Codex        | Usage unavailable; no windows | `tmp/electron-serve.log:1709` records `owner read ended without a snapshot` with reason `timeout`.        |
| Antigravity  | Usage unavailable; no windows | No Antigravity language-server process was running during the live diagnostic.                            |
| Ollama Cloud | No usable usage value         | Electron log had no configured Cloud credential/value. The old reader also used an undocumented endpoint. |
| OpenCode     | No usage source               | No implementation existed.                                                                                |

### After the fix — live redacted harness run

Run completed at `2026-10-07T22:45:38.040Z` (UTC):

| Provider     | Classified state / reason                              | Windows                                          |
| ------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Codex        | `available` / `app-server`                             | Weekly — 28% — resets `2026-10-14T03:31:56.000Z` |
| Antigravity  | `service-unavailable` / `process/discovery`            | None                                             |
| Ollama Cloud | `unsupported-config` / `credential/read`               | None                                             |
| Claude       | `service-unavailable` / `account/read:no-open-session` | None                                             |
| OpenCode     | `no-usage-source` / `no-official-reader`               | None                                             |

The harness had no failure record for Codex. Its live delivery projection was:

| Boundary                                                                                  | Windows returned                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| Production reader                                                                         | Weekly — 28% — `2026-10-14T03:31:56.000Z` |
| `provider:getAccountUsage` backend projection (selected-provider account surface)         | Weekly — 28% — `2026-10-14T03:31:56.000Z` |
| `provider:getPlanLimits` backend projection (shared Analytics card/chat-tile store route) | Weekly — 28% — `2026-10-14T03:31:56.000Z` |

The production App Server sequence completed: `initialize`, `account/read`,
`account/rateLimits/read`, and `account/usage/read`. Its redacted rate-limit response
contained a 10,080-minute primary window (Weekly) and `secondary: null`. The globally
installed Codex CLI used by lanes is 0.160.0 while the application dependency is
0.155.1; a direct redacted probe of the global 0.160.0 App Server had the same response
shape (Weekly primary, `secondary: null`). Version pinning is therefore not suppressing
the five-hour value.

This is the exact remaining blocker for the requested five-hour display: no supported
App Server method exposes a second value for this logged-in account. The current
official protocol accepts only optional Luna/reserve detail flags for
`account/rateLimits/read`, not a window selector, and returns only `primary` and
`secondary` snapshots ([protocol parameters](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/schema/typescript/v2/GetAccountRateLimitsParams.ts),
[protocol snapshot](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/schema/typescript/v2/RateLimitSnapshot.ts)).
The code does not invent a limit that the service did not send.

## Root cause and fixes

1. `PlanLimitOwnerDiscoveryService.discoverSelectedProvider` applied the shared
   three-second aggregate-dashboard deadline to the selected provider as well
   (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:234`).
   Codex App Server cold startup plus account reads took more than three seconds, while
   its production reader has its own ten-second request timeout. The Electron log
   timeout occurred before the successful reader result could be returned or cached.

   The selected-provider path now awaits its reader without the aggregate deadline;
   aggregate discovery remains bounded. A regression test proves that crossing the
   three-second aggregate deadline does not cancel an explicitly selected provider
   read.

2. The Codex reader already launches the installed package App Server directly, rather
   than relying on a `codex` shell shim or a stale version preflight
   (`libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:160,189`).
   The live run proves Windows spawning, JSON-RPC framing, initialization, method names,
   and Zod parsing work in this environment. The CLI adapter's existing path-resolution
   path was retained; no Electron-specific executable workaround was needed.

3. Codex duration mapping is canonical at
   `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:51,95`
   and `libs/shared/src/lib/utils/plan-limits/instants.ts:302`: 300 minutes maps to
   `5-hour`; 10,080 minutes maps to `Weekly`. Fixed labels in the ledger and Claude
   reader were aligned to the same `5-hour` wording. Provider-card RPC uses
   `ProviderRpcHandlers` → `PlanLimitsSnapshotService.ownerSnapshotForProvider`
   (`libs/backend/rpc-handlers/src/lib/provider-rpc-handlers.ts:188-204`,
   `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:125-130`).
   The Analytics provider card and chat plan-limit tiles both load the shared
   `PlanLimitsStore`, which calls `provider:getPlanLimits`
   (`libs/frontend/core/src/lib/services/plan-limits.store.ts`; the Analytics integration
   assertion is at `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts:971-1001`).
   `provider:getAccountUsage` remains the selected provider's account-usage surface.
   All three routes consume the same plan-usage reader and ledger data; no frontend file
   was modified.

4. Ollama Cloud now uses its documented bearer-auth
   [`/api/balance`](https://docs.ollama.com/api/balance) endpoint instead of the
   undocumented `/api/usage` endpoint
   (`libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:10-51`).
   It maps the included-credit allowance and balance to a redacted monthly percentage
   and reset date. The live machine had no stored credential, so no request was made.

5. Antigravity's existing Windows discovery looks for a running local language server
   and its CSRF/port data. The live process check found no matching Antigravity or
   language-server process, so the endpoint was not reachable to test. No discovery
   change was justified without a running service; the harness reports this exact state.

6. OpenCode documents fixed Go entitlement limits but no authenticated current-usage or
   limit API ([Go documentation](https://opencode.ai/docs/go/)). Its tracked request
   for an OAuth limits/usage dashboard remains evidence that such data is not exposed
   ([issue #8911](https://github.com/anomalyco/opencode/issues/8911)). The supported
   result remains `No usage source`; no credential scraping or unsupported endpoint was
   added.

## Files changed

- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\usage-limits-systematic-report.md`
- `D:\projects\ptah-extension\scripts\agent-usage\probe-plan-usage.ts`
- `D:\projects\ptah-extension\scripts\agent-usage\tsconfig.json`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.spec.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.spec.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\readers\claude-plan-usage.reader.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\readers\claude-plan-usage.reader.spec.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\readers\codex-plan-usage.reader.spec.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.rules.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.service.spec.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\quota\plan-usage.service.spec.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\utils\plan-limits\instants.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\utils\plan-limits\instants.spec.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\utils\plan-limits\window-state.spec.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\utils\plan-limits\plan-limit-format.spec.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\utils\plan-limits\lane-state.spec.ts`

## Checks run

| Command                                                                                                                                                                                         | Result                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx jest -c libs/backend/auth-providers/jest.config.ts ... --coverage=false --maxWorkers=2` (the changed Codex, Ollama, Claude, and ledger specs)                                              | Passed: 4 suites, 53 tests.                                                                                                                               |
| `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts --coverage=false --maxWorkers=2` | Passed: 1 suite, 24 tests.                                                                                                                                |
| `npx nx typecheck @ptah-extension/auth-providers --parallel=1`                                                                                                                                  | Passed.                                                                                                                                                   |
| `npx nx typecheck shared --parallel=1`                                                                                                                                                          | Passed.                                                                                                                                                   |
| Live harness command above                                                                                                                                                                      | Passed at `2026-10-07T22:45:38.040Z`; it printed the production-reader, `provider:getAccountUsage`, and `provider:getPlanLimits` projections shown above. |

`npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1` did not complete in
the available execution window, so it is intentionally not reported as passing.
Editor diagnostics could not complete because the TypeScript compiler service was still
running after 45 seconds. Neither produced a source diagnostic. Nx emitted a
non-fatal cloud-authentication notice after successful local targets.

## Decisions

- Removed the deadline only for selected-provider reads. This preserves the aggregate
  dashboard's bounded fan-out while allowing the Codex reader to use its own explicit
  timeout.
- Kept the backend source-of-truth shared between Analytics and chat plan-limit tiles;
  no frontend changes were made.
- Used Ollama's documented balance endpoint and avoided a request when no stored
  credential exists.
- Kept Antigravity and OpenCode states truthful rather than fabricating a percentage or
  adding an unsupported credential scrape.
- Did not synthesize a Codex 5-hour window: live `rateLimits` supplied Weekly only.
- Bypassed owner/identity discovery in the harness with an anonymous target. This keeps
  the live check focused on rate-limit numbers while exercising the production reader,
  ledger merge contract, and both backend RPC snapshot projections.
