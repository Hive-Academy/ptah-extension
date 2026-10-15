# Code Logic Review R9d — Rail lane ownership (`TASK_2026_629_c0b3`)

Review family: Claude reviewing codex. Scope: `compact-lane-rows.ts`, `compact-session-card.component.ts` (+ their specs), `canvas-lane-tabs.component.spec.ts` (spec only), read in full with their consumers. Specs not re-run; I accepted the lane report's pass counts (7/44/6).

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE with fixes (NEEDS_REVISION only if the contract's "only when SESSION_CONTEXT exists" is binding) |
| Blocking / Serious / Moderate / Minor | 0 / 0 / 2 / 2 |

## Verified behaviour
- Rows, counts, `+N` and Rail state all derive from one `buildLaneSummary` output. The CLI filter is now `agent.parentSessionId === sessionId` (`compact-lane-rows.ts:58`). Unresolved (`undefined`) and foreign owners are dropped before `rows`, `counts`, `total` and `moreCount`, so all four stay consistent. Overflow is computed after the filter (spec: 1 owned row, `max=1`, `moreCount` 0).
- An owned agent appears once: it is a single array element mapped once, and the lane-tabs spec asserts a unique `cli:owned` tab id.
- Empty and undefined ids: `sessionIdentity = claudeSessionId ?? tab.id` (`card.ts:205`). The real `agentsOwnedBySession` returns `[]` for a falsy id (`agent-monitor.store.ts:892`). `knownSessionId` stores `''` as `undefined` at every writer, so `'' === ''` cannot match. If `claudeSessionId` were literally `''`, `??` would not fall through, but the result is the safe `[]`.
- `knownSessionId` root cause: the report correctly says unowned-forever agents are a backend event gap (TASK_2026_633). The Rail now hides them instead of repeating them on every card. They remain visible in the tolerant main monitor (`chat-view.component.ts:548`, `agentsForSession`). No silent drop in the main-panel monitor path.
- Lane tabs: `canvas-lane-tabs.component.ts:100-110` already uses strict `ownedBySession`, which returns `[]` for a null session id. The new spec is a real discriminator: it uses three agents and asserts the exact tab list.
- Consumers of the changed code: `buildLaneSummary` is called only from `compact-session-card.component.ts:232`. The card is hosted by (a) canvas Rail cards (`canvas-rail-card.component.ts:84,110`), strict, correct, and (b) `chat-view.component.html:9`, whose `showCompactCard()` (`chat-view.component.ts:925`) is true on the main panel as well (see finding 1). Other `agentsForSession` users (`tile-agent-indicator.component.ts:63`, `chat-view.component.ts:548`, the monitor store views) are untouched and stay tolerant.

## Findings

1. **Moderate — strictness is applied to the card in every host, not only scoped Rail hosts (contract deviation).** `buildLaneSummary` and the card never consult `SESSION_CONTEXT`. `chat-view.component.ts:925-929` renders the same card in the non-canvas main panel whenever the active tab's view mode is compact (or `SESSION_FORCED_CARD` is set). In that host an agent with an unresolved owner now disappears from the card rows, counts and rail state. The same agent remains visible in the main monitor, so it is not lost, but D10 and the batch contract ("only when SESSION_CONTEXT exists") asked for a tolerant main panel. The card's permission callouts were already strict (`card.ts:267,486`), so this is the same class of change, just wider than stated. Fix: either record in D10 that the compact card is strict by design in every host (the cleanest option, since `variant` and `SESSION_CONTEXT` are not exposed to the card), or inject `SESSION_CONTEXT` optionally in the card and use `agentsForSession` when it is absent. Add a spec for the chosen behaviour.
2. **Moderate — the card spec does not pin the card change.** The spec's `agentStore` mock returns the unfiltered list from `agentsForSession` (`compact-session-card.component.spec.ts:143`). The strict filter inside `buildLaneSummary` alone therefore makes the new test pass. Reverting `card.ts:228` to `agentsForSession` would not fail it. Fix: make the mock's `agentsForSession` tolerant per `agentVisibleInSession`, or spy and assert `agentsOwnedBySession` was called with the session id.
3. **Minor — the "Now line" assertions are tautological.** `summary()` is built only from `context()` and `messages()` (`card.ts:424-430`), never from CLI agents. The assertion `nowLabel.nextElementSibling.textContent === summary().content.text` compares a binding to itself, and `not.toContain('unowned' | 'foreign')` checks agent ids that are never rendered (rows show `cli`/`displayName`, i.e. "codex"). Neither can fail on a regression. The Now line was never agent-dependent, so the requirement is satisfied by construction. Fix: drop these two assertions, or give the agents distinct `displayName`s and assert their absence.
4. **Minor — a redundant double filter.** The card pre-filters with `agentsOwnedBySession`, and `buildLaneSummary` filters again. The result is correct and defensive, and `buildLaneSummary` is a public export (`chat/src/index.ts:33`). Because the pure function now has a stricter contract than its old signature, add a short doc comment saying so. Also note that `''` is not rejected inside `buildLaneSummary` itself. This is harmless, since normalisation upstream prevents `''` owners.

## Five logic questions
1. Silent failure: an unowned-forever agent is now invisible on Rails, with no "unattributed" affordance. This is accepted by D10 and deferred to 633, but it makes that backend finding user-visible.
2. User action: switching a main-panel tab to compact view hides unresolved agents (finding 1).
3. Wrong-answer data: owner `''` is normalised to `undefined` and dropped. A tab that has not yet received `claudeSessionId` uses `tab.id`, so agents already keyed by the SDK id show nothing until binding. That is correct, and the row appears on binding because the signals are reactive.
4. Dependency failure: none introduced.
5. Missing: no spec covers a tab whose `claudeSessionId` is unset or `''`. No spec covers the main-panel compact host (findings 1 and 2).

Nothing found is Blocking or Serious. No stale state: both inputs are signals and `sameLaneSummary` equality is unchanged.
