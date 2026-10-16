# Delta 2 cross-side design review

**Verdict: REVISE — 7/10.** Scope is limited to delta 2. The provider fallback is a Serious finding; the status vocabulary is Moderate. Gate 1.7 is not approved until the Serious finding is resolved.

## Findings

1. **Serious — An unknown session provider is shown as Claude.** `design-spec.md:617`, `:1056`, `:1280`, and `:1296` prescribe a Claude fallback or a Claude prototype default. `task-description.md:703-704` and PM-14 at `:64` require a neutral orchestrator glyph when the frontend cannot identify the provider. `libs/frontend/chat-types/src/lib/chat-types.ts:603-650` has session ID and status but no session provider; `libs/shared/src/lib/types/execution/node.ts:229-264` has no provider in `ChatSessionSummary`; `libs/shared/src/lib/types/rpc/rpc-session.types.ts:600-609` has no provider in the liveness response. A Claude mark on a non-Claude session misidentifies the running engine. **Fix:** make the neutral glyph the explicit unknown-provider fallback throughout §4.7, D37, architect check 1, and the delta change table. Use a vendor mark only when an authoritative session provider ID is available. The mock Claude mark may remain only if the mock explicitly declares a Claude session.

2. **Moderate — New tile and dock status words diverge from today's vocabulary and the prototype.** `design-spec.md:609-612`, `:1259-1270`, and `:1281` call the blocked state “needs you” and the failure state “error”; §3.5 at `design-spec.md:246-253` uses `waiting` and `failed`. The existing compact lanes print the source status verbatim (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-lanes.component.ts:112-118`), and the delta prototype also prints `waiting` / `failed` (`prototype/assets/app.js:66-71`, `:345-361`). Requirement 18.8 demands the same status word across views (`task-description.md:710-712`). **Fix:** specify `waiting` and `failed` as displayed agent status words everywhere in the new dock, card, menu, and AGENTS tile. Keep “needs you” as the permission summary and overflow priority meaning; map `waiting` to that priority. Treat `error` as the data-state synonym for displayed `failed`, if applicable.

## Rulings

- **a. Provider fallback:** PM-14 and requirement 18.5 govern: neutral orchestrator glyph when the session's provider is unknown. The session types inspected above expose no authoritative provider ID. `ContextCapacity.providerId` exists in a model-stat path (`libs/frontend/chat-state/src/lib/live-context-stats.ts:36-37`), but it is not established as the session's CLI engine. Do not infer the session provider from it without an explicit contract.
- **b. Status word:** Today's compact lane text and the delta prototype say `waiting`; the new dock should use `waiting`. “Needs you” remains the user-facing request count and overflow urgency phrase, not a replacement agent status word. `failed` is today's failure word.
- **c. Overflow:** Approved as a changed mechanism, not a capability removal. Today's horizontal scroll and edge mask are at `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:40-44`; the delta keeps the selected item visible and all agents reachable in the menu (`task-description.md:753-763`, `parity-inventory.md:133-134`). Priority order and menu access need implementation checks at narrow widths.
- **d. Orchestrator status:** Frontend derivation is feasible. Today's switcher hard-codes `running` (`canvas-lane-tabs.component.ts:119`), while `TabState.status` exists (`libs/frontend/chat-types/src/lib/chat-types.ts:649-650`) and distinguishes active streaming from idle/background states (`:530-551`). The parent can pass the focused tab's status to the dock. The architect must settle the display mapping, including pending user requests and resumed sessions.
- **e. Contrast:** No new foreground/background pair is evident from the delta recipes: §4.7 cites state ink, muted text, kind badge, selected border, and focus ring already audited in §8.2 (`design-spec.md:662-664`, `:788-802`, `:818-827`). The rotating 28% track is expressly decorative; glyph and word carry status (`:609-613`). WCAG 2.2 AA criteria are 4.5:1 for normal text and 3:1 for meaningful UI graphics, as stated at `:801`. This is a specification audit, not a fresh rendered contrast measurement.

## Architect checks

1. Identify an authoritative **session engine provider ID** available to Electron, Rail, and VS Code, or document its absence and apply the neutral fallback (`design-spec.md:1279-1280`; `task-description.md:699-704`). Do not equate model pricing/context provider with the CLI engine without evidence.
2. Define one typed status mapping from monitored agent, pending request, and tab turn state to `running | waiting | done | failed | stopped | queued`; use it in every avatar view (`design-spec.md:1281-1282`; `task-description.md:710-712`). For the Orchestrator, pass focused `TabState.status` into the dock and distinguish streaming/resuming from loaded/awaiting-background/sleeping (`chat-types.ts:530-551`).
3. Name the source of the sub-agent role type and the single CLI ID to provider ID table, including `pi` and `ptah-cli` artwork (`design-spec.md:1283`, `:1287`; `task-description.md:690-698`).
4. Preserve the session ownership filter, `sub:`/`bg:` migration, and selected-item visibility when replacing scroll with priority overflow (`design-spec.md:1284-1286`; `parity-inventory.md:127-135`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Unknown session engine uses a neutral orchestrator glyph. | Neutral glyph; guessed Claude mark; generic monogram. | User decision requires the actual provider (`decisions.md:34-35`); PM-14 and requirement 18.5 explicitly select neutral (`task-description.md:64`, `:703-704`); current session types lack provider. | Yes, once an authoritative provider field exists. |
| Display `waiting` / `failed` for agent states; reserve “needs you” for request urgency. | Existing words; new words. | Current compact lanes and delta prototype (`compact-session-lanes.component.ts:112-118`; `prototype/assets/app.js:66-71`); §3.5 vocabulary (`design-spec.md:246-253`). | Yes. |
| Priority overflow is an acceptable move of scroll access. | Horizontal scroll; priority overflow plus complete menu. | PM-15 (`task-description.md:65`), parity E-9/E-10 (`parity-inventory.md:133-134`), dock criteria (`task-description.md:753-763`). | Yes. |

## Check note

The optional prototype check was started through the required `check-run.mjs` wrapper. It had not returned a result at review writing time, so no pass count is claimed. No build or workspace-wide check was run.
