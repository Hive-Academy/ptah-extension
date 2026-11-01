# B11 lane report

## Revise round 1 (latest result)

- File changed: `libs/frontend/chat/src/lib/components/molecules/agent-card/stdout-visibility.spec.ts`. Its card fixture now supplies a fixed `WallClockService` and no longer supplies the obsolete `AgentMonitorStore.tick` stub. The assertion that structured text replaces raw stdout is unchanged.
- Cause addressed: B11 made the card acquire a real wall clock interval in this test. The full batch gate passed lint and typecheck but intermittently failed this one test among 5,340. The scoped test passed before the edit, so the failure was not reproduced in isolation and the interval cannot be proven to be the sole cause. A fixed clock removes the new timing variable from a test whose behavior does not depend on elapsed time. The resolver does not mutate segments, and the component's tree-building path remains unchanged.
- Final check: **passed** after the edit with `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="stdout-visibility|cli-agent-output|inspector-agent-usage|agent-card" | Select-Object -Last 60`. The same check also passed once before the edit; two of three permitted revise-round runs were used.
- Scoped Ptah diagnostics found no errors in `stdout-visibility.spec.ts`; the tool also listed unrelated sibling diagnostics.
- Not done: the full 5,340-test gate was not rerun in this lane.

## Files changed

- `agent-card.component.ts`: passes `resolveCliLaneUsage(agent)` to the output header and uses `injectWallClock('second', ...)` for elapsed time and lane label. No `store.tick` read remains.
- `cli-agent-output.component.ts`: uses resolved usage for card header tokens, cost, exact total label, and partial `≥` cue. Keeps a shared fold for standalone consumers with no lane record.
- `cli-agent-output.component.spec.ts`: checks partial header and summary cues, reported zero, and clock acquisition/release with interval spies; updates retained-output expectations.
- `inspector-agent-usage.ts`: takes CLI tokens, cost, partial state, and in/out counts from the resolver when a CLI record exists.
- `inspector-agent-usage.spec.ts`: compares one partial fixture against the resolver and lane stats, and verifies absent figures render `—` instead of zero.

All source and spec files above are under `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\frontend\chat\src\lib\components\`. The first three are in `molecules\agent-card\`; the last two are in `organisms\session-inspector\`.

## Verification

- Required lane check ran three times. Final run: **failed**, with 99 passed and 2 failed. Both failures were older expectations in the editable `cli-agent-output.component.spec.ts` for partial output; those expectations were updated afterward. No fourth lane check was run because the task caps it at three.
- Direct Jest verification after the last edit: **2 suites passed, 23 tests passed** (`cli-agent-output.component.spec.ts` and `inspector-agent-usage.spec.ts`; `--coverage=false --maxWorkers=2`).
- Scoped Ptah diagnostics: no errors in the five edited source/spec files. Diagnostics also listed errors in sibling chat files outside this lane's scope.

## Decisions

- Agent cards always supply the resolver result to the header. Direct `CliAgentOutputComponent` consumers that have only segments use the shared `addCliUsage` fold to retain their existing reported total/model/duration display.
- Retained output is marked partial even when a segment includes a numeric total. `Reported total` appears only for an exact total; missing values remain absent in the header and `—` in the summary and inspector.
- The clock subscribes only while the agent is running and releases its interval when the agent completes.

## Anything not done

- A post-fix run of the full lane-check command was not possible under the three-run cap. The changed specs passed directly.
- No rendered screenshot was captured: this lane forbids build, serve, dev, and extra HTML artifacts, so no scoped running UI or artifact was available for Ptah browser inspection.
