# Code Logic Review — TASK_2026_258

Documentation-accuracy review of the two docs lanes (A: `plugins/**` + `astro.config.mjs`;
B: `marketplace/**`, `templates/**`, `reference/**`). Nothing under `apps/ptah-docs/` was
edited by this review, and nothing under `apps/ptah-extension-vscode/assets/plugins/**` or
`.github/skills/**` was written.

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 4              |
| Moderate Issues     | 4              |
| Failure Modes Found | 6              |

The lanes did genuinely good work. Nearly every deletion they made was correct, and their
citations hold up under independent checking. The score is not about what they removed. It
is about a class of error neither lane could see from inside its own scope: **both lanes
verified their claims against the working tree, and the working tree is not what users
have.** That single blind spot produces the two Critical issues below, and it is exactly
the blind spot the user's objection points at — though not for the reason the user
supposed.

---

# SECTION 1 (PRIORITY) — Where Plugins Actually Live

## Verdict up front

**The docs' location claim (`~/.ptah/plugins/`) is CORRECT — unconditionally, in every
runtime, in dev and packaged builds alike.** The user's premise that the dev environment
reads `apps/ptah-extension-vscode/assets/plugins/` is **not supported by the code**. There
is no dev-vs-packaged branch, no `extensionMode` check, no env var, and no fallback to the
bundled assets directory anywhere in the plugin resolution path.

**However, the user's underlying instinct is right, and points at a real and worse problem.**
The docs are wrong about _what is in_ that directory — and the reason is that the published
manifest is stale. See Section 1.4. So: right path, wrong contents.

I am reporting this as unconditional rather than conditional because the code genuinely is
unconditional. Where a real condition exists (published vs. working-tree content), I state
what each condition produces.

## 1.1 Where does plugin discovery actually read from?

One resolution path, no branches. `PluginLoaderService` holds a single base path and is told
it exactly once:

`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:206-232`

```ts
/** Absolute path to the plugins base directory (~/.ptah/plugins/) */
private pluginsBasePath: string | null = null;

initialize(pluginsBasePath: string, workspaceState: IStateStorage): void {
  this.pluginsBasePath = pluginsBasePath;
  ...
}
```

Every read in the service joins off that one field — `countBundledSkills` (line 274),
`discoverHarnessPluginPaths` (line 527/530), `resolvePluginPaths` (line 478). There is no
second root and no fallback.

The value comes from `ContentDownloadService.getPluginsPath()`, which is computed in the
constructor with no conditionals at all:

`libs/backend/platform-core/src/content-download.service.ts:82-87, 146-148`

```ts
constructor() {
  this.ptahDir = path.join(homedir(), '.ptah');
  this.pluginsDir = path.join(this.ptahDir, 'plugins');
  ...
}

getPluginsPath(): string {
  return this.pluginsDir;
}
```

All three runtimes wire it identically:

| Runtime   | Call site                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| VS Code   | `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:45` — `initPluginLoader(contentDownload.getPluginsPath(), logger)`   |
| Electron  | `apps/ptah-electron/src/activation/wire-runtime.ts:163` — `initPluginLoader(container, contentDownload.getPluginsPath())`       |
| CLI / TUI | `libs/backend/cli-engine/src/lib/container.ts:671-674` — `pluginLoader.initialize(contentDownload.getPluginsPath(), wsStorage)` |

**Is there a dev branch?** No. `extensionMode` appears three times in the VS Code app and
none of them touch plugins:

- `bootstrap.ts:52` — Sentry `environment: isDev ? 'development' : 'production'`
- `bootstrap.ts:70` — `ExtensionMode.Test` + `PTAH_E2E` license seed
- `angular-webview.provider.ts:263` — webview dev-server URL
- `license-commands.ts:205` — license command dev behaviour

**Positive evidence that the assets path is deliberately _not_ read.** `SkillJunctionService`
treats a junction pointing into `assets/plugins/` as a **legacy artifact to delete**:

`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:916-934`

```
 * Detect entries created by old extension versions that pointed to
 * the extension install path (e.g., .../assets/plugins/...) rather
 * than ~/.ptah/plugins.
...
  return (
    target.includes('/assets/plugins/') ||
    target.includes('/ptah-extension-vscode/') ||
```

Reading from `assets/plugins/` is the _old_ behaviour, and the current code actively purges
its leftovers. That is about as strong a refutation as the codebase can offer.

## 1.2 So why does the user see plugin trees in the repo?

