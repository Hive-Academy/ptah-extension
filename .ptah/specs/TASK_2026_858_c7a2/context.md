# Context

- Worktree: D:\projects\ptah-extension\.claude-worktrees\chat-message-stagger (branch feat/chat-message-stagger, base 0f0f2a8ca)
- Type: FEATURE, depth Partial (known requirements, user supplied). Prior: TASK_2026_motion_presets (PR #880).
- Gate 0.1: user preference explicit in request: codex lanes implement, Claude subagents review. Max 3 lanes, 2 revise rounds.
- Approval mode: user (user asked to approve the plan).
- Lane rows (2026-11-01): codex installed, near limit (Weekly 92%, resets 2026-11-04). kimi code available (unknown limit). opencode, grok, Glm AT LIMIT. claude/copilot disabled.
- Plan author: software-architect subagent (in-process). Plan reviewer: kimi code lane (cross-side), fallback: user review only.
- 2026-11-01 19:18Z: kimi code lane (pc-10e5a6b5…, family kimi-code) hit API 429 rate limit on plan review; reset unknown -> skipped for this run. Plan review fallback: antigravity lane.
- 2026-11-01 19:19Z: antigravity lane hit quota 429 (resets in ~104h). Codex (92% weekly) reserved for implementation. Plan review: same-side independent Claude code-logic-reviewer subagent (reason: every opposite-side lane except codex at limit; codex budget kept for B1-B3). Gate 2 stays with the user.
- 2026-11-01: Gate 2 APPROVED by user. Implementation: codex lanes B1 -> B2 -> B3.
- Visual review 1: FAIL (D1 reply double entry on finalize id swap; D2 stagger never shows because every load is a tab edge).
- User decision (D2): option 2 "Always stagger on open": every session open / history load staggers; pane-switch becomes plain opacity crossfade (no transform) so motions do not stack; switch to already-loaded tab = crossfade only.
- Code-logic review (claude vs codex): APPROVED 7/10, 4 Moderate (not fixed under one-fix-round rule; listed as later work).
- Fix round 1 -> codex lane.
