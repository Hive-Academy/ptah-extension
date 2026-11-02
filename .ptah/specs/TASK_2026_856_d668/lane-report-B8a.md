# B8a transcript clocks

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`: use `injectWallClock('second', () => hasLiveTurn() && workActive())` for the existing `liveNow` binding.
- `libs/frontend/chat/src/lib/components/organisms/transcript/lane-transcript.component.ts`: use `injectWallClock('second', () => liveTurns().size > 0)` for the existing `now` binding; remove the `AgentMonitorStore` tick read.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`: advance fake time through `WallClockService` and verify the clock stops when the transcript becomes inactive.
- `libs/frontend/chat/src/lib/components/organisms/transcript/lane-transcript.component.spec.ts`: drive a shared-clock test double, verify `Working · 2s` changes to `Working · 3s`, and verify release on completion.
- Deleted `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-live-clock.ts` after checking `libs` and `apps` for importers. The only importer was the scoped chat component.

## Test result

- Requested one-time lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-transcript.component|lane-transcript.component"` — **failed**, 52 passed / 1 failed. The new lane fixture initially had no user turn start timestamp.
- After correcting the fixture: direct `npx jest --testPathPatterns=lane-transcript.component.spec.ts --coverage=false --maxWorkers=2` — **passed**, 6/6 tests. The chat suite passed in the one-time lane check. The combined lane check was not rerun, as requested.
- `git diff --check` passed for the five scoped source files. A scoped search found no remaining `TranscriptLiveClock`, `transcript-live-clock`, or `monitor.tick` references in the four component/spec files; the clock file is absent.
- Scoped Ptah TypeScript diagnostics were unavailable after two 45-second timeouts. No project-wide typecheck or lint was run.

## Decisions

- **Decision:** Keep the existing active predicates and template bindings while replacing both time sources with the root `injectWallClock` second cadence. **Options:** root clock with the existing live gates; a component-owned interval; an always-active root subscription. **Evidence:** the plan specifies these gates, `liveTurns` exists in the lane component, and the final focused tests verify elapsed values and release. **Reversible:** yes, through a later source edit.
- **Decision:** Give the lane elapsed test a timed user event before the assistant tool. **Options:** timed user event; assistant start time alone. **Evidence:** `draftTurns` derives `startTs` from user messages, and the assistant-only fixture rendered `Working` without a duration. **Reversible:** yes, test-only.

## Not done

- The requested combined check did not pass on its single run and was not rerun after the fixture fix. The focused lane spec passed afterward; the chat spec had passed in the combined run.
- TypeScript diagnostics could not complete within the Ptah tool timeout.
- CLI skill invocation was unavailable. I read and applied the workspace `angular-frontend-patterns` skill directly after skill search returned no invocable match.
- Concurrent changes in `libs/backend/agent-sdk`, `libs/frontend/chat-state`, `libs/frontend/chat-ui`, and `libs/shared` were present in the worktree. I did not make or revert them.
