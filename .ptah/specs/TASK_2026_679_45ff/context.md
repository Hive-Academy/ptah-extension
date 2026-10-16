# TASK_2026_679_45ff — context

## Request (user, 2026-10-15, from the TASK_2026_677_efcd session)

"A follow up task i would like you to file is converting our old session view to a modal and add a button for it
under the new session button to load previous sessions."

The user attached a screenshot of today's session list sidebar: a collapsible right-edge panel labelled
`SESSIONS` with `Search sessions...`, `Filters`, a sort select (`Last active`), a grouping select
(`No grouping`), `Date range`, and the session rows (title, relative time, unread / running markers, colored
left accent for active or linked sessions).

## Goal

- Move the old session list (search, filters, sort, grouping, date range, rows, row actions) out of the sidebar
  into a modal dialog.
- Add a button "Previous sessions" (working name) directly under the existing New session button. It opens the
  modal. Selecting a session in the modal loads it and closes the modal.

## Known starting points (not verified in depth)

- `libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts` (filters,
  grouping).
- `libs/frontend/chat/src/lib/components/templates/session-sidebar-width.ts` (sidebar width / divider drag).
- `libs/shared/src/lib/types/session-organization.types.ts` (`SESSION_LIST_GROUPS`).
- `libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts` (list query, grouping sort).
- Sidebar session rows live in `libs/frontend/chat/.../templates/app-shell.component.html` (TASK_2026_648 adds
  workflow badges there).
- The New session button location must be confirmed per host (Electron shell, VS Code webview, Rail).

## Constraints and coordination

- This replaces / redesigns an existing surface: `parity-inventory.md` of the old sidebar is REQUIRED before
  design (every capability keeps, moves into the modal, or is a user-approved removal).
- New UI surface → designer + prototype + Gate 1.7 before the architect.
- Run after TASK_2026_677_efcd (clean session view; header, inspector, agent dock) and TASK_2026_648 (workflow
  badges in app-shell session rows) merge, to avoid conflicts in app-shell / chat-view.
- Open question for the user at Gate 0: does the sidebar go away entirely, or stay as an optional collapsed
  panel? (removal = user decision).
