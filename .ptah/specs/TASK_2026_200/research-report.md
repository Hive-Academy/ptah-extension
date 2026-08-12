# Research Report — TASK_2026_200, Webview File-Picker Surface

Scope: extend context.md's MCP-only analysis to the webview/Electron RPC
surface behind the chat `@` file picker, re-run the deferred §3 audit, and
re-adjudicate the fix strategy. context.md's MCP findings are treated as
established and cited, not re-derived.

---

## 1. Verdict

**Same defect family, worse coverage, and a second, independent frontend-side
cause layered on top.** The `@` file picker's backend RPC (`context:getAllFiles`)
resolves through the exact same DI singleton chain as the MCP `ptah_search_files`
tool — `TOKENS.CONTEXT_ORCHESTRATION_SERVICE` is registered once
(`workspace-intelligence/src/di/register.ts:136-139`) and injected into both
`ContextRpcHandlers` (`context-rpc.handlers.ts:35`) and `PtahAPIBuilder`'s
`coreDeps` (`ptah-api-builder.service.ts:281,419`). It is literally one
instance serving both surfaces, so this is not a sibling bug — it is the same
raw-provider defect context.md diagnosed, reached through a second caller.

But the webview surface is **strictly worse**, not equally covered, for two
reasons this report establishes with code evidence:

1. **No session concept exists on the RPC transport at all.** `RpcMessage`
   (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:166`) carries only
   `{ method, params, correlationId }` — no session id, no window id, no
   workspace root. The MCP path at least has a caller-session-id precedence
   chain (`ptah-api-builder.service.ts:768`) to hang a fix on. The webview path
   has nothing to hang a fix on until a parameter is added to the wire
   contract — this is new plumbing, not a wiring-order fix.
2. **A second, independent, and more severe bug exists purely in the backend
   file-index singleton and is 100% reproducible in Electron with a single
   window and zero concurrency** — `WorkspaceFileIndexService` is built once
   at boot for one root and is _never re-built on workspace switch_ (§4
   below). This is a distinct defect from "coreDeps lacks the proxy" — even a
   perfect session-aware provider fix for the MCP surface would not touch it,
   because nothing on the picker path ever asks for a different root after
   the first build.

A third, frontend-only cause compounds both: `FilePickerService`'s cache
(`_workspaceFiles`, `_lastUpdate`) is global, unkeyed by workspace, and is
never invalidated by `WorkspaceCoordinatorService.switchWorkspace()` — the one
place the frontend orchestrates every other workspace-aware service on a
switch. See §4.C.

---

## 2. File-picker call chain (file:line for every hop)

| #   | Hop                                                                                               | Location                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | User types `@`, dropdown opens                                                                    | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:975` calls `filePicker.ensureFilesLoaded()`                                                                                                                                                                                                                                                 |
| 2   | Cache check (TTL 5 min, unkeyed)                                                                  | `libs/frontend/chat/src/lib/services/file-picker.service.ts:240-259` `ensureFilesLoaded()`                                                                                                                                                                                                                                                                                      |
| 3   | RPC call, no workspace param                                                                      | `file-picker.service.ts:174-177` → `rpcService.call('context:getAllFiles', { includeImages: false, limit: 1000 })`                                                                                                                                                                                                                                                              |
| 4   | Params type — confirms no root/session field exists                                               | `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:14-19` `ContextGetAllFilesParams { includeImages?, limit? }`                                                                                                                                                                                                                                                                   |
| 5   | Transport — confirms envelope carries nothing else                                                | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:166` `handleMessage({ method, params, correlationId })`                                                                                                                                                                                                                                                                  |
| 6   | RPC dispatch                                                                                      | `libs/backend/rpc-handlers/src/lib/handlers/context-rpc.handlers.ts:56-65` `registerGetAllFiles` → `this.contextOrchestration.getAllFiles(params)`                                                                                                                                                                                                                              |
| 7   | DI resolution of `contextOrchestration` — same singleton as MCP's `coreDeps.contextOrchestration` | `context-rpc.handlers.ts:35-36` `@inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)`; registered once at `libs/backend/workspace-intelligence/src/di/register.ts:136-139`                                                                                                                                                                                                            |
| 8   | Orchestration → service                                                                           | `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts:375-377` `getAllFiles()` → `this.contextService.getAllFiles(...)`                                                                                                                                                                                                                             |
| 9   | Service → live index (no root param taken here)                                                   | `libs/backend/workspace-intelligence/src/context/context.service.ts:435-447` `getAllFiles(includeImages, offset, limit)` → `this.fileIndex.getAll(...)`                                                                                                                                                                                                                         |
| 10  | **Root resolved here, once, ever**                                                                | `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts:170-179` `ensureReady()` → `this.workspaceProvider.getWorkspaceRoot()` only if `!this.started`; subsequent calls skip straight to the cached maps                                                                                                                                        |
| 11  | Raw, process-global provider                                                                      | `PLATFORM_TOKENS.WORKSPACE_PROVIDER` injected at `workspace-file-index.service.ts:147-148` — `ElectronWorkspaceProvider.getWorkspaceRoot()` (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:86-88`) or `VscodeWorkspaceProvider.getWorkspaceRoot()` (`libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:71-73`) |
| 12  | Eager pre-build at boot, pinned to the startup root                                               | Electron/CLI shared path: `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:378-391` `fileIndex.start(workspaceRoot)`, called once from `bootThothRuntime(container, { workspaceRoot })`; VS Code: `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:249-264`, same one-shot pattern from `vscode.workspace.workspaceFolders[0]`                               |

