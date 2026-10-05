# Batch 53 executor report — N8 handoff builder and writer

## Backend implementation — `TASK_2026_597`, batch 53

**Tasks completed**: 53.1 `session-handoff-builder.ts`, 53.2 `session-handoff-writer.ts`

**Files** (all under `D:\projects\ptah-extension\.claude-worktrees\task-597-session-budget\libs\backend\agent-sdk\src\lib\helpers\session-budget\`):

- CREATED `session-handoff-builder.ts`. It exports:
  - the pure `extractSessionHandoffFacts(lines)`, `renderSessionHandoff(facts, meta)` and `assembleSessionHandoff(lines, meta)`;
  - the `@injectable` `SessionHandoffBuilder` (LOGGER + `SDK_TOKENS.SDK_JSONL_READER`). Its `build()` checks the id against `UUID_REGEX`, calls `findSessionsDirectory`, then reads `<sessionsDir>/<id>.jsonl` with `readJsonlTail` (4 MB window);
  - the caps in `SESSION_HANDOFF_LIMITS`.
- CREATED `session-handoff-writer.ts`. It exports:
  - `SessionHandoffWriter.write(sessionId, content)`. It writes `~/.ptah/handoffs/<uuid>.md` through a uniquely named temp file in the same directory, renames it over the target, then prunes to the newest 50 `<uuid>.md` files. The file it just wrote is never pruned;
  - `resolveSessionHandoffPath` (UUID check plus confinement to the handoffs directory, F12);
  - `sessionHandoffsDirectory(homeDir)` and `SESSION_HANDOFF_RETENTION = 50`.
- CREATED `session-handoff-builder.spec.ts` (31 tests), `session-handoff-writer.spec.ts` (9 tests, real temp dir) and `__fixtures__/11111111-2222-4333-8444-555555555555.jsonl`.

**Behaviour (component 5)**

- Facts come from the transcript tail only, with no model call:
  - summary: the first non-meta user text after the latest `compact_boundary`, capped at 2,500 characters. Without one, the first user prompt is used, capped at 1,000;
  - changed files: Edit/Write/MultiEdit/NotebookEdit paths, unique, at most 50, then "+N more";
  - open items: the not-completed items of the latest TodoWrite, at most 20, then "+N more";
  - next action: the first in-progress item, else the first pending item, else the last assistant text, capped at 800;
  - task folders: `.ptah/specs/TASK_\d{4}_\d{3}…`, at most 5.
- The sections are fixed:
  1. Session (id, built time, budget line, task folders)
  2. Goal
  3. Decisions and current state
  4. Changed files
  5. Open items
  6. Next action
  7. How to continue
- The total is at most 8,000 characters. When it overflows, the body is cut with `[truncated]` and "How to continue" is always kept. The seed is a fixed preamble plus the document, at most 8,200 characters (AS-N7b). `truncated` is set by any cap.
- Transcript text is treated as data:
  - free text is rendered as a block quote, so it cannot open a heading;
  - control characters are removed;
  - paths are made single-line with no backticks and capped at 300 characters, and are never used as file-system paths;
  - a rejected session id is never logged.
- Failure handling:
  - The builder returns `readError` (`invalid session id`, `transcript directory not found`, `transcript not found`, `transcript unreadable (CODE)`) and still returns a full document built from no lines.
  - The writer returns `{ path: null, writeError }`, with text such as "Invalid session id" or "Could not write the handoff file (CODE)", and never throws.
  - Each distinct failure is logged at WARN once.

**Stack observed**:

- tsyringe `@injectable`/`@inject` with `TOKENS.LOGGER` and `SDK_TOKENS.SDK_JSONL_READER`, following `session-stats-reader.service.ts:98-102` and `session-budget-config.provider.ts`.
- Bounded tail read through `JsonlReaderService.readJsonlTail` (`jsonl-reader.service.ts:554`).
- Transcript path `<sessionsDir>/<id>.jsonl` as in `session-stats-reader.service.ts:123-161`.
- `UUID_REGEX` from `@ptah-extension/shared` (`branded.types.ts:39`).
- Real-filesystem specs with `mkdtemp`, following `session-stats-reader.service.spec.ts`.

**Verification** (run in the `task-597-session-budget` worktree):

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk`: typecheck and lint both passed.
- `npx nx run @ptah-extension/agent-sdk:test --testPathPattern=session-handoff --maxWorkers=2`: the pattern was not applied, so the whole suite ran. 133 suites passed and 2 were skipped; 2,693 tests passed and 3 were skipped.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff --maxWorkers=2`: 2 suites and 40 tests passed.
- Nx Cloud printed a 401 (the organisation is disabled). This does not affect local runs.

**Plan deviations**:

- `SessionHandoffWriter` is a plain class, `new SessionHandoffWriter(logger, { homeDir? })`, and not `@injectable`. The reason is the batch requirement "home dir injectable for specs": tsyringe cannot resolve a `string` constructor parameter, and adding a DI token would mean editing `di/tokens.ts`, which belongs to Batch 55. The precedent is `ProcessStartTimeProbe`, which takes an options constructor. Batch 55 constructs it with the resolved logger. `SessionHandoffBuilder` is `@injectable`. Neither class is registered or added to the barrel; both belong to Batch 55.
- The transcript JSONL does not keep `isCompactSummary` (the converter in `jsonl-reader.service.ts:763-790` drops it, and that file is not in this batch). The summary is therefore taken as the first conversational user text after the latest `compact_boundary`, the same boundary rule `session-history-reader.service.ts:568-577` uses.
- The writer has no read method. The service (Batch 54) keeps the content in memory for `preview-handoff` and the seed, so a read method would be speculative.

**Out-of-scope observations**:

- `nx run …:test --testPathPattern=…` does not narrow this executor, so it ran the whole agent-sdk suite.
- `UUID_REGEX` accepts v4 UUIDs only. The SDK's session ids are v4 today. If that changes, handoffs will be refused with "Invalid session id" and nothing will be written.

## Fix: degradation audit

- `session-handoff-writer.ts`: the temp cleanup used `.catch(() => undefined)`, which the audit flags as `[promise-catch-sentinel]`. It now goes through a private `removeTemp()` method that logs any failure at WARN with the error code and message. Behaviour is unchanged: a failed cleanup never replaces the write failure the caller gets back.
- `npx nx run degradation-audit:lint --outputStyle=static`: passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk`: typecheck and lint both passed.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts …/session-handoff --maxWorkers=2`: 2 suites and 40 tests passed.
