# Batch 13 report — Agent successor tool asks the user (C1, D23)

## Task 13.1: `startSuccessor` calls `requestFromAgent`

- `session-spawner.service.ts` `startSuccessor`: `handoverCoordinator.begin(activeId, 'successor', turnInFlight, handoff)`
  replaced by `handoverCoordinator.requestFromAgent(activeId, request.handoff)` (the signature at
  `session-handover-coordinator.service.ts:282`). The local `turnInFlight` read is gone; the injected
  `turnState` stays (still used by the child phase read, now `:1327-1328`). The refusals have not changed
  (`unattributed-caller`, `chat-runtime-unavailable` when there is no coordinator or it refuses). The
  method still returns `{ ok: true, successor: true }`.
- Spec: both harness `Pick`s (`:70`, `:185`) use `'requestFromAgent'` instead of `'begin'`, and so does the
  lease-transfer fake. The successor case asserts
  `requestFromAgent(child.childSessionId, 'continue')` and `expect(coordinator).not.toHaveProperty('begin')`.
  Added refusal spec: `it.each(['unavailable', 'source-unavailable'])`. When the coordinator refuses, the call
  returns `chat-runtime-unavailable`.
- A6: the steer path's `admitOrHold` (`session-spawner.service.ts:644`) is unchanged. Its behaviour follows
  `holdsSource`.

## Task 13.2: Tool reply and description

- `session-tool-handlers.ts` `sessionStartReply` successor text now reads exactly: "Successor handover
  requested. It waits for the user to approve it in the session banner; nothing changes until then. Keep
  working normally. If the user cancels, this session continues."
- `session-tools.ts` description: successor mode asks the user to approve, and nothing starts until the
  user approves in the session banner. The following sentence now says "A child opens…" so that the
  tab/unattended text clearly refers to child mode.
- `session-tools.spec.ts`: the successor case now uses `toBe` on the exact new text. This is stricter than
  the old regex.

## Grep gate G2 (`.begin(` on the coordinator)

`grep -rnE "\.begin\(" libs apps --include=*.ts | grep -v .spec.ts` finds only one coordinator call:
`libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.ts:99`. The other hits are
unrelated `begin` methods (read timing, turn tracker, connection recorder, conflict banner).

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.ts
- D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\session-tool-handlers.ts
- D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\session-tools.ts
- D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\session-tools.spec.ts

## Verification (each run under the shared lock)

- Spawner spec, with the mapper: 1 suite, 77 tests passed.
- `session-tools.spec.ts`, bare: failed with "Could not locate module marked" (A3 confirmed).
- `session-tools.spec.ts` with the batch's mapper: failed on `wasm-bundle-dir.ts` (`import.meta`). The CLI
  `--moduleNameMapper` replaces the config's mapper, so the config's `wasm-bundle-dir` entry was lost.
  Re-ran with that entry added
  (`"(^|/)wasm-bundle-dir(\\\\.js)?$": ".../libs/backend/vscode-lm-tools/__mocks__/wasm-bundle-dir.ts"`):
  1 suite, 45 tests passed.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1 --skip-nx-cache`: passed.
- `npx nx typecheck @ptah-extension/vscode-lm-tools --parallel=1 --skip-nx-cache`: passed.
- `npx nx lint @ptah-extension/cli-agent-runtime`: 0 errors, 45 warnings.
  `npx nx lint @ptah-extension/vscode-lm-tools`: 0 errors, 79 warnings.
  Running `npx eslint` on the five changed files gives one warning: the existing `max-lines` warning on
  `session-spawner.service.ts`. That file went from 1457 to 1456 lines, so this batch adds no new warnings.

## Deviations / risks

- Verification command: the vscode-lm-tools mapper needs a third entry (`wasm-bundle-dir`), which the batch
  command leaves out. Future runs of that spec need it.
- No deferred 627-L* items touched.
