# Backend implementation — `TASK_2026_701_9e4b`, batch 2

**Tasks completed**: 2.1 (D11 rename `overwrittenLocalEdit` → `keptLocalEdit`), 2.2 (D16 `JSONRPC_SCHEMA_VERSION` `0.2` → `1.0` and docs)

**Verdict**: Code done. Verify shows 76 of 78 tasks passing. The two failures are not caused by this batch: `ptah-extension-webview:lint` is the known D19 issue, and `@ptah-extension/harness-sync:test` fails because of stray files on this machine (see Verification). The team-leader has to clear that machine problem before this batch can show a green verify.

## Files

All MODIFIED, paths relative to `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment`.

### Task 2.1: field rename only, no change in behaviour

These are exactly the 40 code files from the plan's list. The rename was done with a
mechanical `sed` over the files that `git grep -l overwrittenLocalEdit` returned (40 files).

- shared: `libs/shared/src/lib/types/harness-sync.types.ts` (field at `:147`, `{@link}` at `:178`), `harness-sync.types.spec.ts`, `harness-sync.blocked.spec.ts`, `capability-id-codec.spec.ts`
- harness-sync: `health/harness-health.ts`, `targets/claude-target.ts`, `targets/harness-target.port.ts`, `targets/workspace-target.ts`, `targets/mcp/mcp-facet-planner.ts`, `reconciler/harness-reconciler.service.ts`, plus the 10 listed specs (`rival-targets.agent-model`, `workspace-target.overwrite-detach`, `harness-reconciler.{cancellation,capability-policy,foreign-edits,idempotency-removal,local-edit-report,manifest-recovery,verify-agreement,write-failure}`)
- rpc-handlers: `harness/health/harness-health-rpc.service.spec.ts`
- marketplace: `data/attention.ts`, `data/attention.spec.ts`, `data/coverage.spec.ts`, `harness/harness-health.model.ts`, `harness/harness-target-row.component.ts`, `harness/harness-blocked-paths.spec.ts`, `harness/harness-health-badge.component.spec.ts`, `harness/harness-health.store.spec.ts`, `harness/harness-repair-dialog.spec.ts`, `pages/overview/overview-kpis.spec.ts`, `pages/overview/overview-page.component.spec.ts`, `pages/skills/skill-detail.component.spec.ts`
- skill-synthesis-ui: `clones/agent-sync-chips.spec.ts`, `clones/reconcile-guard.spec.ts`, `clones/skill-clones-view.component.spec.ts`
- webview-e2e-harness: `scenarios/marketplace/marketplace.fixtures.ts`
- ptah-cli:
  - `apps/ptah-cli/src/cli/output/formatter.ts`: `countField(target, 'keptLocalEdit')`; the `HARNESS_DOCTOR_COLUMNS` header changes from `'overwritten'` to `'kept'`; the doc comment at `:483` is updated.
  - `formatter.spec.ts`: fixture renamed. One new test, `counts keptLocalEdit under the kept column of harness.doctor`, checks the `kept` header, checks that no `overwritten` text is printed, and checks a count of 2 in that column. This is the verification seam the plan asks for.
  - `apps/ptah-cli/src/cli/commands/harness.spec.ts`

### Task 2.2

- `apps/ptah-cli/src/cli/jsonrpc/types.ts:32`: `JSONRPC_SCHEMA_VERSION = '1.0'`
- `apps/ptah-cli/docs/jsonrpc-schema.md`:
  - The examples at `:66` (`schema_version`), `:532` and `:544` (`schemaVersion`) now show `1.0`. These lines were at `:66`, `:527` and `:539` before the edit.
  - A new `1.0` versioning paragraph follows the `0.2` note. It covers:
    - the MAJOR bump for the `harness.*` change: `overwrittenLocalEdit` removed, `keptLocalEdit: string[]` added with the kept meaning;
    - the wire versions `"jsonrpc": "2.0"` and `protocol_version: "2.0"`, which stay the same;
    - the warning a host gets when it sets `PTAH_HOST_SCHEMA_VERSION=0.2`. It comes from `checkSchemaVersionSkew()` and does not stop the run.
  - Section 1.5 has a new `harness.doctor` row: `ptah harness doctor [--fix]`, payload `{ fixed, health: { targets: [{ target, ..., keptLocalEdit: string[] }] }, selection, summary }`. The payload is taken from `harness-doctor.ts:135-140`. A Breaking (2026-10, schema `1.0`) note follows the row.
  - Prettier realigned the section 1.5 table. Two lines in an unrelated table near `:630` were also reformatted by Prettier; I put them back so the diff stays inside the task.
