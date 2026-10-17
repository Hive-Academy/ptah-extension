# Requirements - TASK_2026_679_45ff

Tags on every rule: `[user-requested]` (the /orchestrate request of 2026-10-16 or decisions.md D1-D4),
`[project-rule: source]`, or `[pm-proposed]` (derived from parity or from the code; the designer, architect or user
may push back). Row IDs such as `B-14` refer to `parity-inventory.md` in this folder.

## Context

Today every chat surface carries a session list sidebar inside `AppShellComponent`: an `<aside>` with search,
filters, sort, grouping, a date range, grouped/nested session rows with live markers, chips and hover actions, and
pagination (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:99-547`). A vertical
`Sessions` tab toggles it (`app-shell.component.html:549-556`). It opens by default on Electron and is closed by
default on VS Code (`app-shell.component.ts:247`), is width-resizable with a persisted width
(`session-sidebar-width.ts`, `app-shell.component.ts:505-653`), and on Electron a divider between the Workspaces
sidebar and the sessions sidebar resizes it too (`electron-shell.component.ts:290-301, 391-419`). On hosts with the
session organization store (Electron, CLI) the query controls go to the server through `ptah-session-filter-bar`
and rows gain chips, a live-phase marker and an Organize action; on VS Code the list keeps a local name search
(`app-shell.component.ts:322-393`; `session-rpc.handlers.ts:208-214`).

The user asked to remove the always-visible sidebar and move the same list into a modal opened by a new
"Previous sessions" button directly under the existing New session button. Selecting a session loads it and closes
the modal; every list capability must survive; the modal must be accessible; e2e specs must be updated, not
deleted; and the result is visually reviewed in Electron in both themes at three widths. D1 records that the sidebar
goes away entirely.

There is no single "New session" button across hosts. Electron is pinned to the canvas (grid) layout
(`electron-shell.component.ts:439, 499`), where the app-shell navbar is hidden (`app-shell.component.html:561-563`);
its New session entry points are the canvas dock button (`orchestra-canvas.component.ts:144-200`, rendered only
while a tile can be added), the Rail footer button, a full-width button in a vertical footer
(`canvas-rail/canvas-rail.component.ts:231-251`), and the empty-board button
(`canvas-rail/canvas-rail-board.component.ts:132-142`). VS Code shows the navbar `New` button in both layouts
(`app-shell.component.html:711-775`) and, in grid layout, the same canvas buttons. Requirement 1 states which
button the new control sits under; Clarification 1 asks the user to confirm.

## Classification

- Type: FEATURE. It adds a new entry point and modal and removes an existing surface.
- Estimate: L. task.md says M, but the work covers two hosts × two layouts, three entry surfaces (navbar, Rail
  footer, collapsed Rail), about 40 parity rows and nine e2e and harness files plus the unit spec migration.
- Priority: not defined here.

## Scope

In scope:

- A "Previous sessions" control placed as Requirement 1 states, opening a modal that holds the session list. `[user-requested]`
- Every capability in `parity-inventory.md` marked `move` or `keep`, available from the modal. `[user-requested]`
- Removing the session sidebar, its `Sessions` tab, its width/resize/persistence code and the Electron divider that
  resizes it. All rows marked `remove-proposed` are user-approved removals (D6). `[user-requested]` D1, D4, D6
- Updating the unit specs that assert on the sidebar, and every e2e spec, helper, docs-screenshot script and
  harness scenario listed in `parity-inventory.md` § "E2E specs that target the sidebar". `[user-requested]`
- Visual review in Electron, dark and light, at 1440, 760 and 400 px window width. `[user-requested]`

Out of scope:

- Backend changes to `session:list`, `session:rename`, `session:delete` or the organization RPCs. The modal uses
  the same contracts (parity rows B-3..B-13, D-2..D-8).
- New list capabilities, such as new filters, sorts, bulk actions, multi-select, a context menu, arrow-key list
  navigation, or persisting filters across app reloads. None of these exist today (D-11, B-16). They would go in
  a follow-up task.
- A keyboard shortcut to open the modal. This is a new capability and belongs in a follow-up task if wanted.
- An always-visible running or needs-you indicator on the new button, which would replace parity row A-12. This
  is new UI and depends on the user's answer to Clarification 2.
- Changes to the session organization editor, the filter bar's internal behaviour, the chips, the live-phase
  marker or the workflow badge. These are reused unchanged (rows marked `keep`).
- The Workspaces sidebar, the Git dock, the agent-panel tab and the shared `SidebarTabComponent`. These are other
  users of the tab component and must keep working.
- The canvas dock button and the empty-board New session button. They get no "Previous sessions" companion
  (Requirement 1 explains why).
- Regenerating and publishing docs images. The shot scripts are updated, and running them is a separate step that
  needs the user to ask for it (project rule below).
- The historical evidence scripts under `.ptah/specs/TASK_2026_612_0332` and `.ptah/specs/TASK_2026_580_9f77`.
  They record closed tasks and no target runs them.

## Requirements

### 1. Entry point placement (per host and layout)

Requirement: the Electron and VS Code user can open the session list from a "Previous sessions" control that sits
directly under the New session button they already use, so finding old sessions needs no sidebar.

Acceptance criteria:

1. When Electron shows a workspace (canvas layout), the system shall render a "Previous sessions" control
   immediately below the Rail footer's New session button, inside the same footer, with nothing between them.
   `[user-requested]` (placement under New session). The choice of the Rail footer is `[pm-proposed]`; see
   Decisions and Clarification 1.
2. When the VS Code webview is in canvas (grid) layout, the system shall render the control in the same Rail
   footer position as criterion 1. `[pm-proposed]`
3. When the VS Code webview is in single layout (no Rail), the system shall render the control as the next
   control after the navbar `New` button in the same Session group, with nothing between them. The navbar is one
   40 px row, so "under" cannot be literal there. `[pm-proposed]`
4. When the Rail is collapsed (manually or by auto-collapse at narrow widths), the system shall still render the
   control under the collapsed New session button, keeping the accessible name "Previous sessions" even if its
   visible label is shortened. `[pm-proposed]` (the Rail footer already shortens New session to `+`,
   `canvas-rail.component.ts:241`)
5. When the New session button is disabled (running cap or tile bound), the system shall keep the control
   enabled. Disabling New session does not affect reading or opening old sessions. `[pm-proposed]`
6. When the control is rendered, the system shall give it a visible text label or tooltip and an accessible name
   of exactly "Previous sessions". The name is `[user-requested]` (working name, context.md); the exact-name check
   is `[pm-proposed]`.
7. When the user activates the control by pointer, Enter or Space, the system shall open the modal.
   `[user-requested]`

### 2. Modal behaviour and accessibility

Requirement: the modal is an accessible dialog. A keyboard or screen-reader user can open it, work inside it and
leave it without losing their place.

Acceptance criteria:

1. When the modal opens, the system shall expose it as a dialog (`role="dialog"` with `aria-modal="true"`, or a
   native modal `<dialog>`) whose accessible name includes "Previous sessions", and shall move focus to a control
   inside it. `[user-requested]` (accessible modal); the role and name check is `[pm-proposed]`.
2. When focus is in the modal and the user presses Tab on the last focusable element or Shift+Tab on the first,
   the system shall keep focus inside the modal (focus trap), and content behind the modal shall not be
   reachable by Tab. `[user-requested]`
3. When the user presses Escape with no nested layer open, the system shall close the modal. `[user-requested]`
4. When the user presses Escape while a nested layer inside the modal is open (the Filters popover, the inline
   rename input, the delete confirmation or the organization editor), the system shall close only that nested
   layer (or cancel the rename) and leave the modal open. `[pm-proposed]` (parity D-2, D-9, B-4)
5. When the modal closes by Escape, by a visible close control or after selecting a session, the system shall
   return focus to the "Previous sessions" control that opened it. `[user-requested]`
6. When the modal is open, the system shall offer a visible close control with an accessible name.
   `[pm-proposed]`
7. When the user clicks the backdrop outside the modal, the system shall close the modal and return focus as in
   criterion 5. `[pm-proposed]` (this is the convention of the existing overlays, for example the new-session
   popover's backdrop at `app-shell.component.html:714-720`)
8. When a nested dialog that was opened from inside the modal closes (the delete confirmation or the organization
   editor), the system shall return focus to the control that opened it, or to another control inside the modal
   if that control no longer exists (for example after a delete), and the modal shall stay open.
   `[pm-proposed]` (parity D-3, D-9)
9. When the user closes and reopens the modal in the same app session, the system shall still show the search
   text, filters, sort, grouping, date range and already loaded pages from before, and shall not send a new
   `session:list` request just because the modal reopened. `[pm-proposed]` (parity A-11, B-16)

### 3. Query controls parity

Requirement: the modal offers the same search, filter, sort, grouping and date controls as the sidebar on the same
hosts.

Acceptance criteria:

1. When the host serves organization (Electron), the system shall show the server-side search, the Filters
   popover (Status, Priority, Task id, Pinned only, Has PR, Clear filters, active-count badge), the sort select
   (Last active, Priority, Created, Name) and the group select (No grouping, By status, By task, By parent), with
   the same `session:list` parameters and the same 250 ms debounce as today. `[user-requested]` (parity B-3..B-13)
2. When the host does not serve organization (VS Code), the system shall show the local name search with its
   clear button and no Filters, sort or group controls, as today. `[user-requested]` (parity B-1, B-2;
   `app-shell.organization.spec.ts:376`)
3. When the user opens the Date range on any host and sets From and/or To, the system shall filter the loaded
   rows by last activity with inclusive whole days, as today. `[user-requested]` (parity B-14)
4. When any filter is active, the system shall show `Clear`, which clears search, filters and date range, closes
   the date panel and keeps the chosen sort and grouping. `[user-requested]` (parity B-15)
5. When the modal is at its narrowest supported width (400 px), the system shall show the Filters popover and the
   date inputs in full, with no clipping by the modal or the viewport. `[pm-proposed]` (TASK_2026_580 checked
   popover clipping in the sidebar, `.ptah/specs/TASK_2026_580_9f77/visual-c12`)

### 4. Row content parity

Requirement: each row in the modal tells the user the same things the sidebar row does.

Acceptance criteria:

1. When a row is shown, the system shall show the display name (one line, truncated, full name in a tooltip),
   the relative last-activity time, `N msgs` when N > 0 and `transcript expired` with its retention tooltip when
   the transcript is gone. `[user-requested]` (parity C-1..C-4)
2. When a row is the current session, the system shall mark it visually and with `aria-current="true"`. When a
   session has an open tab but is not current, the system shall give it the distinct open-tab mark. Both marks
   shall be distinguishable in dark and light themes. `[user-requested]` (parity C-5, C-6)
3. When the host serves organization, the system shall show the live-phase marker (running, waiting or failed),
   the organization chips (pinned, priority, status, started by agent, linked tasks including missing ones, PR
   count) and the workflow badge. `[user-requested]` (parity C-7..C-9)
4. When grouping is active, the system shall show a header with label and count per group, and nested child rows
   (depth 1-3) with the screen-reader prefix "Child session:" under By parent. `[user-requested]` (parity C-10,
   C-11)

### 5. Row actions parity

Requirement: the user can open, rename, delete and organize (including pin) sessions from the modal with the same
outcomes as today.

Acceptance criteria:

1. When the user activates a row, the system shall open that session as today (grid layout: open or focus its
   canvas tile; single layout: switch to its tab) and close the modal, with focus handled as in Requirement 2,
   criterion 5. `[user-requested]` (parity D-1)
2. When the user renames a row, the system shall offer the inline edit (Enter or blur saves, Escape cancels, at
   most 200 characters, empty or unchanged does nothing), call `session:rename`, and update the row and any open
   tab title. The modal stays open. `[user-requested]` (parity D-2)
3. When the user deletes a row, the system shall ask for confirmation first. On confirm it shall call
   `session:delete`, remove the row, forget its workflow mapping, clear the current session if it was that one,
   and close its tab. On cancel it shall send no delete. The modal stays open in both cases. `[user-requested]`
   (parity D-3)
4. When a row has an organization record, the system shall offer Organize, which opens the existing organization
   editor (priority, status, pin and unpin, link and unlink task, add and remove PR link, worktree open and copy)
   over the modal. `[user-requested]` (pin; parity D-4..D-9)
5. When the user moves keyboard focus onto a row, the system shall make that row's Organize, Rename and Delete
   actions reachable by Tab and visible while focused, as today. `[user-requested]` (parity D-10, D-11)
6. When an action fails (`ok:false` or a transport error), the system shall behave as today: for inline rename
   and delete the row is kept and the failure is logged (no inline error UI exists today, and none is added);
   for actions inside the organization editor the editor shows its existing inline error.
   `[pm-proposed]` (parity D-2, D-3, D-9; `app-shell.component.ts:917-935, 957-982`;
   `session-organization-editor.component.ts:752-754`)

### 6. List states and pagination

Requirement: loading, empty, no-match and more-pages states read the same in the modal.

Acceptance criteria:

1. When the host is still booting, the system shall show skeleton rows, not "No sessions yet". `[user-requested]`
   (parity E-1)
2. When there are no sessions, the system shall show "No sessions yet / Create one to get started". When filters
   empty the list, it shall show "No matching sessions" with `Clear filters`. `[user-requested]` (parity E-2,
   E-3)
3. When more pages exist, the system shall show `Load More (remaining)`, or `Load more to expand search` under
   client filters. While loading, the button shall show a spinner and be disabled, and it shall be hidden when
   client filters leave zero rows. `[user-requested]` (parity E-4)
4. When the list is longer than the modal, the system shall scroll the list inside the modal. The page behind the
   modal shall not scroll. `[pm-proposed]`

### 7. Sidebar removal

Requirement: once the change ships, no session list sidebar, `Sessions` tab or sessions resize affordance remains
on any host.

Acceptance criteria:

1. When any host renders a chat or canvas surface, the system shall render no session list `<aside>`, no
   `Sessions` vertical tab (`Toggle Sessions panel`) and no `Resize session sidebar` separator. `[user-requested]`
   D1
2. When Electron shows the Workspaces sidebar, the system shall render no divider that resizes a sessions
   sidebar. The Workspaces sidebar and its own tab keep working. `[user-requested]` D1, D6 (row A-6)
3. When the change is complete, the code paths used only by the removed sidebar (width state, resize handlers,
   width helpers and their constants, the external-resize API used by the Electron divider, and sidebar-only CSS)
   shall be deleted, not left unused. `[project-rule: Ptah working rules "Replace, do not accumulate"]`
4. (Answered) The user approved every `remove-proposed` row (D6), so no removed capability needs a
   modal-appropriate replacement. `[user-requested]` D4, D6

### 8. Layout, sizing and theme

Requirement: the modal and the new control work at the widths and in the themes the user named.

Acceptance criteria:

1. When the Electron window is 1440, 760 or 400 px wide, in dark and in light theme, the system shall show the
   modal fully inside the viewport with no horizontal scrollbar, no clipped controls and every capability in
   Requirements 3-6 reachable. The control from Requirement 1 shall be visible without horizontal scrolling.
   `[user-requested]` (widths and themes); the pass criteria are `[pm-proposed]`.
2. When text and controls in the modal and the new control are measured in both themes, the system shall meet
   WCAG 2.x contrast: text at least 4.5:1, UI components and focus indicators at least 3:1. `[project-rule:
   TASK_2026_677_efcd design-spec.md §8.2]`
3. When an element in the modal or the new control has keyboard focus, the system shall show the app's focus
   ring. `[project-rule: TASK_2026_677_efcd design-spec.md §8.4; FOCUS_RING in
   session-filter-bar.component.ts:72-81]`
4. When the VS Code webview is about 400 px wide (sidebar view), the system shall meet criterion 1 for that host.
   This is checked by the harness or by a reviewer and is not part of the Electron visual review.
   `[pm-proposed]`

### 9. Tests and e2e updates

Requirement: the existing automated coverage of the list survives the move and points at the modal.

Acceptance criteria:

1. When the change is complete, every unit spec that asserted on the sidebar (`app-shell.organization.spec.ts`,
   `electron-shell.activity-placement.spec.ts:188`, `session-sidebar-width.spec.ts`) shall either assert the same
   capability through the modal or be removed together with the code it tested, and only for approved removals.
   `[user-requested]` D4
2. When the change is complete, each e2e spec, helper, docs-screenshot script and harness scenario listed in
   `parity-inventory.md` § "E2E specs that target the sidebar" shall still exist with its tests intact, and shall
   reach the session list through the "Previous sessions" control and the modal. Deleting a spec or a test is not
   allowed. `[user-requested]`
3. When an updated harness scenario runs (`session-delete.e2e.spec.ts`, `session-create.e2e.spec.ts`,
   `session-list.e2e.spec.ts`), it shall open the modal before looking for row controls, so that its DOM steps
   exercise the modal and do not skip silently. `[pm-proposed]` (their DOM steps skip when the control is
   missing)
4. When the change is complete, new tests shall cover the parity rows whose test column says "new test needed",
   and at minimum Requirement 2, criteria 1-5 and 8, and Requirement 5, criterion 1. `[pm-proposed]`

### 10. Organize and Rename for live sessions in the canvas Rail (scope add, D9)

1. When the user opens a Rail card's "Session actions" menu
   (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:180-240`), the menu shall offer
   `Rename` in addition to the existing items. Rename uses the same backend (`session:rename`), the same rules
   (max 200 chars, trimmed, empty or unchanged is a no-op, Escape cancels) and updates the open tab name and the
   Rail card title. `[user-requested]` D9
