# Implementation report - TASK_2026_694_b504

## Files changed

- `libs/frontend/command-center/src/lib/model/session-coordinator.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-start.component.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts`
- Integration specs in `libs/frontend/command-center/src/lib/integration/`: `accessibility-list`, `delegation-and-status`, `failure-and-fallback`, `session-identity-and-lock`, `tribunal-confirm-gate`, and `voice-turn-loop`.
- `libs/frontend/chat-state/src/lib/command-center-persona.ts` and `.spec.ts`.
- This report.

## Acceptance

- **A:** Page entry calls `openStart()` (`command-center-workspace-binding.ts:33`). It clears selection, discovers the current tab, and loads sessions without switching or creating a tab (`session-coordinator.ts:53`). An unselected send creates a new tab (`session-coordinator.ts:293`). The unused `openOrResume()`, `openOrResumeInternal()`, `opening` field, and `sessionExists()` were removed. Live restore, restore failure, and other-tab guard behavior are tested through `chooseSession()` (`session-coordinator.spec.ts:140`, `:163`).
- **B:** The standalone OnPush start component renders up to five cards, Current first, with name, relative time and a Command Center marker (`command-center-start.component.ts:15`, `:125`). It has loading, empty, error and Retry states, plus New session and All sessions. All sessions fetches the full paginated list (`session-coordinator.ts:81`); selection uses the existing Command Center restore path and other-tab guard (`session-coordinator.ts:133`). A request counter prevents stale list responses from replacing a newer result or error state (`session-coordinator.ts:85`, `:108`, `:119`; test `session-coordinator.spec.ts:177`). The page wires selection and controls (`command-center-page.component.ts:196`); the existing Start new control remains wired (`:317`). The component uses a section landmark, native buttons, focus-visible styles and theme tokens. All public component members have explicit accessibility modifiers.
- **C:** The plain spoken opening rule is in `command-center-persona.ts:30` and asserted in its spec.

## Checks

- Command Center typecheck: passed.
- Command Center lint: passed, with no warning or error lines.
- Command Center tests: 41 suites, 421 tests passed. The first run exposed a test setup error in the other-tab guard test; after selecting the other tab's session, the full suite passed.
- Degradation audit: TOTAL 294 unsuppressed sites.
- The earlier lane also passed chat-state typecheck, lint and tests (33 suites, 613 tests). No chat-state source was edited in this verification pass.
- Prettier was run on all source and spec files edited in this verification pass.

## Decisions

- **All sessions selection:** Options were reuse `PreviousSessionsDialogService` or use a Command Center list view. The shared service exposes only `open()`/`close()` and its modal owns chat selection, so the existing Command Center list remains. This keeps selection on the Command Center restore path and needs no chat export. Reversible by adding a selection callback to the shared modal later.
- **Current card:** The current marked tab takes the first card and counts toward the five-card limit. Evidence: the user required Current first and about five cards. Reversible by changing `visibleSessions()`.
- **Provider mark:** Options were retain the conditional mark path or remove it. `ChatSessionSummary` (`libs/shared/src/lib/types/execution/node.ts:229`) and `ChatSessionSummarySchema` have no provider field, so the `session:list` result cannot supply one. Removed the dead `providerId()` method, mark markup and imports. Reversible if the shared session summary and RPC schema later carry provider identity.

## Not done

- Provider marks cannot be shown from the current `session:list` data because it has no provider field. Adding one would require changes outside this task's permitted scope.
