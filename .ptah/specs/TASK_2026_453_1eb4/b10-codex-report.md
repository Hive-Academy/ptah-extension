# Backend implementation — `TASK_2026_453_1eb4`, Batch 10

**Tasks completed**: 10.1, 10.2, 10.3

## Acceptance-criteria checklist

### Task 10.1 — C7 event read and anchor occurrence

- [x] `readSessionEvents` and `readSessionHistory` share `loadSessionEventData`; the events-only path reads raw JSONL and returns the replay projection (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:289`, `:303`). It does not invoke compaction tracking, pricing hydration, usage aggregation, or live-baseline seeding. Missing directory/file returns `[]`; validation still occurs first.
- [x] Existing `readSessionHistory` behavior remains covered by its unedited spec; the full agent-sdk suite passed 111 suites / 1,952 tests (2 suites and 3 tests skipped).
- [x] Valid non-negative `occurrenceFromEnd` resolves from the last matching prompt and returns `null` when out of range; legacy `occurrence` remains the fallback (`session-history-reader.service.ts:793`).
- [x] New regression coverage proves event projection parity and no resume side effects, missing sources, invalid IDs, from-end occurrences 0/1, and legacy occurrence (`session-history-reader.events-read.spec.ts:82`, `:119`, `:135`, `:143`).
- [x] No page selection was added to agent-sdk. Line count is 1,125 versus the 1,086-line baseline: **+39**, within the approximately 40-line cap.

### Task 10.2 — C8 paging service, RPC, and sanitizer

- [x] `resolveResumeWorkingDirectory` exists only in `ChatHistoryReadService` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:127`). `readForResume` wraps the full history API (`:50`); `readPage` authorizes the requested workspace, resolves persisted metadata, calls only `readSessionEvents` (`:105`), resolves the opaque cursor (`:109`), selects the default-or-requested page (`:110`), and returns resumable subagents (`:116`). Resolution and unsafe-workspace coverage is at `chat-history-read.service.spec.ts:67`, `:104`, and `:136`.
- [x] Resume retains `fullEvents` (`chat-session.service.ts:826`) for subagent registration (`:846`) and full-history stats/event accounting (`:887`). Slicing happens only at response construction (`:932`); omitted paging returns full events and no `historyPage` key (`:940`). Both response forms and full-event collaborators are covered at `chat-session-history-page.spec.ts:139` and `:158`.
- [x] The facade rule is satisfied: `chat-session.service.ts` is 1,371 lines versus the 1,419-line baseline: **-48**. The working-directory concern moved rather than being copied.
- [x] `CHAT_TOKENS.HISTORY_READ` is declared and registered (`chat/tokens.ts:14`, `chat/di.ts:70`), with DI coverage in `chat/di.spec.ts`.
- [x] All three required RPC registration sites contain `chat:history-page`: `ChatRpcHandlers.METHODS` (`chat-rpc.handlers.ts:98`), `RpcMethodRegistry` (`libs/shared/src/lib/types/rpc.types.ts:648`), and `RPC_METHOD_ENTRIES` (`rpc.types.ts:3380`). The method is wired at `chat-rpc.handlers.ts:253`. `ALLOWED_METHOD_PREFIXES` was not changed, and the page handler does not use the attachment guard (`chat-session-history-page.spec.ts:228`).
- [x] Resume paging and page RPC schemas are strict; sizes are integers 1..2000 and cursors are capped at 4,096 characters (`chat-rpc.schema.ts:28`, `:82`, `:88-95`). Tests reject 0, 2001, unknown keys, and a 4,097-character cursor (`chat-session-history-page.spec.ts:241-244`).
- [x] Cursor failures map to safe client errors: stale → `Session history changed` / `HISTORY_CURSOR_STALE`, invalid → `Invalid history cursor` / `INVALID_PARAMS` (`chat-rpc.handlers.ts:257-268`). Other `unknown` errors are rethrown through the existing RPC wrapper; raw error messages are not returned. Coverage includes raw-message non-disclosure (`chat-session-history-page.spec.ts:205-219`).
- [x] V1 anchor sanitization retains only non-negative integer `occurrenceFromEnd` (`session-rpc.handlers.ts:253-270`). Tests cover 0/1, -1, 1.5, string `"2"`, and legacy occurrence (`session-rpc.handlers.spec.ts:400-418`).
- [x] The four specified constructor-injection specs were updated; `chat-session-resume-activate.spec.ts` passes in the full rpc-handlers suite.

### Task 10.3 — CLI JSON-RPC documentation

