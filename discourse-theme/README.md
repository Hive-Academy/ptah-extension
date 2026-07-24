# Ptah Community — Discourse theme

A dark, amber-accented Discourse theme matching `ptah.live` (see
`.ptah/specs/TASK_2026_167/context.md`). Dark only — there is no light variant.

```
discourse-theme/
├── about.json          # theme manifest: name, dark "Ptah" color scheme, assets
├── locales/en.yml       # theme_metadata.description (required by Discourse)
├── common/
│   ├── common.scss     # core skin: colors, buttons, header, topic list, cards
│   └── header.html     # slim brand bar — static HTML, ptah.live hardcoded
├── assets/
│   └── ptah-logo.svg   # brand mark, referenced from common.scss ($ptah-logo)
├── scripts/
│   └── apply-theme.rb  # best-effort rails-runner apply script (dev only)
└── README.md
```

There is no `settings.yml` — the brand bar has no configurable options; it's
static markup with `https://ptah.live` hardcoded (see "Static header" note
below).

## Color scheme reference (copy-paste table)

These are the exact values baked into `about.json` → `color_schemes.Ptah`.
Use this table if you'd rather create the color scheme by hand in
**Admin → Customize → Colors → New**.

| Discourse field     | Hex       | Brand meaning                           |
| ------------------- | --------- | --------------------------------------- |
| `primary`           | `#e9ebef` | Primary text/foreground (`ink-100`)     |
| `secondary`         | `#08090c` | Page background (`ink-950`)             |
| `tertiary`          | `#f5a524` | Amber accent — links, primary buttons   |
| `quaternary`        | `#ffbb4d` | Bright amber accent (hover/emphasis)    |
| `header_background` | `#0e1015` | Header bar background (`ink-900`)       |
| `header_primary`    | `#e9ebef` | Header text/icons                       |
| `highlight`         | `#f5a524` | "Jump to post" flash / search highlight |
| `danger`            | `#fb7185` | Destructive actions (also `error`)      |
| `success`           | `#34d399` | Success states                          |
| `love`              | `#fb7185` | "Like"/heart icon color                 |

Extra brand neutrals used inside `common.scss` (not part of Discourse's core
10-color scheme, so they're plain CSS custom properties, not theme colors):
`#12141a` (card surface), `#171a21` / `#262a33` (borders), `#b7bdc9` (muted
text), `#eab308` (warning), `#38bdf8` (info).

## Import — production (`community.ptah.live`)

**Recommended today: manual upload.** Discourse's git-repo importer expects
`about.json` to live at the **root** of the git URL you give it. This theme
lives in a subdirectory of the `ptah-extension` monorepo, which Discourse's
importer can't target directly (there's no documented "subdirectory" option).
Until/unless this folder is mirrored to its own repo (or an orphan branch),
use the always-works path:

1. Zip the contents of `discourse-theme/` (the files, not the parent folder —
   `about.json` must be at the zip root).
2. **Admin → Customize → Themes → Install → From your device** → upload the
   zip.
3. Confirm the "Ptah" color scheme was created (**Admin → Customize →
   Colors**) and is applied to the theme (**Admin → Customize → Themes →
   Ptah Community → Colors** dropdown → select "Ptah").
4. **Admin → Customize → Themes → Ptah Community → Set as default theme.**
5. **Site logo** — a **global** `SiteSetting`, NOT carried by the theme import:
   **Admin → Settings → Branding** → set `logo`, `logo_small`, and `mobile_logo`
   to `assets/ptah-logo.svg`. (Option B / the rails apply script below does this
   step for you automatically.)

There's nothing else to configure under a **Settings** tab — the theme has no
`settings.yml`; the brand bar in `common/header.html` is static HTML with the
`https://ptah.live` link hardcoded (see "Static header" below).

**If/when this folder is published to its own git repo** (e.g.
`github.com/hive-academy/ptah-discourse-theme`, updated by a small CI step
that pushes `discourse-theme/` on tag/merge): **Admin → Customize → Themes →
Install → From a git repository** → paste the repo URL → Discourse will track
it and offer a "Check for updates" button going forward. This is the better
long-term path once that mirror exists — note it's not wired up yet.

## Dev apply — local `discourse_dev` container

Matches the container/workflow already documented in
`docs/deploy/local-testing-setup.md` (Workstream A): the Rails app lives at
`/src` inside the `discourse_dev` container, run as the `discourse` user.

### Option A — rails runner script (fast, best-effort)

```bash
# 1. Copy the theme folder from the host into the container.
docker cp "discourse-theme" discourse_dev:/tmp/ptah-theme

# 2. Apply it (creates/updates the Theme + "Ptah" ColorScheme, sets it default).
docker exec -u discourse:discourse discourse_dev bash -lc \
  "cd /src && bin/rails runner /tmp/ptah-theme/scripts/apply-theme.rb"

# 3. Hard-refresh http://localhost:3001 (no restart needed — Discourse
#    recompiles theme SCSS/settings on save).
```

`scripts/apply-theme.rb` uses `Theme#set_field` / `ColorScheme` / `UploadCreator`
directly (the same primitives Discourse's own theme importer uses internally)
rather than a git clone, since the container has no network path back to this
Windows-side monorepo checkout. It applies the theme fields, the "Ptah" color
scheme, sets it as default, **and sets the site logo** (`logo`/`logo_small`/
`mobile_logo`) from `assets/ptah-logo.svg` — so one run wires up the full
branding. **This is a best-effort script** — those APIs aren't part of
Discourse's documented external plugin surface and can drift across versions;
the logo step is non-fatal (WARN + fall back to the manual Settings upload). If
it errors on your Discourse checkout, use Option B (manual Admin UI).

### Option B — manual Admin UI (guaranteed to work)

Same as the production steps above, just point your browser at
`http://localhost:3001/admin/customize/themes` instead of
`https://community.ptah.live/admin/customize/themes`.

### Option C — official `discourse_theme` CLI (best dev-loop, optional)

Discourse publishes a small Ruby gem for exactly this
(`gem install discourse_theme`, from the host, no rails runner needed):

```bash
discourse_theme new discourse-theme        # only if about.json didn't exist yet
discourse_theme upload discourse-theme     # one-shot upload
discourse_theme watch discourse-theme      # live-reload while editing
```

It talks to Discourse's Admin API (`http://localhost:3001` + an admin API
key you generate under **Admin → API → New API Key**), so it works whether
the container is reachable via `localhost:3001` (host) — no `docker exec`
required at all. Mentioned here as the officially documented workflow; not
scripted into this repo since it requires an interactively-generated API key.

## Static header

`common/header.html` is plain static HTML — no `{{#if}}`/`{{settings.*}}`
Handlebars interpolation. An earlier draft assumed Discourse compiles HTML
theme fields as templates with theme `settings` in scope; that was an
unverified assumption (could render as literal `{{...}}` text in production),
so the brand bar was rewritten to hardcode the `https://ptah.live` link
directly. Same markup/classes as before, so `.ptah-brand-bar*` styling in
`common.scss` still applies unchanged. Net effect: the bar always shows and
always points at `https://ptah.live` — if a configurable link is needed
later, that requires re-introducing `settings.yml` plus verifying Discourse's
actual HTML-field templating support first.

## Notes / assumptions

See `.ptah/specs/TASK_2026_167/discourse-theme.md` for the full list of
schema assumptions made while building this (the `assets.ptah-logo` →
`$ptah-logo` SCSS variable convention, and the `Theme#set_field`/
`ColorScheme` internals used by `scripts/apply-theme.rb`).
