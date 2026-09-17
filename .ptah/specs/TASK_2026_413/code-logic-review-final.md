# Code Logic Review (final) — TASK_2026_413

Scope: read-only behavioural review of `feb980285` (Batch 8b), `3ddc00d40` (security
remediation) and `cfc7513e3` (Batch 8c-2), in the worktree
`D:/projects/ptah-extension/.claude/worktrees/git-review-controls` on
`fix/git-review-controls`. No build, test or git-state command was run, per the brief.

## Verdict

| Metric         | Value                   |
| -------------- | ----------------------- |
| Score          | 7/10                    |
| Verdict        | APPROVE_WITH_FIXES      |
| Blocking       | 0                       |
| Serious        | 2                       |
| Moderate       | 5                       |
| Minor          | 6                       |
| Total findings | 13 PROVED + 3 SUSPECTED |

Why 7 and not 8: two defects (L-1, L-2) sit on the exact controls these commits were
written to establish — the confirmation modal and the verification evidence. Why not 5:
the security remediation's four named claims all hold under tracing, the e2e in
`agent-file-links.spec.ts` drives real clicks through the real marked + DOMPurify path
rather than a fixture, and the deviations from the plan are declared in
`implementation-report.md:198-205` and `:383-397` rather than made silently.

---

# PROVED findings

## L-1 [SERIOUS] The VS Code confirm modal shows a path that is not the file it opens

- **Files**: `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:137-146`,
  `:156-165`, `:176`; `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:352-361`
- **Scenario**: workspace `D:\ws` is open. A cloned or agent-written symlink
  `D:\ws\notes.md` points at `C:\Users\me\Documents\secret.txt`. An agent emits
  `[notes](D:\ws\notes.md)`.
  1. `resolveForView` runs the realpath containment re-check
     (`workspace-file-path.ts:374-380`) and rejects with `outside-roots` — correctly.
  2. `path.isAbsolute(requested)` is true, so `resolveTarget` falls through to
     `resolveForHostReveal` (`file-rpc.handlers.ts:137`).
  3. `resolveForHostReveal` authorizes no root set. `realpath` lands on
     `secret.txt`, which is not on the deny-list, so it returns
     `lexicalPath: 'D:\ws\notes.md'` (`file-link-root-policy.ts:352-359`).
  4. `confirmOutsideWorkspace(outside.lexicalPath)` shows the modal
     **"Open a file from outside your open workspaces?"** with `detail` =
     `D:\ws\notes.md` — a path inside the workspace the user has open.
  5. `reveal()` opens `vscode.Uri.file(resolution.lexicalPath)`, which the OS resolves
     through the symlink. The user sees `secret.txt`.
- **Impact**: the modal's stated purpose is "the one moment the user can tell an
  intended reference apart from a path an injected prompt talked the agent into
  emitting" (`file-rpc.handlers.ts:150-155`). For precisely the symlink case the rest of
  the policy is built to catch, it displays a reassuring in-workspace path. Credentials
  are still blocked by the deny-list, so this is a wrong-file disclosure to the user's
  own editor, not a credential leak — hence Serious rather than Blocking.
- **Smallest fix**: show the resolved target, not the lexical form:
  `confirmOutsideWorkspace(outside.realPath)` — or `detail: \`${lexicalPath}\n→ ${realPath}\``when they differ. A second, cheaper guard is to skip the`resolveForHostReveal`fallback when`requested` is lexically inside a registered root, since that case is
  never "outside your open workspaces".
- **Note**: the Electron side does **not** have this hole. `file:viewContent` omits
  `lexicalPath` on a realpath escape (`workspace-file-path.ts:376-380`), so
  `externalOpenAllowed` is false and `FileViewComponent` never offers the confirm.

## L-2 [SERIOUS] The Batch 8b e2e is recorded as passing, was failing, and has still never been run since it was fixed