`context:getFileSuggestions` (`file-picker.service.ts:398-401`) and the
`/` slash-command pickers (`autocomplete:agents`, `autocomplete:commands`)
follow the identical shape — see §4.

---

## 3. Scoping mechanism per runtime

### Electron

- One process, one `BrowserWindow` (`apps/ptah-electron/src/windows/main-window.ts` — "sole window factory" per its own `CLAUDE.md`; `app.on('activate')` only recreates a window when zero exist). There is no multi-window-multi-workspace scenario in this codebase's Electron build.
- BUT Electron supports multiple **open folders** and an **active-folder switch** within that one window/process: `ElectronWorkspaceProvider` holds `folders: string[]` + a single `activeFolder` (`electron-workspace-provider.ts:51-52,86-88`), and `workspace:switch` RPC (`libs/backend/rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts:284-304`) calls `this.workspaceLifecycle.setActiveFolder(params.path)` at runtime.
- This is exactly the mechanism the user's report points at: `getWorkspaceRoot()` is one process-global mutable value. Anything that reads it _at call time_ (the raw `IWorkspaceProvider`) correctly reflects the current active folder — but anything that cached a root once (§2 hop 10-12) does **not** track subsequent switches. **This is the confirmed leak mechanism for Electron.**

### VS Code

- The extension host is one process per window (confirmed by the CLAUDE.md architecture: `apps/ptah-extension-vscode` "activates inside the extension host process"), so `vscode.workspace.workspaceFolders` genuinely is that window's folder — `VscodeWorkspaceProvider.getWorkspaceRoot()` (`vscode-workspace-provider.ts:71-73`) is correct **for that window**. `WorkspaceRpcHandlers`'s own docstring confirms VS Code doesn't even implement `IWorkspaceLifecycleProvider`, so `workspace:switch`/`addFolder`/`setActiveFolder` are not served there (`workspace-rpc.handlers.ts:13-31`) — VS Code has no in-window workspace-switch UX at all.
- However — and this is exactly the mismatch context.md's MCP repro documents — a Ptah **session**'s `projectPath` can differ from the VS Code window's opened folder (context.md §1's repro: window on `property-hub`, session on `angular-3d-showcase`). The webview RPC surface has **no session id on the envelope** (§2 hop 4-5), so it cannot special-case this even in principle. In VS Code the picker is "correct for the window, wrong for the session" whenever session and window diverge — a narrower window than Electron's (no in-window switching) but not a null risk.

