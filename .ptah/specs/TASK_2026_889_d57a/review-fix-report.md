# Review fix report: docs app fact-check (TASK_2026_889_d57a)

Input: `docs-app-review.md`, section `## Defects`, items 1-10.
Scope: edits only under `apps/ptah-docs/src/content/docs/`. No commit, no push.

Result: 9 defects applied in full. Defect 9 applied in part: two of its four targets
(`memory/forgetting.md:38` and `:62-66`) do not exist in the worktree. All doc paths below
are relative to `apps/ptah-docs/src/content/docs/`.

## Fixes

| Defect # | Doc file:line changed | Source evidence file:line | Result |
| --- | --- | --- | --- |
| 1 | `reference/file-locations.md:13`, `automation/index.mdx:21`, `automation/cron/index.md:10`, `automation/cron/creating-a-job.md:31`, `automation/cron/settings.md:27`, `automation/messaging/settings.md:53` | `libs/backend/persistence-sqlite/src/lib/db-path.ts:11-15,54-65` (production file `~/.ptah/state/ptah.sqlite`). Called from `apps/ptah-electron/src/di/phase-2-libraries.ts:362`. Also `sqlite-connection.service.ts:321` names `~/.ptah/state/ptah.sqlite`. | Applied. `~/.ptah/ptah.db` → `~/.ptah/state/ptah.sqlite` in all 6 places. Note: the reviewer said `SqliteConnectionService` calls `resolvePtahDbPath()`. It does not. The Electron DI phase 2 calls it. The fix is still correct. |
| 2 | `index.mdx:76`, `index.mdx:96` | `libs/frontend/canvas/src/lib/canvas-board-mode.ts:1,14-15` (`CanvasBoardMode = 'rail'` only). Split view: `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:17,73` (**Close split**). No file tree hits remain in the docs. | Applied with the proposed wording. |
| 3 | `chat/switching-models.md:22` | `libs/backend/auth-providers/src/lib/auth/effective-route.ts:39-43,88-91` (`llm.defaultProvider` is not used for the main agent). **Main agent** section: `libs/frontend/chat/src/lib/settings/providers/main-agent-section.component.spec.ts:71`, `providers/index.md:49`. | Applied. Removed the `llm.defaultProvider` claim. Points to the **Main agent** section on **Settings → Providers**. |
| 4 | `sessions/analytics.md:12`, `plugins/marketplace.md:13`, `plugins/skill-selection.md:10` | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:119-131` (button hidden in Electron). `electron-shell.component.ts:300-311` (**Analytics** tab). `apps/ptah-extension-webview/src/app/app.routes.ts:115-120`. `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:7,15,20,22` (back button `aria-label="Back to chat"`, `Dashboard` heading, skill selection card, analytics card). | Applied. The back control is an icon button, so the text now says "click the back arrow (**Back to chat**)". |
| 5 | `sessions/cost-summary.md:26` | `libs/shared/src/lib/types/session-budget.types.ts:19` (`'tokens' \| 'cost'`), `:161-165` (`values: ['tokens', 'cost']`), `:148-150` (an invalid value falls back to the default). | Applied. Description is now ``Budget unit: `tokens` or `cost` (USD).`` |
| 6 | `agents/built-in-agents.md:59-63` → one line at `:59` | Doc-only defect. Lines 59-63 had a duplicate sentence, a `0x01` control character on line 61, and a stray closing `:::`. The file now has no `:::` fence. | Applied. Also split the semicolon sentence into two sentences. |
| 7 | `tasks/index.md:10`, `tasks/index.md:141` | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:276-287` (`role="tab"` **Tasks** button in the title-bar tab strip). | Applied. "navigation rail" → "tab bar". `PtahCodeCode` → `PtahCode`. |
| 8 | `workspace/workspace-intelligence.md:25`, new paragraph at `:32` | `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:240-245` (`<ptah-workspace-indexing>` under **Advanced indexing** on the **Code index** view), `:274-282` (`<ptah-memory-indexing-banner>` on the default **Memories** view), `:348-354` (view tab labels). `libs/frontend/chat/src/lib/settings/settings.component.ts:200-205` (no Workspace Indexing tab). Labels: `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html:99,173,183,192,222` (Index now, Re-index, Pause, Cancel, Resume). `memory-indexing-banner.component.ts:62,112,130,137,156` (Index now, Cancel, Resume, Re-index, no Pause). | Applied in adapted form. The cited `## Indexing controls in Settings` heading no longer exists, because commit `ef130b4e3` rewrote the page. The current text listed the controls but gave no location. Added the location **Thoth → Memory** and which view has which controls. |
| 9 | `memory/how-it-works.md:44`, `memory/searching.md:42,44` | Curator model: `libs/frontend/chat/src/lib/settings/providers/agents-routing-settings.component.ts:126,136` (**Background Model Roles**, role label "Memory curator"). Views: `memory-curator-tab.component.ts:223-246` (`@case ('code')` holds `<ptah-memory-indexed-code>`), `:348-354`. | Applied for `how-it-works.md` and `searching.md`. The UI label is "Memory curator" (lowercase c), not "Memory Curator". Rejected for `memory/forgetting.md:38,62-66`: the file does not exist. The nearest page is `memory/pinning-and-forgetting.md`, and it has no Danger zone, Maintenance, Purge junk, or Rebuild search index text (`git grep` gives no hits in the docs). Nothing to fix. |
| 10 | `automation/messaging/settings.md:19` | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:156-162,173,871-874` (reads section `'ptah'`, key `gateway.permissionLevel`). `libs/backend/platform-core/src/file-settings-keys.ts:248-266,547-553` (key is not in `FILE_BASED_SETTINGS_KEYS` and matches no file-based pattern). `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:69,94-106,246-252` (non-file-based keys come from `this.config[section][key]`, loaded from `<globalStoragePath>/config.json`). `libs/backend/platform-electron/src/registration.ts:170-173` (`globalStoragePath` = `options.userDataPath`). | Applied. The doc now says the key is read from the `"ptah"` object in `config.json` in the Electron user-data folder, with a link to `/reference/file-locations/#electron-user-data` (heading at `reference/file-locations.md:27`). |

