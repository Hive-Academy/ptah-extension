# Batch 58 executor report — N7 tab state

**Tasks completed**: 58.1, 58.2

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/frontend/chat-types/src/lib/chat-types.ts`
  — `TabState.sessionBudget?: SessionBudgetState | null`, next to `sessionStats`; imports the Batch 50 type from
  `@ptah-extension/shared`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/frontend/chat-state/src/lib/tab-manager.service.ts`
  — optional `budget?: SessionBudgetState` on `installSessionStats` and `applyLoadedSessionStats` (no new public
  method); module helper `budgetPatch`; `sessionBudget: null` in `resetTabToFresh` and `rebindTabSession`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts`
  — `budgetState` fixture and a `session budget` describe with 9 cases.

## Behaviour

- The budget installs only within the update of an accepted snapshot (`acceptSessionStats` decides). A snapshot
  rejected by revision floor, session mismatch or validation drops its budget with it.
- An absent budget (`undefined`) leaves the tab's last budget. A budget whose `sessionId` differs from its snapshot's is
  treated as absent (same rule as the snapshot's own session check).
- `resetTabToFresh` and `rebindTabSession` null it alongside `sessionStats`.
- No second counter: the budget is the backend's state, read beside `tab.sessionStats`.

## Specs added (tab-manager.intent-mutators.spec.ts)

Installed with the snapshot; dropped with a lower revision; dropped with an other-session snapshot; absent keeps last;
mismatched budget ignored; resume path installs; delayed resume cannot replace a newer live budget; reset clears;
rebind clears.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-types @ptah-extension/chat-state @ptah-extension/chat @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/git-ui @ptah-extension/harness-builder @ptah-extension/marketplace ptah-extension-webview`
  — "Successfully ran targets typecheck, lint for 10 projects" (20 tasks).
- `npx nx run-many -t test -p @ptah-extension/chat-types @ptah-extension/chat-state --maxWorkers=2` — "Successfully ran
  target test for project @ptah-extension/chat-state". `@ptah-extension/chat-types` has no test target (type-only lib),
  so only chat-state ran.
- `npx nx run @ptah-extension/chat-state:test -- tab-manager.intent-mutators` — 1 suite, 92 tests passed.
- Prettier applied to the three files.

## Deviations

- Specs went into `tab-manager.intent-mutators.spec.ts` rather than `tab-manager.service.spec.ts`: the existing
  `installSessionStats` revision-rule specs and the `sessionSnapshot` fixture live there.
- Added the budget/snapshot `sessionId` match guard (not in the batch text): it keeps a mis-keyed budget off a tab whose
  snapshot was accepted, mirroring the snapshot's own session check.

## Out of scope

- None. Batch 59 wires `stats.budget` / `resume.budget` into the two installers.