### CLI (`platform-cli`)

- `CliWorkspaceProvider.getWorkspaceRoot()` (`libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:80`) is process-per-invocation; `ptah-cli`/`ptah-tui` have no Angular webview/file picker, so this surface is **not reachable** here. Out of scope for this bug but noted for completeness of target B.

---

## 4. Reproduction, confirmed or corrected

### 4.A — Electron: confirmed, deterministic, single window, zero concurrency required (the strongest reproduction)

This is a stronger and more damning finding than context.md's MCP repro, because it needs no second session and no race — it is reachable through the ordinary, single-user "switch workspace" button.

1. Launch Ptah Electron with workspace A open (`startupWorkspaceRoot = A`).
2. `bootThothRuntime` calls `fileIndex.start(A)` once (`boot-thoth-runtime.ts:386`). `WorkspaceFileIndexService.workspaceRoot = A`, `started = true` (`workspace-file-index.service.ts:128-131,157-164,181-195`).
3. User calls `workspace:switch` to open/activate workspace B. `WorkspaceContextManager.switchWorkspace()` (`workspace-context-manager.ts:123-138`) only re-routes **state storage** (`WorkspaceAwareStateStorage`). `WorkspaceRpcHandlers.registerSwitch` (`workspace-rpc.handlers.ts:284-304`) then calls `this.workspaceLifecycle.setActiveFolder(params.path)`, which correctly flips `ElectronWorkspaceProvider.activeFolder` to B.
4. **Nothing in this path calls `WorkspaceFileIndexService.start(B)`.** Grepping the whole Electron app tree for `WorkspaceFileIndexService` finds zero references outside the one-shot boot call in `thoth-runtime`.
5. User opens `@` in chat. `ensureReady()` (`workspace-file-index.service.ts:170-179`) sees `this.started === true` and returns immediately — it never re-checks `workspaceProvider.getWorkspaceRoot()`.
6. **Result: the `@` picker lists workspace A's files forever, for the entire remaining process lifetime, regardless of how many times the user switches the active folder.** This matches the user's report ("lists files belonging to a DIFFERENT workspace than the one the session/window is bound to") exactly, and is the single most likely explanation for it.

`autocomplete:agents`/`autocomplete:commands` (the `/` picker) do **not** even have this one-shot cache — they call `getWorkspaceRoot()` fresh on every `discoverAgents()`/`discoverCommands()` (`agent-discovery.service.ts:122`, `command-discovery.service.ts:199`) — so they track the _process-global_ active folder live. That is actually more correct than the file picker for the Electron single-switch case, but it means they inherit the _other_ leak: they always answer for the process-global active folder, never for a specific session/tab that might be bound to a different root (the MCP-style mismatch), because — like `context:getAllFiles` — their RPC params carry no root/session at all (confirmed: `autocomplete-rpc.handlers.ts` interfaces have no such field).

### 4.B — Electron: frontend cache is a second, compounding cause (**confirmed**, independent of 4.A)

`FilePickerService._workspaceFiles`/`_lastUpdate` (`file-picker.service.ts:60,63`) are global signals with a 5-minute TTL and no workspace key. `WorkspaceCoordinatorService.switchWorkspace()` (`workspace-coordinator.service.ts:92-120`) — the single orchestration point that already resets `TabManagerService`, `SessionLoaderService`, and every editor/git/terminal service on a switch — **does not reference `FilePickerService` at all.** So even a fully-fixed backend (root-aware, correctly re-indexed per switch) would still serve up to 5 minutes of the _previous_ workspace's file list from the frontend cache after every switch, because nothing tells `FilePickerService` a switch happened. This is a distinct, purely frontend defect and must be fixed regardless of which backend strategy is chosen.

### 4.C — VS Code: narrower, session/window-divergence only, **not disproven, not independently reproduced here**

