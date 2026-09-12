# TASK_2026_413 implementation report

## Outcome

All six implementation batches are present on `fix/git-review-controls`. No commit, push, PR, hook bypass, package upgrade, or destructive Git operation was performed. The two legacy Electron Git dock failures are root-caused and fixed, and every requested Batch 6 gate is green; see `test-report.md`.

## Dependency preparation

- Ran `npm ci --no-audit --no-fund` from the existing lockfile in this worktree only; 2,982 pinned packages were installed and no dependency version or lockfile changed.
- The repository postinstall rebuilt `better-sqlite3` for Electron ABI 143 and patched this worktree's installed transformers metadata to the already pinned ONNX runtime. Shared checkout dependencies and the shared Nx daemon were not modified or reset.

## Source changes

### Batch 1 - read-only historical Git review

- Added strict shared/RPC contracts for `git:reviewChanges` and `git:reviewFile` without extending the mutable `GitDiffComparison` contract.
- Implemented PR-style `merge-base(base, head)..head` comparison, immutable resolved SHAs, NUL-safe name-status/numstat parsing, per-file/totals accounting, and explicit unknown counts for binary or unreadable content.
- Added repository-issued review authorization keyed by workspace and resolved SHA pair, plus path membership/containment checks before historical content reads. SHA-shaped client input alone is never treated as authorization.
- Added current staged/worktree numstat enrichment, including known text counts for readable untracked files.

### Batch 2 - safe external editor launching

- Added Kiro across the closed target union, Zod schemas, platform adapters, and verified detection. Detection is PATH-only (`kiro`); no guessed installation path is accepted.
- Added one shared workspace-file resolver for editor and legacy file-open handlers. Relative paths require a registered workspace root, must remain inside it after resolution, and must resolve to a file.

### Batch 3 - branch/review state

- Added signal-based editor launcher and historical review services, safe branch picker/details controls, and per-workspace review selection/cache state.
- Added searchable historical changed-file tree, numstat presentation, and viewed state partitioned by workspace, resolved base SHA, resolved head SHA, and path.
- Checkout remains non-force-first; dirty-tree force checkout requires an explicit warning confirmation. Push, checkout, and launch failures are surfaced in the mounted UI.

### Batch 4 - mounted UI and diff safety

- Mounted branch controls, workspace/file Open In controls, working-tree stats, historical toolbar/panel, expandable Monaco diffs, and viewed toggles in the real dock composition.
- Added required diff provenance. Mutable staged/worktree tabs retain hunk actions; historical tabs have no mutation callback and the diff view also guards against mutation by provenance.
- Kept Monaco. Made the content hunk widget narrow-width-safe with icon controls and hidden accessible labels, and synchronized it after Monaco modified-editor layout changes.
- Added real-child header/dock mount tests; only the actual RPC and Monaco boundaries are substituted.

### Batch 5 - host coordination and real-app proof

- Included review state in workspace switch/removal coordination and added webview root-identity coverage.
- Added a real Electron click-flow for review mode, branch selectors, searchable file expansion, Monaco diff opening, viewed state, Open In, and branch checkout.
- Removed E2E window-widening workarounds from hunk tests and asserted the real BrowserWindow remains 1200x800.

## Conservative scope decisions

- Historical mode has no stage, discard, apply-hunk, commit, push, checkout, merge, or PR actions.
- Responsive historical layout moves the summary below the tree at 520px rather than hiding it behind an unreachable breakpoint.
- The existing working-tree tree builder remains isolated from the historical searchable tree; no new dependency or general-purpose abstraction was introduced.
- No IDE replacement, terminal, CodeMirror, task binding, merge, or PR expansion was added.

## Batch 6

### Regression classification

Both failures are Batch 1-5 regressions, not pre-existing defects. A detached worktree at base `712478de8` reused this worktree's lockfile-identical `node_modules` through a temporary directory junction. Running only `CX:120|opens, switches, and closes independent diff tabs` exited 0 in 120.1s. The temporary worktree `D:/projects/ptah-extension/.claude/worktrees/tmp-413-base` and its junction were removed immediately afterward.

### Root cause

The shared mocked Electron fixture did not define the newly mounted `editor:detectTargets` RPC. `GitDockComponent` starts editor detection at `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:177`, and `EditorLauncherService` assigns the contract field at `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:45`. The generic fake-RPC fallback returned an unrelated namespace object, so the assigned target list was `undefined` rather than the contract-required array.

