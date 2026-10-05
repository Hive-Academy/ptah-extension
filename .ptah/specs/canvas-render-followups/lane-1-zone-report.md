# Lane 1 — zone coalescing

Implemented the scoped Zone.js reduction without changing listener behaviour.

| Surface | Before | After | Zone re-entry |
| --- | --- | --- | --- |
| `app.config.ts:141` | Event coalescing only | Adds `runCoalescing: true` | N/A |
| `agent-monitor-panel.component.ts:557` | Angular template scroll binding | Passive native scroll listener outside Angular at `:958`, removed through `DestroyRef` | Not needed: the rAF handler only updates private `pinnedToBottom`. |
| `agent-lane-scroll.directive.ts:13` | Directive host scroll binding | Passive native scroll listener outside Angular at `:25`, removed through `DestroyRef` | Not needed: the rAF handler only updates private `pinned`. |
| `inline-agent-bubble.component.ts:448` | Angular template scroll binding | Passive native scroll listener outside Angular at `:766`; cleanup removes it | Not needed: it updates private auto-follow bookkeeping only. |
| `compact-session-activity.component.ts:566` | Angular template scroll binding | Passive native scroll listener outside Angular at `:951`; cleanup removes it | Not needed: it updates private `isUserScrolledUp`; later view work is signal-driven. |
| `tab-bar.component.ts:91` | Angular template scroll binding | Passive native scroll listener outside Angular at `:403`; cleanup removes it | Not needed: `checkScroll()` writes signals, which schedule OnPush change detection. |
| `tab-manager.service.ts:2583` | Zone-scheduled debounce and max-wait timers | Both timer registrations run outside Angular at `:2590` and `:2601` | Not needed: callbacks persist state; signal reads do not require re-entry. |

The existing focused listener specs already dispatch real `scroll` DOM events (including the agent-monitor sticky-scroll coverage). Their behaviour remains the intended regression surface after native registration.

## Verification

- AST parse checks for all changed TypeScript sources: clean, zero error nodes.
- Requested chat Jest command was started directly, but did not complete within the available foreground tool window while other Node workers were active; no count was produced.
- Requested chat `tsc` command was started directly and likewise did not complete in that window; no count was produced.
- Scoped TypeScript diagnostics were requested twice. The compiler reported that its check was still running after 45 seconds, so the result was unavailable rather than a pass/fail count.

## Open items

- Re-run the requested direct Jest and three scoped `tsc` commands when the shared runner is idle to record final counts.
- The source changes preserve the existing event-dispatch regression tests; no test implementation was altered in this lane.

## Revision 1

- Removed the remaining inline agent-bubble template scroll binding. The native passive listener remains attached to that same `#contentContainer` element, so a scroll now invokes the handler once.
- `tab-bar` now stores the element reference when it registers the scroll listener and uses that captured reference during destruction. The other lane listeners already remove from their captured element (a closure or dedicated element field), rather than reading a view-child during cleanup.
- Added focused specs for one rendered inline-bubble scroll event invoking the handler once and tab-bar destruction removing the native scroll listener from the registered element.
- Scoped diagnostics completed with the repository's pre-existing chat-spec errors; the two generic-call errors introduced by the new tests were corrected after that diagnostic. No long test or compiler command was run in this revision.
