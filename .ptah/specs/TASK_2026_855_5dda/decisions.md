# Decisions — TASK_2026_855_5dda (per-session git view)

The task runs unattended. Each decision below compares the options, cites the evidence
(`file:line`, repo-relative to the worktree), names the choice, and says whether it can be
reversed. "Verified" means the cited line was opened during design.

---

## D1. Where the session → working-root resolver lives

**Options**

- A. `libs/frontend/chat` (next to `sessionWorkingRoot`).
- B. `libs/frontend/git-ui`.
- C. `libs/shared/src/lib/utils` (pure function, `scope:shared`, `type:util`).

**Evidence**

- Today the only resolver is `sessionWorkingRoot(tab, partitionPath, fallback)` in
  `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts:133-139`
  (agent-origin worktree → partition path → fallback). It does not read the organization
  record and does not validate.
- `git-ui` imports only `core`, `shared`, `ui`, `markdown` (grep of
  `libs/frontend/git-ui/src`). `chat` imports `git-ui` (statically at
  `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:605` via
  dynamic import, and `workspace-coordinator.service.ts:128`). So git-ui → chat would create
  a cycle. Option A is unreachable from git-ui.
- Both libs are `scope:webview`, `type:feature` (`libs/frontend/git-ui/project.json`,
  `libs/frontend/chat/project.json`); `type:feature` may depend on `type:util`
  (`eslint.config.mjs:414-422`). `libs/shared` is `scope:shared`, `type:util`.
- `libs/shared/src/lib/utils/workspace-root-key.ts:44` already holds the shared
  `normalizeWorkspaceRoot` that git-ui uses (`review-navigation.service.ts:3`).

**Choice:** C. A pure `resolveSessionWorkingRoot()` in
`libs/shared/src/lib/utils/session-working-root.ts`, taking plain strings (no `TabState`, no
Angular). chat and git-ui both call it. `sessionWorkingRoot` in chat becomes a thin adapter over
it, so there is one precedence rule.

**Reversible:** yes. It is a pure function behind one export.

---

## D2. Resolver precedence and validation rule — SUPERSEDED by D15 (precedence kept; frontend validation removed)

**Options**

- A. The precedence from the request: organization worktree → agent-origin worktree → session
  cwd → workspace root. Accept a candidate only when it is an open workspace folder, or a
  registered worktree of the workspace's repository.
- B. A, with no frontend validation (the backend checks every call anyway).

**Evidence**

- The organization record carries `worktreePath` and `branch`:
  `libs/shared/src/lib/types/session-organization.types.ts:117-130`. It reaches the webview on
  `ChatSessionSummary.organization` (`libs/shared/src/lib/types/execution/node.ts:257`).
  `ChatStore.sessions` exposes those rows (`libs/frontend/chat/src/lib/services/chat.store.ts:111`).
- The agent origin carries `worktreePath` and `branch`:
  `libs/frontend/chat-types/src/lib/chat-types.ts:547-561`.
- Neither `TabState` (`chat-types.ts:566+`) nor `ChatSessionSummary` (`node.ts:222+`) has a
  per-session cwd field. A session's working directory is its workspace partition path, which is
  how `sessionWorkingRoot` already treats it (`session-git-stats.store.ts:138`,
  `compact-session-card.component.ts:391-397`).
- The backend accepts a non-folder root only when it is a live, non-prunable, non-UNC worktree
  with the same git common dir (`libs/backend/rpc-handlers/src/lib/handlers/git-workspace-root.ts:41-111`).
  For a root it does not accept, it returns the non-git default
  (`git-rpc.handlers.ts:212-217`). The UI then shows "not available"
  (`review-worktree-status.service.ts:94-95`) instead of falling back.

**Choice:** A. The frontend validation makes the fallback graceful. A worktree that was removed
or is foreign falls through to the next candidate instead of showing an error. The backend
check stays authoritative. "Session cwd" means the tab's workspace partition path, because no
other cwd exists. The input `registeredWorktrees: readonly string[] | null` uses `null` for
"list not loaded yet". In that case worktree candidates are kept and the backend has the last
word. This avoids a workspace-root → worktree flip on first paint. The resolver returns the
canonical spelling: the open-folder string, or the git-listed worktree path. That way frontend
keys and backend push roots match.

**Reversible:** yes.

---

## D3. How git-ui learns the active session without importing chat

