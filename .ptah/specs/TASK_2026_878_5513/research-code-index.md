# Research: Memory & Skills "Re-index" does nothing (codebase/symbol indexing)

Read-only trace. Paths relative to the worktree root. V = verified by reading code or logs. U = unverified/inferred.

## Verdict (short)

The click DOES run in the backend (V: Electron log shows `[indexing-control] start` at 20:31:21Z after the user click, and the 20:31 census is still running at 20:39). It runs without ANY visible feedback in the "indexed" state, and a full census takes about 2.4 hours on this repo, so the user sees nothing change. Secondary: a second click while a run is active is silently dropped, and every failure/refusal path (`accepted:false`) is swallowed by the renderer.

## 1. Which buttons exist (codebase/symbol indexing)

| # | Label | Where | Click path | Visible when |
|---|---|---|---|---|
| A | "Re-index" (`aria-label="Re-index workspace"`) | `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html:200-207` (state `indexed`), `:243-247` (state `stale`), `:285` (error "Try again", force) | `onStart(true)` (`workspace-indexing.component.ts:97-101`) -> `WorkspaceIndexingService.start(root, true)` (`workspace-indexing.service.ts:209-217`) -> RPC `indexing:start` {workspaceRoot, force:true} | Memory tab, "Code index" view, section "Advanced indexing" (`memory-curator-tab.component.ts:207-212`). THIS is the user's "Re-index". |
| B | "Index now" | `workspace-indexing.component.html:60` (`onStart(false)`) | same RPC, force=false | state `never-indexed` |
| C | Banner "Index now" / "Re-index" (stale) / "Try again" | `memory-indexing-banner.component.ts:34-45, 133-139, 151-157` -> `indexNow` -> `memory-curator-tab.component.ts:473-477 onIndexNow()` -> `indexingService.start(root,false)` (note: force=false, `.catch(()=>undefined)`) | same RPC | Only in default (memory) view, only for states never-indexed/stale/error. NOT shown for `indexed`, `loading`, `no-workspace`. |
| D | "Resume" / "Cancel" | banner `:107-120`, tab `:479-490` -> `indexing:resume` / `indexing:cancel` | paused/indexing states |
| E | "Rebuild index" (header, code view) | `memory-curator-tab.component.ts:137-147, 555` -> `memory.state.rebuildIndex()` (`memory-state.service.ts:277-286`) -> `memory-rpc.service.ts:168-181` -> `memory:rebuildIndex` | Misleadingly labelled. Backend `memory-rpc.handlers.ts:356-371` -> `MemoryStore.rebuildIndex()` (`memory.store.ts:995+`) rebuilds only `memory_chunks_fts`/`memory_chunks_vec` (MEMORY chunks), NOT `code_symbols`. Result `{rebuiltFts,rebuiltVec}` is discarded by the state service; backend returns `{false,false}` on error (a "success" to the caller). Only feedback: spinner via shared `loading()` and `error()` on thrown RPC error. |

Button E is not codebase indexing but sits in the same Code view header and is a second "nothing happens" candidate. Button A is the one with the reported symptom.

## 2. End-to-end trace of A (Re-index, force=true)

