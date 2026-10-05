## Backend implementation — `TASK_2026_596_0a19`, batch 12

**Tasks completed**: 12.1 (`PtahCliStreamLoop` usage segment and plan-limit signals), 12.2 (registry wiring for the lane owner and signals), plus Batch 11 carry-forward items 1 and 2.

**Files** (worktree root `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`):

- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-stream-loop.service.ts`: adds the usage on the existing `info` line, the forwarding of evidence through the agent-sdk mapper, the per-turn S2 success signal, and the `onPlanLimitSignal` and `planBilledSuccess` config fields.
- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-stream-loop.service.spec.ts`: adds 11 specs.
- CREATED `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-lane-plan-limits.ts`: one instance per spawn. It reads the lane owner (with a 3 s bound), records it through `recordQuotaOwner`, and writes the lane's signals to the ledger.
- CREATED `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-lane-plan-limits.spec.ts`: 17 specs.
- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`: adds `createLanePlanLimits` (spawn-time lazy lookups), the `onSystemInit` call from the init callback, the `handle.setAgentId` attach, and turn release gated on `settled`.
- CREATED `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry-plan-limits.spec.ts`: 2 specs that drive the real `spawnAgent()`.
- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-classifier.ts`:
  - ptah-cli now gets the Claude wording only.
  - Adds `laneLimitWording(cli, ownerProviderId)`.
  - `windowDescriptor` becomes the exported `laneWindowDescriptor`, which also handles `overage`, `monthly` and `other`.
- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-classifier.spec.ts`: the ptah-cli/Ollama expectations are inverted, and specs are added for wording and descriptor.
- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`: only `classifyLaneFailure` changed, plus one named import (`laneLimitWording`) added to the existing classifier import.
- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`: adds 4 ptah-cli classification specs.

**Stack observed**:

- tsyringe DI: `ptah-cli-registry.ts:106-153`, `di/register.ts`.
- Optional collaborators are looked up lazily at spawn with `lookupOptional` (`ptah-cli-registry.ts`, the capability-resolver precedent).
- Logger only, through `TOKENS.LOGGER`.
- The mapper is reused from the `@ptah-extension/agent-sdk` barrel (`index.ts:210-217`): `mapClaudePlanLimitMessage`, `claudeModelFamily` and `ClaudeTurnBilling`. `isMessageStart` comes in through `export *` of `claude-sdk.types`.
- The ledger API is `PlanLimitLedgerService` (`plan-limit-ledger.service.ts:189-269`), reached through `AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER`.

### Per-task evidence

**12.1 Stream loop**

- The `info` line text and `emitOutput` are unchanged. `usage: {model, inputTokens, outputTokens, costUsd}` is attached only for values the result reported.
- `model` is the last main-loop `message_start` model of the turn. When there is none it falls back to the init model.
- Spec: "attaches the turn usage to the existing completion info line". It asserts the exact line `Completed: 1200 input, 80 output, $0.0123, 1.5s, 2 turns`.
- Per-turn rule, the same as S1 (`stream-transformer.ts:428-600`):
  - Scopes come only from `message_start` events without `parent_tool_use_id`.
  - Billing is the latest in-turn `rate_limit_event`. With none it stays `unknown`.
  - Scopes and billing reset at every `result`.
  - A success fires only when `isSuccessResult && !is_error`.
  - Specs: main-loop-only scopes (the subagent haiku is excluded), the per-turn reset, and the is_error and error-result cases.
- F63: `isUsingOverage:true` produces `billing:'overage'` (spec "F63 — …"). The ledger's `recordSuccess` clears nothing on a non-`plan` success (`plan-limit-ledger.service.ts:254`).
- `ollama-cloud`: `planBilledSuccess` gives `billing:'plan'` (spec "bills every success to the plan on a plan-billed (Ollama Cloud) lane").
- Mapper and callback errors are caught and logged at debug with no payload, and the stream continues (spec "keeps the stream running when the signal callback throws").

**12.2 Registry wiring**

- After the system init (`onSessionResolved`), `onSystemInit(sdkQuery)` reads `accountInfo()` once, only for `claude-cli`, with a 3 s timeout. The owner is `LaneOwnerResolver.ownerForClaudeLane(account, agentId)`.
- `ollama-cloud` reads `ownerForPtahCliKey(id, 'ollama-cloud')` at spawn with the same bound. A placeholder key gives an unknown-kind owner.
- Other providers have no owner rule, so they get no owner (lane-owner resolver doc).
- Failure (rejected, timed out, no `accountInfo` method) leaves the owner unknown. It is logged at debug with the failure kind only; no error text is logged.

### Carry-forward handling

1. **Owner recorded before the lane can exit.**
   - The registry handle now implements `SdkHandle.setAgentId`, which `trackSdkHandle` calls right after `agents.set` (`agent-process-manager.service.ts:615-616`). `recordQuotaOwner` runs one microtask after tracking, once the owner read has settled.
   - Every turn is released to the manager (`onTurnComplete`, and the end-of-stream drain) only after `lanePlanLimits.settled`, which is bounded at 3 s. So `handleExit`, the `agent:quota-owner` persist and the exit persist all see the owner.
   - Specs:
     - Registry spec "records the lane owner from accountInfo() before the turn is released": the result has arrived, the turn is still held, `recordQuotaOwner('agent-claude-1', owner)` is called, then `done` resolves.
     - "leaves the owner unknown and still releases the turn when accountInfo() fails".
     - Helper specs: timeout, missing method, stream ending before init.
2. **Ollama false positive.**
   - `classifyLaneFailure` now passes `laneLimitWording(info.cli, info.quotaOwner?.providerId)`. A ptah-cli lane uses `anthropic` or `ollama-cloud` wordings when its owner names that provider.
   - The classifier's `'ptah-cli'` entry no longer includes the Ollama matcher, so an unknown provider never matches it.
   - Specs (manager and classifier): an Anthropic-owned ptah-cli lane failing with "429 Too Many Requests" gets no `failureKind` and no ledger write. An unknown provider is not quota. F38 still matches for an `ollama-cloud` owner, and owner evidence is filed. The Claude wording still matches for an `anthropic` owner.
3. **Antigravity owner upgrade.** This was not wired in Batch 12, which has no task for it. It remains open for the Phase 4 review, as the carry-forward requires.

### Risks handled

- **R5:** `doSpawnSdk` and the resume entry are untouched. The manager diff is 8 lines: the import and `classifyLaneFailure`.
- No never-touch file changed. Nothing outside `libs/backend/cli-agent-runtime/**` was edited. The `auth-providers` working-tree changes belong to the concurrent Phase 3 fix round.
- No timer is left per list item. The only timer is the per-spawn 3 s owner-read bound, which is cleared in `finally` and `unref`'d.

**Verification**:

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` → "Successfully ran targets typecheck, test, lint".
- Test results: Test Suites 88 passed of 88; Tests 1829 passed, 1 skipped, 1830 total.
- The first run failed only on mock typing in the new helper spec. That was fixed and re-run.
- Lint: warnings only. In the changed files the only warning is the existing `max-lines` warning on `ptah-cli-registry.ts`.

**Plan deviations**:

- Created `helpers/ptah-cli-lane-plan-limits.ts` (+ spec) and `ptah-cli-registry-plan-limits.spec.ts`, which Batch 12 does not list. They hold the owner read and ledger writes, so the 1.6k-line registry gains about 70 lines instead of about 250.
- Edited `limits/lane-limit-classifier.ts` (+ spec). The carry-forward rule "never match the Ollama wording when the provider is unknown" lives in its `MATCHERS` table.
- `LaneOwnerResolver` is built from the `PROVIDER_OWNER_RESOLVER` token at spawn (`new LaneOwnerResolver(logger, source)`), because it has no token of its own until Task 13.3.
- Lane Claude window evidence is converted locally (`laneWindowFromEvidence`). `windowFromClaudeEvidence` (`auth-providers/.../plan-limit-ledger.rules.ts:267`) is not exported from the auth-providers barrel, and this batch may not edit auth-providers.
- A lane emits no `turn-start` signal, because its owner is fixed per run (G2 applies to native sessions).

**Out-of-scope observations**:

- Exporting `windowFromClaudeEvidence` from the `@ptah-extension/auth-providers` quota barrel would let `laneWindowFromEvidence` be deleted. The labels match today, and the `laneWindowDescriptor` spec pins them.
- Providers other than `claude-cli` and `ollama-cloud` (`z-ai`, `moonshot`, `openrouter`, custom) get no lane owner, so S2 signals for those lanes are dropped. This matches the Component 10 resolver rules, but the plan's S2 row mentions "Glm lanes". The Phase 4 review should confirm this is intended.
- Task 13.3 should register `LaneOwnerResolver` under a token. `createLanePlanLimits` can then look it up directly.
