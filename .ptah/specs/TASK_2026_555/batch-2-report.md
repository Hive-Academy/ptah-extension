# Batch 2 report — 553 startup survives a rejecting write (S1a)

Executor: backend-developer (subagent), with one read-only Explore subagent for the startup-write survey.
Depends on Batch 1 (d1b1469a3). Full evidence: `.ptah/specs/TASK_2026_553/fix-report.md`, section "Startup survives a
rejecting write".

## Files (all spec or report; no production code changed)

| Path (under ROOT) | Change |
| --- | --- |
| `apps/ptah-extension-vscode/src/activation/bootstrap.cursor-key.spec.ts` | +2 cases (describe "startup survives a rejecting settings write (TASK_2026_553)") |
| `apps/ptah-electron/src/activation/bootstrap.cursor-key.spec.ts` | +2 cases (same describe) |
| `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts` | +1 case: `withEngine` with all three startup writers rejecting |
| `.ptah/specs/TASK_2026_553/fix-report.md` | Startup section appended |
| `.ptah/specs/TASK_2026_555/batch-2-report.md` | This file |

## Survey result

Six settings writes run by themselves at startup:

1. The Cursor key migration
2. The agent-orchestration migration
3. The SDK adapter's `model.selected` first-run default
4. The SDK adapter's legacy model-name migration
5. The CLI `authMethod` migration
6. The settings-core `MigrationRunner`

Every one is contained by a try/catch or `.catch` (file:line in the fix report), so none can abort
`bootstrapVscode`, `bootstrapElectron` or `withEngine`. There are no unhandled fire-and-forget writes.

**No production fix was needed**, so the batch's "stop and report" rule did not trigger.

## Why the VS Code and Electron specs are split

Running `bootstrapVscode` or `bootstrapElectron` needs a real host, which is why the existing specs in those files
read the source. Each file therefore proves survival in two halves:

- **Structural.** `runMigrations()` is inside the `try` whose `catch (settingsError)` warns and never rethrows.
  This builds on the existing cases, which pin that the Cursor step runs after that catch.
- **Behavioural.** The real `runCursorApiKeyMigration`, given the container shape the host passes and a provider that
  rejects with `SettingsPersistError('EACCES')`, resolves. It warns with `errorType` only and never logs the key.

The CLI spec is fully behavioural and runs through `withEngine` itself.

## Verification

- Scoped runs:
  - `npx jest -c libs/backend/cli-engine/jest.config.cjs …/with-engine.spec.ts`: 45/45
  - VS Code `bootstrap.cursor-key.spec.ts`: 4/4
  - Electron `bootstrap.cursor-key.spec.ts`: 4/4
- Batch 2 verify command, run in the foreground:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli --parallel=2`
  → **EXIT=0**, "Successfully ran targets typecheck, test, lint for 4 projects and 41 tasks they depend on".
- Gate G does not apply (Batch 16 is not committed).

## Plan deviations

None. The file list is exactly the batch's four paths plus this report. A behavioural case was added next to the
structural one in each app spec, as the batch's "real rejecting fake" requirement asks.

## Out-of-scope observations (pre-existing, not changed)

- In VS Code and Electron, a failing settings migration also skips `customProviders.load()` in the same try block
  (`apps/ptah-extension-vscode/src/activation/bootstrap.ts:105-126`, `apps/ptah-electron/src/activation/bootstrap.ts:247-268`).
  Startup continues, but custom provider ids do not resolve that session. The migrations write with raw `fs`, so
  Batch 1 did not change this.
- `migrateLegacyAuthMethod` (`libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:519-537`) resolves
  `Symbol.for('WorkspaceProvider')`, which no container registers (the platform token is
  `Symbol.for('PlatformWorkspaceProvider')`). In production it returns early, so the migration never runs.
- The Batch 1 open items (M1 double-failure cache, the sweep ENOENT warning) are untouched.
