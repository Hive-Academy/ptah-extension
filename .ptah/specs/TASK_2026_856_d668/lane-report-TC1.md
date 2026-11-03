# TC1 lane report

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-session.types.ts`: added optional host-owned `turnCount` contract.
- `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts`: validates prompt fields, retains prompt records without usage, and preserves the tool-result substring gate.
- `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts`: counts parent prompt runs after scope filtering, emits ledger `turnCount`, and omits contribution totals if any part lacks a count.
- `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.spec.ts`: covers prompt classification, compact-summary parity, scopes, contribution completeness, and tool-result boundaries.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`: forwards three flags and `message.content` into the shared ledger builder.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`: verifies resume parity fixture gives two turns.
- `.ptah/specs/TASK_2026_856_d668/lane-report-TC1.md`: this report.

## Test result

`npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="session-usage-aggregator|session-history-reader.service|session-stats-reader.perf" | Select-Object -Last 60`: **1 Nx task succeeded**, exit 0; includes unchanged performance spec. PowerShell has no `tail`, so `Select-Object -Last 60` was used. A direct focused Jest run passed **2 suites, 102 tests**; after the final turn-boundary edit, the aggregator regression rerun passed **1 suite, 22 tests**. `git diff --check` passed. Ptah scoped TypeScript diagnostics remained unavailable after two 45-second calls; both reported the check still running.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Count a run of parent prompts once until an assistant record ends it. | Reset on every nonprompt record, or only on an assistant. | Plan defines one turn as consecutive prompts with no main assistant between; tool-result regression passes. | Yes |
| Keep prompt records usage-free and out of message-id deduplication. | Reuse usage-bearing user records, or retain a separate prompt record. | Component 18 explicitly requires zero usage and no merge by `message.id`; role-fallback fixture passes. | Yes |
| Omit aggregate `turnCount` when any contribution lacks it. | Treat missing as zero, or omit the total. | Plan decision #6; contribution fixture checks absent property. | Yes |

## Not done

- TypeScript diagnostics could not finish through Ptah's scoped diagnostics tool. No project-wide typecheck was run, per lane instruction.
- CLI skill invocation/discovery was not exposed in this session. The local `agent-lanes` skill was read from disk; no agent spawning was needed.
- Concurrent changes in `libs/frontend/chat-state`, `libs/frontend/chat-ui`, and `libs/frontend/chat` shown by `git status` were made by other lanes and were not touched here.
