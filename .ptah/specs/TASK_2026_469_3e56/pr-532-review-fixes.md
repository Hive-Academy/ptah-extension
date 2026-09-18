# PR #532 review fixes

## Comment disposition

1. **`.ptah/specs/TASK_2026_469_3e56/code-style-review-frontend.md:12` — fixed.** Reconciled the summary to five minor issues and restored the omitted single-target caret finding in the formal minor list at `.ptah/specs/TASK_2026_469_3e56/code-style-review-frontend.md:11,127`. No behavior test applies; this is a historical-report correction.

2. **`.ptah/specs/TASK_2026_469_3e56/code-style-review-frontend.md:22` — fixed.** Corrected the historical-diff link so its label and repo-relative target both identify `diff-tabs.service.ts` at `.ptah/specs/TASK_2026_469_3e56/code-style-review-frontend.md:22`. No behavior test applies.

3. **`.ptah/specs/TASK_2026_469_3e56/code-style-review.md:1` — fixed.** Deleted the duplicate `code-style-review.md` and retained `code-style-review-frontend.md` as the single frontend style-review record. No behavior test applies.

4. **`.ptah/specs/TASK_2026_469_3e56/fix-round-1-backend.md:15` — fixed.** Replaced the workstation-specific `D:/projects/ptah-extension/` prefixes in the backend fix record with repo-relative paths at `.ptah/specs/TASK_2026_469_3e56/fix-round-1-backend.md:9-15,32,41-43,54-55,66`; the retained frontend style report's targeted links are repo-relative at `.ptah/specs/TASK_2026_469_3e56/code-style-review-frontend.md:18,22`. No behavior test applies.

5. **`.ptah/specs/TASK_2026_469_3e56/fix-round-1-frontend.md:35` — fixed.** Marked the effect-write finding as historical and superseded by Item 8 at `.ptah/specs/TASK_2026_469_3e56/fix-round-1-frontend.md:36` and `.ptah/specs/TASK_2026_469_3e56/code-style-review-frontend.md:18,84`, without rewriting the original finding. No new behavior test applies; the existing named test remains `resets drop confirmation when the popover open state changes`.

6. **`.ptah/specs/TASK_2026_469_3e56/fix-round-2-frontend.md:27` — fixed.** Scoped Items 5 and 6 to the scenarios their named tests actually prove and recorded the then-remaining superseded-reload defect at `.ptah/specs/TASK_2026_469_3e56/fix-round-2-frontend.md:24,29`. No new behavior test applies to the report correction.

7. **`.ptah/specs/TASK_2026_469_3e56/verify-round-2.md:7` — fixed.** Reconciled the verdict with the final logic review: ten of eleven original defects, Backend defect 2 marked not fixed for off-list PATH executables, and the third merge blocker corrected to the superseded stash reload at `.ptah/specs/TASK_2026_469_3e56/verify-round-2.md:5,14,41-45`. No behavior test applies to the historical-report correction.

8. **`libs/backend/platform-core/src/utils/terminal-launch.ts:217` — fixed.** An executable outside the built-in list now appends all built-in candidates from index zero, while a matched executable still appends only later candidates and duplicate avoidance remains in place at `libs/backend/platform-core/src/utils/terminal-launch.ts:210-215`. Test: `appends every built-in candidate after a detected path outside the built-in list` at `libs/backend/platform-core/src/utils/terminal-launch.spec.ts:232`.

9. **`libs/backend/vscode-core/src/services/git-info.service.ts:2455` — fixed.** The stash format is now ref, hash, timestamp, then variable message; parsing reads the hash from field two and rejoins remaining message fields at `libs/backend/vscode-core/src/services/git-info.service.ts:2441-2443,2455,2468-2472`. Test: `parses tab-separated stash list output into StashEntry[]` at `libs/backend/vscode-core/src/services/git-info.service.spec.ts:720`, including a tab inside the message fixture.