- `.claude/skills/ptah-cli-usage/references/jsonrpc.md` (`:4`, `:73`, `:111`, `:141`) and `references/mcp-serve.md` (`:170`) now say `1.0`. The same edits were made to the copies under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/`. Both pairs were byte-identical (`cmp`) before the edit, and the same `sed` was applied to each.
- No other version text was changed. The CLI package versions (`0.1.5`, `0.1.0`), `"jsonrpc":"2.0"` and `protocol_version` are as before.
- No test asserts the literal `'0.2'`: `git grep "'0.2'"` over `apps/ptah-cli/src` and the lib specs returns nothing. The specs compare against the constant.

## Stack observed

- TypeScript in an Nx monorepo, verified with `npm run verify` (`CLAUDE.md`).
- The formatter reads the target record through `countField` and the `HARNESS_DOCTOR_COLUMNS` array (`formatter.ts:156-168,831`).
- The schema constant is used by `checkSchemaVersionSkew` (`apps/ptah-cli/src/main.ts:139-154`).

## Verification

- `git grep -c overwrittenLocalEdit -- . ':!.ptah'` before the edit: 40 code files. After the edit, outside `.ptah` and outside `apps/ptah-cli/docs/jsonrpc-schema.md`: 0 hits. The doc mentions the old name on purpose (see D-B2-1).
- Command, run once in full (the first attempt hit the 30-minute background limit while it was still queued for the lock and never ran):
  `npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/rpc-handlers,@ptah-extension/marketplace,@ptah-extension/skill-synthesis-ui,@ptah-extension/webview-e2e-harness,@ptah-extension/cli-engine,ptah-cli,ptah-electron,ptah-extension-vscode,ptah-extension-webview`
- Header: `lock acquired ...: verify lint,test,typecheck (` followed by all 11 projects. This script prints no "Running target ... for N" line, the same as in the Batch 1 report.
- Result: `NX 78 tasks: 76 succeeded, 69 cached, 2 failed`, exit 1. Every lint, test and typecheck target for shared, rpc-handlers, marketplace, skill-synthesis-ui, webview-e2e-harness, cli-engine, ptah-cli, ptah-electron and ptah-extension-vscode passed. This includes `ptah-cli:test` with the new formatter test, and typecheck in every project. harness-sync lint and typecheck also passed. The two failures:
  - `ptah-extension-webview:lint` fails on the circular dependency `ptah-extension-webview -> @ptah-extension/command-center -> ptah-extension-webview` (1 error). This is the D19 issue that already fails on main, and it is accepted.
  - `@ptah-extension/harness-sync:test`: 18 tests in 6 suites fail. The suites are `agent-consent`, `gitignore`, `cancellation`, `skill-consent`, `write-failure` and `capability-policy`. The failures come from the machine, not from the code:
    - **Cause**: `resolveHarnessWorkspaceRoot()` (`workspace/workspace-root.ts:66-84`) walks up from each temporary workspace (`%TEMP%/harness-*-ws-XXXX`) looking for a marker directory and stops at the home directory. `C:\Users\abdal\AppData\Local\Temp\` contains stray `.claude` and `.ptah` directories, created 2026-09-26. Every temporary spec workspace therefore resolves to `%TEMP%` itself. State, manifests and `.gitignore` land in `%TEMP%`, so each spec finds nothing in its own `ws`. That is why the errors are ENOENT on `ws/.gitignore` and `undefined` for persisted state and manifests.
    - **The suites keep this going**: during this run they wrote into `%TEMP%\.claude\commands` and `%TEMP%\.ptah\harness`, so the stray directories had fresh timestamps of 23:49 local time.
    - **Reproduced**: running only `--testPathPatterns=gitignore --skip-nx-cache` fails the same way. `harness-reconciler.gitignore.spec.ts` is a file this batch did not touch.
    - **Not caused by this batch**: the non-spec diff in harness-sync is only the identifier rename (11 lines, `git diff`), and harness-sync typecheck passes.
    - **Why main looks green**: main's cached result hides the problem because the Nx cache is shared.
  - I re-ran once only for diagnosis. I did not change anything outside the worktree.
- **Needed from the team-leader**: delete `C:\Users\abdal\AppData\Local\Temp\.claude` and `C:\Users\abdal\AppData\Local\Temp\.ptah`. Both are test pollution on this machine and outside this batch. Then run `npm run verify -- -t test -p @ptah-extension/harness-sync` again. I expect it to pass, but I have not run it after a cleanup.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-B2-1 | `jsonrpc-schema.md` keeps the old name `overwrittenLocalEdit` in the breaking-change notes. The "0 hits" check is applied to code. | (a) remove every mention; (b) name the removed field in the notes | implementation-plan.md:1122-1123 gives the note text "`overwrittenLocalEdit` was renamed to `keptLocalEdit`", and batches.md Task 2.2 says the note must state "`overwrittenLocalEdit` removed" | yes |
| D-B2-2 | The plan says "No schema version bump (A34)" next to the section 1.5 note. D16 overrides that, so the note says schema `1.0`. | follow A34; follow D16 | decisions.md D16, batches.md TL9 | yes |
| D-B2-3 | UI copy and test IDs (`harness-target-overwritten`, "local edits replaced", spec titles that say "overwrites") are left as they are. The only label renamed is the CLI column header, because the plan's B16 section names only that one. | rename all copy now; leave it for Batch 6 | batches.md Task 2.1 quality requirement; plan :1116-1118, :1125-1127 | yes |
| D-B2-4 | The `harness.doctor` payload row includes `fixed` and `selection` next to `health` and `summary`. | the plan's shorter payload; the actual payload | `apps/ptah-cli/src/cli/commands/harness-doctor.ts:135-140` | yes |

## Plan deviations

- The shared type's doc comment (`harness-sync.types.ts:146`, "local edits were overwritten (source wins)") is unchanged, because the behaviour has not changed yet. Batch 6 changes the behaviour and should update this comment too.

## Out-of-scope observations

- The stray `%TEMP%\.claude` and `%TEMP%\.ptah` directories break harness-sync reconciler specs on any machine that has them. The specs could pass `homeDir`, or use a temporary root outside `%TEMP%`'s ancestor chain, to protect against this. That is a candidate follow-up and was not changed here.
- I made no git changes. `batches.md` shows as modified in the worktree, but that change came from another agent.
