# Batch 10d.C fix round 1 report

## Fixes

1. **Verify failure 1:** `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:49-96,148,195-478` adds a complete type-safe `CodexContext` fake and lane profile, resolves the registered `Logger` as `Logger`, and returns `null` for absent metadata. Removed the non-overlapping context casts.
2. **Verify failure 2:** `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts:41-47,99-108` now retains each production file's path and exempts only `codex-lane-runtime-composition.ts` from the `registerCodexRuntime|CODEX_RUNTIME_TOKENS` prohibition. The lane file still receives the `devRoute`/`readCodexDevRouteOverride` prohibition and the separate chat host binding check.
3. **C-1 and C-5:** `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:159-174,201-231` uses the shared cached `inspectCodexExecutable` in both probe and `open()`. Runtime ports receive its measured `sha256` and `versionOutput`. Removed local streaming hash code. `codex-lane-runtime-composition.spec.ts:391-455` checks independent reinspection, mismatch rejection before opening a scope, and that the measured values reach runtime ports. The successful fixture pin is computed from its bytes.
4. **C-2:** `codex-lane-runtime-composition.ts:159-164` compares the explicit path's realpath with the native path before inspection and uses the same error as `open()`. `codex-lane-runtime-composition.spec.ts:250-268` covers a different explicit path.
5. **C-3:** `codex-lane-runtime-composition.ts:166` lets `CodexExecutableInspectionError` propagate from the probe unchanged. `codex-lane-runtime-composition.spec.ts:228-247` checks the exact error object and adapter detection behavior.
6. **C-4:** `codex-lane-runtime-composition.spec.ts:271-309` checks the selected `CODEX_HOME` in credentials, catalog, and user MCP discovery while the process environment points elsewhere; `:207-226` renames the duplicate TUI claim to CLI shared-constructor coverage; `:427-452` explicitly asserts that `CodexAccountUsageClient.close()` is not called.
7. **C-6:** Only the local executable hash and file check replaced by the shared inspector were removed. The unrelated host composition helpers were left in place.

## Decisions

- **Adapter diagnostics follow-up:** The shared `CodexAppServerLaneAdapter` logs only `errorClass` for detection failures (`cli-agent-runtime/.../codex-app-server-lane.adapter.ts:143-146`). Its owner should consider logging the inspection error `code`, so pin absence and digest mismatch are distinguishable. The adapter is outside this lane's Scope. Options were editing that shared adapter or preserving scope; preserved scope. Reversible.
- **Guard location:** The task names `surface-composition.spec.ts`, but the literal failing guard is in `codex-runtime-composition.spec.ts:92-108`. The coordinator extended Scope to this file. Options were a broad guard exemption or a path-specific exemption; used the path-specific exemption, following the VS Code reference. Reversible.
- **TUI claim:** Renamed the duplicate CLI constructor assertion instead of expanding into an app-level TUI integration test. This is explicitly allowed by fix item 6b. Reversible.

## Not done

- Tests, typecheck, lint, build, Nx, npm, and `ptah_get_diagnostics` were not run because the task's hard rules prohibit them. No skill-loading tool was available in this lane; no skill was loaded.
