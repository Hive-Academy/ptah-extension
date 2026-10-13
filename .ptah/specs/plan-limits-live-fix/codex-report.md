# Codex plan limits live investigation

## Live reproduction (before, redacted output)

On 2026-10-13, `probe/codex-live.cjs reader` spawned `node <bundled @openai/codex 0.155.1>/bin/codex.js app-server` with the resolved `CODEX_HOME`, mirroring `CodexAccountUsageService`. It sent `initialize` with Ptah client info, `initialized`, `account/read` with `{refreshToken:false}`, `account/rateLimits/read` without params, and optional `account/usage/read`. It never prints response bodies, email, tokens, or account IDs.

Redacted result: `initialize` 3442 ms, `account/read` 20 ms (chatgpt, plan `prolite`, email present), `account/rateLimits/read` 663 ms (`rateLimitsByLimitId.codex`, primary 18% / 10080 min / reset epoch 1792326541), `account/usage/read` 1007 ms; total 6216 ms. No RPC errors or stderr. The installed global `codex-cli 0.162.1` returned the same rate limit in 4562 ms total (initialize 3193 ms, account 687 ms, rate limits 633 ms).

The reference flow `probe/codex-live.cjs reference` sent `initialize` → `initialized` → `account/read` → `account/rateLimits/read` with `params:null`. It also returned `rateLimitsByLimitId.codex` and the primary window, total 4522 ms. Thus omitted versus null rate-limit params is not the failure on this machine.

## Root cause (file:line)

- `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:38-46` only calls `getAccountUsage` and maps its result. Its mapping at lines 54-75 correctly accepts the live primary-only weekly window. No reader defect reproduced.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:240-295` uses the correct app-server handshake and methods. At lines 330-335 it invokes the bundled JavaScript through `process.execPath`, avoiding Windows `.cmd` spawn issues. Both bundled and global versions answered successfully. Its per-RPC 10-second timeout at line 431 did not fire. `account/usage/read` is optional at lines 291-303, so activity failure does not block quota. `account/read` is required for identity and quota at lines 257-284, but succeeded live.
- `libs/shared/src/lib/utils/plan-limits/evidence-precedence.ts:17` sets the shared lookup deadline to 3000 ms. The observed cold `initialize` alone took 3193-3645 ms. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:136-169` applies this deadline to the whole lane and aborts unfinished reads, producing `limit lookup timed out`. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:235-261,620-624` applies the same deadline to selected-provider and lane owner discovery, discarding the late Codex identity. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:516-538` marks identity unavailable until the account read completes. `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:174-185` can also abort a dashboard owner read at 3000 ms when `withDeadline` is true.

## Fix applied

No production files changed. The permitted reader and spec cannot lengthen the upstream discovery, lane, or dashboard deadlines. Changing the reader to ignore cancellation would still leave its callers returning at 3000 ms and could waste work. There is no defensible reader-only fix for the reproduced failure.

## Live result after fix (redacted)

No fix was applied, so this is a verification of the current reader mapping rather than a post-fix dashboard result. `npx tsx --tsconfig tsconfig.base.json probe/reader-live.ts` fed the redacted live reference limit into the actual `createCodexPlanUsageReader` code path. It returned `status: available`, plan `prolite`, one `weekly` window with 18% used, 10080-minute duration, reset `1792326541000`; total live probe plus mapping 4752 ms. The dashboard and `ptah_agent_list` are expected to remain vulnerable to the 3000 ms cold-start deadline until the changes below are made.

## Required changes outside my files (file:line + exact change)

1. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:136-169`: give Codex lanes a separate deadline of at least 12000 ms, preferably a per-row deadline rather than the one shared race currently used by all rows. Keep the existing 3000 ms budget for other lanes. The existing `deadlineMs` option at line 69 can be used only if the caller performs a Codex-specific lookup; it cannot vary within the current batch.
2. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:235-261,613-624`: permit a Codex-specific deadline of at least 12000 ms for selected-provider and detected-lane sources when they resolve `resolveCodexHomeOwner`. Otherwise their 3000 ms race drops the identity before `ownerForCodexHome` can see it.
3. `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:174-185`: when `target.providerId === 'openai-codex'`, set its dashboard read abort timer to at least 12000 ms. Preserve the current 3000 ms timer for other owners.

Use a duration above the measured 6.2-second cold flow; 12000 ms allows the service's 10-second per-request limit plus overhead for the common single slow stage. Re-run the actual dashboard and agent-list flows after these changes. If those flows still fail, inspect the stage and status from the service's redacted warning at `codex-account-usage.service.ts:216-224` before modifying protocol or schema.

## Decisions

The live responses support `rateLimitsByLimitId.codex` selection and `rateLimits` fallback already implemented at `codex-account-usage.service.ts:288`; only the primary weekly window exists in this account. Schema permits the observed `prolite` plan and these fields. I did not duplicate app-server logic in the reader or edit files outside the authorized production scope.

## Test result

`npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.spec.ts --coverage=false --maxWorkers=2 --silent`: 1 suite passed, 14 tests passed. No production change was made, so no typecheck was necessary.
