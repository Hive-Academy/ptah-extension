## Root cause (file:line)

`SessionRpcHandlers` indexed transcripts only from the requested workspace directory at `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:428`. Child SDK sessions are listed under their parent workspace but run in a worktree. Their already-persisted `workingDirectory` is set when `SdkAgentAdapter` creates metadata at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1163`, so the child JSONL was written below the escaped worktree path and never found.

## Changes (file:line list)

- Modified `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:428,452,956,1619-1642`.
  - `session:list` now groups page records by `workingDirectory` (falling back to `workspacePath`) and indexes each distinct transcript directory once.
  - A failed or unresolved directory keeps that directory's records without `hasTranscript`, preserving the prior optional-enrichment semantics.
  - `session:validate` resolves a record's JSONL from its persisted `workingDirectory` when present.
- Modified `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts:251,699-746,1658-1692`.
  - Added `workingDirectory` to the local metadata fixture and regression coverage for worktree transcript listing and validation.

## Resume path finding

`session:validate` obtains the metadata record before calling `findSessionFile`. A child uses `metadata.workingDirectory`; a normal session with no recorded cwd continues to use the request's `workspacePath`. Both paths retain the existing `resolveSessionsDir` escaping and matching behaviour.

## Tests added

- Child transcript exists only in the worktree-escaped directory: `hasTranscript: true`.
- Normal session remains `hasTranscript: false` when absent from the main workspace directory.
- Sidebar validation returns the child worktree JSONL file path.

## Verification (the tail of the nx output, project list, pass/fail)

Project list: `rpc-handlers`.

Required command: `npx nx run-many -t typecheck,test,lint -p rpc-handlers 2>&1 | Select-Object -Last 40`

Result: FAIL. Nx reported typecheck and lint as successful, but the broad test target failed: `Test Suites: 8 failed, 130 passed, 138 total`; `Tests: 1 failed, 7 skipped, 3800 passed, 3808 total`. The available tail identified a dependency-load stack through `vscode-lm-tools` / `surface-rpc.handlers` and did not include the individual assertion failure. Nx Cloud also reported its organisation as disabled (401).

Focused regression command: `npx nx test rpc-handlers --runInBand --testPathPatterns=session-rpc.handlers.spec.ts`

Result: PASS — `Test Suites: 2 passed, 2 total`; `Tests: 141 passed, 141 total`.

## Not done / risks

The required broad `rpc-handlers` test target remains failing outside this focused handler spec. No unrelated suites or dependency configuration were modified. The unchanged broad failure should be investigated separately before treating the project-wide test target as green.

## Revision 1

This revision supersedes the earlier verification status above: after the test-harness constructor update, the required project-scoped command passes all three targets.

### Shared resume-resolution rule

- Added `libs/backend/rpc-handlers/src/lib/chat/session/resume-working-directory.ts:26`. It accepts a persisted cwd only when it is an authorized, safe, existing directory; otherwise it returns the caller's workspace fallback.
- Updated `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:56,105` to use that helper for both resume-history entry points.
- Updated `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:435-440,977,1657-1712` so `session:list` and `session:validate` use the exact same resolution before locating the escaped Claude transcript directory. The list resolver batches by distinct recorded cwd and still performs one transcript index per resolved directory.
- Consequently, a deleted/unauthorized child worktree falls back to the normal workspace transcript probe. A transcript that exists only under the deleted worktree is reported `hasTranscript: false` / `exists: false`, matching the history loader. Normal sessions retain their prior workspace-only behavior.

### Validation regressions

- Strengthened `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts:1760-1808`: the child cwd is `/child-root/child`, which does not contain the main workspace basename, and `fs.access` succeeds only for the exact child projects directory and JSONL path.
- Added the deleted-worktree validation case at `session-rpc.handlers.spec.ts:1810-1831` and the matching list fallback case at `session-rpc.handlers.spec.ts:768-809`.
- Base-behavior check (reasoned without reverting): base `session:validate` passes `/fake/workspace` to `findSessionFile`; the only project directory in this strengthened fixture is `-child-root-child`, which neither matches nor contains `workspace`, and the exact access mock rejects the main-workspace JSONL. Base behavior therefore returns `{ exists: false }`, failing the strengthened expected child-file assertion.

### Child deletion

- Updated `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:708-712,828-837` so deletion passes the raw recorded `workingDirectory` into `findSessionFile`. This is intentionally not the resume-resolution rule: the escaped Claude project directory is derived from the stored path string and remains the correct deletion target after the worktree has been removed.
- Added `session-rpc.handlers.spec.ts:1592-1633`, proving a deleted worktree's child JSONL is unlinked from its recorded escaped directory.
- Adjusted the existing performance harness at `libs/backend/rpc-handlers/src/lib/handlers/session-list.perf.spec.ts:281-282` for the two new handler constructor dependencies.

### Tests and verification

Project list: `rpc-handlers`.

Required command:
`$env:NX_NO_CLOUD='true'; $env:NX_DAEMON='false'; npx nx run-many -t typecheck,test,lint -p rpc-handlers`

Result: PASS. Tail of output:

```text
√  nx run @ptah-extension/rpc-handlers:test
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run @ptah-extension/rpc-handlers:lint

NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/rpc-handlers

Run duration:      54.6s
Cache:             0/3 hit (0%)
Critical path:     46.1s (1 task)
```

No remaining revision-specific risks identified.