**Options**

- A. Have git-ui import `@ptah-extension/chat-state` (`type:data-access`, allowed by tags).
- B. Add an `InjectionToken` in `@ptah-extension/core` that chat implements and the webview app
  provides. This is the existing dependency-inversion pattern.
- C. Have chat push the scope into git-ui imperatively on every tab switch.

**Evidence**

- Precedent: `WORKSPACE_COORDINATOR` is declared in core and implemented by chat to "break the
  circular dependency between core and chat/git-ui"
  (`libs/frontend/core/src/lib/tokens/workspace-coordinator.token.ts:17-29`). It is provided in
  `apps/ptah-extension-webview/src/app/app.config.ts:296-297`.
- The organization record lives in chat's `ChatStore` (`chat.store.ts:74-111`), not in
  chat-state. Option A would still miss it.
- Option C needs an extra call at every place a tab switches, and an edit could miss one.

**Choice:** B. `GIT_SESSION_SCOPE_SOURCE` in core, `type:core`. git-ui injects it with
`{ optional: true }`. When it is absent (tests, other hosts), the dock scope is the workspace
folder, which is today's behaviour.

**Reversible:** yes.

---

## D4. How the scope reaches every git-ui consumer (minimal churn)

**Options**

- A. Add a new `scopeRoot` signal and change about 40 call sites from
  `gitStatus.activeWorkspacePath()` to it.
- B. Keep `GitStatusService.activeWorkspacePath` as the one "root the dock operates on". The new
  scope store drives it, and the five workspace-aware services, through their existing
  `switchWorkspace(root)`.

**Evidence**

- Every dock read and write takes its root from `gitStatus.activeWorkspacePath()`:
  - commit: `commit/commit-composer.component.ts:443,795`
  - stage, unstage, discard: `services/source-control.service.ts:334-336`
  - stash: `services/git-stash.service.ts:106,120,195,269,370`
  - header: `git-dock/git-dock-header.component.ts:167,326,369`
  - history: `history/history-timeline.component.ts:143-469`
  - canvas: `review-canvas/review-canvas.component.ts:303`
- `GitStatusService.switchWorkspace` already keeps one cache entry per root and restores it on
  switch (`git-status.service.ts:214,329-356`).
- `WorkspaceCoordinatorService` fans `switchWorkspace(path)` out to exactly
  GitStatusService, GitBranchesService, ReviewDiffService, GitReviewService and
  ReviewNavigationService, with ReviewNavigationService last
  (`libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:128-136,197-205`).

**Choice:** B. A new `GitDockScopeStore` (git-ui, root) becomes the single driver of that
fan-out. The coordinator calls `store.setWorkspace(path)` instead of looping the services
itself. Removing a workspace still calls each service's `removeWorkspaceState`, plus
`store.removeWorkspace`. The name `activeWorkspacePath` stays, and its doc comment is updated to
"the root the dock is scoped to". A rename would touch about 40 lines and change no behaviour.

**Reversible:** yes. The coordinator change is local to one method.

---

## D5. Is the session's own worktree fully editable in the dock? — choice kept; the 5 s positive cache is SUPERSEDED by D17, the write gate added by D18

**Options**

- A. Read-only, as today for non-folder roots. Edits need "Open as workspace".
- B. Fully editable (stage, unstage, discard, commit, stash, hunks, branch ops) for a validated
  worktree of an open folder's repository. `git:addWorktree` and `git:removeWorktree` stay
  folder-only.
- C. Editable for stage, unstage and commit only.

**Evidence**

- Today, mutating handlers accept only a registered folder (`resolveRoot`,
  `git-rpc.handlers.ts:299-316`). Only `git:info` and `git:diffFile` accept a worktree
  (`resolveReadRoot`, `git-rpc.handlers.ts:324-348`). The workflow handlers are folder-only
  (`git-workflow-rpc.handlers.ts:313-325`).
- The worktree check is strong. The path must be listed by git, not `prunable`, not UNC, and an
  existing directory. Git run inside it must report the same common dir as the open folder
  (`git-workspace-root.ts:41-111`). A worktree that passes shares the open folder's object store
  and refs, so it is the same trust domain as a folder the user already opened. Any write the
  dock could do there, the user could already do from the folder (for example with
  `git -C <worktree>`).
