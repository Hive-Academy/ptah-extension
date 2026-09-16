# Batch 9 Codex Report

## Outcome

Batch 9 / Task 9.1 is complete. The shared library now owns the whole-turn history pager, opaque cursor codec and typed cursor failures, additive paging wire shapes, the stale-history RPC error code, and `MessageAnchorHint.occurrenceFromEnd`. The shared RPC registry and entries were deliberately not changed; V4 leaves those changes for Task 10.2 alongside the handler registration.

## Absolute Files Created or Modified

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\history-page.utils.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\history-page.utils.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\index.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\types\rpc\rpc-chat.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\types\rpc\rpc-session.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\types\rpc\rpc-error-codes.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\CLAUDE.md`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b9-codex-report.md`

No planning document, project configuration, RPC registry, runtime allowlist, scroll code, or transcript CSS was edited. No git write was performed.

## Task 9.1 Acceptance Evidence

1. Constants: `history-page.utils.ts:4-10` exports `HISTORY_TAIL_PAGE_EVENTS = 250`, `HISTORY_PAGE_DEFAULT_EVENTS = 250`, and `HISTORY_PAGE_MAX_EVENTS = 2000`; pinned by `history-page.utils.spec.ts:43-47`.
2. Whole-turn selection: `history-page.utils.ts:42-48,87-125` identifies only root user `message_start` events, treats index 0 as the implicit start, scans backwards in O(events), returns a whole oversize turn, and returns the required empty result. Tests cover empty input, tail snapping, tool-pair integrity, nested-agent integrity, oversize turns, exact fits, and assistant-first input at `history-page.utils.spec.ts:49-225`.
3. Cursor contract: `history-page.utils.ts:12,27-40,51-81` implements the `h1:<id>` codec, the exact `[A-Za-z0-9_-]{1,512}` decoder constraint, root-user-only resolution, and distinct pure `HistoryCursorInvalidError` / `HistoryCursorStaleError` subclasses without Node or browser encoding APIs. UUID, `u-12`, malformed, missing-anchor, and nested-anchor cases are pinned at `history-page.utils.spec.ts:227-258`.
4. Wire types and compatibility: `rpc-chat.types.ts:210-254` adds optional `ChatResumeParams.historyPage` and optional success metadata while explicitly documenting unchanged full-history semantics when absent. `rpc-chat.types.ts:337-352` defines `ChatHistoryPageParams` / `ChatHistoryPageResult`. Because all additions are optional and no handler changes occur here, callers omitting `historyPage` retain the existing shape and behavior.
5. Error code: `rpc-error-codes.types.ts:7-21` appends `HISTORY_CURSOR_STALE`.
6. Anchor hint: `rpc-session.types.ts:284-298` adds documented `occurrenceFromEnd?: number`, defined as identical prompts after the anchor and preferred over `occurrence`.
7. Page-chain seam: `history-page.utils.spec.ts:260-290` walks `endIndex` through each `olderCursor` to `null`, verifies pages are id-disjoint, and verifies concatenation exactly reconstructs the input.
8. Documentation: `libs/shared/CLAUDE.md:29` records tail-page behavior, older pages through `chat:history-page`, and unchanged behavior when `historyPage` is absent.
9. Public export: `utils/index.ts:12-25` exports constants, functions, errors, and types through the shared public barrel.

## Edge Cases and Risks

- Whole turns/tool pairs/agent subtrees: cuts occur only at root user starts (`role === 'user'` and no `parentToolUseId`); dedicated tests prove tool pairs and nested agent user messages cannot become split points.
- Compaction boundary: selection consumes the replayable post-compaction event segment defined by the C6 contract. Compaction boundaries cannot occur inside that input segment, and paging never synthesizes or joins a second segment.
- Oversize turn: the most recent turn is returned whole even when it exceeds `maxEvents`; it is not split to satisfy the soft budget.
- Assistant-first history: when there is no earlier root user start, index 0 remains the boundary and the prefix is reachable as the final older page.
- Cursor safety: malformed wire values and valid-but-missing anchors are distinguishable; nested message ids are never accepted as page anchors.
- Backwards compatibility: optional request/response members preserve full-history `chat:resume` callers. No `chat:history-page` registry or `RPC_METHOD_ENTRIES` change was made in this batch (V4/D10).
- Zod boundary ownership: this batch introduces shared wire types only and no executable external boundary. The approved plan assigns `ChatResumeParamsSchema` / `ChatHistoryPageParamsSchema` validation to Task 10.2 with the handler; no unvalidated handler was introduced here.
- V9 cursor charset: both UUID and fixture-style `u-12` ids are covered.
- Lint risk: the two reported max-line warnings are pre-existing in untouched files; this batch introduced zero lint errors and no new warning in a changed file.

