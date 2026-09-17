# Code Logic Review — `TASK_2026_433` Batch B5a

Scope: `git -C D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes diff -- libs/backend/vscode-lm-tools/` — 5 files: `code-execution/types.ts`, `code-execution/namespace-builders/agent-namespace.builder.ts` (+ spec), `code-execution/ptah-api-builder.service.ts` (+ spec). The `cli-agent-runtime` diff (B4c) is out of scope by instruction; it is read only as committed context to verify the seam.

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                    |
| Serious issues        | 0                                    |
| Moderate issues       | 1                                    |
| Failure modes found   | 2 (both handled correctly)           |

Evidence base: full read of all 5 changed files (diff + surrounding context), the committed `AgentRoleResolver` (`libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.ts`), `AgentRoleStamp`/`doSpawnSdk`/`spawnFromSdkHandle` (`agent-process-manager.service.ts`), `PTAH_CLI_ROLE_DELIVERY` (`ptah-cli-registry.utils.ts`), the shared `SpawnAgentRequest`/`AgentProcessInfo` contract (`agent-process.types.ts`), DI registration (`cli-agent-runtime/src/lib/di/register.ts`, `tokens.ts`) and all three composition roots (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`). Ran and observed green: `nx run @ptah-extension/vscode-lm-tools:test --testPathPatterns="agent-namespace\.builder|ptah-api-builder\.service"` (2 suites, 49 tests), `:typecheck` (clean), `:lint` (21 pre-existing warnings, none in the 5 changed files).

## Five logic questions

### 1. How does this fail silently?

It does not, on the paths this batch owns. The two places a silent role-less spawn was structurally possible are both closed:

- `agent-namespace.builder.ts:183-196` — `request.role !== undefined` (not truthiness) gates resolution, so `role: ''` is resolved rather than treated as absent (deviation 2, confirmed correct: `agent-namespace.builder.spec.ts:526-540` — `''` reaches `resolveAgentRole('D:/ws', '')`, not skipped).
- `agent-namespace.builder.ts:184-190` and `:282-286` — a `role` with no wired resolver throws a **named** `Error` before any `getProjectGuidance` read, `reserveAgentId`, `registry.spawnAgent` or `agentProcessManager.spawn` call; every resolver rejection (`AgentRoleError` or otherwise) propagates unchanged (no `catch` anywhere in `spawn`), so a resolver failure never falls through to a role-less path. Confirmed by both branches in `agent-namespace.builder.spec.ts:451-476` (named-error case) and `:412-450` (`AgentRoleError`/generic-`Error` propagation case), each asserting `reserveAgentId`, `registry.spawnAgent`, `spawnFromSdkHandle` and `agentProcessManager.spawn` were **not** called.

One genuine (but explicitly out-of-scope) silent-degradation seam remains: `listRoles()` (`agent-namespace.builder.ts:394-396`) and its `ptah-api-builder.service.ts:687-693` wiring only degrade to `[]` when **no resolver is registered at all**. If a resolver *is* registered but its `listRoles()` throws (`AgentRoleError('role_read_failed', …)` from a directory read failure, or `'no_workspace'` when `getWorkspaceRoot()` is empty), the rejection propagates uncaught through both layers — there is no `warn + []` fallback here. `batches.md:559` explicitly assigns that catch to Task 5b.3 ("`ptah_agent_list` calls `ptahAPI.agent.listRoles()` (failure → warn + empty), … dispatcher wiring is B5b"), so this is correctly scoped out of B5a, not a defect in it — recorded under Moderate issues as a forward pointer, since nothing today prevents a caller other than the (not-yet-built) B5b dispatcher from calling `listRoles()` directly and seeing a rejection instead of a degraded `[]`.

### 2. What user action produces unexpected behaviour?

- Spawning with a `role` **and** a disabled/unavailable CLI (`cli` in `agentOrchestration.disabledClis`, or a `ptahCliId` that is disabled/lacks an API key) resolves the role file from disk *before* either failure check runs (`agent-namespace.builder.ts:182-196` precedes both the ptah-cli registry's own failure branch at `:228-233` and the rival branch's disabled-CLI check at `:262-271`). If the role name is also wrong, the caller sees `Unknown role "…"` instead of `CLI '…' is disabled`, and a role lookup happens on a request that was always going to be rejected. This is a Minor ordering nit (see below), not a correctness bug — no side effect happens on either error path.
- A caller resuming a rival-CLI agent (`resumeSessionId` set) together with `role` still resolves and forwards `roleDefinition` on the enriched request (`:284-298`) even though `doSpawnSdk` builds `roleStamp` unconditionally from any `request.roleDefinition` it receives (`agent-process-manager.service.ts:509-512`) with no awareness that this is a *resume*, not a fresh conversation. Whether re-asserting a role on a resumed session is desired behaviour is a product question the plan does not address (see Q5) — it is not a bug in this diff, since the same role-forwarding code path is uniform for fresh and resumed spawns and the resolver has no way to know the difference; flagging as a requirements gap.

### 3. What input data produces a wrong answer?

- None found that produces a *wrong* answer (as opposed to a correctly-surfaced error) within this diff's scope. The `role` value is a `string | undefined` in the `SpawnAgentRequest` type, and this layer never coerces or trims it — an all-whitespace role (`'   '`) reaches `resolveAgentRole` unchanged and is correctly rejected by `ROLE_NAME_PATTERN` in the resolver (out of B5a scope, already covered by B4a's own spec).
- The one latent gap: `AgentNamespace.spawn` is also the surface the `execute_code` sandbox calls directly as `ptah.agent.spawn(request)` (per `vscode-lm-tools/CLAUDE.md`'s description of `PtahAPI`), which is typed but not Zod-validated at this layer — that hardening is deliberately deferred to the MCP dispatcher's `AgentSpawnArgsSchema` in B5b (`implementation-plan.md:214`, `560`). A sandbox call passing a non-string `role` (e.g. `123` or `null`) reaches `ROLE_NAME_PATTERN.test(role)` in the resolver, which coerces via `String()` and could produce a confusing `invalid_role_name`/`unknown_role` message rather than a type error, but cannot execute anything unintended — worth a one-line note for B5b's author, not a fix required here.

### 4. What happens when a dependency fails?

- `resolveAgentRole` throwing (resolver down, filesystem error, unknown role) → propagates unchanged, no spawn, no reservation. Verified above.
- `registry.spawnAgent` returning a `SpawnAgentFailure` (`'status' in result`) after a role was successfully resolved → the code throws before calling `spawnFromSdkHandle`, so the resolved role is simply discarded; `reserveAgentId()` (line 212) has already run at this point, but it is stateless (`AgentId.create()`, `agent-process-manager.service.ts:998-1000` — a UUID mint, not a slot claim), so there is nothing to leak or release. Pre-existing code path, unmodified by this diff.
- No resolver wired at all (`AGENT_ROLE_RESOLVER` unregistered in some host) → `ptah-api-builder.service.ts:678-686`'s closure always exists and throws its own named `Error` when `this.agentRoleResolver` is `undefined`; the `agent-namespace.builder.ts:184-190` guard is a second, redundant line of defence for hosts that build `AgentNamespaceDependencies` some other way (mirrors the pre-existing `deliverAgentReport` pattern one-for-one). Confirmed the token IS registered in `registerCliAgentRuntimeServices` (`cli-agent-runtime/src/lib/di/register.ts:55-58`) and that function is called in all three composition roots (`ptah-extension-vscode`, `ptah-electron`, `cli-engine`) before `PtahAPIBuilder` is ever resolved (registration order among Phase-2 calls does not matter for tsyringe `registerSingleton`, since nothing is instantiated until `container.resolve(PTAH_API_BUILDER)`, which all three defer to a later phase). Optional-inject degrades exactly as designed; no host is silently missing the resolver.

### 5. What is missing that the requirements never mentioned?

- Whether re-spawning-as-resume should re-apply a role, or whether `role`/`roleDefinition` should be suppressed once `resumeSessionId` is set (Q2 above). Not covered by `implementation-plan.md` or `batches.md`.
- Precedence between a role failure and a disabled-CLI/no-API-key failure when a request supplies both (Q1/Q2 above) — the plan specifies *where* role resolution sits relative to `reserveAgentId`/slot but not relative to the disabled-CLI check, so the current placement is a legitimate reading of the contract, just one worth a one-line callout in the plan for consistency across future edits.

## Failure modes

### Role resolver unregistered

- Trigger: a host builds `PtahAPIBuilder` without `registerCliAgentRuntimeServices` (or a future host wires `AgentNamespaceDependencies` directly without `resolveAgentRole`).
- Symptom: `ptah_agent_spawn({ role: '…' })` rejects with `Agent roles are unavailable: …`.
- Evidence: `ptah-api-builder.service.ts:678-686`, `agent-namespace.builder.ts:184-190`.
- Current handling: named error, no spawn, no reservation. Correct per the `deliverAgentReport` precedent this batch deliberately mirrors.
- Recommendation: none — this is the intended behaviour, and it is verified not to occur in any of the three shipped hosts today.

### Role listing failure not degraded at the namespace layer

- Trigger: `AgentRoleResolver.listRoles()` throws (`no_workspace` when `getWorkspaceRoot()` returns `''`/relative, or `role_read_failed` on a directory-read error) while a resolver **is** registered.
- Symptom: any direct caller of `ptahAPI.agent.listRoles()` (sandbox code, a future non-B5b caller) gets a rejected promise instead of `[]`.
- Evidence: `agent-namespace.builder.ts:394-396` (`listAgentRoles ? listAgentRoles(getWorkspaceRoot()) : []` — ternary only guards absence, not failure), `ptah-api-builder.service.ts:687-693` (same pattern, no `try/catch`).
- Current handling: uncaught rejection.
- Recommendation: none required for B5a — `batches.md:559` assigns the `warn + []` degradation explicitly to Task 5b.3's dispatcher wiring. Flagging so the B5b reviewer confirms the catch actually lands there and that no interim caller (e.g., `execute_code` sandbox scripts) reaches `agent.listRoles()` before B5b ships.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Moderate: `listRoles()` has no failure degradation at this layer (see Failure modes above)

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:394-396`, `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:687-693`
- Not a defect against B5a's own contract (explicitly deferred to B5b per `batches.md:559`), but the JSDoc on `AgentNamespace.listRoles` (`types.ts:302-308`, "or an empty array when no role source is wired") reads as though `[]` covers every failure mode; it currently only covers the "not wired" case. Suggest the B5b author double-check this doc comment still matches once the dispatcher-level catch lands, or tighten the wording now.

### Minor: role resolution precedes the disabled/unavailable-CLI checks on both branches

- File: `agent-namespace.builder.ts:182-196` runs before the ptah-cli registry failure branch (`:228-233`) and before the rival-branch disabled-CLI check (`:262-271`).
- A request naming both an invalid `role` and a disabled `cli`/`ptahCliId` reports the role failure and masks the disabled-CLI one, and performs a discarded filesystem read for a spawn that would have failed anyway. No side effect either way (no reservation, no process spawned), so this is cosmetic/UX, not a correctness bug.

### Minor: `roleDefinition` forwarded unconditionally on a rival-branch **resume**

- File: `agent-namespace.builder.ts:290-298` includes `roleDefinition` on `enrichedRequest` whenever `request.role` resolved, with no special-casing for `request.resumeSessionId`. Whether a role should apply to a resumed conversation is a product question the plan does not address; flagging as a requirements gap for the architect/PM, not a code defect (the implementation is internally consistent — it treats fresh and resumed spawns identically).

### Informational: sandbox (`execute_code`) callers of `ptah.agent.spawn`/`listRoles` are not schema-validated at this layer

- By design — `implementation-plan.md:214` puts Zod validation (`AgentSpawnArgsSchema`) at the B5b MCP dispatcher, not the namespace. `AgentNamespace.spawn`/`listRoles` are also reachable from the code-execution sandbox directly (per `vscode-lm-tools/CLAUDE.md`'s description of `PtahAPI`), where only TypeScript's compile-time typing applies. A non-string `role` from sandboxed code degrades to a confusing (but harmless) resolver error rather than a clean type error. No action required for B5a.

## Data flow

1. `ptah_agent_spawn` request reaches `AgentNamespace.spawn` (not yet Zod-validated — B5b) — OK.
2. Session id resolved (`activeSessionId`), unrelated to role — OK, unchanged by this diff.
3. `request.role !== undefined` → `resolveAgentRole(getWorkspaceRoot(), request.role)` (`agent-namespace.builder.ts:192-195`) — resolves from the **caller's** workspace root, not `request.workingDirectory` (A4 requirement) — OK, confirmed by `agent-namespace.builder.spec.ts:665-708`'s nested-worktree cases for both branches.
4. No resolver wired → named `Error`, no further steps — OK.
5. Resolver rejects (`AgentRoleError` or otherwise) → propagates, no further steps — OK.
6. Resolver resolves → `roleDefinition` held in a local variable; `getProjectGuidance` awaited next — OK, matches contract ordering.
7. **ptah-cli branch**: `agentId` reserved (stateless mint) → `registry.spawnAgent(ptahCliId, task, { …, role: roleDefinition })` (role forwarded as the full definition, never the caller's raw string) → on registry failure, throw (role discarded, nothing to release) → on success, `spawnFromSdkHandle(handle, { …, ...(roleDefinition ? { roleStamp: { role: roleDefinition.name, ...PTAH_CLI_ROLE_DELIVERY } } : {}) })` — no `roleStamp` key at all when role-less (verified by `agent-namespace.builder.spec.ts:602-618`) — OK; `PTAH_CLI_ROLE_DELIVERY` imported as a **value** from `cli-agent-runtime`, matching the B4b contract amendment noted in `batches.md:506` — OK.
8. **Rival branch**: `roleDefinition` (from the resolver only — a caller-supplied `request.roleDefinition` is destructured out and dropped at `agent-namespace.builder.ts:284-288`, confirmed by `agent-namespace.builder.spec.ts:640-654`) is spread onto `enrichedRequest` and handed to `agentProcessManager.spawn` → `doSpawnSdk` reads `request.roleDefinition` (not `request.role`) to build its own `AgentRoleStamp` (`agent-process-manager.service.ts:509-512`) and forwards `role: roleDefinition` to the adapter's `runSdk` — OK, the seam between B5a's `enrichedRequest.roleDefinition` and B4c's `doSpawnSdk` consumer matches exactly.
9. `list()` stamps every `ptah-cli` row (not rival-CLI rows) with `...PTAH_CLI_ROLE_DELIVERY` unconditionally (`agent-namespace.builder.ts:365`) — OK per contract; rival-CLI rows keep whatever `roleDelivery`/`roleChannel` `cliDetectionService.detectAll()` already attaches (B4c, out of scope here), untouched by the `{...c, disabled: true}` spread.
10. `listRoles()` → `listAgentRoles?.(getWorkspaceRoot()) ?? []` — OK for "not wired"; not yet degraded for "wired but throws" (see Moderate issue above, explicitly B5b's job).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `AgentNamespace.listRoles(): Promise<string[]>` (types.ts) | COMPLETE | none |
| `spawn` resolves role after session resolution, before branch split / `reserveAgentId` / slot | COMPLETE | none — verified by ordering specs on both branches |
| No resolver wired + `role` set → named error, no spawn | COMPLETE | none — both branches covered |
| Every resolver failure (`AgentRoleError` or other) propagates unchanged, no spawn | COMPLETE | none |
| ptah-cli branch: `role` forwarded to `registry.spawnAgent`; `roleStamp` from `PTAH_CLI_ROLE_DELIVERY`, absent key when role-less | COMPLETE | none |
| Rival branch: `enrichedRequest.roleDefinition` set; caller-supplied `roleDefinition` stripped | COMPLETE | none |
| `PtahCliRegistryLike.spawnAgent` options gain `role?: AgentRoleDefinition` | COMPLETE | none |
| ptah-cli list rows spread `...PTAH_CLI_ROLE_DELIVERY` | COMPLETE | none |
| A4: role resolved from `getWorkspaceRoot()`, not `workingDirectory`, including nested worktrees | COMPLETE | none — dedicated spec cases for both branches |
| `ptah-api-builder.service.ts`: `AGENT_ROLE_RESOLVER` optional-inject, `resolveAgentRole` throws named error / `listAgentRoles` returns `[]` when absent | COMPLETE | none |
| D9 (`no_workspace` guard) | COMPLETE (verified in committed `AgentRoleResolver`, not this diff's own code, but consumed correctly) | none |
| D8 (`ptah_agent_list` must still succeed on a role-listing failure) | NOT YET APPLICABLE | correctly deferred to B5b's dispatcher; namespace layer itself does not catch (see Moderate issue) |

Implicit requirements not addressed: role handling on a resumed rival-CLI spawn (Q2/Q5); precedence between a role failure and a disabled-CLI failure when a request supplies both (Q1/Q2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `role: ''` | YES | `!== undefined` gate lets it reach the resolver, which rejects with `invalid_role_name` | none |
| `role` set, no resolver wired (either branch) | YES | named `Error`, no spawn | none |
| Resolver rejects with `AgentRoleError` (either branch) | YES | propagated unchanged, no spawn, no reservation | none |
| Resolver rejects with a non-`AgentRoleError` (e.g. disk I/O `Error`) | YES | propagated unchanged, no spawn | none |
| Role-less ptah-cli spawn | YES | no `roleStamp` key at all (not `roleStamp: undefined`) | none |
| Nested-worktree `workingDirectory` with `role` set | YES | role resolved from `getWorkspaceRoot()`, spawn still runs in the worktree | none |
| Caller supplies `roleDefinition` directly (rival branch) | YES | stripped before spreading `request` | none |
| `role` + disabled CLI / no API key together | PARTIAL | role resolved first, so its error masks the CLI-availability error | cosmetic only, no side effect |
| `role` + `resumeSessionId` (rival branch) | PARTIAL | role always forwarded, no resume-awareness | product question, not a bug |
| `listRoles()` when resolver is wired but its call throws | NO | uncaught rejection | explicitly B5b's scope per `batches.md:559` |
| DI: `AGENT_ROLE_RESOLVER` unregistered in a real host | N/A (does not occur) | confirmed registered in all three composition roots before `PtahAPIBuilder` is ever resolved | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the one thing worth a follow-up ticket is confirming Task 5b.3 actually wraps `ptahAPI.agent.listRoles()` in a `warn + []` catch at the dispatcher, since the namespace/builder layer reviewed here does not do it itself (by design).
- What a robust implementation would add: (1) a one-line decision in the plan on role-vs-disabled-CLI error precedence and role-on-resume, purely for future-proofing rather than because today's behaviour is wrong; (2) once B5b lands, a regression test asserting `ptah_agent_list` still returns agent rows when `listRoles()` throws, to pin D8 end-to-end.
