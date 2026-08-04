# Handoff — Admin view of Builders member content (from the admin dashboard)

**For:** a fresh Claude Code session. Start it with `/orchestrate` and this doc.
**Branch:** `ak/elevate-video-and-tasks` (or a new branch off it).
**One-line goal:** Let a platform **admin** view (and possibly manage) the **Builders member content** — sessions, community, cohorts, "packs" — from the **admin dashboard**, WITHOUT holding a paid Builders membership. Admin and membership stay separate.

---

## Why this exists (background)

Recent work (committed on `ak/elevate-video-and-tasks`) built the Builders/Discourse stack:

- Seamless Discourse SSO + auto-admin from `ADMIN_EMAILS` (`061a19ab7`).
- In-app community surfaces + branded Discourse theme (`075cca870`).
- Builders-gate **security test** proving only Builders read forum/member data (`24f22f874`).
- Navbar redesign (`53feb7325`); theme+logo prod wiring (`6537148fe`).

During that, we hit this UX question: the founder is an **admin** (`ADMIN_EMAILS`) but has only a **free `community` license**, so `/members` correctly shows the "Builders Perk" waitlist gate. The founder's stance (correct, and the reason for this task):

> An admin should NOT need a comp Builders license to see Builders content. Admins should see it **through the admin dashboard**. Admin (staff powers) and Builders membership (paid perk) must stay **separate**.

So: do **not** grant admins a Builders membership or make `isBuildersMember` return true for admins. Instead, give admins a **dedicated admin-side view** of the member content.

---

## The security invariant you MUST NOT break

We just shipped + tested a gate that ensures **only active Builders** read member/forum data. Do not weaken it.

- `libs/api/membership/src/lib/membership.service.ts` — `MembershipService.isBuildersMember(userId)` (active/trialing subscription OR active non-expired `builders` license). Single source of truth. (`libs/api/community/src/lib/discourse/builders-membership.service.ts` still holds the older, verbatim-identical copy that `DiscourseController` uses; it is retired with the rest of the Discourse tree.)
- Gated endpoints: `libs/api/community/src/lib/google-sessions/members.controller.ts` (`GET /api/v1/members/sessions`) and `libs/api/community/src/lib/discourse/community.controller.ts` (`GET /api/v1/community/summary`). Both 403/degrade for non-Builders.
- Regression tests: `scripts/community-gate-smoke.mjs`, `scripts/discourse-e2e.mjs`. **Re-run these after any change here** — they must stay green.

The admin view must reach member content through an **admin-authorized path** (see `AdminGuard`), NOT by loosening the Builders gate on the member-facing endpoints.

---

## What exists today (code map)

**Admin authorization (license server):**

- `libs/api/identity/src/lib/guards/admin.guard.ts` — `AdminGuard`, fail-closed. Runs after `JwtAuthGuard`. The `ADMIN_EMAILS` parse itself now lives in `libs/api/identity/src/lib/admin-emails.ts` (`isAdminEmail`) and is shared by every surface that reads the allowlist; only this guard fail-closes on an unset one.
- `libs/api/admin/src/lib/admin.service.ts` / the `admin-*.controller.ts` files beside it — existing admin endpoints (users, licenses, subscriptions, groups, waitlist, audit, marketing). All `@UseGuards(JwtAuthGuard, AdminGuard)`.

**Admin dashboard (Angular landing page):**

- `apps/ptah-landing-page/src/app/pages/admin/admin.routes.ts` — routes: `overview`, `groups` (cohorts/member-groups, with `discourseGroup` mapping), `waitlist`, `licenses`, `failed-webhooks`, `users`, `users/:id`, `marketing/*`. **No** sessions/community/packs/"members-preview" route exists yet — this feature adds one.
- `apps/ptah-landing-page/src/app/services/admin-api.service.ts` — admin API client (Zod-validated).
- `apps/ptah-landing-page/src/app/pages/admin/admin-layout/*` + `admin-nav.config.ts` — the admin shell + grouped sidebar (add the new section here).
- Shared admin components (from TASK_2026_164): `pages/admin/components/{status-badge,empty-state,stat-tile,detail-drawer,selection-toolbar}`. Reuse them. daisyui `operator` theme.

**The member content itself (what "Builders content" is today):**

- `apps/ptah-landing-page/src/app/pages/members/members-page.component.ts` — the members area: **Sessions** (Google Calendar events w/ Meet links), **Community** card (Open Community + activity widget), **cohort badges** (`memberGroups`).
- `apps/ptah-landing-page/src/app/services/members-api.service.ts` — `/members/sessions` + `/community/summary` clients.
- `apps/ptah-license-server/src/google-sessions/*` — sessions backend (Google Calendar via OAuth refresh token).
- `apps/ptah-license-server/src/member-groups/*` — cohorts/member-groups (→ Discourse groups).
- **"Member Skill Packs" / "PRD-to-Production Curriculum" / "Live Training Sessions" / "Priority Support"** in `pages/members/components/builders-pitch.component.ts` are **marketing bullets on the gate — NOT built features/content**. There is currently **no "packs" data model, storage, or CRUD** anywhere. ⚠️ This is the single biggest scope unknown — see Q1.

