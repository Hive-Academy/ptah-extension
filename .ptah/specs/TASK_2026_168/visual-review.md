# Visual Review - TASK_2026_168 (Navbar Redesign: Declutter & Consolidate)

## Scope note

This review was scoped by the orchestrator to a **targeted audit**, not a full generic 6-viewport sweep: the orchestrator had already live-verified the unauthenticated/authenticated bar renders, the Community▾ panel order/gating, and the dev build. My job was to (a) verify spec compliance at the code level for what wasn't eyeballed, (b) rigorously check accessibility/keyboard behavior, (c) live-test the mobile sheet, and (d) hunt regressions. I supplemented code review with live browser testing (desktop 1440x900 + mobile 375x812, dev server at `http://localhost:4200`) wherever it added real confidence beyond static reading — including scripted DOM assertions for Escape/outside-click/mutual-exclusion, not just screenshots.

## Review Summary

| Metric                                          | Value                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Overall Score                                   | 8/10                                                                                      |
| Assessment                                      | APPROVED-WITH-NITS                                                                        |
| Must-Fix Issues                                 | 0                                                                                         |
| Serious Issues                                  | 0                                                                                         |
| Moderate/Polish                                 | 2                                                                                         |
| Pre-existing (noted, not caused by this change) | 1                                                                                         |
| Viewports Tested                                | 2 targeted (375x812 mobile, 1440x900 desktop)                                             |
| Screenshots Taken                               | 4 (saved under `.ptah/specs/TASK_2026_168/screenshots/`)                                  |
| Live DOM Assertions                             | 5 (Escape, outside-click, mutual exclusion, aria-expanded states, unauth bar composition) |

## Testing Environment

- Dev server: `http://localhost:4200` (already running)
- Browser: Ptah MCP browser (Chromium, headless)
- File under review: `apps/ptah-landing-page/src/app/components/navigation.component.ts` (single file, 933 lines post-change; diff: +365/-202)
- Screenshots: `desktop-product-menu-open.png`, `mobile-bar-closed.png`, `mobile-sheet-unauth.png`, `mobile-bar-authenticated.png` (this last one came from a _stale authenticated browser session_ left over from a previous task run — see note below, not from anything I logged into)

## 1. Spec compliance (code-level) — PASS

Verified directly against `navbar-design-specification.md` §1–§7 and the current file:

- **Product▾** (lines 101-153): `left-0 w-40` panel, icon-less `Features`/`Builders` text items — matches §2/§7 exactly. Live screenshot confirms trigger turns amber and chevron flips to `rotate-180` while open.
- **User▾** (lines 355-452): Members → Profile → divider (`h-px bg-white/10 my-1`, line 434) → Logout (`hover:text-red-400`, line 439). Matches §2/§4 divider spec (`my-1` tightened per spec) and red-hover semantics exactly.
- **Community Forum gating** (lines 210-226): `@if (isAuthenticated() && forumSsoUrl(); as forumUrl)` with `target="_blank" rel="noopener noreferrer"` (lines 213-214) — exact match to §5's "gated by `isAuthenticated() && forumSsoUrl(); as forumUrl`" clause. Live-confirmed: with no auth cookie, the Community panel renders only Discord/GitHub/Reddit/LinkedIn (Forum absent, not hidden-but-rendered) — matches §1's explicit "gating preserved, not just hidden-but-rendered" requirement.
- **Standalone "Download" text link**: confirmed retired. Grepped the rendered desktop bar (both stale-authenticated and clean-unauthenticated live DOM dumps) — only one Download-labelled element exists in each: the CTA. No orphaned second link.
- **Single tri-state signal**: `openMenu = signal<'product' | 'community' | 'user' | null>(null)` (lines 805-807), `toggleMenu()` (899-901), `closeMenu()` (908-918). Grepped the whole `ptah-landing-page` app for `communityMenuOpen|toggleCommunityMenu|closeCommunityMenu|MoreHorizontal` — zero hits. Fully removed, no dead references anywhere in the app.

## 2. Accessibility (§5) — PASS, with one behavior worth a design gut-check

- All three triggers are `<button type="button">` with `aria-haspopup="menu"`, `[attr.aria-expanded]`, `aria-controls` (product: lines 103-124, community: 179-200, user: 357-394). Live DOM confirmed Angular correctly stringifies these to `aria-expanded="true"`/`"false"` (not a boolean attribute-presence bug).
- Panels: `role="menu"` + `aria-labelledby` matching each trigger's `id` (product: 130-131/105, community: 206-207/181, user: 400-401/359) — all IDs cross-reference correctly.
- Items: `role="menuitem"` on every link/button inside all three panels — confirmed.
- User trigger: `aria-label="Account menu"` present (line 364), correctly omitted on Product/Community since they have visible text labels — exactly matches spec's stated rationale.
- Focus-visible ring (`focus-visible:outline-2 outline-amber-400 outline-offset-2`) present on all three triggers and every menu item, including the Logout button (line 439) and the avatar button (line 360).

