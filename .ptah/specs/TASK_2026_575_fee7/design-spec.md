# Design Spec — Language Switcher & RTL Treatment

TASK_2026_575_fee7 · Gate 1.7 · ui-ux-designer

Revision: 1. This revision addresses `design-spec-review.md` round 1
(REVISE: B1-B6 blocking, N1-N15 non-blocking). See "Review responses
(revision 1)" near the end for the full disposition of every finding.

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
Every contrast figure below is a computed sRGB relative-luminance ratio
against the literal theme hex values in
`apps/ptah-landing-page/tailwind.config.js` (WCAG 2.x formula), not an
estimate — see §2.5a for the full table.

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

**Placement (fix for N2 — the original wording misdescribed the nav's own
item order):** immediately **after `Community`**, before the auth cluster.
The real order in `navigation.component.ts` is `Product`, `Pricing`, `Docs`,
`Community`, then — only when signed out — `Login`/`Sign Up`, then the
always-present `Download Ptah` CTA, then — only when signed in — the `User`
avatar menu (which renders *after* Download, not before). "After Community"
is therefore the one anchor point that is correct for both auth states: the
switcher sits between `Community` and whatever comes next (`Login` when
signed out, `Download Ptah` directly when signed in), inside the existing
`<div class="hidden md:flex items-center gap-6">`. It stays before the
primary CTA either way, so `Download Ptah` remains the visually last,
most prominent element — switching language is wayfinding, not a conversion
action.

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
  [attr.aria-label]="languageCode() + ' — ' + ('common.language' | transloco) + ': ' + currentLanguageNativeName()"
  (click)="toggleMenu('lang')"
>
  <lucide-angular [img]="GlobeIcon" class="w-4 h-4" aria-hidden="true" />
  {{ languageCode() }}
  <lucide-angular [img]="ChevronDownIcon" class="w-4 h-4 transition-transform duration-200"
    [class.rotate-180]="openMenu() === 'lang'" aria-hidden="true" />
