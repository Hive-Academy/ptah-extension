# Context — TASK_2026_258

## Origin

A documentation coverage audit run alongside TASK_2026_239 checked three surfaces — the
Tasks board, Plugins, and the shipped `ptah-core` skills. Plugins came back
`COVERED BUT STALE`, and the staleness is the actively harmful kind.

The irony worth recording: the _runtime-download_ story — plugins and templates are not
bundled in the installer, they download from GitHub via `ContentDownloadService` — was the
part suspected of being undocumented, and it is the one part the pages get right
(`plugins/index.md:21-37`, `plugins/plugin-storage.md:1-58`). Everything written around it
is wrong.

Three claims were independently spot-checked before this task was filed:

- The five `Ptah: …Cache…` palette commands appear **only** in the docs' own build
  data-store — i.e. in the docs text itself. Zero hits in `apps/` or `libs/` source.
- No `.versions` directory exists anywhere in `content-download.service.ts` or
  `libs/frontend/marketplace/`.
- Cache metadata is `~/.ptah/.content-cache.json` at `MAX_CONCURRENCY = 10`
  (`content-download.service.ts:76,86`), not `~/.ptah/cache/content-manifest.json` at 8.

## Sources of truth

| Concern                    | File                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| The actual plugin UI       | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.ts`        |
| Plugin surface shell       | `libs/frontend/marketplace/src/lib/**` (`plugins-surface.component.ts`, `providers.registry.ts`) |
| Download / cache / pruning | `libs/backend/platform-core/src/content-download.service.ts`                                     |
| Enablement state           | `plugin-loader.service.ts` (`PLUGIN_CONFIG_KEY` on `workspaceState`)                             |
| Bundled plugin set         | `apps/ptah-extension-vscode/assets/plugins/`                                                     |

## What the docs claim that does not ship

**`plugins/managing.md` documents an entire management UI that does not exist.** An
"Installed" tab, an Update badge, a `⋯` → Uninstall row menu, a `⟳ Refresh` control,
version rollback from `~/.ptah/plugins/<name>/.versions/` behind a "Version history"
button, and settings keys `plugins.autoUpdate` / `plugins.checkInterval`.

What ships is one modal titled **"Configure Ptah Skills"**: a search box, category groups,
checkboxes, and Cancel / Save Configuration. There is no installed tab, no per-plugin
update, no uninstall, no rollback, no `.versions/` anywhere, and no `plugins.autoUpdate`.

**Invented command-palette commands.** `Ptah: Open Plugin Cache Folder`,
`Ptah: Clear Plugin Cache`, `Ptah: Show Content Manifest`
(`plugin-storage.md:97-101`, `managing.md:36,70`), and
`Ptah: Open Template Cache Folder` / `Ptah: Clear Template Cache`
(`templates/template-storage.md:55-57`). None are registered.

**Three contradictory answers for enabled-plugin state, all wrong.**

| Page                                                      | Claim                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `plugins/installing.md:37-49`                             | `<workspace>/.ptah/workspace-settings.json` → `enabledPlugins`                                               |
| `reference/glossary.md:16`, `reference/file-locations.md` | `<workspace>/.ptah/plugins.json`                                                                             |
| Reality                                                   | Memento-backed workspace state storage — not a file in the repo (`plugin-loader.service.ts:209-210,345-362`) |

`installing.md:58` then advises committing `.ptah/workspace-settings.json` "so teammates
share the same plugin set". That file does not exist. This is the single most misleading
line in the section.

**False cache behaviour.** "Content-addressed caching — files with unchanged hashes are
skipped" (`plugin-storage.md:81`) and "you only re-download files that actually changed"
(`managing.md:17`). There is exactly **one** `contentHash`, for the whole manifest; if it
differs, every file re-downloads (`content-download.service.ts:187-229`). All-or-nothing.

**False integrity claim.** "Each file's size and hash are validated before it's written"
(`plugin-storage.md:83`). No per-file hash or size check exists — `downloadToFile` writes
what came over HTTP via temp+rename (lines 366-373). The real safety property, a
**path-traversal guard** (lines 334-339), goes unmentioned.

**False retry claim.** "Installs and updates are queued and retried automatically when
connectivity returns" (`plugin-storage.md:91`; same for templates at
`template-storage.md:49`). There is no queue and no retry — `ensureContent` returns a
failure result and stops (lines 108-127).

**Wrong numbers and paths.** Concurrency is 10, not 8. Templates are written to
`~/.ptah/templates/agents/`, not `~/.ptah/templates/` (`content-download.service.ts:85`).

**Marketplace UI that isn't there** (`plugins/marketplace.md:50-69`): a "Browse
Marketplace" button, stack filters (Angular/React/Nx/Node), contribution filters, a detail
pane with version/author/README, and `SKILL.md` hover-preview. Search matches name,
description and keywords only (`plugin-browser-modal.component.ts:476-490`). The two
referenced screenshots — `/screenshots/plugin-marketplace.png`,
`/screenshots/plugin-enable-toggle.png` — presumably show none of it and should be checked.

**Conflict-resolution rules and a "Problems panel" warning** (`installing.md:61-68`). No
Problems panel exists in the app.

## What ships that the docs never mention

- **A fifth bundled plugin, `ptah-video`**, registered under category `creative-tools`
  (`plugin-loader.service.ts:120-127`). The table at `plugins/index.md:41-46` lists four.
  Site-wide, `ptah-video` appears once, in passing, at `agents/built-in-agents.md:77`.
- **Five display categories**, not three: Core Tools, Backend Tools, Frontend Tools,
  Creative Tools, **Your Skills** (`plugin-browser-modal.component.ts:40-54`).
- **Harness plugins are opt-OUT.** A `ptah-harness-*` directory found on disk is enabled
  the moment it exists and is disabled only by an explicit `disabledPluginIds` entry, while
  bundled plugins are opt-in via `enabledPluginIds`. A checked harness plugin is
  deliberately kept _out_ of `enabledPluginIds` — mirroring would freeze its skills at
  mirror time (`plugin-browser-modal.component.ts:56-65,618-707`). This is the visible
  bridge between Skill Synthesis and Plugins and neither section mentions it.
- **Per-skill toggles inside a plugin**, persisted as `disabledSkillIds`
  (`plugin-browser-modal.component.ts:300-343,575-594`). No page says skill-level
  granularity exists.
- **`pruneStaleFiles` deletes local files absent from the manifest**
  (`content-download.service.ts:200-201,265-275`). Users are never told `~/.ptah/plugins/`
  is authoritatively pruned.
- **A live sixth Marketplace provider, "Connected Apps"** — `oauth-mcp`, status `live`,
  backed by `oauth-surface.component.ts` (`providers.registry.ts:55-63`). The provider
  table at `marketplace/index.md:16-22` lists five.
- **`ptah-core` ships 8 skills**, not the 5 listed at `plugins/marketplace.md:35-47`:
  `ddd-architecture`, `humanize-library`, `orchestration`, `ptah-cli-usage`,
  `skill-creator`, `technical-content-writer`, `tribunal`, `ui-ux-designer`.

## Scope

**In scope** — correcting the Plugins section and the pages that repeat its errors:

| File                                                   | Action            |
| ------------------------------------------------------ | ----------------- |
| `plugins/managing.md`                                  | Rewrite           |
| `plugins/marketplace.md`                               | Rewrite           |
| `plugins/plugin-storage.md`                            | Correct in place  |
| `plugins/installing.md`                                | Correct in place  |
| `plugins/index.md`                                     | Correct (4 → 5)   |
| `plugins/skill-toggles.md`                             | NEW               |
| `plugins/harness-plugins.md`                           | NEW               |
| `marketplace/connected-apps.md`                        | NEW               |
| `templates/template-storage.md`                        | Correct in place  |
| `reference/glossary.md`, `reference/file-locations.md` | Correct           |
| `astro.config.mjs`                                     | 3 sidebar entries |

**Out of scope**

- The Tasks-board gap (`NO COVERAGE`) and the two missing skill pages
  (`humanize-library`, `ptah-cli-usage`) from the same audit. Both are separately
  worthwhile; neither belongs in this task.
- Changing any plugin behaviour. The shipped components are the authority.
- Regenerating the two stale screenshots. Flag them; a capture pass is its own job.

## Conventions

- Plugins, Marketplace and Templates all use **explicit `items`** in `astro.config.mjs`.
  The site never mixes `autogenerate` and explicit items within one section, so each new
  page needs its own entry.
- `nx build ptah-docs` is the gate. There is deliberately no `check` target
  (TASK_2026_249).
