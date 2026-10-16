# Batch A2 fix round 1

## Design

Chose the synchronous alias design. `sessionKey()` changes only plain maps during render. `isOpen()` reads the signal and checks the real session key plus any pending aliases, so the open tile remains visible as soon as an ID arrives. The next `toggle()` or `setOpen()` moves pending entries into the real session key and clears the aliases.

## Changes

- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile-expansion.state.ts:27-77`: record pending aliases without signal writes during render; read aliases in `isOpen()`; migrate entries only from `setOpen()`.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile-expansion.state.spec.ts:17-30,75-108`: add a rendered OnPush TestBed host and update the migration assertion for event-path migration.

## Specs and verification

- `migrates an open tile when a null-ID host receives its session ID`: confirms immediate alias visibility and later migration to the real key.
- `renders an open pending tile after an ID arrives without writing during change detection`: opens while null, renders after ID assignment without throwing, checks an A-to-B switch stays closed, and closes the original tile through a click.
- Existing state specs, including separate null hosts and real-session isolation, remain green.
- Scoped Jest: 1 suite passed; 11 tests passed, 0 failed. Command used `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile-expansion.state.spec.ts --coverage=false --maxWorkers=1` with PowerShell `Select-Object -Last 30` for output (this shell has no `tail`). `git diff --check` passed for the two changed source/spec files.

## Decisions

- Kept the existing host API and all three component callers unchanged.
- Left earlier real-session entries intact when a host switches to another real ID.
- Used a plain alias map per view; only the event-handler write path mutates the signal.

## Not done

- No Nx targets, build, serve, e2e, or unrelated project tests were run, per scope.
