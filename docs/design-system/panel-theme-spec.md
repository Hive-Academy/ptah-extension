# Ptah Builders — Panel Theme Reconciliation Spec

Source of truth for `operator-admin` (revised) and the two new themes `operator-member` /
`operator-member-light` in `apps/ptah-landing-page/tailwind.config.js`. `operator` (public
marketing site) is untouched and out of scope.

Inputs: 8 Stitch screens (dark+light pairs of member_home, community_feed, discussion_thread,
course_learning) under `docs/design-system/stitch_ptah_builders_member_home/`, plus
`admin_sessions_calendar_ptah_builders/code.html` (calendar internals only — its sidebar chrome
is a hallucinated different product and is ignored), plus two Stitch-emitted Material-3
`DESIGN.md` token dumps (`kinetic_operator/`, `warm_professionalism/`).

Every screen emits its own inline `tailwind.config` `<script>` block with a Material-3 token set
(`surface-container-lowest` … `-highest`, `on-primary-fixed-variant`, etc.) that differs slightly
file to file — this is the "drift" this doc collapses into one system.

---

## 1. Elevation ladder

**Revision history (two wrong turns, kept on record so a third pass doesn't repeat either):**

1. **v1** took `base-200`/`base-300` hexes directly from `kinetic_operator/DESIGN.md`'s
   Material-3 frontmatter. Visual review measured it (sRGB relative luminance per WCAG, not by
   eye) and found it flatter than the theme it replaced (`base-100`→`base-200` 1.08:1,
   `base-200`→`base-300` 1.05:1, vs the old theme's 1.12:1/1.20:1).
2. **v2** "fixed" that by widening the ladder to arbitrary ≥1.25/≥1.15 WCAG targets. That
   overcorrected: a three-way rendered comparison (old ladder bare / old ladder + hairline / v2's
   widened ladder) against the actual Stitch screenshots showed the widened version reading as a
   visibly different, lighter navy-slate product — not a refinement of the reference, a departure
   from it.
3. **v3 (current)** is grounded in **pixel-sampled evidence** from the mockup canvases
   themselves — histograms over 60k+ samples per screen, not a hex read off a token file and not
   an eyeballed render:

   | Source                    | Page bg (sampled)        | Card fill (sampled)      | Page→card ratio |
   | ------------------------- | ------------------------ | ------------------------ | --------------- |
   | `member_home`             | `(12,20,31)` = `#0c141f` | `(22,26,35)` ≈ `#161a23` | **1.062:1**     |
   | `admin_sessions_calendar` | ≈ `#0c141f`              | `(21,28,39)` = `#151c27` | **1.081:1**     |

   Two independently sampled screens converge on **1.06-1.08:1** — i.e. the mockups do not
   create depth via background-step distance at all; that's closer to v1's original (tight)
   ladder than to v2's widened one. What _does_ create the mockups' sense of definition is a
   sampled card border at **~(44,51,66)**, giving a measured **~1.43:1 card-to-border contrast**
   — see §2. v1's diagnosis of _why_ (Material-3 tiers are supposed to sit close together because
   M3 carries elevation via shadow + tonal overlay, not background-step distance) was correct;
   its instinct to keep the ladder tight was also correct. v2's error was treating "flatter than
   the old theme" as itself sufficient reason to widen, without checking whether the _reference
   mockups_ were themselves that tight on purpose. They are.

**Conclusion: the ladder reverts to the tight (v1) values.** `base-100`/`base-200`/`base-300`
match the sampled evidence closely enough that no further tuning was applied — the mockups
essentially picked these exact hexes. Depth comes from `--border-hairline` (§2), not from
ladder spacing.

daisyUI gives us three surface steps (`base-100/200/300`). We keep **one** extra CSS custom
property, `--surface-high`, because a 4th "raised above card" tier is genuinely load-bearing: it
is the hover/active state on nav items and calendar cells, the background for notification/badge
chips, and the highlighted "staff reply" card in the discussion thread — five of the eight
screens plus the admin calendar all reach for a value distinctly lighter than the card tier for
exactly these three purposes. This step is not part of the page→card contrast finding above (it's
above the card tier, not between page and card), so it's unaffected by the revert other than
returning to its original v1 value alongside everything else.

| Step                                                       | Hex       | Role                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base-100`                                                 | `#0c141f` | Page canvas                                                | Matches sampled page background in both `member_home` and `admin_sessions_calendar`; `background`/`surface` in the Material-3 config of `member_home` (both modes' dark config), `course_learning` dark; `kinetic_operator/DESIGN.md` frontmatter `background: '#0c141f'`.                                                                                                                                                                                                                      |
| `base-200`                                                 | `#151c27` | Panel / card                                               | Exact match to `admin_sessions_calendar`'s sampled card fill `(21,28,39)`; `admin_sessions_calendar`'s sidebar, calendar-panel wrapper, and session-template cards all use `bg-surface-container-low` = `#151c27`; `kinetic_operator/DESIGN.md` frontmatter `surface-container-low: '#151c27'`. `member_home`'s sampled card fill `(22,26,35)` ≈ `#161a23` is a 1-hex-step drift from the same design intent, folded in — not a distinct tier.                                                  |
| `base-300`                                                 | `#19202c` | Raised row / grid interior structural tier                 | `admin_sessions_calendar`'s `surface-container` and `kinetic_operator/DESIGN.md` frontmatter agree on `#19202c`. Used for e.g. the calendar grid's structural background beneath cells.                                                                                                                                                                                                                                                                                                         |
| `--surface-high` (custom property, not a daisyUI base key) | `#232936` | Hover / active-nav / badge-chip / highlighted-card overlay | `discussion_thread` dark's explicit `.elevated-surface` class (staff-reply highlight) and `course_learning` dark's `.layer-2` both hardcode `#232936`; `admin_sessions_calendar`'s "Active State Navigation" item and toolbar strip use `surface-container-high`/`-highest` (`#232a36`, 1-hex drift, folded in); `member_home`/`community_feed` use `surface-container-highest` (`#2e3542`, a looser drift, also folded in — same _role_, badge/hover/highest tier, just a lighter Stitch run). |

Measured (WCAG relative luminance, sRGB-linearized): `L(base-100)=0.00678`,
`L(base-200)=0.01197`, `L(base-300)=0.01422`, `L(--surface-high)=0.02210`.
`base-100`→`base-200` = **1.091:1**; `base-200`→`base-300` = **1.036:1**;
`base-300`→`--surface-high` = **1.123:1**. These are intentionally close together — that's the
whole finding above, not a defect. Full range `base-100`→`base-300` = **1.13:1**; including
`--surface-high` = **1.27:1** — essentially the original v1 numbers the visual-review flagged as
"flat" in isolation, which is correct: on their own they _are_ flat, and were never meant to
carry definition by themselves. §2 is where the actual contrast lives.

Rejected as a 5th tier: `#070e1a` (`surface-container-lowest`), used only once — the recessed
calendar-grid interior in `admin_sessions_calendar`. It's close enough to `base-100` (`#0c141f`)
to reuse directly; recommend achieving the "sunken well" look with an inset shadow rather than a
new token.

**`--surface-high` is wired as a real utility**, not just a declared CSS variable. It's mapped in
`theme.extend.colors` as `'surface-high': 'var(--surface-high)'`, which makes `bg-surface-high`,
`border-surface-high`, `text-surface-high`, etc. compile to normal Tailwind utilities that read
the theme-scoped custom property. **Verification method, corrected:** an earlier pass "confirmed"
this by adding a scratch HTML file that used `bg-surface-high`, building, checking the compiled
CSS, then deleting the scratch file — that only proves the utility works _while the scratch file
exists_. The durable check is static, not transient: (a) the custom property is declared in every
theme block that needs it (`--surface-high: #232936` dark / `#e2e2ea` light — confirmed present
in the compiled theme selectors), and (b) the `theme.extend.colors` entry
(`'surface-high': 'var(--surface-high)')`) exists in the config source. Both are true regardless
of whether any component currently references `bg-surface-high` — Tailwind's JIT generates the
utility the moment a real component in `libs/web` does, via the existing content globs. A
utility not yet appearing in a build's output because nothing references it yet is normal JIT
behavior, not a defect — don't mistake "absent because unused" for "broken."

**Known, deliberate duplication:** `operator-admin` and `operator-member` are currently
byte-identical theme objects (see §8). daisyUI's compiler recognizes this and collapses their
selectors to a single combined rule (`[data-theme=operator-admin],[data-theme=operator-member]`)
in the compiled CSS. This is expected, not a bug — the two themes are kept as separate names
specifically so the member shell can diverge from the admin shell later without a migration. Do
not "deduplicate" this back down to one theme name.

**Text on these surfaces:** `base-content` moves from the current neutral `#e9ebef` to
`#dce2f3` — a blue-tinted off-white. Evidence: `on-surface: '#dce2f3'` is identical across
_every_ dark screen's config (`member_home`, `community_feed`, `discussion_thread`,
`course_learning`, `admin_sessions_calendar` — 5/5 convergence) and appears in
`kinetic_operator/DESIGN.md`. This is the text-side half of "adopt the blue-tinted ladder," and is
unaffected by the surface-ladder revert above (it was never part of the flatness finding).