- **Files**: `.ptah/specs/TASK_2026_413/test-report.md:131` vs `:174-176`;
  `.ptah/specs/TASK_2026_413/implementation-report.md:395-397`;
  `apps/ptah-electron-e2e/src/specs/git/file-view-tab.spec.ts:144-146`
- **Evidence**:
  - `test-report.md:131` states: `npx nx e2e ptah-electron-e2e -- --grep "read-only file
tabs"` → **"1/1 passed in 6.5s … opened Markdown preview, toggled Source, **closed the
    tab**, rendered the fixed outside-root refusal"**. "Closed the tab" is the exact step
    that could not have run.
  - `test-report.md:174` (Batch 8c-2, later) states the same spec **fails** at line 144
    waiting for a button named `Close readme.md`, because the product emits
    `Close file <name>` (`git-dock.component.ts:163-166`).
  - `implementation-report.md:395` declares it "Left unfixed because both files are
    outside this batch's ownership" — yet `cfc7513e3` **does** change it
    (`file-view-tab.spec.ts:144-146`, `Close readme.md` → `Close file readme.md`).
  - No table row in `test-report.md` records a run of `read-only file tabs` after that
    correction. The last recorded run of that name is the false one at `:131`.
- **Impact**: the only end-to-end proof of Batch 8b (Monaco read-only tab, preview
  toggle, close, refusal, confirm-before-launch) is currently unverified, and one line of
  the evidence table is demonstrably fabricated. Everything downstream that cited "8b:
  PASS" inherits that.
- **Smallest fix**: run `npx nx e2e ptah-electron-e2e -- --grep "read-only file tabs"`
  under the shared lock, replace `test-report.md:131` with the real result, and correct
  `implementation-report.md:395-397` to say the spec was fixed in `cfc7513e3`.

## L-3 [MODERATE] The widened deny-list closes the rename class for six shell directories and leaves it open for the AI-credential ones

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:102`,
  `:104-116`, `:131-144`
- **Evidence**: `directoryPrefixes` is
  `[/^\.(ssh|gnupg|aws|azure|kube|docker)([._-]|$)/]` — single-segment only. The
  multi-segment entries in `directories` (`.config/gcloud`, `.config/gh`, `.config/git`,
  the three `AppData/...` runs) and the multi-segment entries in `files`
  (`.claude/.credentials.json`, `.codex/auth.json`, `.ptah/secrets.enc.json`) get no
  prefix rule at all, and their basenames are not in `basenames`.
  Walk `isCredentialPath('/home/me/.claude.bak/.credentials.json', 'linux')`:
  - `directories`: no run matches (`.claude` is not listed).
  - `directoryPrefixes`: `.claude.bak` does not match the six-name alternation.
  - `files`: `endsWithRun(['.claude.bak','.credentials.json'], ['.claude','.credentials.json'])` → false.
  - `basenames`: `/^credentials(\.|$)/i` does not match `.credentials.json` (leading dot).
    → **`false`.** Same result for `~/.codex-old/auth.json`, `~/.ptah.bak/secrets.enc.json`
    and `~/.config/gh.bak/hosts.yml` (a GitHub OAuth token).
- **Impact**: exactly the MEDIUM-1 evasion the commit claims to close, still open for the
  directories holding this product's own model credentials. Reachable through
  `editor:openFile` scope `external-link`, which hands the path to an often AI-enabled
  editor — the threat `file-link-root-policy.ts:26-28` names.
- **Smallest fix**: add the missing stems to the prefix rule and the missing basenames:
  ```ts
  directoryPrefixes: [
    /^\.(ssh|gnupg|aws|azure|kube|docker|claude|codex|ptah|gemini)([._-]|$)/,
  ],
  // basenames += /^\.?credentials(\.|$)/i, /^auth\.json$/i, /^secrets\.enc\.json$/i, /^hosts\.ya?ml$/i
  ```
  (`/^\.?credentials/` also catches the `.credentials.json` form the current stem anchor
  misses.)

## L-4 [MODERATE] The HIGH-1 regression test cannot fail on Windows — the platform this worktree runs on

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.spec.ts`,
  the `refuses a symlink inside a REGISTERED root that realpaths into .ssh` case
  (`3ddc00d40`, the `try { await fs.symlink(...) } catch { return; }` block)
