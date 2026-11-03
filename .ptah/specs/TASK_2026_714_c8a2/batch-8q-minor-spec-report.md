## Change

Added `snapshots the last sent level, not the opening level, for an idle notification after a level change` in `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1685-1715`.

## Why it fails without :530

1. Open with `plan`, so `wirePermissionLevel` starts at `plan`.
2. Stage `ask` and start a user turn; its `turn/start` frame sends the `ask` policy. The assignment at `codex-context.ts:530` records `ask` as the last sent level.
3. Complete that turn, then stage `plan`. The idle getter shows staged `plan`, while the wire level remains `ask`.
4. An idle `turn/started` notification snapshots the wire level, so the getter must show `ask`. Removing the assignment leaves the wire level at opening `plan`, making the final assertion fail.

## Decisions

- Reused the existing plan policy and fingerprint construction, fake child, and notification pattern.
- Asserted the `turn/start` frame carries the `ask` policy before checking the later snapshot.
- No invocable matching skill was available through this lane's tool list; the skill search returned only skills marked `not-invocable`.

## Not done

- Did not run verification, tests, lint, typecheck, build, or Nx commands, as instructed. No mutation test was run.
- Did not change `codex-context.ts` or any other source file.
