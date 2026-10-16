# Batch D report

## Item 17 — flat CLI lane presentation

- `agent-card.component.ts:46,136`: added `presentation` input, defaulting to `card`; flat mode removes the outer frame and always renders the body. The Task disclosure stays closed by default and contains the full CLI session id.
- `agent-card-header.component.ts:43,182`: flat mode hides the expand control, name badge, and session id; status, model, elapsed time, and Stop/Resume remain.
- `cli-agent-output.component.ts:35,134`: flat mode hides the duplicate stats bar and removes the output frame and horizontal padding.
- `cli-lane-usage-summary.component.ts:18,64`: flat mode removes the usage row box and duplicate elapsed value.
- Extended `agent-card-header.component.spec.ts` and `cli-agent-output.component.spec.ts` for default card and flat behavior.

## Item 15 — inspector AGENTS rows

- `session-agent-roster.ts:72,167`: activity scans backward for a non-usage segment and carries structured `usageTotals` to the row.
- `inspector-agents-section.component.ts:65,189,351`: CLI rows show token, known cost, and duration badges. The badge row wraps whole badges within a narrow inspector; the CLI lane kind badge remains.
- Added `session-agent-roster.spec.ts` and `inspector-agents-section.component.spec.ts` for usage filtering, known badges, and absent usage values.

## Verification

- Focused Jest: 4 suites passed, 26 tests passed (`--coverage=false --maxWorkers=1`).
- Scoped `ptah_get_diagnostics` called after edits; TypeScript compiler service timed out and reported the six source files unchecked. No type-check result is claimed.

## Decisions

- Flat mode keeps the header's elapsed value and hides the usage row's elapsed value. Evidence: the header is the action/status row and the user requested one elapsed display. Reversible.
- Missing token counts suppress the token badge, and unknown cost suppresses the cost badge. Evidence: structured totals distinguish missing values from zero, and the user requested absent values render no badge. Reversible.
- Task disclosure carries the full session id in flat mode. Evidence: the id was removed from the header and must remain available for resume context. Reversible.

## Proposed Removals

None.

## Not done

- The scoped diagnostics service did not produce a TypeScript result before its timeout.
