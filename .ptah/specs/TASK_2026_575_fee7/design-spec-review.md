# Design Spec Review - TASK_2026_575_fee7 (Gate 1.7)

| Field | Value |
| --- | --- |
| Artifacts reviewed | `design-spec.md` (rev 1), `prototype/README.md`, `prototype/index.html`, `prototype/tokens.css`, `prototype/tailwind-build.css`, `prototype/fonts/fonts.css`, `prototype/screenshots/*.png` (10) |
| Author | ui-ux-designer (subagent) |
| Reviewer | independent document reviewer (subagent) |
| Execution sides | author: subagent; reviewer: subagent. Same-side review: no CLI lanes (ptah_agent_* tools) available in this cloud session |
| Reviewed revision | 1 |
| Rounds completed | 1 |
| Verdict | **REVISE**: 1 blocking open (B7, new); B1-B6 resolved; 6 non-blocking open (N16-N21, new); N1-N15 resolved |
| Unresolved items | B7 (blocking), N16-N21 (non-blocking) |

Baseline: `task-description.md` rev 1 (Gate 1 approved) and `context.md` Gate 0 decisions. Parity inventory not required (additive switcher).

For this round I re-read `design-spec.md` rev 1 in full, including section 6 "Review responses". I viewed all 10 screenshots and re-verified each claim against the code:

- `navigation.component.ts`
- `panel-layout.html`
- `member-layout.html` / `admin-layout.html`
- `problem-section.component.ts:199-213`
- `device-frame.component.ts:39,74`
- `waitlist-form.component.ts:108`
- `terms-page.component.ts:45-56`
- the compiled `tailwind-build.css`

## 1. Requirement traceability (rev 1)

| Req | Spec section | Status |
| --- | --- | --- |
| 3.1 switch in place | 3.9 map, 2.2-2.4 | Met |
| 3.3 first-visit detection | 3.9 (silent, no banner) | Met |
| 3.6 pre-paint / font start | 3.6 "Loading constraint" | Met |
| 3.8 switcher a11y | 2.2, 2.3, 2.4, 2.5, 2.5a, 2.6 | Met. Residual implementation notes in N17 and N18 |
| 4.1 logical conversion | 3.1 policy, `start-0` in 2.2 | Met |
| 4.2 icon mirroring | 3.2 | Met. Rotated-chevron fix is mis-specified (N16) |
| 4.3 LTR islands | 3.3 (confirmed in screenshots: CLI block, email, `$29`/`$290`) | Met |
| 4.4 UGC direction | 3.4 | Met |
| 4.5 animated sections | 3.5 (19 rows incl. `problem-section`, and the `overflow-x` QA caveat) | Met |
| 4.6 Arabic font / Latin Inter | 3.6 stack `['Inter','IBM Plex Sans Arabic',…]` (confirmed in the compiled CSS, `tailwind-build.css:173,2418`, and in screenshots) | Met. Weight-mapping side effect in N19 |
| 5.2 numbering | 3.7 `[DECISION]`, including dates via `ar-u-nu-latn` | Met; clearly the user's decision |
| 6.1 do-not-translate | 3.9 | Met |
| 8.4 legal notice | 3.8 `[DECISION]`, operator-native card idiom | Met; clearly the user's decision |
| Open questions | 4 | Met |

## 2. Screenshot verification (B1 recheck)

All 10 PNGs now render the compiled Tailwind 3.4.18 + DaisyUI 4.12.24 build with self-hosted fonts.

- `full-ar-*-1440.png`: nav, panel header, hero, pricing card and CLI section are all correctly mirrored.
  - The logo sits at inline-start (right) and the CTA cluster at inline-end (left).
  - Arabic renders in IBM Plex Sans Arabic, and Latin runs ("SaaS", "Ptah", "Builders", "PRD") stay in Inter.
  - `$29` and `$290` stay LTR with Western digits. The badge now reads "الدفعة 4" (Western digit).
  - The CLI `<pre>` is an LTR, left-aligned island aligned to inline-start.
  - Arrows are flipped (`←` next to "ابدأ الآن").
  - The centred glow does not move.