2. When the host has the organization store (`organizationAvailable`, Electron and CLI) and the session has an
   organization record, the menu shall offer `Organize`, which opens the same organization editor as the modal
   row (pin, priority, status, task links, PR links, worktree). When organization is unavailable (VS Code), the
   item is not shown, exactly as the modal row hides its Organize button. `[user-requested]` D9
3. When the organization editor or rename closes from the Rail, focus shall return to the Rail card's
   "Session actions" trigger (or the card when the trigger is gone). `[user-requested]` (a11y parity with the
   modal)
4. A Rail card whose session is not yet persisted (no session id, a fresh draft tile) shall show Rename and
   Organize as disabled with a reason, or not show them; the design decides which. `[pm-proposed]`
5. Delete is not added to the Rail. `[user-requested]` D9 (only organizing and renaming were asked for)
6. When a session is renamed or organized from the Rail, the modal list (if open later) shows the new name and
   organization data, and vice versa. `[user-requested]` (same store)

## Non-functional requirements

- Compatibility: Angular 22 (`@angular/core` 22.1.7 in `package.json`). New and changed components shall be
  standalone with `ChangeDetectionStrategy.OnPush`, use signals for state and `input()` / `output()` for bindings,
  and use DaisyUI and Tailwind classes with the existing tokens. `[project-rule: brief; existing components such
  as session-filter-bar.component.ts:99-103, 15-25]`
