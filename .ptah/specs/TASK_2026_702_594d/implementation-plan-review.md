# Implementation Plan Review - TASK_2026_702_594d (Gate 2, round 0)

Reviewer: Anthropic-side independent reviewer (read-only). Plan author: codex CLI lane.
Inputs read: `implementation-plan.md`, `task-description.md` (AC1-13, line 33 as amended),
`decisions.md` #1-#15, `design-spec.md`, `design-revision-1.md`, `design-revision-2.md`,
`design-spec-review.md`, `parity-inventory.md`, `context.md`, `prototype/aurora-notices.txt`.
Source spot-checks against the worktree at `eed1fac30`.

Verdict: REVISE

Counts: Blocking 0 | Serious 3 | Moderate 5 | Minor 7

What holds up: every AC maps to a batch (plan:66-77); the preserve-list trace (plan:79) covers
parity rows 10-37 with only the approved removals (#9 dock, ticker, Thoth target; #10/#11 chip
gated); the notice shipping path is real (`apps/ptah-extension-vscode/project.json:48-52`,
`apps/ptah-electron/project.json:103-107`, `apps/ptah-electron/electron-builder.yml:120-121`);
the prototype notice text has no Marketplace scanner token (checked with
`scripts/brand-icons/scanner-tokens.mjs` `findScannerTokens` -> `[]`); Nx project names are
correct (`@ptah-extension/ui|chat|chat-ui|canvas`); `ui` is `type:ui` and `canvas`/`chat`/
`chat-ui` are `type:feature`, so feature -> ui is legal; canvas already imports
`@ptah-extension/chat` (`canvas-rail-board.component.ts:17`) and `SessionRowActionsService` is
public (`chat/src/lib/services/index.ts:122`, re-exported by `chat/src/index.ts`);
`ActivityTickerComponent` has exactly one production consumer
(`orchestra-canvas.component.ts:18,76,103`); the four `canvas-new-session-anchor` users plus the
source are the full literal set (`canvas.spec.ts:32,78,95,126`,
`new-project-question-routing.spec.ts:119,182`, `startup-tti.spec.ts:58`, `ui-driver.ts:453`);
`ptah-electron-e2e` has typecheck/lint but no unit test target; verification commands follow
`CLAUDE.md` (scoped, `--parallel=1`, `--maxWorkers=2`, no build/e2e); no notification-center
file is in any batch.

## Serious

### S1. The shared popover cannot anchor to the hero or footer button as designed

- Evidence: `NativePopoverComponent` positions only against its own projected trigger wrapper:
  `<div #triggerRef class="popover-trigger inline-block"><ng-content select="[trigger]" />`
  (`libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:84-85`),
  `triggerRef = viewChild('triggerRef')` (`:181-182`), `positionPanel(trigger, floating)`
  (`:218-222,248-261`). It has no external anchor input (`:129-179`). Today the only `[trigger]`
  is the dock button (`orchestra-canvas.component.ts:170-195`) that this task deletes. The hero
  lives in `CanvasRailBoardComponent` and the footer in `CanvasRailComponent`, both below the
  shell. Plan:35 says "Hero invokes the existing shared popover anchored to the actual hero
  button" and plan:47 "hero/footer -> board/rail `newSessionRequested` with trigger -> shell
  popover", but names no mechanism and no `ui` file. With the trigger slot empty the panel
  positions against an empty inline-block in the shell, violating AC2 and design-spec:19 (10px
  below the invoking button, flipped near the bottom).
- Required change: pick and specify the mechanism. Recommended: add an optional
  `anchor = input<HTMLElement | null>(null)` to `NativePopoverComponent` that `positionPanel`
  uses in place of `triggerRef` when set (default behaviour unchanged for the other consumers),
  pass the recorded invoking element from the shell, and add
  `native-popover.component.ts`/`.spec.ts` to a `ui` batch with a test that the panel positions
  against the supplied anchor and that existing trigger-slot consumers are unchanged. Change
  `newSessionRequested` from `output<void>()` (`canvas-rail-board.component.ts:286`) to carry the
  element, and state who owns it on the rail -> board -> shell path. Alternatively justify
  moving the popover into the board; either way, name the files.

### S2. `limit:3, sort:'lastActive'` does not return the three most recently active sessions

