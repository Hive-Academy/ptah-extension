# TASK_2026_330 — Agent Output (root)

## Outcome

Moved `Read` observation capture onto the existing all-tool `PostToolUse`
fan-out. Removed the blocking `PreToolUse` handler, callback registry, DI tokens,
registrations, public exports, builder wiring, and obsolete handler specs.

The task-owned focused suites are green. The required repository-wide commands
were also run, but unrelated concurrent edits in explicitly out-of-scope files
currently prevent both commands from finishing green; details are recorded
under Verification.

## Files changed

- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/helpers/hook-session-resolver.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts`
- `libs/backend/memory-curator/src/lib/observation-queue.store.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.boot-scan-budget.spec.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.coalesce.spec.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.integration.spec.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0016_observation_queue.ts`

`libs/backend/agent-sdk/CLAUDE.md` and
`libs/backend/memory-curator/CLAUDE.md` were inspected; neither documented the
removed `PreToolUse Read` hook, so no documentation edit was needed.

## Files deleted

- `libs/backend/agent-sdk/src/lib/helpers/pre-tool-use-callback-registry.ts`
- `libs/backend/agent-sdk/src/lib/helpers/pre-tool-use-hook-handler.ts`
- `libs/backend/agent-sdk/src/lib/helpers/pre-tool-use-hook-handler.spec.ts`

## Specs added or adapted

- Added: `SdkQueryOptionsBuilder.createHooks — PostToolUse + UserPromptSubmit merger › omits PreToolUse from the merged hook list`
- Adapted: `MemoryTriggerService — observation queue side effects › PostToolUse Read inserts the same file-read observation row`
- Removed the deleted handler from hook session-resolution matrix coverage.
- Updated invalid-event fixtures in the remaining hook handler specs.
- Updated all `MemoryTriggerService` constructor fixtures after removing the registry dependency.

## Verification

### Focused task-owned suites — green

`npx nx test @ptah-extension/agent-sdk --testPathPatterns=sdk-query-options-builder.spec.ts --runInBand`

```text
Test Suites: 1 passed, 1 total
Tests:       46 passed, 46 total
```

`npx nx test @ptah-extension/memory-curator --testPathPatterns=memory-trigger --runInBand`

```text
Test Suites: 5 passed, 5 total
Tests:       102 passed, 102 total
```

### Required full Jest command — blocked by concurrent out-of-scope edit

Command run:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator
```

Verbatim latest Jest summary lines:

```text
agent-sdk:
Test Suites: 1 failed, 73 passed, 74 total
Tests:       1 failed, 1116 passed, 1117 total

memory-curator:
Test Suites: 2 skipped, 24 passed, 24 of 26 total
Tests:       60 skipped, 392 passed, 452 total
```

The only failure is
`libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.spec.ts`
(`InternalQueryConcurrencyGate › rejects a queued waiter with
InternalQueryQueueTimeoutError after the ceiling`). The user explicitly marked
`libs/backend/agent-sdk/src/lib/internal-query/**` as owned by another agent and
forbidden for this task, so it was not edited.

### Required typecheck command — task projects green; concurrent consumer blocked Electron

Command run:

```text
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/memory-curator ptah-electron ptah-extension-vscode ptah-cli
```

`@ptah-extension/agent-sdk`, `@ptah-extension/memory-curator`,
`ptah-extension-vscode`, and `ptah-cli` passed. `ptah-electron` was blocked by
the concurrent edit at
`libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts:197`:

```text
error TS2554: Expected 2 arguments, but got 1.
```

That consumer is part of the same concurrent internal-query API change and was
left untouched.

### Diff hygiene

The scoped `git diff --check -- <TASK_2026_330 files>` completed with exit code
0 and no output.

### Grep proof

Command:

```text
rg -n "PreToolUseHookHandler|PreToolUseCallbackRegistry|SDK_PRE_TOOL_USE|pre-tool-use-hook-handler|pre-tool-use-callback-registry|\bPreToolUse\s*:" libs/backend
```

Output:

```text
NO MATCHES: no PreToolUse hook implementation, registration, token, import, or hook key remains in libs/backend.
```

No commit was created.
