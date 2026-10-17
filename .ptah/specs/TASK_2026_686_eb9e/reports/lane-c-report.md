# Lane C review

## Findings

- **C1 — valid.** `tribunal-run-coordinator.ts:166-174` answered the question and awaited `discoveryComplete()` on every confirm, including retries after task, manifest, or launch failure. The entry now records completed discovery and skips that wait on retry (`:66`, `:169-178`). Added a no-second-pulse launch retry regression and updated the cancellation-on-retry spec (`tribunal-run-coordinator.spec.ts:152`, `:347`).
- **C2 — valid.** The page claimed “Drag to tilt orbits” (`command-center-page.component.ts:209`), while `command-scene.component.ts:298-300` registers move, leave, and click handlers only. Removed the drag claim; kept “Select a sphere for status” (`:209`). No paired spec asserted the hint.
- **C3 — valid.** `command-center-page.controller.ts:550-554` matched move words anywhere and treated “fix the race condition” as a Tribunal request. `hasTribunalIntent` now requires the word “tribunal” or a launch verb followed by an optional article and a known move (`command-center-tribunal-intent.ts:3-9`); the controller uses it at `:550`. Added helper cases for incidental text and explicit requests (`command-center-tribunal-intent.spec.ts:3-15`), plus controller cases for ordinary sends with and without a session (`command-center-page.controller.spec.ts:1465-1483`). Existing controller and Tribunal integration specs now use explicit launch wording.
- **C4 — valid.** `confirmProposal` cleared its card only for success (`command-center-page.controller.ts:588-590`), although the coordinator terminates some failed proposals (`tribunal-run-coordinator.ts:147-150`, `:183-184`). The card now clears on success or a nonretryable result (`command-center-page.controller.ts:589`). A controller spec retains the card after a retryable manifest failure, clears it after a nonretryable availability failure, and checks that another Confirm does not report the same failure (`command-center-page.controller.spec.ts:1547-1566`).
- **C5 — valid.** `runState` returned `starting` for zero agents regardless of manifest age (`command-center-projection.source.ts:23-29`). It now uses a named two-minute launch window and returns the existing `unknown` state afterward; manifest projection passes `startedAt` (`:21-29`, `:186`). Specs cover the boundary and a projected manifest with agents cleared while fresh and old (`command-center-projection.source.spec.ts:18-22`, `:379-395`).

## Files changed

- `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`
- `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.ts` (new)
- `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.spec.ts` (new)
- `libs/frontend/command-center/src/lib/integration/tribunal-confirm-gate.spec.ts` (associated controller integration spec)
- `.ptah/specs/TASK_2026_686_eb9e/reports/lane-c-report.md`

Controller line count: **693** (PowerShell count; `wc` is unavailable in this shell). Scoped `ptah_get_diagnostics` was attempted after edits but its TypeScript compiler check remained unavailable after the 45-second limit. Nx, Jest, tsc, build, serve, e2e, and package were not run, as instructed.

## Decisions

- **Intent boundary:** Use a pure helper with `TRIBUNAL_MOVES`. Alternatives were a controller regex or a broader natural-language parser. The explicit review criterion and controller line limit support the helper. Reversible.
- **Old manifest state:** Use `unknown` after two minutes with no matching agents. Alternatives were leaving `starting` or using another terminal state. `CommandWorkState` already includes `unknown`; absence of agents does not establish success or failure. Reversible.
- **Integration spec wording:** Update the associated Tribunal confirm gate spec from “Relay review” to “run relay review” because its prior input depended on the bug being fixed. Reversible.
