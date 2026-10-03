# TASK_2026_600 — exit non-zero when `ptah auth test` fails

## Why

`apps/ptah-cli/src/cli/commands/auth.ts` (the `auth test` command, around line 681) calls `auth:testConnection`,
writes the result as the `auth.test.result` notification and always returns `ExitCode.Success`.

- Before TASK_2026_555, a thrown failure aborted `callRpc`, so the command exited non-zero; a `success: false` result
  (for example a timeout) already exited 0.
- TASK_2026_555 Batch 56 made `auth:testConnection` return `{ success: false, health: null, errorMessage }` with fixed
  text instead of rethrowing. So now **every** failed test exits 0. Recorded as finding 2 in
  `TASK_2026_555/batch-56-code-logic-review.md`.

A script or CI step that gates on `ptah auth test` cannot detect a failed connection.

## Scope

- Return a non-success exit code (reuse an existing `ExitCode` member; add one only if none fits) when
  `result.success !== true`. Keep the notification payload unchanged.
- Check `init.ts` (around line 495), which reads the same RPC, keeps its current flow.
- Document the exit code in the CLI help / docs page for `ptah auth test` if it lists exit codes.

## Acceptance criteria

1. `ptah auth test` exits 0 on success and non-zero on `success: false` (both the thrown and the timeout case).
2. Specs in `apps/ptah-cli/src/cli/commands/auth.spec.ts`.
3. Typecheck, lint, tests for `ptah-cli`; CLI E2E green.

## Out of scope

Other CLI commands' exit codes.
