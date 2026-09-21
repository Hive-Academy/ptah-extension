> **HISTORICAL RECORD, 2026-09-19.** This is the batch-1 safety stop, and every
> claim below is scoped to batch 1 as it stood then. It is kept unedited because
> the reasoning that led to the stop is worth preserving.
>
> It does NOT describe the final state of this task. Batch 1 concluded that no
> safe fix existed, on the premise that the SDK requires a raw-string prompt to
> parse a slash command. `experiment-slash-over-streaminput.md` later ran the
> real SDK and disproved that premise, and the fix landed in `9cfb77c800`
> (production changes plus two agent-SDK specs), with e2e coverage in
> `256e2b6a2b` and `787455788a`.
>
> For the final state read `acceptance-evidence.md`, not this file.

## Files changed

- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_472_a7e2\implementation-plan.md` — records the independently confirmed mechanism, the unsafe-fix decision, blast radius, alternatives, and residual risk.
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_472_a7e2\batch-1-report.md` — records the safety stop and the required verification output.

No production source file was changed. The proposed persistent-stream substitution cannot preserve the raw-string slash-command contract with the installed SDK.

## Test added

No test was added because the task explicitly requires stopping without production changes when the persistent-stream fix is unsafe. A test that merely encodes a broken prompt substitution would not prove the requested behavior. The future regression test must exercise a supported SDK mechanism that keeps a raw slash prompt non-single-turn and must assert prompt shape and persistent input attachment, not elapsed timing.

## Command output

`npx nx run-many -t typecheck -p @ptah-extension/agent-sdk`

```text
 NX   Running target typecheck for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk



> nx run @ptah-extension/agent-sdk:typecheck

> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json




 NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
```

The header names exactly one project, matching the requested project count.

`npx nx run-many -t test -p @ptah-extension/agent-sdk`

```text
 NX   Running target test for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk



> nx run @ptah-extension/agent-sdk:test

(node:28564) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28564) Warning: Failed to load the ES module: D:\projects\ptah-extension\libs\backend\agent-sdk\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(node:26584) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32416) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:25456) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36736) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:15648) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:2356) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37860) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:38036) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31832) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9352) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22652) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:21964) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:17908) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39592) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34940) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 2 skipped, 111 passed, 111 of 113 total
Tests:       3 skipped, 1984 passed, 1987 total
Snapshots:   0 total
Time:        69.925 s
Ran all test suites.




 NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

The header names exactly one project, matching the requested project count. The warnings did not fail the target; Jest ran 113 suites, with 111 passing and 2 skipped.

## What I could not verify

- I could not verify the requested fixed behavior in a live slash-command session because no supported implementation can preserve both raw slash parsing and an open post-result input with SDK 0.3.150.
- I could not add a meaningful regression spec without either asserting the known-broken iterable substitution or reaching into an unsupported SDK runtime method.
- I did not reproduce Claude Code's background checkpoint in this pass; the prior diagnosis contains that external-runtime evidence.
- I did not verify whether a later unreleased or future SDK version adds an explicit raw-prompt multi-turn option.