The first mounted `OpenInButtonComponent` then evaluated `targets().length` at `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:46`. That runtime exception aborted Angular rendering after the first file row, explaining why `a.ts` appeared but `c.ts` did not. The same aborted render cycle prevented the diff view's `afterNextRender` callback at `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:1093` from completing Monaco initialization, explaining the persistent `Loading diff editor...` state. The two symptoms therefore had one fixture-contract root cause; neither the working-tree builder, diff provenance, nor Monaco loader required a product change.

### Fix and regression coverage

- `apps/ptah-electron-e2e/src/support/fixtures.ts:11` now defines a `satisfies EditorDetectTargetsResult` empty-target response and registers it as the default at line 107. This models the real supported state where no external editor is detected and makes future required contract drift a typecheck failure.
- `libs/frontend/git-ui/src/lib/git-dock/git-dock.mount.spec.ts:115` mounts the real dock/source-control/Open In children with zero detected targets and two changed files, asserting both rows survive.
- `apps/ptah-electron-e2e/src/specs/git/git-review-controls.spec.ts:3` uses the prescribed `historical branch review controls` label so the requested grep actually selects all five review/hunk scenarios.

An initial post-fix full dock run proved both target scenarios green but had one unrelated `electronApplication.firstWindow` startup timeout before the first scenario body; the exact full command was rerun and passed 5/5. No timeout or window-size workaround was added.

## Batch 6R

### Accepted review fixes

- Malformed editor detection is now fail-closed. `EditorLauncherService.detect()` narrows `targets` at `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:45`; a success envelope without an array clears targets and records a detection error at line 51. The real-child mount regression at `git-dock.mount.spec.ts:130` proves both file rows and the diff surface still render for `{ success: true, data: {} }`.
- Historical review is extracted into `GitReviewReaderService` (`libs/backend/vscode-core/src/services/git-review-reader.service.ts:45`). `GitInfoService` retains its public signatures and delegates at `git-info.service.ts:437-450`; invalidation also delegates at line 316. Because `GitInfoService` is manually constructed across all three hosts, the optional plain collaborator is constructed by the facade at lines 254-271 and adds no DI token or composition-root manifest entry.
- Issued comparison/path authorization is bounded by the repo-precedent 256-entry LRU (`git-review-reader.service.ts:19,243-254`). Evicted pairs receive the fixed sanitized authorization error, while a subsequent `reviewChanges` re-issues the pair. `git-review-reader.service.spec.ts:50-116` pins eviction, refusal before blob reads, and re-issuance.
- Historical name-status/numstat drift logs only `nameStatusCount` and `matchedNumstatCount` while still returning results (`git-review-reader.service.ts:134-151`). The crafted mismatch test at `git-review-reader.service.spec.ts:17-48` also asserts that file names do not enter the warning.
- The only workspace-removal entry point is `WorkspaceCoordinatorService.removeWorkspaceState()` at `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:287`; it iterates every resolved Git service at lines 293-296. The real-singleton regression at `workspace-coordinator.service.spec.ts:911-921` explicitly includes `GitReviewService.removeWorkspaceState`. No additional removal path required a product change.
- Workspace file-path coverage now lives beside the helper in `workspace-file-path.spec.ts:21-123`: registered/unregistered roots, missing root for a relative path, traversal, absolute outside paths, Windows drive-case matching, UNC and extended-length inputs, directory rejection, and missing/unreadable files. The unresolved realpath/symlink escape is deliberately recorded for Batch 8a and was not changed here.
- Unfiltered local and remote branch lists now sort by descending `lastCommitTime` and cap independently at ten; a non-empty search remains unbounded (`branch-picker-dropdown.component.ts:129-155`). The rendered 12-per-group regression test is in `branch-picker-dropdown.component.spec.ts:37-89`.
- A workspace-wide `apps/` + `libs/` search found no consumers outside git-ui for the seven exports formerly at `libs/frontend/git-ui/src/index.ts:33-39`; those branch/review components and changed-tree helpers are no longer public API.
- The dock Open In test now emits the rendered child output (`git-dock.component.spec.ts:258-273`) instead of calling a protected method through `as unknown`. Historical review specs use explicit success narrowing at `git-info.service.review.spec.ts:53-55,115-117`. The dock JSDoc now accurately records header ownership at `git-dock.component.ts:38-39`.