- Template lint: no element shall carry both a static `class="..."` and a `[class]="..."` binding.
  `[project-rule: @angular-eslint/template/no-duplicate-attributes; TASK_2026_677_efcd decisions.md rows 78-79]`
- Hosts: behaviour shall match on Electron (organization available) and VS Code (organization unavailable),
  as Requirement 3 sets out. `[project-rule: session-rpc.handlers.ts:208-214; app-shell.component.ts:322-327]`
- Verification: only the changed projects shall be checked (`nx test|lint|typecheck <project>`,
  `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time). No `build`, `serve`, `e2e` or `package`
  target shall run unless the user asks for it. `[project-rule: CLAUDE.md "Verification commands"]`
  **User exception (D7):** the 4 Electron e2e specs, the 2 docs-screenshot scripts and the 3 harness scenarios
  listed in `parity-inventory.md` § "E2E specs that target the sidebar" shall each run once, one at a time,
  before the PR. `[user-requested]` D7
- Git: all work happens in the worktree `D:/projects/ptah-extension/.claude-worktrees/previous-sessions-modal`
  on `feat/previous-sessions-modal`, commits run in the foreground, and the commit scopes come from
  `.commitlintrc.json`. `[project-rule: CLAUDE.md]`

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Electron desktop user | More room for the canvas, and old sessions one click away under New session | The Rail footer shows "Previous sessions", and the modal opens and loads a session in two actions |
| VS Code extension user (often a 400 px sidebar) | The same list without a panel that squeezes the chat | The modal fits at 400 px, with local search and date range intact |
| Keyboard and screen-reader user | A dialog that traps focus, closes on Escape and returns focus | Requirement 2 checks pass with keyboard only |
| E2E and docs maintainers | Specs and shot scripts that keep running against the new UI | The `sessionRowButton` and `prepareCanvasWithSessions` helpers open the modal, and no spec is deleted |

## Risks

| Risk                      | Likelihood          | Impact              | Mitigation                 |
| ------------------------- | ------------------- | ------------------- | -------------------------- |
| Nested layers (Filters popover, inline rename, delete confirmation, organization editor) fight the modal's focus trap or Escape handling, and focus is lost or the wrong layer closes | HIGH | HIGH | The architect specifies layer ordering and focus return for each nested layer. The tester covers Requirement 2, criteria 4 and 8, per layer |
| Harness scenarios skip DOM steps when a control is missing, so they pass without testing the modal | HIGH | MEDIUM | The senior tester confirms that each updated scenario reaches the modal's controls (Requirement 9, criterion 3) |
| The modal is rebuilt on each open and loses the query or loaded pages, or sends `session:list` again | MEDIUM | MEDIUM | The architect keeps query and page state outside the modal's lifetime. The tester checks Requirement 2, criterion 9 |
| A second button in the 84 px Rail footer (`canvas-rail.component.ts:231`) overflows the collapsed 56 px Rail, or crowds out the disabled-reason text | MEDIUM | MEDIUM | The designer specifies the footer at collapsed width and with the reason shown. The visual reviewer checks it at 400 px |
| The new footer control changes Tab order that `E/specs/canvas/canvas.spec.ts:218` relies on | LOW | LOW | The developer reviews that spec when changing the footer and updates its expectations without deleting tests |
| Opening a session from the modal when the board is at its tile bound behaves differently from the sidebar | LOW | MEDIUM | The developer keeps the existing `requestCanvasSession` path. The tester covers it in the Requirement 5, criterion 1 test |

## Decisions

- Placement of the new control (Requirement 1). Options were: the Rail footer; the canvas dock; the navbar; all
  of them. I chose the Rail footer in canvas layout and next to the navbar `New` in VS Code single layout,
  because the Rail footer is the only New session button in a vertical stack where "directly under" is literal
  (`canvas-rail.component.ts:231-251`), it is always rendered (the dock button is conditional,
  `orchestra-canvas.component.ts:148`), and the navbar is a single row. This is reversible, and it is confirmed
  through Clarification 1.
- No companion button on the empty board or the canvas dock. Options were to add one or not. I chose not to,
  because the Rail footer is visible beside the empty board (`canvas-rail-board.component.ts:88-112`) and a
  duplicate entry adds clutter. This is reversible.
- Backdrop click closes the modal (Requirement 2, criterion 7). Options were to close or not. I chose close,
  because the existing new-session popovers close on backdrop. This is reversible.
- The modal stays open after rename, delete and organize, and closes only on open (Requirement 5). This follows
  the user's wording, "selecting a session ... closes the modal". It is reversible.

## Clarifications Needed

**RESOLVED by the user 2026-10-16 (decisions.md D5-D7): the recommended option of each question below.**

1. Which New session button should "Previous sessions" sit under?
   - (Recommended) The Rail footer New session in canvas layout (Electron and VS Code grid), and next to the
     navbar `New` in VS Code single layout.
   - The Rail footer only. VS Code single layout gets no entry, so the list is unreachable there.
   - Under every New session button (navbar, dock, Rail footer, empty board).
2. Do you approve the proposed removals in `parity-inventory.md` § Proposed Removals (A-2..A-8, scroll position
   in A-11, and ambient status A-12)?
   - (Recommended) Approve all. The sidebar's resize, width persistence, divider and icon header go, and live
     status of sessions is seen in the modal (board sessions keep their Rail chips).
   - Approve all except A-12, and add a status indicator to the "Previous sessions" button as a new requirement.
   - Approve none, and keep the sidebar as an optional collapsed panel (this reverses D1).
3. Should the updated e2e specs and docs-screenshot scripts be run (CLAUDE.md forbids `e2e` targets unless you
   ask)?
   - (Recommended) Yes. Run the 4 Electron specs, the 2 shot scripts and the 3 harness scenarios once, one at a
     time, before the PR.
   - No. Update only, and run them in CI or later.

## Open questions

- Should the stale `localStorage` key `ptah.sessionSidebarWidth` be cleared once on upgrade, or left alone? The
  architect can answer this. It is harmless either way.
- Should the published docs images `sessions-overview` and `sessions-history` be re-captured after the shot
  scripts change? The user or the docs owner can answer this. It does not block the work.

## Handoff

- Next specialist: ui-ux-designer, then software-architect (the flow in context.md is designer → prototype →
  Gate 1.7 → architect).
- Why: the modal and the Rail footer control are new UI surfaces that need a design and prototype before the
  architect plans how state, layering and removal fit together.
