# Lane L3 report — docs evidence sweep (automation, browser-automation, mcp-and-skills, marketplace, plugins, skill-synthesis, templates)

Status: complete. 55 pages reviewed: 38 edited, 5 kept (skill-synthesis), 12 deleted.
All paths below are relative to the worktree root. UI entry points: chat header buttons **Thoth**, **Marketplace**, **Settings** (`libs/frontend/chat/src/lib/components/molecules/global-config-actions.component.ts:81-86`); Thoth tabs Memory / Skills / Schedules / Messaging (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:376-384`); Settings tabs Providers / Context Management / Advanced / Search & Voice (`libs/frontend/chat/src/lib/settings/settings.component.ts:200-205`).

## Pages

| Page | Action | Main changes | Evidence |
| ---- | ------ | ------------ | -------- |
| automation/index.mdx | edited | "Both off by default" was wrong (cron is on). Points to Thoth. | `libs/backend/platform-core/src/file-settings-keys.ts:455-456` |
| automation/cron/index.md | edited | Entry is **Thoth → Schedules** (was "Settings → Cron"). Scope filter. Removed "coalesced" and per-job policy claims. | `thoth-shell.component.ts:378`; `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:130-195` |
| automation/cron/creating-a-job.md | edited | Form labels (Prompt / handler, Workspace root (optional), Timezone, Enabled, Create job). Workspace root optional. `handler:` rejected. Deleted RPC table and "readable dir" claim. | `cron-scheduler-tab.component.ts:341-450`; `libs/backend/rpc-handlers/src/lib/handlers/cron-rpc.handlers.ts:57-107`; `cron-job-card.component.ts:109-149` |
| automation/cron/cron-expressions.md | edited | Trimmed timezone text. Grammar table kept (croner). | `libs/backend/cron-scheduler/src/lib/types.ts:40` |
| automation/cron/catchup-and-power.md | edited | Catch-up is NOT per job: v1 hard-codes `last`. Removed the `none`/`all` table. `0` turns catch-up off. Runs on start and on resume. | `cron-scheduler.ts:27-29,56,112,123`; `catchup-coordinator.ts:1-25,61`; `libs/shared/src/lib/types/advanced-settings.types.ts:391-403` |
| automation/cron/run-history.md | edited | Kept statuses/fields; trimmed. | `cron-scheduler/src/lib/types.ts:20-26,55-64`; `job-runner.ts:160-166` |
| automation/cron/settings.md | edited | UI path **Settings → Advanced → Fine-tuning → Scheduled jobs** ("Parallel jobs" 1–16, "Catch-up window"), restart needed. | `advanced-settings.types.ts:115-118,377-403`; `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts:188-208` |
| automation/messaging/index.md | edited | Tools NOT auto-approved: `gateway.permissionLevel` default `ask`. Empty allow list accepts any sender (doc said opposite). Entry **Thoth → Messaging**. "Save & start" sets both flags. Added 60/min abuse cap. Removed voice claims. | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:10-20,97,150-195`; `libs/backend/messaging-gateway/src/lib/adapter-lifecycle.service.ts:245-255`; `libs/frontend/messaging-gateway-ui/src/lib/components/allow-list-editor.component.ts` template; `gateway.service.ts:82` |
| automation/messaging/pairing-and-approvals.md | edited | Real UI flow (Access → Pending requests → code → Approve/Reject; Approved → Revoke). Deleted RPC table (`rejectBinding`/`revokeBinding` do not exist). Real approval notice text. | `binding.store.ts:130`; `types.ts:64`; `platform-bindings-panel.component.ts`; `libs/shared/src/lib/types/rpc.types.ts:2541-2605`; `gateway-chat-bridge.ts:156-161` |
| automation/messaging/settings.md | edited | Removed `gateway.coalesceMs` (default 250 not 800; nothing reads it). Slack keys are `botTokenCipher`/`appTokenCipher`. Added `discord.applicationId`, rate-limit keys, note that `permissionLevel` is not a settings.json key. | `file-settings-keys.ts:245-266,455-474`; `gateway-settings-access.ts:16-19`; `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:99-105` |
| automation/messaging/telegram.md | edited | UI path, Save & start, group chat ID rule. Removed "replies stream as edits" and voice. | `adapters/telegram/grammy.adapter.ts:318-345`; `outbound-delivery.service.ts:210-218` |
| automation/messaging/discord.md | edited | Integration section flow (Application ID, Add to your server, Register /ptah, Allowed servers). No DMs (no DirectMessages intent). Commands trimmed to rules backed by reply strings. | `discord.adapter.ts:130-132,672-705`; `discord-integration-kit.component.ts:256-261`; `discord-command-registration.ts:17-73`; `commands/command-replies.ts:14-46` |
| automation/messaging/slack.md | edited | Inbound is `app_mention` only. Scopes cut to `app_mentions:read`, `chat:write`; added event subscription. Both tokens required. | `adapters/slack/bolt.adapter.ts:1-6,162,284`; `gateway-rpc.handlers.ts:308-311` |
| browser-automation/index.md | edited | Was "Playwright, bundled Chromium, Settings → Browser". Now: chrome-launcher + CDP, Chrome must be installed; real tool args; session timeouts 5/15/30 min; URL rules; `browser.allowLocalhost` in **Settings → Advanced → MCP & Browser**; screenshot default JPEG q60, `.ptah/screenshots/`; recordings `browser.recordingDir` or `.ptah/recordings/`; network ring 500. | `apps/ptah-electron/src/di/phase-3-storage.ts:169-181`; `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts:47-53,499-519`; `mcp-core/tool-description.builder.ts:1177-1470`; `namespace-builders/browser-namespace.builder.ts:150-200`; `pro-features/mcp-port-config.component.ts` |
| mcp-and-skills/index.md | edited | Trimmed marketing; fixed tool families and harness targets. | `harness-sync/src/lib/gitignore/harness-state-store.ts:82-83` |
| mcp-and-skills/built-in-mcp-server.md | edited | Removed invented items (runtime.json, `mcp.builtIn.*` keys, command palette commands, metrics panel, `~/.ptah/logs/mcp/`, allow/ask/deny). Now: localhost, default 51820 + next two ports, **MCP port** setting, `.mcp.json` registration, namespace toggles, **External MCP callers** (`mcp.externalCallerAccess`, read-only default). | `mcp-http/http-server.handler.ts:75-82,136,157-170`; `http-mcp-server.service.ts:444-500`; `mcp-caller-token-registry.ts:1-30`; `mcp-port-config.component.ts` template + `:310-345`; `file-settings-keys.ts:160,378` |
| mcp-and-skills/ptah-tools.md | edited | Compact groups from the real tool list. Removed SDK/CLI version notes and lane protocol detail. Fixed `ptah_harness_create_skill` default scope: `workspace` (doc said `user`). | `tool-description.builder.ts` (names), `protocol-dispatcher.ts:486-505`; `tool-description.builder.ts:1555-1566` |
| mcp-and-skills/skills.md | edited | Removed changelog sentence (symlinks/junctions). Rest backed. | `harness-sync/src/lib/manifest/harness-manifest.builder.ts:1-40`; `plugins/ptah-core/skills/orchestration/SKILL.md:225`; `tribunal/SKILL.md:82` |
| mcp-and-skills/popular-skills.md | edited | Added missing `ptah-surface-authoring`, `session-handoff`, and `ptah-nx-saas` commands. | `plugins/*/skills`, `plugins/*/commands` listing |
| mcp-and-skills/creating-skills.md | edited | "auto-junctions" → copies; removed nonexistent "Active skills" chip, `version`/`tags` frontmatter, `.claude/skills` drop-in route; scope default fixed. | `harness-sync/src/lib/targets/claude-target.ts:1-3`; `chat-ui/.../plugin-catalog-panel.component.ts:99` |
| mcp-and-skills/third-party-mcp.md | edited | Removed fake `mcpServers` in `~/.ptah/settings.json`, `${env:}` expansion, permissions block, Settings → MCP panel. Now: Marketplace routes + `ptah_harness_install_mcp_server` targets/scopes. | `tool-description.builder.ts:1615-1710` |
| marketplace/index.md | edited | New nav (Overview, Connectors, MCP Servers, Skills & Plugins; Sources: Smithery, MCP Registry, Custom URL, Ptah Plugins, Community, Marketplaces). Removed Composio "coming soon". | `libs/frontend/marketplace/src/lib/shell/marketplace-nav.component.ts:52-125` |
| marketplace/connectors.md | edited | Status words now Connected / Needs sign-in / Failed; "Set up" for app connectors; removed "Connect a custom server"; MCP chip is in the chat input. | `marketplace/src/lib/ui/status-pill.component.ts:40-50`; `ui/connector-card-actions.component.ts:106`; `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts:977-1007`; `chat/.../mcp-status-chip.component.ts`, `mcp-server-list.component.ts:24-41` |
| marketplace/connected-apps.md | edited | Retitled "Custom URL (OAuth servers)" (slug kept). Removed VS Code/CLI redirect rows and the unbacked 5-minute limit. | `marketplace/src/lib/oauth-surface.component.ts:58-61,149-340`; `cli-agent-runtime/.../oauth/loopback-oauth-callback-listener.ts:36`; `mcp-install.service.ts:561`; `oauth/mcp-oauth-override-resolver.ts:6,68` |
| marketplace/smithery.md | edited | Install button is **Install server** (was "Set up server"); removed "Ready"/"Installed" badge story and settings.json manual config. | `marketplace/src/lib/smithery-surface.component.ts:61-70,104,176-230,490-600,770,1055`; `smithery-wire.constants.ts:10-16` |
| marketplace/mcp-registry.md | edited | Install targets (Claude, VS Code, Cursor, Copilot, Codex, Antigravity); removed Settings → MCP panel. | `pages/servers/server-source-host.component.ts:53-79`; `cli-agent-runtime/.../mcp-install.service.ts:91-98` |
| plugins/index.md | edited | Five official plugins (added `ptah-dotnet`; removed "marketing video", "Ptah CLI usage"). Added kinds: harness, skills.sh, external. | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:316-397,405-450` |
| plugins/marketplace.md | edited | Catalog is a panel at **Marketplace → Sources → Ptah Plugins** (no Configure button/modal); added Creative Tools and From Marketplaces categories. | `chat-ui/.../plugin-catalog-panel.component.ts:90-105`; `marketplace/.../pages/skills/skill-source-host.component.ts:100-125`; `dashboard/.../skill-selection-card.component.ts:140-165` |
| plugins/installing.md | edited | Junctions → copies. Config now one record per project root in global state `ptah.plugins.harnessConfig:<root>` with 5 lists (doc said workspace `ptah.plugins.config`, 3 lists). Removed VS Code Memento. | `agent-sdk/src/lib/helpers/plugin-config-home.ts:1-60`; `rpc-handlers/.../plugin-rpc.handlers.ts:521`; `harness-manifest.builder.ts:34-40` |
| plugins/skill-toggles.md | edited | Trimmed; path fixed. | `plugin-catalog-panel.component.ts` template |
| plugins/skill-selection.md | edited | Trimmed; strings verified. | `plugin-catalog-panel.component.ts` template; dashboard skill-selection card |
| plugins/harness-plugins.md | edited | Scope folders (`{workspace}/.ptah/plugins` default); skills.sh is opt-out too; removed junction/mirror internals and changelog note. | `plugin-loader.service.ts:427-470`; `tool-description.builder.ts:1555-1566` |
| plugins/plugin-storage.md | edited | Added `ptah-dotnet`; removed junction mention; trimmed. | `libs/backend/platform-core/src/content-download.service.ts:21,91,101,262-263,592,601`; `content-manifest.json`; `apps/ptah-electron/src/activation/boot-heavy-services.ts:253` |
| plugins/creating-plugins.md | edited | Removed "no third-party channel" (external GitHub marketplaces exist) and `assets/plugins/` (official path is `plugins/`). Junctions → copies. | `libs/backend/plugin-marketplace/src/lib/github/github-content.client.ts:121-131`; `install/external-plugin-id.ts:82-90`; `marketplace/.../external-marketplaces.component.ts:130-150` |
| skill-synthesis/index.mdx, how-it-works.mdx, the-skills-tab.mdx, settings.md, skill-md-anatomy.mdx | kept | Labels verified (Rebase to upstream, Keep mine, Enhance now, No grade, Skill telemetry, Background Model Roles). | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/*`; `file-settings-keys.ts:207-213,420-425` |
| templates/index.md | edited | Templates are agent templates for agent generation (no Templates panel, no scaffolds, no prompt recipes). Real template list. | `libs/backend/agent-generation/templates/agents/` listing; `template-storage.service.ts:50,78` |
| templates/using-templates.md | edited | Retitled "How Templates Are Used": applicabilityRules selection, write to `.claude/agents/`. Removed Templates panel, Apply/Preview, diff view. | `template-storage.service.ts:307,507-553`; `file-writer.service.ts:59`; `orchestrator.service.ts:150-165` |
| templates/creating-templates.md | edited | Real frontmatter (`templateId`, `templateVersion`, `applicabilityRules`, `model`, `variables` slots), `STATIC` shared blocks. Removed scaffolds/Handlebars/"Ptah: Reload Templates". | `templates/agents/frontend-developer.template.md:1-30`; `template-partial-resolver.ts:1-30` |
| templates/template-storage.md | edited | Added `_shared/`; trimmed. | `content-manifest.json` (templates basePath) |

## Deleted files

- `apps/ptah-docs/src/content/docs/automation/messaging/stream-coalescing.md` — the gateway uses the coalescer in `'complete'` mode (one message per turn, no live edits) and nothing reads `gateway.coalesceMs` (`outbound-delivery.service.ts:210-218`).
- `apps/ptah-docs/src/content/docs/automation/messaging/voice-messages.md` — no adapter supplies `voicePath` (Telegram sets `voicePath: undefined`, `grammy.adapter.ts:355`; Discord/Slack have no audio handling), so no voice note is transcribed.
- `apps/ptah-docs/src/content/docs/browser-automation/launching-a-browser.mdx` — invented settings (Settings → Browser → Executable / Run headless / Persist profile), bundled Chromium, per-workspace profile. Real session rules moved to the index.
- `apps/ptah-docs/src/content/docs/browser-automation/navigation.mdx` — invented args (`waitUntil`, `timeoutMs`); real args are in the index table.
- `apps/ptah-docs/src/content/docs/browser-automation/interacting.mdx` — invented args (coordinates, `button`, `clickCount`, `delayMs`, `clearFirst`); click/type take a CSS selector only.
- `apps/ptah-docs/src/content/docs/browser-automation/reading-content.mdx` — duplicate of the tool table; no unique backed content.
- `apps/ptah-docs/src/content/docs/browser-automation/network-monitoring.mdx` — only real fact (`limit`, 500 cap) moved to the index.
- `apps/ptah-docs/src/content/docs/browser-automation/screenshots.mdx` — wrong defaults (PNG/90, `selector`, `omitBackground`, `path`); real facts moved to the index.
- `apps/ptah-docs/src/content/docs/browser-automation/recording.mdx` — invented args (`fps`, `scale`, `maxDurationMs`, `loop`, `path`); real `maxFrames`/`frameDelay` moved to the index.
- `apps/ptah-docs/src/content/docs/plugins/managing.md` — duplicated installing + plugin-storage, and described a Configure modal and junction rebuild that no longer exist.
- `apps/ptah-docs/src/content/docs/skill-synthesis/background-learning.mdx` — stub that only said the feature was removed (changelog note); not in the sidebar, no inbound links.
- `apps/ptah-docs/src/content/docs/skill-synthesis/reviewing-candidates.mdx` — same: removal stub only; not in the sidebar, no inbound links.

## Sidebar changes needed

Remove (`apps/ptah-docs/astro.config.mjs`):
- `automation/messaging/voice-messages` (line 124)
- `automation/messaging/stream-coalescing` (line 125)
- `plugins/managing` (line 153)
- `browser-automation/launching-a-browser`, `navigation`, `interacting`, `reading-content`, `screenshots`, `network-monitoring`, `recording` (lines 174-180). The section keeps only `browser-automation` (Overview); consider turning it into a single link.

Rename labels (slugs unchanged):
- `marketplace/connected-apps`: "Connected Apps" → "Custom URL" (line 143).
- `templates/using-templates`: "Using Templates" → "How Templates Are Used" (line 165).
- `automation/cron/catchup-and-power`: "Catchup & Power" → "Catch-up & Power" (optional, line 116).

## Inbound links to fix

None. A link check over every page in `apps/ptah-docs/src/content/docs` found no link to a deleted page, and all anchor links into my scope still resolve (`#skill-dependencies`, `#the-mcp-chip-in-chat`, `#how-it-interacts-with-the-other-two-gates`, `#harness-sync--sharing-across-ai-clients`). The only broken link found is outside my scope and unrelated: `troubleshooting/index.mdx:29 -> /troubleshooting/reporting-bugs/`.

Stale text outside my scope (for the owning lane): `troubleshooting/mcp-port-conflicts.mdx:14,48` names "Settings → MCP → Port/Status"; the real path is **Settings → Advanced → MCP & Browser → MCP port** and there is no status view.

My pages link to `/setup/setup-wizard/` and `/setup/ai-team-builder/` (L1 scope). If L1 deletes or renames them, update `templates/index.md`, `templates/using-templates.md`, `plugins/harness-plugins.md`, `plugins/creating-plugins.md`.

## Gaps

- Marketplace: no page for **Overview**, **MCP Servers** (installed servers), **Skills & Plugins**, **Community** (skills.sh), or **Marketplaces** (external GitHub plugin marketplaces with the consent/install report). Only short rows in `marketplace/index.md` and `plugins/creating-plugins.md`.
- **Settings → Advanced → MCP & Browser** panel (port, External MCP callers, namespace toggles, Allow localhost) has no page of its own; covered only inside `built-in-mcp-server.md` and `browser-automation/index.md`.
- Cron **Review runs** link (`/review-runs` route from the Schedules tab) is undocumented.
- `gateway.permissionLevel` has no UI and is not a `settings.json` key, so users cannot easily change it (product gap).
- Messaging voice: the Messaging tab shows a Voice stat and a Whisper model download, but no adapter downloads audio (product gap).
- Remote machines (out of my scope) — see facts.md.

## Decisions

| Decision | Options | Evidence |
| -------- | ------- | -------- |
| Collapse browser-automation into one page and delete 7 subpages | rewrite each / collapse | Every subpage had invented arguments; the real per-tool surface fits one table (`tool-description.builder.ts:1177-1470`). Agents read tool schemas from the server, so per-tool pages duplicate them. |
| Delete RPC method tables (cron, gateway) | keep / delete | Internal renderer↔main contract with no user entry point; already wrong (`rejectBinding`/`revokeBinding` absent, `rpc.types.ts:2541-2605`). |
| Document `gateway.permissionLevel` without a "how to set" step | document file edit / say no UI | Not in `FILE_BASED_SETTINGS_KEYS`; Electron reads it from its own config file (`electron-workspace-provider.ts:99-105`). |
| Keep `marketplace/connected-apps` slug, retitle "Custom URL" | rename file / retitle | Avoids a sidebar slug change and inbound link churn; nav label is "Custom URL" (`marketplace-nav.component.ts:104`). |
| Rewrite templates section around agent templates instead of deleting it | delete section / rewrite | Agent templates exist and ship via content download (`templates/agents/*.template.md`, `template-storage.service.ts:50`); scaffolds and the Templates panel do not. |
| Keep the two video embeds (`ptah-mcp-server.mp4`, `plugins.mp4`) | remove / keep | Files exist in `apps/ptah-docs/public/assets/videos/`; rule 7 says keep asset references. Their content was not checked; they may show older UI. |
| Keep skill-synthesis how-it-works.mdx despite overlap with the-skills-tab | delete / keep | It holds the only description of the grade formula (`.ptah/specs` reviews); it is in the sidebar. |

## Verification

- `node apps/ptah-docs/scripts/check-screenshot-refs.mjs` → "29 reference(s) across the docs all resolve." (5 unreferenced images reported; none were referenced by my deleted pages.)
- Custom internal-link check (`/tmp/l3/links.js`, read-only) over all docs pages: no broken links into or out of my scope.
- No build, serve, or `npm run verify` run (markdown only). No git commands that change state.
