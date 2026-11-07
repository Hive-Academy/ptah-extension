# Lane L2 report — docs evidence sweep (chat, sessions, agents, tribunal, tasks, canvas, workspace, git, memory)

Status: complete. 46 pages audited: 3 deleted, 6 kept, 37 edited or rewritten.

## Pages

| Page | Action | Main changes | Evidence |
| ---- | ------ | ------------ | -------- |
| chat/index.md | edited | Removed VS Code command palette tip, provider list, Quick/Balanced/Thorough. Controls table now matches composer. | `libs/frontend/chat/src/lib/components/molecules/chat-input/` (model-selector, effort-selector), `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts`, `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts` |
| chat/sending-messages.md | edited | Removed Ctrl+Enter, Esc-to-stop, Fork, checkpoint claims. Added "Branch conversation from here". | `chat-input.component.ts:1615` (Enter, no Shift), `:495` "Stop generating"; `organisms/message-bubble.component.html:245` |
| chat/file-attachments.md | rewritten | `@` lists Files & Folders only; `/` lists commands and prompts; agents/skills/MCP resources not offered; folder expansion and token projection removed. Image types fixed. | `components/file-suggestions/unified-suggestions-dropdown.component.ts:32,213-241`; `libs/shared/src/lib/utils/image-media-type.ts:9`; `services/composer-attachments.service.ts:60` |
| chat/effort-levels.md | rewritten | Levels are Default/Low/Medium/High/X-High/Max (not Quick/Balanced/Thorough). Persisted per provider, not "next message only". Per-tile override. | `molecules/chat-input/effort-selector.component.ts:44-90,290-310`; `libs/frontend/core/src/lib/services/effort-state.service.ts:55` |
| chat/autopilot.md | rewritten | Autopilot is the approval mode (Manual, Full Auto, Auto-edit, Plan Mode), not sub-agent delegation. Removed CLI priority. | `autopilot-popover.component.ts:120-175,269-271`; `libs/frontend/core/src/lib/services/autopilot-state.service.ts:98,161-168` |
| chat/cost-and-tokens.md | rewritten | Removed per-provider pricing claims, session summary card, per-message footer. Kept cache tokens, OpenRouter pricing, subscription note, MCP chip. | `libs/shared/src/lib/types/execution/node.ts:57-58`; `libs/backend/auth-providers/src/lib/di/register.ts:36` (OpenRouterPricingService); `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts:7`; `mcp-status-chip.component.ts:32-38`; `mcp-server-list.component.ts:24` |
| chat/execution-tree.md | rewritten | Node types from code. Removed right-hand pane, export menu, `.ptah/traces`, depth warning. | `libs/shared/src/lib/types/execution/node.ts:24-30`; `components/organisms/execution/execution-node.component.ts` |
| chat/switching-models.md | edited | Removed carry-over table, error banner, `anthropicProviderId` example. Kept `llm.defaultProvider`. | `libs/backend/platform-core/src/file-settings-keys.ts:102,339`; `model-selector.component.ts:57` |
| sessions/index.mdx | edited | Removed `.ptah/sessions/` storage. Transcript in `~/.claude/projects/`, organization data in SQLite. Removed metadata card, renamed cost card to Session budget. | `libs/backend/session-organization/src/lib/session-organization.service.ts:1-20`; `libs/backend/agent-sdk/src/lib/session-importer.service.ts:1-8` |
| sessions/managing-sessions.md | rewritten | Removed shortcuts, templates, duplicate, tags, archive folder layout. Added Rename/Organize/Delete row actions, status and priority values. | `components/molecules/session-list-row/session-list-row.component.ts:206-303`; `libs/shared/src/lib/types/session-organization.types.ts:20-30`; `atoms/session-organization-chips/` |
| sessions/session-history.md | rewritten | Removed query grammar, export, tags, shortcuts, index rebuild. Documented Previous sessions search, date range, filters, sort, group. | `molecules/session-filter-bar/session-filter-bar.component.ts`; `molecules/previous-sessions-toolbar/previous-sessions-toolbar.component.ts`; `organisms/previous-sessions/previous-sessions-modal.component.html` |
| sessions/analytics.md | rewritten | Removed quality scores, latency, export, command palette. Documented usage dashboard sections. | `libs/frontend/dashboard/src/lib/components/usage-dashboard/`; `templates/app-shell.component.html:126` |
| sessions/auto-import.md | rewritten | Import runs on workspace open, up to 50 recent Claude sessions, metadata only. Removed import dialog, watcher, settings JSON. | `apps/ptah-electron/src/activation/boot-heavy-services.ts:390-405`; `session-importer.service.ts:1-8` |
| sessions/cost-summary.md | rewritten | Fake pricing overrides and daily budget replaced by the real session budget (`sessionBudget.*`). Title now "Session Budget". | `libs/shared/src/lib/types/session-budget.types.ts:1-25,150-240` |
| sessions/metadata.md | deleted | Invented schema and storage. | — |
| agents/index.mdx | edited | Agents are templates written by the setup wizard; added visual-reviewer to the list; removed in-app editor and "push to Copilot/Codex/Cursor" wording. | `libs/backend/agent-generation/templates/agents/*.template.md` (14 files); `libs/backend/agent-generation/src/lib/di/tokens.ts:91` |
| agents/agent-orchestration.md | kept | Matches `ptah-core` orchestration skill. | `plugins/ptah-core/` |
| agents/agent-sessions.md | kept | Tools, settings, defaults, ranges, allowlist and statuses match code. | `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-settings.ts:32-70` |
| agents/built-in-agents.md | edited | Removed "always available in picker", picker/@-mention section, 40/35/25 review weights. Override note fixed. | `templates/agents/*.template.md` (`alwaysInclude`, `applicabilityRules`); `unified-suggestions-dropdown.component.ts:32` |
| agents/cli-agents.md | edited | CLI list from `SYSTEM_CLI_TYPES` (added Grok, Claude; dropped binary column); removed priority order; max concurrency 100 (was 20); poll pattern replaced by push signal + `ptah_agent_wait`; CLI Agents panel replaced by agent cards; removed v1.0 row. | `libs/shared/src/lib/types/agent-process.types.ts:81-94`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:55,305-325`; `agent-process-manager.service.ts:2787`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts`; `cli-adapters/cli-adapter.utils.ts:352-353`; `agent-card-header.component.ts:150` |
| agents/custom-agents.md | rewritten | Removed in-app editor, Fork as custom, hot-reload, `tools`/`color` fields, templates/plugins sharing. | `templates/agents/*.template.md` (frontmatter `name`, `description`, `model`) |
| agents/syncing-to-cli.md | rewritten | Removed manual Sync UI, modes, auto-sync JSON, unsync. Documented automatic harness reconcile and the target matrix. | `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:1-30`; `apps/ptah-electron/src/activation/plugin-activation.ts:820`; `libs/backend/platform-core/src/file-settings-keys.ts:275-286`; `harness-sync/src/lib/gitignore/gitignore-writer.ts:26-30` |
| agents/importing-history.md | deleted | Duplicate of sessions/auto-import with invented import dialog. | — |
| tribunal/index.mdx, council.md, forge.md, race.md, crucible.md, relay.md | kept | Moves, skills needed and Relay routing match the skill. | `plugins/ptah-core/skills/tribunal/SKILL.md:3,12,86`; `plugins/ptah-core/skills/tribunal/references/{council,forge,race,crucible,relay}.md`; `plugins/ptah-core/skills/orchestration/references/lane-assignment.md` |
| tasks/index.md | edited | Drag between columns removed (no drag code); status via **Change status**. "Read here" removed; documents open in the panel + **Open in editor**. Detail panel has **Start in chat** and **Change status** (note saying otherwise removed). Metadata editor added. Manage menu: **Reindex**, **Generate registry** (`registry.md`), **Tidy finished…**. | `libs/shared/src/lib/types/task-spec.types.ts:13-44`; `libs/frontend/tasks-ui/src/lib/components/task-board-header.component.ts:113-215`; `board/task-card.component.ts:266,632`; `detail/task-detail-header.component.ts:39-43,107,129`; `detail/task-metadata-editor.component.ts:22`; `detail/task-document-reader.component.ts:95-99` |
| canvas/index.md | rewritten | Drag-and-resize grid, lock control, single/grid modes removed: the Rail board is the only board. Documented rail groups, animated reorders, dense cards, sort, New session popover, 20-session cap, 9-running cap with exact message, Open beside / Close split, per-workspace boards. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:46-60,578-582`; `canvas-board-mode.ts`; `canvas-layout-intent.ts:11,240-243`; `canvas-running-cap.ts`; `canvas-rail/canvas-rail-grouping.util.ts:9-16`; `canvas-rail/canvas-rail.component.ts:535`; commit 16e1db0ba |
| workspace/index.mdx | edited | Removed file tree card, status bar badges, VS Code-style quick start. Multi-workspace sidebar, import, harness sync, git watcher. | `libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts`; `apps/ptah-electron/src/activation/workspace-restore.ts:46-89` |
| workspace/opening-a-workspace.md | rewritten | **File → Open Folder...**, **Add Folder**, **Remove workspace**, launch argument. Removed Open Recent, `ptah` shell command, "second launch switches workspace". | `apps/ptah-electron/src/menu/application-menu.ts` ('Open Folder...'); `activation/bootstrap.ts:318-333`; `main.ts:69,420-425` |
| workspace/project-analysis.md | rewritten | Four phase files in `.ptah/analysis/<slug>/`, CLAUDE.md import block; removed stack/patterns/quality/deps JSON, auto-run on open, Re-analyze menu, invented tool arguments. | `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:1-14`; `analysis-claude-md-linker.ts:15,30,96` |
| workspace/switching-workspaces.md | rewritten | Sidebar switch, per-workspace boards, running sessions continue. Removed CLI switch, `.ptah/chats/`, drafts claim. | `workspace-sidebar.component.ts` ("Session running"); `orchestra-canvas.component.ts:51-53` |
| workspace/workspace-config.md | rewritten | Removed `.ptah/plugins.json`, `agents.json`, `context.md`, `chats/` and precedence list. Real folders only. | `analysis-storage.service.ts`; `libs/backend/task-specs`; `harness-sync/src/lib/gitignore/gitignore-writer.ts:27` (`.ptah/harness/state.json`) |
| workspace/workspace-intelligence.md | rewritten | Removed "Show context" and `.ptah/context.md`. Documented index pipelines, controls, `~/.ptah/state/ptah.sqlite`. | `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.ts:113-120`; `libs/backend/persistence-sqlite/src/lib/db-path.ts:11-15` |
| workspace/workspace-restoration.md | rewritten | Real restore flow; removed restore table and settings toggle. Added lane restart resume (24 h cap, "Interrupted by host restart"). | `workspace-restore.ts:46-89`; commits 29abadeaf, 01c167725; `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts` |
| git/index.mdx | rewritten | Removed status bar, orange dot, `/commit`, View → Git Worktrees, confirmation promises. Quick reference points to Git dock and review tabs. | `libs/frontend/git-ui/src/lib/git-dock/` (Fetch, Pull, Push, Stashes); `review-shell` tabs Changes/Commit/History/Task |
| git/git-status.md | edited | Status bar wording replaced by Git dock; removed latency and perf claims. | `git-dock/git-dock-header.component.ts`; `apps/ptah-electron/src/menu/application-menu.ts:137` (toggleDevTools) |
| git/diffs.md | rewritten | Split/Unified layout, filter, Viewed, per-hunk Accept (stage)/Reject (revert, confirmed)/Unstage, discard, comparisons. Removed Shiki list, y/n keys, 10,000-line limit, whitespace toggle. | `review-canvas/hunk-toolbar.component.ts:94-118`; review-canvas / review-shell labels |
| git/commits.md | rewritten | Commit tab, **Generate message**, draft, hook log, Cancel, timeout check. Removed `/commit`, commitlint enforcement, multi-commit and "won't do" lists. | `commit/commit-composer.component.ts:203-225,247-262,457-461` |
| git/worktrees.md | edited | UI path is the **Task** tab (**Add**, **Create new branch**, **Remove worktree**). MCP args unchanged. | `task/task-worktree-view.component.ts:225,266,668`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1092-1108` |
| git/branch-awareness.md | deleted | Invented per-agent branch context bundle and "Show context" toggle. | — |
| memory/index.mdx, how-it-works.md, pinning-and-forgetting.md, searching.md, settings.md | edited | DB path `~/.ptah/ptah.db` → `~/.ptah/state/ptah.sqlite`; transcript path fixed; "Memory → Search" rank display removed; label "Search indexed code symbols"; settings entry point is the Memory tab / advanced settings. Setting keys and defaults kept (match code). | `libs/backend/persistence-sqlite/src/lib/db-path.ts:11-15`, `sqlite-connection.service.ts:321`; `libs/backend/platform-core/src/file-settings-keys.ts:415-447`; `libs/shared/src/lib/types/advanced-settings.types.ts:300-339`; `libs/frontend/memory-curator-ui/src` labels |

