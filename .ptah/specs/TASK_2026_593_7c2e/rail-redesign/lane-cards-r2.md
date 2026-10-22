# Attention snackbar placement, round 2

## Changes

- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20`: anchor the fixed stack at `bottom: 5rem; right: 1rem`, retaining the 348px card width cap and `calc(100vw - 2rem)` viewport clearance. The 900px breakpoint still controls the existing 3/1 visible card limit; it no longer shifts the stack toward the window edge.
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:23`: enter from 4px below. The 120ms timing and reduced motion rule remain.
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:28`: `flex-col-reverse` places the newest card at the bottom. `NotificationService.snackbars()` already returns newest first (`libs/frontend/core/src/lib/services/notification.service.ts:48-53`). The DOM order and focus behavior stay intact; the `+N more` button is visually above the cards.
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts:116-136,185-197`: assert desktop count, bottom/right/width, newest card order and overflow placement, plus narrow width clearance and one-card limit.

## Decisions

- The Electron review's `dark-snackbar-stack.png` and `light-snackbar-stack.png` show three upper-right cards over the Stats pane's Session, Context and Tokens area. The 800px captures show the single card over the session header controls. Bottom-right placement removes the stack from those upper controls.
- Use 5rem (80px) bottom clearance. The round chat send control is `h-7 w-7` (28px) in `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:522`; in the 1440x900 Electron capture its bottom is about 47px above the window edge. An 80px stack bottom leaves about 33px beyond that button's lower edge and places the stack above it. The snackbar remains 1rem from the right edge.
- Retain three cards above 900px and one at or below 900px, with overflow routed to the bell. The current source order is newest first, so reversing only the visual stack places newest nearest the corner without changing keyboard order.

## Verification and limits

- `git diff --check` found no whitespace errors. No Nx, Jest, TypeScript CLI, lint, build, or visual run was performed, as requested.
- Scoped `ptah_get_diagnostics` returned unavailable because its TypeScript check was still running after 45 seconds; both changed files remain unchecked by that tool. The revised placement has not been visually rechecked in Electron.