### Declined findings

- The two file-tree builders remain separate. `source-control-panel.component.ts:46` builds the mutable staged/unstaged tree, while `changed-file-tree.ts:19` builds the searchable immutable historical-review tree. Their state and interaction contracts differ, so merging them would couple intentionally isolated concerns without fixing a demonstrated defect.
- Multi-candidate merge-base handling was not added. The invocation is plain `git merge-base <base> <head>` without `--all` at `git-review-reader.service.ts:84-88`; Git returns one best ancestor for that form, so the proposed multi-line output cannot occur.
- No CRLF-counting comment was added. The current-change untracked counter already handles CRLF, CR, LF, and a terminal newline explicitly at `git-info.service.ts:2416-2417`; a comment-only edit would not improve behavior or coverage.

### Verification note

The first unbounded-parallel four-project Jest run saturated Windows process resources and timed out unrelated setup, voice, and real-git tests. The same required four-project gate passed unchanged with Nx `--parallel=1`; no product timeout was raised. All final gates and exact counts are in `test-report.md`.

## Batch 8c-1

Status: implemented, verification pending (phase 1 ran no Nx, Jest or build command because Batch 6R held the worktree).

### Files

- CREATED `libs/frontend/markdown/src/lib/file-link-target.ts`: `parseFileLinkHref`, `MarkdownFileLinkTarget`, and the internal `MARKDOWN_FILE_HREF_ATTR`.
- CREATED `libs/frontend/markdown/src/lib/file-link-target.spec.ts`: the R6 table (relative, POSIX, drive, UNC, `file://`, `#L` forms, line edge cases, non-file schemes, C0 and length).
- CREATED `libs/frontend/markdown/src/lib/markdown-file-links.ts`: `MARKDOWN_FILE_LINK_HANDLER`, `MarkdownFileLinkHandler`, `MARKDOWN_FILE_LINKS_OPT_IN_ATTR`, `provideMarkdownFileLinks()`.
- CREATED `libs/frontend/markdown/src/lib/markdown-file-links.spec.ts`: real DOM listener spec.
- MODIFIED `libs/frontend/markdown/src/lib/marked-extensions.ts`: sixth extension, `createFileLinkExtension()`.
- MODIFIED `libs/frontend/markdown/src/lib/marked-extensions.spec.ts`: count 6, renderer cases, attribute escaping.
- MODIFIED `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`: `data-ptah-file-links` added to the permissive `FORBID_ATTR`. This tightens the list; `ALLOWED_URI_REGEXP`, `FORBID_TAGS` and `ALLOW_DATA_ATTR` are unchanged.
- MODIFIED `libs/frontend/markdown/src/lib/provide-markdown-rendering.spec.ts`: round trip through the shipped `'full'` link renderer and shipped sanitizer (not the mirrored options). The mirror gains the same `FORBID_ATTR` entry.
- MODIFIED `libs/frontend/markdown/src/index.ts`, `libs/frontend/markdown/CLAUDE.md`.
- CREATED `libs/frontend/core/src/lib/tokens/file-link-opener.token.ts`: `FileLinkOpenRequest`, `IFileLinkOpener`, `FILE_LINK_OPENER`. No default provider.
- MODIFIED `libs/frontend/core/src/index.ts`: token exports.

### Assumption checks

- A2 (raw href): marked 17.0.6 `Tokenizer.link` passes `href` with only angle brackets and CommonMark backslash escapes removed (`anyPunctuation` replace, `node_modules/marked/lib/marked.esm.js`). `encodeURI` happens only inside the default `Renderer.link`, which the extension replaces. No `decodeURI` is needed before parsing. The parser percent-decodes anyway, and `file-link-target.spec.ts` pins `src/a%20b.ts`. A spec against real `marked` was not added: the package resolves only to `lib/marked.esm.js`, which this lib's `transformIgnorePatterns` does not transform.
- A3 (host element): ngx-markdown 21.3.0 writes `this.element.nativeElement.innerHTML = parsed` (`fesm2022/ngx-markdown.mjs:528`) on the component whose selector is `markdown, [markdown]` (`:622`). Extensions are applied through `marked.use(...this.extensions)` (`:251`).
- DOMPurify 3.4.5: `FORBID_ATTR` is checked before `ALLOW_DATA_ATTR` (`purify.es.mjs:1163`), so the opt-in marker is stripped from content. Other `data-*` names skip the URI check (`:1175`).

