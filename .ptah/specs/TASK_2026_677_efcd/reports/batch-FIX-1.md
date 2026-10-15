# Batch FIX-1 report

## Items

### 1. Failed Steer retains the draft

`libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.service.ts:83` now returns the send result and converts rejection to `false`. `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:216,384` closes the input only on `true` and shows an inline `role="alert"` error otherwise. `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts:70,99` accepts an optional `clearOnSubmit` input; the inspector sets it to `false` so a failed send retains its text. Other consumers keep the existing clear-on-submit behavior.

### 2. Background work keeps the Orchestrator waiting

`libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts:98` maps `awaiting-background` with live agents to `waiting`, while a session with no live agents remains idle. `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-status.ts:91` uses the same condition for the avatar, with the live count supplied by `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts:188`. This prevents a waiting card from displaying a done avatar.

### 3. Approval popup announces its actual role

`libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts:20-60` gives the approval content `role="dialog"` and a stable id, sets `aria-haspopup="dialog"`, and points `aria-controls` at that id while expanded. The generic dropdown panel's default `listbox` role is disabled for this instance. The attach button in `chat-input.component.ts:367` opens a real menu and was left unchanged.

### 4. Turn copy action matches the prototype

`libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts:29,53` adds an optional 28 px turn-action size; `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:124` enables it for the turn copy action. The default remains the existing `btn-xs` look elsewhere. The prototype's `.icon-btn` is 28 by 28 px (`prototype/assets/app.css:71-72`), exceeding the 24 px minimum.

## Files

- `libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.service.ts` — preserve the Steer send result.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts` — retain failed Steer drafts and show the error.
- `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts` — optional draft retention for callers awaiting send success.
- `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts` — waiting state while background agents run.
- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-status.ts` — align avatar status with waiting state.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts` — pass live-agent presence to avatar status mapping.
- `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts` — dialog semantics and control relationship.
- `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts` — optional 28 px copy action.
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html` — opt in the turn copy action.

## Spec changes

None. No new specs were written. The orchestrator owns the parallel-wave test run.

## Diagnostics

`ptah_get_diagnostics` was scoped to the nine changed files. It reported no diagnostics in the requested TypeScript files. It does not recognize the changed HTML template. The compiler reported 269 errors in sibling files, including untouched specs; these were outside FIX-1 ownership. No Nx, Jest, build, npm, or git command was run.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain the Steer draft in the inspector through an optional input | Clear on emission; retain until confirmed send | `AgentSteerInputComponent.submit()` cleared immediately, before the service returned; a failed send must keep text for retry | Yes |
| Keep `awaiting-background` idle only when no agent is live | Mark all such sessions working; use live-agent count | Inspector already counts running, waiting, and queued agents at `session-inspector.store.ts:234-239`; the avatar otherwise said done during active background work | Yes |
| Use a nonmodal dialog for approval settings | Menu; listbox; dialog | The popover contains permission choice buttons and an enable/disable action, while the generic dropdown defaulted to `listbox` | Yes |
| Size only the turn copy action to 28 px | Resize every copy button; opt in the turn action | Prototype `.icon-btn` is 28 px; batch A1-3 decision 12 preserved the old 24 px button because changing chat-ui was outside its batch | Yes |

## Clarifications Needed

None.
