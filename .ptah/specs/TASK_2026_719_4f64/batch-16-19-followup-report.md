## Backend implementation — `TASK_2026_719_4f64`, Batch 16/19 follow-ups

**Tasks completed**: all three (the resume spec mock, the `agent:resumeCliSession` `code`, and the CLI `--account` help text).

**Files** (all under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/`). I kept the uncommitted Batch 16 and 19 edits.

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts:37-42`
  - Added a `LaneAccountResumeError` class to the `@ptah-extension/cli-agent-runtime` barrel mock. It has the shape that batch-16-report.md gives: `readonly code`, `super(code)`, and `name = 'LaneAccountResumeError'`.
  - The handler's `instanceof` check no longer throws a TypeError, so the 12 tests that were failing now pass.
- MODIFIED `libs/shared/src/lib/types/rpc.types.ts:1411-1412`
  - Added an optional, additive `code?: 'account_refused'` to the `agent:resumeCliSession` result.
  - This matches the `'account_refused'` member that `agent:continue` already returns through `AgentContinueErrorCode`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - `:1370`: the `registerMethod` result type now includes `code?: 'account_refused'`.
  - `:1471-1475`: on a `LaneAccountResumeError`, the `agent:resumeCliSession` catch now returns `{ success:false, code:'account_refused', error: LANE_ACCOUNT_REFUSED_ERROR }`.
  - The refusals that `resumeAccountRefusal` raises before spawn are unchanged, because they are not `LaneAccountResumeError`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts:793-797`
  - In the existing test "maps a runtime LaneAccountResumeError to the fixed refusal text", the `toEqual` now also asserts `code: 'account_refused'`. `expectNoLeak` and the log assertions are unchanged.
- MODIFIED `apps/ptah-cli/src/cli/router.ts:793`
  - The `--account` help text now reads "claude only: restate the default sign-in route (named accounts are not available in the CLI host)".
  - No spec pins this text (a grep for "restate the default sign-in route" under `apps/` finds only `router.ts`).

I changed 5 files, under the cap of 6. The frontend is unchanged.

**Specs that mock or pin the changed members (rule 5)**

- `agent-rpc.handlers.spec.ts` mocks `LaneAccountResumeError` and pins the resume refusal result. I updated it.
- `agent-rpc.handlers.resume-parent-session.spec.ts` mocks the barrel. I fixed it.
- No ambient-path pins changed.

**Stack observed**

- The handler uses tsyringe and `rpcHandler.registerMethod`, with a zod boundary (`AgentResumeCliSessionParamsSchema`) in `agent-rpc.handlers.ts`.
- The RPC contract types live in `libs/shared/src/lib/types/rpc.types.ts`.

**Verification**

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.lib.json` | exit 0 |
| `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.spec.json` | exit 0 |
| `npx tsc --noEmit -p libs/shared/tsconfig.lib.json` | exit 0 |
| `npx tsc --noEmit -p apps/ptah-cli/tsconfig.app.json` | exit 0 |
| `npx tsc --noEmit -p apps/ptah-cli/tsconfig.spec.json` | exit 2. The only error is the existing `router.ts(127,26) TS1343` (`import.meta`). It was there before my change and is unchanged; nothing new. |
| `npx eslint` on the 5 files | 0 errors, 5 warnings, all existing (`max-lines`, and 2 unused imports in `rpc.types.ts`) |
| `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers --maxWorkers=2` | 110/110 suites passed; 3775 tests passed, 7 skipped |

- **Prettier.** `prettier --check` flags 4 of the files. The same files already fail at `HEAD`. The lines it would change are not mine (for example `agent-rpc.handlers.ts:1408`, spec `:407`, `rpc.types.ts:15`, `router.ts:798`). I did not reformat them, so as not to touch other developers' lines.
- **ptah-cli jest.** I did not run it, because I did not touch a ptah-cli spec.
- **`ptah_get_diagnostics`.** I did not run it. The scoped `tsc` runs above cover the same projects.

**Plan deviations**: none.

**Out-of-scope observations**

- Existing Prettier drift in `agent-rpc.handlers.ts:1408` (a Batch 16 line) and in the other three files.
- The `ResumeResult` test type in `agent-rpc.handlers.resume-parent-session.spec.ts:223` (and in `agent-rpc.handlers.spec.ts:236`) does not list `code`. That is harmless for `toEqual`.

## Decisions

- **Typing of the new `code` field.** I used the literal `'account_refused'` rather than `AgentContinueErrorCode`.
  - Options: the literal, or the full `AgentContinueErrorCode` union.
  - Evidence: the brief asked for the literal, and resume only ever returns this one code.
  - Reversible: yes.