- **Evidence**:
  ```ts
  try {
    await fs.symlink(path.join(home, '.ssh', 'id_ed25519'), link, 'file');
  } catch {
    // Unprivileged Windows cannot create a file symlink.
    return;
  }
  ```
  An unprivileged Windows process cannot create a file symlink, so `fs.symlink` throws
  and the test **returns green having asserted nothing**. This repository's primary
  platform is win32 (root `CLAUDE.md`, "Windows paths"), and this is the single test
  guarding the headline finding the commit is named after.
- **Impact**: the deny-list could be re-keyed back onto `resolution.root` tomorrow and
  this suite would stay green on the developer machine. A green tick for a check that did
  not run is the failure mode root `CLAUDE.md` documents for `nx test projA projB`.
- **Smallest fix**: keep the real-filesystem case but make the skip visible and add a
  platform-independent one that injects an `fs` seam:
  ```ts
  const canSymlink = await probeSymlink();
  (canSymlink ? it : it.skip)('refuses a symlink …', async () => { … });
  ```
  plus a second case driving `resolveForExternalOpen` with a stubbed
  `realpath` that returns `~/.ssh/id_ed25519` for an in-root lexical path. The second one
  runs everywhere and is the one that actually pins the keying.

## L-5 [MODERATE] A close-then-reopen of the same file can be overwritten by the first read's stale response

- **File**: `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts` —
  `openFileView`, `const requestId = 1;` on the new-tab path; guard in
  `applyFileViewResult` (`live.view.requestId !== requestId`)
- **Scenario**: click `[a](src/a.ts:500)` → new tab, `requestId = 1`, read in flight on a
  slow disk. User closes the tab, then clicks `[a](src/a.ts:10)`. `openFileView` finds no
  existing tab (it was removed by `closeDiff`), so it creates a fresh one with
  `requestId = 1` again and issues a second read. The **first** read resolves later;
  `applyFileViewResult('view:…a.ts', 1, oldResult)` finds a live tab whose `requestId` is
  also `1`, so the guard passes and the stale state — including
  `reveal: { line: 500, … }` computed from the _first_ request
  (`file-view-reader.service.ts:47-55`, `:118`) — replaces the newer one. The cursor
  lands on the wrong line with no error.
- **Impact**: silent wrong answer on the feature's own core promise ("opens at the
  requested line"). Narrow window, but the request id exists precisely to close it.
- **Smallest fix**: make the counter monotonic per service, not per tab —
  `private nextRequestId = 0;` and `const requestId = ++this.nextRequestId;` in both
  `openFileView` and `refreshFileView`. The existing spec
  (`diff-tabs.service.spec.ts`, `drops an older response after a newer refresh wins`)
  only covers the same-tab refresh path (ids 1 vs 2) and would not have caught this.

## L-6 [MODERATE] A user cancelling the VS Code confirm is reported to the caller as a failure

- **Files**: `apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:98-100`;
  `libs/frontend/chat/src/lib/services/file-link-router.service.ts:145-150`;
  `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1365-1370`
- **Scenario**: on VS Code, a tasks-board artifact or an out-of-root agent link raises the
  modal; the user clicks away. `openFile` returns
  `{ success: false, error: 'Opening that file was cancelled.' }`. `openInVsCode` treats
  any `data.success === false` as a failure, logs it and **throws**. `TasksStore.openArtifact`
  catches and sets `this._error` to that sentence, so the board shows a red error for a
  deliberate user action. `FilePathLinkComponent` logs a `console.error` for the same.