1. Renderer: `WorkspaceIndexingService.start` calls `rpc.call('indexing:start', {workspaceRoot, force})` and only does `loadStatus` if `result.isSuccess()` (`workspace-indexing.service.ts:209-217`). It never inspects `data.accepted`. No loading/disabled flag, no toast, no error surfacing. Button A has no `[disabled]` and no spinner.
2. RPC registration: `IndexingRpcHandlers.register()` registers `indexing:start` (`libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers.ts`, start handler ~line 138-175). It is registered and the registration log line `[indexing] RPC handlers registered` exists in code (V code; U whether this log line appears today, grep for it was not run on the log).
3. Gate: `if (!this.runDeps) { warn; return {accepted:false, state:'never-indexed'} }` (~line 147-153). `runDeps` is set ONLY in `bootThothRuntime` when `sqliteConnection.isOpen && container.isRegistered(CODE_SYMBOL_INDEXER) && workspaceRoot` (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:455-517`). If Electron boots with no workspace folder, or the indexer is not registered, every click returns `accepted:false`, the renderer ignores it: truly "nothing happens". (U: not the case in the reporter's session; the log proves a start did happen.)
4. Fire-and-forget: `void indexingControl.start(pipeline(undefined), root, runDeps, {force})` then immediately `getStatus` and return `{accepted:true,state}` (handler ~155-170). Renderer gets the status BEFORE the run does anything, so the post-click `loadStatus` shows the same "Indexed / Last updated X" text.
5. `IndexingControlService.start` (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:321-408`):
   - `if (this.activeAbortController) { logger.debug('start() called while already running — ignored'); return; }` (:327-332). A click during any run is silently ignored (debug level, not even in the INFO log).
   - Sets `activeAbortController` at :333 BEFORE `await deriveWorkspaceFingerprint` (:336) and `deriveGitHeadSha` (:341), which sit OUTSIDE the `try` (try starts :358). If either throws, the controller is never cleared and every later click is ignored until app restart. (V by reading; U whether it triggers in practice.)
   - Logs `[indexing-control] start` at INFO (this is the line seen in the log).
   - `runSymbols` -> `runSymbolsIndexWithProgress` -> `deps.runSymbols` (:538-587). Memory pipeline is skipped in Electron (`runDeps` only defines `runSymbols`, `boot-thoth-runtime.ts:463`).
   - On finish: upserts `indexing_state.last_indexed_at`, broadcasts `INDEXING_COMPLETE`, clears controller (:379-398). Errors: `last_error` persisted + debug log only; NO broadcast of an error event (:400-407) so the UI only learns on the next `getStatus`.