### Decisions

- Scheme versus file name: a `name:` prefix is a URL scheme when the name is listed (`http`, `mailto`, `tel`, `javascript` ...), is a single letter (drive-relative), or is dotless and followed by something other than a position. `a.ts:12`, `a.ts:stream` and `Makefile:7` are files. `C:` and `c:foo` return `null`. Without this rule, `x.ts:12` matches the RFC scheme grammar and the plan's rule order would drop every `path:line` link.
- Percent-decoding uses `decodeURIComponent` for relative, drive and file-URL paths, so `%23` becomes `#`. A malformed escape keeps the raw value.
- Listener install is ref-counted per `Document` (the plan says `WeakSet`), so destroying one of two installers does not remove the other's interception. The first installer's handler serves clicks.
- `MarkdownFileLinkHandler.handleMarkdownFileLink` returns `void | Promise<void>`. A rejection is logged like a throw, so 8c-2's async router does not produce unhandled rejections.
- The `pre`/`code` exclusion applies only to a code ancestor inside the matched host.
- The rendered `title` is the link target, as the plan specifies; an author-supplied markdown title is not kept.

### Not done here (8c-2 or follow-up)

- No consumer wiring, context markers, router or composition-root binding.
- `libs/frontend/core/CLAUDE.md` still lists three token files; it is outside this batch's file list.
- The sanitizer strips only the opt-in marker. The 8c-2 context attributes (`data-ptah-tab-id`, `data-ptah-link-root`, `data-ptah-link-document`) still survive in content. The router design already starts its lookup outside `<markdown>`; adding them to `FORBID_ATTR` would be extra defence in depth.

### Phase 1 checks

- `ptah_get_diagnostics` scoped to the 11 changed TS files: no diagnostic in any new or changed line. The tool reports 101 errors from other files: core `*.spec.ts` / `src/testing/*`, plus one older cast at `marked-extensions.spec.ts:135`. It uses a stricter program than the spec tsconfig. Treat them as a baseline to confirm in phase 2.
- `git diff --check -- libs/frontend/markdown libs/frontend/core/src/index.ts`: clean.

## Batch 7

Status: complete.

The working-tree Git dock now has a collapsible and resizable source-control rail while historical review keeps its existing full-width composition. `GitDockComponent` binds the rail to persisted layout signals and mounts its resize separator at `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:72-99`. `GitDockHeaderComponent` supplies the keyboard-operable toggle with `aria-controls` and `aria-expanded` at `git-dock-header.component.ts:48-65`; the control is deliberately absent in historical-review mode.

`ElectronLayoutService` owns the 256 px default, 160-480 px clamp, and collapse state at `libs/frontend/core/src/lib/services/electron-layout.service.ts:65-79,188-201`. Both values are written into the existing Electron layout envelope at lines 592-593 and restored with type checks and width clamping at lines 613-632. Live pointer motion updates only the signal, while pointer completion and keyboard resizing commit persistence, avoiding an RPC write per mousemove.

The new internal `RailResizeHandleComponent` (`libs/frontend/git-ui/src/lib/git-dock/rail-resize-handle.component.ts:34`) is an accessible separator supporting pointer capture, Arrow keys, Home/End, Escape cancellation, blur/lost-capture recovery, animation-frame coalescing, and listener cleanup. Unit coverage includes the layout defaults/restore/malformed-state cases, toggle accessibility and review-mode absence, real-child collapse rendering, resize limits and persistence, multi-pointer rejection, cancellation paths, and cleanup.

The Electron scenario at `apps/ptah-electron-e2e/src/specs/git/git-rail-collapse.spec.ts:103-164` uses the unchanged 1200x800 window and nominal 700 px dock. It collapses and expands the rail, drags it from 256 px to 200 px within the prescribed range, persists a collapsed state, restarts the app with the same profile/database, then proves both the collapsed state and 200 px width restore. It also renders two file rows and a real diff with a malformed editor-target response, retaining the Batch 6R guard coverage.

