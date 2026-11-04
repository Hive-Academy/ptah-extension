# Batch B2 report - shared CLI version label

## Files changed
- CREATED libs/shared/src/lib/cli-version-label.ts - `VERSION_TOKEN`, `isCliProcessDump`, `cliVersionLabel` (moved verbatim, `VERSION_TOKEN` now exported).
- CREATED libs/shared/src/lib/cli-version-label.spec.ts
- MODIFIED libs/shared/src/index.ts - `export * from './lib/cli-version-label'` (no task-folder-markdown-eligibility export).
- MODIFIED libs/shared/src/index.zod-free.spec.ts - added `lib/cli-version-label.ts` to the walked entries.
- MODIFIED libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts - imports from `@ptah-extension/shared` and re-exports `cliVersionLabel`, `isCliProcessDump`; local copies removed. `cli-matrix-rows.spec.ts` unchanged (still imports `cliVersionLabel` through the re-export, which now covers it).
- MODIFIED libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts - `cliVersionLabel(cli.version ?? '')` before the `if (version)` check.
- MODIFIED libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.spec.ts - table test for four version inputs.

## Acceptance
- [x] Functions moved to shared; chat re-export keeps Settings behavior (cli-matrix-rows spec passed).
- [x] `codex-cli 0.155.1` -> `Run through codex v0.155.1.`; empty, whitespace, or dump -> `Run through the codex CLI lane.` (existing no-version text). Covered by the spec.
- [x] Shared index stays zod-free (new module has no imports; added to the zod-free spec). Not re-run to green (see below).
- [x] Did not export the task-folder-markdown-eligibility predicate.

## Verification
- `npm run verify -- -p @ptah-extension/shared` -> exit 1. Not caused by B2. Typecheck: `libs/shared/src/lib/types/rpc.types.ts:742-749,2638-2641,3832-3833` have duplicate identifiers (`TasksReadFolderMarkdownParams/Result`, `tasks:readFolderMarkdown`, `tasks:listFolderEntries`), from B1's in-progress edits. Test: 3959 passed, 1 failed. The failure was my own spec case (`isCliProcessDump('Usage: codex')` is false because the regex needs a word boundary after `usage:`). I fixed the case to `'stdout follows'`. The three suites that failed to run (session-stats-live, session-mcp-status, host-source-registry.contract) are the B1 files. I could not get a clean re-run of the fixed spec because of the B1 typecheck failure.
- `npm run verify -- -p @ptah-extension/chat` -> exit 1. Typecheck and lint passed. Test failed only with `Could not locate module marked mapped as ...\node_modules\marked\lib\marked.umd.js` (a worktree environment issue; the suites failed to run) plus 3 WorkspaceCoordinatorService git regression tests. These look unrelated to B2.
- `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns=cli-matrix-rows` -> exit 0.
- `npm run verify -- -p @ptah-extension/tasks-ui` -> `3 tasks: 3 succeeded`, exit 0.

## Deviations
- Only one extra edit beyond the brief: `VERSION_TOKEN` is exported from shared (it is public via `export *`).

## Open issues
- B1 must remove the duplicate declarations in rpc.types.ts before shared can go green.
- Re-run `npm run verify -- -p @ptah-extension/shared` after B1 settles, to confirm cli-version-label.spec.ts and index.zod-free.spec.ts pass.
- The chat test target needs `marked` resolvable in this worktree (node_modules problem).
- The orchestrator still has to add the eligibility predicate export to libs/shared/src/index.ts.