- [x] Section 3.1 documents opt-in `chat:resume.historyPage`, default full-history behavior, `chat:history-page` parameters/result, opaque cursors, whole-turn pages, compaction-boundary stopping, stale-cursor reopen behavior, and unchanged `session.history` / `session resume` behavior (`apps/ptah-cli/docs/jsonrpc-schema.md:473-503`).
- [x] No CLI source file or CLI verb was added or changed; the only CLI-tree change is the documentation file. The packaged-files coverage passed within the 67-suite CLI run.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts` — shared event loading and V1 from-end anchor resolution.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\agent-sdk\src\lib\session-history-reader.events-read.spec.ts` — C7 regression coverage.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\session\chat-history-read.service.ts` — authorized resume/page history collaborator.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\session\chat-history-read.service.spec.ts` — resolution, event-read, and authorization tests.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\session\chat-session-history-page.spec.ts` — resume paging and handler error/schema tests.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts` — delegates history reads and slices only the response.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\session\index.ts` — exports the collaborator.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\tokens.ts` — adds `HISTORY_READ`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\di.ts` and `chat\di.spec.ts` — registers and verifies the collaborator.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\chat\session\chat-continue-slash-before-resume.spec.ts`, `chat-session-auth.spec.ts`, `chat-session-mcp-status.spec.ts`, and `chat-session-resume-activate.spec.ts` — constructor-injection updates only.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.ts` — strict paging schemas.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts` and `chat-rpc.handlers.spec.ts` — page method wiring and coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts` and `session-rpc.handlers.spec.ts` — V1 anchor sanitization and coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\types\rpc.types.ts` — registry and method-entry registration.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-cli\docs\jsonrpc-schema.md` — JSON-RPC paging documentation only.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b10-codex-report.md` — this delivery report.

## Stack observed

- Nx 22.6.5 and TypeScript 5.9.3 (`package.json:267`, `:277`).
- Product-side constructor injection uses tsyringe 4.10 (`package.json:190`); the new service is registered with the existing token/`registerSingleton` pattern (`chat/tokens.ts:14`, `chat/di.ts:70`).
- External RPC validation uses the repository-pinned Zod 4.3.6 (`package.json:195`) through strict boundary schemas (`chat-rpc.schema.ts:82`, `:95`).

## Verification

Test-runner gate immediately before the final test command:

```text
matching=0 root-runners=0
```

The harness exported contradictory color variables that caused an unrelated CLI formatter assertion on an earlier attempt. For the final run only, `NO_COLOR` was removed and `FORCE_COLOR=1` was set in the child PowerShell process; no repository or CLI code was changed. The required command itself was:

```text
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli --parallel=1 --maxWorkers=2

NX Running target test for 4 projects and 32 tasks they depend on:
- @ptah-extension/shared
- @ptah-extension/agent-sdk
- @ptah-extension/rpc-handlers
- ptah-cli

@ptah-extension/shared:
Test Suites: 60 passed, 60 total
Tests:       1547 passed, 1547 total

@ptah-extension/agent-sdk:
Test Suites: 2 skipped, 111 passed, 111 of 113 total
Tests:       3 skipped, 1952 passed, 1955 total

@ptah-extension/rpc-handlers:
Test Suites: 103 passed, 103 total
Tests:       33 skipped, 3024 passed, 3057 total

ptah-cli:
Test Suites: 1 skipped, 67 passed, 67 of 68 total
Tests:       3 skipped, 1015 passed, 1018 total

NX Successfully ran target test for 4 projects and 32 tasks they depend on
```

Typecheck:

```text
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli @ptah-extension/vscode-core ptah-electron ptah-extension-vscode ptah-extension-webview @ptah-extension/chat --parallel=1
NX Running target typecheck for 9 projects
NX Successfully ran target typecheck for 9 projects
```

Lint:

```text
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli --parallel=1
NX Running target lint for 4 projects
@ptah-extension/shared: 0 errors, 2 warnings
@ptah-extension/agent-sdk: 0 errors, 42 warnings
@ptah-extension/rpc-handlers: 0 errors, 19 warnings
ptah-cli: 0 errors, 125 warnings
NX Successfully ran target lint for 4 projects
```

The warnings are existing max-lines/non-null/unused baseline debt; no new lint error was introduced. Formatting also passed for every changed implementation/spec/doc file:

```text
Checking formatting...
All matched files use Prettier code style!
```

Degradation audit:

