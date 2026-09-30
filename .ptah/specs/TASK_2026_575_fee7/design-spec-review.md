# Design Spec Review - TASK_2026_575_fee7 (Gate 1.7)

| Field | Value |
| --- | --- |
| Artifacts reviewed | `design-spec.md` (rev 2), `prototype/README.md`, `prototype/index.html`, `prototype/tokens.css`, `prototype/tailwind-build.css`, `prototype/fonts/fonts.css`, `prototype/screenshots/*.png` (12) |
| Author | ui-ux-designer (subagent) |
| Reviewer | independent document reviewer (subagent) |
| Execution sides | author: subagent; reviewer: subagent. Same-side review: no CLI lanes (ptah_agent_* tools) available in this cloud session |
| Reviewed revision | 2 |
| Rounds completed | 2 (final round under the revise cap) |
| Verdict | **APPROVED**: 0 blocking open. All of B1-B7 and N1-N21 are resolved. 2 new non-blocking notes (N22, N23) go to the architect |
| Unresolved items | N22, N23 (non-blocking, for the architect/developer). User decisions still pending at Gate 1.7: numbering system (spec 3.7) and legal governing-language notice (spec 3.8) |

Baseline: `task-description.md` rev 1 (Gate 1 approved) and `context.md` Gate 0 decisions. Parity inventory not required (additive switcher).

Round 2 method:
- Re-read spec 2.4, 2.5, 2.6, 3.2, 3.6, 5 and 7 ("Review responses (revision 2)").
- Viewed the new `admin-header-375-{en,ar}.png` and the re-rendered `full-*-375.png`.
- Grepped the prototype for the round-2 fixes.

## 1. Requirement traceability (rev 2)

| Req | Spec section | Status |
| --- | --- | --- |
| 3.1 switch in place | 3.9, 2.2-2.4 | Met |
| 3.3 first-visit detection | 3.9 (silent) | Met |
| 3.6 pre-paint / font start | 3.6 "Loading constraint" | Met |
| 3.8 switcher a11y | 2.2, 2.3, 2.4, 2.5, 2.5a, 2.6 | Met |
| 4.1 logical conversion | 3.1, `start-0` in 2.2 | Met |
| 4.2 icon mirroring | 3.2 | Met |
| 4.3 LTR islands | 3.3 | Met; confirmed in screenshots |
| 4.4 UGC direction | 3.4 | Met |
| 4.5 animated sections | 3.5 (19 rows plus the `overflow-x` QA caveat) | Met |
| 4.6 Arabic font / Latin Inter | 3.6 | Met; compiled stack is Inter first, confirmed in screenshots |
| 5.2 numbering | 3.7 `[DECISION]` | Met; clearly the user's decision |
| 6.1 do-not-translate | 3.9 | Met |
| 8.4 legal notice | 3.8 `[DECISION]` | Met; clearly the user's decision |
| Open questions | 4 | Met |

## 2. Finding status (all rounds)

| # | Round raised | Status | Evidence (round 2 check) |
| --- | --- | --- | --- |
| B1-B6 | 0 | Resolved (round 1) | Unchanged in rev 2 |
| N1-N15 | 0 | Resolved (round 1) | Unchanged in rev 2 |
| **B7** 375px panel-header fix was prototype-only | 1 | **Resolved** | See details below |
| N16 rotated chevron | 1 | Resolved | 3.2:617, conditional `[class.rtl:rotate-90]="isCollapsed(...)"` next to the existing `-rotate-90`. See N22 for a syntax caveat |
| N17 made-up `focus-ring-panel` class | 1 | Resolved | 2.4:374,384 and 2.5:435 use the literal `focus-visible:outline-base-content`. It exists in the compiled build (`tailwind-build.css:2648`) and sits in the utilities layer, after `.btn-primary`. Prototype uses it on 5 elements |
| N18 Up/Down keys | 1 | Resolved | 2.6:509-529, and prototype `index.html:491-492`. Header-menu arrow-key debt is recorded as a follow-up (2.6:541-550) |
| N19 extrabold override hit Latin runs | 1 | Resolved | 3.6:790-816 replaced with `[lang='ar'] { font-synthesis-weight: none }`, also in `tokens.css:55`. Arabic resolves to Plex 700 with no synthesis; Latin keeps Inter 800 |
| N20 icon counts, Send/Reply not icons | 1 | Resolved | 3.2:612,614,618 and 5:947. The counts 38 and 10 match my grep, and the `Send`/`Reply` row is removed |
| N21 weights traceability row | 1 | Resolved | 5:945 |

B7 details:
- Spec 2.4:282-336 now gives the full normative `panel-layout.html` `<header>`:
  - `flex-wrap` on the outer header;
  - `min-w-0` on the left cluster and `truncate` on the `h1`;
  - `shrink-0 whitespace-nowrap` on the badge;
  - `flex-wrap justify-end` on the control cluster;
  - an email truncation span for `member-layout.html:22` and `admin-layout.html:21`.
- The email span is a flex item of the projected cluster, so `max-w-[7rem]` applies.
- Screenshots:
  - `full-{en,ar}-{dark,light}-375.png` show the member shell as two clean rows. "Ptah Builders" stays on one line, "Cohort 4" / "الدفعة 4" stays on one line, and the email ends in an ellipsis.
  - `admin-header-375-{en,ar}.png` show "Admin Dashboard" / "لوحة تحكم المشرف" with the `Restricted` / "مقيّد" badge on one row, and the email plus switcher on the second.
  - Nothing is clipped and there is no overflow in either direction.
  - The AR crops are correctly mirrored: the switcher sits at inline-end and the email is an LTR island.

## 3. New non-blocking notes (round 2, for the architect/developer; do not gate approval)

- **N22** `design-spec.md:617`: `[class.rtl:rotate-90]` depends on Angular accepting a colon in a `[class.x]` binding name. Tailwind will still find the class in the source. When implementing, confirm it compiles. If it does not, use the equivalent `[ngClass]="{ 'rtl:rotate-90': isCollapsed(group.label) }"`. The intent is the same.
- **N23** `design-spec.md:328-335`: the prose says "a `title` attribute … still carries the full address", but the normative email span has no `title`. Screen readers still read the full text, so this is not an accessibility failure. For sighted users, add `[title]="email"` to the truncated span, as `member-layout.html:48` already does in the sidebar footer.

## 4. Verdict

**APPROVED.** There are no blocking findings, and every design-relevant requirement traces to a spec section, backed by verified code references and correct screenshots in RTL and LTR, dark and light, at 375 and 1440. Remaining items:

- **For the user at Gate 1.7:** the numbering system (designer recommends Western `0-9`, spec 3.7) and the legal governing-language notice ("English governs" draft or equally binding Arabic, spec 3.8). Both are clearly marked `[DECISION]` and not pre-decided.
- **For the architect/developer:** N22 and N23.
