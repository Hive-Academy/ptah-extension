# Batch 13 report

## Files written

- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-login.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-login.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-commands.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-sign-in.service.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-sign-in.service.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/index.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-13-report.md

## Evidence

- Task 13.1: `parseCodexLoginState` validates attempt, mode, status, optional values and HTTPS URL, and omits host `error`. `acceptsCodexLogin` checks attempt identity, phase rank, and terminal stickiness. `codexTerminalLoginCommand` selects installed command or POSIX-quoted bundled path; returns null for Windows, empty paths, and paths containing `"`. Parser/order/command specs cover these cases.
- Task 13.2: Root `CodexSignInService` handles `AUTH_CODEX_LOGIN_STATUS`; start responses pass through the same parser and acceptor as pushes. Four R1-4 races have fake-timer specs. No-state `success:false` yields local failed; cancelled remains a terminal information state. The service sets a 20 s nothing-seen timer, clears it on accepted states and destruction, uses a 15 s RPC timeout, refreshes auth after success, and is inert outside Electron.
- Task 13.3: Public core index exports Batch 12 ambient status, readiness and connection-target symbols, plus all Batch 13 symbols.
- Scoped `ptah_get_diagnostics` after the final edits: no diagnostics in the six changed core files. The same compiler pass reports 114 errors in sibling files, including existing auth-state and readiness specs; they are outside this batch's allowed edit scope.

## Risks

- R1-4: response state is authoritative; cancelled cannot be replaced by a late running response, and a no-state failure uses generic local failure copy. Tests cover all four listed orderings.
- D-14 no-command sentence: unsupported Windows and quoted-path cases return null; no bare command is offered for a bundled binary.
- Raw host output: parser drops `error`; service does not store CLI output.
- Stale attempt and final-state races: different attempt IDs are rejected while an attempt is current; a final state is sticky. A restart remembers the prior ID and rejects delayed pushes from that attempt until a new ID arrives.
- Nothing-seen timer: one timer field, reset on each accepted state, released on terminal state and `DestroyRef`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Export directly from core `index.ts` | change services barrel / direct exports | Scope permits only core `index.ts`; it already exports the services barrel | yes |
| Keep installed command as bare `codex login` | quote installed path / bare command | Design 5.4 explicitly shows `codex login` for installed selection; bundled selection needs path | yes |
| Ignore a prior attempt ID during explicit restart | accept all pushes while state null / reject prior ID | Plan requires stale attempt IDs dropped; host returns a fresh ID for restart | yes |

## Limitations

- Did not run Jest, Nx, `npm run verify`, build or application targets, as explicitly prohibited for this lane. Orchestrator must run `npm run verify -- -p @ptah-extension/core`.
- The scoped TypeScript diagnostic pass reports sibling errors outside the permitted files; no changes were made to those files.