**Escape + outside-click — live-verified with scripted DOM assertions, not just read from code:**

- Opened Community▾, dispatched a synthetic `Escape` keydown on `document` → `aria-expanded` flipped to `"false"`, panel removed from DOM, **and `document.activeElement` was confirmed to be `#community-menu-trigger`** — exact match to spec §5's "Escape... returns focus to that menu's trigger button."
- Opened Community▾ again, clicked an unrelated `<h1>` on the page → panel closed (`aria-expanded="false"`, panel removed) with no focus assertion needed since spec doesn't require focus preservation here — confirmed outside-click works.
- Opened Product▾, then clicked Community▾'s trigger → Product closed (`aria-expanded="false"`, panel removed), Community opened — mutual exclusion via the single `openMenu` signal confirmed live, not just by reading `toggleMenu()`.

**Worth flagging (not a compliance defect — implementation matches spec's literal text, but worth a design sanity-check):** `closeMenu()` (lines 908-918) is reused by both the Escape handler _and_ every menu-item `(click)` (e.g. lines 138, 147, 217, 235, 257, 279, 301, 408, 423, 441) — this is exactly what §7's component-structure plan specifies ("closeMenu()... Used by: menu-item (click), Escape handler..."). I live-verified the consequence: clicking "Discord" inside the Community panel closes the menu _and_ snaps `document.activeElement` back to `#community-menu-trigger` (confirmed via script), the same as the Escape path. For a mouse click this is invisible. For a keyboard user who tabs to "Features" (an in-page anchor, not an external link) and presses Enter, focus will forcibly jump back onto the "Product" trigger button immediately after navigating, rather than settling anywhere near the section that just came into view. This is spec-compliant as written, so I'm not marking it a defect, but it's a real, testable UX wrinkle for keyboard/screen-reader users on the two in-page anchor items specifically (Features/Builders) — worth a quick product call on whether that's desired before calling the a11y pass fully done.

The implementation team made one **good, documented deviation** from the literal spec text here: `onDocumentClick()` (lines 927-931) does _not_ route through `closeMenu()` — it sets `openMenu.set(null)` directly, skipping the trigger-refocus step. Spec §7 literally says the outside-click handler should "call `closeMenu()`," which — if followed literally — would steal focus back to an invisible trigger button every time a user clicks anywhere else on the page (e.g., into a different form field), a real bug. The implementation's own summary (`frontend-implementation.md` line 32) documents this choice explicitly ("clears `openMenu` without stealing focus, so clicking page inputs isn't disrupted"). This is the right call and I'd leave it as-is.

## 3. Mutual exclusion — PASS (live-verified, see above)

Single signal confirmed via scripted assertion, not just code reading: opening Community while Product was open cleanly closed Product and opened Community with correct `aria-expanded` states on both.

## 4. Mobile sheet — PASS

Live-tested at 375x812 with a clean (no-cookie) session. Screenshot `mobile-sheet-unauth.png` and DOM dump both confirm:

- Order: Features, Builders, Pricing, Docs → divider → Login, Sign Up (unlabeled, per §3's explicit "no ACCOUNT label needed for 2 plain auth links") → divider → **COMMUNITY** label (`text-white/40 uppercase tracking-wide`, line ~601) → Discord, GitHub, Reddit, LinkedIn (Community Forum correctly absent, unauthenticated) → divider → full-width `Download Ptah` CTA as the final row.
- No redundant plain "Download" row anywhere in the mobile sheet — confirmed by DOM text dump (`Download Ptah` appears exactly once).
- No horizontal overflow, no clipped text, no overlapping elements at 375px width. Sheet content fits comfortably within the 812px viewport height without requiring scroll.
- Note: I could not live-test the **authenticated** mobile sheet (ACCOUNT section with Members/Profile/Logout) since I don't have a login flow available in this session — per the task's own caveat, this was assessed from code only (§3's mockup vs. lines 522-574: `@if (isAuthenticated())` branch renders `ACCOUNT` label, Members, Profile, Logout in that exact order, matching spec).

## 5. Visual consistency — PASS

- No new hex values or Tailwind colors introduced anywhere in the diff — confirmed by reading the full file: every new class uses `amber-500`/`amber-400`, `ink-800`/`ink-950`, `white/10`/`40`/`70`/`80`, `slate-950/95`, `red-400`, all pre-existing in the file's token vocabulary.
- Dropdown panel styling (`border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5`) is identical across all three menus (Product left-0/w-40, Community/User right-0/w-48) — matches spec's "identical to current Community panel" instruction. Live screenshot of the open Product panel confirms visually.
- Avatar badge (`w-9 h-9 rounded-full bg-ink-800 border border-white/10 text-white/80`, line 375) matches spec §4/§6 Option A exactly, including the documented Option B follow-up comment (lines 367-373).
- Active-state bindings: Pricing (`routerLinkActive="text-amber-500"` + exact option, lines 158-159), Download CTA (`routerLinkActive="bg-amber-400"`, line 342), avatar ring (`accountSectionActive` computed at lines 822-825, checking `/profile`/`/members` prefix) all match spec token table §4 verbatim.

## 6. Regressions — PASS

- Scrolled-state bar styling (`bg-transparent` vs `bg-ink-900/90 backdrop-blur-md shadow-lg border-b border-ink-700`, lines 59-63) — untouched by the diff, confirmed present and live-rendering `bg-transparent` at page top.
- `handleLogout()` (858-871), `toggleMobileMenu()`/`closeMobileMenu()` (884-893), `onScroll()` (876-879) — all unchanged, confirmed via diff (no changes to these method bodies) and via the host binding list still containing `'(window:scroll)': 'onScroll()'` alongside the two new listeners.
- Removed `MoreHorizontal` import (no longer used) — confirmed no leftover reference anywhere in the app via grep.

## Component Testing Results

| Component  | Trigger semantics                        | Panel a11y                 | Open/close                                                                                                     | Focus mgmt                                                         | Verdict                                                       |
| ---------- | ---------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Product▾   | button + aria-haspopup/expanded/controls | role=menu, aria-labelledby | mutual excl. confirmed live                                                                                    | Escape returns focus (live-confirmed on Community, same code path) | PASS                                                          |
| Community▾ | same                                     | same                       | confirmed live                                                                                                 | Escape returns focus (live-confirmed), outside-click confirmed     | PASS                                                          |
| User▾      | button, aria-label="Account menu"        | same                       | not directly live-tested (unauth session has no User trigger rendered) — code identical to Community's pattern | code review only                                                   | PASS (by code parity with Community, which was live-verified) |

## Design System Compliance

No new tokens. All colors/spacing pulled from the file's existing Tailwind utility vocabulary, per spec §4's "no new hex values, no new Tailwind colors" mandate.

## Accessibility Visual Audit

| Check                                                             | Status               |
| ----------------------------------------------------------------- | -------------------- |
| `aria-haspopup`/`aria-expanded`/`aria-controls` on all 3 triggers | PASS                 |
| `role="menu"` + `aria-labelledby` on all 3 panels                 | PASS                 |
| `role="menuitem"` on all items                                    | PASS                 |
| Focus-visible ring on every new interactive element               | PASS                 |
| Escape closes + returns focus to trigger                          | PASS (live-verified) |
| Outside-click closes                                              | PASS (live-verified) |
| Mutual exclusion (only one menu open)                             | PASS (live-verified) |
| User trigger `aria-label` (avatar-only, no visible text)          | PASS                 |

## Verdict

**Recommendation**: APPROVE (with two non-blocking notes for follow-up)
**Confidence**: HIGH — backed by live scripted DOM assertions for the riskiest behaviors (Escape/outside-click/mutual-exclusion), not just static code reading.
**Key Concern** (non-blocking): `closeMenu()`'s trigger-refocus is shared between Escape and ordinary menu-item clicks (exactly as spec's §7 literally specifies), which live-testing confirms causes focus to snap back to the Product/Community/User trigger button immediately after any menu-item activation — most noticeable for the two in-page anchor items (Features/Builders) where a keyboard user's focus lands back on the trigger instead of near the revealed section. This is spec-compliant, not a bug, but worth a quick product/design confirmation that it's the intended behavior long-term.

## Non-blocking notes for follow-up (not scored against this task)

1. `closeMenu()` reused for menu-item clicks causes a focus-snap-back to the trigger after every menu selection (see §2 above) — confirm intended, or scope the trigger-refocus to the Escape path only in a follow-up.
2. Mobile "Logout" row uses `text-white/60` as its base text color while Members/Profile use `text-white/80` (lines 563/601 area) — this is a **pre-existing** inconsistency (confirmed via diff: the old code already had `text-white/60` for Logout before this task), not introduced by this redesign. Not this task's responsibility to fix, flagging only for completeness.

## What Pixel-Perfect Would Look Like

Identical to the current implementation, plus: (a) a documented, deliberate decision on whether menu-item-click focus-return should differ from Escape's focus-return (currently they're identical by design per spec, which is defensible but worth a sign-off), and (b) the pre-existing mobile Logout opacity inconsistency cleaned up in a separate small pass. Everything else — token reuse, ARIA wiring, gating logic, mutual exclusion, mobile regrouping — already matches the approved spec faithfully and held up under live interaction testing, not just a read-through.
