# Plan part A2 - Header (§5), composer (§6), motion (§7) - TASK_2026_677_efcd

Status: COMPLETE for A2 scope; open items under "Open checks" (O1 needs Part B's answer).

## Summary

Scope: design-spec.md §5 (lines 694-716), §6 (720-736), §7 (740-778); task-description.md requirement 12.2-12.5
(lines 488-496) and 13 (lines 498-509). Header/inspector state (inspector component, open-state store, inspector
aggregate) belong to part B; A2 binds to them through the contract below.

## Host evidence (which component renders a session header today)

| Evidence | Location | Implication |
| --- | --- | --- |
| VS Code / Electron single view: NO per-session header exists. `app-shell` owns a global navbar (`min-h-[40px]`, dashboard/Thoth/tab-bar/actions) and the sidebar state | `app-shell.component.html:550-554`, `:664` (`<ptah-tab-bar />`), `:829` (`<ptah-chat-view />`); `app-shell.component.ts:245-246` (`_sidebarOpen` local signal), `:498-499` (`toggleSidebar()`) | The §5 header is NEW and must live in `chat-view` (app-shell is off-limits, decisions.md row 35). |
| `chat-view` full view starts with the agent-origin banner, then stats strip, tray; composer at `:246` | `chat-view.component.html:15-51`, `:246` (`<ptah-chat-input />`) | Header inserts at the top of the full-view branch (before `agent-origin-banner-slot`). |
| Rail: `ptah-canvas-focus-header` is the session header (48 px `<header>`, title `<strong>`, branch chip from `tab.agentOrigin.branch`, model, state chip incl. `needs`, Stop, view-mode toggle A-4, split Details, overflow menu, Close) | `canvas-focus-header.component.ts:36-82`, inputs `:87-111`; bound in `canvas-focus-area.component.ts:34-55` (`[branch]="tab()?.agentOrigin?.branch ?? null"` at `:38`) | Rail already has a header with Rail-only controls; a second header inside the Rail transcript would duplicate it. |
| Rail transcript and Tribunal conductor tiles host `chat-view` with `SESSION_CONTEXT` | `canvas-detail-transcript.component.ts:70-79`; `conductor-tile.component.ts:218-221` | `chat-view` can tell the main host from tile hosts by `_sessionContext === null` (`chat-view.component.ts:276-278`). |
| Part B gates its inspector on `hostsInspector = computed(() => !this._sessionContext && !(this._forcedCard?.() ?? false))` | `plan-part-b-inspector.md:451` | The header uses the same predicate (one source): header and inspector toggle appear exactly where the inspector can open. |

Shared header component: NOT feasible as one component across hosts. `canvas-focus-header` carries Rail-only controls
(pane marker, Stop, split Details, swap/close pane menu, Close; `:41-81`) and 648 adds its workflow badge there in its
own element (decisions.md row 34-35). A shared PRESENTATIONAL chip is also not worth it (two hosts, different recipes:
Rail `rounded bg-base-200 px-1.5 text-xs` vs §5 bordered 22 px mono chip). Rail keeps `canvas-focus-header`
unchanged by A2 (parity A-4 keep; design-spec.md:303, :1121). Part B touches its Details gate only.

## Components

### 1. `SessionHeaderComponent` (CREATE, chat lib, molecule)

- Selector `ptah-session-header`; standalone, OnPush, `input()`/`output()`, lucide icons.
- Path: `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts` (inline template,
  matches `canvas-focus-header` single-file style; no new spec file - see "Existing specs").
- Inputs: `title: string`, `branch: string | null`, `needsYouCount: number`, `inspectorOpen: boolean`,
  `inspectorDot: 'need' | 'sel' | null`, `toggleLabel: string`, `inspectorId: string` (default `'inspector'`).
- Output: `inspectorToggled: void`. Exposes `titleEl` (`viewChild<ElementRef<HTMLElement>>('title')`) and
  `toggleEl` for Part B's `attach(shell, opener, title)`.
- Template (order = DOM = tab order, §5): h1 title (`tabindex="-1"`, `truncate`) -> spacer ->
  `<ng-content select="[sessionHeaderChip]" />` -> branch chip (`@if (branch())`, hidden via container query
  < 640 px) -> needs-you chip (`@if (needsYouCount() > 0)`, `role="status"`) ->
  `<ng-content select="[sessionHeaderAction]" />` -> inspector toggle button.
- Sidebar toggle: OMITTED (Decision A2-1).
- Pure presentational: no store injection (the host passes values); keeps it testable from the existing
  `chat-view` spec and keeps dependency direction trivial (chat -> chat).

### 2. `ChatViewComponent` header + motion wiring (MODIFY, shared file with A1 and B)

- Renders `<ptah-session-header>` at the top of the full-view branch when `hostsInspector()` (Part B's computed).
- Owns the session-switch stagger trigger (§7.1) for all hosts (the thread and composer are inside chat-view in every
  host, including Rail).

### 3. `ChatInputComponent` composer chips (MODIFY)

- See "Exact edits" (top strip: workspace + branch hints; approval chip; model chip label rule).

### 4. Session-switch stagger (§7.1-7.3, req 13.1-13.3, req 15.7)

Evidence: easings already on `:host` (`chat-view.component.css:71-74`); `ptahFadeIn` keyframe and the
reduced-motion block for `banner-enter`/`fade-enter` exist (`:105-112`, `:139-147`); the file already uses
`:host ::ng-deep` (`:62`), so reaching child-component classes from chat-view CSS has precedent. Transcript slots are
`.chat-msg-slot` wrappers in `chat-transcript.component.html:35-42`; a slot mounts its `ptah-message-bubble` only
inside the render window (`:43-46`), so only mounted bubbles are in the DOM. The turn items of design-spec §7.1 row 2
(user bubble, disclosure row, answer, chip row, action row) all render inside `message-bubble.component.html`, which
A1-3 rewrites (plan-part-a1-turn.md:108-142). `hostEl` is already injected (`chat-view.component.ts:274`);
`resolvedTabId` exists
(`chat-view.component.ts:809`); `resolvedSessionId` is `claudeSessionId`, which goes null -> id when a new
session gets its first id (`:798-807`), so it must NOT be the trigger.

- Trigger (TS, chat-view): an `effect` on `resolvedTabId()`; when it changes to a non-null value that differs from
  the last seen id, call `playEnter()`. View-mode switches do not change the tab id, so the stagger does not replay
  (req 15.7). Not keyed on `resolvedSessionId`.
- `playEnter()` runs in `afterNextRender` (scheduled from the effect with the component injector) so the new tab's
  bubbles are in the DOM. On the HOST element (`hostEl`, so Part B's root `<div>` attributes are untouched):
  1. Index pass (once per switch, not per item over time): `hostEl.nativeElement.querySelectorAll('.st-t')` returns
     the mounted turn items in DOM order; set `el.style.setProperty('--i', String(Math.min(k + 1, 8)))` for item
     `k` (0-based). Every item gets a value; items 8 and later all get `8` (the shared capped delay), so long threads
     still animate every item and never cascade past 360 ms.
  2. `classList.remove('is-entering')`, read `offsetWidth` (reflow), `classList.add('is-entering')`, `clearTimeout`
     of the previous timer, `setTimeout(remove, 1000)`. Release: `DestroyRef.onDestroy(clearTimeout)`.
  One timer and one DOM query per chat-view instance per switch; no observer, no per-item timer. A bubble that mounts
  while `is-entering` is still set (render window, late history) has no inline `--i` and takes the CSS fallback
  `var(--i, 8)` (capped delay); it still animates.
- CSS (chat-view.component.css), only `opacity`/`transform`:
  - `:host(.is-entering) .st-f` -> `ptahFadeIn 200ms var(--ptah-ease-soft) backwards`; the header gets `st-f` with
    delay 0, the composer wrapper (`chat-view.component.html` around `<ptah-chat-input />`, `:246`) gets `st-f` with
    `--d:120ms`.
  - New keyframe `ptahStaggerUp` (opacity 0 -> 1, translateY(6px) -> 0) on `:host(.is-entering) ::ng-deep .st-t`,
    260 ms, `var(--ptah-ease-soft)`, `backwards`, delay `calc(min(var(--i, 8), 8) * 45ms)` (45 ... 360 ms). The
    `.st-t` hook is a class only, put by A1-3 on the five item elements in `message-bubble.component.html`: the user
    branch `<article aria-label="You">`, the `ptah-turn-disclosure-row` host, the `.cs-answer` div, the
    `ptah-turn-agent-chips` host, the action-row wrapper. No ancestor of an item (slot, bubble host, assistant
    `<article>`) animates, so opacity never compounds. A1 sets no `--i` and no index logic; chat-view owns both.
    See Decision A2-3.
  - New keyframe `ptahStaggerLeft` (opacity 0 -> 1, translateX(8px) -> 0) on `:host(.is-entering) ::ng-deep .st-r`,
    260 ms, `backwards`, delay `calc(80ms + min(var(--i), 6) * 36ms)`. Part B puts `class="st-r"` and
    `style="--i:n"` on inspector header (0), orchestrator card (1), AGENTS (2), each agent row (3..), TODOS, GIT
    (contract note for B). Inspector toggle-open uses B's single 220 ms slide-in, no stagger.
  - Reduced motion (§7.3): `@media (prefers-reduced-motion: reduce) { :host(.is-entering) .st-f,
    :host(.is-entering) ::ng-deep .st-t, :host(.is-entering) ::ng-deep .st-r { animation: none !important;
    animation-delay: 0ms !important; } }` (global `styles.css` zeroes durations but not delays - design-spec.md:774).
    Live pulse, spinner and caret stop rules belong to A1 (turn) and C (dock).
- Worst case: 8 * 45 + 260 = 620 ms (req 13.1); restart via class removal + reflow leaves no element mid-animation
  (req 13.2).

### 5. Composer chips (§6, req 12.4-12.5)

Evidence (C-18, `parity-inventory.md:97`): composer template is inline in `chat-input.component.ts`: textarea `:230-239`
(placeholder `Ask a question or describe a task...`), attach popover `:281-330` (`aria-label="Attach files or
images"` `:296`), `<ptah-model-selector>` `:332`, `<ptah-effort-selector>` `:334-337`, voice (Electron only)
`:342-382`, Stop `:387-398`, Send `btn btn-circle btn-primary` `:401-411`, status line with
`<ptah-autopilot-popover [sessionId]="tabSessionId()">` `:419-422`, `ptah-mcp-status-chip` `:426-429`,
`ptah-peer-session-send` `:432`, auth label `:435-441`.

- Top strip (NEW, inside the card, above the field): workspace hint (`Folder` 14 + basename, `title` = full path) and
  branch hint (`GitBranch` 14 + mono name). Non-interactive (D8, `design-spec.md:1063`), no tab stops. Workspace
  label hidden below 640 px (icon only, design-spec.md:153). Branch hint absent when branch is null; the whole strip
  absent when both are null.
- Data: chat-input already injects `TabManagerService`, `SESSION_CONTEXT`, `VSCodeService` (imports list). Root =
  `sessionWorkingRoot(tab, tabs.findTabByIdAcrossWorkspaces(tabId)?.workspacePath ?? null,
  vscode.config().workspaceRoot)` (`session-git-stats.store.ts:83-89`; same call as
  `canvas-session-details.component.ts:144-153`). Branch = the shared `sessionBranch` helper (Decision A2-4).
- Approval chip: MOVE `<ptah-autopilot-popover>` from the status line into the bar right after the attach `+`
  (§6.3 order). Its trigger re-skin (`h-7 px-2 rounded-md text-xs font-medium`, `shield` 14, ink from
  `text-state-*`, `aria-haspopup="menu"`, aria-label `Approval mode: {mode}`) is a change to the chat-ui component
  `AutopilotPopoverComponent` (Assumption: its trigger markup is in that component; implementer opens it). Data stays
  `AutopilotStateService.stateFor(sessionId)` (req 12.4-12.5), so mode changes from anywhere show at once.
- Model and effort: keep BOTH existing controls (`ptah-model-selector`, `ptah-effort-selector`) and their popovers;
  wrap them in one chip-styled `role="group" aria-label="Model and effort"` (`h-7 px-2 rounded-md text-xs
  text-base-content-muted`), separator `·`. Below 640 px the effort selector shows its icon-only trigger (label text
  hidden), never removed (Decision A2-5; keeps C-18 effort reachable).
- Bar order: `+` -> approval chip -> spacer -> model/effort group -> mic -> send/stop. Send restyled to D1 (28 px
  `rounded-full bg-base-content text-base-100`, `ArrowUp` 16; `design-spec.md:735, :1056`). While streaming the
  existing Stop (`:387-398`) takes the same slot and size; the send button stays (queues, per comment `:400`) - see
  Open check O4.
- Status line keeps MCP chip, peer send and auth label (unchanged; not in §6 but no removal approved).
- Placeholder and visually hidden label: `Ask the orchestrator to plan, build or review...` / `Message the
  orchestrator`, except the read-only placeholder (`:235-236`) stays. Card classes per §6 header line; `field-sizing`
  auto-grow kept (`max-h` = 8 lines).
- Landmark: wrap in `<form aria-label="Message composer">` with `(submit)` prevented (design-spec.md:796) -
  Assumption: no existing form handler conflicts; implementer checks `handleKeyDown` `:1448-1469`.

## Exact edits per file

| File (abs path under worktree) | Action | Edit |
| --- | --- | --- |
| `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts` | CREATE | Component 1. Icons `PanelRight`, `GitBranch` from `lucide-angular`. Container query `@container (max-width: 639px)` hides the branch chip (B makes the shell a size container, B line 429). |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | MODIFY (shared with A1, B) | Insert the header block of the binding contract at the top of the FULL-view branch (before `:20`); add `class="st-f" style="--d:120ms"` to the composer wrapper around `:244-247`. Compact branch (`:4-14`): A2 adds nothing (A1/B own compact-card retirement; if the compact card stays, the header must still render above both branches - Open check O2). |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` | MODIFY (shared with A1, B) | Import `SessionHeaderComponent`; `store = inject(SessionInspectorStore)`; `inspectorModel` computed; `headerBranch` computed (A2-4 helper); `viewChild(SessionHeaderComponent)` exposing `toggleEl`/`titleEl` getters for B's `attach`; stagger `effect` + `playEnter()` + timer release. |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.css` | MODIFY (shared with B) | Keyframes `ptahStaggerUp`, `ptahStaggerLeft`; `.is-entering` rules; reduced-motion block (component 4). |
| `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` | MODIFY | Component 5 (top strip, bar order, approval move, model/effort group, send restyle, form landmark, placeholder). |
| `libs/frontend/chat-ui/src/lib/.../autopilot-popover.component.ts` (path: implementer locates via `AutopilotPopoverComponent` export) | MODIFY | Trigger re-skin only; popover content unchanged. |
| `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts` | MODIFY (owner: B, see A2-4) | `known` state gains `branch: string | null` from `result.branch.branch` (`rpc-git.types.ts:97-99, :134-136`) in `toState` (`:55-70`); add exported pure `sessionBranch(tab, gitState)` = `tab.agentOrigin?.branch ?? (gitState.kind === 'known' ? gitState.branch : null)`. |

Not touched by A2: `canvas-focus-header.component.ts` (Rail header, A-4 keep), app-shell, tab-bar, tab-item,
canvas-rail-card, canvas-detail-transcript, `chat-transcript.component.html`, `message-bubble.component.html` (the
`.st-t` item hooks are A1-3's; A2 owns the index pass, keyframes and trigger in chat-view).

## Header <-> inspector binding contract

Part B defines the API (`plan-part-b-inspector.md:255-298`); A2 consumes it unchanged. Binding, in
`chat-view.component.html` (chat-view provides `InspectorShellController`, B line 450):

```html
@if (hostsInspector()) {
  <ptah-session-header #sessionHeader
    [title]="resolvedActiveTab()?.title ?? ''"
    [branch]="headerBranch()"
    [needsYouCount]="inspectorModel().needsYouCount"
    [inspectorOpen]="shell.isOpen()"
    [inspectorDot]="shell.isOpen() ? null : shell.showDot()"
    [toggleLabel]="shell.toggleLabel()"
    (inspectorToggled)="shell.toggle()">
    <ng-container ngProjectAs="[sessionHeaderChip]"><ng-content select="[sessionHeaderChip]" /></ng-container>
    <ng-container ngProjectAs="[sessionHeaderAction]"><ng-content select="[sessionHeaderAction]" /></ng-container>
  </ptah-session-header>
}
```

- `inspectorModel = computed(() => store.modelFor(tabId)())` where `store = inject(SessionInspectorStore)` (B
  component 3, `:238`). A2 reads ONLY `needsYouCount`.
- Toggle button attributes: `aria-pressed=inspectorOpen`, `aria-controls=inspectorId`, `aria-label=toggleLabel`.
  The dot is `aria-hidden="true"`; the accessible name does not change with the dot (delta2-r1 Moderate 1).
- ONE dot, precedence owned by B's `showDot` (`need` before `sel`, `plan-part-b-inspector.md:264-266`). A2 adds one
  rule on top: no dot while the inspector is open (§5 line 705 "when the inspector is closed").
  Note for B: `showDot` must already return `null` when open, or A2's guard above stays; either is fine, not both
  needed. `sel` uses `--sel` token; `need` uses `bg-state-need`; both 7 px, 2 px `base-100` ring.
- `attach(shell, opener, title)`: opener = `sessionHeader.toggleEl()`, title = `sessionHeader.titleEl()`. B calls
  `attach` in `afterNextRender`; A2 exposes the two `viewChild` refs. Note for B: header is inside an `@if`; the
  opener/title getters must be lazy functions (B's signature already takes `() => HTMLElement | null`).
- Inspector element id: B's `<aside>` must carry `id="inspector"` (aria-controls target). Note for B.
- Slots: re-projected from `ChatViewComponent` so 648's session-embed can project into them later. Nothing binds them
  on main; empty slots render nothing.

## Parity row -> location

| Row | Today | A2 location |
| --- | --- | --- |
| A-3 | `tab-item.component.ts:72-83` view-mode toggle | Unchanged (A2 does not touch tab-item) |
| A-4 | `CV/canvas-rail/canvas-focus-header.component.ts:57-60` view-mode toggle | Unchanged (keep) |
| C-18 | `chat-input.component.ts` controls (see component 5) | Same component, re-skinned; every control kept; approval moves into the bar |
| D-7 | `canvas-session-details.component.ts:78-83`, `:124`, `TabState.agentOrigin.branch` | header branch hint + composer branch hint (A2, via `sessionBranch`) + GIT section (B) |
| req 12.2 | new | header `N needs you` chip + toggle dot (A2), count from B aggregate |
| req 13 | new | chat-view host class + CSS (A2); inspector row classes (B) |

## Data flow + empty/failure states

1. `TabManagerService.activeTab()` / `SESSION_CONTEXT` -> `resolvedActiveTab` / `resolvedTabId` (chat-view `:809`,
   `:984-992`).
2. Header title = `tab.title`; branch = `sessionBranch(tab, gitStore.stateFor(root))`; count =
   `SessionInspectorStore.modelFor(tabId)().needsYouCount` (B component 3); toggle/dot/label =
   `InspectorShellController` (B component 4).
3. Composer workspace/branch from the same root + `sessionBranch`; approval from `AutopilotStateService.stateFor`.
4. `resolvedTabId` change -> `playEnter()` -> host class for 1000 ms.

Empty/failure: no tab -> header not rendered (guarded by `resolvedActiveTab()`); empty title -> `h1` empty but present
(focus target); branch null or git state `none`/`unknown`/not yet read -> branch chips absent (no placeholder, no
error UI; git failures are B's GIT-section concern); count 0 -> chip absent, no dot; aggregate for a missing tab returns
zero counts (B `:242`); no `ResizeObserver` -> B's band falls back to docked; reduced motion -> no animation, full
opacity at once.

## Bundle impact

Eager (chat main chunk): `SessionHeaderComponent` (~1.5-2 kB min, template + 2 icons), stagger CSS (~0.6 kB),
chat-input template delta (~0.5 kB). `GitBranch`, `Folder`, `PanelRight`, `ArrowUp`, `Shield` lucide icons are tree-shaken
single icons (`Folder` already imported in chat-input). No new dependency, no new lib. The header must stay eager (it is
the focus fallback for B's `closeInsp`); the inspector stays deferred (B, D-10).

## Suggested file-disjoint batches + verification commands

- A2-B1 (frontend-developer): `session-header.component.ts` (CREATE) + `session-git-stats.store.ts` branch field/helper
  IF B agrees to hand it over (else B does it first). Depends on B component 3-4 existing (or a typed stub).
- A2-B2 (frontend-developer): `chat-input.component.ts` + autopilot popover trigger (chat-ui). File-disjoint from A1/B.
- A2-B3 (frontend-developer): chat-view `.html/.ts/.css` header block + stagger. SHARED FILES with A1 and B: the
  team-leader must serialize all chat-view edits into one batch or strict sequence (B root/inspector first, then A2
  header, then A1 thread).
- Verification (one at a time, from the worktree):
  - `node .ptah/tmp/check-run.mjs a2-chat -- npx nx test chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a2-chat-ui -- npx nx test chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `npx nx typecheck chat --parallel=1`, `npx nx typecheck chat-ui --parallel=1`
  - `npx nx lint chat --parallel=1`, `npx nx lint chat-ui --parallel=1`

## Existing specs likely needing assertion updates

- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`: send button classes
  (`btn-primary` -> D1), placeholder text, autopilot popover position, `Attach files or images` label if renamed to
  `Attach files or add context` (§6.3).
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`: new header element in the main host;
  needs `SessionInspectorStore`/`InspectorShellController` provided (B) - header assertions (count chip copy
  `1 needs you`/`2 need you`, toggle `aria-pressed`, dot) fit here; no new spec file.
- `libs/frontend/chat-ui` autopilot popover spec (if it asserts trigger classes/labels).
- `session-git-stats.store.spec.ts`: `known` state shape gains `branch` (toEqual assertions).
- Not affected: `canvas-focus-header.component.spec.ts`, `canvas-focus-area.component.spec.ts` (A2 leaves Rail header).

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| A2-1 | Header has NO sidebar toggle (departure from §5 item 1) | (a) omit; (b) output wired into app-shell | Sidebar state is a private signal of app-shell (`app-shell.component.ts:245-246, :498-499`); app-shell is off-limits (decisions.md row 35); `ptah-sidebar-tab` already toggles it (`app-shell.component.html:540-545`) | yes: add an output + one app-shell binding later |
| A2-2 | §5 header renders in `chat-view` only where the inspector is hosted (`hostsInspector()`: main panel); Rail keeps `canvas-focus-header` | shared header across hosts; header in every chat-view | Rail/Tribunal tiles already have their own header (`canvas-focus-header.component.ts:36-82`; `conductor-tile.component.ts:218-221`); shared component would carry Rail-only controls and collide with 648's badge (row 34-35) | yes |
| A2-3 | Stagger unit = each turn item (user bubble, disclosure row, answer, chip row, action row) in DOM order, class hook `.st-t` set by A1-3, `--i = min(k+1, 8)` written by one chat-view index pass per switch; items past the 8th share the 360 ms delay | (a) whole `.chat-msg-slot`, last 8 via `:nth-last-child` (Gate 2 REJECTED D-A2-2: skips earlier turns and per-item order); (b) A1 computes a running `--i` in templates (couples A1 to motion, needs a cross-bubble counter) | design-spec §7.1 row 2 and req 13.1; A1 adds only a class; one DOM query per switch, no per-item timer | yes: drop the class or the pass |
| A2-4 | Branch = `tab.agentOrigin.branch` else the git store's last known branch for the session root; the header/composer never start git tracking | header calls `track()`; git-ui `GitStatusService` | Only `agentOrigin.branch` carries a branch today (D-7, `canvas-session-details.component.ts:124`); `GitInfoResult.branch` is fetched but dropped in `toState` (`session-git-stats.store.ts:55-70`); chat must not import git-ui (no import in chat src; `workspace-coordinator.service.spec.ts:913`); B keeps git tracking in the deferred GIT section | yes |
| A2-5 | Model + effort stay two existing controls in one chip group; effort label hidden < 640 px, control kept | single merged `{model} · {effort}` popover | C-18 keeps both controls (`chat-input.component.ts:332-337`); merging popovers is new UI not required for parity | yes |
| A2-6 | Stagger trigger keyed on `resolvedTabId`, class on the host element | key on `resolvedSessionId`; class on B's root div | `resolvedSessionId` flips null -> id on first send (`chat-view.component.ts:798-807`); host class avoids editing B-owned root attributes | yes |

## Open checks

- O1: Part B must (a) put `id="inspector"` on its aside, (b) add `st-r` + `--i` on inspector rows, (c) confirm
  `showDot()` precedence `need` > `sel` and whether it already returns null when open, (d) accept or hand over the
  `session-git-stats.store.ts` `branch` field (A2-4). Send to architect-b-inspector / orchestrator.
- O2: Compact view (`chat-view.component.html:4-14`): does the header also show above the compact card? Spec §3.8
  says header chip and dot still show in either mode (req 15 line ~596). If the compact card stays, move the header
  above the `@if (showCompactCard())` split. Coordinate with A1 (compact-card retirement).
- O3: Autopilot popover trigger file path and whether its trigger is configurable without breaking other consumers
  (grep `ptah-autopilot-popover` usages before editing).
- O4: §6 says Send "becomes the existing Stop control" while streaming; today Send stays enabled to queue during
  streaming (`chat-input.component.ts:400`). Keep both (Stop left of Send) unless the orchestrator confirms queueing
  may be hidden while streaming - capability question, not decided here.
- O5: superseded by A2-3 (no `:nth-last-child`). Verify instead that the five `.st-t` hooks exist after A1-3 and
  that no `.st-t` element is nested inside another `.st-t` (compounding opacity).
- O6: Electron grid mode (`app-shell.component.html:553`): confirm which component hosts `chat-view` per tile and that
  it provides `SESSION_CONTEXT` (else the main-host header would appear per tile).
- O7: The `[sessionHeaderChip]`/`[sessionHeaderAction]` re-projection through chat-view is non-deferred (header is
  eager), so plain `ng-content` works; 648 binds after it lands. No dependency on 648 code.
