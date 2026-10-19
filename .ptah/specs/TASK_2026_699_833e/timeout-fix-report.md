# Lane plan limits timeout fix

## Diff

- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts:17-18`: comment now cites backend `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12 s); `LANE_PLAN_LIMITS_TIMEOUT_MS` changed from `10_000` to `15_000`.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.spec.ts:111`: expected timeout changed from `10_000` to `15_000`. The RPC option assertion uses the constant and needed no other change.

## Spec result tail

Command: `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.spec.ts --coverage=false --maxWorkers=2`

```text
node.exe : Test Suites: 1 passed, 1 total
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Test Suites: 1 passed, 1 total:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

Tests:       21 passed, 21 total
Snapshots:   0 total
Time:        7.822 s
Ran all test suites matching
libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.spec.ts.
```

Exit code: 0. PowerShell formatted Jest's stderr summary as a `NativeCommandError`; the suite passed.

## Other worktree changes

Changes in `sidebar-tab.component.ts`, `split-handle.component.ts`, their specs, and task review/decision files were present or appeared during this work. I did not edit or revert them. Other task files and `.electron-userdata/` were also present.