10. **`libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.spec.ts:84` — fixed.** The shared setup resets `stashCount` at `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.spec.ts:77`; the stash test no longer owns cleanup. No new test applies; this isolates all existing header tests.

11. **`libs/frontend/git-ui/src/lib/services/git-branches.service.ts:550` — fixed.** A response without a transport error now returns only `{ success: false }`, allowing the caller's Fetch/Pull/Push fallback copy to win at `libs/frontend/git-ui/src/lib/services/git-branches.service.ts:548-551`. Test: `leaves caller-specific fallback copy to the caller when the RPC has no error` at `libs/frontend/git-ui/src/lib/services/git-branches.service.spec.ts:449`.

12. **`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:325` — fixed.** `loadListFor()` now distinguishes `applied`, `failed`, and `superseded`; both mutation recovery branches restore fallback errors only for an applied reload, while successful-mutation reconciliation treats only an actual failed reload as failure at `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:24,119-178,318,331,347`. Test: `preserves a newer reload failure when the mutation reload is superseded` at `libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts:421`.

13. **`libs/backend/platform-core/src/utils/terminal-launch.ts:264` — fixed.** The final candidate is now probed before success at `libs/backend/platform-core/src/utils/terminal-launch.ts:255`. Skipping it could falsely report success for a process that acquired a PID and died immediately without opening a terminal; truthful failure is worth the bounded 1.5-second wait. Test: `rejects when the final candidate starts and then dies inside the probe window` at `libs/backend/platform-core/src/utils/terminal-launch.spec.ts:343`.

No review comment was skipped as contradictory or purely stylistic.

## Verification

`npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/rpc-handlers --parallel=1 --skip-nx-cache`

```text
Test Suites: 42 passed, 42 total
Tests:       4 todo, 804 passed, 808 total
Test Suites: 39 passed, 39 total
Tests:       663 passed, 663 total
Test Suites: 27 passed, 27 total
Tests:       420 passed, 420 total
Test Suites: 101 passed, 101 total
Tests:       33 skipped, 3074 passed, 3107 total
NX   Successfully ran target test for 4 projects
```

`npx nx run-many -t typecheck -p @ptah-extension/git-ui @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/vscode-core @ptah-extension/rpc-handlers`

```text
NX   Running target typecheck for 8 projects:
NX   Successfully ran target typecheck for 8 projects
```

`npx nx run @ptah-extension/git-ui:lint`

```text
D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\diff-view\diff-view.component.ts
  946:1  warning  File has too many lines (1417). Maximum allowed is 700  max-lines
✖ 1 problem (0 errors, 1 warning)
NX   Successfully ran target lint for project @ptah-extension/git-ui
```

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`

```text
degradation-audit: scanned 2900 file(s)
  libs/backend/platform-core: 7 ok (baseline 7)
  libs/backend/rpc-handlers: 1 ok (baseline 1)
degradation-audit: TOTAL 303 unsuppressed site(s)
```

## CI e2e failures

The two failing Playwright tests in `apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts` encoded the replaced header contract and were updated without changing production code:

- The former `git dock header hides the push button when there is nothing to push` case is now `git dock header keeps Fetch, Pull and Push available when the branch is in sync`. With `ahead: 0` and `behind: 0`, it asserts that Fetch, Pull, and Push are visible, that Pull and Push have the plain accessible names without counts, and that clicking each control reaches `git:fetch`, `git:pull`, and `git:push` respectively.
- `git dock header push button pushes unpushed commits to remote` retains its `git:push` observation. It now asserts the current nonzero contract: accessible name `Push (2 ahead)`, visible `↑2`, accessible name `Pull (3 behind)`, visible `↓3`, and an always-visible Fetch control.

These Playwright e2e changes are **unverified locally** because the target requires a built Electron dist and is intentionally slow/serial. A human can run exactly:

```text
npx nx run ptah-electron-e2e:e2e -- --grep "git dock"
```