Muted/secondary text was consistently `on-surface-variant: '#d7c3ae'` (a warm tan-grey) across
the same 5 screens. daisyUI v4 has no dedicated "muted text" slot — recommend implementing via
`text-base-content/60` opacity rather than hardcoding a second text color; not worth a second
custom property.

### Light ladder (`operator-member-light`)

**Same finding applies, confirmed by pixel-sampling.** `base-100` (`#faf9f7`) vs `base-200`
(`#ffffff`) measures **1.052:1** — sampled evidence lines up with the WCAG calculation exactly.
The correct response, per the dark-ladder finding above, is **not** to widen this — a
near-white card on an off-white page, defined by a visible hairline, is the mockups' actual light
idiom, symmetric with the dark theme's near-black-on-near-black-plus-hairline idiom. Fills stay
as originally reconciled; `--border-hairline` (§2) is what was tuned for light mode.

| Step             | Hex       | Role                                      | Evidence                                                                                                                                                                                                                                                                                                                     |
| ---------------- | --------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base-100`       | `#faf9f7` | Page canvas                               | `member_home_light_mode`'s literal `body{background-color:#faf9f7}`; `community_feed_light_mode`'s config `surface`/`background`; `warm_professionalism/DESIGN.md` "Level 0 (Base): Page background `#faf9f7`." Absorbs `#faf8ff` (`discussion_thread_light_mode`, `course_learning_light_mode` — 1-hex drift, same intent). |
| `base-200`       | `#ffffff` | Panel / card                              | Universal across all 4 light screens (`.glass-panel`, `surface-variant`, `surface-container-lowest`, `.layer-1` all resolve to pure white).                                                                                                                                                                                  |
| `base-300`       | `#f2f0ec` | Elevated / inactive-chip / hover-row tier | `community_feed_light_mode`'s arbitrary `bg-[#f2f0ec]` (inactive filter chips, toolbar hover, trending-row hover) **and** `warm_professionalism/DESIGN.md`: "Cards and containers use `#ffffff` (raised) or `#f2f0ec` (elevated)." Two-source convergence.                                                                   |
| `--surface-high` | `#e2e2ea` | Badge/notification-highest tier           | `member_home_light_mode` / `community_feed_light_mode` / `discussion_thread_light_mode` all converge on `surface-container-highest` ≈ `#e2e1e9`/`#e2e2ea` (1-hex drift). Kept for parity with the dark theme's 4th step rather than because light screens visibly lean on it — low-risk, no cost.                            |

