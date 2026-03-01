# TASK_2025_171: Fix Review Issues from TASK_2025_170 Rename

## Task Type: BUGFIX

## Priority: HIGH (contains CRITICAL data-loss issues)

## Branch: feature/sdk-only-migration

## Context

TASK_2025_170 renamed `customAgent` → `ptahCli` across the entire codebase. Code review identified 11 issues (2 CRITICAL, 5 SERIOUS, 4 MODERATE) that must be fixed before merge.

## Issues to Fix

### CRITICAL (data loss on upgrade)

**Issue 1: package.json settings key NOT updated**

- `apps/ptah-extension-vscode/package.json` line 331 still declares `ptah.customAgents`
- Code reads/writes `ptah.ptahCliAgents` (via `PTAH_CLI_AGENTS_CONFIG_KEY = 'ptahCliAgents'`)
- Existing users' agents silently disappear on upgrade
- Fix: Rename key in package.json to `ptah.ptahCliAgents` + add migration

**Issue 2: No secret storage migration**

- Secret prefix changed from `customAgent.{id}` to `ptahCli.{id}`
- Existing API keys stored under old prefix are unreachable
- Fix: One-time migration in registry initialization

### SERIOUS

**Issue 3: Duplicated Ptah CLI merge logic**

- `agent-rpc.handlers.ts` lines 90-106 and 296-313 have identical 15-line blocks
- DRY violation: when one is updated, the other is forgotten
- Fix: Extract `private async mergePtahCliAgents()` method

**Issue 4: testConnection creates redundant adapter**

- `ptah-cli-registry.ts:396-490` calls `getAdapter()` (caches), then creates separate `testAdapter` with 6/9 args
- Fix: Use only the test adapter, remove redundant `getAdapter()` call

**Issue 5: createAgent() non-atomic config+key save**

- `ptah-cli-registry.ts:203-210`: `saveConfigs()` succeeds then `setProviderKey()` fails = half-created state
- Fix: Save key first (more failure-prone), then config; or rollback config on key failure

**Issue 6: Frontend catch blocks swallow errors**

- `ptah-cli-config.component.ts` lines 527, 568, 648, 719: `catch {}` with no error variable
- Fix: `catch (err)` + `console.error('[PtahCliConfig]', err)` + include in error message

**Issue 7: Component selector stutters: `ptah-ptah-cli-config`**

- Mechanical rename artifact in `ptah-cli-config.component.ts:83`
- Fix: Change to `ptah-cli-config` and update all template references

### MODERATE

**Issue 8: `ca-` ID prefix**

- `ptah-cli-registry.ts:74-76` still generates `ca-{uuid}` ("custom agent" artifact)
- Fix: Change to `pc-{uuid}` for new agents (keep accepting `ca-` for backward compat)

**Issue 9: No ngOnDestroy in PtahCliConfigComponent**

- Success timer (`setTimeout`) at line 739 not cleaned up on destroy
- Fix: Add `implements OnDestroy`, store timer ref, clear in `ngOnDestroy()`

**Issue 10: ptahCliSessions map never cleaned**

- `chat-rpc.handlers.ts`: map only cleans on `chat:abort`, not on natural session end
- Fix: Clean up entry when stream completes in `streamExecutionNodesToWebview`

**Issue 11: No concurrency guard for rapid toggle**

- Rapid toggle operations cause last-write-wins race condition
- Fix: Add `_isUpdating` signal guard in PtahCliConfigComponent

## Files Affected

### Backend

- `apps/ptah-extension-vscode/package.json`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`
- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`

### Frontend

- `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.html`

## Strategy

- Partial workflow: Team-Leader → Developers (parallel backend + frontend) → QA
- Batch 1: Backend fixes (Issues 1-5, 8, 10)
- Batch 2: Frontend fixes (Issues 6-7, 9, 11)
- Batch 3: Build verification + QA
