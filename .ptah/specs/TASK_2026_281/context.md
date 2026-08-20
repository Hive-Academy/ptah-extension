# TASK_2026_281 — Harness trigger gaps + RPC facade split

Follow-up to TASK_2026_278. Each item below was recorded by that task's implementers as deliberately out of scope, not discovered afterwards.

## Items

1. **Resumed sessions get no preflight.** `SdkAgentAdapter.resumeSession` returns early on its already-active branch and never reaches `SessionQueryExecutor`, where the preflight lives. Harmless while resume always follows a start in the same process, but the harness can drift between the two (plugin toggled, skill promoted, another host reconciled). Add the preflight to the resume path, or move it to a place both paths cross.
2. **`AgentProcessManager.spawnFromSdkHandle` bypasses `doSpawn`** and therefore the rival-CLI spawn preflight. Only reachable for handles spawned elsewhere today; left alone deliberately. Either route it through the same preflight or document why the caller guarantees one.
3. **Cron cwd fallback.** `job.workspaceRoot ?? process.cwd()` — in Electron that is the app install directory. `resolveHarnessWorkspaceRoot` will resolve whatever it is handed (and correctly refuses to climb into `$HOME`), but a job with no workspace should not silently reconcile a non-workspace. Decide: skip the harness for workspace-less jobs, or fail the job with a clear reason.
4. **Marketplace add/remove propagation.** `plugins:add-marketplace` / `plugins:remove-marketplace` do not call the propagation service. Probably right — neither changes the enabled-plugin set — but confirm, and pin it with a spec either way so the next reader does not have to re-derive it.
5. **`harness-rpc.handlers.ts` is 909 lines** (ceiling 700, warn-level). The handler logic already moved to `HarnessHealthRpcService`; what remains is registration plus imports. Apply the facade rule: keep the class name, DI token and method signatures, and extract registration groups into named collaborators — a split that pushes the constructor past ~8 deps is cut in the wrong place. Note the cost: the host-profile manifest, both app DI bundles and the coverage specs enumerate this class, so a split touches all of them.

## Acceptance

- Items 1–3 each closed with a spec, or with a written "documented unsupported" note in the owning lib's `CLAUDE.md`.
- Item 4 pinned by a spec asserting the chosen behaviour.
- `harness-rpc.handlers.ts` under the ceiling with no method-signature or token change; RPC surface specs still green.
