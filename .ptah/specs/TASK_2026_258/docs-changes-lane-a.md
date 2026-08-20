# Lane A changelog — TASK_2026_258 (Plugins section)

Scope: `apps/ptah-docs/src/content/docs/plugins/**` + `apps/ptah-docs/astro.config.mjs`.
Lane B's files (`marketplace/**`, `templates/**`, `reference/**`) untouched.

## Sources read before writing

| Claim area                       | File read                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The modal, categories, search    | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.ts`                                                     |
| Status widget / entry point      | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-status-widget.component.ts`                                                     |
| Surface shell + provider list    | `libs/frontend/marketplace/src/lib/plugins-surface.component.ts`, `providers.registry.ts`                                                     |
| Enablement + harness discovery   | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`                                                                             |
| Save path, validation, junctions | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`                                                                           |
| Junction / collision rules       | `libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts`                                                                            |
| Download / cache / prune         | `libs/backend/platform-core/src/content-download.service.ts`                                                                                  |
| Config shape                     | `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:284-361`                                                                                     |
| Harness authoring                | `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts`, `libs/backend/vscode-lm-tools/.../harness-namespace.builder.ts:302-349` |
| Bundled plugin trees             | `apps/ptah-extension-vscode/assets/plugins/**` (read only, not written)                                                                       |

## Files touched

### `plugins/index.md` — corrected

- Plugin table 4 → **5**; added `ptah-video` (Creative Tools, 1 skill `video-showcase`). Each row now
  carries the modal category and verified counts (8/7/3/3/1 skills; 5/2/0/0/0 commands — counted on disk,
  matching `AVAILABLE_PLUGINS`).
- Cache tree now lists all five plugins and `templates/agents/` (was `templates/`).
- **Deleted as false:** "agents, skills, templates and slash commands" as the plugin contribution set.
  No bundled plugin has an `agents/` or `templates/` directory, and nothing in the loader or junction
  service reads either. Only `skills/` and `commands/` are consumed.
- Next-steps list extended with the two new pages.

### `plugins/managing.md` — rewritten

**Deleted as false:** the Installed tab; the Update badge and per-plugin Update button; auto-update
(`plugins.autoUpdate` / `plugins.checkInterval`); the `⟳ Refresh` control; `Ptah: Refresh Plugin
Marketplace`; `Ptah: Clear Plugin Cache`; the `⋯` → Uninstall row menu and its three-item deletion list;
version rollback, "Version history", and `~/.ptah/plugins/<name>/.versions/`; "you only re-download files
that actually changed".

**Replaced with:** reopening **Marketplace → Plugins → Configure** as the whole management surface; a
control table for the one modal (search, category groups, checkbox, chevron, Cancel, Save Configuration);
unchecking-and-saving as the real disable flow, with the honest note that files stay in `~/.ptah/plugins/`
because the cache is global while enablement is per workspace; the all-or-nothing cache stated plainly;
deleting `~/.ptah/.content-cache.json` as the actual recovery move.

### `plugins/marketplace.md` — rewritten

Title changed `Plugin Marketplace` → **Plugin Catalog** (slug unchanged, so inbound links still resolve).

**Deleted as false:** the "Browse Marketplace" button; stack filters (Angular/React/Nx/Node); contribution
filters; the detail pane with version/author/README/install controls; `SKILL.md` hover preview; "keyword
search against … skill titles"; the Agents and Templates rows of the contribution table; the "marketplace
is online-only" framing (the list is local metadata); both screenshot references — see below.

**Replaced with:** the real open path; the five categories in their fixed render order, and the note that
empty categories are hidden (which is why **Your Skills** is invisible until you author one); search
matching name / description / keywords only, case-insensitive, resetting on close; the actual row badges
(Recommended, Yours, skill count, command count) and the fact that the skill count is read from disk once
downloaded; the corrected `ptah-core` tree — **8** skills (`ddd-architecture`, `humanize-library`,
`orchestration`, `ptah-cli-usage`, `skill-creator`, `technical-content-writer`, `tribunal`,
`ui-ux-designer`) and **5** commands, was 5 skills and 2 commands.

### `plugins/installing.md` — corrected in place

**Deleted as false:** `<workspace>/.ptah/workspace-settings.json` and its `enabledPlugins` example; the
advice to commit it "so teammates share the same plugin set" (the single most misleading line in the
section — the file does not exist); the "Plugins → Installed" toggle-off instructions; "alphabetical by
plugin name" load order; the entire **Problems panel** conflict warning; the
`/screenshots/plugin-enable-toggle.png` image.

**Replaced with:** enablement stored in the host's per-workspace state store (`workspaceState` Memento)
under key `ptah.plugins.config`, with a field table for `enabledPluginIds` / `disabledPluginIds` /
`disabledSkillIds` / `lastUpdated`, and an explicit "nothing to commit, nothing to gitignore, no
mechanism today for sharing a selection through version control"; the real save sequence (persist →
resolve paths, dropping unknown IDs and missing directories → invalidate command cache → rebuild
junctions + copy commands); a note that enabling is not downloading; the real collision rule —
first plugin path wins, later ones skipped with a **log** warning, a pre-existing real directory at
`.claude/skills/<name>` left untouched, and no conflict UI anywhere.

### `plugins/plugin-storage.md` — corrected in place

