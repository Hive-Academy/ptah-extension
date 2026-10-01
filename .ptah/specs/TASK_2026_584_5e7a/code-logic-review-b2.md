VERDICT: APPROVED
Score: 9/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 2: MCP Subagent Root Registrar)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 1        |
| Failure modes found | 1        |

---

## Numbered Defects

### 1. [MINOR] Case/Separator Path Identity Discrepancy on Windows in `retainedRoots`

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:540,580`
- **Scenario**: `retainedRoots` is an in-memory `Set<string>`. `retainRoot` and `releaseRoot` accept raw `root: string` without canonicalizing separators or drive letter casing (e.g. `path.normalize(root)`). If a caller retains `D:\project\worktree` and later releases `D:/project/worktree` (or lowercase `d:\project\worktree`), `this.retainedRoots.delete(root)` evaluates to `false`.
- **Impact**: The entry is not deleted from `retainedRoots` upon release. While Batch 5 (`SessionSpawnerService`) passes the identical `snapshot.worktreePath` across the child session lifecycle, any external or transformed caller path representation discrepancy leaves the root retained until server stop or process exit.
- **Fix**: Defensive normalization: apply `path.normalize(root)` (and optionally case-normalization for Windows drive letters) at the entry of both `retainRoot` and `releaseRoot`.

---

## Five Logic Questions

### 1. How does this fail silently — where does a failure produce a success-looking result?

- **Analysis**:
  - In `retainRootNow` (`http-mcp-server.service.ts:548-577`), failures during reconciliation or lock timeouts result in `outcome = notRegistered('write-failed')` or `outcome = notRegistered('lock-timeout')`.
  - When `outcome.registered` is false, `retainRootNow` cleans up `retainedRoots` (if not previously retained) and returns `{ registered: false, reason }`. It never returns `registered: true` when the write failed.
  - In the DI registration shim (`libs/backend/vscode-lm-tools/src/lib/di/register.ts:124-152`), if `TOKENS.CODE_EXECUTION_MCP` is missing from the container or throws during resolution or execution, `retainRoot` catches the error, logs a warning, and returns `{ registered: false, reason: 'registrar-unavailable' }`.
  - In `releaseRoot`, failures to delete or remove entries on disk log warnings and return `void` without rejecting, strictly honoring the port contract (`mcp-subagent-root-registrar.interface.ts:34-37`) that removal failures are non-blocking and retried on the next reconcile or stop.

### 2. What user action produces unexpected behaviour?

- **Analysis**:
  - If a user manually edits or deletes `<worktree>/.mcp.json` while a subagent session is active, an intermediate folder-change reconcile will not rewrite the file because `this.registrations.get(configPath)?.port === port` hits the existing cache in `reconcileRegistrations` (`http-mcp-server.service.ts:522`). This is identical to the existing idempotency behavior for workspace roots and intentional to avoid unnecessary disk I/O.
  - If the user quits or closes the workspace, `disposeAsync()` invokes `stop()`, which calls `unregisterFromAllSlots()` and cleanly purges the `ptah` entry from `<worktree>/.mcp.json`.

### 3. What input data produces a wrong answer rather than an error?

- **Analysis**:
  - Empty or relative strings passed to `retainRoot` (`http-mcp-server.service.ts:541`) return `{ registered: false, reason: 'invalid-root' }` immediately without queueing work.
  - Calling `retainRoot` with a path that is already an open workspace folder succeeds and writes the entry. Releasing that root (`http-mcp-server.service.spec.ts:1596`) removes it from `retainedRoots` but preserves the `.mcp.json` entry because the folder is still present in `workspaceProvider.getWorkspaceFolders()`.
  - As noted in Defect 1, paths differing only by slash direction or drive letter casing on Windows (`D:\foo` vs `D:/foo`) fail `Set.delete` matching during release.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

- **Analysis**:
  - **File lock timeout**: If another process holds the lock on `<worktree>/.mcp.json`, `withMcpConfigLock` throws `FileLockTimeoutError`. This is caught in `registerInSlot` and mapped to `notRegistered('lock-timeout')`. `retainRootNow` catches this, prunes the root from `retainedRoots`, and returns `{ registered: false, reason: 'lock-timeout' }` (`http-mcp-server.service.spec.ts:1643`).
  - **Missing MCP server (e.g. CLI host / headless)**: The DI shim in `register.ts` returns `{ registered: false, reason: 'registrar-unavailable' }`.
  - **Server stopped / port closed**: If `retainRoot` is invoked when `this.stopped || !this.port`, it returns `{ registered: false, reason: 'not-started' }` (`http-mcp-server.service.ts:551`). No work is queued and no entry is written.

### 5. What is missing that the requirements never mentioned?

- **Analysis**:
  - **Path normalization**: The interface does not require canonical path normalization, leaving path representation consistency as a caller obligation.
  - **Degraded path test in `register.spec.ts`**: The shim degradation in `vscode-lm-tools/src/lib/di/register.ts` is implemented and verified manually/mechanically, but lacks a dedicated unit test in `register.spec.ts`.

---

## Failure Modes

### FM-1: Windows Path Mismatch Leaves Retained Root in Memory

- **Trigger**: Caller invokes `retainRoot` with Windows backslashes (`D:\worktree`) and invokes `releaseRoot` with forward slashes (`D:/worktree`).
- **Symptom**: `releaseRoot` completes without error, but `<worktree>/.mcp.json` remains planned in `desiredSlots()`.
- **Evidence**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:556,582`
- **Current handling**: Direct `Set.delete(root)` returns `false` and skips unregistering.
- **Recommendation**: Canonicalize with `path.normalize(root)` in `retainRoot` and `releaseRoot`.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