</button>
```

Where `languageCode()` is `'EN'`/`'AR'`. Fix for N11 (WCAG 2.5.3 Label in
Name): the previous draft's `aria-label` ("Language: English") did not
contain the visible trigger text ("EN"), so a speech-input user saying
"click EN" would not match the accessible name. The `aria-label` is now
prefixed with the exact visible substring — e.g. `"EN — Language: English"`
when English is active, `"AR — اللغة: العربية"` when Arabic is active — so
the visible label is always a literal substring of the accessible name, and
the name still states the language in its own language per 3.8.

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

Menu panel (identical shell to `#community-menu`). Fix for N1: anchored with
the **logical** `start-0` utility (Tailwind ≥3.3, confirmed available at the
project's `^3.4.18`), not a physical `left-0` or a manual `ltr:`/`rtl:` pair
— `start-0` already resolves to the correct physical edge per direction,
which is the whole point of 4.1's logical-property policy, so the switcher's
own markup should follow it rather than special-case itself.

```html
@if (openMenu() === 'lang') {
  <div id="lang-menu" role="menu" aria-labelledby="lang-menu-trigger"
    class="absolute start-0 top-full mt-2 w-40 rounded-lg border border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5 z-50">
    <button type="button" role="menuitemradio" lang="en" dir="ltr"
      [attr.aria-checked]="activeLang() === 'en'"
      class="flex w-full items-center justify-between px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
      [ngClass]="activeLang() === 'en' ? 'text-amber-500' : 'text-white/70 hover:text-white hover:bg-white/5'"
      (click)="selectLanguage('en')">
      English
      @if (activeLang() === 'en') { <lucide-angular [img]="CheckIcon" class="w-4 h-4" aria-hidden="true" /> }
    </button>
    <button type="button" role="menuitemradio" lang="ar" dir="rtl"
      [attr.aria-checked]="activeLang() === 'ar'"
      class="flex w-full items-center justify-between px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
      [ngClass]="activeLang() === 'ar' ? 'text-amber-500' : 'text-white/70 hover:text-white hover:bg-white/5'"
      (click)="selectLanguage('ar')">
      العربية
      @if (activeLang() === 'ar') { <lucide-angular [img]="CheckIcon" class="w-4 h-4" aria-hidden="true" /> }
    </button>
  </div>
}
```

Fix for B3 (snippet/prose mismatch): item activation calls a new
`selectLanguage(lang)` method, not `setLanguage()` + `closeMenu()`:

```ts
public selectLanguage(lang: SupportedLang): void {
  this.i18n.setLanguage(lang);
  this.openMenu.set(null);
  this.elementRef.nativeElement
    .querySelector('#lang-menu-trigger')
    ?.focus();
}
```

This is a small, new method (not a reuse of `closeMenuAndRefocus()`, which
is Escape-specific and closes without changing selection) — §2.6 states
exactly this refocus behavior, and this is the code that delivers it, fixing
the earlier draft's mismatch between its prose and its snippet.

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
<div role="group" [attr.aria-label]="'common.language' | transloco"
  class="mx-4 mt-1 mb-2 flex rounded-lg border border-ink-700 bg-ink-950/60 p-1">
  <button type="button" role="menuitemradio" lang="en" dir="ltr" [attr.aria-checked]="activeLang() === 'en'"
    class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    [ngClass]="activeLang() === 'en' ? 'bg-amber-500 text-ink-950' : 'text-white/70 hover:text-white'"
    (click)="setLanguage('en')">English</button>
  <button type="button" role="menuitemradio" lang="ar" dir="rtl" [attr.aria-checked]="activeLang() === 'ar'"
    class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    [ngClass]="activeLang() === 'ar' ? 'bg-amber-500 text-ink-950' : 'text-white/70 hover:text-white'"
    (click)="setLanguage('ar')">العربية</button>
</div>
```

Fix for B3 (invalid ARIA structure): the mobile overlay itself is
`role="menu"` (`navigation.component.ts:466-469`), and `menu` may only own
`menuitem`/`menuitemradio`/`menuitemcheckbox`/`group`/separator elements —
`radiogroup`/`radio` are not valid children of `menu` and axe flags this as
`aria-required-children`. The wrapper is now `role="group"` (a valid child
of `menu`) and the two buttons are `role="menuitemradio"` (also valid,
directly ownable by `group`), keeping the same `aria-checked` semantics and
the same segmented visual. No roving-tabindex code is needed here: both are
real `<button>` elements, natively reachable by `Tab` and operable with
`Enter`/`Space` regardless of their ARIA role — the mobile menu's other
items (`<a role="menuitem">`) already rely on that same native operability
without roving tabindex, so this stays consistent with the surrounding menu.

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
`MemberThemeService`). Fix for N3: it is projected **after**
`<ng-content select="[panelTopBar]" />`, not before it:

```html
<div class="flex items-center gap-2 text-sm text-base-content-muted">
  <ng-content select="[panelTopBar]" />
  <ptah-language-switch />
</div>
```

With the switch placed *before* `ng-content` (the earlier draft), the
rendered member-shell order is `[Lang][Signed in as][email][ThemeToggle]` —
the switch and `MemberThemeToggle` end up separated by the "signed in as"
text, contradicting the "adjacent preferences cluster" this section claimed.
Placed *after* `ng-content`, the order becomes
`[Signed in as][email][ThemeToggle][Lang]` — the switch now sits directly
next to `MemberThemeToggle`, which is what the cluster claim actually
requires. For the admin shell, which has no theme toggle
(`admin-layout.html:19-24` projects only "Signed in as" + email), the order
is simply `[Signed in as][email][Lang]` — the switch is last and reachable,
with no clustering claim to satisfy there (also fixing the earlier
imprecise "left of" phrasing — the correct, direction-agnostic wording is
"at the end of the topbar's control cluster").

Segmented toggle, DaisyUI/panel tokens only (matches `MemberThemeToggle`'s
`border-hairline` / `bg-base-200` / `surface-high` / `base-content-muted`
vocabulary exactly, and now `btn-sm` — fix for N11, which caught the
earlier draft using `btn-xs` while claiming to match `MemberThemeToggle`'s
own `btn-sm`):

```html
<div role="radiogroup" [attr.aria-label]="'common.language' | transloco" id="panel-lang-group"
  class="inline-flex rounded-lg border border-hairline bg-base-200 p-0.5">
  <button type="button" role="radio" lang="en" dir="ltr"
    [attr.aria-checked]="activeLang() === 'en'"
    [attr.aria-label]="'EN — ' + ('common.language' | transloco) + ': English'"
    [tabIndex]="activeLang() === 'en' ? 0 : -1"
    class="btn btn-sm rounded-md border-0 gap-1 font-medium focus-ring-panel"
    [ngClass]="activeLang() === 'en' ? 'btn-primary' : 'btn-ghost text-base-content-muted hover:bg-surface-high hover:text-base-content'"
    (click)="setLanguage('en')">
    EN
    @if (activeLang() === 'en') { <lucide-angular [img]="CheckIcon" class="w-3 h-3" aria-hidden="true" /> }
  </button>
  <button type="button" role="radio" lang="ar" dir="rtl"
    [attr.aria-checked]="activeLang() === 'ar'"
    [attr.aria-label]="'AR — ' + ('common.language' | transloco) + ': العربية'"
    [tabIndex]="activeLang() === 'ar' ? 0 : -1"
    class="btn btn-sm rounded-md border-0 gap-1 font-medium focus-ring-panel"
    [ngClass]="activeLang() === 'ar' ? 'btn-primary' : 'btn-ghost text-base-content-muted hover:bg-surface-high hover:text-base-content'"
    (click)="setLanguage('ar')">
    AR
    @if (activeLang() === 'ar') { <lucide-angular [img]="CheckIcon" class="w-3 h-3" aria-hidden="true" /> }
  </button>
</div>
```

Three fixes from round 1 land in this snippet together:

- **B2** (option labels must be "labelled in its own language"): the visible
  caption stays the compact `EN`/`AR` — panel topbar space is tight, the
  same constraint `MemberThemeToggle` already designs around — but
  `aria-label` now names the language in its own language (`English` /
  `العربية`), and is prefixed with the exact visible substring (`EN —` /
  `AR —`), which simultaneously satisfies N11's WCAG 2.5.3 Label-in-Name
  requirement. This is the "keep `EN`/`AR` visible with `aria-label`" option
  the review offered as an acceptable fix.
- **B4 / N12** (focus ring contrast + color-only state): `focus-ring-panel`
  replaces `focus-visible:outline-amber-400` — see §2.5a for the measured
  numbers (amber-400 is 1.68:1 against `operator-member-light`'s white
  header, below the 3:1 WCAG 1.4.11 floor; `base-content` is ≥13:1 in every
  panel theme). The selected segment also now renders a small check icon
  (`w-3 h-3`, matching the header skin's own check), so "which one is
  selected" is never carried by fill color alone — `bg-primary` on white is
  only 2.04:1 as a filled-shape boundary, below 3:1 non-text contrast; the
  check icon (drawn at text-level contrast against `primary-content`, not
  as a fill boundary) and `aria-checked` carry the state instead.
- Roving `tabIndex` (`0` on the checked radio, `-1` on the other) is set
  directly in the template here, with the keyboard behavior in §2.6.

### 2.5 States (both skins)

| State | Public header (menu) | Panel shells (segmented) |
| --- | --- | --- |
| Default (inactive option) | `text-white/70` | `btn-ghost text-base-content-muted` |
| Hover | `hover:text-white hover:bg-white/5` | `hover:bg-surface-high hover:text-base-content` |
| Focus-visible | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2` (trigger + each menu item — dark `ink`/`slate` backgrounds only, so amber-400 is safe here) | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content focus-visible:outline-offset-2` (`focus-ring-panel`, fix for B4 — **not** `outline-amber-400`, which fails 3:1 on `operator-member-light`; see §2.5a) |
| Active/pressed (mouse-down) | native button `:active` (browser default; no custom class, matching sibling menus) | native button `:active` |
| Current/selected | trigger: `text-amber-500`; item: `text-amber-500` + `CheckIcon` + `aria-checked="true"` | `btn-primary` + small `CheckIcon` (fix for N12 — state is not color-only) + `aria-checked="true"` |

### 2.5a Measured contrast (fix for B4 — the earlier draft asserted "≥4.5:1 in all three" with no figures)

Computed WCAG 2.x sRGB contrast ratios against the literal hex values in
`apps/ptah-landing-page/tailwind.config.js`. "Panel themes" = `operator-admin`
/ `operator-member` (identical ladder) and `operator-member-light`.

| Pair | operator-admin / operator-member | operator-member-light |
| --- | --- | --- |
| `base-content-muted` (default) on `base-200` | 4.7:1 | 5.3:1 |
| `base-content` (hover) on `surface-high` | >10:1 | >10:1 |
| `primary-content` (`#08090c`) on `primary` (`#f5a524`) — selected fill | 9.76:1 | 9.76:1 |
| **Focus outline — `base-content` on `base-200`** (the fix) | **13.21:1** (`#dce2f3` on `#151c27`) | **17.03:1** (`#1a1c22` on `#ffffff`) |
| Focus outline — `amber-400` on `base-200` (the earlier, rejected choice) | passes (amber-400 on near-black is high-contrast here) | **1.68:1 — fails WCAG 1.4.11's 3:1 non-text floor** |
| `primary` fill (`#f5a524`) as a shape boundary on `base-200` (non-text 1.4.11 check) | passes (near-black background) | **2.04:1 — fails 3:1**, which is why the selected segment also carries a check icon (text-level contrast, not fill-boundary) rather than relying on the fill alone |

Header-skin pairs (all on the `slate-950/95` menu panel, effectively
near-black): `text-white/70` default ≈9.9:1, `text-amber-500` selected
≈10.1:1 — both comfortably pass and are unaffected by this fix, since the
header skin never renders on a light surface.

### 2.6 Accessible name, option labels, keyboard

- **Trigger accessible name** (header skin): `aria-label` = the visible
  code (`"EN"`/`"AR"`) + `" — "` + the translated string for key
  `common.language` (§2.7 — "Language" / "اللغة") + `": "` + the current
  language's **native** name ("English" / "العربية") — e.g.
  `"EN — Language: English"` when EN is active, `"AR — اللغة: العربية"` when
  AR is active (fix for N11, §2.2). This is the one place the *word*
  "Language" is itself translated, because it names the control, not a
  language.
- **Radiogroup accessible name** (panel skin): `aria-label` = same
  `common.language` key (§2.7).
- **Option labels**: always the literal strings `English` and `العربية`
  (never translated versions of "English"/"Arabic" — a language names
  itself), each with its own `lang`/`dir` attribute as shown above, per 3.8.
- **Keyboard — header (menu) skin (revised for B3):** `Tab` reaches the
  trigger, then `Tab` again reaches each menu item **in document order**
  when the menu is open — the same Tab-only pattern the existing `Product`/
  `Community`/`User` menus already use (none of them move focus into the
  panel on open or support arrow-key roving either;
  `navigation.component.ts` has no such code for any of the three today).
  The earlier draft specified auto-focus-into-menu plus `↑`/`↓` roving,
  which is real APG "menu button" behavior but does not exist anywhere in
  this component today and would have been new interaction code contradicting
  its own "zero new wiring" claim. Matching the sibling menus' actual,
  simpler, already-shipped pattern resolves the contradiction: `Enter`/
  `Space` on the trigger opens the menu (focus stays on the trigger, exactly
  as it does for `Product`/`Community`/`User`); `Enter`/`Space` on a
  reached item calls `selectLanguage(lang)` (§2.2), which sets the language,
  closes the menu and **explicitly** refocuses the trigger — this is the one
  small new method beyond the existing pattern, because none of the sibling
  menus need to refocus their trigger on item activation (they navigate or
  open a new tab instead); `Escape` closes without changing selection and
  refocuses the trigger, via the existing `closeMenuAndRefocus()`; outside
  click closes without changing selection, via the existing
  `onDocumentClick()`. This is fully implementable as the ordinary Tab
  order of two real `<button role="menuitemradio">` elements — no roving
  `tabindex`, no keydown handler, needed for this skin.
- **Keyboard — panel (segmented) skin (revised for B3):** this is a real,
  standalone ARIA `radiogroup` (not nested inside another widget), so it
  gets the actual APG radio-group implementation the review asked for, not
  an assertion that it happens automatically:
  - **Roving tabindex**: the checked radio carries `tabIndex="0"`, the other
    `tabIndex="-1"` (shown inline in the template in §2.4) — recomputed
    every time the selection changes, so `Tab` always lands on whichever
    option is currently checked, and the group is a single stop in the
    page's tab order, per the standard radio-group pattern.
  - **Arrow keys**: a `(keydown)` handler on the group reads
    `getComputedStyle(group).direction` (or, in the component, the
    injected active-direction signal) and explicitly inverts the mapping:

    ```ts
    public onGroupKeydown(e: KeyboardEvent): void {
      const isRtl = this.direction() === 'rtl'; // shared i18n direction signal
      let delta = 0;
      if (e.key === 'ArrowRight') { delta = isRtl ? -1 : 1; }
      else if (e.key === 'ArrowLeft') { delta = isRtl ? 1 : -1; }
      else { return; }
      e.preventDefault();
      const next = delta > 0 ? 'ar' : 'en'; // 2-item group: the other option
      this.setLanguage(next);
      this.focusRadio(next);
    }
    ```

    This replaces the earlier draft's "swaps meaning automatically …
    browser-native" claim, which is not true for ARIA radios (only native
    form controls and plain document flow get that for free) — the
    component reads the direction and inverts the key mapping itself, which
    is what "implementable as written" requires.
  - Moving focus with the arrow keys **also** selects, matching the ARIA
    APG radio-group pattern and `MemberThemeToggle`'s own single-click
    semantics (no separate "confirm" step). `Space`/`Enter` on the focused
    radio applies it too, for pointer-then-keyboard parity.