- Evidence: any request carrying `sort` is query mode (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:93-98,112`).
  In query mode the host sorts **pinned first**, then the sort key, then paginates
  (`libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts:15,86`). On a host with the
  organization store (Electron), `limit:3` therefore returns pinned sessions ahead of more
  recent unpinned ones, and the client-side re-sort the plan adds (plan:21,37) cannot recover
  rows the server never sent. AC9 requires "the three entries with greatest `lastActivityAt`".
  Plan:21 records only a sort-order assumption, not this cut.
- Required change: specify a request shape that is exact under pinned-first ordering. One
  bounded option: two calls in query mode, `pinned:true` and `pinned:false`, each `limit:3`,
  merge, sort by `lastActivityAt` desc with a stable tie-break, take 3 (archived stays excluded
  by query mode). State the archived-exclusion choice and test it with a fixture where an older
  pinned session would otherwise displace a newer unpinned one, on both an
  `organizationAvailable` and a non-organization (VS Code) response.

### S3. Selector and accessible-name dependents beyond `canvas-new-session-anchor` are not re-targeted

- Evidence: the deleted dock button carries `title="Add new session tile"`
  (`orchestra-canvas.component.ts:180-184`). Neither replacement carries it
  (`canvas-rail.component.ts:234-244` footer, `canvas-rail-board.component.ts:145-154` empty
  board). These locate by that title and will silently break (e2e is never run in this task's
  verification):
  `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:173`,
  `apps/ptah-electron-e2e/src/specs/task-370-concurrent-session-isolation.spec.ts:127`,
  `apps/ptah-electron-e2e/src/docs-screenshots/sessions.shot.ts:59`,
  `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:73`,
  `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts:236`,
  `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts:62`.
  Separately, the design renames the Skills action to "Open Library" (design-spec:43,123), but
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-servers.e2e.spec.ts:207,228`
  finds `getByRole('button', { name: 'Open Marketplace Skills' })`. Decision #11 (SC1) intends
  that no existing e2e caller breaks; plan:41 and plan:93 searched only the test id.
- Required change: add these seven files to the selector batch (2D, or split it to stay under
  about eight files; `webview-e2e-harness` is a separate project with typecheck/lint only) and
  re-target them to the new hero / footer test ids (keep the "empty board vs tiles exist"
  branch the scenes already use), and to the new Skills action name. Widen the closing literal
  search to `canvas-new-session-anchor`, `Add new session tile`, `Open Marketplace Skills`,
  `canvas-dock` and `activity-ticker-host`, and require zero hits outside deleted files.

## Moderate

### M1. Aurora export path contradicts the enforced barrel rule; files missing

- Evidence: `libs/frontend/ui/src/index.ts` and `libs/frontend/ui/src/lib/native/index.ts:10-14`
  must stay pure `export * from` lists, enforced by `native/brand-mark/brand-mark-barrels.spec.ts`.
  Plan:31 says "exported only via `libs/frontend/ui/src/index.ts`" and lists that file as
  modified (plan:56).
- Required change: create `libs/frontend/ui/src/lib/native/aurora/index.ts`, add
  `export * from './aurora';` to `libs/frontend/ui/src/lib/native/index.ts`, leave
  `libs/frontend/ui/src/index.ts` untouched; update 1B's file list and require
  `brand-mark-barrels.spec.ts` to pass.

### M2. Deleting `SetupStatusWidgetComponent` breaks a chat public re-export not in 1A

- Evidence: `libs/frontend/chat/src/lib/components/index.ts:118-127` re-exports
  `SetupStatusWidgetComponent` from `@ptah-extension/chat-ui` (deprecated alias).
  1A lists only `chat-ui/src/index.ts` (plan:55).
- Required change: add `libs/frontend/chat/src/lib/components/index.ts` to 1A and drop the
  re-export; confirm with a literal search that no other consumer exists.

### M3. The temporary chip mount has no defined owner file or position

- Evidence: plan:41 keeps the chip "in a temporary board/rail attention position", but 2B owns
  board/rail and Phase 3 owns only `orchestra-canvas.component.ts`/`.spec.ts` (plan:62). If the
  mount lands in board or rail, Phase 3 must edit those files too. The chip is also stubbed in
  `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts:130`, which Phase 3 does not list.
- Required change: state that the temporary mount stays in `orchestra-canvas.component.ts`
  (for example an in-flow or corner slot inside `session-viewport`, keeping its
  `@defer (on idle)` and placeholder), that it must not cover the board notice or hero, and add
  `orchestra-canvas.rail.spec.ts` to 2C and to Phase 3. With that, the single cross-phase
  exception for `orchestra-canvas.component.ts` is sound: phases are sequential, Phase 3 is
  gated, and TASK_2026_593 does not edit the file (task-description:30).

### M4. Intra-phase dependencies are not stated, though batches look parallel-safe

- Evidence: 2B consumes 2A's `RecentSessionsStore` export; 2C binds 2B's new notice input,
  dismissal output and trigger-carrying `newSessionRequested`, plus the S1 anchor; 2D re-targets
  ids that 2B/2C create. All of 2B and 2C run in the same `@ptah-extension/canvas` test target,
  so a 2B run sees 2C's half-done state if they run concurrently. Plan:51 says only "batches
  within a phase are file-disjoint".
- Required change: state the order 2A -> 2B -> 2C -> 2D (or merge 2B/2C contracts first), and
  name the board <-> shell contract (input names, output payload types) so 2B and 2C build
  against one definition.

### M5. Phase 3 lacks the branch-sync step and a plan for 593 not having merged

- Evidence: plan:62 gates Phase 3 on TASK_2026_593 merging but does not say that this branch
  must be updated from `main` first, nor what ships if phases 1-2 finish before that merge
  (user CLAUDE.md requires a PR for finished work).
- Required change: add "merge or rebase `main` into `feat/chat-start-screen` after 593 merges,
  resolve conflicts (likely `chat-ui/src/index.ts`, `orchestra-canvas.component.ts` imports),
  then run Phase 3". State the default: open the PR for phases 1-2 with the temporary chip
  mount, and land Phase 3 on the same branch before merge or as a follow-up PR.

## Minor

- m1. Plan:51 says `orchestra-canvas.component.ts` is the only cross-phase file; 
  `libs/frontend/chat-ui/src/index.ts` is edited in 1A and 2C (plan:55,60). Sequential, so safe;
  correct the statement.
- m2. The 2C row (plan:60) embeds 2D's files inside 2C's cell; move them to 2D only so file
  ownership is unambiguous.
- m3. `<main>` before the rail in DOM (plan:35, design-spec:62) also changes Tab order on
  populated boards, where "rail keyboard model" is out of scope (task-description:29). Say
  whether the reorder applies only to the empty board, and keep a spec that the rail keyboard
  handler (`orchestra-canvas.component.ts:64`, `onRailKeydown`) is unaffected.
- m4. Place `aurora-notices.txt` deliberately: `brand-mark/` holds the generated
  `brand-icons-notices.txt` (`scripts/brand-icons.manifest.json:14`). Reusing that `input`
  directory is acceptable, but note the file is hand-maintained, and add a static check that it
  returns no `findScannerTokens` hit (the VSIX scanner rule in
  `scripts/brand-icons/scanner-tokens.mjs`).
- m5. `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts:13-17`
  documents the ticker's host as the canvas dock; its assertions (absence) still pass, but the
  comment becomes false. Update it in 2C or 2D.
- m6. Task NFR (task-description:44) says recent sessions come from `ChatStore.sessions`/
  `loadSessions`; the plan's dedicated read is justified (plan:86, `session-loader.service.ts:497-550`
  spreads dialog filters) and serves AC9, but it should name itself a deviation from that line.
