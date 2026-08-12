# TASK_2026_168 — Navbar Redesign: Declutter & Consolidate

**Component under redesign**: `apps/ptah-landing-page/src/app/components/navigation.component.ts`
**Direction**: Declutter & consolidate (user-chosen). Not a mega-menu, not a "keep everything" polish.

---

## 1. Final Information Architecture

### Desktop top-level row (left → right, after logo)

| Slot | Element                                                         | Type                                              | Behavior                                                        |
| ---- | --------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| 1    | **Product ▾**                                                   | Disclosure dropdown                               | Contains: Features, Builders                                    |
| 2    | **Pricing**                                                     | Direct link (`/pricing`)                          | —                                                               |
| 3    | **Docs**                                                        | Direct external link (`docs.ptah.live`, `_blank`) | —                                                               |
| 4    | **Community ▾**                                                 | Disclosure dropdown                               | Contains: Community Forum\* , Discord, GitHub, Reddit, LinkedIn |
| 5a   | _Unauthenticated only_: **Login**, **Sign Up**                  | Direct links                                      | Existing styles unchanged                                       |
| 6    | **Download Ptah**                                               | Primary amber CTA button (`/download`)            | Always visible, both auth states                                |
| 7    | _Authenticated only_: **User menu ▾** (avatar/initials trigger) | Disclosure dropdown                               | Contains: Members, Profile, — divider —, Logout                 |

\* gated: only rendered when `isAuthenticated() && forumSsoUrl()`.

**Target count** (down from ~12 flat targets):

- Unauthenticated: Logo, Product▾, Pricing, Docs, Community▾, Login, Sign Up, Download CTA = **8**
- Authenticated: Logo, Product▾, Pricing, Docs, Community▾, Download CTA, User▾ = **7**

### Grouping justification

- **Product** folds the two homepage-anchor links (`Features` §`#features`, `Builders` §`#builders`) — both "what Ptah is" — into one disclosure. They're anchors on the same route, so nesting them costs nothing functionally.
- **Community** folds every non-product, non-account destination (forum + 4 socials) behind one clearly **labeled** entry — this directly fixes the complaint that Community Forum was buried in a nameless "⋯". It also scales: a future 6th social slots into the same menu without re-cluttering the bar.
- **User menu** folds every account-scoped action (Members, Profile, Logout) behind the identity affordance users already expect in the top-right corner of a SaaS app, instead of spelling each one out inline.
- **"Download" text link is retired, not dropped**: it pointed at the exact same `/download` route as the "Download Ptah" CTA button (redundant target in the current file, lines 130–137 vs 329–341). The CTA already satisfies the "don't drop Download(route)" requirement — it's re-homed into the CTA, not removed.
- **Pricing and Docs stay top-level** (not folded into Product) because they are high-intent, single-destination links with no natural sibling to group with — folding them would add a click for no organizational gain.

### Auth-state variants (explicit)

**Authenticated:**

```
Product▾  Pricing  Docs  Community▾   [Download Ptah]  [User ▾]
```

User menu panel: Members → Profile → ──── → Logout (Logout visually separated + red-hover, exactly as today).
Community menu panel: Community Forum → Discord → GitHub → Reddit → LinkedIn.

**Unauthenticated:**

```
Product▾  Pricing  Docs  Community▾   Login   Sign Up   [Download Ptah]
```

No user menu (nothing to show). Community menu panel: Discord → GitHub → Reddit → LinkedIn (Community Forum item simply absent — gating preserved, not just hidden-but-rendered).

---

## 2. Desktop layout — structural mockup

**Authenticated, at top of page (transparent bg):**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [Ptah Logo]      Product▾   Pricing   Docs   Community▾        [Download Ptah]  ( U )▾    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                    ↑ avatar trigger
```

**Unauthenticated:**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [Ptah Logo]      Product▾   Pricing   Docs   Community▾    Login   Sign Up  [Download Ptah]│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Community▾ panel open (authenticated), right-aligned under trigger:**

```
                                              ┌───────────────────────────┐
                                              │ 💬  Community Forum       │
                                              │ 🎮  Discord                │
                                              │ 🐙  GitHub                 │
                                              │ 👽  Reddit                 │
                                              │ 💼  LinkedIn               │
                                              └───────────────────────────┘
