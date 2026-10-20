# HANDOFF - TASK_2026_708_bff3 (voice canvas life)

Written 2026-10-20 by the orchestrator session (Claude). Read this first, then `context.md`.

## Goal

Two follow-ups to TASK_2026_707 (PR #782) on the Command Center Voice canvas
(`libs/frontend/command-center`, Nx project `command-center`):

1. Background dot twinkle: 12 of the 48 backdrop dots brighten and dim, as an overlay, only in
   painted frames while the renderer is `active` (no new frames, none under reduced motion).
2. Delegation pulses: when a worker node becomes `starting`/`running`, a bright head travels along
   the drawn link owner -> worker (bezier, or straight line for a matching tether), then a ring
   expands at the worker. One per link, cap 6, cleared on theme / reducedMotion change (both
   directions), `setHidden(true)`, `destroy`, and when the worker or owner leaves the layout.

Binding user rules: `context.md` "Binding decisions". User-approved spec:
`implementation-plan.md` (revision 2).

## Where

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\voice-canvas-life`
- Branch: `feat/voice-canvas-life` from `main` at `a745b9692`. `node_modules` is a junction to the
  main checkout.
- Task folder: `D:\projects\ptah-extension\.claude-worktrees\voice-canvas-life\.ptah\specs\TASK_2026_708_bff3`

## Done

| Step | Result |
| --- | --- |
| Plan rev 1 -> codex review REVISE (4 findings) -> rev 2 -> codex re-review APPROVED | `implementation-plan-review.md` |
| Gate 2: user APPROVED revision 2 | `decisions.md` row 10 |
| Batch 1 implemented by a codex lane | `batch-1-report.md` |
| Code-logic review (Anthropic subagent vs codex implementer): APPROVED 8/10 | `code-logic-review.md` |
| One codex fix round (findings 1, 2, 3, 5, 6) + scoped re-review APPROVED 8.5/10 | `batch-fix-report.md`, `code-logic-review.md` "Re-review" |
| `npx nx typecheck command-center --parallel=1` | PASS |
| `npx nx lint command-center --parallel=1` | PASS |
| `npx nx test command-center --parallel=1 --maxWorkers=2` | PASS, 51 suites / 605 tests (one "worker failed to exit gracefully" warning, no failures) |
| Prettier check on new files; grep for any / ts-ignore / as unknown as / console / Date.now / performance.now in new files | clean |

## State of the work tree

NOTHING IS COMMITTED. Branch `feat/voice-canvas-life` is local-only, with no commits and no PR.
Uncommitted changes (all under `libs/frontend/command-center/src/lib/scene/`):

- NEW `command-scene-twinkle.ts`, `command-scene-twinkle.spec.ts`
- NEW `command-scene-pulses.ts`, `command-scene-pulses.spec.ts`
- M `command-scene-decoration.ts` (`dots` -> exported `SCENE_DOTS`; Prettier reflowed 5 lines in
  `drawRootGlow`, formatting only)
- M `command-scene-renderer.ts` (wiring only, +21 lines)
- M `command-scene-renderer.spec.ts` (+169 lines of focused tests)
- untracked task folder `.ptah/specs/TASK_2026_708_bff3/`

No subagent or CLI lane is running.

## Open items and decisions

- Minor, recorded, not fixed: the mid-flight bezier test in `command-scene-pulses.spec.ts`
  samples t = 0.5, which equals the straight-line midpoint, so it does not prove the curve
  (`decisions.md` row 13). Optional later fix: sample at progress 0.25.
- Accepted risk (decision 9): a worker first seen in the layout already `running` (for example
  from overflow) pulses once.
- Light-theme twinkle may be faint (peak alpha 0.4 on `#625d73`). Tune only after screenshots.
- The real-profile check (live microphone, real delegated work) needs the user's permission first.
- All decisions: `decisions.md` rows 1-13.

## Next steps (in order)

Peer coordination first: before each heavy job (nx, jest, Electron build, push), run `ListAgents`,
announce to every peer, and wait for "checks: free" / "Electron: free" from whoever holds the
machine. Send "checks: free" to the next peer when done. At handoff time the queue after this task
was analytics 707 (session `ptah-ptah-extension-analytics-e5d8890000ebk2qkufgly0f`), then
skills-epic 662 (`ptah-ptah-extension-skills-epic-v7-ab908d0000ebk2qkufgly0h`). Run every command
from the worktree.

1. Degradation audit (must be <= 291, the main baseline):
   `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1`
2. `npx nx typecheck ptah-extension-webview --parallel=1`
3. Electron visual check (Electron first):
   - Before screenshots must come from `main` (base `a745b9692`). Build them from the main checkout
     or a clean worktree of `main`; do not stash in this worktree.
   - `NX_DAEMON=false npx nx build-dev ptah-electron --parallel=1`, then `copy-renderer-dev`.
   - Launch `dist/apps/ptah-electron/main.mjs` with Playwright `_electron`, remote debugging port
     9334 only, throwaway HOME/USERPROFILE/APPDATA/LOCALAPPDATA, `--user-data-dir` and
     `PTAH_DB_PATH` under `%TEMP%`, and an empty temp folder as the last positional argument.
   - Voice tab -> "New session". Renderer:
     `ng.getComponent(document.querySelector('ptah-command-scene')).renderer`. Drive
     `setVoice`/`setSnapshot`; inject a fake child node (first idle, then `starting`) into a
     snapshot to trigger a pulse.
   - Screenshots: dark, light, reduced motion (twinkle and pulse mid-flight + arrival ring). Save
     under `screenshots/` in the task folder and write `visual-review.md`.
   - Close with `taskkill /T /F /PID <pid>` and confirm port 9334 is free.
4. Commit in the foreground. Read `.commitlintrc.json` first. Subject <= 72 chars, body lines
   wrapped at 72. Two commits:
   - `feat(command-center): twinkle backdrop dots and delegation pulses` (code + specs)
   - `docs(task-specs): TASK_2026_708 voice canvas life plan and reviews` (task folder)
   End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
5. Push in the background with the PR chained (pre-push runs di-lint and the Electron
   validate-deps gate):
   `git push -u origin feat/voice-canvas-life && gh pr create --base main --title "..." --body "..."`
   Body: `## Summary` + `## Test plan`, ending with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Report the PR link.
6. Edit the `status:` line of `task.md` to `in_review`. Ask the user before removing the worktree
   after merge.
