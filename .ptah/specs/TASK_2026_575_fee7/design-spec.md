# Design Spec — Language Switcher & RTL Treatment

TASK_2026_575_fee7 · Gate 1.7 · ui-ux-designer

Scope: the EN/AR language switcher (public header, member shell, admin shell)
and the RTL (Arabic) visual treatment for `ptah-landing-page`. Requirements
are approved (`task-description.md` rev 1); this spec does not re-open them.
Two items remain explicit **user decisions** and are marked `[DECISION]`
below and in Open Questions: numbering system, legal governing-language
notice wording/alternative.

Every value below traces to an existing token, an existing component
pattern, or is stated as new with its rationale. Contrast pairs are measured
against WCAG 2.2 AA (4.5:1 text, 3:1 non-text) — the project's own
`base-content-muted.spec.ts` already gates the muted-text tier at 4.5:1, so
this spec follows that standard rather than introducing a different one.

---

## 1. Existing system read (source of every token used below)

- **Themes** (`apps/ptah-landing-page/tailwind.config.js`): `operator`
  (public marketing shell, dark only), `operator-admin` (admin shell, dark
  only), `operator-member` / `operator-member-light` (member shell, user
  toggles via `MemberThemeService`). `base-100/200/300`, `base-content`,
  `base-content-muted` (token, `--bcm` per theme), `surface-high`,
  `hairline` (→ `border-hairline`), `primary` = `#f5a524` (amber) in every
  theme.
- **Public header** (`libs/web/ui/src/lib/navigation.component.ts`): a
  bespoke (non-DaisyUI) fixed nav on `ink-900/950` with `white/80` text,
  `amber-500` accents, and three mutually-exclusive disclosure menus (`Product`
  / `Community` / `User`) driven by one tri-state `openMenu` signal, each
  rendered as `role="menu"` / `role="menuitem"` in a
  `bg-slate-950/95 backdrop-blur-md border border-amber-500/10 rounded-lg
  shadow-lg` panel. Escape closes + refocuses trigger; outside-click closes.
  Mobile menu is a full-width slide-down panel with grouped sections.
- **Member shell topbar** (`member-layout.html` → `panelTopBar` slot) and
  **admin shell topbar** (`admin-layout.html` → same slot) both project into
  **the same shared header markup**, `panel-layout.html`'s
  `<header class="sticky top-0 z-10 flex items-center justify-between gap-3
  border-b border-hairline bg-base-200 px-4 py-3 lg:px-6">`, ending in
  `<div class="flex items-center gap-2 text-sm text-base-content-muted">
  <ng-content select="[panelTopBar]" /></div>`. `MemberThemeToggle` is the
  one existing control in that slot today, styled
  `btn btn-sm gap-2 border border-hairline bg-base-200
  text-base-content-muted hover:bg-surface-high hover:text-base-content`,
  icon `aria-hidden`, caption hidden below `sm`, `aria-label`/`title` =
  destination label.
- **Fonts** (`index.html`): Inter (sans, wght 400/500/600/700/800) +
  JetBrains Mono (mono, wght 400/500/600/700), Google Fonts, preconnected,
  `display=swap`. No Arabic glyphs today.
- **Landing animated sections**: GSAP + `ScrollTrigger` in
  `builders-section.component.ts` (seamless `xPercent` marquee + scrubbed
  rail) and `pillars-spine.component.ts` (scrubbed vertical spine with a
  centred node), plus a scrubbed tug-of-war bar in
  `comparison-tug-meter.component.ts`. `console-grid-background.component.ts`
  (`libs/web/ui`), `falling-cubes-background.component.ts` (`libs/web/legal`)
  and `auth-hero.component.ts` (`libs/web/auth`) hold decorative CSS/inline
  positioning per the task brief.

---

## 2. Language switcher

### 2.1 Component form (one decision, two skins)

**One logical control, `LanguageSwitch`, in `@ptah-web/ui` (or `panel-ui` for
the panel skin — see 2.4), with two visual skins** because it sits in two
visual systems that already diverge (bespoke marketing nav vs. DaisyUI panel
chrome — the same divergence `MemberThemeToggle` already lives inside).
Forcing one skin into both would mean reskinning either the marketing nav's
custom menus or the DaisyUI panel buttons; neither is in scope. Both skins
share one accessibility contract (2.5) and one label set (2.6).