- **[MINOR] `http-mcp-server.service.ts:540,580`**: Raw string keys in `retainedRoots` Set without `path.normalize`.
- **[MINOR] `register.ts:124-152`**: Missing test case in `register.spec.ts` exercising `mcpSubagentRootRegistrarShim` when `TOKENS.CODE_EXECUTION_MCP` is unregistered or throws. (Acknowledged as out-of-scope for Batch 2).

---

## Data Flow

1. **Entry**: Caller invokes `IMcpSubagentRootRegistrar.retainRoot(worktreePath)` [OK]
2. **Validation**: `CodeExecutionMCP.retainRoot` validates non-empty and `path.isAbsolute(root)` [OK]
3. **Queueing**: Operation enqueued via `this.enqueueMcpOp` to prevent race conditions with workspace folder switches or server teardown [OK]
4. **State check**: Checks `this.stopped || !this.port`; returns `not-started` if stopped [OK]
5. **Set insertion**: `this.retainedRoots.add(root)` records root [OK]
6. **Reconciliation**: `this.reconcileRegistrations(this.port)` invokes `desiredSlots()`, which merges `retainedRoots` with workspace folders and writes `.mcp.json` under file lock [OK]
7. **Rollback on failure**: If writing fails or lock times out, `retainedRoots.delete(root)` rolls back the addition [OK]
8. **Release**: `releaseRoot(worktreePath)` deletes `root` from `retainedRoots` under `enqueueMcpOp`, then triggers `reconcileRegistrations` to remove the `.mcp.json` entry [OK]
9. **Teardown**: Server `stop()` calls `unregisterFromAllSlots()`, unregistering all retained roots from disk; retained roots survive in memory so restart can reinstate them if active [OK]

---

## Requirements Fulfilment

| Requirement                                                                               | Status   | Gap  |
| ----------------------------------------------------------------------------------------- | -------- | ---- |
| Port `IMcpSubagentRootRegistrar` + token `MCP_SUBAGENT_ROOT_REGISTRAR` in `platform-core` | COMPLETE | None |
| Export types from `platform-core/src/index.ts`                                            | COMPLETE | None |
| `CodeExecutionMCP` implements `IMcpSubagentRootRegistrar`                                 | COMPLETE | None |
| Operations serialized through `enqueueMcpOp`                                              | COMPLETE | None |
| Never reject (`retainRoot` returns outcome, `releaseRoot` returns `void`)                 | COMPLETE | None |
| Retained roots planned in `desiredSlots()`, surviving workspace folder changes            | COMPLETE | None |
| Idempotent retain and release                                                             | COMPLETE | None |
| Graceful degraded DI shim in `register.ts`                                                | COMPLETE | None |
| Comprehensive test coverage (11 new spec cases)                                           | COMPLETE | None |

---

## Edge Cases

| Case                                       | Handled | How                                                                   | Concern                  |
| ------------------------------------------ | ------- | --------------------------------------------------------------------- | ------------------------ |
| Empty / whitespace root                    | YES     | Rejected at entry (`invalid-root`)                                    | None                     |
| Relative root path                         | YES     | Rejected at entry (`invalid-root`)                                    | None                     |
| Server stopped before retain               | YES     | Returns `not-started`, retains nothing                                | None                     |
| Server stopped during/after retain         | YES     | `stop()` unregisters from disk; release after stop is a no-op         | None                     |
| Re-retain already retained root            | YES     | Preserves previous retention on failure, idempotent                   | None                     |
| Double release                             | YES     | No-op, touches no files                                               | None                     |
| Release root that is open workspace folder | YES     | Removes from `retainedRoots`, keeps in `.mcp.json`                    | None                     |
| Lock timeout on `.mcp.json`                | YES     | Returns `lock-timeout`, cleans up `retainedRoots`                     | None                     |
| Missing MCP server in DI                   | YES     | Shim returns `{ registered: false, reason: 'registrar-unavailable' }` | None                     |
| Case/separator variance on Windows         | PARTIAL | Set uses raw string equality                                          | Minor finding (Defect 1) |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None for Batch 2; caller in Batch 5 must pass the canonical `snapshot.worktreePath` consistently to ensure `Set.delete` matches on Windows.
- What a robust implementation would add:
  1. `path.normalize(root)` inside `retainRoot` and `releaseRoot`.
  2. A unit test in `register.spec.ts` asserting degraded shim behavior when `CODE_EXECUTION_MCP` is not registered.
