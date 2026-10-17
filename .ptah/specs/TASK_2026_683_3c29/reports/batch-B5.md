# Batch B5 — ChatView session entrance

## Changes

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:174,196,699,1194-1216,1381` — replaced the CV-2.1 DOM pass and reflow with a tab-id keyed `enteringTabId` signal and one 400 ms timer created outside Angular's zone. A new tab switch cancels the previous timer; destroy cancels the current timer. The host `is-entering` binding now serves inspector rows only.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:35,106,269` — binds each transcript's `entering` input to its tab id and keeps the session header and composer still.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.css:188-209` — retains only the inspector `.st-r` stagger, retimed to the global motion tokens and with a reduced-motion override. Removed the local motion tokens and the old header/message animations.
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:14,70,92,115,121,161` — removed dead `st-t` classes.
- `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts:125-194` — added five focused cases: A→B marks B only; same-tab mode and first session id do not replay; the 400 ms timeout clears and destroy cancels it; rapid A→B→A restarts the window; the production template retains the transcript binding.

`chat-view.component.ts` line count: **2110 before → 2075 after** (35 lines fewer).

## Removal search

Command: `rg -n 'playEnter|wireSessionSwitchStagger|_enterTimer|clearEnterTimer|\bst-f\b|\bst-t\b|data-st-i|ptahStaggerUp|--d:' libs/frontend/chat/src`

Output: `LEGACY_GREP=NO_HITS`.

Command: `rg -n 'offsetWidth' libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

Output: `CHATVIEW_REFLOW_GREP=NO_HITS`. Other `offsetWidth` uses in `libs/frontend/chat/src` belong to file suggestions and settings layout measurement, outside B5.

## Verification

- Requested ChatView Jest scope: 4 existing suites passed. The new suite initially failed two assertions that counted all Jest timers, including Angular's own timers. Result: 126 passed, 2 failed across 5 suites.
- After replacing those timer-count assertions with direct cancellation and restart checks, focused `chat-view.session-enter.spec.ts` Jest run: **1 suite, 5 tests passed**. The full scope was not rerun, respecting the one full-scope run limit.
- `ptah_get_diagnostics` after the source edits reported no errors in the requested files; its later recheck after the spec adjustment timed out and returned unavailable. The focused Jest run compiled and passed the adjusted spec.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the first non-null tab entrance. | Animate first show; skip first show. | The approved motion spec includes first show and the previous tab-edge implementation also entered the first tab. | Yes |
| Keep the inspector's `.st-r` animation on the host class. | Retain and retime; remove it. | Approved plan component 6 and B5 explicitly retain the inspector stagger; U1 holds header and composer still. | Yes |

## Clarifications Needed

None.