`base-content` = `#1a1c22`. Evidence: `member_home_light_mode`'s literal `body{color:#1a1c22}`;
`community_feed_light_mode`/`discussion_thread_light_mode` configs use `on-surface: '#191b21'`
(1-hex drift, folded in).

---

## 2. Borders

**This is where the mockups' actual definition lives — not the surface ladder (§1).** Pixel
sampling the mockup card borders gave **~(44,51,66)**, and measuring that against the sampled
card fill produces **~1.43:1 card-to-border contrast** — this single number is the real source of
the "the mockups read as rich/deep" effect that motivated widening the ladder in the first place
(wrongly — see §1). The fix was never the ladder; it was making sure this border is present and
correctly tuned.

`base-300` cannot serve as both "raised surface" and "hairline border" — a fill and a stroke need
different lightness, and conflating them (the original recommendation: reuse `border-base-300`
for hairlines) means any future elevation-ladder tweak silently breaks border visibility.
`stat-tile.html` using `border-base-300` on `bg-base-200` demonstrated exactly this failure mode.
Borders get their own token.

**`--border-hairline`** — a dedicated custom property, wired as a real utility exactly like
`--surface-high` (`hairline: 'var(--border-hairline)'` in `theme.extend.colors`, giving
`border-hairline`, `bg-hairline`, etc.). Statically confirmed (declared property + colors mapping,
not a transient scratch-file test — see §1's verification-method note): `--border-hairline:
#303849` (dark), `--border-hairline: #dcd6cb` (light), both present in the compiled theme
selectors, both wired through `theme.extend.colors`.

| Theme                                     | Hex       | `base-200` fill `L` | Border `L` | Card-to-border ratio | Target                            |
| ----------------------------------------- | --------- | ------------------- | ---------- | -------------------- | --------------------------------- |
| dark (`operator-admin`/`operator-member`) | `#303849` | 0.01197 (`#151c27`) | 0.03939    | **1.4425:1**         | 1.40-1.45 (sampled ≈1.43) ✓       |
| light (`operator-member-light`)           | `#dcd6cb` | 1.0 (`#ffffff`)     | 0.67585    | **1.4468:1**         | same idiom, symmetric with dark ✓ |

**Dark-mode derivation.** `#2c3342` — the Stitch-sampled hairline family cited below — measures
`L=0.03295`, giving **1.339:1** against `base-200` (`#151c27`, restored to its v1 value per §1):
slightly under the 1.40-1.45 target. `#303849` (44% brighter G-channel step from `#2c3342`, same
~221° hue as the sampled border cluster) was solved to land at **1.4425:1**, matching the
sampled ~1.43:1 almost exactly, without leaving the sampled border's hue family.

**Light-mode derivation.** No prior pass had actually retargeted the light hairline — it had been
carried forward from Stitch evidence (`#e2ddd4`, `member_home_light_mode`'s `.glass-panel` border
etc.) without checking it against a card-to-border ratio at all. Measured against `base-200`
(`#ffffff`, unchanged per §1): `#e2ddd4` only gives **1.352:1** — visibly softer than dark mode's
equivalent. Solved for the same 1.40-1.45 window: `#dcd6cb` (a slightly darker step in the same
warm-neutral family as `#e2ddd4`, not a hue change) lands at **1.4468:1**, putting light and dark
on matching card-to-border contrast for the first time.

Original Stitch evidence for hairline color/weight (design intent, not the exact final hex in
either mode): `member_home` (`.glass-panel` — hardcoded, distinct from its own config's
`outline-variant` #524434), `community_feed` (`.thread-card`, `layer-border` custom token),
`discussion_thread` (`.hairline-border` custom class), `course_learning` (`border-color` custom
token), `member_home_light_mode`'s `.glass-panel` border, `community_feed_light_mode`'s
`outline-variant`, `warm_professionalism/DESIGN.md`'s "the `#e2ddd4` hairline border." Four of
five dark screens define this as an explicit, deliberate CSS class/custom-token — i.e. not
Material-3 auto-export noise — and `kinetic_operator/DESIGN.md` states it in prose: "Every panel
transition must be defined by a 1px hairline border." Width is **1px** (`border`) as the default
everywhere. Rejected: `admin_sessions_calendar`'s `outline-variant` = `#524434` (warm brown, M3
auto-export, same rejected family as the calendar's chrome navigation); `discussion_thread_light_
mode`'s `outline-variant` (`#d8c3b0`) and `course_learning_light_mode`'s generic
`#e0e0e0`/`#eeeeee` (both one-off, unrepresentative light-mode M3 exports); the pre-existing
`ink-700` = `#262a33` (considered as a candidate at one point, but it's an `operator`-theme value
tied to that theme's own untouched ladder, not derived against the admin/member ladder or the
sampled border evidence at all).

2px borders are reserved for semantic-state accents only, never a generic card weight: active-nav
item (`border-l-2 border-primary`), active-lesson row (`border-l-2 border-primary-container`),
"unread" thread indicator (`border-l-2` in the info/tertiary hue), "pinned" thread indicator
(`border-t-2` in primary). A 4px left-bar (`w-1` solid div, not a border utility) is used
interchangeably with the 2px border technique for the same "pinned" semantic in different
screens — pick one implementation per component, don't standardize the hex.

---

## 3. Color roles beyond surfaces

| daisyUI key       | Hex (dark) | Hex (light) | Role                                            | Evidence / decision                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------- | ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary`         | `#f5a524`  | `#f5a524`   | Brand CTA / active nav / links                  | **Decision 2 (given):** brand amber stays primary in every theme, dark or light. Stitch's own light mockups actually used `#c97e0e` as the resting CTA color (`community_feed_light_mode`, `course_learning_light_mode` configs) with `#f5a524` only as the _hover_ state — this is exactly the kind of per-screen drift the task exists to collapse; decision 2 overrides it in favor of one brand hex everywhere. |
| `primary-focus`   | `#c97e0e`  | `#c97e0e`   | Hover/pressed primary                           | Matches the existing `amber.600` and every light screen's actual resting-CTA hex (`#c97e0e`) — now correctly demoted to the _focus_ state instead of `primary` itself.                                                                                                                                                                                                                                              |
| `accent`          | `#ffbb4d`  | `#ffbb4d`   | Secondary emphasis                              | **Decision 2 (given):** Stitch's dark-ladder amber `#ffc77f`/hover `#ffb957`/`#ffbb4d` become accent, not primary. Kept the existing `#ffbb4d` (already `amber.400`) rather than introducing yet another near-identical amber.                                                                                                                                                                                      |
| `secondary`       | `#34d399`  | `#34d399`   | Unchanged — kept                                | No Stitch evidence contradicts it; not in scope of the decisions.                                                                                                                                                                                                                                                                                                                                                   |
| `info`            | `#38bdf8`  | `#38bdf8`   | Unchanged — kept                                | Loosely supported: `community_feed` dark's "unread" indicator (`tertiary-container` `#36c2ff`) and `discussion_thread`'s "accepted answer" (`secondary-container` `#00a6e0`) are both blue-family, consistent with keeping `info` blue. Not worth chasing Stitch's exact blue given it varies screen to screen.                                                                                                     |
| `success`         | `#34d399`  | `#34d399`   | Unchanged — kept                                | `discussion_thread_light_mode`'s "Accepted Answer" badge uses true Tailwind `green-100/600/800`, and `course_learning_light_mode`'s "Answered" check uses `text-green-600` — both support keeping success green; exact hex not chased.                                                                                                                                                                              |
| `warning`         | `#eab308`  | `#eab308`   | Unchanged — **must** stay distinct from primary | **Decision 5 (given).** Do not undo the existing `tailwind.config.js:92-95` fix.                                                                                                                                                                                                                                                                                                                                    |
| `error`           | `#fb7185`  | `#fb7185`   | Unchanged — kept                                | Stitch evidence varies wildly by screen (`#ffb4ab` dark M3, `#ba1a1a` light M3, `#93000a` error-container) — none is authoritative enough to displace the existing coral-red; kept for cross-theme consistency rather than importing a 5th red.                                                                                                                                                                     |
| `neutral`         | `#151c27`  | `#f2f0ec`   | Chrome / less-prominent surfaces                | Set equal to `base-200`/`base-300` respectively — matches how the admin sidebar (`bg-surface-container-low`) and the light "inactive chip" tier actually read; no dark-footer-bar evidence in any screen that would justify a separately dark `neutral` in the light theme. Tracks `base-200`, so it moved with the ladder's widen-then-revert (§1) and is now back at its original value.                          |
| `neutral-focus`   | `#232936`  | `#e2ddd4`   | Hover of the above                              | `--surface-high` (dark) / hairline border hex (light, as a chip-hover darkening). Tracks `--surface-high`, likewise reverted.                                                                                                                                                                                                                                                                                       |
| `neutral-content` | `#b7bdc9`  | `#1a1c22`   | Text on `neutral`                               | Dark: unchanged existing value (close enough to the `#d7c3ae` muted-text evidence that a change isn't justified). Light: same as `base-content`.                                                                                                                                                                                                                                                                    |

All `*-content` pairs on bright/saturated fills (`primary-content`, `accent-content`, `info-
content`, `success-content`, `warning-content`, `error-content`) stay `#08090c` across every
theme — the existing near-black already reads correctly against amber/green/blue/yellow/red and
introducing a second near-black per theme (e.g. a `#1a1c22`-based one for the light theme) would
add drift for zero visible benefit.

### Known limitation: `warning` vs `primary` at low-opacity borders

`warning` (`#eab308`) and `primary` (`#f5a524`) are only ~8° apart in hue — a deliberate,
already-recorded tradeoff (decision 5: `warning` must differ from `primary`, it isn't required to
differ by _much_, and it must not be repainted). Measured: composited at the `/20` border-opacity
convention used for outline-style badges (§3 above, e.g. `border-primary/20`), the two colors'
mutual contrast is **≈1.02:1** — indistinguishable at that opacity. This is a real finding, but
the fix is **not** to repaint `warning` (out of scope, decision 5 stands) — it's that conveying
semantic meaning through a low-opacity _border_ was never going to survive two brand colors this
close in hue. Any component that needs to distinguish a warning state from a primary/brand state
should use a solid fill, an icon, or text, not rely on a translucent border alone to carry the
distinction. Recorded here so a future pass doesn't "fix" this by touching `warning`.

---

## 4. Typography

Two incompatible token vocabularies exist across the 8 screens. **System A** (named
`display-lg`/`headline-md`/`title-sm`/`body-base`/`body-sm`/`code-sm`/`label-caps`/
`numeric-data`) appears in 6 of 8 screens: `member_home` (both modes), `community_feed` dark,
`discussion_thread` (both modes), `course_learning` (both modes). **System B**
(`headline-lg`/`headline-lg-mobile`/`headline-md`/`body-lg`/`body-md`/`caption`/`label-mono`)
appears only in `community_feed_light_mode`. System A is the canonical scale — System B is a
one-off Stitch run and is rejected below.

| Token          | Size | Weight | Line-height | Tracking | Family             | Applied to                                                                                         |
| -------------- | ---- | ------ | ----------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `display-lg`   | 32px | 700    | 1.2         | -0.02em  | Inter              | Page H1, hero session title (stat _numbers_ on top of this size switch family to mono — see below) |
| `headline-md`  | 24px | 600    | 1.3         | —        | Inter              | Section H1s ("Community Feed", "Sessions")                                                         |
| `title-sm`     | 18px | 600    | 1.4         | —        | Inter              | Card/thread H2-H3 titles, nav brand                                                                |
| `body-base`    | 14px | 400    | 1.6         | —        | Inter              | Post/paragraph body text                                                                           |
| `body-sm`      | 13px | 400    | 1.5         | —        | Inter              | Nav labels, excerpts, chip labels                                                                  |
| `code-sm`      | 13px | 450    | 1.6         | —        | **JetBrains Mono** | Inline `<code>`, fenced code blocks                                                                |
| `label-caps`   | 11px | 600    | 1.0         | 0.08em   | **JetBrains Mono** | Every all-caps eyebrow/section header, badge/tag text, avatar overflow counters                    |
| `numeric-data` | 14px | 500    | 1.0         | —        | **JetBrains Mono** | Every count, timestamp, stat number, progress %, lesson duration                                   |

**Mono usage confirmed and is heavier than the task hypothesis stated** — it's not just
timestamps/counts/IDs/badges: `community_feed_light_mode` (System B) extends `label-mono` to
author _names_ in the byline row, not just their timestamp/role. Recommend: `font-mono` (→
JetBrains Mono) for anything in `label-caps` or `numeric-data` roles; `font-sans` (→ Inter,
already the default) for everything else.

`display-lg` at 48px (System B's `headline-lg`, hero-only, with a 32px mobile step) is the one
piece of System B worth keeping as an _optional_ larger display step for hero sections — but it's
additive, not a replacement for System A's 32px `display-lg`.

---

## 5. Spacing / radius / border-width observations

- **Card padding:** `p-3` (compact list rows — calendar template cards, upcoming-session
  cards) → `p-4` (standard cards, composer) → `p-5`/`p-6` (primary content cards — OP post,
  hero widgets) → `p-8` (hero sections only).
- **Gap rhythm:** `gap-1`/`gap-2` (icon+label pairs) → `gap-3`/`gap-4` (card internals, grids)
  → `gap-6`/`gap-8` (page-level section stacks, multi-column layouts).
- **Radius:** Cards consistently **12px** (`rounded-xl` / hardcoded `12px` in custom classes) —
  matches the existing `--rounded-box: 0.75rem`, no change needed. Buttons/inputs consistently
  **8px** (`rounded-lg`) — matches existing `--rounded-btn: 0.5rem`, no change needed. Badges are
  mixed: most are full pill (`rounded-full`), matching the existing `--rounded-badge: 999px`, but
  `discussion_thread` dark's role pills ("Core Team", "Founding Member") use square `rounded`
  (4px) instead. This is a single-screen inconsistency, not a pattern — **kept the existing 999px
  default**, did not change it.
- **Border width:** 1px (`border`) is the default everywhere, without exception, for card/panel/
  input hairlines. 2px is reserved for semantic-state accents (see §2). No screen uses a generic
  2px card border.

No evidence in any screen contradicts the other existing custom properties
(`--animation-btn`, `--animation-input`, `--btn-focus-scale`, `--border-btn`, `--tab-border`,
`--tab-radius`) — all kept unchanged.

---

## 6. Rejected

- **`admin_sessions_calendar_ptah_builders`'s sidebar/chrome** ("PTAH_OS V2.0.4-STABLE",
  Inventory/Analytics/Treasury/Deploy Project nav). Per task instructions this is a hallucinated
  different product; only its calendar-cell/event-chip/right-rail treatment fed into this spec.
- **Material-3 token naming** (`surface-container-lowest`…`-highest`,
  `on-primary-fixed-variant`, `inverse-on-surface`, etc.) from every screen's inline
  `tailwind.config` and from both `DESIGN.md` files. None of it is carried forward — everything
  collapses onto daisyUI's `base-100/200/300` + the one `--surface-high` custom property, per
  decision 3/4.
- **`kinetic_operator/DESIGN.md`'s own internal contradiction**: its YAML frontmatter declares
  the new blue-tinted ladder (`surface: '#0c141f'`, `surface-container-low: '#151c27'`,
  `surface-container: '#19202c'`) — which this spec adopts — but its prose "Colors" and
  "Elevation & Depth" sections instead describe the _old_ neutral ladder ("Page backgrounds are
  darkest (#0b0d12). Raised containers use #161a23... Layer 1 (Cards/Panels): #161a23... Layer 0
  (Background): #0b0d12"), i.e. exactly the values this task is replacing. The frontmatter (which
  matches the actual screen `code.html` values) was treated as authoritative; the prose is stale
  boilerplate and was ignored.
- **`#0b0d12`** as page background. Used literally in `community_feed` and `discussion_thread`
  dark screens' `<body>` styles (and it's the _current_ `operator-admin` `base-100`), but decision
  1 explicitly calls for moving off this exact value onto the `#0c141f` family; two of five dark
  screens hadn't made that jump internally either — expected drift, decision 1 wins.
- **`community_feed_light_mode`'s System B typography vocabulary** as the canonical scale (see
  §4) — outvoted 6-to-1 by System A across the other seven screens.
- **A 5th elevation tier for `#070e1a`** (calendar-grid recessed interior) — see §1.
- **Discussion/course screens' own per-file "primary vs primary-container" flip-flopping** as the
  brand-action driver (`community_feed` dark uses `primary-container` #f5a524 for its main CTA,
  while `member_home`/`community_feed_light_mode` use plain `primary`; `course_learning` dark uses
  `primary-container` for progress-fill while its light counterpart uses plain `primary` for the
  same element) — decision 2 resolves this outright: `primary` is always `#f5a524`.
- **Four different, mutually-inconsistent implementations of the amber CTA** across the four
  dark-ladder screens (`member_home`'s `primary`/`ffbb4d`-hover/`#2a1800`-text triple;
  `community_feed`'s `primary-container`/`#ffbb4d`-hover; `discussion_thread`'s own
  `primary`/`#ffbb4d`-hover/mismatched `#2a1800` text that doesn't equal its own config's
  `on-primary: #462b00`; `course_learning`'s `.primary-btn` class using its config's `primary`
  directly) — all collapsed into the single `primary`/`primary-focus`/`primary-content` triple in
  §3.
- **Syntax-highlighter palettes** (VS-Code-Dark+-style tokens in `discussion_thread_light_mode`'s
  `.code-block` — `#1e1e1e`/`#569cd6`/`#ce9178`/`#dcdcaa`/`#6a9955`, and the M3-token-based
  `.token.*` classes elsewhere) are out of scope for a daisyUI theme object; left for a future
  Monaco/Shiki theme mapping, not part of this token system.
- **Widening the elevation ladder** to fix the flatness finding above. This was the _second_
  wrong turn, not the fix: pixel-sampling the actual Stitch mockups (60k+ samples/screen) showed
  they sit at **1.06-1.08:1** page-to-card contrast — i.e. the mockups themselves are that tight,
  and a three-way rendered comparison against them confirmed the widened ladder read as a
  visibly different, lighter product, not a refinement. `base-200`/`base-300`/`--surface-high`
  reverted to their original values (`#151c27`/`#19202c`/`#232936`). The definition the mockups
  actually carry comes from a sampled **~1.43:1 card-to-border contrast** — see §2's
  `--border-hairline`, which is the token that was actually under-specified.
- **Lifting `base-200`/`base-300`/`--surface-high` hexes directly from
  `kinetic_operator/DESIGN.md`'s Material-3 frontmatter without checking them against a rendered
  or sampled reference** — the diagnosis behind the first version of §1. The _hue family_ those
  values pointed at was right (confirmed by direct pixel sampling — see §1); Material-3 tiers are
  designed to sit close together (M3 carries elevation via shadow + tonal overlay, not
  background-step distance), and it turns out that's _also_ roughly how tight the actual Stitch
  mockups are, once measured. The mistake was reading the WCAG "flatter than the old theme"
  finding as proof the ladder itself needed fixing, rather than checking whether the reference
  mockups were that tight on purpose (they are) and looking for the missing definition elsewhere
  (the hairline, §2).

---

## 7. Refactor mapping table — `ink-*` / `amber-*` → daisyUI

**Status: this table reflects what actually shipped in `libs/web/admin`, not my original
proposal.** The concurrent refactor agent derived the muted-text rows (`ink-700`…`ink-300`) by
_measuring_ alpha composites against the new theme values rather than reasoning about roles by
eye, and those measured values are what landed. My original §7 (role-reasoned, not measured) was
wrong on every muted-text row — corrected below, with the derivation shown so the next agent
doesn't have to re-derive it.

`libs/web` currently uses raw `ink-*`/`amber-*` Tailwind utility classes (e.g. `bg-ink-900`,
`text-ink-300`). The table below is the structural (role-based) correspondence to daisyUI
semantic keys, derived from the fact that the _existing_ `operator` theme's `base-*`/`neutral*`/
`accent`/`primary` values were built by copying the `ink-*`/`amber-*` scale verbatim (confirmed
exact-hex matches below) — i.e. this mapping already exists implicitly and this table just makes
it explicit. `ink-*`/`amber-*` themselves are untouched (`operator` is out of scope), but the
_role_ each step plays is what the concurrent `libs/web/admin` refactor should target — resolving
through `operator-admin`'s (new) hex values, not `operator`'s old ones, wherever the admin shell
is what's being refactored. **`libs/web/members` must be built from this table as shipped — it is
the source of truth, not a parallel proposal.**

| Tailwind class | Hex       | daisyUI key                                  | Basis                                                                                                                                                                                                                                                                                        |
| -------------- | --------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ink-950`      | `#08090c` | `base-100`                                   | Exact match: `operator.base-100 = '#08090c'`                                                                                                                                                                                                                                                 |
| `ink-900`      | `#0e1015` | `base-200`                                   | Exact match: `operator.base-200 = '#0e1015'`                                                                                                                                                                                                                                                 |
| `ink-850`      | `#12141a` | `neutral`                                    | Exact match: `operator.neutral = '#12141a'`                                                                                                                                                                                                                                                  |
| `ink-800`      | `#171a21` | `base-300` (and `neutral-focus`)             | Exact match: `operator.base-300 = operator.neutral-focus = '#171a21'`                                                                                                                                                                                                                        |
| `ink-700`      | `#262a33` | `border-base-300` (no dedicated daisyUI key) | Sits one step above `base-300` in lightness; closest role is a raised-surface/divider border. No exact daisyUI slot — use as a border utility, not a fill. Not an opacity-of-`base-content` case (it's a surface/border tone, not text), so it wasn't part of the alpha remeasurement below. |
| `ink-600`      | `#3a3f4b` | `base-content/20`                            | **Shipped, measured** — see derivation below. (My original proposal, `/30`, was wrong.)                                                                                                                                                                                                      |
| `ink-500`      | `#5b616f` | `base-content/40`                            | **Shipped, measured.** (Original proposal `/50` was wrong.)                                                                                                                                                                                                                                  |
| `ink-400`      | `#8b92a1` | `base-content/60`                            | **Shipped, measured.** (Original proposal `/70` was wrong.)                                                                                                                                                                                                                                  |
| `ink-300`      | `#b7bdc9` | `base-content/80`                            | **Shipped, measured.** (Original proposal, `neutral-content`, was wrong on two axes — see below.)                                                                                                                                                                                            |
| `ink-100`      | `#e9ebef` | `base-content`                               | Exact match: `operator.base-content = '#e9ebef'` — **note:** in `operator-admin`/`operator-member`, `base-content` is now `#dce2f3`, not `#e9ebef` (§1); the admin refactor resolves `ink-100`→`base-content` through the _new_ admin value.                                                 |
| `amber-400`    | `#ffbb4d` | `accent`                                     | Exact match: `operator.accent = '#ffbb4d'`                                                                                                                                                                                                                                                   |
| `amber-500`    | `#f5a524` | `primary`                                    | Exact match: `operator.primary = '#f5a524'`                                                                                                                                                                                                                                                  |
| `amber-600`    | `#c97e0e` | `primary-focus`                              | Exact match: `operator.primary-focus = '#c97e0e'`                                                                                                                                                                                                                                            |

### Why `ink-300` is `base-content/80`, not `neutral-content`

My original proposal mapped `ink-300` → `neutral-content` on the strength of an exact hex match
(`operator.neutral-content = '#b7bdc9' = ink.300`). That match is real but the role is wrong:
`neutral-content` is the fill-role foreground _for `neutral`-colored surfaces_ (e.g. text sitting
on a `bg-neutral` chip), not a general muted-body-text color. Using it for ordinary muted text
means that text stops tracking `base-content` — the moment a theme changes `base-content` and
`neutral-content` independently (which `operator-admin`/`operator-member` already do — `#dce2f3`
vs `#b7bdc9`), muted body text visually decouples from the text color it's supposed to be a
quieter variant of. `base-content` **with an opacity modifier** is the correct mechanism: it's
definitionally always a percentage of the real text color, in every theme, forever, with no
separate hex to keep in sync.

### Alpha derivation (so it isn't re-derived by eye next time)

Composite-over-background opacity is computed as `α = (channel_fg − channel_bg) / (channel_full_fg − channel_bg)`
using the red channel (all four `ink-*` steps are near-neutral greys, so R/G/B track together
closely enough that channel choice doesn't move the rounded Tailwind step). Background is
`base-200` (`#151c27`, R=21) — the panel surface that muted text actually sits on — composited
toward `base-content` at full opacity (`#dce2f3`, R=220), span = 220 − 21 = **199**:

| `ink-*`   | Hex       | R   | α = (R − 21) / 199       | Nearest Tailwind opacity step                |
| --------- | --------- | --- | ------------------------ | -------------------------------------------- |
| `ink-600` | `#3a3f4b` | 58  | (58−21)/199 = **0.186**  | `/20`                                        |
| `ink-500` | `#5b616f` | 91  | (91−21)/199 = **0.352**  | `/40` (no `/35` on Tailwind's default scale) |
| `ink-400` | `#8b92a1` | 139 | (139−21)/199 = **0.593** | `/60`                                        |
| `ink-300` | `#b7bdc9` | 183 | (183−21)/199 = **0.814** | `/80`                                        |

**This ratio is base-hex-independent** — it holds for any `base-content`/`base-200` pair with the
same relative spacing, which is _why_ opacity modifiers on `base-content` are the right mechanism
here instead of fixed per-step hex keys: the tier reads correctly no matter which theme (or which
future ladder revision) it's rendered under, without re-deriving anything. This is the same reason
§1 recommends `text-base-content/60` over a hardcoded muted-text hex for the Stitch-observed
`#d7c3ae` — it was already the right call, just not yet backed by a measured table.

### `base-content/40` fails WCAG AA for body text — use it for glanceable metadata only

Measured against `base-200` (`#151c27`, the ladder's permanent value per §1's revert — this
number is now stable and won't move again unless the ladder itself changes) using the same
composite-then-contrast method as §1/§2: `base-content/40` composites to RGB(100.6, 107.2,
120.6), luminance `L=0.14675`, giving **3.18:1** against `base-200`'s `L=0.01197`. That clears
WCAG's 3:1 minimum for large text / UI components but fails the 4.5:1 minimum for normal body
text. By contrast, `base-content/60` composites to RGB(140.4, 146.8, 161.4), `L=0.28999`, giving
**5.49:1** against the same `base-200` — clears AA with real margin. This finding is unrelated to
and unaffected by the ladder widen-then-revert in §1 (`base-content/40`'s failure mode was
present before, during, and after the ladder experiment — it is fundamentally about that specific
opacity step, not about which `base-200` hex it happens to be measured against).

`ink-500`/`base-content/40` is nonetheless used today for content a user needs to read reliably
(the Overview screen's row timestamps, row context, and the `ro` read-only badge). Two ways to
resolve this, and the call here is the second one: raise those specific _usages_ to `/60`, rather
than raise what `/40` _means_. `/40` should be reserved for genuinely glanceable, low-priority
metadata (disabled-state icons, decorative dividers, placeholder ghosting) where failing to read
it costs nothing — not for anything a user is expected to actually read. This is a component-level
usage decision (which elements get which opacity class), not a token-semantics change, so it's
recorded here rather than acted on directly; `libs/web/admin`'s existing `/40` usages on
timestamps/badges should be audited and bumped to `/60` where the text is load-bearing.

---

## 8. Full theme objects (for reference — see `tailwind.config.js` for the applied version)

### `operator-admin` (revised)

```
primary #f5a524 · primary-focus #c97e0e · primary-content #08090c
secondary #34d399 · secondary-focus #10b981 · secondary-content #08090c
accent #ffbb4d · accent-focus #f5a524 · accent-content #08090c
neutral #151c27 · neutral-focus #232936 · neutral-content #b7bdc9
base-100 #0c141f · base-200 #151c27 · base-300 #19202c · base-content #dce2f3
info #38bdf8 · info-content #08090c
success #34d399 · success-content #08090c
warning #eab308 · warning-content #08090c
error #fb7185 · error-content #08090c
--surface-high #232936
--border-hairline #303849
```

### `operator-member` (new, dark)

Identical palette to `operator-admin` above (both are dark-ladder, same surfaces/semantics) —
scoped separately so the member shell (dashboard home, community feed, discussion threads,
course viewer) can diverge from the admin shell later without touching admin.

### `operator-member-light` (new)

```
primary #f5a524 · primary-focus #c97e0e · primary-content #08090c
secondary #34d399 · secondary-focus #10b981 · secondary-content #08090c
accent #ffbb4d · accent-focus #f5a524 · accent-content #08090c
neutral #f2f0ec · neutral-focus #e2ddd4 · neutral-content #1a1c22
base-100 #faf9f7 · base-200 #ffffff · base-300 #f2f0ec · base-content #1a1c22
info #38bdf8 · info-content #08090c
success #34d399 · success-content #08090c
warning #eab308 · warning-content #08090c
error #fb7185 · error-content #08090c
--surface-high #e2e2ea
--border-hairline #dcd6cb
```

Surface fills (`base-100/200/300`) are intentionally tight in both themes — see §1. Definition
comes from `--border-hairline`, tuned per theme in §2.

All three carry forward the existing `--rounded-box: 0.75rem`, `--rounded-btn: 0.5rem`,
`--rounded-badge: 999px`, `--animation-btn: 0.15s`, `--animation-input: 0.2s`,
`--btn-focus-scale: 1.0`, `--border-btn: 1px`, `--tab-border: 2px`, `--tab-radius: 0.5rem`
unchanged (§5).