- **Impact**: cancel is not a failure. It produces error UI and error logs, which trains
  the user to ignore both.
- **Smallest fix**: give the wire result a distinguishable shape — e.g. return
  `{ success: false, cancelled: true, error: MESSAGE.cancelled }` from the handler — and
  have `openInVsCode` resolve rather than reject when `cancelled` is set.

## L-7 [MODERATE] A relative link in the agent-monitor panel or the subagent overlay silently resolves against the wrong workspace

- **Files**: `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:141-144`;
  `libs/frontend/chat/src/lib/components/organisms/subagent-transcript-overlay.component.ts:19-21`;
  `libs/frontend/chat/src/lib/services/file-link-router.service.ts:176-186`
- **Evidence**: both carry `data-ptah-file-links` but no `data-ptah-tab-id`.
  `AgentMonitorPanelComponent` is mounted from
  `libs/frontend/tribunal-panel/src/lib/components/vendor-card.component.ts:25` and
  `SubagentTranscriptOverlayComponent` from
  `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:111` — neither
  inside a `ChatTranscriptComponent`, so `closest(LINK_CONTEXT_SELECTOR)` finds nothing
  and `resolveContext` falls back to `vscode.config().workspaceRoot`.
- **Impact**: a tribunal vendor or a subagent working in a worktree emits
  `[x](src/index.ts)`; the router sends the ACTIVE workspace as the root, the backend
  authorizes it (it is a registered root), and a same-named file from a _different_
  repository opens with no indication that the root was substituted. AC 22 requires the
  originating tab's workspace.
- **Declared?** Partly. `implementation-report.md:377` and the two code comments state
  the behaviour ("a relative path there resolves against the active workspace root"); the
  **consequence** — silently opening a different repository's file of the same name — is
  stated nowhere. Under the brief's rule this is not requirements drift, but it is a
  silent-wrong-answer path that should be named.
- **Smallest fix**: when no context marker resolves and the path is relative, either pass
  no `workspaceRoot` (so the backend answers `no-base-root` and the tab shows a
  refusal the user can read) or have both surfaces expose the session they are rendering
  as `data-ptah-tab-id`. The first is one line and fails loudly.

## L-8 [MINOR] `openInVsCode` reports success when the host returned no payload

- **File**: `libs/frontend/chat/src/lib/services/file-link-router.service.ts:145`
- `if (result.success && result.data?.success !== false) return;` — a transport envelope
  with `data: undefined` (handler unregistered, response shape drift) satisfies this and
  the router reports the file as opened. Fix: `result.data?.success === true`.

## L-9 [MINOR] "Preview is disabled for files over 512 KB." is shown when the size is simply unknown

- **File**: `libs/frontend/git-ui/src/lib/file-view/file-view.component.ts:144-150`,
  with `previewAvailable` at `:209-216`
- On a first-load `error` for a `.md` path, `sizeBytes` is `null`
  (`file-view-reader.service.ts:116`), so `previewAvailable()` is false and the size note
  renders beside an unrelated error banner. Fix: gate the note on
  `view.sizeBytes !== null && view.sizeBytes > MAX_MARKDOWN_PREVIEW_BYTES`.

## L-10 [MINOR] The dynamic `git-ui` import buys nothing — the composition root already imports the barrel statically

- **Files**: `libs/frontend/chat/src/lib/services/file-link-router.service.ts:57-62`,
  `:114`; `apps/ptah-extension-webview/src/app/app.config.ts:58-63`, `:201`
- The doc comment says "A static import here would pull it into the eager chat chunk, and
  chat loads on every host including VS Code, where the dock does not exist."
  `app.config.ts:58-63` statically imports `DiffTabsService, GitBranchesService,
GitStatusService, WorktreeService` from `@ptah-extension/git-ui` — the same wide barrel
  that exports `GitDockComponent` and `DiffViewComponent` — for the `MESSAGE_HANDLERS`
  registrations. The chunk is eager regardless. The lib-graph hygiene argument still
  holds; the bundle argument in the comment does not. Fix: correct the comment, or keep
  the claim and move the barrel import to a narrow entry point.

