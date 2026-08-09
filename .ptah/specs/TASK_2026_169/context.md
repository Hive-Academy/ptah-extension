# TASK_2026_169 — Admin-dashboard management of Builders member content

**Type:** FEATURE
**Workflow depth:** Full
**Branch:** `ak/elevate-video-and-tasks`
**Created:** 2026-08-01
**Source handoff:** `docs/handoff-admin-builders-content-view.md`

## User Request

> Add an admin-dashboard view of Builders member content (sessions/community/cohorts, packs TBD) — admins see it via AdminGuard, NOT via a Builders membership.

## Core Goal

Let a platform **admin** (`ADMIN_EMAILS`) view **and manage** Builders member content from the
admin dashboard **without holding a paid Builders membership**. Admin (staff powers) and Builders
membership (paid perk) stay strictly separate.

## Checkpoint 0 — Resolved Scope Decisions

### Q1: What is a "pack"? → **Define + build the packs model**

Investigation found THREE distinct meanings of "packs" in the repo, and the user's intent matched
none of the existing ones:

1. **"Member Skill Packs" marketing copy** — `builders-section.component.ts:344`,
   `builders-pitch.component.ts:122`, `pricing-grid.component.ts:645`, `members-page.component.ts:337`,
   `pricing-hero.component.ts:48`, `index.html:57`. Describes "delivery patterns shared as SKILL.md
   packs." **No data model, no storage, no CRUD.**
2. **Ptah Marketplace plugins/skills** — real, but a different thing:
   `libs/backend/platform-core/src/content-download.service.ts:80` fetches `content-manifest.json`
   from the **public** `Hive-Academy/ptah-extension` repo into `~/.ptah/`. Free for everyone,
   ungated, an _app_ feature not a license-server one. **Out of scope.**
3. **User's actual intent** — a pack is **the source code / GitHub repo we create**, with its full
   codebase, Claude plugins, MCP servers, etc., made available to Builders. **Did not exist.**

**DECISION:** Build meaning #3 as a new first-class model on the license server.
A pack = title, description, GitHub repo URL, optional private-repo access note, tags, published flag.
Admin CRUD in the new admin section; Builders see the published list on `/members`.

**Delivery = link out to the repo.** Explicitly **NOT** in scope: automatic GitHub collaborator
invites, GitHub App/PAT integration, storing users' GitHub handles, invite/revoke lifecycle tied to
subscription status. The user chose the link-out option over the automation option.

### Q2: Architectural direction → **Option C — Full CRUD management**

Admin-authorized path via `@UseGuards(JwtAuthGuard, AdminGuard)`. NOT Option B (do not make the
member-facing endpoints accept `isBuildersMember || isAdmin`).

### Q3: Read-only or manage? → **Full CRUD on everything**

- **Packs** — full CRUD (new model), **cohort-scoped** (see Checkpoint 2 below).
- **Cohorts / member-groups** — manage membership.
- **Sessions** — create / edit / delete against Google Calendar.
- **Community** — ~~moderation actions~~ **read-only** (revised at Checkpoint 2 below).

## Checkpoint 2 — Post-Architecture Decisions (user, 2026-08-01)

The architect raised two clarifications on `implementation-plan.md`. Both resolved:

### C2-Q1: Discourse moderation depth → **Read-only; moderation stays in Discourse**

> "for the discourse moderation lets leave that through discourse admin panel only"

- **DROPPED:** `PUT /admin/community/topics/:topicId/status` (close/reopen, pin/unpin, list/unlist),
  its DTO, its audit action, and the per-row toggles in the UI.
- **KEPT:** read-only topic list + review-queue count, each row deep-linking into Discourse.
  Orchestrator's ruling — the user removed _moderation_, not _visibility_; surfacing member
  community content in the admin dashboard was the original premise of the task.
- Consequence: `DiscourseAdminProvider` needs **no verb widening**; only a new GET.

### C2-Q3: Packs → **ADMIN-ONLY REGISTRY. No member-facing surface.** (supersedes C2-Q2)

> "i think we are complicating the cohort scoped packs, i think its easier i would be sharing the
> repo for each cohort inside the cohort so each member will get their pack through github not
> through us"

