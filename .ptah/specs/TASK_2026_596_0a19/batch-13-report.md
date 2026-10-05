## Backend implementation — `TASK_2026_596_0a19`, batch 13

**Tasks completed**: 13.1, 13.2, 13.3, 13.4, plus Batch 13 carry-forwards 1 to 4. Carry-forward 3 (Antigravity) could not be wired; see below.

### Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-lookup.service.ts`: `LaneLimitLookupService.lookup(rows, {deadlineMs, signal})`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-lookup.service.spec.ts`: 10 tests (F41, failed, no-owner, Glm key, recorded owner, model scope, caller abort).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.ts`: `PlanLimitOwnerDiscoveryService.discoverTargets(...)` (Component 10b).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.spec.ts`: 18 tests (F69, F70, F72, F81 x3, F82 x2, F83, Ollama key cases through the real `PlanUsageService`, a throwing source, ledger-only owners).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-owner-read.ts`: one rule for how an owner is read (`planOwnerRead`) and the snapshot built without a read (`snapshotWithoutRead`). The lookup and discovery both use it.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\owner-lifecycle.integration.spec.ts`: 5 tests (F55 backend legs, G2 per-turn path, G3 restart, 3 malformed or legacy cases).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts`: added `LANE_OWNER_RESOLVER`, `LANE_LIMIT_LOOKUP` and `PLAN_LIMIT_OWNER_DISCOVERY`, all built with `Symbol.for`. Each description is unique in `libs/`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\di\register.ts`: registers all three as singletons (`useClass`), before `AGENT_PROCESS_MANAGER`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\index.ts`: exports both services and their public types.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`: the import, the constructor's `@inject(CLI_AGENT_RUNTIME_TOKENS.LANE_OWNER_RESOLVER)`, and `restoreAgents` now copies `ref.quotaOwner`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.restore.spec.ts`: +1 test (owner copied; none when none was recorded; a restored record refuses `recordQuotaOwner`).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-lane-plan-limits.ts`: deleted `laneWindowFromEvidence` and now calls `windowFromClaudeEvidence`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-lane-plan-limits.spec.ts`: the old standalone describe is now a behavioural test of a model-scoped window going through the lane.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`: `createLanePlanLimits` looks up `LANE_OWNER_RESOLVER` instead of calling `new LaneOwnerResolver(...)`. The misplaced `lookupOptional` JSDoc (Phase 4 Minor item) is now back above `lookupOptional`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry-plan-limits.spec.ts`: registers a real `LaneOwnerResolver` under the new token.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\di\register.agent-process-manager.smoke.spec.ts`: checks that the manager's `laneOwners` is the token singleton, and +1 test that resolves `LANE_LIMIT_LOOKUP` and `PLAN_LIMIT_OWNER_DISCOVERY` as singletons from the real registration.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\index.ts`: +1 line, `export { windowFromClaudeEvidence } from './plan-limit-ledger.rules';`. The root barrel is untouched at 149 lines (≤150).

### Stack observed

- **DI**: tsyringe. Tokens are built with `Symbol.for` in `di/tokens.ts`, and registration uses `container.register(token, {useClass}, {lifecycle: Singleton})`, as in `register.ts:55-71`.
- **Constructors**: no clock seam. A trailing clock parameter would need a factory registration, as `auth-providers/src/lib/di/register.ts:213-239` does, so the lookup uses `Date.now()` instead.
- **Logging**: `TOKENS.LOGGER`, debug level, failure kind only. No error text is logged, following `ptah-cli-lane-plan-limits.ts` and `plan-credential.source.ts`.
- **Restore validation**: the zod boundary is `SessionMetadataStore.getCliSessionsForRestore`, which calls `parseQuotaOwnerRef` (`session-metadata-store.ts:319-326, 892-897`). Discovery's `ownerKeys` come from RPC, so discovery re-validates them with `parseQuotaOwnerRef(quotaOwnerRefFromKey(key))`.
- **Deadline**: modelled on `settledWithin` (`protocol-dispatcher.ts:2901-2916`). All lanes race one shared deadline timer, which is unref'd and cleared in `finally`. There is no timer per lane.

### Per-task evidence

**13.1 `LaneLimitLookupService`**

- For each row, the owner is `row.quotaOwner` (a recorded run) when present. Otherwise it comes from the rule: `ownerForLane` for codex, opencode and antigravity, or `ownerForPtahCliKey` for a ptah-cli lane on `ollama-cloud`.
- `planOwnerRead` then decides between `PlanUsageService.getOwnerSnapshot(target, {signal})` and a ledger-only snapshot. The result goes through `applicableLimits(snapshot, row.modelScope)` and then `classifyLaneState`.
- A lane that misses the deadline gets `lookup:'timeout'` and the reason `{kind:'lookup-failed', failure:'timed-out'}`. A throw gives `lookup:'failed'`. A row with no owner rule gives `lookup:'no-owner'` and `no-snapshot`.
- `lookup` never rejects. After the deadline, or when the caller aborts, the internal controller is aborted, so waiting `PlanUsageService` joins are released.
- The spec checks F41 by asserting that the slow lane's signal is aborted. A thrown reader and a thrown owner rule each fail only their own lane.

