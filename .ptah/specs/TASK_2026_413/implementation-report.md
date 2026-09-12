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

## Batch 8b

Status: **PASS**.

The existing dock tab store now carries a read-only `view` descriptor alongside its established `diff` descriptor (`diff-tab.types.ts:108-153`). `DiffTabsService.openFileView` opens a hidden dock, de-duplicates normalized paths, preserves view tabs across workspace switches, and uses request IDs to reject stale reads (`diff-tabs.service.ts:247-310`, `443-466`). Content I/O is isolated in the named `FileViewReaderService`, the only frontend caller of `file:viewContent`; it preserves old content after transport failure, clears it after authorization failure, and trusts backend copy only for known refusal reasons (`file-view-reader.service.ts:58-159`).

`FileViewComponent` owns one disposable Monaco model per instance and configures `readOnly` plus `domReadOnly`; requested positions are clamped and revealed after content arrives (`file-view.component.ts:178-309`). `.md`, `.markdown`, and `.mdx` start in preview, with Source available unless the file exceeds 512 KiB. Preview rendering imports `MarkdownBlockComponent` from the repository sanitizer chokepoint, and the body supplies the opt-in link root/document markers (`file-view.component.ts:16-17`, `45-75`). A template scan test prohibits `[innerHTML]` and direct `.innerHTML` use.

The Git dock renders file and diff tabs from the same tab strip even when the workspace is not a Git repository, routes view tabs to `<ptah-file-view>`, and preserves the existing diff-tab accessible names (`git-dock.component.ts:93-191`). `EditorLauncherService.openLinkedFile` sends only `editor:openFile` requests scoped as `external-link` (`editor-launcher.service.ts:93-111`). A blocked-but-externally-openable path first displays an inline `alertdialog` containing the full absolute path and chosen editor; only its explicit Open action emits, while Cancel does nothing (`file-view.component.ts:76-127`, `152-176`). Denied paths expose no Open In control.

Focused reader, tab-store, Monaco lifecycle/theme, component, launcher, real-child mount, and Electron tests cover every Batch 8b behavior. The Electron proof keeps the BrowserWindow at 1200x800 and verifies the 700 px dock, a requested text position, Markdown preview/source, close, fixed outside-root refusal, and confirm-before-external-open. During regression verification the mixed-strip close label initially broke the legacy diff-tab locator; restoring the established `Close diff for …` name and adding the distinct `Close file …` name fixed compatibility without weakening the scenario.

## Security remediation (Batches 7/8a)

Four of the five findings in `security-review-7-8a.md` were in scope here. Each is
described with what changed, where, and the spec case that pins it.

### HIGH-1 — symlink escape bypassed the credential deny-list — FIXED

`resolveForExternalOpen` keyed its deny-list on `resolution.root`, the LEXICAL
root match, so a symlink inside a registered workspace root that realpathed into
`~/.ssh` skipped the deny-list entirely.

- `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:243-259` —
  the `widened = extra.some(...)` test is replaced by
  `await this.isInsideRegisteredRoots(resolution.realPath)`. The exemption is now
  keyed on the REAL path's containment in the registered roots or their
  worktrees; everything else is deny-listed on both its lexical and its real
  form.
- `file-link-root-policy.ts:388-424` — new private `isInsideRegisteredRoots` and
  `realpathAll`. Roots are realpath'd before comparison (home and `os.tmpdir()`
  can themselves be symlinks); an unresolvable root is dropped, which can only
  shrink the exempt set. Worktrees are consulted only after the registered roots
  miss, because listing them shells out to git.
- The registered-root `.env` exemption is preserved deliberately, and the file
  header (`file-link-root-policy.ts:1-42`) is rewritten to state the real-path
  rule, why lexical keying was wrong, and that the exemption stays.

Pinned by `file-link-root-policy.spec.ts`:
`refuses a symlink inside a REGISTERED root that realpaths into .ssh` (asserts
`outside-roots` and the absence of `lexicalPath`),
`does not apply the deny-list inside a registered workspace root` (the `.env`
exemption, unchanged), and the pre-existing home/temp cases
(`allows an ordinary file under home for external open`,
`refuses a credential under home, disclosing no path`,
`refuses a benign-looking symlink whose REALPATH lands in .ssh`).

### HIGH-2 — VS Code `file:open` refused absolute paths it must confirm — FIXED

`resolveForExternalOpen` is bounded to registered union home union temp, so
`D:\other-repo\x.ts` was rejected with `outside-roots` and
`confirmOutsideWorkspace` never ran — contradicting Decision 3 in `context.md`.

- `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:261-355` —
  new third method `resolveForHostReveal(requested, { allowDirectory })`, beside
  `resolveForView` and `resolveForExternalOpen`. It authorizes no root set but
  still enforces, in order: `checkLinkedPathForm` on the requested string,
  absolute-only (a relative path returns `no-base-root`, never `process.cwd()`),
  `realpath`, `checkLinkedPathForm` again on the RESOLVED target (a junction can
  escape to UNC), the credential deny-list on both lexical and real forms, and
  the regular-file / directory check. Its header comment states why it exists and
  that it never returns bytes — VS Code only reveals the path in its own editor.
  `resolveForExternalOpen` is NOT widened: the in-app viewer and the Electron
  external-open path keep their current root sets.
- `libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts:237-244` —
  `realpathFailureReason` is exported so the new policy answers with the same
  wire vocabulary rather than minting a second mapping. `checkLinkedPathForm` is
  reused, not copied.
- `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:137-146` —
  `resolveTarget` now calls `resolveForHostReveal`; the confirm runs on its
  `lexicalPath`. Relative paths are unchanged: view roots only.
- `file-rpc.handlers.ts:16-25` — header rule 2 rewritten to name the policy
  actually used and to record why `resolveForExternalOpen` is not.

Pinned by `file-link-root-policy.spec.ts` `describe('resolveForHostReveal')`,
which contrasts `resolveForView` rejecting a sibling-repo path against
`resolveForHostReveal` resolving it, plus credential refusal, UNC / device /
extended-prefix refusal, relative-path refusal, `not-found`, and the directory
case.