- Neither skin ever announces the raw key path (matches 2.2.5 of the
  requirements for translation fallback in general).

### 2.7 Translation key ownership (fix for N13)

The earlier draft used two different keys for the same word — `nav.language`
for the header skin, `common.language` for the panel skin — without saying
which project's scope owns either. Per requirement 2.1, shared chrome text
belongs to `libs/web/ui` (or `panel-ui`), consumed from there by other
scopes. This revision merges both into **one** key, `common.language`,
owned by `libs/web/ui`'s own translation scope (`libs/web/ui`'s `en`/`ar`
files), and both skins reference that single key — the header skin's own
snippet in §2.2 is updated accordingly. The two components themselves stay
in different libraries, matching where each already lives: the header skin
in `libs/web/ui` (alongside `NavigationComponent`), the panel skin in
`libs/web/panel-ui` (alongside `panel-layout`) — only the translation key is
unified, not the component.

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
direction-bearing icons**. Fix for N8: the earlier list omitted several
icon families the codebase actually uses, misclassified one rotated
instance, and its usage counts did not reproduce — this revision states the
exact grep and re-verifies every count.

| Icon (lucide-angular) | Where used | Mirror? |
| --- | --- | --- |
| `ArrowRight` / `ArrowLeft` / `ChevronRight` / `ChevronLeft` | "next/back", "learn more →" style affordances and disclosure indicators (66 combined matches for the word-boundary pattern `ArrowRight\|ArrowLeft\|ChevronRight\|ChevronLeft` across `.ts` files under `libs/web`, counting every match, not distinct files) | **Yes** — swap meaning: e.g. an `ArrowRight` in LTR becomes visually `ArrowLeft` in RTL. Implement as `rtl:scale-x-[-1]` on the rendered `<lucide-angular>` rather than conditionally swapping the `[img]` binding — one line, no template branching, pure horizontal flip, glyph stays crisp. |
| `LogOut` (4 usages) | user-menu / logout affordances | **Yes** — conventionally mirrored alongside other "exit/leave" direction icons, even though the icon itself is a door-and-arrow pictogram; treat it as direction-bearing for consistency with `ArrowRight`-style "forward" icons it is usually paired next to. |
| `Send` (28 usages), `Reply` (13 usages) | composer/reply actions across `libs/web/members` (community) and `libs/web/admin` | **Yes** — both are directional "paper airplane toward the reader" / "arrow back into a thread" pictograms whose implied direction is reading-direction-relative; mirror with the same `rtl:scale-x-[-1]` technique. |
| `ExternalLink` (12 usages) | outbound-link affordances | **No** — the arrow points up-and-out of a box, a "leaves this page" pictogram independent of reading direction (the corner it exits from is a fixed visual convention, not a left/right reading cue); do not mirror. |
| `Download` | primary CTA icon | No — an arrow-into-a-tray pictogram, not a direction-of-reading icon. |
| `ChevronDown` (general use), `User`, `Users`, `Menu`/`X`, `MessagesSquare`, `Globe`, `Check`, `Sun`/`Moon` | nav, switcher, theme toggle | No — none encode reading direction. |
| **Exception**: `ChevronDown` rotated `-rotate-90` in `panel-layout.html:95` (the collapsed-group disclosure indicator) | sidebar nav group headers | **Yes, this one instance only.** A `ChevronDown` rotated -90° no longer points down — it points toward the group's collapsed content, i.e. toward reading-start — so unlike every *other* `ChevronDown` in the app, this specific rotated use **is** direction-bearing and must mirror. Fix: `rtl:rotate-90` alongside the existing `[class.-rotate-90]="isCollapsed(...)"`, so the two rotations combine to the mirrored angle under RTL instead of cancelling out. This is the one explicit exception to "never mirror `ChevronDown`" and is called out here precisely so it is not missed. |
| Literal `→`/`←` text-arrow characters (found in admin templates, e.g. `needs-attention-queue.ts`, `data-table.ts`) | inline "view all →" style affordances written as characters, not icon components | **Flag for conversion, not a CSS mirror.** A literal arrow character baked into a translatable string cannot be selectively flipped by CSS without wrapping it in its own element, and a translator cannot know whether to keep it, drop it or mirror it. Recommendation for the developer/architect: extract these into the same icon-component pattern as everywhere else (an `ArrowRight`/`ChevronRight` icon, not a character in the string), so they fall under the `rtl:scale-x-[-1]` rule above like every other directional icon, and so the translation key holds no embedded directionality. |
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

