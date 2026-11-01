# CX5 lane report

## Files changed

- `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.spec.ts`: pinned F2 (65%), F3 (13%), F5 (105% unclamped), and all three F6 unavailable-capacity variants through `inputs().context`.
- `libs/frontend/chat/src/lib/services/vitals/chat-vitals.store.spec.ts`: pinned the same cases through `ChatVitalsStore.context()`.
- `.ptah/specs/TASK_2026_856_d668/lane-report-CX5.md`: this report.
- No source files changed. No unrelated working-tree changes observed in `git status --short`.

## Test result

- `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-stats-source|chat-vitals.store" | Select-Object -Last 60`: **PASS**, `NX 1 task: 1 succeeded` (exit code 0). Run once.
- `git diff --check`: PASS.
- Scoped `ptah_get_diagnostics` completed on retry. It found no new errors in the added assertions. It still reports a pre-existing TS2352 in `session-stats-source.spec.ts` (the invalid-cache cast, present in `HEAD`) and 263 errors across the owning project; a clean project typecheck is therefore not claimed.

## Defects found

- None in the context projections; all requested cases passed.

## Anything not done

- A DOM assertion for the empty-state ring's 100% width clamp is outside the two permitted spec files. The store test pins its unclamped input at 105%; the existing component clamps that value at lines 165–173.
- No UI render was needed for this test-only batch. No matching Angular testing skill or skill loader was exposed in this session; the available local skill inventory only listed unrelated skills.