- `full-ar-*-375.png`: no horizontal clipping and no page overflow. The panel header, however, wraps to three rows (see B7).
- `full-en-*`: unchanged LTR baseline.
- Dark vs light: only the member shell changes theme (`operator-member-light`). This is correct, because public and admin are dark-only in `tailwind.config.js`.
  - The light panel switcher reads clearly: the selected state is amber with a check mark, and inactive is muted.
- `header-menu-open-en-1440.png` / `-ar-1440.png`:
  - In EN, the menu anchors at the trigger's inline-start, with the check mark on the current option.
  - In AR, the menu opens toward the left from the trigger's right edge (`start-0` correct in RTL). The `English` item stays LTR inside it.

## 3. Round-0 findings: disposition

| # | Status | Evidence |
| --- | --- | --- |
| B1 screenshots not rendering | **Resolved** | See section 2 |
| B2 panel options labelled EN/AR | **Resolved** | 2.4:298-316 `aria-label` "EN — …: English" / "AR — …: العربية" with the option's own `lang` |
| B3 keyboard/ARIA not implementable | **Resolved** | See details below |
| B4 light focus ring 1.68:1; unmeasured claims | **Resolved** | 2.5 panel ring is `base-content`; 2.5a measured table (13.21:1 / 17.03:1). Figures spot-checked. Implementation caveat in N17 |
| B5 `problem-section` missing | **Resolved** | 3.5:560, verified against `problem-section.component.ts:199-213,86-197` |
| B6 font stack dropped Inter | **Resolved** | 3.6:646-658. Compiled CSS and screenshots confirm |
| N1 physical `left-0` | Resolved | 2.2:165 `start-0` |
| N2 placement wording | Resolved | 2.2:97-109, matches `navigation.component.ts` order |
| N3 panel order | Resolved | 2.4:265-287, switch after `<ng-content>`, adjacent to the theme toggle |
| N4 marquee contradictory | Resolved | 3.5:557, one decision, `buildMarquee()` cited |
| N5 tug-meter labels | Resolved | 3.5:559, whole meter in a `dir="ltr"` island, marker exemption reason corrected |
| N5a missing rows | Resolved | 3.5:563-566 and the `overflow-x` note at :576-583. Cited lines verified |
| N6 tracking override | Resolved | 3.6:672 descendant `:where(...)` selector |
| N7 weight set | Resolved | 3.6:587-592, 686-694. See N19 for a side effect |
| N8 icon list | Resolved in substance | Rotated chevron and `→`/`←` characters now covered. See N16 and N20 |
| N9 legal notice tokens | Resolved | 3.8:739-747, matches `terms-page.component.ts:45-56` |
| N10 numbering incl. dates | Resolved | 3.7:713-721. Prototype digits are now Western |
| N11 Label-in-Name, `btn-xs` | Resolved | 2.2:122, 2.4:300/310, `btn-sm` |
| N12 color-only selected state | Resolved | Check icon on the selected segment (visible in screenshots) |
| N13 key ownership | Resolved | 2.7 single `common.language` key in the `libs/web/ui` scope, host lib per skin |
| N14 traceability / first-visit | Resolved | 3.9 |
| N15 invented operator tokens | Resolved | `tokens.css` no longer defines them; they come from the DaisyUI build |

B3 details:
- The header skin now uses the sibling menus' Tab-only pattern, with a new `selectLanguage()` that refocuses the trigger (2.2:186-202, 2.6:389-411); snippet and prose agree.
- The panel skin has roving `tabIndex` plus a direction-aware keydown handler (2.6:412-447).
- The mobile row is `group`/`menuitemradio`, valid inside `role="menu"` (2.3:217-242).

## 4. New findings (round 1)

### Blocking

