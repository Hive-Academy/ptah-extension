# Phase 5 — Composer responsiveness / CLS follow-up

## Built

- Added cached, 50 ms trailing projection for `@` file and `/` command trigger
  suggestions. The ordinary composer draft signal remains synchronous; only
  trigger-specific local searching/filtering and the remote file query are
  deferred to the trailing projection.
- Trigger activation remains immediate. The cache is refreshed after the async
  file/command catalog load, is bounded to 24 file-query entries, and pending
  work is cancelled on trigger close and component destroy.
- Added the single Phase 5 rollback flag,
  `COMPOSER_TRIGGER_CACHE_ENABLED`. It defaults to `true`; setting it to
  `false` restores immediate trigger projection without changing draft or
  stream state.
- The Electron global-action cluster width reservation required by this phase
  was already present in the stacked baseline (`f23c9fc3ba`): a non-shrinking
  `min-w-[13rem]` cluster and permanent 32 px back-button slot. No second
  reservation mechanism was introduced.

## Files changed

- `libs/frontend/chat/src/lib/services/composer-trigger-scheduler.ts` (new)
- `libs/frontend/chat/src/lib/services/index.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`
- `.ptah/specs/TASK_2026_STREAMING_ARCH/phase-5-report.md`

## Tests added / exercised

- Normal composer typing updates only the draft and does not invoke suggestion
  work.
- Trigger typing coalesces several keystrokes into one latest-query local and
  remote projection; returning to a prior query reuses its cached result.
- The rollback flag restores immediate trigger projection.
- The existing focused Electron shell regression confirms the reserved,
  non-shrinking global-actions cluster and fixed back slot, so conditional UI
  cannot shift the tab strip.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts src/lib/components/molecules/chat-input/chat-input.component.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 69 tests. The suite emits existing mocked-model-service console warnings.
- `npx jest -c libs/frontend/chat/jest.config.ts src/lib/components/templates/electron-shell.activity-placement.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 5 tests.
- `npx nx typecheck @ptah-extension/chat --parallel=1` — passed. One pre-existing Angular NG8107 optional-chain warning in `peer-session-send-dialog.component.ts`; Nx Cloud organization reporting was disabled and did not affect the result.
- `npx nx lint @ptah-extension/chat` — passed with 34 warnings and no errors (including existing project max-lines/non-null warnings); Nx Cloud reporting was disabled and did not affect the result.
- `git diff --check` — passed.

During implementation, two scoped typecheck attempts caught strict
`SuggestionItem` union/readonly errors in the new adapter. They were corrected
before the final passing typecheck above.

## Decisions

- The debounce is limited to trigger projection. Normal text entry must remain
  immediately reflected in the textarea/draft, particularly while a stream is
  rendering.
- The 50 ms delay matches the architecture's visible-stream cadence while
  avoiding a costly local file search for every trigger keystroke.
- The title-bar reservation stays separate from streaming state and uses the
  baseline's fixed-width layout contract; Phase 5 does not add a stream-driven
  layout observer or a second action-width calculation.

## Deviations / remaining measurement

- No Phase 6 zoneless/provider work was introduced.
- A representative active-stream browser INP trace (p75 <=200 ms and no
  interaction >500 ms) was not run here: this task prohibits build, serve and
  e2e targets, and this worktree has no standalone active-stream performance
  harness. The focused unit seams establish the scheduling behavior, but the
  approved release-gate trace remains a release-validation activity.
