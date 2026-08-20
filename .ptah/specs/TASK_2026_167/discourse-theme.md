# A2 — Ptah Community Discourse Theme

Package: `discourse-theme/` (repo root, sibling to `apps/` and `libs/`).

## What was built

```
discourse-theme/
├── about.json           # manifest: name "Ptah Community", component:false,
│                         # dark "Ptah" color_scheme (brand hex table below),
│                         # assets.ptah-logo → assets/ptah-logo.svg
├── locales/en.yml        # theme_metadata.description (no settings — see below)
├── common/
│   ├── common.scss      # core skin — see "Styling coverage" below
│   └── header.html      # slim brand bar — static HTML, ptah.live hardcoded
├── assets/
│   └── ptah-logo.svg    # ankh mark, amber (#f5a524) stroke — copy of the
│                         # landing page's public/assets/icons/ptah-logo.svg
│                         # with the gold stroke swapped to the exact brand
│                         # amber token
├── scripts/
│   └── apply-theme.rb   # rails-runner dev-apply script (see README)
└── README.md             # import instructions (prod + dev) + color table
```

There is no `settings.yml`/`scss/` scaffolding in the final package — see
"Post-review fix" below.

## Brand tokens → Discourse color scheme mapping

Discourse's core color scheme has exactly 10 fields; the brand palette maps
cleanly onto 8 of them, with 2 reuses noted:

| Discourse field     | Hex       | Source token                     |
| ------------------- | --------- | -------------------------------- |
| `primary`           | `#e9ebef` | `ink-100` (primary text)         |
| `secondary`         | `#08090c` | `ink-950` (page background)      |
| `tertiary`          | `#f5a524` | `amber-500` (accent/links/CTAs)  |
| `quaternary`        | `#ffbb4d` | `amber-400` (bright accent)      |
| `header_background` | `#0e1015` | `ink-900`                        |
| `header_primary`    | `#e9ebef` | `ink-100`                        |
| `highlight`         | `#f5a524` | `amber-500` (reused — see below) |
| `danger`            | `#fb7185` | error token                      |
| `success`           | `#34d399` | success token                    |
| `love`              | `#fb7185` | reused from `danger` (see below) |

Tokens with **no** slot in Discourse's core scheme (`ink-850` `#12141a`,
borders `#171a21`/`#262a33`, muted text `#b7bdc9`, `warning` `#eab308`, `info`
`#38bdf8`) are declared as plain CSS custom properties (`--ptah-*`) at the top
of `common/common.scss` instead of invented as fake Discourse SCSS variables.

`amber-600` (`#c97e0e`, the hover token) is used directly as a hardcoded hex
in `common.scss` button/link hover states (`--ptah-amber-hover`) rather than
forced into one of the 10 scheme slots.

## Post-review fix — static header (must-fix from visual review)

The first draft had `common/header.html` reading two theme settings via
`{{#if settings.show_brand_header}}` / `{{settings.header_home_url}}`. Visual
review flagged that as an unverified assumption about Discourse's HTML
theme-field templating — it could render as literal `{{...}}` text in
production instead of being interpreted. Fix applied:

- `common/header.html` rewritten as plain static HTML: the brand bar always
  renders, and the link is hardcoded to `https://ptah.live`. Same markup/
  classes (`.ptah-brand-bar`, `.ptah-brand-bar__link`, etc.), so the existing
  `common.scss` styling is untouched.
- `header_home_url` / `show_brand_header` removed — deleted `settings.yml`
  entirely (it had no other keys) and dropped their descriptions from
  `locales/en.yml`, keeping `theme_metadata.description`.
- `scripts/apply-theme.rb` no longer writes a `:settings` theme field (there's
  no `settings.yml` to read).
- Deleted the empty, unused `discourse-theme/scss/` directory (dead
  scaffolding from the initial pass — real SCSS lives in `common/common.scss`).
- Removed `learn_more` from `about.json` — unconfirmed as an actual
  `about.json` schema field, dropped to avoid importer weirdness.

Net effect: the theme is now fully static (no settings surface at all), which
is a strictly safer default given the Handlebars assumption couldn't be
verified. Re-adding a configurable link/toggle later requires first
confirming Discourse's actual HTML theme-field templating support (or using
a `<script type="text/discourse-plugin">` initializer instead, which is
unambiguously JS, not templated HTML).

## Assumptions made (flagged per task instructions, not guessed silently)

1. **`assets.ptah-logo` → `$ptah-logo` SCSS variable.** Discourse exposes
   `about.json`'s `assets` map as SCSS variables of the same key inside theme
   SCSS (used in `common.scss` as `background-image: url($ptah-logo)`), not
   as raw URLs usable directly in HTML fields — hence the brand bar renders
   an empty `<span>` styled via that SCSS variable rather than an `<img>`.
2. **`scripts/apply-theme.rb`'s `Theme#set_field` / `ColorScheme` /
   `Theme#set_default!` APIs.** These are the internal primitives Discourse's
   own theme importer and specs use, but they are NOT part of a documented
   external plugin API and can drift between Discourse versions/branches.
   The script is offered as a fast dev-loop option; the README's Option B
   (manual Admin UI import, using the color table above) is the
   guaranteed-to-work fallback if the script errors on a given checkout.
3. **Git-repo import across the monorepo boundary.** Discourse's
   "Install → From a git repository" importer expects `about.json` at the
   git URL's root. Since `discourse-theme/` is a subdirectory of this
   monorepo, that importer can't target it directly today — documented as a
   manual-zip-upload path now, with a note that mirroring this folder to its
   own repo/orphan branch would unlock true git-tracked "Check for updates."
4. **Webfont delivery.** Inter + JetBrains Mono are pulled via a Google Fonts
   `@import url(...)` in `common.scss` rather than bundled as woff2 assets —
   one external request per family, cached broadly; flagged as a tradeoff
   inline in the SCSS comment, with self-hosting via theme `assets/` as the
   documented upgrade path if a strict no-external-requests policy is later
   required. (Accepted as-is per visual review.)

## Not done here (out of scope for A2)

- No actual git remote was created/pushed for this theme (task says "do NOT
  commit to git" for this artifact and the repo mirror described in
  assumption #4 is future work).
- Favicon: about.json doesn't declare one — Discourse's favicon is a global
  site setting (`Admin → Customize → Emojis/Logo`), not a theme-owned asset;
  the brand mark is instead surfaced via the `common/header.html` brand bar
  and `assets/ptah-logo.svg`.
