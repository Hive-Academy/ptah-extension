# Lane B docs changes — TASK_2026_258

Writer: technical-content-writer (Lane B). Scope: Marketplace `connected-apps.md` (new),
`marketplace/index.md`, `templates/template-storage.md`, `reference/glossary.md`,
`reference/file-locations.md`. Nothing under `plugins/` and nothing in `astro.config.mjs`
was touched.

## Files touched

### 1. `apps/ptah-docs/src/content/docs/marketplace/connected-apps.md` — NEW

Documents the sixth Marketplace provider, `oauth-mcp` / "Connected Apps"
(`libs/frontend/marketplace/src/lib/providers.registry.ts:55-63`, status `live`,
kind `mcp`). Frontmatter matches its two siblings (`title`, `description`); structure and
voice follow `smithery.md` / `mcp-registry.md` (intro, numbered connect flow, badge table,
permission pointer, comparison table, next steps).

Every claim and its source:

| Claim                                                                                                            | Source                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| URL field, optional friendly name, Connect button disabled until URL non-empty                                   | `oauth-surface.component.ts:111-120,121-129,177-193`                                                                 |
| Quick-connect chips Sentry / Notion / Linear; chips only pre-fill, URL box is source of truth                    | `oauth-surface.component.ts:32-42,164-175,432-437`                                                                   |
| Friendly name defaults to the server hostname                                                                    | `mcp-oauth.service.ts:153`                                                                                           |
| Browser opens; single pending await, no polling; "Connecting…" state                                             | `oauth-surface.component.ts:44-51,182-185,444-488`                                                                   |
| Five-minute authorization window                                                                                 | `mcp-oauth.service.ts:41` (`DEFAULT_CALLBACK_TIMEOUT_MS`)                                                            |
| Advanced section = pre-registered Client ID / Secret, collapsed, only for servers without automatic registration | `oauth-surface.component.ts:131-162`, `mcp-oauth.service.ts:177-193`                                                 |
| Error when no dynamic registration and no Client ID                                                              | `mcp-oauth.service.ts:190-192`                                                                                       |
| Row = name + URL + badge; Connected / Expired / Disconnected semantics                                           | `oauth-surface.component.ts:249-286`, `mcp-oauth.service.ts:233-245`                                                 |
| Reconnect shown only when not connected; Disconnect always                                                       | `oauth-surface.component.ts:288-329`                                                                                 |
| Disconnect deletes tokens + manifest record                                                                      | `mcp-oauth.service.ts:247-251`                                                                                       |
| Connections attach at session start, not mid-session; near-expiry refresh                                        | `chat-session.service.ts:206-238,258-265`, `mcp-oauth-override-resolver.ts:48-85`, `mcp-oauth.service.ts:39,258-266` |
| A server with a dead token contributes nothing rather than failing the chat                                      | `mcp-oauth-override-resolver.ts:12-14,59-64`                                                                         |
| Tokens in encrypted per-server secret slots, never in plaintext config, never logged                             | `mcp-oauth-token-store.ts:1-12,36-69`, `mcp-oauth.service.ts:14-16`                                                  |
| Non-secret metadata at `~/.ptah/mcp-oauth-installed.json`                                                        | `mcp-oauth-installed-manifest.ts:1-23,36-46`                                                                         |
| Bearer header exists only in memory for the session                                                              | `mcp-oauth-override-resolver.ts:6-9,65-69`                                                                           |

Deliberately **not** claimed: the exact `mcp__<server>__<tool>` tool-id string for OAuth
servers (the override key is a URL-derived `oauth-…` slug, and I did not verify how the
SDK renders it into tool ids), and any screenshot — no `marketplace-oauth*.png` exists in
`public/screenshots/`, so the page ships without an image rather than with a broken one.

### 2. `marketplace/index.md`

- Added the sixth provider row: **Connected Apps** — "OAuth-secured remote MCP servers you
  authorize in the browser" — Live.
- Added a matching `### Connected Apps` section between Smithery and Composio, in the same
  one-paragraph-plus-link shape as its neighbours.
- Added the page to **Next steps**.

Nothing else in this file changed.

### 3. `templates/template-storage.md`

Corrected in place:

- **Path.** `~/.ptah/templates/` → `~/.ptah/templates/agents/` throughout, including the
  storage-layout tree (`content-download.service.ts:85,150-156`,
  `content-download.service.spec.ts:256-259`, `template-storage.service.ts:71-73`).
