# TASK_2026_413 implementation plan

## 1. Architecture decision

Keep the existing mutable Git pipeline intact and add a parallel read-only review pipeline.

```text
Working tree/index                           Historical branch review
GitStatusService                            GitReviewService
  -> git:info                                 -> git:reviewChanges(base, head)
DiffTabsService                              -> git:reviewFile(baseSha, headSha, path)
  -> git:diffFile(staged|worktree)           -> one read-only expanded Monaco diff
  -> git:applyHunks(snapshot guarded)         -> applyHunks = null
stage/unstage/discard/commit allowed         no mutation methods exposed
```

Do not add a historical member to `GitDiffComparison`. That union is part of the hunk-operation safety matrix. Historical results get their own types and RPC methods so a future UI mistake cannot route a branch comparison into `git:applyHunks`.

Recommended comparison semantics are `merge-base(base, head)..head` (the same changes a pull-request review presents). Both user ref names are first resolved to commit SHAs; only SHAs enter later diff/show commands. This decision awaits owner approval.

## 2. Contracts

### 2.1 Historical review wire types

Add to `libs/shared/src/lib/types/rpc/rpc-git.types.ts`:

```ts
interface GitReviewChangesParams extends GitWorkspaceScopedParams {
  base: string;
  head: string;
}

interface GitResolvedReviewRef {
  name: string;
  sha: string;
}

interface GitReviewFile {
  path: string;
  originalPath?: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C';
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

interface GitReviewChangesResult {
  success: boolean;
  base?: GitResolvedReviewRef;
  head?: GitResolvedReviewRef;
  mergeBaseSha?: string;
  files: GitReviewFile[];
  totals: { additions: number; deletions: number; binaryFiles: number };
  error?: string;
}

interface GitReviewFileParams extends GitWorkspaceScopedParams {
  baseSha: string;
  headSha: string;
  path: string;
  originalPath?: string;
}

interface GitReviewFileResult {
  success: boolean;
  path: string;
  originalPath: string;
  baseSha: string;
  headSha: string;
  original: GitBlobRead;
  modified: GitBlobRead;
  error?: string;
}
```

Register `git:reviewChanges` and `git:reviewFile` in `libs/shared/src/lib/types/rpc.types.ts` and its runtime method-name object. These remain under the existing allowed `git:` prefix.

### 2.2 Current-change stats

Extend `GitFileStatus` with optional `additions`, `deletions`, and `binary` fields. `git:info` populates them by merging status records with staged/worktree `--numstat -z` output using `(path, staged)` identity. Optional fields preserve compatibility with older push payloads. Equality in `GitStatusService` must include the new fields so stat-only updates render.

### 2.3 Editor and legacy file-open contracts

- Add `'kiro'` to `EditorTargetId` in both `libs/shared/src/lib/types/rpc/rpc-editor.types.ts` and `libs/backend/platform-core/src/interfaces/editor-launcher.interface.ts`.
- Add it to `EditorTargetIdSchema` in `editor-rpc.schema.ts`.
- Extend both `EditorOpenFileParams` and `FileOpenParams` with `workspaceRoot?: string`. Their `path` may be absolute, or workspace-relative only when an explicit registered `workspaceRoot` is supplied.

Factor one handler-local path resolver used by both `editor:openFile` and legacy `file:open`:

1. Validate `{ path, line?, workspaceRoot? }` strictly with Zod.
2. If `path` is relative, require `workspaceRoot`, find the exact registered root, and resolve beneath it.
3. If `path` is absolute, choose the supplied registered root or the containing registered root.
4. Reject unknown roots, traversal/outside-root results, and directories.
5. Pass only the normalized absolute file to `IEditorLauncher`. The explicit editor RPC uses its requested target; legacy `file:open` detects the remembered/default target.

## 3. Backend design

### 3.1 Historical reads in `GitInfoService`

Add two public read methods to `libs/backend/vscode-core/src/services/git-info.service.ts`:

- `reviewChanges(workspacePath, base, head)`
- `reviewFile(workspacePath, request)`

Implementation rules:

- Resolve a supplied ref using `git rev-parse --verify --end-of-options <ref>^{commit}`. Reject empty, leading-option, NUL/control, and unresolved values with sanitized errors.
- Compute `git merge-base <baseSha> <headSha>` for the recommended semantics.
- Run `git diff --name-status -z --find-renames --find-copies <mergeBaseSha> <headSha> --` and `git diff --numstat -z --find-renames --find-copies <mergeBaseSha> <headSha> --`.
- Parse NUL-delimited output; never split filenames on spaces or tabs beyond Git's documented field separators. Merge rename/copy records using old/new path identity.
- Represent `-\t-` numstat as `{ additions: null, deletions: null, binary: true }` and exclude it from numeric totals while incrementing `binaryFiles`.
- `reviewFile` accepts only 40/64-character hexadecimal resolved SHAs issued by `reviewChanges`, validates both path segments, and reads `baseSha:originalPath` and `headSha:path`. It reads no index/worktree content and returns no patch, hunks, or snapshot token.
- Reuse the existing structured `GitBlobRead` and sanitized read-error classification. Do not expose stderr or absolute paths.
- Cache reads by workspace plus resolved SHA pair. Existing cache invalidation remains safe; immutable SHA keys also prevent moving branch labels from corrupting an in-flight result.

### 3.2 RPC boundary

In `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts`, add strict Zod schemas for both methods, including workspace root, bounded non-empty refs, hexadecimal SHAs, and normalized relative file paths. In `git-rpc.handlers.ts`:

- add both method names to `GitRpcHandlers.METHODS` and `register()`;
- resolve the requested workspace through the existing registered-folder gate;
- return typed failure objects instead of rejecting transport promises;
- never call mutation methods from either handler.

### 3.3 Current numstat

Enhance `getInfo`/its helper in `GitInfoService` to collect staged and unstaged numstat independently:

- staged: `git diff --cached --numstat -z --find-renames --find-copies --`;
- worktree: `git diff --numstat -z --find-renames --find-copies --`;
- untracked regular text files: count lines as additions only if the existing file provider can read them within the workspace; binary/unreadable entries remain `null` rather than guessed.

Keep the existing porcelain-v2 status parser authoritative for status/staged identity. Numstat enriches rows; it does not create or mutate rows.

## 4. Frontend state and layout

### 4.1 Services

Create `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts`:

- signals: targets, loading, detectionError, launchStatus;
- `detect()` single-flights per dock lifetime;
- `openWorkspace(target, root)` and `openFile(target, root, relativePath, line?)` call the typed editor RPCs with the displayed workspace root and convert failures to visible status;
- stale launch/detection responses do not overwrite state after destruction.

Create `libs/frontend/git-ui/src/lib/services/git-review.service.ts`:

- state is partitioned by active workspace;
- signals: mode (`working-tree | branch-review`), base/head names, resolved result, loading/error, expanded file, filter query, and viewed keys;
- selecting base/head triggers a generation-guarded review request and resets the expanded file;
- file diff requests use only the resolved SHA pair returned by `reviewChanges`;
- viewed storage key: `gitReview.viewed.v1`, with entries keyed by `workspaceRoot\0baseSha\0headSha\0path`;
- switching workspace restores only that workspace's selection/cache and cannot apply an old response.

### 4.2 Restored branch controls

Restore the prior components as new `git-ui` owners:

- `branch-picker/branch-picker-dropdown.component.ts`
- `branch-picker/branch-details-popover.component.ts`

Port behavior, not stale imports. Both import `GitBranchesService` locally, remain standalone/OnPush/signals, and use actual buttons and dialogs. Improve the picker's force warning to state exactly that uncommitted changes will be discarded. Add Escape/focus restoration and rendered-click specs.

The header current-branch control performs checkout. Separate base/head review selectors never call checkout. Visual proximity must not merge their semantics.

### 4.3 Review presentation

Create:

- `review/git-review-toolbar.component.ts` — mode switch, base/head selectors, totals, commit/push action and live status.
- `review/git-review-panel.component.ts` — main review list plus right changed-files rail.
- `review/git-review-file-row.component.ts` — disclosure header, status, per-file stats, Mark as viewed, file Open In, and the single expanded `DiffViewComponent`.
- `source-control/changed-file-tree.ts` — pure tree/filter builder reused by source control and historical review.

At the 700 px default dock width:

```text
┌ current branch/details ─ workspace Open In ─ status ┐
├ Working tree | Branch review  base … head  +N -N    ┤
├ commit message                         Commit/Push   ┤
├──────────────────────────────┬──────────────────────┤
│ review rows / active Monaco  │ Filter files         │
│ ▾ src/a.ts +12 -3  Viewed    │ ▾ src                │
│   read-only diff             │   a.ts +12 -3        │
│ ▸ test/a.spec.ts +8 -0       │ ▸ test               │
└──────────────────────────────┴──────────────────────┘
```

- Rail width: `w-52` at 700 px; collapse to an overlay/disclosure below the existing 300 px minimum, rather than shrinking Monaco to zero.
- Use existing `bg-base-*`, `border-base-content/10`, `text-base-content-muted`, `text-success`, `text-error`, and focus-ring conventions.
- Folder filter is case-insensitive and retains ancestors of matches.
- One row is expanded at a time. The right tree and row list share the same selected path signal.
- Historical rows pass `applyHunks=null`; working-tree tabs retain `diffTabs.applyHunksFn`.

### 4.4 Mount wiring

Modify `git-dock-header.component.ts` to mount current-branch picker/details, workspace Open In, and visible push/launch status. Modify `git-dock.component.ts` to:

- import and render the real review toolbar/panel;
- run editor detection;
- pass the active `GitStatusService.activeWorkspacePath()` into every open request;
- switch between the existing mutable source-control/diff-tabs surface and branch-review surface;
- display non-git/loading/error empty states;
- never issue a bare relative `file:open` call.

Modify `source-control-file.component.ts` to mount icon-only Open In and actually emit its open request. Modify `source-control-panel.component.ts` to use the shared filtered tree/stat rows and move the commit composer to the top toolbar without changing mutation service ownership.

Refactor `diff-tab.types.ts` with a presentation-only discriminated provenance:

```ts
type DiffProvenance = { kind: 'mutable'; comparison: GitDiffComparison } | { kind: 'historical'; base: GitResolvedReviewRef; head: GitResolvedReviewRef };
```

Only the mutable branch carries snapshot/hunk state. `DiffViewComponent` derives labels from the provenance and renders hunk controls only when provenance is mutable, the apply function exists, and all current guards pass.

### 4.5 Default-width hunk fix

In `diff-view.component.ts`, replace the no-wrap text-heavy floating action cluster at narrow widths with icon buttons whose accessible labels/title retain Stage/Unstage/Discard text. Keep the header toolbar as the full keyboard path. Clamp the content widget inside the modified editor viewport and relayout on Monaco layout changes. Do not change `DEFAULT_EDITOR_WIDTH`.

## 5. Exact file plan and batches

### Batch 1 — read-only Git review backend

Ownership:

- `libs/shared/src/lib/types/rpc/rpc-git.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/backend/vscode-core/src/services/git-info.service.ts`
- `libs/backend/vscode-core/src/services/git-info.service.spec.ts`
- new `libs/backend/vscode-core/src/services/git-info.service.review.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts`

Deliverable: immutable-SHA historical comparison, current numstat enrichment, strict RPC validation, scratch-repo mutation invariants. No frontend files.

### Batch 2 — Kiro and workspace-safe launching

Ownership:

