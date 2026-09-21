# Lane: Jest config dedup — `libs/api/*` duplication on new code

Branch: `chore/task-499-esm-nestjs12` (PR 548, SonarCloud 4.1% duplication on new code, required <= 3%).

## What moved

| Setting                                                                       | Where it lived           | Where it lives now                                                     |
| ----------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `testEnvironment: 'node'`                                                     | All 15 `jest.config.cts` | `libs/api/jest.api-preset.cjs`                                         |
| `transform` (`'^.+\\.[tj]s$'` -> ts-jest with `<rootDir>/tsconfig.spec.json`) | All 15 `jest.config.cts` | `libs/api/jest.api-preset.cjs`                                         |
| `moduleFileExtensions: ['ts', 'js', 'html']`                                  | All 15 `jest.config.cts` | `libs/api/jest.api-preset.cjs`                                         |
| `preset: '../jest.api-preset.cjs'`                                            | All 15 `jest.config.cts` | Unchanged (stays per file — it is the link to the preset)              |
| `displayName: 'api-<name>'`                                                   | All 15 `jest.config.cts` | Unchanged (genuinely per project)                                      |
| `coverageDirectory: '../../../coverage/libs/api/<name>'`                      | All 15 `jest.config.cts` | Unchanged — see the `coverageDirectory` section for why it cannot move |

The preset now spreads `require('../../jest.preset.js')` (the root Nx preset, which keeps `maxWorkers: '50%'` and its RSS comment) and adds the three shared settings on top. The long `--experimental-vm-modules` comment and the `vm.SourceTextModule` capability guard in `jest.api-preset.cjs` are byte-for-byte unchanged — verified by `git diff libs/api/jest.api-preset.cjs`, whose only hunks are the new block after line 50.

## Differences found

I read all 15 files (`admin`, `audit`, `billing`, `community`, `core`, `email`, `forum`, `identity`, `learning`, `licensing`, `marketing`, `member-hub`, `membership`, `notifications`, `youtube`). **All 15 are identical apart from the two values `displayName` and `coverageDirectory`.** No file carried any other difference, so nothing had to be kept back.

I also grepped the whole workspace for `jest.api-preset`: the preset's only consumers are these 15 configs, so widening it cannot change any other project's Jest config.

## rootDir

Claim: `<rootDir>` inside a preset resolves per consuming project, not to the preset's own directory. Confirmed by three observations:

1. **Baseline.** Before the change, with the transform in the project config, `NODE_OPTIONS=--experimental-vm-modules npx jest --showConfig -c libs/api/core/jest.config.cts` reported `"rootDir": "D:\\projects\\ptah-extension\\libs\\api\\core"`.
2. **After the move.** The same `--showConfig` now run for `api-core` reports `"rootDir": "...\\libs\\api\\core"` and for `api-marketing` reports `"rootDir": "...\\libs\\api\\marketing"`, while both carry the transform (now defined only in the preset) with its `tsconfig: "<rootDir>/tsconfig.spec.json"` option intact. The preset did not pin the merged config to `libs/api`.
3. **Negative control.** `libs/api/tsconfig.spec.json` does **not** exist (only `libs/api/<name>/tsconfig.spec.json` files do). If `<rootDir>` resolved to the preset's own directory, ts-jest would fail to find any tsconfig and every suite would fail. The real suites pass (see Verification), so ts-jest substituted the consuming project's rootDir.

One subtlety observed on the way: Jest merges a preset's `transform` map with the project's (the `--showConfig` output shows both the preset's `^.+\.[tj]s$` entry and the Nx root preset's `^.+\.(ts|js|mts|mjs|cts|cjs|html)$` entry), so the override semantics are identical to before the move.

## coverageDirectory

Decision: it stays in each `jest.config.cts`. It cannot be derived in the preset.

Reason (precise): `coverageDirectory` resolves relative to the consuming project's `rootDir`, so a preset could write `'<rootDir>/../../../coverage'` and land on the right repository root. But the required target is `<root>/coverage/libs/api/<name>`, and the preset has no way to know `<name>`: Jest provides no config token for the project name or folder, the preset exports one static object shared by all 15 projects (it is not a function and receives no per-consumer identity), and `displayName` is not usable as a token either. Deriving it would require a per-project path, which is exactly the thing the preset cannot see. Guessing a shared directory (e.g. `coverage/libs/api`) would merge 15 projects' coverage reports into one — a behavior change, not a dedup.

Each file therefore keeps `coverageDirectory: '../../../coverage/libs/api/<name>'` as one of its two per-project lines. `jest --showConfig` confirms it still resolves to `D:\projects\ptah-extension\coverage\libs\api\core` for `api-core`.

## Verification

The acceptance command, run from the repository root (first run; Nx hid the Jest output, so the same command was re-run with `--skip-nx-cache --output-style=static` to make it visible):

