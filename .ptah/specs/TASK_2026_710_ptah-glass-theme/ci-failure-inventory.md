# PR #805 CI failure inventory

Head: f5a388d52fc65b1130cbbbc0b4c2a8f13c46adea.
Evidence: GitHub Actions logs, inspected 2026-10-22. No local checks run.

## Unit tests — run 39534276007

1. `libs/frontend/core/src/lib/services/theme.service.spec.ts:181`: theme-state test expects zero state writes, but accent initialization writes `ptah-accent: gold`. Keep the authoritative-theme assertion precise without rejecting independent accent initialization.
2. `apps/ptah-extension-webview/src/app/theme-boot-lists.spec.ts:82`: ACCENT expectation excludes gold. Gold must remain valid in persisted state so a stale non-default mirror cannot override it.

## Electron — run 39534276029

3. `apps/ptah-electron-e2e/src/specs/auto-updater.spec.ts:231`: state marker disappears. Received state contains only `ptahRoute` and `ptah-accent: gold`. Investigate initialization/state-write ordering. Preserve the test's persistence guarantee.
4. `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:138,166,199,227,241`: Open beside / Move down menu clicks fail. Board content intercepts pointer events.
5. `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:52`: same Open beside interception.
6. `apps/ptah-electron-e2e/src/specs/task-370-concurrent-session-isolation.spec.ts:109`: same Open beside interception.
7. `apps/ptah-electron-e2e/src/specs/git/git-rail-collapse.spec.ts:101`: requested dock size expects width >=699px, receives 695px. Check flex shrink and new glass gutters, not a wider tolerance.
8. `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts:65`: old default anubis expectation, actual intended ptah-glass.
9. `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts:128`: old count 34, actual 36 after new theme pair.
10. `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts:210`: test captures glass default tokens but switches back to anubis. Preserve deferred fetch/repaint/restoration coverage with the intended initial theme.

## Webview — run 39534276014

11. `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/lock-popover-stacking.e2e.spec.ts:271`: compact-tier lock popover sits below later cards. Hit testing reaches provider-card-open buttons.
12. `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts:79`: ADV-4 membership key activation click times out, followed by Search & Voice tab timeouts, both host modes. Trace glass containing/stacking contexts before changing test behavior.

## Constraints

Preserve C4 glass design, non-glass behavior, overlays, pane sizing, persistence, eager/deferred theme coverage. Do not disable tests, force clicks, or relax geometry assertions to hide failures.

One heavy check at a time across sessions. Peer PR #803 currently reserves the slot. Implementation lane has no local-check authorization.

Existing branch/worktree continues TASK_2026_710. Unrelated `.gitignore` modification stays untouched.
