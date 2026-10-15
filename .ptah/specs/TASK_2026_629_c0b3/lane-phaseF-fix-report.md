# Phase F frontend fix report

## Items

1. **S1 — done for ChatView send paths.** `chat-view.component.ts:262,1437,1453,1479` injects `SESSION_START_GUARD` optionally and blocks resume one, resume all, and budget wrap-up before dispatch. It leaves resumable entries in place and displays the reason through the existing tab-scoped action banner. `chat-view.component.spec.ts:1300` covers blocked/allowed/token-absent resume and blocked budget. Feedback sender remains an open item below.
2. **M2 — done.** `compact-session-metrics.ts:105` accepts the tab's compaction timestamp and stops the finalized scan before older messages. Card `compact-session-card.component.ts:232` and details `canvas-session-details.component.ts:128` pass `lastCompactionAt`. `compact-session-metrics.spec.ts:114` covers a finalized post-compaction turn followed by an older todo.
3. **M3 — done.** `compact-session-metrics.ts:112` iterates live events without allocating an array.
4. **M4 — done.** `compact-session-metrics.ts:30` defines `sameGitState`; `session-git-stats.store.ts:296` skips equal writes; card `compact-session-card.component.ts:266` and details `canvas-session-details.component.ts:155` use computed equality. `session-git-stats.store.spec.ts:153` confirms unchanged counts preserve object identity.
5. **Style 2 — done.** `workspace-root.ts:2` holds root normalization and equality; `change-set.store.ts:24` and `session-git-stats.store.ts:17` use it. `workspace-root.spec.ts:1` covers slash and case behavior; the existing ChangeSetStore suite passed as part of the chat project suite.
6. **Style 3 + m3 — done.** `compact-session-metrics.ts:47,55` exports shared todo/git titles, distinguishing unavailable from failed. Activity `compact-session-activity.component.ts:806,834` and details `canvas-session-details.component.ts:135,158` consume them. Barrel `chat-ui/src/index.ts:53` exports them; metrics and canvas detail specs cover wording.
7. **Minors — done.** `canvas-session-details.component.ts:149` calls the required tab lookup directly; the panel mock was repaired at `canvas-detail-panel.component.spec.ts:56`. `session-context.token.ts:56` names `SessionStartGuard`, exported from `chat/src/index.ts:41`. `session-git-stats.store.ts:19` uses `LOG_PREFIX`.

## Checks

- Focused `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: chat-view 80/80; git store 12/12; workspace-root 1/1; metrics 8/8; canvas details 5/5; canvas detail panel 1/1. All pass. The panel test initially failed with its incomplete mock and passed after repair.
- Project `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: chat-ui pass, chat pass, canvas 26 suites / 322 tests pass after the panel mock repair. The tail-filtered chat-ui/chat output did not retain their aggregate counts.
- `npx nx typecheck <project> --parallel=1 --skip-nx-cache`: chat-ui, chat, canvas pass. An existing NG8107 warning in the untouched peer-session-send dialog appeared for chat/canvas.
- `npx nx lint <project> --parallel=1 --skip-nx-cache`: chat-ui pass (7 warnings), chat pass (37 warnings), canvas pass (13 warnings). No errors.
- Prettier was run on every changed file, including the repaired panel spec.
- Line counts: `chat-view.component.ts` 1877 before → 1897 after; `compact-session-activity.component.ts` 1290 before → 1279 after. Before counts are reconstructed from the edit hunks; after counts were measured from the files.

## Decisions

- `lastCompactionAt` is the authoritative boundary already stamped on tabs. The selector returns unknown when its backward scan reaches a message older than that boundary. It remains conservative for turns whose message timestamps precede compaction.
- The budget action is guarded in ChatView, where the optional token is available; the budget service API is unchanged.
- `gitTitle` uses `Git changes unavailable` for unavailable and `Could not read git status` for failed; both views now use the same wording.

## Open items

- `libs/frontend/chat/src/lib/services/agent-feedback/chat-agent-feedback-sender.service.ts:50` dispatches from the application-level `AGENT_FEEDBACK_SENDER` provider (`apps/ptah-extension-webview/src/app/app.config.ts:239`), not a ChatView/component call site that can read the tile guard. Guarding that path requires a tab-aware dispatch boundary or provider API change and was outside the scoped fix.
- The tab timestamp cutoff is conservative if a post-compaction TodoWrite shares a finalized message timestamp from before compaction; no separate persisted todo boundary exists in `ExecutionNode`. The selector shows unknown in that case instead of reviving an older list.
