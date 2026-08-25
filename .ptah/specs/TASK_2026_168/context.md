# TASK_2026_168 — Navbar Redesign (Declutter & Consolidate)

## Type / Workflow

- **Type**: CREATIVE (frontend redesign of the landing-page top navigation)
- **Workflow**: ui-ux-designer (spec) → USER APPROVAL checkpoint → frontend-developer (impl) → visual-reviewer
- **Direction (user-chosen)**: **Declutter & consolidate**. Reduce the top row to essentials; tuck account actions into a user menu and socials + Community Forum into a clean grouped "Community" menu. Modern SaaS nav, fewer/clearer targets. NOT a mega-menu, NOT a keep-everything polish.

## The problem

`apps/ptah-landing-page/src/app/components/navigation.component.ts` currently crams ~12 targets into one row:
Features · Builders · Pricing · Docs · Download · Members · Profile · Logout · Discord · GitHub · ⋯(Community Forum/Reddit/LinkedIn) · **Download Ptah** CTA.
Community Forum is buried in the "⋯" overflow — the trigger for this redesign.

## Must-haves / constraints

- **Surface Community Forum** as a first-class destination (top-level or a clearly-labeled "Community" menu — not hidden in a nameless "⋯").
- **Auth-aware**: authenticated shows Members, Profile, Logout, Community Forum; unauthenticated shows Login + Sign Up. Preserve both states.
- **Community Forum link** is the one-click SSO deep-link `forumSsoUrl()` = `${communityUrl}/session/sso?return_path=%2F`, shown only when `isAuthenticated() && forumSsoUrl()` (communityUrl non-null). Keep this exact gating (target=\_blank, rel=noopener).
- Keep the **Download Ptah** primary CTA prominent.
- Existing entries to re-home (don't drop): Features, Builders, Pricing, Docs, Download(route), Members, Profile, Logout, Discord, GitHub, Reddit (r/ptah_coding), LinkedIn (showcase/ptah-coding-orchestra), Community Forum.
- Recommended consolidation: account actions (Profile, Logout) → a user avatar/menu; socials (Discord, GitHub, Reddit, LinkedIn) + Community Forum → a labeled "Community" menu; primary row = Product/Features, Pricing, Docs, Community, + Download CTA. Designer may refine grouping but must justify.
- **Responsive**: desktop bar + mobile hamburger menu (the component already has both; the mobile menu already lists Community Forum at its own entry — keep mobile clean too).

## Standards (Ptah Angular)

- Angular 21 standalone, `ChangeDetectionStrategy.OnPush`, signals + `computed()` + `inject()`.
- Tailwind 3 + daisyui 4 `operator` theme; lucide-angular icons. Brand tokens: amber `#f5a524` accent (hover `#c97e0e`), ink dark surfaces (`ink-950 #08090c` … `ink-800 #171a21`), text `white/80`, focus-visible amber outline (already the pattern in the file).
- No `[innerHTML]`. Keep existing signals/handlers (`isAuthenticated`, `handleLogout`, `communityMenuOpen`/`toggle`/`close`, `forumSsoUrl`, mobile menu state) — extend/rename as needed but preserve behavior.
- Accessibility: proper `aria-expanded`/`aria-haspopup`/`role="menu"`, keyboard nav, focus-visible states (match current), close-on-outside-click / Escape for menus.
- Keep initial bundle lean; no new heavy deps (lucide + tailwind only).

## Deliverable (ui-ux-designer)

`.ptah/specs/TASK_2026_168/navbar-design-specification.md` — concrete spec: final IA (exact top-level items + what goes in the user menu vs community menu), desktop + mobile layouts (ASCII/structure), visual states (default/hover/active/focus/open), auth-state variants, a11y behaviors, and a component-structure plan the frontend-developer can implement directly against the existing `navigation.component.ts`. Reference exact brand tokens/classes already in the file.
