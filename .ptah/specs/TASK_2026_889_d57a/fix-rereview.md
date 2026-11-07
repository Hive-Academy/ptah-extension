# Docs Fix Re-Review (`apps/ptah-docs`) — TASK_2026_889_d57a

## Verdict

**APPROVED**

- All 10 defects from `docs-app-review.md` are resolved against the current source tree (`git diff` across 17 files under `apps/ptah-docs/src/content/docs/`).
- The writer's rejection of the two `memory/forgetting.md` sub-items in Defect #9 is verified: `apps/ptah-docs/src/content/docs/memory/` contains 5 files (`how-it-works.md`, `index.mdx`, `pinning-and-forgetting.md`, `searching.md`, `settings.md`), `memory/forgetting.md` does not exist, and none of the 5 existing memory pages describe **Danger zone**, **Maintenance**, **Purge junk entries**, or **Rebuild search index** in a wrong location.
- Structural checks pass: `node apps/ptah-docs/scripts/check-screenshot-refs.mjs` exits `0` (`29 reference(s) across the docs all resolve`), frontmatter is untouched across all 17 edited files, the stray `:::` fence in `agents/built-in-agents.md` is removed, and the new internal anchor link `/reference/file-locations/#electron-user-data` in `automation/messaging/settings.md:19` resolves to `## Electron user data` at `reference/file-locations.md:27`.

## Per-defect

| Defect # | Resolved (yes/no) | Evidence `file:line` |
| --- | --- | --- |
| 1 | yes | Doc: `apps/ptah-docs/src/content/docs/reference/file-locations.md:13`, `automation/index.mdx:21`, `automation/cron/index.md:10`, `automation/cron/creating-a-job.md:31`, `automation/cron/settings.md:27`, `automation/messaging/settings.md:53` (`~/.ptah/state/ptah.sqlite`). Source: `libs/backend/persistence-sqlite/src/lib/db-path.ts:11-15,54-65`. |
| 2 | yes | Doc: `apps/ptah-docs/src/content/docs/index.mdx:76,96`. Source: `libs/frontend/canvas/src/lib/canvas-board-mode.ts:1,14-15` (`mode: 'rail'`), `apps/ptah-docs/astro.config.mjs:13-16`. |
| 3 | yes | Doc: `apps/ptah-docs/src/content/docs/chat/switching-models.md:22`. Source: `libs/backend/auth-providers/src/lib/auth/effective-route.ts:39-43,88-101`, `libs/frontend/chat/src/lib/settings/providers/main-agent-section.component.ts:60-61`. |
| 4 | yes | Doc: `apps/ptah-docs/src/content/docs/sessions/analytics.md:12`, `plugins/marketplace.md:13`, `plugins/skill-selection.md:10`. Source: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:300-311`, `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:3-16,20-22`. |
| 5 | yes | Doc: `apps/ptah-docs/src/content/docs/sessions/cost-summary.md:26` (``Budget unit: `tokens` or `cost` (USD).``). Source: `libs/shared/src/lib/types/session-budget.types.ts:18-19,161-165`. |
| 6 | yes | Doc: `apps/ptah-docs/src/content/docs/agents/built-in-agents.md:59` (duplicate sentence, `0x01` byte, and stray `:::` removed). Source: `apps/ptah-docs/src/content/docs/agents/built-in-agents.md:57-60`. |
| 7 | yes | Doc: `apps/ptah-docs/src/content/docs/tasks/index.md:10,141` (`in the tab bar`, `PtahCode`). Source: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:276-287`. |
| 8 | yes | Doc: `apps/ptah-docs/src/content/docs/workspace/workspace-intelligence.md:25-32` (**Thoth → Memory**, **Advanced indexing** on **Code index**, and indexing banner on **Memories**). Source: `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:222-246,274-282,348-354`, `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html:99,173,183,192,222`, `libs/frontend/memory-curator-ui/src/lib/components/memory-indexing-banner.component.ts:62,112,130,137,156`. |
| 9 | yes | Doc: `apps/ptah-docs/src/content/docs/memory/how-it-works.md:44` (**Settings → Providers → Background Model Roles** (**Memory curator**)), `memory/searching.md:42,44` (**Code index** view tab in **Thoth → Memory**); `memory/forgetting.md` absent and `memory/{how-it-works.md,index.mdx,pinning-and-forgetting.md,searching.md,settings.md}` contain no misplaced Danger zone / Maintenance / Purge junk / Rebuild search index claims. Source: `libs/frontend/chat/src/lib/settings/providers/agents-routing-settings.component.ts:126,136`, `libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts:240-241`, `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:222-246,348-354`. |
| 10 | yes | Doc: `apps/ptah-docs/src/content/docs/automation/messaging/settings.md:19` (`"ptah"` object in `config.json` in the Electron user-data folder, linking to `/reference/file-locations/#electron-user-data` at `reference/file-locations.md:27`). Source: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:156-162,173`, `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:69,94-106`. |

## New defects

none
