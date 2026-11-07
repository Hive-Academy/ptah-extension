# Gap inventory — lane B

Scope: the frontend feature libraries (cron-scheduler-ui, git-ui, harness-builder, machines-ui,
marketplace, mcp-apps-page, memory-curator-ui, messaging-gateway-ui, review-runs-ui,
skill-synthesis-ui, tasks-ui, workspace-indexing), every Settings section, and the known gaps
(remote machines, MCP caller authentication, memory corpus and timeline, session inspector).

Docs root: `apps/ptah-docs/src/content/docs/`. Slugs are paths without the extension.
Code paths are relative to the worktree root. `LF` = `libs/frontend`.

| # | Area | Feature (UI label) | Code evidence (file:line) | Docs page (slug or —) | Status | Notes |
|---|------|--------------------|---------------------------|-----------------------|--------|-------|
| 1 | Thoth › Memory | **Memories** view: search, scope toggle, pin, forget, stats strip | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:232`, `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:284` | memory/searching, memory/pinning-and-forgetting | documented | — |
| 2 | Thoth › Memory | **Timeline** view: query, memory type, concepts, files, date range, anchor, Load more (KNOWN GAP) | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:350`, `LF/memory-curator-ui/src/lib/components/timeline-filters.component.ts:48` | — | missing | No docs page contains "timeline". |
| 3 | Thoth › Memory | **Corpus** view: **Knowledge corpora** list, build-corpus dialog (name, type, concepts, files, query, limit, workspace scope), **Suggested boards** (KNOWN GAP) | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:351`, `LF/memory-curator-ui/src/lib/components/corpus-build-dialog.component.ts:55` | — | missing | memory/how-it-works only says "corpus memories are exempt" from eviction. |
| 4 | Thoth › Memory | **Code index** view: indexed symbols, search, paging, **Advanced indexing** / **Re-index** | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:224`, `LF/workspace-indexing/src/lib/workspace-indexing.component.ts` (mounted at memory-curator-tab:244) | memory/searching, workspace/workspace-intelligence | documented | — |
| 5 | Thoth › Memory | **Maintenance** › diagnostics: Last curator run, Curator model, DB health, storage health, event feed, trigger toggles | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:257`, `LF/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:55` | — | missing | memory/settings lists trigger keys only. The diagnostics panel is not described. |
| 6 | Thoth › Memory | **Danger zone**: purge entries by subject pattern and match mode | `LF/memory-curator-ui/src/lib/components/memory-danger-zone.component.ts:25`, `:33` | — | missing | Destructive action with no docs. |
| 7 | Thoth › Memory | Memory **Paused** switch | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:185`, `LF/memory-curator-ui/src/lib/components/memory-pause-switch.component.ts:59` | memory/settings | partial | Only the `memory.enabled` key is listed. The tab switch is not named. |
| 8 | Thoth › Skills | Skills Library: cards, drawer, edit body, history restore, **Rebase to upstream** / **Keep mine**, **Enhance now** | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:237`, `LF/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:108` | skill-synthesis/the-skills-tab, skill-synthesis/how-it-works | documented | — |
| 9 | Thoth › Skills | **Skills** pause switch and **Skill telemetry** switch | `LF/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:77` | skill-synthesis/the-skills-tab | documented | — |
| 10 | Thoth › Skills | Bulk select and bulk rebase toolbar | `LF/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:305`, `LF/skill-synthesis-ui/src/lib/components/clones/clone-bulk-toolbar.component.ts:58` | — | missing | — |
| 11 | Thoth › Skills | Quarantined agents panel and **Restore** | `LF/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:400`, `LF/skill-synthesis-ui/src/lib/components/clones/quarantined-agents-panel.component.ts:255` | — | missing | No docs page contains "quarantine". |
| 12 | Thoth › Skills | Agent card: model per provider editor | `LF/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts:351`, `LF/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:167` | — | missing | — |
| 13 | Thoth › Skills | Scorecard badge and scorecard detail in the drawer | `LF/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts:343` | skill-synthesis/the-skills-tab | partial | The page names **Success** / **No grade**. The scorecard detail is absent. |
| 14 | Thoth › Skills | **Orchestration specs**: **Harvest** review verdicts, **Clear stale** | `LF/skill-synthesis-ui/src/lib/components/skill-specs-control.component.ts:19`, `LF/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:113` | — | missing | No docs page contains "harvest". |
| 15 | Thoth › Schedules | **Schedules** tab: job list, stats, scope, **Run now** / **Edit job** / **Delete job**, job editor, run history drawer | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:242`, `LF/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:130` | automation/cron/* (6 pages) | documented | — |
| 16 | Thoth › Messaging | Messaging tab: platform tabs, Connection / Access / Integration, allow list, pending and approved bindings, Discord integration kit | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:247`, `LF/messaging-gateway-ui/src/lib/components/gateway-platform-pane.component.ts:52` | automation/messaging/* (6 pages) | documented | — |
| 17 | Thoth › Messaging | **Gateway setup** guide drawer | `LF/messaging-gateway-ui/src/lib/components/messaging-gateway-tab.component.ts:126`, `LF/messaging-gateway-ui/src/lib/components/gateway-setup-guide.component.ts:24` | — | missing | Low priority: in-app help. The pages do not name it. |
| 18 | Thoth › Messaging | **Voice & rate limits** section | `LF/messaging-gateway-ui/src/lib/components/messaging-gateway-tab.component.ts:303` | automation/messaging/settings | documented | — |
| 19 | Reviews | **Review runs** page: runs list, **Refresh**, run detail (Stage timeline, Coverage and lanes, **Rerun this PR**, Findings, Walkthrough preview, Artifacts) | `apps/ptah-extension-webview/src/app/app.routes.ts:177`, `LF/review-runs-ui/src/lib/components/review-run-detail.component.ts:30` | getting-started/first-launch (tab name only) | missing | Also linked from **Schedules** (`cron-scheduler-tab.component.ts:141`). |
| 20 | Reviews | Review settings drawer: **Repositories** editor, **GitHub bot identity** token, publication pause | `LF/review-runs-ui/src/lib/components/review-runs-page.component.ts:229`, `LF/review-runs-ui/src/lib/components/review-bot-identity.component.ts:10` | — | missing | RPC `review:setBotToken`, `review:setPublicationPause`, `review:updateSettings`. |
| 21 | Tasks | Tasks board: Kanban / List, six columns, detail panel, workflow documents, **Start**, **New Task**, exclusions drawer | `apps/ptah-extension-webview/src/app/app.routes.ts:143`, `LF/tasks-ui/src/lib/components/tasks-view.component.ts:373` | tasks/index | documented | — |
| 22 | Tasks | Filter bar (text, labels, sort) and saved views menu | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:178`, `:199` | — | missing | tasks/index does not mention filter, sort or saved views. |
| 23 | Tasks | Multi-select bulk bar: move to a status, add or remove a label | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:344`, `LF/tasks-ui/src/lib/components/bulk/task-bulk-bar.component.ts` | — | missing | — |
| 24 | Tasks | Board command palette (`Ctrl+K` / `Cmd+K`) | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:365`, `:577` | — | missing | Not in reference/keyboard-shortcuts. |
| 25 | Tasks | Detail panel: relations editor and activity feed | `LF/tasks-ui/src/lib/components/detail/task-detail.component.ts:283`, `:313` | tasks/index | partial | Only `depends_on` is named. Relation kinds and activity are absent. |
| 26 | Tasks | **Manage**: **Generate registry**, **Reindex**, **Tidy finished…** | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:381` | tasks/index | documented | — |
| 27 | Apps | **Apps** page: MCP apps conversation, app surface panel, resizable column | `apps/ptah-extension-webview/src/app/app.routes.ts:153`, `LF/mcp-apps-page/src/lib/components/apps-page.component.ts` | getting-started/first-launch (tab name only) | missing | — |
| 28 | Git | Git dock header: branch, ahead/behind, stash count, Fetch / Pull / Push | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:127` | git/git-status, git/index | documented | — |
| 29 | Git | Branch picker: search, switch, create a branch, overwritten-files warning | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:127`, `LF/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:63`, `:290` | — | missing | Docs tell the user to switch branches in a terminal. |
| 30 | Git | **Stashes** popover: entries and files in a stash | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:157`, `LF/git-ui/src/lib/stash/stash-popover.component.ts:59` | git/index | partial | Named in the quick reference only. Actions are absent. |
| 31 | Git | Review view › **Changes**: diff layout, hunk actions, stage / discard, **Choose a comparison** | `LF/git-ui/src/lib/review-canvas/review-canvas.component.ts` | git/diffs | documented | — |
| 32 | Git | Review view › **Commit** composer and message generation | `LF/git-ui/src/lib/commit/commit-composer.component.ts` | git/commits | documented | — |
| 33 | Git | Review view › **History** tab: timeline, stash section, refresh | `LF/git-ui/src/lib/review-shell/review-shell.component.ts:377`, `LF/git-ui/src/lib/history/history-timeline.component.ts:141` | git/index | partial | Named in the quick reference only. |
| 34 | Git | Review view › **Task** tab: add and remove worktrees | `LF/git-ui/src/lib/task/task-worktree-view.component.ts:239` | git/worktrees | documented | — |
| 35 | Git | Task tab › **Pull request** panel: PR status badge, open in browser | `LF/git-ui/src/lib/task/task-worktree-view.component.ts:193`, `LF/git-ui/src/lib/task/task-pr-panel.component.ts:123` | — | missing | — |
| 36 | Git | Conflict banner with conflicted files | `LF/git-ui/src/lib/review-shell/review-shell.component.ts:199`, `LF/git-ui/src/lib/conflict/conflict-banner.component.ts:190` | — | missing | No docs page contains "conflict". |
| 37 | Git | **Open in** button: choose an external editor | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:164`, `LF/git-ui/src/lib/open-in/open-in-button.component.ts:95` | — | missing | Appears in the dock, diffs, history and the spot editor. |
| 38 | Git | Spot editor: edit a file in the review view, Markdown view, unsaved-changes state | `LF/git-ui/src/lib/review-shell/review-shell.component.ts:255`, `LF/git-ui/src/lib/spot-editor/spot-editor.component.ts:167` | — | missing | — |
| 39 | Git | **Draft comments** bar on the review canvas | `LF/git-ui/src/lib/review-canvas/review-canvas.component.ts:206`, `LF/git-ui/src/lib/review-canvas/draft-comments-bar.component.ts:65` | — | missing | — |
| 40 | Setup | AI team builder: Brief / Proposal / Review, preview sections, **Presets**, **Apply**, leave dialog | `LF/onboarding/src/lib/proposal/proposal-workspace.page.ts:120`, `LF/harness-builder/src/lib/components/harness-config-preview.component.ts:90` | setup/ai-team-builder | documented | — |
| 41 | Setup | Builder AI helpers ("Describe the product or paste a PRD") and stack profile (Toolchain, Skills, Plugins on) | `LF/onboarding/src/lib/proposal/proposal-workspace.page.ts:115`, `LF/harness-builder/src/lib/components/sidebar/builder-stack-profile-section.component.ts` | setup/ai-team-builder | partial | These two sidebar sections are not named. |
| 42 | Marketplace | **Overview** page: stats, needs attention, featured connectors | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:59`, `LF/marketplace/src/lib/pages/overview/overview-page.component.ts` | marketplace/index | partial | One table row only. |
| 43 | Marketplace | **Connectors** catalog and status | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:65`, `LF/marketplace/src/lib/pages/connectors/connectors-page.component.ts` | marketplace/connectors | documented | — |
| 44 | Marketplace | **MCP Servers** (installed): table / cards, filters, server detail inspector, capability toggles, target marks, coverage matrix, bulk actions, removal | `LF/marketplace/src/lib/routes/marketplace.routes.ts:138`, `LF/marketplace/src/lib/pages/servers/installed-servers-page.component.ts` | marketplace/index, marketplace/mcp-registry | partial | Only "See what is installed". Detail, toggles, coverage and removal are absent. |
| 45 | Marketplace | **Skills & Plugins** (installed): library, skill detail, stale-library notice | `LF/marketplace/src/lib/routes/marketplace.routes.ts:152`, `LF/marketplace/src/lib/pages/skills/installed-skills-page.component.ts` | marketplace/index, plugins/skill-toggles | partial | The page itself is one table row. |
| 46 | Marketplace | Harness health badge, **Re-check harness health**, repair dialog, blocked harness paths | `LF/marketplace/src/lib/pages/skills/skills-section-header.component.ts:43`, `LF/marketplace/src/lib/harness/harness-health-badge.component.ts:123` | — | missing | No docs page contains "repair" or "blocked path". |
| 47 | Marketplace | **Smithery** source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:92` | marketplace/smithery | documented | — |
| 48 | Marketplace | **MCP Registry** source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:98` | marketplace/mcp-registry | documented | — |
| 49 | Marketplace | **Custom URL** (OAuth servers) source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:104` | marketplace/connected-apps | documented | — |
| 50 | Marketplace | **Ptah Plugins** source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:110` | plugins/marketplace, plugins/installing | documented | — |
| 51 | Marketplace | **Community** source (skills.sh) | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:116` | marketplace/index, plugins/index | partial | Named only. How to search and install is absent. |
| 52 | Marketplace | **Marketplaces** source: GitHub `owner/repo` marketplaces, consent dialog (per-file differences), install report, installed rows | `LF/marketplace/src/lib/pages/skills/skill-source-host.component.ts:132`, `LF/marketplace/src/lib/external-consent-dialog.component.ts:209` | marketplace/index, plugins/marketplace | partial | Named only. The consent and install flow is absent. |
| 53 | Settings | Settings page, four tabs, result toast with **Undo** | `LF/chat/src/lib/settings/settings.component.ts:201`, `LF/chat/src/lib/settings/feedback/settings-toast.component.ts` | settings/index | documented | — |
| 54 | Settings › Providers | **Main agent** section: **Reassign** provider, model and effort, scope badges, clear override | `LF/chat/src/lib/settings/providers/providers-settings.component.ts:129`, `LF/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:132` | providers/index | partial | One bullet. Reassign popover, scope badges and override are absent. |
| 55 | Settings › Providers | Connections: filter, connection cards, **Connect a provider** catalog, custom endpoint, setup wizard, detail drawer (Overview & Used By, Credentials, Models & Tiers, Advanced) | `LF/chat/src/lib/settings/providers/providers-settings.component.ts:353`, `:445` | providers/index, providers/* (12 pages) | documented | **Token pricing** in the Advanced tab is not named. |
| 56 | Settings › Providers | Claude **Accounts** tab: **Add account**, sign-in script, ambient login check, Used by, remove | `LF/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:87`, `LF/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:107` | providers/claude | partial | One sentence. Add, sign-in script and remove steps are absent. |
| 57 | Settings › Providers | **CLI agents** matrix: model / effort cells, Claude lane account, Copilot auto-approve, Cursor credential, capability detail, **Orchestration policy**, **Max concurrent agents**, **Re-detect CLI agents** | `LF/chat/src/lib/settings/providers/agents-routing-settings.component.ts:63`, `LF/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:84` | providers/index, agents/cli-agents | partial | Policy, max concurrent, re-detect, Cursor credential and capability detail are absent. |
| 58 | Settings › Providers | Ptah CLI instances: add instance, tier mapping | `LF/chat/src/lib/settings/providers/add-cli-instance-modal.component.ts`, `LF/chat/src/lib/settings/providers/cli-tier-mapping-modal.component.ts` | providers/ptah-cli | documented | — |
| 59 | Settings › Providers | **Background models** / **Background model roles**: memory curator, skill enhancement, decision model, **Enhancement time limit** | `LF/chat/src/lib/settings/providers/agents-routing-settings.component.ts:142`, `LF/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:483` | providers/index, skill-synthesis/settings | partial | Decision model row (key, base URL, timeout) and the time limit editor are absent. |
| 60 | Settings › Providers | Setting scope row ("Where this value can be set") | `LF/chat/src/lib/settings/providers/setting-scope-row.component.ts:116` | — | missing | Global versus workspace scope of a value is not explained. |
| 61 | Settings › Context Management | **Subagent prompt-cache TTL** | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:53` | settings/index | partial | Named only. |
| 62 | Settings › Context Management | Session budget | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:65` | sessions/cost-summary | documented | Page title is "Session Budget". It has a Settings section. |
| 63 | Settings › Context Management | **Lane guards** | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:74`, `LF/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.ts:60` | settings/index | partial | Named only. |
| 64 | Settings › Context Management | Host routing, lane rotation, capability matrix (Family, Model, Samples, Score) | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:78`, `:80` | — | missing | — |
| 65 | Settings › Context Management | **Context budgets** group (`compaction.*`, idle compaction) | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:86`, `libs/shared/src/lib/types/advanced-settings.types.ts:93` | — | missing | No docs page contains a `compaction.` key. |
| 66 | Settings › Context Management | **Codex agents** group and **Codex sandbox mode** | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:87`, `:89` | providers/codex | partial | Only `codexAutoApprove` is documented. Sandbox mode and `codexAutoCompactTokens` / `codexToolOutputTokenLimit` / `codexWebSearch` are absent. |
| 67 | Settings › Context Management | **Background query limits** group (`internalQuery.*`) | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:90` | — | missing | — |
| 68 | Settings › Advanced | **Membership & data**: membership key, log out, **Export** / **Import** settings | `LF/chat/src/lib/settings/advanced-settings.component.ts:75`, `:122` | settings/import-export, getting-started/signing-in | documented | — |
| 69 | Settings › Advanced | Agent behaviour: **Enhanced System Prompt** (drawer: preview, regenerate, download), chat reasoning effort, **Dynamic workflows**, **Ultracode** mode | `LF/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:136`, `:239` | chat/effort-levels | partial | Only effort is documented. Enhanced prompt, dynamic workflows and Ultracode are absent. |
| 70 | Settings › Advanced | Output styles: list, active style, create, editor, command-line parity write | `LF/chat/src/lib/settings/advanced-settings.component.ts:165`, `LF/chat/src/lib/settings/output-style/output-style-config.component.ts:89` | settings/index | partial | Named only. |
| 71 | Settings › Advanced | **MCP server port** and **Allow localhost access for browser tools** | `LF/chat/src/lib/settings/pro-features/mcp-port-config.component.ts:101`, `:206` | mcp-and-skills/built-in-mcp-server, troubleshooting/mcp-port-conflicts | partial | The localhost-access toggle is absent. |
| 72 | Settings › Advanced | Claude built-ins: built-in tools and claude.ai skills, token cost, "Needs tool" | `LF/chat/src/lib/settings/advanced-settings.component.ts:167`, `LF/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts:173` | — | missing | — |
| 73 | Settings › Advanced | Fine-tuning groups: **Memory upkeep**, **Scheduled jobs**, **Workspace harness** | `LF/chat/src/lib/settings/advanced-settings.component.ts:206`, `:208` | memory/settings, automation/cron/settings | partial | The keys of memory and cron are listed. `harness.preflightTimeoutMs` and `harness.manageGitignore` are absent. |
| 74 | Settings › Advanced | **Setup**: **Run onboarding again**, **Check Claude Code** | `LF/chat/src/lib/settings/settings.component.html:253`, `:265` | getting-started/first-launch, providers/claude | partial | **Run onboarding again** is absent. |
| 75 | Settings › Search & Voice | Web search: providers, API keys, Max results, test | `LF/chat/src/lib/settings/search-voice-settings.component.ts:20` | providers/web-search | documented | — |
| 76 | Settings › Search & Voice | Voice: STT and TTS direction, provider, model / voice, status, **Voice engines** drawer (ElevenLabs, local STT, local TTS) | `LF/chat/src/lib/settings/search-voice-settings.component.ts:23`, `LF/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts:65` | — | missing | No docs page contains "ElevenLabs" or "text-to-speech". |
| 77 | Settings › Search & Voice | go vet consent: **Allow go vet**, workspace, Go binary | `LF/chat/src/lib/settings/search-voice-settings.component.ts:24`, `LF/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:283` | — | missing | Consent to run the local Go toolchain needs a page. |
| 78 | Known gap | Remote machines (ssh transport, pairing, registry, remote sessions) | `libs/frontend/machines-ui/src/index.ts:1` (`export {};`), `libs/backend/remote-machines/src/lib/machines-rpc.handlers.ts:66`, `apps/ptah-electron/src/activation/wire-runtime.ts:346`, `libs/shared/src/lib/types/rpc.types.ts:4071` | — | missing | The backend and `machines:*` RPC are wired in Electron. No renderer UI calls them yet. No docs page contains "remote machine". |
| 79 | Known gap | MCP caller authentication: **External MCP callers** (`mcp.externalCallerAccess`) | `LF/chat/src/lib/settings/pro-features/mcp-port-config.component.ts:134`, commit `9101d8bc6` | mcp-and-skills/built-in-mcp-server (#external-callers) | partial | The setting is documented. Policy levels (read-only, lane-report, privileged), persistent tokens in `.mcp.json` / Codex TOML / Cursor header, and Host/Origin checks are absent. |

## Summary

Counts (79 rows):

| Status | Count |
|--------|-------|
| documented | 25 |
| partial | 24 |
| missing | 30 |

The 10 most important `missing` features:

1. **Remote machines** (#78) — users need a page that tells them how to pair a machine over ssh and run sessions on it. Write the page when a UI calls the `machines:*` methods.
2. **Review runs** (#19, #20) — a full surface with GitHub bot tokens and PR reruns. A user cannot set it up without a page.
3. **Memory Timeline** (#2) — the user needs to know how to filter memory events by type, concept, file and date.
4. **Memory Corpus** (#3) — the build dialog has six inputs and suggested boards. The user cannot know what a corpus does.
5. **Apps page** (#27) — a top-level tab that has only its name in the docs.
6. **Voice settings** (#76) — the user must select engines and keys (ElevenLabs or local) before voice works.
7. **Branch picker** (#29) — the docs tell users to switch branches in a terminal, but the app can do it.
8. **Memory Danger zone** (#6) — a destructive purge needs a page that describes its pattern modes.
9. **Context budgets and Background query limits** (#65, #67) — these keys change compaction and concurrency. Users need defaults and effects.
10. **go vet consent** (#77) — a security consent for running the local Go toolchain. Users need to know what it allows.

## Decisions

- **Session inspector**: it is in `libs/frontend/chat` (`LF/chat/src/lib/services/session-inspector/`,
  used at `LF/chat/src/lib/components/templates/chat-view.component.ts:1166`). That is lane A
  scope, so this file has no row for it. No docs page contains "inspector".
- **machines-ui** is an empty library (`export {};`), created in commit `c9e71a634`. Row #78
  uses the backend and RPC evidence instead.
- **MCP caller authentication** is `partial`, not `missing`: `mcp-and-skills/built-in-mcp-server`
  has an "External callers" section with the setting and its two values.
- **Thoth shell** (`LF/thoth-shell`) is only the tab host. Its tabs are in rows #1–#18. The shell
  and its entry button are left to lane A.
- **AI team builder**: the `harness-builder` components are mounted in the onboarding proposal page.
  Rows #40–#41 cover the builder panels only. The onboarding flow is lane A.
- **Skipped as not for Electron**: `vscode-lm-config.component.ts` shows only when a VS Code LM
  provider exists. That provider is not in the Electron host.
- **Skipped as not mounted in Settings**: the `notifications` and `display` advanced groups
  (`advanced-settings.types.ts`). No `groupId="notifications"` or `groupId="display"` mount was found
  in Settings. Lane A owns notifications.
- **Theme** (settings/theme) is not in a Settings tab component. It is left to lane A (shell).
- **Grouped**: small controls are under their panel. Examples: connection drawer tabs (#55),
  CLI matrix cells and popovers (#57), marketplace UI parts (#44).
- **Code index and workspace indexing**: the `workspace-indexing` component is mounted in the
  Code index view (`memory-curator-tab.component.ts:244`, before the `maintenance` case). This
  agrees with workspace/workspace-intelligence.
- Labels were found by search of templates (`aria-label`, headings, text). Each `missing` status
  was checked with a search of the docs for the feature name and its UI label strings.
