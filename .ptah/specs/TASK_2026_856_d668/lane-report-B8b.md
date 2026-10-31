# B8b lane report

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts`: Both run label and lane stats now derive elapsed time from `injectWallClock('second', () => this.live())` and the record's absolute timestamps. Removed both `monitor.tick()` reads.
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts`: Uses a fixed wall clock and checks elapsed time across a remount and clock update without a monitor tick.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`: Uses the shared wall clock while streaming or a lane is running, removes the card-owned interval, and keeps a mount-time floor when the shared clock has been idle. Context percentage is recomputed with `trustedContextWindow` and `contextFillPercent`; unknown or mismatched capacity yields `null`.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`: Covers shared interval acquisition and release, remount elapsed time, trusted F2 = 65%, and resumed unknown-window F6 = null / `Context —`.

## Lane check

- Final run (third permitted run): `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="subagent-lane.component|compact-session-card" | Select-Object -Last 60` — passed, 2 scoped suites (79 tests). The first two runs failed on test expectations fixed before the final run.
- `git diff --check` on the four scoped source/spec files — passed.
- Scoped Ptah diagnostics: no new source errors. Three existing errors remain in `compact-session-card.component.spec.ts` at the branded tab/session ID fixture and a compaction signal inference; those lines predate this lane. Sibling project diagnostics also report existing errors outside scope.

## Decisions

- The card accepts only a capacity trusted for the displayed model and matching `contextWindow`, then recomputes the percentage from `contextUsed`. It never trusts a persisted `contextPercent: 0` placeholder.
- An unknown context window renders `Context —` in the activity card. This satisfies the missing-data rule without changing the child component outside scope.
- The shared clock may be idle before a card mounts, so the card uses its absolute mount time as a floor for the first elapsed reading. No card interval remains.
- Applied the local `.claude/skills/angular-frontend-patterns/SKILL.md`. A CLI Skill invocation tool was unavailable, so the file was read directly.

## Not done

- No browser screenshot: the scope permits only these four TypeScript files and this report, and the task forbids starting an app server. The Jest component render was inspected through DOM assertions for the context cue.
- No build, workspace-wide verification, commit, or changes to other lanes' files.
