# Decisions — TASK_2026_863

| # | Decision | Evidence / source |
|---|----------|-------------------|
| 1 | Type BUGFIX, depth Partial; no PM/architect/designer phase. | Request is a known small change plus one status bug; no new surface. |
| 2 | Implementer: codex lane. | Only lane with confirmed room; user prefers non-Claude lanes. |
| 3 | "Delete the streamed text" means remove the live streamed-text preview line from the session tile only (not from the chat view). | User text + screenshot. |
| 5 | Independent code-logic reviewer: grok lane (different family from codex). | User reported grok weekly limit reset at 17:40 UTC. |
| 6 | Scope addition: active tile gets a tinted background (theme token, dark + light), border accent kept. Before/after screenshots (dark + light) required at completion. | User follow-up with screenshot. |
| 7 | Coordinator fixed 3 stale canvas specs (dense default, removed holdText binding). | canvas:test failures after batch A. |
| 8 | Grok review REVISE (blocking: hidden-tail suppresses terminal turn_state). Fix round on root cause in stream coordinator, revert card-side override. | code-logic-review.md. |
| 9 | Rebase onto current main before push (branch base dd380c449 is behind main). | Review "Decisions" note. |
| 10 | Scope addition (user): lane-event (agent report) card narrower: `w-4/5` → `w-3/5 max-w-[36rem]`, min width kept. Done by coordinator (trivial class edit), spec updated, lane-event-row tests pass. | User follow-up with screenshot. |
| 11 | Grok re-review r1 APPROVED 8/10 (0 blocking, 0 serious). Two Moderate items deferred to a later task (no lane-config break, no data loss): status-only write leaves spinner/terminalReason stale until reveal (failed turn shows Finished, not error); revision-floor heal waits for focus. Missing real scheduler+applier integration test recorded as coverage gap. | code-logic-review-r1.md; lean rule 4. |
| 4 | "Compacted as default" means the tile's compact mode is the initial/default state; the user can still expand if a toggle exists. | User text; keep capability, change default only. |
