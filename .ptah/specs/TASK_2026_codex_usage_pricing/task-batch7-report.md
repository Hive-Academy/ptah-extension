# Batch 7 report: one usage reader and live push

## Status

Implemented the assigned source and spec changes. No verification command ran because the task prohibits tests, lint, typecheck, build, Nx, npm, Jest, and `ptah_get_diagnostics`. The coordinator must verify this batch. This report does not claim that the changed code compiles or that the specs pass.

## Changed files

- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts`
  - Delegates omitted, default, and explicit home reads to the attached `CodexAccountUsageClient`.
  - Keeps the legacy default-home reader only when no shared client is attached.
  - Adds live context identity checks, stale-update rejection, per-context refresh coalescing, released-context rejection, and provider-neutral window mapping.
  - Adds shared-client attach/detach lifecycle methods without transferring client ownership to the singleton service.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts`
  - Updates default-home delegation expectations.
  - Adds the live-update, cache-reuse, abort, and path-alias acceptance specs listed below.
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts`
  - Mirrors stdout from the existing chat child process without creating another process.
  - Validates `account/rateLimits/updated` envelopes and params with Zod before emitting a sanitized update.
  - Removes observers and releases live contexts on context or runtime disposal.
  - Logs only error classes and never logs protocol payloads, account identifiers, or credentials.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts`
  - Shares the first chat scope's usage client with `CodexAccountUsageService`.
  - Keeps that client alive when an individual chat scope closes.
  - Routes accepted live windows into `PlanLimitLedgerService.recordWindowEvidence`.
  - Detaches and closes the shared client during binding disposal, which releases its watchers and processes.
  - Preserves the previous standalone `createElectronCodexScopeFactory` behavior when no shared owner is supplied.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts`
  - Extends the Codex RPC case with a second pull and checks that both legacy reads use `refresh: false` and retain the same response shape.
- `libs/backend/rpc-handlers/src/lib/handlers/plan-limits-broadcaster.spec.ts`
  - Adds provider-neutral live window evidence to a snapshot and checks the unchanged `planLimits:changed` push.

No batch 8 file, MCP data, or `task-tracking/landing-live-demo/HANDOFF.md` was edited by this lane. Other modified files visible in the worktree belong to concurrent work.

## Acceptance coverage

- Two different homes remain separate:
  - `CodexAccountUsageService > keeps live updates for two homes and owners separate`.
- Reject a notification older than the cached `fetchedAt`:
  - `CodexAccountUsageService > rejects a stale live update before refreshing the shared reader`.
- Reject a notification for another home or owner:
  - `CodexAccountUsageService > rejects a context that changes home or owner`.
- Concurrent refreshes coalesce into one read:
  - `CodexAccountUsageService > coalesces concurrent live refreshes into one read`.
  - Existing lower-level coverage also remains in `CodexAccountUsageClient > coalesces lexical home aliases and uses only the supported usage request`.
- Abort works:
  - `CodexAccountUsageService > propagates default-home abort through the attached reader`.
  - `CodexAccountUsageService > propagates caller abort from the core client`.
  - `CodexAccountUsageService > propagates abort while an explicit-home core read is pending`.
  - Existing lower-level coverage remains in `CodexAccountUsageClient > cancels one waiter independently and closes the process when the last waiter aborts` and `rejects pre-aborted callers without watching or spawning`.
- Win32 drive-letter case and alias paths map through `normalizeCodexHomeKey`:
  - `CodexAccountUsageService > maps Win32 drive-letter case and alias paths through the shared reader`.
  - `CodexAccountUsageService > treats Windows case and trailing separators as the default home`.
  - Existing lower-level coverage remains in `CodexAccountUsageClient > coalesces lexical home aliases and uses only the supported usage request`.
- Watchers and processes are cleaned up on disposal:
  - Electron binding disposal calls `CodexAccountUsageClient.close` after all scopes close.
  - Existing lower-level coverage remains in `CodexAccountUsageClient > releases home watchers and active children on close and refuses later reads` and `can close while eligibility is still unresolved`.
  - `CodexAccountUsageService > rejects released and closed contexts without another read` covers rejected work after service/context disposal.
- Pull reads reuse the refreshed cache and keep RPC shapes unchanged:
  - `CodexAccountUsageService > publishes refreshed provider-neutral windows and reuses them on pull`.
  - `ProviderRpcHandlers > reads the Codex owner through PlanUsageService and reuses the filled cache on later pulls`.
- Live ledger changes use the existing push shape:
  - `PlanLimitsBroadcaster > pushes newer provider-neutral window evidence through the unchanged message`.

## Nx projects touched

- `@ptah-extension/auth-providers`
- `@ptah-extension/codex-runtime`
- `@ptah-extension/rpc-handlers`
- `ptah-electron`

Dependent hosts for the coordinator's batch gate:

- `ptah-extension-vscode`
- `ptah-cli`
- `ptah-tui`

## Required changes outside the assigned files

None are required for the implemented wiring.

Recommended additional coverage outside this lane's file scope:

- Add a `codex-runtime` spec that emits fragmented, malformed, invalid, and valid notification frames through the wrapped spawner and checks listener cleanup.
- Add an Electron composition spec that opens two scopes, closes the first, and proves that the shared client closes only during binding disposal.
- If maintainers want the notification callbacks in the public runtime registration contract, move the local structural callback types from `codex-runtime.ts` and `codex-runtime-composition.ts` into `libs/backend/codex-runtime/src/lib/di/registration.ts`. The current optional structural extension requires no functional change to that file.

## Risks and limitations

- The runtime observer duplicates line parsing because `codex-context.ts` was outside the assigned files. The primary protocol parser retains ownership of protocol responses. The observer only mirrors valid quota notifications.
- The observer starts after `context.open` succeeds. Notifications emitted before that point do not trigger live refreshes; ordinary pull reads remain available.
- A notification triggers `account/rateLimits/read` through the shared client. The notification params are validated but are not applied directly as a snapshot. This uses the plan's permitted invalidation/refresh behavior.
- Credits, individual allowances, reset-credit, and upsell fields still depend on the previously documented `PlanUsageService` propagation follow-up. A live update with no windows produces no ledger window change.
- The shared Electron ownership path and the stdout observer have no new direct specs because their spec files were not assigned. Existing client specs cover low-level cleanup and coalescing only.
- No verification evidence exists in this lane. The coordinator must run scoped verification and dependent-host checks before delivery.