Per §3, VS Code has no in-window switch, so 4.A's mechanism does not apply. The only reachable leak is the same one context.md's MCP repro demonstrates: a session whose `projectPath` differs from the VS Code window's folder. Since the RPC envelope carries no session id (§2 hop 4-5), the file picker in that VS Code window would show the window's folder's files even for a message being composed in a chat tab bound to a different session/root. This is **INFERRED** from the absence of any session parameter on the wire — it was not independently reproduced by running the app, only established structurally from the code (no session id exists to thread through, so the only possible outcome is "window's root, always").

### 4.D — CLI: not applicable (no webview/file picker surface exists on this host).

---

## 5. Section 3 audit results (the deferred list)

| Site                                                                                           | Provider used                                                                                                                  | Reachable from                                                                                                                                                                                                                                                                               | Leaks?                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-file-index.service.ts:176` (`ensureReady`)                                          | Raw `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, but only consulted **once** per process lifetime (see §4.A)                          | Webview RPC (`context:getAllFiles`, `context:getFileSuggestions` via `ContextService`) **and** MCP `ptah_search_files`/relevant-file suggestions (context.md §3, same `ContextOrchestrationService` singleton)                                                                               | **Yes — confirmed, and the worst instance found**: never re-resolves after first build, not just "raw provider" but a permanently stale snapshot regardless of provider correctness                                                                                                                                                                                 |
| `workspace-indexer.service.ts:329` (`getDefaultWorkspaceFolder`)                               | Raw provider, read fresh on each call (no caching field on this class)                                                         | `WorkspaceIndexerService.indexWorkspaceStream` — used by `WorkspaceFileIndexService.build()` (indirectly, receives an explicit `workspaceFolder` param at call time, so this private helper is a fallback only reachable when no explicit param is given) and by code-symbol indexing wiring | **Conditional** — leaks only for callers that omit an explicit `workspaceFolder`; the one path we traced (`build(workspaceRoot)`, `workspace-file-index.service.ts:211-215`) always passes an explicit root, so this helper is currently a dead fallback on that path. Not independently exercised beyond static reading — labelled **INFERRED** for other callers. |
| `context-analysis/context-enrichment.service.ts:383` (`toRelativePath`)                        | Raw provider, read fresh per call                                                                                              | Display-only path formatting inside content-enrichment (token-reduction summaries), not the file-picker or MCP tool surface directly, per its own file's scope                                                                                                                               | **Conditional/low severity** — produces a wrong _relative-path display string_ (falls back to a 3-segment tail if the root doesn't match) rather than wrong _file contents or listings_. Same "raw provider" defect class, but not part of the picker bug.                                                                                                          |
| `autocomplete/command-discovery.service.ts:199,272` (`discoverCommands`, `initializeWatchers`) | Raw `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, read fresh per call (confirmed via grep — same injection pattern as agent-discovery) | Webview RPC `autocomplete:commands` (the `/` picker) — **not** wired into any MCP namespace builder in `ptah-api-builder.service.ts` (no reference found)                                                                                                                                    | **Yes — confirmed, live-tracks the process-global active folder** (so correct for 4.A's single-window-switch case, but has zero session/tab awareness — same defect class as `context:getAllFiles`, minus the one-shot-cache aggravation)                                                                                                                           |
| `autocomplete/agent-discovery.service.ts:122,193` (`discoverAgents`, `initializeWatchers`)     | Raw `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`agent-discovery.service.ts:61-62`), read fresh per call                             | Webview RPC `autocomplete:agents` (the `/` picker) — not present in the MCP namespace builders either                                                                                                                                                                                        | **Yes — confirmed**, same as command-discovery: reachable only from the webview `/` picker, live-tracks process-global root, no session/tab awareness                                                                                                                                                                                                               |

**Correction to context.md's framing:** context.md characterized this list as merely "suspected — verify during the fix," implying the raw-provider pattern was the whole story. The audit shows the actual severity split is not uniform: `workspace-file-index.service.ts` is the _worst_ of the five (permanent staleness, not just wrong-window), while `context-enrichment.service.ts:383` is comparatively minor (display string only). Treating the whole list as one fix is imprecise — the file-index one-shot-cache defect needs its own fix distinct from "inject the session-aware provider."