```

(icons illustrative — actual glyphs: `MessagesSquareIcon` lucide + existing inline Discord/GitHub/Reddit/LinkedIn SVGs, unchanged from current file)

**Product▾ panel open, left-aligned under trigger:**

```
┌───────────────────────┐
│  Features             │
│  Builders             │
└───────────────────────┘
```

**User▾ panel open (authenticated), right-aligned under avatar, rightmost element:**

```
                                                                              ┌───────────────────┐
                                                                              │ 👥  Members        │
                                                                              │ 👤  Profile        │
                                                                              │ ─────────────────  │
                                                                              │ ⏻  Logout          │
                                                                              └───────────────────┘
```

Only **one** of Product/Community/User menus may be open at a time (mutual exclusion — see §7).

---

## 3. Mobile layout — hamburger sheet

Same hamburger trigger, same `#mobile-menu` slide-down panel/backdrop mechanics as today. Content reorganized into **labeled, divided sections** instead of one flat list of ~13 rows:

```
┌───────────────────────────────┐
│  Features                     │   ← primary nav (ungrouped — only 4 core items,
│  Builders                     │      a section header would be noise)
│  Pricing                      │
│  Docs                         │
│ ─────────────────────────────  │
│  ACCOUNT                      │   ← small uppercase muted label (text-white/40 text-xs
│  👥 Members                   │      font-semibold tracking-wide uppercase), authenticated only
│  👤 Profile                   │
│  ⏻ Logout                     │
│ ─────────────────────────────  │
│  COMMUNITY                    │   ← same muted section-label treatment
│  💬 Community Forum           │      (Community Forum row omitted if not authenticated/no forumSsoUrl)
│  🎮 Discord                   │
│  🐙 GitHub                    │
│  👽 Reddit                    │
│  💼 LinkedIn                  │
│ ─────────────────────────────  │
│  [   Download Ptah   ]        │   ← full-width primary CTA, last item, unchanged styling
└───────────────────────────────┘
```

**Unauthenticated mobile** — the ACCOUNT section becomes just:

```
│ ─────────────────────────────  │
│  Login                        │
│  Sign Up                      │
│ ─────────────────────────────  │
```

(no "ACCOUNT" label needed for 2 plain auth links — keep as today, unlabeled, matches current unauthenticated block styling exactly).