- m7. Specify `SetupStatusStore` scope (root singleton vs component provider) and its refresh
  triggers (workspace change, after wizard launch), since board(s) and single-chat now share it;
  and note the `role=alert` (persistence) / `role=status` (cap) split from design-spec:62
  supersedes AC12's "status semantics" wording.

## User decisions needed

None. All findings are work the plan can settle from source. The Phase 3 shipping default in
M5 is an orchestrator decision; escalate only if the orchestrator wants to hold the PR until
TASK_2026_593 merges. Archived-session exclusion in S2 follows the host's query-mode default
and AC9 is silent on it; record it under Decisions rather than asking.

## Round 1 re-review

Inputs: revised `implementation-plan.md`, `implementation-plan-revision-1.md`, this file's
round-0 findings. Fresh source spot-checks and literal greps against the worktree.

Verdict: APPROVED

Counts (new findings): Blocking 0 | Serious 0 | Moderate 2 | Minor 2

### Findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 popover anchor | Resolved | Plan:29,33 add `anchor = input<HTMLElement \| null>(null)`, `anchor() ?? triggerRef()?.nativeElement`, and `HTMLElement` payloads on rail `newSession` and board `newSessionRequested`. Matches source: positioning reads only `triggerRef` (`native-popover.component.ts:181-182,218-222`); board output is `output<void>()` today (`canvas-rail-board.component.ts:286,881-882`) and forwards rail `(newSession)` (`:115`). Spec file exists (`popover/native-popover.component.spec.ts`) and is in 1B. Focus restore also works natively: `openPopover` records `document.activeElement` (`:216`), which is the clicked hero/footer button. |
| S2 recent top three | Resolved | Two query-mode reads `pinned:true`/`pinned:false`, `limit:3` each, merge, dedupe, sort, take 3 (plan:37). Exact: the pin predicate filters before sort and paginate (`session-list-query.ts:77-92,119`; `session-rpc.handlers.ts:460-466`); with no org map the predicate is text-only (`session-list-query.ts:110`), so dedupe covers the duplicate responses; archived excluded by default (`:117`). `pinned`, `sort`, `limit` exist on `SessionListParams` (`rpc-session.types.ts:84,107,113`); `lastActivityAt` exists on the summary (`claude-domain.types.ts:76`). Fixtures listed in 2A (plan:54). |
| S3 selector dependents | Resolved, with one omission (N1) | All eleven Electron/harness callers are in 2D (7 files) or 2E (4 files) (plan:57-58); closing search widened to five literals (plan:63). My grep of the five literals finds every hit inside a batch-owned or deleted file except `apps/ptah-docs/src/content/docs/canvas/index.md:41` (N1). |
| M1 Aurora barrel | Resolved | `aurora/index.ts` + `native/index.ts` star export, root untouched, barrel spec required (plan:27,52). Rule confirmed at `brand-mark-barrels.spec.ts:88-103`. |
| M2 chat re-export | Resolved | 1A owns `chat/src/lib/components/index.ts` (plan:51); re-export at `:123`; no other consumer outside 1A files (grep). |
| M3 chip mount | Resolved | Stays in shell `session-viewport`, `@defer (on idle)` kept (plan:35); `orchestra-canvas.rail.spec.ts` in 2C and phase 3 (plan:56,59). Four queue files exist and only the shell and its two specs reference them. |
| M4 phase-2 order/contracts | Resolved | Order 2A -> 2B -> 2C -> 2D -> 2E and named board contract (plan:47). |
| M5 gate and branch sync | Resolved | Phase 3 updates from `main` after TASK_2026_593 merges (plan:59); phases 1-2 ship as their own PR if the gate is closed (plan:61). |
| m1-m7 | Resolved | plan:47 (overlap list), 56-58 (2C/2D split), 33 (empty-board DOM order only, `onRailKeydown` spec), 41 (hand-maintained notice, scanner check), 43/56 (ticker harness comment in 2C), 37 (named deviation), 23/35 (root store, refresh triggers, alert/status split). |