- `libs/shared/src/lib/types/rpc/rpc-editor.types.ts`
- `libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
- `libs/backend/platform-core/src/interfaces/editor-launcher.interface.ts`
- `libs/backend/platform-core/src/utils/editor-launcher-detection.ts`
- `libs/backend/platform-core/src/utils/editor-launcher-detection.spec.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-editor-launcher.spec.ts`
- `libs/backend/platform-electron/src/implementations/electron-editor-launcher.spec.ts`
- `libs/backend/platform-cli/src/implementations/cli-editor-launcher.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/file-open-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/file-open-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/file-open-rpc.handlers.spec.ts`

Official Kiro documentation establishes the IDE shell command as `kiro`; `kiro-cli` is a separate terminal agent and must not be registered as an editor launcher. Add PATH detection for `kiro` first. Before adding non-PATH candidates, verify the current IDE installer output on each OS (or an official published location); do not infer a VS Code-style directory layout from other products. Adapter tests must cover every candidate that is actually adopted and prove nonexistent candidates are omitted.

### Batch 3 — new frontend state/primitives

Ownership (new files only):

- `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts`
- `libs/frontend/git-ui/src/lib/services/editor-launcher.service.spec.ts`
- `libs/frontend/git-ui/src/lib/services/git-review.service.ts`
- `libs/frontend/git-ui/src/lib/services/git-review.service.spec.ts`
- `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts`
- `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.spec.ts`
- `libs/frontend/git-ui/src/lib/branch-picker/branch-details-popover.component.ts`
- `libs/frontend/git-ui/src/lib/branch-picker/branch-details-popover.component.spec.ts`
- `libs/frontend/git-ui/src/lib/review/git-review-toolbar.component.ts`
- `libs/frontend/git-ui/src/lib/review/git-review-toolbar.component.spec.ts`
- `libs/frontend/git-ui/src/lib/review/git-review-panel.component.ts`
- `libs/frontend/git-ui/src/lib/review/git-review-panel.component.spec.ts`
- `libs/frontend/git-ui/src/lib/review/git-review-file-row.component.ts`
- `libs/frontend/git-ui/src/lib/review/git-review-file-row.component.spec.ts`
- `libs/frontend/git-ui/src/lib/source-control/changed-file-tree.ts`
- `libs/frontend/git-ui/src/lib/source-control/changed-file-tree.spec.ts`

Deliverable: independently testable signal stores and rendered primitives. No existing mount file changes, so this batch is file-disjoint from Batch 4.

### Batch 4 — mount and mutable/read-only composition

Ownership:

- `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts`
- new `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.spec.ts`
- `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts`
- `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.spec.ts`
- new `libs/frontend/git-ui/src/lib/git-dock/git-dock.mount.spec.ts`
- `libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts`
- `libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.spec.ts`
- `libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts`
- `libs/frontend/git-ui/src/lib/source-control/source-control-file.component.spec.ts`
- `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts`
- `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.spec.ts`
- `libs/frontend/git-ui/src/lib/types/diff-tab.types.ts`
- `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts`
- `libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts`
- `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts`
- `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.spec.ts`
- `libs/frontend/git-ui/src/index.ts`

Deliverable: controls genuinely mounted, top action feedback, stats/tree/viewed UI, strict provenance separation, and default-width hunk presentation. `git-dock.mount.spec.ts` must use real header, source-control, Open In, and review children; stub only RPC and Monaco loader boundaries.

### Batch 5 — composition-root and real-browser regression gates

Ownership:

- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`
- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts`
- `apps/ptah-extension-webview/src/app/git-dock-arming-identity.spec.ts`
- `apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts`
- new `apps/ptah-electron-e2e/src/specs/git/git-review-controls.spec.ts`
- `apps/ptah-electron-e2e/src/specs/git/hunk-widget-mouse.spec.ts`
- `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts`
- `apps/ptah-electron-e2e/src/support/source-control.ts`

Add `GitReviewService` to workspace switch/remove coordination so it cannot retain the previous repository. Extend the identity/mount test to prove the live dock and coordinated services share root instances.

Delete the `widenWindow()` workaround from both hunk specs. Assert the window remains 1200×800, dock is 700 px, action/widget boxes do not intersect the vertical scrollbar, and real mouse clicks reach Stage and Discard. The new review e2e must click rendered controls and inspect observed RPC calls; direct component method invocation is forbidden.

## 6. Test matrix

| Layer                       | Required proof                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Shared/handler schema       | malformed refs, SHA, root, path, line, and unknown editor IDs rejected; Kiro accepted                                      |
| GitInfoService scratch repo | modified/added/deleted/renamed/binary stats; divergent base/head semantics; file bodies; no HEAD/index/worktree mutation   |
| Editor adapters             | Kiro PATH and verified install detection; argv launch; missing executable omitted                                          |
| File-open handler           | relative + registered root resolves correctly; process CWD irrelevant; wrong root/traversal/outside path rejected          |
| Angular service             | stale workspace/ref responses dropped; viewed keys partitioned and invalidated; launch and push errors visible             |
| Angular rendered components | branch checkout/dirty confirm, base/head selection, filter/tree, row expansion, viewed toggle, Open In, commit/push clicks |
| Dock mount integration      | real children exist and emit through dock to RPC; catches export-only regressions                                          |
| Webview composition         | MESSAGE_HANDLERS/service identity and workspace switch fan-out                                                             |
| Electron e2e                | default-width clicks, Monaco diff, branch review, Open In, push feedback, workspace switching                              |

## 7. Verification commands after implementation

Do not run until dependencies are available. Do not install without approval.

```powershell
npx nx run-many -t lint typecheck -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/git-ui @ptah-extension/chat ptah-extension-webview ptah-electron-e2e --parallel=1

npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/git-ui @ptah-extension/chat ptah-extension-webview

npx nx e2e ptah-electron-e2e -- --grep "Git dock|Git review controls|hunk widget|hunk revert"

