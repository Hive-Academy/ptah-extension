# Batch 17 report: degradation-audit markers on the proposal store

**Task**: 17.1, annotate the three flagged sites in the proposal store.
**Verdict**: PASS. Only comments were added: no statement, return value, log call or
baseline changed.

## File

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts`

## Markers

Placement: each marker is the first comment line inside the catch body (zone 2 in
`tools/degradation-audit/check-degradation.ts:39-41`). This is the same placement used in
`libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:205,230` and
`libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.ts:231,364,393`.
For the `.catch(...)` site, the marker sits in the contiguous comment run directly above
the statement (zone 3, `check-degradation.ts:42-45`).

| Audit site (old line)                                                              | Kind                  | Catch / call line now      | Marker line |
| ---------------------------------------------------------------------------------- | --------------------- | -------------------------- | ----------- |
| `:145` catch-return-sentinel (corrupt record: warns, returns null)                 | `reported`            | `:145`                     | `:146-148`  |
| `:157` promise-catch-sentinel (temp unlink, original error rethrown)               | `optional-capability` | `:162` (`catch` at `:159`) | `:160-161`  |
| `:166` catch-return-sentinel (readdir failure: warns unless ENOENT, prune skipped) | `reported`            | `:171`                     | `:172-174`  |

## Verification

1. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 2>&1 | grep -E "rpc-handlers|vscode-lm-tools|shared|FAIL" | head -20`
   PASS. Exit 0 and no FAIL line. The only remaining rpc-handlers site is the baselined
   `agent-rpc.handlers.ts:1316`.
   ```
   libs/backend/rpc-handlers: 1 ok (baseline 1)
   libs/backend/vscode-lm-tools: 2 ok (baseline 2)
   libs/shared/src: 3 ok (baseline 3)
   ```
2. `npx prettier --check libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts`
   PASS.
   ```
   Checking formatting...
   All matched files use Prettier code style!
   ```
3. `npx nx run-many -t lint,test -p @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -20`
   PASS. The Nx Cloud 401 notice is about the cloud plan and does not affect the local run.
   ```
   NX  Successfully ran targets lint, test for project @ptah-extension/rpc-handlers
   Run duration: 56.3s   Cache: 0/2 hit (0%)
   ```

## Scope

I touched no other file. The Batch 9 working-tree files, `batches.md`, `decisions.md` and
`batch-9-report.md` were left as they were. I ran no git commands.
