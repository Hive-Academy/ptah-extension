# TASK_2026_707_b4e1 - Voice ripples from the Ptah sphere

## Request

User (2026-10-19), after reviewing ngxui.com (`@omnedia/ngx-*`): "a good one with pulses".
Orchestrator proposal, accepted by the user ("I do agree"): voice-driven ripples from the Ptah
root sphere on the Command Center Voice page, drawn in our own Canvas 2D renderer. Follow-up to
TASK_2026_706_f625 (PR #776, merged).

## Type and depth

FEATURE, Partial workflow (one lib, 2-4 files): plan -> user approval -> codex lane implements
-> orchestrator checks -> Anthropic `code-logic-reviewer` -> one fix round -> Electron check on
port 9334 -> commit, push, PR.

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/voice-ripples`, branch
  `feat/voice-ripples` from `main` @ `d184d87ec`. `node_modules` is a junction to the main
  checkout (remove with `cmd //c rmdir node_modules` before `git worktree remove`).
- Lib: `libs/frontend/command-center` (Nx project `command-center`). Host for the visual check:
  Electron.

## Decisions (binding)

- R1 No ngxui dependency. `@omnedia/ngx-*` peers on Angular ^21 (we run 22.1.7), runs its own
  rAF loop, ignores `prefers-reduced-motion`, hardcodes white. Ideas only (MIT).
- R2 Replace, do not add. `drawVoiceRing` (`command-scene-status.ts:161-179`) already draws two
  time-looped rings while speaking. The ripple emitter replaces that block; the static voice
  ring itself (state colour, dash, level pulse, thinking arc) stays unchanged.
- R3 Ripples are driven by the voice level we already receive (`inputLevel` while listening,
  `outputLevel` while speaking), not by a fixed loop.
- R4 Ripples only exist in `LIVE_VOICE_STATES` (listening, thinking, speaking). Those states
  already paint every frame when reduced motion is off, so the ~30 fps ambient cap and the
  off-screen pause are untouched. On a voice-state, reduced-motion or theme change the ripple
  list is cleared synchronously in the setter (no fade tail that would keep the loop live).
- R5 Reduced motion: no ripples at all (the existing static voice ring already shows state).
- R6 New code lives in a new file `scene/command-scene-ripples.ts`; the renderer (625 lines)
  only gains wiring. No new public exports from the lib.
- R7 Colours come from `snapshot.inks` (listening `done`, speaking `need`, thinking `run`), so
  dark and light themes both work. No `text-base-content/NN` (not relevant to canvas, kept as
  the standing rule).
- Carried from TASK_2026_706 context E6: N1 text contracts, D7 and D9 stay binding.
