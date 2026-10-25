# CI fix report — PR #817

## Files changed

- `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts`: removed `[openOnFocus]="false"`, restoring the search field's default focus-opens-list behavior.
- `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts`: corrected spec #35 to assert that refocus after Use opens an empty search, Escape closes only the list and retains focus, and the closed field displays the drafted model label. Preserved the no-write-before-Save and exact saved model/scope/context assertions.
- `.ptah/specs/TASK_2026_718_15b7/decisions.md`: marked #10 superseded and added #16 with the e2e contract and rationale.
- `.ptah/specs/TASK_2026_718_15b7/ci-fix-report.md`: this report.

## Decisions

Restore the existing product behavior rather than change the e2e contract or disable focus opening to satisfy a unit assertion. `settings-visual.e2e.spec.ts:1136` requires the focused model input to have `aria-expanded="true"` after manual-entry Cancel. Both Cancel and Use return through `closeManual()`. The shared field displays the search query while open and the selected label while closed. This reversible change aligns spec #35 with that behavior; the e2e file is unchanged.

## Verification

Ran only the requested Jest spec once, with coverage disabled and two workers:

```text
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts --coverage=false --maxWorkers=2
```

PowerShell captured combined stdout/stderr, displayed the final 40 lines using `Select-Object -Last 40` (the equivalent of `tail -40`), and searched the complete captured output for `console\.` using `Select-String`. Exit code: 0. No console stubs were added.

Exact Jest result lines:

```text
Test Suites: 1 passed, 1 total
Tests:       42 passed, 42 total
Snapshots:   0 total
Time:        5.925 s
```

```text
Console output matches (console.): 0
```

The required role-level `ptah_get_diagnostics` call scoped to the two changed TypeScript files reported no diagnostics in either requested file. It also reported 253 errors in sibling files; these were outside this fix's ownership and were not modified. This is not a clean project-wide typecheck claim.

## Risk and limits

Low risk: one template input override was removed and the regression spec now covers the restored focus/open/Escape sequence plus persistence of the manual model draft. Browser behavior across the four CI variants still requires CI confirmation; no e2e, build, workspace-wide checks, package installation, or git commands were run. All changes remain local in the assigned worktree.