## Deleted files

- `apps/ptah-docs/src/content/docs/sessions/metadata.md` — invented JSON schema, `.ptah/sessions/index.json`, field queries, plugin metadata; no code backs it.
- `apps/ptah-docs/src/content/docs/agents/importing-history.md` — duplicates `sessions/auto-import.md`; its import dialog, rescan command and settings do not exist.
- `apps/ptah-docs/src/content/docs/git/branch-awareness.md` — invented branch context bundle and "Chat → Show context" toggle; no code backs it.

## Sidebar changes needed

None required. `astro.config.mjs` uses `autogenerate` for `chat`, `agents`, `sessions`, `workspace` and `git` (lines 47-135), so deleted pages drop out by themselves. Optional:

- `sessions/cost-summary` keeps its slug; its title is now "Session Budget".
- `agents/index.mdx` title is now "Agents in PtahCode".

## Inbound links to fix

None. Grep of `apps/ptah-docs`, `docs/` and `README.md` for `sessions/metadata`, `agents/importing-history`, `git/branch-awareness`, `session-history/#` and `analytics/#quality` finds no remaining link. The one in-scope link (`agents/importing-history.md:45` → `sessions/metadata`) went with the deleted file.

## Verification

- `node apps/ptah-docs/scripts/check-screenshot-refs.mjs`: "29 reference(s) across the docs all resolve". It lists 5 unreferenced files (`agents-wizard-step2.png`, `agents-wizard-step4.png`, `file-tree-panel.png`, `setup-analysis.png`, `v2-thoth-memory.png`). None of them was referenced by an in-scope page before this lane (git diff shows no removed screenshot line).
- Link scan of all in-scope pages: no broken page link. All in-scope anchors resolve (`#the-mcp-chip-in-chat`, `#skill-dependencies`, `#session-resume`, `#concurrency-limits`, `#the-code-symbol-index`). Out of scope: `troubleshooting/index.mdx:29` → `/troubleshooting/reporting-bugs/` is broken (L1 area).
- Frontmatter: every in-scope page starts with `---` and has `title` and `description`.
- No build, serve or workspace-wide check was run.

