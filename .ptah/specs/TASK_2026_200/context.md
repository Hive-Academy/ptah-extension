# TASK_2026_200 — Core namespaces bypass session-aware workspace resolution

**Type:** BUGFIX
**Severity:** High — silent wrong-project answers, no error surfaced
**Related:** `TASK_WORKSPACE_SCOPING_REVIEW` (per-workspace state), `TASK_2026_195` (global vs. workspace-partitioned state)

---

## 1. Observed behavior

A Claude Code session was running with primary working directory
`D:\projects\angular-3d-showcase` (git branch `main`, single commit). The user
asked which project was active. `ptah_workspace_analyze` returned:

```
**Project Type:** react
**Root:** D:\projects\property-hub
**Description:** Pro-Estate Egypt - Real Estate CRM Platform
**Total Files:** 4959
```

It returned the complete directory tree of `property-hub` — apps, libs, 190+
`task-tracking` folders — for a session bound to a different repository. No
warning, no error, no indication that the answered root differed from the
session root. An agent that trusts the tool then reasons about, and edits, the
wrong repository.

The mismatch is internally inconsistent, not just surprising: in the same
session, `ptah_ast_analyze` and `ptah_files_*` resolve a relative path against
the session workspace, while `ptah_workspace_analyze` resolves against the
VS Code active folder. Two tools, one session, two different roots.

---

## 2. Root cause