- Path arguments are traversal-checked and placed after `--` (`git-info.service.ts:2830-2858`).
  Writes are serialized per root (`writeLock.run(workspacePath, …)`, `git-info.service.ts:1183`).
- Destructive actions already confirm (`review-canvas/pending-discard.ts:88-121`). The confirm
  is dropped when the root changed while the dialog was open
  (`review-canvas/changed-file-tree.component.ts:794`). But `SourceControlService.discardChanges`
  and `discardAll` re-read the root at call time (`source-control.service.ts:201-235,334-336`)
  instead of using the root the user confirmed.
- Option A makes the main requirement (a per-session view the user acts on) a dead end. Option C
  leaves a dock where some buttons work and others fail with "No workspace folder open".

**Choice:** B. One `GitRootResolver` replaces both private resolvers in each git handler. Its
policy is `'folder-or-worktree'` for every `git:*` method except `git:addWorktree` and
`git:removeWorktree` (`'folder'`), so the dock cannot remove the worktree it is scoped to. Safety
hardening:

1. `discardChanges` and `discardAll` take the confirmed `workspaceRoot` explicitly, and the tree
   passes `pending.workspaceRoot`.
2. The discard confirmation names the worktree when the scope is not the workspace folder.
3. Each call names exactly one root. Paths stay relative and traversal-checked. Nothing resolves
   a path against a second root.

**Reversible:** yes. Narrowing the policy table puts back the read-only rule.

---

## D6. The existing read-only worktree scope bar — reuse or replace

**Options**

- A. Replace it with the new scope header.
- B. Keep it unchanged for foreign roots. Add the new dock-wide scope header above the dock
  header.

**Evidence**

- The bar shows while the Changes tab views a root that `ReviewNavigationService.isForeignRoot`
  judges foreign. "Foreign" means not equal to `gitStatus.activeWorkspacePath()`
  (`review-navigation.service.ts:255-262`, `review-shell.component.ts` viewedRoot/`worktreeStatus`
  wiring, `worktree-scope-bar.component.ts:21-85`).
- Under D4, the session's own worktree becomes `activeWorkspacePath`. A change set from the
  active session is then no longer foreign and opens editable, with no change to the bar's code.

**Choice:** B. The bar keeps its meaning: "you are looking at a root other than the dock's
scope". This now only happens for a change set or file from a non-scoped session. Its "Back"
action is unchanged.

**Reversible:** yes.

---

## D7. Backend watcher lifetime: lease protocol — SUPERSEDED by D16 (lease protocol kept; timer, lease cap, primary reconcile, lease set narrowed)

**Options**

- A. Imperative `acquire(root)` / `release(root)` RPCs with a refcount.
- B. A declarative `git:watchRoots { leaseId, roots }`. It replaces the lease's whole set. The
  pool refcounts roots across leases, caps concurrent secondary watchers with LRU eviction, and
  expires leases that are not renewed.
- C. Implicit leases started by `git:info` reads, with a TTL.

**Evidence**

- The Electron watcher is one target, re-armed on switch (`git-watcher.service.ts:530-551`). The
  frontend cache TTL is short because background roots get no pushes
  (`git-status.service.ts:216-231`).
- The primary watcher excludes agent worktree directories and nested repos
  (`git-watcher.service.ts:600-616`), so a session worktree's edits produce no push today.
- `IWorkspaceWatcher` supports several independent subscriptions
  (`libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.ts:360-361`,
  "dispose stops delivery for that subscription only").
- A renderer reload throws away frontend state. With option A, every acquire made before the
  reload leaks. Option C hides the lifetime inside a read path.

**Choice:** B.

- One renderer lease id per `GitDockScopeStore` instance.
- The set is ordered by priority: the dock scope root first, then the open sessions of the
  active workspace. It is capped at 4 on the frontend.
- The backend pool keeps `Map<leaseId, {roots, renewedAt}>` and computes refcount = number of
  leases holding a root. It holds at most `MAX_SECONDARY_ROOT_WATCHERS = 4` watchers and evicts
  the least-recently-requested root beyond that. A root equal to the primary watcher's root is
  skipped. Leases not renewed within 180 s are dropped on the next `setLease` call (no backend
  timer).
- The frontend renews every 60 s, only while its set is non-empty, with one interval that is
  cleared when the set empties and on destroy.
- Release: a root leaves every lease → its watcher is stopped at once.

