# TASK_2026_177 — Native community platform

- **Type**: FEATURE
- **Workflow**: Full (PM → Architect → Team-Leader → QA)
- **Created**: 2026-08-03
- **cli_delegation**: disabled (user chose sub-agents only at Checkpoint 0.1)

## User request

> Design a powerful, professional, maintainable and scalable community platform.
> We might also need comments. Also integrate with YouTube for courses and live
> sessions, and Google Meet for private sessions.

## Standing decision that frames everything

**Discourse is being dropped entirely.** Not headless — removed. The forum's
value (trust levels, spam heuristics, flag queues, email digests) is built for
large public forums with hostile anonymous traffic. Ptah Builders is a paid,
invite-gated cohort where the paywall is the spam filter.

Evidence gathered before this task:

- `community.ptah.live` (production) is **empty**.
- All authored content lives in a local Docker `discourse_dev` container:
  **17 topics, 19 posts, 4 categories**, every topic a single seed post. There
  is no conversation to migrate.
- Exported with raw markdown to `docs/community/discourse-export.json`
  (committed `6614f9e92`) so migration does not depend on that container.
- The substantive content is **8 sequential "Week N build thread" topics plus
  "Start here" and "Questions"** — a curriculum, not a discussion. It maps to
  Course → Module → Lesson with ordering and completion state, which Discourse
  structurally cannot express.

Deleting `libs/api/community/src/lib/discourse/` (~12 files: SSO, admin
provider, group sync, membership service, controllers) is in scope. So is
retargeting `apps/ptah-discourse-theme` and the Seshat harness's community
skills (`D:/projects/seshat`), which currently describe Discourse operations.

## Checkpoint 0 decisions (user-answered)

| Question       | Decision                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI delegation | **Disabled.** Sub-agent developers only.                                                                                                                                                                                                                                                                                                              |
| YouTube        | **Unlisted videos + Data API v3.** Store `videoId`; server fetches title/duration/thumbnail with an API key (no OAuth, no channel write access). Embed via `youtube-nocookie.com`. Live sessions are scheduled unlisted streams whose ID an admin pastes. Duration from the API is what makes lesson progress accurate rather than a manual checkbox. |
| Google Meet    | **Extend the existing `SessionRequest` + `GoogleSessionsModule`.** The Calendar API generates the Meet link automatically on event create, so no separate Meet integration is needed. Adds a member-facing request/accept flow on top of what already works.                                                                                          |
| Comments       | **Separate models.** `Post` carries threaded forum replies; a distinct `LessonComment` attaches to lessons. No polymorphic comment table — it would lose referential integrity and force a discriminator into every query.                                                                                                                            |

## Already landed (do not redo)

| Commit      | What                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2659ae5b0` | Admin palette classes → daisyUI semantic tokens (155 substitutions, 24 files)                                                                                                  |
| `08c59af79` | `operator-admin` / `operator-member` / `operator-member-light` themes + spec                                                                                                   |
| `399af4917` | `--border-hairline` and `--surface-high` wired into components; brand amber applied                                                                                            |
| `5273fbdd0` | **`libs/web/panel-ui` extracted** — `PanelLayout`, `PanelNavItem`/`PanelNavGroup`, `StatTile`, `StatusBadge`, `EmptyState`, `DetailDrawer`, `SelectionToolbar`, `BadgeVariant` |
| `6614f9e92` | Discourse content export                                                                                                                                                       |

The member panel MUST build on `@ptah-web/panel-ui`. Do not author a second
shell. `docs/design-system/panel-theme-spec.md` is the authoritative token
reference — surfaces are `base-100`/`base-200`/`base-300`, every boundary is
`border-hairline`, hover/active is `bg-surface-high`, and `base-300` is a fill
that must never be used as a border.

## Design evidence

`docs/design-system/stitch_ptah_builders_member_home/` — 8 approved screens
(member home, community feed, discussion thread, course player, sessions
calendar; each in dark and light). These are the visual target.

## Planned IA (from prior analysis, for the PM to validate not invent)

Member panel at `/members`, mounted like `/admin`:
Hub · Learn (Courses, Artifacts) · Build (Packs) · Live (Sessions, Replays,
Request a session) · Community (Feed, My Threads, Notifications) · Account.

## Known backend debt to resolve inside this task

- `isBuildersMember` is implemented **twice** — `MembersController` and
  `BuildersMembershipService`. Consolidate to one `@Global` service before
  adding member controllers, or the definition of "paid member" will drift.
- Packs have **no member-facing endpoint by design** (`packs.types.ts:8-15`
  states the registry gates nothing and access is administered on GitHub).
  A member Packs view needs that decision revisited explicitly.
- `/members/home` should be one aggregate endpoint, not five waterfall calls.

---

## Live validation environment (added during Batch 1)

The full stack runs locally and every batch is expected to verify against it
rather than against mocks:

| Service                           | Where                                                             |
| --------------------------------- | ----------------------------------------------------------------- |
| License server                    | `http://localhost:3000` — `/api/health` returns 200               |
| Postgres                          | container `ptah_postgres`, db `ptah_db`, user `ptah`              |
| Discourse (migration source only) | `http://localhost:3001`                                           |
| Dev proxy                         | landing-page dev server proxies `/api` and `/webhooks` to `:3000` |

Query the database with:
`docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "<sql>"`

### Seeded entitlement — read this before writing an exit gate

Batch 1 discovered that **no live user was entitled**: all three licenses were
`plan='community'` and there were zero subscriptions, so `isBuildersMember`
correctly returned false for everyone. The B1/B3/B6 exit gates in `tasks.md`
assume `entitled: true` and were therefore unreachable as written.

A dev license has been seeded to fix that:

- `abdallah@miramarstaffing.com` now holds `license_key='DEV-BUILDERS-VALIDATION-0001'`,
  `plan='builders'`, `status='active'`, `source='manual'`, `created_by='dev-validation'`.
- That account is also in `ADMIN_EMAILS`, so it exercises the entitled **and**
  admin paths.

Remove it with:
`delete from licenses where license_key='DEV-BUILDERS-VALIDATION-0001';`

**`member_group_assignments` is deliberately still empty.** That keeps A-2's
zero-cohort case — entitled member, no cohort — as the _default_ live state, so
every batch exercises it for free. Do not seed an assignment to make a test
pass; if a batch needs cohort-gated content, create the assignment inside the
test and remove it afterwards, the way Batch 1 did with the license flip.

### Pre-existing red test, fixed in Batch 1

`route-map.spec.ts` was already failing at HEAD — 66 routes discovered, 65
recorded. Commit `080cc3b3f` added `@Post(':eventId/invitations')` to
`admin-sessions.controller.ts` without recording it. Verified independently:
the route is in the controller at HEAD and absent from the spec at HEAD. Batch 1
recorded it with a comment noting the origin.

### Shared-file serialisation rule

Batches that edit shared registry files — `tsconfig.base.json`, `nx.json`,
`app.module.ts`, `route-map.spec.ts`, `eslint.config.mjs` — MUST NOT run
concurrently. Batches 1 and 2 were dispatched in parallel as "file-disjoint";
both needed a `tsconfig.base.json` path alias, which produced
"file modified since read" failures and looked like a rogue duplicate executor.
Parallelism is only safe when the shared-registry edits are disjoint too.