## Verification — Final Clean Sequence

### 1. Tests

Command:

`npx nx run-many -t test -p @ptah-extension/shared --parallel=1 --maxWorkers=2`

Literal output lines:

```text
NX   Running target test for project @ptah-extension/shared:
- @ptah-extension/shared
Test Suites: 60 passed, 60 total
Tests:       1539 passed, 1539 total
NX   Successfully ran target test for project @ptah-extension/shared
```

Nx used its singular header because exactly one requested project was resolved; the listed project count is 1 as required.

### 2. Typecheck

Command:

`npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/chat ptah-extension-webview ptah-electron-e2e ptah-cli --parallel=1`

Literal output lines:

```text
NX   Running target typecheck for 6 projects:
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/chat
- ptah-extension-webview
- ptah-electron-e2e
- ptah-cli
NX   Successfully ran target typecheck for 6 projects
```

The first attempt exceeded the command wrapper's 120-second limit and left one orphaned `npx nx run-many ... typecheck` wrapper with no worker children. Only that exact PID was stopped. The required command then completed successfully, and the final clean sequence above was rerun after formatting.

### 3. Lint

Command:

`npx nx run-many -t lint -p @ptah-extension/shared --parallel=1`

Literal output lines:

```text
NX   Running target lint for project @ptah-extension/shared:
Linting "@ptah-extension/shared"...
✖ 2 problems (0 errors, 2 warnings)
NX   Successfully ran target lint for project @ptah-extension/shared
```

Existing warnings, both in untouched files:

```text
libs/shared/src/lib/connectors/ptah-connectors.catalog.ts
777:1  warning  File has too many lines (810). Maximum allowed is 700  max-lines
libs/shared/src/lib/types/rpc.types.ts
759:1  warning  File has too many lines (3168). Maximum allowed is 700  max-lines
```

### 4. Degradation Audit

Command:

`npx nx run degradation-audit:lint --skip-nx-cache`

Literal output lines:

```text
degradation-audit: scanned 2843 file(s)
  libs/shared/src: 3 ok (baseline 3)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

### 5. Prettier

Command:

`npx prettier --check libs/shared/src/lib/utils/history-page.utils.ts libs/shared/src/lib/utils/history-page.utils.spec.ts libs/shared/src/lib/utils/index.ts libs/shared/src/lib/types/rpc/rpc-chat.types.ts libs/shared/src/lib/types/rpc/rpc-session.types.ts libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts libs/shared/CLAUDE.md`

Literal output lines:

```text
Checking formatting...
All matched files use Prettier code style!
```

The newly created report was then checked separately with
`npx prettier --check .ptah/specs/TASK_2026_453_1eb4/b9-codex-report.md` and produced the same two literal success lines, so every changed file is covered.

## Diff Safeguards

- `git diff --check`: no output.
- `git diff --name-only -- libs/shared/src/lib/types/rpc.types.ts libs/backend/vscode-core/src/messaging/rpc-handler.ts`: no output; registry and allowlist are unchanged.
- No changed-file match for `content-visibility`, TODO, FIXME, `RpcMethodRegistry`, or `RPC_METHOD_ENTRIES`.
- Final product-code status contains exactly the seven Batch 9 files listed above; this report is the only task-folder addition.

## Revise round 1

### Findings resolved

1. **LOGIC MODERATE — invalid `maxEvents`:** `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\history-page.utils.ts:43-48` defines the dedicated typed `HistoryPageInvalidOptionsError`. `history-page.utils.ts:101-107` rejects non-finite, non-integer, zero, and negative budgets before the empty-input return or selection scan. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\history-page.utils.spec.ts:58-68` covers `NaN`, positive/negative infinity, `0`, `-1`, and `1.5`. The new error is publicly exported at `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\index.ts:20`.
2. **LOGIC MODERATE — cursor length boundaries:** `history-page.utils.spec.ts:252-257` proves one-character and exactly-512-character ids round-trip. `history-page.utils.spec.ts:259-267` retains the explicit 513-character rejection as `HistoryCursorInvalidError`.
3. **LOGIC MINOR — inline type import:** `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\types\rpc\rpc-chat.types.ts:12` now imports `SubagentRecord` with a top-level `import type`; `rpc-chat.types.ts:352` uses that symbol directly.
4. **STYLE MINOR — selection-state name:** `history-page.utils.ts:115-134` renames `foundLastTurn` to `foundNewestTurnStart`, accurately describing the first root-user boundary found during the backwards scan.
5. **STYLE MINOR — index-zero invariant:** `history-page.utils.ts:91-96` now documents that index 0 is always the implicit start, including assistant-first transcripts.
6. **STYLE MINOR — readonly page result arrays:** `rpc-chat.types.ts:349-352` uses `readonly FlatStreamEventUnion[]` and `readonly SubagentRecord[]`. This is safe because `ChatHistoryPageResult` has no existing consumer yet, mutable arrays produced by Batch 10 remain assignable to readonly fields, and the page result is a read-only transport consumed by Batch 12. `ChatResumeResult.events` remains mutable to avoid changing established consumers.

