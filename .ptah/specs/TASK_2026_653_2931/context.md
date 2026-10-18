# TASK_2026_653_2931 — context

Source: TASK_2026_629_c0b3 `decisions.md` row 66 (user decision, 2026-10-13), from the user's Electron test of the
Orchestra Canvas Rail board. Starts after TASK_2026_629 merges.

## Scope (user decisions)

1. **Session sidebar as a strip when the canvas is open.** Today the left app-shell session list
   (`apps/ptah-extension-webview` app-shell `<aside>`, `app-shell.component.html:99-512`, open by default in Electron,
   `app-shell.component.ts:244`) lists every session, and the Rail column lists the open board sessions again.
   Direction chosen by the user: when the canvas is open, collapse the sidebar to a narrow strip with a different
   purpose — workspace switcher, search, and the sessions that are not on the board (history, closed sessions, other
   workspaces). The Rail stays the live board. Needs a design pass (designer, prototype, Gate 1.7).
2. **Details column resizer only.** The Rail keeps the fixed widths of TASK_2026_629 D6. The Details (information)
   column, which TASK_2026_629 R9 fills with Agents and Displays, gets a resizer with min/max widths and a persisted
   width. Reusable handles: `chat-ui/src/lib/atoms/electron-resize-handle.component.ts`, `split-handle.component.ts`,
   `resize-handle.styles.ts`, `chat/src/lib/components/atoms/resize-handle.component.ts`,
   `git-ui/src/lib/git-dock/rail-resize-handle.component.ts`.
3. **App-wide cursor-pointer and hover audit.** Tailwind preflight gives `cursor:pointer` only to `button` and
   `[role=button]`; clickable hosts without a role show an arrow and no hover. Audit the whole webview/Electron
   renderer (TASK_2026_629 R9 fixes only the Rail items).

## Not in scope

The TASK_2026_629 R9 regression fixes (Rail name popover, Displays panel, Agents section, Grid lane memory, Rail
pointer/hover).

## Cancelled (2026-10-17)

Cancelled by the user. The session sidebar work is now handled in another session, which moves the
session sidebar into a modal. Do not start this task.
