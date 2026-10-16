# Design spec review, Delta 3, round 1 (Gate 1.7)

Verdict: APPROVED

Score: 9/10

Reviewer: codex

## Findings

| Round-0 finding | Resolved? | Evidence |
| --- | --- | --- |
| 1. Lane-only limit warning hidden with inspector closed | Yes | `design-spec.md:1521-1528,1574-1575` defines one summary over session indicator and lane subgroups, at before near, shared by the chip, description and alert; pending > at > near > workflow dot. `prototype/assets/delta3.js:66-75,282-300` draws the lane case. |
| 2. Sub-agent model in dock card; AGENTS source undefined | Yes | `design-spec.md:1509-1514,1581` confines the model to that agent's AGENTS entry, provides raw-id description and specifies Claude record and CLI lane sources. `agent-monitor.store.ts:141,448,613`; `background-agent-tray.component.ts:246-277,294-331` show the proposed frontend join points. `prototype/assets/app.js:162-165` draws the AGENTS token and accessible raw id. |
| 3. Moved details hover-only | Yes | `design-spec.md:1443-1448,1534-1538` specifies four focusable disclosures, exact detail text and focus order. `prototype/assets/delta3.js:139-145` renders buttons with `aria-expanded` and `aria-controls`. |
| 4. Unknown context inconsistent | Yes | `task-description.md:863-867` and `design-spec.md:1434-1435` now agree on an em dash, no used-token count and no ring. `session-stats-summary.component.ts:215-225`; `.html:338-350` support that rule. `prototype/assets/delta3.js:147-157` draws it. |
| 5. C-48b called pending | Yes | `task-description.md:953-957,1068-1070` and `parity-inventory.md:142` mark it settled under decisions row 54. |
| 6. Prototype missing states | Yes | `prototype/assets/delta3.js:38,50-53,214-219` draws the cost-budget bar and status, evidence and cooldown tiles in `stats=more`; `DELTA-3-NOTES.md:47` records the variant. |

1. **Minor — two prototype notes retain superseded descriptions.** `prototype/DELTA-3-NOTES.md:27` still says the status/evidence/cooldown tiles are “not drawn in the mock,” despite `delta3.js:50-53,214-219` drawing them. The same notes at `:35` still say the sub-agent model moves to the dock hover card, contrary to the corrected rule at `:47`, `design-spec.md:1509-1511`, and the actual AGENTS row in `prototype/assets/app.js:162-165`. Update those two rows before using the notes as implementation handoff.

## Rulings

- D56 is accepted as revised: the composer selector remains the only model control or label in the main column; known sub-agent models appear in their inspector AGENTS entries, with raw ids available to assistive technology (`design-spec.md:1509-1514`; `task-description.md:885-893`).
- The closed-inspector warning covers both plan windows and lanes, with a textual chip and toggle description (`design-spec.md:1521-1528`). The context unknown state makes no measured claim (`design-spec.md:1434-1435`).
- The tray move preserves the shown session's entries and actions in AGENTS. The session scope and absence of an “other sessions” group follow the settled user decision (`design-spec.md:1499-1515`; `decisions.md:59`; `task-description.md:953-957`).

## Proposed Removals

None. C-48b was settled by decisions row 54; other sessions' agents remain reachable from their own tabs (`parity-inventory.md:142`; `task-description.md:953-957`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| APPROVED at Gate 1.7, with one minor notes correction | APPROVED; REVISE | All six round-0 findings resolved above; no Blocking or Serious finding remains | Yes |
| Keep agent model in inspector AGENTS only | Footer; dock card; AGENTS | `design-spec.md:1509-1514`; `task-description.md:885-893`; `agent-monitor.store.ts:141,448,613` | Yes |
| Treat C-48b as settled session scope | Cross-session AGENTS group; session-scoped AGENTS | `decisions.md:59`; `task-description.md:953-957`; `parity-inventory.md:142` | Yes |

## Clarifications Needed

None. This was a read-only design and source review; no build or test was run.