```text
degradation-audit: scanned 2846 file(s)
apps/ptah-cli: 29 ok (baseline 29)
libs/backend/agent-sdk: 4 ok (baseline 4)
libs/backend/rpc-handlers: 1 ok (baseline 1)
libs/shared/src: 3 ok (baseline 3)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

The scoped Ptah diagnostics provider was also queried twice after the edits, but honestly reported `typescript-compiler — Unavailable` because its background check exceeded 45 seconds. The explicit nine-project TypeScript check above is the successful diagnostic evidence.

## Plan deviations

None. An intermediate size-budget cleanup shortened the established missing-file log phrase and one existing agent-sdk assertion caught it; the phrase was restored before the final passing verification. The final implementation remains within the specified line budget.

## Blocking findings

None.

## Out-of-scope observations

- The test/build output retains the existing CommonJS `import.meta` warning from `workspace-intelligence` and the existing CLI Jest forced-worker-exit warning.
- Nx reports that the AI agent configuration is outdated. Neither item affected the required checks, and neither was modified in this batch.

## Revise round 1

### Finding → resolution

- **Degradation audit / shared loader**: retained the proper non-suppressed structure in which the catch only logs and the missing-result sentinel is handled after the catch (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:330-333`). The pre-edit and final audits both report the required **TOTAL 303**; `libs/backend/agent-sdk` remains `4 ok (baseline 4)`.
- **Out-of-range `occurrenceFromEnd`**: added a regression assertion using `ids.length`, proving an index beyond the last match resolves to `null` and reaches the existing `MESSAGE_ID_NOT_FOUND_PHRASE` throw (`session-history-reader.events-read.spec.ts:168-178`).
- **Reader log prefix**: restored the exact `[SessionHistoryReader] Session file not found` message through `MISSING_SESSION_LOG` and retained the session context object (`session-history-reader.service.ts:68`, `:331`).
- **Page-read authorization gaps**: added direct `WORKSPACE_NOT_OPEN` and unsafe-open-workspace tests, both also asserting that event I/O never starts (`libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts:151-180`).
- **Full-history invariant**: documented at the `fullEvents` declaration that registration and stats require the unsliced transcript (`chat-session.service.ts:826`).
- **Named shared-load result**: added the private `SessionEventData` return type and applied it to `loadSessionEventData` (`session-history-reader.service.ts:99-104`, `:308-315`).

### Files changed in revise round 1

- MODIFIED `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` — named result type, restored prefixed log, audit-safe missing-file flow.
- MODIFIED `libs/backend/agent-sdk/src/lib/session-history-reader.events-read.spec.ts` — out-of-range from-end regression.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts` — no-workspace and unsafe-workspace branches.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` — full-history invariant comment.
- MODIFIED `.ptah/specs/TASK_2026_453_1eb4/b10-codex-report.md` — this revise-round record.

No `libs/frontend/**` file was edited.

### Line deltas

```text
session-history-reader.service.ts: 1086 -> 1126 (+40)
chat-session.service.ts:            1419 -> 1372 (-47)
```

### Literal verification output

Runner gate immediately before the required four-project suite:

```text
matching=0 root-runners=0
```

Tests:

```text
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli --parallel=1 --maxWorkers=2
NX Running target test for 4 projects and 32 tasks they depend on:
- @ptah-extension/shared
- @ptah-extension/agent-sdk
- @ptah-extension/rpc-handlers
- ptah-cli

@ptah-extension/shared
Test Suites: 60 passed, 60 total
Tests:       1547 passed, 1547 total

@ptah-extension/agent-sdk
Test Suites: 2 skipped, 111 passed, 111 of 113 total
Tests:       3 skipped, 1952 passed, 1955 total

@ptah-extension/rpc-handlers
Test Suites: 103 passed, 103 total
Tests:       33 skipped, 3026 passed, 3059 total

ptah-cli
Test Suites: 1 skipped, 67 passed, 67 of 68 total
Tests:       3 skipped, 1015 passed, 1018 total

NX Successfully ran target test for 4 projects and 32 tasks they depend on
```

Typecheck:

```text
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli @ptah-extension/vscode-core ptah-electron ptah-extension-vscode ptah-extension-webview @ptah-extension/chat --parallel=1
NX Running target typecheck for 9 projects:
NX Successfully ran target typecheck for 9 projects
```

Lint:

```text
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli --parallel=1
NX Running target lint for 4 projects:
@ptah-extension/shared: 2 problems (0 errors, 2 warnings)
@ptah-extension/agent-sdk: 42 problems (0 errors, 42 warnings)
@ptah-extension/rpc-handlers: 19 problems (0 errors, 19 warnings)
ptah-cli: 125 problems (0 errors, 125 warnings)
NX Successfully ran target lint for 4 projects
```

Degradation audit:

```text
npx nx run-many -t lint -p degradation-audit --parallel=1
NX Running target lint for project degradation-audit:
degradation-audit: scanned 2846 file(s)
libs/backend/agent-sdk: 4 ok (baseline 4)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

Formatting:

```text
Checking formatting...
All matched files use Prettier code style!
```

### Deviations and blockers

- No plan deviations and no blockers.
- One focused preflight run caught a return annotation accidentally applied to the constructor while introducing the named result type. It was corrected before the passing focused and binding verification runs above.
