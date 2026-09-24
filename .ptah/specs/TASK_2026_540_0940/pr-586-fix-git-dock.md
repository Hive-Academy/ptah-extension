# PR-586 — Fix flaky `git-dock.spec.ts` diff-tab test

Branch `feat/task-540-global-config-menu` · CI failure run 35970324119 · TASK_2026_540_0940

## Cause

The test **`opens, switches, and closes independent diff tabs`** (starts
`apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts:251`) mocked `git:diffFile`
with ONE static reply at a time: the alpha payload was installed first, then
REPLACED by the beta payload right before opening the second tab (the removed
call was at pre-fix lines 299-307). If the already-open alpha tab re-requested
its diff after the swap (e.g. on a refresh), it received beta's payload and was
relabelled `beta.ts (working tree)`.

In CI run 35970324119 that race happened before the assertion
`expect(betaTab).toHaveAttribute('aria-selected','true')` (pre-fix line 319,
now `git-dock.spec.ts:325`): TWO tabs were named `beta.ts (working tree)`
(ids `git-diff-tab-0-0` and `git-diff-tab-0-1`) and the alpha tab was gone, so
Playwright's strict-mode locator failed. The previous CI run passed because
the re-request is timing-dependent — hence flaky, not deterministically broken.

## Fix

`apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts` — one change:

- **`git-dock.spec.ts:277-300`** — register the `git:diffFile` mock ONCE, before
  any tab opens, as a path-keyed resolver:

  ```ts
  const diffByPath = {
    'alpha.ts': gitDiffFileMock({ path: 'alpha.ts', comparison: 'worktree',
      original: "export const value = 'alpha original';\n",
      modified: "export const value = 'alpha modified';\n",
      snapshotToken: 'alpha-snapshot' }),
    'beta.ts': gitDiffFileMock({ path: 'beta.ts', ... 'beta-snapshot' }),
  };
  await ui.mockRpc({
    'git:diffFile': `(params) => (${JSON.stringify(diffByPath)})[params.path]`,
  });
  ```

  Each path now always gets its own payload, no matter when (or how often) an
  open tab re-requests its diff. The resolver string is compiled in the main
  process via `new Function('params', ...)` (`apps/ptah-electron-e2e/src/support/ui-driver.ts:113-133`),
  so it cannot close over test variables — hence the `JSON.stringify`-embedded
  table. The params key was confirmed against `GitDiffFileParams`
  (`libs/shared/src/lib/types/rpc/rpc-git.types.ts:339-345`): `path: string`).
- The second `ui.mockRpc` call (pre-fix `git-dock.spec.ts:299-307`) that swapped
  in beta's static payload is removed; the beta-open click at
  `git-dock.spec.ts:314-316` is kept as-is.
- A 5-line comment at `git-dock.spec.ts:277-281` explains why the mock is
  path-keyed (an already-open tab can re-request its diff) and why the table is
  embedded rather than closed over.
- Original/modified strings, `comparison: 'worktree'` and snapshot tokens
  (`alpha-snapshot`, `beta-snapshot`) are byte-identical to the previous mocks.
- **No assertion changed**; every `expect` in the test is untouched.
- No other test in `git-dock.spec.ts` relied on the removed call: the other four
  tests never mock `git:diffFile`; the CX:120 test only asserts
  `getObservedCalls('git:diffFile')` is empty (an observed-call log, not mock
  state), and each test runs in a freshly launched app.

## Verification

`npx nx run-many -t typecheck,lint -p ptah-electron-e2e --skip-nx-cache` —
exit code 0:

```
 NX   Running targets typecheck, lint for project ptah-electron-e2e:
- ptah-electron-e2e

√  nx run ptah-electron-e2e:typecheck
√  nx run ptah-electron-e2e:lint

 NX   Successfully ran targets typecheck, lint for project ptah-electron-e2e

  Run duration:      6.0s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     5.9s (1 task)
```

The Electron e2e suite itself was NOT run (it cannot run reliably on this
machine, per task instructions); verification is typecheck + lint only.