**Reversible:** yes. The constants live in one file.

---

## D8. Where the per-root watcher code lives (host boundary)

**Options**

- A. A host-owned RPC handler in `apps/ptah-electron` (the `hostHandlers` map).
- B. A library handler `GitWatchRpcHandlers` in rpc-handlers, behind a new capability
  `gitRootWatch` and a platform-core port `IGitRootWatchRegistry`. It is registered only in
  Electron, like `appUpdater`.

**Evidence**

- Host-owned entries are being retired: "These entries shrink to zero as the handler families
  are unified" (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:9-12`).
- Precedent for an Electron-only port plus capability: `PLATFORM_TOKENS.APP_UPDATER` is
  "Registered only by hosts whose profile sets `appUpdater: true`"
  (`libs/backend/platform-core/src/di/tokens.ts:135-139`). It is bound only in
  `apps/ptah-electron/src/di/phase-4-handlers.ts:193-196`, and its manifest entry is
  `requires: ['appUpdater']` (`manifest.ts:489-493`).
- Capabilities a host omits default to `false` (`host-profile.ts:83-86`,
  `apps/ptah-electron/src/rpc-host-profile.ts:1-8`). VS Code and CLI then exclude the method,
  and their surface specs list the excluded methods
  (`apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:34,229`,
  `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:37,117`).
- `git:` is already an allowed prefix (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:72`).
  The host-source baseline only guards names that match
  `/turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage/`
  (`libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-18`), so
  `git:watchRoots` needs no baseline exception.

**Choice:** B. VS Code and TUI/CLI get the smallest change: one entry in each expected-absent
capability list and method list. They need no adapter.

**Reversible:** yes.

---

## D9. Push isolation: payload root and key normalization — "resolver returns canonical spelling" SUPERSEDED by D15; rest kept

**Evidence**

- `git:status-update` already carries `workspaceRoot`
  (`libs/shared/src/lib/types/messages/git-status.ts:47-58`). The watcher sets it from its own
  target (`git-watcher.service.ts:1193-1215`).
- `GitStatusService.applyGitInfo` routes by a raw string compare (`git-status.service.ts:447-466`).
  `GitBranchesService.handleMessage` drops pushes by raw string compare
  (`git-branches.service.ts:213-218`). `ReviewDiffService` already normalizes
  (`review-diff.service.ts:417`).
- `_workspaceGitState` is an unbounded `Map` (`git-status.service.ts:214`).

**Choice:**

- No payload change is needed.
- GitStatusService keys its cache by `normalizeWorkspaceRoot` (shared) and compares normalized.
- GitBranchesService compares normalized.
- The cache is bounded at `MAX_CACHED_ROOTS = 12`, evicting the least-recently-updated
  non-active entry.
- The resolver (D2) and the backend (`liveWorktreeOf` returns the git-listed path,
  `git-workspace-root.ts:84-91`) use the same spelling. Normalization is defence in depth.
- Secondary watchers run with the agent-worktree audit off. That audit prunes worktrees from the
  main checkout and broadcasts `git:worktreeChanged` (`git-watcher.service.ts:925-975`), and it
  must stay single.

**Reversible:** yes.

---

## D10. The stats card git cell opens the dock scoped to that session

**Options**

- A. The cell click pins the dock to that session's tab, unless that tab is already active, in
  which case it stays in follow mode. It then opens the dock on the Changes tab.
- B. The cell click activates the tab (switches chat), and follow mode does the rest.

**Evidence**

- The board-layout git cell is a static `<span>`
  (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:831-845`).
  Its host card already emits navigation outputs (`compact-session-activity.component.ts:856-881`).
- The dock opens through `ElectronLayoutService.setEditorPanelVisible(true)`
  (`libs/frontend/core/src/lib/services/electron-layout.service.ts:237-239`).
- chat reaches git-ui services only by dynamic import of `@ptah-extension/git-ui/services`
  (`workspace-coordinator.service.ts:128`).
- Option B hijacks the user's chat focus (the board exists to watch many sessions without
  switching).

**Choice:** A. A chat service `SessionGitDockOpener.open(tabId)` dynamically imports
`GitDockScopeStore`, calls `showSession(tabId)`, selects the Changes tab and opens the dock. The
card's stats root and the dock's root come from the same resolver (D1), so the numbers match.

**Reversible:** yes.

---