**13.2 `PlanLimitOwnerDiscoveryService`**

- The selected provider goes through `resolveEffectiveAuthRoute`, and `routeInput` assembles both inputs that function needs:
  - **Config**: the active `ActiveProviderResolver.resolveActiveAuth()` when nothing is selected or the selection is the active provider. Otherwise it is derived from the selection: `claude-cli` → `claudeCli`, `anthropic` → `apiKey`, any other → `thirdParty`.
  - **Provider snapshot**: `getAllAnthropicProviders()` plus the virtual direct `anthropic` entry. Types are mapped the way `llm:getProviderStatus` maps them, and `status:'unknown'` is used because discovery probes nothing.
- The route table is implemented as planned:
  - `claude-cli` → a read through the native session's probe handle; with no native session, a known `service-unavailable`/`no-open-session`.
  - `anthropic` on an API key → known `unsupported-auth`, never read.
  - `openai-codex` → the account home, with no `credentialRef`.
  - `ollama-cloud`, `opencode-go`, `opencode-zen` → the stored provider key.
  - Any other provider → known `provider-unsupported`.
- The remaining sources are CLI stores, sessions, codex from detection, enabled ptah-cli `ollama-cloud` agents with `{kind:'ptah-cli-key'}`, then ledger-only `ownerKeys`, then active evidence.
- The list is deduplicated by owner key, and the first source to name an owner wins.
- Each source runs inside `fromSource`, so a throw drops only that source and logs a debug line with the source name and error kind.
- The return type is `DiscoveredPlanOwner = {kind:'read', target} | {kind:'known', snapshot}`. A `known` entry must not be read again. This is how F82 and the `ownerKeys` ledger-only snapshots avoid a reader call.

**13.3 DI tokens, registration and exports**

- The tokens, registration and exports are listed under Files. The manager now injects `LaneOwnerResolver` by token, which closes the Batch 11 observation that it was resolved by class with no registration.
- The registry looks the resolver up by token.
- Smoke specs: the existing tests stay green, plus the new resolution test.

**13.4 `owner-lifecycle.integration.spec.ts`**

- Real pieces: `SessionPlanLimitCallbackRegistry`, `ProviderOwnerResolver`, `PlanLimitLedgerService`, `LaneOwnerResolver`, `PtahCliLanePlanLimits`, `AgentProcessManager`, the `wireAgentEventListeners` persistence, and `SessionMetadataStore` over `createMockStateStorage`.
- The only fake is the probe. It caches the account per turn and drops it at `turn-start`, which is the G2 contract. `accountInfo()` answers A and then B. No account-change event is emitted.
- Leg 1:
  - Turn 1 makes the session owner A.
  - Run 1 records A, and `quotaOwner` A is persisted before the run exits through `agent:quota-owner`.
  - Turn 2 moves the session owner to B.
  - Run 1 keeps A, and its relation to the session is `different`.
  - Run 2 records B, and its relation is `same`.
  - Both persisted references are `completed` and carry A and B respectively.
- G3 restart:
  - `ledger.snapshotFor(A)` is asserted to be `undefined`, so there is no ledger evidence.
  - The store is flushed, then reloaded as a new `SessionMetadataStore` over the same storage. A new manager runs `restoreAgents`.
  - The restored run carries A, and `ownerRelation` against B is `different`.
- Malformed owner, legacy bare `quotaOwnerKey`, and an unknown `identityKind`: each restores with no `quotaOwner` (relation `unknown`) and never as B.
- The two exit tests take a 20 s timeout. The manager's real `GRACEFUL_EXIT_DELAY_MS` is 3 s, and real timers keep the store and retry path real.

### Carry-forwards and risks

1. **`windowFromClaudeEvidence`**: exported from the quota sub-barrel. `laneWindowFromEvidence` is deleted. `laneWindowDescriptor` is kept: the classifier still uses it (`lane-limit-classifier.ts:233`). `grep laneWindowFromEvidence` over `libs/` finds nothing.
2. **`LaneOwnerResolver` token**: registered. The manager and the registry both use it.
3. **Antigravity owner upgrade: not wired. This must be raised in the Phase 4 review.**
   - The Batch 10 reader returns no account identity. `createAntigravityPlanUsageReader` parses only `models.{remainingFraction, resetTime}` (`antigravity-plan-usage.reader.ts:46-54, 113-124`), and its reading carries no `account`.
   - Nothing names an Antigravity account, so there is no `account` owner to upgrade `cli-store` to.
   - Wiring `recordQuotaOwner` would need a new identity field from the provisional LS payload (AS8). That is an auth-providers reader change outside this batch.
   - Antigravity lanes and cards therefore stay on the `cli-store` owner. That is a consistent key: discovery, the lookup and the manager all use `ownerForCliStore('antigravity')`.