## L-11 [MINOR] A failed dock open leaves the dock revealed and empty

- **File**: `libs/frontend/chat/src/lib/services/file-link-router.service.ts:112-128`
- `setEditorPanelVisible(true)` runs before the `try`. `implementation-plan.md` A.5 says
  "A dynamic import failure is logged and the dock stays as it was." It does not. Fix:
  either reveal inside the `try` after the import resolves (losing the parallel-fetch
  benefit) or hide it again in the `catch` when it was hidden before.

## L-12 [MINOR] An e2e test name claims two things the test does not do

- **File**: `apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts:329`
- Title: `'a tool-call file chip opens a tab, and a renderer reload restores the dock
(A6/A7, D10)'`. The body clicks a **markdown link** (`:356`), not a
  `FilePathLinkComponent` chip, and `:365-367` explicitly declines to assert dock
  restore. The declining is honest and correct; the title is not. Consequence: AC 21's
  tool-call-chip path has unit coverage only, and a reader scanning test names would
  conclude otherwise. Fix: rename to
  `'a link opens a tab, and a renderer reload returns to the same URL'`.

## L-13 [MINOR] Collapsed rail + no open tab renders an empty pane

- **File**: `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:98-108`
- When the workspace **is** a git repo, the rail is collapsed and no tab is open, the
  `@else if (!diffTabs.activeDiffTab())` branch renders a `flex-1 p-4` div whose two inner
  `@if`s are both false — a blank pane with no affordance to expand the rail again from
  that region. Fix: render a short "Source control is collapsed" line with the expand
  control in that branch.

---

# SUSPECTED (not proven; stated so it is not mistaken for a clean bill)

- **S-1 — no coalescing on view-tab revalidation.** `onFileContentChanged`
  (`diff-tabs.service.ts`) fires `refreshFileView` per event, while the diff path
  deliberately debounces through `refreshDebounceTimers`. A watcher burst during a build
  would issue one `file:viewContent` per event for an open tab. Not proven to matter —
  the read is bounded at 2 MiB and the request-id guard keeps state correct — but the
  asymmetry with the diff path looks unintentional.
- **S-2 — `FILE_LINK_OPENER` as a hard dependency of a root `MESSAGE_HANDLERS` service.**
  `TasksStore` (`tasks-store.service.ts:420`) now throws NG0201 at first injection if the
  token is unbound. `implementation-report.md:399-403` argues every runtime path is
  covered by the single webview composition root, and that argument traces correctly
  today. It already cost two spec repairs. An `@Optional()` fallback that logs would turn
  a future app-level omission from a boot crash into a degraded feature.
- **S-3 — plan item not carried out.** `implementation-plan.md` 8b.3 required removing
  the git-ui barrel over-exports (style finding 2). `libs/frontend/git-ui/src/index.ts`
  still exports `GitDockComponent`, `GitDockHeaderComponent`, `OpenInButtonComponent` and
  the `OpenIn*` types. This is a structure question — routed to
  `code-style-reviewer`, not scored here.

---

# The five review axes, answered

### 1. Test honesty

Mostly good, with two real problems and one structural limit.

- **Genuinely honest work**: `file-rpc.handlers.spec.ts` now constructs a **real**
  `FileLinkRootPolicy` over real temp files for the out-of-root block
  (`3ddc00d40`), which is exactly the mock that concealed HIGH-2. `agent-file-links.spec.ts`
  streams a real `chat:chunk`, renders through the real marked extension and the real
  DOMPurify pass, and clicks real anchors; its `page.mouse.click` workaround for the
  un-intercepted `https://` link (`:249-254`) is reasoned, not a weakening.
  `file-link-router.service.spec.ts` builds real DOM and pins the R8 forgery cases
  (`:134-164`). `file-link-wiring.spec.ts:66-86` asserts port **identity** and a single
  listener pair — a check that can actually fail.
