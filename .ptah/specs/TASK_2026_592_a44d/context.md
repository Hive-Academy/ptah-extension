# Task Context - TASK_2026_592_a44d

## User Request
"basically workspace switching shouldn't every close its session actually now i have another project that has
running sessions and i left it as a feature to switch easily between different projects so we need to check
carefully when we close a tab it should close its session associated with it lets make sure we don't cae any
issues and lets fix in a new worktree please"

## Task Type
BUGFIX

## Complexity
Medium (frontend tab lifecycle + possibly one backend RPC; several close paths and must-not-break cases)

## Strategy
BUGFIX, with research: researcher-expert (map every tab-close / session-replace path, the backend end-session
contract, and the must-not-end cases) → team-leader Mode 1 (plan-free) → developer batches → QA (code-logic
review cross-side + senior-tester).

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session`, branch
`fix/close-tab-ends-session` from `main` 95cb1de78. `node_modules` is a junction to the main checkout.

## CLI Lanes
User standing preference (this session): use CLI lanes where they work (Glm, antigravity, opencode); check
`ptah_agent_list` first. Lanes are shared with the TASK_2026_555 session running in parallel — keep to at most
one lane here at a time.

## Conversation Summary
- Investigation 2026-10-02: 14 claude.exe under Ptah.exe 7360 (started 16:04); 5 active user sessions + this
  one; 8 idle leftovers. All post-date app start, so they are not crash orphans.
- User decision: workspace switching must never end sessions (multi-project switching is a feature).
- User asked: closing a tab ends its session; be careful not to cause regressions; work in a new worktree.
- User instruction (2026-10-02): when the fix is finished, push the branch and open a PR to `main`, watch the CI
  jobs until they succeed, fix any failing job, and address CodeRabbit review comments if any.
- Orchestrator decisions after research-report.md (stated to the user as assumptions, 2026-10-02):
  (a) Electron workspace-folder REMOVAL (not switching) ends every session of the removed workspace (tab state is
  destroyed); the confirm stays for streaming tabs only. Workspace SWITCH is unchanged.
  (b) `closeTab` confirm extends to `awaiting-background` and `sleeping` tabs.
  (c) Dead `closeOtherTabs` / `closeTabsToRight` are deleted (zero non-spec callers).
  (d) Reuse `chat:abort`; no new RPC unless the `saveResumeState([])` overwrite is proven to matter.
  (e) `/clear`, rewind rebind and `forceCloseTab` transfer do not end sessions in v1 (backend `displaceExisting`
  covers the next registration).
- Security note given to the user: the HeyGen MCP bearer token is visible in claude.exe command lines
  (`--mcp-config`); rotation recommended. Not part of this fix.
