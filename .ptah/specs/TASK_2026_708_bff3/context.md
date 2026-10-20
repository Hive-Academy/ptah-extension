# Task Context - TASK_2026_708_bff3

## User Request

Two follow-ups to TASK_2026_707 (PR #782, merged) on the Ptah Command Center Voice page canvas
(`libs/frontend/command-center`, Nx project `command-center`):

1. Background dot twinkle: a few background dots slowly brighten and dim (idea from ngxui
   `starry-sky`, MIT; do NOT add any @omnedia/ngx-* dependency).
2. Delegation link pulses: when Ptah hands work to an agent, a small bright pulse travels along
   the link from owner to worker, and a short ring appears at the worker node when it arrives.
   Builds on the flowing links from PR #776.

Full request text: see the `/orchestrate` arguments of the session that created this folder.

## Binding decisions (user-requested)

- Canvas 2D only, no new dependency. Theme colours from `snapshot.inks` or theme-aware values;
  check dark and light.
- Keep the ~30 fps ambient frame cap and the off-screen pause (`setHidden`). The twinkle runs only
  inside the existing capped ambient frames and only while `active` is true. With no work and an
  idle voice, the scene stays as idle as today (no new frames).
- The backdrop stays cached. Twinkling dots are a light per-frame overlay of a small subset
  (8-16 dots), never a backdrop rebuild.
- Reduced motion: no twinkle, no traveling pulses. Static links unchanged.
- Pulses: at most one per link at a time, a global cap, pruning by age, cleared on theme and
  reducedMotion change and when the node leaves the layout.
- Follow the `VoiceRippleEmitter` pattern (`scene/command-scene-ripples.ts`): pure class with
  `update(now)` / `draw()`, cap, age pruning, at most one emit per frame, synchronous `clear()`
  in renderer setters, rAF time only, no burst after a hidden pause.
- New logic in NEW files; the renderer (~640 lines) only gets wiring.
- Strict TS (no any, @ts-ignore, `as unknown as`), no console.*, small files, no new lib exports.
- Plan reviewed by a codex lane (opposite side) and approved by the user before implementation.
- Codex lanes implement; Anthropic code-logic-reviewer per phase; one codex fix round.
- Memory-safe checks only, one at a time, from the worktree; degradation audit must not exceed
  the main baseline (291).
- Electron visual check (dark, light, reduced motion) on port 9334 with a throwaway profile.
  The real-profile check needs the user's approval first.

## Task Type

FEATURE

## Complexity

Medium

## Strategy

FEATURE, Partial depth: orchestrator plan (requirements are given in full by the user, so no PM
phase) -> codex plan review -> user Gate 2 -> one codex implementation batch -> scoped checks ->
code-logic-reviewer (Anthropic) -> one codex fix round -> Electron visual check -> commit, PR.
No designer or prototype: the change adds no UI surface; it changes an existing canvas, so
completion needs before/after Electron screenshots (dark + light).

## CLI Lanes

Gate 0.1: lanes `enabled` (user request and the temporary CLAUDE.md "CLI lanes first" rule).
Approval mode for Gate 2: `user` (the user asked to approve the plan).
`ptah_agent_list` at start: codex installed, confirmed room (weekly 63%, reset 2026-10-24);
opencode near limit (monthly 93%); antigravity, grok, Glm unknown; copilot disabled;
cursor, pi not installed. No lane AT LIMIT.

## Worktree

`D:\projects\ptah-extension\.claude-worktrees\voice-canvas-life`, branch `feat/voice-canvas-life`
from `main` at a745b9692, `node_modules` junction to the main checkout.