---

## 6. Recommended fix strategy

**Firm recommendation: reject context.md's "alternative considered" (registering the session-aware proxy directly against `PLATFORM_TOKENS.WORKSPACE_PROVIDER`) even more strongly now than context.md did, and additionally reject "just inject the session-aware provider into the webview RPC handlers" as a complete fix — because the webview surface has no session id to be aware of in the first place.**

Do this instead, as three separable pieces of work:

1. **Add explicit `workspaceRoot` (or `sessionId`) params to the picker-surface RPC contracts**, matching the pattern the codebase already uses for `tasks:get`/`cron:create` (per `TASK_WORKSPACE_SCOPING_REVIEW`'s own review of that exact pattern): `context:getAllFiles`, `context:getFileSuggestions`, `autocomplete:agents`, `autocomplete:commands`. The frontend already has the needed value at the call site — `TabManagerService`/`ChatStore` track per-tab workspace root (evidenced by `WorkspaceCoordinatorService.switchWorkspace(newPath)` fanning out to per-tab-aware services) — so this is plumbing, not new capability. This is the _only_ way to close the VS Code session/window-divergence case (§4.C), because there is nothing else on the wire to resolve against.
2. **Root-key `WorkspaceFileIndexService`'s cache and re-index on switch, instead of a single pinned `workspaceRoot`/`started` pair.** This is the dominant, deterministic Electron bug (§4.A) and is independent of (1) — even a perfectly-threaded root param is useless if the index backing it was built once for a different root and never rebuilt. Either key `files`/`directories`/the watcher by root (mirroring context.md §4 item 3's `Map<string, WorkspaceInfo>` recommendation for `WorkspaceAnalyzerService`), or at minimum call `fileIndex.start(newRoot)` from `workspace:switch`'s handler (`workspace-rpc.handlers.ts:304`) so single-active-folder Electron self-heals on every switch (cheaper, but does not solve concurrent multi-root correctness — see Open Questions).
3. **Wire `FilePickerService` into `WorkspaceCoordinatorService.switchWorkspace()`** (`workspace-coordinator.service.ts:92-120`) to clear/refetch on switch, exactly like `TabManagerService`/`SessionLoaderService`/the editor trio already are. This is required regardless of (1)/(2) — it is a frontend-only cache-staleness bug with its own trigger.

### Alternatives rejected

