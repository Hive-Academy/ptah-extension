# CI fix round 2

## Defect 1 — CI theme coverage

`libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready.fixtures.ts:37-41`: CI now selects `ptah-glass` and `ptah-glass-light` for both viewport sizes. This preserves dark/light coverage for the Ready visual captures, reduced-transparency captures, and contrast sweep while still omitting the Anubis pair in CI. Local runs retain all four themes. The comment now describes the actual selection instead of claiming every assertion is retained.

## Defect 2 — chat assertion

`apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:41-43`: after Back to chat, the spec checks that the onboarding shell is gone **and** the real `ptah-chat-view` component is visible. The selector is declared in `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:169`.

## Defect 3 — first-run reload

`apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:31-39`: after Skip, the spec reloads, waits for the chat view to appear, and checks that `ready-claude-step` is absent. It reopens Home through the Setup menu before testing Back to chat. It makes no URL or post-reload Home assertion.

## Defect 4 — first-run logging

`libs/frontend/onboarding/src/lib/first-run/onboarding-first-run.tracker.ts:119-130`: a failed URL parse now logs its cause through `LoggingService.warn` using the tracker context. The degradation marker is `reported`, matching the audit rule. The failed parse still leaves the first-run flag unmarked.

## Defect 5 — persisted flag poll

`apps/ptah-electron-e2e/src/specs/state.spec.ts:37-43`: `skipFirstRun` polls localStorage after reload until the `ptah.onboarding.v1` value contains `shownAt`, before the caller waits for a persistable route.

## Verification

- `npm run verify -- -t lint -p degradation-audit` — `NX   1 task: 1 succeeded` (exit 0).
- `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/webview-e2e-harness` — `NX   5 tasks: 5 succeeded` (exit 0).
- `npm run verify -- -t lint,typecheck -p ptah-electron-e2e` — `NX   2 tasks: 1 succeeded, 1 failed` (exit 1). Typecheck succeeded; lint failed only on the four accepted, pre-existing `no-restricted-syntax` errors in `src/specs/git-watcher.spec.ts:111,169,220,273`.
- `git diff --check` passed.

## Decisions

Kept the existing CI reduction across the four onboarding visual specs and changed only their shared theme selection. Used a rendered chat component selector as the readiness check after reload and after Back to chat. No e2e or application targets were run, as instructed. The worktree's other pre-existing uncommitted changes were left alone.
