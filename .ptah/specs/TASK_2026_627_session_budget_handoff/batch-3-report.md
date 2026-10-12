# Batch 3 report — TASK_2026_627

Batch: Agent handoff kept in full; budget remembers the workspace. Tasks 3.1 and 3.2 are implemented.
No git commands were run apart from one read-only `git status --short`, used to list the changed files.

## Files changed

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/di/register.ts`: one line. The factory now passes
  `c.resolve(MainThreadNoticeQueue)` to `SessionBudgetService` (see Deviations).

## Task 3.1: Handoff builder (R8)

- `SESSION_HANDOFF_LIMITS`:
  - `agentHandoffChars` is now 6,000 (was 2,000).
  - `seedChars` is now 14,200, which is `totalChars + agentHandoffChars + 200`.
  - `totalChars` stays 8,000 and covers the deterministic part only.
  - The comments on the constant and on `SessionHandoffDocument.content` describe the new caps.
- `withAgentHandoff` was rewritten:
  - The agent text is sanitised (`sanitizeHandoffText`) and block-quoted.
  - It is rendered as a `## Agent handoff` section placed directly under the `# Session handoff`
    title, in `document.content`.
  - The seed is rebuilt as `SEED_PREAMBLE + content` and sliced to `seedChars`. The worst case is
    166 + 8,000 + 18 + 6,000 + 2 = 14,186 characters, so the slice never cuts anything.
  - `chars` and `truncated` are updated.
  - With no agent text (undefined, empty, or blank after sanitising), the document is returned
    unchanged.
- New helper `quoteWithin` caps the *quoted* form of the agent text at `agentHandoffChars`,
  `[truncated]` marker included. Quoting adds 2 characters per line, so the raw cap shrinks in
  proportion to the overflow, by at least 1 per pass, so the loop always ends.
- The old "Agent handoff supplement:" prefix, and its rule of skipping the agent text when the seed
  had no room, are removed.
- New constants `DOCUMENT_TITLE` and `AGENT_HANDOFF_HEADING`. `renderSessionHandoff` uses
  `DOCUMENT_TITLE`, and its output is unchanged.
- Spec: the two old supplement cases are replaced by these:
  - section rendered under the title, block-quoted, control characters stripped, `## …` inside the
    text quoted;
  - **R8 regression**: a full deterministic document (near 8,000 chars) plus a 5,000-char agent
    handoff keeps all 5,000 chars in both content and seed. The rest of the document is
    byte-identical to the build without agent text, and `## How to continue` is still present;
  - a 7,000-char agent handoff is cut to exactly 6,000 quoted characters ending in ` [truncated]`,
    with `truncated: true`;
  - text with 3,000 one-character lines stays within 6,000 quoted characters, with the marker;
  - no agent text (`undefined`, `''`, whitespace and control characters only) gives a document equal
    to the plain build.

## Task 3.2: `SessionBudgetService`

- `BudgetEntry.workspacePath?: string` was added. It is set in `acceptOrThrow` through
  `rememberWorkspace(entry)`, after the tracked-entry check, the first time
  `sessionControl.getSessionWorkspace` returns a value. Later answers do not overwrite it.
- `buildHandoff` uses `getSessionWorkspace(sessionId) ?? entry?.workspacePath`. When neither is
  known, it reports `workspace-unknown` as before.
- `MainThreadNoticeQueue` is injected as an optional last constructor parameter,
  `@inject(MainThreadNoticeQueue) private readonly noticeQueue?: SessionBudgetNoticeQueue`. This
  follows the same idiom as `PostToolUseHookHandler` from Batch 1. `SessionBudgetNoticeQueue` is a
  new exported `Pick<MainThreadNoticeQueue, 'clear'>`.
- Pending notices are now cleared on session end:
  - `release(sessionId)` calls `noticeQueue?.clear(sessionId)`;
  - `clearAll()` calls it for every tracked session before clearing the map.
- `observeLive`, `liveFigure`, notice posting and `onTurnTerminal` were not added; they belong to
  Batch 7.
- Spec: the harness now passes a real `MainThreadNoticeQueue`. New cases:
  - a preview after the live lookup starts returning `undefined` builds from the remembered
    workspace, with no `handoff-read` WARN;
  - the first known workspace is kept, and the live lookup wins while it answers;
  - a workspace that was never known still builds without the transcript (builder not called);
  - a notice posted before `release` is gone after it, and another session's notice survives;
  - `clearAll` drops the notices of every tracked session;
  - `release` and `clearAll` do not throw when the service is built without a queue.

## Verification (from the worktree root)

1. `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts --coverage=false --maxWorkers=2`
   → `Test Suites: 2 passed, 2 total` / `Tests: 107 passed, 107 total`. It was run again after the
   prettier formatting below, with the same result.
2. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`
   → `Successfully ran target typecheck for project @ptah-extension/agent-sdk`
3. `npx nx lint @ptah-extension/agent-sdk --parallel=1`
   → `✖ 52 problems (0 errors, 52 warnings)` / `Successfully ran target lint`. The warning count
   matches the Batch 1 and 2 baseline. `session-budget.service.ts` is listed among the files with
   warnings; with no change in the count, that is taken as a warning that existed before this batch.
4. `npx prettier --write` on the builder, the builder spec and the service spec. The prettier check
   had flagged them; part of what it flagged was the old `withAgentHandoff` long line, which existed
   before this batch.

## Deviations

- **`register.ts` was edited (one line).** The batch lists only the service and its spec. But
  `SessionBudgetService` is built by a factory in `di/register.ts`, not by decorator injection,
  so without this line the queue would never reach the service in production and `clear` would
  never run. `MainThreadNoticeQueue` is registered at `register.ts:279`, before that factory.
- **Placement of the agent section.** It sits directly under the `# Session handoff` title line
  rather than before it, so the document still starts with its title. It is the first section of
  the content and of the seed (after the preamble). If the plan meant literally the first bytes,
  the change is a one-liner in `withAgentHandoff`.

## Out-of-scope observations

- `libs/shared/src/lib/types/session-budget.types.ts:319`: the `SessionBudgetActionResult.handoff.seed`
  doc comment still says "at most 8,200 characters". It is now 14,200. This is a comment only and no
  code validates it. It is left for Batch 4, which owns the shared contract.
