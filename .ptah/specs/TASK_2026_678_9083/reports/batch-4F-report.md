# Batch 4F report

## Files written

- Modified: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`
- Created: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-persona.spec.ts`
- Created: `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-4F-report.md`

## Change

In the router's `new-query` `sessionConfig`, added exactly `...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),` after the existing optional fields. No other branch or call field changed. The spec drives `ChatSessionService.continueSession` through the real router and inspects the adapter call.

## Spec cases

| Case | Assertion | Status |
| --- | --- | --- |
| (a) inactive session, `/compact`, persona | Exact `systemPrompt` value in `executeSlashCommand` `sessionConfig`; no resume | Pass (project test target) |
| (b) active session, `/compact`, persona | Exact `systemPrompt` value; no resume or teardown | Pass (project test target) |
| (c) no `systemPrompt` | No `systemPrompt` key in `sessionConfig` | Pass (project test target) |
| (d) empty string | No `systemPrompt` key in `sessionConfig` | Pass (project test target) |
| (e) `/clear` | No `executeSlashCommand` call | Pass (project test target) |

## Agent SDK chain

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1617-1626`: provider profile merge starts with `...config.sessionConfig`, then overrides model and optional effort. `systemPrompt` survives.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1650-1654`: the merged `sessionConfig` enters `executeSlashCommandQuery`.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:743-746`: `executeSlashCommandQuery` passes `config.sessionConfig` into `executeQuery`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1769`: query options read `sessionConfig?.systemPrompt` as `userSystemPrompt`.

## Scoped verification

Command: `npx nx run-many -t test typecheck lint -p @ptah-extension/rpc-handlers --parallel=1` (one foreground run, output captured outside the worktree at `%TEMP%/ptah-batch-4f-scoped.log`). The Nx header names one project, `@ptah-extension/rpc-handlers`. Exit code: 0.

```text
NX   Running targets test, typecheck, lint for project @ptah-extension/rpc-handlers:

- @ptah-extension/rpc-handlers

√  nx run @ptah-extension/rpc-handlers:test
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run @ptah-extension/rpc-handlers:lint

NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/rpc-handlers

Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

NX   Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan. (code: 401)
SCOPED_EXIT_CODE=0
```

## Decisions and deviations

- Decision: use a focused `continueSession` harness with a real router. The existing slash-before-resume and provider-profile specs establish this seam; it covers both inactive and active states while asserting the final adapter call. Reversible.
- `ptah_get_diagnostics` timed out after 45 seconds and reported the two changed files unchecked. The scoped Nx typecheck passed.
- Nx Cloud printed a disabled-organization warning after all three local targets succeeded; command exit code was 0. Nx suppressed individual Jest case output, so case status follows the successful project test target.