## Extra hits fixed

- `git grep -n "ptah.db" -- apps/ptah-docs`: 6 hits. All 6 are the defect 1 locations. All are fixed. A second run gives 0 hits.
- `git grep -n "PtahCodeCode" -- apps/ptah-docs`: 1 hit (`tasks/index.md:141`). Fixed. A second run gives 0 hits.
- `git grep -n "navigation rail" -- apps/ptah-docs`: 0 hits after the fix.

## Verification

- `node apps/ptah-docs/scripts/check-screenshot-refs.mjs`: "29 reference(s) across the docs all resolve". It also reports 5 unreferenced screenshot files. That is not related to this change.
- Frontmatter is not changed in any file. The only removed fence is the stray `:::` in `agents/built-in-agents.md`.
- New internal link `/reference/file-locations/#electron-user-data` matches the heading `## Electron user data`.
- No build, serve, or Astro check ran (not permitted by the task rules).

## Decisions

- **Defect 8: target text moved.** Options: reject (heading gone) or fix the current text. Evidence: the current text lists the controls with no location. Decision: add the correct location. Reversible.
- **Defect 9: `forgetting.md` absent.** Options: edit `pinning-and-forgetting.md` or record a rejection. Evidence: that page has no UI navigation for Danger zone or Maintenance. Decision: no edit. A new section would be new content, which is out of scope. Reversible.
- **Defect 9: label case.** Used "Memory curator", as in `agents-routing-settings.component.ts:136`, and not the proposed "Memory Curator". Reversible.
- **Defect 4: back control.** Used "back arrow (**Back to chat**)", because the control is an icon button with `aria-label="Back to chat"` (`dashboard-grid.component.html:7`). Reversible.
