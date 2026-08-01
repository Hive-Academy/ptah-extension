# Ptah Community — Discourse theme

A dark, amber-accented Discourse theme matching `ptah.live` (see
`.ptah/specs/TASK_2026_167/context.md`). Dark only — there is no light variant.

```
apps/ptah-discourse-theme/
├── about.json          # theme manifest: name, dark "Ptah" color scheme, assets
├── locales/en.yml       # theme_metadata.description (required by Discourse)
├── common/
│   ├── common.scss     # core skin: colors, buttons, header, topic list, cards
│   └── header.html     # slim brand bar — static HTML, ptah.live hardcoded
├── assets/
│   └── ptah-logo.svg   # brand mark, referenced from common.scss ($ptah-logo)
├── tools/
│   └── deploy-theme.mjs # package + push to Discourse's admin API (dev & prod)
├── scripts/
│   └── apply-theme.rb  # legacy rails-runner script — logo bootstrap only
├── project.json        # Nx targets: build / deploy / watch
└── README.md
```

Only the theme files ship: `deploy-theme.mjs` packages from an **allowlist**
(`about.json`, `settings.yml`, `assets/`, `common/`, `desktop/`, `mobile/`,
`locales/`, `javascripts/`, `scss/`, `migrations/`), so `README.md`,
`project.json`, `tools/` and `scripts/` can never leak into a published bundle.

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

## Deploying

One script drives both environments — `tools/deploy-theme.mjs` packages the
theme and pushes it to Discourse's admin API
(`POST /admin/themes/import`, multipart field `bundle`). Passing `theme_id`
makes Discourse **update that theme in place** via `RemoteTheme.update_zipped_theme`
rather than creating a duplicate, so re-deploying is idempotent. Dev and prod
differ only by URL and credentials.

```bash
npm run theme:build          # validate + package -> dist/apps/ptah-discourse-theme/
npm run theme:deploy         # -> http://localhost:3001  (discourse_dev)
npm run theme:deploy:prod    # -> https://community.ptah.live
```

Production deploys normally run in CI: push `release/community` and
`.github/workflows/deploy-community-theme.yml` validates, packages, imports and
smoke-checks the forum. Merging to `main` does **not** touch the live site.

### Credentials

Set these in `.env` (see `.env.example`) or as CI secrets/variables:

| Variable                       | Notes                                         |
| ------------------------------ | --------------------------------------------- |
| `DISCOURSE_THEME_API_KEY`      | **Global**-scope, single-user (admin) key     |
| `DISCOURSE_THEME_API_USERNAME` | defaults to `system`                          |
| `DISCOURSE_THEME_ID`           | theme to update — blank only on first install |

> [!WARNING]
> The license server's `DISCOURSE_API_KEY` will **not** work. That key is scoped
> to `groups: manage` + `users: list`, and Discourse hides admin routes from
> non-admin keys behind a **404 rather than a 403** — so it fails as a confusing
> "not found". Create a separate Global-scope key under **Admin → API → New API
> Key**. The deploy script detects this case and says so.

> [!IMPORTANT]
> `DISCOURSE_THEME_ID` must be pinned. With it blank, every deploy creates
> another duplicate theme instead of updating the live one. Run the deploy once
> with it unset — the script prints the id it created — then pin that value.

The vars are namespaced `DISCOURSE_THEME_*` on purpose: the license server's
`DISCOURSE_URL`/`DISCOURSE_API_KEY` point at **production** in a normal `.env`,
so inheriting them would make a plain local `theme:deploy` write to the live
forum. The deploy script never reads them. It also refuses any non-localhost
target unless `--yes` is passed or `CI` is set.

### First-time bootstrap (once per Discourse instance)

1. `node tools/deploy-theme.mjs --url <url> --set-default` with
   `DISCOURSE_THEME_ID` unset — creates the theme, applies the "Ptah" color
   scheme, and marks it the site default. Note the printed id.
2. Pin that id as `DISCOURSE_THEME_ID` (local) / the `DISCOURSE_THEME_ID` repo
   variable (CI). Every later deploy updates in place.
3. **Site logo** — a global `SiteSetting`, _not_ carried by a theme import.
   Set it once: **Admin → Settings → Branding** → `logo`, `logo_small`,
   `mobile_logo` → upload `assets/ptah-logo.svg`. (Or run
   `scripts/apply-theme.rb`, which still does this step — see below.)

`--set-default` is deliberately opt-in, not part of a routine deploy, so a
content push can never silently re-point the live forum's active theme.

### Local dev loop

`npm run theme:deploy` after each edit is usually enough. For live reload while
editing, Discourse's official CLI works against `localhost:3001`:

```bash
gem install discourse_theme
nx watch ptah-discourse-theme      # discourse_theme watch .
```

Note the gem is **dev-only** — its `upload` command errors with
`"No theme_id is set, please sync via the 'watch' command initially"`, reads no
environment variables, and can only create a theme through an interactive
prompt, so it can't run in CI. That's why the API script above exists.

### Fallbacks

- **`scripts/apply-theme.rb`** (rails runner, needs container shell access) —
  superseded for theme content, but still the one automated path that sets the
  **site logo**. It uses Discourse internals (`Theme#set_field`, `ColorScheme`,
  `UploadCreator`) that aren't a documented external API and can drift across
  versions.
  ```bash
  docker cp apps/ptah-discourse-theme discourse_dev:/tmp/ptah-theme
  docker exec -u discourse:discourse discourse_dev bash -lc \
    "cd /src && bin/rails runner /tmp/ptah-theme/scripts/apply-theme.rb"
  ```
- **Manual upload** (always works) — `npm run theme:build`, then **Admin →
  Customize → Themes → Install → From your device** and upload
  `dist/apps/ptah-discourse-theme/ptah-community-theme.zip`.

### Why not Discourse's git-repo importer?

It expects `about.json` at the **root** of the git URL, and this theme is a
subdirectory of the monorepo — there's no documented "subdirectory" option.
Using it would require mirroring this folder to its own repo. The admin-API
push above avoids that entirely and deploys immediately rather than on
Discourse's remote-theme polling interval.

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