- **Public header skin — disclosure menu button.** Matches the existing
  `Product` / `Community` / `User` pattern exactly (same trigger shape, same
  panel styling), so it reads as "a fourth menu of the same kind" rather than
  a foreign control.
- **Member/admin shell skin — two-button segmented toggle
  (`role="radiogroup"`).** Matches `MemberThemeToggle`'s button-in-topbar
  idiom (a compact `btn btn-sm` in the shared `panelTopBar` slot), but a
  toggle rather than a menu because there are exactly two mutually exclusive
  values shown side by side — the same shape DaisyUI's own `join`/segmented
  pattern uses, and faster to operate (one click, no open/close step) than a
  dropdown would be for a 2-item set.

### 2.2 Public header — desktop (≥ `md`, 768px+)

Placed **between `Docs` and the `Login`/`Sign Up` (or `User` menu) cluster**,
inside the existing `<div class="hidden md:flex items-center gap-6">` —
i.e. it becomes a fourth top-level item alongside `Product`, `Pricing`,
`Docs`, `Community`. Placing it here (not after Download) keeps the primary
CTA (`Download Ptah`) the visually last, most prominent element, unchanged —
switching language is wayfinding, not a conversion action, so it belongs with
the other wayfinding controls.

Trigger button:

```html
<button
  type="button"
  id="lang-menu-trigger"
  class="flex items-center gap-1.5 text-sm font-medium transition-colors rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
  [ngClass]="openMenu() === 'lang' ? 'text-amber-500' : 'text-white/80 hover:text-amber-500'"
  aria-haspopup="menu"
  [attr.aria-expanded]="openMenu() === 'lang'"
  aria-controls="lang-menu"
  [attr.aria-label]="('nav.language' | transloco) + ': ' + currentLanguageNativeName()"
  (click)="toggleMenu('lang')"
>
  <lucide-angular [img]="GlobeIcon" class="w-4 h-4" aria-hidden="true" />
  {{ activeLang() === 'ar' ? 'AR' : 'EN' }}
  <lucide-angular [img]="ChevronDownIcon" class="w-4 h-4 transition-transform duration-200"
    [class.rotate-180]="openMenu() === 'lang'" aria-hidden="true" />
</button>
```

- Icon: `Globe` (lucide-angular, already an available icon family in this
  app). Visible caption: `EN` / `AR` (2-letter code — short by design; the
  full native name lives in the menu and in the `aria-label`, not duplicated
  on the trigger where marketing-nav real estate is tight, exactly the
  reasoning `MemberThemeToggle` already applies by hiding its caption below
  `sm`).
- `openMenu` signal on `NavigationComponent` widens from
  `'product' | 'community' | 'user' | null` to
  `'product' | 'community' | 'user' | 'lang' | null` — one more branch of the
  existing tri-state pattern, still mutually exclusive with the other three,
  still closed by the existing `closeMenuAndRefocus()` (Escape) and
  `onDocumentClick()` (outside-click) handlers with zero new wiring beyond
  adding `'lang'` to the union.

Menu panel (identical shell to `#community-menu`, `right`-anchored like it
since the switcher sits left of the auth links but the panel should not
overflow the viewport edge — mirror `left`/`right` anchoring per direction,
see §3):

```html
@if (openMenu() === 'lang') {
  <div id="lang-menu" role="menu" aria-labelledby="lang-menu-trigger"
    class="absolute left-0 top-full mt-2 w-40 rounded-lg border border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5 z-50">
    <button type="button" role="menuitemradio" lang="en" dir="ltr"
      [attr.aria-checked]="activeLang() === 'en'"
      class="flex w-full items-center justify-between px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
      [ngClass]="activeLang() === 'en' ? 'text-amber-500' : 'text-white/70 hover:text-white hover:bg-white/5'"
      (click)="setLanguage('en'); closeMenu()">
      English
      @if (activeLang() === 'en') { <lucide-angular [img]="CheckIcon" class="w-4 h-4" aria-hidden="true" /> }
    </button>
    <button type="button" role="menuitemradio" lang="ar" dir="rtl"
      [attr.aria-checked]="activeLang() === 'ar'"
      class="flex w-full items-center justify-between px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
      [ngClass]="activeLang() === 'ar' ? 'text-amber-500' : 'text-white/70 hover:text-white hover:bg-white/5'"
      (click)="setLanguage('ar'); closeMenu()">
      العربية
      @if (activeLang() === 'ar') { <lucide-angular [img]="CheckIcon" class="w-4 h-4" aria-hidden="true" /> }
    </button>
  </div>
}
```

