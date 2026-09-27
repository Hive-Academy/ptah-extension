# Batch 37b3 executor report: `ptah config go-vet` (Lane K)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`, base d61fc1d2b
(37a..37b2). No git command changed state. The working tree is left dirty.

## Status

- **Task 37b3.1 (CLI): done.**
- **Task 37b3.2 (matrix fragment `b37b.ts`): deferred per batches.md.** Lane K does not contain the Batch 27 harness
  (`WI/testing/mcp-contract/` exists only on `fix/task-559-mcp-tool-contract`, which is not an ancestor of HEAD).
  team-leader-37b decided that 37b3.2 runs on the integration branch after Lane K is merged. It also added
  `language-honesty.contract.spec.ts` (the `HONESTY_CHECKS['typeCheck:go']` entry) to the 37b3.2 file list. No
  `b37b.ts` was written in Lane K.

## Files

| Status   | File                                          | Change |
| -------- | --------------------------------------------- | ------ |
| MODIFIED | `apps/ptah-cli/src/cli/commands/config.ts`    | `go-vet-status` / `go-vet-on` / `go-vet-off` added to `ConfigSubcommand`, the dispatch switch and the header. New exported `executeGoVet(action, globals, hooks)`. New `runGoVetStatus`, `runGoVetChange`, result guards, and the fixed failure line. The outer catch is now `catch (error: unknown)` |
| MODIFIED | `apps/ptah-cli/src/cli/router.ts`             | `config go-vet <action>` calls `configCmd.executeGoVet` |
| MODIFIED | `apps/ptah-cli/src/cli/commands/config.spec.ts` | 15 new go-vet cases |
| —        | `apps/ptah-cli/src/test-utils/manifest-parity.spec.ts` | Not touched. It checks package.json versions and does not list RPC methods |

## Behaviour (O2 §5.2)

- **`status`** calls `diagnostics:go-vet-consent-get` with `{}`. It sends the `config.goVet` notification with
  `{ supported, workspaceRoot, state, staleReason? (only when stale), goBinary? }`. A stale consent is shown as
  `stale` with its reason and never as `on`. Exit code is `0`, or `1` when `supported:false` (stderr line
  `ptah config go-vet: unsupported`).
- **`on` / `off`** first call GET. They stop with exit `1` and never send SET when:
  - `supported:false` → `unsupported`;
  - `workspace:null` → `no-workspace`.

  Otherwise they call SET with `{ enabled, workspaceRoot: <GET's root>, source: 'cli' }`. On success the
  notification is `config.goVet` with `{ supported:true, workspaceRoot, state: <SET read-back state>, goBinary? (on only) }`.
  The root the CLI operates on is always shown.
- **Failed change → exit `1`**, one stderr line `ptah config go-vet: <error>`, and no `config.goVet` notification.
  This covers:
  - SET `success:false`, where `<error>` is the RPC error union value;
  - a SET that reports success but reads back the wrong state (reported as `persist-failed`).

  It never exits `0`, unlike `autopilot set`.
- **Unknown action → exit `2`.** The action is validated in `executeGoVet` and not by commander, because commander's
  unknown-subcommand exit code is not 2. Only the action's own keys count (`hasOwnProperty`), so `toString` is rejected.
- **Transport failure → exit `5`** through the existing catch, which sends a `task.error` notification with
  `internal_failure`. A GET or SET result of the wrong shape is thrown into the same path, so it is never shown as a status.
- **JSON mode.** The formatter is the same one as for every other `config` sub-command, so JSON output carries the
  same `config.goVet` fields.
- No `as any` and no `@ts-ignore`. Types come from `@ptah-extension/shared` (`DiagnosticsGoVetConsent*`).

## FB evidence

- **Base (d61fc1d2b):** `executeGoVet` and the `go-vet-*` sub-commands do not exist, so the new spec cannot compile.
- **Mutation:** `goVetFailure` was changed to return `ExitCode.Success` (the `autopilot set` behaviour the task
  forbids). `jest -c apps/ptah-cli/jest.config.cjs …/config.spec.ts` gave **7 failed, 29 passed**. The file was
  restored, and its hash was confirmed identical afterwards.
- **After the change:** `nx test ptah-cli --testFile=src/cli/commands/config.spec.ts` → **36 passed**.

## Verification (tail only)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p ptah-cli --skip-nx-cache --parallel=2`: "Successfully ran
  targets test, lint, typecheck for project ptah-cli and 33 tasks it depends on". The scope is `-p ptah-cli` only, per
  team-leader-37b; workspace-intelligence is not touched in Lane K.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: every per-directory total is ok (`apps/ptah-cli: 29 ok (baseline 29)`).
  **The printed TOTAL is 301, not 300.** The extra site is
  `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:337 [catch-return-sentinel]`,
  committed in 37b2 (d61fc1d2b). No file from this batch adds a site; `libs/frontend/chat` stays within its baseline
  (10 of 11).
- Prettier: clean on the three edited files.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron`: only ptah-cli was run (green above). No ptah-electron file or
  dependency was changed in this batch.
- `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY`: not touched.

## Out-of-scope observations

- The degradation-audit TOTAL of 301 comes from 37b2's card (`go-vet-consent-config.component.ts:337`); see above.
  Either the 37b2 catch needs a logged/rethrown path, or the TOTAL-300 rule needs a recorded exception.
- The real-Go hostile spec is still pending a CI or user run.