## D11. Pin semantics and persistence

**Choice:**

- Pinned scope = `{ tabId, root }`.
- While the tab exists, the root is re-resolved from its candidate (deterministic, and it follows
  a worktree change on that session).
- When the tab is closed, the last root is kept and labelled "session closed" until the user
  unpins.
- The pin is not persisted across reload: the request did not ask for it, and follow mode is the
  documented default.
- On a workspace switch or removal, the pin clears when its root belongs to that workspace.

**Evidence:** none in the repo requires persistence. `ReviewNavigationService` also keeps its
scope in memory only (`review-navigation.service.ts:128-133`).

**Reversible:** yes.

---

## D12. VS Code and TUI behaviour

**Choice:**

- The scope store follows sessions only when `vscode.config().isElectron === true`
  (`libs/frontend/core/src/lib/services/vscode.service.ts:24,151`). In other hosts its scope is
  always the workspace folder, which is today's behaviour, and it sends no leases.
- The backend root widening (D5) is host-neutral and also applies to VS Code. That is safe
  because the validation is identical. No VS Code UI is changed.

**Reversible:** yes.

---

## D13. Alignment with sibling TASK_2026_854 (feat/session-auto-links)

**Evidence:**

- The sibling worktree had no commits beyond main and no `contract-for-git-view.md` at design
  time (`git log main..HEAD` empty).
- Its context says it will "Expose the session -> worktree root mapping through a small
  documented contract" and that this branch owns `session-git-stats.store.ts`
  (`.claude-worktrees/feat-session-auto-links-6e9899b8a83f/.ptah/specs/TASK_2026_854_52e8/context.md:35-37`).

**Choice:** The resolver reads only the already-shipped field
`SessionOrganizationSummary.worktreePath` (TASK_2026_580). If the sibling publishes a different
mapping, only `ChatGitSessionScopeSource.candidateFor()` changes, because the resolver input is
plain strings.

**Risk:** the sibling may also edit `compact-session-card.component.ts` (session card shows its
task). Our edit there is limited to two small hunks: an `(openGit)` binding and the organization
path argument.

**Reversible:** yes.

---

## D14. Sibling contract published — confirmed match

**Evidence:** `.claude-worktrees/feat-session-auto-links-6e9899b8a83f/.ptah/specs/TASK_2026_854_52e8/contract-for-git-view.md`
(read 2026-10-30):

- `:12-18` — the git root is `SessionOrganizationSummary.worktreePath`; `null` means "use the
  workspace root". This is the field D13 already uses.
- `:34` — `session:list` rows carry `ChatSessionSummary.organization.worktreePath / branch`. This
  is the `ChatStore.sessions()` row read in plan section 9.
- `:43-57` — the webview accessor `SessionOrganizationCache.organizationFor(sessionId)` is ADDED by
  TASK_2026_854 and does not exist on `main`. Its first step is the same `session:list` row read.
- `:29-30` — paths are not re-normalized; we compare with the resolver's own normalization.
- `:38-39` — when `organizationAvailable()` is false (VS Code), treat as "no worktree known". The
  resolver then falls through to agent origin / partition / workspace root, as planned.
- `:63` — no new git RPC or push from that task.

**Choice:** No plan change. All organization reads go through ONE method,
`ChatGitSessionScopeSource.organizationWorktreeFor(sessionId)`, that reads the `session:list` row.
This branch does not import the sibling's new cache file (it is not on `main`). After both PRs
merge, a follow-up replaces that one method body with `organizationFor(id)()?.worktreePath ?? null`
to gain the `session:getOrganization` fallback and the `session:organizationChanged` refresh.

**Merge note (contract `:65-71`):** the sibling adds a `[linkedTask]` binding near `[gitStats]` in
`compact-session-card.component.ts`. Our `(openGit)` binding is in the same template region. Keep
both bindings on conflict.

**Reversible:** yes.

---

## D15. Frontend resolver does not validate; the backend is the only authority (plan-review 3, 6)

**Evidence:** plan-review.md findings 3 and 6. The planned frontend check used the single global
`WorktreeService._worktrees` list (`worktree.service.ts:49-58,81-99`), which publishes whichever
response finishes last and is loaded for the current dock root only, so a fast A→B→A switch could
"validate" a candidate against the wrong folder's list, and a `null` list let the header label an
unverified root editable.

**Choice:**

