# Context - TASK_2026_697_bae4

## User request (2026-10-18)

> for the polish idea, i think we if we merged both of the agents reviews we will have a more
> beautiful view

> all of those prs is merged now ... lets work in the new enhancements from grok and glm combined

Base: `main` `7267c1f4c` (contains #753 provider marks, #757 start view, #760 proposals,
#762 restored-session provider id). Previous session handoff: `previous-session-handoff.md`.

## Inputs

- `.ptah/specs/TASK_2026_696_9529/proposal-grok.md` (14 ideas; strong on performance and measured
  contrast in `anubis` / `anubis-light`).
- `.ptah/specs/TASK_2026_696_9529/proposal-glm.md` (13 ideas; strong on visual effects).

## Rules

- Build on what exists. Keep the canvas radial layout and motion (the user prefers them; the
  SVG/DOM redesign TASK_2026_689 was reverted). No new framework, no from-scratch scene.
- Every idea reuses a real component/store/stat (file:line) or is marked NEW.
- Canvas: resolve theme inks once per theme change (no CSS variable reads in `draw`), cache
  sprites and gradients, DPR cap 2, reduced-motion gates, rAF only while something animates,
  frame budget under ~2 ms of extra work.
- Text contrast: WCAG AA 4.5:1; state graphics 3:1, in both themes. No `text-base-content/NN`
  (the `no-alpha-base-content` spec bans it).
- Implementation in phases (Phase 1 quick wins first), each phase reviewed.

## User decision (2026-10-18)

The orchestrator reviewed `implementation-plan.md` (18 merged ideas V01-V18, spot-checked against
the code) and showed the merged list. The user chose **all 3 phases**: Phase 1, then 2, then 3 on
this branch, one code-logic review per phase, one PR at the end with dark + light before/after
screenshots. After that, the #762 visual check (restored-session provider mark, one short paid
turn approved).
