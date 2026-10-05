## Backend implementation — `TASK_2026_596_0a19`, batch 1

**Tasks completed**: 1.1, 1.2, 1.3

**Files** (all under `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src`):

- CREATED `lib\types\plan-limit.types.ts` — the plan-limit contract (types only, zod-free)
- MODIFIED `lib\types\rpc\rpc-providers.types.ts` — `'no-usage-source'` status, 5 optional fields on `ProviderGetAccountUsageResult`, `ProviderGetPlanLimitsParams`/`Result`
- MODIFIED `lib\types\rpc.types.ts` — import of the two new types, `'provider:getPlanLimits'` in `RpcMethodRegistry` (after `provider:getAccountUsage`) and in `RPC_METHOD_ENTRIES`
- MODIFIED `index.ts` — `export * from './lib/types/plan-limit.types';` (barrel now 91 lines, ≤150)
- MODIFIED `lib\types\agent-process.types.ts` — `AgentFailureKind`, `AgentProcessInfo.failureKind?`, `AgentProcessInfo.quotaOwner?`, `CliSessionReference.quotaOwner?`
- MODIFIED `lib\types\messages\message-constants.ts` — `PLAN_LIMITS_CHANGED: 'planLimits:changed'` (after `SESSION_MCP_STATUS`)
- MODIFIED `lib\types\messages\payload-map.ts` — `'planLimits:changed': PlanLimitsSnapshot`

### Declarations added

`plan-limit.types.ts`:
- `PlanLimitSource` = `'provider-api' | 'provider-unofficial' | 'stream-event' | 'error-derived' | 'estimated'` (from task-description Req 1.4)
- `PlanWindowKind` = `'five_hour' | 'weekly' | 'weekly_model' | 'monthly' | 'overage' | 'other'`
- `PlanWindowKey` = `'five_hour' | 'weekly' | \`weekly_model:${string}\` | 'monthly' | 'overage' | \`other:${string}\``
- `PlanLimitUsed` = `{kind:'percent', percent}` | `{kind:'amount', amount, limit, unit}`
- `OwnerLimitEvidence {observedAt, source, resetsAt?, resetSource?, modelScope?}` (also the type of `PlanLimitWindow.exhaustion`)
- `PlanLimitWindow {key, kind, label, modelScope?, durationMins?, used?, usedSource?, usedObservedAt?, resetsAt?, resetSource?, lastResetAt?, exhaustion?, observedAt}`
- `QuotaOwnerIdentityKind` = `'account' | 'credential' | 'cli-store' | 'unknown'`
- `QuotaOwnerRef {key, providerId, identityKind, label}`
- `PlanLimitCooldown {until, observedAt, rawUntil?}`
- `PlanLimitUnavailableReason` = `'no-open-session'`
- `PlanLimitOwnerSnapshot {owner, status: ProviderAccountUsageStatus, fetchedAt?, staleSince?, windowSetEstablished, windows[], ownerEvidence[], cooldown?, account?, activity?, unavailableReason?}` — `account`/`activity` reuse `ProviderGetAccountUsageResult['account'|'activity']`
- `PlanLimitSessionOwner {ownerKey: string|null, modelScope: string|null}`
- `PlanLimitsSnapshot {generatedAt, owners[], sessionOwners: Readonly<Record<string, PlanLimitSessionOwner>>}`

`rpc-providers.types.ts`:
- `ProviderAccountUsageStatus` gains `'no-usage-source'`
- `ProviderGetAccountUsageResult` gains optional `owner?: QuotaOwnerRef`, `windows?`, `ownerEvidence?`, `cooldown?`, `windowSetEstablished?`; every existing field (`status, providerId, fetchedAt, staleSince, account, quota.primary/secondary, activity`) untouched
- `ProviderGetPlanLimitsParams {providerId?, sessionIds?, ownerKeys?, refresh?}`; `ProviderGetPlanLimitsResult = PlanLimitsSnapshot`

`agent-process.types.ts`:
- `AgentFailureKind = 'quota'`, doc comment naming it THE single failure/stop-kind union (597 adds members here, no parallel `stopReason`)
- `AgentProcessInfo.failureKind?: AgentFailureKind`, `AgentProcessInfo.quotaOwner?: QuotaOwnerRef` (both mutable, like `status`: set on failure / upgraded unknown→known)
- `CliSessionReference.quotaOwner?: QuotaOwnerRef` (readonly, like its siblings)
- 597 regions (`SpawnAgentRequest.systemPrompt`, usage fields) not touched.

### Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=2` →
  `√ lint`, `√ typecheck`, `√ test` — "Successfully ran targets typecheck, test, lint for project @ptah-extension/shared" (Nx Cloud 401 warning is unrelated).
- `grep -rn quotaOwnerKey libs/shared` → no output (exit 1).
- `wc -l libs/shared/src/index.ts` → 91.
- Three-app typecheck (plan's seam) not run: outside this batch's scoped command; no consumer of `ProviderAccountUsageStatus` exists outside `libs/shared` (grep), and all additions are optional fields or new types.

### R4 (no secrets)

No field in any new or changed type holds a credential, a credential reference, an email, or identity material. The owner is named only by `QuotaOwnerRef.key` (opaque hashed key) and a generic `label`; doc comments state "never an email or a key". `ProviderGetPlanLimitsParams` takes only provider id, session ids, opaque owner keys and a refresh flag.

### R10 (7-file exception)

All 7 files are type-only edits inside `libs/shared` that must compile together: the RPC registry's `Record<RpcMethodName, true>` forces both registry spots in one change, the payload map imports the new snapshot type, and the barrel must export the new file. Done as one batch as accepted in `batches.md` R10.

**Plan deviations**:
- D3/AS2 applied: `quotaOwner?: QuotaOwnerRef` everywhere, no `quotaOwnerKey`.
- `OwnerLimitEvidence` carries an extra optional `modelScope?` — Decision 4 clears owner-level evidence "whose recorded `modelScope` equals the success scope, or is null", so the scope must be on the shape. Additive.
- `plan-limit.types.ts` ↔ `rpc-providers.types.ts` is a type-only import cycle (snapshot needs the status/account/activity types; the account-usage result needs owner/window types). Erased at runtime; lint (no cycle rule configured) and typecheck pass. Documented in the file header.
- Named helper types added for precision: `PlanWindowKey`, `QuotaOwnerIdentityKind`, `PlanLimitUnavailableReason`, `PlanLimitSessionOwner`.

**Out-of-scope observations**:
- `provider:getPlanLimits` is now in the registry with no handler; the boot-time `verifyRpcRegistration` (`libs/backend/rpc-handlers/src/lib/verify-and-report.ts`) will report it missing until the handler batch lands.
