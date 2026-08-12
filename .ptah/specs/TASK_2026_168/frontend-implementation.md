# TASK_2026_168 — Frontend Implementation Summary

**Component**: `apps/ptah-landing-page/src/app/components/navigation.component.ts` (single standalone component, desktop bar + mobile sheet)
**Build**: `npx nx build ptah-landing-page --configuration=development` — **SUCCEEDED** (bundle generation complete, ~10s, initial total 2.95 MB unchanged surface).
**Spec followed**: `navbar-design-specification.md` (user-approved) — implemented faithfully.

---

## What changed

### Information architecture (desktop top row)

Consolidated from ~12 flat targets to the approved set:

- **Product ▾** disclosure (`left-0 w-40` panel): Features, Builders (icon-less text items, `routerLink="/"` + `fragment`).
- **Pricing** direct link — `routerLinkActive="text-amber-500"` + `[routerLinkActiveOptions]="{ exact: true }"`.
- **Docs** direct external link (`docs.ptah.live`, `_blank rel="noopener noreferrer"`).
- **Community ▾** disclosure (`right-0 w-48` panel), labeled (replaces the old nameless `⋯`): **Community Forum FIRST** (gated `@if (isAuthenticated() && forumSsoUrl(); as forumUrl)`, one-click SSO deep-link, `target="_blank" rel="noopener noreferrer"` — behavior unchanged), then Discord, GitHub, Reddit, LinkedIn (existing inline SVGs reused verbatim).
- **Download Ptah** CTA — kept, `routerLinkActive="bg-amber-400"`. The redundant standalone "Download" text link was retired (CTA already points at `/download`).
- **User ▾** avatar menu (authenticated only, `right-0 w-48`): Members, Profile, `h-px bg-white/10 my-1` divider, Logout (red-hover).
- **Unauthenticated**: Login + Sign Up remain inline before the CTA, styling unchanged. No user menu rendered.

### State model (single tri-state signal)

- Removed `communityMenuOpen`, `toggleCommunityMenu()`, `closeCommunityMenu()`.
- Added `openMenu = signal<'product' | 'community' | 'user' | null>(null)` — drives all three panels; mutual exclusion is free.
- Added `toggleMenu(menu)` (toggle-with-exclusivity via `update`) and `closeMenu()`.
- Added `accountSectionActive = computed(() => router.url.startsWith('/profile') || startsWith('/members'))` (injected `Router`) — rings the avatar.
- Preserved unchanged: `scrolled`/`onScroll`, `mobileMenuOpen`/`toggleMobileMenu`/`closeMobileMenu`, `isAuthenticated`, `forumSsoUrl`, `handleLogout`, `checkAuthState`.

### New behaviors (§7) — previously absent

- Injected `ElementRef`. Host metadata extended with `'(document:keydown.escape)': 'closeMenu()'` and `'(document:click)': 'onDocumentClick($event)'` (kept existing `'(window:scroll)': 'onScroll()'`).
- **Escape** → `closeMenu()` clears the open menu AND returns focus to that menu's trigger (`querySelector('#{menu}-menu-trigger').focus()`).
- **Outside click** → `onDocumentClick()` uses `!elementRef.nativeElement.contains(event.target)` (host stays a real DOM node via `:host { display: contents }`) and clears `openMenu` without stealing focus, so clicking page inputs isn't disrupted.
- Menu-item clicks call `closeMenu()`; clicking a different trigger switches `openMenu` and is "inside" the host, so the document listener is a no-op for it.

### Icons

- Added `ChevronDown` (rotating caret on all three triggers, `rotate-180` bound to that menu's open state, `transition-transform`).
- Removed now-unused `MoreHorizontal` import.
- Kept `User` (avatar badge + Profile row), `Users` (Members), `LogOut`, `MessagesSquare`, `Menu`, `X`, `Download`.

### Avatar — Option A (per spec §6)

Circular `w-9 h-9 rounded-full bg-ink-800 border border-white/10 text-white/80` badge holding the `User` lucide icon; `hover:border-amber-500/40 hover:text-amber-500`; `ring-2 ring-amber-400` when `accountSectionActive()`, `ring-1 ring-amber-500/30` while the user menu is open. A code comment documents Option B (email-initials via `authService.getCurrentUser()`) as a future upgrade path.

### Mobile sheet (§3)

Regrouped into labeled sections (`px-4 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-white/40`):

- Primary (ungrouped): Features, Builders, Pricing, Docs.
- **ACCOUNT** (authenticated): Members, Profile, Logout. Unauthenticated keeps Login/Sign Up **unlabeled** exactly as today.
- **COMMUNITY**: Community Forum first (same gating), Discord, GitHub, Reddit, LinkedIn.
- Full-width **Download Ptah** CTA as the last item (styling unchanged). Redundant plain "Download" row removed. Same hamburger/backdrop/`animate-slide-down` mechanics preserved.

---

## Accessibility (§5)

- All three triggers are `<button type="button">` with `aria-haspopup="menu"`, `[attr.aria-expanded]`, `aria-controls`, and stable `id="{product|community|user}-menu-trigger"`. User trigger has `aria-label="Account menu"` (avatar-only, no visible label); Product/Community rely on visible text labels.
- Panels: `role="menu"`, `id="{...}-menu"`, `aria-labelledby="{...}-menu-trigger"`.
- Items: `role="menuitem"` with the exact focus-visible ring (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2`) applied to every trigger, menu item, and the avatar button.
- Native `<button>` triggers get Enter/Space for free; single-open mutual exclusion; Escape + outside-click close. External links keep `rel="noopener noreferrer"`.

## Constraints honored

- Angular 21 standalone, `ChangeDetectionStrategy.OnPush`, signals/`computed()`/`inject()` only.
- Tailwind 3 + daisyui 4 + lucide-angular only — no new deps, no CDK, no `[innerHTML]`. Exact existing brand tokens reused (amber `text-amber-500`/`bg-amber-400`, ink surfaces, `text-white/80`, `text-white/40`).
- No spec file existed (`navigation.component.spec.ts` absent) — nothing to update; no test references to the removed API.

## Notes for visual review

- Verify Escape-returns-focus and outside-click-closes across all three desktop menus.
- Confirm avatar ring states: amber ring on `/profile` and `/members` routes, subtle open-state ring otherwise.
- Confirm Download CTA `routerLinkActive` "you are here" state on `/download`.