## Gaps

- **Session inspector**: the side panel with the task section (plan limits merged in, commit 82596b65e), agents section, lane limit tiles and session stats has no page.
- **Remote machines** (`libs/frontend/machines-ui`, `libs/backend/remote-machines`): ssh pairing and registry have no page.
- **Git**: Stashes popover, History tab, branch picker / Branch details, and pull request status in the Task tab have no docs beyond one line in `git/index.mdx`.
- **Memory tab extras**: Knowledge corpora, the memory timeline, DB Health, and the "Danger zone" purge by subject pattern are not documented.
- **Rewind** ("Rewind file changes to here") on chat messages is not documented.
- **Session budget UI**: the chat chip and budget banner are only mentioned. Their exact labels were not checked.
- **Named Claude accounts** for lanes (commit fd03461be) and **MCP caller authentication** (9101d8bc6) are not covered in agents pages.
- **Usage dashboard range values** (`USAGE_RANGE_OPTIONS`) were not located, so `sessions/analytics.md` does not list them.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| L2-1 | Rewrite `chat/autopilot.md` as the approval-mode page, not delete it. | Delete page / rewrite | The toggle exists and is called Autopilot in code; only the description was wrong. `autopilot-popover.component.ts` | yes |
| L2-2 | Reuse `sessions/cost-summary.md` (slug kept) for the real session budget instead of deleting it. | Delete / reuse | Rule 6 allows accurate text where an existing page covers the area; the page already had a "Budgets" section. `session-budget.types.ts` | yes |
| L2-3 | Delete `agents/importing-history.md` and keep `sessions/auto-import.md`. | Keep both / merge / delete one | Both covered the same import; the sessions page is the natural home. | yes |
| L2-4 | Keep screenshot references even where the image may show an older UI (for example `agents-custom-editor.png`, `recent-workspaces.png`). | Remove refs / keep | Task rule 7: keep references valid, do not delete assets. Images were not inspected. The coordinator may want new screenshots. | yes |
| L2-5 | Use `ptah.agentSessions.*` names as the page had them. | Drop prefix / keep | Keys are read through `getConfiguration('ptah', 'agentSessions.…')` (`session-child-settings.ts:95-118`) and are not in the file-settings list, so the `ptah.` section prefix is the visible name. | yes |
| L2-6 | Leave `agents/agent-orchestration.md`, `agents/agent-sessions.md`, tribunal pages and most memory text unchanged. | Rewrite / keep | Spot checks of settings, defaults, ranges, statuses and skill names matched the code. | yes |
| L2-7 | Rename narrative "Ptah" to "PtahCode" in edited pages; keep "Ptah CLI" and `ptah_*` tool names. | — | Landing and L1 use PtahCode as the product name. | yes |
