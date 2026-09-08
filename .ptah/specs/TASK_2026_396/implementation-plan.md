## Decision

Make `sessionFileExists` intrinsically non-throwing by containing both the directory scan and file-access check in one `try`/`catch (error: unknown)`, but do not use that Claude-store probe to authorize resume for any value currently admitted by `CliType`: the admitted values are `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, and `ptah-cli`, while `claude` is not in the union (`libs/shared/src/lib/types/agent-process.types.ts:62-73`) and the RPC schema rejects values outside that exact set (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts:31-41,62-67`). Therefore both active spawn paths must pass the supplied `cliSessionId` through unchanged and let their owning adapter/registry perform the resume. This satisfies the Codex and Ptah CLI safety requirements without a false local-filesystem veto; however, frozen AC3 is not implementable as written without admitting `cli: 'claude'`, which the frozen scope explicitly forbids by ruling out a schema/contract change (`.ptah/specs/TASK_2026_396/task-description.md:27-35`). Implementation must not claim full AC1-AC6 completion until AC3 is reconciled with the actual contract.

## Answers

1. **Gate only the actual Claude transcript owner, not “Anthropic-compatible” vendors, but no such gate is reachable in this RPC today.** `CliType` admits exactly `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, and `ptah-cli`; `SYSTEM_CLI_TYPES` defines the first six and the union appends `ptah-cli` (`libs/shared/src/lib/types/agent-process.types.ts:59-73`). The Zod boundary derives the same six and appends only `ptah-cli` (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts:31-41,62-67`). Thus `params.cli === 'claude'` is statically impossible and runtime-invalid, and broadening the gate to `ptah-cli` would contradict the frozen requirement that `ptah-cli` pass its id through (`.ptah/specs/TASK_2026_396/task-description.md:18-24`). The gate covers none of the seven currently admitted members. If a future, separately scoped contract change adds `claude`, only that literal should use `~/.claude/projects`, whose ownership is documented by the Agent SDK (`libs/backend/agent-sdk/src/index.ts:7-10`); the six system vendors and `ptah-cli` should remain pass-through lanes.

2. **Put the `try`/`catch` inside `sessionFileExists`; do not rely on a caller wrapper.** The helper's own contract says it returns a boolean (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1070-1077`), yet both `fs.readdir` and `fs.access` can reject (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1078-1099`). Containing both awaits inside the helper makes every invocation honor that contract and directly satisfies the frozen “must never throw” rule (`.ptah/specs/TASK_2026_396/task-description.md:14-17`). A wrapper would leave the helper dishonest and allow either call site to bypass the safety policy. Call-site honesty is separate from exception containment: the non-`ptah-cli` branch must stop consulting the Claude-only helper and pass the id directly (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:799-820`), and `resumePtahCliSession` must do the same in both of its downstream option objects (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:875-895,923-934`). AC4 should exercise the helper directly in the colocated spec because no valid RPC lane should invoke it after routing is corrected.

3. **The `~/.claude/projects` gate does not make sense on the `ptah-cli` path.** `ptah-cli` is not a binary/vendor literal; it selects a user-configured provider by `ptahCliId` (`libs/shared/src/lib/types/agent-process.types.ts:59-60`, `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts:34-36`). The registry exposes a merged set of built-in and user-defined Anthropic-compatible providers (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:545-550`), resolves the configured provider at spawn time (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:578-595`), and owns resume by forwarding `options.resumeSessionId` into the SDK query's `resume` option (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:682-686,738-746`). `resumePtahCliSession` currently applies the filesystem result twice, once before `PtahCliRegistry.spawnAgent` and again before `spawnFromSdkHandle` (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:875-895,923-934`); both conditions must be removed so the same supplied id reaches both halves. Protocol compatibility does not prove that this handler can authoritatively veto a configured provider's thread from one hard-coded local store.

4. **The existing “starting fresh” warning is meaningful only for a genuine Claude lane after a failed Claude transcript probe; it is not meaningful for any currently admitted lane.** Today the non-`ptah-cli` warning follows a Claude-store miss for every system vendor (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:804-816`), and the Ptah warning makes the same unsupported inference (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:900-903`). Both warnings must leave the active paths because those paths will no longer intentionally clear the resume id or start fresh. The wording should be retained only alongside a future reachable `cli: 'claude'` branch; frozen AC3's demand to observe it now conflicts with the union and schema cited in answer 1.