Each item carries its **own** `lang`/`dir`, independent of the active UI
language, so a screen reader always pronounces "English" in English and
"العربية" in Arabic (3.8) — this is why the option labels are hard literals,
never translation keys.

### 2.3 Public header — mobile menu (< `md`)

Inside the existing slide-down panel, as its own ungrouped row (same tier as
Features/Builders/Pricing/Docs), directly **above** the `Account`/first
divider — a segmented toggle rather than a disclosure, because a mobile
overlay has no room for a second-level open/close step and a 2-way toggle is
one tap either way:

```html
<div role="radiogroup" [attr.aria-label]="'nav.language' | transloco"
  class="mx-4 mt-1 mb-2 flex rounded-lg border border-ink-700 bg-ink-950/60 p-1">
  <button type="button" role="radio" lang="en" dir="ltr" [attr.aria-checked]="activeLang() === 'en'"
    class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    [ngClass]="activeLang() === 'en' ? 'bg-amber-500 text-ink-950' : 'text-white/70 hover:text-white'"
    (click)="setLanguage('en')">English</button>
  <button type="button" role="radio" lang="ar" dir="rtl" [attr.aria-checked]="activeLang() === 'ar'"
    class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    [ngClass]="activeLang() === 'ar' ? 'bg-amber-500 text-ink-950' : 'text-white/70 hover:text-white'"
    (click)="setLanguage('ar')">العربية</button>
</div>
```

Row order in the RTL mobile menu does not itself flip (it is a stack, not a
horizontal row of independent items) — only the two buttons' internal
start/end alignment does, automatically, via `dir` (§3).

### 2.4 Member shell + admin shell — shared, single implementation

