# TASK_2026_161 — CLI-agent adapters: tree-kill + opencode follow-ups

**Source:** GitHub issue #430 (Hive-Academy/ptah-extension). Follow-ups deferred from TASK_2026_160 (commit `91ad76d37`).
**Type:** BUGFIX + REFACTORING · **Workflow:** Partial (session-ready plan supplied in-issue, source-verified).
**Research notes:** `.ptah/specs/TASK_2026_160/followup-opencode.md`, `.ptah/specs/TASK_2026_160/followup-treekill.md`.

## Scope (4 items, landing order A+B → C → D)

- **A — opencode MCP race** (Low/Low): replace `<cwd>/opencode.json` read-merge-write with per-process `OPENCODE_CONFIG_CONTENT` env var. Delete `configureMcpServer`, `cleanupMcpEntry`, `mcpConfigPath`, and the `done.then(cleanupMcpEntry)` call.
- **B — opencode Windows native-binary fallback** (Low/Low): drop the dead `if (!options.binaryPath)` gate; call `resolveOpencodeNativeBinary(options.binaryPath)` unconditionally, prefer when it `existsSync`s (mirror Codex).
- **C — process-tree kill** (Medium/Medium, systemic): add shared `killProcessTree(pid, signal)` to `cli-adapter.utils.ts`; add `detached: process.platform !== 'win32'` to `spawnCli`; route pi/antigravity/opencode through `resolveDirectSpawn`; update pi/antigravity/opencode/copilot abort handlers to call `killProcessTree(child.pid)`; point `AgentProcessManager.killProcess` at the same helper. NOT the `tree-kill` npm package.
- **D — extract `createBufferedEmitter<T>()`** (Low/Low): factor the ~35-line buffered emit/subscribe closure (output + segment) out of all 6 adapters into `cli-adapter.utils.ts`.

## Batches

| Batch | Items | Status                              | Commit       |
| ----- | ----- | ----------------------------------- | ------------ |
| 1     | A + B | done                                | `1f3694ba7`  |
| 2     | C     | done (4 logic-review fixes applied) | `f41a638ee`  |
| 3     | D     | done                                | pending hook |

Logic review of Batch 2 (`batch2-logic-review.md`) found 2 blocking timing regressions + 2 cheap issues, all fixed before commit:

1. POSIX killProcessTree now polls liveness (early-exit) instead of always waiting 5s.
2. Removed manager's dead `Promise.race([frozen sdkHandle.done, timeout])`; rely on killProcessTree wait, 500ms fallback only when no PID.
3. `detached` made opt-in (main-run spawns only, not short probes).
4. copilot resets `activeChild` between turns (mirrors pi).

CLI delegation: disabled (well-specified backend work, subagent implementation).
