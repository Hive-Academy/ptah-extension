# Hang fix report

## Cause

`trackWorkspaceBinding.open()` retried `openStart()` while the active workspace differed from `store.workspace()`. If `openStart()` returned without binding the store, that condition stayed true forever. The controller spec's coordinator mock exposed this and the test worker exhausted memory.

## Fix

- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.ts:30-40`: capture the active workspace before each `openStart()` call and retry only if it changed during that call. Cap the sequence at three calls. A switch during loading still opens the new workspace.
- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.spec.ts:9-42`: regression test confirms an unbound store resolves after one call. The existing switch test confirms exactly one additional call and the new workspace's start state.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:82`: add `refreshSessions` to the coordinator mock so workspace clearing exercises the binding contract.

## Checks

- Prettier on all three edited files: passed.
- Scoped `ptah_get_diagnostics`: no diagnostics in edited files. It reported 29 errors in other project specs; the project typecheck target passed.
- Targeted Jest for controller and binding specs, 300-second job timeout, `--maxWorkers=2`: exit 0.
- `npx nx typecheck command-center --parallel=1 --output-style=static`: passed.
- `npx nx lint command-center --parallel=1 --output-style=static`: passed.
- `npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2`: 41 suites and 430 tests passed.

## Decisions

- Retry based on the workspace path changing during the call, with a three-call cap. The task supplied this approach; the store may legitimately remain unbound when a load fails. Reversible.

