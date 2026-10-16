# Design spec review, Delta 3 (Gate 1.7)

Verdict: REVISE

Score: 6/10

Reviewer: codex

## Findings

1. **Serious — lane-only limits can disappear when the inspector is closed.** D3.7 shows the header chip and description from `limits.indicator`, and D3.9 repeats that source (`design-spec.md:1510-1513,1559-1560`). Today's view model sets `indicator` only from `session.indicator`, while lane tiles are built separately (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.ts:55-64`). A near/at-limit lane with no session alert therefore has no textual closed-state warning, contrary to `task-description.md:916-919`. Define a session-scoped aggregate that examines lane states as well, chooses at before near, and supplies the full warning text to the chip and toggle description. Keep the dot precedence pending request > at limit > near limit > workflow.

2. **Serious — D56 places a read-only model label back in the main chat surface and leaves its inspector data path undefined.** `design-spec.md:1503,1113` adds `Model {name}` to the *main-view agent dock* hover/focus card, although `task-description.md:881-888` permits only the composer selector in the chat-view main column. The inline bubble's model comes from its node (`inline-agent-bubble.component.ts:889-904`); today's tray row type has no model field (`libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:46-80`), and the tray mapper does not copy one (`libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.ts:246-277,294-331`). Specify a frontend-only join or existing source for each agent's model and show it visibly in that agent's **inspector AGENTS** entry, with the raw id accessible. Remove the proposed dock-card model line.

3. **Serious — moved explanatory details are hover-only in the specification and prototype.** D3.3 assigns `tooltip = contextTooltip()`, `tokenTooltip()`, `costTooltip()` and `agentsTooltip` to static tiles (`design-spec.md:1433-1442`), but does not specify a focusable control or accessible description for the token breakdown, partial-coverage line, budget lines, cost explanation and lifetime-agent count. The prototype's static tile uses `title` without keyboard focus (`prototype/assets/delta3.js:101-108`). Requirement 21.4 explicitly requires the same text by keyboard focus *or* an accessible description (`task-description.md:858-861`). Attach descriptions to named values or provide a focusable details control, and specify the exact content and focus order.

4. **Moderate — unknown context is internally inconsistent.** D3.3 shows `152.9k tokens` plus `Window unknown` (`design-spec.md:1434`), while the current strip emits an em dash for the percent and omits used tokens when the capacity is unknown (`session-stats-summary.component.ts:215-225`; `.html:338-350`). Requirement 21.5 itself says an unknown window shows a percent (`task-description.md:862-865`), contrary to the current frontend. Reconcile the requirement and design to the current evidence; do not imply a measured percentage or display a previously hidden count as parity.

5. **Moderate — C-48b approval state conflicts across documents.** The user accepted session-scoped AGENTS with no other-sessions group (`decisions.md:59`; `design-spec.md:1504`), yet `task-description.md:947-949` and `parity-inventory.md:142` still call the cross-session removal pending. Mark that decision settled in those documents before implementation handoff; other sessions' agents remain reachable through their own tabs.

6. **Minor — prototype omits several specified states.** `prototype/DELTA-3-NOTES.md:49-55` says status/evidence/cooldown tiles, cost-budget bar and dock model card are not drawn; `prototype/assets/delta3.js:153-160` renders window tiles only. The spec covers these (`design-spec.md:1439,1470`), so implementation values are not being invented, but Gate 1.7 visual review cannot inspect those states. Add representative interactive states when revising the prototype.

The main move otherwise tracks the requested capabilities: the strip and tray leave the main column (`design-spec.md:1381-1388`); SESSION, AGENTS, PLAN LIMITS and LANES carry compactions, budgets, estimate marks, known subtotal, per-model data, window resets and provenance, lane Subtotal and agent actions (`design-spec.md:1401-1504`). The full-state prototype orders the sections as D45 specifies (`prototype/assets/app.js:257-263`). Window tones reuse the engine state (`design-spec.md:1466,1557`); no provider window is fabricated (`design-spec.md:1454-1457`). Tiles meet the stated 24 px target floor (`design-spec.md:1522-1523`). The contrast report's muted label on surface-1 pair is 5.71:1 dark and 5.46:1 light against the 4.5:1 text criterion (`design-spec.md:1526-1534`), and the checked pair is present in `prototype/assets/contrast-delta3.mjs:20-24`. No build or test was run; this is a document and source review.

## Rulings

- **D56: REJECT as written.** Moving the *sub-agent's* model out of the inline bubble is a defensible reading of the user's broader “all read-only model labels in the chat area” answer (`decisions.md:55`; `task-description.md:881-888`), despite it being distinct from the session model. Showing that model in the main-view dock hover card reintroduces the label there. Keep the composer selector, put the sub-agent model in its inspector AGENTS entry, and keep the session model and per-model totals in SESSION Models.
- **Cross-session tray: ACCEPT the user's row 54 decision.** The inspector is session-scoped; the other sessions' tabs retain their agents and actions. The pending-removal labels are stale documentation, not a new approval requirement.

## Proposed Removals

None newly proposed. C-48b's cross-session list was already resolved by the user's answer in `decisions.md:59`; the requested move preserves each shown session's tray capabilities.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Return REVISE at Gate 1.7 | APPROVED; REVISE | Serious findings 1-3 violate closed-state reach, model placement and keyboard parity | Yes |
| Keep sub-agent model, but only in the inspector AGENTS entry | Keep footer; show in dock card; show in AGENTS | `task-description.md:881-888`; `design-spec.md:1503`; source model at `inline-agent-bubble.component.ts:889-904` | Yes |
| Treat C-48b as settled by the user | Pending; accepted session scope | `decisions.md:59`; `design-spec.md:1504` | Yes |

## Clarifications Needed

None. The findings can be resolved from the recorded user decisions and frontend sources.
