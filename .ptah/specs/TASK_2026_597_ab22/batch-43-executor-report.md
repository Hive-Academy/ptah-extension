# Batch 43 executor report — N3 frontmatter `disallowedTools` on reviewers and planners

Verdict: COMPLETE. Task 43.1 is done. All six files carry exactly one `disallowedTools` line, and each line is byte-equal
to the committed policy row. Every check is green.

## Task 43.1 — files

All files are under `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\.claude\agents\`:

- MODIFIED `code-logic-reviewer.md`
- MODIFIED `code-style-reviewer.md`
- MODIFIED `modernization-detector.md`
- MODIFIED `project-manager.md`
- MODIFIED `software-architect.md`
- MODIFIED `team-leader.md`

Each file gets one inserted line, placed directly after `model:`. This is the same spot the generator uses
(`orchestrator.service.ts` `buildAgentFileContent`, Batch 42). Nothing else changed: bodies, `name`, `description` and
`model` are untouched. `git diff --stat -- .claude/agents` shows 6 files changed, 6 insertions(+), 0 deletions.

The inserted line is the `NO_BROWSER_NO_WEB` row of `SUBAGENT_DISALLOWED_TOOLS` in
`libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts`. The server name `ptah` comes from
`PTAH_MCP_SERVER_NAME` in `libs/shared/src/lib/types/capability-toggle.types.ts:61`.

```
disallowedTools: mcp__firecrawl, mcp__ptah__ptah_web_search, mcp__ptah__ptah_browser_navigate, mcp__ptah__ptah_browser_screenshot, mcp__ptah__ptah_browser_evaluate, mcp__ptah__ptah_browser_click, mcp__ptah__ptah_browser_type, mcp__ptah__ptah_browser_content, mcp__ptah__ptah_browser_network, mcp__ptah__ptah_browser_close, mcp__ptah__ptah_browser_status, mcp__ptah__ptah_browser_record_start, mcp__ptah__ptah_browser_record_stop
```

The 42.1 rules hold:

- `mcp__firecrawl` is the only server-level entry.
- The 11 browser tools are listed by full name.
- There is no partial wildcard and no `*`.

## Verification

1. **Content check.** A Node script rebuilds the expected line the same way `formatDisallowedToolsFrontmatter` does, then
   checks each file. Every file passed every check:
   - exactly 1 `disallowedTools` line;
   - the line equals the expected line;
   - `js-yaml` parses the frontmatter, and `name` equals the file id;
   - `disallowedTools` is a string that splits into 13 entries;
   - no `*`.
2. **`git diff -U0 -- .claude/agents`.** The only added line is the one above, and it appears 6 times. There are no
   removed lines.
3. **Repo validator for agent files.** There is no frontmatter schema validator for `.claude/agents`.
   - `scripts/validate-orchestration-skill.ts` (`npm run validate-skill`) only checks that the agent files exist (`:405-419`).
     The edit does not affect that.
   - `node scripts/regen-agents.mjs` (dry run) reports `WOULD CHANGE 0`. The Codex and OpenCode mirrors do not drift,
     because their transforms rebuild frontmatter from `name` and `description` only.
4. **`npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation`.**
   - test and lint: succeeded, cache hit.
   - typecheck: my first combined run passed `--maxWorkers=2` through to `tsc`, which fails with TS5023 (unknown option).
     That was a command error on my side. Typecheck run alone: "Successfully ran target typecheck". This batch changes no
     source in that project.
5. No Nx project owns `.claude/agents`, so no project target applies to the edited files themselves.

## Plan deviations

None.

## Out-of-scope observations

None. Batch 44's files, the agent-sdk code and `batches.md` were not touched, and nothing was committed.
