# TASK_2026_202 — Curriculum restructure: 8 weekly modules → 10-day intensive

## User intent

The founder's assessment: "8 full weeks is not realistic for a project build
with coding agent and we will be building base modules (auth, user, billing,
projects, products, ai agents integrations, social media integrations with
zernio) i think a 2 week plan with at 3 hours a day would be sufficient".

## The format is an upgrade, not a downgrade

| | 8-week weekly | 2-week intensive |
| --- | --- | --- |
| Sessions | 8 | 10 (weekdays) |
| Live hours | ~12 | ~30 |
| Touchpoints | weekly drip | daily |

Denser, tighter feedback loop, more than double the live content, and it
finishes inside the free window instead of dragging past it. For a cohort whose
purpose is reputation-building before checkout opens, that is the better shape.

## Scope decision: 5 domains, not 7

The founder listed seven areas. Thirty live hours across seven domains is ~4h
each, and two of them do not compress:

- **Billing** — webhook idempotency and subscription state machines. The Ptah
  license server is living proof this is not a 4-hour topic.
- **Social integrations** — OAuth per platform, token refresh, rate limits, and
  Meta/X/LinkedIn app-review latency, which is calendar time no coding agent
  shortens. Highest-variance item on the list and mostly outside the editor.

Coding agents compress typing, not integration surprises or third-party
approval queues. So: five domains over ten daily modules, with ONE social
integration built end-to-end as the exemplar. The remaining platforms become the
post-cohort bonus session — which is the "one more completely free builders
session" the founder already wanted as a slot.

Proposed domain arc (module titles to be drafted by PM, founder reviews at
Checkpoint 1 — the curriculum is his):

1. Foundation — workspace, boundaries, CI
2. Auth + user + tenancy
3. Domain modelling — projects + products
4. Billing + entitlements
5. AI agent integrations + one social integration end-to-end

## Strategy

DOCUMENTATION, Partial depth: PM → Developer → Style Reviewer.

Note this is seed **data plus a mapping module with a hard count assertion**, not
prose — the developer step is real code work, not a markdown edit.

## Coupled touch points (change together)

- `docs/community/discourse-export.json:203-341` — the 8 "Week N build thread"
  topics.
- `apps/ptah-license-server/prisma/seed/map-course.ts` — `MODULE_TITLES` and
  `CURRICULUM_TOPIC_IDS`. **Line 196 hard-throws when the two lengths
  disagree**, so a partial edit fails the seed loudly rather than silently.
- `apps/ptah-license-server/prisma/seed/map-topics.ts`.
- `map-course.ts:61` — course description hardcodes "The eight-week Ptah
  Builders cohort, one module per week".
- Reseed via the community seed entry point; `community-seed.spec.ts` and
  `map-course` fixtures under `prisma/seed/__fixtures__` will need updating.

## Pre-existing defect to repair in the same pass

`map-course.ts:38-40` already documents it: source topic 21 is titled "Week 7
Hardening — tests, policies, observability" while its module title is simply
"Hardening". The seed notes this is "wrong today, not merely fragile".

## Mechanics that do NOT change

