# Context - TASK_2026_700_dcce

## User request (2026-10-19)

> i feel like we can do more elevations and enhancements to our canvas and designs specially the
> surroundings and how the overall experience is built together, meaning i feel its a bit
> detached, very less icons used and not following our designs

The orchestrator showed the approved TASK_2026_678 prototype
(`.ptah/specs/TASK_2026_678_9083/prototype/command-center.html`, rendered states in
`C:/Users/abdal/AppData/Local/Temp/cc697/proto/`). The user chose **"Match prototype + app
style"**: bring the page to the prototype's look (header with brand tile, warm surroundings,
gold Ptah sphere with dotted voice halo and the plate under it, provider marks, icons on plates,
rows, states and controls, large rail with an action card, one dock bar) and align it with the
Chat and Tribunal pages. A designer first updates the prototype for the real app; the user
approves it (Gate 1.7) before any code.

## User target look (2026-10-19)

> something like that is awesome C:\Users\abdal\AppData\Local\Temp\cc697\proto

The rendered prototype states in that folder are the target look: `dark-idle.png`,
`dark-speaking.png`, `dark-approval.png`, `light-speaking.png`, `light-24-nodes.png`. The design
must stay close to them; deviations need a stated reason (real app fonts and theme tokens,
accessibility, or a capability in `parity-inventory.md`).

## Base

- Worktree `D:/projects/ptah-extension/.claude-worktrees/voice-prototype-align`, branch
  `feat/voice-prototype-align`, from `origin/main` `34095a98e` (contains PR #766, TASK_2026_697).

## Rules (carried from TASK_2026_678 / 697 and the user)

- Keep the Canvas 2D radial layout and motion. No 3D libraries. Lucide icons and GSAP allowed.
- Theme inks resolved once per theme change; cached sprites/gradients; DPR cap 2; rAF only while
  something animates; reduced-motion gates.
- Text contrast AA 4.5:1, state graphics 3:1, dark (`anubis`) and light (`anubis-light`).
  Never `text-base-content/NN` (the `no-alpha-base-content` spec bans it).
- Preserve every current capability (see `parity-inventory.md`); removals need user approval.
- Memory-safe checks only (`--parallel=1`, Jest `--maxWorkers=2`), one heavy check at a time.
- Electron visual check on port 9334 only, announced to peers.

## Gate 0.1

- Preference source: standing user rules (TASK_2026_697 handoff): codex lanes implement,
  Anthropic subagent reviews. Lanes `enabled`.
- Approval mode: **user** for Gate 1.7 (the user asked to approve the prototype before code).
  Gate 2 (plan): lane-review with notice.
- `ptah_agent_list` 2026-10-19: codex confirmed room (Weekly 26%); grok near limit (98%);
  opencode, Glm, antigravity unknown; none AT LIMIT.

## Scope addition (2026-10-19, user via peer session task-612-follow-up)

The user asked that the task also cover child sessions. Interpretation (confirm at Gate 1.7):
Ptah agent child sessions (`ptah_session_start` tabs linked by `parentSessionId`), which the
Command Center already projects as `kind: 'child'` nodes (`model/work-projection.ts:180`, silver
spheres). Design adds: child sphere and plate, owned lanes as satellites, rail rows with nested
owned work, selected card, no-tab `unknown` state, and
`{dark,light}-child-session.png`. Queued as turn 3 of revision lane cad58755.
`design-spec-review-r1.md` on disk is the peer session's review (same 3 Serious findings as
this session's reviewer, different IDs); it is kept as the round-1 review.
Correction (review r2): no open-tab/focus action for child nodes exists today; it is listed as a
proposed addition in `design-spec.md` for the user to approve at Gate 1.7.
Design review r2 (`design-spec-review-r2.md`): APPROVE, 0 Blocking, 0 Serious, 4 Moderate, 3 Minor.
