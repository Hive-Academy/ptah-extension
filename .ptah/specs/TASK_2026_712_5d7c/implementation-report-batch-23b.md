# Backend implementation: `TASK_2026_712_5d7c`, batch 23b

**Tasks completed**: I wired the Batch 23 route material into the Claude lane runner, the manager's remembered-owner write and the lane limit lookup's read. I also added a spec that pins "two named routes give distinct owner keys, and the ambient key is unchanged".

**Files** (4, all inside the worktree):

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`: system init now calls `lanePlanLimits.onSystemInit(sdkQuery, context.named?.route)`. Ambient lanes pass `undefined`, so the existing `ownerForClaudeLane(account, agentId)` branch runs as before.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: `rememberLaneOwner` derives the route fingerprint through `laneRouteFingerprint(info)`.
  - Named run: the key carries `accountRouteFingerprint`.
  - Ambient run: the key object is exactly `{ cli, ptahCliId }`, as before.
  - Present but unreadable binding: the owner is not remembered (fail closed).
  - The manager now imports `laneRouteFingerprint` from `./limits/lane-limit-lookup.service`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts`:
  - New exported helper `laneRouteFingerprint(value: object): string | null | undefined`. It runs on top of the existing validator `laneAccountFields` (lane-resume-gate) and narrows `unknown` without a cast.
  - New optional row field `claudeRoute?: ClaudeAccountNamedRoute`. `readLane` forwards it to `planOwnerRead` as `claudeRoute`.
  - `ownerOf` passes `accountRouteFingerprint` to `lastLaneOwner`. It takes the fingerprint from `row.claudeRoute`, else from a persisted `accountBinding` on the row. An unreadable binding reads no owner, never the ambient one.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts`: new `describe('LaneLimitLookupService on named Claude accounts')` with two cases, using a real `LaneOwnerResolver`.
  - Ambient, route A and route B are each remembered and looked up under their own owner. The ambient `lastLaneOwner({cli, ptahCliId})` is unchanged. A route C with no run of its own reads `no-owner` and does not borrow the ambient owner.
  - A corrupt binding (`accountBindingId` mismatch) is neither remembered nor read. `laneRouteFingerprint` returns `undefined` for ambient, `null` for corrupt, and the fingerprint for bound.
  - The spec uses no `process.cwd()` and no `jest.spyOn`.

**Stack observed**:
- tsyringe `@injectable` / `@inject` (`lane-limit-lookup.service.ts` constructor). No new token and no new constructor parameter, so nothing to register.
- Binding validation is `classifyProviderAccountBinding` via `laneAccountFields` (`cli-agents/lane-resume-gate.ts:170`).
- The route type is `ClaudeAccountNamedRoute` (`libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts:40`), already imported by Batch 23 in the same lib.
- The Batch 23 signatures I matched:
  - `onSystemInit(query, route?)` in `ptah-cli-lane-plan-limits.ts`
  - `LaneOwnerKey.accountRouteFingerprint?` in `lane-owner.resolver.ts`
  - `PlanOwnerReadContext.claudeRoute?` in `plan-owner-read.ts`
- `ClaudeNamedLaneAdmission.route` is at `claude-sdk-lane-runner.ts:276`.

**Verification**:
- `ptah_get_diagnostics` (severity error) on the 4 changed files: 0 errors, 0 warnings. The coverage field reported `clean: true, analyzed: null`, so how much was actually analysed is unreported.
- Per the batch rules, I did not run nx, jest, tsc or lint. The orchestrator should run `npx nx test cli-agent-runtime --parallel=1` and `npx nx typecheck cli-agent-runtime`.

**Existing specs that mock or assert a changed member** (the orchestrator should run these):
- `claude/claude-sdk-lane-runner.spec.ts`: mocks `onSystemInit` and asserts `toHaveBeenCalledTimes(1)` only. The call arity changed; no assertion on args.
- `cli-agents/cli-adapters/claude-cli.adapter.spec.ts`: mocks `onSystemInit`.
- `ptah-cli/helpers/ptah-cli-lane-plan-limits.spec.ts`: `onSystemInit` (Batch 23 file, untouched).
- `cli-agents/agent-process-manager.service.spec.ts:2066` and `agent-process-manager.restore.spec.ts:284`: assert `rememberLaneOwner` was called with `{ cli: 'codex', ptahCliId: undefined }`. These are ambient rows and the key object is unchanged, so both should still pass.
- `cli-agents/agent-process-manager.account-binding.spec.ts:111`: stubs `rememberLaneOwner`.
- `cli-agents/limits/lane-limit-lookup.service.spec.ts:367`: asserts `lastLaneOwner` was called with exactly `{cli, ptahCliId}` (ambient, unchanged).
- `cli-agents/limits/lane-owner.resolver.spec.ts`, `owner-lifecycle.integration.spec.ts` and `plan-owner-read.accounts.spec.ts` reference `lastLaneOwner` / `rememberLaneOwner` (resolver unchanged by me).
- `libs/backend/vscode-lm-tools/.../agent-namespace.limits.spec.ts` uses `LaneLimitLookupRow`. The row only gained an optional field.

## Decisions

- **Unreadable binding**: present but invalid (the `laneAccountFields` → `{accountBinding: null}` sentinel).
  - Options: (a) treat it as ambient; (b) skip remembering and reading.
  - Chose (b). Evidence: the "never shared / fail closed" rule in the Batch 23 resolver doc and D7.
  - Reversible.
- **Where `laneRouteFingerprint` lives**: options were a new file, `lane-owner.resolver.ts` (Batch 23-owned, so not allowed) or the lookup service (owned).
  - Put in the lookup service so the write side (manager) and the read side (lookup) build the key through one function.
  - Reversible: a pure move.
- **Lookup row route source**: rows from `CliDetectionResult` hold no route. I added an optional, typed `claudeRoute` (certified, so it cannot be fabricated from a persisted binding) and also accept a persisted `accountBinding` on rows such as `AgentProcessInfo`, validated through `laneAccountFields`.
  - No caller sets `claudeRoute` yet, so a named Claude read through the lookup still reaches `planOwnerRead` without it. A session-bound read additionally needs `cliSessionId`/`sessionId`.
  - Additive.

**Plan deviations**: none to the Batch 23 files. Their signatures matched, so they were not edited.

**Out-of-scope observations**:
- No lookup caller (`lane-plan-limits-rpc.handlers.ts`, `agent-namespace.builder.ts` → `ptah-api-builder.service.ts`) passes `claudeRoute` yet. A certified route source per row (a lifecycle or admission accessor) is still needed, as Batch 23 noted for Batches 27/28.
- Named lanes whose run recorded `quotaOwner` on the row bypass `lastLaneOwner` entirely, which is unchanged behaviour.
- `git status` shows `libs/backend/usage-analytics/src/lib/sources/claude-ledger.source.ts` modified. I did not touch it (another agent's work).
- Named live launch remains fail-closed (D7). Nothing here launches a query, and no log text changed. The only new comment text is in code comments; no new log lines.