git diff --check
```

Read the Nx header and confirm the requested project count; do not use `nx test A B` syntax. No `project.json` edit is planned, so `nx reset` should not be necessary.

## 8. Risks and mitigations

- **Ref injection/ambiguity:** option-safe `rev-parse`, then immutable SHA-only reads.
- **Historical mutation leak:** separate RPC/result types, discriminated frontend provenance, `applyHunks=null`, and before/after repository snapshots in tests.
- **Workspace bleed:** explicit roots, registered-folder resolution, generation guards, coordinator fan-out, and viewed keys containing workspace/SHA pair.
- **Rename/stat parser drift:** NUL-delimited Git output and scratch repos containing spaces, tabs where supported, rename, copy, and binary fixtures.
- **Monaco memory/layout:** one expanded historical diff, existing model eviction, icon-only narrow widget, measured no-overlap browser assertions.
- **Export-only false green:** real-child mount spec plus Electron rendered-click coverage.
- **Unavailable test tooling:** record as a readiness blocker; request approval for dependency preparation only when implementation resumes.

## 9. Approval gate

No product source changes begin until the owner approves this plan and chooses comparison semantics:

- Recommended: merge-base review (`base...head` meaning merge-base to head).
- Alternative: endpoint review (`base..head`).

Dependency installation/linking is also not authorized in this phase. When implementation resumes, the executor must first agree on how the isolated worktree obtains the repository's pinned dependencies.

## Addendum: Batches 7-8

Scope addendum approved 2026-09-11 (`context.md` "Scope addendum"). This section is additive; sections 1-9 above remain the record for Batches 1-6. All line references are to the worktree (`fix/git-review-controls`, base `712478de8`, uncommitted Batch 1-6 changes included) unless marked `05e725865^` or `main`.

### A.1 Inputs and constraints

- Requirements used: `context.md` (both scope-addendum sections), `task-description.md`, sections 1-9 above, `batches.md`, `implementation-report.md` (incl. Batch 6), `test-report.md`, `code-style-review.md`; root `CLAUDE.md`; `CLAUDE.md` of `libs/frontend/{markdown,chat,chat-ui,core,git-ui}`, `libs/backend/{rpc-handlers,vscode-core,platform-core}`, `libs/shared`, `apps/ptah-electron`.
- Corrections applied from `code-style-review.md` to files these batches already touch: finding 2 (git-ui barrel over-exports, `libs/frontend/git-ui/src/index.ts:33-39`) → Batch 8b; finding 3 (protected-method test, `git-dock.component.spec.ts:257-263`) and finding 7 (stale JSDoc, `git-dock.component.ts:38-40`) → Batch 7; finding 6 (no `workspace-file-path.spec.ts`) → Batch 8a. Finding 1 (`GitInfoService` facade split) and finding 4 (dual tree builders) stay out of scope. No file in these batches touches either.
- Design handoff used: none. The UI reference is the deleted code at `05e725865^`.
- Missing decision-critical input: none. Every orchestrator decision below was resolvable from source.

### A.2 Codebase evidence

| Evidence                                                                                                                                                   | Location                                                                                                                                                                                                                                                     | Implication                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Source-control rail is a fixed `w-64` div; no collapse, no resize                                                                                          | `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:69-80`                                                                                                                                                                                          | Batch 7 replaces this container                                                |
| Old panel: `sidebarVisible` toggle with `PanelLeftClose`/`PanelLeft`; 256 px default; drag clamp 160-480; pointer-capture + rAF + Escape/blur restore drag | `05e725865^` `editor-panel.component.ts:85-99,119-140,668-671,1403-1418,1488-1600`                                                                                                                                                                           | Port behaviour, not the file; visibility was never persisted there             |
| Layout state persisted under one key; restore reads typed fields; dock default 700, min 300                                                                | `libs/frontend/core/src/lib/services/electron-layout.service.ts:34-41,563-571,582-601`                                                                                                                                                                       | Rail width/collapsed join the same persisted object                            |
| git-ui may depend on `ElectronLayoutService`                                                                                                               | `libs/frontend/git-ui/CLAUDE.md` Dependencies                                                                                                                                                                                                                | No new dependency edge for Batch 7                                             |
| `EditorLauncherService.detect` assigns `response.data.targets` unchecked, and treats a `{success:false}` payload as success                                | `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:43-50`                                                                                                                                                                                     | Batch 6 root cause is reachable from product code, not only fixtures           |
| `OpenInButtonComponent` dereferences `targets().length`                                                                                                    | `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:46-48`                                                                                                                                                                                     | Normalize at the service boundary                                              |
| Old markdown preview: Preview/Source toggle; Monaco host kept mounted and `invisible`; relayout on rAF after returning to source                           | `05e725865^` `code-editor.component.ts:68-112,232-240,545-556`                                                                                                                                                                                               | Batch 8b preview contract                                                      |
| `EditorTab` is a generic tab record; `diff` presence is the discriminant; keys are collision-safe against absolute-path file tabs                          | `libs/frontend/git-ui/src/lib/types/diff-tab.types.ts:42-50,112-141`                                                                                                                                                                                         | File tabs extend this model; no parallel tab store                             |
| `DiffTabsService` owns tab order, activation, close fallback, origin-workspace stale guard, and `FILE_CONTENT_CHANGED` handling                            | `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:91-112,146-149,180-255,290`                                                                                                                                                                      | Reuse for view tabs; file is 647 lines, so reading goes in a collaborator      |
| Dock renders the tab strip only for an active diff and only in git repos in working-tree mode                                                              | `git-dock.component.ts:58-68,82-154`                                                                                                                                                                                                                         | Batch 8b restructures the body                                                 |
| `GitReviewService.setMode` exists                                                                                                                          | `libs/frontend/git-ui/src/lib/services/git-review.service.ts:48`                                                                                                                                                                                             | Opening a link switches to working-tree mode                                   |
| Monaco diff view: read-only, theme detection plus body `MutationObserver`                                                                                  | `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:1208-1259`                                                                                                                                                                                    | Extract theme detection instead of copying it                                  |
| Electron guard treats every `file:` URL as internal                                                                                                        | `apps/ptah-electron/src/windows/main-window.ts:47-56,88-95`                                                                                                                                                                                                  | A relative agent link replaces the window; must narrow                         |
| Renderer is loaded only via `loadFile(renderer/index.html)`                                                                                                | `apps/ptah-electron/src/activation/post-window.ts:102-103`, `apps/ptah-electron/src/main.ts:212-213`                                                                                                                                                         | Allowed navigation is "same document" only                                     |
| Permissive sanitizer: `ALLOW_DATA_ATTR: true`; URI regexp strips drive-letter/`file:`/`vscode:`                                                            | `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:65-68`                                                                                                                                                                                         | Allowlist is not loosened; target travels in a `data-*` attribute              |
| DOMPurify accepts any `data-*` name matching `DATA_ATTR` before the URI check                                                                              | `node_modules/dompurify/dist/purify.es.mjs:321,1175,1187` (dompurify 3.4.5)                                                                                                                                                                                  | `data-ptah-file-href` survives with any value                                  |
| Marked extensions use `renderer` hooks that return `false` to fall through; `escapeHtml` helper exists                                                     | `libs/frontend/markdown/src/lib/marked-extensions.ts:179-217,289-321,335-343`                                                                                                                                                                                | New link extension follows this pattern                                        |
| Chat surfaces render `<markdown>` directly, not `MarkdownBlockComponent`                                                                                   | `chat/.../execution-node.component.ts:140`, `chat-ui/.../thinking-block.component.ts:75`, `agent-card-output.component.ts:153,281`, `agent-summary.component.ts:75,102`, `compact-session-activity.component.ts:251,355,368`, `diff-display.component.ts:52` | A per-component directive would miss surfaces; use one document-level delegate |
| `'full'` preset installed once at the webview root                                                                                                         | `apps/ptah-extension-webview/src/app/app.config.ts:266`                                                                                                                                                                                                      | Extension and interceptor register there                                       |
| `markdown` is `scope:shared`; that tag may depend only on `scope:shared`; core/chat/git-ui are `scope:webview`                                             | `libs/frontend/markdown/project.json:7`, `eslint.config.mjs:116-127`                                                                                                                                                                                         | markdown cannot import core/chat; the port is a markdown-owned token           |
| Core's inversion pattern: tokens in core, bound in composition root                                                                                        | `libs/frontend/core/CLAUDE.md` Guideline 6; `app.config.ts:131-134`                                                                                                                                                                                          | `FILE_LINK_OPENER` lives in core                                               |
| chat avoids static git-ui imports; resolves git services by dynamic import + `Injector`                                                                    | `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:24,40-43,121-128`                                                                                                                                                                      | Router follows the same pattern                                                |
| FilePathLink calls `rpc.openFile(path)` without line, ignores failure; used in tool-call header, diff-display, relay rail                                  | `chat-ui/.../file-path-link.component.ts:69-75`; `tool-call-header.component.ts:91-94`; `diff-display.component.ts:39`; `tribunal-panel/.../relay-phase-rail.component.ts:127-130`                                                                           | One component change covers three surfaces                                     |
| Tasks board opens artifacts through `rpc.openFile(absPath)`                                                                                                | `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1351-1368`                                                                                                                                                                                   | Routed through the same port                                                   |
| Only callers of `ClaudeRpcService.openFile` are FilePathLink and tasks-store                                                                               | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:284-289`; grep                                                                                                                                                                                    | Method deleted once both migrate                                               |
| Tabs are partitioned by workspace path; lookup by tab id returns `workspacePath`, incl. background workspaces                                              | `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:297-308`                                                                                                                                                                                | Originating workspace = the tab's partition                                    |
| Transcript hosts carry `tabId`; compact card carries `tab`                                                                                                 | `chat/.../chat-transcript.component.ts:133-165`; `compact-session-card.component.ts:47-56,137`                                                                                                                                                               | DOM link-context markers go on these hosts                                     |
| Sends use the active workspace as `workspacePath`; Ptah-created worktrees are registered as folders                                                        | `chat/.../message-sender.service.ts:352,413`; `electron-layout.service.ts:189-227`                                                                                                                                                                           | A session's cwd is its partition root, which is registered                     |
| SDK subagent worktrees are created at `<cwd>/.claude-worktrees/<name>`                                                                                     | `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:152-160`                                                                                                                                                                                    | Lexically inside the session root                                              |
| `GitInfoService.getWorktrees(root)` lists worktrees, `[]` on failure                                                                                       | `libs/backend/vscode-core/src/services/git-info.service.ts:592-612`                                                                                                                                                                                          | Backend expands the allowlist to worktrees of registered roots                 |
| Batch 2 resolver: registered-root match, lexical containment, stat; no realpath                                                                            | `libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts:8-58`                                                                                                                                                                                     | Hardened viewer policy is built here                                           |
| Containment is lexical only by design                                                                                                                      | `libs/backend/platform-core/src/utils/path-containment.ts:22-27,64-74`                                                                                                                                                                                       | Symlink escape is this RPC's job                                               |
| `IFileSystemProvider` has no `realpath`; handlers already use `fs/promises` directly                                                                       | `platform-core/src/interfaces/file-system-provider.interface.ts:17-58`; `rpc-handlers/.../file-rpc.handlers.ts:20,170,242,251`                                                                                                                               | Node `fs` in-handler follows precedent; no port change                         |
| Legacy `file:read` has no containment, schema, cap or encoding handling                                                                                    | `rpc-handlers/.../file-rpc.handlers.ts:69-78`                                                                                                                                                                                                                | Not widened; follow-up recorded                                                |
| `file:` and `editor:` prefixes already allowed                                                                                                             | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:47-48`                                                                                                                                                                                                | No prefix change; registry + manifest still required                           |
| Capabilities are the unit of per-host variation; manifest partitions `RPC_METHOD_NAMES`                                                                    | `rpc-handlers/src/lib/host-profile/capabilities.ts:18-55`; `manifest.ts:315-319,364,378-414`                                                                                                                                                                 | New `fileViewer` capability + manifest entry                                   |
| Electron enables all capabilities; VS Code omits fs access; CLI lists absent capabilities                                                                  | `apps/ptah-electron/src/rpc-host-profile.ts:26-44`; `apps/ptah-extension-vscode/src/rpc-host-profile.ts:22-33`; `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:18-24`; `rpc-surface.spec.ts:108-117`                                                | Electron on; VS Code default off; CLI list updated                             |
| VS Code `file:open`: no schema, stats raw path (relative resolves against process cwd), line only, returns raw `error.message`                             | `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:43-90`                                                                                                                                                                            | Batch 8a hardens it for relative links and column                              |
| `editor:openFile` schema/handler use Batch 2 resolver, line only                                                                                           | `editor-rpc.schema.ts:14-21`; `editor-rpc.handlers.ts:76-93`                                                                                                                                                                                                 | Add explicit `scope` for out-of-root agent links                               |
| E2E fake RPC fixture, `ui.goto('git')`, 1200x800 assertion                                                                                                 | `apps/ptah-electron-e2e/src/support/fixtures.ts:92-110`; `ui-driver.ts:312-325`; `hunk-widget-mouse.spec.ts:47`                                                                                                                                              | New specs reuse fixture; no resize helpers                                     |

### A.3 Architecture decisions

**D1 — Rail collapse (Batch 7).** Requirement: outcome 1. Chosen: `ElectronLayoutService` owns `gitRailWidth` (default 256, clamp 160-480) and `gitRailCollapsed`, persisted in the existing `electron-layout` state object. `GitDockComponent` binds the rail width; a git-ui `RailResizeHandleComponent` ports the old pointer-capture drag; the header gets the toggle. Evidence: `electron-layout.service.ts:563-601`; `05e725865^ editor-panel.component.ts:1403-1600`. Rejected: reuse chat-ui `ElectronResizeHandleComponent` (git-ui must not depend on chat libs, `git-ui/CLAUDE.md`; it also sets width from absolute pointer X and uses mouse events); component-local signal (the requirement demands persistence). Effect: the fixed `w-64` container is replaced; review-mode rail (`git-review-panel.component.ts:26-43`) untouched.

**D2 — Detection robustness (Batch 7).** Product code must tolerate a failed or malformed `editor:detectTargets`: a `success:false` payload is a detection error, and missing or non-array `targets` normalizes to `[]` with a visible error. Fix at the service boundary, not in each consumer. On failure the single-flight is released so a later dock mount retries.

**D3 — Read-only file tab (Batch 8b).** Chosen: extend `EditorTab` with a `view?: FileViewTabState` discriminant, keyed `view:<normalized absolute path>`. `DiffTabsService` gains `openFileView` / refresh-on-`FILE_CONTENT_CHANGED`, delegating the RPC call and result mapping to a new injected collaborator `FileViewReaderService` (facade rule; keeps `DiffTabsService` near its current size). Evidence: `diff-tab.types.ts:112-141` already anticipates non-diff tabs; `diff-tabs.service.ts:180-255` owns order/activation/fallback. Rejected: a second tab store (two active keys need cross-service arbitration and a merged strip ordering); renaming `diffTabs`/`activeDiffKey` to generic names (ripples into Batch 1-6 specs; recorded as follow-up, JSDoc updated instead).

**D4 — Contained read RPC (Batch 8a).** New `file:viewContent` served by `FileViewRpcHandlers` under a new `fileViewer` capability (Electron only). Path policy lives in `workspace-file-path.ts` (extended) plus an injectable `FileLinkRootPolicy` that supplies authorized roots: registered folders, plus worktrees of registered folders (lazy, only on lexical miss), plus a realpath re-check. Rejected: reuse the `fileSystemAccess` capability (it means raw fs access, `capabilities.ts:49`; a host may want the viewer without raw access); widening `file:read` (orchestrator decision); a platform-core `realpath` port (three adapter changes for one Node call that handlers already make directly).

**D5 — Backend-authoritative session roots.** The renderer sends the originating tab's partition root as `workspaceRoot` and, for links inside a previewed document, `documentPath`. The backend accepts them only as a base-selection hint. A hint must equal or lie within a registered root, or a worktree of one; otherwise `root-not-open`. Evidence: tabs partition by workspace (`tab-workspace-partition.service.ts:297-308`); Ptah worktrees are registered (`electron-layout.service.ts:189-227`); SDK subagent worktrees are lexically inside their session root (`worktree-hook-handler.ts:152-156`); other worktrees come from `git worktree list` (`git-info.service.ts:592-612`). Rejected: a new session→cwd backend store (no current producer records a cwd distinct from `workspaceId`, `session-metadata-store.ts:63-66`).

**D6 — Link capture (Batch 8c).** A markdown-lib marked extension renders every file-like link as `<a href="#" data-ptah-file-href="<raw>" title="<raw>">`. That happens before sanitization, so neither the URI allowlist nor the sanitizer changes. One capture-phase `click`/`auxclick` listener on `document`, installed by `provideMarkdownFileLinks()`, intercepts anchors inside a `markdown` host. It skips `pre`/`code`, parses `data-ptah-file-href` (or a raw-HTML anchor's `href`), and calls a markdown-owned `MARKDOWN_FILE_LINK_HANDLER` token. The composition root binds that token to chat's `FileLinkRouterService`, which also implements core's `FILE_LINK_OPENER` used by FilePathLink and tasks-store. Evidence: consumer spread in A.2; lint scopes `eslint.config.mjs:116-127`; data-attr retention `purify.es.mjs:1175`. Rejected: a directive on each `<markdown>` (nine consumer files, easy to miss one); an `(click)` on `MarkdownBlockComponent` (chat surfaces bypass it); loosening `ALLOWED_URI_REGEXP` (forbidden). The sentinel `href="#"` keeps anchors focusable, so Enter fires `click`. If interception ever fails, the navigation stays in-page, which emits no `will-navigate`. The data attribute is transport, not a trust signal: an agent can author it in raw HTML at the same trust level as a markdown link, and the backend policy decides.

**D7 — Bare `path:line` text is not linkified.** Justification: prose false positives (`10:30`, `3:2`, `host:port`); inline code is often an example rather than a reference; linkifying text on every streaming re-render adds a DOM walk per chunk (`execution-node.render-throttle.spec.ts` exists precisely to bound that cost); structured tool paths are already links via FilePathLink. Recorded as follow-up.

**D8 — Outside-root external open.** The viewer never shows out-of-root bytes. The tab shows a message plus Open In. `editor:openFile` gains `scope: 'workspace' | 'external-link'` (default `workspace`, unchanged behaviour). `external-link` authorizes view roots ∪ `realpath(os.homedir())` ∪ `realpath(os.tmpdir())`, with UNC/device/ADS forms refused before any fs call, and the target must be a regular file after realpath. Justification: bytes go to the user's own editor process via argv arrays (Batch 2 adapters), never to the renderer; agent out-of-root references are predominantly `~/.claude/...`, `~/.ptah/...` and temp scratch; excluding system and device paths stops a prompt-injected link from launching an editor on `/proc/kcore`, `/dev/zero`, `\\.\PhysicalDrive0` or an SMB share (NTLM credential leak). `scope` is renderer-chosen, but its widest outcome is "open a local regular file under home/tmp in the user's editor", which grants nothing that `file:read` does not already grant on Electron.

**D9 — VS Code.** No viewer; `fileViewer` stays off. FilePathLink and markdown links call `file:open` with `{path, line, column, workspaceRoot}`. The VS Code handler adopts the strict schema. It resolves relative paths through `FileLinkRootPolicy` (never process cwd) and resolves absolute paths through the D8 external-link policy, keeping directory reveal. It refuses UNC/device forms before `fs.stat` and returns sanitized errors. Column is honoured with `vscode.Position(line-1, column-1)`. The external launcher (`IEditorLauncher.openFile`) stays line-only; column for external editors is a follow-up (would change `platform-core` plus three adapters).

**D10 — Electron navigation guard.** `will-navigate` allows only a `file:` target whose URL, minus hash and query, equals the current document URL minus hash and query (a same-document reload). Every other `file:` is cancelled and not handed to `shell.openExternal`; `http/https/mailto` behaviour is unchanged. Initial `loadFile` and `webContents.reload()` do not emit `will-navigate` (Assumption A7). The pure predicate moves to `navigation-policy.ts` for unit testing.

Assumptions (implementer resolves before relying on them):

- A1: `TOKENS.GIT_INFO_SERVICE` is registered in the Electron container. Evidence: `GitRpcHandlers` injects it (`git-rpc.handlers.ts:131`) and Electron serves `git:*`. Check: `grep -rn GIT_INFO_SERVICE apps/ptah-electron/src`.
- A2: marked 17.0.6 hands the raw, uncleaned `href` to `renderer.link` (`node_modules/marked/lib/marked.d.ts:197`). Check `Renderer.link` in `marked.esm.js`; if pre-cleaned, `decodeURI` before parsing.
- A3: ngx-markdown 21.3.0 writes rendered HTML into the `markdown` host element (`types/ngx-markdown.d.ts:1851`, selector `markdown, [markdown]`). Check `MarkdownComponent.render`.
- A4: `libs/backend/rpc-handlers/src/index.ts` re-exports the handlers barrel. Check before adding exports.
- A5: the loaded Monaco build exposes `monaco.languages.getLanguages()` with `extensions`, used for language inference. Fallback is `plaintext`.
- A6: `VSCodeService.setState/getState` persists across an Electron renderer reload. Check its Electron branch; the e2e reload assertion proves it.
- A7: Electron 40 emits no `will-navigate` for `loadFile`/`reload`. The e2e reload step proves it.
- A8: `electron-layout.service.spec.ts` exists. Modify if present, create if not.
- A9 (known limitation): a relative link emitted by a subagent running inside `<root>/.claude-worktrees/<name>` resolves against the parent tab root, not the worktree. Absolute links work. Follow-up: carry agent cwd on execution nodes.

### A.4 Component specifications

#### Batch 7 — Collapsible source-control rail + detection robustness

##### 7.1 Rail layout state (`ElectronLayoutService`)

- Purpose: own and persist the Git dock rail width and collapsed state.
- Contract (additions only):

```ts
const DEFAULT_GIT_RAIL_WIDTH = 256;
const MIN_GIT_RAIL_WIDTH = 160;
const MAX_GIT_RAIL_WIDTH = 480;
readonly gitRailWidth: Signal<number>;
readonly gitRailCollapsed: Signal<boolean>;
setGitRailWidth(width: number): void;       // clamp; no persist (drag frames)
commitGitRailWidth(): void;                 // persistLayout()
toggleGitRail(): void;                      // flip + persistLayout()
```

- `persistLayout()` (`:563-571`) adds `gitRailWidth` and `gitRailCollapsed`. `restoreLayout()` (`:582-601`) applies them only when `typeof` is `number`/`boolean` and passes width through the clamp, so malformed persisted values are ignored.
- Failure: persistence is the existing `setState` path; there is no new failure mode.
- Verification seam: service spec for clamping, the persist call on commit/toggle but not on `setGitRailWidth`, and restore with valid, malformed and absent state.
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/lib/services/electron-layout.service.ts`; MODIFY (or CREATE, A8) `.../libs/frontend/core/src/lib/services/electron-layout.service.spec.ts`.