**Deleted as false:** `~/.ptah/cache/content-manifest.json`; concurrency "default 8"; "content-addressed
caching — files with unchanged hashes are skipped"; "each file's size and hash are validated before it's
written"; "new plugin installs and updates are queued and retried automatically"; the Offline banner; the
three `Ptah: …` cache commands (`Open Plugin Cache Folder`, `Clear Plugin Cache`, `Show Content Manifest`)
— none is registered anywhere in `apps/` or `libs/`.

**Replaced with:** `~/.ptah/.content-cache.json` and what it actually stores (hash + timestamp + counts,
not a manifest copy); `~/.ptah/templates/agents/`; concurrency **10**; one manifest-level `contentHash`,
all-or-nothing; `pruneStaleFiles` deleting any local file not listed in the manifest; atomic temp+rename
writes; the **path-traversal guard** named as the real safety property; redirect limit 5 and the 30 s
request timeout; per-file failure counting; "no retry queue" stated explicitly; a plain-shell table
replacing the invented commands.

### `plugins/skill-toggles.md` — NEW

Per-skill checkboxes inside an expanded, enabled plugin; the chevron's render condition; `disabledSkillIds`
as bare directory names in a flat global namespace; disabled skills skipped at junction build and their
stale junctions removed; commands unaffected; a 4-row interaction matrix for plugin × skill state; toggles
surviving a plugin being unchecked; the save-time validation that drops skill IDs matching nothing; the
footer counter.

### `plugins/harness-plugins.md` — NEW

`ptah-harness-<slug>/skills/<slug>/SKILL.md` layout and who writes it; the **Your Skills** category and the
**Yours** badge; name/description/skill-count all derived live from disk with nothing cached; opt-out vs
opt-in stated as a table with the reason (you already said yes by clicking Apply); `disabledPluginIds` as
the denylist; the two consequences (status count is not `enabledPluginIds.length`; pre-denylist configs
load unchanged, no migration); and the section this page exists for — why a **checked** harness plugin is
deliberately kept out of `enabledPluginIds`, because that list drives the user-layer mirror, mirrored
entries win on collision, and mirroring would freeze the skills at mirror time and hide later wizard edits.
Closes with the prune caution (below).

### `astro.config.mjs` — 3 sidebar entries

- Plugins: `Skill Toggles` and `Harness Plugins`, placed after Managing and before Plugin Storage.
- Marketplace: `Connected Apps` between `MCP Registry` and `Smithery`, per instruction (page authored by
  Lane B; the file existed by build time and the page rendered).
- One extra edit: the Plugins item label `Marketplace` → `Catalog`, so the sidebar matches the renamed H1.
  Slug untouched.

## Build

```
npx nx build ptah-docs   →   Successfully ran target build for project ptah-docs
147 pages built in 7.40s
```

Both new pages and Lane B's `marketplace/connected-apps` are present in `dist/apps/ptah-docs/`. No failures
in Lane B's areas.

## Screenshots — checked, as instructed

Neither referenced file exists. `apps/ptah-docs/public/screenshots/` contains 23 PNGs; there is no
`plugin-marketplace.png` and no `plugin-enable-toggle.png`. Both references were therefore **broken images
in production**, not merely stale ones. I removed both (`marketplace.md:8`, `installing.md:20`) rather than
leaving a 404 in place. Regenerating them stays out of scope; if a capture pass happens, the two natural
shots are the Ptah Skills surface with the status widget, and the Configure Ptah Skills modal with one
plugin expanded to show per-skill checkboxes.

## Deliberately left out / could not verify

- **The prune-vs-harness collision is a real defect, not a doc bug.** `pruneStaleFiles`
  (`content-download.service.ts:265-275`) walks all of `~/.ptah/plugins/` and unlinks every file absent
  from the manifest, with no exclusion for `ptah-harness-*`. Harness-authored plugins live in exactly that
  directory and are never in the manifest, so a `contentHash` change should delete a user's authored
  skills. Nothing in `content-download.service.spec.ts` covers it. I documented the pruning rule honestly
  and added a caution to keep a copy of anything irreplaceable, but I did **not** assert the deletion as
  observed behaviour — I did not run it. **Worth filing as its own defect.**
- **The task brief calls `harness-plugins.md` "the bridge from Skill Synthesis to Plugins". The code says
  otherwise** and I followed the code. `ptah-harness-*` directories are written by the harness wizard —
  `HarnessFsService.createSkillPlugin` and the `ptah_harness_create_skill` tool. Skill Synthesis writes to
  `~/.ptah/skills/<slug>/SKILL.md`; `grep ptah-harness libs/backend/skill-synthesis/src` returns nothing.
  The page therefore bridges **AI Team Builder / harness authoring** → Plugins, and links Skill Synthesis
  at the end as the adjacent-but-separate mechanism.
- **`plugins/creating-plugins.md` is likely stale too** and was outside my assigned file list, so I left it
  alone. Worth a look: the contribution model there may still promise `agents/` and `templates/`
  directories, which no bundled plugin has and no loader reads.
- `mcp-and-skills/ptah-tools.md:82` documents `ptah_harness_create_skill` as writing to `~/.ptah/skills/`
  or workspace `.claude/skills/`. The builder writes `~/.ptah/plugins/ptah-harness-<slug>/`. Out of my
  lane; flagged for whoever owns that section.
- I did not touch `apps/ptah-extension-vscode/assets/plugins/**` or `.github/skills/**` (read only).