The dishonest mock is gone. `file-rpc.handlers.spec.ts`
`describe('an out-of-root absolute path, against the real policy')` constructs a
REAL `FileLinkRootPolicy` against a `mkdtemp` directory that no registered root
contains and pins: the confirm is called with the absolute path and opens on
`Open`; declining returns `Opening that file was cancelled.` and opens nothing; a
credential under that directory is refused with a single non-modal warning and no
modal confirm; a UNC share and a device path are refused before any confirmation.

### MEDIUM-1 — deny-list evaded by directory-name variations — FIXED

- `file-link-root-policy.ts:76-93` — new `CREDENTIAL_DENY_LIST.directoryPrefixes`
  (`/^\.(ssh|gnupg|aws|azure|kube|docker)([._-]|$)/`), applied per segment at
  `file-link-root-policy.ts:174-176`. The separator class is what keeps it
  narrow. Written in lower case WITHOUT the `i` flag on purpose: `segmentsOf`
  already lower-cases on win32, so matching stays case-insensitive there and
  case-SENSITIVE on posix, where `.SSH` is a genuinely different directory —
  the pre-existing posix case-sensitivity test still passes unchanged.
- `file-link-root-policy.ts:107-133` — `credentials`, `known_hosts` and
  `authorized_keys` added to `basenames`, stem-anchored with `(\.|$)`.

Pinned by `file-link-root-policy.spec.ts`: `denies %s by directory prefix`
(`.aws.bak`, `.ssh-old`, `.ssh_backup`, `.gnupg.2024`, a nested `.kube-old`);
`denies %s by basename wherever it was moved` (`credentials`,
`credentials.json`, `known_hosts`, `authorized_keys`); and the negative block
`still allows %s`, which proves `awsome`, `sshd-config` (as directory and as
file), `.dockerignore`, `.sshrc` and `my-credentials.ts` are NOT caught. A
further case pins win32-only case-insensitivity for the prefixes.

### LOW-1 — raw error text crossed the RPC boundary — FIXED

- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:35-47` —
  new fixed `MESSAGE` map.
- `editor-rpc.handlers.ts:172-188` — `openDetected` returns
  `'Could not launch the requested editor.'` and `detectFailure` (the sibling
  with the identical leak) returns `'Could not detect installed editors.'`. Both
  route the real error through the single private `warn` helper, which is the
  only place it goes. The `EditorOpenResult` / `EditorDetectTargetsResult` shapes
  are unchanged, so the renderer contract is untouched. The remaining
  caller-visible strings in this class are Zod issue messages and fixed
  containment copy, neither of which carries host state.

Pinned by `editor-rpc.handlers.spec.ts`:
`returns fixed copy and logs the real error when a launch throws` (asserts the
fixed sentence, that the host path fragment `AppData` is absent, and that the
logger received an `Error`) and `returns fixed copy when detection throws`.

### MEDIUM-2 — NOT fixed here, deliberately out of scope

`libs/frontend/markdown/src/lib/markdown-file-links.ts` (the
`pending instanceof Promise` thenable check) belongs to Batch 8c-1 and to another
executor. This batch was scoped to four named backend / extension files and must
not edit `libs/frontend/**`.

### Verification

Both commands run from the worktree, under the shared Nx lock, one at a time.

- `npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-extension-vscode`
  — `Successfully ran target test for 2 projects`. `@ptah-extension/rpc-handlers`:
  97 suites passed, 2881 passed / 31 skipped. `ptah-extension-vscode`: 6 suites
  passed, 60 passed.
- `npx nx run-many -t lint typecheck -p @ptah-extension/rpc-handlers ptah-extension-vscode`
  — `Successfully ran targets lint, typecheck for 2 projects`. 0 errors. The 19 +
  1 remaining lint warnings are pre-existing and in files this batch did not
  touch (`max-lines` on harness services, unused `TOKENS` imports, non-null
  assertions in a harness spec, an unused arg in `post-init.ts`).
- `ptah-electron:typecheck` was not run: it fails on this branch for an unrelated
  reason inherited from `main` (jest globals in
  `apps/ptah-electron/src/config/build-artifact-gate.ts`).

## Batch 8c-2

Chat link router, agent-output context markers, `FILE_LINK_OPENER` migration, composition-root wiring, Electron e2e, plus security finding 4. Nothing was committed, stashed, rebased or pushed, and `npx nx reset` was never run. Every Nx and Playwright command held the shared lock for its whole duration.

### Source changes

- **CREATE `libs/frontend/chat/src/lib/services/file-link-router.service.ts`** — one root service implementing BOTH `IFileLinkOpener` (`FILE_LINK_OPENER`) and `MarkdownFileLinkHandler` (`MARKDOWN_FILE_LINK_HANDLER`). Context resolution starts at `origin.closest('markdown, [markdown]')?.parentElement ?? origin`, so an attribute an agent authored inside its own rendered markdown can never be the match (R8); it then takes `closest('[data-ptah-link-document], [data-ptah-tab-id]')`. A previewed document wins and supplies `documentPath` plus its root; otherwise a tab marker resolves through `TabManagerService.findTabByIdAcrossWorkspaces`, which covers a BACKGROUND workspace; otherwise `vscode.config().workspaceRoot`, normalised so the default empty string becomes no root rather than an empty one.
- **Electron branch**: `setEditorPanelVisible(true)` first and synchronously (it triggers the shell's lazy dock load, so the dock chunk and the import fetch in parallel), then `await import('@ptah-extension/git-ui')`, `GitReviewService.setMode('working-tree')`, `DiffTabsService.openFileView`. There is no static git-ui import at this layer — the same pattern as `WorkspaceCoordinatorService.resolveGitServices`. A dynamic-import or open failure is logged with the `[FileLinkRouter]` prefix and re-thrown, never swallowed.
- **VS Code branch**: `rpcCall<FileOpenResult>(vscode, 'file:open', { path, line, column, workspaceRoot })`. `documentPath` is not sent because it has no VS Code producer. A refusal is logged and rejects.
- **Context markers**, as Angular HOST bindings only, never on a `<markdown>` element and never inside rendered content: `ChatTranscriptComponent` and `CompactSessionCardComponent` carry `data-ptah-file-links` plus `[attr.data-ptah-tab-id]`; `AgentMonitorPanelComponent` and `SubagentTranscriptOverlayComponent` carry the opt-in marker only, because both are store-driven and bound to no session tab, so a relative path there resolves against the active workspace root.
- **`FilePathLinkComponent`** now injects `FILE_LINK_OPENER` and `ElementRef` instead of `ClaudeRpcService`, emits `clicked`, then calls `open({ path, origin: host.nativeElement })`. The atom has no error surface of its own, so a rejection is logged rather than shown.
- **`TasksStore.openArtifact`** routes through `FILE_LINK_OPENER` and sets its error signal ONLY when the opener rejects.
- **`ClaudeRpcService.openFile` is deleted**, along with the now-unused `FileOpenResult` import. `grep -rn "rpcService.openFile\|rpc.openFile\|openFile: jest.fn" libs apps` returns only the expected survivors: the git-ui `EditorLauncherService`, the platform adapters and the backend container smoke specs. No compatibility shim was left behind.
- **Composition root** (`app.config.ts`): `{ provide: FILE_LINK_OPENER, useExisting: FileLinkRouterService }`, `{ provide: MARKDOWN_FILE_LINK_HANDLER, useExisting: FileLinkRouterService }` and `provideMarkdownFileLinks()`. `useExisting` is load-bearing — two instances would hold separate git-ui module caches and could resolve the same link against different workspaces.

### Marker audit (R2)

Marked, because they render agent output: chat transcript, compact session card, agent monitor panel, subagent transcript overlay, plus the git-ui file-view preview already marked by Batch 8b. Deliberately UNMARKED, so their links keep plain browser behaviour: `tasks-ui` task detail, `chat/settings/*`, `chat/update-dialog`, `skill-synthesis-ui/*`, `setup-wizard` analysis results and transcript, `harness-builder`, and `tribunal-panel` crucible verdict. The harness-builder and setup-wizard analysis transcripts do render agent execution nodes but carry no session tab, so they stay unmarked by default as the batch specifies; that remains a follow-up for the orchestrator to decide. Negative specs pin task detail and the update dialog.

### Security finding 4 (`markdown-file-links.ts`)

`if (pending instanceof Promise)` is replaced by a structural thenable check. The webview shell is Zone-based, so a handler's async method returns a `ZoneAwarePromise`, and a cross-realm handler returns that realm's `Promise`; neither is an instance of this realm's `Promise`, so the identity test let those rejections escape unhandled. A spec case now returns a non-Promise thenable that rejects and asserts it is still logged.

### Deviations, stated rather than made silently

1. **`.then(undefined, reportHandlerFailure)` instead of `.catch(...)`.** The brief asked to keep the existing `.catch` behaviour. `PromiseLike` — the only thing a thenable check establishes — guarantees `then` and nothing else; a Zone.js or cross-realm thenable is not required to expose `.catch`, so calling it would have reintroduced a narrower version of the same bug. `.then(undefined, handler)` is behaviourally identical and is what the standard defines `.catch` in terms of.
2. **Callers migrated beyond the R5 list.** R5 named five files. Two more needed migrating: `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.spec.ts`, which provided `ClaudeRpcService` for the atom under test, and four `TasksStore` TestBeds across `tasks-store.service.spec.ts`, `tasks-view.component.spec.ts` and `task-views.service.spec.ts`, which had to bind `FILE_LINK_OPENER` once the store took the port as a required dependency. Two webview specs also needed providers: `unit5-message-routing.spec.ts` (a stub opener for `TasksStore`) and the new `file-link-wiring.spec.ts` (`provideModelRefreshControl()`, which `TabManagerService` reaches through the router). R5's list was incomplete, as it warned it might be.
3. **The e2e's `file:viewContent` assertion does not check `line`/`column`.** Plan step 8c.5.2 is satisfied as written — it only requires `workspaceRoot` — but the reason is worth recording: `FileViewContentParams` (`rpc-misc.types.ts:163`) deliberately carries only `path`, `workspaceRoot` and `documentPath`. The backend reads bytes; the reveal is applied renderer-side. The Monaco cursor assertion, `{ lineNumber: 12, column: 3 }`, is what proves line and column survived the trip, and it passes. My first draft asserted them on the RPC and failed; the contract was right and the spec was wrong.
4. **The e2e reload step asserts less than plan step 8c.5.7 implies.** `mainWindow.reload()` completes and the window lands back on the same URL — the A6/A7 and D10 property, that an agent `file:` link cannot replace the document and leave the app unable to return. It does NOT assert the dock re-mounts after a bare renderer reload. Dock-state restore is proven by `git source-control rail`, which relaunches the whole app, the path the persisted `electron-layout` state is designed for. Asserting it after `page.reload()` failed, and I could not show it is a guaranteed property rather than my own assumption, so the spec claims only the narrower thing it actually proves.

### Is `FILE_LINK_OPENER` as a REQUIRED dependency of `TasksStore` safe at runtime?

Yes, and it is provable rather than assumed. The token has no default provider, so a consumer that fails to bind it gets an NG0201 at first injection — which is exactly how two spec failures surfaced during verification. The question is whether any RUNTIME path can hit that.

There are exactly two Angular bootstraps in the repository: `apps/ptah-extension-webview/src/main.ts` and `apps/ptah-landing-page/src/main.ts` (`grep -rln "bootstrapApplication"`). The webview app is the single composition root for BOTH the VS Code webview and the Electron renderer, and it binds the token. The landing page consumes neither `@ptah-extension/tasks-ui` nor `@ptah-extension/chat-ui` — a grep for either specifier across `libs/web`, `libs/api` and `apps/ptah-landing-page` returns nothing — so neither `TasksStore` nor `FilePathLinkComponent` can be constructed there. Every runtime path is therefore covered by the composition root, and a future app that consumes these libs without binding the token fails loudly at construction rather than silently failing to open files.

### Out-of-scope defect found, reported and NOT fixed

`apps/ptah-electron-e2e/src/specs/git/file-view-tab.spec.ts:144` (Batch 8b's file) asks for a button named `Close readme.md`, but `git-dock.component.ts:165-166` emits `Close file <name>` for a file tab and `Close diff for <name>` for a diff tab. The 8b product fix landed without updating this spec. Proven pre-existing at HEAD without `git stash`: `git diff --stat HEAD` is empty for both that spec and all of `libs/frontend/git-ui`, neither of which this batch touches, and `git show HEAD:` on each file reproduces the same mismatch. Left unfixed because both files are outside this batch's ownership.

**Orchestrator correction (after the final logic review, finding L-2).** The spec WAS fixed, in this same commit `cfc7513e3` — the orchestrator made the one-line change to `Close file readme.md` before committing, so the sentence above is stale. The corrected spec has since been run twice on this branch and passes both times, including the close step. Batch 8b's own report of this spec as "1/1 passed" was false and is retracted at `test-report.md:131`.

## Logic-review remediation (backend)

Findings L-1, L-3, L-4 and L-6 from `code-logic-review-final.md`. L-2, L-5 and
L-7 to L-13 are outside this batch's ownership and were not touched.

### SHARED CONTRACT for L-6 — read this first

SHARED CONTRACT: `FileOpenResult.cancelled?: true` — a new OPTIONAL field on the existing `FileOpenResult` interface in `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:136-152`, exported unchanged from `@ptah-extension/shared`. It is present ONLY when the user declined the host's confirmation modal, and it is ALWAYS accompanied by `success: false` (nothing was opened). Its type is the literal `true`, so `result.data?.cancelled === true` is the whole detection; never match on `error`, which stays display copy and may be reworded. No other field changed, and no other outcome sets it.

### L-1 [SERIOUS] — the confirm now names the file it will open

Two halves, both in `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts`.

- **The modal states the resolved target when it differs.**
  `confirmOutsideWorkspace` takes both paths (`:175-178`) and builds its `detail`
  at `:198-200`: the bare path when `samePath(requested, real)` holds, otherwise
  `<requested>` then a blank line then `This is a link. It opens:` then
  `<realPath>`. The ordinary case — an absolute link into an unregistered sibling
  repo — is unchanged and still shows one path, so the extra line appears only
  when there genuinely is a redirection to read. `samePath` (`:52-63`) normalises
  first and compares case-insensitively on win32 only, so `D:\ws\.\a.ts` is not
  reported as a redirection and neither is `D:\WS\a.ts`.
- **The deliberate decision about the fallback, written where it is made**
  (`:157-167`). A lexically-in-root path DOES still reach `resolveForHostReveal`.
  Skipping the fallback for in-root paths is the cheaper guard the review offered,
  and it was rejected: the only way an in-root path gets there is that
  `resolveForView` already rejected it, and for an in-root path that is almost
  always the realpath containment re-check — the path is a link out of the
  workspace. A symlinked docs folder or a junctioned dependency tree is an
  ordinary developer setup, so refusing outright would regress exactly the "a link
  into a sibling checkout still opens" case Decision 3 exists to preserve, reached
  through a link instead of an absolute path. It is CONFIRMED rather than refused,
  and the confirm is now truthful, which is what makes the human gate real again.
  The file header (`:16-22`) was corrected to match.

Pinned by `file-rpc.handlers.spec.ts`, `describe('the confirmation detail')`:
`names the resolved target when a link makes it differ` asserts the detail
contains BOTH the in-workspace lexical path and the out-of-workspace target, and
`shows the path alone when nothing redirects it` asserts the bare path is
unchanged when the two are equal. The policy is doubled in those two cases on
purpose — the assertion is about the modal's copy, and doubling is what lets them
run on an account that cannot create a symlink. The real policy's half of the same
scenario is pinned in `file-link-root-policy.spec.ts` (see L-4).

### L-3 [MODERATE] — the rename class closed for every directory the list names

`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts`.

`directoryPrefixes` is REPLACED, not extended. A list of single-segment regexes
could never describe the multi-segment entries, which is why
`.config/gh.bak/hosts.yml` and `.claude.bak/.credentials.json` passed. In its
place, `renameSuffixes: ['.', '-', '_']` (`:87-113`) is applied by `segmentMatches`
(`:175-181`) to EVERY segment of EVERY run in both `directories` and `files`,
through the shared `runMatchesAt` (`:183-189`) that `containsRun` and
`endsWithRun` both use now. One rule, and no second list to keep in step with the
first.

Why this rather than the review's suggested
`directoryPrefixes: /^\.(...|claude|codex|ptah)/`: that denies the whole of
`~/.claude`, `~/.codex` and `~/.ptah`, and `resolveForExternalOpen`'s own header
states those directories are the predominant agent reference and that making them
openable is the point of the wider root set. `.claude` is deny-listed as the FILE
run `.claude/.credentials.json`, so the suffix rule closes
`.claude.bak/.credentials.json` while `~/.claude/settings.json` still opens.

One basename widened: `/^credentials(\.|$)/i` became `/^\.?credentials(\.|$)/i`
(`:154`) — the leading dot in `.credentials.json` was the anchor the old stem rule
missed.

Narrowness is pinned by specs, not asserted, in `file-link-root-policy.spec.ts`:

- Positive, new: `denies %s behind a renamed parent directory` covers all four
  named cases — `.claude.bak/.credentials.json`, `.codex-old/auth.json`,
  `.ptah.bak/secrets.enc.json`, `.config/gh.bak/hosts.yml` — plus
  `.config/gcloud-old`, `.config/git_backup` and
  `AppData/Roaming/Microsoft/Credentials.bak`.
- Negative, required: `.dockerignore`, `.sshrc`, `awsome` and `sshd-config` are in
  the existing `still allows %s` block and still return `false`. `.dockerignore`
  starts with `.docker`, but the next character is `i`, which is not in
  `renameSuffixes`.
- Negative, new: a second `still allows %s` block proves the rule does NOT widen a
  directory the list names only through a file entry — `~/.claude/settings.json`,
  `~/.claude.bak/skills/x/SKILL.md`, `~/.ptah/user/agents/x.md`,
  `~/.codex/config.toml`.
- Case behaviour is unchanged and still pinned: `.SSH.bak` denies on win32 and
  allows on posix.

`CREDENTIAL_DENY_LIST.directoryPrefixes` no longer exists; the
non-empty-in-every-class case asserts `renameSuffixes` instead. The const is
exported from the lib barrel but has no consumer outside this file and its spec.

### L-4 [MODERATE] — the HIGH-1 regression test can now fail on this platform

`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.spec.ts`.

- **The silent `return` is gone.** `canCreateFileSymlink()` probes once at module
  load using `node:fs` sync calls in a scratch directory, and
  `const itWithSymlink = canCreateFileSymlink() ? it : it.skip` drives the two
  real-filesystem symlink cases. On an unprivileged Windows account the runner now
  PRINTS them as skipped instead of ticking them green having asserted nothing.
- **A platform-independent case was added**:
  `refuses an in-root path whose REALPATH is a private key, with no symlink`. A
  `jest.mock('node:fs/promises')` factory delegates to the real module except for
  exact paths placed in `mockRealpathOverrides`, so the temp trees the suite builds
  still behave normally. The case writes a real regular file at
  `<workspace>/seeded_note.md` inside the single REGISTERED root and maps its
  `realpath` to `<home>/.ssh/id_ed25519`.

Why that case fails if the deny-list is ever re-keyed onto the lexical root:
`resolveLinkedFilePath` returns `root` as the LEXICAL match
(`workspace-file-path.ts:392`, `:407`), which here is the registered workspace.
The exemption is taken on `isInsideRegisteredRoots(resolution.realPath)`
(`file-link-root-policy.ts:262`), and the real path is under home, not under the
workspace, so the exemption does not apply, `isCredentialPath` fires, and the
result is `{ kind: 'rejected', reason: 'outside-roots' }` with no `lexicalPath`.
Re-key that one line to `resolution.root` and the same input takes the exemption
and returns `kind: 'file'` WITH a `lexicalPath` — both assertions in the case
flip. The seam is the one the policy actually uses (the policy and the mechanism
below it both import `node:fs/promises`), so the override also covers the
containment re-check, which is what makes the scenario reachable without a
symlink at all.

### L-6 [MODERATE] — cancelling is no longer reported as a failure

- `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:136-152` — the field described
  under SHARED CONTRACT above, with the reason and the "detect the flag, never the
  message" rule in its doc comment.
- `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:98-103`
  — the cancel branch returns
  `{ success: false, cancelled: true, error: MESSAGE.cancelled }`. `success` stays
  `false` because nothing was opened; `cancelled` is what lets a renderer resolve
  quietly instead of throwing.
- The Electron `file:open` handler
  (`libs/backend/rpc-handlers/src/lib/handlers/file-open-rpc.handlers.ts`) raises
  no confirmation and therefore never sets the field. The contract was deliberately
  not widened past this one outcome.
- Pinned by `file-rpc.handlers.spec.ts`, `opens nothing when the confirmation is
declined`, whose `toEqual` now includes `cancelled: true` — an exact-shape
  assertion, so a handler that later drops the flag fails.
- The renderer half (`file-link-router.service.ts`, `tasks-store.service.ts`,
  `file-path-link.component.ts`) is `libs/frontend/**` and was NOT touched.

### Files

- MODIFIED `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts` — truthful confirm detail, the fallback decision comment, `cancelled: true`
- MODIFIED `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts` — confirmation-detail cases, exact cancel shape
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts` — `renameSuffixes` replaces `directoryPrefixes`, applied to every segment of every run; `.?credentials` basename
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.spec.ts` — rename-class positives and negatives, visible symlink skip, the fs-seam HIGH-1 case
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-misc.types.ts` — `FileOpenResult.cancelled?: true`

### Verification

Each command took the shared `ptah-413-nx.lock` directory first and released it
with `rm -rf` immediately on return. `npx nx reset` was NOT run — a second
executor is working in this worktree.

- `npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/shared`
  — header read `Running target test for 3 projects and 26 tasks they depend on`;
  N = 3, the number asked for.
  - `@ptah-extension/shared` — **56/56 suites, 1368/1368 tests passed**.
  - `ptah-extension-vscode` — **6/6 suites, 62/62 tests passed** (includes the two
    new confirmation-detail cases and the exact-shape cancel case).
  - `@ptah-extension/rpc-handlers` — 96/97 suites passed, **1 failed**:
    `skills-sh/skills-sh-source-root.service.spec.ts` ›
    `writes every slug of a whole-repo install and unions the record on re-install`,
    `Exceeded timeout of 5000 ms for a test`, in a suite that itself took 25.1 s.
- **The failure is pre-existing and load-induced, proven without `git stash`.**
  `git diff --name-only HEAD` does not list either
  `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.spec.ts`
  or its service; `git show HEAD:<each path>` diffs byte-identical against the
  working tree. It is a 5-second Jest timeout in a spec that ran concurrently with
  the dependency builds of the same command, not an assertion failure, and it is
  in a lib area (`skills-sh/`) that shares nothing with the files changed here.
- `npx nx test @ptah-extension/rpc-handlers` re-run alone — **97/97 suites,
  2891 passed, 33 skipped, 0 failed**, `Successfully ran target test`. The same
  spec passes when it is not competing with the builds, which is what makes the
  first result a flake rather than a regression. This is the run that covers the
  L-3 and L-4 specs, and they pass.
- `npx nx run-many -t lint typecheck -p @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/shared`
  — `Successfully ran targets lint, typecheck for 3 projects`. **0 errors.**
  20 warnings, all pre-existing `max-lines` / `no-unused-vars` /
  `no-non-null-assertion` notices in files this work did not touch
  (`harness/ai/*`, `harness/streaming/*`, `activation/post-init.ts`).
- **The L-4 skip is real on this machine, and visible.** A direct probe of
  `fs.symlinkSync` in this worktree returns `EPERM`, so both real-filesystem
  symlink cases are reported as SKIPPED by the runner (part of the 33) rather than
  returning green having asserted nothing. The platform-independent case that
  replaces them RAN and passed. That is the whole point of the change: before it,
  the single test guarding HIGH-1 could not fail here.
- Not run: the Electron e2e (`ptah-electron-e2e`) — outside this batch's project
  set and unaffected by these files. L-2, which asks for an e2e re-run, was not in
  scope here.

## Logic-review remediation (frontend)

Findings L-5, L-6, L-7, L-8, L-9, L-11, L-12 and L-13 from
`code-logic-review-final.md`. Nothing was committed, stashed, rebased or pushed,
`npx nx reset` was never run, and nothing under `libs/backend/**`,
`apps/ptah-extension-vscode/**` or `libs/shared/**` was edited. Every Nx and
Playwright command held the shared lock for its whole duration.

### L-5 [MODERATE] — the file-view request id is now monotonic per service

- `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:101-113` — a new
  private `nextFileViewRequestId` counter, documented with the exact defect it
  closes.
- `:281` (`openFileView`, new-tab path) — `const requestId = ++this.nextFileViewRequestId;`
  in place of the hardcoded `1`.
- `:457-459` (`refreshFileView`) — draws from the same counter instead of
  `tab.view.requestId + 1`, so a refresh id can never collide with an id a
  previous tab already issued. Per-tab monotonicity is preserved, because the
  counter only ever increases.
- **Pinned by** `libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts`
  -> `drops a closed tab's late response after the same file is re-opened`. It
  drives the review's scenario directly: open at line 500 with the read still in
  flight, close the tab, re-open the same file at line 10, resolve the SECOND
  read, then resolve the FIRST. The assertion is on `reveal`, which is what the
  stale response used to overwrite. Against the old code this test fails; the
  existing `drops an older response after a newer refresh wins` case does not,
  because it never closes the tab.

### L-6 [MODERATE] — cancelling is no longer reported as a failure

Wired to the backend executor's `SHARED CONTRACT` line above
(`FileOpenResult.cancelled?: true`), read from `implementation-report.md:407`
before this was written.

- `libs/frontend/chat/src/lib/services/file-link-router.service.ts:154-160` —
  after the success check, `if (result.data?.cancelled === true) return;`. The
  router resolves, so `TasksStore.openArtifact` sets no error signal and
  `FilePathLinkComponent` logs no `console.error` for a deliberate user action.
  The flag is the whole detection; `error` is never matched on.
- **Pinned by** `file-link-router.service.spec.ts` ->
  `RESOLVES when the user cancelled the host confirmation`, which also asserts
  `console.error` was not called.

### L-7 [MODERATE] — both unmarked surfaces now publish their tab

**Fixed rather than recorded as a limitation**, because the owning tab turned out
to be genuinely available in both places through an existing public lookup,
`TabManagerService.findTabBySessionIdAcrossWorkspaces` — no new marker and no
invented identity. Where it resolves to nothing the attribute is simply absent
and the router keeps its previous active-workspace fallback, so nothing regresses.

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:141-150`
  (host) and `:487-501` (`linkTabId`) — a SCOPED panel (`sessionId` input) maps
  its session to the owning tab and publishes `data-ptah-tab-id`. The GLOBAL
  panel (`sessionId === null`) renders the ACTIVE tab's agents, so its absent
  marker was already the correct answer and is left alone.
- `libs/frontend/chat/src/lib/components/organisms/subagent-transcript-overlay.component.ts:19-32`
  (host + `linkTabId`) — the overlay is store-driven, but the store knows the
  transcript's PARENT SESSION, so the tab is resolvable.
  `libs/frontend/chat/src/lib/services/subagent-transcript-viewer.service.ts:33-40`,
  `:52`, `:76`, `:93` expose that session as a readonly signal, set in `openFor`
  and cleared in `close`.
- **Pinned by** `agent-monitor-panel.scope.spec.ts` -> the `file-link tab context`
  describe (scoped panel publishes the background tab; global panel publishes
  nothing; a session with no tab publishes nothing), and the new
  `subagent-transcript-overlay.component.spec.ts` (same three cases).

### L-8 [MINOR] — success is asserted, not assumed

- `file-link-router.service.ts:145-149` — `result.data?.success === true`
  replaces `result.data?.success !== false`. A transport envelope with
  `data: undefined` is now a rejection rather than a silent "opened".
- **Pinned by** `file-link-router.service.spec.ts` ->
  `rejects when the transport succeeded but the host returned no payload`.

### L-9 [MINOR] — the size note states only a measured fact

- `libs/frontend/git-ui/src/lib/file-view/file-view.component.ts:144` and the new
  `previewSizeBlocked` computed at `:217-230` — the note renders only when
  `sizeBytes !== null && sizeBytes > MAX_MARKDOWN_PREVIEW_BYTES`. A first-load
  failure leaves `sizeBytes` null, which used to print "over 512 KB" beside an
  unrelated error banner. `previewAvailable` is unchanged — an unknown size still
  correctly disables the preview; only the CLAIM about why was wrong.
- **Pinned by** `file-view.component.spec.ts` ->
  `does NOT claim the file is over 512 KB when the size is unknown`. The existing
  `disables preview over 512 KiB...` case still passes, so the real over-cap copy
  is not lost.

### L-11 [MINOR] — a failed dock open restores the previous dock state

- `file-link-router.service.ts:108-137` — `openInDock` captures
  `layout.editorPanelVisible()` before revealing, and the `catch` hides the dock
  again only when it was hidden before. The reveal still happens FIRST, so the
  dock chunk and the dynamic import keep fetching in parallel; only the failure
  branch changed. An already-open dock is left open.
- **Pinned by** two cases in `file-link-router.service.spec.ts`:
  `hides the dock again when the open fails and the dock was hidden before`
  (asserts the exact call sequence `[[true], [false]]`) and
  `leaves an ALREADY-open dock open when the open fails`.

### L-12 [MINOR] — the e2e test name now matches what the test proves

- `apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts:329-333` —
  retitled to `a link opens a tab, and a renderer reload returns to the same URL
(A6/A7, D10)`, with a comment above it stating both things the old title
  claimed and the body does not do: it clicks a markdown link rather than a
  `FilePathLinkComponent` tool-call chip (that path has unit coverage only), and
  it deliberately does not assert dock restore. The body is unchanged — renaming
  was the honest fix, since the declining comment at `:365-367` is correct.

### L-13 [MINOR] — a collapsed rail with no open tab has an affordance

- `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:103-121` — the
  `@else if (!diffTabs.activeDiffTab())` branch gains a final `@else` for the
  case both existing conditions miss (git repo, not loading, rail collapsed):
  "Source control is collapsed." plus a `Show changed files` button bound to the
  existing `ElectronLayoutService.toggleGitRail()`. No new layout state and no
  new primitive.
- **Pinned by** `git-dock.mount.spec.ts` ->
  `offers a way back when the rail is collapsed with no tab open`, which collapses
  through the real header toggle, asserts the copy and the control, clicks it, and
  asserts the rail is back.

### Not fixed, and why

- **L-1, L-2, L-3, L-4** — backend, VS Code host, and test-report corrections.
  Owned by the parallel backend executor; untouched here by the brief's file
  rules.
- **L-10 and S-1 to S-3** — not in this assignment's finding list. L-10 (the
  dynamic-import comment's bundle argument) and S-1 (no coalescing on view-tab
  revalidation) both sit in files this work touched and are left exactly as they
  were, deliberately rather than by oversight.

### Deviation from the review's suggested fix — L-7

The review offered two options and called the first "one line": when no marker
resolves and the path is relative, send no `workspaceRoot` so the backend answers
`no-base-root` and the user reads a refusal. That was NOT taken. It fails loudly,
but it fails for the common case too — the global agent-monitor panel, which is
scoped to the ACTIVE tab, would start refusing links it resolves correctly today.
The second option (publish the tab) turned out to be available on both surfaces
without inventing an identity, so it was taken instead, and the active-workspace
fallback is kept for the genuinely unknowable cases.

### Second review pass — final-review.md MEDIUM-1, LOW-1, LOW-2

Three further deny-list findings, all in
`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts`. They were
raised against the pre-`renameSuffixes` code but re-checked against it; MEDIUM-1
and LOW-1 still applied, LOW-2 was already closed and is now pinned.

#### MEDIUM-1 [MEDIUM] — the deny-list was evadable on the whole macOS platform

`segmentsOf` folded case only for win32. APFS and HFS+ ship case-INSENSITIVE and
case-preserving, so `~/.AWS/config` and `~/.aws/config` are the SAME file on a
stock Mac while the segment comparison treated them as different names:
`isCredentialPath('/Users/u/.AWS/config', 'darwin')` returned `false`.

Fixed by a named predicate rather than a second platform literal inline —
`foldsCase(platform)` (`:166-181`), used by `segmentsOf` (`:183-187`). darwin now
folds alongside win32; linux does not, because `.SSH` there is genuinely a
different directory and folding it would refuse files that are not credentials.
The comment records the one case this gets deliberately wrong: a darwin machine
formatted case-sensitive (APFS-CS) is now over-refused slightly, which is the
correct direction for a deny-list to err in.

Pinned three ways, as asked:

- `denies %s on darwin` — seven upper- and mixed-case forms: `.AWS/config`,
  `.SSH/id_rsa`, `.DOCKER/config.json`, `.KUBE/config`, `.Aws.Bak/notes.md`
  (rename rule + folding together), `.CONFIG/GH/hosts.yml` (multi-segment), and
  `.Claude/.Credentials.json` (a `files` run).
- `still allows %s on linux, where the name genuinely differs` — the same
  upper-case forms must NOT match on linux.
- `applies the rename rule case-insensitively on win32 only` — the pre-existing
  win32 behaviour, unchanged.
- `keeps the lower-case forms denied on every platform` — a loop over win32,
  darwin and linux, so folding cannot be "fixed" later by dropping the ordinary
  case.

#### LOW-1 [LOW, false refusal] — a directory run matched a FILE basename

The rename rule was applied to every segment including the LEAF, so
`~/.docker-compose.yml` matched the `.docker` directory entry through the `-`
suffix and an ordinary compose file outside the registered roots was refused as
if it were a credential directory.

`containsRun` is REPLACED by `containsDirectoryRun` (`:223-249`), which passes an
`exactFinalSegment` flag into `runMatchesAt` (`:206-221`) when the run would end
at the leaf. Ancestor segments keep the rename rule — a segment with something
after it is unambiguously a directory, which is the case the rule exists for
(`~/.docker-old/config.json`). The leaf may satisfy a directory run only by EXACT
equality. `files` runs are untouched and still use the rename rule at the leaf,
because there the leaf IS the file.

The exact-leaf match is what preserves the case the brief warned about: `~/.ssh`,
`~/.aws`, `~/.config/gh` and `AppData/Local/Microsoft/Credentials` as directory
TARGETS are still refused. What the change trades away is refusing a RENAMED
credential directory as a directory — `~/.ssh.bak` itself. Every path INSIDE it is
still refused by the ancestor rule and revealing a directory discloses no bytes,
so that is the cheap half of the pair; the comment at `:229-241` states it rather
than leaving it to be discovered.

Pinned by two new blocks:

- `still allows %s, a FILE that merely starts with a run` —
  `.docker-compose.yml`, `.docker-compose.yaml`, `.docker.env.sample`,
  `.ssh-notes.md`, `.aws-setup.md`.
- `still denies %s as a directory target` — `~/.ssh`, `~/.aws`, `~/.config/gh`,
  `AppData/Local/Microsoft/Credentials`.

#### LOW-2 [LOW] — already closed by the rename rule, now pinned

All three named paths were already refused by the previous pass, so no production
change was needed. Traced: `~/.npmrc.bak` and `~/.git-credentials.old` match a
`files` run at the leaf (`.npmrc` / `.git-credentials` followed by `.`);
`~/.config/gh.bak/hosts.yml` matches the `.config/gh` directory run at an
ANCESTOR segment, which is the position the rename rule still applies to after
LOW-1. Pinned as spec cases rather than left as an argument, together with
`~/.netrc.backup` and `~/.config/gcloud.bak/creds.db`.

The review's own suggested fix for LOW-2 — adding
`/^\.(npmrc|git-credentials|netrc|pgpass)(\.|$)/i` to `basenames` — was NOT taken.
It would be a second mechanism for a class the run rule already covers, and a
basename rule matches at any depth including inside directories where these names
are ordinary.

#### Verification (second pass)

Same locking discipline; each command took `ptah-413-nx.lock` with `mkdir`,
wrote an `owner.txt`, and released with `rm -rf` on return. No `npx nx reset`.

- `npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/shared`
  — header `Running target test for 3 projects and 26 tasks they depend on`,
  N = 3, and `Successfully ran target test for 3 projects`.
  - `@ptah-extension/shared` — 56/56 suites, 1368/1368 passed.
  - `@ptah-extension/rpc-handlers` — **97/97 suites, 2917 passed, 33 skipped,
    0 failed** (2891 before this pass; the 26 new cases are the difference).
  - `ptah-extension-vscode` — 6/6 suites, 62/62 passed.
  - The `skills-sh-source-root` timeout seen in the FIRST pass did not recur.
- `npx nx run-many -t lint typecheck -p @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/shared`
  — `Successfully ran targets lint, typecheck for 3 projects`. **0 errors**, 22
  warnings, all pre-existing: 19 in `rpc-handlers` (`harness/ai/*`,
  `harness/streaming/*`), 1 in `ptah-extension-vscode` (`activation/post-init.ts`),
  and 2 `max-lines` notices in `@ptah-extension/shared` on files of 810 and 3130
  lines — both already past the 700-line ceiling before the 11-line
  `FileOpenResult.cancelled` addition.
- The 33 skipped are unchanged from the first pass: the two `itWithSymlink` cases,
  visibly skipped because `fs.symlinkSync` returns `EPERM` on this account, plus
  the 31 that pre-date this work.

#### Coordination note

While checking the lock after the first pass I saw a lock directory present,
assumed it was my own un-released one, and deleted it — it belonged to the
frontend executor (`owner.txt` read `logicfix-fe`). I recreated it immediately
with its original contents. The gap was roughly twenty seconds and I started no Nx
command inside it.

What I can and cannot prove about the consequence: a process listing 22 minutes
later showed a legitimate `nx run-many -t test` (PID 3460, started 15:19) holding
the lock, and my own queued run then acquired it and completed normally, so the
lock was not left stale. I cannot prove the holder was continuous across the
20-second gap — if the frontend executor's own `rm -rf` happened to land inside
it, my restored directory would have been an orphan until the next release.
Noted because someone else may need to recognise that shape, not because a
failure was observed.

## CI remediation (PR #499)

### Changes

- `libs/backend/rpc-handlers/src/lib/handlers/file-open-rpc.handlers.spec.ts`
  now derives the workspace, inside file, and outside file with Node's host
  `path.resolve` and asserts the resulting native path. This is preferable to
  a win32/POSIX case table because `resolveWorkspaceFilePath` intentionally uses
  the host `node:path` implementation and has no platform seam to stub; the
  same absolute/contained/outside behavior is now exercised on every runner
  without asking Linux to classify a Windows drive string. This holds on both
  platforms because `/ws` is root-absolute under both Node path implementations
  and `path.resolve` supplies the native drive/separators before the handler
  calls `path.isAbsolute` and containment logic.
- `apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts` intercepts
  `shell.openExternal` inside the Electron main process for the one test that
  clicks an HTTPS agent link, records the handoff, and asserts the exact URL.
  The Linux CI log showed that all test assertions completed and only the
  `electronApp` fixture teardown exceeded 60 seconds; the unique real external
  handoff was waiting on Linux's unavailable desktop portal/`xdg-open` path and
  kept Electron alive. This holds on both platforms because both execute the
  same Electron navigation guard and verify the same `https://example.com/a.ts`
  handoff without launching either OS's browser infrastructure.

### Platform-assumption sweep

The exact `origin/main...HEAD` changed-spec set was searched for drive paths,
backslashes, UNC/device forms, and separator assumptions in the three requested
areas. The only `path.isAbsolute` defect was the `file-open` spec above. The
remaining Windows-shaped values are intentional: `workspace-file-path`, the VS
Code file handler, and markdown specs pass explicit `win32` seams or exercise
cross-platform parsers/form rejection; Git root matching explicitly normalizes
slash direction; frontend service values and error strings are opaque RPC/UI
data and never reach Node path classification. The Windows-shaped Electron
markdown fixture was retained for the same reason: it proves a Windows link is
parsed on every host, while the relative link's mocked workspace root is only
renderer/RPC data. No deliberately cross-platform parser case was weakened.

### Verification

All commands acquired `ptah-413-nx.lock` before Nx and released the directory
recursively immediately afterward.

- `npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-extension-vscode`
  printed `Running target test for 2 projects and 26 tasks they depend on` and
  passed: rpc-handlers 97/97 suites (2,919 passed, 33 skipped) and VS Code 6/6
  suites (62/62 passed).
- `npx nx e2e ptah-electron-e2e -- --grep "agent file links|read-only file tabs"`
  printed the one requested E2E project plus 2 dependency tasks and Playwright
  `Running 4 tests using 1 worker`; all 4 passed in 30.0 seconds. The formerly
  hanging test passed in 7.8 seconds and teardown completed normally.
- `git diff --check` passed.