**Placement decision: add `LanguageSwitch` (panel skin) directly inside
`panel-layout.html`'s own header markup**, immediately **before**
`<ng-content select="[panelTopBar]" />`, not inside each shell's own
`panelTopBar` projection. `panel-layout.html` is the one file both
`member-layout.html` and `admin-layout.html` render through (confirmed:
both project into the same `<header>` → same `panelTopBar` slot in
`panel-layout.html`). Adding it there — once — satisfies "reachable from all
three [shells]" (it is literally the same DOM in both) with **zero
duplication** and zero risk of the two shells drifting out of sync, which
per-shell placement would risk. This is the move the brief explicitly
invites ("Gate 1.7 prototype may move it … into the shared
`libs/web/panel-ui/src/lib/panel-layout/panel-layout.ts`"), taken.

`panel-layout.ts` gains no new `@Input()` for this — `LanguageSwitch` reads
the shared i18n signal directly (same pattern `MemberThemeToggle` uses for
`MemberThemeService`), so `panel-layout.html` only needs one new line:

```html
<div class="flex items-center gap-2 text-sm text-base-content-muted">
  <ptah-language-switch />
  <ng-content select="[panelTopBar]" />
</div>
```

Visually it sits **left of** each shell's own topbar content (member's
"Signed in as …" / admin's own content) and **left of** `MemberThemeToggle`
on the member shell specifically — language is the more fundamental of the
two preferences and reads first, and grouping the two toggle-style controls
adjacent to each other (language, then theme) reads as one "preferences"
cluster rather than two unrelated controls.

Segmented toggle, DaisyUI/panel tokens only (matches `MemberThemeToggle`'s
`border-hairline` / `bg-base-200` / `surface-high` / `base-content-muted`
vocabulary exactly):

```html
<div role="radiogroup" [attr.aria-label]="'common.language' | transloco"
  class="inline-flex rounded-lg border border-hairline bg-base-200 p-0.5">
  <button type="button" role="radio" lang="en" dir="ltr" [attr.aria-checked]="activeLang() === 'en'"
    class="btn btn-xs rounded-md border-0 font-medium"
    [ngClass]="activeLang() === 'en' ? 'btn-primary' : 'btn-ghost text-base-content-muted hover:bg-surface-high hover:text-base-content'"
    (click)="setLanguage('en')">EN</button>
  <button type="button" role="radio" lang="ar" dir="rtl" [attr.aria-checked]="activeLang() === 'ar'"
    class="btn btn-xs rounded-md border-0 font-medium"
    [ngClass]="activeLang() === 'ar' ? 'btn-primary' : 'btn-ghost text-base-content-muted hover:bg-surface-high hover:text-base-content'"
    (click)="setLanguage('ar')">AR</button>
</div>
```

`btn-primary` = theme `primary` (`#f5a524`) on `primary-content` (`#08090c`)
in every theme (`operator-admin`, `operator-member`,
`operator-member-light`) — pre-measured by the theme itself, ≥ 4.5:1 in all
three (amber-on-near-black / amber-on-near-black / amber-on-near-black is
the darkest pairing; DaisyUI's own `primary-content` was chosen for exactly
this contrast in the existing theme spec). Caption stays visible at all
widths here (unlike `MemberThemeToggle`'s `hidden sm:inline`) because `EN`/
`AR` are only 2 characters — no `sm:` collapse needed.

### 2.5 States (both skins)

| State | Public header (menu) | Panel shells (segmented) |
| --- | --- | --- |
| Default (inactive option) | `text-white/70` | `btn-ghost text-base-content-muted` |
| Hover | `hover:text-white hover:bg-white/5` | `hover:bg-surface-high hover:text-base-content` |
| Focus-visible | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2` (trigger + each menu item) | same utility, applied to each radio button |
| Active/pressed (mouse-down) | native button `:active` (browser default; no custom class, matching sibling menus) | native button `:active` |
| Current/selected | trigger: `text-amber-500`; item: `text-amber-500` + `CheckIcon` + `aria-checked="true"` | `btn-primary` + `aria-checked="true"` |

### 2.6 Accessible name, option labels, keyboard

- **Trigger accessible name** (header skin): `aria-label` = the translated
  string for key `nav.language` ("Language" / "اللغة") + ": " + the current
  language's **native** name ("English" / "العربية") — e.g.
  `"Language: English"` when EN is active, `"اللغة: العربية"` when AR is
  active. This is the one place the *word* "Language" is itself translated,
  because it names the control, not a language.
- **Radiogroup accessible name** (panel skin): `aria-label` = same
  `common.language` key.
- **Option labels**: always the literal strings `English` and `العربية`
  (never translated versions of "English"/"Arabic" — a language names
  itself), each with its own `lang`/`dir` attribute as shown above, per 3.8.
- **Keyboard — header (menu) skin**: `Tab` reaches the trigger; `Enter`/
  `Space` opens the menu, focus moves to the checked item (or the first item
  if none — never happens here since one is always checked); `↑`/`↓` move
  between the two items (roving, wraps); `Enter`/`Space` on an item selects
  it and closes the menu, focus returns to the trigger (same
  `closeMenuAndRefocus` path Escape already uses); `Escape` closes without
  changing selection and returns focus to the trigger; outside-click closes
  without changing selection.
- **Keyboard — panel (segmented) skin**: `Tab` reaches the group once (the
  checked radio is the tab stop, per the standard `radiogroup` pattern);
  `←`/`→` (and `↑`/`↓`, since the two are visually adjacent) move the
  checked state between the two buttons and apply immediately (radio-group
  semantics — no separate "confirm" step, matching how `MemberThemeToggle`
  already applies on a single click); `Space`/`Enter` on a focused-but-not
  ­yet-checked button also applies it, for pointer-then-keyboard parity. In
  RTL, `←`/`→` swap meaning automatically because focus order follows `dir`
  (browser-native for a `dir="rtl"` ancestor); no bespoke key-remapping code
  is needed or wanted.
- Neither skin ever announces the raw key path (matches 2.2.5 of the
  requirements for translation fallback in general).

---

## 3. RTL layout rules

### 3.1 What mirrors vs. stays fixed

**Mirrors under `dir="rtl"`** (logical-property/`rtl:` conversion, per 4.1):
all text alignment, all padding/margin that currently reads `l`/`r`, all
absolute `left`/`right` positioning that is not a centring pair, border
radii on one side, `space-x-*`, non-centred `translate-x`, and
`bg-gradient-to-l/r`. This is a mechanical conversion the architect/developer
executes file-by-file against the committed search pattern (4.1); this spec
fixes the **policy**, not the line-by-line diff.

**Exempt / does not mirror** (carries `rtl-exempt: <reason>` per 4.1):

- Centring pairs: `left-1/2 -translate-x-1/2` (and the `top-1/2
  -translate-y-1/2` partner) — centring is directionless, e.g.
  `comparison-tug-meter.component.ts:175`,
  `pillars-spine.component.ts:112/142`,
  `video-showcase.component.ts:30/108`. Reason to record: `centring pair,
  directionless`.
- Decorative background/3D/GSAP geometry whose coordinates are computed in
  pixel/viewport space rather than expressing "start"/"end" content flow —
  `console-grid-background.component.ts`,
  `falling-cubes-background.component.ts`,
  `alwayson-loop-diagram.component.ts`'s data-driven inline positions. Reason
  to record: `decorative geometry, not content flow` (§3.2 gives the
  per-component call for every animated section explicitly).
- The Ptah logo and any other **non-directional** icon (per 4.2).

### 3.2 Icon mirroring list

Mirror (`scale-x-[-1]` via a `rtl:` variant, or swap to the icon's
already-mirrored Lucide counterpart where one exists) **only
direction-bearing icons**:

| Icon (lucide-angular) | Where used | Mirror? |
| --- | --- | --- |
| `ArrowRight` / `ArrowLeft` | "next/back", "learn more →" style affordances (20/26 usages across `libs/web/*`) | **Yes** — swap meaning: an `ArrowRight` in LTR becomes visually `ArrowLeft` in RTL and vice versa. Implement as `rtl:scale-x-[-1]` on the rendered `<lucide-angular>` rather than conditionally swapping the `[img]` binding — one line, no template branching, and it is a pure horizontal flip so the glyph stays crisp. |
| `ChevronRight` / `ChevronLeft` | disclosure/"next" affordances (16/4 usages) | **Yes**, same `rtl:scale-x-[-1]` technique — but **not** the nav's `ChevronDown` (points down, not left/right — never mirror a vertical chevron). |
| `Download` | primary CTA icon | No — an arrow-into-a-tray pictogram, not a direction-of-reading icon. |
| `ChevronDown`, `User`, `Users`, `LogOut`, `Menu`/`X`, `MessagesSquare`, `Globe`, `Check`, `Sun`/`Moon` | nav, switcher, theme toggle | No — none encode reading direction. |
| Ptah logo (`ptah-icon.png`) | header, structured data | Never — brand mark, fixed orientation in both directions (4.2 explicit). |
| Discord/GitHub/Reddit/LinkedIn brand SVGs | community menu | Never — third-party brand marks. |

### 3.3 LTR islands

Per 4.3, the following render **LTR and left-aligned inside the RTL page**,
regardless of the active language — wrap each in a utility class (e.g.
`.ltr-island { direction: ltr; unicode-bidi: isolate; text-align: left; }`,
added once to `styles.css` and applied at the element rendering the value,
not the enclosing block, so the surrounding Arabic sentence keeps flowing
RTL around it):

- Code blocks, inline `<code>`, CLI command snippets, anything already
  carrying `font-mono` (`~74` files per the inventory).
- Email addresses (e.g. member shell's "Signed in as …" `font-mono` email).
- URLs and file paths.
- License keys and version strings.

This is additive to the existing `font-mono` styling, not a replacement for
it — `font-mono` already visually marks these as "technical," `.ltr-island`
makes that also true for bidi layout.

### 3.4 User-generated content

Per 4.4, member posts/topics/display names get their direction from their
**own content**, not the UI language: apply `dir="auto"` at the element that
renders the user string (browser-native first-strong-character detection —
no library needed, no per-post language field to maintain). This is
independent of `[lang]`, which stays the UI's active language throughout.

### 3.5 Per-section decision — animated/3D/GSAP/horizontal-scroll (`libs/web/landing` + the 3 named siblings)

| Component | What it does | RTL decision | Why |
| --- | --- | --- | --- |
| `sections/builders/builders-section.component.ts` | Seamless `xPercent` marquee (skill-pack chips) + a scrubbed horizontal-ish rail | **Keep-LTR direction of travel; mirror surrounding layout.** The marquee's `gsap.set(track, {xPercent: from}) → xPercent: to` loop is a pure numeric animation with no semantic "next/back" — flipping its sign under `dir="rtl"` (`from`/`to` negated) is a one-line, low-risk change the developer applies at the `buildMarqueeLoop` call site directly (not a layout mirror), because a marquee that visually drifts the "wrong" way under RTL reads as a bug, not a design choice. The section's own padding/heading alignment mirrors normally. |
| `sections/pillars/pillars-spine.component.ts` | Vertical scrubbed spine, centred rail nodes | **Mirror.** Everything here is vertical (`top`/`height` scrub) or horizontally centred (`left-1/2 -translate-x-1/2`, exempt per 3.1) — there is no horizontal direction to get wrong, so ordinary logical-property conversion of the surrounding text/padding is sufficient; no special-cased animation logic needed. |
| `sections/comparison/comparison-tug-meter.component.ts` | Scrubbed `scaleX` fill bar, a two-sided "tug of war" (production vs. vibe-coded) | **Keep the left/right semantic sides fixed; mirror only text/padding.** The two sides of the meter carry a real semantic ("your production side" vs. "the other side") independent of reading direction — flipping which physical side each label sits on would break the metaphor readers already associate with left=start in the English version. Mark the bar's own `left-[38%]`/fill-origin rules `rtl-exempt: fixed semantic sides, not reading-direction layout`; convert the section's surrounding text/heading alignment normally. |
| `console/alwayson-loop-diagram.component.ts` | Data-driven inline positions (loop diagram) | **`rtl-exempt` (decorative geometry).** Positions are computed coordinates for a diagram illustration, not text flow; per 3.1, mark exempt and leave the coordinate math untouched. |
| `console/council-demo.component.ts`, `console/memory-recall-diagram.component.ts`, `console/orchestra-fanout-diagram.component.ts` | Illustrative product-UI diagrams (memory-recall's own doc calls out "a horizontal session track") | **Mirror the diagram frame and its text; keep internal chronological order (S1→S10, left-to-right in the diagram) fixed.** A session timeline's left-to-right chronology is a data convention (earliest first), not a reading-direction convention — reversing it under RTL would make the diagram harder to read against every other "earliest-first" timeline in the product, not easier. Mark the internal ordering logic `rtl-exempt: chronological order, not reading direction`; the diagram's outer card, labels and captions mirror normally. |
| `sections/also-available/also-available.component.ts`, `sections/cta/cta-section.component.ts`, `sections/hero/hero-content-overlay.component.ts`, `sections/hero/hero-device-showcase.component.ts`, `sections/hero/hero.component.ts`, `sections/problem/problem-section.component.ts`, `sections/provider-strip/provider-strip.component.ts`, `sections/video-showcase/video-showcase.component.ts` | Standard content sections; centred glow/blur decoration | **Mirror.** No horizontal-scroll or direction-encoded animation logic found in any of these (grep found none); ordinary logical-property conversion applies. Their `left-1/2 -translate-x-1/2`/`top-1/2 -translate-y-1/2` decorative blurs are exempt centring pairs per 3.1. |
| `libs/web/ui/src/lib/console/console-grid-background.component.ts` | Decorative CSS grid background | **`rtl-exempt` (decorative geometry).** Named explicitly in the requirement as an example exempt case. |
| `libs/web/legal/src/lib/components/falling-cubes-background.component.ts` | Decorative CSS animation | **`rtl-exempt` (decorative geometry).** Named explicitly in the requirement as an example exempt case. |
| `libs/web/auth/src/lib/components/auth-hero.component.ts` | Hero decoration with raw CSS `left:`/`right:` | **Mirror the raw CSS positions** (convert to logical `inset-inline-start/end` or add `[dir="rtl"]` overrides at `auth-hero.component.ts:173-184`, the lines the requirement names) — this is content-adjacent hero layout, not a detached background layer, so it should track reading direction like the rest of the page. |

All eight sections/diagrams above are additionally subject to 4.5's
screenshot gate (no horizontal overflow, no clipped/overlapped copy at 375 /
768 / 1440px under `dir="rtl"`) regardless of their mirror/keep-LTR call —
that is a QA/developer gate this spec does not re-decide, only flags as
applicable to every row in this table.

### 3.6 Arabic webfont

**Recommendation: IBM Plex Sans Arabic**, weights 400 / 500 / 600 / 700 (the
same four weights already loaded for Inter, so every existing `font-medium`/
`font-semibold`/`font-bold` utility keeps working unchanged when the active
language switches). Rationale:

- **Pairs with Inter**: both are neutral, grotesque-adjacent, low-contrast
  UI/text faces from a "systematic type family" design philosophy (IBM Plex
  Sans Arabic was drawn as the Arabic companion in the same Plex superfamily
  whose Latin cut IBM Plex Sans directly informed; Inter is itself a modern
  grotesque in the same register) — neither face reads as decorative or
  display-weight next to the other, which matters because English brand/
  product terms (6.1/6.2) stay in Latin script inline inside Arabic
  sentences and must not visually clash.
- **Rejected: Cairo** — more geometric/rounded, reads closer to a display or
  editorial face; next to Inter's grotesque forms in mixed EN/AR strings
  (e.g. "Ptah Builders" inline in an Arabic sentence) the pairing looks
  mismatched.
- **Rejected: Tajawal** — designed for larger display sizes; loses crispness
  at the small UI sizes this app uses heavily (badges, nav labels, table
  cells in admin), which is most of this app's Arabic text.
- **Rejected: Noto Sans Arabic** — safe, very complete Unicode coverage, but
  its default metrics run visually heavier/wider than IBM Plex Sans Arabic
  at matched weights, so English and Arabic runs in the same sentence would
  look unbalanced. Keep it documented as the **fallback** in the font stack
  (`'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif`) for any glyph
  IBM Plex Sans Arabic does not cover.
- Available on Google Fonts (same CDN already used for Inter/JetBrains
  Mono — no new font pipeline).

**Loading constraint (only when Arabic is active, per 4.6/risk row):** do
**not** add the Arabic family to the static `index.html` `<link>` (that
would load it for every English visitor). Instead, the app-level pre-paint
script (3.6/architect's mechanism) that sets `lang`/`dir` before first paint
is also the one place that, when the resolved language is `ar`, injects:

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

`display=swap` matches the existing Inter/JetBrains Mono links, so the FOUT
window (flagged as a risk in `context.md`) is a brief Arabic-fallback→
IBM-Plex swap, not a blank-text flash — acceptable and consistent with how
Inter itself already loads.

**Arabic typography adjustments** (apply under `[lang="ar"]` /
`:dir(rtl)` — CSS additions to `styles.css`, not new Tailwind config beyond
the `fontFamily.sans` list gaining the Arabic family):

- No `letter-spacing`/`tracking-*` on Arabic runs — Arabic script's
  connected letterforms break under tracking. Neutralize with
  `[lang="ar"] { letter-spacing: normal; }`, overriding the hero's own
  `text-8xl`/`text-9xl` negative tracking (`fontSize` extension above) when
  Arabic is active.
- Neutralize `uppercase`/`tracking-wide` combinations used for eyebrow/
  overline labels (e.g. the mobile nav's `Account`/`Community` section
  headers, `text-[11px] font-semibold uppercase tracking-wide`) — Arabic has
  no case, so `uppercase` is a no-op visually but `tracking-wide` still
  distorts it; scope the same `letter-spacing: normal` override plus
  `text-transform: none` to `[lang="ar"] .uppercase`.
- Line-height: raise body copy from Tailwind's default (`leading-normal`,
  1.5) to **1.7–1.8** (`leading-[1.75]`) under `[lang="ar"]` — Arabic's
  diacritics and taller ascenders/descenders need more vertical room at the
  same font-size than Latin text does; 1.5 reads visibly cramped.
- `font-mono` (JetBrains Mono) never changes — code/CLI text stays Latin/
  mono in both languages per 3.3/do-not-translate (6.1).

### 3.7 Numbering system `[DECISION — designer recommendation, user confirms at Gate 1.7]`

**Recommendation: Western `0-9`**, not Arabic-Indic (`٠-٩`), consistent with
the open question's own framing ("recommended for a developer tool").
Reasoning specific to this product: prices (`$29/mo`), version strings,
license keys, CLI flags, and code samples all stay Latin-script/Western-
numeral per 5.3/6.1 regardless of which numbering system prose uses — so
choosing Arabic-Indic would create a page where the *same* digit shape
means two different things a few pixels apart (Western in a price, Eastern
in a sentence), which is a harder reading experience than one numbering
system throughout. Western numerals are also what the product's own
technical audience (developers, including Gulf/Levant markets where Ptah's
Arabic-reading users are most likely to be technical) already reads
fluently in every IDE, terminal and package registry. This is the
recommendation; the user's sign-off is still required per the task's Open
Questions before the architect encodes it as the default `Intl.NumberFormat`
numbering system (`numberingSystem: 'latn'`) in the shared i18n library.

### 3.8 Legal pages — governing-language notice `[DECISION — designer proposal, user confirms at Gate 1.7]`

Proposed **for the "English version governs" option** (the alternative —
publishing Arabic as equally binding — is the user's to choose instead; this
spec does not decide between them, only drafts the copy/placement for the
option the requirement names first):

**Placement**: a non-dismissible notice block immediately below the page
`<h1>` and above the first body paragraph, on all three legal routes
(`terms-and-conditions`, `privacy`, `refund`), visible **only** when the
active language is Arabic (an English visitor never sees it, since the
English text is the governing text and needs no disclaimer about itself).
Styling reuses the existing alert/notice vocabulary already in the theme
system rather than inventing one:

```html
<div class="mb-6 rounded-lg border border-hairline bg-base-200 px-4 py-3 text-sm text-base-content-muted" role="note">
  {{ 'legal.governingLanguageNotice' | transloco }}
</div>
```

**Draft copy** (agent-drafted, flagged for the user's copy review per 8.x
like every other Arabic string — this is a draft, not final):

- **EN** (shown nowhere in the UI, kept only as the translator's source
  string / for the review table): *"This page is also available in Arabic
  for convenience. In the event of any conflict or ambiguity between the two
  versions, the English version governs."*
- **AR** (draft): *"هذه الصفحة متوفرة أيضًا باللغة العربية للتسهيل على
  القارئ. في حال وجود أي تعارض أو غموض بين النسختين، تُعتمد النسخة
  الإنجليزية."*

**Alternative (not proposed here, named for completeness):** publish the
Arabic legal text as equally binding, with no notice at all. That path needs
no notice component — if the user picks it, `legal.governingLanguageNotice`
and this block are simply not wired into the three legal pages. Recorded in
Open Questions below as still awaiting the user's answer.

---

## 4. Open questions carried to the user (unchanged from `context.md`, designer position added)

1. **Numbering system** — designer recommends Western `0-9` (§3.7). User
   confirms or overrides at Gate 1.7.
2. **Legal governing-language notice vs. equally-binding Arabic text** —
   designer has drafted the notice's copy/placement for the "governs" option
   (§3.8) but does not choose between the two paths; the user decides.
3. **Admin copy review depth** (spot-check vs. full read) — not a design
   question; carried forward for the team-leader/user, unchanged.

---

## 5. Traceability summary

| Decision | Token/pattern source |
| --- | --- |
| Header switcher panel styling | `#community-menu` in `navigation.component.ts:203-314` (identical classes) |
| Header switcher focus ring | Every existing nav link/button (`focus-visible:outline-amber-400`, repeated 15+ times in the file) |
| Panel switcher styling | `member-theme-toggle.ts` (`btn btn-sm`, `border-hairline`, `bg-base-200`, `surface-high`, `base-content-muted`) |
| Panel switcher shared placement | `panel-layout.html`'s single `<header>`, confirmed rendered by both `member-layout.html:21` and `admin-layout.html:19` via the same `panelTopBar` slot |
| `btn-primary` contrast for "current" state | `operator-admin`/`operator-member`/`operator-member-light` theme definitions, `primary` + `primary-content`, `apps/ptah-landing-page/tailwind.config.js` |
| Arabic font weights (400/500/600/700) | Matches the Inter weight set already loaded in `index.html` |
| `.ltr-island` mechanism | New, additive utility in `apps/ptah-landing-page/src/styles.css`, layered on top of existing `font-mono` usage |
| Icon mirroring candidates | `ArrowRight`/`ArrowLeft`/`ChevronRight`/`ChevronLeft` usage counts (66 combined) found across `libs/web/*` |
| Per-section RTL calls | `grep` of `ScrollTrigger`/`xPercent`/`scrub` across the 15 `libs/web/landing` components + the 3 named sibling components |
