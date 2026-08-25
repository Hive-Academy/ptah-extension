# Lane C changelog — TASK_2026_258 (review blockers)

Writer: technical-content-writer (Lane C). Scope: the review's **Critical Issue 2**
(`plugins/creating-plugins.md`), **Moderate Issue 3** (broken screenshot refs in
`marketplace/index.md` and `marketplace/mcp-registry.md`), and **Serious Issue 4**
(`mcp-and-skills/ptah-tools.md:82`). Nothing else was touched. No file under
`apps/ptah-extension-vscode/assets/plugins/**` or `.github/skills/**` was written, and
`astro.config.mjs` was not edited — this lane added no pages.

The `ptah-core` 8-vs-7 count was left at **8** deliberately, per instruction: the docs and
the manifest land together on merge.

## Verification done before writing (every replacement claim)

| Claim I wrote                                                                                            | How I verified it                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only bundled IDs + existing `ptah-harness-*` dirs resolve; anything else dropped with a log-only warning | Read `plugin-loader.service.ts:448-496` — `KNOWN_PLUGIN_IDS.has(id) \|\| harnessIds.has(id)`, else `this.logger.warn('Unknown plugin ID filtered out')`. `KNOWN_PLUGIN_IDS` is `AVAILABLE_PLUGINS.map(p => p.id)` (line 143); `HARNESS_PLUGIN_PREFIX = 'ptah-harness-'` (line 154)                                                                                               |
| `~/.ptah/plugins/` is pruned against the manifest                                                        | Read `content-download.service.ts:200-201, 265-275`. `pruneStaleFiles` walks the whole dir and `fs.unlinkSync`es every file not in the manifest set. No harness exclusion, no try/catch, no log                                                                                                                                                                                  |
| No "load from folder" / "reload plugins" command                                                         | `grep -rn "Load Plugin From Folder\|Reload Plugins" apps/ptah-extension-vscode apps/ptah-electron libs scripts` → **zero hits**. `package.json contributes.commands` registers exactly 10: `toggleChat`, `openFullPanel`, `setupAgents`, `enterLicenseKey`, `removeLicenseKey`, `checkLicenseStatus`, `openDashboard`, `openOrchestraCanvas`, `exportSettings`, `importSettings` |
| No **Local** badge                                                                                       | `grep -n "Local" plugin-browser-modal.component.ts` → **zero hits**. Only `Recommended` (line 217) and `Yours` (line 229) render                                                                                                                                                                                                                                                 |
| Harness path `~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/SKILL.md`                                | Two writers agree: `harness-fs.service.ts:47,72-73` and `harness-namespace.builder.ts` (`code-execution/namespace-builders/`, `createSkill`) — `path.join(ptahHome, 'plugins', 'ptah-harness-' + sanitizedName)`, then `skills/<sanitizedName>/SKILL.md`                                                                                                                         |
| Only `skills/` and `commands/` are read out of a plugin                                                  | `skill-junction.service.ts:415` (`join(pluginPath, 'skills')`) and the command sync at 554+. `discoverPluginSkills(pluginPaths)` in `agent-generation` reads skills only. `grep "'agents'\|'templates'"` across `agent-sdk/helpers` → zero                                                                                                                                       |
| No bundled plugin has `agents/` or `templates/`                                                          | Listed all five: `ptah-angular` (skills), `ptah-core` (.claude-plugin, commands, skills), `ptah-nx-saas` (.claude-plugin, commands, skills), `ptah-react` (skills), `ptah-video` (skills)                                                                                                                                                                                        |
| `plugin.json` is never parsed by Ptah                                                                    | `grep -rn "claude-plugin" apps/*/src libs/**` → only `content-download.service.ts:358` (a doc comment example) and spec fixtures. It is downloaded as a file, never read                                                                                                                                                                                                         |
| Publishing section is accurate — **kept unchanged**                                                      | `scripts/generate-content-manifest.js` exists; `PLUGINS_BASE_PATH = 'apps/ptah-extension-vscode/assets/plugins'` (line 25) matches step 2                                                                                                                                                                                                                                        |
| CI enforces the manifest regeneration                                                                    | `.github/workflows/content-manifest.yml:51,54` runs `npm run manifest:self-test` and `npm run manifest:check`; `package.json:68` maps `manifest:check` → `--check`                                                                                                                                                                                                               |
| A real directory at `.claude/skills/<name>` is left alone by the junction pass                           | Lane A verified and documented this in `installing.md`; consistent with `skill-junction.service.ts` skip counting ("Number of skills skipped (real directory or file exists)", line 88)                                                                                                                                                                                          |

## Files touched

### 1. `apps/ptah-docs/src/content/docs/plugins/creating-plugins.md`

**Deleted as false** (all four review findings plus one the review did not enumerate):

- **`Ptah: Load Plugin From Folder…`** and **`Ptah: Reload Plugins`** — unregistered.
- **"Sideloaded plugins are marked _Local_"** — no such badge exists.
- **"Drop your plugin folder directly into `~/.ptah/plugins/` and restart Ptah"** — the
  instruction that causes the data loss.
- **"Ptah reads any well-formed plugin it finds under `~/.ptah/plugins/`"** (the private-
  plugins tip) — false twice over: the folder is neither resolved nor kept.