6. Indexer: `symbolIndexer.indexWorkspace(wsRoot,{signal,userInitiated:true,onProgress})` (`boot-thoth-runtime.ts:466-499`). `CodeSymbolIndexer.indexWorkspace` (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:554-571`) keeps ONE census per root: if a census is already active the call JOINS it (`joinActiveCensus`, :743-775) - adds its progress listener and flips `userInitiated`, returns the active promise. So an in-flight boot/watcher census is not "ignored" at the indexer level; the click piggybacks on it and just waits for it (potentially hours). Force has no distinct semantics at the indexer (`force` only affects `row.symbols_enabled` and memory gating in the control service, :359, :371).
7. Progress back to UI: onProgress -> `webviewManager.broadcastMessage(MESSAGE_TYPES.INDEXING_PROGRESS, ...)` (`boot-thoth-runtime.ts:478-495`), also the control service broadcasts a final 100% "Done" (:558-566) plus `INDEXING_COMPLETE`. Renderer receives them through `WorkspaceIndexingService.handleMessage` (`workspace-indexing.service.ts:162-176`, registered via MESSAGE_HANDLERS per file header; U: registration in `apps/ptah-extension-webview/src/app/app.config.ts` not re-read here). Electron `WebviewManager.broadcastMessage` delivery to the renderer not verified (U), but `indexing:complete`-driven refetch in the tab effect exists (`memory-curator-tab.component.ts:~405-424`).

## 3. Root cause of "nothing happens"

Ranked, with evidence:

1. **No feedback in `indexed` state (primary, V).** `WorkspaceIndexingService.uiState` (`workspace-indexing.service.ts:91-155`) only turns progress into the `indexing` UI for backend status `never-indexed` (:101-105) or `indexing` (:113). But the backend can never report `indexing`: `deriveStateFromRow` (`indexing-control.service.ts:106-118`) returns only error/paused/never-indexed/stale/indexed - there is no "running" derivation. So when the user clicks Re-index on an `indexed` (or `stale`) workspace the panel stays on "Indexed - Last updated X ago", progress events are stored in `_progress` and never shown, the button does not disable or spin. Looks dead. The banner (default view) has no `indexed` case at all.
2. **Run is extremely long (V, log).** `~/.config/Ptah/logs/Ptah Electron-2026-11-04.log`: `[CodeSymbolIndexer] Workspace indexing complete: filesScanned 3806, symbolsIndexed 41371, durationMs 8718776` (18:00:16Z, = 2.4 h) and again `durationMs 8668637` (20:24:44Z). Contributing: `[background-work] deferral ceiling reached ... code-symbol-indexer maxDeferMs 600000 state foreground-busy` (18:25, 19:31), repeated slow SQLite statements (`DELETE FROM code_symbols_vec`, vec MATCH 4.8 s, `quick_check` 1.5 s, main-thread lag p99 1.6 s at 20:31:47). The click at 20:31:21Z logged `[indexing-control] start` and there is no completion line by 20:39Z. So the click ran; it is the "reindexInFlight=true / updating / 3190 unchecked" state the MCP tool reported. Note the previous census ended only 7 minutes before the click; census re-runs happen frequently (see section 4: watcher full runs), so the index was already "fresh" and the reindex was semantically a no-op for the user.
3. **In-flight dedupe is silent (V).** A second click while `activeAbortController` is set returns at debug level (`indexing-control.service.ts:327-332`); the RPC still replies `accepted:true`. Combined with (1) and (2) the user cannot tell "running" from "ignored".
4. **Refusals/errors swallowed (V).** `accepted:false` (no runDeps, no workspaceRoot, setup error) and `catch` in the banner path `.catch(()=>undefined)` (`memory-curator-tab.component.ts:476`); service ignores `accepted`; runtime errors are only persisted to `last_error` and logged at debug, no push event.
5. Leak risk (V code, U in practice): controller set before awaited fingerprint calls outside `try` -> permanent "already running".
6. "Never ran" is NOT the explanation for this report; it IS possible when `runDeps` is null (no workspace at boot) - same silent UI.

## 4. How codebase indexing works today

- Store: SQLite (`persistence-sqlite`, migration `0013_code_symbols.ts`): table `code_symbols` (id, workspace_root, file_path, kind, symbol_name, subject, text, token_count, timestamps), FTS (BM25) and `code_symbols_vec` (sqlite-vec embeddings). Written via `CodeSymbolStore` / `symbol-sink.adapter.ts`. Per-workspace progress row lives in `indexing_state` (fingerprint, git_head_sha, last_indexed_at, symbols_cursor, last_error, symbols_enabled, memory_enabled).
- Triggers:
  - Boot: `bootThothRuntime` builds `WorkspaceIndexLifecycleService` with the file watcher; it starts a background full `indexWorkspace` (not `userInitiated`, so it waits on the background-work governor), `boot-thoth-runtime.ts:~520-560`.
  - Watcher: `libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts` debounces 500 ms per-file `reindexFile`; storms (>=25 paths / overflow / truncated) collapse into one governed full run; extension-less delete triggers a full run with a 30 s cooldown (:60-80).
  - Manual: the `indexing:*` RPCs above (UI), and `ptah_code_reindex` / `ptah.code.reindex` MCP tool (`userInitiated`).
- Coverage: indexer tracks per-root census state (`current` / `updating` / `incomplete`) reported by `ptah_code_search_symbols` (`coverage`), independent of `indexing_state.last_indexed_at`.
- Consumers: `memory:searchSymbols` (Code view list, `memory-state.service.ts loadSymbols`), `ptah_code_search_symbols`/symbol index MCP tools, memory hybrid search. `memory-state` stats tile `codeIndex`.
- The UI "Indexed / last updated" text comes from `indexing_state.last_indexed_at` (written only by `IndexingControlService.start/resume`), so boot/watcher censuses do NOT update it; it can read old even though the index is fresh. (V by reading both write sites; U on resulting user-visible mismatch.)

## 5. Observability gaps

UI shows today: banner/panel status text, a percent bar only for `never-indexed`/`indexing`/`paused`; "Last updated N ago" for indexed. Missing:
- Running indicator in `indexed`/`stale` states (progress ignored); disabled+spinner on button A/B/C while a run is active (`busy()` exists only for the banner).
- Backend "running" state in `getStatus` (expose `isRunning`, current phase, processed/total, run start time, and whether it joined a boot/watcher census).
- Outcome of last run: files scanned, symbols indexed, errors (16 errors per run are only in the log), duration, and the error message with a push event on failure.
- Surface `accepted:false` reasons (`no-workspace`, `indexer-not-ready`, `already-running`) from the RPC.
- Live coverage (`current/updating/incomplete`, unchecked file count) next to "Code index".
- Clarify labels: E "Rebuild index" -> "Rebuild memory search index" and report `rebuiltFts/rebuiltVec`.

Tests existing: `workspace-indexing.service.spec.ts` (uiState cases only: never-indexed override, code-only, indexed; nothing for `start()` result handling, progress during `indexed`, or `accepted:false`); `workspace-indexing.component.spec.ts` exists (not read; U whether it covers onStart); `memory-curator-tab.component.spec.ts` mocks `rebuildIndex` only (no onIndexNow/onRebuildIndex assertions found by grep); `indexing-control.service.spec.ts:265-336` covers start idempotence ("second call ignored"), pause/resume, completion; `memory-rpc.handlers.spec.ts` covers rebuildIndex handler. No spec for `indexing-rpc.handlers` accepted:false-when-no-runDeps paths was checked (U).

## 6. Fix proposal (minimal)

1. `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts`
   - Move the fingerprint/git-sha awaits inside the `try`, or wrap so `activeAbortController`/`activeWorkspaceFp` are cleared in a `finally` on every non-pause exit (also on the error path, :400-407).
   - Add `isRunning()`/include `running: boolean` (and last run stats) in `getStatus`; make `deriveStateFromRow`-based state `indexing` when `activeAbortController` is set. Return/emit a distinct `already-running` outcome instead of a debug-log return; broadcast an error event (or reuse INDEXING_COMPLETE with `error`) on failure. Log start/finish/ignored at INFO.
   - Persist a `last_run` summary (files, symbols, errors, durationMs) from the indexer stats.
2. `libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers.ts` + shared `IndexingStartResult` type (`libs/shared/src/lib/types/rpc/...`): add `reason?: 'no-workspace' | 'indexer-not-ready' | 'already-running' | 'error'`; return it for the `runDeps` null and already-running cases.
3. `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts`
   - `start/resume`: track `_starting`/`_lastActionError` signals; inspect `data.accepted`/`reason`; set an error string on failure and on RPC failure.
   - `uiState`: when `_progress()` is non-null and < 100, return `indexing` regardless of backend `indexed`/`stale` state (and when status.running). Expose `isRunning` computed.
4. `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html/.ts`: in `indexed`/`stale`/`error` blocks disable button A while running, show spinner and progress bar/label ("1234/3806 files"), render last-run summary and action error text (`role="alert"`). Cancel remains available.
5. `libs/frontend/memory-curator-ui/src/lib/components/memory-indexing-banner.component.ts` and `memory-curator-tab.component.ts`: add an `indexed` case (compact "Indexed N symbols, last updated X [Re-index]") or at least keep the `indexing` case reachable; replace `.catch(()=>undefined)` in `onIndexNow/onResumeIndex/onCancelIndex` with error surfacing; pass `force` consistently.
6. `memory-curator-tab.component.ts` header button E: rename to "Rebuild memory search index", use a dedicated `rebuilding` signal (not the shared `loading`), show result/err message via `memory-state.service.ts rebuildIndex` (return the `{rebuiltFts,rebuiltVec}` and set an info signal); backend `memory-rpc.handlers.ts:362-370` should rethrow `RpcUserError` rather than return `{false,false}`.
7. Tests: extend `workspace-indexing.service.spec.ts` (progress while `indexed` -> `indexing`; `accepted:false` sets error), `workspace-indexing.component.spec.ts` (button disabled/spinner while running), `indexing-control.service.spec.ts` (controller released when fingerprint throws; second start returns `already-running`), `indexing-rpc.handlers` spec (no runDeps -> reason).
8. Optional/out-of-scope-but-relevant: investigate the 2.4 h census duration (vec DELETE per symbol `DELETE FROM code_symbols_vec WHERE rowid = ?` ~50-150 ms each, governor deferrals); consider a "force" that is a no-op when a census finished < N minutes ago, with a visible "already up to date (scanned 7 min ago)" message.

## Unknowns / not verified
- Whether `INDEXING_PROGRESS` push messages actually reach the Electron renderer (WebviewManager impl and MESSAGE_HANDLERS registration not re-read). Smallest check: log in `handleMessage` while a run is active, or read `apps/ptah-electron` webview-manager broadcast.
- Whether `indexing:start` RPC call itself reached the handler (only the downstream `[indexing-control] start` line, which implies yes).
- SQLite DB contents were not queried (sqlite3 not run); `indexing_state` row for fingerprint `8815c58aa5ca61d2` would show last_indexed_at / last_error.
- Component spec contents for workspace-indexing component not read.