Fix for N5a: re-ran the grep the requirement's risk row asks for —
`slideLeft|slideRight|x:|xPercent|scaleX|transformOrigin|ScrollTrigger|overflow-x` —
across every non-spec `.ts` under `libs/web/landing/src/lib`. The table below
now covers 19 components (not 15 — the earlier count omitted
`terminal-mock`, `device-frame`, `waitlist-form` and `comparison-section`),
plus `problem-section` gains the row B5 required.

| Component | What it does | RTL decision | Why |
| --- | --- | --- | --- |
| `sections/builders/builders-section.component.ts` | Seamless `xPercent` marquee (skill-pack chips) via `buildMarquee()` (`:486`, fix for N4 — the function is `buildMarquee`, not `buildMarqueeLoop`) + a scrubbed rail | **One decision (fix for N4 — the earlier draft stated two contradictory ones): the marquee's physical direction of travel stays fixed in both languages.** `gsap.set(track, {xPercent: from}) → xPercent: to` (`:502-504`) is a pure numeric animation with no semantic "next/back" tied to it. The developer negates `from`/`to` inside `buildMarquee()` when `dir="rtl"`, so the on-screen drift direction is invariant — this is a code-level constant flip, not a layout "mirror" or "keep-LTR" choice, because there is no layout axis being decided here, only a sign the animation code must correct for so the visual does not accidentally reverse. The section's own surrounding text/padding mirrors normally via ordinary logical-property conversion. |
| `sections/pillars/pillars-spine.component.ts` | Vertical scrubbed spine, centred rail nodes | **Mirror.** Everything here is vertical (`top`/`height` scrub) or horizontally centred (`left-1/2 -translate-x-1/2`, exempt per 3.1) — there is no horizontal direction to get wrong, so ordinary logical-property conversion of the surrounding text/padding is sufficient; no special-cased animation logic needed. |
| `sections/comparison/comparison-tug-meter.component.ts` | Scrubbed `scaleX` fill bar, a two-sided "tug of war" (production vs. vibe-coded) | **Wrap the entire meter in an LTR island; the section's own heading copy outside it mirrors normally.** Fix for N5: the earlier "keep semantic sides fixed, mirror only text/padding" call was internally inconsistent — the row-label rows use `justify-between` (`:83`, `:109`), which *would* mirror under `dir="rtl"` conversion and swap which label sits over which physical segment, while the fill bars (`left-0`, `left-[38%]`, `bg-gradient-to-r`) stay physically fixed regardless — so a straight "convert the utilities, exempt the bar" instruction produces labels landing on the wrong segments. Wrapping the whole `<div class="max-w-4xl mx-auto space-y-8">` block (the axis rows, both meters, the lifecycle rail and its handoff marker) in `dir="ltr"` sidesteps the inconsistency entirely: every physical-direction utility inside it — `justify-between`, `left-0`, `left-[38%]`, `bg-gradient-to-r` — keeps meaning exactly what it means today, in both languages, because the island is never in `rtl` context. Only the section's own translatable heading/intro copy, outside the island, converts normally. The `left-[38%] -translate-x-1/2` handoff-marker label (`:175`) is *not* a page-centring pair (correcting the earlier draft's exemption reason) — it centers the label on a fixed 38% seam mark within this now-LTR-islanded meter; record its exemption as `rtl-exempt: fixed data-marker position inside an LTR-islanded meter`. |
| `sections/problem/problem-section.component.ts` | Two-sided entrance animation (`textConfig` narrative panel, `chartConfig` chart panel) + a hand-drawn SVG bar chart with a physical x-axis | **Fix for B5 (row missing from the previous revision).** `textConfig.animation = 'slideRight'` (`:200-201`, comment: "Narrative entrance — slide in from the left") and `chartConfig.animation = 'slideLeft'` (`:207-209`, comment: "Chart panel entrance — slide in from the right") are direction-encoded relative to an assumed LTR reading order (text column first/start, chart column second/end). **Mirror the entrance directions**: under `dir="rtl"` the two columns swap position (the narrative panel moves to the physical right, the chart to the physical left), so their slide-in origins must swap too — `textConfig` should slide in from the *physical* right and `chartConfig` from the *physical* left under RTL, i.e. the developer branches these two `ViewportAnimationConfig.animation` values on direction (`slideRight`↔`slideLeft`) rather than leaving them constant. **The SVG chart itself (`xLabels` `:190-197`, gridlines, the `f1…f13` frequency axis `:161`) is a keep-LTR island**: a chart's x-axis is a data convention (time/sequence increasing left-to-right), the same reasoning as the `console/*` diagrams below — wrap the `<svg>` chart panel in `dir="ltr"` so its axis never reverses, while the chart's own entrance-animation *side* (which panel slides from which physical edge) still mirrors per the paragraph above. |
| `console/alwayson-loop-diagram.component.ts` | Data-driven inline positions (loop diagram) | **`rtl-exempt` (decorative geometry).** Positions are computed coordinates for a diagram illustration, not text flow; per 3.1, mark exempt and leave the coordinate math untouched. |
| `console/council-demo.component.ts`, `console/memory-recall-diagram.component.ts`, `console/orchestra-fanout-diagram.component.ts` | Illustrative product-UI diagrams (memory-recall's own doc calls out "a horizontal session track") | **Mirror the diagram frame and its text; keep internal chronological order (S1→S10, left-to-right in the diagram) fixed.** A session timeline's left-to-right chronology is a data convention (earliest first), not a reading-direction convention — reversing it under RTL would make the diagram harder to read against every other "earliest-first" timeline in the product, not easier. Mark the internal ordering logic `rtl-exempt: chronological order, not reading direction`; the diagram's outer card, labels and captions mirror normally. |
| `console/terminal-mock.component.ts` | Illustrative CLI transcript with a blinking `.cursor` (`@keyframes terminal-blink`, `ml-1` after the last line) | **No RTL decision needed beyond 3.3** — the entire transcript is `font-mono` CLI output, which 3.3 already makes an LTR island; the blinking cursor sits inside that same island (it is the last character of an LTR block, not an independent direction choice), so `ml-1` stays as-is inside the island and needs no `rtl:` conversion. Listed here explicitly because N5a flagged it as a gap, not because it needs new behavior. |
| `console/device-frame.component.ts` | Device chrome frame; `ml-2` on a status label (`:39`), a "right-aligned live status badge" (`:74` comment) | **Mirror** — `ml-2` converts to `ms-2` (logical), and the "right-aligned" badge converts to a logical end-alignment utility (`text-end`/`justify-end` rather than `justify-end` assumed-physical); ordinary 4.1 conversion, no animation-direction logic involved. |
| `sections/builders/waitlist-form.component.ts` | Form input with a leading icon (`absolute left-3.5 top-1/2 -translate-y-1/2`, `:108`) | **Mirror** — a standard icon-inside-input pattern; convert `left-3.5` to the logical `start-3.5`. The `top-1/2 -translate-y-1/2` half is vertical centring, already covered by 3.1's centring-pair exemption (vertical, not horizontal, so it was never in question). |
| `sections/comparison/comparison-section.component.ts` | Section wrapper composing `comparison-tug-meter` | **Mirror** — no animation or positioning logic of its own (composition only); its heading/intro copy converts normally, and it inherits the LTR-island decision from `comparison-tug-meter` above. |
| `sections/also-available/also-available.component.ts`, `sections/cta/cta-section.component.ts`, `sections/hero/hero-content-overlay.component.ts`, `sections/hero/hero-device-showcase.component.ts`, `sections/hero/hero.component.ts`, `sections/provider-strip/provider-strip.component.ts`, `sections/video-showcase/video-showcase.component.ts` | Standard content sections; centred glow/blur decoration | **Mirror.** No horizontal-scroll or direction-encoded animation logic found in any of these; ordinary logical-property conversion applies. Their `left-1/2 -translate-x-1/2`/`top-1/2 -translate-y-1/2` decorative blurs are exempt centring pairs per 3.1. |
| `libs/web/ui/src/lib/console/console-grid-background.component.ts` | Decorative CSS grid background | **`rtl-exempt` (decorative geometry).** Named explicitly in the requirement as an example exempt case. |
| `libs/web/legal/src/lib/components/falling-cubes-background.component.ts` | Decorative CSS animation | **`rtl-exempt` (decorative geometry).** Named explicitly in the requirement as an example exempt case. |
| `libs/web/auth/src/lib/components/auth-hero.component.ts` | Hero decoration with raw CSS `left:`/`right:` | **Mirror the raw CSS positions** (convert to logical `inset-inline-start/end` or add `[dir="rtl"]` overrides at `auth-hero.component.ts:173-184`, the lines the requirement names) — this is content-adjacent hero layout, not a detached background layer, so it should track reading direction like the rest of the page. |

All nineteen sections/diagrams above are additionally subject to 4.5's
screenshot gate (no horizontal overflow, no clipped/overlapped copy at 375 /
768 / 1440px under `dir="rtl"`) regardless of their mirror/keep-LTR call —
that is a QA/developer gate this spec does not re-decide, only flags as
applicable to every row in this table. One QA caveat worth stating
explicitly (N5a): `landing-page.component.ts:82` sets `overflow-x: hidden`
on the page host. That is good defensive CSS against an accidental
scrollbar, but it also means a genuine RTL layout bug in a child section
(content pushed past the viewport edge) will be silently clipped rather than
surfaced as a visible horizontal scrollbar — so the 4.5 screenshot gate
must check computed `scrollWidth` and visual clipping/overlap directly, not
rely on "no scrollbar appeared" as a passing signal.

### 3.6 Arabic webfont

**Recommendation: IBM Plex Sans Arabic**, weights 400 / 500 / 600 / 700 — four
weights, covering `font-medium`/`font-semibold`/`font-bold`. (Fix for N7:
`index.html` actually loads Inter at **five** weights, 400/500/600/700/800,
not four as the earlier draft said — the hero's `font-extrabold` uses that
800 cut. IBM Plex Sans Arabic has no 800 weight; see the weight-mapping note
below.) Rationale:

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

**Font stack — fix for B6.** The earlier draft's documented stack,
`'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif`, put Plex first and
left Inter out entirely — violating 4.6 ("English, Latin and mono text shall
keep Inter") for every Latin run inside an Arabic page, including inline
brand/product terms (6.1: "Ptah", "SaaS", "Builders"), which would have
rendered in Plex's Latin glyphs instead. The corrected stack, applied to
`tailwind.config.js`'s `fontFamily.sans` (used for **both** languages, no
`[lang="ar"]`-scoped family override):

```js
fontFamily: {
  sans: ['Inter', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'system-ui', '-apple-system', 'sans-serif'],
  mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'], // unchanged
},
```

Inter has no Arabic glyphs, so the browser's per-character font-matching
falls through to IBM Plex Sans Arabic automatically for Arabic text while
every Latin character — in either language — keeps rendering in Inter. This
is why no `[lang="ar"]` family override is needed at all: the single stack
above is correct for both languages simultaneously, and the CSS below is
scoped to metrics only (line-height, letter-spacing, weight), never family.

**Arabic typography adjustments** (apply under `[lang="ar"]` — CSS additions
to `styles.css`, metrics only, per the font-stack fix above):

- No `letter-spacing`/`tracking-*` on Arabic runs — Arabic script's
  connected letterforms break under tracking. Fix for N6: the earlier
  `[lang="ar"] { letter-spacing: normal; }` rule sat on the root and could
  not reach descendants carrying their own `tracking-*` utility (a later,
  more specific rule always wins) or the hero's `text-8xl`/`text-9xl`
  negative tracking. Target the actual utilities instead, and exclude
  `font-mono` and `.ltr-island` (Latin technical text keeps its own metrics
  regardless of the active language):
  ```css
  [lang='ar'] :where([class*='tracking-'], .text-8xl, .text-9xl):not(.font-mono):not(.ltr-island) {
    letter-spacing: normal;
  }
  ```
- Neutralize `uppercase` the same way — Arabic has no case, so `uppercase`
  is a visual no-op, but a co-occurring `tracking-wide` (e.g. the mobile
  nav's `Account`/`Community` section headers,
  `text-[11px] font-semibold uppercase tracking-wide`) still distorts
  Arabic letterforms: `[lang='ar'] .uppercase:not(.font-mono):not(.ltr-island) { text-transform: none; }` (the tracking rule above already
  neutralizes the accompanying `tracking-wide`).
- Line-height: raise body copy from Tailwind's default (`leading-normal`,
  1.5) to **1.75** under `[lang="ar"]` — Arabic's diacritics and taller
  ascenders/descenders need more vertical room at the same font-size than
  Latin text does; 1.5 reads visibly cramped.
- **Weight mapping (fix for N7):** IBM Plex Sans Arabic ships 400-700, with
  no 800 cut, but the hero headline uses `font-extrabold` (800). Rather than
  let the browser synthesize a bolder weight from 700 — synthetic bold
  distorts Arabic's connected letterforms far more visibly than it does
  Latin — map extrabold down to the heaviest real Arabic weight:
  `[lang='ar'] .font-extrabold { font-weight: 700; }`. Latin text inside the
  same element is unaffected (Inter does render true 800), so this rule
  targets the Arabic-rendered glyphs' actual weight while the class's
  effect on any Latin run stays as authored.
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
Questions before the architect encodes it. Fix for N10: this choice must
cover **dates as well as numbers** — 5.1 requires Arabic month/day names via
the `date` pipe/`Intl`, and without an explicit numbering system those APIs
default to Arabic-Indic digits in an `ar` locale even though 5.2's numbering
choice was meant to apply everywhere. The architect should apply
`numberingSystem: 'latn'` consistently to both `Intl.NumberFormat` **and**
`Intl.DateTimeFormat` (or the equivalent single locale tag
`ar-u-nu-latn`, which sets it for every `Intl` API keyed off that locale at
once — the simpler single point of truth).

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
Fix for N9: `border-hairline`/`bg-base-200` are `panel-ui`/DaisyUI tokens
that the public `operator` theme does not define (confirmed: `operator` in
`tailwind.config.js` has no `--border-hairline`/`--surface-high` entries,
and no `libs/web/legal` file uses them) — the legal pages instead use the
`operator` theme's own card idiom, `bg-white/[0.03] border border-white/[0.06] rounded-2xl backdrop-blur-sm` with `text-amber-400` headings and `text-white/70`
body copy (`terms-page.component.ts:45-56` and identically in
`privacy-page.component.ts`/`refund-page.component.ts`). The notice now
matches that idiom instead of inventing a DaisyUI-flavored one:

```html
<div class="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-white/70 backdrop-blur-sm" role="note">
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

### 3.9 Additional behavior notes (fix for N14)

- **Requirement → section map** for the three criteria the review found
  under-traced:
  - **3.1** (switch in place, no reload, URL unchanged): §2.2-2.4 —
    `setLanguage()`/`selectLanguage()` only ever update the active-language
    signal and `document.documentElement.lang`/`.dir`; no snippet in this
    spec issues a navigation, route change or URL mutation of any kind.
  - **3.3** (first-visit detection): this is silent — the switcher renders
    whichever language 3.3's detection resolved to (stored preference, else
    `navigator.languages[0]` starting with `ar`, else English) with no
    banner, toast or "we picked this for you" prompt. A visitor who wants a
    different language uses the switcher exactly as they would to change
    their mind later; first-visit detection is not a decision the interface
    surfaces or asks the visitor to confirm.
  - **6.1** (do-not-translate terms stay Latin): the prototype's Arabic
    strings keep "Ptah", "Ptah Builders", "SaaS" and "PRD" untranslated
    inline (e.g. §3.8's own draft notice, and the pricing card's "Builders")
    as worked examples of the glossary requirement 6.2 asks the
    architect/developer to formalize; this spec does not itself define the
    do-not-translate glossary file, only demonstrates the visual result.
- **Latin terms and punctuation inside an Arabic sentence**: short inline
  Latin runs — the do-not-translate terms above, or a single product name —
  need **no** special markup. The Unicode Bidi Algorithm already embeds a
  short LTR run correctly inside surrounding RTL text, including adjacent
  Arabic punctuation, without help. `.ltr-island` (3.3) is reserved for the
  cases that actually need explicit isolation: multi-token technical strings
  with their own internal punctuation that must not reflow with the
  sentence around them (a URL, a version string, a CLI command, a code
  block) — not single inline words. Applying `.ltr-island` to every Latin
  term as well would be over-isolation with no benefit and a maintenance
  cost (one more class to remember on every do-not-translate mention).

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
| Icon mirroring candidates | word-boundary grep of `ArrowRight\|ArrowLeft\|ChevronRight\|ChevronLeft` across every `.ts` under `libs/web` (66 combined matches — this is a match count, not a file count, which is the reproducible unit; see §3.2) |
| Per-section RTL calls | `grep` of `slideLeft\|slideRight\|x:\|xPercent\|scaleX\|transformOrigin\|ScrollTrigger\|overflow-x` across all 19 non-spec `.ts` files under `libs/web/landing/src/lib` + the 3 named sibling components (see §3.5) |
| Panel focus-ring color (`base-content`, not `amber-400`) | Computed WCAG contrast against `apps/ptah-landing-page/tailwind.config.js`'s literal theme hex values — §2.5a |
| Legal notice card styling | `terms-page.component.ts:45-56` (`bg-white/[0.03] border border-white/[0.06] rounded-2xl backdrop-blur-sm`, identical in `privacy-page.component.ts`/`refund-page.component.ts`) |
| Admin topbar has no theme toggle | `admin-layout.html:19-24` (`panelTopBar` content is "Signed in as" + email only) |

---

## 6. Review responses (revision 1)

Every finding from `design-spec-review.md` round 1 (REVISE: B1-B6 blocking,
N1-N15 non-blocking), and where it is resolved.

### Blocking

- **B1** (screenshots did not render the design): the prototype no longer
  depends on any CDN at capture time. `prototype/tailwind-build.css` is a
  real, offline-compiled Tailwind 3.4.18 + DaisyUI 4.12.24 stylesheet built
  from the project's own theme values (see that file's own header comment
  for the exact, reproducible build command), and `prototype/fonts/fonts.css`
  self-hosts the actual Inter, JetBrains Mono and IBM Plex Sans Arabic
  `.woff2` files instead of linking Google Fonts live. All 8 screenshots
  were recaptured and visually confirmed by eye (flex layout intact, RTL
  mirrored, LTR islands holding, Plex Arabic glyphs rendering, no clipping
  at 375px after also fixing a genuine mobile-width overflow the panel
  topbar had once the switcher was added — see the `flex-wrap` fix in
  `prototype/index.html`'s panel header). Two new screenshots
  (`header-menu-open-en-1440.png`, `header-menu-open-ar-1440.png`) show the
  header menu open per direction, plus the default closed state every other
  shot already carries.
- **B2** (panel options labelled "EN"/"AR" only): fixed in §2.4 — visible
  caption stays `EN`/`AR` (space-constrained, matching `MemberThemeToggle`'s
  own collapse reasoning), but `aria-label` now states the language in its
  own language (`English`/`العربية`), satisfying 3.8.
- **B3** (keyboard/ARIA contract not implementable as written): fixed
  throughout §2.2, §2.3 and §2.6 — the header skin now specifies Tab-order
  operability matching the existing sibling menus exactly (no invented
  arrow-roving that contradicted "zero new wiring"), with a real, small
  `selectLanguage()` method that closes the menu and refocuses the trigger
  (the snippet and the prose now agree); the panel skin gets a real,
  concrete roving-tabindex + direction-aware keydown implementation; the
  mobile row's ARIA structure changed from invalid `radiogroup`/`radio`
  nested in `role="menu"` to valid `group`/`menuitemradio`.
- **B4** (light-theme focus ring fails contrast; contrast claims unmeasured):
  fixed — panel focus ring is now `base-content` (§2.5), and §2.5a adds the
  full measured contrast table the review asked for, including the specific
  1.68:1 and 2.04:1 failures that justified the change.
- **B5** (`problem-section` animated-direction gap): fixed — a full row
  added to §3.5 covering `textConfig`/`chartConfig`'s `slideRight`/
  `slideLeft` entrance directions and the SVG chart's LTR-island decision.
- **B6** (font stack dropped Inter for Latin text): fixed — §3.6 now states
  `['Inter', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', ...]`, applied
  identically to both languages, with no `[lang="ar"]` family override.

### Non-blocking

| # | Disposition |
| --- | --- |
| N1 | Fixed — §2.2's menu panel now uses `start-0`, not `left-0`/`ltr:`/`rtl:`. |
| N2 | Fixed — §2.2 placement corrected to "after Community, before the auth cluster," accurate for both signed-in and signed-out nav states. |
| N3 | Fixed — §2.4: `LanguageSwitch` now projects after `<ng-content>`, so it sits directly next to `MemberThemeToggle` on the member shell; "left of" reworded to direction-agnostic phrasing; admin's actual topbar content (email only, no theme toggle) now stated correctly. |
| N4 | Fixed — §3.5's builders row now states one decision (a code-level sign flip so the marquee's physical drift direction is invariant), not two contradictory ones, and cites `buildMarquee()` (not `buildMarqueeLoop`). |
| N5 | Fixed — §3.5's tug-meter row now wraps the whole meter in an LTR island instead of a piecemeal "fixed sides, mirror text" rule that `justify-between` broke; the `left-[38%]` marker's exemption reason corrected from "centring pair" to "fixed data-marker position inside an LTR-islanded meter." |
| N5a | Fixed — §3.5 re-ran the grep across all 19 (not 15) `libs/web/landing` components and added rows for `terminal-mock`, `device-frame`, `waitlist-form` and `comparison-section`, plus a QA note on `landing-page.component.ts:82`'s `overflow-x: hidden` masking risk. |
| N6 | Fixed — §3.6's letter-spacing rule now targets `:where([class*='tracking-'], .text-8xl, .text-9xl)` descendants, excluding `.font-mono`/`.ltr-island`, instead of a root-level rule descendants' own utilities would have overridden. |
| N7 | Fixed — §3.6 now states Inter's real weight count (five, 400-800) and adds the `[lang='ar'] .font-extrabold { font-weight: 700; }` mapping so Arabic never gets a synthesized bold from Plex's 700 ceiling. |
| N8 | Fixed — §3.2 adds `Send`/`Reply`/`LogOut` (mirror) and `ExternalLink` (no mirror), flags literal `→`/`←` text characters in admin templates for conversion to icon components, documents the `panel-layout.html:95` rotated-`ChevronDown` exception, and restates the count methodology (66 is a match count across a stated grep pattern, reproducible as specified). |
| N9 | Fixed — §3.8's legal notice now uses the legal pages' own `bg-white/[0.03] border border-white/[0.06]` card idiom instead of DaisyUI tokens `operator` does not define. |
| N10 | Fixed — §3.7 extends the numbering-system recommendation to dates (`Intl.DateTimeFormat`/`ar-u-nu-latn`), not `Intl.NumberFormat` alone; the prototype's Arabic-Indic digits (badge, section labels) were replaced with Western numerals to stop contradicting the recommendation the user is asked to confirm. |
| N11 | Fixed — both skins' `aria-label`s are now prefixed with their exact visible text (`"EN — Language: English"`, `"AR — اللغة: العربية"`, `"EN — Language: English"` on the header trigger), satisfying WCAG 2.5.3; panel skin changed from `btn-xs` to `btn-sm`, matching `MemberThemeToggle`. |
| N12 | Fixed — the panel skin's selected segment now also renders a small check icon, so state is never carried by fill color alone (§2.4, §2.5a). |
| N13 | Fixed — §2.7 merges `nav.language`/`common.language` into one `common.language` key owned by `libs/web/ui`, consumed by both skins; each skin's owning library is restated (header: `libs/web/ui`; panel: `libs/web/panel-ui`). |
| N14 | Fixed — §3.9 adds the requirement→section map for 3.1/3.3/6.1, states first-visit detection is silent (no banner), and explains why short inline Latin do-not-translate terms need no `.ltr-island` markup (the Unicode Bidi Algorithm already handles them) while multi-token technical strings do. |
| N15 | Fixed — the prototype no longer hand-defines `--surface-high`/`--border-hairline` for the `operator` theme (removed from `tokens.css`; the compiled `tailwind-build.css` now generates these per-theme exactly as DaisyUI does in the real app, correctly leaving `operator` without them), and the marketing-header markup that had been using those tokens now uses the literal `ink-700` border color the real `NavigationComponent` uses instead. |

Both `[DECISION]` items (numbering system, legal governing-language notice)
remain the user's to make at Gate 1.7, unchanged by this revision.
