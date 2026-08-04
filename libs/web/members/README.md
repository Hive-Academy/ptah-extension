# @ptah-web/members

The Ptah Builders **member panel**, mounted at `/members` by
`apps/ptah-landing-page/src/app/app.routes.ts`.

## Public surface

`src/index.ts` exports **`MEMBER_ROUTES` and nothing else**. Every component is
reachable only through a lazy `loadComponent` inside that route tree, mirroring
`@ptah-web/admin`. Nothing else in the workspace may import a member component
directly — if a second surface needs one, the primitive is promoted to
`@ptah-web/panel-ui` instead (plan §5.3).

## Shell

`MemberLayout` is a **thin binding over `PanelLayout`** from
`@ptah-web/panel-ui`. The drawer, grouped sidebar, primary/secondary tiering,
per-group collapse and active-route highlighting all live there. There is no
second shell, no second sidebar and no second drawer (R9.1). What is local:

- `MEMBER_NAV_GROUPS` (`member-nav.config.ts`) — the nav data,
- `MemberThemeService` — `operator-member` / `operator-member-light`, persisted
  in `localStorage['ptah.members.theme']` (AD-13),
- the projected top bar (email + theme toggle) and sidebar footer
  (membership card).

`drawerId="member-drawer"` is deliberately distinct from the admin's
`admin-drawer` so the two shells can never collide.

## Routing

`members.routes.ts` enumerates every route explicitly. **There is no
`:model` / `:model/:id` catch-all.** The admin panel keeps one because it is an
internal operator surface; on a member-facing surface it is a data-exposure
hazard (R9.4, RK-11). `members.routes.spec.ts` fails the build if one is
reintroduced.

Phase 1 ships real `hub` and `account` pages. The remaining routes render
`MemberPhasePlaceholder`, which reads its `data.surface` / `data.phase` from the
route and renders the shared `EmptyState`. The route table is declared **now** so
its enforcing spec is in force from day one.

## Data

Exactly **one** request composes the hub: `GET /api/v1/members/hub`
(`MemberHubApiService`). A hub assembled client-side from several endpoints
fails R6.2, and `member-hub-api.service.spec.ts` asserts the single call.

Wire types and Zod schemas come from `@ptah-contracts/community`. This lib
declares none of its own — a re-declared response shape is exactly the drift
that contracts lib exists to prevent.

Every section carries `status: 'ok' | 'empty' | 'unavailable'`, and all three
render. `'empty'` and `'unavailable'` are visually distinct on purpose: "you
have no unread topics" and "the forum is down" are different messages.

## Guard

`MemberGuard` probes `GET /api/v1/members/entitlement`:

| Outcome                   | Result                      |
| ------------------------- | --------------------------- |
| `401`                     | `/login?returnUrl=/members` |
| `200 { entitled: false }` | `/pricing`                  |
| `200 { entitled: true }`  | seeds `MemberSessionStore`  |

It is **cosmetic**. The server-side `MemberGuard` in `libs/api/membership` is the
real enforcement (NFR-S8); never rely on this one for authorization.

## Tokens

`docs/design-system/panel-theme-spec.md` is authoritative. Surfaces are
`base-100` / `base-200` / `base-300`; every boundary is `border-hairline`;
hover/active is `bg-surface-high`. **`base-300` is a fill and is never a
border** — at 1.05:1 against a `base-200` card it is invisible. Load-bearing
muted text uses `text-base-content/60` or stronger; `/40` measures 3.18:1 and
fails WCAG AA for body text.

`eslint.config.mjs` in this lib enforces all of that, plus `OnPush` on every
component.

## Markdown

User-generated content renders through `@ptah-extension/markdown` — the single
DOMPurify chokepoint — using the `'member'` preset, supplied by a route-level
`providers` array on the `/members` route. Never `[innerHTML]`, never a second
sanitizer.