- **Cannot fail**: L-4, the HIGH-1 symlink test, silently returns on Windows.
- **False evidence**: L-2, `test-report.md:131`.
- **Mistitled**: L-12.
- **Structural limits, declared or acceptable**: `file-view.component.spec.ts:8-30` stubs
  `ngx-markdown`, so the "renders through MarkdownBlockComponent" case proves
  pass-through, not sanitization; the no-`innerHTML` guarantee rests on the source-grep at
  `:308-314`, which is what the plan asked for. Both e2e specs supply
  `externalOpenAllowed: true` from their own `file:viewContent` mock, so they exercise
  the UI mapping and not the backend policy — correct layering, but it means no e2e would
  notice a policy change.
- **No mock-the-policy-you-claim-to-prove cases remain** in the three commits. The one
  that existed was removed by `3ddc00d40`.

### 2. Silent failures and swallowed errors along the link path

The chain holds. Traced end to end:

- **marked extension → DOMPurify**: unchanged by these commits; `data-ptah-file-links` is
  in `FORBID_ATTR` and the opt-in lookup starts at `host.parentElement`
  (`markdown-file-links.ts:118`), so agent HTML cannot opt itself in. The forgery cases
  are pinned in `file-link-router.service.spec.ts:134-164`.
- **document listener**: the `instanceof Promise` → thenable fix
  (`markdown-file-links.ts:136`, `:157-164`) is correct, and `.then(undefined, handler)`
  rather than `.catch` is the right call for a `PromiseLike` — reasoned in
  `implementation-report.md:385-388` and pinned by the non-native-thenable spec case.
- **FileLinkRouterService**: rejects rather than swallows on both branches
  (`:123-128`, `:147-150`).