##### 7.2 `RailResizeHandleComponent` (git-ui, internal)

- Purpose: vertical separator that resizes the rail by pointer and keyboard.
- Contract: `selector: 'ptah-git-rail-resize-handle'`; inputs `width: number`, `min: number`, `max: number`; outputs `widthChange: number` (per rAF frame) and `widthCommit: void`. Renders `role="separator" aria-orientation="vertical" aria-label="Resize source control" tabindex="0"` with `aria-valuenow/min/max`, classes `w-1 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/50`.
- Behaviour (port of `05e725865^ editor-panel.component.ts:1403-1600`): `pointerdown` records `startX`/`startWidth` and takes `setPointerCapture`, tolerating failure. Moves coalesce to one rAF. `pointerup` commits. `pointercancel`, `lostpointercapture`, window `blur` and `Escape` restore the original width. A second pointer is refused while one drag is active, and every listener is removed on end or destroy. ArrowLeft/ArrowRight step 16 px, and Home/End jump to min/max; each key commits.
- Quality: OnPush, `inject()`, no zone dependency (runs in zoneless libs); nothing lingers after destroy.
- Verification seam: component spec dispatching real `PointerEvent`/`KeyboardEvent` on the rendered separator. It covers clamping, Escape restore, blur restore, keyboard steps and listener cleanup (spy on `document.removeEventListener`).
- Files: CREATE `.../libs/frontend/git-ui/src/lib/git-dock/rail-resize-handle.component.ts` and `.spec.ts`.

##### 7.3 Dock rail and header toggle

- `GitDockComponent` (`:69-80`) replaces the fixed container:
  - `@if (!layout.gitRailCollapsed())`, a `<div id="git-source-control-rail" class="flex-shrink-0 border-r border-base-content/10 overflow-hidden" [style.width.px]="layout.gitRailWidth()" style="max-width: calc(100% - 12rem)">` hosting the panel.
  - Then `<ptah-git-rail-resize-handle>`, wired to `setGitRailWidth`/`commitGitRailWidth`.
  - The `max-width` keeps at least 192 px for the diff/file pane at the 300 px dock minimum.
  - When collapsed, the right pane is `flex-1` at full width.
  - JSDoc `:33-40` is rewritten to describe the header branch controls and rail (style finding 7).
- `GitDockHeaderComponent` gains a leading toggle button, before the branch button, rendered when `gitStatus.isGitRepo() && review.mode() === 'working-tree'`. Attributes: `data-testid="git-rail-toggle"`, `aria-controls="git-source-control-rail"`, `[attr.aria-expanded]="!layout.gitRailCollapsed()"`, label/title `Hide source control` / `Show source control`, icon `PanelLeftClose` / `PanelLeft` (lucide-angular, already a git-ui dependency).
- Review mode: toggle hidden; the review panel keeps its own responsive rail.
- Verification seam: `git-dock.mount.spec.ts` (real children) clicks the toggle and asserts the rail is absent, the right pane present and the persisted state written; `git-dock-header.component.spec.ts` covers visibility per mode. Replace the protected-method test at `git-dock.component.spec.ts:257-263` with a rendered click (style finding 3).
- Files: MODIFY `.../git-ui/src/lib/git-dock/git-dock.component.ts`, `git-dock.component.spec.ts`, `git-dock.mount.spec.ts`, `git-dock-header.component.ts`, `git-dock-header.component.spec.ts`.

##### 7.4 Detection robustness (`EditorLauncherService`)

- `detect()` (`:37-63`) classifies the response:
  - Transport failure: `detectionError` = transport message.
  - `data.success === false`: `detectionError = data.error ?? 'Editor detection failed.'`, `targets = []`.
  - Non-array `targets`: `targets = []`, `detectionError = 'Editor detection returned an invalid response.'`.
  - Array: filter entries to objects with string `id` and `displayName`.
- Any failure sets `this.detection = null` so the next `detect()` retries.
- Verification seam: service spec with each malformed shape. Mount spec: a `detectTargets` response of `{}` still renders every file row and a visible detection-error state (the Batch 6 regression, now pinned in product code).
- Files: MODIFY `.../git-ui/src/lib/services/editor-launcher.service.ts`, `editor-launcher.service.spec.ts`.

##### 7.5 Electron e2e

- CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron-e2e/src/specs/git/git-rail-collapse.spec.ts` (`describe('git source-control rail')`):
  - At the fixture window, assert `[1200, 800]` as `hunk-widget-mouse.spec.ts:47` does, and dock container width 700 (±1).
  - Toggle collapse: rail hidden, diff pane width grows by the rail width.
  - Drag the separator with mouse to 200 px, then reload the renderer; the width is restored and the collapsed state survives reload.
  - Mock `editor:detectTargets` as `{}`: every mocked file row still renders.
  - No window resize and no `editorPanelWidth` override.

#### Batch 8a — Backend contracts, contained read, host profiles, Electron guard

##### 8a.1 Wire contracts (`libs/shared`)

`rpc-misc.types.ts` (next to `FileOpenParams`, `:124-138`):

```ts
export interface FileOpenParams {
  path: string;
  line?: number;
  column?: number;
  workspaceRoot?: string;
}

export type FileViewFailureReason = 'invalid-request' | 'unsupported-path' | 'no-base-root' | 'root-not-open' | 'outside-roots' | 'not-found' | 'not-a-file' | 'too-large' | 'binary' | 'unsupported-encoding' | 'unreadable';

export interface FileViewContentParams {
  /** Decoded filesystem path: relative, POSIX absolute or drive absolute. Never a URL. */
  path: string;
  /** Originating session's workspace (tab partition root). Base-selection hint only. */
  workspaceRoot?: string;
  /** Absolute path of the document that contained the link (preview links). */
  documentPath?: string;
}

