# Code Logic Review — TASK_2026_612_0332

Score 7/10 — APPROVED (0 blocking, 0 serious, 4 moderate, 1 minor). Reviewed by static reading of the uncommitted diff; I did not run the tests.

## Answers to the orchestrator's five points

1. **Normal sessions are unchanged in sidebar listing. APPROVED.**
   - `sdk-agent-adapter.ts:1156-1170` records `workingDirectory` only when `workingDirectory !== workspaceId`. A normal session whose cwd equals its workspace has it `undefined`, and `session-rpc.handlers.ts:1642` falls back to `workspacePath`. `session:list` then indexes the same directory as before.
   - If a normal session's cwd differs from `workspaceId` in format (trailing slash or a subfolder), it now indexes the SDK's real cwd directory. That is where the SDK wrote the JSONL, so the result is more correct, not less.
   - `listTranscriptIds` still calls `resolveSessionsDir` without partial match (`:1592`), so the strict listing is preserved.
   - A cwd that escapes differently from `workspaceId` still resolves through the existing exact, case-insensitive and `[-_]`-normalized steps.
2. **Resume validation and history load can now disagree for a deleted worktree. See finding 1.**
3. **FIFO queue: no loop and no lost request except the cap. See finding 3.**
   - `orchestra-canvas.component.ts:416-428` tracks `canvasTabRequests()` and drains through `untracked`. The drain sets the queue to `[]`, the effect re-runs once and returns at `length === 0`, so there is no loop.
   - `adoptTab` dedups.
   - A grep found no other readers of the old `canvasTabRequest` or `clearCanvasTabRequest`. Only the orchestra component and the specs use the new API.
   - The effect is created in the constructor, so it drains anything queued before mount.
4. **Adoption gate is correct, including the VS Code case.**
   - `tab-workspace-partition.service.ts:324-337` returns `workspacePath: activePath` for a tab in the active set. In VS Code `activePath` is `null` and `activeWorkspacePath` is `null`, so `null === null` passes.
   - A tab in a background partition returns that partition's path, which differs from the active path, so no wrong-grid tile is created. A request is queued only when `adoptAgentSessionTab` returns `adopted` or `exists` (`agent-session-adoption.service.ts:250-253`).
   - Adoption before the parent workspace is active returns `parent-absent`. That is not settled, so it is retried later. If the child is adopted into a background partition, the gate skips it and first-visit hydration tiles it when the user switches there.
5. **The regression test for `session:validate` does not discriminate. See finding 2.**

## Findings

### 1. Moderate — `session:validate` says "exists" for a child whose worktree was deleted, but the load and resume fall back to a different directory

- Files: `session-rpc.handlers.ts:956-959`, `chat-history-read.service.ts:93-111`.
- `resolveResumeWorkingDirectory` falls back to the workspace when `persistedPath` no longer exists on disk. The JSONL under `~/.claude/projects/<escaped worktree>` survives the worktree deletion, so `validate` and the sidebar `hasTranscript` now report true.
- Before the fix, a deleted-worktree child reported "expired" (by accident). Now the sidebar shows it as normal, and opening or resuming it reads the fallback directory. The result is empty history, or the "process exited with code 1" error that `session:validate` exists to prevent.
- This is a narrower case than the original bug, and the child's work is already committed. It is still an inconsistency introduced between two sides of the same check.
- Fix: in `session:validate` and the `session:list` directory choice, apply the same persisted-dir existence check, authorization check and fallback as `resolveResumeWorkingDirectory`. Alternatively, extract it into a shared helper.

### 2. Moderate — the `session:validate` regression test passes on base behavior

- File: `session-rpc.handlers.spec.ts:1658-1689`.
- On the base code, `findSessionFile(id, '/fake/workspace')` calls `resolveSessionsDir` with `allowPartialMatch: true` (`session-rpc.handlers.ts:1504`). The only directory listed is `-fake-workspace-.claude-worktrees-child`.
- The exact, case-insensitive and normalized matches fail. The basename "workspace" is then a substring of the worktree directory name, so the partial match returns it.
- `mockAccess` is `mockResolvedValue(undefined)`, so the file check succeeds. Base behavior returns the same `{exists: true, filePath}` as the new code, and the test cannot catch a regression of the `metadata?.workingDirectory` change.
- In real use the base partial match can also hit a worktree directory by luck, while a wrong match can also hide a miss. The validate change is still the correct fix.
- The `session:list` test (`:699-746`) does discriminate. List mode has no partial match, so base reports `hasTranscript: false` for the child.
- Fix: make the validate fixture's worktree basename not contain the workspace basename, or have `mockAccess` succeed only for the exact expected path. Add a negative assertion that the workspace directory is not probed.

### 3. Moderate — stale canvas requests accumulate and can be applied later in the wrong place

- Files: `agent-session-adoption.service.ts:279-296`, `orchestra-canvas.component.ts:416-428`.
- The gate checks `layoutMode() === 'grid'`, not that the canvas component is mounted. `layoutMode` defaults to `'grid'` (`app-state.service.ts:406`), so requests queue while a non-canvas surface is shown or before the canvas has mounted.
- If the canvas mounts later after a workspace switch, the first drain calls `adoptTab(tabId)` on the now-active workspace's grid for a tab that belongs to the previous workspace. The old single slot had the same exposure, but the queue is now unbounded and keeps every stale entry.
- Closed or deleted tabs are likely cleaned up by the existing reactive tile cleanup, which I did not trace.
- Fix: carry `workspacePath` in the request and skip it on drain if it differs from the active path. Alternatively, drop requests whose tab no longer exists.

