## Verdict

REVISE — 8/10.

Review family: codex (implementer family: Claude).

The LANES fixes restore the requested disclosures and put the compact usage/limit/status summary in the lane button's accessible name. AGENTS now announces the model and input/output split, but the original finding's sighted-keyboard access requirement remains unresolved.

## Finding status

| Finding | Fixed yes/no | Evidence file:line |
| --- | --- | --- |
| 1. LANES hover-only explanations and summary supplied only as a description | Yes, for the cited caption/subtotal/owner disclosures and lane-name defect | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:54` and `:69`: native caption button and visible detail; `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-subtotal-tile.component.ts:45` and `:71`: subtotal button and visible full detail; `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts:345` and `:359`: owner button and visible footnote. Its `:83` and `:449` supply the compact accessible name directly, including lower-bound wording. |
| 2. AGENTS model/input-output accessibility | No — partially fixed; accessible-name defect fixed, keyboard-visible split still missing | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-list.ts:103` builds the split, `:110` adds the known model, and `:132` combines the name. `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-row.component.ts:37` applies it. However, `:62` still exposes the split visually only through a nonfocusable span's native title. |

## New findings

1. **major — Residual part of original finding 2, not a newly introduced regression.** `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-row.component.ts:62`: a sighted keyboard user focuses an agent row with known input/output usage. The visible cell shows only total tokens. Its child span's `title` contains the split, but the row has no focus-triggered tooltip or keyboard-openable usage disclosure. The new `aria-label` helps screen-reader users without providing a visible explanation to this user. Activating the row opens its thread (`:38`), rather than revealing the split. Add a visible tooltip on row focus or a separate sibling disclosure button; preserve thread activation and avoid nesting interactive controls. This was explicitly requested in rev7's suggested fix and remains outstanding.

## Review evidence and limits

- The new LANES buttons are native `type="button"` controls, with expansion state, conditional panel relationships, visible detail text, focus outlines and Escape handlers. Owner disclosures are outside the lane-opening button. Default `strip` variants remain separate.
- `lane-usage-tile.component.spec.ts:620` asserts the complete compact label and absence of duplicate `aria-describedby`; `:689` checks owner-detail visibility and Escape. Despite its keyboard wording, that test opens through `.click()` at `:703`, not a real Enter/Space interaction. Native button semantics support keyboard activation statically; the spec is not browser keyboard verification.
- `lane-subtotal-tile.component.spec.ts:71` and `inspector-limits-lanes.component.spec.ts:72` cover the other disclosure states. `inspector-agents-section.component.spec.ts:409` now checks the actual row's explicit label using a known model and asymmetric input/output values. The assertion at `:416` still checks only a title for visual split access.
- Static follow-up review only. No source edits, tests, typechecks, lint, browser or assistive-technology checks were performed. The coordinator reports 1,626 chat-ui tests, 107 session-inspector tests, passing typechecks and zero chat-ui lint errors; those results were not independently rerun. Approval of unrelated working-tree changes is outside this follow-up's scope.

## Coordinator response (disputed, deferred)

The remaining part of finding 2 (a keyboard-visible per-agent In / out split) is not
changed in this PR. The user asked for the split as a tooltip on the Tokens figure.
Screen readers now announce it in the row name, and the thread that a row click opens
shows the agent's stats. A focus-visible tooltip needs a shared app-wide component;
it is listed as a follow-up in the PR body.
