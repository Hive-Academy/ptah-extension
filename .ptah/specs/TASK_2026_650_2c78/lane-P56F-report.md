# P56F follow-ups

## Findings fixed

| Item | Fix file:line | Spec file:line |
| --- | --- | --- |
| Reload neutral status in either reply order | `guidance-generation.store.ts:89`, `generation-workflow-shell.component.ts:407` | `guidance-generation.store.spec.ts:123`, `generation-workflow-shell.component.spec.ts:113` |
| Failed toggle restores the saved checkbox value | `guidance-result-panel.component.ts:36` | `guidance-result-panel.component.spec.ts:5` |
| Remove unreachable model-specific guidance copy | `generation-guidance-page.component.ts:47`, `generation-workflow.store.ts:156` | `generation-guidance-page.component.spec.ts:123`, `generation-workflow.store.spec.ts:33` |
| Restored route offers Back to chat without showing another workspace's data | `generation-workflow-shell.component.ts:249` | `generation-workflow-shell.component.spec.ts:274` |
| Widget launch failure keeps the status and actions visible | `setup-status-widget.component.ts:145` | `setup-status-widget.component.spec.ts:125` |
| Hub ignores a second activation while launch is pending | `setup-hub.component.ts:1434` | `setup-hub.component.spec.ts:135` |

## Checks

- Focused setup-wizard Jest: 5 suites, 36 tests passed (`--coverage=false --maxWorkers=1`).
- Focused chat-ui Jest: 1 suite, 7 tests passed (`--coverage=false --maxWorkers=1`).
- Focused harness-builder Jest: 1 suite, 16 tests passed (`--coverage=false --maxWorkers=1`).
- Prettier applied to changed source and specs.
- ESLint found one new unused catch variable, which was removed; its other 109 findings were warnings. ESLint was not rerun after that small correction.
- Scoped `ptah_get_diagnostics` was invoked after edits. The TypeScript compiler did not return within its 45-second window on three attempts; it reported the scoped files unchecked.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Preserve restore state until a run is accepted in this session or is seen non-terminal. | Clear on every adoption; use the workflow's accepted run ID. | AC18 and review N1; the shell exposes `acceptedRun()` and both stores independently fetch the run. | Yes |
| Reset the checkbox property immediately after emitting the requested value. | Wait for a store update; restore from the saved input immediately. | A failed RPC re-read leaves the input value unchanged, so Angular need not write the DOM property again. | Yes |
| Offer Back to chat in the unavailable shell state. | Automatic redirect; explicit action. | Review N4 permits either; the shell already withholds content when the active workspace does not own the tab. | Yes |
| Keep launch errors separate from status-loading errors. | Reuse `error`; add `launchError`. | Review M1; the shared `error` switches the whole widget to a status retry branch. | Yes |

## Deviations

- The guidance RPC host maps model/provider preparation errors to the same `not-running` rejection as other preparation failures and returns a generic provider message. The frontend cannot verify a model-specific cause, so the unreachable model-specific guidance branch was removed. The fixed text remains on the agent path, where the RPC response is distinguishable.
- No `app.config.ts` change was needed: the shell action resolves the restored-route dead end while its existing binding check prevents cross-workspace data from rendering.
- Scoped TypeScript diagnostics were unavailable because the compiler exceeded the tool timeout. The focused Jest suites passed.

## Proposed Removals

None.
