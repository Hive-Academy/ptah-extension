# Batch 9 report: R outcome-report tool accepts absolute in-workspace paths (TASK_2026_879_9809)

Executor: backend-developer subagent. I ran no git commands, did not edit `batches.md`, and did not touch `scripts/dev/*`.

## Tasks

### 9.1 The tool uses the shared helper (done)

**`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts`**

Removed:
- the inline `isAbsolute` / `win32.isAbsolute` / drive-letter / `relative` rule;
- the local `NOT_FOUND_CODES` and `isNotFound`;
- the `node:path` import.

New deliverables branch:
1. Runs `containedDeliverablePath(root, entry)` on every entry first. The first escaping entry returns `{recorded:false, reason:'deliverable path escapes workspace: <entry>'}`, with no filesystem call for any entry.
2. Then runs `checkDeliverable(fileSystem, root, entry)` for each entry (`Promise.all`), which realpaths the root and the entry and then stats the real path.
   - `{check}` is used as before. Not-found codes (ENOENT, ENOTDIR, FileNotFound, FileNotADirectory, including a dangling link) still map to `exists:false` inside the helper.
   - `errorCode === 'outside-root'`, meaning a symlink escape after realpath, returns the same escape reason. The symlink is never stat'ed (R2).
   - Any other code calls `logger.warn('Deliverable stat failed', {code})`, which logs the code only, and returns the unchanged `deliverable stat failed for <entry>`.

Unchanged:
- The reason strings.
- The tool description (`buildOutcomeReportTool`).
- Validation (`OutcomeReportArgsSchema.parse`).
- The payload, still built field by field as `{checks, taskKind, taskId, routingSource}`. There is no `origin`, so R3 holds.

Behaviour changes:
- Absolute paths inside the root are now accepted. This includes `<root>/.claude-worktrees/x/a.md`, the live failure from decision row 6.
- A report with any escaping entry now makes zero stats (before, the other entries were still stat'ed).

**`libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts`**
- `paths` gains the plan's verbatim `.describe('Deliverable files: absolute paths inside the workspace, or workspace-relative paths. At most 20.')`.
- Validation (`min(1).max(1024)`, `max(20)`) is unchanged.

### 9.2 Tool spec (done)

File: `outcome-report.tool.spec.ts`

**Fixture**
- The fake filesystem gains `realpath: async (path) => path`. The fixture has no symlinks.
- Every existing test keeps its assertions: EACCES, VS Code codes, ENOENT, the `../outside` / `E:foo` / UNC escape test, and the no-persisted-paths test.

**Schema assertion**
- The closed-object schema test now expects `paths.description` to equal the new text followed by ` Required for kind deliverables; not allowed for any other kind.`
- This confirms that `flattenOperationUnion` (`surface-tools.ts:105-128`) keeps the zod description and appends its note.

**New block `describe('ptah_outcome_report deliverable paths')`**
- An absolute path inside the root gives `applied`, `delivered`.
- An absolute worktree path `<root>/.claude-worktrees/x/a.md` gives `applied`, `delivered`.
- A workspace-relative path still gives `applied`.
- These are refused with the exact `deliverable path escapes workspace: <path>`, and no stat and no submit:
  - an absolute path outside the root;
  - `../a.md`;
  - `docs/../../a.md`;
  - the Windows drive path `C:/work/a.md` on POSIX.
- A symlink case: realpath maps `docs/link.md` outside the root. It is refused with the escape reason, realpath is called with the link, and stat and submit are not called.
- With one valid path and one escaping path, the whole report is refused and stat is never called.

**Other copies:** `mcp-contract.sweep.spec.ts` stayed green in the same project run. Grep found no other copy of the "Required for kind deliverables" text in `apps/` or `libs/`.

## Changed files

- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts
- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts

All three were prettier-clean at HEAD and are prettier-clean now.

## Risks

- **R2, symlink escape:** now enforced in the tool through `checkDeliverable`. A spec test covers it.
- **R3, no host-origin claim:** the payload construction is unchanged and the args schema is strict.
- **Reason strings:** both strings are unchanged, and spec tests assert them exactly.
- **No new filesystem access** beyond `realpath`. `IFileSystemProvider` already has it, and both hosts implement it.

## Verification

1. `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/lane-outcomes`
   - First attempt: stopped by my own 10-minute background timeout (exit 130, `3 succeeded, 1 stopped, 2 skipped`). It was not a failure.
   - Re-run: `NX 6 tasks: 6 succeeded, 3 cached`.
   - vscode-lm-tools tests: `Test Suites: 100 passed, 100 total`, `Tests: 6 skipped, 3332 passed, 3338 total`.
   - lane-outcomes tests: 20 suites, 333 passed.
2. `npm run verify -- -t typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/gateway-chat-bridge,ptah-electron`: `NX 3 tasks: 3 succeeded`.
3. `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`, which is on Batch 9's own list: `NX 10 tasks: 10 succeeded, 1 cached`, including dependency tasks.

None of the runs printed a "Running target ... for N projects" header. Each lock line names exactly the requested projects.

## Decisions

- **Lexical pre-check over all entries before any stat.**
  - Options: (a) per-entry checks inside `Promise.all`, as before; (b) refuse the whole report on the first lexical escape, as the recorder producer does.
  - Choice: (b). It keeps the exact reason string and the "no stat on escape" assertion, it is consistent with Batch 7, and it adds no filesystem access.
  - Reversible.
- **Matching `'outside-root'` as a local constant.** The helper's code literal is not exported from `@ptah-extension/lane-outcomes`, and the Batch 2 files (`deliverable-check.ts`, `src/index.ts`) are outside Batch 9's file list. The tool therefore keeps a documented local constant `OUTSIDE_ROOT = 'outside-root'`, and the symlink spec pins the behaviour.
  - Follow-up for the reviewer: export the constant from `deliverable-check.ts` and the barrel, then import it here and in the recorder.
  - Reversible.
- **No `path.resolve` on the workspace root in the tool.** The helper already resolves the root, and a blank root is still rejected before this point (`session workspace root unavailable`).
