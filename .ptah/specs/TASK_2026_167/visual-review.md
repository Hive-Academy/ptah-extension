# Visual Review — TASK_2026_167 (A2 Discourse Theme + B2 Community Widget)

## Review Summary

| Metric               | Value                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall Score        | 6.5/10                                                                                                                                                               |
| Assessment           | NEEDS_REVISION (verify one runtime assumption before ship)                                                                                                           |
| Method               | **Static/source review only** — no live Discourse instance, no browser. All findings below are read-only reasoning about markup/SCSS/JSON, not rendered screenshots. |
| Must-fix-before-ship | 1 (theme), 0 (widget)                                                                                                                                                |
| Should-verify        | 2 (theme)                                                                                                                                                            |
| Polish / minor       | 5 (theme: 3, widget: 2)                                                                                                                                              |

---

## Part 1 — Discourse theme package (`discourse-theme/`)

### Structural validity — mostly sound, one unverifiable core assumption

- `about.json:1-27` — the shape matches Discourse's documented schema: `name`, `component`, `authors`, `about_url`, `theme_version`, `minimum_discourse_version`, `assets`, `color_schemes`, `modifiers`. The 10 `color_schemes.Ptah` fields (`primary`/`secondary`/`tertiary`/`quaternary`/`header_background`/`header_primary`/`highlight`/`danger`/`success`/`love`) are exactly Discourse core's base color-scheme fields — no invented keys, no missing required ones. **Polish**: `learn_more` (`about.json:26`) is not a field I can confirm exists in Discourse's about.json schema. It's very likely just silently ignored by the importer (unknown top-level keys don't fail import), but flagging since I can't verify it's a real, honored key.
- `locales/en.yml:1-7` — covers both `settings.yml` keys (`header_home_url`, `show_brand_header`) plus `theme_metadata.description`. Correct nesting under `en:`. No gaps.
- `settings.yml:1-6` — valid `default`/`type` shape for both settings.
- **Must-verify-before-ship**: `common/header.html:12-24` assumes Discourse's HTML theme field (`header.html`) supports Handlebars-style `{{#if settings.show_brand_header}}` / `{{settings.header_home_url}}` with a `settings` object in scope. I cannot confirm this is the correct interpolation syntax for Discourse's theme HTML-field compiler (I have moderate-to-low confidence the actual mechanism is a `{{setting "name"}}` _helper call_ rather than dot-path object access, and that conditional blocks in these fields have historically been limited). The task's own `discourse-theme.md:58-64` already flags this exact risk and gives two fallbacks (static variants, or a `<script type="text/discourse-plugin">` initializer). **This is the single item that could make the entire A2 brand-bar deliverable silently no-op or render literal `{{...}}` text in production** — it needs a real render check against the `discourse_dev` container (`docker cp` + hard refresh) before this ships, not just a code read. Everything else in the package is inert if this one field is wrong (SCSS/color scheme still apply independently), so the blast radius is contained to the brand bar only — hence NEEDS_REVISION rather than REJECTED.
- `scripts/apply-theme.rb` — plausible use of `Theme#set_field` / `ColorScheme` / `set_default!`; I can't execute Rails to confirm, and the author already flags this as best-effort with a guaranteed-fallback (manual Admin UI import). Acceptable as documented.
- **Minor**: an empty `discourse-theme/scss/` directory exists on disk (confirmed via directory listing) with zero files in it. Git won't track an empty directory, so this is inert, but it's dead scaffolding — either populate it or delete it so the tree matches what's documented.

### Brand accuracy — accurate, restrained amber usage

Verified every hex in `about.json` and `common.scss` against context.md's token table — all match exactly (`#08090c`, `#0e1015`, `#12141a`, `#171a21`, `#262a33`, `#e9ebef`, `#b7bdc9`, `#f5a524`, `#c97e0e`, `#ffbb4d`, `#34d399`, `#eab308`, `#fb7185`). No drift, no approximated hex values.

- Amber (`$tertiary`/`#f5a524`) usage in `common.scss` is genuinely restrained: links (`a`, line 65), primary buttons (`.btn-primary`, line 133-152), header icon hover (line 182-185), unread/new-topic badges (line 260-264), topic-title hover (line 246-253), and the scrollbar-thumb hover (line 314-316). It is not used as a background wash or applied indiscriminately — matches the "single restrained accent" brief.
- `assets/ptah-logo.svg` is confirmed to be the landing page's `public/assets/icons/ptah-logo.svg` geometry (circle + ankh crossbar path, identical `viewBox`/coordinates) with only the stroke color swapped from the old gold `#d4af37` to the exact brand amber `#f5a524` — accurate reuse, not a re-drawn approximation.
- **Polish / off-brand flag**: `--ptah-info: #38bdf8` (`common.scss:36`) is **not** one of the brand tokens listed in context.md (which only specifies base/border/text/amber/success/warning/error — no "info" color). It's a reasonable Tailwind-sky-400-ish choice for `.alert-info` styling, but it was invented, not sourced from brand — worth a design sign-off rather than treating it as pre-approved.
- Two color-scheme slots are knowingly reused rather than given unique brand hexes (`highlight` = `tertiary` = amber, `love` = `danger` = `#fb7185`). Documented and reasonable given Discourse's fixed 10-slot scheme, but note the practical effect: Discourse's "jump to post" flash-highlight will use the same amber as every link/button, slightly reducing its attention-grabbing contrast against the rest of the UI (low severity — the flash is a transient background fade, not a static color, so it likely still reads fine).

### Robustness — mixed; core color/typography wiring is solid, several selectors are brittle

- Good: most of the file targets Discourse's actual SCSS color variables (`$primary`, `$secondary`, `$tertiary`, `$header_background`, `$header_primary`, `$danger`, `$success`) rather than hardcoded hex, so a color-scheme change would propagate correctly.
- Fragile-selector concern (as asked to flag): a number of rules key off deep, multi-level, highly specific DOM structure that historically shifts across Discourse core upgrades, e.g. `common.scss:242` `.topic-list-item.visited td.main-link .link-top-line a.title:not(.badge-notification)`, and the long comma-separated surface list at `common.scss:93-113` (`.topic-list, .category-boxes, ..., .select-kit-body`). Any one of those class names disappearing/renaming in a future Discourse release silently drops that surface's styling (no error, just a visual regression) — acceptable for a v1 skin, but should be flagged as an ongoing maintenance cost, which is exactly what the review was asked to call out.
- Fonts: `common.scss:23` `@import url("https://fonts.googleapis.com/css2?family=Inter...")` is a reasonable, working approach, self-documented as a tradeoff (external request per page load vs. self-hosted woff2). Not a defect, just a known tradeoff already flagged inline by the author.

### A11y / contrast — passes cleanly, no concerns found

I computed WCAG relative-luminance contrast ratios for every text/background pairing actually used in the theme:

| Pairing                                                             | Ratio   | WCAG AA (4.5:1 normal text) |
| ------------------------------------------------------------------- | ------- | --------------------------- |
| Amber `#f5a524` on `#08090c` (links on page bg)                     | 9.76:1  | Pass (AAA)                  |
| Amber `#f5a524` on `#0e1015` (header links)                         | 9.32:1  | Pass (AAA)                  |
| Bright amber `#ffbb4d` on `#08090c`                                 | 11.82:1 | Pass (AAA)                  |
| Muted `#b7bdc9` on `#08090c`                                        | 10.56:1 | Pass (AAA)                  |
| Muted `#b7bdc9` on card `#12141a`                                   | 9.76:1  | Pass (AAA)                  |
| Primary text `#e9ebef` on `#08090c`                                 | 16.68:1 | Pass (AAA)                  |
| Amber-hover `#c97e0e` on `#08090c` (or as btn bg vs `#08090c` text) | 6.14:1  | Pass (AA, not AAA)          |
| Danger `#fb7185` on `#08090c`                                       | 7.40:1  | Pass (AAA)                  |
| Info `#38bdf8` on `#08090c`                                         | 9.29:1  | Pass (AAA)                  |

No contrast failures anywhere in the palette — genuinely a well-chosen dark palette. The only sub-AAA pairing (amber-hover button, 6.14:1) still clears AA comfortably.

---

## Part 2 — Community widget (`community-topic-list.component.ts` + `members-page.component.ts` wiring)

**Method**: source-level only — cannot run the Angular app or a browser here, so this is reasoning about the rendered DOM shape from the template/Tailwind classes, not a verified screenshot.

### What looks right

- `community-topic-list.component.ts:79-84` — correct Tailwind truncation pattern (`flex-1 min-w-0` wrapping a `truncate` title). This actually works for arbitrarily long single-word titles/URLs (no `break-words`, so `truncate`'s `white-space: nowrap` + ellipsis will clip regardless of word boundaries) — good stress-test resilience.
- Design-token consistency confirmed by grep against the rest of `members-page.component.ts` and sibling components (`session-card`, `builders-pitch`): `border-secondary/10`, `divide-secondary/10`, `text-neutral-content`, `group-hover:text-secondary` are all pre-existing conventions on this page (daisyui `secondary` = `#34d399`, used consistently as this page's interactive-accent color for icons/hovers). The new widget matches this convention exactly rather than introducing a new one — no visual inconsistency here.
- Degradation is correctly wired end-to-end:
  - `members-page.component.ts:195` gates the _entire_ community section (CTA + topic list) behind `communitySsoUrl()` — when `communityUrl` is `null`, only the "being set up" fallback paragraph renders (`members-page.component.ts:239-241`). Matches the "hidden when communityUrl null" requirement.
  - Empty topics (`[]`, not loading): the `@if (topicsLoading()) {...} @else if (topics().length > 0) {...}` (`members-page.component.ts:220-237`) has no `@else` branch, so an empty list renders nothing extra — the CTA row above is untouched. Matches "empty → keeps the CTA" requirement.
  - `buildMeta()` (`community-topic-list.component.ts:131-138`) drops empty segments (`categoryName: null`, unparseable/`null` `lastPostedAt`) rather than emitting stray separators like `" · · 3 posts"` — robust to partial data.
- `formatRelativeTime` (`community-topic-list.component.ts:33-47`) is a clean, self-contained `Intl.RelativeTimeFormat` walk with a safe `NaN`-date guard returning `''` — no risk of rendering "Invalid Date".

### Polish (not blocking)

1. **Loading→loaded layout shift**: the skeleton (`members-page.component.ts:220-231`) always renders exactly 3 pulsing rows, while the real list can render up to 5 (`community-topic-list.component.ts:118`, capped at 5). If the API returns 4-5 topics, the card grows taller the instant real data replaces the skeleton — a small but real CLS-style jump. Low severity (single card section, not above-the-fold on load), but easy to avoid by sizing the skeleton to the eventual max (5 rows) or a fixed-height container.
2. **Meta line can wrap unevenly on narrow widths**: `community-topic-list.component.ts:86` (`<p class="mt-0.5 text-xs text-neutral-content">{{ row.meta }}</p>`) has no `truncate`, so a long category name concatenated with the relative-time and post-count segments (e.g. `"Really Long Category Name For A Sub-forum · 2 weeks ago · 12 posts"`) will wrap to two lines on mobile widths while shorter rows stay one line — rows end up visually uneven height. Minor, content-dependent, no functional break.
3. **Redundant `aria-label`**: `community-topic-list.component.ts:78` sets `[attr.aria-label]="'Open ' + row.title + ' in the community'"` on an anchor that already has visible text (`row.title` + meta), which fully overrides the computed accessible name (dropping the meta text and icon from it). Not wrong, just duplicative — the visible title text alone would likely have sufficed as the accessible name.

I found no actual visual-breaking issues in the widget's static template — truncation, spacing, hover states, and empty/loading/hidden states are all internally consistent with each other and with the surrounding page.

---

## Verdict

**Recommendation**: NEEDS_REVISION (theme only — the widget is fine as-is).
**Confidence**: MEDIUM — genuinely limited by static-only review; the one thing I'd most want a live check for is exactly the thing I can't check statically.
**Key concern**: `discourse-theme/common/header.html`'s `{{#if settings.show_brand_header}}` / `{{settings.header_home_url}}` syntax is an unverified assumption about Discourse's HTML theme-field templating. Before shipping A2, apply the theme to the `discourse_dev` container (per the README's own "Dev apply" section) and visually confirm the brand bar actually renders — if the syntax is wrong, the fallback path (static header variants or a `<script type="text/discourse-plugin">` initializer) already documented in `discourse-theme.md` should be used instead.

Everything else — brand token accuracy, contrast, amber restraint, `about.json`/`locales`/`settings.yml` structural shape, and the B2 widget's template/degradation logic — checks out on this static pass.
