# Gate 1 re-review — Revision 1

**Verdict: APPROVED**

1. **Resolved — running-first rendered order.** `task-description.md:51-53` requires left-to-right running-first order, defines the selected non-running exception, and requires a rendered-order component test. `parity-inventory.md:28` matches it.
2. **Resolved — five-chip cap bypasses.** `task-description.md:51-53` caps every rendered path at five chips and names non-finite width, missing `ResizeObserver`, resize, and focused-dock status tests. `parity-inventory.md:28` covers each case.
3. **Resolved — keyboard parity.** `task-description.md:53,59` defines dock and rail focus order, freeze behavior, hidden-focus recovery, and selection behavior. `parity-inventory.md:12,29` requires the corresponding tests.
4. **Resolved — Stop target capture.** `task-description.md:65` fixes the inspector tab/session across query, confirmation, abort, cleanup, and fallback, including active-tab changes. `parity-inventory.md:22` requires both asynchronous tests and cancel/single-abort checks.
5. **Resolved — per-status jump actions.** `task-description.md:57-59` keeps all five labeled actions with counts and pointer/keyboard tests. `parity-inventory.md:8` preserves their accessible names and jump behavior.

**New Blocking issues:** None found in Revision 1.