- **The `agents/` and `templates/` rows of the contribution table**, the `agents/` and
  `templates/` entries in the structure tree, and the whole `### Agent file` example.
  Same error class Lane A deleted from `plugins/index.md`; the review endorsed that
  deletion (Section 8, "Lane A's deletion of that contribution claim was right"), so I
  applied it here for consistency. This is the one edit that goes beyond the review's
  literal fix list — flagging it explicitly.
- **"That alone is enough to be loaded"** (the `plugin.json`-only folder) — nothing parses
  `plugin.json`, and a folder with no `skills/` or `commands/` contributes nothing.

**Replaced with:**

- An opening paragraph stating the thing the page never said: you cannot install a plugin
  yourself. Plugins reach users through the published manifest.
- A two-row contribution table (`skills/<name>/SKILL.md` → a junction at
  `<workspace>/.claude/skills/<name>/`; `commands/*.md` → a copy at
  `<workspace>/.claude/commands/<name>.md`), plus a sentence naming `agents/`/`templates/`
  as _not_ contributions and pointing at `/agents/custom-agents/`.
- A rewritten **Testing locally** section opening with a `:::danger[There is no
sideloading]` callout, then the two independent reasons a hand-dropped folder fails —
  the ID-resolution filter and the manifest prune — each stated as its own rule.
- **Author it through the harness instead**: the `ptah-harness-<slug>/skills/<slug>/SKILL.md`
  tree, the AI Team Builder wizard and `ptah_harness_create_skill` as the two entry points,
  the **Your Skills** category / **Yours** badge / opt-out activation, cross-linked to
  [Harness plugins](/plugins/harness-plugins/) for the full model and the prune caution.
- **Iterating on a skill without a plugin**: write straight into
  `<workspace>/.claude/skills/<name>/SKILL.md` — your directory, not Ptah's, and nothing
  prunes it.
- A `:::note` replacing the private-plugin tip: there is no third-party channel today;
  distribute `SKILL.md` files into workspace `.claude/skills/` instead.
- One paragraph added to **Publishing** explaining why step 3 is load-bearing (the manifest
  both gates downloads and drives deletion) and naming the CI gate.
- Next steps gained a `harness-plugins` link.

**Kept unchanged** — the Publishing section's four steps, the `plugin.json` example, the
Skill file and Command file examples, and the Style guide. All verified accurate.

### 2. `apps/ptah-docs/src/content/docs/marketplace/index.md`

Deleted line 8, `![Marketplace overview](/screenshots/marketplace-overview.png)`.
Confirmed absent first: `apps/ptah-docs/public/screenshots/` holds 22 files and the only
`marketplace-*` one is `marketplace-smithery.png`. Following Lane A's precedent (delete)
rather than Lane B's (flag and keep) — the review's Moderate Issue 3 asked for one call,
not two.

### 3. `apps/ptah-docs/src/content/docs/marketplace/mcp-registry.md`

Deleted line 8, `![MCP Registry in the Marketplace](/screenshots/marketplace-mcp-registry.png)`.
Same check, same reasoning.

**No third broken reference exists in my four files.** `grep -n "screenshots/"` across all
four returned exactly those two hits; `creating-plugins.md` and `ptah-tools.md` reference
no images at all.

### 4. `apps/ptah-docs/src/content/docs/mcp-and-skills/ptah-tools.md` (line 82 only)

`ptah_harness_create_skill` was documented as creating a skill "under `~/.ptah/skills/` or
workspace `.claude/skills/`". Corrected to the path both writers actually use —
`~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/SKILL.md` — with a link to
`/plugins/harness-plugins/`. The section is no longer internally inconsistent with
`harness-plugins.md:9`.

## Build

```
npx nx build ptah-docs
→ Successfully ran target build for project ptah-docs
  147 page(s) built in 5.13s
  Pagefind index over 148 HTML files
```

PASS. No warnings attributable to these four files.

## Left out / not done

- **`ptah-core` 8 → 7 not applied**, per instruction. The docs stay at 8 and the merge of
  `ak/tui-defects` makes them true. Until that merge, `plugins/index.md` and
  `plugins/marketplace.md` describe a skill live users do not have (review Serious Issue 1).
  **This lane does not close that item — the merge does.**
- **No new pages, no sidebar edits.** `humanize-library` and `ptah-cli-usage` still have no
  skill pages; deferred to their own task.
- **`mcp-and-skills/creating-skills.md:114` carries the same wrong path I just fixed in
  `ptah-tools.md`.** It says `ptah_harness_create_skill` "writes the skill under
  `<workspace>/.claude/skills/my-skill/SKILL.md`". That is false for the same reason — the
  tool writes to `~/.ptah/plugins/ptah-harness-<slug>/`. The file is outside my assigned
  list so I did not touch it, but it is now the only remaining page contradicting
  `harness-plugins.md`. **Worth a one-line follow-up.** (Its option 3, "drop a folder into
  `.claude/skills/`", is correct and I linked to it.)
- **`pruneStaleFiles` vs. harness plugins** remains a product defect needing its own task
  (review Critical Issue 1). I documented the pruning rule as the reason hand-dropped
  plugins do not survive — which is the manifest-driven behaviour the code plainly does —
  but like Lane A I did not assert the harness-deletion scenario as observed. I did not run
  it.
- **No docs↔manifest drift gate added** (review Serious Issue 3). Out of scope here.
