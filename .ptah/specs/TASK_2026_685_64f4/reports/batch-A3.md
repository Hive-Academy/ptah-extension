# Batch A3 — execution header and flat CLI lane

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts:6` — new 30 px disclosure row, sibling action slot, and controlled details region. `execution-header.component.spec.ts:18` covers metadata, tone, projection, and expansion.
- `libs/frontend/chat/src/lib/components/molecules/turn/turn-disclosure-row.component.ts:119` — optional extra metadata and warning tone, included in the accessible name. `turn-disclosure-row.component.spec.ts:4` locks the existing defaults.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:62` — flat presentation now uses the shared header; at `:211` card duration uses the shared run rule, and at `:221` the lane label, peek, counts, tokens, and guard reason are derived. `agent-card-flat-header.spec.ts:20` covers the flat surface.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts:58` — removed the duplicate duration input and display. `cli-lane-usage-summary.component.spec.ts:23` updated for the new contract.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts:1` — removed unused `formatElapsed`; its spec had no cases for that function.
- `libs/frontend/chat/src/lib/utils/message-summary.utils.ts:109` — pure `summarizeExecutionNodes` reuses the existing walker. `message-summary.utils.spec.ts:4` covers nested tools and unique files.
- `libs/frontend/chat/src/lib/components/index.ts:55` — exported the new component.

## Preserve list

| Old flat header item | New place |
| --- | --- |
| Running/completed status badge | Running pulse and `Working`/`Worked` label in disclosure row; guard stop reason remains visible as warning metadata |
| Stop | Sibling action button while running, named for the agent |
| Resume | Sibling action button for finished lanes with CLI session ID, named for the agent |
| Remove column | Sibling action button when `closable` |
| Elapsed duration | Once in the disclosure label |
| Model badge | Model fact in details |
| Usage context, input, output, cache read, cache write, and cost | Moved usage summary in details, with the same partial values |
| Task text | Task fact in details |
| Parent ID | Parent fact in details |
| CLI session ID | CLI session fact in details |

## Decisions

- Use the existing tree builder for flat lane metadata, with the same event-first selection as `CliAgentOutputComponent`; this keeps tool and file counts on the rendered execution source. Reversible.
- Show a token total only when a reported total or at least one input/output count exists; segment fallback receives the partial `≥` prefix. This follows `usageTotalsFromSegments` and avoids an invented zero. Reversible.
- Keep card presentation on its existing header and Task disclosure path. Its elapsed number now uses `formatAgentDuration`; the duplicate duration in the usage row was removed as directed by the plan. Reversible.

## Verification and remaining work

- No tests, lint, build, serve, or e2e commands were run, per the batch instruction. The orchestrator owns those checks.
- Scoped `ptah_get_diagnostics` reported no diagnostics in requested changed files. It also reported 267 errors in sibling files in the project; those files are outside this batch.
- Nothing else remains within A3 scope.