Date-based unlock already operates per module (`map-course.ts:10` — "R2.4.1's
date-based unlock operates on modules, so per-week modules are what the release
schedule needs"). A daily cadence needs new dates, not new mechanics. Likewise
every seeded lesson is manual-complete only (no `videoDurationSeconds`), and
`setAnswered` is admin-only because `Course.createdBy` is null — both unchanged.

## Out of scope

- Authoring actual lesson content/video for the 10 sessions.
- Anything in TASK_2026_201 (comp licences, invite email, approval flow).
- Changing the unlock or progress mechanics.

---

## Checkpoint 1 outcomes — founder decisions (2026-08-11)

The three `## Clarifications Needed` items in `task-description.md` are CLOSED,
the §4 module table is AMENDED, and one NEW requirement is added.

### C1 — Seeded environments: **none** (PM Option A confirmed)

Founder: "i didn't ever run seed community by hand."

Corroborating evidence gathered at the checkpoint: no GitHub workflow runs
`seed-community` or `prisma:migrate:deploy` — `ci.yml:89` and
`nightly-coverage.yml:62` run `prisma:generate` only, for typegen. And
`docs/deploy/founder-setup-checklist.md` §2.4 (`prisma:migrate:deploy` against
production) is still unchecked.

Consequence: the 18-module overlay proven in `task-description.md` §8 is a
LATENT hazard, not a live one. The FR-IDEM-2 cleanup runbook still ships — it is
correct and will be needed the first time anyone re-seeds a persistent database —
but no environment needs cleaning as part of this task. Risk R2 drops from
Critical to Low. **The seed still gains no delete verb.**

### C2 — Module table: **AMENDED**, replaces `task-description.md` §4

Founder agreed with the orchestrator's critique that the 5×2 symmetry was
forcing it: Day 6 (Products) was thin after Day 5 built the same pattern one
level up, and Day 10 (OAuth + encrypted storage + refresh + publish + failure
paths, live, as the finale) was the most optimistic session in the plan with
nowhere for overrun to go.

Products folds into Day 5; the integration splits across Days 9–10. The two
changes balance exactly — no days gained or lost.

| Day | Domain | Module title | What gets built |
| --- | --- | --- | --- |
| 1 | Foundation | The workspace — monorepo, boundaries, first green CI | Nx workspace, API + web app, enforced module boundaries, CI running lint/typecheck/test on every PR |
| 2 | Foundation | The database and the deploy pipe — Postgres, migrations, staging on merge | Postgres + ORM, first migration, config service, containerised deploy so every merge lands on a staging URL |
| 3 | Auth + tenancy | Sign-up, sign-in, session | Hosted auth end-to-end: redirect, callback, session cookie, route guard, a `/me` the web app actually calls |
| 4 | Auth + tenancy | Users, organisations and the tenancy boundary | User/org/membership models, roles, and the single place every query is tenant-scoped |
| 5 | Domain modelling | Projects and products — the aggregates and their contracts | Projects: schema, migration, ownership, soft delete, list/detail, web screens. Then products under a project — same pattern, faster because it is established: nested routing, boundary validation, shared wire contracts, pagination |
| 6 | Billing | Checkout — plans, prices and the first paid subscription | Payment provider setup, plan/price configuration, a working checkout session, the customer portal — a real card charged in test mode |
| 7 | Billing | Webhooks and entitlements — turning a payment into a durable fact | Signature verification, idempotent handlers, the subscription state machine, plan gates on the server and reflected in the UI |
| 8 | AI + integrations | The agent in the product — tools, streaming and cost control | Server-side agent endpoint with tools calling your own domain, streamed to the browser, with usage and rate limits |
| 9 | AI + integrations | Connecting an integration — OAuth and the token lifecycle | One social platform connected: OAuth handshake, encrypted token storage, refresh-before-expiry, and proving the connection survives a restart |
| 10 | AI + integrations | Publish, fail, retry — and launch | The agent drafts a post, the integration publishes it, and you handle the platform saying no: error taxonomy, retry with backoff, and the launch itself |

Domains are now deliberately UNEVEN — Domain modelling gets one day, AI +
integrations gets three. The evenness of the original draft was tidiness, not
weighting. Two consequences worth preserving in the docblock:

- The agent (Day 8) now lands AFTER entitlements (Day 7), so its cost control
  enforces real plan limits rather than hypothetical ones.
- Deploy stays on Day 2, which is what removes the Day-10 launch crunch a
  two-week format cannot absorb (unchanged from the original draft's reasoning).

`task-description.md` §4's curriculum decisions 1 and 3 (Hardening and Deploy
distributed rather than standalone; "Agents, memory and skills" narrowed to the
in-product agent) stand unchanged.

### C3 — Cohort start date: **Tuesday 1 September 2026**

⚠️ **Known consequence, accepted for now, cheap to change.** Weekdays only from
Tue 1 Sep puts Days 1–4 in week 1, Days 5–9 in week 2, and **Day 10 alone on
Monday 14 September** — the finale isolated on a third week after a weekend.

A Monday 31 August start would give a clean 5+5 across exactly two weeks ending
Fri 11 Sep. The founder was shown this and supplied 1 September. Because C4
below makes rescheduling a single admin action, this is recorded as a decision
that can be revisited without code change — NOT as an oversight to re-raise.

### C4 — NEW REQUIREMENT: reusable cohort scheduling

Founder: "i want an easy way to set the cohort start dates for this one and for
future ones as well."

This is scope ADDED at the checkpoint, explicitly requested. It resolves what
was previously framed as a gate/don't-gate argument: scheduling becomes a
capability that is **off by default and one action away**, so the founder
decides per cohort rather than the task deciding for him.

**Requirement.** One admin action takes a cohort start date and sets `releaseAt`
on every module of a course, in day order, on weekday offsets — skipping
weekends — so ten dates come from one input.

**Constraints that survive unchanged:**

- The SEED still never writes `releaseAt` (`community-seed.ts:520-524`,
  `:589-592`). FR-DATE-1 stands. Seeded modules are created open
  (`releaseAt = null`), and a re-run can never silently unschedule modules an
  admin has date-gated. Scheduling is an explicit, separate action.
- `ModuleLockService` (`module-lock.service.ts:55-110`) is NOT modified. The
  daily cadence needs new dates, not new mechanics — computing release dates at
  READ time from a course-level start date was considered and rejected for
  exactly this reason: it would move unlock logic into the read path and fight
  per-module admin overrides.
- Concrete `releaseAt` values are written, so a per-module override through the
  existing `PATCH /api/v1/admin/course-modules/:id`
  (`admin-course-modules.controller.ts:176`) still works afterwards and is not
  clobbered by anything other than a deliberate re-schedule.

**Reusability is the point, not a bonus.** It must work for cohort 2 and 3
without a code change. Note `COURSE_SLUG` is `ptah-builders-cohort-1`, so a
future cohort is a NEW course row — the action is therefore keyed on a course,
not hardcoded to this one, and must not assume ten modules.

**Left to the architect:** endpoint shape and placement, DTO, whether the
weekday-offset computation lives in a service or a pure helper, audit action,
idempotency, and what happens to modules already carrying a manual `releaseAt`.
The architect must also decide whether the action is preview-then-apply or
apply-directly — a mis-typed start date silently shifting ten member-visible
dates is the failure mode to design against.

FR-DATE-2's docblock offset table is still delivered, now as documentation of
what the action computes rather than as a manual procedure.

### C5 — Gating default: **open**

The seed continues to produce `releaseAt = null` — all modules open. The founder
applies a schedule via C4 when and if he wants one. Recorded so no implementer
"helpfully" ships the first cohort pre-gated.