Structural checks: batches are file-disjoint within each phase; largest batches are 1A and 1B at
eight files; each batch names its own scoped proof; phase-2 order is stated; phase 3 is last and
gated on TASK_2026_593 with a branch update from `main`; phases 1-2 ship alone. Verification
commands follow `CLAUDE.md`.

### New findings

#### Moderate

N1. User docs still name the deleted dock button, and the plan's own closing search will fail.

- Evidence: `apps/ptah-docs/src/content/docs/canvas/index.md:41` says "Click **Add new session
  tile** in the canvas toolbar". No batch owns this file, yet plan:63 requires zero hits for
  `Add new session tile` outside deleted files.
- Required change: add the file to 2E (four files today) and rewrite the step for the hero
  button on an empty board and the rail footer button once tiles exist. Line 67 ("lock control in
  the toolbar") does not refer to the dock and stays.

N2. The shell popover host has no specified placement or attributes once its trigger is gone.

- Evidence: the cap semantics sit on the popover host, not only on the button:
  `[attr.tabindex]` 0, `role="group"`, `aria-label="New Session unavailable"` and `title` when
  `canStartRunningSession()` is false (`orchestra-canvas.component.ts:149-169`). With the
  projected trigger deleted, that host becomes an empty focusable group, a phantom tab stop.
  Also, the panel renders in normal flow, hidden but taking space, until Floating UI sets
  `position: fixed` (`native-popover.component.ts:103-106`; `floating-ui.service.ts:180`). A
  host placed as a child of the `flex flex-col` grid (`orchestra-canvas.component.ts:81-84`)
  would briefly push down `session-viewport` on every open. Plan:29 says only "single shared
  named popover".
- Required change: state that the shell removes the host-level cap attributes, because cap
  semantics move to the focusable `aria-disabled` hero and footer (plan:33). Place the host out of
  flow, for example as a zero-size absolute element inside the relative `canvas-grid`, and keep
  the `@if (canvasStore.canAddTile())` guard. Add 2C specs that the host is not focusable when
  capped and that opening the popover does not change the session-viewport height.

#### Minor

- n1. 2E's proof names the Nx project `webview-e2e-harness`. Its name is
  `@ptah-extension/webview-e2e-harness` (`libs/frontend/webview-e2e-harness/project.json:2`).
  2C also edits a harness file (the ticker comment) but lists no harness typecheck or lint.
  Correct the name and add the harness lint step to 2C.
- n2. After the deletions, comments still name the removed components:
  `webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts:19,170`
  (`ptah-activity-ticker`) and `chat-ui/src/lib/atoms/skeleton-block.component.ts:12`
  (`setup-status-widget.component.ts`). The closing search does not cover them. Optional: fix the
  boot comment in 2C and the skeleton comment in a batch that has room, or accept them as
  historical notes.

### User decisions needed

None. N1 and N2 are work the plan can settle from source. Neither blocks approval, but the
team-leader should carry both into 2E and 2C when decomposing.
