# Batch 5 report

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/index.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/index.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-5-report.md`

## Tests per requirement

- Synthetic fake-spawner tests cover fixed argv, selected binary, environment stripping, browser and device transcripts, URL rejection, no URL, browser-open false or throw, process exit, selection failure, cancellation in the PID tick, disposal during selection, and kill-tree rejection.
- No real CLI process is launched in the spec.
- `ptah_get_diagnostics` initially returned 0 errors before the spec was added. Two scoped checks after the spec was added timed out after 45 seconds with all four source files unchecked; a further two-file retry also timed out. They did not report a pass or errors.
- Jest, Nx and `npm run verify` were not run in this lane, per the caller's explicit sandbox rule. The orchestrator owns `npm run verify -- -p @ptah-extension/auth-providers`.

## Revision 1 coverage

- R1-1: fixed default `login` and device `login --device-auth`; both call `openExternal` once, with `browserOpened` set from its result or false on throw.
- R1-2: Linux/BSD child environment uses the first available `/usr/bin/true` or `/bin/true`; macOS/Windows retain host `BROWSER`.
- R1-3: extraction walks HTTPS candidates until the first URL meeting protocol, userinfo and 4096-character checks; validation repeats immediately before opening.
- R1-4: cancellation settles `cancelled` synchronously, including in the PID resolution tick; `start()` reads the current state after awaits.
- R1-5: `dispose()` cancels startup or kills the active child tree and awaits kill completion; failure falls back to `child.kill`, and terminal state is emitted once.

## Decisions

- Used the existing spawner handle and `whenSpawned` contract; selection errors map to `unavailable`, whereas spawn errors map to `spawn-failed`. Evidence: plan Component 3 and `IProcessSpawner` interface. Reversible: yes.
- Settled cancellation before awaiting tree kill so a late close cannot publish success. Evidence: R1-4 and R1-5 race requirements. Reversible: yes.
- Kept the service as a factory-style class with a dependency object, matching Kimi and the plan. Reversible: yes.

## Risks

- Full project verification remains with the orchestrator; no Nx or Jest command was run here.
- Scoped TypeScript diagnostics remained unavailable due to the tool timeout; the orchestrator's project check must resolve this verification gap.
