# Batch 28 report — Thoth shell Library fixture

## What changed

- Reduced `skillStateStub` to the pause and telemetry signals and methods used by the current Skills tab and its pause switch. Removed candidate, suggestion, stat, queue, digest, spec, detail, selection, filtering, promotion, rejection, acceptance, and dismissal stubs, including `refreshSuggestions`, `refreshCandidates`, `loadStats`, and `loadSettings`.
- Removed the candidate-row fixture (`pendingByRoot`, `allRows`, and the scoped `listCandidates` implementation). Kept a minimal `listCandidates` mock solely to assert that the shell never calls it.
- In `shows desktop-only placeholder for skills tab when not on Electron`, replaced the obsolete status-filter-chip assertion with an assertion that the current Skills Library notice appears. No test was deleted.
- Preserved the Skills tile On/Off, workspace refresh, `settings:get` telemetry, active-tab, and pause badge assertions. Added an explicit `listCandidates` not-called assertion to the tile refresh test and kept that assertion in the pause refresh test.

## Acceptance rg result

`rg -n "refreshSuggestions|listCandidates|listSuggestions" libs/frontend/thoth-shell` finds **no** `refreshSuggestions` or `listSuggestions` references. Its five `listCandidates` hits are the mock declaration, mock setup, RPC stub property, and two `not.toHaveBeenCalled()` assertions in `thoth-shell.component.spec.ts`; there is no candidate fetch.

## Decisions

- Retained `getSettings` for the live pause badge tests and `settings:get` for the Skills tile telemetry contract (O21).
- Kept the negative `listCandidates` contract check while replacing its old candidate-row behavior with an empty mock.
- No test, typecheck, lint, build, serve, or e2e command was run, per task rules. Verification was limited to reads and `rg`.

## Clarifications Needed

None.