- **Reuse the MCP session-aware proxy machinery (`buildSessionAwareWorkspaceProvider`) for the webview RPC handlers.** Rejected: that machinery resolves _from a caller session id_, which the MCP transport supplies via `getCallerSessionId()`/AsyncLocalStorage-style request context, and the webview `RpcMessage` envelope has no equivalent field to source that id from. Adopting this approach as-is would silently resolve to "most-recently-active session" (precedence tier 2 in `resolveSessionWorkspaceRoot`, `ptah-api-builder.service.ts:764`) for every webview RPC call — which is exactly the ambiguous, session-agnostic behavior causing the bug, just relabeled. It would need the same explicit-param plumbing from (1) to have a caller id to key off of, at which point the proxy adds a layer of indirection over what threading an explicit root already gives you directly.
- **Registering the session-aware proxy against `PLATFORM_TOKENS.WORKSPACE_PROVIDER` globally.** Still rejected, now with stronger evidence than context.md had: §5's audit shows the raw provider is reachable from services (`command-discovery`, `agent-discovery`, `context-enrichment`) that are consumed by webview callers with no session id, non-MCP watchers (`initializeWatchers` at `command-discovery.service.ts:272`, `agent-discovery.service.ts:193`), and the process-lifetime-cached `WorkspaceFileIndexService` — none of which have a caller session id to resolve against even if the token pointed at a session-aware wrapper. Global registration would just move today's silent-wrong-answer to a different silent-wrong-answer (most-recently-active session, or the proxy's own platform fallback) for all of these non-MCP consumers.
- **"Just fix `workspace:switch` to call `fileIndex.start()`" as the complete fix.** Rejected as _sufficient_ (though recommended as a component, see (2)): it fixes Electron's single-active-folder switch case but does nothing for VS Code's session/window divergence (§4.C, no switch event exists there to hook) and nothing for the frontend cache (§4.B). All three pieces are needed; none subsumes the others.

---

## 7. Proposed additional acceptance criteria (for context.md §5)

8. With Electron workspace A open and `WorkspaceFileIndexService` already built for A, calling `workspace:switch` to B, then invoking the `@` file picker, returns B's files — not A's — with no manual reload/restart.
9. `context:getAllFiles` and `context:getFileSuggestions` accept an explicit workspace-scoping parameter and return results for that root, independent of whichever root the process's raw `IWorkspaceProvider` currently reports.
10. `autocomplete:agents` and `autocomplete:commands` (the `/` picker) resolve the same explicit workspace-scoping parameter, not the process-global active folder, when one is supplied.
11. `WorkspaceCoordinatorService.switchWorkspace()` clears or refetches `FilePickerService`'s cached file list; a `@` picker opened within 5 minutes of a switch never shows the pre-switch workspace's files.
12. Unit test: `WorkspaceFileIndexService`, once started for root A, correctly serves root B's files after an explicit re-index call for B (either root-keyed cache, or single-root-with-rebuild — whichever design is chosen) without requiring a process restart.
13. Cache/lookup keys for any new root-keyed maps introduced by this fix use the same normalization helper as `task-specs`' `normalizeWorkspaceRoot()` (`libs/backend/task-specs/src/lib/normalize-workspace-root.ts:14`), so Windows drive-letter-case and trailing-separator variants collapse to one key — per the known `TASK_WORKSPACE_SCOPING_REVIEW` finding (Issue 6 in its code-logic-review) that this exact class of bug (unnormalized cache keys) has already shipped once (cron's `workspaceRoot` filter) in this codebase.

---

## 8. Open questions

- **Electron multi-root correctness is architecturally unresolved, not just unimplemented.** `WorkspaceFileIndexService` (and by extension `ContextService`/`ContextOrchestrationService`) is a single process-wide singleton. Even with root-keying and re-index-on-switch (§6 item 2), there is exactly one "current" root at any instant — if two chat tabs are concurrently bound to two different workspace roots (which `TabManagerService`'s per-tab state suggests is a supported scenario, per `WorkspaceCoordinatorService.switchWorkspace`'s stale-response-guard comments about "rapid A→B→A"), the file index cannot serve both simultaneously without a genuine per-root cache (not just "rebuild on switch"). Whether concurrent multi-tab-multi-root file-picker correctness is actually a requirement for this task, or whether "last-switched-to root wins, and that's an acceptable model for a picker" is good enough, was not decided by the user's request and should be confirmed before choosing between "rebuild on switch" (cheap, still single-root) vs. "true root-keyed cache" (more work, handles concurrent tabs).
- **Whether the frontend already threads a stable per-tab `workspaceRoot` value that can be handed straight to `context:getAllFiles`**, or whether `TabManagerService`'s workspace field needs a lookup at the call site — I confirmed the _existence_ of per-tab workspace awareness (via `WorkspaceCoordinatorService`'s fan-out and the tasks/cron precedent), but did not read `TabManagerService`'s public API in this pass to confirm the exact accessor `FilePickerService`/`chat-input.component.ts` would call.
- **4.C (VS Code session/window divergence for the webview picker) is inferred from the absence of a session id on the wire, not independently reproduced by running the app** — I did not find or run an existing test that exercises "VS Code window on folder X, Ptah session bound to folder Y, open the `@` picker." Worth a manual/e2e check before committing to the severity ranking implied in §1.
- **`workspace-indexer.service.ts:329`'s exact reachability** (whether any live call path actually omits the explicit `workspaceFolder` param and falls through to `getDefaultWorkspaceFolder()`) was traced through `WorkspaceFileIndexService.build()` only; other callers of `WorkspaceIndexerService.indexWorkspaceStream`/`discoverFiles` were not exhaustively enumerated.
