## Backend implementation — `TASK_2026_597_ab22`, batch 44

**Tasks completed**: 44.1 — frontmatter `disallowedTools` on the remaining restricted agents

**Files** (frontmatter only; one line added after `model:`, the placement the generator uses per batch-42 report line 49):

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/backend-developer.md — `disallowedTools: mcp__firecrawl`
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/frontend-developer.md — `disallowedTools: mcp__firecrawl`
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/devops-engineer.md — `disallowedTools: mcp__firecrawl`
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/senior-tester.md — `disallowedTools: mcp__firecrawl`
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/technical-content-writer.md — `disallowedTools: mcp__firecrawl`
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/.claude/agents/ui-ux-designer.md — `disallowedTools: mcp__firecrawl`

**Policy source**: `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts:75-80`. All six rows map to
`NO_WEB_SCRAPE` = `[...WEB_SCRAPE_SERVERS]` = `['mcp__firecrawl']`. `formatDisallowedToolsFrontmatter` gives
`disallowedTools: mcp__firecrawl`, and each file now carries that exact text. It is a server-level entry with no partial wildcard and no bare `*`
(42.1 rules). The rows for visual-reviewer, researcher-expert and video-director are `[]`, so those files were not touched.

**Verification**:

- Content check: `grep -c '^disallowedTools:'` returns 1 for each of the six files and 0 for visual-reviewer,
  researcher-expert and video-director. The line text is identical to the table output.
- Frontmatter parse: `js-yaml` load of each file's frontmatter succeeds. `name` matches the filename, the keys are
  `name,description,model,disallowedTools`, and `disallowedTools === "mcp__firecrawl"`.
- Repo validator: there is no dedicated validator for agent frontmatter. `scripts/validate-orchestration-skill.ts` only checks that
  agent files exist. I ran `node scripts/regen-agents.mjs` without `--write`; it regenerates the Codex/OpenCode mirrors from
  `.claude/agents` and printed `WOULD CHANGE 0`. The new key does not reach the mirrors, which matches the batch-42 note
  that those transforms rebuild frontmatter from `name`/`description` only.
- No build or test target applies, because these are config text files.

**Plan deviations**: none.

**Out-of-scope observations**: the other modified files under `.claude/agents` belong to Batch 43, which ran in parallel. I did not touch them.