The first rail e2e draft measured 487 px because the independent workspace sidebar was still open beside the 700 px dock. The fixture now closes that sidebar through its rendered accessible toggle before asserting the dock geometry; neither the BrowserWindow nor the configured dock width is changed. No timeout was raised. Batch 8 file-view, link-routing, markdown, backend, and navigation-guard behavior was not implemented or modified by this batch.

## Batch 8a

Status: complete.

### Contracts (8a.1)

`FileOpenParams` gains `column?`, `EditorOpenFileParams` gains `scope?: 'workspace' | 'external-link'`, and `rpc-misc.types.ts` adds `FileViewFailureReason`, `FileViewContentParams`, `FileViewContentResult` and `FILE_VIEW_MAX_BYTES` (2 MiB). `file:viewContent` is registered in both halves of the dual-registration contract: the `RpcMethodRegistry` entry and the `RPC_METHOD_ENTRIES` map. The `file:` prefix was already in `ALLOWED_METHOD_PREFIXES`, so no runtime-guard change was needed.

### Ordered path policy (8a.2, 8a.3)

`resolveLinkedFilePath` in `workspace-file-path.ts` implements the plan's ordered algorithm, and the order is documented in the file as contractual rather than incidental:

1. `checkLinkedPathForm` runs before any filesystem or git call. It rejects NUL/C0/DEL, any leading `\\` or `//` (UNC, `\\?\`, `\\.\`), and — on win32 only — drive-relative (`C:foo`), root-relative (`\foo`) and alternate data streams (a colon anywhere but index 1). The colon rules are win32-only deliberately: a colon is a legal character in a POSIX file name.
2. Base selection from `documentPath`, then `workspaceRoot`; an unauthorized hint is `root-not-open`, and a relative path with no base is `no-base-root`. `process.cwd()` is never consulted.
3. Lexical containment against registered roots, widened to worktrees **lazily** and at most once, only on a miss.
4. **Realpath containment re-checked after resolution.** A junction resolving to UNC, or any realpath outside the authorized set, is `outside-roots` **without** `lexicalPath` — that omission is what makes `externalOpenAllowed` false, so a symlink escape is never disclosed and never offered for external open.
5. `stat` for kind and size; non-regular files (FIFO, socket, device) are `not-a-file`.

`FileLinkRootPolicy` supplies the roots. `resolveForView` authorizes open folders plus their worktrees at the 2 MiB cap; `resolveForExternalOpen` adds realpath'd `homedir`/`tmpdir` with no cap, minus `CREDENTIAL_DENY_LIST`. `listWorktrees` drops UNC entries so a checkout on a share cannot re-authorize the form the gate refuses.

The deny-list covers the required directories, files, Windows credential stores and basename patterns, and is checked on **both** the lexical and the real path. Ptah's own secret-envelope store is `~/.ptah/secrets.enc.json`, located at `libs/backend/settings-core/src/encryption/secrets-file-store.ts:4` and denied as `.ptah/secrets.enc.json`.

**Deliberate scope of the deny-list (R1):** it guards the home/temp _widening_ only, per `batches.md` 8a.3. A `.env` inside a registered workspace root stays openable — the agent can already read it there, so refusing would break a normal workflow while protecting nothing. Pinned by a test.

### Contained read (8a.4)

`FileViewRpcHandlers` serves `file:viewContent` behind a new `fileViewer` capability with a `.strict()` Zod schema capped at 4096 characters per field. The read opens the realpath, reads at most `maxBytes + 1` bytes and closes in `finally`; exceeding the cap means the file grew after `stat` and yields `too-large`. Decoding is BOM → binary NUL sniff (first 8000 bytes) → fatal UTF-8. The BOM check precedes the sniff deliberately: UTF-16 text is full of NUL bytes and would otherwise be classified binary.

Every failure maps to one fixed sentence; no `error.message`, `errno`, realpath or stderr crosses the boundary, `logger.warn` receives the reason only, and the handler never rejects to the transport. Registration: `fileViewer` capability, a `fileView` manifest entry, Electron profile on, VS Code and CLI default off, CLI `EXPECTED_ABSENT_CAPABILITIES` and both host surface baselines updated. `rpc-allowlist.spec.ts` and the manifest invariants passed unmodified.

### Hosts (8a.5) and navigation guard (8a.6)

`editor:openFile` routes on `scope`; `'external-link'` accepts a regular file only and launches the **lexical** path, never the realpath. The VS Code `file:open` handler now parses the shared schema, form-gates before any `stat`, and resolves a relative path only under a checked root — it previously called `fs.stat(params.path)` directly, resolving against the extension host's `process.cwd()`.

**R3 resolved without a regression, per orchestrator decision 3:** an absolute path outside the registered roots is _not_ refused. It goes through the external-link policy and then a modal `showWarningMessage` showing the absolute path with an explicit Open action; cancel opens nothing. A deny-listed credential is refused outright and never reaches a confirm. Column support is `new vscode.Position(line - 1, (column ?? 1) - 1)`. Sentry capture is kept; the returned copy is fixed.

`navigation-policy.ts` imports no `electron` and allows only a navigation whose `file:` origin and pathname equal the current document's. `isInternalNavigation` and `EXTERNAL_SCHEMES` are deleted, not kept alongside. A cancelled `file:` navigation is never handed to `shell.openExternal`. **R9** is pinned and documented: hash and query are ignored, so an agent `href="index.html?x"` reloads the app the user is already in — it cannot become a navigation to different content.

### DI manifests (8a.7, R4)

`FileViewRpcHandlers` added to Electron `expected-resolvable` and VS Code `expected-absent` (with `'fileViewer'`). **A1 held, and no BLOCKER was needed:** `TOKENS.GIT_INFO_SERVICE` is registered in production on both hosts (`phase-4-handlers.ts:113`, `phase-3-handlers.ts:56`), but neither hand-built smoke container registered it, and `EditorRpcHandlers` now reaches it through `FileLinkRootPolicy`. Both smoke containers register a fake `GitInfoService` — the same repair pattern the post-rebase gate used for the filesystem port. No lazy `isRegistered` workaround was added.

`emitDecoratorMetadata` is `false` in `tsconfig.base.json`, so every constructor parameter needs an explicit `@inject(...)`. `FileLinkRootPolicy` is injected as a class token, following `skills-sh-rpc.handlers.ts:164`.

### Deviations from the plan

- `LinkedFileResolution`'s `directory` variant carries `realPath` and `root` in addition to `lexicalPath`. The policy needs both to apply the deny-list to a directory target, which the plan's sketch could not express.
- `resolveLinkedFilePath` takes an optional `fs` seam (defaulting to `node:fs/promises`). It exists so a spec can prove `realpath`/`stat` were **never** called for a refused form — the plan requires that negative, and it is not otherwise observable.
- `resolveForView` accepts `maxBytes`/`allowDirectory` overrides so the VS Code handler can reuse it to resolve a path it will reveal rather than read.

### Follow-ups recorded, not actioned

- **Legacy `file:read` remains uncontained.** `FileSystemRpcHandlers.register` (`libs/backend/rpc-handlers/src/lib/handlers/file-rpc.handlers.ts:69-78`) reads any caller-supplied path with no schema, containment, size cap or encoding handling, behind the `fileSystemAccess` capability. Batch 8a deliberately did not widen or narrow it. It is the strongest argument against treating `file:viewContent` as redundant, and should be either contained or removed.
- **Pre-existing failure, outside this batch's ownership: `ptah-electron:typecheck`.** Six errors in `apps/ptah-electron/src/config/build-artifact-gate.ts` (`Cannot find name 'describe'/'it'`, `Cannot find namespace 'jest'`). That file uses jest globals but is compiled by `tsconfig.app.json`, whose `types` are `["node","electron"]` and whose `exclude` is only `src/preload.ts` and `**/*.spec.ts` — the gate file is not a `.spec.ts`, so it is in the app program without jest types. Proven independent of Batch 8a: moving the new `navigation-policy.spec.ts` aside reproduces the identical six errors, the file is unmodified at HEAD, and `tsconfig.app.json` excludes `**/*.spec.ts` so no new spec entered that program. Not fixed here, per the do-not-touch-outside-ownership rule.
- A TOCTOU swap of a path component between `realpath` and `open` by a local writer already inside an authorized root remains possible; Node exposes no fd-to-path check on Windows. Recorded in `workspace-file-path.ts`.