## Change set

1. **`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — `registerResumeCliSession`.** In the non-`ptah-cli` branch at lines 803-820, delete the `sessionFileExists` call and its “starting fresh” warning. Pass `params.cliSessionId` directly as `resumeSessionId`. Do not add a `params.cli === 'claude'` comparison: it is unreachable under `CliType` and rejected by the boundary schema. Final control flow:

   ```ts
   if (params.cli === 'ptah-cli' && resolvedPtahCliId) {
     result = await this.resumePtahCliSession(...);
   } else if (params.cli === 'ptah-cli') {
     throw configurationError;
   } else {
     result = await this.agentProcessManager.spawn({
       cli: params.cli,
       task: params.task,
       resumeSessionId: params.cliSessionId,
       parentSessionId: params.parentSessionId,
       ptahCliId: params.ptahCliId,
       resumedFromAgentId: params.previousAgentId,
     });
   }
   ```

2. **`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — `resumePtahCliSession`.** Delete the call at lines 875-878 and the warning at lines 900-904. Set `resumeSessionId: params.cliSessionId` in both `PtahCliRegistry.spawnAgent` options (currently lines 890-897) and `AgentProcessManager.spawnFromSdkHandle` metadata (currently lines 923-934). Preserve parent-session normalization and every other field unchanged. This guarantees both halves agree on the resumed thread and prevents a local Claude-store miss from silently converting the request to a fresh session.

3. **`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — `sessionFileExists`.** Keep the signature and path-matching logic, but wrap the complete probe, beginning with construction/scan of `projectsDir` and ending with `fs.access`, in `try { ... } catch (error: unknown) { ... }`. Return `false` for every filesystem failure, including rejected `readdir` and rejected `access`. Do not read `error.message` unless `error instanceof Error`; no logging is required because “not probeable” and “not found” intentionally share the boolean result, but if a debug/warn is retained it must use that narrowing. The helper must resolve, never reject:

   ```ts
   private async sessionFileExists(...): Promise<boolean> {
     try {
       const dirs = await fs.readdir(projectsDir);
       const matchedDir = /* existing normalization and lookup */;
       if (!matchedDir) return false;
       await fs.access(path.join(projectsDir, matchedDir, `${sessionId}.jsonl`));
       return true;
     } catch (error: unknown) {
       // Optional logging may inspect message only after instanceof Error.
       return false;
     }
   }
   ```

4. **`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts` — harness observability.** Retain the existing `fs/promises` mocks (`:23-26,73-74`). Expose the mock logger from `makeHarness` only if needed to assert absence/presence of warnings; do not alter production interfaces. Remove or rewrite existing Ptah expectations that assume an `fs.access` rejection drops `resumeSessionId` (`:193-204`), because that behavior is the silent-loss defect for a pass-through lane.

5. **`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts` — routing regressions for AC1/AC2 and the Ptah path.** Add a focused describe block that posts valid RPC payloads and proves:
   1. with `mockReaddir.mockRejectedValue(ENOENT)`, a `codex` request returns success, calls `spawn` once with `resumeSessionId: CLI_SESSION_ID`, and does not call either filesystem mock;
   2. with `mockReaddir` configured with a matching directory and `mockAccess.mockRejectedValue(ENOENT)`, a `codex` request still succeeds with the same resume id and does not call either filesystem mock;
   3. with both filesystem mocks configured to reject, a `ptah-cli` request passes the id unchanged to both `registry.spawnAgent(...)[2].resumeSessionId` and `processManager.spawnFromSdkHandle(...)[1].resumeSessionId`, with neither filesystem mock called and no “starting fresh” warning.

6. **`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts` — direct non-throwing probe regressions for AC4.** Because no currently valid RPC lane should invoke a Claude-only probe, invoke the private helper through a narrow test-only structural cast of the constructed handler. Add one test where `readdir` rejects and one where `readdir` returns the matching escaped workspace directory but `access` rejects; in both cases `await expect(probe(...)).resolves.toBe(false)`. Add a success control where both mocks resolve and the helper returns `true`. This pins the helper contract without weakening the production visibility or changing the RPC schema.

7. **No edit to `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts` or `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`.** The schema accurately reflects `CliType`, and the Codex adapter already chooses `resumeThread` exactly when the handler supplies `resumeSessionId` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:640-642`). Run `npx nx run-many -t test -p @ptah-extension/rpc-handlers` after implementation and verify the header reports one project.

