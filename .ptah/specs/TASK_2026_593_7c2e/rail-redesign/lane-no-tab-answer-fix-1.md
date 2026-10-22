# No-tab permission answer revision

## Defect 1 — full permission parity

- `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:21` builds a short plain-text input and description preview. It uses the old card's 40-character command, last-two path segments, and 30-character pattern conventions, redacts sensitive values, removes control characters, and limits the result. Lines 180-195 publish Allow, Always allow, Deny, Deny with message, and the preview for session permissions even when no tab owns the request.
- `libs/frontend/core/src/lib/services/attention.types.ts:33` carries the preview. `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:6` renders it as escaped Angular text and shares the four controls plus Open. Deny with message expands a labeled text field; Enter submits the form and Escape cancels it. The form refuses empty feedback.
- Bell, snackbar, and canvas rail use that component at `libs/frontend/notification-center/src/lib/notification-center.component.ts:56`, `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:52`, and `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:201`. Their dispatch methods pass the optional reason through `notification-center.store.ts:85`, `notification-snackbar.component.ts:204`, and `canvas-rail.component.ts:405`.
- `libs/frontend/core/src/lib/tokens/attention-action-dispatcher.token.ts:9`, `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts:34`, and `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:62` carry that reason to `PermissionHandlerService.handlePermissionResponse`. The dispatcher checks the live generation and pending queue for all four decisions; the handler remains the authority that rejects an already removed request.

### Backend payload compared with HEAD

HEAD's `chat-view.component.html` passed the badge card's `responded` event directly to `chatStore.handlePermissionResponse($event)`. The card emitted `{ id, decision, reason }`; `PermissionHandlerService` posted `{ type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE, response }`. The revised path reaches the same handler and posts the same shape:

| Choice | `response` sent with `SDK_PERMISSION_RESPONSE` |
| --- | --- |
| Allow | `{ id, decision: 'allow', reason: undefined }` |
| Always allow | `{ id, decision: 'always_allow', reason: undefined }` |
| Deny | `{ id, decision: 'deny', reason: undefined }` |
| Deny with message | `{ id, decision: 'deny_with_message', reason: '<user text>' }` |

The old card supplied no rule fields. Its `always_allow` decision asks the backend to create the rule from the pending request; the revised path uses the same request ID and decision.

## Defect 2 — closed-tab canvas rail

`chat-attention-source.service.ts:58,149-150` remembers the session's last known workspace path while a tab exists. `canvas-rail.component.ts:347-352` includes a tabless permission for that workspace in Needs you even when no tile matches. A session whose workspace was never observed still has no known rail workspace.

## Defect 3 — reason precedence

`chat-attention-source.service.ts:180-184` gives a tabless lane's Allow action `Session unavailable` before considering an absent tool name; a lane with a tab and no tool retains `Unknown tool`.

## Defect 4 — fallback visibility assertion

`libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts:508-517` again asserts `unmatchedPermissions()` contains the request after the only target tab closes, alongside the queue assertion.

## Specs added or updated

- `chat-attention-source.service.spec.ts:100-145`: closed-tab workspace, preview, four actions, lane reason precedence, sensitive preview redaction.
- `agent-permission-responder.spec.ts:80-107`: payload for all four decisions, including typed feedback.
- `chat-attention-action-dispatcher.service.spec.ts:66-90`: new decisions, empty feedback, and stale refusal.
- `canvas-rail.component.spec.ts:82`: tabless permission remains visible without a tile.
- `core/src/lib/components/attention-permission-actions.component.spec.ts:1`: preview, labeled feedback, form submission, and Escape cancellation.
- `permission-handler.service.spec.ts:508-517`: fallback reader after tab close.

## Decisions

- Permission preview shows compact values for the fields displayed by the old card and a short, redacted summary of other input fields. It uses Angular text interpolation, with no HTML injection.
- Session workspace memory is scoped to the attention source instance and keyed by session ID. The rail only claims a row for a workspace it observed.
- Existing round-1 changes that removed `ptah-permission-badge` and its exports were already uncommitted when this lane began; this lane did not restore or revert them. Other pre-existing uncommitted files under `.ptah` were not changed.

## Not done

No Nx, Jest, TypeScript, lint, build, or end-to-end command was run, as instructed. CI must verify compilation and specs.