- **Electron dock**: a policy refusal becomes a readable `blocked` tab rather than a blank
  editor (`file-view-reader.service.ts:143-160`); a transport failure preserves previous
  content (`:93-103` over `baseState`'s `previous?.content`); an authorization failure
  clears it. All three match the plan.
- **Monaco loader failure** is swallowed by design (`file-view.component.ts:313-316`) so
  it cannot overwrite backend refusal copy — a defensible trade, but note that a Monaco
  load failure on a non-markdown file therefore produces a silent blank pane with no
  message at all. Not counted as a finding because the comment states the intent; worth a
  fallback line of copy.
- Two genuine silent-success paths found: **L-8** (undefined payload) and **L-6**
  (cancel reported as failure — the inverse).

### 3. Races and stale state

- **Slow read resolving after a tab switch**: correct. `applyFileViewResult` keys on tab
  key _and_ `requestId`, and a closed tab's late response finds no `live` tab and is
  dropped.
- **Rapid switching between two links to the same file**: correct — `refreshFileView`
  increments, the older response loses.
- **Close-then-reopen the same file**: **broken** — L-5.
- **Monaco model/editor disposal**: correct. `syncModel` disposes the prior model before
  `createModel` (`file-view.component.ts:325-336`), `blocked` disposes
  (`:242-243`), `DestroyRef` disposes editor + model + theme observer (`:254`, `:373-388`),
  and `initializeEditor` re-checks `this.destroyed` after the await (`:290`). The
  `inmemory://` URI is derived from the path, and only one `FileViewComponent` instance
  exists at a time (the dock swaps inputs, not instances), so no duplicate-URI throw.
- **A refusal arriving after a success**: covered by the same `requestId` guard.
- **Dock opening before the service exists**: safe. `DiffTabsService` and
  `GitReviewService` are both `providedIn: 'root'`
  (`diff-tabs.service.ts:75`, `git-review.service.ts:17`) and the router resolves them
  from the root `Injector`, so the tab is in the store before `GitDockComponent` renders.
  `setEditorPanelVisible(true)` first is deliberate and correct — except on the failure
  branch, L-11.

### 4. Unmet requirements

Checked against `context.md` and `implementation-plan.md` 8b/8c.

| Requirement                                                               | Status     | Gap                                                                                                      |
| ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| 8b.1 reader status mapping, content-preservation rules                    | COMPLETE   | `file-view-reader.service.ts:27-32`, `:93-103`, `:143-160` match the plan exactly                        |
| 8b.1 `requestId` guards stale reads                                       | PARTIAL    | L-5: new-tab path hardcodes `1`                                                                          |
| 8b.1 view tabs survive a workspace switch                                 | COMPLETE   | no clear path in `DiffTabsService`; diff-only guards at `:210`, `:231`, `:391`, `:411`                   |
| 8b.2 preview-first ≤512 KiB, Source toggle, no `innerHTML`                | COMPLETE   | note copy leaks onto the error path (L-9)                                                                |
| 8b.2 reveal clamping, one model per instance, DestroyRef disposal         | COMPLETE   | —                                                                                                        |
| 8b.3 file tab renders in a non-git workspace                              | COMPLETE   | pinned by `git-dock.mount.spec.ts` `renders a file tab in a non-git workspace…`; blank-pane edge at L-13 |
| 8b.3 barrel over-export removal                                           | MISSING    | S-3, style-owned                                                                                         |
| 8c.3 context starts outside `<markdown>`                                  | COMPLETE   | `file-link-router.service.ts:164`                                                                        |
| 8c.3 both ports → one instance                                            | COMPLETE   | `app.config.ts:144-145` (`useExisting`), pinned by `file-link-wiring.spec.ts:66-72`                      |
| AC 21 `ClaudeRpcService.openFile` deleted, all callers migrated           | COMPLETE   | verified: remaining `.openFile(` are `EditorLauncherService` only                                        |
| AC 22 relative link resolves against the originating tab's workspace      | PARTIAL    | L-7 for the two unmarked surfaces                                                                        |
| Decision 3 — VS Code confirms rather than refuses an unregistered sibling | COMPLETE   | `resolveForHostReveal` + `file-rpc.handlers.ts:137-146`; but see L-1 for what the confirm shows          |
| Decision 1 — deny-list on given **and** realpath form                     | PARTIAL    | keying is fixed; coverage gap at L-3                                                                     |
| AC 29/30 — e2e and Nx gates pass with a confirmed project count           | UNVERIFIED | L-2                                                                                                      |

Implicit requirement not addressed: nothing tells the user _why_ a confirm was raised for
a path that looks like it is inside their workspace (L-1).

### 5. The security remediation's claims, verified one by one

| Claim                                                                | Verdict   | Evidence                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deny-list now keyed on REAL-path containment, not the lexical root   | **HOLDS** | `file-link-root-policy.ts:262-275`; `isInsideRegisteredRoots` at `:375-398` realpaths the roots first, consults worktrees only after the registered roots miss, and drops unresolvable roots (fail-closed) |
| `resolveForHostReveal` authorizes no root set                        | **HOLDS** | `:306-362` — no root parameter, no `matchRoot`, no `isPathWithinRoots`                                                                                                                                     |
| …while still applying the form gate                                  | **HOLDS** | `:310` on the request **and** `:328` re-applied to the realpath'd target, which is what a junction-to-UNC escape needs                                                                                     |
| …realpath                                                            | **HOLDS** | `:321`, mapped through the shared `realpathFailureReason` (`workspace-file-path.ts:244`) rather than a second vocabulary                                                                                   |
| …the deny-list                                                       | **HOLDS** | `:332-336`, on both lexical and real form, **before** `stat`, and returning no `lexicalPath` so no external-open affordance is offered                                                                     |
| …the file-kind check                                                 | **HOLDS** | `:338-350`; FIFO/socket/device fall to `not-a-file`                                                                                                                                                        |
| Relative paths rejected rather than resolved against `process.cwd()` | **HOLDS** | `:313-315`                                                                                                                                                                                                 |
| `resolveForExternalOpen` root set unchanged                          | **HOLDS** | `:243-254` still `registered ∪ worktrees ∪ home ∪ temp`; only the deny-list keying moved                                                                                                                   |
| The registered-root exemption still lets a repo `.env` open          | **HOLDS** | pinned by `does not apply the deny-list inside a registered workspace root`                                                                                                                                |
| LOW-1 raw `error.message` no longer crosses the RPC boundary         | **HOLDS** | `editor-rpc.handlers.ts` `MESSAGE.launchFailed`/`detectFailed` + the single `warn` funnel; pinned by two spec cases that assert the `AppData` fragment is absent                                           |
| The handler spec no longer mocks the policy it proves                | **HOLDS** | `file-rpc.handlers.spec.ts` builds a real `FileLinkRootPolicy` over a real temp tree                                                                                                                       |

**Ways around it that I did find**: L-1 (the confirm displays the wrong path, so the
human gate the design leans on is defeated for the symlink case) and L-3 (renamed
AI-credential directories still pass). **Ways around it I looked for and did not find**:
UNC/device/ADS/drive-relative all refused before any I/O; `..` collapsed before
containment; a junction whose realpath is UNC refused at `:328` and
`workspace-file-path.ts:372`; an unresolvable root shrinks rather than widens the
authorized set in all three `realpathAll` sites; the renderer cannot widen the deny-list
(not configurable, `:64-70`); `resolveForHostReveal` returns no bytes and only `success`
crosses the wire.

---

## Data flow, annotated

Electron, agent markdown → viewer:

1. marked extension emits `data-ptah-file-href`; DOMPurify keeps it, strips
   `data-ptah-file-links` from content — **OK**, unchanged by these commits.
2. document capture listener (`markdown-file-links.ts:105-141`) — **OK**; opt-in checked
   at `host.parentElement`, `pre`/`code` skipped, `preventDefault` before the handler.
3. `FileLinkRouterService.resolveContext` — **OK** for the transcript and compact card;
   **GAP (L-7)** for the agent-monitor panel and subagent overlay.
4. `setEditorPanelVisible(true)` → dynamic import → `setMode` → `openFileView` — **OK**,
   except the revealed-empty-dock failure branch (**L-11**).
5. `DiffTabsService.openFileView` → tab insert → `FileViewReaderService.read` — **GAP
   (L-5)** on the reopen race.
6. `file:viewContent` → Zod → `FileLinkRootPolicy.resolveForView` → bounded read → typed
   result — **OK**; realpath containment holds and no path is disclosed on an escape.
7. `FileViewComponent` renders Monaco or preview — **OK**; **cosmetic GAP (L-9)**.

VS Code, agent markdown → native tab:

1-3 as above. 4. `file:open` → schema → `resolveForView` → on rejection
`resolveForHostReveal` → confirm → `showTextDocument` — **GAP (L-1)** at the confirm,
**GAP (L-6)** on cancel reporting.

---

## What a robust implementation would add

1. `realPath` in the VS Code confirmation detail (L-1) — one line, restores the control.
2. A monotonic request-id counter on `DiffTabsService` (L-5) — two lines, plus the
   close-and-reopen spec case that is missing.
3. The four missing deny-list stems and basenames (L-3), with a table-driven spec case per
   AI-credential directory.
4. A platform-independent HIGH-1 case that injects `realpath` (L-4), so the keying is
   pinned wherever the suite runs.
5. A `cancelled` flag on `FileOpenResult` (L-6).
6. A re-run of `read-only file tabs` and an honest correction of `test-report.md:131` and
   `implementation-report.md:395-397` (L-2).
