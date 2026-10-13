# BM1 report — Orchestra Canvas metrics

## Summary

Implemented the retained top-level TodoWrite marker, strict todo selector, and fixed todo/context/git slots in the board metrics zone. Exposed the selector and state types from chat-ui. The live marker is carried across compaction so the selector returns unknown while the new state has no parseable live input.

## Per-item status

| Item | Status | Evidence |
| --- | --- | --- |
| Top-level marker, timestamp ordering, replacement and FIFO retention | Done | `libs/frontend/chat-types/src/lib/chat-types.ts:66,250-262`; `chat-types.spec.ts:21-62` |
| Todo parsing and newest top-level selection | Done | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-metrics.ts:30-99`; `compact-session-metrics.spec.ts:29-130` |
| Fixed todo, context and git slots, progress and state titles | Done | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:785-855,882-883`; `compact-session-activity.component.spec.ts:1232-1285` |
| Public exports | Done | `libs/frontend/chat-ui/src/index.ts:49-55` |
| Compaction amendment A1 | Done | `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:575`; `accumulator-core.service.spec.ts:908-917`; `compact-session-metrics.spec.ts:101-106` |

The selector ignores sub-agent live events and finalized agent subtrees. A missing, partial, malformed, or folded newest input yields unknown, even when an older finalized list exists. An empty valid list yields none. Known lists count completed items and expose the in-progress text. The board renders an em dash for missing or unknown slots, titles for their states, and a trailing plus sign with the partial git title.

## A1 resolution

`compaction_complete` creates a fresh `StreamingState` and copies the latest TodoWrite marker before publishing it. Its events and accumulators remain empty, so `summarizeTodos` returns unknown until a parseable live input arrives or the turn finalizes. This is a one-line production change in chat-streaming. Tests cover the replacement state's marker and the selector's refusal to show an older finalized list. The marker update in `setStreamingEventCapped` precedes both same-id replacement and FIFO insertion; tests cover both.

## Tests and checks

All changed files were formatted with `npx prettier --write`.

| Command | Observed result |
| --- | --- |
| `npx nx test @ptah-extension/chat-types --testFile=chat-types.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Unavailable: project has no `test` target. |
| Temporary Jest configuration using repository preset and ts-jest, scoped to `chat-types.spec.ts`, `--coverage=false --maxWorkers=2` | 1 suite, 3 tests passed. Temporary configuration removed after the run. |
| `npx nx test @ptah-extension/chat-ui --testFile=compact-session-metrics.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 6 tests passed. |
| `npx nx test @ptah-extension/chat-ui --testFile=compact-session-activity.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 46 tests passed. |
| `npx nx test @ptah-extension/chat-streaming --testFile=accumulator-core.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 47 tests passed. |
| `npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 70 suites, 1,113 tests passed. |
| `npx nx test @ptah-extension/chat-streaming --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 25 suites, 627 passed, 1 skipped. |
| `npx nx typecheck @ptah-extension/chat-types --parallel=1 --skip-nx-cache` | Passed. |
| `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` | Passed. |
| `npx nx typecheck @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache` | Passed. |
| `npx nx lint @ptah-extension/chat-types --parallel=1 --skip-nx-cache` | Passed without warnings. |
| `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` | Passed with 7 warnings; one is the preexisting activity component max-lines warning. |
| `npx nx lint @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache` | Passed with 2 warnings in unrelated files. |

`compact-session-activity.component.ts` grew from 1,230 to 1,290 lines. The extra lines are the three metrics slots and two inputs in the existing template/component; no new component was introduced.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Carry the marker through compaction | Carry marker, or add a reset flag to streaming state | `accumulator-core.service.ts:574-576` creates an empty replacement; marker alone makes the selector conservatively unknown | Yes; a future explicit reset flag can replace the copy. |
| Keep fixed slots in the existing metrics zone | Existing zone or a new metrics component | `compact-session-activity.component.ts:785-855` already owns the persistent zone and stats row | Yes. |
| Use the shared TodoWrite guard plus per-item validation | Trust the guard, or validate each item | `libs/shared/src/lib/type-guards/guards/exec.ts:238-247` checks only the array shape | Yes. |

## Open items

- `chat-types` has no Nx test target; its new spec runs through a temporary Jest configuration. The project may add a permanent test target later if desired.
- The chat-ui card and canvas detail wiring are assigned to later BM batches. Their absent inputs currently render placeholders as designed.
