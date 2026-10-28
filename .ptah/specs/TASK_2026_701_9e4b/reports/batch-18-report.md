# Backend implementation: `TASK_2026_701_9e4b`, batch 18

**Tasks completed**: Task 18.1, "Print kept files in `ptah agent`/`ptah wizard` (A20)".

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-cli\src\cli\commands\wizard.ts`
  - `submit-selection` now emits one `wizard.files.kept` notification when the completion payload has `kept` or `changed-since-preview` agents. The notification carries `{ outputDirectory, keptCount, changedSincePreviewCount, files: [{ agentId, path, status, reason }] }`.
  - Two exported functions were added: `collectKeptFiles(payload)` and `WizardKeptFile`.
  - The header doc was updated.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-cli\src\cli\commands\wizard.spec.ts`
  - 3 new cases: kept files listed on a successful run; listed before `task.error` on a failed run; none for a payload from an older host that has no `agents`.
  - The coverage header was updated.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-cli\src\cli\commands\agent.ts`
  - `packs install` now emits one `agent.pack.install.kept` notification before `agent.pack.install.complete` when `WizardInstallPackAgentsResult.files` contains `kept` or `changed-since-preview` rows. The notification carries `{ packId, source, keptCount, changedSincePreviewCount, files: [{ file, status, reason }] }`.
  - Two exported functions were added: `collectKeptPackFiles(files)` and `AgentPackKeptFile`.
  - The header doc was updated.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-cli\src\cli\commands\agent.spec.ts`
  - 2 new cases: kept and changed-since-preview rows are listed in order, and the RPC params show no plan token; no notification when every file was written or unchanged.

No other file was touched.

## Stack observed

- CLI output goes through the injected `Formatter.writeNotification`. In `--json` mode it writes NDJSON JSON-RPC notifications. In `--human` mode, `HumanFormatter` falls back to `<prefix> <method> <json>` for methods it does not render specially (`apps/ptah-cli/src/cli/output/formatter.ts:204-212`, `:289-331`).
- No `console.*` is used, and `stderr` is only used for usage errors, as in the existing commands.
- The DTOs come from `@ptah-extension/shared`:
  - `GenerationCompletePayload` and `GenerationAgentOutcome` with `status: FileOutcome` are in `libs/shared/src/lib/types/wizard/phase.ts:203-254`. `keptCount` and `changedSincePreviewCount` are optional on the wire; the Batch 12 report (:14) says older hosts do not send them.
  - `PackFileOutcome` and `FileOutcome` are in `libs/shared/src/lib/types/rpc/rpc-setup-decisions.types.ts:89-94,151-154`.
  - `WizardInstallPackAgentsResult.files?` is in `rpc-setup.types.ts:709-718`.
- Tests use the spec files' existing `makeFormatter` / `makeEngine` / `pushAdapter` mock pattern.

## Verification

- Command: `npm run verify -- -p ptah-cli,ptah-tui 2>&1 | sed ... | grep -E "Running target|tasks:|✖|full log"`
- Result: `NX   45 tasks: 45 succeeded, 2 cached`, exit code 0.
- The run waited in the verify lock queue and was moved to the background after 600 s. It then ran to completion under the lock as the same single run; it was not re-run.
- The "Running target ... for N projects" header line did not appear in the filtered output. Because of that, the project count could not be confirmed from the header. 45 tasks for 2 projects includes their dependency tasks.
- `ptah_get_diagnostics` was unavailable: the TypeScript check timed out after 45 s. The verify typecheck target covers this.
- The phase-end keep-alive (`-t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`) was not run. It is in the batch block, but the executor prompt limits me to the first command. It is the team-leader's phase-end step.

## How each listed edge case and risk was handled

- **JSON output mode.** Kept files are emitted as a normal JSON-RPC notification, so they reach `--json`/NDJSON consumers as a stable machine contract:
  - `wizard.files.kept` for wizard runs.
  - `agent.pack.install.kept` for pack installs.
- **Human mode.** The formatter fallback prints the method and the JSON body, which contains the paths and reasons. The formatter was not changed (the batch rule says no D11 formatter changes here).
- **Counts equal rows.** Counts are derived from the listed rows, not copied from `payload.keptCount`. They therefore always match the rows, even with an older host that omits the counts.
- **Older hosts.** A missing `agents` array or missing `files` yields no rows and no notification. Each has a test.
- **Failed run.** Kept files are emitted before `task.error`, so a partly failed run still reports which existing files were left alone. Tested.
- **Unreadable kept file.** For `kept` with `GenerationAgentOutcome.error` set, the error is appended to the reason. The `FileOutcome` doc says `kept` also covers a file kept because it was unreadable.
- **Create-only (A20).** No new flag was added, and no `previewToken`, `fileDecisions`, `planToken` or `decisions` are sent. Specs assert the exact RPC params.
- **No-op runs.** If nothing was kept, no notification is emitted, so existing consumers see unchanged output. The existing happy-path specs still pass.
- **Exit codes** are unchanged: kept files are not an error.
- **TUI.** Not touched; typecheck and test only.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use a dedicated notification per command (`wizard.files.kept`, `agent.pack.install.kept`), emitted only when the list is non-empty | add fields to `agent.pack.install.complete`; always emit (possibly empty) | Batch rule says no formatter changes. The existing event-pipe already forwards the full `wizard.generation.complete` payload. A separate method keeps existing notification shapes unchanged for current consumers | yes |
| Counts are computed from the rows | trust `payload.keptCount` | Review F8 / Task 17.1 "counts equal per-file rows"; the wire counts are optional | yes |
| `wizard retry-item` is left unchanged | add kept output | `WizardRetryItemResponse` has no per-file data. Batch 12 decision 3 already maps `changed-since-preview` to `success:false` with a message, which the command prints as `task.error`, and a `kept` retry counts as success | yes |

## Plan deviations

None.

## Out-of-scope observations

- `ptah agent apply <name>` (`agent.ts` `runApply`) still overwrites `.ptah/agents/<name>.md` whenever the content differs. It is an explicit single-template apply, not a wizard run or pack install, so A20 does not clearly cover it. It was not changed; flagged for the P2 logic review.
- `agent.pack.install.complete.changed` is still `!fromCache`. When every file was kept, it can report `changed: true` although nothing was written. It was not changed, to keep the existing contract.