---

## First: resolve scope (Checkpoint 0 in the new session)

The phrase "Builders packs" is ambiguous. Clarify with the user BEFORE building:

- **Q1 — What is a "pack"?** Is there real content to show (course modules, downloadable artifacts, skill packs), or is it aspirational marketing copy? If real: where does it live (repo? external? a DB table that doesn't exist yet)? If it doesn't exist yet, this feature may be "preview the existing members experience (sessions/community/cohorts)" now, with packs deferred until the packs feature itself exists.
- **Q2 — Which direction** (see options below)?
- **Q3 — Read-only preview, or manage?** Should admins just _view_ member content, or _administer_ it (create sessions, upload packs, moderate community)?

---

## Options (present these; recommend A)

**Option A — Dedicated admin "Builders / Members" section (recommended).**
Add an admin route (e.g. `/admin/members` or `/admin/builders`) behind `AdminGuard`, with **admin-authorized backend endpoints** that return the same member content the Builders see (sessions, community summary, cohorts) — but authorized by _admin_, not membership. Read-only first (Q3). Reuses the existing member-content services server-side; new thin admin controllers gate on `AdminGuard` instead of `isBuildersMember`. Keeps admin/membership cleanly separate, doesn't touch the tested member-facing gate, and scales to real "packs" management later.

**Option B — Admins bypass the members gate (smallest, but flawed).**
Make the member-facing endpoints allow `isBuildersMember(user) || isAdmin(user)`. Simple, but: (a) it half-opens the _member-facing_ UI to admins rather than giving them an _admin_ view, and (b) an admin still isn't in the Discourse `builders` group (that's asserted from membership, not admin), so gated forum categories stay locked → inconsistent. Also mildly weakens the gate we just hardened. Not recommended.

**Option C — Full Builders content management.**
Admin CRUD for sessions/packs/community (create/edit/delete). Largest scope; only if Q3 = "manage" and the packs feature actually exists. Likely a later phase after A.

---

## Constraints / standards

- **Do not weaken `isBuildersMember` or the member-facing endpoints.** Admin access is a _separate_ authorized path (`AdminGuard`).
- Backend: NestJS, `@UseGuards(JwtAuthGuard, AdminGuard)`, `catch (error: unknown)`, `ConfigService` (no `process.env`), Zod at boundaries, never leak raw errors. RPC dual-registration rule is N/A (license-server HTTP).
- Frontend: Angular 21 standalone, `ChangeDetectionStrategy.OnPush`, signals/`computed()`/`inject()`, daisyui `operator` + Tailwind, reuse the shared admin components, lazy-loaded admin route, no `[innerHTML]`. Admin stays hidden from public nav; `AdminAuthGuard` is a UX shortcut (server `AdminGuard` is the real boundary).
- Add/keep tests green: extend admin specs; re-run `community-gate-smoke.mjs` + `discourse-e2e.mjs` to prove the member gate is unchanged.

---

## How to start the new session

1. `/orchestrate` with: _"Add an admin-dashboard view of Builders member content (sessions/community/cohorts, packs TBD) — admins see it via AdminGuard, NOT via a Builders membership. See docs/handoff-admin-builders-content-view.md."_
2. Task type: **FEATURE** (likely Full workflow given a new admin section + backend endpoints). Run **Checkpoint 0** to resolve Q1–Q3 above with the user first.
3. Suggested flow: `software-architect` (design the admin route + admin-authorized endpoints, decide packs scope) → user approval → `backend-developer` (admin endpoints reusing member-content services) ∥ `frontend-developer` (admin section + nav) → `code-logic-reviewer` (confirm the member gate is untouched + admin path is properly gated) → verify (re-run the two gate smoke tests) → commit.

## Dev environment notes (for live testing)

- `npm run docker:up` brings up postgres + license-server (:3000) + Discourse dev (Rails :3001 + Ember frontend) — see `scripts/discourse-dev-up.sh`.
- Landing page: `nx serve ptah-landing-page` (:4200).
- Admin email in dev `.env`: `ADMIN_EMAILS=abdallah@miramarstaffing.com`. Mint a `ptah_auth` cookie for local admin testing the same way `scripts/community-gate-smoke.mjs` does (HMAC over header.payload with `JWT_SECRET`).
- abdallah's dev license-server user id: `674888a2-b28b-4d83-87c8-8c30d971edc1` (has a `community` license, NOT builders — perfect for testing that an admin sees content WITHOUT a membership).
