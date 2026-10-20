# Phase B fix D: Thoth shell spec fakes

## Changed lines

- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:17`: import `ClaudeRpcService` for the status service's settings RPC fake.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:125-129`: add typed telemetry state signals and `refreshTelemetryEnabled`/`setTelemetryEnabled` methods, fixing the initialization exception at the reported `:368` and `:748` sites.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:560`: type the existing settings mock's result for the pause switch.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:641-655`: answer `settings:get` for `skills.telemetry.enabled` and `skillSynthesis.enabled`, so the real status service can load telemetry and refresh pause badges.

## Root cause

The test state stub predated the telemetry switch added to `SkillSynthesisStateService`. The real `ThothStatusService` now reads Skills telemetry and the Skills pause flag through `ClaudeRpcService`, but this suite supplied only a `SkillSynthesisRpcService` fake. The new RPC fake returns successful setting reads and routes the pause value through the existing `getSettings` mock.

Scoped `ptah_get_diagnostics` reported no errors in the edited spec and six errors in unedited sibling files. Jest, Nx, lint, typecheck, build and e2e were not run, as instructed. The spec retains LF line endings.

## Part 2

- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:545-577`: describe the telemetry contract and count the Skills `settings:get` reads.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:600-626`: return telemetry values for the active fake workspace; preserve the separate pause setting response.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:669-670`: provide the observable settings RPC mock.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:687-740`: assert `On` → `Off` after a tab switch, `On` after a workspace switch, three telemetry setting reads, and no extra read on an active-tab click. The existing Paused badge assertions and no-`max-w-` assertion remain.

Clarification resolved by orchestrator decision O21: the Skills tile follows the current telemetry setting contract. The candidate fake remains because the Paused badge suite still references it. No tests or build commands were run, as instructed. The edited spec retains LF line endings.