`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

```ts
415  build(): PtahAPI {
417    const coreDeps = {
418      workspaceAnalyzer: this.workspaceAnalyzer,          // raw provider inside
419      contextOrchestration: this.contextOrchestration,    // raw provider inside
420    };
421
426    const sessionAwareWorkspaceProvider = buildSessionAwareWorkspaceProvider(
427      this.workspaceProvider,
428      () => this.resolveSessionWorkspaceRoot(),
429    );
431    const systemDeps   = { ..., workspaceProvider: sessionAwareWorkspaceProvider };
437    const analysisDeps = { ..., workspaceProvider: sessionAwareWorkspaceProvider };
451    const astDeps      = { ..., workspaceProvider: sessionAwareWorkspaceProvider };
```

`coreDeps` is constructed at line 417, before the session-aware proxy exists at
line 426, and it never receives one. It carries service _instances_, and each of
those instances resolved `PLATFORM_TOKENS.WORKSPACE_PROVIDER` from the DI
container at construction time — the raw, process-global provider.

Consumers of `coreDeps`:

| Line | Namespace   | Exposed MCP tools                                                             |
| ---- | ----------- | ----------------------------------------------------------------------------- |
| 465  | `workspace` | `ptah_workspace_analyze`, `ptah_workspace_get_info`, project type, frameworks |
| 468  | `search`    | `ptah_search_files`, relevant-file suggestions                                |

The call chain that leaks the wrong root:

1. `buildWorkspaceNamespace` → `workspaceAnalyzer.getCurrentWorkspaceInfo()`
   and `analyzeWorkspaceStructure()`
   (`namespace-builders/core-namespace.builders.ts:41-48`)
2. `WorkspaceAnalyzerService.analyzeWorkspaceStructure()` delegates to
   `WorkspaceService` (`composite/workspace-analyzer.service.ts:177`)
3. `WorkspaceService` reads `this.workspaceProvider.getWorkspaceRoot()`
   (`workspace/workspace.service.ts:201`) — the raw provider

The session-aware machinery itself is correct and already tested. See
`session-aware-workspace-provider.ts:21` and its precedence chain documented at
`ptah-api-builder.service.ts:768` (caller session id → most-recently-active
session → platform provider). The defect is coverage, not logic: two namespaces
were never wired into it.

### 2.1 Second defect — the cached snapshot

Even with the proxy injected, `ptah_workspace_analyze` would still answer from
one global snapshot:

```ts
// composite/workspace-analyzer.service.ts
115  private initialize(): void {
116    const workspaceWatcher = this.workspaceProvider.onDidChangeWorkspaceFolders(
117      () => { this.updateWorkspaceInfo(); },
122    this.disposables.push(workspaceWatcher);
123    this.updateWorkspaceInfo();

130  getCurrentWorkspaceInfo(): WorkspaceInfo | undefined {
131    return this.workspaceInfo;
132  }
```

`workspaceInfo` is a single field on a singleton, populated once at construction
and refreshed only when the platform reports a folder change. It is not keyed by
root, so it cannot represent two concurrently open workspaces. `getInfo`,
`getProjectType` and `getFrameworks` all read it
(`core-namespace.builders.ts:49-57`).

---

## 3. Scope

**Confirmed affected**

- `ptah_workspace_analyze`
- `ptah_workspace_get_info` / project type / frameworks
- `ptah_search_files` and relevant-file suggestions (`ContextOrchestrationService`,
  via `ContextService` at `context/context.service.ts:351` and `:628`)

**Suspected — verify during the fix.** These services hold the raw provider
internally and are reached as pre-built instances even where the namespace
builder receives the session-aware proxy. `analysis-namespace.builders.ts` calls
`workspaceProvider.getWorkspaceRoot()` at lines 149 and 173 only, so any path
that instead falls through to the service's own field is still global:

- `workspace-indexer.service.ts:329`
- `context-analysis/context-enrichment.service.ts:383`
- `file-indexing/workspace-file-index.service.ts:176`
- `autocomplete/command-discovery.service.ts:199,272`
- `autocomplete/agent-discovery.service.ts:122,193`

**Not affected** — `ast`, `files`, `context`, `json`, `project`, `relevance`,
`dependencies` namespaces resolve through `deps.workspaceProvider`.

---

## 4. Proposed fix

Preferred approach: make the session-aware provider the _only_ provider the MCP
surface can reach, instead of adding it to one more dependency bag.

1. **Move the proxy construction above `coreDeps`** and pass it to every
   dependency bag, `coreDeps` included. This is a one-line reordering plus a
   field addition, and it removes the ordering hazard that caused the defect.
2. **Give the core services a root parameter.** `coreDeps` holds instances, so a
   `workspaceProvider` field on the bag only helps if the builder uses it. Add an
   explicit root argument to the paths the builder calls:
   - `getCurrentWorkspaceInfo(root?: string)`
   - `analyzeWorkspaceStructure(root?: string)`
   - `getProjectInfo(root?: string)`
     Have `buildWorkspaceNamespace` pass `deps.workspaceProvider.getWorkspaceRoot()`.
3. **Key the cache by root.** Replace the single `workspaceInfo` field with a
   `Map<string, WorkspaceInfo>` keyed on the normalized absolute root. Invalidate
   per key on `onDidChangeWorkspaceFolders`. Normalize with the same helper the
   cron `workspaceRoot` matching uses, so Windows drive-letter and separator
   variants collapse to one key (that normalization gap is a known finding from
   `TASK_WORKSPACE_SCOPING_REVIEW`).
4. **Audit the suspected list in section 3.** For each, either inject the
   session-aware provider at the DI registration used by the MCP container, or
   thread an explicit root.
5. **Guard against regression at the boundary.** Prefer a structural test over a
   per-tool test: assert that every namespace bag built in
   `PtahAPIBuilder.build()` carries the session-aware provider, so a future
   namespace cannot be added without it.

### Alternative considered

Registering the session-aware proxy directly against
`PLATFORM_TOKENS.WORKSPACE_PROVIDER` in the MCP container would fix every
consumer at once, including the suspected list, with no signature changes. It is
rejected as the primary fix because the same singletons serve non-MCP callers
(webview, indexer warm-up, watchers) that have no caller session id, and because
it hides the caching defect in section 2.1 rather than fixing it. Reconsider if
the section 3 audit shows the raw provider is reachable from many more paths
than listed.

---

## 5. Acceptance criteria

1. With workspace A open in the IDE and a session bound to workspace B,
   `ptah_workspace_analyze` returns root B.
2. `ptah_workspace_analyze` and `ptah_ast_analyze` report the same root for the
   same session, in every session, concurrently.
3. Two concurrent sessions on different roots each get their own root — the
   second call does not return the first session's cached snapshot.
4. `ptah_search_files` returns paths under the calling session's root only.
5. With no session and no workspace open, the tools return the existing
   "No workspace folder open" error, not a `$HOME` fallback
   (`ptah-api-builder.service.ts:753-758`).
6. Unit test: `PtahAPIBuilder.build()` passes a session-aware provider to every
   namespace dependency bag.
7. Unit test: `WorkspaceAnalyzerService` returns distinct `WorkspaceInfo` for two
   distinct roots without a folder-change event between the calls.

**Added by the §7 scope extension (webview picker surface):**

8. With Electron workspace A open and the file index already built for A,
   `workspace:switch` to B then opening the `@` picker returns B's files — no
   reload, no restart.
9. `context:getAllFiles` / `context:getFileSuggestions` accept an explicit
   workspace-scoping parameter and answer for that root, independent of whatever
   root the process-global `IWorkspaceProvider` currently reports.
10. `autocomplete:agents` / `autocomplete:commands` (the `/` picker) resolve the
    same explicit parameter when supplied.
11. `WorkspaceCoordinatorService.switchWorkspace()` clears or refetches
    `FilePickerService`'s cached list — a picker opened within the 5-minute TTL
    after a switch never shows pre-switch files.
12. Unit test: `WorkspaceFileIndexService`, once started for root A, serves root
    B's files after re-index for B, with no process restart.
13. Any new root-keyed map uses `normalizeWorkspaceRoot()`
    (`libs/backend/task-specs/src/lib/normalize-workspace-root.ts:14`) so
    Windows drive-letter case and trailing-separator variants collapse to one
    key.

---

## 6. Reproduction

1. Open workspace A in the IDE — for example `D:\projects\property-hub`.
2. Start a Ptah session whose `projectPath` is workspace B — for example
   `D:\projects\angular-3d-showcase`.
3. Call `ptah_workspace_analyze` from that session.
4. **Expected:** root is workspace B. **Actual:** root is workspace A, with
   workspace A's full file tree.
5. Call `ptah_ast_analyze` with a relative path in the same session, and confirm
   it resolves against workspace B. The two tools disagree.

---

## 7. Scope extension — the webview file-picker surface (2026-08-10)

User report: the chat `@` file picker lists files from a _different_ workspace
than the one in use. Scope of this task was extended, with user approval, to
cover both the MCP tool surface (§1–§6 above) and the webview/Electron RPC
surface behind the pickers. Full analysis: **`./research-report.md`**.

### 7.1 What the research changed

The picker is not a sibling bug — `TOKENS.CONTEXT_ORCHESTRATION_SERVICE` is
registered once (`workspace-intelligence/src/di/register.ts:136-139`) and
injected into _both_ `ContextRpcHandlers` (`context-rpc.handlers.ts:35`) and
`PtahAPIBuilder`'s `coreDeps` (`ptah-api-builder.service.ts:281,419`). One
instance, two callers. But the webview surface is worse in two ways:

1. **No session concept exists on the RPC transport.** `RpcMessage`
   (`vscode-core/src/messaging/rpc-handler.ts:166`) carries only
   `{ method, params, correlationId }`. The MCP path at least has a caller
   session id to resolve against; the webview path has nothing. Reusing
   `buildSessionAwareWorkspaceProvider` here would silently fall through to
   "most-recently-active session" — the same ambiguity, relabeled.
2. **A distinct, deterministic, single-window Electron bug dominates.**
   `WorkspaceFileIndexService.ensureReady()`
   (`workspace-file-index.service.ts:170-179`) resolves the root exactly once
   per process and sets `started = true`. `fileIndex.start(root)` is called once
   at boot (`thoth-runtime/src/lib/boot-thoth-runtime.ts:378-391`) and
   **`workspace:switch` never re-indexes** (`workspace-rpc.handlers.ts:284-304`
   flips only `activeFolder`). So after any switch the picker serves the boot
   workspace's files for the rest of the process lifetime. No race, no second
   session, no concurrency required — this is the most likely explanation for
   the user's report and is not fixed by anything in §4.
3. **A third cause is purely frontend.** `FilePickerService`'s cache
   (`file-picker.service.ts:60,63`, 5-min TTL, unkeyed by workspace) is not
   referenced by `WorkspaceCoordinatorService.switchWorkspace()`
   (`workspace-coordinator.service.ts:92-120`), which already resets the tab
   manager, session loader and editor trio on switch.

The `/` pickers (`autocomplete:agents`, `autocomplete:commands`) read the root
fresh per call (`agent-discovery.service.ts:122`, `command-discovery.service.ts:199`)
so they track the active folder live — but with zero session awareness, same
defect class.

### 7.2 Concurrency requirement — decided

The picker does **not** need to serve two roots concurrently. The frontend model
is one active workspace at a time: `TabManagerService.switchWorkspace()` swaps
between per-workspace tab partitions (`tab-workspace-partition.service.ts:19`).
So "correct for the active root, invalidated on switch" is the target — a
root-keyed cache is acceptable but a full concurrent multi-root index is **out
of scope**. This closes open question 1 of the research report.

### 7.3 Fix strategy for this surface

Three separable pieces; none subsumes the others.

1. **Thread an explicit workspace-scoping param** through the picker RPC
   contracts — `context:getAllFiles`, `context:getFileSuggestions`,
   `autocomplete:agents`, `autocomplete:commands` — following the existing
   `tasks:*` / `cron:*` precedent. Remember the **RPC dual-registration rule**
   (`libs/shared/.../rpc.types.ts` + `ALLOWED_METHOD_PREFIXES`).
2. **Make `WorkspaceFileIndexService` re-indexable**: key by normalized root, or
   at minimum re-`start()` from the `workspace:switch` handler. Dominant fix for
   the confirmed Electron repro.
3. **Invalidate `FilePickerService` on switch** via
   `WorkspaceCoordinatorService.switchWorkspace()`, like every other
   workspace-aware frontend service.

**Rejected** (see research-report.md §6): registering the session-aware proxy
globally against `PLATFORM_TOKENS.WORKSPACE_PROVIDER`; reusing the MCP
session-aware proxy for webview handlers; treating "re-index on switch" alone as
the complete fix.
