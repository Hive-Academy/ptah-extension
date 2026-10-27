# Code logic review — rev6

Review family: codex (implementer family: Claude)

## Verdict

**REVISE — 7/10.** Three failure modes: 0 blockers, 1 major, 2 minor. The menu repairs are present and the scoped chat tests pass. The B+ implementation still loses available usage on a normal background transition and retains disclosure state across unrelated selections. This is above the 5–6 band because the central list, disclosure, ordering and action paths are implemented and exercised; below 8 because a supported agent lifecycle loses displayed data. Confidence: medium; verification limits are below.

Scope: current working-tree implementations named in the request, including the five new inspector files; no committed-history review. Requirements: `design-spec.md:234` (Revision 2 item 10), the B+ prototype at `prototype/stats-ideas.html:87`, and rev5's five findings. Paths below are relative to the worktree. For concise citations:

- **I/** = `libs/frontend/chat/src/lib/components/organisms/session-inspector/`
- **R/** = `libs/frontend/canvas/src/lib/canvas-rail/`
- **S/** = `libs/frontend/chat/src/lib/services/session-agents/`

## Rev5 findings status

| Finding | Fixed yes/no | Evidence file:line |
| --- | --- | --- |
| Pane actions lacks arrow roving | Yes | `R/canvas-focus-header.component.ts:103` focuses the first item after render; `:115` delegates to `R/canvas-rail-keyboard.ts:27`, which handles wrapping arrows/Home/End. Card delegation is at `R/canvas-rail-card.component.ts:723`. |
| Hand-off picker arrows do nothing | Yes | `libs/frontend/chat/src/lib/components/molecules/send-to-messaging/handoff-binding-picker.component.ts:47` wires the handler; `:196` filters disabled options and handles arrows/Home/End. Its enclosing card skips listbox targets at `R/canvas-rail-card.component.ts:725`. |
| Pointer Close unnecessarily moves to a neighbouring card | Yes, source path; integration qualification below | `R/canvas-rail-card.component.ts:590` captures focus before pointer activation; `:581` restores an outside, connected target after render using the application injector. Keyboard activation clears the saved target at `:594`. `R/canvas-board-focus.ts:86` preserves surviving focus. |
| Last-session close leaves focus on body | Yes | `R/canvas-board-focus.ts:87` falls back to hero New session, then footer New session. The actual close path invokes it at `R/canvas-rail-board.component.ts:1074`, after the removal guard at `:1060`. |
| Failed Stop has no announcement | Yes for rejected abort promise | `R/canvas-rail-card.component.ts:569` logs and announces the rejection; the live region is at `:401`. `R/canvas-rail-card.component.spec.ts:1099` verifies rejection handling and rendered announcement. |

## Findings

1. **Major — backgrounding a sub-agent discards available usage figures.** `I/inspector-agents-section.component.ts:473` resolves a monitor sub-agent only when `lane.kind === 'subagent'`. However, `S/session-agent-roster.ts:174` represents a monitor record whose status becomes `background` as `bg:<parentToolUseId>`; the record remains in the sub-agent monitor. Those roster rows carry no usage totals or segments (`S/session-agent-roster.ts:137`). Consequently `I/inspector-agent-usage.ts:34` receives neither monitor source: context, input/output and cost become null (`:59`, `:63`, `:65`), although the record still reports them. Tray extras retain only model and token total (`S/session-agent-tray.service.ts:65`). **Scenario:** expand a sub-agent with reported usage, send it to background, and inspect its normalized `bg:` row: known detail figures and cost turn into “not reported.” **Fix:** look up the same monitor record for both `subagent` and `background` lane kinds; retain the null fallback for background-only records. Add a transition test preserving Context, In/out and Cost across `sub:x → bg:x`. The test named “reuses sub-agent lane usage for context…” at `I/inspector-agents-section.component.spec.ts:314` asserts tokens, model tooltip and In/out at `:340`, but never Context and never the background case.

2. **Minor — a previously collapsed row stays collapsed after host selection changes or a session switch.** `I/inspector-agents-section.component.ts:265` stores only a global `collapsedKey`; `:351` applies it to every current selection. It is cleared only by selecting a different row through the component's own click handler (`:360`), not by changes to `selectedAgentKey` or `tabId`. The dock reuses the inspector with input-bound session/selection (`R/canvas-inspector-dock.component.ts:180`, `:193`). **Scenario:** collapse Orchestrator in session A, switch to session B with Orchestrator selected: B starts collapsed too. Likewise, collapse row A, change host selection to B and back to A: A remains collapsed despite the comment promising that selecting another row clears it. **Fix:** scope disclosure state to session identity and reset the collapse marker when effective selection changes, without resetting a user's deliberate collapse on ordinary usage ticks. Test host-driven A→B→A and tab changes. The existing host test (`I/inspector-agents-section.component.spec.ts:237`) only checks key normalization, not this lifecycle.

3. **Minor — seven rows with the last selected produces a no-op “Show 0 more.”** `I/inspector-agents-section.component.ts:316` appends a selected row outside the first six. With exactly seven rows and row seven selected, all seven are visible and `hiddenCount()` is zero (`:324`), but the button condition at `:214` checks total list length instead. Clicking it only changes the label to “Show fewer,” which also removes nothing for that selection. **Fix:** show the expansion control when `showAll()` is true or `hiddenCount() > 0`, or reserve one of the six slots for the selected row. Add exactly-seven-row coverage and a list-shrink case; the existing below-fold test uses ten total rows (`I/inspector-agents-section.component.spec.ts:281`) and misses the boundary.

## Five logic questions

1. **Silent failure:** a background transition renders valid usage as absent without an error; see finding 1 and `I/inspector-agent-usage.ts:59`.
2. **Unexpected user action:** changing sessions after collapsing Orchestrator carries that collapse into another session; see finding 2 and `I/inspector-agents-section.component.ts:351`.
3. **Wrong answer from input data:** exactly seven rows, with the seventh selected, gives a zero-item expansion action; see finding 3 and `I/inspector-agents-section.component.ts:324`. The formatter guards non-finite/negative token and cost figures at `I/inspector-agent-list.ts:83`; this does not prevent the missing-source problem above.
4. **Dependency failure:** rejected session Stop promises now produce a live announcement (`R/canvas-rail-card.component.ts:569`). Missing monitor usage becomes dashes (`I/inspector-agent-usage.ts:34`, `I/inspector-agent-list.ts:96`); that is appropriate for genuinely absent data, but not for the resolvable background record. End-to-end RPC timeout/cancellation behavior was not exercised.
5. **Unspecified requirement:** disclosure lifetime across session identity and host-driven selection is not stated in item 10; the component itself promises reset on another selection (`I/inspector-agents-section.component.ts:264`). Finding 2 uses that local contract and avoids requiring an invented persistence policy.

## Decisions

- Preserve the requested B+ replacement: removing the expanded strip/in-flow card is explicitly authorized by `design-spec.md:235`. Template-consumer search across `apps` and `libs` found the remaining lane-strip instance in the collapsed rail (`R/canvas-inspector-dock.component.ts:128`) and the floating card in `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:228`; no remaining bindings of the removed sidebar/inline modes on those components were found. Unrelated settings-toast `[inline]` is not a consumer. Reversible presentation change; no scope escalation needed.
- Keeping a selected agent visible below the fold is defensible rather than hiding the active detail. Preserve that choice while fixing the expansion control (finding 3); alternative is a strict six-row cap. Evidence: `I/inspector-agents-section.component.ts:315`. Reversible.
- Do not score the roster-only CLI fallback's exact/partial distinction as a production defect: the roster currently obtains CLI entries from the same monitor (`S/session-agent-roster.service.ts:82`, `S/session-agent-roster.ts:169`). A fixture that supplies roster usage with an empty monitor is not by itself proof of a reachable production path.
- `ptah_code_search_symbols` returned zero hits with an empty index; native text search was used as fallback. No source, task state or machine-owned task document was changed.

## Could not check

- Ran exactly one scoped check: `npm run verify -- -t test -p @ptah-extension/chat -- "--testPathPatterns=inspector-agent|send-to-messaging"`. Result: Nx reported **1 task succeeded**, exit 0, no cache hit. This covers the matching chat specs, not canvas or chat-ui test execution. No build, serve or e2e run.
- Scoped `ptah_get_diagnostics` returned **Unavailable**, with 15 files unchecked because its TypeScript check was still running after 45 seconds. This is not a clean diagnostics result; it reported that the underlying check was not cancelled.
- No browser/assistive-technology run. Pointer-close test `R/canvas-rail-card.component.spec.ts:1122` checks focus restoration but its output subscriber is a spy (`:1129`); it does not remove the card. Actual card destruction, async removal and popover focus-return ordering remain integration uncertainties, despite the source repair.
- Fully traced the new agent view-model, usage mapping and disclosure paths. Large existing canvas composition files and their broad specs were inspected selectively around the affected wiring/focus paths, not exhaustively; this verdict is not approval of all their existing logic. Some large reads were output-truncated. The consumer scan is text-based and does not substitute for an Angular template typecheck.
- No `task-description.md`, `implementation-plan.md`, `batches.md`, `tasks.md`, `test-report.md` or `code-style-review.md` appeared in the discovered task folder. The supplied request, context, design specification and rev5 review supplied the review contract. No separate style verdict is asserted.