**B7. The mobile-width panel-header fix exists only in the prototype.**
- Adding the switcher overflows the shared panel topbar at 375px. Section 6's B1 response (`design-spec.md:849-851`) says the prototype fixed this with `flex-wrap` and email truncation (`prototype/index.html:157,159`: `flex flex-wrap … justify-end` and `truncate max-w-[7rem] sm:max-w-none`).
- The spec's normative markup for `panel-layout.html` (2.4:268-273) still shows `<div class="flex items-center gap-2 …">`, with no wrap and no truncation. The member and admin projections (`member-layout.html:22-24`, `admin-layout.html:20-23`) have no truncation either.
- An implementer following the spec would reproduce the overflow the designer found.
- The prototype's own result is also rough: `full-*-375.png` shows the header as three rows, "Ptah Builders" wrapping onto two lines, and the cohort badge wrapping into a two-line blob.
- Fix: put the 375 behaviour into 2.4 as a normative rule, for example:
  - `flex-wrap justify-end` on the control cluster;
  - an email truncation class on the member and admin email spans, or hiding the email below `sm` (the `aria`/`title` already carries it);
  - `whitespace-nowrap` on the badge.
- Add a 375px shot of the admin shell (title "Admin Dashboard" + `Restricted` badge + email + switcher). No theme toggle there, but the title is longer.

### Non-blocking

- **N16** `design-spec.md:514`: the fix for the rotated chevron is wrong as written.
  - A static `rtl:rotate-90` class applies whenever the page is RTL, including the expanded state, where there is no `-rotate-90`. Under RTL the expanded chevron would then point sideways instead of down.
  - The two classes do not "combine"; both write the same `--tw-rotate`, and the `rtl:` variant wins.
  - Fix: bind it conditionally, e.g. `[class.rtl:rotate-90]="isCollapsed(group.label)"` next to `[class.-rotate-90]` (`panel-layout.html:95`).
- **N17** `design-spec.md:302,312,331`: `focus-ring-panel` is a made-up class name in normative markup.
  - DaisyUI's `.btn-primary` sets `outline-color: primary` (`tailwind-build.css:1311-1315`), and the checked radio is the tab stop.
  - If the class is later defined in the components layer, the amber outline can win and bring back the 1.68:1 failure in `operator-member-light`.
  - Write the literal utilities in the snippet (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content focus-visible:outline-offset-2`); the utilities layer beats `.btn-primary`.
- **N18** `design-spec.md:426-436`: the panel keydown handler handles only `ArrowLeft`/`ArrowRight`. APG radio groups also move on `ArrowUp`/`ArrowDown`, and round 0 of this spec listed them. Add them, direction-independent: Down = next, Up = previous. Also note that the header skin keeps `role="menu"` without arrow keys. That matches the three sibling menus, so it is existing debt rather than new, but it is worth a follow-up ticket.
- **N19** `design-spec.md:686-694`: `[lang='ar'] .font-extrabold { font-weight: 700 }` also drops Latin runs in the same element to 700. For example, "SaaS" in the Arabic hero loses Inter 800. The claim that "Latin text inside the same element is unaffected" is incorrect.
  - Option: use `font-synthesis-weight: none` under `[lang='ar']` instead. Arabic glyphs then render at Plex 700 and Latin keeps true Inter 800.
  - Otherwise, drop the unaffected claim.
- **N20** `design-spec.md:508,510,511,825`: the icon counts still do not reproduce.
  - `grep -rowE 'ArrowRight|ArrowLeft|ChevronRight|ChevronLeft' libs/web --include=*.ts` gives **38**, not 66. `ExternalLink` gives 10, not 12.
  - `Send` and `Reply` are **not lucide icons** in this codebase. Every hit is copy text ("Send Message", "Reply"). My round-0 N8 wrongly listed them as icons, so the reviewer error carried through.
  - Drop those two rows, or reword them as "if introduced later", and correct the counts.
- **N21** `design-spec.md:823`: traceability still says the Arabic weights "match the Inter weight set", which contradicts 3.6's corrected five-vs-four statement. Update the row.

## 5. Required for next round

Resolve B7 by making the 375px panel-header rule normative in 2.4, and add an admin-shell 375px screenshot. N16-N21 are one-line edits; N16 and N17 are recommended before architecture because they change normative markup. The two `[DECISION]` items (numbering system, legal governing language) are correctly left with the user.