### Files changed in revise round 1

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\history-page.utils.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\history-page.utils.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\utils\index.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\shared\src\lib\types\rpc\rpc-chat.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b9-codex-report.md`

Batch 11's uncommitted `libs/frontend/**` files and reports were present throughout this round and were not edited by Batch 9.

### Verification — revise round 1 clean sequence

#### 1. Tests

Command: `npx nx run-many -t test -p @ptah-extension/shared --parallel=1 --maxWorkers=2`

```text
NX   Running target test for project @ptah-extension/shared:
- @ptah-extension/shared
Test Suites: 60 passed, 60 total
Tests:       1547 passed, 1547 total
NX   Successfully ran target test for project @ptah-extension/shared
```

Nx used the singular header because exactly one requested project was resolved. Before starting, the runner audit reported `RUNNER_COUNT=0`.

#### 2. Typecheck

Command: `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/chat ptah-extension-webview ptah-electron-e2e ptah-cli --parallel=1`

```text
NX   Running target typecheck for 6 projects:
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/chat
- ptah-extension-webview
- ptah-electron-e2e
- ptah-cli
NX   Successfully ran target typecheck for 6 projects
```

#### 3. Lint

Command: `npx nx run-many -t lint -p @ptah-extension/shared --parallel=1`

```text
NX   Running target lint for project @ptah-extension/shared:
Linting "@ptah-extension/shared"...
✖ 2 problems (0 errors, 2 warnings)
NX   Successfully ran target lint for project @ptah-extension/shared
```

Both warnings remain pre-existing in untouched files:

```text
libs/shared/src/lib/connectors/ptah-connectors.catalog.ts
777:1  warning  File has too many lines (810). Maximum allowed is 700  max-lines
libs/shared/src/lib/types/rpc.types.ts
759:1  warning  File has too many lines (3168). Maximum allowed is 700  max-lines
```

#### 4. Degradation audit

Command: `npx nx run degradation-audit:lint --skip-nx-cache`

```text
degradation-audit: scanned 2844 file(s)
  libs/shared/src: 3 ok (baseline 3)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

#### 5. Prettier

Command: `npx prettier --check libs/shared/src/lib/utils/history-page.utils.ts libs/shared/src/lib/utils/history-page.utils.spec.ts libs/shared/src/lib/utils/index.ts libs/shared/src/lib/types/rpc/rpc-chat.types.ts libs/shared/src/lib/types/rpc/rpc-session.types.ts libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts libs/shared/CLAUDE.md`

```text
Checking formatting...
All matched files use Prettier code style!
```

### Revision safeguards

- `git diff --check -- libs/shared`: no output.
- `git diff --name-only -- libs/shared/src/lib/types/rpc.types.ts libs/backend/vscode-core/src/messaging/rpc-handler.ts`: no output; V4/D10 deferral remains intact.
- No frontend file was edited in this revision.
