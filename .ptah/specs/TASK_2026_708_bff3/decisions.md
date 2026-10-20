# Decisions - TASK_2026_708_bff3

| # | Stage | Decision | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| 1 | pre-flight | FEATURE, Partial depth, no PM (user gave full requirements), no designer (no new surface) | User request; orchestration SKILL flow rules | yes |
| 2 | Gate 0.1 | Lanes enabled, codex for plan review and implementation; Gate 2 approval mode `user` | User request; CLAUDE.md temporary lane rule; ptah_agent_list (codex confirmed room) | yes |
| 3 | plan | Twinkle is a stateless function; dot positions shared via a file-level `SCENE_DOTS` export from the decoration file | `command-scene-decoration.ts:3-7`; no burst possible with a stateless rAF-time function | yes |
| 4 | plan | Twinkle gated by `this.active` only (already excludes reduced motion and the idle single-root scene) | `command-scene-renderer.ts:183-186` | yes |
| 5 | plan | Pulse trigger = state transition into `starting`/`running`, detected inside `update(now)` against recorded states; first update after construct/clear seeds silently | User request (pattern of VoiceRippleEmitter, no burst after hidden pause) | yes |
| 6 | plan | Pulses also run along tethers (straight path) because tethers are owner -> worker links in the rect layout | `scene-layout.ts:554-571` | yes |
| 7 | plan | One implementation batch (both features need the renderer) | User request: "one batch if both need the renderer" | yes |
| 8 | Gate 2 r1 | Accept codex findings 1-4: observe every snapshot synchronously in setSnapshot (silent while hidden or reduced motion), drawn-link rule with tether fromId/toId match, save()/restore() in overlays, focused renderer tests | implementation-plan-review.md (revision 1) | yes |
| 9 | Gate 2 r1 | Keep: a never-observed worker that appears already live queues one pulse (it is the delegation itself; overflow first-entry is indistinguishable in the renderer, accepted false positive) | Renderer only receives the layout, not the projection (`command-scene-renderer.ts:25-39`) | yes |
| 10 | Gate 2 | User APPROVED implementation plan revision 2 | User reply 2026-10-20 | yes |
| 11 | Batch 1 | Implementation lane runs no tests; orchestrator runs all scoped checks itself, one at a time after peer coordination (5 peer sessions active) | CLAUDE.md memory rules; ListAgents | yes |
| 12 | Review | Code-logic review APPROVED 8/10 (Review family: anthropic reviewer vs codex implementer). One codex fix round takes findings 1, 2 (test strength of binding clears), 3, 5 (prettier) and 6; finding 4 stays as accepted by plan decision 9 | code-logic-review.md | yes |
| 13 | Re-review | Fix round APPROVED 8.5/10. Minor: mid-flight bezier test samples t=0.5 (equals straight midpoint) - recorded, not fixed (Minor rule) | code-logic-review.md re-review | yes |
