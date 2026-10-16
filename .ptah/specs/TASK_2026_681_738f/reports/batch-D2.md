# Batch D2 — visual followups

## Changes

- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:72`: added one pure helper to derive input, output, total tokens and cost from usage segments; returns null when none are reported. Its return type is the full `CliAgentStats` shape, so optional context and cache fields remain readable by the summary template.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts:67`: falls back to segment usage for the lane row when structured totals are absent.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts:38,170`: carries CLI segments into inspector agent rows so restored lanes retain usage data.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:200,328`: token and cost badges use segment fallback; duration badge displays the same `formatAgentDuration` text as the lane and aria label.
- Specs: `stats-bar.utils.spec.ts:25`, `cli-lane-usage-summary.component.spec.ts:56`, `inspector-agents-section.component.spec.ts:70` cover the helper, restored lane fallback, precedence, and hour duration badge.

## Verification

`npx jest -c libs/frontend/chat/jest.config.ts <three changed spec paths> --coverage=false --maxWorkers=1`: 3 suites passed, 20 tests passed. Scoped Ptah diagnostics found no errors in changed source files, including a repeat on `cli-lane-usage-summary.component.ts` after correcting TS2339 from the helper return type. The chat project has existing errors in unrelated specs; no broad target was run.

## Decisions

- Used `formatAgentDuration` through the existing row view for the CLI badge. The badge component formats with `formatDurationMs`, which leaves durations in minutes. This is a reversible markup choice.
- Kept `usageTotals` authoritative when present and used segment totals only when absent, preserving provider values and the existing total-token precedence. This is a reversible fallback.
- Passed segment references through `SessionAgent` because the inspector row otherwise only received `usageTotals`; no data copy or new store was needed. This is reversible.