**Distribution moves entirely out of Ptah.** The admin grants cohort members access on GitHub
directly (collaborator invites, or posting the repo link in that cohort's Discourse group). Ptah
never serves pack content and never gates pack access.

- **REMOVED:** `GET /api/v1/members/packs`, `MemberPacksController`, the cohort-aware
  `listVisibleTo()` SQL predicate, the `BuildersMembershipService` dependency in `PacksModule`, the
  cross-cohort smoke matrix, leak risks L5/L6/L7/L7b, frontend F4 (members-page packs section), and
  the `members-api.service.ts` / `memberPackSchema` extensions.
- **DEMOTED:** the cohort FK goes from a _security gate_ to a plain bookkeeping label (renamed off
  `requiredGroupKey`, which would now lie about its function). FK + `onDelete: SetNull` retained.
- **DROPPED:** `published` — meaningless with no member surface.
- **KEPT:** `Pack` model, admin CRUD (5 endpoints), `repoUrl` + its GitHub-URL regex, cohort label,
  `PacksList` / `PackFormModal` / `DeletePackModal`.
- **Side effect:** the security invariant proof gets _stronger_ — packs no longer touch the member
  path at all.

### ~~C2-Q2: Pack cohort scoping → YES, packs are cohort-scoped~~ (SUPERSEDED by C2-Q3)

> "packs will be shared individually with each cohort and each one will get its own repo"

- `Pack` gains a **nullable** cohort FK to `MemberGroup`. `null` = visible to every active Builder;
  non-null = visible only to Builders assigned to that cohort.
- "Each one gets its own repo" needs no model change — `repoUrl` already provides it. Recorded in
  the model docblock so the 1-pack-1-repo intent is explicit.
- **Security-critical:** `PacksService.listPublished()` becomes cohort-aware via the existing
  `MemberGroupsService.getGroupsForUser`. Predicate: `published = true AND (cohort IS NULL OR cohort
IN <caller's groups>)`, filtered **in the query**, never by post-filtering in JS.
- Admin path unaffected — `GET /admin/packs` still returns every pack, all cohorts, incl. drafts.
- `PackFormModal` gains a cohort selector (member-group dropdown + explicit "All Builders" option).
- **New gate dimension to test:** `scripts/packs-gate-smoke.mjs` must prove cross-cohort isolation —
  a Builder in cohort A sees A's pack and unscoped packs, but NOT cohort B's pack.

### Checkpoint 0.1: CLI delegation → **ENABLED, `ollama cloud` only**

- `ollama cloud` — ptah-cli, ptahCliId `pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9`
- (`claude cli` available but not selected; `cursor` not installed)

Sub-agents other than team-leader may delegate file-disjoint grunt work to `ollama cloud`.
Max 3 concurrent. CLI agents must NOT commit to git.

## The Security Invariant — MUST NOT BREAK

Only active Builders may read member/forum data through the **member-facing** endpoints.

- `apps/ptah-license-server/src/discourse/builders-membership.service.ts` —
  `BuildersMembershipService.isBuildersMember(userId)` is the single source of truth.
  **Do not modify its semantics. Do not make it return true for admins.**
- Gated member-facing endpoints (leave their gate untouched):
  - `src/google-sessions/members.controller.ts` — `GET /api/v1/members/sessions`
  - `src/discourse/community.controller.ts` — `GET /api/v1/community/summary`
- Admin access is a **separate authorized path** via `AdminGuard`, never a loosening of the above.
- Regression proof: `scripts/community-gate-smoke.mjs`, `scripts/discourse-e2e.mjs` must stay green.

## Pre-Architecture Findings (verified by orchestrator)

- **Google Calendar write scope is already granted.** `GoogleCalendarProvider` (`google-calendar.provider.ts:92`
  `patchEventAttendees`, `:112` `'PATCH'`, `:127` `method: 'GET' | 'PATCH'`) already performs
  authenticated writes against `https://www.googleapis.com/calendar/v3`. The refresh-token grant in
  `google-auth.provider.ts` requests no explicit scopes — it inherits whatever was consented
  out-of-band — and since PATCH works today, a write scope is present. Session create/delete needs
  `POST /calendars/{id}/events` and `DELETE /calendars/{id}/events/{eventId}`; the provider currently
  only types `'GET' | 'PATCH'` and must be widened. **Confirm with a live create+delete smoke before
  building UI on top of it.**
- No `admin-nav.config.ts` at the path the handoff cited; it is at
  `apps/ptah-landing-page/src/app/pages/admin/admin-layout/admin-nav.config.ts`.
- Shared admin components available for reuse under `pages/admin/components/`:
  `status-badge`, `empty-state`, `stat-tile`, `detail-drawer`, `selection-toolbar`, `data-table`,
  `segment-picker`, `template-picker`, plus modals (`issue-comp-license-modal`, `delete-user-modal`,
  `waitlist-invite-modal`, `bulk-email-modal`, `assign-members-modal`, `group-form-modal`).
- License server has no internal `@ptah-extension/*` imports — it is standalone.

## Constraints

**Backend (NestJS 11):** `@UseGuards(JwtAuthGuard, AdminGuard)`, `catch (error: unknown)`,
`ConfigService` (never `process.env`), Zod/DTO validation at boundaries, never leak raw
`error.message` to clients. Prisma migration for the packs model. Admin mutations should hit the
existing audit log (`AuditModule`).

**Frontend (Angular 21):** standalone, `ChangeDetectionStrategy.OnPush` mandatory, signals /
`computed()` / `inject()`, daisyui `operator` theme + Tailwind, reuse shared admin components,
lazy-loaded admin route, no `[innerHTML]`. Admin stays hidden from public nav; `AdminAuthGuard` is a
UX shortcut only — server `AdminGuard` is the real boundary. Keep initial bundle < 1mb.

## Planned Agent Sequence

1. ~~Checkpoint 0~~ ✅ resolved above
2. `software-architect` → `implementation-plan.md`
3. Checkpoint 2 (user approval, plain message)
4. `backend-developer` ∥ `frontend-developer`
5. `code-logic-reviewer` — verify member gate untouched + admin path properly gated
6. Verify: `scripts/community-gate-smoke.mjs` + `scripts/discourse-e2e.mjs` green
7. Commit

## Dev Environment

- `npm run docker:up` → postgres + license-server (:3000) + Discourse dev (Rails :3001 + Ember).
- `nx serve ptah-landing-page` → :4200.
- Dev `ADMIN_EMAILS=abdallah@miramarstaffing.com`.
- abdallah's dev user id: `674888a2-b28b-4d83-87c8-8c30d971edc1` — has a `community` license, NOT
  builders. Ideal for proving an admin sees content WITHOUT a membership.
- Mint a `ptah_auth` cookie locally the way `scripts/community-gate-smoke.mjs` does (HMAC over
  `header.payload` with `JWT_SECRET`).
