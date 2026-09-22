# PR #568 feedback — CI gates and review comments

Two CI jobs failed and CodeRabbit left six comments. One failure was ours, one
was not. Two of the six comments were real bugs.

## Items

| # | Item | Outcome | Where |
| - | ---- | ------- | ----- |
| 1 | degradation-audit ratchet: `auth-providers 25 FAIL (baseline 24)` | Fixed with a documented suppression. `failResponse` was confirmed to genuinely handle the rejection — it destroys the streams and rejects the enclosing request promise, and the forwarding boundary logs it and sends an error response. Baseline NOT raised. | `translation-proxy-base.ts:909`, handler `:789`, boundary `:411` |
| 2 | **Real bug.** `probeModels` accepted non-empty stdout without checking the exit outcome, so a run that wrote partial output then exited non-zero published each partial line as a model id. | Fixed. Both attempts now require `exitCode === 0 && !timedOut && !errored`. The cold-start retry still fires on the exit-0-empty-stdout signature. | `opencode-cli.adapter.ts:393` |
| 3 | **Real bug.** Unhandled rejection from `PtahCliStreamLoop.run`. | Fixed. Narrowed and logged, converted to the existing failure exit code 1 before callback disposal, proxy teardown and pending-turn resolution. | `ptah-cli-registry.ts:865` |
| 4 | Security (CWE-200): a local account name in committed spec records. | Fixed. Three absolute paths replaced with `%USERPROFILE%`, measurements preserved. Case-insensitive sweep of both task folders found no remainder. | `TASK_2026_525_dbb1/context.md:4,:63,:64` |
| 5 | Task status out of date. | Fixed. `backlog` → `in_review` on BOTH carriers, not just the one flagged. | `TASK_2026_525_dbb1/task.md:3`, `TASK_2026_526_1e6f/task.md:3` |
| 6 | Broken markdown table (MD056): unescaped `\|` inside a cell. | Fixed. | `TASK_2026_526_1e6f/catalog-batch-report.md:10` |

Items 5 and 6 were completed by the orchestrator: the executing lane's role
forbids editing `task.md` and unrecognised task-folder documents, which is a
correct restriction rather than a failure — it declined and reported the exact
values instead.

## Tests added

- `opencode-cli.adapter.spec.ts:255` — parameterized over attempt 1 and attempt
  2: a failed attempt carrying valid-looking stdout yields `[]`, with no extra
  retries. This is the regression for item 2.
- `ptah-cli-registry-sakana-proxy.spec.ts:242` — parameterized over `Error` and
  string rejections: a stream-loop rejection logs, resolves both the initial and
  the queued continuation turn with exit 1, and stops the proxy exactly once.
  Regression for item 3.

## Verification

```
npx nx run degradation-audit:lint
  libs/backend/auth-providers: 24 ok (baseline 24)
  degradation-audit: TOTAL 302 unsuppressed site(s)
  NX   Successfully ran target lint for project degradation-audit

npx nx typecheck @ptah-extension/cli-agent-runtime
  NX   Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime

npx nx test @ptah-extension/cli-agent-runtime
  Test Suites: 64 passed, 64 total
  Tests:       1 skipped, 1015 passed, 1016 total

npx nx lint @ptah-extension/cli-agent-runtime
  ✖ 42 problems (0 errors, 42 warnings)

npx nx test @ptah-extension/auth-providers
  Test Suites: 46 passed, 46 total
  Tests:       824 passed, 824 total
```

## Not ours — deliberately untouched

`electron-e2e` also failed, on
`apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts:251`:

```
strict mode violation: getByRole('tab', { name: 'beta.ts (working tree)', exact: true })
resolved to 2 elements
```

`betaTab` is scoped to `page` rather than to the `diffTablist` locator the
adjacent assertion uses, so it matches any identically-named tab elsewhere in
the document. The spec is unchanged on `main` since 2026-09-18, four days before
this branch, and this PR touches no git or dock file. Re-run rather than patched;
fixing an unrelated area inside this PR would have widened its blast radius for
no benefit.

## Known, not fixed here

Four pre-existing task folders still contain the same account name that item 4
redacted from ours — `TASK_2026_237`, `TASK_2026_381`, `TASK_2026_396`,
`TASK_2026_398`. They predate this PR and are out of its scope, but the CWE-200
argument applies to them identically and they are worth a sweep.
