# B2c implementation report

## Summary

Wired the compact card to lane rows, priority callouts, permission responses, lane navigation and a conditional elapsed clock. The B1 sampler is untouched.

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` — card wiring.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts` — regression coverage.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` — context percentage input and metrics display.
- `.ptah/specs/TASK_2026_629_c0b3/lane-B2c-report.md` — this report.

## Check results

- PASS — `npx nx test @ptah-extension/chat --testFile=compact-session-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 26 tests.
- PASS — `npx nx test @ptah-extension/chat-ui --testFile=compact-session-activity.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 46 tests.
- PASS — `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`.
- PASS — `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`.
- PASS — `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: 0 errors, 35 warnings.
- PASS — `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: 0 errors, 8 warnings.
- `ptah_get_diagnostics` was unavailable after its 45 s scoped compiler timeout; the Nx typechecks above passed.

## Decisions

| Decision                                               | Options                                             | Evidence                                                                                                                 | Reversible |
| ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Use `agentOrigin` for branch and elapsed where present | Use `agentOrigin`; invent a session start           | `TabState.agentOrigin` includes branch and startedAt; ordinary tabs have neither.                                        | Yes        |
| Add a context percent input in `chat-ui`               | Leave known context data out; pass a separate input | `TabState.liveModelStats.contextPercent` exists, but activity had no input. This is the only source file-list expansion. | Yes        |
| Hide Retry for terminal session errors                 | Show Retry; omit Retry                              | The current compact/full chat path has no session error retry action to invoke.                                          | Yes        |

## Open items

- Todo and git +/- figures have no public card-level signal. They would need session-scoped todo and git change snapshots from the host/store.
- Ordinary sessions have no branch/start timestamp on `TabState`; only child tabs have `agentOrigin.branch` and `agentOrigin.startedAt`. The card shows placeholders for other sessions.
- Phase A visual screenshot for two cards remains assigned to the phase review.