- `resolveSessionWorkingRoot` keeps the D2 precedence (organization → agent origin → session
  cwd → workspace root) and returns the first non-empty candidate, trimmed, in the caller's
  spelling. It takes no `openFolders` / `registeredWorktrees` input and returns no `rejected`
  list. `isSameWorkingRoot` (normalized compare) is exported beside it.
- Every `git:*` call and `git:watchRoots` re-validates the root on the backend
  (`GitRootResolver`). A refused root shows the dock's existing "unavailable" state with the
  scope header still visible, so the user can unpin or switch tabs. No frontend registration
  state, so no `loaded` flag on `WorktreeService`.

**Reversible:** yes.

## D16. Watcher pool lifetime (plan-review 2)

**Choice:**

- One timer per pool, scheduled at the nearest lease deadline (`renewedAt + LEASE_TTL_MS`,
  180 s), `unref`'d, rescheduled on every change and cleared on `dispose()`. An expired lease is
  deleted and its watchers stopped without any further RPC.
- At most `MAX_LEASES = 16` leases; a new lease beyond that evicts the least recently renewed.
- At most `MAX_SECONDARY_ROOT_WATCHERS = 4` watchers; a lease holds at most 8 roots (Zod), the
  renderer sends at most 4.
- The pool owns one `reconcile()` that recomputes the desired set (union of live leases, minus
  the primary watcher's root, capped by most-recent request) and starts/stops watchers. It runs on
  `setLease`, on expiry, on `attach`, and whenever the primary watcher's root changes, so a root
  skipped because it was primary is armed once it no longer is.

**Reversible:** yes.

## D17. No positive authorization cache (plan-review 4)

**Evidence:** `findRegisteredWorktree` already checks list membership, `prunable`, directory
existence and a matching common dir per call (`git-workspace-root.ts:54-99`), and the current
read path calls it on every request with no cache (`git-rpc.handlers.ts` `resolveReadRoot`).

**Choice:** `GitRootResolver` keeps no cache. Every call, read or write, re-validates. A worktree
removed or replaced between two writes is refused on the second one. The cost is the same as
today's read path.

## D18. Write gate

**Choice:**

- Mutating `git:*` methods accept a named root only when it is a registered workspace folder or a
  live worktree of one, validated per call (D17). `git:addWorktree` / `git:removeWorktree` stay
  folder-only.
- A refused named root never falls back to the active folder.
- Discard sends the root the user confirmed (not a re-read of the dock root), and its confirm copy
  names the worktree.
- `git-info.service.ts` is unchanged: its `isInsideRoot` protection for direct file reads and the
  `validatePaths` traversal check still apply inside the validated root.

## D19. TASK_2026_854 seam (organization worktree lookup)

**Evidence:** contract-for-git-view.md (854 worktree): `SessionOrganizationCache.organizationFor(
sessionId)` exists only on `feat/session-auto-links`, not on `main`; `session:list` rows already
carry `organization.worktreePath` on `main`.

**Choice:** all organization reads go through ONE injectable, `SessionWorktreeLookup`
(`libs/frontend/chat/src/lib/services/session-git-scope/session-worktree-lookup.service.ts`) with
one method, `worktreeFor(sessionId: string | null): string | null` (a reactive read). On `main` it
reads the `ChatStore.sessions()` row. After 854 merges, the follow-up is a one-line body change to
`this.organizationCache.organizationFor(id)()?.worktreePath ?? null` (gains the
`session:getOrganization` fallback and the `session:organizationChanged` refresh). When no
worktree is known, the resolver falls through to agent origin → session cwd → workspace root, so
the dock works on `main` today.

## D20. Electron DI guards are required (plan-review 5)

**Choice:** `GitWatchRpcHandlers` and `PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY` are added to
`apps/ptah-electron/src/di/expected-resolvable.ts`, covered by `container.smoke.spec.ts`, and
`git:watchRoots` is asserted present in the Electron `rpc-surface.spec.ts` (and absent in the VS
Code and CLI surface specs).

## D21. Effect tracking in `GitDockScopeStore` (plan-review 1)

**Choice:** the store's `effect()` reads every input signal (active/pinned candidate, workspace
path, Electron flag) in its tracked body and passes plain snapshots into an untracked
`reconcile(snapshot)`. A test switches only the active tab (no workspace switch) and asserts the
fan-out.
