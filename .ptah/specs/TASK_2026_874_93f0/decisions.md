# Decisions — TASK_2026_874_93f0

1. Type BUGFIX, depth Partial, full auto (user request). Gate 0.1: lanes enabled
   (memory 01M4TTVS8HFP7FGCEX1RNSCXK0, lanes-first). Approval mode: lane-review.
2. Lane choice: grok for research and implementation (confirmed room). opencode, Glm, kimi
   at limit; copilot and claude disabled. Memory 01M6HJGPQP0JNJRDDW1KHCA824 conflicts about
   codex, so review goes to antigravity first; codex only as disclosed fallback.
3. Root cause of the plan tile symptom (research-report.md, orchestrator confirmed
   cli-detection.service.ts:150-163,289-293 and agent-rpc.handlers.ts:1258):
   `agent:detectClis` calls `invalidateCache()`, which nulls `detectionInFlight` while the
   `provider:getPlanLimits` scan runs. A second concurrent scan starts, and the first scan's
   `finally` can null the second promise. Doubled spawns push discovery past the 12 s deadline,
   and the welcome never reloads plan limits. The request scope is not the cause.
4. Fix design: in-flight dedupe with a generation counter. `invalidateCache()` keeps the
   in-flight promise (callers join it) but bumps a generation so a result from an older
   generation is not cached; `finally` clears only its own promise. Chosen over "never clear
   in-flight" because `agent:setConfig` must not cache a scan that started before a key change.
5. Welcome reloads plan limits on its clock while `loadError()` or `discoveryIncomplete`, and
   the plan ring shows `error` for a failed load instead of "no plan window".
6. `skillsSh:listInstalled` must not turn a thrown scan into `{ skills: [] }`, after a check of
   all its frontend callers.
8. Grok implementation lane failed twice at the ACP handshake (30 s, zero tool calls). In full
   auto mode, implementation moves to codex (only lane with confirmed room). This overrides the
   codex conflict in memory 01M6HJGPQP0JNJRDDW1KHCA824; the user can overturn it.
9. Review (code-logic-reviewer subagent, Claude family; lane fallback because antigravity and
   grok failed at handshake; weaker-evidence label because the orchestrator, also Claude,
   wrote the planRing guard and the refresh() fix). Serious "joins a stale scan after
   setConfig" fixed with generation-tagged joins plus `refresh()` for `agent:detectClis`.
   Moderate modelCache stale write fixed. Re-review APPROVED.
10. Follow-up (Moderate, deferred, no data loss): the welcome plan-limit retry runs every 30 s
    while discovery stays incomplete and resets the store's own 3-retry counter. Add a bound.
11. Scoped verify: lint and typecheck pass for all three projects; chat tests pass. Test
    failures in cli-agent-runtime (12) and rpc-handlers (30) are all in unchanged specs
    (real git, symlinks, Windows temp paths, process-spawn timeouts); no changed spec failed.
7. RecentWorkspacesStore: no change (read path re-reads on each welcome visit; no defect found).
