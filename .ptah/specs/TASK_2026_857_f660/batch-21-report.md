# Batch 21 report

## Task 21.1 � Electron composition root

- `apps/ptah-electron/src/di/phase-2-libraries.ts:301-303` aliases `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` to `LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER`; `:414-416` starts lane outcomes with `observeSubagentEnded: true`.
- `apps/ptah-electron/src/di/phase-4-handlers.ts:94-96` calls `registerHostRouting(container)` after `registerChatServices`. Phase 4 follows SDK and lane-routing registration in Phase 2 and the `TOKENS.PTAH_API_BUILDER` binding in Phase 3 (`apps/ptah-electron/src/di/container.ts:43-46`). Phase 4 registration precedes first chat singleton resolution.
- `apps/ptah-electron/src/di/phase-4-handlers.ts:98-105` disposes the coordinator on Electron `will-quit`, before the main quit listener registered after DI setup. The optional `app?.once` check lets stripped Jest containers run without Electron's app object.

## Task 21.2 � DI guard

- `apps/ptah-electron/src/di/expected-resolvable.ts:34-40` lists all five requested tokens: `CHAT_TOKENS.HOST_ROUTING_COORDINATOR`, `LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING`, both task-kind classifier tokens, and `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE`.
- The existing `EXPECTED_RESOLVABLE` array is handler classes; the named token list keeps the `.name` based handler smoke test valid.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:751-753,756-785` checks the classifier alias and outcome observer option. `:850-863,945` supplies the earlier-phase registration preconditions to the isolated Phase 4 fixture and asserts coordinator registration. This guard spec was the one additional file changed because its Phase 4 fixture failed without the new preconditions. The RPC surface and surface composition specs needed no edit and passed in the Electron test target.

## Task 21.3 � Other hosts

- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:15-29` and `apps/ptah-cli/src/di/expected-resolvable.ts:14-27` enumerate selected attention tokens and handler classes, not every new lib-owned token. Their typecheck and test targets passed; neither guard needed an edit.

## Files touched

- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/di/phase-2-libraries.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/di/phase-4-handlers.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/di/expected-resolvable.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/di/container.smoke.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-21-report.md`

## Checks

- `npm run verify -- -p ptah-electron`: first run 8/9 tasks succeeded, exit 1; one Prettier-sensitive source-text assertion failed. Fixed that guard assertion. Final run 9/9 tasks succeeded, exit 0 (6 cached).
- `npm run verify -- -t typecheck,test -p ptah-extension-vscode,ptah-cli`: 44/44 tasks succeeded, exit 0 (4 cached).
- `npm run verify -- -t lint -p degradation-audit`: 1/1 task succeeded, exit 0.
- `npx prettier --write` on all four TypeScript files: exit 0. `npx prettier --check` on all four: exit 0, all matched files formatted.
- `ptah_get_diagnostics` scoped to the four changed TypeScript files was attempted after edits but returned unavailable after its 45-second TypeScript timeout. The required Electron verify included a successful typecheck.

## R9

R9 did not fire. Both other hosts passed their required typecheck and tests. No VS Code or CLI files were edited.

## Proposed B22

None.

## Decisions

- **D-B21-1 � Use `registerHostRouting` in Phase 4.** Options: the older plan's `registerHostRoutingServices` name or the exported `registerHostRouting`. Evidence: `libs/backend/rpc-handlers/src/index.ts:128` exports `registerHostRouting`, and the B19 handoff names it. Reversible: yes.
- **D-B21-2 � Attach a `will-quit` listener in the scoped Phase 4 file.** Options: leave subscriptions until process exit or release through Electron's quit lifecycle. Evidence: `apps/ptah-electron/src/main.ts` registers `will-quit` after DI setup; the task requires disposal where a shutdown hook exists. Reversible: yes.
- **D-B21-3 � Keep service tokens in a separate named list.** Options: mix symbols into the handler-class list or add `EXPECTED_RESOLVABLE_TOKENS`. Evidence: `container.smoke.spec.ts:352-360` reads `.name` from handler classes. Reversible: yes.

No host skill-loading tool was available in this lane; no skill was loaded.
