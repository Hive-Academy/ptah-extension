# PR #802 frontend fixes

## Changes

- **A1 — snackbar specs:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts:72,119,157,184` retains stale/unavailable, hover dismissal, and responsive overflow coverage. Assertions now match two desktop cards and one narrow card and inspect DOM/classes instead of jsdom-computed host CSS. The unavailable outcome reaches the shared action through `notification-snackbar.component.ts:48`, so the button can be disabled with its reason.
- **A2 — whitespace denial:** `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:45,106` removes native `required` validation from the denial input; the existing trimmed-value validation remains responsible for keeping whitespace-only submissions open and describing the inline error. `attention-permission-actions.component.spec.ts:38` opens the new More menu before exercising that path.
- **A3 — canvas fallback:** `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:16,70` assigns a single primary action: enabled Allow, else enabled Show in canvas, else the first enabled decision. `attention-permission-actions.component.spec.ts:78` adds fallback and Escape coverage. The existing canvas rail fallback spec remains relevant.
- **B1 — compact rail decisions:** `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:13-39` keeps primary and Show in canvas inline, with Always allow, Deny, and Deny with message in the keyboard-reachable More menu. Escape closes it. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts:98` opens the menu before asserting Always allow.
- **B2 — placement:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20-21,95-102` positions the 22rem stack left of the Stats pane on desktop, above the composer at widths up to 900px, and limits it to two desktop cards or one narrow card. Overflow remains in the bell/+N entry.
- **C — compact card:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:31-72` puts icon, kind, truncated title and dismiss on the first row; workspace/provider and right-aligned actions on the second. Detail and unavailable reasons remain available as title or screen-reader text. Shared permission actions run in compact mode. Snackbar specs continue to cover identity, detail, dispatch outcomes, pauses, dismissal, and overflow.
- **D — scanner fixtures:** `libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts:156,160,263` and `chat-attention-host-message-handler.service.spec.ts:164` compose secret-shaped test inputs at runtime. Redaction and unsafe-title test intent is unchanged. A search found one similar literal in an older, unrelated core provider settings spec; it was outside the new attention specs and was left untouched.

## Decisions

- **Primary order:** Allow, then Show in canvas, then first enabled decision. Options were preserving all ghost buttons or using the existing canvas-card priority. The canvas-card behavior and approved design specify one filled primary. Reversible.
- **Menu placement:** Keep secondary decisions in a shared More menu instead of changing each host. The same control renders the rail, bell, and snackbar, and rail width is about 260px. Reversible.
- **Snackbar placement:** Use a fixed 18rem right offset at desktop width to clear the Stats pane; at 900px and below use 15rem bottom offset to clear the composer. Two small desktop cards bound the occupied area. This is based on the 1440x900 and 800x900 visual-review-3 evidence; a later Electron screenshot should validate exact pane clearance. Reversible.
- **Denial validation:** Let component validation handle whitespace instead of browser constraint validation. It emits an accessible inline error and preserves the entered field. Reversible.

## Verification and remaining work

- Both changed components parse with zero Tree-sitter errors. Scoped `ptah_get_diagnostics` timed out twice and reported unchecked files, so it did not establish a type-check result. No Nx, Jest, tsc, lint, build, or visual capture was run, per task instruction.
- Electron visual confirmation at 1440x900 and 800x900, and orchestrator-run unit specs, remain outstanding.