export type FileViewContentResult =
  | { success: true; absolutePath: string; workspaceRoot: string; relativePath: string; content: string; sizeBytes: number; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' }
  | {
      success: false;
      reason: FileViewFailureReason;
      error: string;
      /** Lexically resolved path; present only for outside-roots / too-large / binary / unsupported-encoding. Never a realpath. */
      absolutePath?: string;
      sizeBytes?: number;
      /** True when D8's external-link policy would accept absolutePath. */
      externalOpenAllowed: boolean;
    };

export const FILE_VIEW_MAX_BYTES = 2 * 1024 * 1024;
```

`rpc-editor.types.ts`: `EditorOpenFileParams` adds `scope?: 'workspace' | 'external-link'`.

`rpc.types.ts`: add `'file:viewContent': { params: FileViewContentParams; result: FileViewContentResult }` beside `'file:open'` (`:689`), plus `'file:viewContent': true` in the method-name map (`:3348` block).

Files: MODIFY `.../libs/shared/src/lib/types/rpc/rpc-misc.types.ts`, `rpc/rpc-editor.types.ts`, `rpc.types.ts`.

##### 8a.2 Path policy (`workspace-file-path.ts` + `FileLinkRootPolicy`)

Contract (added to `workspace-file-path.ts`; existing `resolveWorkspaceFilePath` is kept for `editor:openFile` scope `workspace` and Electron `file:open`):

```ts
export type LinkedPathForm = { ok: true } | { ok: false };
export function checkLinkedPathForm(value: string, platform?: NodeJS.Platform): LinkedPathForm;

export interface LinkedFileRoots {
  view: readonly string[];
  external: readonly string[];
}
export type LinkedFileResolution =
  | { kind: 'file'; lexicalPath: string; realPath: string; root: string; sizeBytes: number }
  | { kind: 'directory'; lexicalPath: string } // only when allowDirectory
  | { kind: 'rejected'; reason: FileViewFailureReason; lexicalPath?: string; sizeBytes?: number };

export async function resolveLinkedFilePath(request: { path: string; workspaceRoot?: string; documentPath?: string }, roots: { registered: readonly string[]; listWorktrees(root: string): Promise<readonly string[]>; extra?: readonly string[] }, options: { maxBytes?: number; allowDirectory?: boolean }): Promise<LinkedFileResolution>;
```

`FileLinkRootPolicy` (new `file-link-root-policy.ts`, `@injectable()`):

- Dependencies: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `TOKENS.GIT_INFO_SERVICE` (A1).
- Methods: `resolveForView(request)` (extra roots none, `maxBytes = FILE_VIEW_MAX_BYTES`) and `resolveForExternalOpen(request, { allowDirectory })` (extra roots `os.homedir()` and `os.tmpdir()`, no size cap).
- `listWorktrees` maps `gitInfo.getWorktrees(root)` to paths and drops UNC-form paths.

Ordered algorithm (security order is part of the contract):

1. **Form gate, before any fs or git call**, on `path`, `workspaceRoot` and `documentPath`. Reject `unsupported-path` for:
   - NUL or C0 control characters;
   - a leading `\\` or `//` (UNC, `\\?\`, `\\.\`, `//server`);
   - on win32: drive-relative `^[A-Za-z]:(?![\\/])`, root-relative `^[\\/](?![\\/])`, or any `:` after position 1 (alternate data streams).
2. **Base selection.** Registered = `workspace.getWorkspaceFolders()`. Hints count only if they are authorized, meaning equal to or within a registered root, or within a worktree of one.
   - `documentPath` authorized → base = `dirname(documentPath)`.
   - Otherwise `workspaceRoot` authorized → base = that root.
   - A supplied but unauthorized hint → `root-not-open`.
   - A relative path with no base → `no-base-root`.
3. `lexical = isAbsolute ? path.resolve(path) : path.resolve(base, path)`. `process.cwd()` is never consulted, because steps 1-2 guarantee an absolute input on every branch.
4. **Lexical containment.** `isPathWithinRoots(lexical, registered ∪ extra)`. On a miss, lazily add worktrees of every registered root (parallel; `getWorktrees` is already bounded by `WORKTREE_GIT_TIMEOUT_MS` and returns `[]` on failure) and retry. Still a miss → `outside-roots` with `lexicalPath`.
5. **Realpath containment.** `realTarget = fs.promises.realpath(lexical)` (`ENOENT`/`ENOTDIR` → `not-found`; `EACCES`/`EPERM` → `unreadable`). `realRoots = realpath(each authorized root)`; failing roots are dropped. A UNC-form `realTarget` (junction to a share) → `outside-roots` without `lexicalPath`. `!isPathWithinRoots(realTarget, realRoots)` → `outside-roots` without `lexicalPath`, so a symlink escape is not offered for external open.
6. `fs.promises.stat(realTarget)`: a directory → `directory` if `allowDirectory`, else `not-a-file`; `!isFile()` (FIFO, socket, device) → `not-a-file`; `size > maxBytes` → `too-large`.

`FileViewRpcHandlers` then does the read: `fs.promises.open(realTarget, 'r')`, reads at most `maxBytes + 1` bytes and closes in `finally`. If more than `maxBytes` bytes were read (the file grew after stat) → `too-large`. Decoding:

- BOM `EF BB BF` → UTF-8 minus BOM.
- BOM `FF FE` / `FE FF` → UTF-16 LE/BE.
- Otherwise a NUL within the first 8000 bytes → `binary`.
- Otherwise `new TextDecoder('utf-8', { fatal: true })`; a throw → `unsupported-encoding`.

Residual risk, recorded: a TOCTOU swap of a path component between realpath and open by a local writer inside an authorized root. Node offers no fd-to-path check on Windows, and exploiting it requires write access to the workspace already.

- Failure behaviour: never throws to transport; every rejection maps to a fixed message table (for example `outside-roots` → "This file is outside the workspaces open in Ptah."). No `error.message`, stderr or realpath is returned. Logging goes through `logger.warn('[file:viewContent] rejected', { reason })` with no content or path.
- Verification seam: `workspace-file-path.spec.ts` (style finding 6) exercises the pure form gate and `resolveLinkedFilePath` against a temp directory tree. Cases: relative/absolute inside, `..` traversal, sibling-prefix (`/ws` vs `/ws2`), win32 case-fold (platform param), UNC/device/drive-relative/ADS strings with a spy proving `realpath`/`stat` were never called, symlink out of root (skipped on Windows without symlink privilege, junction used instead), symlink between two authorized roots (allowed), directory, FIFO (POSIX only), size cap boundary, unregistered hint, and a worktree root (fake `listWorktrees`). The existing `resolveWorkspaceFilePath` gets registered-root, relative-without-root, directory and traversal cases.
- Files: MODIFY `.../libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts`; CREATE `workspace-file-path.spec.ts`, `file-link-root-policy.ts`, `file-link-root-policy.spec.ts`.

##### 8a.3 `FileViewRpcHandlers`

- `static readonly METHODS = ['file:viewContent'] as const satisfies readonly RpcMethodName[]`. Constructor: `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `FileLinkRootPolicy`.
- Schema `FileViewContentParamsSchema = z.object({ path: z.string().min(1).max(4096), workspaceRoot: z.string().min(1).max(4096).optional(), documentPath: z.string().min(1).max(4096).optional() }).strict()`, parsed with `safeParse`; failure → `invalid-request`.
- Result: success carries lexical `absolutePath`, matched root, POSIX `relativePath`, decoded `content`, `sizeBytes`, `encoding`. `externalOpenAllowed` on failure = `(await policy.resolveForExternalOpen({path: lexicalPath})).kind === 'file'`, evaluated only when `lexicalPath` is present.
- Registration: `capabilities.ts` adds `'fileViewer'` (doc: "Host can serve contained read-only file content for an in-app viewer (`file:viewContent`)"). `manifest.ts` adds `{ key: 'fileView', methods: FileViewRpcHandlers.METHODS, requires: ['fileViewer'], handler: FileViewRpcHandlers }`. Electron profile sets `fileViewer: true`. VS Code profile unchanged (defaults false). CLI `EXPECTED_ABSENT_CAPABILITIES` adds `'fileViewer'`. VS Code `di/rpc-surface.spec.ts` excluded expectations add `file:viewContent` (near `:60`).
- Verification seam: handler spec with a fake `RpcHandler` capturing the registered function (existing handler-spec pattern) and a real temp tree, covering success, each reason, sanitized error text and no path in errors. `rpc-allowlist.spec.ts` / manifest invariants must stay green unmodified. `cli-engine` `rpc-surface.spec.ts` must show `file:viewContent` excluded.
- Files: CREATE `.../rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts`, `file-view-rpc.schema.ts`, `file-view-rpc.handlers.spec.ts`. MODIFY `handlers/index.ts`, `src/index.ts` (A4; export `FileLinkRootPolicy`, `FileOpenRpcParamsSchema`, `checkLinkedPathForm`), `host-profile/capabilities.ts`, `host-profile/manifest.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron/src/rpc-host-profile.ts`, `.../libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`, `.../apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`.

##### 8a.4 `editor:openFile` scope and `file:open` column

- `EditorOpenFileParamsSchema` (`editor-rpc.schema.ts:14-21`) adds `scope: z.enum(['workspace','external-link']).optional()`. `EditorRpcHandlers.openFile` (`:76-93`): `scope === 'external-link'` → `FileLinkRootPolicy.resolveForExternalOpen` (file only); otherwise the existing `resolveWorkspaceFilePath`. Launcher call is unchanged (line only). The constructor gains `FileLinkRootPolicy`.
- `FileOpenRpcParamsSchema` (`file-open-rpc.schema.ts:11-17`) adds `column: z.number().int().positive().optional()`. Electron `file:open` behaviour is otherwise unchanged; the column is not forwarded to the launcher.
- VS Code `FileRpcHandlers` (`apps/ptah-extension-vscode/.../file-rpc.handlers.ts:43-90`):
  - Parse with the exported `FileOpenRpcParamsSchema`. Relative path → `FileLinkRootPolicy.resolveForView` using the resolved lexical path only (the size cap is irrelevant here, so call the resolver with `maxBytes: Infinity, allowDirectory: true`). Absolute path → `resolveForExternalOpen(…, { allowDirectory: true })`.
  - Reject with fixed messages; `Path not found: ${path}` becomes a fixed string.
  - Selection uses `new vscode.Position(line - 1, (column ?? 1) - 1)`.
  - Sentry capture is kept; the raw `error.message` is no longer returned (a fixed "Could not open the file in VS Code." is returned instead).
- Verification seam: editor handler spec for scope routing; VS Code handler spec (CREATE) with the `vscode` module mocked, covering relative + authorized root, relative + unregistered root, UNC before stat, column selection, and directory reveal.
- Files: MODIFY `.../rpc-handlers/src/lib/handlers/editor-rpc.schema.ts`, `editor-rpc.handlers.ts`, `editor-rpc.handlers.spec.ts`, `file-open-rpc.schema.ts`, `file-open-rpc.handlers.spec.ts`; MODIFY `.../apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts`; CREATE `.../apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts`.

##### 8a.5 Electron navigation policy

- Contract (CREATE `apps/ptah-electron/src/windows/navigation-policy.ts`, no `electron` import):

```ts
export function isSameDocumentNavigation(currentUrl: string, targetUrl: string): boolean; // both file:, equal minus hash/query; unparseable → false
export function isSafeExternalUrl(targetUrl: string): boolean; // http:, https:, mailto: only
```

- `main-window.ts:47-101`: `will-navigate` → `if (isSameDocumentNavigation(window.webContents.getURL(), url)) return; event.preventDefault(); if (isSafeExternalUrl(url)) void shell.openExternal(url);`. `setWindowOpenHandler` is unchanged apart from using `isSafeExternalUrl`. `isInternalNavigation` and `EXTERNAL_SCHEMES` are deleted (replaced).
- Verification seam: `navigation-policy.spec.ts` covers same document with `#hash` (allowed), a sibling `file:` path, a relative-resolved `file:///…/renderer/src/a.ts`, `file://server/share`, `javascript:`, an empty current URL, and malformed input. The e2e in 8c proves reload still works (A7).
- Files: CREATE `.../apps/ptah-electron/src/windows/navigation-policy.ts`, `navigation-policy.spec.ts`; MODIFY `.../apps/ptah-electron/src/windows/main-window.ts`.

Follow-up recorded, not implemented: legacy `file:read` (`file-rpc.handlers.ts:69-78`) lacks schema, containment, size cap and encoding handling. Migrate its callers to `file:viewContent` or apply `FileLinkRootPolicy`.

#### Batch 8b — Read-only file tab in the Git dock (Electron)

##### 8b.1 Tab model and reader

- `diff-tab.types.ts` additions:

```ts
export type FileViewTabStatus = 'loading' | 'fresh' | 'refreshing' | 'blocked' | 'error';
export interface FileViewTabState {
  absolutePath: string; // lexical, from backend on success; request path otherwise
  workspaceRoot: string | null;
  relativePath: string | null;
  content: string; // '' unless fresh/refreshing
  sizeBytes: number | null;
  isMarkdown: boolean; // /\.(md|markdown|mdx)$/i
  reveal: { line: number; column: number } | null;
  status: FileViewTabStatus;
  failure?: { reason: FileViewFailureReason; message: string; externalOpenAllowed: boolean };
  request: FileViewOpenRequest; // retained for refresh
  requestId: number;
}
export interface FileViewOpenRequest {
  path: string;
  line?: number;
  column?: number;
  workspaceRoot?: string;
  documentPath?: string;
}
export function fileViewTabKey(absoluteOrRequestPath: string): string; // `view:` + separator-normalized path, lowercased on win32-shaped paths
```

`EditorTab` adds `view?: FileViewTabState`; exactly one of `diff` / `view` is present. JSDoc on `EditorTab`, `diffTabs` and `activeDiffKey` is updated to say "dock tab" (rename deferred).

- `FileViewReaderService` (CREATE `services/file-view-reader.service.ts`, `providedIn: 'root'`, internal):
  - `read(request, requestId): Promise<FileViewTabState>` calls `rpcCall<FileViewContentResult>(vscode, 'file:viewContent', {path, workspaceRoot, documentPath})`.
  - Mapping: success → `fresh`; `outside-roots`, `root-not-open`, `no-base-root` or `unsupported-path` → `blocked` with empty content; any other failure → `error` with empty content. A transport failure on refresh returns `error` while keeping the previous content (git-ui guideline 4). An authorization failure on refresh (`outside-roots`, `root-not-open`) clears content deliberately, because revocation is not staleness.
  - Copy is taken from the backend's fixed `error` string only when `reason` is a known union member; otherwise generic copy.
- `DiffTabsService` additions:
  - `openFileView(request: FileViewOpenRequest): Promise<void>`: an existing key (matched by request path or resolved `absolutePath`) → activate, update `reveal`, refresh. Otherwise insert a `loading` tab immediately (so the dock shows progress), then apply the read result guarded by `requestId`.
  - `closeDiff`/`activateDiff` work unchanged by key.
  - `openDiffKeys` (`:112-114`) filters to diff tabs only; the view component owns its own model lifecycle.
  - `onFileContentChanged(absolutePath)` (`:290-299`) also refreshes view tabs whose `absolutePath` matches, using the same normalization.
  - Diff-only paths (`onGitStatusUpdate`, `refreshAllDiffTabs`, `applyFreshDiff`, `patchDiff`, `applyHunks`) skip tabs without `diff`.
  - View tabs are not dropped on workspace switch: they carry their own authorized root, unlike `openDiff`'s origin guard at `:215-218`.
- Verification seam: reader spec (every reason → status; content clearing rules). `DiffTabsService` spec: open, re-open reveal, close fallback across mixed tabs, content-changed refresh, stale `requestId` drop, diff refresh ignoring view tabs.
- Files: MODIFY `.../git-ui/src/lib/types/diff-tab.types.ts`, `services/diff-tabs.service.ts`, `services/diff-tabs.service.spec.ts`; CREATE `services/file-view-reader.service.ts`, `services/file-view-reader.service.spec.ts`.

##### 8b.2 `FileViewComponent`

- Purpose: render one view tab as a read-only Monaco editor, or as a markdown preview.
- Contract: `selector: 'ptah-file-view'`; inputs `tab: EditorTab` (required, `view` present), `editorTargets: readonly EditorTarget[]`; outputs `retryRequested: string` (key) and `openExternal: OpenInRequest`.
- Template regions:
  1. Header: file name, `title` = absolute path, `Read-only` badge, and when `isMarkdown` a Preview/Source toggle button (`aria-pressed`, icons `Eye`/`Code`, labels "Preview"/"Source").
  2. Body host `class="flex-1 min-h-0 relative"` carrying the link-context attributes `[attr.data-ptah-link-root]="view.workspaceRoot"` and `[attr.data-ptah-link-document]="view.absolutePath"`.
  3. The Monaco host is always mounted, `invisible` while preview is showing (old `code-editor.component.ts:94-99`).
  4. Preview: `<ptah-markdown-block [content]="view.content" />` inside `overflow-y-auto p-4`, shown by default for markdown when `sizeBytes <= 512 KiB`. Above that, Source only, with the note "Preview is disabled for files over 512 KB."
  5. `blocked`: `role="alert"` message plus `<ptah-open-in-button mode="full" [targets]="editorTargets" [root]="view.workspaceRoot ?? ''">`, rendered only when `failure.externalOpenAllowed`. It emits `openExternal` with `{ target, path: view.absolutePath, line: reveal?.line }`.
  6. `error`: `role="alert"` message plus a Retry button.
  7. `loading`: spinner with `aria-busy`.
- Monaco:
  - `MonacoLoaderService.load()` (`monaco-loader.service.ts:107`), then `monaco.editor.create(host, { readOnly: true, domReadOnly: true, automaticLayout: true, minimap: { enabled: false }, theme })`.
  - One `ITextModel` per component instance; setting a new tab disposes the previous model. Language comes from `getLanguages()` extension match (A5), falling back to `plaintext`.
  - When `reveal` changes on a fresh tab: clamp line/column to the model, `setSelection`, `revealPositionInCenter`.
  - Leaving preview for Source relayouts on `requestAnimationFrame` (old `:545-556`).
  - `DestroyRef` disposes the editor, model and theme observer.
- Theme: extract `detectMonacoTheme()` plus the body-attribute observer from `diff-view.component.ts:1208-1259` into CREATE `services/monaco-theme.ts` (internal, not exported: `observeMonacoTheme(monaco, onChange): () => void`), used by both components. `DiffViewComponent` behaviour is unchanged.
- Security: markdown only through `MarkdownBlockComponent` (the chokepoint); no `[innerHTML]`, no second sanitizer. MDX renders as markdown, and JSX-like tags are removed by the existing sanitizer. Links inside the preview flow through 8c with `documentPath` set, so their relative base is the document directory, re-authorized by the backend.
- Dependency: git-ui adds `@ptah-extension/markdown` (`scope:shared`, permitted for `scope:webview` by `eslint.config.mjs:125-126`). Update `libs/frontend/git-ui/CLAUDE.md` Dependencies and Boundaries ("read-only file view tab; still no file tree or editing").
- Verification seam: component spec with the real `MarkdownBlockComponent` under an ngx-markdown stub (existing `__mocks__/ngx-markdown.ts` pattern) and a fake Monaco loader. It covers preview-first for `.md`/`.mdx`, Source toggle `aria-pressed`, the 512 KiB threshold, the blocked state with and without `externalOpenAllowed`, reveal clamping, model disposal on tab change, and absence of `innerHTML` bindings (template scan assertion).
- Files: CREATE `.../git-ui/src/lib/file-view/file-view.component.ts`, `file-view.component.spec.ts`, `services/monaco-theme.ts`, `services/monaco-theme.spec.ts`; MODIFY `diff-view/diff-view.component.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/CLAUDE.md`.

##### 8b.3 Dock composition and launcher scope

- `GitDockComponent` body, after Batch 7:
  - `branch-review` → review panel (unchanged).
  - Otherwise a row of [rail (only when `isGitRepo()`), resize handle, right pane].
  - When not a git repo or still loading, the rail slot shows the existing message text and the right pane still works, so a file tab opens in a non-git workspace.
  - Right pane: the tab strip renders whenever `diffTabs.diffTabs().length > 0`. Tab label is the `fileName` (view tabs: basename plus the `Read-only` badge in the panel, not the strip); the close button, Arrow and Delete keyboard model (`:210-231`) are unchanged.
  - Panel: `@if (activeTab.view)` → `<ptah-file-view (openExternal)="launchers.openLinkedFile($event)" (retryRequested)="diffTabs.refreshFileView($event)">`, else `<ptah-diff-view>` as today.
- `EditorLauncherService.openLinkedFile(request: OpenInRequest)` → `editor:openFile` with `{ target, path, line?, scope: 'external-link' }`; the success/error status reuses the existing `launchStatus` region.
- Barrel `libs/frontend/git-ui/src/index.ts`:
  - Remove the internal exports at `:32-39` (style finding 2). Keep `OpenInRequest`/`OpenInButtonMode` types only if a consumer outside git-ui imports them (grep; otherwise remove).
  - Add `type FileViewOpenRequest`. `DiffTabsService` and `GitReviewService` are already exported (`:21,23`).
  - Before deleting, `grep -rn "@ptah-extension/git-ui"` across `libs apps` and keep anything imported externally.
- Verification seam: `git-dock.mount.spec.ts` with real header, source-control, file-view (fake Monaco) and markdown-block children:
  - a view tab opens in a non-git workspace;
  - a mixed diff + view strip with keyboard navigation works;
  - `.md` preview renders;
  - the blocked tab's Open In click issues `editor:openFile` with `scope: 'external-link'`.
- Files: MODIFY `.../git-ui/src/lib/git-dock/git-dock.component.ts`, `git-dock.component.spec.ts`, `git-dock.mount.spec.ts`, `services/editor-launcher.service.ts`, `services/editor-launcher.service.spec.ts`, `src/index.ts`.

#### Batch 8c — Link capture and routing

##### 8c.1 Markdown lib: parser, marked extension, interceptor port

- CREATE `libs/frontend/markdown/src/lib/file-link-target.ts`:

```ts
export interface MarkdownFileLinkTarget {
  path: string;
  line?: number;
  column?: number;
}
export function parseFileLinkHref(raw: string): MarkdownFileLinkTarget | null;
```

Rules, in order:

- Trim. Reject empty input, length > 4096, or C0 controls.
- `#…` or `?…` → `null` (in-page).
- A scheme is `^[A-Za-z][A-Za-z0-9+.-]*:` excluding a single-letter drive followed by `\` or `/`:
  - `file:` → `new URL()`; a host that is not empty and not `localhost` → return the target with the `//host/…` path, so the backend rejects it as `unsupported-path` and the click is still swallowed. Otherwise `decodeURIComponent(pathname)`, stripping a leading `/` before `X:`.
  - Any other scheme → `null`, leaving existing http/mailto behaviour.
- Protocol-relative `//host` → `null`; UNC `\\…` → target (backend rejects).
- Fragment `#L<n>(C<c>)?` or `#L<n>-L<m>` → line/column; any other fragment is stripped.
- Relative hrefs are `decodeURI`d; malformed escapes → keep raw.
- Trailing `:<line>(:<col>)?` is parsed from the string after any drive prefix, so `C:\x.ts:12:3` → `{ path: 'C:\\x.ts', line: 12, column: 3 }`. Line/column must be positive integers ≤ 10^7, otherwise not stripped.
- The result is a filesystem path string, never a URL.
- `marked-extensions.ts` adds `createFileLinkExtension()` to `getMarkedExtensions()` (`:335-343`):
  - `renderer.link(this, token: Tokens.Link)` returns `false` when `parseFileLinkHref(token.href)` is null.
  - Otherwise it emits `<a href="#" data-ptah-file-href="${escapeHtml(token.href)}" title="${escapeHtml(token.href)}" class="ptah-file-link">${parser.parseInline(token.tokens)}</a>`, with `parser` accessed the way `list` does at `:293-299`.
- CREATE `libs/frontend/markdown/src/lib/markdown-file-links.ts`:

```ts
export interface MarkdownFileLinkHandler {
  handleMarkdownFileLink(target: MarkdownFileLinkTarget, anchor: HTMLAnchorElement): void;
}
export const MARKDOWN_FILE_LINK_HANDLER = new InjectionToken<MarkdownFileLinkHandler>('MARKDOWN_FILE_LINK_HANDLER');
export function provideMarkdownFileLinks(): EnvironmentProviders; // provideEnvironmentInitializer
```

The initializer injects `DOCUMENT`, `MARKDOWN_FILE_LINK_HANDLER` and `DestroyRef`, and adds exactly one capture listener for `click` and one for `auxclick`, removed on destroy. The listener:

- ignores `button > 1`;
- `anchor = (event.target as Element | null)?.closest?.('a')`;
- requires `anchor.closest('markdown, [markdown]')` (A3) and `!anchor.closest('pre, code')`;
- takes `raw = anchor.getAttribute('data-ptah-file-href') ?? anchor.getAttribute('href')`;
- calls `parseFileLinkHref(raw)`; on a non-null target it calls `event.preventDefault()` and `handler.handleMarkdownFileLink(target, anchor)`.
- It does not call `stopPropagation`. A handler throw is caught and logged with `console.error`, and default navigation stays prevented.
- Installing twice is idempotent (module-level `WeakSet<Document>` guard) so "one listener" holds even if the provider is repeated.
- Barrel `src/index.ts` exports `parseFileLinkHref`, `MarkdownFileLinkTarget`, `MARKDOWN_FILE_LINK_HANDLER`, `MarkdownFileLinkHandler`, `provideMarkdownFileLinks`. `libs/frontend/markdown/CLAUDE.md`: "six extensions", the file-link section, and the rule that the data attribute is transport, not trust.
- Verification seam:
  - `file-link-target.spec.ts` covers the table of every form in the requirement plus `#L`, http, mailto, `#anchor`, `C:` alone, `a.ts:0`, and percent-encoding.
  - `marked-extensions.spec.ts` round-trips through the real permissive sanitizer options. The spec already mirrors them at `provide-markdown-rendering.spec.ts:191-224`; add a test that `data-ptah-file-href="C:\x.ts:12:3"` and `file:///…` survive while a raw `href="C:\x"` is stripped.
  - `markdown-file-links.spec.ts` renders real DOM inside a `<markdown>` element. It covers: one listener after N renders (spy `addEventListener`); a replaced `innerHTML` (streaming re-render) still intercepted; anchors in `pre`/`code` ignored; http passthrough (no `preventDefault`); `auxclick` with button 1; handler throw; and removal on destroy.
- Files: CREATE `.../libs/frontend/markdown/src/lib/file-link-target.ts`, `file-link-target.spec.ts`, `markdown-file-links.ts`, `markdown-file-links.spec.ts`; MODIFY `marked-extensions.ts`, `marked-extensions.spec.ts`, `provide-markdown-rendering.spec.ts`, `src/index.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/CLAUDE.md`.

##### 8c.2 Core port

- CREATE `libs/frontend/core/src/lib/tokens/file-link-opener.token.ts`:

```ts
export interface FileLinkOpenRequest {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly origin?: Element | null;
}
export interface IFileLinkOpener {
  open(request: FileLinkOpenRequest): Promise<void>;
}
export const FILE_LINK_OPENER = new InjectionToken<IFileLinkOpener>('FILE_LINK_OPENER');
```

Export from `core/src/index.ts`. DELETE `ClaudeRpcService.openFile` (`claude-rpc.service.ts:284-289`) and its spec case once 8c.3 and 8c.4 land; also remove the `FileOpenResult` import if it becomes unused.

- Files: CREATE the token; MODIFY `.../libs/frontend/core/src/index.ts`, `services/claude-rpc.service.ts`, `services/claude-rpc.service.spec.ts` (if it covers `openFile`).

##### 8c.3 `FileLinkRouterService` (chat) and link-context markers

- Purpose: turn a link click into an in-app view tab (Electron) or a native tab (VS Code), resolved against the originating context.
- Contract: `@Injectable({ providedIn: 'root' }) export class FileLinkRouterService implements IFileLinkOpener, MarkdownFileLinkHandler`. Injects `VSCodeService`, `ElectronLayoutService`, `TabManagerService`, `Injector`.
- Link-context DOM contract, written on Angular host bindings only:
  - `ChatTranscriptComponent` host `'[attr.data-ptah-tab-id]': 'tabId()'`;
  - `CompactSessionCardComponent` host `'[attr.data-ptah-tab-id]': 'tab().id'`;
  - `FileViewComponent` body `data-ptah-link-root` / `data-ptah-link-document` (8b.2).
- Context resolution: `start = origin?.closest('markdown, [markdown]')?.parentElement ?? origin`, so an agent-authored attribute inside rendered markdown can never be the match. Then `ctx = start?.closest('[data-ptah-link-document], [data-ptah-tab-id]')`.
  - `documentPath` = `data-ptah-link-document`; `workspaceRoot` = `data-ptah-link-root`.
  - Otherwise `workspaceRoot = tabManager.findTabByIdAcrossWorkspaces(tabId)?.workspacePath`.
  - Otherwise `vscode.config().workspaceRoot` (relay rail, tasks board, dashboard, setup wizard).
- `open()`:
  - **Electron** (`vscode.isElectron`): `layout.setEditorPanelVisible(true)` (`electron-layout.service.ts:176`; triggers the lazy dock load, `electron-shell.component.ts:388-397`). Then `const git = await import('@ptah-extension/git-ui')` (same pattern as `workspace-coordinator.service.ts:121-128`), `injector.get(git.GitReviewService).setMode('working-tree')`, and `await injector.get(git.DiffTabsService).openFileView({ path, line, column, workspaceRoot, documentPath })`. Root services exist before the dock mounts, so the tab is present when it renders.
  - **VS Code**: `rpcCall<FileOpenResult>(vscode, 'file:open', { path, line, column, workspaceRoot })`; the VS Code handler shows a native warning on failure (8a.4). `documentPath` has no VS Code producer.
  - Failures of the dynamic import are caught and logged with `console.error('[FileLinkRouter] …')`, never swallowed silently.
- `handleMarkdownFileLink(target, anchor)` → `void this.open({ ...target, origin: anchor })`.
- Composition root (`apps/ptah-extension-webview/src/app/app.config.ts`, near `:131-134` and `:266`): `{ provide: FILE_LINK_OPENER, useExisting: FileLinkRouterService }`, `{ provide: MARKDOWN_FILE_LINK_HANDLER, useExisting: FileLinkRouterService }`, `provideMarkdownFileLinks()`.
- Verification seam:
  - Router spec with a real DOM tree: a markdown anchor inside a transcript marked `data-ptah-tab-id` resolves the background-workspace root via a stubbed TabManager. An attribute injected inside `<markdown>` is ignored. A document context passes `documentPath`.
  - Electron branch: `setEditorPanelVisible(true)` + `setMode` + `openFileView` args (jest mock of `@ptah-extension/git-ui`). VS Code branch: RPC args including column.
  - Webview composition spec (`apps/ptah-extension-webview/src/app/`): both tokens resolve to the same router instance, and the markdown listener is installed exactly once.
- Files: CREATE `.../libs/frontend/chat/src/lib/services/file-link-router.service.ts`, `file-link-router.service.spec.ts`; MODIFY `chat/src/lib/services/index.ts` (export), `chat/.../organisms/transcript/chat-transcript.component.ts`, `chat/.../molecules/compact-session/compact-session-card.component.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-webview/src/app/app.config.ts`; CREATE `.../apps/ptah-extension-webview/src/app/file-link-wiring.spec.ts`.

##### 8c.4 FilePathLink and tasks board

- `FilePathLinkComponent`: replace `ClaudeRpcService` with `inject(FILE_LINK_OPENER)` + `ElementRef`; `openFile(event)` → `clicked.emit(event)`, then `void opener.open({ path: fullPath(), origin: host.nativeElement })`. The icon and JSDoc now say "opens in Ptah's viewer on desktop; native editor in VS Code". The chat-ui "no services" rule already has a `core`-injection exception for this atom (`file-path-link.component.ts:46`). This keeps the same single core dependency, swapped for a port.
- `TasksStore.openArtifact` (`tasks-store.service.ts:1351-1368`): `await inject(FILE_LINK_OPENER).open({ path: absPath })`; the error signal is set only when the opener rejects.
- Verification seam: FilePathLink spec provides a fake opener and asserts a rendered click passes `origin` and the path. Tasks store spec asserts the opener call.
- Files: MODIFY `.../libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts`, `file-path-link.component.spec.ts`, `.../libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts` and its spec.

##### 8c.5 Electron e2e

CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts` (`describe('agent file links')`), at the fixture window with assertions `[1200,800]` and dock 700 ±1:

1. Seed a canvas chat tile (existing `session-seed.ts` / `ui.goto('chat')`) whose assistant markdown contains `[a](src/a.ts:12:3)`, `[b](C:\\ptah-e2e-ws\\docs\\readme.md)`, `` `src/inline.ts:4` `` and `[c](https://example.com)`. Mock `file:viewContent` per path.
2. Click `a` with the dock hidden: the dock opens, a tab `a.ts` is active, Monaco shows line 12 selected, and the observed `file:viewContent` call carries `workspaceRoot: 'C:\\ptah-e2e-ws'`. The window URL is unchanged.
3. Click `b`: preview renders a heading; toggle Source and Monaco is visible.
4. Inline code is not an anchor. The http link issues no `file:viewContent` call and the window URL is unchanged.
5. Mock an `outside-roots` result with `externalOpenAllowed: true`: the alert text is visible; clicking Open In issues `editor:openFile` with `scope: 'external-link'`.
6. A tool-call header FilePathLink click opens a tab.
7. `mainWindow.reload()` completes and the dock state restores (proves D10 plus A6/A7).

No window or dock resizing.

### A.5 Integration architecture

- **Data flow (Electron)**:
  1. The agent's markdown goes through marked plus the file-link extension, producing `data-ptah-file-href` before sanitization.
  2. DOMPurify keeps the `data-*` attribute; `href="#"` is safe.
  3. The user clicks; the document capture listener → `MARKDOWN_FILE_LINK_HANDLER` → `FileLinkRouterService` resolves context from the DOM marker to the TabManager partition root.
  4. `ElectronLayoutService.setEditorPanelVisible(true)` → dynamic git-ui → `GitReviewService.setMode` → `DiffTabsService.openFileView` → `FileViewReaderService`.
  5. `rpcCall('file:viewContent')` → `RpcHandler` (`file:` prefix) → `FileViewRpcHandlers` → Zod → `FileLinkRootPolicy` (form gate → hint authorization → lexical → worktrees → realpath → stat) → bounded read → decode → typed result.
  6. `FileViewComponent` renders Monaco read-only, or the markdown preview through `MarkdownBlockComponent`.
     FilePathLink and tasks enter at step 3 via `FILE_LINK_OPENER`.
- **Data flow (VS Code)**: steps 1-3, then `rpcCall('file:open', {path, line, column, workspaceRoot})` → VS Code `FileRpcHandlers` → schema → `FileLinkRootPolicy` → `showTextDocument` + selection.
- **State**: rail width and collapse live in `ElectronLayoutService`, persisted per renderer. View tabs live in the `DiffTabsService` renderer-lifetime tab list and are not persisted (consistent with diff tabs). Worktree lists are not cached; they are computed only on a lexical miss.
- **External boundaries and trust**: every renderer-supplied path and root is untrusted and Zod-validated. Roots are authorized against `IWorkspaceProvider.getWorkspaceFolders()` plus `git worktree list` of those roots. Network/device/ADS forms are refused before any fs or git call. Symlink escape is refused by the realpath re-check. Size is capped at 2 MiB for the viewer (512 KiB for preview). Binary and non-UTF text are refused. Markdown is sanitized once, at the existing chokepoint. Electron main refuses `file:` navigation other than same-document.
- **Failure and rollback**: the RPC never rejects on policy; the tab shows `blocked`/`error` with retry or external open. A dynamic import failure is logged and the dock stays as it was. A drag interruption restores the pre-drag width. Detection failure shows an error and retries on the next mount.
- **Observability**: backend rejections go to `logger.warn` with a reason code only. Frontend router and interceptor failures go to `console.error` with a `[FileLinkRouter]` / `[MarkdownFileLinks]` prefix. E2E observed-call recording (`ui.getObservedCalls`) proves routing.

### A.6 Security analysis summary

| Threat                                                                               | Control                                                                                             | Where               |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------- |
| `..` traversal                                                                       | resolve then lexical containment                                                                    | 8a.2 steps 3-4      |
| Symlink/junction escape                                                              | realpath target within realpath roots                                                               | 8a.2 step 5         |
| UNC `\\server\share`, `//server`, `file://host/` (SMB/NTLM leak)                     | lexical form gate before any fs/git call; UNC realpath refused; spec spies prove no fs call         | 8a.2 step 1, 5      |
| Device `\\?\`, `\\.\`, FIFO, `/dev/*`                                                | form gate + `stat.isFile()`; external-open roots exclude system dirs                                | 8a.2 steps 1, 6; D8 |
| Windows ADS `a.ts:stream`, drive-relative `C:x`, root-relative `\x` (cwd dependence) | form gate                                                                                           | 8a.2 step 1         |
| Renderer-forged root                                                                 | hint must be a registered root, within one, or a worktree of one                                    | 8a.2 step 2         |
| Large file / memory                                                                  | stat cap + bounded read (`maxBytes + 1`)                                                            | 8a.2 step 6, 8a.3   |
| Binary / non-UTF-8                                                                   | BOM detection, NUL heuristic, fatal `TextDecoder`                                                   | 8a.3                |
| Error leakage                                                                        | fixed message table, no raw `error.message`, no realpath                                            | 8a.3, 8a.4          |
| XSS via previewed file / agent markdown                                              | single DOMPurify chokepoint; no `[innerHTML]`; URI allowlist unchanged                              | 8b.2, D6            |
| Agent-authored `data-ptah-file-href` or context attributes                           | data attribute is transport only; context lookup starts outside `<markdown>`; backend re-authorizes | D6, 8c.3            |
| Window replacement by `file:` navigation                                             | same-document-only navigation policy                                                                | 8a.5                |
| Streaming re-render drops handlers                                                   | document-level delegate independent of rendered nodes                                               | 8c.1                |

### A.7 Acceptance criteria (continuing from 14)

15. At 1200×800 with the 700 px dock, the rendered rail toggle collapses and expands the source-control rail; the diff/file pane fills the freed width; the toggle is absent in branch-review mode, and the review rail is unaffected.
16. Dragging the rail separator clamps to 160-480 px and never leaves the right pane under 12rem. Escape, pointer cancel and window blur restore the pre-drag width. ArrowLeft/ArrowRight resize by 16 px.
17. Rail width and collapsed state persist across a renderer reload through the `electron-layout` state; malformed persisted values fall back to defaults.
18. A failed, `success:false` or malformed `editor:detectTargets` result renders a detection-error state, leaves every file row rendered, and a later dock mount retries detection.
19. On Electron, clicking an agent markdown link opens a read-only Git dock tab at the correct line and column. This holds in a message bubble, execution node, agent card, thinking block or compact card, and for relative, POSIX absolute, drive-letter (`C:\x.ts:12:3`), `file://`, `path:line[:col]` and `#L<n>` forms. The dock opens if hidden, the window does not navigate, and exactly one document listener exists regardless of message count or streaming re-renders.
20. Anchors inside `pre`/`code`, and `http`/`https`/`mailto` links, keep their existing behaviour; bare `path:line` text and inline code are not linkified.
21. FilePathLink (tool-call header, diff-display header, tribunal relay rail) and tasks-board artifact links open in the Electron viewer; `ClaudeRpcService.openFile` no longer exists.
22. A relative link resolves against the originating tab's workspace, including a background workspace; a relative link inside a previewed markdown document resolves against that document's directory.
23. `.md`, `.markdown` and `.mdx` open preview-first through `MarkdownBlockComponent`; Source shows read-only Monaco; there is no `[innerHTML]` and no second sanitizer; preview is disabled above 512 KiB with a visible note.
24. `file:viewContent` rejects traversal, outside-root paths, symlink/junction escape, UNC and device forms (with no fs call), ADS and drive-relative forms, directories, files over 2 MiB, binary and non-UTF text, and unregistered base roots. It accepts worktrees of registered roots and returns only sanitized error copy.
25. An outside-root link shows a visible message; Open In appears only when `externalOpenAllowed`; the launch issues `editor:openFile` with `scope: 'external-link'`, and the backend refuses system, device and UNC targets under that scope.
26. In VS Code, links call `file:open` with line and column, relative paths resolve only under an authorized root, and UNC paths are refused before stat; `file:viewContent` is excluded on VS Code, CLI and TUI surfaces.
27. Electron main cancels agent `file:` navigations, does not hand them to `shell.openExternal`, still opens http(s) externally, and a renderer reload still loads.
28. `file:viewContent` is present in the RPC registry, method-name map, manifest (`fileViewer`) and Electron profile; manifest invariant, allowlist and host-surface specs pass.
29. Electron e2e `git source-control rail` and `agent file links` pass at the default window and dock without resize helpers.
30. Lint, typecheck and unit targets for the affected projects, plus the e2e greps, pass with the Nx header confirming the requested project count.

### A.8 Team-leader handoff

- **Recommended executors**:
  - Batch 7 — Codex CLI. Contained Angular port of a known drag implementation into files Codex authored in Batches 4-6. Fallback: the frontend-developer subagent.
  - Batch 8a — backend-developer subagent. The security-ordered path policy and Node fs semantics (realpath, junctions, ADS) benefit from careful reasoning. Cross-vendor logic review by Codex or Antigravity.
  - Batch 8b — Codex CLI. Monaco lifecycle and `DiffTabsService`/dock files are Batch 4 Codex territory.
  - Batch 8c — frontend-developer subagent. Cross-library DI ports, lint-scope constraints and sanitizer round-trip tests. Style review by ptah-cli Ollama Cloud or Antigravity; visual review by the visual-reviewer after 8c.
- **Complexity**: HIGH overall. Batch 7 is MEDIUM (UI state plus persistence plus e2e). 8a is HIGH (security policy, three hosts, manifest). 8b is MEDIUM-HIGH (Monaco lifecycle, mixed tab model). 8c is HIGH (cross-lib ports, DOM delegation, routing both platforms).
- **Dependencies and ordering (component level)**: 8a.1 contracts before any 8b/8c code that imports them. 8b.3 depends on Batch 7's `git-dock.component.ts` and `editor-launcher.service.ts` edits. 8c.3 calls the 8b.1 `DiffTabsService.openFileView` and 8b.3 barrel. 8c e2e runs last. The `ClaudeRpcService.openFile` deletion lands only with its last caller migration (8c.4).
- **Parallel-safe work**: Batch 7 ∥ Batch 8a (file-disjoint). 8c.1 (markdown lib) and 8c.2 (core token) are file-disjoint from 8b and may run alongside it; 8c.3-8c.5 wait for 8b. No batch edits a `project.json`, so `nx reset` is not needed.
- **File-overlap matrix**:

| File                                                                                                                                                                                                     |  7  | 8a  | 8b  | 8c  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | :-: | :-: | :-: |
| `git-ui/.../git-dock/git-dock.component.ts` (+ `.spec`, `.mount.spec`)                                                                                                                                   |  ✔  |     |  ✔  |     |
| `git-ui/.../services/editor-launcher.service.ts` (+ `.spec`)                                                                                                                                             |  ✔  |     |  ✔  |     |
| `git-ui/.../git-dock/git-dock-header.component.ts` (+ `.spec`)                                                                                                                                           |  ✔  |     |     |     |
| `core/.../electron-layout.service.ts` (+ `.spec`)                                                                                                                                                        |  ✔  |     |     |     |
| `libs/shared/.../rpc.types.ts`, `rpc-misc.types.ts`, `rpc-editor.types.ts`                                                                                                                               |     |  ✔  |     |     |
| `rpc-handlers` handlers / host-profile / index; `cli-engine` expected-absent; Electron and VS Code app handler/profile/spec; `apps/ptah-electron/src/windows/*`                                          |     |  ✔  |     |     |
| `git-ui` types, diff-tabs, reader, file-view, monaco-theme, diff-view, index, CLAUDE.md                                                                                                                  |     |     |  ✔  |     |
| `markdown/**`, `core/.../tokens/file-link-opener.token.ts`, `core/src/index.ts`, `claude-rpc.service.ts`, `chat/**`, `chat-ui/.../file-path-link*`, `tasks-ui/.../tasks-store*`, `webview/app.config.ts` |     |     |     |  ✔  |

- **Files affected**:
  - CREATE:
    - `git-ui/.../git-dock/rail-resize-handle.component.ts` (+ `.spec`); `apps/ptah-electron-e2e/src/specs/git/git-rail-collapse.spec.ts`.
    - `rpc-handlers/.../handlers/workspace-file-path.spec.ts`, `file-link-root-policy.ts` (+ `.spec`), `file-view-rpc.handlers.ts` (+ `.spec`), `file-view-rpc.schema.ts`; `apps/ptah-extension-vscode/.../file-rpc.handlers.spec.ts`; `apps/ptah-electron/src/windows/navigation-policy.ts` (+ `.spec`).
    - `git-ui/.../services/file-view-reader.service.ts` (+ `.spec`), `git-ui/.../file-view/file-view.component.ts` (+ `.spec`), `git-ui/.../services/monaco-theme.ts` (+ `.spec`).
    - `markdown/.../file-link-target.ts` (+ `.spec`), `markdown/.../markdown-file-links.ts` (+ `.spec`); `core/.../tokens/file-link-opener.token.ts`; `chat/.../services/file-link-router.service.ts` (+ `.spec`); `apps/ptah-extension-webview/src/app/file-link-wiring.spec.ts`; `apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts`.
  - MODIFY: every file named in A.4 component file lists.
  - DELETE: none as files. `ClaudeRpcService.openFile`, `main-window.ts` `isInternalNavigation`/`EXTERNAL_SCHEMES`, and the internal git-ui barrel exports are removed as symbols.
- **Verification commands** (from the worktree; confirm the Nx header count):

```powershell
npx nx run-many -t lint typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/core @ptah-extension/git-ui @ptah-extension/markdown @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/tasks-ui ptah-electron ptah-extension-vscode ptah-extension-webview ptah-electron-e2e --parallel=1
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/core @ptah-extension/git-ui @ptah-extension/markdown @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/tasks-ui ptah-electron ptah-extension-vscode ptah-extension-webview
npx nx e2e ptah-electron-e2e -- --grep "git source-control rail|agent file links|Git dock|historical branch review controls|in-editor hunk action widget|hunk revert dialog"
git diff --check
```

Project names must match each `project.json` `name` (for example `ptah-electron` and `ptah-extension-vscode` for apps). The team-leader verifies each name before the first run, because a misspelled name is silently dropped.

- **Rebase conflicts against `main`** (read-only: `git log --oneline 712478de8..main -- <paths>`, run 2026-09-11):
  - Every file Batches 7-8 create or modify has **zero** main-only commits. Checked: `libs/frontend/{git-ui,markdown,chat-ui,tribunal-panel,tasks-ui,chat-streaming}`, `electron-layout.service.ts`, `apps/ptah-electron/src/windows`, `apps/ptah-electron/src/rpc-host-profile.ts`, `libs/backend/rpc-handlers/src/lib/host-profile`, `apps/ptah-extension-webview/src/app`.
  - The `libs/frontend/chat` hits (`cdab18267`, `4f806f210`, `c7d64c7b8`, `ab298c128`) touch `electron-shell.component.ts`, `app-shell.component.ts` and `message-sender*`, none of which this addendum edits.
  - `libs/shared/src/lib/types` hits (`9b08510ab`, `24d42041c`, `542ba4e99`, `1ef1d40f1`) touch `messages/memory.ts` and `task-spec.contract*`, not the three RPC type files edited here.
  - `rpc-handlers/handlers` hit `d2ec27603` touches only `tasks-rpc.handlers.spec.ts`.
  - `e1585fad9` (FilePathLink → `file:open`) is already an ancestor of base `712478de8`, so it causes no conflict.
  - Pre-existing Batch 1-6 conflict, outside this addendum: `0caa52f27` edits `libs/backend/vscode-core/src/services/git-info.service.ts` and `.spec.ts`, which Batches 1-5 heavily modified. It also edits `apps/ptah-extension-vscode/src/rpc-host-profile.ts` (2 lines), which Batch 8a does not modify.
  - Recommended timing: rebase once, after Batches 1-6 are committed (when commits are authorized) and before Batch 8a's verification run. That confines the `git-info.service.ts` resolution to Batch 1 context and gives `nx affected` a current base. Batches 7-8 need no mid-flight rebase.

- **Follow-ups (not in scope)**:
  - Containment, schema and cap for legacy `file:read`.
  - Column support in `IEditorLauncher` adapters.
  - Linkifying bare `path:line` text.
  - Agent-cwd-aware base for subagent worktree links (A9).
  - Renaming `diffTabs`/`activeDiffKey` to dock-tab names.
  - Dock visibility restore on restart (already recorded in `context.md`).
  - Git-bash `/d/...` path mapping on Windows.
  - `code-style-review.md` findings 1 and 4.
