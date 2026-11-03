# Context — TASK_2026_863

## User request (verbatim)

"in our sessions tile we should leave the compacted as default and we should delete the streamed
text that we show there is confusing, also it needs to be active as sometimes i open a session in
running and i have to view it first before it moved to the done session so it seems like it
doesn't work until i make it active"

A screenshot showed the sidebar groups "Running" and "Finished". Each tile shows a title, a status
chip, a streamed-text line ("Now I will send the updated fix prompt to t..."), a "+N" chip, agent/CLI/ctx
chips and a diff stat.

## Classification

- Type: BUGFIX (with a small UI simplification). Depth: Partial.
- Flow: Codex lane investigates + implements → independent code-logic review → verify → PR.
- No new UI surface; before/after screenshots are optional evidence, not a prototype gate.

## Gate 0.1

- Preference: user global CLAUDE.md — delegate heavily to non-Claude CLI lanes.
- Lanes enabled. Approval mode: lane-review.
- ptah_agent_list: codex (confirmed room, weekly 41%), antigravity (limit unknown),
  opencode / grok / Glm / kimi at limit; copilot and claude disabled.

## Worktree

`D:/projects/ptah-extension/.claude-worktrees/session-tile-compact-default`, branch
`fix/session-tile-compact-default`.