```
npx nx run-many -t test -p api-core api-marketing api-email --skip-nx-cache --output-style=static

NX   Running target test for 3 projects:

- api-core
- api-marketing
- api-email

> nx run api-email:test

> cross-env NODE_OPTIONS=--experimental-vm-modules jest --config libs/api/email/jest.config.cts

[... EmailService Nest logs ...]

Test Suites: 2 passed, 2 total
Tests:       23 passed, 23 total
Snapshots:   0 total
Time:        3.796 s, estimated 6 s
Ran all test suites.

> nx run api-core:test

> cross-env NODE_OPTIONS=--experimental-vm-modules jest --config libs/api/core/jest.config.cts --//="NestJS 12 is ESM-only while these specs compile to CommonJS. Jest needs vm.SourceTextModule to require() an ESM package, and that only exists under --experimental-vm-modules. Scoped per project, NOT workspace-wide: the same flag makes Jest load @angular/core as a real ES module where `module` is undefined, breaking every jest-preset-angular suite."

[... sentry.module.spec.ts "override-canary" expected-error logs ...]

Test Suites: 4 passed, 4 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        4.731 s, estimated 8 s
Ran all test suites.

> nx run api-marketing:test

> cross-env NODE_OPTIONS=--experimental-vm-modules jest --config libs/api/marketing/jest.config.cts

[... UnsubscribeTokenService / WaitlistService / MarketingService Nest logs ...]

Test Suites: 5 passed, 5 total
Tests:       48 passed, 48 total
Snapshots:   0 total
Time:        4.926 s, estimated 9 s
Ran all test suites.

NX   Successfully ran target test for 3 projects

  Run duration:      9.9s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     5.5s (1 task)
```

(The earlier bare run of `npx nx run-many -t test -p api-core api-marketing api-email` also printed `Successfully ran target test for 3 projects` with `Cache: 0/3 hit` — a real run, not a replay.)

Counts: **11 test suites, 100 tests, all passed** — `api-email` 2 suites / 23 tests, `api-core` 4 suites / 29 tests, `api-marketing` 5 suites / 48 tests. Sum of per-project runs matches the multi-project run below (11 / 100).

Trap checks:

1. **Not zero / no silent failure.** No project printed `No tests found`. Every project reported non-zero suites and tests, and each summary line reads `passed, N total`. The `override-canary` ERROR line in `api-core` output is an expected error thrown by `sentry.module.spec.ts` to prove the Sentry override; the suite still passed.
2. **Distinct `displayName` per project.** Each Nx task runs one Jest project, so the summary lines alone do not carry the display name. Direct evidence comes from a multi-project Jest run over the same three configs (`npx jest --projects libs/api/core libs/api/marketing libs/api/email --colors=false`), which prints one header per suite:

```
PASS api-marketing libs/api/marketing/src/lib/marketing/services/unsubscribe-token.service.spec.ts
PASS api-email libs/api/email/src/lib/services/email.service.spec.ts
PASS api-email libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts
PASS api-marketing libs/api/marketing/src/lib/marketing/services/template-render.service.spec.ts
PASS api-core libs/api/core/src/testing/mock-prisma.factory.spec.ts
PASS api-core libs/api/core/src/lib/sentry/sentry.module.spec.ts
PASS api-core libs/api/core/src/testing/nest-module-builder.spec.ts
PASS api-core libs/api/core/src/lib/common/nullable-dto.spec.ts
PASS api-marketing libs/api/marketing/src/lib/marketing/services/segment-resolver.service.spec.ts
PASS api-marketing libs/api/marketing/src/lib/marketing/services/marketing.service.spec.ts
PASS api-marketing libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts
Test Suites: 11 passed, 11 total
Tests:       100 passed, 100 total
```

All three display names appear, each with its own suites. One caveat worth recording: the first PASS-line attempts printed nothing. Jest 30.5.2 checks `AGENT_ENV_VARS` (which include `CLAUDECODE`) in `@jest/core/build/index.js` and switches to an `AgentReporter` that suppresses headers for passing files. Running the same command with those variables unset restored the normal output. The missing lines were an agent-environment artifact, not a config regression.

## Lines removed

`git diff --stat libs/api/`: **16 files changed, 31 insertions(+), 91 deletions(-)** — net −60 lines.

- Each `jest.config.cts` went from 10 lines to 5.
- The 5 genuinely duplicated setting lines (`testEnvironment` 1, `transform` 3, `moduleFileExtensions` 1) existed in 15 copies; they now exist once in the preset. That deletes 70 duplicated setting lines (14 redundant copies × 5 lines).
- Lines identical across the 15 files drop from 8 per file (only `displayName` and `coverageDirectory` differed) to 3 per file — and those 3 are non-consecutive (`module.exports = {`, the `preset:` link, `};`), so the longest duplicated block in any file falls from 6 consecutive lines to 1, below Sonar's duplicated-block threshold.
- The preset grew by 16 lines (the shared settings plus a comment recording the `<rootDir>` resolution), counted in the 31 insertions above.
