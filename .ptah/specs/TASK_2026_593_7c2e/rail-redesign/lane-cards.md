# Attention card implementation

## Changed files

- `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts` and its spec: expose safe `sessionTitle`, `provider`, and `detail` on local question, permission, and lane permission items.
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts` and its spec: expose the safe projected session title and provider.
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts` and its spec: render the shared card anatomy and cap the desktop stack at two cards.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts` and its spec: render the shared anatomy in Needs you and Recent notices, retain bell behavior, and focus the first enabled request action.

## Field mapping

Local chat items reuse the existing sanitized values: `sessionTitle` is the safe, nondefault tab title; `provider` is the known provider label; `detail` is `Tool: <safe tool name>` for permissions and lane permissions or the safe first question preview for questions. `context` remains unchanged for older consumers and notifications. Projected host notices carry only a safe session title, so the host projection sets `sessionTitle` and a known `provider`; it leaves `detail` absent because the strict host notice contract has neither a tool name nor question text. No raw prompt or tool input was added to the projection.

## Card anatomy and behavior

Both surfaces use an uppercase kind label and matching Lucide icon, a 3px `bg-state-need` or `bg-state-err` accent, `surface-3` snackbar or `surface-2` bell shell, session title as the main line with `item.title` fallback, provider when known, a `bg-base-200` workspace chip with `Workspace unavailable` fallback, and a truncated safe detail line. The shell uses `border-[color:var(--surface-border)]` and elevation tokens rather than a full state border. Answer or Allow is the sole `btn-primary btn-sm` action when available; Show in canvas becomes primary if Allow is unavailable. Deny and other navigation actions use `btn-ghost btn-sm`. Disabled buttons use native `disabled`, full opacity muted text, a border, and adjacent reason text linked by `aria-describedby`. Dismiss labels identify the presentation. Bell rows use list semantics and the panel retains its dialog label. No time label is shown because `AttentionItem` has no timestamp.

## Placement

The snackbar remains at the top right, but shows at most two cards on desktop and one at narrow or short viewports. `+N more` still opens the bell. This is the design request's offered bounded-stack choice to reduce overlap with the Electron Stats pane while preserving overflow access.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Limit the desktop snackbar stack to two | Three at top right; two plus overflow; move across the window | Visual run 3 showed three cards covering Stats actions; the task expressly offers a two-card cap and the existing component already has overflow routing | Yes |
| Leave host-projected `detail` absent | Infer a detail from `notice.title`; extend the host contract; omit | `AttentionNotice` contains only a safe title, kind, target, and time; its title is a session label, so inventing a tool or question would misrepresent the request | Yes |
| Use `item.title` as main-line fallback | Generic unavailable label; title fallback | The approved implementation objective explicitly names `item.title` as fallback; known session metadata takes precedence | Yes |

## Verification and remaining work

`ptah_get_diagnostics` reported no diagnostics in the edited files. It also reported preexisting errors in sibling chat/shared files. No Nx, Jest, TypeScript, lint, build, or visual run was performed, as instructed. Angular template rendering and actual resolved contrast in both themes remain for CI or Electron visual review; the CSS uses the existing full-opacity muted token specified for accessible contrast.