- **Cache metadata.** `~/.ptah/cache/content-manifest.json` →
  `~/.ptah/.content-cache.json` (`content-download.service.ts:86`), and it is described as
  cache metadata (a content hash), not as the manifest itself.
- **Filenames.** The example tree listed `frontend-developer.md`, `security-auditor.md`
  etc. The real files are flat `*.template.md` names
  (`content-manifest.json` `templates.files`, `template-storage.service.ts:63`). There is
  no `security-auditor` template at all. Tree and JSON example both replaced with real
  entries.
- **`basePath`.** `libs/backend/agent-generation/templates` →
  `libs/backend/agent-generation/templates/agents`, and the `files` example no longer
  carries an `agents/` prefix, matching the shipped manifest.
- **Download flow.** The "diffs the files list using content hashes / downloads missing or
  changed files" step was false. Replaced with what ships: one `contentHash` for the whole
  manifest; equal hash means nothing downloads, differing hash means every listed file
  re-downloads, up to 10 in parallel (`content-download.service.ts:76,187-198,203-229`).
- **Pruning, newly documented.** Added one line that a refresh deletes local files absent
  from the manifest, so hand-added files there do not survive
  (`content-download.service.ts:200-201,265-275`).

Deleted as false:

- The whole **"Inspecting the cache"** table. `Ptah: Open Template Cache Folder` and
  `Ptah: Clear Template Cache` are unregistered per the brief — and so is the third row,
  `Ptah: Refresh Templates`: zero hits outside the docs, and
  `apps/ptah-extension-vscode/package.json` `contributes.commands` registers ten commands,
  none of them cache- or template-related. The section had no true row left, so it went.
- **"template installs queue for retry."** There is no queue and no retry — `ensureContent`
  catches, returns a failure result, and stops
  (`content-download.service.ts:108-127,173-185`).
- **The Templates panel "Offline banner."** Not asked for, but deleted rather than left
  standing: `Offline` has zero matches anywhere in `libs/frontend/`. The surviving offline
  sentence says only what is verifiable — existing files keep working, the fetch fails
  quietly.

### 4. `reference/glossary.md`

- **Plugin** — deleted "enabled per workspace via `.ptah/plugins.json`". Enablement is
  Memento-backed workspace state under key `ptah.plugins.config`
  (`plugin-loader.service.ts:38-39,209-210,345-368`), not a file in the repo. Replaced with
  a sentence saying exactly that.
- **Template** — `~/.ptah/templates/` → `~/.ptah/templates/agents/`, same citation as
  above. (Same class of error as the file I was asked to fix; corrected while here.)

### 5. `reference/file-locations.md`

- Templates row: `~/.ptah/templates/` → `~/.ptah/templates/agents/` on all three
  platforms, relabelled "Installed agent templates".
- Added a row for `~/.ptah/.content-cache.json` (content cache metadata) — a real file
  that the reference did not list. The page did **not** repeat the wrong
  `~/.ptah/cache/content-manifest.json` path anywhere; its "Cache" section is the Electron
  user-data cache and is untouched.
- Deleted the workspace-local `<workspace>/.ptah/plugins.json` row and replaced it with a
  short paragraph stating that the enabled-plugin selection (enabled plugins, disabled
  plugins, disabled skills) lives in Ptah's per-workspace state storage, so there is
  nothing to commit or hand-edit.

## Build result

`npx nx build ptah-docs` — **PASS**. 145 pages built in 4.90s, Pagefind index over 146 HTML
files, no warnings attributable to these files. `dist/apps/ptah-docs/marketplace/connected-apps/`
is emitted. Lane A's `astro.config.mjs` and `plugins/` edits were not in the tree at build
time; the new page therefore renders but is not yet in the sidebar, which is expected and
is Lane A's entry to add.

## Left out / could not verify

- **`/screenshots/marketplace-overview.png`** referenced at `marketplace/index.md:8` does
  not exist in `apps/ptah-docs/public/screenshots/` — nor does
  `/screenshots/marketplace-mcp-registry.png` used by `mcp-registry.md:8`. Only
  `marketplace-smithery.png` is present. Both are broken images today; `astro build` does
  not catch public-asset references. Flagged, not touched — screenshot capture is its own
  job per `context.md`.
- **Tool-id format for OAuth-connected servers** — not documented, see above. The page
  links to the shared permission model instead of asserting a string.
- **Whether the Templates panel surfaces any offline state at all** — no evidence found, so
  the page now says nothing about panel-level offline UI.