4. **`restoreAgents` copies `ref.quotaOwner`**: covered by the restore spec and by the G3 leg of the integration spec.
5. **Lane model scope**: `LaneLimitLookupRow.modelScope` is applied whenever it is known. A spec shows that Opus-only exhaustion is `at-limit` for Opus and not for Sonnet.
6. **R5**: the manager diff hunks are imports, the constructor (line 218) and `restoreAgents` (line 819). `doSpawnSdk` and the resume entry are untouched. No never-touch file was changed. Edits are limited to `cli-agent-runtime/**` and the one quota barrel line.
7. **R7 (unknown or foreign evidence)**: a Claude owner is read only through its own session's handle (`planOwnerRead`).
   - Without a handle, the probe would answer with the most recently active native session, which can be another account.
   - Recorded Claude lane owners therefore read ledger-only, as `no-open-session`, and are never read through someone else's session.
   - Ledger-only and active-evidence listings skip `unknown`-kind owners.
8. **D6**: discovery reuses `ProviderOwnerResolver` (`ownerForSession`, `ownerForCodexHome` and the others). Owner keys are never built here.
9. **D9**: the tokens use `Symbol.for`.
10. **AS6**: the DI file paths were confirmed.
11. **Secrets (R4)**: targets carry only `credentialRef`. The logs carry only source names and error kinds. A spec checks that a detection error's path text is not logged.

### Fixtures covered

- **F41**: covered.
- **F55**: the backend legs are covered. The `AgentMonitorStore` and view-model legs belong to Batches 17 and 18.
- **F69, F70, F72**: covered.
- **F77**: the per-turn re-read path is covered, with A then B across turns and no event.
- **F81, F82, F83**: covered.
- **G3 restart fixture and the malformed/legacy case**: covered.
- **Missing Ollama key**: still listed, and reads `unsupported-config`.
- **Placeholder key**: reads `unsupported-auth`.
- Both key cases go through the real `PlanUsageService` with a fake credential source, so no reader is called and nothing reaches the network.

### Verification

Command, run in the foreground with no extra flags:
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/auth-providers`.

It exited 1, and the only failed target was `@ptah-extension/auth-providers:test`. The other five targets passed.

| Target | Result |
| --- | --- |
| `cli-agent-runtime:typecheck` | passed |
| `cli-agent-runtime:test` | 91/91 suites; 1864 passed, 1 skipped (count read back from the Nx cache replay) |
| `cli-agent-runtime:lint` | 0 errors, 44 warnings. None of the warnings is in a new file; the only ones in touched files are the existing `max-lines` warnings on the manager and the registry. |
| `auth-providers:typecheck` | passed |
| `auth-providers:lint` | passed |
| `auth-providers:test` | 59/61 suites; 1524 passed, 5 failed |

All 5 `auth-providers:test` failures are known environment failures from the brief:

- `translation-proxy.sdk.integration.spec.ts` S1 to S4: `EPERM, Permission denied` in `removeTree` at teardown (`:177`, called from `:883`).
- `translation-proxy-base.spec.ts` "does not fire the header deadline once output has started": the header-deadline timing test.

The only auth-providers change in this batch is one barrel export line.

**Plan deviations**:

1. `ownerKeys` and active-evidence entries are listed after the live sources, not at plan position 1c. A ledger-only entry therefore never shadows a live read of the same key, and dedup keeps the live entry.
2. Discovery returns `DiscoveredPlanOwner[]` (`read` or `known`) instead of `PlanOwnerTarget[]`. `PlanOwnerTarget` cannot express F82 (no reader call) or a ledger-only snapshot. Batch 15 reads `read` entries and passes `known` snapshots through as they are.
3. Ledger-only snapshots use `status:'service-unavailable'` with no `unavailableReason`, because no status value means "no current read for this account". The frontend (Batch 18) shows this by matching the snapshot's owner against the current owner.
4. Ptah-cli Claude agents are not a discovery source: their owner exists only once a run reads its own account. They appear through that run's `ownerKeys` entry, or through the host Claude login via the selected-provider and session sources.
5. `plan-owner-read.ts` is an extra file inside `limits/`. It keeps the lookup and discovery from duplicating the owner-to-target rule.

**Out-of-scope observations**:

- `agent-namespace.builder.ts:377-385` (vscode-lm-tools) maps ptah-cli rows without `providerId`. Batch 14 must add `providerId: a.providerId` so that `LaneLimitLookupService` can apply the Ollama Cloud key rule to Glm lanes. Without it, those rows read `no-owner`.
- Phase 4 confirmation items from Batch 12 are still open for the reviewer: the dropped S2 signals for z-ai, moonshot, openrouter and custom providers, and the owner-recording order. The misplaced JSDoc is now fixed.