Two real, benign reasons — neither of which is a read path:

1. **The repo tree is the publishing source.** The manifest's `plugins.basePath` is
   literally `apps/ptah-extension-vscode/assets/plugins`
   (`content-manifest.json`, and `scripts/generate-content-manifest.js:25`). Files are
   _served from_ there over `raw.githubusercontent.com` and _written to_ `~/.ptah/plugins/`.
   The user was looking at the origin of the copy, not its destination.

2. **Electron bundles the directory as a build asset — and nothing reads it.**
   `apps/ptah-electron/project.json:96-99`:

   ```json
   { "glob": "**/*", "input": "apps/ptah-extension-vscode/assets/plugins", "output": "assets/plugins" }
   ```

   I grepped every `.ts`/`.js`/`.json` under `apps/` and `libs/` for a read of that output
   path. There is none. This is **vestigial dead weight** in the Electron bundle,
   contradicting the root `CLAUDE.md` rule ("never re-add them as build assets in
   `project.json`"). Flagged as Moderate Issue 3 — it is a build hygiene defect, not a doc
   defect, and it is very likely what makes the dev build _look_ like it ships plugins.

The VSIX, by contrast, correctly excludes them —
`apps/ptah-extension-vscode/.vscodeignore:54-56`:

```
# Plugin and template content — downloaded from GitHub at runtime (TASK_2025_248)
**/assets/plugins/**
**/templates/**
```

## 1.3 What happens when the remote manifest is absent?

**It is not absent.** I fetched it live:

```
curl -s -o /dev/null -w "HTTP %{http_code} size=%{size_download}"
  https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json
→ HTTP 200  size=17193
```

`content-manifest.json` is committed at the repo root and present on `origin/main`
(`git ls-tree origin/main -- content-manifest.json` returns it). The download story the
docs tell is real and functioning.

For completeness, the absent-manifest path: `doEnsureContent` catches the fetch failure and
returns `{ success: false, fromCache: isContentAvailable(), error: 'Manifest fetch failed: …' }`
(`content-download.service.ts:173-185`). Activation is non-blocking in all three runtimes
(`wire-runtime.ts:51-57` logs a `console.warn` and continues). A first-run user with no
network therefore gets an **empty `~/.ptah/plugins/`**, and the Configure modal still lists
all five bundled plugins — because `AVAILABLE_PLUGINS` is a hardcoded catalogue
(`plugin-loader.service.ts:51-140`) that renders regardless of disk. Ticking one is silently
inert: `resolvePluginPaths` drops it at the `fs.existsSync` filter with a log-only warning
(`plugin-loader.service.ts:479-488`). This is Failure Mode 1 and the docs handle it
adequately (`installing.md:26`).

## 1.4 The actual defect: the published manifest is a month stale

This is the finding that matters, and neither lane caught it because both verified against
the working tree.

|                    | Working tree (what both lanes read) | **Live `main` (what users download)** |
| ------------------ | ----------------------------------- | ------------------------------------- |
| `generatedAt`      | 2026-08-15                          | **2026-07-14**                        |
| `contentHash`      | `sha256:7fd75b01…`                  | **`sha256:246438a9…`**                |
| plugin files       | 219                                 | **213**                               |
| `ptah-core` skills | **8**                               | **7**                                 |
| missing skill      | —                                   | **`humanize-library`**                |

Verified two ways:

```
git ls-tree origin/main --name-only apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/
→ ddd-architecture, orchestration, ptah-cli-usage, skill-creator,
  technical-content-writer, tribunal, ui-ux-designer      (7 — no humanize-library)

git branch -r --contains 310b039e5   → (empty: not merged to any remote branch)
```

Commit `310b039e5` _"feat(plugins): ship the humanize skill and stop the modal miscounting
it"_ is on the local branch `ak/tui-defects` and **has not reached `main`**.

Per-plugin counts from the **live** manifest:

| Plugin         | Live skills | Live commands | Docs claim               |
| -------------- | ----------- | ------------- | ------------------------ |
| `ptah-core`    | **7**       | 5             | **8** skills, 5 commands |
| `ptah-nx-saas` | 7           | 2             | 7 / 2 ✅                 |
| `ptah-angular` | 3           | 0             | 3 / 0 ✅                 |
| `ptah-react`   | 3           | 0             | 3 / 0 ✅                 |
| `ptah-video`   | 1           | 0             | 1 / 0 ✅                 |

Only `ptah-core` is wrong — but it is wrong in three places at once, and it is the default,
`isDefault: true`, most-used plugin.

**And the UI will visibly contradict the docs.** `countBundledSkills` overrides the
hardcoded catalogue number with the real disk count
(`plugin-loader.service.ts:249-252, 271-278`):

```ts
skillCount: this.countBundledSkills(plugin.id) ?? plugin.skillCount,
```

So a user today downloads 7 skills, the badge reads **7**, and three doc pages say **8**
and name a skill (`humanize-library`) that will not be in their list. That is precisely the
"walk a user through something that is not there → bug report" failure this whole task
exists to eliminate. The task re-introduced a smaller instance of its own bug class.

## 1.5 Verdict on the location claims, page by page

| Page:line                            | Claim                                                                  | Verdict                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `plugins/index.md:23`                | "not bundled in the Ptah installer… downloads into `~/.ptah/plugins/`" | **Correct** (VSIX-accurate; Electron bundles a dead copy) |
| `plugins/index.md` table             | `ptah-core` — **8 skills**, names `humanize-library`                   | **WRONG today** — live manifest ships 7                   |
| `plugins/marketplace.md:61-63`       | `ptah-core` **8** skills incl. `humanize-library`                      | **WRONG today**                                           |
| `plugins/installing.md:17,31,55`     | resolves under `~/.ptah/plugins/`                                      | **Correct**                                               |
| `plugins/managing.md:40,54,60`       | files stay in / delete `~/.ptah/plugins/`                              | **Correct**                                               |
| `plugins/plugin-storage.md:29,78,86` | written to and pruned under `~/.ptah/plugins/`                         | **Correct**                                               |
| `plugins/harness-plugins.md:9,61,64` | `~/.ptah/plugins/ptah-harness-<slug>/`                                 | **Correct**                                               |
| `reference/file-locations.md:13`     | "Installed plugins (downloaded at runtime)"                            | **Correct**                                               |
| `reference/glossary.md:16`           | "Plugins live under `~/.ptah/plugins/`"                                | **Correct**                                               |

**No page needs an environment caveat for the path.** The path is universal. What three
pages need is a corrected `ptah-core` count, or a merge.

---

# SECTION 2 — The 5 Paranoid Questions

### 1. How does this fail silently?

- **The docs silently describe a future state.** Every count in Lane A was verified against
  the working tree. `nx build ptah-docs` passes, prose reads confidently, and nothing in the
  toolchain compares a doc claim to the _published_ manifest. The docs will be wrong for
  every user until `ak/tui-defects` merges, and no gate will ever say so.
- **A ticked plugin whose directory is absent does nothing, visibly.**
  `resolvePluginPaths` filters it out with `this.logger.warn(...)` and returns a shorter
  array (`plugin-loader.service.ts:479-488`). The checkbox stays ticked. Save reports
  success. No skills appear.
- **`pruneStaleFiles` deletes user data with no log line at all** — see Critical Issue 1.

### 2. What user action causes unexpected behavior?

- Following `plugins/creating-plugins.md:100` — "Drop your plugin folder directly into
  `~/.ptah/plugins/`" — and then triggering any content refresh. The folder is deleted.
- Authoring a skill in the harness wizard, then having the manifest hash change. Same
  deletion (Critical Issue 1).
- Looking for `humanize-library` in the Configure modal because `plugins/index.md` names it.
- Opening the command palette for any of the seven `Ptah: …` commands the docs still
  reference (five removed by the lanes, **two still live** in `creating-plugins.md`).

### 3. What data makes this produce wrong results?

The manifest's `contentHash`. It is a single whole-manifest hash
(`content-download.service.ts:187-198`), so it is simultaneously the cache key, the prune
trigger, and the re-download trigger. One skill edit anywhere flips it and re-downloads all
219 files _and_ prunes everything unlisted. The lanes documented the all-or-nothing
re-download correctly; the coupled destructive prune is under-weighted.

### 4. What happens when dependencies fail?

| Dependency                      | Failure             | Handling                                                | Assessment                           |
| ------------------------------- | ------------------- | ------------------------------------------------------- | ------------------------------------ |
| GitHub manifest fetch           | 404 / offline       | `success: false`, activation continues                  | OK, documented (`marketplace.md:88`) |
| Individual file download        | HTTP error          | `Promise.allSettled`, counted as failed, `console.warn` | OK, documented                       |
| `fs.unlinkSync` in prune        | EPERM / file locked | **Uncaught** → aborts entire `doEnsureContent`          | **MISSING** — Serious Issue 1        |
| `writeFile`/`rename`            | disk full           | rejects → counted failed                                | OK                                   |
| Cache metadata write            | any error           | caught, `console.warn`                                  | OK                                   |
| `readdirSync` in `walkLocalDir` | any error           | caught → `return results`                               | OK                                   |

### 5. What's missing that the requirements didn't mention?

- **A gate that compares doc claims to the published manifest.** `nx build ptah-docs` checks
  links and syntax. It cannot check truth. This task fixed ~30 false claims by hand; nothing
  stops the 31st.
- **`plugins/creating-plugins.md` was in neither lane's scope** and is the single most
  dangerous page in the section (Critical Issue 2).
- **Nobody owns the docs↔release ordering.** The docs describe `main`; the repo is a branch.

---

# SECTION 3 — Failure Mode Analysis

### Failure Mode 1: Empty plugins dir on first run, ticked checkboxes do nothing

- **Trigger**: first launch offline, or manifest fetch failure.
- **Symptoms**: modal lists all five plugins (hardcoded catalogue), ticking + saving
  succeeds, no skills appear in `.claude/skills/`.
- **Impact**: Moderate. Self-heals on the next successful download.
- **Current handling**: `existsSync` filter, log-only warning
  (`plugin-loader.service.ts:479-488`).
- **Recommendation**: docs handle it (`installing.md:26`). Product-side, the modal should
  show a "not downloaded yet" state. Out of scope here.

### Failure Mode 2: Harness-authored skills deleted by prune

- **Trigger**: any manifest `contentHash` change while `~/.ptah/plugins/ptah-harness-*` exists.
- **Symptoms**: user's authored skills vanish; junctions pruned as stale.
- **Impact**: **Critical — unrecoverable user data loss.**
- **Current handling**: none. See Critical Issue 1.

### Failure Mode 3: Docs assert a skill users do not have

- **Trigger**: reading `plugins/index.md` or `plugins/marketplace.md` today.
- **Symptoms**: `humanize-library` named in docs, badge reads 7, skill absent.
- **Impact**: Serious — reproduces the exact bug class this task set out to kill.
- **Current handling**: none. See Critical Issue 2 / Serious Issue 2.

### Failure Mode 4: Prune aborts the whole download

- **Trigger**: `fs.unlinkSync` throws (Windows file lock, EPERM, read-only).
- **Symptoms**: `ensureContent` returns `success: false`; **no files download at all**,
  because prune runs at lines 200-201, before any download.
- **Impact**: Serious — a single locked file blocks all content indefinitely, and it retries
  identically every launch.
- **Current handling**: caught only by the outer `.catch` in `ensureContent` (108-121).
- **Recommendation**: wrap the `unlinkSync` in try/catch and continue.

### Failure Mode 5: Sideloading advice destroys the sideload

- **Trigger**: following `creating-plugins.md:100` / `:117`.
- **Symptoms**: plugin never appears in the modal (it is rejected by ID validation), then is
  deleted on the next refresh.
- **Impact**: **Critical** — the docs instruct the user into data loss.
- **Current handling**: none. See Critical Issue 2.

### Failure Mode 6: Prune leaves empty directory skeletons

- **Trigger**: a plugin or skill removed from the manifest.
- **Symptoms**: `pruneStaleFiles` unlinks files only; directories remain.
  `discoverHarnessPluginPaths` (`plugin-loader.service.ts:544-563`) accepts any
  `ptah-harness-*` **directory**, so an emptied harness dir still renders as a plugin with
  `skillCount: 0`.
- **Impact**: Moderate — a ghost row in the modal.
- **Current handling**: none.

---

# SECTION 4 — Critical Issues

### Critical Issue 1: `pruneStaleFiles` deletes harness-authored skills — no guard, no test

- **File**: `libs/backend/platform-core/src/content-download.service.ts:200-201, 265-275`
- **Scenario**: user authors a skill via the harness wizard → it lands at
  `~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/SKILL.md`. The manifest hash later
  changes. `pruneStaleFiles(this.pluginsDir, manifest.plugins.files)` walks **all** of
  `~/.ptah/plugins/` and unlinks every file not in the manifest. Harness files are never in
  the manifest.
- **Evidence**:

  ```ts
  private pruneStaleFiles(localDir: string, manifestFiles: string[]): void {
    const manifestSet = new Set(manifestFiles);
    const localFiles = this.walkLocalDir(localDir, localDir);
    for (const relPath of localFiles) {
      if (!manifestSet.has(relPath)) {
        const fullPath = path.join(localDir, ...relPath.split('/'));
        fs.unlinkSync(fullPath);          // no harness exclusion, no try/catch, no log
      }
    }
  }
  ```

- **Impact**: unrecoverable loss of user-authored work. Silent — there is not even a
  `console.warn`.
- **Corroborating evidence that this boundary is known**:
  `user-layer-mirror.service.ts:1529-1532` explicitly **refuses to write** under
  `~/.ptah/plugins/`. The write side has a guard; the delete side does not.
- **Test coverage**: `grep -n "prune\|harness" content-download.service.spec.ts` → **zero
  matches**. Entirely untested.
- **Fix**: skip any relative path whose first segment starts with `ptah-harness-`; wrap the
  unlink in try/catch; add a debug log. Then add specs.
- **Status**: Lane A flagged this honestly and declined to assert it without running it
  (`docs-changes-lane-a.md:145-151`). **That was the correct call, and the read confirms
  it.** It needs its own defect task — it is a product bug, not a docs bug.

### Critical Issue 2: `plugins/creating-plugins.md` is unfixed and instructs users into data loss

- **File**: `apps/ptah-docs/src/content/docs/plugins/creating-plugins.md:100-117`
- **Scenario**: the one page in the Plugins section neither lane was assigned. It carries
  the same error classes the task was filed to remove, plus a destructive instruction.
- **Evidence** — four independently verified false claims:

  | Line | Claim                                                                  | Reality                                                                                                                                                                                                                    |
  | ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 100  | "Drop your plugin folder directly into `~/.ptah/plugins/` and restart" | Deleted by `pruneStaleFiles` on the next hash change                                                                                                                                                                       |
  | 101  | `Ptah: Load Plugin From Folder…`                                       | **Unregistered.** `package.json contributes.commands` has 10 entries; this is not one                                                                                                                                      |
  | 103  | `Ptah: Reload Plugins`                                                 | **Unregistered.** Only grep hits are inside VS Code's own bundled `markdown-language-features` extension                                                                                                                   |
  | 105  | "Sideloaded plugins are marked **Local** in the marketplace"           | No `Local` badge exists; badges are Recommended / Yours                                                                                                                                                                    |
  | 117  | "Ptah reads any well-formed plugin it finds under `~/.ptah/plugins/`"  | **False.** `resolvePluginPaths` accepts only `KNOWN_PLUGIN_IDS ∪ ptah-harness-*` dirs (`plugin-loader.service.ts:466-475`); anything else is filtered with a warning. `getAvailablePlugins` returns bundled + harness only |

- **Impact**: a user following this page loses their work and never sees their plugin. It is
  strictly worse than any page the task did fix, and it now sits next to eight corrected
  pages, borrowing their credibility.
- **Fix**: bring into scope. Delete the two invented commands and the "Local" badge; replace
  the sideload section with the truth (only `ptah-harness-*` is discovered; use the harness
  wizard); add the prune warning. The "Publishing" section (lines 109-115) is **accurate** —
  `scripts/generate-content-manifest.js` exists and `PLUGINS_BASE_PATH` matches — keep it.
- **Note**: Lane A suspected this file was stale (`docs-changes-lane-a.md:158-160`) but
  guessed the wrong reason (`agents/`/`templates/` contribution model). The real problems
  are worse.

---

# SECTION 5 — Serious Issues

### Serious Issue 1: `ptah-core` documented as 8 skills; users get 7

- **Files**: `plugins/index.md` (table), `plugins/marketplace.md:61-63`, and the
  `humanize-library` mention in the index skill list.
- **Scenario**: live manifest ships 7 `ptah-core` skills. `countBundledSkills` makes the
  badge read the disk count, so the UI shows **7** while three doc locations say **8** and
  name the missing skill.
- **Fix — pick one**:
  1. **Merge `ak/tui-defects` to `main`** (commit `310b039e5` ships `humanize-library` and
     regenerates the manifest). Docs then become correct with no edit. **Preferred** — it is
     also what makes the shipped product match its own catalogue constant, which already
     hardcodes `skillCount: 8` at `plugin-loader.service.ts:59`.
  2. Change 8 → 7 and drop `humanize-library`, then change it back after merge.
- **Recommendation**: gate this task's "done" on the merge, not on a doc edit. Option 2
  creates a second wrong state.

### Serious Issue 2: Prune failure aborts all content download

- **File**: `content-download.service.ts:200-201`
- Prune runs _before_ any download. An uncaught `unlinkSync` throw skips lines 203-229
  entirely — no plugins, no templates — and recurs every launch.
- **Fix**: try/catch per unlink, continue on failure.

### Serious Issue 3: No mechanism prevents doc/manifest drift recurring

- This task hand-corrected ~30 false claims. The gate is `nx build ptah-docs`, which cannot
  detect a false statement.
- **Fix**: a small spec asserting doc-stated counts against `content-manifest.json` —
  in the spirit of `libs/backend/task-specs/src/lib/contract.guard.spec.ts`, which already
  pins `apps/ptah-extension-vscode/assets/plugins` paths (lines 232, 293). Cheap, and it
  would have caught Serious Issue 1 automatically.

### Serious Issue 4: `mcp-and-skills/ptah-tools.md:82` documents the wrong harness write path

- Documents `ptah_harness_create_skill` as writing to `~/.ptah/skills/` or `.claude/skills/`;
  the builder writes `~/.ptah/plugins/ptah-harness-<slug>/`.
- Correctly flagged by Lane A as out of lane (`docs-changes-lane-a.md:161-163`). It now
  contradicts the new `harness-plugins.md:9`, so the section is internally inconsistent
  until fixed. Needs an owner.

---

# SECTION 6 — Moderate Issues

1. **Electron bundles a dead `assets/plugins` copy.** `apps/ptah-electron/project.json:96-99`
   copies the whole tree into the build with no reader. Violates the root `CLAUDE.md` rule
   and inflates the installer — the opposite of the "keeps the desktop installer small"
   benefit `plugins/index.md:35` claims. Very likely the source of the user's impression
   that dev reads bundled assets. Remove the asset entry, or document why it stays.

2. **Empty harness directories render as ghost plugins** (Failure Mode 6).

3. **Three broken screenshot references remain.** Lane A removed two
   (`plugin-marketplace.png`, `plugin-enable-toggle.png` — both confirmed absent from the 23
   PNGs in `public/screenshots/`). Lane B found but did not remove
   `/screenshots/marketplace-overview.png` (`marketplace/index.md:8`) and
   `/screenshots/marketplace-mcp-registry.png` (`mcp-registry.md:8`). `astro build` does not
   validate public assets, so these are broken images in production. The lanes made
   _opposite_ calls on the same class of problem — Lane A deleted, Lane B flagged. Pick one.

4. **`humanize-library` and `ptah-cli-usage` still have no skill pages** — deferred by
   `context.md:137-139`, correctly. Noting that Serious Issue 1 makes the
   `humanize-library` gap more visible, since `plugins/index.md` now names it.

---

# SECTION 7 — Data Flow Analysis

```
 GitHub main
   content-manifest.json ──HTTP 200, 17193 B, generatedAt 2026-07-14──┐
   (baseUrl + plugins.basePath =                                       │  [GAP A] a month
    apps/ptah-extension-vscode/assets/plugins)                         │  behind the tree
                                                                       ▼
                                              ContentDownloadService.doEnsureContent
                                                        │
                                    ┌───────────────────┴───────────────────┐
                                    ▼                                       ▼
                       hash == cache? → return fromCache        hash differs
                                                                            │
                                                          pruneStaleFiles(pluginsDir)
                                                            deletes ALL unlisted files
                                                       [GAP B] harness skills destroyed
                                                       [GAP C] unlink throw aborts run
                                                                            │
                                                          downloadFilesBatch (10 parallel)
                                                            path-traversal guard ✅
                                                            temp+rename ✅
                                                            no per-file hash/size check
                                                                            ▼
                                                      ~/.ptah/plugins/   ← THE ONLY READ ROOT
                                                                            │
   apps/ptah-extension-vscode/assets/plugins/   ──[never read]──✗           │
   dist/apps/ptah-electron/assets/plugins/      ──[never read]──✗  [GAP D]  │
                                                                            ▼
                                          PluginLoaderService.initialize(pluginsBasePath)
                                            VS Code / Electron / CLI — identical, no branch
                                                                            │
                                      ┌─────────────────────────────────────┤
                                      ▼                                     ▼
                     AVAILABLE_PLUGINS (hardcoded, 5)          countBundledSkills() reads disk
                     renders with or without disk              overrides the constant
                                      │                                     │
                                      └──────────────► Configure modal ◄────┘
                                                       badge = 7   docs say 8   [GAP E]
```

### Gap Points Identified

- **GAP A** — published manifest is 1 month behind the working tree; every lane verified
  against the tree. Root cause of Serious Issue 1.
- **GAP B** — prune has no `ptah-harness-*` exclusion → user data loss (Critical 1).
- **GAP C** — prune runs before download and can abort the whole run (Serious 2).
- **GAP D** — two bundled copies exist that nothing reads; Electron's is shipped (Moderate 1).
- **GAP E** — disk-derived badge and hand-written doc count can disagree, with no gate
  (Serious 1 + 3).

---

# SECTION 8 — Requirements Fulfillment

| Requirement (`context.md:119-133`)           | Status      | Concern                                                                                                      |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `plugins/managing.md` — rewrite              | COMPLETE    | Verified: invented UI gone                                                                                   |
| `plugins/marketplace.md` — rewrite           | **PARTIAL** | Correct except `ptah-core` = 8 (Serious 1)                                                                   |
| `plugins/plugin-storage.md` — correct        | COMPLETE    | `.content-cache.json`, concurrency 10, prune, traversal guard — all verified                                 |
| `plugins/installing.md` — correct            | COMPLETE    | Memento/`ptah.plugins.config` claim verified at `plugin-loader.service.ts:39,358-359`                        |
| `plugins/index.md` — 4 → 5                   | **PARTIAL** | 5 plugins ✅; `ptah-core` count wrong (Serious 1)                                                            |
| `plugins/skill-toggles.md` — NEW             | COMPLETE    | `disabledSkillIds` behaviour matches lines 300-343, 575-594                                                  |
| `plugins/harness-plugins.md` — NEW           | COMPLETE    | Opt-out model verified; prune caution correctly hedged                                                       |
| `marketplace/connected-apps.md` — NEW        | COMPLETE    | 6th provider `oauth-mcp` confirmed                                                                           |
| `templates/template-storage.md` — correct    | COMPLETE    | `templates/agents/` verified at `content-download.service.ts:85`; live manifest `templates.basePath` matches |
| `reference/glossary.md`, `file-locations.md` | COMPLETE    | `.ptah/plugins.json` correctly removed                                                                       |
| `astro.config.mjs` — 3 entries               | COMPLETE    | Build passes, 147 pages                                                                                      |

**Verified-correct numbers** (independent disk count, working tree): skills 8/7/3/3/1,
commands 5/2/0/0/0 — Lane A's figures match exactly. No bundled plugin has an `agents/` or
`templates/` directory, so Lane A's deletion of that contribution claim was right.

### Implicit Requirements NOT Addressed

1. **Docs must describe the published release, not the working tree.** Never stated; it is
   the root cause of the only substantive inaccuracies left.
2. **`creating-plugins.md` belongs to the Plugins section.** Scoping by filename let the
   worst page through (Critical 2).
3. **A drift gate.** (Serious 3.)

---

# SECTION 9 — Edge Case Analysis

| Edge case                               | Handled | How                                              | Concern                                |
| --------------------------------------- | ------- | ------------------------------------------------ | -------------------------------------- |
| First run, no network                   | YES     | Non-blocking; empty dir; catalogue still renders | Ticking is silently inert (documented) |
| Manifest 404                            | YES     | `success:false`, `fromCache` reported            | Fine                                   |
| Plugin ticked, dir absent               | YES     | `existsSync` filter, log warning                 | Silent in UI                           |
| Harness dir present at prune            | **NO**  | Files deleted                                    | **Critical 1**                         |
| `unlinkSync` throws                     | **NO**  | Aborts whole download                            | **Serious 2**                          |
| Path traversal in manifest              | YES     | `content-download.service.ts:334-339`            | Correct; docs credit it                |
| Redirect loop                           | YES     | `maxRedirects = 5`                               | Fine                                   |
| Slow server                             | YES     | 30 s timeout (line 418)                          | Fine                                   |
| Concurrent `ensureContent`              | YES     | `inFlightPromise` dedupe (104-106)               | Fine                                   |
| Unknown plugin ID saved                 | YES     | Filtered vs `KNOWN_PLUGIN_IDS ∪ harness`         | Correct; docs describe it              |
| Traversal ID (`ptah-harness-../../etc`) | YES     | Directory-backed validation (466-475)            | Correct                                |
| Empty harness dir after prune           | **NO**  | Renders as 0-skill plugin                        | Moderate 2                             |
| Legacy `assets/plugins` junction        | YES     | `isOldExtensionEntry` deletes it                 | Confirms the read root                 |
| Multi-line YAML in SKILL.md             | **NO**  | `parseFrontmatter` (677-694) is single-line only | Pre-existing; documented in code       |

---

# SECTION 10 — Integration Risk Assessment

| Integration                               | Failure probability          | Impact       | Mitigation                                        |
| ----------------------------------------- | ---------------------------- | ------------ | ------------------------------------------------- |
| Docs ↔ published manifest                 | **HIGH** (currently failing) | Serious      | Needed: merge + drift spec                        |
| Prune ↔ harness plugins                   | **HIGH**                     | **Critical** | None — needs code fix                             |
| Prune ↔ filesystem locks (Windows)        | MEDIUM                       | Serious      | None — needs try/catch                            |
| `getPluginsPath` ↔ all three runtimes     | **LOW**                      | —            | Uniform, no branch. Solid                         |
| `countBundledSkills` ↔ catalogue constant | MEDIUM                       | Moderate     | Disk wins; correct design, but diverges from docs |
| Electron asset copy ↔ runtime             | LOW                          | Moderate     | Dead weight; remove                               |
| Docs ↔ screenshots                        | **HIGH**                     | Minor        | 3 broken refs remain                              |

---

# Verdict

**Recommendation**: **NEEDS_REVISION**

**Confidence**: HIGH — every claim in Sections 1-5 is backed by a file:line read, a `git
ls-tree`, or a live HTTP fetch performed during this review.

**Top risk**: `pruneStaleFiles` silently deleting harness-authored skills
(`content-download.service.ts:265-275`). It is untested, unguarded, and destroys work the
user created through a first-class Ptah feature. **It is a product defect, not a docs
defect, and it should be filed and fixed independently of this task.**

## On the user's objection specifically

The user is **wrong on the mechanism** — there is no dev-vs-packaged plugin path, and
`~/.ptah/plugins/` is correct everywhere — but **right that something is off**, and the
instinct was well aimed. Two findings vindicate the suspicion:

1. Electron really does bundle `apps/ptah-extension-vscode/assets/plugins` into its build
   (`project.json:96-99`), so a dev build genuinely _contains_ the plugin trees. Nothing
   reads them, but their presence makes "not bundled" look false on a dev machine.
2. The published content really is out of date, so the docs really do describe something a
   user cannot see — just a _skill_, not a _directory_.

**The pages do not need environment caveats.** They need a merge, one count corrected in
three places, and `creating-plugins.md` brought into scope.

## Blocking items before APPROVED

1. Fix `ptah-core` 8 → 7, or merge `ak/tui-defects` to `main` (**preferred**).
2. Bring `plugins/creating-plugins.md` into scope — 2 invented commands, a false "Local"
   badge, a false discovery claim, and a data-loss instruction.
3. File `pruneStaleFiles` vs. harness plugins as its own defect.

## Non-blocking follow-ups

4. Try/catch the prune unlink.
5. Remove the Electron `assets/plugins` asset entry.
6. Resolve the 3 remaining broken screenshot references consistently.
7. Add a docs↔manifest drift spec.
8. Assign an owner to `mcp-and-skills/ptah-tools.md:82`.

## What a Robust Implementation Would Include

- A build-time assertion tying doc-stated skill/command counts to `content-manifest.json`,
  so drift fails CI instead of shipping.
- A prune allowlist (`ptah-harness-*`) plus per-file try/catch and a debug log.
- Docs generated from, or at minimum validated against, the published manifest rather than
  hand-transcribed from the working tree.
- A public-asset (screenshot) existence check in the docs build.
- A stated convention for whether docs describe `main` or the working tree — the absence of
  that convention is the root cause of every remaining inaccuracy in this task.

## Credit where due

Both lanes cited sources per claim, and I independently confirmed a large sample: concurrency
10, `.content-cache.json`, `templates/agents/`, single whole-manifest `contentHash`, no
per-file hash validation, no retry queue, the path-traversal guard, five categories, the
opt-in/opt-out split, `disabledSkillIds`, the Memento key `ptah.plugins.config`, the sixth
`oauth-mcp` provider, the five unregistered commands, and the two absent screenshots. **All
held.** Lane A's refusal to assert the prune deletion without observing it
(`docs-changes-lane-a.md:145-151`) was exactly right, and it is the finding that turned out
to matter most. The revisions above are narrow, and none of them undo the lanes' work.