### 4. Moderate — `deleteSessionFiles` still resolves from the workspace path

- File: `session-rpc.handlers.ts:809-815`.
- Deleting a child session from the sidebar leaves its JSONL under the worktree directory, so the file is orphaned. The partial-match guess in `findSessionFile` may or may not find it, and the other call sites at `:697` and `:813` keep the old behavior.
- This is out of the stated scope but is the same bug class: a child session that only half-behaves like a normal one.
- Fix: read `metadataStore.get(id).workingDirectory` there as well.

### 5. Minor — `adoptTab` refusal at `MAX_CANVAS_TILES` is silent

- File: `orchestra-canvas.component.ts:421-426`.
- When the tile cap is reached the request is consumed and dropped, with no retry and no signal back to the caller. The code already documents this as a known gap (TASK_2026_471). The tab stays in the tab list.

## Residual uncertainty

- I did not run the specs or `ptah_get_diagnostics`.
- I did not trace the canvas's cleanup of tiles whose tab is missing.
- I did not check the frontend specs against base behavior beyond the structure of the cases (burst FIFO, `focus:false`, and the active versus background gate).

## Re-review (round 2)

Final verdict: APPROVED. Read-only static review; I did not run the specs.

### Per finding

**F1 — resolved.**
- The extracted `resolve-working-directory` rule is `resume-working-directory.ts:22-61`, identical in behavior to the old private method.
- `chat-history-read.service.ts` now calls it at `:56-64` and `:105-113`.
- `session-rpc.handlers.ts:1692-1711` (`resolveTranscriptDirectory`) applies it for session list and validate. It short-circuits when there is no recorded directory or it equals the workspace path, so normal sessions get no `exists()` call and no behavior change.
- A deleted worktree, an unauthorized directory or an unsafe directory falls back to the workspace directory. Validate, list and the history load therefore agree.
- Batching: `resolveTranscriptDirectories` (`:1660-1690`) resolves once per distinct `workingDirectory`, and `listTranscriptIdsByDirectory` runs one `readdir` per distinct resolved directory. There are no per-row `exists()` calls.

**F2 — resolved.**
- The new validate test (`session-rpc.handlers.spec.ts`, "finds a child session transcript…") uses worktree `/child-root/child`. The escaped name `-child-root-child` does not contain the workspace basename "workspace", so base partial match cannot find it.
- `mockAccess` succeeds only for the exact expected path and the projects directory, and the test asserts the workspace-directory path is not probed. It would fail on base.
- The list test and the deleted-worktree list test (asserts `exists` was called and `readdir` was not called for the worktree directory) are also discriminating.

**F3 — resolved, with a minor behavior note.**
- `CanvasTabRequest.workspacePath` is set at `agent-session-adoption.service.ts` (`landed.workspacePath`, only when it equals the active path) and at `task-prompt-bridge.service.ts` (`tabManager.activeWorkspacePath`).
- The canvas drain (`orchestra-canvas.component.ts:427-431`) skips requests whose workspace differs from `canvasStore.activeWorkspacePath() ?? ''`.
- Path format is identical: the canvas store's active path is set only from `tabManager.activeWorkspacePath$` (`orchestra-canvas.component.ts:437-440`, via `switchWorkspaceTiles` and `hydrateWorkspace`), with no normalization on either side. `null` maps to `''`, which is the store's `IMPLICIT_WORKSPACE_PATH` (`canvas.store.ts:61`). Electron requests are therefore not all dropped, and the VS Code case works.
- The Tasks-board launch tiles in the same workspace when the canvas is mounted and hydrated.

**F4 — resolved.**
- `deleteSessionFiles` (`session-rpc.handlers.ts:826-835`) uses the raw recorded directory (`workingDirectory ?? workspacePath`).
- The raw choice is sound, because the transcript outlives the worktree.
- `findSessionFile` only escapes the path into a directory name under `~/.claude/projects`, and the existing `startsWith` containment check at `:845` still applies, so no traversal risk is introduced.
- The delete test covers a deleted-worktree child.

### DI and hosts
- `SessionRpcHandlers` gained `FILE_SYSTEM_PROVIDER` and `PLATFORM_INFO` injections (`session-rpc.handlers.ts:169-172`).
- The handler is a singleton resolved by token in vscode (`phase-3-handlers.ts:70`), electron (`phase-4-handlers.ts:91`) and cli (`container.ts:821`).
- `ChatHistoryReadService` already injects the same two tokens in the same containers, so they resolve in every host.
- The only direct constructions are the two specs. `session-list.perf.spec.ts:284-285` passes `{}` stubs, which is fine because normal sessions never reach `exists()`.

### New defects
None that I could verify as blocking or serious.

Minor, verified by code reading:
- If a request is drained while the canvas store's active path is still null, the request is dropped because `'' !== path`. On first mount the request effect (`:416`) is declared before the workspace-switch effect (`:437`). The new tab is still tiled by first-visit hydration from `tabManager.tabs()`, but it is no longer focused. Only the `focus` step is lost.
- A request arriving in the same tick as a workspace switch, before the canvas store catches up, is dropped. First-visit hydration also covers it. A non-first-visit switch would not, but the window is narrow.