## Acceptance mapping

| Criterion | Satisfying edit and evidence |
| --- | --- |
| AC1 | Change-set items 1 and 5.1: Codex bypasses the unrelated filesystem and succeeds with the id forwarded even when `readdir` is configured to reject. |
| AC2 | Change-set items 1 and 5.2: Codex always receives the supplied `cliSessionId`; the adapter therefore takes `resumeThread`, not `startThread` (`codex-cli.adapter.ts:640-642`). |
| AC3 | **Blocked by the frozen contract.** `cli: 'claude'` cannot pass `AgentResumeCliSessionParamsSchema` (`agent-rpc.schema.ts:31-41,62-67`) and is not a `CliType` (`agent-process.types.ts:62-73`). Satisfying this literal criterion requires either changing the schema/type (explicitly out of scope) or correcting AC3 to name a currently admitted lane/another RPC. No source edit in this plan fabricates a passing test for an unreachable payload. |
| AC4 | Change-set items 3 and 6: both `readdir` and `access` rejection tests resolve to `false`; the helper's own boundary contains all filesystem exceptions. |
| AC5 | Change-set item 7: run the exact frozen Nx command after implementation and confirm the existing plus new suite passes. |
| AC6 | Change-set items 5 and 6 cover AC1, AC2, and AC4, including both rejection paths. Full coverage of AC3 is blocked for the same contract reason recorded above. |

## Rejected alternatives

1. **Bare `try`/`catch` around the existing probe with unchanged call sites.** It removes the raw ENOENT but returns `false`, causing Codex's `resumeSessionId` to become `undefined` at `agent-rpc.handlers.ts:816`; the correct adapter then calls `startThread` instead of `resumeThread` (`codex-cli.adapter.ts:640-642`). This is silent conversation loss and fails AC2.

2. **A separate safe wrapper around a still-throwing `sessionFileExists`.** This leaves the helper's advertised boolean contract false and makes safety depend on every caller remembering the wrapper. It directly fails the frozen requirement that `sessionFileExists` itself never throw and makes the two current call sites easier to diverge.

3. **Treat `ptah-cli` as the missing `claude` literal because it uses Anthropic-compatible providers.** The registry is provider-configured and owns resume by forwarding the id to the SDK (`ptah-cli-registry.ts:545-550,578-595,738-746`); applying a hard-coded local-store veto violates the explicit pass-through requirement for `ptah-cli` and can silently start fresh.

4. **Add `claude` to `CliType` and the Zod enum in this task.** That would make AC3 reachable, but it is an RPC contract/schema change explicitly listed as out of scope (`task-description.md:27-35`) and would require broader adapter, UI, and validation analysis beyond this defect.

5. **Keep warning “starting fresh” while still forwarding the resume id.** The log would describe behavior that no longer occurs. Adapter-owned resume failure should be reported as a failure by that adapter, not pre-announced as a fresh start by this handler.

## Risks

- The largest risk is falsely marking AC3/AC6 complete despite the source-level contract contradiction. A test that sends `cli: 'claude'` can only prove schema rejection unless it bypasses the real RPC boundary, which would not test the acceptance behavior.
- The implementer must update both Ptah resume-id copies. Fixing only `registry.spawnAgent` or only `spawnFromSdkHandle` recreates inconsistent session metadata and can break later continuation/persistence.
- Codex tests must assert the exact `resumeSessionId`, not only `{ success: true }`; otherwise `startThread` can regress while the test stays green.
- Rejection mocks for Codex/Ptah must also assert `readdir` and `access` were not called. A successful result alone would not prove vendor routing stopped touching the Claude store.
- The direct private-helper tests should use the narrowest possible structural cast and must not change production visibility merely for testing.
- Catching only ENOENT is insufficient: the frozen requirement says any filesystem error returns `false`. Conversely, swallowing errors is acceptable only inside this optional existence probe; adapter-owned resume errors must still propagate through the handler's existing outer error conversion.
- Do not edit the Codex adapter, schema, shared union, frontend, or platform adapters. Those changes would exceed the frozen scope and obscure the actual handoff defect.
