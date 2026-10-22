# Code Logic Review - TASK_2026_716

Verdict: APPROVED
Score: 8/10
Review family: claude; implementer family: codex

Scope: native-autocomplete.component.ts/.spec.ts, settings-toast.component.ts/.spec.ts (read in full), plus read of FloatingUIService position/cleanup and the two named consumers.
Evidence run: ui autocomplete jest 42/42 pass; chat feedback jest 55/55 pass; degradation-audit: frontend/ui 1 ok (baseline 1), frontend/chat 10 ok (baseline 11), no FAIL. Every new catch carries a degradation-audit comment (autocomplete.ts:184, 218, 270+; toast.ts:140).

## Checked and sound
- Focus: popover shell has no autofocus, showPopover on a manual popover does not move focus; input keeps focus. Keyboard (ArrowUp/Down/Home/End/Enter/Escape) and aria-activedescendant unchanged; ids stay in DOM.
- Outside click uses contains() on origin and panel; shell is pointer-events:none, panel pointer-events:auto, so no click blocker. Manual mode has no native light dismiss.
- Promotion happens before measure; position race bounded at 1000 ms with generation guards after await (autocomplete.ts:188); timer cleared on close/destroy; floatingUI.cleanup() cancels the request token.
- Missing/throwing showPopover falls back to display:block; hideLayer is idempotent and guarded.
- Toast: own hide/show toggles are ignored (target === region); closed-state toggles ignored; coalesced via raisePending; destroy removes listener and rechecks destroyed/connected in the microtask; no focus() call; manual popover has no backdrop so it stays non-blocking over a modal dialog.

## Defects
1. (minor) settings-toast.component.ts:113-115 - the filter accepts any popover-bearing target, including another page toast's region. With two non-inline SettingsToastComponent instances both showing a toast, each instance's hide/show fires a toggle that the other re-raises, giving an endless async ping-pong. Only one page toast exists today. Fix: also skip targets matching `[data-testid="settings-toast-region"]` (or a shared static marker class).
2. (minor) native-autocomplete.component.ts:97/166 - in the no-Popover-API fallback the shell is a position:fixed element with z-index auto, so the panel's z-50 is trapped in the shell's stacking context and can still sit under sibling panes. This is the original bug, only in the degraded path. Fix: give the shell `z-index: 50` in the fallback (e.g. `.ptah-autocomplete-layer { z-index: 50 }`; harmless in the top layer).
3. (minor, accepted trade-off) settings-toast.component.ts:122-124 - a toast re-raised above a modal dialog can visually cover dialog content in the bottom-right corner; the inline variant is the accessible path. Not blocking, no change required.

No blocking defects. Consumers: provider-model-search-field.component.ts (row mousedown cancel at 74/345 keeps field focus; panel stays in DOM so contains() still works) and the deprecated CDK selection/autocomplete are unaffected.