Section labels use: `class="px-4 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-white/40"` — new class combo, but built entirely from existing Tailwind utilities already in the file (`text-white/40` pattern doesn't exist yet verbatim but follows the same `text-white/NN` opacity convention as `text-white/60`/`70`/`80` already used throughout).

The plain "Download" mobile row is removed for the same reason as desktop (redundant with the CTA at the bottom of the same sheet).

---

## 4. Visual states (exact tokens — no new colors)

All new interactive elements reuse the file's existing token set. No new hex values, no new Tailwind colors.

| Element                                 | Default                                                                                                                                                                                                                                                                                 | Hover                                                                        | Active (routerLinkActive)                                                                                                                            | Focus-visible                                                                                                                                                                                                                                                           | Open                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Product / Community trigger (text)      | `text-white/80`                                                                                                                                                                                                                                                                         | `hover:text-amber-500`                                                       | n/a — disclosure menus aren't routes, no persistent active state                                                                                     | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2`                                                                                                                                                          | icon `ChevronDown` rotates via `rotate-180` class; trigger text `text-amber-500` while `openMenu() === 'product' \| 'community'` |
| Pricing link                            | `text-white/80`                                                                                                                                                                                                                                                                         | `hover:text-amber-500`                                                       | `routerLinkActive="text-amber-500"` `[routerLinkActiveOptions]="{ exact: true }"`                                                                    | same as above                                                                                                                                                                                                                                                           | n/a                                                                                                                              |
| Download Ptah CTA                       | `bg-amber-500 text-ink-950`                                                                                                                                                                                                                                                             | `hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber`          | `routerLinkActive="bg-amber-400"` (visually same as hover — "you are here")                                                                          | same as above                                                                                                                                                                                                                                                           | n/a                                                                                                                              |
| User avatar trigger                     | `bg-ink-800 border border-white/10 text-white/80` (circular, `w-9 h-9 rounded-full`)                                                                                                                                                                                                    | `hover:border-amber-500/40 hover:text-amber-500`                             | `[class.ring-2] [class.ring-amber-400]` bound to a new `accountSectionActive` computed (true when `router.url` starts with `/profile` or `/members`) | same outline pattern                                                                                                                                                                                                                                                    | `ring-1 ring-amber-500/30` while `openMenu() === 'user'`                                                                         |
| Dropdown panel (Product/Community/User) | `absolute {left-0\|right-0} top-full mt-2 rounded-lg border border-amber-500/10 bg-slate-950/95 backdrop-blur-md shadow-lg py-1.5 z-50` (identical to current Community panel; Product panel `left-0` since it's the leftmost trigger, `w-40`; Community/User panels `right-0`, `w-48`) | —                                                                            | —                                                                                                                                                    | —                                                                                                                                                                                                                                                                       | rendered only while its `openMenu()` branch matches                                                                              |
| Menu item (all three menus)             | `flex items-center gap-2.5 px-4 py-2 text-white/70 text-sm font-medium`                                                                                                                                                                                                                 | `hover:text-white hover:bg-white/5`                                          | n/a                                                                                                                                                  | browser default `:focus-visible` ring inherited from anchor/button semantics — add same `focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2` explicitly since these are inside an absolutely-positioned panel | —                                                                                                                                |
| Logout menu item                        | `text-white/70`                                                                                                                                                                                                                                                                         | `hover:text-red-400 hover:bg-white/5` (matches existing red-hover semantics) | —                                                                                                                                                    | same focus-visible pattern                                                                                                                                                                                                                                              | —                                                                                                                                |
| Login / Sign Up (unauthenticated)       | unchanged from current file                                                                                                                                                                                                                                                             | unchanged                                                                    | `routerLinkActive` not needed — guarded routes redirect away when authenticated                                                                      | unchanged                                                                                                                                                                                                                                                               | n/a                                                                                                                              |

Divider inside User menu (before Logout): reuse existing `<div class="h-px bg-white/10 my-2" aria-hidden="true">` pattern already used in the mobile sheet, tightened to `my-1` for the compact panel.

---

## 5. Accessibility

- **Triggers** (Product, Community, User): `<button type="button">` with `aria-haspopup="menu"`, `[attr.aria-expanded]="openMenu() === 'product' | 'community' | 'user'"`, `aria-controls="{product|community|user}-menu"`, `id="{product|community|user}-menu-trigger"`. Community/Product trigger `aria-label` unnecessary since visible text label ("Product"/"Community") already names it; User trigger needs `aria-label="Account menu"` (no visible text label, avatar-only).
- **Panels**: `role="menu"`, `id="{product|community|user}-menu"`, `aria-labelledby="{...}-menu-trigger"`.
- **Items**: `role="menuitem"` on every link/button inside a panel (matches current Community panel pattern exactly).
- **Keyboard**:
  - Trigger buttons are native `<button>` elements → Enter/Space toggle by default, no custom handling needed.
  - **Escape** closes whichever menu is open and returns focus to that menu's trigger button (new — add `document:keydown.escape` host listener; on close, call `.focus()` on the trigger's `ElementRef`/template ref that was open).
  - **Outside click** closes any open menu (new — see §7 implementation; not present in the current file at all, must be added, not just preserved).
  - Tab order inside an open panel follows natural DOM order (no custom roving `tabindex`/arrow-key nav — matches the simplicity level of the current Community panel; not required for a 2–5 item disclosure menu per WAI-ARIA APG's simpler "menu button" pattern).
  - Only one of Product/Community/User may be open at once — opening a second automatically closes the first (mutual exclusion via a single tri-state signal, §7).
- **Focus-visible rings**: every new interactive element (all 3 triggers, all menu items, the avatar button) gets the exact existing ring: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2`.
- **Mobile sheet**: unchanged mechanics (`role="menu"`/`menuitem`, backdrop click closes, `aria-expanded` on hamburger, `aria-controls="mobile-menu"`) — only the _content grouping_ changes, not the a11y contract.
- Community Forum link keeps `target="_blank" rel="noopener noreferrer"` exactly as today, gated by `isAuthenticated() && forumSsoUrl(); as forumUrl`.

---

## 6. Assumption flagged (avatar source)

The user model (`AuthUser` in `auth.service.ts`) exposes only `{ id, email }`, and `NavigationComponent` currently only consumes `isAuthenticated()` — no user identity data flows into this component today. Two options, pick one at implementation time:

- **Option A — recommended for this pass**: circular badge, `w-9 h-9 rounded-full bg-ink-800 border border-white/10`, containing the existing `User` lucide icon (`w-5 h-5`) as a generic placeholder. Zero new HTTP calls, zero new signals beyond menu state. Matches "keep bundle lean."
- **Option B — future enhancement, not required here**: call `authService.getCurrentUser()` (already exists, unused by this component) to get `email`, derive initials via a `computed()` (e.g. first letter of local-part before `@`), and render initials as text instead of the icon. Flag this as a follow-up ticket if product wants a more personalized avatar — out of scope for a declutter/consolidate pass.

Spec assumes **Option A** for the buildable deliverable; note Option B in code comments as a documented future upgrade path.

---

## 7. Component-structure plan

Keep everything inside the existing single `navigation.component.ts` — the file already owns "the nav," and the task explicitly says don't invent a from-scratch component. No new Angular component is required to hit the spec above; the three dropdowns are structurally identical to the existing Community dropdown, just parameterized differently.

### Signals — replace/generalize, don't triple the boilerplate

- **Remove**: `communityMenuOpen` (signal), `toggleCommunityMenu()`, `closeCommunityMenu()`.
- **Add**: `openMenu = signal<'product' | 'community' | 'user' | null>(null)` — single tri-state signal drives all three panels and guarantees mutual exclusion for free.
- **Add methods**:
  - `toggleMenu(menu: 'product' | 'community' | 'user'): void` — sets `openMenu` to `menu` if not already open, else `null` (standard toggle-with-exclusivity).
  - `closeMenu(): void` — sets `openMenu` to `null`. Used by: menu-item `(click)`, Escape handler, outside-click handler, route-change (optional).
- Template reads `openMenu() === 'community'` etc. directly in `@if` blocks — no extra per-menu computed signals needed.
- **Add** (for the User menu active-state, §4): `accountSectionActive = computed(() => this.router.url.startsWith('/profile') || this.router.url.startsWith('/members'))`. Requires injecting Angular `Router` (new `inject(Router)`), which is a small, justified addition since `RouterLink` is already imported from the same package.
- Keep unchanged: `scrolled`, `mobileMenuOpen`, `isAuthenticated`, `forumSsoUrl`, `handleLogout()`, `toggleMobileMenu()`, `closeMobileMenu()`, `onScroll()`.

### Outside-click + Escape (new behavior — not present today)

The current file has **no** outside-click handling for the Community panel at all (only explicit menu-item clicks call `closeCommunityMenu()`); this spec requires adding it for all three menus:

- Inject `ElementRef` (new).
- Extend the existing `host: {...}` object in `@Component` metadata (it already has `'(window:scroll)': 'onScroll()'`) with:
  - `'(document:keydown.escape)': 'closeMenu()'`
  - `'(document:click)': 'onDocumentClick($event)'`
- `onDocumentClick(event: Event): void` — if `!this.elementRef.nativeElement.contains(event.target as Node)`, call `closeMenu()`. Because the host uses `display: contents` (unchanged), the host element remains a real DOM node wrapping both the fixed nav bar and the fixed mobile overlay, so `.contains()` correctly treats clicks anywhere inside the whole nav (bar, panels, mobile sheet) as "inside" and leaves them alone; only clicks on the rest of the page close an open menu.
- No `stopPropagation()` needed: clicking a different trigger already switches `openMenu` via `toggleMenu()`, and that click is still "inside" the host, so the document listener is a no-op for it.

### Icons

- **Add**: `ChevronDown` from `lucide-angular` (dropdown carets for Product/Community/User triggers; rotate 180° via `class.rotate-180` bound to that menu's open state).
- **Remove**: `MoreHorizontal` import — no longer used once the nameless "⋯" trigger is replaced by the labeled "Community" trigger.
- **Keep**: `User` (now used for the avatar badge instead of the old inline Profile link), `Users` (Members row, now inside User menu), `LogOut`, `Menu`, `X`, `Download`, `MessagesSquare` (Community Forum row, unchanged).
- Discord/GitHub/Reddit/LinkedIn stay as the existing inline `<svg>` paths — no change, no new assets.

### Template changes, section by section

1. Desktop bar: replace the `Features`/`Builders` anchors with one `Product` trigger button + panel (2 plain-text menu items, no icons, matching their current icon-less style).
2. Replace `Pricing`, `Docs` as-is (add `routerLinkActive` to Pricing only, per §4).
3. Remove the standalone `Download` link entirely (redundant with CTA, §1).
4. Remove the top-level `Members`/`Profile`/`Logout` block and the Discord/GitHub inline `<a>` tags and the old `MoreHorizontal` "⋯" dropdown block — replace with the two new triggers: `Community` (panel: Community Forum-gated, Discord, GitHub, Reddit, LinkedIn — reuses the exact panel markup/classes already in the file, just renamed and relabeled) and, for authenticated users only, the `User` avatar trigger (panel: Members, Profile, divider, Logout).
5. Keep `Download Ptah` CTA exactly where it is today (last, or second-to-last if User menu is present), add `routerLinkActive` per §4.
6. Login/Sign Up block: unchanged, still rendered inline (not moved into a menu) since unauthenticated users have nothing to consolidate them with.
7. Mobile sheet: same `@if (isAuthenticated())` branches as today, but reordered/regrouped into the sectioned layout in §3, with small uppercase `ACCOUNT`/`COMMUNITY` labels inserted before their respective groups, and the redundant `Download` row removed (CTA stays as the final full-width row, unchanged).

No new deps, no CDK, no new heavy libraries — Tailwind utilities + lucide-angular only, consistent with the existing file.

---

## Summary of re-homing (traceability)

| Original item        | New home                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Features             | Product ▾ menu                                                                                      |
| Builders             | Product ▾ menu                                                                                      |
| Pricing              | Top-level (unchanged)                                                                               |
| Docs                 | Top-level (unchanged)                                                                               |
| Download (text link) | Retired — CTA already covers `/download`                                                            |
| Members              | User ▾ menu                                                                                         |
| Profile              | User ▾ menu                                                                                         |
| Logout               | User ▾ menu (below divider)                                                                         |
| Discord              | Community ▾ menu                                                                                    |
| GitHub               | Community ▾ menu                                                                                    |
| Reddit               | Community ▾ menu (was already in "⋯")                                                               |
| LinkedIn             | Community ▾ menu (was already in "⋯")                                                               |
| Community Forum      | Community ▾ menu, **first item** (was buried in unlabeled "⋯", now first-class and clearly labeled) |
| Download Ptah CTA    | Top-level (unchanged, still primary)                                                                |
| Login / Sign Up      | Top-level, unauthenticated only (unchanged)                                                         |
