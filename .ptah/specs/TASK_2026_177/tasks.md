# Development Tasks - TASK_2026_177

**Total Tasks**: 137 | **Batches**: 16 | **Status**: 15/16 complete — **PHASE 1 CLOSED** (B1–B5 ✅) · **PHASE 2 CLOSED** (B6–B8 ✅, plus the B6.1 / B7.1 follow-ups) · **PHASE 3 CLOSED** (B9–B11 ✅, committed 2026-08-05) · **PHASE 4 CLOSED** (B12–B13 ✅, committed 2026-08-09; **B12's F-1 closed by B14**) · **PHASE 5 BACKEND CLOSED** (B14 ✅, committed 2026-08-10 as `54650edee`) · **PHASE 5 FRONTEND CLOSED** (B15 ✅, committed 2026-08-10 as `12ed2703f` · `3345904dd` · `a05714286` · `7408121b6`)
**Phase 1 batches**: 5 (fully decomposed) | **Phase 2**: 3 batches, 34 tasks (✅ complete) | **Phase 3**: 3 batches, **35 tasks** (B9 = 17, B10 = 11, B11 = 7 — **refined at the Phase-2/Phase-3 boundary, 2026-08-05**) | **Phase 4**: **26 tasks, ✅ COMPLETE** — B12 = 16 (backend, 2026-08-08), B13 = 10 (frontend, 2026-08-09; decomposed at the P4 BE/FE boundary and executed across two sessions) | **Phase 5**: batch-level, refined at its phase boundary

Native community platform (replaces Discourse). Decomposed from
`implementation-plan.md` §8 (build order + blocker table), §9 (risk→structure map),
§10 (handoff + verification points + CREATE/MODIFY/DELETE census).

**CLI delegation is DISABLED** (`context.md`, Checkpoint 0.1). Every batch executor is
a sub-agent — `backend-developer` or `frontend-developer`. No `codex`, no `copilot`,
no `ptah-cli`.

---

## Batch index

`Mode` is `parallel` only where the two batches are **file-disjoint** — the file sets are
listed in each batch below so the claim is checkable. Everything else is `sequential`
and says which shared file forces it (`tsconfig.base.json`, `controller-registry.ts`,
`route-map.spec.ts`, `forum.module.ts`, `panel-ui/src/index.ts`).

| ID      | Phase | Title                                                              | Executor           | Mode                     | Depends on                       | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ----- | ------------------------------------------------------------------ | ------------------ | ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1**  | 1     | P1a — `libs/api/membership` (R7 in full)                           | backend-developer  | parallel (w/ B2)         | —                                | ✅ COMPLETE `e954a531a`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **B2**  | 1     | P1c — `libs/api-contracts/community` (pure leaf)                   | backend-developer  | parallel (w/ B1)         | —                                | ✅ COMPLETE `6349c4b3e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **B3**  | 1     | P1d — `libs/api/member-hub` skeleton + entitlement probe           | backend-developer  | sequential               | B1, B2                           | ✅ COMPLETE `3d5484f40`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **B4**  | 1     | P1e — `libs/web/members` shell, guard, nav, theme, markdown preset | frontend-developer | sequential               | B2, B3                           | ✅ COMPLETE `cdc1a1ef5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **B5**  | 7     | P1b — Discourse removal, theme retirement, **migration 1**         | backend-developer  | sequential               | B1, B4                           | ✅ COMPLETE (`fd1b4557e`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B6**  | 2     | P2-BE — `libs/api/forum`, **migration 2**                          | backend-developer  | sequential               | B3, B5                           | ✅ COMPLETE `9260336e7` (+ `46f0cde07`, `229c4a85c`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **B7**  | 2     | P2-FE — community screens + the NFR-S2 chokepoint test             | frontend-developer | parallel (w/ B8)         | B4, B6                           | ✅ COMPLETE `d2b32d055` (+ B7.1, staged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **B8**  | 2     | P2-MIG — MG-1 seed (9 topics) + MG-5 decommission                  | backend-developer  | parallel (w/ B7)         | B6                               | ✅ COMPLETE `1cbe93a26`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **B9**  | 3     | P3-BE — `libs/api/youtube` + `libs/api/learning`, **migration 3**  | backend-developer  | sequential               | B5 (migration order), B1, B2, B3 | ✅ COMPLETE `a8d33adde` + `4d1c57707` + `aa38f5f42`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **B10** | 3     | P3-FE — course screens + the facade-then-player                    | frontend-developer | **sequential, after B9** | B4, B9                           | ✅ COMPLETE `254b99227` + `b56124fc0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **B11** | 3     | P3-MIG — seed the curriculum course (8 Week topics)                | backend-developer  | parallel (w/ B10)        | B8, B9                           | ✅ COMPLETE `e6cb8f49b` (Task 11.6 reassigned to B10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **B12** | 4     | P4-BE — live + private sessions, **migration 4**                   | backend-developer  | sequential               | B9                               | ✅ **COMPLETE — all 16 tasks, 2026-08-08.** Commits `10d5981e7` (12.1–12.3, 12.5 · migration 4 + F-1's `deleted_by`), `dca2735d3` (12.4 · contracts), `d574f62a7` (12.6–12.10 · `common/` + three services + DTOs), `ecf3603ec` (12.11–12.14 · four controllers, two modules, three registries), `42ce775ef` (12.15 · the hub three-way merge), `5f9572956` (Batch 11's F-1 lint, closed). Every exit-gate clause verified, **clauses 1 and 3 LIVE against the real Google Calendar API** — `ASSUMPTION-10 IS FALSE`, `GOOGLE_OAUTH_*` IS configured in this workspace. See `batch-12-report.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **B13** | 4     | P4-FE — live, replays, request-a-session                           | frontend-developer | sequential               | B4, B12                          | ✅ **COMPLETE — all 10 tasks, 2026-08-09.** Decomposed into 13.1–13.10 at the P4 BE/FE boundary, then executed across two sessions (the first was killed mid-flight after 13.9; its work was adopted, judged and extended rather than redone). Commits `5cc1fdd80` (13.2–13.3 · the two API services), `fc6e30773` (13.5–13.8 · the card, the three pages and the `startActivated` player input), `8a761df03` (13.9 · the three route swaps), `e9181716f` (a **real WCAG AA failure** the axe pass found in `panel-ui`'s `EmptyState` — pre-existing, not this batch's code), `db584deaa` (13.10 · the e2e proofs + live fixtures). Task 13.4 **declined the §5.3 promotion** — `panel-ui` has no barrel edit this batch. All five exit-gate clauses met, **1 and 3 LIVE** against the populated real-calendar feed (50 upcoming, 2 distinct titles, 44 days) with **two** identities. **B12's F-1 stays OPEN** — a `page.route()` stub is a client stub. See `batch-13-report.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **B14** | 5     | P5-BE — member packs, notifications, **migration 5**               | backend-developer  | sequential               | B6, B12                          | ✅ **COMPLETE — all 17 tasks, 2026-08-10.** One commit `54650edee` (14.1–14.17 · migration 5, `MemberPacksModule`, `libs/api/notifications`, the four producers, the two hub sections), dispatched in three sub-batches 14A/14B/14C to a `backend-developer`. `code-logic-reviewer` APPROVED after reproducing every gate itself (93/93 structural, 9 projects green across `eslint:lint,typecheck,test`) and independently verifying all six exit-gate clauses. **B12's F-1 is CLOSED** — the `503 scheduling_unavailable` branch is now driven server-side across `accept`/`reschedule`/`decline`, asserting no write on any of seven Prisma verbs, proven non-cosmetic by deliberate failure. `ScheduleModule.forRoot()` is the first scheduled job in this server. `MIN_TOTAL_PAYLOAD_PARAMS` 76 → 77. See `batch-14a-report.md`, `batch-14b-report.md`, `batch-14c-report.md`, `code-logic-review.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **B15** | 5     | P5-FE — packs, notification badge, full a11y + e2e pass            | frontend-developer | sequential               | B4, B14                          | ✅ **COMPLETE — all 11 tasks, 2026-08-10.** Shipped as **FOUR** commits, split by revertibility on B13's precedent: `12ed2703f` (**a new server endpoint this batch proved was missing** — `POST /v1/members/notifications/read`; 15A found `SelectionToolbar` had _no_ API that could honour "act on the N I selected", only one-row and whole-inbox, with no mark-unread, so `read-all` on a partial selection destroyed unread state irreversibly; ownership proven live with two real Postgres identities and by deliberate failure at unit **and** server level; `MIN_TOTAL_PAYLOAD_PARAMS` 77 → 78), `3345904dd` (**a real pre-existing a11y defect** — `DetailDrawer` kept content focusable while `aria-hidden`, axe `aria-hidden-focus` **serious**; `pointer-events-none` blocks the mouse and does nothing to the keyboard; fixed with `inert`; kept separate because it benefits the four admin consumers equally), `a05714286` (`SelectionToolbar`'s **first** spec after four admin consumers and zero coverage, plus the `/40` contrast sweep widened from `<p>` to every text-bearing element), `7408121b6` (15.1–15.11 · packs page with `accessNote` above the repo link, notifications page + store, `badgeCount` route-matched into the **existing** `navGroups`, placeholder retired, e2e). Dispatched as 15A/15B + a backend endpoint dispatch + a review-fix pass. `code-logic-reviewer` APPROVED with 0 blocking after independently re-running the deliberate-failure mutation and probing the generation scheme for wraparound and concurrent-write races. **Two defects found and fixed mid-batch**: the panel fetched the unread count **twice** per entry (measured live as `[unread-count, unread-count, hub]`), and the first repair introduced a race the reviewer caught where an in-flight count read could land _after_ a write and revert the badge for up to 60 s — resolved with a **write-generation stamp**, not a dirty flag, since a flag cannot tell "duplicate for the same navigation" from "represents new state". **15A's equivalence guard deliberately RETAINED** as a safety net on an irreversible write. **R6.2 re-run completely unedited and passing** four phases later (R6.6) — `members-content.spec.ts` is byte-identical to HEAD and appears in **no** commit; its stricter sibling in `members-courses.spec.ts` _did_ go red and caught the badge poll, because R6.2's filters are scoped to `/hub`, `/community`, `/search`. 🔴 **KNOWN, DELIBERATELY UNFIXED, ROUTED ELSEWHERE**: `text-base-content/60` measures **4.42:1** vs the required 4.5:1 in `operator-member-light`, affecting the shared panel nav and therefore **every** panel surface, member and admin — every axe pass in this repo before B15 ran in the dark theme only. Not fixed here because every failing element uses the _correct_ semantic token and the **token itself** is what is wrong; reviewer confirmed the scope call and that this diff does not worsen it. Gates: `web-members` 45/**933**, `web-panel-ui` 5/**41**, both lint-clean. See `batch-15a-report.md`, `batch-15b-report.md`, `bulk-read-endpoint-report.md`, `batch-15-fixes-report.md`, `code-logic-review-batch-15.md`. |
| **B16** | 5     | P5-CLOSEOUT — MG-4 Seshat harness + final documentation sweep      | backend-developer  | sequential               | B14, B15                         | ⏸️ PENDING                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Commit ledger — Phase 1 so far

| Commit      | Covers                                                                                          | Files |
| ----------- | ----------------------------------------------------------------------------------------------- | ----- |
| `e954a531a` | B1 — `libs/api/membership`                                                                      | —     |
| `6349c4b3e` | B2 — `libs/api-contracts/community`                                                             | —     |
| `3d5484f40` | B3 — member hub + entitlement probe                                                             | —     |
| `cdc1a1ef5` | **B4 — `/members` shell mount, member markdown preset, token lint rules, old-surface deletion** | 46    |
| `776696ede` | Review finding **F1** — calendar outage reports `unavailable`, not `empty`                      | 5     |
| `69f4ff78e` | Review findings **F2 + F4** — one `ADMIN_EMAILS` parse; de-personalised examples                | 10    |
| `2bf9ffb0a` | Review finding **F3** — `AppModule` boot smoke test (+ `@nestjs/testing` devDep)                | 3     |
| `0fdbdc094` | Review finding **F5** — handoff-doc paths broken by `1bea0f634`                                 | 1     |
| `af2d22653` | B4 addendum 2 — cross-panel nav links between the member and admin panels                       | 10    |
| `496ad5c5c` | B4 addendum 2 — post-login landing resolved from identity                                       | 8     |

### Commit ledger — Phase 2

`git log --oneline` order is newest-first, so the ledger below reads bottom-up against it.
**Batch 7.1 is the one exception: it is STAGED IN THE INDEX AND NOT YET COMMITTED** at the
time of this refine pass (`git status --short` shows `A  …/my-threads-page.ts` and four
`M ` siblings). Whoever commits next must stage path-by-path — the index also carries 19
foreign files from the concurrent `task-specs`/`tasks-ui` process (PRE-7 / RK-10).

| Commit                  | Covers                                                                                   | Note                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `9260336e7`             | **B6 — `libs/api/forum` (68 files, 9 services, 5 controllers, 26 routes) + migration 2** | Three sequential dispatches: 6A (6.1–6.5), 6B (6.6–6.11), 6C (6.12–6.15)               |
| `46f0cde07`             | B6 follow-up — three docblocks that argued against themselves                            | Post-review, kept separately revertible                                                |
| `1cbe93a26`             | **B8 — the MG-1 community seed** (11 files under `prisma/seed/`, +38 tests)              | 4 categories / 9 topics / **10** posts — see the Batch 8 result for the 11th           |
| `229c4a85c`             | **B6.1 — the three backend defects Batch 7 found by driving the real API**               | F-1 unread units (4 sites), F-2 `@IsOptional()` null→500 (12 fields), F-3 `?mine=true` |
| `d2b32d055`             | **B7 — the member community screens + the NFR-S2 render chokepoint**                     | 10 of 11 tasks; 7.6 blocked and reported                                               |
| _(staged, uncommitted)_ | **B7.1 — My Threads + the promoted unread e2e**                                          | Closes B7's one blocked task and its one `test.fail()`                                 |

**The Phase-2 pattern worth repeating, stated once here because it is the process finding
rather than a code finding**: Batch 7 hit three server defects, **reported them instead of
working around them**, and got a `?mine=true` boolean rather than an `?authorId=`
enumeration hole and a four-site unit fix rather than a one-line repair that would have
broken a write path. `blocked → reported → fixed in a scoped follow-up → closed` cost two
extra dispatches and produced a better API than the un-blocked path would have. **Phase 3
should expect the same and budget for it** — B9 and B10 have the same shape (a backend the
frontend is the first real consumer of), and B10 is the batch most likely to find a B9
defect.

Findings F1–F5 came out of post-Batch-3/4 review and are committed separately from the
batch work so each stays independently revertible. F2 and F4 share `admin.guard.ts`, so
they could not be split further at file granularity.

**Known-red between B4 and B5** — `apps/ptah-landing-page-e2e/src/specs/members-content.spec.ts`
and `members-gate.spec.ts` are **deliberately failing** as of `cdc1a1ef5`. They assert against
the deleted `@ptah-web/account` members surface and stub `communityUrl`, both of which B4
removed on purpose (RISK-C ordering: frontend first, backend second). **Task 5.6 owns their
rewrite** (see lines ~1347 and ~1362). Do not "fix" them anywhere else, and do not read their
failure as a B4 regression.

**Migration authority** — five owners, nobody else. Prisma migration directory names
embed a timestamp, so two developers authoring concurrently produce a silent ordering
conflict. **No batch outside this table may run `prisma migrate dev`, create a directory
under `apps/ptah-license-server/prisma/migrations/`, or edit a `schema.prisma` model.**

| Migration | Owner   | Name suffix                                                          |
| --------- | ------- | -------------------------------------------------------------------- |
| 1         | **B5**  | `drop_discourse_group`                                               |
| 2         | **B6**  | `community_forum` (+ hand-written `pg_trgm` and two trigram indexes) |
| 3         | **B9**  | `courses` (+ hand-written lesson-title trigram index)                |
| 4         | **B12** | `live_and_private_sessions`                                          |
| 5         | **B14** | `packs_visibility_and_notifications`                                 |

Migration owners run `npx prisma migrate dev --create-only --name <suffix>`, hand-edit
the SQL, then `npx prisma migrate dev` to apply against the running `ptah_db`. Keep the
plan's **name suffix** but let Prisma generate the timestamp — the plan's hand-picked
future dates (`20260902…`, a month out) would sort _after_ a real migration authored in
the interim and silently invert the order.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS — no blockers. The plan is unusually
well-evidenced; every structural claim I re-verified held. Six risks are recorded
below, four of which change the batch ORDER rather than the plan.

### Assumptions verified against source

| #   | Claim                                                       | Verified at                                                                                                                   | Verdict                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1 | `@ptah-web/panel-ui` exports the nine symbols               | `libs/web/panel-ui/src/index.ts`                                                                                              | ✅ **8 export lines, 9 symbols** — `panel-nav.types` yields both `PanelNavItem` and `PanelNavGroup`. Do not "correct" the count to 8.                                                                                      |
| V-2 | `dtoPipe(Dto)` is the server-wide, mandatory mechanism      | `libs/api/core/src/lib/common/dto-validation.pipe.ts:1-60`                                                                    | ✅ Docblock is explicit: _"EVERY `@Body()`/`@Query()` payload param MUST bind `dtoPipe(TheDto)`. A bare `@Body() dto: X` is SILENTLY UNVALIDATED."_ esbuild emits no `emitDecoratorMetadata`.                              |
| V-3 | A shared controller registry gates every new controller     | `apps/ptah-license-server/src/testing/controller-registry.ts`                                                                 | ✅ Census assertion fails the build on any `*.controller.ts` missing from the list. Currently imports `AdminCommunityController`, `CommunityController`, `DiscourseController`.                                            |
| V-4 | `scope:api-contracts` exists, unused, pure leaf             | `eslint.config.mjs:88-130`                                                                                                    | ✅ `onlyDependOnLibsWithTags: ['scope:api-contracts']`. `scope:web`, `scope:api`, `scope:app`, `scope:landing` all permitted to depend on it. **`libs/api-contracts/` does not exist on disk** — Batch 2 creates the root. |
| V-5 | AD-1: markdown chokepoint already reachable from `libs/web` | `libs/frontend/markdown/project.json` tags `["scope:shared","type:ui"]`; `apps/ptah-landing-page/src/app/app.config.ts:14,43` | ✅ Landing app already calls `provideMarkdownRendering({ extensions: 'basic' })`. `scope:web → scope:shared` and `type:feature → type:ui` both permitted. **No lint change needed.**                                       |
| V-6 | `discourse/` is 17 files                                    | `libs/api/community/src/lib/discourse/`                                                                                       | ✅ 16 files + `dto/admin-community.dto.ts` = 17. 11 export lines in `libs/api/community/src/index.ts:6-16`.                                                                                                                |
| V-7 | AD-12 re-declaration is required                            | `libs/api/community/src/lib/google-sessions/members.controller.ts:37,53`                                                      | ✅ `@Controller('v1/members')` + `@Get('sessions')`.                                                                                                                                                                       |

### Risks identified

| #          | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Sev  | Mitigation                                                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-A** | **`isBuildersMember` has THREE implementations, not two.** `discourse/builders-membership.service.ts:24`, `google-sessions/members.controller.ts:106`, **and `discourse/discourse.controller.ts:182`**. `context.md` and plan §2.3 name only the first two. The third dies with the P1b directory deletion, not with P1a. R7.2's unqualified gate (`rg 'isBuildersMember'` → one implementation) is therefore **not satisfiable at the end of Batch 1**. | HIGH | Two-stage assertion. Task 1.6 asserts _one implementation outside `libs/api/community/src/lib/discourse/`_; Task 5.7 asserts the unqualified R7.2 gate after deletion.                                                                                                                |
| **RISK-B** | **RI-1 prefix collision.** `v1/members` (`MembersController`) is a strict prefix of `v1/members/hub` and `v1/members/entitlement`. Landing the hub controllers before AD-12's re-declaration fails `route-map.spec.ts` RI-1 and blocks the build.                                                                                                                                                                                                        | HIGH | AD-12 is **Task 1.5**, one batch before the hub batch. Task 3.6 re-runs `route-map.spec.ts` as its gate.                                                                                                                                                                              |
| **RISK-C** | **Cross-side same-commit coupling on `communityUrl`.** §3.2 requires backend drop + frontend Zod-schema drop _in the same commit_, which would force backend and frontend into one batch (forbidden).                                                                                                                                                                                                                                                    | MED  | Verified asymmetric: `z.object()` **strips** unknown keys, so a frontend schema that already dropped `communityUrl` tolerates a backend still sending it; the reverse breaks. **Frontend drops first (Batch 4), backend second (Batch 5).** This is the reason P1e precedes P1b here. |
| **RISK-D** | **`/members` route continuity.** `libs/web/account/src/lib/members/` currently serves `/members` and calls `getCommunitySummary()`. Deleting the service method before its caller breaks typecheck; deleting the caller before `MEMBER_ROUTES` exists leaves `/members` unrouted.                                                                                                                                                                        | MED  | Batch 4 performs the route swap, the 4-file deletion and the `members-api.service.ts` edit **atomically in one batch**.                                                                                                                                                               |
| **RISK-E** | **`libs/api-contracts/` is a new top-level lib root.** `nx.json` declares no `workspaceLayout`, so default discovery applies — but `$schema`, `rootDir` and jest `preset` relative depths must match a known-good sibling.                                                                                                                                                                                                                               | MED  | Task 2.1 copies depths verbatim from `libs/api/community` (both are 3 levels deep: `libs/<root>/<lib>`). Verification is `nx show project api-contracts-community`.                                                                                                                   |
| **RISK-F** | **`type:util → onlyDependOnLibsWithTags: ['type:util']`** (`eslint.config.mjs`). `libs/api/membership` and `libs/api/youtube` are tagged `type:util`, so they may depend **only** on `type:util` libs. A `type:feature` collaborator would fail lint.                                                                                                                                                                                                    | MED  | Task 1.1 re-runs the tag census on `api-core`/`api-identity`/`api-audit` before scaffolding. Per-task verification is `nx lint api-membership`.                                                                                                                                       |

### Assumptions this decomposition takes

- **ASSUMPTION-1 — P1b is sequenced AFTER P1e.** §8.1's normative blocker table lists
  `P1a → P1b` and nothing else pointing into P1b. The ASCII graph draws P1b above
  P1c/P1d/P1e, but the table governs (orchestrator instruction: _"Real blockers only"_).
  Reordering resolves RISK-C and RISK-D at zero cost. Reverse this deliberately if the
  release train needs Discourse gone earlier.
- **ASSUMPTION-2 — Batch 2 (P1c contracts) has no dependency on Batch 1.** It is a pure
  leaf (`onlyDependOnLibsWithTags: ['scope:api-contracts']`). It may run concurrently
  with Batch 1 if the orchestrator has capacity.
- **ASSUMPTION-3 — `panel-ui` primitive promotions are distributed, not batched.** §5.3
  names five promotions (`TagChip`, `ThreadRow`, `SessionCard`, `CalendarMonth`,
  `ProgressMeter`). Each is promoted in the frontend batch that first renders it, not in
  a speculative up-front batch — which is the rule §5.3 itself states.

### Edge cases to handle

- [ ] Entitled member with **no** `MemberGroupAssignment` → empty `cohortKeys`, sees all `member`-visibility content, never errors (R7.8, A-2) → Tasks 1.3, 1.4
- [ ] Authenticated user **without** entitlement → `200 { entitled: false }`, frontend routes to `/pricing`, never a raw 403 or an empty panel (R7.7) → Tasks 3.2, 4.5
- [ ] Unauthenticated caller → `401`, frontend routes to `/login?returnUrl=/members` (never conflated with unentitled) → Tasks 3.2, 4.5
- [ ] One hub section fails or is disabled → `200` with `{ status: 'unavailable' }`, page not blanked (R6.4, NFR-R3) → Task 3.3
- [ ] `GOOGLE_OAUTH_*` unset in Phase 1 → sessions section still resolves via `@Optional() @Inject`, no `500` (NFR-R1) → Task 3.4
- [ ] `base-300` used as a **border** → the specific error `panel-theme-spec.md` §2 exists to prevent (NFR-U2) → Task 4.7
- [ ] `MarkdownRenderingConfig.extensions` widens `'full' | 'basic'` → `'full' | 'basic' | 'member'`; both existing consumers must keep compiling → Task 4.2

---

## Batch dependency graph

```
 Batch 1 (P1a membership, BE) ──┬──────────────┐
                                │              │
 Batch 2 (P1c contracts, BE) ───┴─▶ Batch 3 ───┴─▶ Batch 5 (P1b removal, BE)
   [no dep — may run with B1]      (P1d hub, BE)        ▲
                                         │              │
                                         └─▶ Batch 4 ───┘
                                             (P1e shell, FE)
 ── Phase 1 complete ───────────────────────────────────────────────────────
 B5 ─┬─▶ Batch 6  (P2 forum BE, migration 2) ─┬─▶ Batch 7  (P2 community FE)
     │                                        └─▶ Batch 8  (P2 MG-1 seed, 9 topics)
     ├─▶ Batch 9  (P3 youtube+learning BE, migration 3) ─┬─▶ Batch 10 (P3 courses FE)
     │                                                   └─▶ Batch 11 (P3 MG-1 course)
     └─▶ [B9] ─▶ Batch 12 (P4 live+private BE, migration 4) ─▶ Batch 13 (P4 live FE)
 B6 + B12 ─▶ Batch 14 (P5 packs+notifications BE, migration 5) ─▶ Batch 15 (P5 FE)
                                                                 └─▶ Batch 16 (closeout)
```

Edges, and the §8.1 row each comes from:

| Edge                                  | Source                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B1 → B3, B4, B5, B6, B9, B12, B14     | "P1a `membership` blocks every member controller in P2–P5" + "P1a blocks P1b (MG-2.2 / RK-4: relocate and test first, delete second)" |
| B2 → B3, B4, and every later batch    | "P1c contracts lib blocks every backend member surface and `libs/web/members`"                                                        |
| B3 → B4                               | frontend `MemberGuard` probes `GET /members/entitlement`; hub page consumes `GET /members/hub`                                        |
| B3 → B6, B9, B12, B14                 | "P1d hub skeleton blocks P2/P3/P4/P5 hub extensions (R6.6 — later phases extend)"                                                     |
| B4 → B7, B10, B13, B15                | "P1e shell + routes blocks every member screen"                                                                                       |
| B4 → B5                               | RISK-C: frontend drops `communityUrl` first (safe direction only)                                                                     |
| B6 → B14                              | "P2 `forum` blocks P5 notifications _producers_"                                                                                      |
| B6 → B8 → MG-5                        | "P2 MG-1 verified in prod blocks MG-5 decommission (MG-5.3: never before)"                                                            |
| B9 → B12                              | "P3 `youtube` lib blocks P4 live-session metadata (R3.2 reuses R2.2's provider)"                                                      |
| B5 → B6 → B9 → B12 → B14 (migrations) | "migration N blocks migration N+1 — forward-only, sequential"                                                                         |

**Explicitly NOT blockers** (§8.1), so these may run concurrently if capacity allows:
B6 ↮ B9 (`forum` and `learning` share no model, service or route prefix) · B9 ↮ B12
beyond the `youtube` lib · frontend ↮ backend within a phase (the contracts lib is what
makes the stub type-accurate).

🔴 **ONE DEPARTURE, taken at the Phase-3 refine pass: B10 is SEQUENTIAL AFTER B9, not
parallel with it.** §8.1's "frontend ↮ backend within a phase" is true in principle and wrong
here, for two reasons Phase 2 established empirically:

1. **`z.object()` strips unknown keys but does not invent them.** A client schema that omits a
   field tolerates a server that sends it; the reverse breaks. Every required field must reach
   the server before the client schema declares it — RISK-C's asymmetry, which is also why B4
   preceded B5.
2. **B7's three findings all came from driving the real API** and none was visible from inside
   the backend's own tests. Building against a stub defers that discovery to the e2e run.
   **B10 ↮ B11 remains genuinely parallel** — their file sets are disjoint including every
   shared-registry file — with one caveat recorded in both batches: B10's exit-gate clause 1
   needs B11's seed to exist, so B10's _browser and e2e_ checks must follow B11 unless B10 seeds
   its own throwaway course and tears it down by id.

🔴 **B9 CANNOT overlap ANYTHING.** It edits `tsconfig.base.json` **twice**, plus
`schema.prisma`, `app.module.ts`, `controller-registry.ts`, `route-map.spec.ts` and
`controller-validation.spec.ts`. `context.md`'s serialisation rule exists because two
"file-disjoint" batches both needed a `tsconfig.base.json` alias and collided.

---

## Preconditions every batch must confirm before writing code

Folded in from plan §10. A developer confirms these **first**, in the batch that touches
the relevant area, and states the confirmation in their report.

| #         | Precondition                                                                                                                                                                                                                                                                                           | Applies to                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **PRE-1** | `dtoPipe(Dto)` binds on **every** `@Body()` / `@Query()` whole-object payload param. Read `libs/api/core/src/lib/common/dto-validation.pipe.ts` first. A bare `@Body() dto: X` is silently unvalidated (esbuild emits no `emitDecoratorMetadata`) and `controller-validation.spec.ts` fails the build. | every backend batch with a controller                    |
| **PRE-2** | Every new controller is added to `apps/ptah-license-server/src/testing/controller-registry.ts` **in the same commit that creates it**. The census assertion fails otherwise.                                                                                                                           | every backend batch with a controller                    |
| **PRE-3** | `@ptah-web/panel-ui` exports exactly the nine symbols at `libs/web/panel-ui/src/index.ts` (8 export lines). Anything else must be added there first, and only when a second panel actually renders it (§5.3).                                                                                          | every frontend batch                                     |
| **PRE-4** | The `'member'` markdown preset is added **inside** `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts` and nowhere else. No second renderer, no second sanitizer, no `[innerHTML]` (NFR-S2, RK-2).                                                                                          | Batch 4, and every frontend batch rendering user content |
| **PRE-5** | `GoogleCalendarProvider` / `GoogleAuthProvider` already exist and already resolve the Meet link from `hangoutLink` / `conferenceData`. **No Meet API is called and none is built** (R4.1, §5).                                                                                                         | Batch 12                                                 |
| **PRE-6** | `AuditLogService.write` accepts a `tx` (`audit-log.types.ts` `WriteAuditLogParams.tx`). Every admin mutation enlists its audit row in the mutation's own `$transaction` (R8.5, `packs.service.ts:98-141` pattern).                                                                                     | every backend batch with an admin mutation               |
| **PRE-7** | RK-10: the working tree carries unrelated WIP and `TASK_2026_176` is active in the same specs directory. Never write into another task's folder. Never bypass hooks with `--no-verify`. Stop and report on out-of-scope failures rather than fixing neighbouring WIP.                                  | every batch                                              |

---

## Verification protocol — the stack is live, so use it

The full stack is running locally. **A batch is not done when `typecheck` and unit tests
pass.** It is done when the endpoint answered, the migration applied against the real
database, or the page rendered in a browser. Every task's `Verification` block below is
the _minimum_; the checks named here are additionally required at each batch's exit gate.

| Handle      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `V-HEALTH`  | `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health` → `200`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `V-TOKEN`   | Browser path: `npx nx serve ptah-landing-page` (proxies `/api` + `/webhooks` → `:3000`), log in at `http://localhost:4200/login` as `abdallah@miramarstaffing.com`, copy the token from devtools → `export TOKEN='<paste>'`. **Headless path** (a sub-agent cannot use a browser): sign the documented `JWTPayload` shape with `JWT_SECRET` from the workspace-root `.env` — the same secret `JwtModule` is configured from — for the dev user's real `users.id`, short expiry, and delete the token file afterwards. B6 used this. |
| `V-CURL`    | `curl -s -b "ptah_auth=$TOKEN" http://localhost:3000/api/v1/...  \| jq` — ⚠️ **CORRECTED 2026-08-05 (B6 C-3).** This previously read `-H "Authorization: Bearer $TOKEN"`, which **never authenticates**: `libs/api/identity/src/lib/guards/jwt-auth.guard.ts` reads `request.cookies['ptah_auth']` and never looks at the `Authorization` header. Every V-CURL in this file, including B1's and B3's recorded-as-passing ones, returns `401` when run exactly as it was written.                                                    |
| `V-DB`      | `psql "$DATABASE_URL" -c '<sql>'` (`DATABASE_URL` from `$ROOT/.env`); in practice use `docker exec ptah_postgres psql -U ptah -d ptah_db -tAc '<sql>'`                                                                                                                                                                                                                                                                                                                                                                              |
| `V-MIG`     | ⚠️ **SUPERSEDED for this task — do NOT run `prisma migrate dev` in this workspace.** See Task 6.4 and RISK-K. Hand-author the folder, generate the DDL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, then `npx prisma migrate deploy` → `npx prisma migrate status`.                                                                                                                                                                                                               |
| `V-BROWSER` | render the surface at `http://localhost:4200/members/...` in **both** `operator-member` and `operator-member-light` (NFR-U5)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `V-NX`      | `npx nx lint <project> && npx nx typecheck <project> && npx nx test <project>`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

`abdallah@miramarstaffing.com` is in `ADMIN_EMAILS` **and** exists in `users`, so both
`/admin` and `/members` are reachable through a real login. No static harness is needed
and none should be built.

### The live data state is a free test, not an obstacle

| Table                    | Rows  | What it lets us prove for real                                      |
| ------------------------ | ----- | ------------------------------------------------------------------- |
| `users`                  | 3     | real login, real JWT, real `MemberContext`                          |
| `licenses`               | 3     | entitlement resolves from `License`/`Subscription` (A-2 first half) |
| `member_groups`          | 1     | the cohort key the MG-1.4 mapping needs — **but see RISK-G below**  |
| member-group assignments | **0** | ⭐                                                                  |
| `packs`                  | 0     | member Packs list renders `EmptyState`, not a crash (R5, R6.3)      |

⭐ **Zero assignments with three entitled users is exactly the case A-2 and R7.8 exist to
handle** — "an entitled member with no `MemberGroupAssignment` sees all `member`-visibility
content and no `cohort`-gated content, and SHALL NOT error". Conflating entitlement with
cohort would lock all three real users out of the product entirely, and the current data
makes that failure reproduce on the first request rather than in production. Therefore:

- **B1 exit gate** — `V-CURL` on `GET /api/v1/members/entitlement` returns
  `200 { entitled: true, cohorts: [], isAdmin: true }`. Not `403`, not `500`, and
  `cohorts: []` must not be an error path. This is Task 1.3 / 1.4's real-world assertion.
- **B3 exit gate** — `V-CURL` on `GET /api/v1/members/hub` returns `200` with every
  section present for a zero-cohort member.
- **B6 exit gate** — a `visibility: 'cohort'` category is **invisible** to this same
  account (`404`, never `403` — R1.1.3) while `visibility: 'member'` categories are
  visible. One account proves both halves of the entitlement/cohort split.

### RISK-G — added during this audit · ✅ **CLOSED 2026-08-04, EMPIRICALLY**

> Verified against the live dev database: `member_groups` holds exactly one row,
> `key='founding'`, `is_default = true`. The seed's cohort key resolves. **B8 still runs its
> pre-flight check** — the risk is closed for today's data, not for all time, and the abort
> path is what makes a future empty/defaultless table loud instead of silent.

**Original statement — the single `member_groups` row's `is_default` value was unverified,
and B8's seed aborts without a default.** MG-1.4 maps Builders Lounge → `cohort` with
`cohortKeys = [<default MemberGroup.key>]`, resolved from `MemberGroup where isDefault: true`,
and `implementation-plan.md:1675` states the seed **aborts with an actionable message**
rather than seeding an ungated cohort category. Severity MED.

**Mitigation**: B8 opens with a pre-flight `V-DB` check —
`select key, is_default from member_groups;`. If no default exists, set one through the
existing admin surface **before** seeding. Do not weaken the abort, and do not hardcode
the key: the abort is the control that stops a cohort-gated category from being seeded
wide open.

---

# PHASE 1 — Foundation (fully decomposed, immediately actionable)

**Ships**: members can sign into a working `/members` panel.
**Phase 1 exit gate (§8.2)**: `rg 'isBuildersMember'` → one implementation ·
`rg -i discourse` (excluding the export JSON) → zero hits · `/members` renders with
`PanelLayout` in **both** themes · the hub responds in **one** request (asserted) ·
`members.routes.spec.ts` green · `nx lint`, `typecheck`, `test`, `nx graph` clean.

---

## Batch 1: P1a — `libs/api/membership` (R7) ✅ COMPLETE (`e954a531a`)

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn; no frontend substitute — this is pure NestJS/Prisma)
**Execution Mode**: sequential
**Rationale**: Five tightly coupled files in one new lib, each importing the previous
(`MemberContext` → `MembershipService` → `CohortResolver` → `MemberGuard` → module).
Architecture decisions are live throughout (tag choice under RISK-F, the verbatim
relocation under RK-4). §8.1 makes this the single hardest blocker in the task — it
gates every member controller in P2–P5. Not parallel-eligible: shared new project scaffold.
**Tasks**: 6 | **Dependencies**: none — this is the root of the graph
**Preconditions**: PRE-1, PRE-2, PRE-6, PRE-7

---

### Task 1.1: Scaffold the `libs/api/membership` Nx project ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\membership\project.json`
- `D:\projects\ptah-extension\libs\api\membership\tsconfig.json`
- `D:\projects\ptah-extension\libs\api\membership\tsconfig.lib.json`
- `D:\projects\ptah-extension\libs\api\membership\tsconfig.spec.json`
- `D:\projects\ptah-extension\libs\api\membership\jest.config.cts`
- `D:\projects\ptah-extension\libs\api\membership\README.md`
- `D:\projects\ptah-extension\libs\api\membership\src\index.ts`
- `D:\projects\ptah-extension\tsconfig.base.json`

**Requirement refs**: AD-6, NFR-M2, NFR-M4
**Pattern to follow**: `libs/api/community/project.json` — copy structure verbatim, same directory depth.

**Implementation details**:

- `{ "name": "api-membership", "tags": ["scope:api", "type:util"] }`
- `tsconfig.base.json` path: `"@ptah-api/membership": ["./libs/api/membership/src/index.ts"]`
- README states _why_ this is a lib and not a directory: RK-4 — the membership definition
  must survive the deletion of `libs/api/community/src/lib/discourse/`, and being in a
  different Nx project makes that survival **structural, not procedural**.

**Validation notes**:

- **RISK-F**: `type:util → onlyDependOnLibsWithTags: ['type:util']`. Before scaffolding,
  confirm `api-core`, `api-identity` and `api-audit` are all tagged `["scope:api","type:util"]`.
  If any is `type:feature`, STOP and report — the tag choice is wrong, not the dependency.

**Verification**:

```
nx show project api-membership
npx nx lint api-membership
```

Both must succeed with the project resolved and zero boundary violations.

---

### Task 1.2: `MemberContext` + `MembershipService` — the one `isBuildersMember` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\membership\src\lib\membership.types.ts`
- `D:\projects\ptah-extension\libs\api\membership\src\lib\membership.service.ts`
- `D:\projects\ptah-extension\libs\api\membership\src\lib\membership.service.spec.ts`

**Requirement refs**: R7.1, R7.2, R7.4, R7.5, R7.6, A-2, RK-3, RK-4, MG-2.2
**Pattern to follow**: `libs/api/community/src/lib/discourse/builders-membership.service.ts:24-44`

**Implementation details**:

- `MembershipService.isBuildersMember(userId)` is `builders-membership.service.ts:24-44`
  **moved verbatim** — the subscription-then-license query, DB-resolved, never JWT-resolved.
  Do not "improve" it during the move; a behaviour change here is indistinguishable from
  the drift R7 exists to stop.
- `MemberContext` per plan §2.3: `{ userId, email, entitled, cohortKeys, isAdmin }`, all `readonly`.
- A-2 separation is structural: `entitled` derives from `License` / `Subscription` only.
  `cohortKeys` is **not** computed here — that is Task 1.3.
- Prisma errors → sanitized typed exceptions, never a raw dependency message
  (`packs.service.ts:277-313` pattern, NFR-S7).

**Validation notes**:

- R7.4's five cases are mandatory and each must be a distinct `it()`: active paid member ·
  expired/lapsed member · admin who is **not** a member · member with an entitlement but
  **no** cohort assignment · unauthenticated caller.
- The fourth case is the A-2 edge: it must return `entitled: true`, not throw.

**Verification**:

```
npx nx test api-membership --testPathPatterns=membership.service.spec
```

All five R7.4 cases green.

---

### Task 1.3: `CohortResolver` — `MemberGroupAssignment` → cohort keys ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\membership\src\lib\cohort-resolver.service.ts`
- `D:\projects\ptah-extension\libs\api\membership\src\lib\cohort-resolver.service.spec.ts`

**Requirement refs**: R7.3, R7.6, R7.8, A-2, AD-10
**Dependencies**: Task 1.2

**Implementation details**:

- Read-only. One query: `MemberGroupAssignment` → `readonly string[]` of `MemberGroup.key`.
- Never writes, never derives entitlement. The two predicates stay separate (A-2).

**Validation notes**:

- **Edge case (R7.8)**: an entitled member with **zero** assignments returns `[]` — normal,
  never an error, never a throw. A-2's whole reasoning is that a data-entry omission must
  degrade to "missing some content", not "denied access".
- AD-10: cohort matching downstream is `hasSome` against a `String[]` column, so a stale
  key matches nobody — restrictive by direction. Nothing here needs to reconcile.

**Verification**:

```
npx nx test api-membership --testPathPatterns=cohort-resolver.service.spec
```

Includes an explicit "no assignments → `[]`, no throw" case.

---

### Task 1.4: `MemberGuard` — resolve `MemberContext` once per request ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\membership\src\lib\guards\member.guard.ts`
- `D:\projects\ptah-extension\libs\api\membership\src\lib\guards\member.guard.spec.ts`

**Requirement refs**: R7.3, R7.7, NFR-S8, RK-3
**Dependencies**: Tasks 1.2, 1.3

**Implementation details**:

- Runs **after** `JwtAuthGuard`. Resolves entitlement + cohort keys once and attaches
  `req.memberContext`. Cohort resolution happens **in the guard** so no service re-derives
  it (R7.3) and no controller can forget it.
- On failure: `403 { reason: 'membership_required' }` — the exact shape
  `isMembershipRequiredError()` in `libs/web/core/src/lib/services/members-api.service.ts`
  already parses. Do not invent a new error shape.

**Validation notes**:

- Every member controller in P2–P5 will declare `@UseGuards(JwtAuthGuard, MemberGuard)` at
  **class** level. This guard is the single server-side enforcement point NFR-S8 names.
- Empty `cohortKeys` must **allow** the request (R7.8), not deny it.

**Verification**:

```
npx nx test api-membership --testPathPatterns=member.guard.spec
```

Cases: entitled+cohorts → allow · entitled+no cohorts → allow with `[]` · not entitled → 403 with `{ reason: 'membership_required' }` · no JWT user → 403.

---

### Task 1.5: `MembershipModule` (@Global), app wiring, and AD-12 route re-declaration ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\membership\src\lib\membership.module.ts`
- `D:\projects\ptah-extension\libs\api\membership\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts`
- `D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\members.controller.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`

**Requirement refs**: R7.1, R7.3, AD-12, RK-3
**Dependencies**: Tasks 1.2, 1.3, 1.4
**Pattern to follow**: `discourse.module.ts` / `MemberGroupsModule` `@Global()` registration.

**Implementation details**:

- `@Global()` module exporting `MembershipService`, `CohortResolver`, `MemberGuard`.
  Registered in `app.module.ts` **before every consumer** (R7.3).
- **Delete** the private `isBuildersMember` at `members.controller.ts:106-129` and re-point
  its call site (`:63`) to `MembershipService`. Deleted, not merged — the surviving copy is
  the extracted one.
- **AD-12**: re-declare `@Controller('v1/members')` + `@Get('sessions')` as
  `@Controller('v1/members/sessions')` + a bare `@Get()`. The resolved URL is
  byte-identical (`/api/v1/members/sessions`), so no contract changes.
- Update `route-map.spec.ts` `EXPECTED_ROUTES` to match the re-declaration.

**Validation notes**:

- **RISK-B is why this task is here and not in Batch 3.** `v1/members` is a strict prefix of
  `v1/members/hub` and `v1/members/entitlement`. Landing the hub controllers first fails
  `route-map.spec.ts` RI-1 and blocks the build. This re-declaration makes every member
  controller a sibling at a fixed depth-3 **literal** segment.
- No member controller may declare a route parameter at segment 3, in this task or ever.

**Verification**:

```
npx nx test ptah-license-server --testPathPatterns=route-map.spec
npx nx test ptah-license-server --testPathPatterns=controller-validation.spec
```

Both green; `/api/v1/members/sessions` still resolves identically in `EXPECTED_ROUTES`.

---

### Task 1.6: Batch-1 membership-consolidation assertion (scoped) ✅ COMPLETE

**Files**: (assertion only — no new source file)
**Requirement refs**: R7.2, RK-3
**Dependencies**: Tasks 1.2, 1.5

**Implementation details**: run the repo-wide search and record the result in the report.

**Validation notes**:

- **RISK-A**: three implementations exist today —
  `libs/api/community/src/lib/discourse/builders-membership.service.ts:24`,
  `libs/api/community/src/lib/google-sessions/members.controller.ts:106`, and
  `libs/api/community/src/lib/discourse/discourse.controller.ts:182`.
  `context.md` and plan §2.3 name only the first two.
- Tasks 1.2 and 1.5 remove the second and relocate the first. The **third dies with the
  P1b directory deletion in Batch 5**, not here.
- Therefore Batch 1's gate is the **scoped** form. The unqualified R7.2 gate is Task 5.7.
  Do not attempt to satisfy the unqualified form in this batch by editing files inside
  `discourse/` — that directory is deleted wholesale in Batch 5 and edits to it are waste.

**Verification**:

```
rg 'async isBuildersMember|isBuildersMember\(userId' --glob '!node_modules' \
   --glob '!libs/api/community/src/lib/discourse/**' -n
```

Expected: exactly one implementation, in `libs/api/membership/src/lib/membership.service.ts`.

---

**Batch 1 Verification (exit gate)**:

- `nx show project api-membership` resolves; `nx lint api-membership` clean (RISK-F)
- `nx test api-membership` — all specs green, R7.4's five cases present
- `nx test ptah-license-server` — `route-map.spec` and `controller-validation.spec` green (RISK-B)
- Scoped `isBuildersMember` search returns exactly one implementation (RISK-A)
- `nx graph` — `api-membership` is a leaf-ward `type:util` node with no cycle

---

## Batch 2: P1c — `libs/api-contracts/community` (leaf) ✅ COMPLETE (`6349c4b3e`)

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `frontend-developer` (the lib is type-only + Zod and is consumed by both sides; a frontend developer can author it, but the backend developer owns the wire semantics)
**Execution Mode**: sequential
**Rationale**: One new Nx project whose files share a single naming and no-`extends`
discipline. The structural spec (Task 2.5) must see the final file layout, so the tasks
are ordered, not disjoint. Small but architecturally load-bearing — §8.1 makes it a
blocker for **both** sides of every later phase.
**Tasks**: 5 | **Dependencies**: **none** — pure leaf (ASSUMPTION-2: may run concurrently with Batch 1)
**Preconditions**: PRE-7

---

### Task 2.1: Scaffold `libs/api-contracts/community` under a new lib root ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\project.json`
- `D:\projects\ptah-extension\libs\api-contracts\community\tsconfig.json`
- `D:\projects\ptah-extension\libs\api-contracts\community\tsconfig.lib.json`
- `D:\projects\ptah-extension\libs\api-contracts\community\tsconfig.spec.json`
- `D:\projects\ptah-extension\libs\api-contracts\community\jest.config.cts`
- `D:\projects\ptah-extension\libs\api-contracts\community\README.md`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\index.ts`
- `D:\projects\ptah-extension\tsconfig.base.json`

**Requirement refs**: AD-6, F-5, NFR-M2, RK-8

**Implementation details**:

- `{ "name": "api-contracts-community", "tags": ["scope:api-contracts", "type:util"] }`
- `tsconfig.base.json`: `"@ptah-contracts/community": ["./libs/api-contracts/community/src/index.ts"]`
- Type-only + Zod. **No NestJS import, no Prisma import, no Angular import.** The eslint
  constraint `onlyDependOnLibsWithTags: ['scope:api-contracts']` makes it a pure leaf.
- README records why the seam exists: `scope:api-contracts` was pre-declared in
  `eslint.config.mjs` with zero projects; this is its first consumer, and it is the one
  legitimate bridge between `scope:api` and `scope:web`.

**Validation notes**:

- **RISK-E**: `libs/api-contracts/` does not exist yet. `nx.json` declares no
  `workspaceLayout`, so default discovery applies — but copy `$schema` / `rootDir` /
  jest `preset` relative depths **verbatim** from `libs/api/community`. Both are three
  levels deep (`libs/<root>/<lib>`), so the depths are identical; confirm rather than assume.

**Verification**:

```
nx show project api-contracts-community
npx nx lint api-contracts-community
```

Project resolves and lints with zero boundary violations.

---

### Task 2.2: Shared primitives and pagination envelope ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\shared\visibility.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\shared\reaction-type.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\shared\notification-kind.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\paged.contract.ts`

**Requirement refs**: NFR-P5, R1.1.1, R1.4.3, R10.1
**Dependencies**: Task 2.1

**Implementation details**:

- `Visibility = 'member' | 'cohort' | 'staff'` (R1.1.1)
- `ReactionType` — the fixed four, server-defined: `'like' | 'insightful' | 'celebrate' | 'thanks'`.
  **No free-form emoji** (R1.4.3).
- `NotificationKind` — the five from §1.6.
- `Paged<T> = { items: T[]; page: number; pageSize: number; total: number; hasMore: boolean }`
  with the NFR-P5 caps documented in the docblock: default 25, **max 50**, `>50` → 400.

**Verification**: `npx nx typecheck api-contracts-community` clean; the four constants are exported from `src/index.ts`.

---

### Task 2.3: The hub envelope — stable across all five phases ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-hub.contract.ts`

**Requirement refs**: R6.1, R6.3, R6.4, R6.6, AD-4
**Dependencies**: Task 2.2

**Implementation details**: exactly plan §3.2 —

```
HubSectionStatus = 'ok' | 'empty' | 'unavailable'
HubSection<T>    = { status: HubSectionStatus; data: T }
MemberHubResponse = {
  member: { firstName: string | null; cohorts: { key: string; name: string }[] };
  sections: { learning; community; sessions; packs; notifications }
}
```

All five sections are declared **now**, in Phase 1, even though four of them report
`'empty'` until their phase lands. R6.6 is only satisfiable if the shape never changes.

**Validation notes**:

- The docblock must state the R6.6 contract in force: _later phases change which sections
  report `'ok'`; they never change the shape and never add a client request._
- `'unavailable'` carries the **empty shape** in `data`, not `null` for array sections —
  that is what lets the UI render `EmptyState` uniformly (R6.3).

**Verification**: `npx nx typecheck api-contracts-community` clean; `MemberHubResponse` exported.

---

### Task 2.4: Member and admin contract directories with the no-`extends` rule ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-topic.contract.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-course.contract.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-live.contract.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-pack.contract.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-notification.contract.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-session-request.contract.ts`
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\admin\` (directory + the five admin contract files)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\index.ts`

**Requirement refs**: NFR-S4, NFR-S5, R5.2, R5.3, RK-8, AD-6
**Dependencies**: Task 2.3

**Implementation details**:

- Phase 1 declares the **summary/section payload types the hub envelope references**
  (`ContinueLearning`, `HubTopicSummary`, `HubSessionSummary`, `MemberPack`,
  `{ unreadCount: number }`). Fuller per-surface types (`MemberTopicDetail`,
  `MemberCourseDetail`, `LiveFeedItem`, …) are added by their own phase's batch — the
  directory and the rule exist now so nothing lands outside them later.
- **The rule this lib exists to enforce**: no `admin/*` type may `extend` a `member/*` type.
  Admin types **re-declare** their fields. This inverts the `AdminSession extends
BuildersSession` precedent, which was safe only because `BuildersSession` was frozen.
- `MemberPack` is declared standalone per §3.6 — `notes` cannot arrive by inheritance (R5.2, NFR-S5).

**Validation notes**:

- **RK-8** is the reason this is compile-time, not review discipline. A member endpoint
  leaking admin fields would expose other members' email addresses.

**Verification**: `npx nx typecheck api-contracts-community` clean; `rg 'extends' libs/api-contracts/community/src/lib/admin` returns no match crossing into `member/`.

---

### Task 2.5: Structural spec — no `extends` crosses `member/` ↔ `admin/` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\contract-boundary.spec.ts`

**Requirement refs**: NFR-S4, RK-8
**Dependencies**: Task 2.4
**Pattern to follow**: `apps/ptah-license-server/src/common/route-map.spec.ts:31` — the
_"a comment cannot fail a build; this can"_ idiom.

**Implementation details**:

- Glob `src/lib/admin/**/*.ts`, parse for `extends` / `interface X extends`, and assert no
  identifier resolved from a `member/` import appears on the right of `extends`.
- Also assert the reverse direction, so a future `member/*` file cannot extend an `admin/*` type.

**Verification**:

```
npx nx test api-contracts-community
```

Green. Then deliberately add a temporary `AdminPack extends MemberPack` and confirm the
spec **fails**; revert. State both results in the report.

---

**Batch 2 Verification (exit gate)**:

- `nx show project api-contracts-community` resolves; `nx lint` clean (RISK-E)
- `nx typecheck api-contracts-community` clean
- `nx test api-contracts-community` green, including the deliberate-failure probe of Task 2.5
- No NestJS / Prisma / Angular import anywhere in the lib
- `nx graph` shows the project as a leaf with zero outgoing edges

---

## Batch 3: P1d — `libs/api/member-hub` skeleton + entitlement probe ✅ COMPLETE (`3d5484f40`)

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: The composer, its five section resolvers and the two controllers are one
coherent design (`Promise.allSettled` fault isolation, AD-4). The R6.4 fault-injection
test must see the finished composer. Two new controllers land here, so PRE-2 and RISK-B
both apply in the same commit — not decomposable into independent parallel prompts.
**Tasks**: 6 | **Dependencies**: Batch 1 (MemberGuard, MembershipService), Batch 2 (hub envelope)
**Preconditions**: PRE-1, PRE-2, PRE-7

---

### Task 3.1: Scaffold `libs/api/member-hub` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\project.json`
- `D:\projects\ptah-extension\libs\api\member-hub\tsconfig.json` (+ `.lib.json`, `.spec.json`)
- `D:\projects\ptah-extension\libs\api\member-hub\jest.config.cts`
- `D:\projects\ptah-extension\libs\api\member-hub\README.md`
- `D:\projects\ptah-extension\libs\api\member-hub\src\index.ts`
- `D:\projects\ptah-extension\tsconfig.base.json`

**Requirement refs**: AD-6, NFR-M2, NFR-M4
**Dependencies**: Batch 1, Batch 2

**Implementation details**:

- `{ "name": "api-member-hub", "tags": ["scope:api", "type:feature"] }`
- Path alias `"@ptah-api/member-hub"`. Depends on `membership` + `contracts` in Phase 1;
  `forum` / `learning` / `community` / `notifications` edges are added by their phases.

**Verification**: `nx show project api-member-hub`; `npx nx lint api-member-hub` clean.

---

### Task 3.2: `GET /api/v1/members/entitlement` — the frontend guard's probe ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-entitlement.controller.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-entitlement.controller.spec.ts`

**Requirement refs**: R7.7, R9.5, §3.2
**Dependencies**: Task 3.1
**Pattern to follow**: `libs/web/core/src/lib/guards/admin-auth.guard.ts:31-33` — and its
warning against probing heavy handlers.

**Implementation details**:

- `@UseGuards(JwtAuthGuard)` **only** — deliberately not `MemberGuard`.
- Returns `200 { entitled: boolean; cohorts: { key; name }[]; isAdmin: boolean }`.
- **Returns `200 { entitled: false }` rather than 403** so the frontend guard can
  distinguish "not logged in" (401 → `/login`) from "logged in, not a member"
  (→ upgrade surface, R7.7) without reading an exception body.
- Two queries max. Do not compose the hub here.

**Validation notes**:

- **Edge cases**: unauthenticated → `401` · authenticated non-member → `200 { entitled: false }` ·
  entitled with no cohorts → `200 { entitled: true, cohorts: [] }`.
- R7.7 explicitly forbids showing an empty panel or a raw `403` to a logged-in non-member.

**Verification**:

```
npx nx test api-member-hub --testPathPatterns=member-entitlement.controller.spec
```

All three edge cases present and green.

---

### Task 3.3: `MemberHubService` — the `Promise.allSettled` composer (AD-4) ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.service.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.service.spec.ts`

**Requirement refs**: R6.1, R6.3, R6.4, R6.5, R6.6, AD-4, NFR-R3, NFR-P1
**Dependencies**: Tasks 3.1, 3.2, Batch 2 Task 2.3

**Implementation details**:

- `compose(ctx: MemberContext)` resolves entitlement + cohort keys **once** (already on the
  context from `MemberGuard` — do not re-derive, R7.3), then runs the section resolvers
  concurrently.
- **`Promise.allSettled`, not `Promise.all`.** A rejected section becomes
  `{ status: 'unavailable', data: <empty shape> }` and the response is still `200`. This is
  the entire content of R6.4 — `Promise.all` would blank the home screen, the exact
  outcome R6.4 forbids.
- Adding a Phase-N section adds one file and one line here. That is how R6.6 holds the
  client at one request across four phases.

**Validation notes**:

- **The R6.4 fault-injection case is mandatory**: force one resolver to reject and assert
  the response is `200`, that section is `'unavailable'`, and every other section is intact.
- Query budget per §3.2/AD-4: seven DB round-trips **in parallel**, none N+1 (NFR-P4).

**Verification**:

```
npx nx test api-member-hub --testPathPatterns=member-hub.service.spec
```

Green, including the fault-injection case.

---

### Task 3.4: The five section resolvers (Phase-1 shapes) ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\learning.section.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\community.section.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\sessions.section.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\packs.section.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\notifications.section.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\*.section.spec.ts`

**Requirement refs**: R6.1, R6.3, R6.4, NFR-R1, §3.2 phase table
**Dependencies**: Task 3.3
**Pattern to follow**: `members.controller.ts:48-50` and `sessions.service.ts:66-77` —
`@Optional() @Inject(X)` for `@Global` collaborators; degrade, never fail.

**Implementation details**: per §3.2's phase table, Phase 1 fills exactly one section.

- `sessions` — **POPULATED** from the existing Calendar path (`SessionsService.listUpcomingSessions`)
- `learning` → `{ status: 'empty', data: null }`
- `community` → `{ status: 'empty', data: [] }`
- `packs` → `{ status: 'empty', data: [] }`
- `notifications` → `{ status: 'empty', data: { unreadCount: 0 } }`
- Each resolver exports one `resolve(ctx: MemberContext): Promise<HubSection<T>>`.

**Validation notes**:

- **Edge case (NFR-R1)**: with `GOOGLE_OAUTH_*` unset the sessions resolver must return
  `{ status: 'unavailable', data: null }` — not throw, not `500`. The feature-off posture is
  already established by `google-auth.provider.ts:1-24`; reuse it, do not re-invent it.
- The four empty sections must return `'empty'` (there is genuinely no data yet), not
  `'unavailable'` (which means a source failed). The UI renders `EmptyState` for both, but
  the distinction is what makes R6.4's fault signal meaningful.

**Verification**:

```
npx nx test api-member-hub --testPathPatterns=section.spec
```

Includes a `GOOGLE_OAUTH_*`-unset case asserting no throw and no `500`.

---

### Task 3.5: `GET /api/v1/members/hub` controller + `MemberHubModule` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.controller.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.module.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts`

**Requirement refs**: R6.1, R6.2, R6.5, §3.1 conventions
**Dependencies**: Tasks 3.2, 3.3, 3.4

**Implementation details**:

- `@Controller('v1/members/hub')`, `@UseGuards(JwtAuthGuard, MemberGuard)` at **class** level.
- Register `MemberHubModule` in `app.module.ts` **after** `MembershipModule` (which is
  `@Global` and must precede every consumer, R7.3).
- Errors: typed Nest exceptions with fixed sanitized messages. Raw dependency messages
  never reach a client (NFR-S7).

**Validation notes**: PRE-1 — any `@Query()` here binds `dtoPipe`. Phase 1's hub takes no payload, so there should be none; if one appears, it binds.

**Verification**: `npx nx test api-member-hub` green; server boots with the new module registered.

---

### Task 3.6: Register both controllers in the shared registry ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\testing\controller-registry.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`

**Requirement refs**: F-4, AD-12, PRE-2
**Dependencies**: Tasks 3.2, 3.5

**Implementation details**:

- Add `MemberEntitlementController` and `MemberHubController` to the registry **in this
  same commit** (PRE-2). The census assertion in `controller-validation.spec.ts` fails the
  build otherwise.
- Add both routes to `EXPECTED_ROUTES` in `route-map.spec.ts`.

**Validation notes**:

- **RISK-B verification point.** This is where the AD-12 re-declaration from Task 1.5 pays
  off: `v1/members/sessions`, `v1/members/hub` and `v1/members/entitlement` are three
  disjoint depth-3 literal siblings. If RI-1 fails here, Task 1.5 did not land — stop and
  report rather than weakening the invariant.

**Verification**:

```
npx nx test ptah-license-server --testPathPatterns=route-map.spec
npx nx test ptah-license-server --testPathPatterns=controller-validation.spec
npx nx test ptah-license-server --testPathPatterns=admin-guards.spec
```

All green. RI-1 / RI-2 / RI-3 satisfied.

---

**Batch 3 Verification (exit gate)**:

- `nx test api-member-hub` green, incl. the R6.4 fault-injection case (Task 3.3)
- `route-map.spec` + `controller-validation.spec` green with both new controllers (RISK-B)
- `GET /api/v1/members/entitlement` returns `200 { entitled: false }` for a logged-in non-member — never 403 (R7.7)
- `GET /api/v1/members/hub` returns all five sections with the stable envelope (R6.6)
- With `GOOGLE_OAUTH_*` unset, the hub still returns `200` (NFR-R1)
- `nx lint`, `nx typecheck` clean

**Post-Batch-3 review findings, all closed after the fact** (committed separately from
`3d5484f40` so each is independently revertible):

- **F1** `776696ede` — the "known nuance, deliberately not changed" that Batch 3 recorded in
  `sessions.section.ts` is now fixed. `SessionsService.readUpcomingSessions` reports
  `{ ok:false, reason:'disabled'|'fetch_failed' }`, so a live Calendar outage surfaces as
  `'unavailable'` rather than the false `'empty'`. `listUpcomingSessions` survives as a
  one-line lossy view, so `GET /v1/members/sessions` and the Paddle welcome email are
  byte-identical. Failure stays a value, so the hub still answers `200` (R6.4 / NFR-R3).
- **F2 + F4** `69f4ff78e` — the `ADMIN_EMAILS` census was **five** copies, not the four the
  Batch-3 docblock claimed, and they had drifted (two trimmed the incoming email, three did
  not). `libs/api/identity/src/lib/admin-emails.ts` is now the one parse; `AdminGuard` keeps
  the fail-closed **policy** at the guard. `member-entitlement.controller.spec.ts:236` was
  inverted — it required a private parse and so would have failed on the correct code.
- **F3** `2bf9ffb0a` — `apps/ptah-license-server/src/app/app.module.spec.ts` boots the real
  Nest injector via `.compile()`. Proven to fire: removing `IdentityModule` from
  `MemberHubModule` reproduces Batch 3's DI bug verbatim while `route-map`,
  `controller-validation` and `admin-guards` all stay green. Added `@nestjs/testing` devDep.
- **F5** `0fdbdc094` — four handoff-doc paths broken by `1bea0f634` corrected.

**Independently re-verified after the findings landed** (not developer self-report):

```
nx run-many -t eslint:lint,typecheck,test -p api-membership,api-member-hub,api-community,api-identity,api-admin,ptah-license-server --skip-nx-cache
  → Successfully ran for 6 projects (license-server 66 tests, up from 62)
```

---

## Batch 4: P1e — `libs/web/members` shell, guard, nav, theme, markdown preset ✅ COMPLETE (`cdc1a1ef5`)

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer` (re-spawn; Angular 21 signals + Tailwind token discipline is not substitutable)
**Execution Mode**: sequential
**Rationale**: One new Angular lib whose route config, layout, guard, nav config and theme
service are mutually referential. Two enforcing specs (no-catch-all, one-hub-request) must
see the finished route tree. The `/members` swap plus the old-surface deletion must be
**atomic** (RISK-D), which forbids splitting into parallel prompts.
**Tasks**: 8 | **Dependencies**: Batch 2 (contract types), Batch 3 (entitlement + hub endpoints)
**Preconditions**: PRE-3, PRE-4, PRE-7

---

### Task 4.1: Scaffold `libs/web/members` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\project.json`
- `D:\projects\ptah-extension\libs\web\members\tsconfig.json` (+ `.lib.json`, `.spec.json`)
- `D:\projects\ptah-extension\libs\web\members\jest.config.cts`
- `D:\projects\ptah-extension\libs\web\members\README.md`
- `D:\projects\ptah-extension\libs\web\members\src\index.ts`
- `D:\projects\ptah-extension\tsconfig.base.json`

**Requirement refs**: A-5, AD-6, NFR-M2
**Pattern to follow**: `libs/web/admin/project.json`

**Implementation details**:

- `{ "name": "web-members", "tags": ["scope:web", "type:feature"] }`
- Path alias `"@ptah-web/members"`.
- **`src/index.ts` exports `MEMBER_ROUTES` and nothing else** — components are reachable
  only through lazy `loadComponent`, mirroring `@ptah-web/admin`'s surface.

**Validation notes**: `scope:web → { scope:shared, scope:web, scope:api-contracts }` and
`type:feature → { feature, data-access, ui, util, core }`. Both `@ptah-contracts/community`
and `@ptah-extension/markdown` are reachable (V-4, V-5). Verified — no lint change needed.

**Verification**: `nx show project web-members`; `npx nx lint web-members` clean.

---

### Task 4.2: Add the `'member'` markdown preset — inside the existing lib only ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\frontend\markdown\src\lib\provide-markdown-rendering.ts`
- `D:\projects\ptah-extension\libs\frontend\markdown\src\lib\markdown-block.component.ts`
- `D:\projects\ptah-extension\libs\frontend\markdown\src\lib\provide-markdown-rendering.spec.ts`

**Requirement refs**: NFR-S2, NFR-U5, AD-1, OQ-2, RK-2
**Dependencies**: Task 4.1
**Precondition**: PRE-4

**Implementation details**:

- Widen `MarkdownRenderingConfig.extensions` from `'full' | 'basic'` to
  `'full' | 'basic' | 'member'`.
- `'member'` supplies a DOMPurify **allowlist** sanitizer (`ALLOWED_TAGS` / `ALLOWED_ATTR`,
  **not** `FORBID_*`) — the existing `'full'` preset is a deny-list tuned for AI-generated
  content and deliberately allows SVG, `details`, `style` and custom elements. That is
  wrong for member-authored UGC.
- Plus an `afterSanitizeAttributes` hook forcing `rel="noopener noreferrer nofollow"` and
  `target="_blank"` on anchors.
- `MarkdownBlockComponent`: add `variant = input<'invert' | 'auto'>('invert')`; `'auto'`
  emits `prose dark:prose-invert`. Default unchanged so no existing consumer moves —
  the hardcoded `prose-invert` at `:17` breaks `operator-member-light` (NFR-U5).

**Validation notes**:

- **NFR-S2 / RK-2 are the whole point.** One lib, one sanitizer module, one `DOMPurify`
  import in the web tree. Authoring a second renderer is explicitly forbidden (OQ-2 option c).
- **Edge case**: both existing consumers must keep compiling — `apps/ptah-landing-page`
  (`'basic'`, app.config.ts:14,43) and the webview app (`'full'`). Union widening is
  additive, but verify with a full typecheck, not by inspection.
- `'basic'` falls through to ngx-markdown's `DEFAULT_SECURITY_CONTEXT` (Angular's
  `DomSanitizer`, **not** DOMPurify). Do not assume `'basic'` is safe for UGC.

**Verification**:

```
npx nx test markdown
npx nx typecheck ptah-landing-page
npx nx typecheck ptah-extension-webview
```

All green — the union widening breaks neither existing consumer.

---

### Task 4.3: `MEMBER_ROUTES` — explicitly enumerated, no catch-all ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.spec.ts`

**Requirement refs**: R9.4, R9.5, RK-11
**Dependencies**: Task 4.1
**Pattern to follow**: `libs/web/admin/src/lib/admin.routes.ts:29-186` — one `path: ''`
layout route with lazy `loadComponent` children. **Do not** copy `:model` / `:model/:id`
at `:175-183`.

**Implementation details**: exactly plan §5.2's 15-route tree. Phase 1 supplies real
components for `hub` and `account`; the remaining routes point at lightweight placeholder
components replaced in their phase's frontend batch — the route table is declared **now**
so its enforcing spec is in force from day one.

**Validation notes**:

- `members.routes.spec.ts` walks the tree and asserts: (i) no route path's **first**
  segment begins with `:`; (ii) every parameter segment is drawn from the allowlist
  `{ ':slug', ':lessonSlug', ':id' }`; (iii) the literal strings `':model'` and
  `':model/:id'` appear nowhere.
- `admin.routes.ts:16-19` documents the catch-all the admin panel deliberately keeps —
  on an internal operator surface it is a feature; on a member-facing surface it is a
  **data-exposure hazard** (RK-11, Critical). Do not reuse the admin pattern here.

**Verification**:

```
npx nx test web-members --testPathPatterns=members.routes.spec
```

Green. Then add a temporary `{ path: ':model' }` route and confirm the spec **fails**; revert. Report both results.

---

### Task 4.4: `MemberLayout` on `PanelLayout` + `MEMBER_NAV_GROUPS` + theme service ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\member-layout\member-layout.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\member-layout\member-layout.html`
- `D:\projects\ptah-extension\libs\web\members\src\lib\member-nav.config.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-theme.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-theme.service.spec.ts`

**Requirement refs**: R9.1, R9.2, R9.3, R9.6, R9.7, NFR-U1, AD-13
**Dependencies**: Task 4.3
**Precondition**: PRE-3
**Pattern to follow**: `libs/web/admin/src/lib/admin-layout/admin-nav.config.ts` (`ADMIN_NAV_GROUPS`)

**Implementation details**:

- `MEMBER_NAV_GROUPS: readonly PanelNavGroup[]` exactly as plan §5.4 — Home · Learn
  (Courses, Artifacts) · Build (Packs) · Live (Sessions, Replays, Request a session) ·
  Community (Feed, My Threads, Notifications) · Account.
- `MemberLayout` binds `PanelLayout` with `title="Ptah Builders"`,
  `drawerId="member-drawer"` (**distinct** from the admin's, per `panel-layout.ts:64-67`),
  the cohort name as `badgeLabel`, and projects email + theme toggle into `[panelTopBar]`
  and the membership card into `[panelSidebarFooter]`.
- `MemberThemeService`: `localStorage['ptah.members.theme']`, `operator-member` /
  `operator-member-light`, bound to `PanelLayout`'s `theme` input (AD-13).
- `badgeCount` on Notifications is wired in Batch 15 when the store exists; the nav item
  declares the field now. **No parallel badge mechanism** — `PanelNavItem.badgeCount` is
  the intended and only mechanism (R9.3).

**Validation notes**:

- **R9.1 is absolute**: no second shell, no second sidebar, no second drawer. Reuse
  `StatTile`, `StatusBadge`, `EmptyState`, `DetailDrawer`, `SelectionToolbar` rather than
  re-implementing (R9.7).
- **PRE-3**: `panel-ui` exports nine symbols from eight lines. Anything beyond them must
  be added to `libs/web/panel-ui/src/index.ts` **first**, and only when a second panel
  actually renders it (§5.3). Phase 1 needs no promotion.
- NFR-U1: `ChangeDetectionStrategy.OnPush`, signals, `inject()`. No constructor injection.

**Verification**:

```
npx nx test web-members --testPathPatterns=member-theme.service.spec
npx nx lint web-members
```

Green. Manual: `/members` renders in `operator-member` **and** `operator-member-light`
with no hardcoded-color artifacts (NFR-U5).

---

### Task 4.5: Frontend `MemberGuard` — entitlement probe with three outcomes ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\guards\member.guard.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\guards\member.guard.spec.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\state\member-session.store.ts`

**Requirement refs**: R7.7, R9.5, NFR-S8
**Dependencies**: Tasks 4.1, 4.4, Batch 3 Task 3.2
**Pattern to follow**: `libs/web/core/src/lib/guards/admin-auth.guard.ts` — but reading a
**body**, not a status, because the entitled/unentitled distinction is data, not an error.

**Implementation details**: probe `GET /api/v1/members/entitlement` —

- `401` → `/login?returnUrl=/members`
- `200 { entitled: false }` → `/pricing` (R7.7's upgrade surface)
- `200 { entitled: true }` → seed `MemberSessionStore` (a `MemberContext` signal, set once) and allow

**Validation notes**:

- **All three outcomes are distinct edge cases and each needs a test.** R7.7 explicitly
  forbids an empty panel or a raw `403` for a logged-in non-member.
- NFR-S8: this guard is **cosmetic**. Server-side `MemberGuard` (Batch 1 Task 1.4) is the
  real enforcement. Never rely on this for authorization.

**Verification**:

```
npx nx test web-members --testPathPatterns=member.guard.spec
```

Three routing outcomes green.

---

### Task 4.6: Hub page + typed API service, one request (R6.2) ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\hub\hub-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\hub\sections\continue-learning-card.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\hub\sections\community-activity-card.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\hub\sections\next-session-card.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\hub\sections\packs-card.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-hub-api.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-hub-api.service.spec.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\account\account-page.ts`

**Requirement refs**: R6.2, R6.3, R9.7, R9.8, NFR-U1, NFR-U2, NFR-U3
**Dependencies**: Tasks 4.4, 4.5, Batch 2 Task 2.3, Batch 3 Task 3.5
**Pattern to follow**: `libs/web/core/src/lib/services/members-api.service.ts:78-90` —
Zod at the frontend HTTP boundary via the shared `validate()`.

**Implementation details**:

- **Exactly one** data request for the initial render (R6.2). A hub composed client-side
  from multiple endpoint calls fails this requirement.
- A section reporting `'empty'` or `'unavailable'` renders the `EmptyState` primitive from
  `@ptah-web/panel-ui` — **never** omitted silently (R6.3).
- Layout and hierarchy match `docs/design-system/stitch_ptah_builders_member_home/`
  (member home, dark + light). Resolve all token drift through `panel-theme-spec.md` (R9.8).

**Validation notes**:

- **NFR-U2**: surfaces `base-100`/`base-200`/`base-300`, every boundary `border-hairline`,
  hover/active `bg-surface-high`, `primary` `#f5a524` via token. **`base-300` is a fill and
  is NEVER used as a border** — the specific error `panel-theme-spec.md` §2 exists to prevent.
  No raw hex, no Material-3 token names, no `ink-*` / `amber-*`.
- **NFR-U3**: load-bearing muted text uses `text-base-content/60` or stronger. `/40`
  measures 3.18:1 and fails WCAG AA for body text — reserve it for genuinely glanceable metadata.

**Verification**:

```
npx nx test web-members --testPathPatterns=member-hub-api.service.spec
npx nx lint web-members
```

Green. Manual: hub renders in both themes; every empty section shows `EmptyState`.

---

### Task 4.7: NFR-U2 / NFR-U1 enforcing lint rules scoped to `libs/web/members/**` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\eslint.config.mjs`
- `D:\projects\ptah-extension\libs\web\members\eslint.config.mjs` (if the repo scopes per-project)

**Requirement refs**: NFR-U1, NFR-U2, RK-7
**Dependencies**: Task 4.6

**Implementation details**:

- `@angular-eslint/prefer-on-push-component-change-detection` scoped to `libs/web/members/**`.
- `no-restricted-syntax` banning raw hex literals, `ink-*`, `amber-*`, Material-3 token
  names, **and `border-base-300`** — scoped to `libs/web/members/**`.

**Validation notes**: RK-7 (design drift) — the 8 approved screens each emit their own
conflicting Material-3 token set. `panel-theme-spec.md` already collapses that drift; this
rule is what keeps it collapsed as later phases add screens.

**Verification**:

```
npx nx lint web-members
```

Clean. Then add a temporary `class="border-base-300"` and a raw `#1a1a1a` and confirm lint **fails** on both; revert. Report both results.

---

### Task 4.8: Mount `/members`, delete the old surface, drop the Discourse wire fields ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\app.routes.ts`
- `D:\projects\ptah-extension\libs\web\core\src\lib\services\members-api.service.ts`
- `D:\projects\ptah-extension\libs\web\account\src\lib\members\members-page.component.ts` **(DELETE)**
- `D:\projects\ptah-extension\libs\web\account\src\lib\members\members-page.component.spec.ts` **(DELETE)**
- `D:\projects\ptah-extension\libs\web\account\src\lib\members\components\builders-pitch.component.ts` **(DELETE)**
- `D:\projects\ptah-extension\libs\web\account\src\lib\members\components\community-topic-list.component.ts` **(DELETE)**
- `D:\projects\ptah-extension\libs\web\account\src\lib\members\components\session-card.component.ts` **(DELETE)**
- `D:\projects\ptah-extension\libs\web\account\src\index.ts`

**Requirement refs**: R9.5, F-6, MG-2.7, AD-1
**Dependencies**: Tasks 4.3, 4.5, 4.6

**Implementation details**:

```ts
{
  path: 'members',
  canActivate: [MemberGuard],
  loadChildren: () => import('@ptah-web/members').then((m) => m.MEMBER_ROUTES),
  providers: [provideMarkdownRendering({ extensions: 'member' })],   // AD-1
  data: { hideFromNav: true },
}
```

- The route-level `providers` array creates a route-level injector whose `MarkdownService`
  - `SANITIZE` **shadow** the app's `'basic'` pair for the entire member subtree.
    `provideMarkdown()` returns plain providers (`MarkdownService` is a bare class provider,
    not `providedIn: 'root'`), so this works with **no app-config change and no
    cross-contamination**.
- From `libs/web/core/.../members-api.service.ts`: delete `getCommunitySummary`,
  `communityTopicSchema`, `communitySummaryResponseSchema`; drop `communityUrl` from
  `membersSessionsResponseSchema`.
- Delete the four `libs/web/account/src/lib/members/` files and their barrel exports.

**Validation notes**:

- **RISK-C — this ordering is deliberate and asymmetric.** `z.object()` **strips** unknown
  keys, so a frontend schema that has already dropped `communityUrl` tolerates a backend
  that still sends it. The reverse breaks. The frontend must go first; Batch 5 removes the
  backend field second. Do **not** "helpfully" edit the backend here.
- **RISK-D — this task is atomic.** `members-page.component.ts` is the only caller of
  `getCommunitySummary()`. Deleting the method without the component breaks typecheck;
  deleting the component before `MEMBER_ROUTES` exists leaves `/members` unrouted. All
  three changes land together.

**Verification**:

```
npx nx typecheck ptah-landing-page
npx nx build ptah-landing-page
npx nx test web-core
npx nx test web-account
```

All green; `/members` resolves to the new shell; no dangling import of the deleted components.

**✅ DEVIATION CLOSED — the guard now sits on the `/members` app route, exactly as specified
above.** Commit `d1b57ec0f` (B4 addendum). Superseded history follows, because the _why_
still matters:

The snippet above did not lint as first written. Naming `canActivate: [MemberGuard]` beside
`loadChildren: () => import('@ptah-web/members')` is a **static import of a lazy-loaded
library**, which `@nx/enforce-module-boundaries` forbids outright. `/admin` gets away with the
inline form only because `AdminAuthGuard` lives in `@ptah-web/core`, which is never lazy.
`cdc1a1ef5` therefore shipped the guard on `MEMBER_ROUTES[0]` inside the lib as a working
stopgap, and recorded relocation as an **open architectural alternative deferred to the user**.

**The user chose relocation.** `d1b57ec0f` `git mv`s `MemberGuard` and `MemberSessionStore`
into `@ptah-web/core` beside `AdminAuthGuard` — rename detection preserved at 75%/85%/94%
similarity, so history follows the files — and restores `canActivate: [MemberGuard]` on the
`/members` route. `MEMBER_ROUTES[0]` **drops** its own `canActivate`: leaving both would run
the entitlement probe **twice per navigation**. Two behavioural gains beyond legality: a
reader of `app.routes.ts` can now see that `/members` is guarded at all, and an unentitled
visitor is bounced to `/pricing` **before** the member chunk downloads rather than after.

The boundary error is **resolved, not suppressed**. The pre-change form was applied first and
produced exactly one error — `app.routes.ts 7:1 Static imports of lazy-loaded libraries are
forbidden. @nx/enforce-module-boundaries` — and the same command reports **0 errors** after
the real change. There is **no `eslint-disable`** anywhere in the change.

The wiring assertion was **split and strengthened, not deleted**:

- `members.routes.spec.ts` now walks **every descendant** route through a new `guardCount`
  (not just `[0]`) and asserts the subtree declares no guard of its own — strictly stronger
  than the `MEMBER_ROUTES[0].canActivate` equality it replaces.
- `app.routes.spec.ts` asserts the **positive** wiring, against the source text, using the
  same `readFileSync` technique that suite already uses to avoid pulling the eager marketing
  component graph (fullcalendar, gsap, lenis) into the Jest module graph.
- `libs/web/members/src/lib/member-guard-wiring.spec.ts` **(new)** drives a **real Router**
  over the real route shape: `MemberLayout` is never instantiated on **either** deny path,
  and the probe fires **exactly once** per navigation.

`@ptah-web/members` keeps its one-symbol barrel. Widening it was never the fix — anything
exported there must be imported statically to be useful, which is the very error the move
exists to avoid.

Also fixed in passing: `hub/sections/continue-learning-card.ts` did not parse — backticks
inside an HTML comment inside the component's template literal terminated the literal
(`TS1005` ×4). Baseline lint was already red from Task 4.6 before Tasks 4.7/4.8 started.

---

**Batch 4 Verification (exit gate)** — result as of `cdc1a1ef5`:

- ✅ **UPGRADED FROM ⚠️ PARTIAL BY THE B4 ADDENDUM** — `/members` renders with `PanelLayout` in
  **both** `operator-member` and `operator-member-light` (R9.1, R9.6, NFR-U5). This bullet was
  static evidence only as of `cdc1a1ef5`; it now has **live browser evidence** — both themes
  were rendered and the screenshots viewed, not merely reasoned about. Two **cosmetic** defects
  surfaced in that check (light-mode gutter, thin secondary nav) — recorded in the addendum
  below and carried to B15's a11y pass. Neither blocks this gate.
- ✅ `members.routes.spec.ts` green, incl. the deliberate-failure probe (R9.4, RK-11)
- ✅ Hub issues **exactly one** data request on initial render (R6.2)
- ✅ Guard routes all three outcomes correctly: 401 → `/login`, unentitled → `/pricing`,
  entitled → hub (R7.7) — see the deviation note above on _where_ the guard is declared
- ✅ `'member'` preset added **only** inside `provide-markdown-rendering.ts`; both existing
  consumers still typecheck (PRE-4)
- ✅ NFR-U2 lint rule active and **proven by deliberate failure** — 11 errors across all five
  patterns plus OnPush, clean after revert (Task 4.7)
- ✅ Old `/members` surface deleted; `nx typecheck` + `nx build ptah-landing-page` clean
  (RISK-D)
- ⚠️ **KNOWN RED, OWNED BY TASK 5.6** — `apps/ptah-landing-page-e2e/src/specs/members-content.spec.ts`
  and `members-gate.spec.ts` fail between B4 and B5 by design: they target the deleted surface
  and stub `communityUrl`. Not a B4 regression; do not patch them outside Task 5.6.

**Independently re-verified after Batch 4** (not developer self-report):

```
nx run-many -t eslint:lint,typecheck,test -p web-members,web-core,web-account,ptah-landing-page --skip-nx-cache
  → Successfully ran for 4 projects
```

Only pre-existing warnings remain (unused `eslint-disable` in `jest.config.ts` / `instrument.ts`;
17 `explicit-member-accessibility` in `download-page.component.ts`). None introduced by B4.

---

### Batch 4 addendum ✅ COMPLETE — user-requested, two independent changes

| Commit      | Change                                                                                |
| ----------- | ------------------------------------------------------------------------------------- |
| `d1b57ec0f` | `refactor(landing): move MemberGuard and its store into @ptah-web/core` (13 files)    |
| `a7edf152c` | `refactor(landing): extract the member theme toggle into its own component` (6 files) |

**1. Guard/store relocation** — closes the Task 4.8 deviation. See the ✅ DEVIATION CLOSED
note on Task 4.8 above for the full record.

**2. Theme toggle hardened and rendered.** ⚠️ **CORRECTION TO THE RECORD: the control already
existed.** It shipped in `cdc1a1ef5` (icon toggle in the top bar, Dark/Light pair on the
account page); the brief that requested this work wrongly described it as new. What actually
changed is an **extraction, not an addition**: the inline button became a testable standalone
OnPush component, `libs/web/members/src/lib/member-layout/member-theme-toggle.ts` (+ spec),
driven by the **existing** `MemberThemeService`. No second theme mechanism, no second
persistence key — still one owner and one `ptah.members.theme` key. One new `destinationLabel`
computed. **PRE-3 intact**: `@ptah-web/panel-ui` is untouched — still 8 export lines,
9 symbols. A11y: native `<button>`, `aria-hidden` icon, 32px hit target, and an `aria-label`
naming the destination that is deliberately a **superset of the visible caption** (WCAG 2.5.3,
Label in Name) — the coupling is documented on the computed so it is not silently broken.

**Verification (independently re-run on the committed HEAD, not developer self-report):**

```
nx run-many -t eslint:lint,typecheck,test -p web-members,web-core,ptah-landing-page --skip-nx-cache
  → Successfully ran targets eslint:lint, typecheck, test for 3 projects
```

0 errors. Only the same pre-existing `download-page.component.ts` warnings noted above.

**Recorded, NOT fixed — carried forward:**

1. ⚠️ **Light-mode right-edge gutter stays dark.** The panel switches to light but the
   document background behind the scrollbar does not, which suggests `data-theme` is bound to
   the **panel root rather than `<html>`**. Cosmetic; visible on short pages. Belongs to the
   shell binding, not to the toggle. → **B15 a11y/visual pass.**
2. ⚠️ **Secondary nav items render thin in both themes.** Artifacts, Replays, Request a
   session, My Threads, Notifications, Account settings sit at `text-base-content/60`.
   `panel-theme-spec.md` marks `/40` as failing AA (3.18:1) and names `/60` as the sanctioned
   floor, so `/60` here **needs measuring** rather than assuming. → **B15 a11y pass.**
3. ~~⚠️ **`member-session.store.spec.ts` does not exist.**~~ ✅ **CLOSED by `af2d22653`.** The
   next thing to touch `MemberSessionStore` was the addendum below, which added `entitled()`,
   so the direct spec came with it. Original note: only the guard carried a spec; the store was
   covered **transitively** by `member.guard.spec.ts` and `member-guard-wiring.spec.ts`.

---

### Batch 4 addendum 2 ✅ COMPLETE — cross-panel nav + post-login landing

| Commit      | Change                                                                         | Files |
| ----------- | ------------------------------------------------------------------------------ | ----- |
| `af2d22653` | `feat(landing): add cross-panel nav links between the member and admin panels` | 10    |
| `496ad5c5c` | `feat(landing): land admins on /admin and members on /members after sign-in`   | 8     |

Two separable changes, committed separately. They share `member-session.store.ts` and
`member.guard.ts` only in the sense that both files were touched across the pair — no hunk
splitting was needed, the split is clean at file granularity. `af2d22653` carries no code
reference to anything introduced in `496ad5c5c` (the one mention is a `{@link
MemberEntitlementService}` in a docblock, and the workspace runs no jsdoc/tsdoc lint plugin,
so it is inert for one commit).

**1. Cross-panel nav.** The member sidebar gains an `Admin` item (`MEMBER_ADMIN_NAV_GROUP`,
`ShieldCheck`, → `/admin`) shown only when `isAdmin`. The admin sidebar gains `Member Panel`
(`ADMIN_MEMBER_NAV_GROUP`, `Hammer`, → `/members`).

⚠️ **The admin-side link is gated on ENTITLEMENT, not on admin-ness, and that asymmetry is
deliberate.** Everyone rendering the admin sidebar is already an admin, so gating on `isAdmin`
would gate on nothing; `/members` is protected by `MemberGuard`, which turns on `entitled`
alone. An admin holding only a free `community` license would click an `isAdmin`-gated link and
be bounced to `/pricing`. A link that reliably fails is worse than no link.

⚠️ **The mechanism was chosen to match a commitment already on record, not on its own merits
(R9.3).** Both config files stay static data and export the conditional group as a **separate
const**; each layout owns a `computed()` that appends it. `member-nav.config.ts`'s docblock
already commits **Batch 15's Notifications `badgeCount`** to reshaping the nav from a
`computed()` in the layout. Adding a config _function_ here would have left two mechanisms for
conditionally-shaped nav — a config function for one condition, a computed for the other — and
that divergence is exactly the drift R9.3 exists to prevent. **B15 must use the same computed**;
if it reaches for a config function instead, the two have diverged and R9.3 is broken.

**PRE-3 intact**: `@ptah-web/panel-ui` untouched — still 8 export lines, 9 symbols. No new
source of admin-ness: `isAdmin` still originates only from the entitlement probe response and
still authorizes nothing (R7.4, NFR-S8).

**2. Post-login landing.** `AuthPageComponent.navigateAfterAuth()` ended in a hardcoded
`/profile`. Two new services in `@ptah-web/core`: `member-entitlement.service.ts` — now the
**single call site** for `GET /api/v1/members/entitlement`, with `member.guard.ts` refactored to
delegate so the guard and the landing decision share one probe rather than giving `isAdmin` two
origins — and `post-login-destination.service.ts` (`isAdmin` → `/admin`, else `entitled` →
`/members`, else `/profile`).

Three rules, each tested rather than merely commented:

1. **`returnUrl` always wins.** Asserted with `httpMock.expectNone`, so the test fails if the
   probe is _issued at all_, not merely if the navigation ends up wrong. Hoisting the probe
   above that early return would make the member panel unreachable for any admin `MemberGuard`
   had just bounced to sign in.
2. **No bounce.** An admin navigating to `/members` stays there. Asserted through a **real
   Router with `/admin` in the route table**, so an accidental bounce resolves to a real route
   and is caught, instead of failing to match and passing by accident.
3. **Admin outranks member for the DEFAULT landing only** — a preference about where to arrive,
   never a redirect afterwards.

Guard coverage intact through the new seam: `401` → `/login?returnUrl=/members`,
`{entitled:false}` → `/pricing` and explicitly **not** `/login`, `{entitled:true}` → allow and
seed, probe still fires exactly once per navigation.

**Verification (developer-run against the working tree):**

```
nx run-many -t eslint:lint,typecheck,test -p web-core,web-members,web-admin,web-auth,ptah-landing-page --skip-nx-cache
  → Successfully ran targets for 5 projects
```

Pre-commit hooks (`nx format:write`, `nx affected --target=lint`, electron `validate-deps`) and
commitlint passed on both commits. **No `--no-verify` anywhere.**

#### ⚠️ Evidence quality — read before citing the screenshots

Five screenshots exist under `.ptah/screenshots/task_2026_177_b4a2_*.png`. They are **not
committed and cannot be**: `.gitignore:128` matches `.ptah/**` (confirmed with
`git check-ignore -v`, not assumed).

**Three of the five are byte-identical** — SHA256 `3DA23426C9FE…`, 105 986 bytes each:

| File                                          | Bytes   | SHA256 (first 12) |
| --------------------------------------------- | ------- | ----------------- |
| `..._admin_sidebar_member_link.png`           | 111 502 | `E5E7C20B8456`    |
| `..._login_no_returnurl_lands_admin.png`      | 111 210 | `51B3A81D78CC`    |
| `..._member_sidebar_admin_link.png`           | 105 986 | `3DA23426C9FE`    |
| `..._rule1_returnurl_beats_admin_default.png` | 105 986 | `3DA23426C9FE`    |
| `..._rule2_admin_stays_on_members.png`        | 105 986 | `3DA23426C9FE`    |

The duplication is **legitimate, not a capture error**: all three end on `/members/hub` as the
same admin in the same theme, so the pixels genuinely are identical. But the consequence is
what matters — **no URL bar is captured**, so the images cannot distinguish "landed on
`/members` because `returnUrl` said so" from "landed there for any other reason".

⚠️ **The screenshots do NOT independently evidence rules 1 and 2. The unit tests are the
evidence for those rules.** Nobody should later read "five screenshots" as five independent
confirmations — it is three distinct frames, and two of the three rules are proven only in
`post-login-destination.service.spec.ts` and `member-guard-wiring.spec.ts`.

#### Recorded, NOT fixed — carried forward

1. ⚠️ **`AdminLayout` has no entitlement on a cold load.** `MemberSessionStore` is seeded in
   exactly two places — `MemberGuard` activation, and the post-login probe. An admin who opens
   `/admin` in a fresh tab against an existing cookie has had neither, so the **Member Panel
   link is hidden** until they sign in again or visit `/members` once. This is **fail-closed**:
   the failure mode is an absent affordance, never a bad bounce. Proposed fix, **not
   implemented**: one `MemberEntitlementService.probe()` from `AdminLayout` per admin session —
   a new probe on the admin surface, deliberately not added without being asked for.
   → whoever next touches `AdminLayout`.
2. ⚠️ **OAuth and magic-link sign-ins bypass the new landing logic entirely.** They never
   re-enter `AuthPageComponent`; `libs/api/licensing/.../auth.controller.ts:353,558` redirects
   them **server-side** to `/` and `/profile`. Making admins land on `/admin` through those
   paths is a license-server change and was out of scope here. → future license-server batch.
3. ⚠️ **`GuestGuard` ignores `returnUrl`** (`libs/web/core/src/lib/guards/guest.guard.ts:33`):
   an already-authenticated visitor hitting `/login?returnUrl=/members` is sent to `/profile`.
   **Pre-existing and orthogonal to rule 1** — rule 1 governs the post-_authentication_ path,
   this governs the already-authenticated one. Reported, not changed.

⚠️ **Committed from a working tree carrying unrelated WIP.** A separate skill-synthesis /
skill-clones feature was live in the tree during this session. Both commits were staged
path-by-path; `git diff --name-only a7edf152c..HEAD` returns **only** `libs/web/**` files, and
nothing under `apps/ptah-extension-vscode/`, `libs/backend/`, `libs/frontend/`, `libs/shared/`,
`CLAUDE.md` or `skills-lock.json` was staged. This is the RK-10 / PRE-7 hazard behaving exactly
as the ledger warned — do not `git add -A` in this tree.

---

## Batch 5: P1b — Discourse removal, theme app retirement, migration 1 ✅ COMPLETE

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: A single wide deletion whose correctness is a repo-wide invariant, not a
per-file property. Migration 1 must land in a fixed position relative to the deletion
(MG-2.4). The frontend edits included here are **wire-contract cleanups**, not UI work —
enumerated explicitly below so the backend developer knows the exact, bounded set.
**Tasks**: 7 | **Dependencies**: Batch 1 (RK-4: relocate and test first, delete second), Batch 4 (RISK-C: frontend schema already dropped `communityUrl`)
**Preconditions**: PRE-2, PRE-7

> **ASSUMPTION-1**: this batch is sequenced after P1e. §8.1's blocker table lists only
> `P1a → P1b`; it does not block P1c/P1d/P1e on P1b. Reordering resolves RISK-C and RISK-D.

**Carried in from B4 and the review findings — read before starting:**

- **RISK-C second half is now due.** B4 (`cdc1a1ef5`) already dropped `communityUrl` from the
  **frontend** `membersSessionsResponseSchema`. This batch removes the **backend** field. Until
  it does, the server sends a key the client silently strips — tolerable, but not the end state.
- **Task 5.6 owns two deliberately-red e2e specs**:
  `apps/ptah-landing-page-e2e/src/specs/members-content.spec.ts` and `members-gate.spec.ts`.
  They have been failing since `cdc1a1ef5` because they assert against the deleted
  `@ptah-web/account` members surface and stub `communityUrl`. **Rewrite them here** — they are
  not a regression and must not be patched anywhere else.
- **Task 5.1 also removes the fifth `ADMIN_EMAILS` caller.** `discourse.controller.ts` was
  re-pointed at `@ptah-api/identity`'s `isAdminEmail` / `isAdminAllowlistConfigured` in
  `69f4ff78e` and then deleted here, leaving four callers. Nothing to migrate — just do not
  re-introduce a local parse while unwinding the module graph.
- **`MemberGuard` and `MemberSessionStore` now live in `@ptah-web/core`, not
  `@ptah-web/members`** (`d1b57ec0f`). `/members` declares `canActivate: [MemberGuard]` in
  `app.routes.ts`; `MEMBER_ROUTES` declares **no** guard and must not regain one — a second
  declaration runs the entitlement probe twice per navigation, and `members.routes.spec.ts`
  fails if one reappears. Do not "restore" the guard into the member lib while unwinding
  imports here.
- **Two cosmetic items are carried to B15, not to this batch** — light-mode gutter stays dark,
  and secondary nav at `text-base-content/60` needs contrast measuring. (The third,
  `member-session.store.spec.ts`, was closed by `af2d22653`.) Full detail in the **Batch 4
  addendum** block above. Do not fix them here.
- **Three further items are carried out of Batch 4 addendum 2** — `AdminLayout` has no
  entitlement on a cold load, OAuth/magic-link sign-ins bypass the post-login landing logic
  (a license-server change), and `GuestGuard` ignores `returnUrl`. None belong to this batch.

---

### Task 5.1: Delete `libs/api/community/src/lib/discourse/` (17 files) ✅ COMPLETE

**Files** (all DELETE):

- `D:\projects\ptah-extension\libs\api\community\src\lib\discourse\` — `admin-community.controller.ts` (+ `.spec.ts`), `admin-community.service.ts`, `builders-membership.service.ts`, `community.controller.ts` (+ `.spec.ts`), `discourse-admin.provider.ts` (+ `.spec.ts`), `discourse-provisioning.service.ts` (+ `.spec.ts`), `discourse-sso.service.ts` (+ `.spec.ts`), `discourse.controller.ts` (+ `.spec.ts`), `discourse.module.ts`, `discourse.types.ts`, `dto/admin-community.dto.ts`
- MODIFY `D:\projects\ptah-extension\libs\api\community\src\index.ts` (remove lines 6-16, the 11 discourse exports)

**Requirement refs**: MG-2.1, MG-2.2, MG-2.3, RK-4
**Dependencies**: Batch 1 (Tasks 1.2, 1.6)

**Implementation details**: routes removed with it — `GET /api/v1/sso/discourse`,
`GET /api/v1/community/summary`, `GET /api/v1/admin/community/topics`,
`GET /api/v1/admin/community/review-queue`.

**Validation notes**:

- **RK-4 / MG-2.2 ordering is non-negotiable**: `BuildersMembershipService` lives inside
  this directory. Its logic was relocated to `libs/api/membership` in Batch 1 **and its
  tests are green** before this deletion. Confirm Batch 1's tests pass before deleting.
- **RISK-A**: this deletion also removes the third `isBuildersMember` at
  `discourse.controller.ts:182`, which is what finally makes R7.2's unqualified gate
  satisfiable (Task 5.7).

**Verification**: `npx nx typecheck api-community`; `npx nx test api-community` — no dangling import, no orphaned spec.

---

### Task 5.2: Unwire the module graph and the structural registries ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\testing\controller-registry.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-guards.spec.ts`

**Requirement refs**: MG-2.3, F-4, PRE-2
**Dependencies**: Task 5.1

**Implementation details**:

- Remove the `DiscourseModule` import + registration from `app.module.ts`.
- Remove `AdminCommunityController`, `CommunityController`, `DiscourseController` from the
  registry (verified present at `controller-registry.ts:13-15`).
- Update `EXPECTED_ROUTES`; **delete the `@Redirect` quirk note at `route-map.spec.ts:49-51`**
  — it exists only for `discourse.controller.ts`.
- Drop the discourse controller cases from `admin-guards.spec.ts`.

**Verification**:

```
npx nx test ptah-license-server --testPathPatterns="route-map|controller-validation|admin-guards"
```

All green; the census reports no missing and no stale entry.

---

### Task 5.3: Remove Discourse from adjacent backend domains ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\billing\src\lib\paddle\paddle.service.ts` (+ `.spec.ts`)
- `D:\projects\ptah-extension\libs\api\community\src\lib\member-groups\member-groups.service.ts`
- `D:\projects\ptah-extension\libs\api\community\src\lib\member-groups\dto\member-group.dto.ts`
- `D:\projects\ptah-extension\libs\api\community\src\lib\member-groups\member-groups.controller.ts`
- `D:\projects\ptah-extension\libs\api\audit\src\lib\audit-log.types.ts`
- `D:\projects\ptah-extension\libs\api\licensing\src\lib\license.controller.ts` (+ `.spec.ts`)
- `D:\projects\ptah-extension\libs\api\community\README.md`

**Requirement refs**: MG-2.3, MG-2.5, NFR-M5
**Dependencies**: Task 5.1

**Implementation details**:

- `paddle.service.ts`: remove the `DiscourseProvisioningService` fan-out call.
- `member-groups`: drop `discourseGroup` from `MemberGroupWithCount`,
  `CreateMemberGroupInput`, `UpdateMemberGroupInput`, `AssignManyResult`, the DTO, and the
  best-effort sync call in the controller.
- `audit-log.types.ts`: remove `'discourse.group.sync'`; rewrite the `:33-36` comment
  (_"no `community._` action because the surface is read-only"\* — no longer true).
- `libs/api/community/README.md`: rewrite _"Why these five directories are ONE lib"_ — the
  `discourse/` ↔ `member-groups/` cycle the README documents is what deleting `discourse/`
  resolves, which is what makes AD-6's lib split possible.

**Verification**: `npx nx test api-billing api-community api-audit api-licensing` — all green.

---

### Task 5.4: Migration 1 — drop `MemberGroup.discourseGroup` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\20260805090000_drop_discourse_group\migration.sql`

**Requirement refs**: MG-2.4, NFR-M3, §1.8
**Dependencies**: Task 5.3
**Pattern to follow**: the 15 existing migrations' naming convention.

**Implementation details**:

- `ALTER TABLE "member_groups" DROP COLUMN "discourse_group";`
- Remove `discourseGroup` from the `MemberGroup` model (`schema.prisma:61`); rewrite the
  `MemberGroup` docblock (`:44-55`).
- **Forward-only.** This is migration **1 of 5**; migration N blocks migration N+1 (§8.1).

**Validation notes**: land this **after** Task 5.3 removes every code reference — otherwise
the app compiles against a column that no longer exists.

**Verification**:

```
npx prisma validate --schema apps/ptah-license-server/prisma/schema.prisma
npm run prisma:migrate:dev
```

Migration applies cleanly; `rg discourseGroup` returns zero hits.

---

### Task 5.5: Retire `apps/ptah-discourse-theme` and its deploy path ✅ COMPLETE

**Files** (DELETE unless noted):

- `D:\projects\ptah-extension\apps\ptah-discourse-theme\` (whole project)
- `D:\projects\ptah-extension\.github\workflows\deploy-community-theme.yml`
- `D:\projects\ptah-extension\docs\deploy\discourse-digitalocean.md`
- MODIFY `D:\projects\ptah-extension\package.json` (remove discourse-theme deploy scripts)
- MODIFY `D:\projects\ptah-extension\tools\migration\manifest.json`
- MODIFY `D:\projects\ptah-extension\CLAUDE.md`

**Requirement refs**: MG-3.1, MG-3.2, MG-3.3
**Dependencies**: Task 5.2

**Implementation details**: `CLAUDE.md` — remove `ptah-discourse-theme` from the module
index; add the new libs (`api/membership`, `api-contracts/community`, `api/member-hub`,
`web/members`; the remaining three are added by their phases) and describe the new
community surfaces (MG-3.2).

**Validation notes**: MG-5 (the `discourse_dev` Docker container and its compose service)
is **NOT** in this batch. MG-5.3 gates decommissioning on MG-1 verification in production,
which is Batch 8. Do not remove the compose service here.

**Verification**:

```
npx nx graph
```

No orphaned project, no broken dependency (MG-3.3). App count drops by one.

---

### Task 5.6: Remaining Discourse references — env, frontend links, docs, e2e ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\.env.example` (`:261-316`), `.env.prod.example` (`:60-79`), `.env`
- `D:\projects\ptah-extension\libs\web\core\src\lib\models\license-data.interface.ts`
- `D:\projects\ptah-extension\libs\web\core\src\lib\services\subscription-state.service.ts`
- `D:\projects\ptah-extension\libs\web\ui\src\lib\navigation.component.ts`
- `D:\projects\ptah-extension\libs\web\auth\src\lib\auth-page.component.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\groups\components\group-form-modal\` (`.ts`, `.html`)
- `D:\projects\ptah-extension\libs\web\admin\src\lib\groups\groups-list\groups-list.html`
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-content.spec.ts`, `members-gate.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\support\` (`auth.ts`, `db.ts`, `env.ts`, `global-setup.ts`), `playwright.config.ts`
- `D:\projects\ptah-extension\docs\deploy\e2e-test-handoff.md`, `founder-setup-checklist.md`, `local-testing-setup.md`
- `D:\projects\ptah-extension\docs\handoff-admin-builders-content-view.md`, `handoff-license-server-validation-pipe.md`

**Requirement refs**: MG-2.6, MG-2.7, NFR-M5
**Dependencies**: Tasks 5.1-5.5

**Implementation details**:

- Remove all eight `DISCOURSE_*` vars: `DISCOURSE_URL`, `DISCOURSE_SSO_SECRET`,
  `DISCOURSE_API_KEY`, `DISCOURSE_API_USERNAME`, `DISCOURSE_BUILDERS_GROUP`,
  `DISCOURSE_THEME_API_KEY`, `DISCOURSE_THEME_API_USERNAME`, `DISCOURSE_THEME_ID`.
  **Add `YOUTUBE_API_KEY`** in the block they vacate (used from Batch 9).
- `navigation.component.ts`: repoint the community link to `/members/community` (MG-2.7).
- `auth-page.component.ts`: remove the discourse return-url branch.
- e2e: rewrite `members-content` / `members-gate` against the new `/members`; drop discourse
  fixtures and env from the support files.

**Validation notes**: these are the **bounded** frontend edits this backend batch owns —
wire fields, links and env, not UI. Anything beyond this list belongs to a frontend batch;
if you find one, stop and report rather than widening scope (PRE-7 / RK-10).

**Verification**: `npx nx typecheck web-core web-ui web-auth web-admin ptah-landing-page`; `npx nx e2e ptah-landing-page-e2e` green.

---

### Task 5.7: NFR-M5 + R7.2 final sweep (unqualified form) ✅ COMPLETE

**Files**: (assertions only)
**Requirement refs**: R7.2, NFR-M5, MG-3.3, RK-3
**Dependencies**: Tasks 5.1-5.6

**Validation notes**: **RISK-A closes here.** Batch 1 could only assert the scoped form
because `discourse.controller.ts:182` held a third implementation inside the
to-be-deleted directory. With that directory gone, the unqualified R7.2 gate is satisfiable.

**Verification**:

```
rg 'async isBuildersMember|isBuildersMember\(userId' --glob '!node_modules' -n
# expected: exactly one implementation — libs/api/membership/src/lib/membership.service.ts

rg -i discourse --glob '!node_modules' --glob '!.nx' --glob '!coverage' \
                --glob '!dist' --glob '!.ptah/specs' \
                --glob '!docs/community/discourse-export.json'
# expected: ZERO hits

npx nx graph
npm run lint:all && npm run typecheck:all && npm run test
```

---

**Batch 5 Verification (exit gate — also the Phase 1 gate, §8.2)**:

- `rg 'isBuildersMember'` → exactly **one** implementation (R7.2, RISK-A closed)
- `rg -i discourse` (excluding the export JSON and this task's specs) → **zero** hits (NFR-M5)
- `/members` renders with `PanelLayout` in both themes (from Batch 4, re-confirmed)
- Hub responds in **one** request, asserted (R6.2)
- `members.routes.spec.ts` green (R9.4)
- Migration 1 applied; `nx graph` clean with no orphaned project (MG-3.3)
- `npm run lint:all`, `npm run typecheck:all`, `npm run test` all green

---

### Batch 5 result ✅ COMPLETE — deviations and gate qualifications

**Every deviation below is a deliberate decision with its reasoning recorded. Read
this before treating any of it as an oversight.**

#### ⚠️ MG-5.3 DEVIATION — decommission gate lifted, user-decided

The plan (§6.1, Task 5.5 validation note, Batch 8 coarse task 6) gates removing the
`discourse_dev` compose service on **MG-1 verified in production**, i.e. Batch 8.
**The user lifted that gate for this batch, and the evidence supports it**:

- **Production is empty.** Recorded in `context.md` before the task began.
- **The real content is 17 topics / 19 posts / 4 categories in a LOCAL
  `discourse_dev` container**, not in production.
- **It is already exported** to `docs/community/discourse-export.json`, committed
  `6614f9e92`. The gate existed to stop content being destroyed before migration;
  the content is on disk, in git, independent of any container.

So the gate protected nothing that is not already protected. **What was and was
not done, precisely:**

- ✅ Compose _wiring_ removed: the `extra_hosts: host.docker.internal` entry that
  existed only to reach the container, its comment block, the four
  `scripts/discourse-dev-*.sh` helpers, and the `npm run docker:up` / `docker:down`
  chaining into them.
- 🛑 **The user's running local container and its volume were NOT touched.** Batch 8
  still verifies the seed against it. Do not stop or delete it there either —
  verify first.
- 🛑 **Production was NOT decommissioned in this batch.** Nothing was executed
  against the droplet. The full ordered procedure is written and unexecuted at
  `.ptah/specs/task_2026_177/decommission-runbook.md`, with a §5 execution log.

**⚠️ CORRECTION TO THE BRIEF, VERIFIED**: there is **no `discourse_dev` service in
`docker-compose.yml` to drop.** The container is driven by Discourse's own
`d/boot_dev` in WSL and was never a compose service —
`scripts/discourse-dev-up.sh:13` said so explicitly. What existed in compose was
only the wiring listed above.

#### ⚠️ NFR-M5 gate — one exclusion must be added, and it is not optional

`rg -i discourse` returns **zero** hits across the workspace **except three Prisma
migration files**, which cannot be cleaned and must be excluded:

```
apps/ptah-license-server/prisma/migrations/20260719160000_add_member_groups/migration.sql   (3)
apps/ptah-license-server/prisma/migrations/20260801120000_add_packs/migration.sql           (1)
apps/ptah-license-server/prisma/migrations/20260805090000_drop_discourse_group/migration.sql (2)
```

**The first two are pre-existing and already applied** — editing an applied
migration changes its checksum and breaks every existing database. **The third is
migration 1 itself**: `ALTER TABLE "member_groups" DROP COLUMN "discourse_group"`
cannot drop a column without naming it, and §1.8 fixes the migration's name.

**This is a contradiction inside the plan, not something this batch introduced.**
§1.8 names the migration `20260805090000_drop_discourse_group` while §6.5 demands
zero hits with no migration exclusion — the two could never both hold. The
migration directory is an append-only historical ledger, exactly the case §6.2
already accepts for the handoff docs ("historical accuracy is preserved in git").

**The gate command should read:**

```bash
rg -i discourse --glob '!node_modules' --glob '!.nx' --glob '!coverage' \
                --glob '!dist' --glob '!.ptah/specs' \
                --glob '!docs/community/discourse-export.json' \
                --glob '!apps/ptah-license-server/prisma/migrations/**'
# verified: ZERO hits
```

#### ⚠️ Scope additions beyond Task 5.6's file list — both user-confirmed

Task 5.6 says to stop and report rather than widen scope (PRE-7 / RK-10). Two items
outside its list were blocking, so they were raised and **explicitly approved**:

1. **`libs/web/admin/src/lib/builders/community/` DELETED** (`community-view.ts`,
   `.html`, `.spec.ts`), with its `/admin/builders/community` route, its sidebar
   entry, and the `listCommunityTopics()` / `getReviewQueue()` methods plus their
   Zod envelopes in `admin-builders-api.service.ts`. It called
   `GET /v1/admin/community/{topics,review-queue}`, both deleted by Task 5.1, so it
   could only 404; it also held ~40 of the remaining hits. §6.2 assigns the rebuild
   to Phase 2 — Batch 7 builds a **new** surface against new contracts, not this one
   restored. A comment at each removal site says so.
2. **`CLAUDE.md` edited** (3 lines: the two `ptah-discourse-theme` module-index
   entries, plus the app count `14 → 13`). Required by Task 5.5. The brief marked
   the file foreign; it was clean in git, so there was no foreign hunk to collide
   with. **Left unstaged** — the team-leader decides whether it joins this commit.

#### Deviations from the letter of the plan, with reasons

| Plan text                                                                                                  | What was done instead                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.6: "`auth-page.component.ts`: remove the discourse return-url branch"                                    | Branch KEPT; only its comment rewritten      | `isAllowedAbsoluteReturnUrl` is a generic origin allowlist (own origin + API origin), not forum wiring. It is the only thing between a crafted `?returnUrl=https://evil` and a post-auth **open redirect**. The forum SSO bounce was its first _motivation_, never its scope. Deleting it would remove a live security control to tidy a comment.                                                                                                                                                                  |
| 5.2: "drop the discourse controller cases from `admin-guards.spec.ts`"                                     | G5 deleted entirely; G4 **and G6** repointed | G5's subject (`AdminCommunityController`) no longer exists, and re-pointing it at Phase 2's moderation controllers would assert read-only against a surface that owns writes by design. G6's forbidden-import regex named `builders-membership.service`, now deleted — a pattern that can never match reads as coverage but is vacuous, so it now names `MembershipService`, the live thing packs must not reach for.                                                                                              |
| 5.4 verification: `npm run prisma:migrate:dev`                                                             | `prisma migrate deploy`                      | `migrate dev` refused and demanded a **full database reset** over a PRE-EXISTING checksum drift on an unrelated migration (`20260724120000_seed_marketing_templates_v2`, edited after being applied — committed in `4db8de4df`, not by this batch). Resetting would have destroyed the local dev DB **including Batch 1's seeded entitlement**, which the B1/B3/B6 exit gates depend on. `migrate deploy` applied migration 1 non-destructively. **The drift is unfixed and reported, not swallowed** — see below. |
| §6.2: `packs.types.ts` / `admin-packs.controller.ts` docblocks describe "the new `/members/packs` channel" | Described as **Phase 5, not yet built**      | The member endpoint does not exist yet (Batch 14). Writing it in the present tense would have been false.                                                                                                                                                                                                                                                                                                                                                                                                          |

#### Verification actually run — every command and its result

```
npx nx test api-membership --skip-nx-cache                 → 3 suites, 23 tests PASS   (RK-4 pre-check before deleting)
npx prisma validate --schema .../schema.prisma             → valid
prisma migrate deploy                                      → 20260805090000_drop_discourse_group APPLIED
psql -tAc "…information_schema.columns…member_groups"      → discourse_group ABSENT; 7 columns remain
prisma generate                                            → client regenerated (7.7.0)
npx nx show projects                                       → 90 projects; ptah-discourse-theme GONE (MG-3.3)

npx nx run-many -t eslint:lint,typecheck,test -p api-membership,api-member-hub,
  api-community,api-identity,api-admin,ptah-license-server --skip-nx-cache
                                                           → PASS, 6 projects
npx nx run-many -t eslint:lint,typecheck,test -p api-billing,api-audit,api-licensing,
  api-contracts-community,web-core,web-ui,web-auth,web-admin,web-members,ptah-landing-page
                                                           → PASS, 10 projects

rg 'async isBuildersMember|isBuildersMember\(userId'       → ONE: libs/api/membership/src/lib/membership.service.ts:69
                                                             ✅ R7.2 unqualified gate satisfied; RISK-A CLOSED
rg -i discourse (exclusions above)                         → ZERO

npm run lint:all                                           → PASS, 68 projects, 0 errors (25 pre-existing warnings)
npm run typecheck:all                                      → PASS, 85 projects
npm run test                                               → PASS, 3 projects, 36 tests
```

⚠️ **`npm run test` is NARROWER than its name suggests — do not read it as full
coverage.** It runs **three** projects (`ptah-extension-vscode`,
`ptah-extension-webview`, `@ptah-extension/shared`, per `CLAUDE.md`'s Development
Commands). It touches **none** of the api libs or the license server this batch
changed. The backend evidence is the two explicit `nx run-many` invocations above,
covering all 16 touched projects. A future batch reading only "`npm run test` green"
off this ledger would be reading a gate that never looked at its code.

**One test constant had to be re-derived, and the arithmetic is recorded rather than
merely lowered**: `controller-validation.spec.ts`'s anti-vacuity floor
`MIN_TOTAL_PAYLOAD_PARAMS` 39 → **37**, and `NAMED_PRIMITIVE_PARAM_COUNT` 8 → **6**.
The entire drop is the deleted SSO controller's two named primitives (`sso`, `sig`);
the whole-object count is **unchanged at 31**, which is what proves no bound payload
param went missing unnoticed. Both numbers were re-derived by running the suite. The
docblock now states that a deletion is the only thing that may lower this floor and
that it must be justified in place every time.

#### 🔴 Reported, NOT fixed — carried forward

1. **Prisma migration checksum drift, PRE-EXISTING and out of scope.**
   `20260724120000_seed_marketing_templates_v2` was modified after being applied
   (last touched by `4db8de4df`, "relaunch Builders early-adopter offer"). Any
   `prisma migrate dev` now demands a full reset of the dev database. Migration 1
   was applied with `migrate deploy` to avoid that. **This will bite the next
   migration (Batch 6) exactly the same way.** Fixing it means either restoring
   that file's original content or updating its checksum in `_prisma_migrations` —
   a deliberate decision that belongs to whoever owns that change, per PRE-7.
2. **`libs/web/admin`'s admin community surface is gone until Batch 7.** The
   sidebar no longer has a Community entry. Deliberate, approved, and noted here so
   Batch 7 knows the entry must be re-added, not just the page.
3. **Production `community.ptah.live` is still running.** Nothing was executed
   against it. See `decommission-runbook.md`.
4. **`API_PUBLIC_URL` was removed from `.env.example` / `.env.prod.example` / `.env`
   / `.env.prod`** along with the eight `DISCOURSE_*` vars. It had **zero** code
   readers left — its only consumer was the deleted SSO controller's login-bounce
   `returnUrl`. Called out because it is not on §6.3's list of eight.

⚠️ **Committed-from state**: the working tree carried the unrelated skill-synthesis
WIP throughout (`libs/backend/skill-synthesis`, `rpc-handlers`, `frontend/ui`,
`frontend/editor`, `skill-synthesis-ui`, `shared`, `apps/ptah-extension-vscode`) plus
`skills-lock.json`. **Nothing in this batch was staged or committed** — the
team-leader owns commits. `git add -A` was never used; the one `git rm` was
immediately `git reset` so the index stayed empty and uniform. **`--no-verify` was
never used.**

---

# PHASES 2-5 — batch-level shape

> **Refinement happens at each phase boundary**: when the preceding phase's exit gate is
> green and committed, the orchestrator re-invokes team-leader in MODE 1-refine for the next
> phase's batches. Enumerating 100+ hours of work at full fidelity up front would be
> guessing — each phase's real artefacts inform the next one's detail, and Phase 2 proved it
> (the census constants, the `V-CURL` cookie correction and the Prisma-7 command shapes were
> all discovered by execution, not by planning).
>
> **Batches 6–8 (Phase 2) are ✅ COMPLETE**, each with a result block recording deviations,
> corrections to this document, and carried-forward items.
> **Batches 9–11 (Phase 3) were refined on 2026-08-05** and are fully decomposed below.
> **Batches 12–16 remain coarse** and carry only their **executor**, **mode**,
> **dependencies**, **§8.2 exit gate** and **scope boundary** — enough for the orchestrator
> to sequence and for the next refine pass to expand.
>
> 🔴 **A refine pass must read the preceding phase's execution reports, not just this file.**
> The Phase-3 decomposition below is built on 25+ verified findings from
> `batch-6a/6b/6c`, `batch-6.1`, `batch-7`, `batch-7.1` and `batch-8` reports in this folder.
> Phase 2 lost three dispatches to specs that could not be followed as written — the Prisma
> `--from-url` flag, `V-CURL`'s Bearer header, and the admin controller nesting. Every one of
> those is now encoded as a named trap in the tasks that would otherwise repeat it.

---

## Batch 6: P2-BE — `libs/api/forum` + migration 2 ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: The largest single lib in the task (~30 files across nine services). Depth
enforcement, `postCount` transactional maintenance and the query budget are cross-cutting
invariants, not independent files.
**Dependencies**: Batch 5 (migration 1 must precede migration 2), Batch 1, Batch 2, Batch 3
**Preconditions**: PRE-1, PRE-2, PRE-6, PRE-7
**Tasks**: 15 (refined at the Phase-1/Phase-2 boundary, 2026-08-04)

**Scope boundary (RK-1)**: no trust levels, no spam heuristics, no flag queues, no digests,
no websockets, no denormalized reaction counters, no reconciliation job, no `tsvector`, no
external search. §5 of the requirements is normative.
**Exit gate (§8.2 P2, backend half)**: a depth-3 reply attempt attaches at depth 2
server-side · NFR-P4 25-topic feed ≤ 5 queries, asserted · soft-delete filter spec green ·
`route-map` + `controller-validation` green · **migration 2 applied against the running
`ptah_db` with `pg_trgm` and both trigram indexes present in `pg_indexes`** · a
`visibility: 'cohort'` category is invisible (404, never 403) to the zero-cohort dev
account while `visibility: 'member'` categories are visible.

---

### Ground truth that changed after the plan was written — read before starting

**Everything in this block was verified on 2026-08-04, after `fd1b4557e`. Do not plan
against the plan's stale facts.**

1. **The Discourse integration is gone from the repo AND from production.** The production
   container, its DNS record, its disk and its API keys were destroyed on 2026-08-04. The
   local `discourse_dev` container has also been deleted by the user. Nothing in Phase 2
   may read a forum, local or remote. The only content source is
   `docs/community/discourse-export.json` (committed `6614f9e92`).
2. **The `api-community` file-level dependency cycle is RESOLVED** — `discourse/` was its
   other half. `libs/api/community/README.md` now records this. **AD-6's further lib split
   is therefore unblocked but is DEFERRED, deliberately — see the decision note below.**
3. **`libs/web/admin`'s community surface was DELETED in Batch 5 with user approval**
   (`community-view.ts/.html/.spec.ts`, the `/admin/builders/community` route, its sidebar
   entry, and `listCommunityTopics()` / `getReviewQueue()` plus their Zod envelopes in
   `admin-builders-api.service.ts`). Batch 7 **adds a new** admin moderation surface
   **including a sidebar entry** — it does not restore the old one. Removal-site comments
   at `admin.routes.ts:167-169` and `admin-builders-api.service.ts:398-403` say so.
4. **Structural test G5 in `admin-guards.spec.ts` was DELETED** (it asserted the admin
   community controller was read-only; the native surface owns writes by design). **G4 and
   G6 were repointed at `MembershipService`.** G1 still enumerates admin controllers by
   hand in two `it.each` tables — Task 6.13 adds this batch's three.
5. **`controller-validation.spec.ts` constants are now `MIN_TOTAL_PAYLOAD_PARAMS = 37` and
   `NAMED_PRIMITIVE_PARAM_COUNT = 6`.** The first is a floor (`>=`); the second is an
   **exact-equality** assertion. See RISK-I below — this batch touches both.
6. **`audit-log.types.ts` no longer carries `'discourse.group.sync'`**, and its `:35-41`
   comment now says `community.*` actions land with Phase 2's moderation controllers.
   **Task 6.13 owns adding them**, and owns rewriting that comment from "not yet" to a
   description of what is there.
7. **`member_groups` holds exactly one row: `key='founding'`, `is_default = true`** (V-DB,
   2026-08-04). **RISK-G is empirically closed**, though B8 still runs its pre-flight
   because the row can change. Member-group assignments are still **0**, which is what
   makes the B6 exit gate's cohort-invisibility check meaningful.
8. **`pg_trgm` 1.6 is available and `trusted` on the local PostgreSQL 16.13, and the local
   `ptah` role is a superuser.** `CREATE EXTENSION` will succeed locally. Production is a
   different question — see RISK-H.

#### AD-6 lib split — DEFERRED, with the reason

**Batch 6 does NOT split `libs/api/community`.** The cycle removal makes the split
_possible_; nothing in R1, R1.7 or R8 makes it _necessary_. Three reasons to defer:

- **Batch 6 does not touch `libs/api/community` at all.** The forum is a new lib. Splitting
  the old one here would put a large, risky, untested-by-this-batch refactor inside the
  batch that already carries the task's biggest new lib and its hardest migration.
- **B12 and B14 are about to rewrite three of the four surviving directories**
  (`google-sessions/`, `packs/`, and the new `live-sessions/`). Splitting before those land
  invalidates their file lists and forces the split to be redone or reconciled.
- **The README that documents the resolution was rewritten in Batch 5** and explicitly
  frames the split as "a free choice about cohesion rather than something the graph
  forbids". A free choice with no consumer is scope inflation (RK-1).

**Recommended owner**: a follow-up task after B16, or B16's documentation sweep if it
proves trivial. Recorded here so the next reader knows it was decided, not forgotten.

---

### Risks surfaced by the Phase-2 refine pass

These are **new** — none is in the plan's risk table or in this file's Plan Validation
Summary. Batches 7 and 8 reference them by handle.

| #          | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Sev                 | Mitigation                                                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-H** | **`CREATE EXTENSION pg_trgm` would be boot-blocking if it failed in PRODUCTION.** The license-server Dockerfile CMD is `npx prisma migrate deploy && node main.cjs`, so a migration that cannot apply means the process **never starts** — a boot-blocking failure, not a degraded feature. ⚠️ **SEVERITY DOWNGRADED HIGH → LOW ON EVIDENCE (2026-08-04).** The premise was a managed-Postgres app role without `CREATE`. Production is **not** managed: it is a `postgres:16-alpine` container on the droplet, and the live check returns `current_user=ptah, usesuper=t` with `pg_trgm 1.6` available and not yet installed. The extension **will** create. The boot-blocking MECHANISM is real and stays documented — it is why any failing migration is an outage — but this particular failure cannot occur on today's infrastructure. **Re-raise to HIGH if the database ever moves to Neon or any managed provider**, which `founder-setup-checklist.md` §2.4 still contemplates. | **LOW** (was HIGH)  | Task 6.4 keeps the privilege pre-flight — cheap, and it is the thing that would catch a provider migration. Do **not** wrap `CREATE EXTENSION` in a swallow-all `DO $$ … EXCEPTION` block: an index silently missing is worse than a loud failure, because A-7's whole search design assumes it.           |
| **RISK-I** | **`NAMED_PRIMITIVE_PARAM_COUNT = 6` is an exact-equality assertion, not a floor.** One `@Query('q') q: string` anywhere in this batch fails the build. `MIN_TOTAL_PAYLOAD_PARAMS = 37` is a floor and will be exceeded, but leaving it at 37 makes it progressively more vacuous.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | MED                 | Every `@Query()` in this batch binds a **whole-object DTO** through `dtoPipe` (PRE-1), so the named count stays 6. Task 6.14 raises `MIN_TOTAL_PAYLOAD_PARAMS` to the re-derived value and justifies the new number in the docblock, the way `fd1b4557e` justified lowering it.                            |
| **RISK-J** | **The plan's admin controller split violates RI-1.** §2.5 proposes `admin-categories.controller.ts` at `v1/admin/community/categories` **and** `admin-topics.controller.ts` at `v1/admin/community`. The second is a strict path-prefix of the first — exactly the shape RISK-B caught for `v1/members`. `KNOWN_PREFIX_DEBT` and `PREFIX_EXCEPTIONS` are both **empty arrays** at HEAD, so there is no debt list to add to and the build fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **HIGH**            | Task 6.13 lands **three** admin controllers at three disjoint literal depth-4 prefixes — `v1/admin/community/categories`, `v1/admin/community/topics`, `v1/admin/community/posts`. No controller sits at bare `v1/admin/community`. Do not "fix" a failure here by adding an entry to `PREFIX_EXCEPTIONS`. |
| **RISK-K** | ~~The pre-existing Prisma checksum drift blocks `prisma migrate dev`.~~ ✅ **CLOSED — DISPROVED EMPIRICALLY 2026-08-05.** All 18 rows in `_prisma_migrations` were compared against the `sha256sum` of their `migration.sql` on disk and **every one matches**, `20260724120000_seed_marketing_templates_v2` included. `097853b39`'s restore fixed it; B5's carried-forward item 1 and this row were both written before anyone checked. B6 still hand-authored (correctly — that is safe either way, and _running_ `migrate dev` to find out was the one experiment with a destructive failure mode). **Batch 9 may use `prisma migrate dev --create-only` normally.**                                                                                                                                                                                                                                                                                                                  | ~~HIGH~~ **CLOSED** | None needed. Re-run the checksum comparison before trusting this — any future edit to an applied migration re-opens it. `--from-config-datasource` stays the safer habit but is no longer a workaround.                                                                                                    |
| **RISK-L** | **`ForumModule`'s import list in plan §2.5 names `NotificationsModule`, which does not exist until Batch 14.** Copying the list verbatim produces an unresolvable import and a red `app.module.spec.ts` boot test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MED                 | Task 6.14 omits it and records the omission in the module docblock. B14 adds the import together with the producers it exists for.                                                                                                                                                                         |
| **RISK-M** | **PRE-3 as written ("exactly the nine symbols … 8 export lines") goes stale the moment Batch 7 promotes `ThreadRow` and `TagChip`.** Every later frontend batch confirms PRE-3 in its report; after B7 the literal count is wrong and a careful developer will read a legitimate change as a violation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | MED                 | Task 7.1 states the new count in its report **and** in `libs/web/panel-ui/src/index.ts`'s header, so the number has one authoritative home rather than being re-asserted from a stale precondition. B10/B13/B15 read the barrel, not PRE-3's number.                                                       |

---

### Assumptions this refine pass takes (not in the plan; flag if wrong)

- **ASSUMPTION-4 — `visibility: 'staff'` resolves visible to admins only.** R1.1.1 defines
  the three values and R1.1.3 fixes the 404 posture, but no requirement says _who_ sees
  `staff`. The only defensible reading is "admin only" (that is what the word means, and
  the MG-1.4 mapping sends Discourse's `Staff` category there). Task 6.5 therefore lets
  `ctx.isAdmin` satisfy the `staff` branch of `buildCategoryVisibilityWhere` — **the one
  place in this task where `isAdmin` participates in a member-side decision**. It grants no
  write authority and no cohort content; admin moderation stays behind `AdminGuard`. The
  docblock must say all of this, and a spec must assert that a non-admin entitled member
  gets **404** on a `staff` category and on every topic inside it.
- **ASSUMPTION-5 — the R1.2.3 "editable window" is 24 hours, admins exempt.** R1.2.3 says
  "within an editable window" and never gives a value; §3.3's error table proves a window
  exists (`403 (not author / window closed)`). Task 6.7 declares **one** exported constant
  in `common/`, uses it in exactly one place, and states the chosen value in the report so
  the user can overrule a number rather than hunt for it.

---

### Task 6.1: Scaffold `libs/api/forum` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\project.json`
- `D:\projects\ptah-extension\libs\api\forum\tsconfig.json` (+ `.lib.json`, `.spec.json`)
- `D:\projects\ptah-extension\libs\api\forum\jest.config.cts`
- `D:\projects\ptah-extension\libs\api\forum\README.md`
- `D:\projects\ptah-extension\libs\api\forum\src\index.ts`
- `D:\projects\ptah-extension\tsconfig.base.json`

**Requirement refs**: AD-6, NFR-M2, NFR-M4, §2.1
**Dependencies**: none within the batch — this is its root
**Pattern to follow**: `libs/api/member-hub/project.json` (the most recent `type:feature`
api lib, same depth).

**Implementation details**:

- `{ "name": "api-forum", "tags": ["scope:api", "type:feature"] }`
- `tsconfig.base.json`: `"@ptah-api/forum": ["./libs/api/forum/src/index.ts"]`
- README states the lib's boundary: it owns categories, topics, posts, reactions, read
  state and search, and it exports **only** `TopicsReadService` and `ReadStateService`
  (§2.5) — those are the two things `member-hub` composes. A wider barrel would let a
  future consumer reach past the guard chain.

**Validation notes**:

- `type:feature → { feature, data-access, ui, util, core }`, so depending on `api-core`,
  `api-identity`, `api-audit`, `api-membership` (all `type:util`) and
  `api-contracts-community` (`scope:api-contracts`) is permitted. RISK-F does **not** apply
  here — that constraint bites `type:util` libs only.
- **Shared-registry serialisation** (`context.md`): this task edits `tsconfig.base.json`.
  No other batch may be running that also edits it. B7 and B8 do not.

**Verification**:

```
nx show project api-forum
npx nx lint api-forum
```

Project resolves; zero boundary violations.

---

### Task 6.2: Phase-2 wire contracts in `@ptah-contracts/community` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-topic.contract.ts` (EXTEND)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-search.contract.ts` (NEW)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\admin\admin-topic.contract.ts` (NEW)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\index.ts`

**Requirement refs**: §3.3, NFR-S4, RK-8, R1.1.2, R1.7.1, R1.7.5, AD-6
**Dependencies**: Task 6.1
**Pattern to follow**: the existing `member-topic.contract.ts`, whose docblock already
says _"the fuller per-surface types … are added by Batch 6 (P2-BE), in THIS file"_.

**Implementation details**:

- Member types, all in `member-topic.contract.ts` beside `HubTopicSummary`:
  `MemberCategory` (`id, slug, name, description | null, visibility, sortOrder,
topicCount, unreadCount`), `MemberTopicSummary`, `MemberTopicDetail`, `MemberPost`.
  Each gets a Zod schema `satisfies z.ZodType<T>`, matching the file's existing idiom —
  the schema is what the **frontend** parses at its HTTP boundary in Batch 7.
- `MemberTopicDetail` carries `acceptedPost: MemberPost | null` **and** the same post in
  its chronological position with `accepted: true` (§3.3, R1.5.1). The duplication is
  deliberate and must be stated in the docblock, or a reader will "fix" it.
- `MemberPost` carries `deleted: boolean` and, when deleted, a **tombstone**: `bodyMarkdown`
  is the empty string and `authorName` is `null` (R1.3.5). A deleted post's body must never
  reach the wire.
- `member-search.contract.ts`: `SearchExcerpt = { text: string; matches: { start: number;
length: number }[] }` — **plain text plus offsets, never HTML** (R1.7.5). Plus
  `MemberSearchResults = { topics: Paged<…>; posts: Paged<…>; lessons: Paged<…> }`.
- `admin/admin-topic.contract.ts` **re-declares** `AdminCategory`, `AdminTopicSummary`,
  `AdminPost`. Admin types carry what member types must not: `deletedAt`, `deletedBy`,
  `authorEmail`. **No `extends`, no import from `member/`, in either direction.**

**Validation notes**:

- **This is the earliest artefact Batch 7 needs.** §8.1 lets the frontend build against
  stubs, and this file is what makes a stub type-accurate. If B7 is dispatched
  concurrently, it starts here.
- `contract-boundary.spec.ts` is the enforcement (Task 2.5). It must stay green with the
  new `admin/` file — that is the first time the spec has a second admin file to police.
- **`lessons` is declared now and returns an empty `Paged` until Batch 9.** Declaring it
  later would change the search response shape mid-task, which is the same failure R6.6
  exists to prevent on the hub.

**Verification**:

```
npx nx typecheck api-contracts-community
npx nx test api-contracts-community
```

Green. Then temporarily add `interface AdminTopicSummary extends MemberTopicSummary` and
confirm `contract-boundary.spec.ts` **fails**; revert. Report both results.

---

### Task 6.3: Prisma schema — the five forum models and the `User` back-relations ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`

**Requirement refs**: §1.3, §1.7, AD-9, AD-10, AD-11, R1.1.1, R1.4.1, A-6
**Dependencies**: Task 6.1
**Pattern to follow**: the `Pack` / `MemberGroup` models already in the file.

**Implementation details**:

- `Category`, `Topic`, `Post`, `PostReaction`, `TopicReadState` **verbatim from §1.3**,
  including every `@@index`, every `onDelete` and every rejected-index comment. The
  comments explaining what was rejected and why are part of the deliverable — they are what
  stops the next contributor adding the index the plan already reasoned away.
- `User` back-relations per §1.7: `topics Topic[] @relation("TopicAuthor")`,
  `posts Post[] @relation("PostAuthor")`, `postReactions PostReaction[]`,
  `topicReadStates TopicReadState[]`.
- `authorId` is `String? @db.Uuid` — `User.id` is `@db.Uuid` (`schema.prisma:19`). A plain
  `String` FK against a `uuid` column is a migration-time error, not a compile-time one.
- **No `Topic.body` column** (AD-9). Post #1 **is** the body. Adding one later would create
  two sources of truth for the same text.

**Validation notes**:

- **This task writes the schema only. It does NOT create a migration folder and does NOT
  run any `prisma migrate` command.** Task 6.4 owns that, and the separation is what makes
  the drift workaround reviewable: the schema diff and the SQL are two artefacts that must
  agree, not one artefact that must be trusted.
- `onDelete: Restrict` on `Topic.category` and on `Post.parent` are both deliberate (§1.3).
  Do not soften either to `Cascade` to make a test easier.

**Verification**:

```
npx prisma validate --schema apps/ptah-license-server/prisma/schema.prisma
```

Valid. `git diff` on `schema.prisma` shows **only** the five models plus the four `User`
back-relations — no incidental reformatting of neighbouring models.

---

### Task 6.4: Migration 2 — hand-authored, `pg_trgm`, two trigram indexes ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\20260812090000_community_forum\migration.sql` (NEW)

**Requirement refs**: §1.8, A-7, NFR-M3, MG-2.4 ordering
**Dependencies**: Task 6.3
**Pattern to follow**: `20260805090000_drop_discourse_group/migration.sql` — the folder
Batch 5 hand-authored for exactly this reason.

**Implementation details, in order**:

1. **Privilege pre-flight (RISK-H), BEFORE writing anything**:
   ```
   psql "$DATABASE_URL" -tAc "select current_user, rolsuper from pg_roles where rolname = current_user;"
   psql "$DATABASE_URL" -tAc "select name, installed_version from pg_available_extensions where name = 'pg_trgm';"
   ```
   Local expectation (verified 2026-08-04): `ptah | t`, and `pg_trgm | 1.6 |` with an empty
   installed version. If the **production** `DATABASE_URL` is reachable, run the same two
   queries against it and record the result. If it is not reachable, say so in the report
   and name the check as a **pre-deploy gate** — do not assume it passes.
2. **Generate the DDL without `migrate dev`** (RISK-K — `migrate dev` demands a full reset
   over the pre-existing `20260724120000_seed_marketing_templates_v2` checksum drift, which
   would destroy Batch 1's seeded dev entitlement that the B1/B3/B6 gates depend on):
   ⚠️ **CORRECTED 2026-08-05 (B6 C-1/C-2). The command originally written here does not
   exist on the installed Prisma 7.7.0** — `--from-url` and `--to-schema-datamodel` were
   both removed (`Error: --from-url was removed. Please use --[from/to]-config-datasource`).
   **Migrations 3, 4 and 5 must use the corrected form**:

   ```
   cd apps/ptah-license-server && DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" \
     npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```

   `prisma.config.ts` sets `datasource.url` from `process.env['DATABASE_URL']`, so
   `--from-config-datasource` reads **the live database** exactly as `--from-url` did:
   **no shadow database is created and nothing is reset.** B6 proved the equivalence by
   confirming the seeded dev entitlement survived the run.

   ⚠️ **Do not redirect stdout straight into `migration.sql`.** Prisma 7 writes a dotenv
   banner (`◇ injected env (0) from .env …`) to **stdout** ahead of the script, which
   produces a SQL file whose first line is not SQL. Strip it and assert the file begins
   with `-- CreateTable`, or use Prisma's `-o/--output` flag.

   Read the generated SQL before doing anything else: it must contain five
   `CREATE TABLE`s and their indexes and **nothing else**. Any unrelated `ALTER`/`DROP` in
   that output is drift between the schema file and the live database — stop and report it
   rather than committing it inside this migration.

3. **Append the hand-written block** Prisma cannot express (§1.8, A-7):
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX "community_topics_title_trgm" ON "community_topics" USING gin (title gin_trgm_ops);
   CREATE INDEX "community_posts_body_trgm"   ON "community_posts"  USING gin (body_markdown gin_trgm_ops);
   ```
   A comment above the block must say that these are invisible to Prisma's model, that a
   later `migrate diff` will therefore never mention them, and that **`prisma migrate diff`
   output must be read before every subsequent migration** so nothing drops them.
4. **Apply and regenerate**:
   ```
   npx prisma migrate deploy
   npx prisma generate
   npx prisma migrate status
   ```

**Validation notes**:

- **Keep the plan's `20260812090000_community_forum` name.** This file's migration table
  (line ~81) says to let Prisma generate the timestamp — **that instruction is superseded
  by RISK-K**: `migrate dev --create-only` is exactly the command that refuses. The
  hand-picked timestamp only has to sort after `20260805090000`, which it does.
- **Should the drift be repaired first? No — not in this task, and this is a considered
  answer, not a deferral by omission.** Repairing it means either (a) restoring
  `20260724120000_seed_marketing_templates_v2/migration.sql` to its pre-`4db8de4df` content
  from git, which makes the checksum match again without touching data — but silently
  discards the _content change_ `4db8de4df` intended, which must then be re-landed as a new
  migration; or (b) updating that row's `checksum` in `_prisma_migrations`, which blesses
  the edit on **this** database and no other. Both are decisions belonging to the owner of
  `4db8de4df` (PRE-7), and both are riskier than the workaround. **But it does not go
  away**: migrations 3, 4 and 5 will each hit it, and every developer who runs
  `prisma migrate dev` on this workspace hits it. Recommended: raise it as its own task
  after Phase 2, with option (a) plus a follow-up migration.
- **Never run `prisma migrate reset` or `prisma db push` in this workspace.** Both destroy
  the seeded dev entitlement (`context.md`), which silently makes three later exit gates
  unreachable rather than red.
- Production ordering is handled by the image, not by procedure — the Dockerfile CMD is
  `npx prisma migrate deploy && node main.cjs`, so schema and code always ship together.
  That is also precisely why RISK-H is boot-blocking.

**Verification**:

```
npx prisma migrate status
psql "$DATABASE_URL" -tAc "select extname from pg_extension where extname = 'pg_trgm';"
psql "$DATABASE_URL" -tAc "select indexname from pg_indexes where indexname like '%_trgm';"
psql "$DATABASE_URL" -tAc "select table_name from information_schema.tables where table_name like 'community_%' order by 1;"
```

Expected: migration applied and no pending · `pg_trgm` present · **both** trigram indexes
present · five `community_*` tables. Paste all four outputs into the report — this is the
one task in the batch whose result cannot be re-derived from the source tree.

---

### Task 6.5: `common/` — soft delete, visibility, slugs, and the AD-5 structural spec ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\common\soft-delete.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\common\visibility.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\common\visibility.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\common\slug.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\common\slug.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\common\soft-delete-filter.spec.ts`

**Requirement refs**: AD-5, OQ-5, R1.1.2, R1.1.3, R1.2.2, R1.2.7, AD-10
**Dependencies**: Tasks 6.1, 6.4
**Pattern to follow**: `route-map.spec.ts:31` — the _"a comment cannot fail a build; this
can"_ idiom, for the structural spec.

**Implementation details**:

- `soft-delete.ts`: `export const NOT_DELETED = { deletedAt: null } as const;` — OQ-5
  option (a), chosen because Prisma middleware (option b) hides the filter from the reader
  and from the structural spec below. One constant, spread at every member read site.
- `visibility.ts`: `buildCategoryVisibilityWhere(ctx: MemberContext): Prisma.CategoryWhereInput`
  producing an `OR` of exactly three branches — `visibility: 'member'` ·
  `visibility: 'cohort'` AND `cohortKeys: { hasSome: ctx.cohortKeys }` ·
  `visibility: 'staff'` AND `ctx.isAdmin` (ASSUMPTION-4). When `ctx.cohortKeys` is empty the
  cohort branch must be **omitted entirely**, not emitted as `hasSome: []` — `hasSome` with
  an empty array matches nothing in Postgres, which happens to be correct, but relying on
  that is a coincidence and a reader cannot check it.
- `slug.ts`: deterministic — lowercase, non-alphanumeric → `-`, collapse repeats, trim
  leading/trailing `-`, cap at 80 chars, then a collision suffix (`-2`, `-3`, …) resolved
  against existing rows. Generated **once at creation** and never regenerated (R1.2.2).

**The AD-5 structural spec** (`soft-delete-filter.spec.ts`) is the load-bearing artefact:

- Parse every `*.service.ts` under `libs/api/forum/src/lib/` and locate each
  `findMany` / `findFirst` / `findUnique` / `count` / `aggregate` call.
- Assert each one either spreads `NOT_DELETED` (or is inside a `where` that does) **or**
  carries a `// AD-5-EXEMPT: <reason>` comment on the line above.
- The exemption escape hatch is required and must be **narrow**: the admin moderation
  read path takes `?includeDeleted` (§3.3) and legitimately reads tombstones. A spec with
  no exemption mechanism gets deleted the first time it is inconvenient; one with a
  documented, greppable exemption survives.
- Assert the exemption list itself: the spec fails if the number of exemptions **grows**
  beyond the ones enumerated in its own constant, so a new unfiltered read cannot be
  waved through by adding a comment.

**Validation notes**:

- **R1.1.3 is the security property this file serves**: an invisible category yields `404`,
  never `403`. `403` confirms existence. The where-builder is what makes the 404 the
  _natural_ outcome — the row simply is not found — rather than something a controller has
  to remember to translate.
- ASSUMPTION-4's `staff` branch is the one place `isAdmin` enters a member-side decision.
  `visibility.spec.ts` must contain: entitled non-admin, zero cohorts → sees `member` only ·
  entitled non-admin with `founding` → sees `member` + that cohort's · admin → additionally
  sees `staff` · **nobody** sees a cohort category whose keys they do not hold.

**Verification**:

```
npx nx test api-forum --testPathPatterns="visibility|slug|soft-delete-filter"
```

Green. Then temporarily remove one `NOT_DELETED` spread from a member read and confirm
`soft-delete-filter.spec.ts` **fails**; revert. Report both results.

---

### Task 6.6: Categories — service and DTOs ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\categories.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\categories.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\dto\create-category.dto.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\dto\update-category.dto.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\dto\reorder-categories.dto.ts`

**Requirement refs**: R1.1.1, R1.1.2, R1.1.4, R8.8, AD-10, §3.3
**Dependencies**: Tasks 6.2, 6.5

**Implementation details**:

- Member read: visible categories in `sortOrder` (R1.1.4 — **never** alphabetical, never by
  creation date), each with `topicCount` (non-deleted topics) and `unreadCount`.
- Admin write: create / update / delete / reorder. `cohortKeys` is validated against
  existing `MemberGroup.key` values on write — an unknown key is a `400`, not a silently
  unreachable category.
- Reorder is **one transaction with a sparse renumber** (R8.8) taking `{ ids: string[] }`.
  Sparse (100, 200, 300…) so a single later insert does not force a full renumber.
- Delete: a category with topics must not be deletable — the schema's `onDelete: Restrict`
  already refuses, so the service turns that into a typed `409`-shaped message rather than
  letting a raw Prisma error escape (NFR-S7).

**Validation notes**:

- **R1.1.2 is stronger than "filter the list"**: the response must not disclose the
  existence, name **or topic counts** of invisible categories. `topicCount` is computed
  after the visibility where-clause, not before it and then masked.
- Every read in this service spreads `NOT_DELETED` (AD-5) — the structural spec from Task
  6.5 is already in force when this file lands.

**Verification**:

```
npx nx test api-forum --testPathPatterns=categories.service.spec
```

Cases: ordering by `sortOrder` · invisible category absent from the list **and** from the
counts · unknown `cohortKey` rejected · reorder is one transaction · delete-with-topics
refused with a sanitized message.

---

### Task 6.7: Topics — create, edit, soft delete, pin/lock/move ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\topics.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\topics.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\dto\create-topic.dto.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\dto\update-topic.dto.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\dto\moderate-topic.dto.ts`

**Requirement refs**: R1.2.1–R1.2.7, R8.2, AD-9, AD-11, §3.3
**Dependencies**: Tasks 6.5, 6.6

**Implementation details**:

- **Create is one transaction that writes a `Topic` AND its post #1** (AD-9). There is no
  `Topic.body`; the opening body is `Post` with `postNumber = 1`. A create that writes the
  topic and then the post outside a transaction can leave a bodyless topic, which nothing
  downstream can render.
- Creating in a category the member cannot see is **404** (R1.2.1 + R1.1.3), not 403.
- Title 3–200 chars, body 1–50 000 (§3.3) — enforced in the DTO, not in the service.
- Edit: author only, within the ASSUMPTION-5 window; sets `editedAt`. Non-author non-admin
  → `403` (R1.2.4). Editing the body edits **post #1**, not a topic column.
- Soft delete (R1.2.7): sets `deletedAt`/`deletedBy`; the topic disappears from every
  member listing, feed and search result **immediately** — which it does for free, because
  every member read goes through `NOT_DELETED`.
- Pin / lock / move are admin-only (R1.2.5, R1.2.6, R8.2). A locked topic rejects new
  replies with `403 { reason: 'topic_locked' }` (§3.3) while existing content stays
  readable.
- `lastPostedAt` is maintained on every post write, in the same transaction (it is the
  feed's sort key and is `@@index`ed with `pinned`).

**Validation notes**:

- **`postCount` belongs to Task 6.8**, not here. It counts replies only and is maintained
  by the post write path; a topic create must leave it at its `@default(0)` because post #1
  is not a reply.
- The edit window constant lives in `common/` and is referenced once. State its value in
  the task report (ASSUMPTION-5).

**Verification**:

```
npx nx test api-forum --testPathPatterns=topics.service.spec
```

Cases: create writes topic + post #1 in one transaction · create in an invisible category →
404 · slug stable across a title edit · non-author edit → 403 · out-of-window edit → 403 ·
admin edit allowed · soft-deleted topic absent from member reads · reply to a locked topic
→ 403 `{ reason: 'topic_locked' }`.

---

### Task 6.8: Posts — depth repair, tombstones, transactional `postCount` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\posts.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\posts.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\dto\create-post.dto.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\dto\update-post.dto.ts`

**Requirement refs**: R1.3.1–R1.3.5, R1.6.4, AD-9, AD-11, RK-12, §3.3
**Dependencies**: Task 6.7

**Implementation details**:

- **R1.3.3 depth repair, server-side.** A `parentId` naming a post that itself has a
  non-null `parentId` is **re-pointed to that post's parent** — the new reply becomes a
  sibling at depth 2, not a third level. It is a **repair, not a rejection**: the member's
  reply is saved where it belongs. A 400 here would lose content over an implementation
  detail the member cannot see.
- `postNumber` is allocated **inside** the transaction (`@@unique([topicId, postNumber])`
  is what makes a concurrent double-allocation fail loudly rather than duplicate).
- **AD-11 `postCount`**: incremented in the same transaction as the post write, decremented
  in the same transaction as a soft delete. It counts **replies only** — it excludes post
  #1 and excludes soft-deleted posts. `lastPostedAt` is bumped in the same transaction.
- **R1.6.4** — a member's own reply must not read as unread to them. The reply write
  therefore upserts the author's `TopicReadState.lastReadPostNumber` to the new
  `postNumber` **in the same transaction**. Doing it anywhere else makes a member's own
  post flash as unread until they reload.
- Soft delete with children: the post becomes a **tombstone** — children stay readable, the
  row stays in the thread, and the wire shape carries an empty body and a null author
  (R1.3.5, and the `MemberPost` contract from Task 6.2).

**Validation notes**:

- **The AD-11 consistency test is mandatory and is the only thing that licenses the
  denormalized counter** (R1.4.4's reasoning applies here too): run a sequence of creates,
  replies, edits and soft deletes, then assert `Topic.postCount` equals a freshly computed
  `count({ topicId, postNumber: { gt: 1 }, deletedAt: null })`. Without that test the
  column is exactly the un-reconciled counter RK-1 rejects.
- **RK-12**: depth is capped by _construction_, not by the UI. A spec must attempt a
  depth-3 reply directly against the service and assert the row lands at depth 2 — this is
  a §8.2 P2 exit-gate item and it is asserted here, not in the browser.

**Verification**:

```
npx nx test api-forum --testPathPatterns=posts.service.spec
```

Cases: reply attaches chronologically · reply-to-a-child re-points to the parent (depth 2) ·
`postNumber` allocated in-transaction · `postCount` excludes post #1 · `postCount`
decrements on soft delete · the AD-11 consistency sequence · a deleted parent's children
still read · the author's own reply leaves their unread count at 0.

---

### Task 6.9: `TopicsReadService` — feed and thread read models, inside the query budget ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\topics-read.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\topics-read.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\dto\list-topics.query.dto.ts`

**Requirement refs**: R1.2.5, R1.6.2, R1.6.3, NFR-P4, NFR-P5, §3.3
**Dependencies**: Tasks 6.5, 6.7, 6.8

**Implementation details**:

- Feed: `Paged<MemberTopicSummary>`, pinned first then `lastPostedAt` desc (R1.2.5), the
  ordering the `@@index([categoryId, pinned, lastPostedAt])` and
  `@@index([pinned, lastPostedAt])` pair exists to serve.
- Pagination per NFR-P5: `page` 1-based, `pageSize` default 25, **max 50**, `> 50` → 400.
  The cap lives in the DTO so it is enforced before the service is entered.
- Unread per topic = `postCount - lastReadPostNumber`, **clamped at 0** (R1.6.2). A topic
  the member has never opened reports its whole `replyCount` (R1.6.3) — which falls out of
  the `@default(0)` on a missing read-state row, so the absence of a row is the "never
  read" signal and no row is written on a read.
- Thread read model: the topic, its posts in `postNumber` order, reaction counts, the
  member's own reactions, and the hoisted accepted answer.

**Validation notes**:

- **NFR-P4 is an exit-gate item and is asserted here.** A 25-topic feed executes **≤ 5**
  database queries. Assert it by counting calls on the mock Prisma client
  (`createMockPrisma()`) — one query per collection, never one per row. The natural shape
  is: categories (visibility) · topics page · topics count · read states for those topic
  ids · reaction counts grouped by post. That is five.
- The unread join must be a **single** `findMany` over `TopicReadState` filtered by
  `userId` and `topicId: { in: [...] }` — the composite PK leads with `userId`, which is
  exactly that query. A per-topic lookup is the N+1 NFR-P4 forbids.

**Verification**:

```
npx nx test api-forum --testPathPatterns=topics-read.service.spec
```

Cases: pinned-first ordering · `pageSize=51` → 400 · never-opened topic fully unread ·
unread clamped at 0 when `lastReadPostNumber > postCount` · **the ≤ 5 query-count
assertion for a 25-topic feed**.

---

### Task 6.10: Reactions, read state, accepted answer ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\reactions\reactions.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\reactions\reactions.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\reactions\reaction-types.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\read-state\read-state.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\read-state\read-state.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\read-state\dto\mark-read.dto.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\accepted-answer.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\accepted-answer.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\dto\accept-answer.dto.ts`

**Requirement refs**: R1.4.1–R1.4.4, R1.5.1–R1.5.3, R1.6.1, R1.6.5, R1.6.6, A-6
**Dependencies**: Tasks 6.8, 6.9

**Implementation details**:

- **Reactions**: the fixed four come from `@ptah-contracts/community`'s `REACTION_TYPES` —
  `reaction-types.ts` re-exports them so there is **one** list, not a server copy that can
  drift from the wire type. Toggle = delete-if-exists-else-create **inside one
  transaction** (R1.4.1). Counts are **derived** via `groupBy` (R1.4.4) — no counter column
  anywhere, which is also the RK-1 scope boundary.
- **Read state** (A-6): one row per member per topic, upserted on the composite PK. `POST
topics/:id/read` takes `{ lastReadPostNumber }` and is **monotonic** — it never moves
  backwards, so an out-of-order client request cannot un-read a thread. `POST
categories/:id/read-all` marks every **visible** topic in the category in **one request**
  (R1.6.5), which means one `createMany`/`updateMany` pair, not a loop.
- **Accepted answer**: settable by the topic author **or** an admin (R1.5.3 — anyone else
  gets `403`). The post must belong to the topic and must not be soft-deleted. At most one
  per topic is enforced by `Topic.acceptedPostId @unique`, so marking a second one clears
  the first by assignment (R1.5.2) rather than by a compensating write that can be skipped.

**Validation notes**:

- **R1.6.6**: unread is computed for the requesting member only, and there is no per-post
  read receipt. If a design here starts wanting one, A-6 has already rejected it.
- Reaction counts for a whole thread come back in **one** `groupBy` — this is one of the
  five queries Task 6.9's budget accounts for.
- The `:type` path segment is validated by `ParseEnumPipe` at the controller (§3.3). It is a
  `@Param`, **not** a payload param, so it does not move `NAMED_PRIMITIVE_PARAM_COUNT`
  (RISK-I).

**Verification**:

```
npx nx test api-forum --testPathPatterns="reactions|read-state|accepted-answer"
```

Cases: second identical reaction removes the row · counts derived, never stored · read
marker never moves backwards · mark-all-read is one request and touches only visible topics ·
non-author non-admin accept → 403 · marking a second answer clears the first · accepting a
deleted post → 400/404.

---

### Task 6.11: Search — ILIKE + trigram, visibility in the SQL ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\search\search.service.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\search\search.service.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\search\dto\search.query.dto.ts`

**Requirement refs**: R1.7.1–R1.7.5, A-7, NFR-S1, §3.3
**Dependencies**: Tasks 6.4 (the indexes must exist), 6.5, 6.9

**Implementation details**:

- `q` 2–200 chars; `kinds` a subset of `topics,posts,lessons`; `page`/`pageSize` per NFR-P5.
  All of it in **one `@Query()` DTO** bound with `dtoPipe` (PRE-1, RISK-I).
- Results grouped by kind (R1.7.1), each kind its own `Paged`.
- **Visibility is a `WHERE` clause in the query** (R1.7.2), built from
  `buildCategoryVisibilityWhere(ctx)` — never a post-filter, and never a filter the client
  applies. Post results are gated by their topic's category, so the join is part of the
  query, not a second pass.
- Excerpts are **plain text plus match offsets** (R1.7.5) — the `SearchExcerpt` shape from
  Task 6.2. The API never returns HTML and never returns a `<mark>`-wrapped string.
  Highlighting is Batch 7's `HighlightTextPipe` over text nodes.
- Raw SQL for the trigram path uses `Prisma.sql` **parameterisation**. String-interpolating
  `q` into a `$queryRawUnsafe` is a SQL-injection hole and fails NFR-S1 on the one boundary
  in this batch that takes free-form member text.
- **`lessons` returns an empty `Paged` in Phase 2** and is filled by Batch 9. Declared now
  so the response shape never changes.

**Validation notes**:

- R1.7.4 sets p95 < 500 ms at §1.3 volume. At 9 seeded topics that is unmeasurable — record
  the index usage instead: `EXPLAIN` on the trigram query shows a `Bitmap Index Scan` on
  `community_posts_body_trgm`, not a `Seq Scan`. That is the property the budget depends on
  and it is checkable today.
- A member must not be able to find, via search, a topic in a category they cannot see.
  That is one spec, and it is the reason R1.7.2 says "in the query".

**Verification**:

```
npx nx test api-forum --testPathPatterns=search.service.spec
psql "$DATABASE_URL" -c "explain select id from community_posts where body_markdown ilike '%ptah%';"
```

Cases: invisible-category content absent from every kind · `q` shorter than 2 → 400 ·
excerpt carries offsets and no HTML · `kinds=lessons` returns an empty page, not a 400 ·
the query is parameterised (assert against the generated SQL, not by inspection).

---

### Task 6.12: Member controllers — `v1/members/community` and `v1/members/search` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\member-community.controller.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\member-community.controller.spec.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\search\member-search.controller.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\search\member-search.controller.spec.ts`

**Requirement refs**: §3.1, §3.3, §3.7, R1.1.3, NFR-S8, NFR-S9, PRE-1
**Dependencies**: Tasks 6.6–6.11

**Implementation details**:

- `@Controller('v1/members/community')` and `@Controller('v1/members/search')` — two
  classes, two **disjoint literal depth-3 segments** (§3.7). Neither may ever declare a
  parameter at segment 3 (RISK-B's standing rule).
- `@UseGuards(JwtAuthGuard, MemberGuard)` at **class** level on both. `req.memberContext` is
  read, never re-derived (R7.3) — no controller or service calls `MembershipService` or
  `CohortResolver` again.
- The full §3.3 member table: categories · topics (list/detail/create/patch/delete) · posts
  (create/patch/delete) · reactions (`PUT`, `ParseEnumPipe` on `:type`) · accepted answer
  (`PUT`/`DELETE`) · read (`POST topics/:id/read`) · read-all (`POST
categories/:id/read-all`).
- **`PUT` on the reaction toggle, not `POST`** — the request expresses "my reaction of this
  type should flip", and a retry converges (§3.3).
- **PRE-1**: every `@Body()` / `@Query()` whole-object param binds `dtoPipe(TheDto)`. A bare
  `@Body() dto: X` is **silently unvalidated** (esbuild emits no `emitDecoratorMetadata`).
  Read `libs/api/core/src/lib/common/dto-validation.pipe.ts` first and confirm it in the
  report.
- **NFR-S9 throttles**: content creation 10/min, reactions 30/min; reads inherit the global
  100/min. Applied with `@Throttle` per §3.1.

**Validation notes**:

- **RISK-I**: no `@Query('name') name: string`. Every query payload is a whole-object DTO,
  so `NAMED_PRIMITIVE_PARAM_COUNT` stays at 6.
- Errors are typed Nest exceptions with fixed sanitized messages (NFR-S7). A raw Prisma
  message must never reach a client — `packs.service.ts:277-313` is the pattern.
- Invisible → **404**, never 403 (R1.1.3). `403` is reserved for visible-but-forbidden: a
  locked topic, a non-author edit.

**Verification**:

```
npx nx test api-forum --testPathPatterns="member-community.controller|member-search.controller"
```

Green. Then, against the live stack (`V-TOKEN`, `V-CURL`):

```
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/members/community/categories | jq
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/v1/members/community/topics?pageSize=51" -o /dev/null -w '%{http_code}\n'
```

Expected: `200` with the visible categories · `400` for `pageSize=51`.

---

### Task 6.13: Admin moderation controllers, and the `community.*` audit vocabulary ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\admin-community-categories.controller.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\admin-community-topics.controller.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\admin-community-posts.controller.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\lib\**\*.controller.spec.ts` (one per controller)
- `D:\projects\ptah-extension\libs\api\audit\src\lib\audit-log.types.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-guards.spec.ts`

**Requirement refs**: §3.3 admin table, R8.2, R8.5, R8.8, PRE-6, F-4
**Dependencies**: Tasks 6.6–6.11

**Implementation details**:

- **THREE controllers at three disjoint literal prefixes** — `v1/admin/community/categories`,
  `v1/admin/community/topics`, `v1/admin/community/posts`. **No controller sits at bare
  `v1/admin/community`.** This is RISK-J: the plan's §2.5 split
  (`v1/admin/community/categories` + `v1/admin/community`) makes the second a strict prefix
  of the first, `KNOWN_PREFIX_DEBT` is an empty array at HEAD, and RI-1 fails the build.
  **Do not resolve a failure here by adding a `PREFIX_EXCEPTIONS` entry.**
- `PATCH categories/reorder` is declared **before** `PATCH categories/:id` (RI-3 —
  intra-controller specificity ordering; `route-map.spec.ts` asserts it).
- `@UseGuards(JwtAuthGuard, AdminGuard)` at **class** level, `AdminThrottlerGuard` where a
  route needs it. Both guards are declared **locally in `ForumModule`** rather than by
  importing `AdminModule` — the acyclicity idiom `MemberGroupsModule` already uses (§2.5).
- **PRE-6**: every admin mutation writes its `AdminAuditLog` row **inside the mutation's own
  `$transaction`**, passing `tx` through `WriteAuditLogParams.tx`
  (`packs.service.ts:98-141` is the pattern). An audit row written after the transaction
  commits is a row that can be missing for the one mutation anybody will ever ask about.
- `audit-log.types.ts`: add `AdminAuditAction` values
  `community.category.create|update|delete|reorder`,
  `community.topic.pin|lock|move|update|delete|restore`,
  `community.post.delete|restore`; add `AdminAuditTargetType` values `Category`, `Topic`,
  `Post`. **Rewrite the `:35-41` comment** — it currently explains why there is _no_
  `community.*` action yet and promises them for Phase 2. Leaving a "not yet" note above
  the actions it predicted is how a file starts lying.
- `admin-guards.spec.ts` **G1**: add all three controllers to the `it.each` table that
  asserts class-level `JwtAuthGuard` + `AdminGuard` in that order, and to the second table
  asserting the `v1/admin/` mount. G1 is a hand-maintained enumeration — a new admin
  controller that is not added to it is simply unguarded by the guard test.

**Validation notes**:

- **Do not re-add a G5-shaped read-only assertion.** G5 was deleted on purpose
  (`admin-guards.spec.ts:29-35`): the native community surface owns moderation **writes** by
  design, and asserting read-only against it would freeze the opposite of the architecture.
- `POST topics/:id/restore` honours R8.5's ≥30-day window. The window is a constant beside
  the soft-delete helper, not a literal in the controller.
- `GET topics?includeDeleted` is the AD-5 exemption Task 6.5 provided for. It carries the
  `// AD-5-EXEMPT:` marker and appears in the spec's enumerated exemption list.

**Verification**:

```
npx nx test api-forum
npx nx test ptah-license-server --testPathPatterns=admin-guards.spec
```

Green, with G1 covering all three new controllers. Assert in a spec that a moderation
mutation and its audit row share **one** transaction (spy on `$transaction`, assert
`AuditLogService.write` received a `tx`).

---

### Task 6.14: `ForumModule`, app wiring, and the three structural registries ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\forum\src\lib\forum.module.ts`
- `D:\projects\ptah-extension\libs\api\forum\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\testing\controller-registry.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts`

**Requirement refs**: §2.5, §2.11, §3.7, F-4, PRE-2, PRE-1
**Dependencies**: Tasks 6.12, 6.13

**Implementation details**:

- `ForumModule` providers: the nine services, plus `AdminGuard` and `AdminThrottlerGuard`
  declared **locally**. Imports: `ConfigModule`, `PrismaModule`, `IdentityModule`,
  `MembershipModule`, `AuditModule`. **Exports: `TopicsReadService` and `ReadStateService`
  only** (§2.5).
- **RISK-L — omit `NotificationsModule`.** §2.5 lists it, but `libs/api/notifications` does
  not exist until Batch 14. Record the omission in the module docblock with a pointer to
  B14, so the next reader sees a decision rather than a mistake.
- Register `ForumModule` in `app.module.ts` **after** `MembershipModule` (`@Global`, must
  precede every consumer — R7.3). Array order is readability only; `route-map.spec.ts`
  arbitrates routing (`app.module.ts` comment, TASK_2026_170 R2).
- **PRE-2 — all five new controllers go into `controller-registry.ts` IN THIS SAME COMMIT.**
  Labels are path-qualified and must be unique: `forum/MemberCommunityController`,
  `forum/MemberSearchController`, `forum/AdminCommunityCategoriesController`,
  `forum/AdminCommunityTopicsController`, `forum/AdminCommunityPostsController`. The census
  assertion scans every `libs/api/*/src` root and fails the build on any `*.controller.ts`
  missing from the list — `libs/api/forum/src` becomes a root the moment it exists, with no
  edit to the discovery code.
- Add every new route to `EXPECTED_ROUTES` in `route-map.spec.ts`.
- **`controller-validation.spec.ts`**: re-derive and **raise** `MIN_TOTAL_PAYLOAD_PARAMS`
  from 37 to the value the suite reports, and justify the new number in the docblock the
  way `fd1b4557e` justified lowering it (RISK-I). `NAMED_PRIMITIVE_PARAM_COUNT` must stay
  **6** — if it moved, a `@Query('x') x: string` slipped in and the fix is the controller,
  not the constant.
- `app.module.spec.ts` (F3, `2bf9ffb0a`) boots the real Nest injector. It must stay green —
  it is the test that catches a missing module import that `route-map` and
  `controller-validation` both pass through.

**Validation notes**:

- **RISK-J's verification point.** If RI-1 fails here, Task 6.13's prefixes are wrong. Fix
  the prefixes; do not widen `PREFIX_EXCEPTIONS` or `KNOWN_PREFIX_DEBT` — both are empty
  arrays at HEAD and that emptiness is itself the current invariant.
- **Shared-registry serialisation**: this task edits `app.module.ts`, `controller-registry.ts`
  and two specs in `apps/ptah-license-server/src/common/`. No batch running concurrently may
  touch them. B7 and B8 do not.

**Verification**:

```
npx nx test ptah-license-server --testPathPatterns="route-map|controller-validation|admin-guards|app.module"
npx nx run-many -t eslint:lint,typecheck,test -p api-forum,api-contracts-community,api-member-hub,api-audit,ptah-license-server --skip-nx-cache
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
```

All green; the server boots with `ForumModule` registered; `V-HEALTH` returns 200.

---

### Task 6.15: Hub `community` section — `'empty'` → `'ok'` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\community.section.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\community.section.spec.ts`
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.module.ts`

**Requirement refs**: R6.1, R6.3, R6.4, R6.6, AD-4, §3.2 phase table
**Dependencies**: Task 6.14

**Implementation details**:

- The section resolves recent + unread topics through `TopicsReadService` and returns
  `HubSection<HubTopicSummary[]>` with `status: 'ok'` (or `'empty'` when there genuinely
  are no visible topics).
- `MemberHubModule` imports `ForumModule` for the two exported services.
- **The envelope does not change and the composer gains no new line** — the section file
  already exists and already returns a `HubSection`. R6.6's whole claim is that a phase
  changes _which_ sections report `'ok'`, never the shape and never the request count.
- **`Promise.allSettled` still applies** (AD-4): if the forum query throws, this section
  becomes `{ status: 'unavailable', data: [] }` and the hub still answers `200`. Add the
  fault-injection case for this section specifically — the composer's generic case exists,
  but a section with real work behind it is the one that can now actually fail.

**Validation notes**:

- **`'empty'` and `'unavailable'` are not interchangeable.** `'empty'` means there is no
  data; `'unavailable'` means a source failed. The UI renders `EmptyState` for both, but
  collapsing them destroys R6.4's fault signal.
- **R6.2 must still hold**: the hub is still exactly one request. If this section makes the
  frontend want a second call, the section is returning the wrong shape.

**Verification**:

```
npx nx test api-member-hub
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/members/hub | jq '.sections.community'
```

`status: 'ok'` (or a justified `'empty'`) with the same envelope shape Phase 1 shipped. The
Batch 4 Playwright one-request assertion re-runs **unchanged** and still passes.

---

**Batch 6 Verification (exit gate)**:

- `nx show project api-forum` resolves; `nx lint api-forum` clean
- `nx test api-forum` green, including: the depth-3 → depth-2 repair (RK-12), the AD-11
  `postCount` consistency sequence, the NFR-P4 ≤ 5-query feed assertion, and the AD-5
  soft-delete structural spec **proven by deliberate failure**
- Migration 2 applied; `pg_trgm` and **both** trigram indexes present in the live database
  (paste the `psql` output)
- `route-map.spec` (RI-1/RI-2/RI-3), `controller-validation.spec`, `admin-guards.spec` and
  `app.module.spec` all green
- `V-CURL` — a `visibility: 'cohort'` category is **404** to the zero-cohort dev account and
  `visibility: 'member'` categories are `200`; one account proves both halves of A-2
- `GET /api/v1/members/hub` still answers in **one** request with the unchanged envelope
- `nx graph` — `api-forum` sits below `api-membership` / `api-contracts-community` with no cycle

---

### Batch 6 result ✅ COMPLETE — exit gate met, deviations and corrections

**Executed 2026-08-04/05 in three sequential `backend-developer` dispatches** (6A = Tasks
6.1–6.5, 6B = 6.6–6.11, 6C = 6.12–6.15), each with its own report in this folder:
`batch-6a-report.md`, `batch-6b-report.md`, `batch-6c-report.md`. **Those three files are the
detail; this block is the summary.** Read them before treating anything below as an oversight.

**Exit gate — verified by the orchestrator independently, not only self-reported:**

```
npx nx run-many -t eslint:lint,typecheck,test \
  -p api-forum,api-contracts-community,api-member-hub,api-audit,ptah-license-server \
  --skip-nx-cache
→ Successfully ran targets for 5 projects. 0 errors, 2 pre-existing warnings.
   api-forum 436 tests / 18 suites · ptah-license-server 73 (was 65) · api-member-hub 72
```

Every gate item is green: `api-forum` resolves and lints clean · the RK-12 depth-3→depth-2
repair, the AD-11 `postCount` consistency sequence, the NFR-P4 ≤5-query feed assertion and
the AD-5 structural spec all pass, **and each was proven by deliberate failure and reverted**
· migration 2 applied with `pg_trgm` and both GIN trigram indexes live · `route-map`,
`controller-validation`, `admin-guards`, `app.module` all green · V-CURL proved both halves of
A-2 live · the hub still answers in one request and `.sections.community` moved `'empty'` →
`'ok'` with the identical envelope · `nx graph` shows no cycle.

**`libs/api/forum` is 68 files**: 9 services, 5 controllers, 18 DTOs/support, 18 specs, the
`common/` layer and one test double. 26 routes added.

#### Census constants — the numbers a later batch must not guess

| Constant                                  | Value           | Note                                                                                                                                                                                                |
| ----------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_TOTAL_PAYLOAD_PARAMS`                | **37 → 51**     | Floor. Re-derived by running the suite; arithmetic closes exactly (31 pre-existing + 14 new whole-object + 6 named). Justified in the docblock.                                                     |
| `NAMED_PRIMITIVE_PARAM_COUNT`             | **6, unmoved**  | Exact equality. Every `@Query()` added binds a whole-object DTO through `dtoPipe` (RISK-I held).                                                                                                    |
| `EXPECTED_ROUTES`                         | 64 → **90**     | The docblock's running total was **already stale by four** before this batch — it read 68, the array held 64 (P1b deleted four routes and updated the array but not the prose). Corrected in place. |
| `PREFIX_EXCEPTIONS` / `KNOWN_PREFIX_DEBT` | **still empty** | RISK-J avoided by construction: three admin controllers at three disjoint literal depth-4 prefixes. Nothing was added to either array.                                                              |
| `EXPECTED_EXEMPTIONS`                     | **two entries** | Both `admin-topics-read.service.ts` — `topic.findMany` and `topic.count`. See the correction below.                                                                                                 |

#### Corrections made to THIS document, because it was wrong

1. **`V-CURL` never authenticated.** It prescribed `-H "Authorization: Bearer $TOKEN"`;
   `JwtAuthGuard` reads `request.cookies['ptah_auth']` and never looks at that header. Every
   V-CURL in this file — **including B1's and B3's, which their reports recorded as
   passing** — returns `401` when run exactly as written. Fixed at the handle table, with a
   headless `V-TOKEN` mint recipe added.
2. **Task 6.4's `migrate diff` command does not exist on Prisma 7.7.0.** `--from-url` and
   `--to-schema-datamodel` were both removed. Fixed in place, plus the stdout-banner trap
   that corrupts a redirected `migration.sql`. **Migrations 3–5 (Batch 9) would each have
   hit this.**
3. **`V-MIG` marked superseded** — `prisma migrate dev` must not run in this workspace
   (RISK-K), and the handle still prescribed it.

#### Deviations, each deliberate

| Spec said                                                                                | What was done                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPECTED_EXEMPTIONS` gets **one** entry (the admin `?includeDeleted` read)              | **Two** — `topic.findMany` and `topic.count`, both in `admin-topics-read.service.ts` | A paged read is two queries, and `Paged.total` must run under the **same** `where` as the page or a moderator who asked to see tombstones is shown a total that excludes them. Three ways to reach "exactly one" were considered; all three _hid_ the tombstone read from the census rather than declaring it. **The right invariant is not the count — it is "no exemption outside that one admin file, and none on a write path."** Both hold; `restore` was designed around `restorableWhere` so it needs none.                                                                                                                                                                                                                                                                                                              |
| The barrel gains **three** `export *` lines                                              | **Eight** — 1 module + 2 services + 5 controller classes                             | PRE-2 requires all five controllers in `controller-registry.ts`, which imports them **by package name**; a controller the barrel hides cannot be registered and the census fails the build. `admin-guards.spec.ts` G1 has the same requirement. The two instructions cannot both hold. The capability rule is preserved and now **asserted**: `forum.module.spec.ts` fails if a third service leaves the lib, or if `NOT_DELETED` / `buildCategoryVisibilityWhere` / `restorableWhere` do. A controller class cannot be constructed outside Nest — its constructor deps are exactly the services the barrel does not export — and its guards travel with it as decorator metadata. Every other api lib exports its controllers for the same reason. **The line count was a proxy for the capability rule, and it broke first.** |
| NFR-P4's five queries include "reaction counts grouped by post"                          | Fifth slot is the batched **author-name** lookup                                     | A feed returns `MemberTopicSummary`, which has no posts and no reactions — that query belongs to the _thread_ read model. Same count, different member. The assertion pins the exact composition, so a reader comparing it to the old list would otherwise think it had drifted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Task 6.15: `MemberHubModule` imports `ForumModule` "for the two exported services"       | Only `TopicsReadService` is injected                                                 | `MemberTopicSummary.unreadCount` already carries the number `ReadStateService` would return, computed inside the same five-query budget. A second injection would be a duplicate derivation of one number — which is how a card and a feed start disagreeing. `ForumModule` still exports both; B14's notification badge is the obvious second reader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MemberTopicDetail.acceptedPost` is `null` when the accepted post is off-page (6A's D-5) | **Always populated** when a live accepted answer exists                              | 🔴 **The 6A docblock argues against its own final sentence.** The paragraph says the hoist exists so the answer is reachable without paging to "page 4 of a long thread"; the sentence then nulls it in exactly that case, leaving the hoist doing nothing in the only case where it was redundant. One extra query, only when off-page and only for topics that have one. **Still cheap to overrule — one conditional and two tests — but it becomes frontend-visible once B7 renders it.**                                                                                                                                                                                                                                                                                                                                    |
| Task 6.13's file list                                                                    | +4 service files not on it                                                           | §3.3's admin table needs `CategoriesService.listForAdmin()`, `AdminTopicsReadService.list()` and `Topics/PostsService.restore`, none of which existed after 6B and none of which is in any file list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| §3.3's admin table gives **posts** two operations and no list                            | No standalone post list added                                                        | An unpaged scan of the largest table serving a screen nobody asked for (RK-1). Moderating a post is something an admin does from a thread. If a queue is ever wanted it is a queue of **flags**, which RK-1 defers. Stated in the controller docblock so the absence reads as a decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

#### Carried forward — reported, not fixed

1. ✅ **The Prisma checksum drift (RISK-K) is CLOSED, not carried forward.** All three B6
   dispatches reported it as open, each inheriting the claim from B5 rather than testing it
   — correctly, since the test (`migrate dev`) is the one command with a destructive failure
   mode. The **non-destructive** test was run at batch close: all 18 `_prisma_migrations`
   checksums match their files' `sha256sum`. `097853b39` had already fixed it. **No
   follow-up task is needed.** Recorded here because three reports in a row asserted the
   opposite, which is how a stale fact acquires the appearance of corroboration.
2. **The trigram `EXPLAIN` check in Task 6.11 is vacuous at 0 rows** — the planner correctly
   prefers a `Seq Scan` on an empty heap, and would print the same whether the index existed,
   had the wrong operator class, or had been dropped. `set enable_seqscan = off` **does**
   show `Bitmap Index Scan on community_posts_body_trgm` (and `ESCAPE '\'` costs it nothing),
   which proves the plan is available. Re-run the unforced `EXPLAIN` after B8 seeds content
   and `ANALYZE`; until then use the forced form.
3. **`createMockPrisma()` in `libs/api/core` covers none of the forum models**, and its own
   spec asserts `MODEL_KEYS` by exact equality, so extending it turns `api-core:test` red
   unless that census moves too. `api-forum` hand-rolls one local double instead
   (`src/testing/mock-forum-prisma.ts`), following the `packs.service.spec.ts` precedent.
   The factory's docblock claim to cover "every model in schema.prisma" was **already** stale
   (`Pack`, `MemberGroup`, `Waitlist` are absent). Worth a follow-up.
4. **`search.service.ts` gets zero AD-5 structural coverage** — the analyser parses Prisma
   call expressions and that file emits SQL text. Substituted by asserting
   `t.deleted_at IS NULL` / `p.deleted_at IS NULL` **directly against the generated SQL**,
   which is stronger, but it is a substitution a future reader should know about.
5. **`RULE-FILTER` checks for a _mention_ of `NOT_DELETED`, not an effect.** An `OR` whose
   other branches are wider passes while filtering nothing. B6 found this looking for a
   legitimate way through the `postNumber` tension and deliberately did not use it. The
   analyser probably should not try to tell semantic cases apart — **the mitigation is
   review**, and it is now a sentence in the spec's docblock.
6. **`--testPathPattern` was renamed by Jest 30** to `--testPathPatterns` (command-line
   only). Several `Verification` blocks in this file still prescribe the old flag; they fail
   with an option error rather than running nothing, so it is loud, not silent.
7. **6A's `visibility.ts` claims to be "the one place `isAdmin` enters a member-side
   decision".** `AcceptedAnswerService.accept` (R1.5.3, author **or** admin) is a second, and
   B6C's admin surface is arguably a third. All are deliberate and different in kind. A
   one-word fix — "the one place `isAdmin` affects **visibility**" — closes it. Left alone
   because the claim is overstated, not wrong about ASSUMPTION-4.

#### Approved assumptions, now implemented

**ASSUMPTION-4** (`visibility: 'staff'` = admins only) and **ASSUMPTION-5** (24-hour edit
window) were approved by the orchestrator at dispatch and are live. ASSUMPTION-5's constant
is `EDIT_WINDOW_MS` in `libs/api/forum/src/lib/common/edit-window.ts`, measured from
`createdAt` (not `editedAt`, or each edit restarts the clock). **Admins are exempt
structurally, not by a branch** — the member edit path has no `isAdmin` escape hatch, and
admin edits go through `PATCH /v1/admin/community/topics/:id` behind `AdminGuard`, which
writes an audit row. ASSUMPTION-4 was additionally confirmed live: the `staff` category is
visible to the admin account while the `cohort` category is not, because being an admin
grants no cohort content.

#### Live verification residue

Three probe categories, one topic, one reply and one reaction were created through the real
API and **removed**; all five `community_*` tables are back to 0 rows, the seeded dev
entitlement is intact, and `member_group_assignments` is **still empty** (it was not seeded
to make anything pass). **The nine `community.*` audit rows those mutations wrote were
deliberately NOT deleted** — they are an accurate record of moderation that really happened,
written by the mechanism under test. Deleting audit rows to tidy a verification run is
precisely the instinct an audit log exists to defeat.

#### Concurrent WIP (PRE-7 / RK-10)

The other process was active throughout and **committed mid-batch** (`3e93069fd`, 16 files
across `libs/backend/**`, `libs/frontend/**`, `libs/shared/**`), moving HEAD. Verified by
`git show --name-only`: **none of this task's paths was in it.** No sub-agent staged,
committed, or touched a foreign path; `--no-verify` was never used.

---

## Batch 7: P2-FE — community screens + the NFR-S2 chokepoint test ✅ COMPLETE

**Recommended Executor**: `frontend-developer` | **Fallback**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Feed, thread, composers and reaction bar share the topic/post view model and
the markdown render path. **This is the first phase that renders user content**, so RK-2's
enforcing test lands here with it.
**Dependencies**: Batch 4 (shell), Batch 6 (contracts + endpoints; may start against stubs per §8.1 — Task 6.2 is the earliest artefact that unblocks this batch)
**Preconditions**: PRE-3, PRE-4, PRE-7
**Tasks**: 11 (refined at the Phase-1/Phase-2 boundary, 2026-08-04)

**Exit gate (§8.2 P2, frontend half)**: a member creates a topic, replies one level, reacts,
sees accurate unread counts · the NFR-S2 no-second-renderer test is green and proven to fail
when violated · both themes clean (NFR-U5) · no reply indents more than one level regardless
of the data (R1.3.4) · **the new admin moderation surface is reachable from the admin
sidebar** (it was deleted in B5 and is not restored anywhere else).

**File set** (for the parallel-with-B8 claim): `libs/web/panel-ui/**`, `libs/web/members/**`,
`libs/web/admin/**`, `apps/ptah-landing-page-e2e/**`. Batch 8's set is
`apps/ptah-license-server/prisma/**` and `apps/ptah-license-server/project.json`.
**Disjoint, including the shared-registry files** (`context.md`'s serialisation rule):
neither batch touches `tsconfig.base.json`, `nx.json`, `app.module.ts`, `route-map.spec.ts`
or `eslint.config.mjs`.

---

### Carried in from Batch 5 — read before starting

- **The admin community surface was DELETED, not disabled.** `community-view.ts/.html/.spec.ts`,
  the `/admin/builders/community` route, its sidebar entry, and `listCommunityTopics()` /
  `getReviewQueue()` with their Zod envelopes are all gone (`fd1b4557e`, user-approved).
  Removal-site comments at `admin.routes.ts:167-169` and `admin-builders-api.service.ts:398-403`
  say the rebuild is a **new** surface against **new** contracts. Task 7.10 builds it, sidebar
  entry included.
- **`MemberGuard` and `MemberSessionStore` live in `@ptah-web/core`**, not in
  `@ptah-web/members` (`d1b57ec0f`). `MEMBER_ROUTES` declares **no** guard and must not
  regain one — `members.routes.spec.ts` fails if a guard reappears anywhere in the subtree,
  and a second declaration runs the entitlement probe twice per navigation.
- **`libs/web/members/src/index.ts` exports `MEMBER_ROUTES` and nothing else.** Widening the
  barrel is never the fix for a boundary error — anything exported there has to be imported
  statically to be useful, which is the error the guard relocation exists to avoid.
- **Two cosmetic defects are carried to B15, not to this batch**: the light-mode right-edge
  gutter stays dark (`data-theme` looks bound to the panel root rather than `<html>`), and
  the secondary nav sits at `text-base-content/60` and needs contrast **measuring**. Do not
  fix them here; do not make them worse.
- **RISK-M applies to Task 7.1.** PRE-3's literal "nine symbols / 8 export lines" becomes
  wrong the moment this batch promotes two primitives. The barrel is the authority, not the
  precondition's number.

---

### Task 7.1: Promote `ThreadRow` and `TagChip` into `@ptah-web/panel-ui` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\thread-row\thread-row.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\thread-row\thread-row.spec.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\tag-chip\tag-chip.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\tag-chip\tag-chip.spec.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\index.ts`

**Requirement refs**: §5.3, R9.7, NFR-U1, NFR-U2, PRE-3
**Dependencies**: none within the batch
**Pattern to follow**: `libs/web/panel-ui/src/lib/status-badge/status-badge.ts` — the
existing primitive shape (standalone, OnPush, `input()` signals, zero injected services).

**Implementation details**:

- `ThreadRow`: title, author, reply count, `unreadCount`, and the `pinned` / `locked` /
  `accepted` markers (§5.3). Presentational only — it emits nothing and fetches nothing.
- `TagChip`: `input({ label, variant })` reusing the existing `BadgeVariant` union rather
  than declaring a second variant vocabulary.
- Both are added to `libs/web/panel-ui/src/index.ts`, taking it from 8 export lines /
  9 symbols to **10 export lines**. Update the barrel's header comment with the new count so
  there is **one** authoritative number (RISK-M) — PRE-3's literal is now stale and later
  frontend batches must read the barrel, not the precondition.
- Each ships with its own `.spec.ts`, per §5.3.

**Validation notes**:

- **§5.3's rule is "a primitive earns a place when a second panel actually renders it."**
  Both qualify only because Task 7.10 gives them a real admin consumer in this same batch.
  If Task 7.10 is dropped or deferred, these two promotions must be dropped with it and the
  components stay private to `libs/web/members` — otherwise this is the speculative
  extraction §5.3 exists to prevent.
- **NFR-U2**: tokens only. `base-100`/`base-200`/`base-300` surfaces, `border-hairline`
  boundaries, `bg-surface-high` hover. **`base-300` is a fill and never a border.** These
  files sit in `libs/web/panel-ui`, which is **outside** the `libs/web/members/**` scope of
  the Task 4.7 lint rule — so the rule will not catch a violation here. Check by hand and
  say in the report that you did.

**Verification**:

```
npx nx test web-panel-ui
npx nx lint web-panel-ui
npx nx typecheck web-admin web-members
```

Green; the barrel exports 10 lines and the new count is recorded in its header.

---

### Task 7.2: Member community and search API services ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-community-api.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-community-api.service.spec.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-search-api.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-search-api.service.spec.ts`

**Requirement refs**: §3.3, NFR-S1, NFR-P5, R7.7
**Dependencies**: Batch 6 Task 6.2 (the contracts)
**Pattern to follow**: `libs/web/members/src/lib/services/member-hub-api.service.ts` and
`libs/web/core/src/lib/services/validate-response.ts` — Zod at the frontend HTTP boundary
through the shared `validate()`.

**Implementation details**:

- One method per §3.3 endpoint, each parsing its response with the **schema exported by
  `@ptah-contracts/community`** — never a locally re-declared shape. A second copy of the
  wire type on the client is exactly the drift the contracts lib exists to remove.
- Pagination parameters respect NFR-P5's cap client-side too: a request for `pageSize > 50`
  is a client bug, and the service should not be able to express it.
- `isMembershipRequiredError()` already exists in
  `libs/web/core/src/lib/services/members-api.service.ts` and parses the server's
  `403 { reason: 'membership_required' }` shape. Reuse it. Do not invent a second error
  shape or a second parser.

**Validation notes**:

- `z.object()` **strips** unknown keys — that asymmetry is what made RISK-C's ordering safe
  in Phase 1 and it still holds: a client schema that omits a field tolerates a server that
  sends it. It does **not** work the other way, so never add a required field to a client
  schema before the server sends it.
- These services are pure data access: no signals, no state, no routing. State lives in the
  pages.

**Verification**:

```
npx nx test web-members --testPathPatterns="member-community-api|member-search-api"
```

Cases per service: a well-formed response parses · a response missing a required field
**throws** (proving the parse is live, not decorative) · a 403 `membership_required` is
recognised by the shared helper.

---

### Task 7.3: Private community components ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\topic-composer.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\reply-composer.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\reaction-bar.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\accepted-answer-badge.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\unread-pill.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\*.spec.ts`

**Requirement refs**: §5.3, R1.4.1, R1.4.2, R1.5.1, R1.6.2, NFR-U1, NFR-U3, NFR-S2
**Dependencies**: Tasks 7.1, 7.2

**Implementation details**:

- All five **stay private to `libs/web/members`** (§5.3): the composers are markdown
  authoring with no admin equivalent, `ReactionBar` is member-semantics-only (A-8 — admin
  does not react), and `UnreadPill` is a member concept. Do not promote them.
- Composers are **plain markdown textareas with a preview**, and the preview renders through
  `<ptah-markdown-block>` like everything else. **No WYSIWYG** — the task description
  rejects it explicitly because it introduces a second content representation and a second
  sanitization path, directly against NFR-S2.
- `ReactionBar` renders the fixed four from `REACTION_TYPES` (`@ptah-contracts/community`),
  shows per-type counts and marks which the current member applied (R1.4.2). Optimistic
  toggle is fine; reconcile from the `PUT` response, which returns the authoritative counts.
- `AcceptedAnswerBadge` uses `StatusBadge` from `@ptah-web/panel-ui` rather than a new
  badge (R9.7).
- NFR-U1: `ChangeDetectionStrategy.OnPush`, signals, `inject()`. No constructor injection —
  the Task 4.7 lint rule is scoped to `libs/web/members/**` and will fail the build.

**Validation notes**:

- **NFR-U3**: load-bearing muted text uses `text-base-content/60` or stronger. `/40` measures
  3.18:1 and fails WCAG AA for body text.
- **NFR-S2**: no `[innerHTML]`, no `DomSanitizer.bypassSecurityTrustHtml`, no direct `marked`
  or `dompurify` import. Task 7.9's spec enforces it, but these are the first files it will
  police — write them correctly rather than discovering it at the end.

**Verification**:

```
npx nx test web-members --testPathPatterns=community/components
npx nx lint web-members
```

Green. Cases: reaction toggle emits once per click and reconciles from the response · the
composer preview goes through `<ptah-markdown-block>` · `UnreadPill` renders nothing at 0.

---

### Task 7.4: Community feed page ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\feed-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\feed-page.spec.ts`

**Requirement refs**: R1.1.4, R1.2.5, R1.6.2, R1.7.3, R6.3, R9.7, R9.8, NFR-U2, NFR-U5, NFR-U6
**Dependencies**: Tasks 7.1, 7.2, 7.3
**Design source**: `docs/design-system/stitch_ptah_builders_member_home/` — the **community
feed** screens, dark **and** light.

**Implementation details**:

- Category rail in admin-defined `sortOrder` (R1.1.4), topic list as `ThreadRow`s, pinned
  first (R1.2.5), unread counts from the wire (R1.6.2).
- **Paginate** (NFR-U6). Virtualization is permitted but paginating is simpler and the
  server already returns `Paged<T>` with `hasMore`. Unbounded DOM growth on the feed is the
  named failure.
- Empty feed renders `EmptyState` from `@ptah-web/panel-ui` — never a bare "0 results"
  string (R1.7.3, R6.3).
- Resolve every token conflict between the approved screens and the code through
  `docs/design-system/panel-theme-spec.md` (R9.8) — the eight screens each emit their own
  conflicting Material-3 token set, which is RK-7.

**Validation notes**:

- **NFR-U2 is lint-enforced here** (Task 4.7, scoped to `libs/web/members/**`): no raw hex,
  no `ink-*`, no `amber-*`, no Material-3 token names, **no `border-base-300`**.
- **NFR-U5**: render in `operator-member` **and** `operator-member-light`. Batch 4 proved
  both themes work at the shell level; a new page can still break light mode on its own.

**Verification**:

```
npx nx test web-members --testPathPatterns=feed-page
npx nx lint web-members
```

Green. Manual `V-BROWSER` at `http://localhost:4200/members/community` in both themes.

---

### Task 7.5: Thread page ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\thread-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\thread-page.spec.ts`

**Requirement refs**: R1.3.1–R1.3.5, R1.4.2, R1.5.1, R1.6.1, RK-12, NFR-S2, NFR-U5
**Dependencies**: Tasks 7.2, 7.3
**Design source**: the **discussion thread** screens, dark and light.

**Implementation details**:

- Post #1 renders as the topic body (AD-9) — there is no separate body field to render.
- **Indentation is driven by `parentId != null` and by nothing else** (R1.3.4, RK-12). Not
  by a computed depth, not by a recursive component that could nest further. Data produced
  by a future migration or by a bug cannot then render at depth 3, because the renderer has
  no way to express it.
- The accepted answer appears **twice**: hoisted above the list, and in its chronological
  position marked `accepted: true` (R1.5.1, §3.3). Both come from the same response — do not
  fetch it separately and do not filter the duplicate out.
- A deleted post renders as a **tombstone** with its children still readable (R1.3.5).
- Opening the thread records the read position (R1.6.1) via `POST topics/:id/read`.
- Every body renders through `<ptah-markdown-block>`, which resolves the `'member'` preset
  from the route-level injector `app.routes.ts` installs for the whole `/members` subtree
  (AD-1, PRE-4). **No second renderer, no second sanitizer, no `[innerHTML]`.**

**Validation notes**:

- **PRE-4**: the `'member'` preset lives inside `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`
  and nowhere else. If it needs a change, change it **there** — do not shadow it locally.
- `MarkdownBlockComponent` takes `variant = input<'invert' | 'auto'>('invert')` (Task 4.2).
  Member surfaces that must work in light mode pass `'auto'`; the default is unchanged so no
  existing consumer moves.

**Verification**:

```
npx nx test web-members --testPathPatterns=thread-page
```

Cases: **no reply indents more than one level even when the fixture data says depth 3**
(this is a §8.2 exit-gate item, asserted here) · the accepted answer appears hoisted **and**
inline · a tombstone renders with its children · the read marker is posted once per open.
Manual `V-BROWSER` in both themes.

---

### Task 7.6: My Threads page ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\my-threads-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\my-threads-page.spec.ts`

**Requirement refs**: R9.2, R1.7.3, NFR-U6
**Dependencies**: Tasks 7.1, 7.2, 7.4

**Implementation details**:

- The member's own topics (and topics they replied in), reusing `ThreadRow` and the same
  pagination the feed uses. This page is deliberately thin — it is the feed with an author
  filter, not a second list implementation.
- `EmptyState` when the member has authored nothing, with copy that points at the composer
  rather than reporting zero.

**Validation notes**: the server's `@@index([authorId])` on both `Topic` and `Post` exists
for this page (§1.3). If this page needs a query the backend cannot serve within the NFR-P4
budget, that is a Batch 6 gap — report it rather than fanning out requests here.

**Verification**:

```
npx nx test web-members --testPathPatterns=my-threads-page
```

Green; `EmptyState` on the empty case; both themes.

---

### Task 7.7: Search page and `HighlightTextPipe` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\search\search-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\search\search-page.spec.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\shared\highlight-text.pipe.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\shared\highlight-text.pipe.spec.ts`

**Requirement refs**: R1.7.1, R1.7.3, R1.7.5, NFR-S2, §5.5
**Dependencies**: Tasks 7.2, 7.3

**Implementation details**:

- Results grouped by kind (R1.7.1). **The `lessons` group renders an `EmptyState` in Phase 2
  and is filled by Batch 10** — the server already returns the key (Task 6.11), so no shape
  changes later.
- `HighlightTextPipe` takes the server's `{ text, matches: { start, length }[] }` and returns
  a `{ text, match }[]` array the template renders as **sibling `<span>`s** — text nodes
  only. It **never** produces an HTML string and is **never** applied to markdown output
  (R1.7.5). The excerpt is plain text from the API precisely so highlighting can never
  become an injection path.
- No results → `EmptyState` from `@ptah-web/panel-ui`, not "0 results" (R1.7.3).

**Validation notes**:

- **This pipe is the single most tempting place in the batch to reach for `innerHTML`.** The
  whole design — plain excerpts, offsets, sibling spans — exists to make that unnecessary.
  Task 7.9's spec will catch it, but the reason belongs here.
- Overlapping or out-of-range offsets must degrade to plain text, not throw. The server
  computes them, but a pipe that can crash a page on a boundary case is worse than one that
  renders un-highlighted.

**Verification**:

```
npx nx test web-members --testPathPatterns="search-page|highlight-text"
```

Cases: multiple matches in one excerpt · zero matches · **out-of-range offsets render plain
text rather than throwing** · the pipe's output contains no HTML string anywhere.

---

### Task 7.8: Swap the four Phase-2 placeholder routes for real components ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.spec.ts`

**Requirement refs**: R9.4, R9.5, RK-11
**Dependencies**: Tasks 7.4, 7.5, 7.6, 7.7

**Implementation details**:

- Replace `loadPlaceholder` with real `loadComponent` imports on exactly four routes:
  `community` (feed), `community/topics/:slug` (thread), `community/my-threads`, `search`.
  The other placeholder routes stay — Batches 10, 13 and 15 own theirs.
- The route **paths do not change**. They were enumerated in Batch 4 precisely so this swap
  is a one-line-per-route edit and `members.routes.spec.ts` is in force from day one.
- **Do not add `canActivate` anywhere in this tree.** The guard lives on the `/members` app
  route (`d1b57ec0f`); `members.routes.spec.ts` walks every descendant through `guardCount`
  and fails if one reappears.

**Validation notes**:

- **RK-11**: no route path's first segment may begin with `:`, every parameter segment must
  come from `{ ':slug', ':lessonSlug', ':id' }`, and the literals `':model'` / `':model/:id'`
  must appear nowhere. This swap introduces no new parameter, so the spec should pass
  untouched — if it does not, a path drifted.
- If the placeholder component becomes unused before Batch 10, **leave it**. It is still the
  target of six routes.

**Verification**:

```
npx nx test web-members --testPathPatterns=members.routes.spec
npx nx build ptah-landing-page
```

Green. Then add a temporary `{ path: ':model' }` route and confirm the spec **fails**;
revert. Report both results.

---

### Task 7.9: The NFR-S2 chokepoint spec — one renderer, one sanitizer ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\markdown-chokepoint.spec.ts`

**Requirement refs**: NFR-S2, RK-2, AD-1, OQ-2, §5.5
**Dependencies**: Tasks 7.3, 7.5, 7.7
**Pattern to follow**: `libs/api-contracts/community/src/lib/contract-boundary.spec.ts` —
the same source-text-assertion idiom, already proven in this task.

**Implementation details**:

- Glob `libs/web/members/**/*.{ts,html}` and assert **zero** occurrences of: `innerHTML`,
  `bypassSecurityTrustHtml`, `from 'marked'`, `from 'dompurify'`, `from 'ngx-markdown'`.
- Assert positively as well: every component that renders member-authored text uses
  `<ptah-markdown-block>`. A negative-only spec passes trivially on a file that renders
  nothing.
- Exclude the spec file itself from its own glob, or it fails on its own needles — the
  classic self-match bug in this idiom.

**Validation notes**:

- **RK-2 is why this lands in this batch and not in Batch 4.** §8.1: _"the NFR-S2 test lands
  in the same phase as the first rendered content"_. Phase 2 is that phase.
- **OQ-2 option (c) — authoring a second renderer — is explicitly forbidden.** If a rendering
  need cannot be met by the `'member'` preset, the preset changes inside
  `libs/frontend/markdown` (PRE-4). It does not fork.
- A spec that has never been seen to fail is not evidence. The deliberate-failure probe below
  is part of the deliverable, not a nicety.

**Verification**:

```
npx nx test web-members --testPathPatterns=markdown-chokepoint
```

Green. Then add a temporary `[innerHTML]="body"` to one member template and confirm the spec
**fails** naming that file; revert. Report both results.

---

### Task 7.10: A NEW admin moderation surface in `libs/web/admin` ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\admin\src\lib\builders\community\community-moderation.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\builders\community\community-moderation.html`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\builders\community\community-moderation.spec.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-builders-api.service.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\admin.routes.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\admin-layout\admin-nav.config.ts`

**Requirement refs**: R8.2, R8.5, §3.3 admin table, §5.3, §6.2, R9.7
**Dependencies**: Tasks 7.1, Batch 6 Task 6.13 (the endpoints)

**Implementation details**:

- **This is a NEW surface, not a restoration.** The old `community-view` read
  `GET /v1/admin/community/{topics,review-queue}`, both deleted by Batch 5's Task 5.1. The
  new one reads Batch 6's three admin controllers — `v1/admin/community/categories`,
  `.../topics`, `.../posts` — and it can **write** (pin, lock, move, soft-delete, restore),
  which the old read-only surface could not. G5 was deleted for exactly this reason.
- `admin-builders-api.service.ts`: add methods and **new Zod envelopes** for the admin
  contract types from `@ptah-contracts/community` (`AdminCategory`, `AdminTopicSummary`,
  `AdminPost`). The comment at `:398-403` marking where the old methods were removed should
  be replaced by the new methods, so the file does not carry both a tombstone and its
  replacement.
- `admin.routes.ts`: add the route back at `/admin/builders/community`, replacing the
  removal note at `:167-169`. **Do not** copy the `:model` / `:model/:id` catch-all pattern —
  it is legitimate on the admin surface and this route does not need it.
- `admin-nav.config.ts`: add a `Community` item to the existing **`Builders Content`** group,
  beside `Packs` and `Sessions`. That group is where member-facing content admin already
  lives; `Member Groups` deliberately stays under `People & Community` and this does not
  change that.
- Reuse `ThreadRow` (promoted in Task 7.1 — this is the second consumer that licenses the
  promotion), plus `StatusBadge`, `EmptyState`, `SelectionToolbar` and `DetailDrawer` from
  `@ptah-web/panel-ui` (R9.7).

**Validation notes**:

- **This task is what makes Task 7.1 legitimate** under §5.3's "a second panel actually
  renders it" rule. If this task is cut, cut the promotion too.
- The admin panel uses the `operator-admin` theme, not the member themes. Do not import
  member theme logic here — `MemberThemeService` owns `ptah.members.theme` and nothing else
  may write that key (AD-13).
- `libs/web/admin` is **outside** the `libs/web/members/**` NFR-U2 lint scope. Token
  discipline here is manual; `panel-theme-spec.md` is still authoritative.

**Verification**:

```
npx nx test web-admin
npx nx lint web-admin
npx nx typecheck web-admin ptah-landing-page
```

Green. Manual: sign in as `abdallah@miramarstaffing.com`, confirm **Community** appears in
the admin sidebar under Builders Content, the page loads, and a pin/lock round-trips against
the live server.

---

### Task 7.11: e2e coverage, both-theme pass, and the R6.2 re-run ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-community.spec.ts` (NEW)
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-content.spec.ts` (EXTEND)

**Requirement refs**: NFR-M1, NFR-U5, NFR-U6, R6.2, R6.6, §8.2 P2
**Dependencies**: Tasks 7.4–7.10

**Implementation details**:

- The §8.2 P2 frontend gate is a **journey**, and it must be executed, not reasoned about:
  a member creates a topic, replies one level, reacts, and sees an accurate unread count.
  Drive it against the live stack the way Batch 5 rewrote `members-content.spec.ts` to do.
- Re-run Batch 4's **one-request** hub assertion **unchanged** (R6.2, R6.6). It must still
  pass now that the `community` section returns real data — that is the entire claim R6.6
  makes, and re-running the original assertion is the only thing that tests it.
- Visual pass on feed, thread, my-threads and search in **both** `operator-member` and
  `operator-member-light` (NFR-U5).

**Validation notes**:

- **The full axe pass is Batch 15's** (§8.2 P5), not this batch's. Do obvious a11y hygiene
  here — labelled controls, focus order, keyboard-reachable composer — and record anything
  that needs measuring for B15 rather than fixing it out of scope.
- **PRE-7 / RK-10**: the working tree carries unrelated WIP that already fails eslint and the
  electron build gate, plus untracked `tmp-leak-*` scratch files. Never `git add -A`. Never
  touch `libs/backend/**`, `libs/frontend/**`, `libs/shared/**`,
  `apps/ptah-extension-vscode/**` or `content-manifest.json`. If a gate fails on one of
  those paths, report it — it is not this batch's.

**Verification**:

```
npx nx e2e ptah-landing-page-e2e
npx nx run-many -t eslint:lint,typecheck,test -p web-members,web-panel-ui,web-admin,web-core,ptah-landing-page --skip-nx-cache
```

All green, with the journey spec and the unchanged one-request assertion both passing.

---

**Batch 7 Verification (exit gate)**:

- The §8.2 journey passes end to end: create a topic → reply one level → react → accurate
  unread count
- The NFR-S2 chokepoint spec is green **and proven to fail** when violated (Task 7.9)
- No reply indents more than one level even on depth-3 fixture data (R1.3.4, RK-12)
- Feed, thread, my-threads and search render clean in **both** member themes (NFR-U5)
- Every empty surface renders `EmptyState`, never a bare zero (R1.7.3, R6.3)
- The admin **Community** entry is back in the sidebar and its page writes successfully
- `panel-ui` exports 10 lines and its header records the new count (RISK-M)
- The Batch 4 one-request hub assertion still passes, unchanged (R6.2, R6.6)

---

### Batch 7 result ✅ COMPLETE — the "blocked, reported, fixed, closed" arc

**Executed 2026-08-05 in two `frontend-developer` dispatches**: **B7** (Tasks 7.1–7.11,
`batch-7-report.md`, committed `d2b32d055`) and **B7.1** (`batch-7.1-report.md`, **staged
and not yet committed**). Between them ran **B6.1** (`batch-6.1-report.md`, committed
`229c4a85c`), a `backend-developer` dispatch that existed only because Batch 7 refused to
paper over what it found. **Read those three reports before treating anything below as an
oversight.**

**Exit gate — five of five graded items, verified live against `:4200 → :3000 → Postgres`
with no stubbed community response:**

```
npx nx run-many -t lint,typecheck,test \
  -p web-members,web-panel-ui,web-admin,web-core,ptah-landing-page --skip-nx-cache
→ 0 errors. web-members 213 tests / 19 suites · web-panel-ui 14 · web-admin 144 · web-core 25

E2E_ADMIN_EMAIL=abdallah@miramarstaffing.com npx playwright test --reporter=list
→ 37 passed | 1 skipped | 5 failed — all 5 failures pre-existing and foreign (see F-7 below)
```

#### The arc — this is the part the next reader should copy

| Stage        | What happened                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocked**  | Task 7.6 (My Threads) could not be built: `ListTopicsQueryDto` had no author filter, `forbidNonWhitelisted: true` turns an invented `?authorId=` into a `400`, and the client holds **no user id** (`MemberSessionStore` carries `entitled` / `isAdmin` / `cohorts` only). The §8.2 "accurate unread counts" clause also failed — a measured server-side off-by-one.                                                                                                          |
| **Reported** | Nothing was faked. The route kept its placeholder with a docblock naming the exact unblocking change; the unread clause became a `test.fail()` carrying the measurement table, so the suite was green today and would turn **red the day the server was fixed**. Three alternatives (everyone's threads under "My Threads", a permanent `EmptyState`, unroutable dead code) were named and rejected in writing.                                                               |
| **Fixed**    | B6.1 took all three findings. **Each was bigger than reported.** F-1 was **four** sites, not one, and Batch 7's proposed one-liner would have broken the fourth (`markCategoryRead`, a WRITE) and shipped a louder defect. F-2 was **twelve** fields across five DTOs, not one. F-3 shipped as `?mine=true` — a boolean the server resolves from `ctx.userId` — rather than the `?authorId=` F-3 also offered, because the latter is an enumeration hole dressed as a filter. |
| **Closed**   | B7.1 built My Threads against the parameter as **built** (and asserts the client _cannot_ express `authorId`/`userId`/`authorEmail`), swapped the fourth route, and promoted the `test.fail()` to a real test that asserts **more** than it did — stepping `1 → 2 → 0` across two foreign replies and a read, because a single observation cannot tell "accurate" from "accidentally right".                                                                                  |

**The lesson, stated plainly**: neither the `mine=true` shape nor the four-site fix would
have existed if Batch 7 had shipped a page that listed everyone's threads under a heading
that said "My threads". Two extra dispatches bought a better API.

#### Census constants — unmoved, and verified by `git diff`

| Constant                                 | Value                            | Note                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NAMED_PRIMITIVE_PARAM_COUNT`            | **6, unmoved**                   | `mine` is a property of an existing whole-object DTO, not a named primitive.                                                                                            |
| `MIN_TOTAL_PAYLOAD_PARAMS`               | **51, unmoved**                  | It counts _params_, not DTO fields. Adding `mine` to an existing DTO moves neither number.                                                                              |
| `EXPECTED_ROUTES`                        | **90, unmoved**                  | `?mine=true` is a where-clause, not a route. `GET …/community/my-threads` is a live `404`.                                                                              |
| `EXPECTED_EXEMPTIONS`                    | **2, unmoved**                   | `post-numbering.ts` and `optional-field.ts` are not `*.service.ts` and contain no Prisma call.                                                                          |
| `KNOWN_PREFIX_DEBT` / `UNVALIDATED_DEBT` | **`[]`**                         | Untouched.                                                                                                                                                              |
| `panel-ui` barrel                        | **10 export lines / 11 symbols** | RISK-M discharged: the count now lives in the barrel's own header docblock, which says PRE-3's literal is stale. **Later frontend batches read the barrel, not PRE-3.** |
| **`EXPECTED_NULLABLE_OPTIONALS`**        | **2 (new)**                      | Added by B6.1 in `libs/api/forum/src/lib/common/nullable-dto.spec.ts`. Both entries are `description` fields where `null` genuinely clears a value.                     |

#### Corrections made to THIS document, because it was wrong

1. **`PREFIX_EXCEPTIONS` is NOT an empty array, and never was in this task** (B6.1 A-3).
   It holds **one pre-existing entry** — `marketing/PublicMarketingController` at the
   **empty** prefix, with an 80+ character reason (`/api/unsubscribe/:token` is generated
   into outbound marketing email; a sent email cannot be updated, so versioning that prefix
   silently breaks unsubscribe). **`KNOWN_PREFIX_DEBT` IS `[]`, and that is the array the
   Batch-6 result and several briefs meant.** Verified at HEAD:
   `route-map.spec.ts:400` (the one exception) and `:450` (`const KNOWN_PREFIX_DEBT:
readonly string[] = [];`). **The invariant for Phase 3 is: add nothing to either.**
2. **Task 8.1 check 3's export commit was the defective snapshot** — corrected in place to
   `a22b03eb6` (see that task).
3. **Nothing was found wrong with `V-CURL` or `V-MIG`** beyond what Batch 6 already fixed;
   both B7 and B7.1 re-confirmed the cookie form independently (B7 F-9, B7.1 F-13).

#### Deviations, each deliberate

| Spec said                                                  | What was done                                       | Why                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 7.1: two files per primitive                          | **Three** (`.ts` + `.html` + `.spec.ts`)            | All six pre-existing `panel-ui` primitives use `templateUrl`. "Pattern to follow: `status-badge.ts`" is the stronger instruction than the file count.                                                                                                                                                                                       |
| Task 7.6: build `MyThreadsPage`; 7.8: swap **four** routes | Placeholder kept; **three** routes swapped          | F-3. Closed by B7.1 — four of four now.                                                                                                                                                                                                                                                                                                     |
| Task 7.5: implied route-input binding                      | `ActivatedRoute` **signal**, not `input.required()` | **F-4**: `withComponentInputBinding()` is not installed on `provideRouter` in `apps/ptah-landing-page/src/app/app.config.ts`. Installing it is an app-wide router change affecting how every routed component receives parameters. A signal (not a snapshot) is required anyway — thread → thread navigation reuses the component instance. |
| Task 7.10: Zod envelopes for **three** admin types         | **Two** (`AdminCategory`, `AdminTopicSummary`)      | **F-5**: `AdminPost` has no read endpoint (B6 deliberately shipped `DELETE :id` + `POST :id/restore` and no list, RK-1). A schema that parses nothing is the drift the contracts lib declines to ship.                                                                                                                                      |
| Task 7.11: two e2e files                                   | **Three** (+`admin-crud.spec.ts`)                   | The admin half of the gate is an _admin_ surface; a unit spec asserting the nav config proves the config, not the chrome.                                                                                                                                                                                                                   |
| (unlisted)                                                 | `libs/web/members/jest.config.cts`                  | `marked` ships its ESM build as a bare `lib/marked.esm.js`, so Jest dies on its `export`. `marked                                                                                                                                                                                                                                           | ngx-markdown`added to`transformIgnorePatterns`, mirroring `apps/ptah-landing-page/jest.config.ts`. **The specs use the REAL `provideMarkdownRendering({ extensions: 'member' })` rather than mocking the renderer\*\* — otherwise NFR-S2's chokepoint claim is asserted only against source text. |

#### Carried forward — reported, not fixed

1. **F-10 — `?mine=true` filters `Topic.authorId` only.** Task 7.6's own wording says _"the
   member's own topics **(and topics they replied in)**"_. `implementation-plan.md:350`
   provisions `@@index([authorId])` on **both** `Topic` and `Post`; **`Post.@@index([authorId])`
   still has no reader.** The unblocking change is one `OR` clause —
   `OR: [{ authorId }, { posts: { some: { authorId, ...NOT_DELETED } } }]` — and
   `my-threads.spec.ts` already asserts the five-query budget, so whoever does it has the
   test that says whether it still fits. The page's copy says "Threads you started" rather
   than implying the wider set.
2. **F-4 — `withComponentInputBinding()` is still not installed.** `ThreadPage` is the first
   consumer that wanted it. **Batch 10's lesson page takes two route params
   (`:slug`, `:lessonSlug`) and is the second** — see Task 10.6.
3. **F-5 — `AdminPost` is still a contract type nothing produces.** Revisit when B12/B14
   touch the area.
4. **F-7 — two pre-existing e2e specs assert strings absent from the source**
   (`admin-crud.spec.ts:16` "Total Signups", `pricing-waitlist.spec.ts:22` "Join the
   Builders Waitlist"). **Not weakened; still red; still someone's regression to triage.**
   Phase 3 will see the same 5 failures and must not read them as its own.
5. **F-11 — `ThreadRow` renders an author on a page where every row is the same author.** A
   `[showAuthor]` input was deliberately NOT added (three consumers, cosmetic gain on one).
6. **The two cosmetic theme defects stay carried to Batch 15**: the light-mode right-edge
   gutter stays dark (`data-theme` looks bound to the panel root rather than `<html>`), and
   the secondary nav at `text-base-content/60` needs contrast **measuring**, not adjusting
   by eye. **Batch 10 must not fix them and must not make them worse.**
7. **B8's Task 8.7 assertion 8 (the `'member'`-preset round-trip) is still unimplemented**
   and is now a _frontend_ item — see the Batch 8 result and Task 11.6.
8. **F-8 (trap)** — a backtick inside an HTML comment in an Angular **inline template**
   terminates the template literal and produces `SyntaxError: Invalid shorthand property
initializer` pointing at the _importing spec's_ line 1. It names neither the file nor the
   cause. Batch 10 writes several inline templates; this is free to avoid and expensive to
   diagnose.

#### Live verification residue

Every fixture created through the API or seeded for a test was removed **by id**; the
committed seed is byte-identical (`categories=4 topics=9 posts=10`), `users` is 3, and
`member_group_assignments` is **still 0** — the e2e fixture category is deliberately
`visibility: 'member'` precisely so it does not need an assignment. The **18 `community.*`
audit rows** those moderation writes produced were **deliberately not deleted** (9 are
B6C's): they record moderation that really happened, written by the mechanism under test.
B6.1 deleted **six** of its own, and stated the distinction — its rows referred to scratch
categories that no longer exist, which is a dangling reference rather than history.

---

## Batch 8: P2-MIG — MG-1 seed (9 topics) + MG-5 decommission ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: One artefact (`community-seed.ts`) whose Zod schema, mapping and idempotency
are a single design. Its spec suite is the RK-9 mitigation.
**Dependencies**: Batch 6 (the tables must exist)
**Preconditions**: PRE-7
**Tasks**: 8 (refined at the Phase-1/Phase-2 boundary, 2026-08-04)

**Scope boundary**: this batch imports **9 topics and 11 posts** and nothing else. The 8
Week topics become a **course** and that is **Batch 11's** work against the same module —
do not write course, module or lesson rows here, and do not pre-build the mapping for them.

**Exit gate (re-specified — see "The verification source has changed" below)**: the seed
runs against the local `ptah_db` and creates 4 categories, 9 topics, 11 posts · every
imported `bodyMarkdown` is **byte-identical** to the export's `raw` · every imported topic
and post carries the export's original `createdAt`, not `now()` · a second run produces
**zero** creates · a `raw: null` fixture aborts and writes nothing · a U+FFFD fixture aborts
and writes nothing · the summary reports `unmatchedUsernames: ['system'] (19 posts)` · **no
`User` row is created** · the string `cooked` appears nowhere in the seed module.

---

### The verification source has changed — read this first

**The original exit gate said to verify the seed "against the live container". That is now
impossible and the plan cannot be followed literally here.**

| Was                                                      | Is                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Production forum at `community.ptah.live`                | **Destroyed 2026-08-04** — container, DNS record, disk and API keys all gone                                              |
| Local `discourse_dev` container as the comparison source | **Deleted by the user.** Batch 5's note "do not stop or delete it there either — verify first" is **overtaken by events** |
| "MG-1 verified in production" gating MG-5                | There is no forum left to gate against; see Task 8.8                                                                      |

**The seed's source of truth is `docs/community/discourse-export.json`** (HEAD of that file is
**`a22b03eb6`** — _"fix: capture real markdown in the Discourse export"_ — ⚠️ **CORRECTED
2026-08-05 (B8 Finding 1); this previously read `6614f9e92`, which is the DEFECTIVE snapshot
whose 19 `raw` fields were `null`**. Verified present: 4 categories, 17 topics, 19 posts,
18 of 19 `raw` non-empty — see the Batch 8 result for the 19th). That
was always the design — MG-1.1 says the importer reads **only** the committed export and
never a container. What changes is the **verification**: correctness is now proven by
comparing the seeded database against the export file, not against a running forum. That is
a strictly better check anyway — it is reproducible, it runs in CI, and it does not depend on
a service anyone can turn off.

**MG-5's compose-service removal is already DONE** — Batch 5 folded it in with the user's
approval (see the "MG-5.3 DEVIATION" block in the Batch 5 result). Batch 5 also verified
there was never a `discourse_dev` service in `docker-compose.yml` to remove; what existed was
the `extra_hosts` wiring and four helper scripts, all removed. **Task 8.8 therefore has a
much smaller remit than the coarse plan implied, and one open decision for the user.**

---

### Task 8.1: Pre-flight — database state, export integrity, forum tables ✅ COMPLETE

**Files**: (assertions only — no source file)
**Requirement refs**: RISK-G, MG-1.1, MG-1.4, §7.1
**Dependencies**: Batch 6 Task 6.4 (the tables must exist)

**Implementation details**: run each check and paste the output into the report.

```
# 1. The cohort key MG-1.4 needs. RISK-G's original concern.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select key, name, is_default from member_groups;"

# 2. The five forum tables from migration 2 exist and are empty.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select table_name from information_schema.tables where table_name like 'community_%' order by 1;"

# 3. The export is present and unmodified.
git log --oneline -1 -- docs/community/discourse-export.json
node -e "const d=require('./docs/community/discourse-export.json'); \
  console.log('categories', d.categories.length, 'topics', d.topics.length, \
  'posts', d.topics.reduce((n,t)=>n+t.posts.length,0));"
```

**Validation notes**:

- **RISK-G is empirically closed as of 2026-08-04**: `member_groups` holds exactly one row,
  `key='founding'`, `is_default = true`. The seed's cohort key therefore resolves to
  `founding`. **Run the check anyway** — the row can change, and the abort exists precisely
  so a missing default is loud rather than silently seeding an ungated cohort category.
  (The RISK-G block earlier in this file still describes the value as unverified; it was
  written before this check and is left untouched by this refine pass.)
- ⚠️ **CORRECTED 2026-08-05 (B8 Finding 1).** Expected from check 3: **`a22b03eb6`** —
  _"fix: capture real markdown in the Discourse export"_ — and `categories 4 topics 17
posts 19`. This line previously read `6614f9e92`, which is the **defective** snapshot
  whose 19 `raw` fields came back `null`; that defect is the entire reason RK-9 exists.
  A checker following the old instruction literally would have confirmed the presence of
  the broken file and passed. `implementation-plan.md` §7.1 had it right all along
  ("Re-verified against `a22b03eb6`"); this file and the Batch-8 brief both inherited the
  stale hash. Any other numbers mean the export changed and §7's counts must be re-derived
  before writing code.
- **`member_group_assignments` must stay empty** (`context.md`). Do not seed an assignment
  to make anything pass. If a cohort-gated read must be tested, create the assignment inside
  the test and remove it afterwards.

**Verification**: all three checks pass with the expected values, pasted into the report. If
check 1 returns no default row, **STOP** — set one through the existing admin surface first,
and do not weaken the abort in Task 8.4.

---

### Task 8.2: Seed runner plumbing — the `seed-community` target ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (NEW — entry point + CLI)
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\tsconfig.json` (NEW)
- `D:\projects\ptah-extension\apps\ptah-license-server\project.json`

**Requirement refs**: §7.2, MG-1.3, AD-8
**Dependencies**: Task 8.1

**Implementation details**:

- A **target, not a migration** (MG-1.3): a Prisma migration runs once, and re-runnability is
  a requirement.
- ⚠️ **The plan's `npx tsx …` command will not work as written — `tsx` is not a dependency of
  this workspace** (verified: absent from both `dependencies` and `devDependencies`). `npx tsx`
  would silently network-install an unpinned binary on every run. Use the **repo's existing
  convention** instead — `npx ts-node --project <tsconfig> <script>`, exactly as
  `package.json:65,66,78,79` already do for four other scripts. `ts-node ^10.9.2` is a real
  devDependency. If a maintainer prefers `tsx`, it must be **added to `devDependencies`
  explicitly** in this task; do not rely on `npx` resolution either way.
  ```jsonc
  "seed-community": {
    "executor": "nx:run-commands",
    "options": {
      "command": "npx ts-node --project apps/ptah-license-server/prisma/seed/tsconfig.json apps/ptah-license-server/prisma/seed/community-seed.ts"
    }
  }
  ```
- ⚠️ **Prisma 7 driver adapters: a bare `new PrismaClient()` will NOT connect.** This schema
  has **no `datasource.url`** — the URL lives in `apps/ptah-license-server/prisma.config.ts`
  and the adapter is supplied at runtime. The seed must mirror `PrismaService`:
  ```ts
  config({ path: resolve(__dirname, '../../.env') }); // as prisma.config.ts does
  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter });
  ```
  Import `PrismaClient` from the generated client at
  `libs/api/core/src/lib/generated-prisma-client/client` (the `generator client` `output`).
  The seed tsconfig needs the path mapping or a relative import — prove it runs before
  writing the mapping logic on top of it.
- CLI: parse `--refresh-bodies` (default **off**). Nothing else. No `--force`, no `--reset`.
- A missing `DATABASE_URL` aborts with a named error before any file is read.

**Validation notes**:

- **AD-8's quarantine starts here**: the string `cooked` must not appear in this module or
  any file it imports. Task 8.7 asserts it as source text. Do not add a "for reference"
  comment naming the field — the spec cannot tell a comment from a call site, and that is
  the point.
- Exit code must be non-zero on abort. A seed that reports failure on stdout and exits 0 will
  be run in a script and believed.

**Verification**:

```
npx nx run ptah-license-server:seed-community --help  # or a no-op dry path
```

The target resolves, the script starts, connects, and exits cleanly on an empty run before
any mapping exists. Prove connectivity **first** — a Prisma 7 adapter mistake looks exactly
like a mapping bug three tasks later.

---

### Task 8.3: The Zod export schema — the content-integrity check ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\discourse-export.schema.ts`

**Requirement refs**: §7.2, MG-1.2, MG-1.6, MG-1.9, NFR-S10, AD-8, RK-9
**Dependencies**: Task 8.2

**Implementation details**: **verbatim from §7.2.** The schema is not boilerplate — it is
where every content-integrity property is asserted mechanically instead of by a human
reading a diff.

- `.length(4)` on categories, `.length(17)` on topics, and the `.refine()` asserting the
  19-post total. MG-1.6's counts are checked **before any write**, not counted after one.
- `raw: z.string().min(1)` — this is the specific regression that produced `raw: null` on all
  19 posts. `.min(1)` turns it into a loud abort instead of 19 empty bodies in the database.
- `.refine((s) => !s.includes('\uFFFD'), …)` — mojibake that still "looks like markdown"
  passes human review. It must not pass this.
- **`cooked: z.unknown()`** — present in the export, deliberately typed so that any use is a
  **compile error**. Typing it `string` would invite `post.cooked` at a call site.
- Validate the **whole file** before a single write (MG-1.2). A malformed file aborts with a
  clear error and writes nothing.

**Validation notes**:

- Zod is **4.3.6** in this workspace. `z.string().datetime()` still exists in v4; confirm the
  exact API against the installed version rather than the plan's snippet, and adjust the
  call, not the assertion.
- The `note` field is validated as present-and-non-empty on purpose (§7.2): it records why
  the per-post fetch is necessary, so the shortcut cannot be silently reintroduced.

**Verification**:

```
npx nx test ptah-license-server --testPathPatterns=community-seed
```

(Once Task 8.7 lands.) Immediately: parse the real export through the schema and confirm it
validates, then mutate a scratch copy to `raw: null` and confirm it does not.

---

### Task 8.4: Category mapping, description de-HTML, cohort resolution ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-categories.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (wire-up)

**Requirement refs**: §7.3, MG-1.4, AD-10, AD-15, RISK-G
**Dependencies**: Task 8.3

**Implementation details**:

- The four rows, upserted on `Category.slug`, **keyed on source `categoryId`** (§7.1's
  correction to MG-1.6 — the importer must not hard-code the misremembered General/Builders
  Lounge breakdown):

  | Source            | Native slug       | `visibility` | `cohortKeys`                  | `sortOrder` |
  | ----------------- | ----------------- | ------------ | ----------------------------- | ----------- |
  | 4 General         | `general`         | `member`     | `[]`                          | 10          |
  | 5 Builders Lounge | `builders-lounge` | `cohort`     | `[<default MemberGroup.key>]` | 20          |
  | 2 Site Feedback   | `site-feedback`   | `member`     | `[]`                          | 30          |
  | 3 Staff           | `staff`           | `staff`      | `[]`                          | 40          |

- The cohort key resolves from `MemberGroup where isDefault: true` — **`founding`** as of
  Task 8.1's check. **If none exists, abort with an actionable message.** Do not hardcode the
  key, and do not weaken the abort: it is the control that stops a cohort-gated category from
  being seeded wide open.
- `Category.description` is the **one** field the source carries as HTML — Discourse has no
  `raw` counterpart for it. Four rows, one sentence each: strip tags with a fixed regex and
  store **plain text**. `Category.description` is typed and rendered as plain text
  everywhere in this task; it never reaches `libs/frontend/markdown` and never reaches
  `[innerHTML]`. That is what keeps "no HTML in the pipeline" **total** rather than
  nearly-total.

**Validation notes**:

- The `staff` category lands with `visibility: 'staff'`, which under **ASSUMPTION-4**
  (Batch 6) is admin-only. After seeding, the dev account — which **is** an admin — will see
  it. That is correct and expected; do not read it as a leak. A non-admin entitled member
  must get 404, which is Batch 6 Task 6.5's spec, not this one's.
- AD-15: upsert on the **natural** key (`slug`), not on a synthetic `sourceRef` column. A
  `sourceRef` column was explicitly rejected (RK-1).

**Verification**:

```
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select slug, visibility, cohort_keys, sort_order from community_categories order by sort_order;"
```

Four rows, exactly as tabled, with `builders-lounge` carrying `{founding}` and no HTML tag
anywhere in `description`.

---

### Task 8.5: Topic and post mapping — 9 topics, 11 posts, one transaction ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-topics.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (wire-up)

**Requirement refs**: §7.3, §7.4, MG-1.6, MG-1.7, MG-1.8, A-4, AD-9, AD-11, AD-15
**Dependencies**: Task 8.4

**Implementation details**:

- **The 9 non-curriculum topics**: source ids 5, 23 (General), 13, 14 (Builders Lounge),
  8, 9, 10 (Site Feedback), 4, 6 (Staff). The 8 Week topics (ids 15–22) are **skipped here**
  — Batch 11 turns them into a course.
- Upsert on `Topic.slug`; posts upsert on `@@unique([topicId, postNumber])`.
- `pinned` is carried from the source (topics 5 and 13).
- **`bodyMarkdown = raw`, copied verbatim.** No transform, no re-wrap, no entity decoding.
- **Timestamps**: the source `createdAt` is written **explicitly** (MG-1.7). A row that
  defaults to `now()` loses the property the exit gate checks.
- The two multi-post topics (ids **4** and **13**) import both posts: post #1 becomes the
  opening body (AD-9) and post #2 a **top-level reply** (`parentId: null`, `postNumber: 2`).
- `Topic.postCount` and `lastPostedAt` are **computed from the imported posts in the same
  transaction** (AD-11). `postCount` counts replies only, so it is 1 for topics 4 and 13 and
  0 for the other seven.
- **Authorship**: every source `username` is `system`, which matches no `User`. `authorId =
null` on all posts (A-4, MG-1.8). **No `User` row is fabricated** — placeholder users would
  pollute the one table entitlement derives from (A-2).
- **One `$transaction` for the whole import** (§7.4): a mid-run failure leaves the database
  untouched.
- **Idempotency** (§7.4): a second run produces zero creates and reports `updated` counts.
  `update` payloads **exclude `bodyMarkdown`** when the row already exists, unless
  `--refresh-bodies` is passed — in which case every overwrite is **logged per row**. The
  default must be the safe one; an operator should type the destructive intent rather than
  inherit it.

**Validation notes**:

- 11 posts, not 19: the 8 curriculum topics contribute 8 bodies that become **lessons** in
  Batch 11. `11 + 8 = 19` — the assertion §7.5 prints.
- Do not "helpfully" soft-delete Discourse's own seed content (topics 5, 4, 6). §7.1 records
  the observation and takes **no action**: MG-1.6 asserts all 17 are imported, and an admin
  can soft-delete them after verification in one action each (R8.2).

**Verification**:

```
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select count(*) from community_topics; select count(*) from community_posts;"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select slug, pinned, post_count, created_at from community_topics order by created_at;"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select count(*) from community_posts where author_id is not null;"
```

Expected: 9 topics, 11 posts · timestamps matching the export, **not** today · `post_count`
1 for the two multi-post topics and 0 elsewhere · **zero** posts with a non-null author.

---

### Task 8.6: Summary output and the `--refresh-bodies` log ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\summary.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (wire-up)

**Requirement refs**: §7.5, MG-1.10, §7.4
**Dependencies**: Task 8.5

**Implementation details**:

- The summary is §7.5's block, **minus the course lines Batch 11 adds**:
  ```
  Community seed complete
    categories:  created 4  updated 0
    topics:      created 9  updated 0
    posts:       created 11 updated 0
    unmatched usernames: system (19 posts) → attributed to the system author (A-4)
    bodies: 11/11 imported from `raw`; 0 from `cooked`; 0 transformed
    assertions: source topics 17 = 8 curriculum (batch 11) + 9 topics ✓
  ```
  Batch 11 extends this with `courses`, `modules` and `lessons` lines and completes the
  `11 + 8 = 19` post assertion. Keep the printer **data-driven** so B11 adds rows rather
  than rewriting the format.
- `unmatchedUsernames` reports **19 posts** because that is what the export contains, even
  though this batch writes 11 — the count describes the source, and B11 writes the other 8
  bodies from the same 19. State that on the line so the arithmetic is not read as a bug.
- `--refresh-bodies` logs **one line per overwritten row** with the topic slug and post
  number. A bulk "N bodies refreshed" line is not enough to reconstruct what was destroyed.

**Verification**: run the seed twice; the second run prints `created 0` on every line and
non-zero `updated` counts. Paste both summaries into the report.

---

### Task 8.7: `community-seed.spec.ts` — the RK-9 mitigation ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\` (malformed, `raw: null`, U+FFFD)

**Requirement refs**: §7.6, MG-1, RK-9, NFR-S10, AD-8, A-4
**Dependencies**: Tasks 8.3–8.6

**Implementation details** — §7.6's assertions, scoped to this batch (the course ones are
Batch 11's):

1. The count assertions: 4 categories, 17 source topics, 19 source posts, **9 topics + 11
   posts written**.
2. A malformed file aborts and writes nothing.
3. **A fixture with `raw: null` on one post aborts** — the regression that produced the
   original defect must fail loudly rather than write an empty body.
4. **A fixture containing U+FFFD in `raw` aborts** — mojibake that still looks like markdown
   must not pass.
5. A second run produces zero creates.
6. A run **without** `--refresh-bodies` does not overwrite an edited body; a run **with** it
   does, and logs each overwrite.
7. **The string `cooked` appears nowhere in the seed module** — AD-8's quarantine, enforced
   as a source-text assertion over every file in `prisma/seed/` (NFR-S10).
8. An imported body **round-trips through `libs/frontend/markdown`'s `'member'` preset
   without content loss.**
9. **No `User` row is created** (A-4).

**Validation notes**:

- Assertion 8 crosses the frontend/backend boundary. `libs/frontend/markdown` is
  `scope:shared`, so importing it from a spec under `apps/ptah-license-server` may fail
  `@nx/enforce-module-boundaries` — check before writing it. If it does, the honest
  alternative is to assert the round-trip **in a `web-members` spec** using a body fixture
  copied from the export, and to say so here. **Do not weaken the assertion to a regex over
  markdown syntax** — that tests nothing.
- Assertions 3 and 4 are the ones RK-9 exists for. They must be seen to fail against a
  correct implementation before they are believed — run them against the good export and
  confirm they pass, then against the fixtures and confirm they abort.
- **Byte-fidelity is the check the deleted container used to provide.** Add it explicitly:
  for every imported post, `bodyMarkdown` must equal the export's `raw` **byte for byte**.
  That is the strongest form of "the migration did not mangle the content", and it does not
  need a forum to be running.

**Verification**:

```
npx nx test ptah-license-server --testPathPatterns=community-seed
```

All nine assertions plus the byte-fidelity check green. Report which mechanism assertion 8
ended up using and why.

---

### Task 8.8: MG-5 close-out — what is left, and one decision for the user ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\.ptah\specs\task_2026_177\decommission-runbook.md` (§5 execution log)

**Requirement refs**: MG-5.1, MG-5.2, MG-5.3, §6.1
**Dependencies**: Tasks 8.1–8.7

**What is already done — do not redo it**:

- **The compose wiring was removed in Batch 5** (`fd1b4557e`): the `extra_hosts:
host.docker.internal` entry, its comment block, the four `scripts/discourse-dev-*.sh`
  helpers and the `npm run docker:up` / `docker:down` chaining. Batch 5 also verified there
  was **never a `discourse_dev` service in `docker-compose.yml`** — the container was driven
  by Discourse's own `d/boot_dev` in WSL.
- **The local `discourse_dev` container has been deleted by the user.** Batch 5's instruction
  to leave it running for Batch 8's verification is overtaken; there is nothing to stop.
- **Production was destroyed on 2026-08-04** — container, DNS record, disk and API keys.

**What is left**:

1. Update `decommission-runbook.md` §5's execution log with what actually happened, when,
   and by whom. The runbook was written and left unexecuted by Batch 5; leaving it that way
   while production is gone makes the document actively misleading.
2. Record that MG-5.3's gate ("never before MG-1 is verified in production") is **moot**: the
   thing it protected — authored content living only in a forum — has been on disk and in git
   since `6614f9e92`, and the forum it gated against no longer exists.

**⚠️ ONE OPEN DECISION — MG-5.2 cannot be executed as written. Return it to the
orchestrator; do not decide it inside this batch.**

MG-5.2 asks for a `301` from `community.ptah.live` → the member community surface. **The DNS
record for that host was destroyed**, so there is nothing left to redirect _from_: the host
now fails to resolve. The options are:

| Option                                                                                                                                              | Consequence                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** Re-create a DNS record for `community.ptah.live` pointing at a redirect target, and serve the `301` → `https://ptah.live/members/community` | Old links and search results land on the new surface. Costs one DNS record and a redirect rule. **Recommended** if any external link to the forum was ever published.                                                                     |
| **(b)** Accept `NXDOMAIN` and record the decision                                                                                                   | Zero cost. Old links dead-end at a DNS failure rather than a redirect. Defensible if the forum was never publicly linked — production held only Discourse's own 7 seed topics and **0 human posts**, which is evidence that it never was. |

**Recommendation**: **(b)**, with (a) available if the user knows of a published link. The
evidence favours (b) — a forum with zero human posts had no audience to redirect. Either way,
the outcome is written into the runbook §5 log; MG-5.2 must not be silently dropped.

**Validation notes**: **PRE-7** — nothing in this task executes against production
infrastructure without an explicit instruction. Batch 5 deliberately left the runbook
unexecuted for the same reason.

**Verification**: `decommission-runbook.md` §5 contains a dated execution log covering the
production teardown, the local container deletion, and the MG-5.2 decision with its reason.
No infrastructure command is run from this batch.

---

**Batch 8 Verification (exit gate)**:

- `nx run ptah-license-server:seed-community` creates **4 categories, 9 topics, 11 posts**
- Every `bodyMarkdown` is **byte-identical** to the export's `raw` (asserted, not eyeballed)
- Every topic and post carries the export's original `createdAt` — verified in `psql`, not
  inferred
- A **second** run produces zero creates and non-zero updates
- A `raw: null` fixture aborts and writes nothing · a U+FFFD fixture aborts and writes nothing
- The summary reports `unmatchedUsernames: ['system'] (19 posts)`
- **Zero `User` rows created**; **zero** posts with a non-null `author_id`
- The string `cooked` appears nowhere under `prisma/seed/`
- `decommission-runbook.md` §5 carries the execution log and the MG-5.2 decision

---

### Batch 8 result ✅ COMPLETE — one gate number moved, and the reason is in the export

**Executed 2026-08-05 in one `backend-developer` dispatch** (`batch-8-report.md`, committed
`1cbe93a26`, 11 new files under `apps/ptah-license-server/prisma/seed/` + one `project.json`
target). HEAD did not move during the batch. **Read the report before treating anything
below as an oversight.**

```
npx nx run-many -t eslint:lint,typecheck,test -p ptah-license-server,api-forum --skip-nx-cache
→ Successfully ran targets for 2 projects.
   ptah-license-server 111 tests / 5 suites (was 73 — +38 from community-seed.spec.ts)
   api-forum 436 / 18 (unchanged) · 0 errors, 2 pre-existing warnings
```

#### 🔴 The one number that moved: **10 posts, not 11**

The export's 11th post — topic 13 (_"Start here — how this cohort works"_, pinned), post #2
— has `raw: ""`. **Not `null`; the empty string.** plan §7.1's "`raw` populated: 19 of 19.
Zero nulls. 12,474 chars" is literally true about nulls and about the character total, and
misleading about bodies. Task 8.3's prescribed `raw: z.string().min(1)`, implemented
literally, **aborts on the real export and the seed can never run at all** — the gate would
have been unreachable rather than red.

Both fields being empty is the signature of a Discourse **small-action** post (the grey
one-line marker written when a topic is pinned, which topic 13 was), not a capture failure —
a capture failure leaves the rendered field populated and only the markdown missing, which
is exactly what `a22b03eb6` fixed. **But the seed cannot prove that distinction and must not
try: AD-8 forbids it from reading the rendered field at all**, so `raw.length === 0` is the
only signal available in code.

| Option               | Consequence                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Abort, as specified  | The seed can never run. Gate unreachable.                                                                                                                                                                    |
| Import it            | A blank reply under a pinned welcome thread, and `Topic.postCount = 1` promising a reply with no content. A user-visible defect.                                                                             |
| **Skip it** ← chosen | 10 posts not 11; `postCount = 0` on topic 13. Counted, named in the summary, asserted in the spec, controlled by one constant (`SKIP_EMPTY_BODY_POSTS` in `map-topics.ts`) so reversal is a one-line change. |

**The genuinely correct fix is upstream** — re-capture the export without small-action posts.
Then `EXPECTED_POST_COUNT` becomes 18, `EXPECTED_NON_EMPTY_BODY_POSTS` matches it, the skip
constant is deleted, and the arithmetic becomes an honest `18 = 10 + 8`. **This is the one
open item for the user.** Until then the post arithmetic Batch 11 completes is
**`19 = 10 written + 1 skipped + 8 curriculum`**, not `11 + 8`.

#### Census constants introduced

| Constant                                                                   | Value                                                                        | Home                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPECTED_CATEGORY_COUNT` / `EXPECTED_TOPIC_COUNT` / `EXPECTED_POST_COUNT` | 4 / 17 / **19** (source totals)                                              | `discourse-export.schema.ts:59-61`                                                                                                                                                                        |
| `EXPECTED_NON_EMPTY_BODY_POSTS`                                            | **18**, checked by **equality**                                              | `discourse-export.schema.ts:56` — a regression to empty bodies aborts (0 ≠ 18) and a fix to the phantom post also aborts (19 ≠ 18), which is correct: that is a content change a human should acknowledge |
| `SKIP_EMPTY_BODY_POSTS`                                                    | `true`                                                                       | `map-topics.ts:68`                                                                                                                                                                                        |
| `IMPORTED_TOPIC_IDS` / `CURRICULUM_TOPIC_IDS`                              | 9 / **8**, asserted disjoint and asserted to cover the 17 source ids exactly | `map-topics.ts:21,34` — **both exported; Batch 11 consumes `CURRICULUM_TOPIC_IDS` and must not redeclare it**                                                                                             |

#### Deviations, each deliberate

| Spec said                                                       | What was done                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma.upsert` everywhere (§7.4)                               | **`findUnique` + `create`/`update`** on the same natural keys                  | `upsert` **cannot tell the caller which branch it took**, and "a second run produces zero creates" is the gate's central observable. An upsert-based seed prints the identical summary whether it created 9 topics or updated 9 — exactly the failure the idempotency check exists to catch. AD-15 and RK-1 are unaffected; the match keys are **asserted**, not merely claimed (`['slug']`, `['topicId_postNumber']`). |
| Reproduce the slug rules from `common/slug.ts`                  | Rules reproduced as a **schema constraint**; **values reused from the source** | Calling `buildSlug()` would break idempotency **outright**: `resolveSlugCollision` takes the set of slugs already in use, so run 2 would see run 1's `guidelines`, resolve `guidelines-2`, and create a duplicate topic. `slug.ts`'s own docblock says it is create-path-only, and this is not the create path.                                                                                                         |
| `cooked: z.unknown()` in the schema (Task 8.3)                  | **Field omitted entirely**                                                     | Task 8.3 and Task 8.7 assertion 7 are **directly contradictory** — the declaration would be the first violation of the assertion that enforces it. A Zod object schema strips undeclared keys, so the field is gone **at run time** as well as from its type, which is strictly stronger than `z.unknown()`. Both halves asserted. **plan §7.5's summary block has the same problem** and that clause is omitted too.   |
| `npx tsx …` (Task 8.2)                                          | `npx ts-node --project …`                                                      | `tsx` is in neither `dependencies` nor `devDependencies`; `npx tsx` would network-install an unpinned binary on every run. `ts-node ^10.9.2` is a real devDependency and `package.json` already uses this form for three other scripts.                                                                                                                                                                                 |
| Files listed in Task 8.2                                        | **+ `prisma-client.ts`**                                                       | Isolates the Prisma-7 adapter + two-stage `DATABASE_URL` resolution so it is separately provable — the one thing Task 8.2 warned "looks exactly like a mapping bug three tasks later".                                                                                                                                                                                                                                  |
| All fixtures committed                                          | **2 committed, 2 derived at test time**                                        | A hand-copied 42 KB fixture is a snapshot of the export as of the day it was copied, and **this export has already been re-captured once** — `a22b03eb6` fixed `6614f9e92`, the very defect these fixtures test. Deriving keeps the only difference the single mutation under test, and a control test asserts the _unmutated_ copy validates.                                                                          |
| Task 8.7 assertion 8 (round-trip through the `'member'` preset) | **NOT implemented, and not weakened**                                          | See carried-forward item 1.                                                                                                                                                                                                                                                                                                                                                                                             |
| Task 8.8: "the runbook was written and left unexecuted"         | It was **fully executed** by Batch 5                                           | All nine steps ticked or explicitly `DECLINED`/`N/A`, with timestamps; the header already read `✅ EXECUTED 2026-08-04`. A **§5b addendum** was added instead of rewriting §5.                                                                                                                                                                                                                                          |
| Task 8.8: "return MG-5.2 undecided"                             | **Decided: option (b), accept `NXDOMAIN`**                                     | The batch brief superseded this file. Recorded with its reasoning _and_ the still-available option (a), so the orchestrator can overturn it in one edit.                                                                                                                                                                                                                                                                |

#### Two vacuity findings — both found by testing the test

1. **Byte fidelity was vacuous as first written.** The check compared each stored
   `bodyMarkdown` to the export `raw` byte for byte — and it **also passed when `.trim()`
   was added to the mapper**, because not one of the 18 non-empty bodies has leading or
   trailing whitespace or a CR. Fixed by mapping a derived fixture whose body is hostile to
   every plausible normalisation (leading/trailing whitespace, a tab, CRLF, an HTML entity,
   a literal tag, a non-ASCII em-dash, a trailing blank line). **Generalisable rule, and it
   is the same shape as B6's trigram `EXPLAIN` at 0 rows: a comparison against a corpus that
   is invariant under a transform detects nothing. Any future "we compared it byte for byte"
   claim must say what the corpus is _sensitive to_.**
2. **The AD-8 grep needle is assembled from fragments** (`['coo','ked'].join('')`) because
   the assertion greps **every file under `prisma/seed/`, its own spec included** — a
   literal would make the test that enforces the quarantine the first thing to violate it.
   The scan also asserts it saw ≥ 8 files, so a glob that silently matches nothing cannot
   pass. **Batch 11's files are inside that scan.**

#### Carried forward — reported, not fixed

1. **Task 8.7 assertion 8 is unimplemented**, and _the predicted blocker was not the real
   one_. `@nx/enforce-module-boundaries` **permits** it: `ptah-license-server` is
   `scope:app`, which may depend on `scope:shared`, and `libs/frontend/markdown` is
   `["scope:shared","type:ui"]`. The three real blockers are (a)
   `apps/ptah-license-server/jest.config.ts` sets `testEnvironment: 'node'` and DOMPurify
   needs a DOM; (b) **`createMemberSanitizer` is module-private** in
   `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:230` and reachable only
   through Angular DI — the barrel exports only `MarkdownBlockComponent`,
   `provideMarkdownRendering`, `MarkdownRenderingConfig` and `getMarkedExtensions`; (c) the
   fallback location is the frontend side. **Owner: Task 11.6, in `libs/web/members`, where
   jsdom and the real `'member'` preset are already wired.** Task 8.7's instruction stands:
   _do not weaken it to a regex over markdown syntax — that tests nothing._
2. **B6 carried-forward item 2 (the trigram `EXPLAIN`) is STILL open past Batch 8.** With 10
   rows the planner still correctly prefers a `Seq Scan`, and `ANALYZE` changed nothing. The
   forced form (`set enable_seqscan = off`) does show `Bitmap Index Scan on
community_posts_body_trgm`, which proves the plan is available. **Keep using the forced
   form.** Batch 9's lesson-title trigram index inherits exactly this — see Task 9.4.
3. **`typecheck` does not cover `prisma/seed/`** (Finding 10). `tsc --noEmit -p
tsconfig.app.json` has `include: ["src/**/*.ts"]`. Coverage comes from `ts-jest`
   (the spec imports all five seed modules) and from
   `apps/ptah-license-server/prisma/seed/tsconfig.json` run standalone. `eslint .` **does**
   cover it. **Batch 11 must add any new seed module to the spec's import graph or it is
   linted but not type-checked.**
4. **`@nx/enforce-module-boundaries` blocks the only lightweight route to `PrismaClient`**
   from a standalone script, so `prisma-client.ts` carries a scoped, documented
   `eslint-disable-next-line` on one relative import — **verified load-bearing** (removing it
   produces the boundary error, and the workspace's unused-disable reporting did not flag
   it). The clean fix is a `@ptah-api/prisma-client` alias in `tsconfig.base.json`, which
   Batch 8 was forbidden to touch. **Batch 9 owns `tsconfig.base.json` twice already** —
   folding this in is optional and is called out in Task 9.1.
5. **🔴 ONE ACTION FOR THE USER, still open.** A second forum API key
   (`id=2 ptah-theme-deploy`) existed on the destroyed server and appeared in no env file —
   almost certainly an **Actions secret** supplied to the deleted
   `deploy-community-theme.yml`. It was revoked server-side on 2026-08-04 and its service is
   gone, so this is hygiene, not live exposure — but a credential that outlives its service
   is exactly what gets reused. **Check `Settings → Secrets and variables → Actions`, and
   the Dependabot and Environments tabs too** (an environment-scoped secret does not appear
   in the repository list). An agent cannot read repository secrets and did not try.

#### Live state Phase 3 inherits

```
community_categories 4 · community_topics 9 · community_posts 10
community_post_reactions 0 · community_topic_read_state 0
users 3 · member_groups 1 (key='founding', is_default=t) · member_group_assignments 0
licenses: DEV-BUILDERS-VALIDATION-0001  builders/active  — intact
admin_audit_log: 18 community.* rows, deliberately retained
```

Every seeded row is distinguishable: `author_id IS NULL`, `created_at` between
**2026-07-22 and 2026-08-01**, and the nine slugs listed under Task 8.5. **Batch 11 extends
this same seed module and must not truncate, re-run destructively, or seed
`member_group_assignments`.**

---

## Batch 9: P3-BE — `libs/api/youtube` + `libs/api/learning` + migration 3 ⏸️ PENDING

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential — and **dispatch it in THREE parts, as Batch 6 was**.
Batch 6 was 15 tasks and ran as 6A / 6B / 6C; this is 17 across two new libs and one
migration, which is larger. The split that matches the dependency edges:

| Dispatch | Tasks       | Shape                                                                                                                                                                                               |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **9A**   | 9.1 – 9.6   | Both scaffolds, the whole `youtube` lib, the schema, migration 3, and the two armed structural specs. Ends with an irreversible step (the migration) and nothing depending on an unwritten service. |
| **9B**   | 9.7 – 9.14  | Contracts + `common/` + the seven services. No controller, no module, no registry edit.                                                                                                             |
| **9C**   | 9.15 – 9.17 | Controllers, DTOs, `LearningModule`, the three registries, the census constants, the hub section and the NFR-P6 proof.                                                                              |

**Rationale**: `libs/api/youtube` is a hard prerequisite for `learning`'s authoring path and
(per §8.1) for Batch 12. Lock evaluation, prev/next traversal and progress clamping read the
same course tree and are one model, not independent files. The migration is the one
irreversible step and belongs in the dispatch that has nothing built on top of it yet.

**Dependencies**: Batch 5 (migration order — migration 2 is applied, migration 3 is next),
Batch 1 (`MemberContext` / `MemberGuard`), Batch 2 (`@ptah-contracts/community`), Batch 3
(the hub composer and its five section seams). **NOT blocked by Batch 6 or Batch 8**
(§8.1: P2 ↮ P3 — `forum` and `learning` share no model, no service and no route prefix).
In practice B6/B7/B8 have all landed, so this is a note about what would have been legal
rather than a live choice.

**Preconditions**: PRE-1, PRE-2, PRE-6, PRE-7 — and read the three below **before** the
first line of code.

**Tasks**: 17 (refined at the Phase-2/Phase-3 boundary, 2026-08-05)

**Scope boundary (RK-1 / RK-6)**: no YouTube OAuth, no upload pipeline, no channel write
access, no quota tracking, no backoff scheduler, **no metadata refresh cron** —
`refresh-metadata` is a **manual** admin action, deliberately, because an automatic refresh
job reintroduces the quota surface the authoring-time decision removed. No cache, no TTL, no
Redis: **persistence IS the cache** (§4.5), because there is no read-path call to cache. No
certificates, no quizzes, no discussion threads on modules, no course-level enrolment table
(entitlement + cohort already decide visibility — A-2).

**Exit gate (§8.2 P3, backend half)** — four clauses, each with a named owner task:

1. **A locked module returns `403` from the API, not a CSS state** (Task 9.10, proved live
   with `V-CURL` in Task 9.17).
2. **Completion derives from persisted duration** (Task 9.13) — `furthest >= 0.9 *
videoDurationSeconds`, computed server-side; the client never sends a `completed` flag.
3. **With `YOUTUBE_API_KEY` unset nothing `500`s and an admin can save manual metadata**
   (Tasks 9.3 + 9.12). ⚠️ **This is the DEFAULT state of this workspace** — see ASSUMPTION-6.
4. **No YouTube request fires on a member lesson read** (Task 9.17, NFR-P6) — asserted
   **twice**, structurally and behaviourally, and **proven by deliberate failure**.

Plus the standing structural gates: `route-map` (RI-1/RI-2/RI-3) · `controller-validation`
(`NAMED_PRIMITIVE_PARAM_COUNT` **exactly 6**, `MIN_TOTAL_PAYLOAD_PARAMS` re-derived and
raised) · `admin-guards` G1 · `app.module.spec` boots · migration 3 applied against the
running `ptah_db` with the lesson-title trigram index present in `pg_indexes` · **the two
new lib-local structural specs green and each proven to fail** (Task 9.6).

**File set** (for the serialisation claim): `libs/api/youtube/**`, `libs/api/learning/**`,
`libs/api-contracts/community/**`, `libs/api/member-hub/**`,
`apps/ptah-license-server/prisma/schema.prisma`,
`apps/ptah-license-server/prisma/migrations/<ts>_courses/**`,
`apps/ptah-license-server/src/app/app.module.ts`,
`apps/ptah-license-server/src/testing/controller-registry.ts`,
`apps/ptah-license-server/src/common/{route-map,controller-validation}.spec.ts`,
`apps/ptah-license-server/src/admin/admin-guards.spec.ts`, `tsconfig.base.json`,
`.env.example`, `.env.prod.example`.

🔴 **Shared-registry touchpoints — this is why B9 CANNOT run in parallel with B10 or B11.**
`context.md`'s serialisation rule exists because two "file-disjoint" batches both needed a
`tsconfig.base.json` alias and collided. **B9 edits `tsconfig.base.json` TWICE** (Tasks 9.1
and 9.6), plus `app.module.ts`, `controller-registry.ts`, `route-map.spec.ts`,
`controller-validation.spec.ts` and `schema.prisma`. **No other batch may be in flight while
9A or 9C is running.** 9B touches none of them and is the only part that could overlap
anything — but sequencing the whole batch is simpler than reasoning about a partial window.

---

### Ground truth Phase 3 inherits — read before starting

**Every item below was verified against the tree on 2026-08-05, at or after `a2d36a24c`.
Do not plan against the plan's stale facts, and do not re-derive these.**

1. **`libs/api/youtube` does not exist. `libs/api/learning` does not exist.** Neither has a
   `tsconfig.base.json` alias. Both are created here.
2. **`YOUTUBE_API_KEY` is ALREADY in `.env.example:285` and `.env.prod.example:76`** — Batch
   5 added it into the block vacated by the `DISCOURSE_*` removal, exactly as §4.1 asked.
   **Do not re-add it.** Check first; the plan's instruction to add it is already discharged.
3. **`YOUTUBE_API_KEY` is present but EMPTY in the workspace-root `.env` (line 259).** See
   **ASSUMPTION-6** — the feature-off path is the live path here.
4. **`PREFIX_EXCEPTIONS` is NOT empty** — one pre-existing entry,
   `marketing/PublicMarketingController` at the empty prefix
   (`route-map.spec.ts:400-418`). **`KNOWN_PREFIX_DEBT` IS `[]`** (`:450`). The invariant
   is: **add nothing to either.** RI-1 compares **segment-wise proper path prefixes**
   (`isProperPathPrefix(segmentsOfPrefix(a), segmentsOfPrefix(b))`), not string prefixes —
   which is why §2.6's `v1/admin/courses` and `v1/admin/course-modules` are legal siblings.
   See RISK-N for the full disjointness check, already done.
5. **`MIN_TOTAL_PAYLOAD_PARAMS = 51`** (`controller-validation.spec.ts:156`) — a **floor**.
   **`NAMED_PRIMITIVE_PARAM_COUNT = 6`** (`:182`) — an **exact-equality** assertion. One
   `@Query('slug') slug: string` anywhere in this batch fails the build. `UNVALIDATED_DEBT`
   is `[]` (`:78`).
6. **`EXPECTED_ROUTES` holds 90 entries** and its docblock's running total was corrected in
   Batch 6 to `65 → 66 → 68 → 64 (P1b) → 90 (B6, +26)`. **A count in prose is the one thing
   in that file no assertion keeps honest** — extend the _array_, then fix the prose.
7. **`createMockPrisma()` in `libs/api/core/src/testing/mock-prisma.factory.ts` covers nine
   models and none of the course models**, and `mock-prisma.factory.spec.ts:51` asserts
   `MODEL_KEYS` by **exact equality**. Extending it is a two-file change that turns
   `api-core:test` red unless the census moves too. See Task 9.6 for the verdict.
8. **The AD-5 structural spec is LIB-LOCAL.**
   `libs/api/forum/src/lib/common/soft-delete-filter.spec.ts:431` sets
   `LIB_ROOT = resolve(__dirname, '..')` and `:486` asserts
   `LIB_ROOT.endsWith('src/lib')`. It scans `libs/api/forum` and **nothing else**. Same for
   `nullable-dto.spec.ts`. **`libs/api/learning` therefore starts with ZERO coverage from
   either.** See Task 9.6.
9. **`@IsOptional()` skips validation for `null` as well as `undefined`** — twelve fields
   across five DTOs returned `500` in Batch 6 before B6.1 swept them.
   `libs/api/forum/src/lib/common/optional-field.ts` exports `IsOptionalNotNull()`
   (a `ValidateIf` that gates the whole property, so the refusal names the property and the
   expected type) and `NullMeansAbsent()` (a `Transform`). **Every nullable field in this
   batch's DTOs uses the learning-lib equivalent or explains why not** — Task 9.6 decides
   whether it is imported or re-declared.
10. **`Topic.postCount` counts replies and excludes the opening post; `lastReadPostNumber`
    is a post number and includes it.** `libs/api/forum/src/lib/common/post-numbering.ts`
    is the one place the two units convert. **Lesson progress has the same class of
    hazard** — see RISK-O, which is the highest-value thing in this block.
11. **`resolveParentId` — the R1.3.3 depth repair — is a PRIVATE method on
    `PostsService`** (`posts.service.ts:244-263`), three lines of decision
    (`return parentPost.parentId ?? parentPost.id`) wrapped in a `topicId`-scoped,
    `NOT_DELETED`-filtered read. It is **not** exported, and
    `forum.module.spec.ts` asserts the barrel exports exactly two services and none of
    `common/`. Task 9.14 decides reuse-vs-reimplement, explicitly.
12. **AD-12 is discharged and the member namespace is clean.** Every member controller
    declares a literal segment 3: `v1/members/{entitlement,hub,sessions,community,search}`.
    `MembersController` moved from `@Controller('v1/members')` + `@Get('sessions')` to
    `@Controller('v1/members/sessions')` (`members.controller.ts:58`). **RISK-B cannot
    recur** as long as this batch's two member controllers also declare literal segment 3.
13. **Migration state is clean and `prisma migrate dev` is SAFE again (RISK-K CLOSED).** All
    18 `_prisma_migrations` checksums were compared against their files' `sha256sum` at the
    close of Batch 6 and every one matches. **Migration 3 does not need Batch 6's
    hand-authoring workaround** — but `migrate diff --from-config-datasource` remains the
    safer habit and Task 9.5 uses it. **Prisma is 7.7.0**: `--from-url` and
    `--to-schema-datamodel` **do not exist**, and Prisma 7 writes a dotenv banner to
    **stdout** that corrupts a redirected `.sql`. Both traps are spelled out in Task 9.5.
14. **`libs/api/member-hub/src/lib/sections/learning.section.ts` already exists** and
    returns `{ status: 'empty', data: null }`. Its docblock says in terms: _"THIS FILE IS
    THE SEAM, NOT A PLACEHOLDER. Batch 9 replaces the body of `resolve` … and changes
    NOTHING else — not the envelope, not the composer, not the client."_ Task 9.17 honours
    that literally, the way Task 6.15 did for `community`.
15. **`app.module.ts` registers `ForumModule` at line ~107, after `MembershipModule`
    (line 69)** — R7.3's ordering. `LearningModule` goes in the same region for the same
    reason. `MemberHubModule` is at ~90.
16. **The command shapes that actually work here.** `nx lint` **does not exist** for
    `libs/api/*` — the inferred target is **`eslint:lint`** (it exists because the lib
    carries its own `eslint.config.mjs`; Batch 6A had to add one that Task 6.1's file list
    omitted). Jest 30's flag is **`--testPathPatterns=`**, not `--testPathPattern=`.
    **`npm run test` runs 3 unrelated projects and is never the gate.** **Never
    `nx affected`** — a second process commits to this branch and `affected` pulls in its
    in-flight work. Always an explicit project list with `--skip-nx-cache`.
17. **`npx nx show project <new-lib>` can fail once with `Could not find project`** on a
    stale Nx graph. `npx nx reset` fixes it. It looks like a scaffolding bug and is not one.

---

### Risks surfaced by the Phase-3 refine pass

These are **new**. Batches 10 and 11 reference them by handle.

| #          | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Sev                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-N** | **The §2.6 controller layout was checked against RI-1 and it PASSES — but only because the check is segment-wise.** `v1/admin/courses` and `v1/admin/course-modules` are a _string_ prefix pair and would fail a naive check; RI-1 uses `isProperPathPrefix` over parsed segments (`route-map.spec.ts:511-540`), and `['v1','admin','courses']` is not a prefix of `['v1','admin','course-modules']` because segment 3 differs. **All eight new prefixes are disjoint literal siblings and nothing sits at a bare parent.** Full check written out in Task 9.15. **This is RISK-J's shape and it does NOT recur.**                                               | **LOW** (checked, closed) | Task 9.15 lands the exact eight prefixes below and nothing else. **Do not "simplify" `v1/admin/course-modules` to `v1/admin/courses/modules`** — that WOULD nest under `v1/admin/courses` and reproduce RISK-J exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **RISK-O** | 🔴 **Lesson progress has THREE units and they are mutually confusable: a POSITION in seconds, a DURATION in seconds, and a PERCENTAGE.** R2.3.2's rule is "90% of _persisted_ duration". `furthestPositionSeconds` and `videoDurationSeconds` are both integer seconds and are **interchangeable at every call site without a type error**. R2.3.5's course percentage is a **third** number derived from _lesson counts_, not from seconds — `completedLessons / totalLessons`. B6.1's whole finding was that `postCount` and `lastReadPostNumber` were "consistent with each other and all wrong" across four sites, and **no single-site test could see it**. | **HIGH**                  | Task 9.13 declares the conversion in **one** named file (`libs/api/learning/src/lib/progress/completion.ts`) with named functions, not a bare `* 0.9` at a call site, and its spec derives expectations from a **fixture model** rather than restating the implementation's arithmetic — exactly the shape change `unread-units.spec.ts` made. Task 9.11 asserts the course percentage is computed from **counts**, never from seconds.                                                                                                                                                                                                                                                                                                                                                |
| **RISK-P** | **NFR-P6 ("no YouTube request fires on a member lesson read") passes VACUOUSLY if the code path is never exercised.** "We didn't call it" is true of a test that renders nothing. Batch 6's carried item 2 (a trigram `EXPLAIN` that was vacuous at 0 rows) and Batch 8's Finding 6 (a byte comparison against a corpus invariant under the transform) are both this failure, twice.                                                                                                                                                                                                                                                                             | **HIGH**                  | Task 9.17 asserts it **two independent ways**: (a) **structurally** — no file under `libs/api/learning/src/lib/{courses,progress,comments}` imports `@ptah-api/youtube`, and the only importer is `lessons/lesson-video.service.ts`, asserted **by name** the way `markdown-chokepoint.spec.ts` pins its three importers; (b) **behaviourally** — the real member read path runs against a `YouTubeMetadataProvider` double whose `fetchVideo` **throws**, over a lesson that HAS a `youtubeVideoId` and full persisted metadata. Plus **the deliberate-failure step is part of the task**: add a `fetchVideo` call to the read path, watch both halves fail, revert, report both runs.                                                                                                |
| **RISK-Q** | **`libs/api/youtube` is `type:util`, and `type:util → onlyDependOnLibsWithTags: ['type:util']`** (`eslint.config.mjs:202-204`). RISK-F is the general form of this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **LOW** (checked, closed) | **Verified: the tag is correct and the lib needs nothing it cannot have.** `api-core`, `api-identity`, `api-audit` and `api-membership` are all `["scope:api","type:util"]`, so `api-youtube` **may** depend on `api-core`. In practice it needs neither: `ConfigService` comes from `@nestjs/config` and `Logger` from `@nestjs/common`, both npm packages outside the tag graph, which is exactly how `GoogleAuthProvider` is built. **Verdict: keep `type:util`, import nothing from `libs/api/*`, and say so in the README.** `libs/api/learning` is `type:feature`, which permits `{feature, data-access, ui, util, core}` — so it may depend on `api-youtube`, `api-core`, `api-identity`, `api-audit`, `api-membership` and `api-contracts-community`. RISK-F does not bite it. |
| **RISK-R** | **The plan's `google-auth.provider.ts:1-24` reference is right about the DOCBLOCK and wrong about the LOG-ONCE MECHANISM.** `GoogleAuthProvider`'s only `logged*` flag is `loggedScopeVerdict` (`:52`), which guards a _scope verdict_, not the disabled notice. The disabled-log-once idiom lives in a **different file**: `sessions.service.ts:60` (`private loggedDisabled = false`) and `:427-438` (`private isEnabledOrLogOnce()`). §4.1 cites `sessions.service.ts:396-407` — **stale by ~30 lines.**                                                                                                                                                      | MED                       | Task 9.3 names both files and both line ranges, and copies `isEnabledOrLogOnce()`'s shape (a private method that returns the boolean _and_ owns the flag) rather than scattering `if (!this.loggedDisabled)` at each call site.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **RISK-S** | **`bypassSecurityTrustResourceUrl` appears NOWHERE in this repository today** — verified by `rg` across `libs` and `apps`. Batch 10 introduces the workspace's **first** trusted-URL construction. There is no in-repo precedent to imitate and no existing spec to extend.                                                                                                                                                                                                                                                                                                                                                                                      | **HIGH** (B10)            | Task 10.3 isolates it in **one** pure function with no Angular dependency, and Task 10.11 gives it a dedicated spec **and** a `youtube-embed-chokepoint.spec.ts` sibling to `markdown-chokepoint.spec.ts`. Detail in Batch 10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **RISK-T** | **B10 is the first real consumer of B9's API, which is exactly the shape that produced B7's three findings.** B7 found an off-by-one, a 500 and a missing filter — none visible from inside the backend's own tests.                                                                                                                                                                                                                                                                                                                                                                                                                                             | MED                       | **Budget for a `9.1` follow-up dispatch the way B6.1 and B7.1 were budgeted.** Task 10.2's instruction is explicit: **report, do not work around**. The Batch 7 result records why that produced a better API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

### Assumptions this refine pass takes (not in the plan; flag if wrong)

- 🔴 **ASSUMPTION-6 — the YouTube happy path CANNOT be verified live in this workspace, and
  that is a fact about the environment, not a licence to skip it.** `.env:259` reads
  `YOUTUBE_API_KEY=` with **no value**, so `isEnabled()` is `false` here and every live
  `V-CURL` against the authoring path exercises the **feature-off** branch. That makes exit-gate
  clause 3 free and exit-gate clause 4 _easier than it should be_ — a member read makes no
  YouTube call partly because nothing can. **Therefore**: (a) Task 9.3's success, `not_found`,
  `private`, `not_embeddable`, `malformed_response` and timeout branches are asserted against
  a **stubbed `fetch`**, each mapping to §4.4's row, with the stub's shape taken from a real
  `videos.list` response body pasted into the spec; (b) Task 9.12 asserts the enabled path by
  **injecting a provider double that returns `{ ok: true, video }`**, so the transaction
  boundary is proven without a key; (c) the report states plainly that no real YouTube request
  was made. **Cheapest way to overrule**: the user puts a real Data API v3 key in `.env`, and
  Task 9.12 adds one live `V-CURL` against a known unlisted video id. One line of `.env`, one
  extra check — say so in the report rather than pretending either way.
- **ASSUMPTION-7 — a course's `visibility`/`cohortKeys` gate is evaluated with the SAME
  three-branch rule as a forum category, including ASSUMPTION-4's `staff` ⇒ admin-only.**
  §1.4 gives `Course.visibility` the identical `'member' | 'cohort' | 'staff'` vocabulary and
  the identical `cohortKeys String[]`, and R2.1.2 fixes the draft posture at `404`. No
  requirement says who sees a `staff` course, exactly as none said it for a `staff` category.
  Task 9.8 therefore mirrors `buildCategoryVisibilityWhere` — **as a second implementation in
  `libs/api/learning/src/lib/common/visibility.ts`, not a shared one** (see Task 9.8 for why),
  with the same "omit the cohort branch entirely when `ctx.cohortKeys` is empty" rule and the
  same `satisfies Visibility` pin against `@ptah-contracts/community`. If the user wants
  `staff` courses visible to non-admin staff, that is one branch in one file.
- **ASSUMPTION-8 — `Lesson.videoDurationSeconds` is the ONLY duration the 90% rule may read,
  and a lesson with `videoDurationSeconds === null` is manual-only even if it has a
  `youtubeVideoId`.** R2.3.4 says "a lesson with no video ⇒ manual only"; §4.6.6 says "a lesson
  with no `videoDurationSeconds` is manual-only". These differ: the feature-off path (R2.2.6)
  produces a lesson **with** a video id and **possibly without** a duration, when an admin typed
  a title but no runtime. The stricter reading — key on the duration, not on the id — is the
  only one that cannot compute a threshold against `null`. Task 9.13 implements it and the
  docblock says so. **Cheap to overrule**: one predicate in one file.
- **ASSUMPTION-9 — `refresh-metadata` writes nothing when the fetch fails.** §4.4 maps a
  failed fetch to `422`/`502` for a _save_; R2.2.5 says "re-fetched and updated" for a
  _refresh_ and does not say what a partial batch does. Task 9.12 makes the bulk refresh
  **per-lesson atomic and batch-tolerant**: each lesson either updates fully or not at all, the
  response reports `{ refreshed, skipped, failed: [{ lessonId, reason }] }`, and **one bad id
  does not roll back the good ones**. A single all-or-nothing transaction across N lessons
  would make one deleted video block every other refresh, which is the opposite of what a
  maintenance action is for.

---

### Task 9.1: Scaffold `libs/api/youtube` — and settle RISK-F before writing a line ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\youtube\project.json` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\tsconfig.json` (NEW, + `.lib.json`, `.spec.json`)
- `D:\projects\ptah-extension\libs\api\youtube\jest.config.cts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\eslint.config.mjs` (NEW — **load-bearing, see below**)
- `D:\projects\ptah-extension\libs\api\youtube\package.json` (NEW — **load-bearing, see below**)
- `D:\projects\ptah-extension\libs\api\youtube\README.md` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\index.ts` (NEW)
- `D:\projects\ptah-extension\tsconfig.base.json` (MODIFY — one line)

**Requirement refs**: §2.1, §2.4, R2.2, R3.2, NFR-M2, NFR-M4, RISK-F, RISK-Q
**Dependencies**: none — this is the batch's root
**Pattern to follow**: `libs/api/forum/project.json` + `libs/api/forum/eslint.config.mjs`
(the most recent api lib, same depth) for the file set; **`libs/api/membership/project.json`
for the TAGS**, because that is the only other `["scope:api","type:util"]` api lib.

**Implementation details**:

- `{ "name": "api-youtube", "tags": ["scope:api", "type:util"] }`.
- `tsconfig.base.json`: `"@ptah-api/youtube": ["./libs/api/youtube/src/index.ts"]`, placed to
  match the file's existing api ordering (Batch 6A put `forum` between `member-hub` and
  `community` for this reason).
- **`eslint.config.mjs` and `package.json` are NOT optional and are NOT in the plan's file
  list.** Batch 6A's D-1 established both: `eslint.config.mjs` is what makes Nx **infer** the
  `eslint:lint` target — without it `npx nx eslint:lint api-youtube`, this task's own
  verification command, **does not exist**; `package.json` carries `"name":
"@ptah-api/youtube"`, which is what puts `packageName` into the project's `js` metadata and
  the `npm:private` tag on it, matching every sibling.
- README states the boundary in one paragraph: this lib owns **one outbound integration** and
  **no persistence** — it never sees Prisma, never sees a `MemberContext`, and returns a
  discriminated union rather than throwing. It is consumed by `libs/api/learning` (Batch 9)
  and `libs/api/community` (Batch 12, R3.2, **verbatim, not a second provider**).
- The barrel starts at `export {};` (Batch 6A's D-2 idiom — keeps `index.ts` a module rather
  than a script) with a docblock naming the intended end state: `YoutubeModule`,
  `YouTubeMetadataProvider`, the two pure helpers and the types. Tasks 9.2/9.3 fill it.

**Validation notes**:

- 🔴 **RISK-Q / RISK-F — settle it here, in the report, with the evidence.**
  `eslint.config.mjs:202-204` reads `{ sourceTag: 'type:util', onlyDependOnLibsWithTags:
['type:util'] }`. Run the census before scaffolding:
  `for p in core identity audit membership; do grep -o '"tags":[^]]*]' libs/api/$p/project.json; done`
  → all four are `["scope:api","type:util"]`. **So `type:util` DOES permit reaching
  `api-core`.** The tag is correct and the plan is right.
  **But the lib should still import nothing from `libs/api/*`**: `ConfigService`
  (`@nestjs/config`) and `Logger` (`@nestjs/common`) are npm packages outside the tag graph,
  which is exactly how `GoogleAuthProvider` is built
  (`libs/api/community/src/lib/google-sessions/google-auth.provider.ts:1-3`). **State both
  findings in the report** — that the tag permits `api-core`, and that nothing needed it — so
  the next reader does not re-litigate it.
- **Shared-registry serialisation**: this task edits `tsconfig.base.json`. Task 9.6 edits it
  again. No other batch may be in flight (`context.md`).
- If `nx show project api-youtube` says `Could not find project`, run `npx nx reset` — stale
  graph, not a scaffolding error (Batch 6A minor finding).

**Verification**:

```
npx nx reset && npx nx show project api-youtube
npx nx run-many -t eslint:lint,typecheck -p api-youtube --skip-nx-cache
```

Expected: `tags: ["npm:private","scope:api","type:util"]`, `metadata.js.packageName:
"@ptah-api/youtube"`, targets include **`eslint:lint`**, `test`, `typecheck`. Zero boundary
violations. Paste the `show project` JSON into the report — it is the RISK-Q evidence.

---

### Task 9.2: `libs/api/youtube` pure core — id extraction, ISO-8601 duration, the Zod boundary ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\youtube\src\lib\extract-video-id.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\extract-video-id.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\parse-iso8601-duration.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\parse-iso8601-duration.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.schemas.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.schemas.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.types.ts` (NEW)

**Requirement refs**: R2.2.1, R2.2.3, §4.2, §4.3, §4.4, NFR-S1
**Dependencies**: Task 9.1
**Pattern to follow**: `libs/api/forum/src/lib/common/slug.ts` — a pure, dependency-free
module whose docblock states what it is **not** (Batch 6A's `slug.ts` says explicitly that
`resolveSlugCollision` "is not a concurrency control"). Do the same here.

**Implementation details**:

- **`extractVideoId(input: string): string | null`** — accepts a bare 11-char id, a
  `watch?v=`, a `youtu.be/`, an `/embed/`, a `/shorts/` and a `/live/` URL, with or without
  extra query parameters. Returns `null` for anything else. **The canonical id shape is
  `/^[A-Za-z0-9_-]{11}$/` and it is declared HERE, exported, and is the same constant Batch
  10 imports** — see Task 10.3. Two implementations of that regex is how one of them drifts.
- **`parseIso8601Duration(value: string): number | null`** — `"PT1H2M3S"` → `3723`. Must
  handle the forms YouTube actually emits: `PT0S` (a zero-length/still-processing video),
  `P1DT2H` (a >24h stream), a missing component (`PT5M`), and a plain `PT` with nothing after
  it. **Returns `null` rather than `0` on a form it does not understand** — `0` is a legal
  duration and would silently make the 90% threshold `0`, marking every lesson complete on
  the first frame (RISK-O's shape, one layer up).
- **`youtube.schemas.ts`** — §4.3 verbatim, with `z.url()` on the thumbnail (**Zod is 4.3.6;
  `z.string().url()` is the deprecated v3 spelling and `z.iso.datetime()` / `z.url()` are the
  v4 forms — Batch 8 verified this against the installed version**). The three thumbnail
  sizes are each `.optional()` because YouTube omits `high` on some videos; the resolver picks
  `high ?? medium ?? default` and returns `null` if all three are absent rather than throwing.
- **`youtube.types.ts`** — `YouTubeVideoMetadata` (`{ videoId, title, durationSeconds,
thumbnailUrl }`) and the **discriminated union** `YouTubeFetchResult`:
  ```ts
  | { ok: true;  video: YouTubeVideoMetadata }
  | { ok: false; skipped: true }
  | { ok: false; error: 'not_found' | 'private' | 'not_embeddable'
                      | 'malformed_response' | 'unavailable'; status?: number }
  ```
  **`skipped: true` is a distinct arm, not `error: 'disabled'`** — §4.4's last row says the
  feature-off outcome **is not an error**, and a caller that pattern-matches on `error` must
  be unable to accidentally treat it as one.

**Validation notes**:

- **`privacyStatus: 'unlisted'` is ACCEPTED** — unlisted is the Checkpoint-0 delivery model
  (§4.4's footnote). A schema or a mapper that only accepts `'public'` breaks the entire
  product. Put a spec case on it with that sentence in the test name.
- **Not one field is persisted before `safeParse` succeeds** (NFR-S1). The schema module
  exports the schema; it must not export a "parse or default" helper, because the first
  caller to use one is the one that persists garbage.
- **These three files are pure and have no Nest decorators.** They are testable without a
  module, which is the reason they are separated from the provider — the provider's spec then
  only has to cover transport.

**Verification**:

```
npx nx test api-youtube --skip-nx-cache --testPathPatterns="extract-video-id|parse-iso8601|youtube.schemas"
```

Green. Required cases: every URL form → the same id · a 10-char and a 12-char id → `null` ·
an id containing `+` or `/` → `null` (base64 confusion is the realistic wrong input) ·
`PT0S` → `0` · `P1DT2H` → `93600` · `"5 minutes"` → `null` · the §4.3 schema accepts a real
`videos.list` body pasted verbatim into the spec · it **rejects** the same body with
`contentDetails` removed · `privacyStatus: 'unlisted'` parses.

---

### Task 9.3: `YouTubeMetadataProvider` + `YoutubeModule` — never throws, feature-off, log once ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube-metadata.provider.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube-metadata.provider.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.module.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\index.ts` (MODIFY — the barrel)
- `D:\projects\ptah-extension\.env.example` (**VERIFY ONLY — see below**)
- `D:\projects\ptah-extension\.env.prod.example` (**VERIFY ONLY**)

**Requirement refs**: R2.2.2, R2.2.6, §4.1, §4.2, §4.4, §4.5, NFR-S1, NFR-S6, NFR-S7, NFR-R1, NFR-R2, RK-6, RISK-R
**Dependencies**: Task 9.2
**Pattern to follow**: **two files, and the plan names only one of them.**
`libs/api/community/src/lib/google-sessions/google-auth.provider.ts:5-19` for the **docblock
and the four design rules** (ConfigService only, never throws, feature-off ⇒ `{skipped:true}`,
AbortController-bounded), and `:56-66` for the `?.trim() || undefined` constructor idiom.
**`libs/api/community/src/lib/google-sessions/sessions.service.ts:60` and `:427-438` for the
LOG-ONCE MECHANISM** — `private loggedDisabled = false` plus
`private isEnabledOrLogOnce(): boolean`.

**Implementation details**:

- Constructor reads `YOUTUBE_API_KEY` **once**, via `ConfigService` (NFR-S6 — never
  `process.env`), with `?.trim() || undefined`. `isEnabled(): boolean { return this.apiKey !==
undefined; }`.
- 🔴 **"Log once" needs a NAMED mechanism, and RISK-R says the plan points at the wrong file
  for it.** `GoogleAuthProvider`'s only guard is `loggedScopeVerdict` (`:52`), which is about
  OAuth scopes, not about being disabled. **Copy `isEnabledOrLogOnce()` instead**: a private
  method that returns the boolean **and owns the flag**, so no call site can forget to check
  it and no call site can log twice. §4.1's citation of `sessions.service.ts:396-407` is stale
  by ~30 lines; the real range is `:427-438`.
- `fetchVideo(videoId: string): Promise<YouTubeFetchResult>` —
  `GET https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=<id>&key=<key>`,
  **native `fetch` + `AbortController` at 10,000 ms. No `googleapis` package** (§4.2, matching
  `GoogleAuthProvider`'s explicit decision).
- **It never throws.** Every path — transport error, abort, non-2xx, unparseable JSON, Zod
  failure — folds into an `ok: false` arm. **The raw upstream body is never surfaced**
  (NFR-S7): the `error` field is one of the five literals from Task 9.2, and any upstream text
  goes to `logger.warn` and nowhere else. A spec asserts the returned object contains no
  substring of a fabricated upstream error body.
- **The §4.4 outcome table, implemented in the provider half only.** The provider owns
  `items: [] → 'not_found'`, `privacyStatus === 'private' → 'private'`,
  `embeddable === false → 'not_embeddable'`, Zod failure → `'malformed_response'`,
  HTTP ≥ 400 or timeout → `'unavailable'` (carrying `status` when there is one). **The
  HTTP-status half of that table belongs to Task 9.12**, because `422` vs `502` is an admin-API
  concern and this lib knows nothing about HTTP responses.
- **The key never crosses to the client** (RK-6). It is not in any returned object, not in any
  log line, and a spec asserts the key string appears in no `logger` call argument.
- `YoutubeModule` provides and exports `YouTubeMetadataProvider`. Not `@Global()` — two
  consumers (learning now, community in B12) both import it explicitly.
- **Barrel**: `YoutubeModule`, `YouTubeMetadataProvider`, `extractVideoId`,
  `parseIso8601Duration`, `VIDEO_ID_PATTERN`, and the types. **`youtube.schemas.ts` is NOT
  exported** — a consumer that can reach the schema can build a `YouTubeVideoMetadata` that
  never went through `fetchVideo`, which is the one thing this lib exists to prevent.
- **`.env.example:285` and `.env.prod.example:76` ALREADY carry `YOUTUBE_API_KEY`** (Batch 5
  added it into the block vacated by `DISCOURSE_*`, exactly as §4.1 asked). **Verify, do not
  re-add.** If a duplicate key is introduced the file silently keeps the last one. Confirm in
  the report with `grep -n YOUTUBE_API_KEY .env.example .env.prod.example`.

**Validation notes**:

- 🔴 **ASSUMPTION-6 applies here and must be stated in the report.** `.env:259` has
  `YOUTUBE_API_KEY=` **empty**, so `isEnabled()` is `false` in this workspace and **no live
  request can be made**. Every outcome in §4.4 is therefore asserted against a **stubbed
  `fetch`** (`jest.spyOn(globalThis, 'fetch')`), with the success case's stub body pasted from
  a real `videos.list` response so the schema is exercised against the shape YouTube actually
  emits rather than one invented to satisfy the schema. **Say in the report that no real
  YouTube request was made**, and name the one-line way to overrule it.
- **The timeout must be asserted, not assumed.** A spec that never exercises the abort path
  leaves a 10-second hang in the authoring flow. Use fake timers, assert the `AbortController`
  is aborted at 10,000 ms and that the result is `{ ok: false, error: 'unavailable' }`.
- **"Logs once" must be asserted across TWO calls**, not one. A single-call spec passes for a
  provider that logs every time.
- NFR-P6 lives in Task 9.17, but it starts here: **this lib must be importable by exactly one
  file in `libs/api/learning`**. Nothing in this task should make that harder.

**Verification**:

```
npx nx run-many -t eslint:lint,typecheck,test -p api-youtube --skip-nx-cache
grep -n "YOUTUBE_API_KEY" .env.example .env.prod.example
```

Green. Cases, one per §4.4 row plus: disabled ⇒ `{ ok:false, skipped:true }` and **exactly one
log line across two calls** · timeout ⇒ `unavailable`, aborted at 10 s · a 403 quota body ⇒
`unavailable` with `status: 403` and **no upstream text in the result** · the api key appears
in no logger argument · `unlisted` succeeds.

---

### Task 9.4: Prisma schema — the five course models and the `User` back-relations ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma` (MODIFY)

**Requirement refs**: §1.4, §1.7, R2.1, R2.2, R2.3, R2.4, R2.5, AD-10, AD-15, A-8
**Dependencies**: none within the batch (may run alongside 9.1–9.3)
**Pattern to follow**: **Batch 6A's Task 6.3, exactly** — `git diff -U0 … | grep -E "^@@|^-[^-]"`
should show **two hunks and zero deletions**: the `User` back-relations, and one appended
block after the last model, under a banner comment.

**Implementation details**:

- `Course`, `CourseModule`, `Lesson`, `LessonProgress`, `LessonComment` **verbatim from
  §1.4** — every `@@index`, every `@@unique`, every `onDelete`, **and every
  rejected-index comment**. The three rejection comments are load-bearing and Batch 6A
  carried the equivalents in:
  - `@@unique([courseId, sortOrder])` **deliberately not declared** — R8.8 forbids
    renumbering siblings one request at a time, and a uniqueness constraint would force the
    bulk reorder to sequence its `UPDATE`s to dodge transient collisions.
  - `@@index([lessonId])` on `LessonProgress` **REJECTED** — the composite PK leads with
    `userId`, which serves every query this task issues. A `lessonId`-leading index would
    only serve cross-member analytics, which §5 does not ship. **It also enforces
    NFR-S4/R2.3.7 by SHAPE: there is no efficient way to ask "who else completed this
    lesson", so no member endpoint accidentally can.** Carry that sentence in.
  - `LessonComment` is a **DISTINCT model, never a polymorphic comment table shared with
    `Post`** (Checkpoint-0). Carry §1.4's comment in verbatim.
- `LessonProgress` has a **composite PK and no surrogate id** (`@@id([userId, lessonId])`).
- `User` gains **exactly four** Phase-3 back-relations:
  ```prisma
  lessonProgress  LessonProgress[]
  lessonComments  LessonComment[]  @relation("LessonCommentAuthor")
  ```
  ⚠️ §1.7 lists eight across all phases; Batch 6A added the four Phase-2 ones and its D-7
  records why the rest were held back — `notifications` and `actedNotifications` name a model
  that does not exist until Phase 5 and **would not validate**. Add only what Phase 3 needs.
  Count what §1.4 actually requires: `LessonProgress.user` and `LessonComment.author` are the
  two relation fields, so **two** back-relations, not four — verify against the models you
  paste and state the number you added.
- `authorId`, `userId` are `@db.Uuid` to match `User.id`, exactly as `Topic.authorId` /
  `Post.authorId` are. Batch 6A confirmed the generated DDL emits `UUID` and the FK targets
  `"users"("id")`.
- **Add the banner Batch 6A added and this batch needs again**: a comment above the block
  recording that the lesson-title trigram index exists **only in SQL** and is invisible to
  this schema, so a later `migrate diff` will never mention it and a later migration can
  silently drop it. That warning has to live where a schema reader will see it.

**Validation notes**:

- **Append after the last model; do not interleave.** That is what keeps the diff to two
  hunks and zero incidental reformatting of neighbouring models.
- **Run no `prisma migrate` command in this task.** The migration is Task 9.5.
- `Course.published` defaults to `false` and `Course.sequential` defaults to `false`
  (§1.4) — R2.4.3: when not sequential, **only** date-based locking applies.

**Verification**:

```
cd apps/ptah-license-server && DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" npx prisma validate --schema prisma/schema.prisma
git diff --stat apps/ptah-license-server/prisma/schema.prisma
git diff -U0 apps/ptah-license-server/prisma/schema.prisma | grep -E "^@@|^-[^-]"
```

Expected: `The schema … is valid 🚀` · **two hunks, zero deletions** · no migration folder
created. Paste all three outputs.

---

### Task 9.5: Migration 3 — `courses` + the lesson-title trigram index ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\<generated-ts>_courses\migration.sql` (NEW)

**Requirement refs**: §1.8, A-7, NFR-M3, RISK-H, RISK-K
**Dependencies**: Task 9.4
**Pattern to follow**: `apps/ptah-license-server/prisma/migrations/20260812090000_community_forum/migration.sql`
— Batch 6A's migration 2, including its `-- ---` separator and the comment block above the
hand-written half.

**Implementation details** — the exact sequence, because **three of Phase 2's lost dispatches
were command-shape failures and two of them were in this task's ancestor**:

1. **Privilege pre-flight, BEFORE writing anything** (RISK-H — keep it even though it is now
   LOW, because it is the check that would catch a move to a managed provider):
   ```
   docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select current_user, rolsuper from pg_roles where rolname = current_user;"
   docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select extname from pg_extension where extname='pg_trgm';"
   docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select table_name from information_schema.tables where table_name in ('courses','course_modules','course_lessons','lesson_progress','lesson_comments') order by 1;"
   ```
   Expected: `ptah|t` · `pg_trgm` **already installed by migration 2** (so this migration does
   **not** re-`CREATE EXTENSION`; `IF NOT EXISTS` would be harmless but a no-op line that
   claims to do something is worse than its absence) · **no rows** from the third.
2. **Name the folder with a Prisma-generated timestamp, keeping the plan's SUFFIX only.**
   §1.8's hand-picked `20260819090000` is a **future** date and would sort _after_ a real
   migration authored in the interim, silently inverting the order. This file's Migration
   Authority table says the same. Use `--create-only` and keep `_courses`.
3. 🔴 **RISK-K IS CLOSED — `prisma migrate dev --create-only` is safe here.** All 18
   `_prisma_migrations` checksums were compared against their files' `sha256sum` at the close
   of Batch 6 and every one matches; `097853b39` had already fixed the drift, and three
   reports in a row asserted the opposite without testing it. **Re-run the comparison first
   anyway** — any edit to an applied migration re-opens it — and paste the result.
   ```
   cd apps/ptah-license-server && npx prisma migrate dev --create-only --name courses
   ```
   **If you prefer the safer habit** (and it costs nothing), generate the DDL with
   `migrate diff` and hand-author the folder instead:
   ```
   DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" \
     npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```
   ⚠️ **`--from-url` and `--to-schema-datamodel` DO NOT EXIST on Prisma 7.7.0** — both were
   removed. The error is `` `--from-url` was removed. Please use `--[from/to]-config-datasource` ``.
   This is Batch 6A's C-1 and **it was written down for exactly this migration.**
   ⚠️ **Prisma 7 writes a dotenv banner (`◇ injected env (0) from .env …`) to STDOUT, ahead
   of the script.** Redirecting straight into `migration.sql` produces a file whose first line
   is not SQL. Strip it and **assert the file begins with `-- CreateTable`**. This is C-2.
4. **Read the generated SQL before applying it.** It must contain five `CREATE TABLE`s and
   their indexes and constraints, **and nothing else**. Audit mechanically:
   ```
   grep -c "^CREATE TABLE" .../migration.sql            # expect 5
   grep -nE "^(ALTER|DROP)" .../migration.sql | grep -v "ADD CONSTRAINT"   # expect none
   ```
   **Any unrelated `ALTER` or `DROP` means drift between `schema.prisma` and the live database
   — stop and report it, do not apply.**
5. **The hand-written block**, below a `-- ---` separator with a comment block that states:
   this index is invisible to Prisma's model; a later `migrate diff` will never mention it;
   **the generated SQL of every subsequent migration in this app must therefore be read**; and
   losing it is a _silent performance_ failure, not an error, because search still returns
   correct results by sequential scan.
   ```sql
   CREATE INDEX "course_lessons_title_trgm" ON "course_lessons" USING gin (title gin_trgm_ops);
   ```
   **Do NOT wrap anything in a swallow-all `DO $$ … EXCEPTION` block** (RISK-H's explicit
   instruction): an index silently missing is worse than a loud failure, because A-7's whole
   search design assumes it.
6. Apply with `npx prisma migrate deploy`, then `npx prisma generate`.
   **`prisma migrate reset` and `prisma db push` must not be run.**

**Validation notes**:

- 🔴 **The `EXPLAIN` check on this index will be VACUOUS and you must say so.** Batch 6's
  carried item 2 and Batch 8's re-check both found that at 10 rows the planner correctly
  prefers a `Seq Scan` and would print the same output whether the index existed, had the
  wrong operator class, or had been dropped. **`course_lessons` will hold 8 rows after Batch 11.** Use the forced form — `set enable_seqscan = off;` — which does show a
  `Bitmap Index Scan`, and record that the unforced check needs thousands of rows to mean
  anything. Do not report the unforced `Seq Scan` as a pass or a failure; report it as
  uninformative.
- **Verify `indexdef`, not just `indexname`** — Batch 6A's extra check. An index that merely
  carries the name is not a GIN index with `gin_trgm_ops`.
- **Confirm the dev entitlement survived.** This is the check that proves the command behaved
  like a diff and not like a reset:
  `select license_key, plan, status from licenses where license_key like 'DEV-%';` →
  `DEV-BUILDERS-VALIDATION-0001|builders|active`. And the Batch-8 seed must be untouched:
  `categories=4 topics=9 posts=10`.

**Verification** — paste all six outputs verbatim; **this is the one task in the batch whose
result cannot be re-derived from the source tree**:

```
npx prisma migrate status
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select table_name from information_schema.tables where table_name in ('courses','course_modules','course_lessons','lesson_progress','lesson_comments') order by 1;"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select indexdef from pg_indexes where indexname = 'course_lessons_title_trgm';"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select license_key, plan, status from licenses where license_key like 'DEV-%';"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select count(*) from community_topics;"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
```

Expected: up to date, nothing pending · **five** tables · a GIN index with `gin_trgm_ops` ·
the dev license intact · `9` · `200`.

---

### Task 9.6: Scaffold `libs/api/learning` — and ARM its two structural specs before any service exists ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\project.json` (NEW, + `tsconfig*.json`, `jest.config.cts`, `eslint.config.mjs`, `package.json`, `README.md`)
- `D:\projects\ptah-extension\libs\api\learning\src\index.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\testing\mock-learning-prisma.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\soft-delete-filter.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\nullable-dto.spec.ts` (NEW)
- `D:\projects\ptah-extension\tsconfig.base.json` (MODIFY — one line)

**Requirement refs**: §2.1, §2.6, AD-5, AD-6, OQ-5, NFR-M2, NFR-M4, PRE-1
**Dependencies**: Task 9.1 (the `tsconfig.base.json` ordering convention), Task 9.5 (the
generated Prisma client must carry the course models before the mock can be typed)
**Pattern to follow**: `libs/api/forum/src/lib/common/soft-delete-filter.spec.ts` and
`libs/api/forum/src/lib/common/nullable-dto.spec.ts` — **copy the analysers, not the
censuses.** And `libs/api/forum/src/testing/mock-forum-prisma.ts` for the double.

**Implementation details**:

- `{ "name": "api-learning", "tags": ["scope:api", "type:feature"] }` — `type:feature`
  permits `{feature, data-access, ui, util, core}`, so depending on `api-core`,
  `api-identity`, `api-audit`, `api-membership`, **`api-youtube`** (all `type:util`) and
  `api-contracts-community` (`scope:api-contracts`) is permitted. **RISK-F does not bite
  here** — it constrains `type:util` sources only.
- `tsconfig.base.json`: `"@ptah-api/learning": ["./libs/api/learning/src/index.ts"]`.
- README states the boundary: this lib owns courses, modules, lessons, progress and lesson
  comments, and its barrel exports **`LearningModule` + `CourseReadService` +
  `ProgressService` + the controller classes** — see the export-surface note below.

🔴 **THE AD-5 DECISION, stated rather than rediscovered.**
`libs/api/forum/src/lib/common/soft-delete-filter.spec.ts:431` sets
`LIB_ROOT = resolve(__dirname, '..')` and `:486` asserts `LIB_ROOT.endsWith('src/lib')`. It
scans `libs/api/forum` and **nothing else**. `Lesson`, `LessonComment`, `Course` and
`CourseModule` are all soft-deletable (`deletedAt` on every one, §1.4). **A rule that stops
at a lib boundary is a rule with a hole**, and `libs/api/learning` would otherwise ship four
soft-deletable models with zero structural coverage.

**Verdict: `libs/api/learning` gets its OWN equivalent of both specs, copied and re-rooted —
NOT a widened forum spec.** Three reasons, in order of weight:

1. Widening the forum spec's root breaks its own `LIB_ROOT.endsWith('src/lib')` self-check
   and makes `api-forum:test` depend on a foreign lib's source tree — a change to
   `libs/api/learning` would then turn `api-forum` red, which is how a structural spec
   acquires a reputation for being flaky and gets deleted.
2. The **censuses must be per-lib**. `EXPECTED_EXEMPTIONS` in forum holds exactly two entries,
   both `admin-topics-read.service.ts`; merging would make one list where "the number of
   places that can return a deleted row" stops being a property of one lib.
3. A shared analyser would have to live somewhere both libs can import. `libs/api/core` is the
   only candidate, and putting a Jest-only TypeScript AST walker in the lib every runtime
   imports is worse than 200 duplicated lines of test code.
   **The counter-argument, stated so it is visible**: two analysers can drift, and a fix to
   one will not reach the other. Mitigate by putting a one-line pointer in each file's
   docblock naming the other, so a reader of either knows a sibling exists.

- **`learning`'s `EXPECTED_EXEMPTIONS` starts as `[]`** and — unlike forum — **should still be
  `[]` at the end of this batch.** §3.4's admin table has no `?includeDeleted` read; the
  admin course list is a list of live courses. **If a task in this batch wants an exemption,
  that is a design event, not a formality.** Forum's D-6.13d (the restore window inside the
  `UPDATE`'s `WHERE`, so `updateMany().count` _is_ the outcome and no tombstone read exists)
  is the pattern that kept forum's write paths exemption-free; reuse it if a restore appears.
- **`learning`'s `EXPECTED_NULLABLE_OPTIONALS` starts as `[]`** too. Every optional DTO field
  in this batch uses `IsOptionalNotNull()`. **Import it from forum or re-declare it?** —
  **Re-declare, in `libs/api/learning/src/lib/common/optional-field.ts`.** `optional-field.ts`
  lives in forum's `common/`, which `forum.module.spec.ts` asserts is **not** barrel-exported
  (and that assertion is load-bearing: `NOT_DELETED` leaving the lib would let a consumer
  hand-build a `where` and read the forum past every visibility clause). Widening forum's
  barrel for two decorators is a worse trade than 20 duplicated lines. **Say this in the
  report** — it is the same shape of call as the AD-5 one and both should be visible.

🔴 **THE PRISMA DOUBLE DECISION.** `libs/api/core/src/testing/mock-prisma.factory.ts` carries
nine models and none of the course models, and `mock-prisma.factory.spec.ts:51` asserts
`MODEL_KEYS` **by exact equality**, so extending it turns `api-core:test` red unless that
census moves in the same change. That is a two-file change in a lib outside this batch's
territory, on a census of the same kind as `NAMED_PRIMITIVE_PARAM_COUNT`.
**Verdict: a lib-local `src/testing/mock-learning-prisma.ts`**, following
`libs/api/forum/src/testing/mock-forum-prisma.ts` exactly — under `src/testing/`, **excluded
by `tsconfig.lib.json`**, type-checked by `ts-jest` under `tsconfig.spec.json`, and **not
exported from the barrel** (a test double is not part of a lib's public API). It must carry a
working `$transaction` stub, because every write path in this batch uses one and nine
slightly different stubs that disagree is the failure `mock-forum-prisma.ts` exists to
prevent. **The factory's own docblock claim to cover "every model in schema.prisma" was
ALREADY stale before Phase 2** (`Pack`, `MemberGroup`, `Waitlist` are absent) — that remains
worth a follow-up and is not this batch's.

**Validation notes**:

- 🔴 **Both structural specs are VACUOUS on the day they land** — there are no services yet,
  so the real-tree scan finds zero files. Batch 6A hit this and its answer is the right one:
  keep the **probe block** (fabricated sources run through the same `analyze()` /
  `violationsIn()`, asserting each rule fires, that violations are reported exhaustively
  rather than short-circuiting, **and that the legal shapes are NOT flagged**), plus an
  assertion that the loader is pointed at `src/lib` and can see `common/`. That last one
  guards against the failure mode where the scan silently covers nothing **forever** rather
  than only until the first service.
- **`RULE-FILTER` checks for a MENTION of the constant, not an effect** (Batch 6 carried item
  5). An `OR` whose other branches are wider passes while filtering nothing. Carry that
  sentence into the copied docblock — the mitigation is review, and the spec should say so.
- **`RULE-UNIQUE` matters more here than in forum.** `findUnique`'s `where` accepts only
  unique fields, so `findUnique({ where: { id, ...NOT_DELETED } })` **does not compile** — it
  is the one read shape that can look filtered and not be. `Lesson` and `CourseModule` both
  have natural composite uniques (`@@unique([moduleId, slug])`, `@@unique([courseId, slug])`)
  which makes `findUnique` _more_ tempting here than it was in forum. Ban it outright and let
  the message say "use `findFirst`".
- **Shared-registry serialisation**: this task edits `tsconfig.base.json` for the second time
  in the batch.
- **Optional, and called out because Batch 9 already owns the file**: Batch 8's carried item 4
  wants a `@ptah-api/prisma-client` alias pointing at the generated client directory, so
  `prisma/seed/prisma-client.ts` can drop its scoped `eslint-disable`. It is one line in
  `tsconfig.base.json`. **Taking it is fine; skipping it is fine; doing it silently is not** —
  if taken, say so and re-run `ptah-license-server:eslint:lint`.

**Verification**:

```
npx nx reset && npx nx show project api-learning
npx nx run-many -t eslint:lint,typecheck,test -p api-learning --skip-nx-cache
```

Green, with both structural specs passing on their probe blocks.
**Then the deliberate-failure step, and it is required**: create a throwaway
`libs/api/learning/src/lib/courses/tmp-proof.service.ts` containing a real
`lesson.findMany({ where: { moduleId } })`, confirm `soft-delete-filter.spec.ts` **fails and
names the file by path** (which proves the loader, the discovery walk and the analysis on the
**real tree**, not just on fabricated strings — Batch 6A's method note), delete the file, and
confirm green. **Report both runs.** Do the same for `nullable-dto.spec.ts` with a throwaway
DTO carrying `@IsOptional() @IsString() name?: string`.

---

### Task 9.7: Phase-3 wire contracts in `@ptah-contracts/community` ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-course.contract.ts` (NEW)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-lesson-comment.contract.ts` (NEW)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\admin\admin-course.contract.ts` (NEW)
- `D:\projects\ptah-extension\libs\api-contracts\community\src\index.ts` (MODIFY)

**Requirement refs**: §3.4, R2.1.5, R2.3.5, R2.4.2, R2.4.4, R2.5, NFR-S4, RK-8, A-8
**Dependencies**: Task 9.6 (nothing technically — but landing contracts before services keeps
the service written against the wire type rather than the reverse)
**Pattern to follow**: `libs/api-contracts/community/src/lib/member/member-topic.contract.ts`
(Zod schema + `satisfies z.ZodType<T>` per type) and
`libs/api-contracts/community/src/lib/admin/admin-topic.contract.ts` (**types only, no Zod**).

**Implementation details**:

- **Member types carry Zod schemas; admin types do not.** Batch 6A's D-4 established this and
  verified it against `admin-pack.contract.ts` and `admin-session-request.contract.ts` (zero
  `z.` references in either): member schemas exist because **the member panel parses them at
  its HTTP boundary**; `libs/web/admin` carries its own response envelopes. Adding unparsed
  admin schemas would be decoration that drifts — and Batch 7's D-4 is the live proof, where
  a third admin schema was declined precisely because nothing produced the shape.
- **Member** (`member-course.contract.ts`):
  - `MemberCourseSummary` — `{ id, slug, title, description, coverImageUrl|null, completedLessons, totalLessons, percent }`
  - `MemberModuleSummary` — `{ id, slug, title, description|null, sortOrder, locked, lockReason|null, unlocksAt|null, lessons: MemberLessonSummary[] }`
  - `MemberLessonSummary` — `{ id, slug, title, sortOrder, completed, durationSeconds|null }`
  - `MemberCourseDetail` — `{ …summary, modules: MemberModuleSummary[] }`
  - `MemberLessonDetail` — `{ id, slug, title, bodyMarkdown, youtubeVideoId|null, videoTitle|null, videoDurationSeconds|null, videoThumbnailUrl|null, progress: MemberLessonProgress, previous: MemberLessonRef|null, next: MemberLessonRef|null, comments: MemberLessonComment[] }`
  - `MemberLessonProgress` — `{ furthestPositionSeconds, completedAt|null, completionSource: 'auto'|'manual'|null }`
  - `LOCK_REASONS` as a `readonly` tuple + `LockReason` + `isLockReason`, mirroring
    `REACTION_TYPES` / `SEARCH_KINDS`. The two values are `'not_released'` and
    `'previous_module_incomplete'`. **The UI must match on these machine values, never on a
    sentence** — B6C's carried item 5 says exactly this about `{ reason: 'topic_locked' }`.
- 🔴 **`MemberLessonDetail` is the type that carries R2.4.4's redaction, and the type must
  make the redaction EXPRESSIBLE.** When a module is locked the endpoint returns `403`, so
  `MemberLessonDetail` is never the locked shape — **but `MemberModuleSummary.lessons` IS
  returned for a locked module** (R2.4.4: "its title and lesson titles MAY be visible … but
  lesson bodies, comments, and video IDs SHALL NOT be returned"). That is why
  `MemberLessonSummary` carries **no** `bodyMarkdown`, **no** `youtubeVideoId` and **no**
  `comments`: the redaction is enforced by the type having no field to leak, not by a mapper
  remembering to delete one. **Say this in the docblock** — it is the same argument
  `HubTopicSummary` makes for being a distinct type rather than an alias (B6C's D-6.15c: a
  `{ ...row }` spread puts every future field into the narrower response).
- **Member** (`member-lesson-comment.contract.ts`): `MemberLessonComment` —
  `{ id, lessonId, parentId|null, bodyMarkdown, authorName|null, answered, deleted, createdAt, editedAt|null }`.
  **`answered: boolean`, not `reactions`** — A-8: lesson comments get the "Answered" treatment
  **instead of** reactions, matching the `course_learning` screens. There is no
  `REACTION_TYPES` on this type and there must not be.
- **Admin** (`admin-course.contract.ts`): `AdminCourse`, `AdminCourseModule`, `AdminLesson` —
  **re-declared, no `extends`, no import from `member/` in either direction.**
  `AdminLesson` carries `videoMetadataFetchedAt` and `videoMetadataSource`, which no member
  type does: staleness is an authoring concern (§4.5 — so the admin UI can badge rows older
  than N days and offer `refresh-metadata`).
- 🔴 **NFR-S4 / R2.3.7 — no member type may carry another member's progress.** Every progress
  field on every member type is **the caller's own**. There is no `completedBy`, no
  `completionCount`, no `learners`. The composite-PK shape (Task 9.4) makes the query
  inefficient; the contract makes it **unrepresentable**. Assert it: a spec that greps the
  member contract files for `userId` and finds none.

**Validation notes**:

- **`contract-boundary.spec.ts` is already in force** and its `R-CONTAIN` / `R-HERITAGE` rules
  fire on any cross-reference. Batch 6A proved both by deliberate failure. **Repeat that
  proof here**: temporarily add `extends MemberCourseSummary` to `AdminCourse`, confirm both
  rules fire and name the file, revert, confirm green. Report both runs — the spec has never
  been exercised against a `course` file.
- **`z.object()` strips unknown keys.** That asymmetry is what made RISK-C's Phase-1 ordering
  safe and it still holds: a client schema that omits a field tolerates a server that sends
  it; the reverse breaks. **So a required field must reach the server before the client
  schema declares it** — which is why B9 lands before B10 and not beside it.
- Zod is **4.3.6**. Use `z.url()` and `z.iso.datetime()`, not the v3 `.url()` / `.datetime()`
  on `ZodString`.

**Verification**:

```
npx nx run-many -t eslint:lint,typecheck,test -p api-contracts-community --skip-nx-cache
```

Green, `contract-boundary.spec.ts` included, plus the deliberate-failure run above.

---

### Task 9.8: `libs/api/learning/src/lib/common/` — soft delete, visibility, slug, sparse ordering ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\soft-delete.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\visibility.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\visibility.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\slug.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\slug.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\sort-order.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\sort-order.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\optional-field.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\member-context.ts` (NEW)

**Requirement refs**: AD-5, AD-10, OQ-5, R2.1.2, R2.1.3, R2.1.4, R8.8, ASSUMPTION-7
**Dependencies**: Tasks 9.6, 9.7
**Pattern to follow**: `libs/api/forum/src/lib/common/` — file for file. `soft-delete.ts`,
`visibility.ts`, `member-context.ts` and `optional-field.ts` are near-copies; `sort-order.ts`
is new.

**Implementation details**:

- `soft-delete.ts`: `export const NOT_DELETED = { deletedAt: null } as const;` — OQ-5 option
  (a). Carry forum's three reasons for rejecting Prisma middleware (option b): it hides the
  filter from the reader; it forces an admin `?includeDeleted` path to fight it with a bypass
  flag, which is the thing that gets copy-pasted into a member read; **and a structural test
  cannot see an interceptor.**
- `visibility.ts`: `buildCourseVisibilityWhere(ctx: MemberContext): Prisma.CourseWhereInput`
  — the same three-branch `OR` as `buildCategoryVisibilityWhere` (ASSUMPTION-7):
  `visibility: 'member'` · `visibility: 'cohort'` AND `cohortKeys: { hasSome: ctx.cohortKeys }`
  · `visibility: 'staff'` AND `ctx.isAdmin`. **When `ctx.cohortKeys` is empty the cohort
  branch is OMITTED ENTIRELY, not emitted as `hasSome: []`** — the empty-array form happens to
  be correct in Postgres, but that correctness rests on a property a reviewer cannot check by
  reading the file, whereas an absent branch is correct for a visible reason.
  **Also export `buildModuleCourseVisibilityWhere` / `buildLessonCourseVisibilityWhere`**,
  which nest the same clause under `module.course` — Batch 6A added
  `buildTopicCategoryVisibilityWhere` for exactly this reason: without it a lesson read filters
  the lesson and then checks its course separately, which **decides the lesson exists before it
  checks**, reopening the 403/404 gap the file exists to close.
  **`published: true` composes into the same `where` for every member read** (R2.1.2 — a draft
  course is `404`, not `403`), so a draft is invisible by the same mechanism rather than by a
  controller remembering to translate.
- **Why a SECOND implementation rather than sharing forum's.** `buildCategoryVisibilityWhere`
  returns a `Prisma.CategoryWhereInput` — a different generated type — and lives in forum's
  `common/`, which `forum.module.spec.ts` **asserts is not barrel-exported**, with a stated
  reason: `NOT_DELETED` or the where-builder leaving the lib would let a consumer hand-build a
  `where` and read past every visibility clause. Sharing would mean widening that barrel and
  deleting that assertion. **The duplicated thing is ~15 lines of pure branch logic pinned by
  its own spec in each lib.** Put a one-line pointer in each docblock naming the other, so the
  duplication is visible rather than accidental.
- `slug.ts`: `slugify` + `buildSlug` with the same rules as forum's — lowercase,
  non-alphanumeric runs → `-`, **truncate to 80 BEFORE the trailing-hyphen trim** (so a cut
  landing mid-separator cannot leave a dangling `-`), collision suffix from `-2`,
  `FALLBACK_SLUG_STEM = 'lesson'` / `'module'` / `'course'` for a title that normalises to
  nothing. **The result may exceed 80 by the width of the suffix, deliberately** — truncating
  the stem to make room makes two different long titles collide _more_ often. Docblock must
  state, as forum's does, that **this is not a concurrency control**: the `@@unique` decides
  and the create path must catch `P2002` and retry.
- `sort-order.ts`: `SORT_ORDER_STEP = 100` and
  `renumberSparse(ids: readonly string[]): { id: string; sortOrder: number }[]` →
  `100, 200, 300…`. **Sparse so a single later insert does not force a full renumber**
  (R8.8's reason). Also `DETERMINISTIC_ORDER_BY` — the R2.1.4 tie-break, declared **once**:
  `[{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]`. §1.4's comment says ties
  break on `(sortOrder, createdAt, id)`; a second copy of that tuple at a call site is how two
  screens start disagreeing about lesson order.
- `optional-field.ts`: `IsOptionalNotNull()` (a `ValidateIf` gating the whole property) and
  `NullMeansAbsent()` (a `Transform`), copied from
  `libs/api/forum/src/lib/common/optional-field.ts`. **`@ValidateIf`, not a "not null"
  validator** — `@IsOptional()` short-circuits the property _before_ any sibling validator is
  consulted, so a sibling would never run; `@ValidateIf` gates the whole property, so an
  explicit `null` is judged by the `@IsString()` / `@IsInt()` already on the field and the
  refusal **names the property and the expected type**. Whitelisting is unaffected
  (`@ValidateIf` registers its own metadata, so `whitelist: true` does not strip the field).
- `member-context.ts`: `requireMemberContext(req)` — B6C's D-6.12b. **It is a tripwire for a
  removed guard, not a null check**: every visibility decision in the lib derives from
  `req.memberContext`, so "the guard was deleted" must fail loudly rather than resolve
  `undefined`. One shared function, because written per controller the copies drift in the one
  way that is invisible — none of them is reachable in a passing test.

**Validation notes**:

- **`visibility.spec.ts` must assert WHICH COURSES ARE VISIBLE, not what the where-clause
  looks like.** Batch 6A's `visibility.spec.ts` is the model: run the generated clause through
  a ~15-line model of the two Prisma operators actually emitted (`OR`, `hasSome`
  array-overlap) against fixture courses, and assert the resulting visible set. **The model
  THROWS on an operator it does not implement**, so a future third branch breaks the test
  loudly instead of evaluating to `false` and hiding every course from everyone.
- Required cases, all seven: entitled non-admin, zero cohorts → `member` only · with
  `founding` → `member` + that cohort's (incl. multi-key ANY-match) · admin → additionally
  `staff` · **entitled non-admin does NOT see a `staff` course** · being an admin grants no
  cohort content · **a draft course is invisible to everyone including the admin** · the `OR`
  is **never empty** (an empty `OR` matches nothing in Prisma and would make the whole
  curriculum invisible). Plus: the emitted clause omits `hasSome` entirely for a zero-cohort
  member, asserted both structurally and via
  `JSON.stringify(...).not.toContain('hasSome')`.
- **`ctx.cohortKeys` must be COPIED into a mutable array, not aliased** — it is the
  request-scoped `MemberContext`.
- **The three literal visibility values are pinned with `satisfies Visibility`** against
  `@ptah-contracts/community`, so a change to `VISIBILITIES` breaks the compile. The column is
  a Postgres `String`, not an enum, so **nothing at the database layer would catch that
  drift.**
- 🔴 **The live gate this file serves.** The dev account holds
  `DEV-BUILDERS-VALIDATION-0001`, is in `ADMIN_EMAILS`, and has **zero**
  `member_group_assignments`. So a `visibility: 'cohort'` course must be **invisible (404,
  never 403)** to it while a `visibility: 'member'` course is visible — one account proves
  both halves of A-2. B6C proved exactly this live for categories, on the write path as well
  as the read. Task 9.17 repeats it for courses.

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns="visibility|slug|sort-order"
```

Green, all seven visibility cases present.

---

### Task 9.9: Courses, modules and lessons — the write path and the R8.8 bulk reorder ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\courses.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\courses.service.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\reorder.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\reorder.service.spec.ts` (NEW)

**Requirement refs**: R2.1.1, R2.1.2, R2.1.3, R8.1, R8.8, AD-10, AD-15, §3.4, PRE-6
**Dependencies**: Task 9.8
**Pattern to follow**: `libs/api/forum/src/lib/categories/categories.service.ts` for the
admin-write shape and the sanitized-Prisma-error mapping; **`libs/api/forum/src/lib/common/admin-audit.ts`**
for the audit seam (B6C's D-6.13b — one shared writer passing `WriteAuditLogParams.tx`, not
three copies that each forget something different).

**Implementation details**:

- Course / module / lesson CRUD + `PUT :id/published`. **Publish is a separate endpoint from
  update** (§3.4) because publishing is the one write with a member-visible blast radius, and
  a distinct audit action (`learning.course.publish`) is worth more than a `metadata` diff.
- **`cohortKeys` is validated against existing `MemberGroup.key` values on write** — an
  unknown key is a `400`, not a silently unreachable course. `cohortKeys` has **no FK**
  (AD-10), so nothing at the database layer catches a typo, and the admin surface is the only
  place that can. Forum's `CategoriesService` does the same, and B6C's D-6.13g resolves
  `cohortNames` from `MemberGroup` rather than echoing the keys, rendering a missing name as
  `"<key> (unknown group)"` rather than dropping it. **Do the same for `AdminCourse`.**
- **Delete is soft** (`deletedAt`/`deletedBy`), and `deletedBy` **refuses rather than writing a
  placeholder** (B6C's D-6.13i): a soft delete storing `'unknown'` is a deletion with no owner,
  and the audit row cannot repair the column.
- **`onDelete: Cascade` on `CourseModule.course` and `Lesson.module` (§1.4) means a HARD delete
  of a course would take its lessons and every member's progress with it.** There is no hard
  delete in this API and there must not be one. Say so in the service docblock — the cascade is
  a schema-level statement about what _would_ happen, and its absence from the API is the
  control.
- 🔴 **`ReorderService` is R8.8's whole point: ONE request, ONE transaction, a sparse
  renumber.** `PATCH reorder` takes `{ ids: string[] }` — the complete sibling list in the
  desired order — and writes `renumberSparse(ids)` in a single `$transaction`. Three
  properties, each asserted:
  1. **`@@unique([courseId, sortOrder])` is deliberately NOT declared** (§1.4's comment), so
     the `UPDATE`s need no sequencing to dodge transient collisions. A spec asserts the writes
     are issued in one transaction and that their order does not matter.
  2. **The submitted `ids` must be exactly the current sibling set** — no additions, no
     omissions, no foreign parents. A partial list is a `400`, because renumbering a subset
     leaves the others at stale numbers and the resulting order is neither the old one nor the
     new one. Assert the three rejection shapes.
  3. **One audit row per reorder, not one per row** — the intent is "the admin reordered these
     siblings", and twelve rows would make the log useless for the case it exists for (B7's
     bulk-lock decision is the inverse of this and both are right: twelve _independent_
     moderation actions are twelve rows; one reorder is one action).
- **PRE-6, and it is not optional.** Every admin mutation writes its audit row **inside the
  mutation's own `$transaction`, via `tx`** (`AuditLogService.write` accepts
  `WriteAuditLogParams.tx`). B6C asserted this four ways and the fourth is the one that
  matters: the spec drives the **REAL** service over the shared Prisma double, and asserts
  `AuditLogService.write` received `tx` **=== the same client** the `update` was called on —
  not merely "a defined tx" — **and** that the row is written **before** the transaction
  callback returns, **and** that a mutation which threw audits nothing and opens no
  transaction. With a jest-doubled service, "the hook received a `tx`" only asserts that the
  spec called it that way.
- **Audit vocabulary**: add `learning.course.{create,update,delete,publish,reorder}`,
  `learning.module.{create,update,delete,reorder}`,
  `learning.lesson.{create,update,delete,reorder,refresh_metadata}` to `AdminAuditAction`, and
  `Course`, `CourseModule`, `Lesson` to `AdminAuditTargetType`
  (`libs/api/audit/src/lib/audit-log.types.ts`). **B6C rewrote that file's `:35-41` comment
  from "there is no `community.*` action YET" to a description of what is there; do the same
  rather than appending under a stale note.**

**Validation notes**:

- **`NOT_DELETED` on every read in this file**, including the reads that exist only to
  validate a write (the parent-exists check before creating a module). The structural spec
  from Task 9.6 is in force from the moment this file lands — **expect it to fire; that is it
  working.**
- **A Prisma error must not escape raw** (NFR-S7). Map `P2002` (slug collision) to a typed
  `409` and `P2003`/`P2025` to a typed `404`, the way `categories.service.ts:mapPrismaError`
  does.
- **`Lesson.slug` is unique per MODULE, `CourseModule.slug` per COURSE** (§1.4). A slug
  collision resolver scoped to the wrong parent produces a `P2002` the retry cannot clear.

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns="courses.service|reorder.service"
```

Cases: create → publish → member-visible · a draft is absent from every member read · unknown
`cohortKey` → 400 · soft delete removes it from member reads immediately · reorder is **one**
transaction with sparse numbers · a partial `ids` list → 400 · a foreign-parent id → 400 · the
audit row shares the mutation's `tx` (all four PRE-6 assertions) · a throwing mutation audits
nothing.

---

### Task 9.10: `ModuleLockService` — R2.4, evaluated server-side on every lesson read ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\module-lock.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\module-lock.service.spec.ts` (NEW)

**Requirement refs**: R2.4.1–R2.4.5, §3.4, §8.2 P3
**Dependencies**: Task 9.8
**Pattern to follow**: `libs/api/forum/src/lib/common/visibility.spec.ts` for the
"assert the outcome, not the shape" spec technique; the service itself has no forum analogue.

**Implementation details**:

- `evaluate(module, course, completedLessonIds, now): { locked: boolean; reason: LockReason | null; unlocksAt: Date | null }`
  — **a pure function over data already fetched**, not a service that queries. That is what
  lets `CourseReadService` (Task 9.11) evaluate every module in a course without an N+1, and
  it is what makes this spec a table of cases rather than a mock ceremony.
- Two rules, and **only** two:
  1. **R2.4.1 — date.** `releaseAt` in the future ⇒ locked, `reason: 'not_released'`,
     `unlocksAt: releaseAt`.
  2. **R2.4.2 — sequential.** `course.sequential === true` AND the **preceding module in
     `DETERMINISTIC_ORDER_BY`** has at least one lesson the member has not completed ⇒ locked,
     `reason: 'previous_module_incomplete'`, `unlocksAt: null`.
     **R2.4.3: when `sequential === false`, ONLY the date rule applies.** The seeded curriculum
     course is `sequential: false` (§7.3), so the sequential branch has **no live data behind it
     in this workspace** — which is exactly why its spec cases matter more, not less.
- Precedence when both would fire: **date first**, because `unlocksAt` is a fact the UI can
  render and "finish the previous module" is not actionable on a module that has not been
  released. Assert the combined case.
- **The first module of a course is never locked by the sequential rule** — there is no
  preceding module. Assert it; an off-by-one here locks the entire curriculum.
- **An empty preceding module (zero lessons) does not lock the next one.** "Every lesson in
  the preceding module is complete" is vacuously true of an empty module, and the alternative
  is a course an admin can permanently brick by adding an empty module. Assert it and state
  the reasoning in the docblock.

**Validation notes**:

- 🔴 **This is exit-gate clause 1: "a locked module returns 403 from the API, not a CSS
  state."** R2.4.5 says locking SHALL be evaluated server-side **on every lesson read**; a
  module hidden only by CSS is a defect. The service is where the decision lives; **Task 9.15's
  controller is where the `403` is produced** and **Task 9.17 is where it is proved live**.
- 🔴 **403 vs 404 — the distinction, stated so nobody "harmonises" it.** The forum's rule is
  _invisible ⇒ 404, never 403_, because a `403` confirms existence (R1.1.3). **A locked module
  is a different case: it is VISIBLE but FORBIDDEN, which is exactly what 403 is for.** R2.4.4
  says the member _may_ see the module title and its lesson titles — the existence is already
  disclosed, deliberately, so the member can see what is coming. Returning `404` would
  contradict the course detail response the same member just received. **The two rules are
  consistent and they are not in tension:**
  - the course itself is draft, or its visibility/cohort gate excludes the caller ⇒ **404**
    (the where-clause simply does not find it — Task 9.8);
  - the course is visible and the module is locked ⇒ **403 `{ reason: 'not_released' | 'previous_module_incomplete' }`**.
    Write both sentences into the service docblock and put a spec case on each, so a future
    reader who knows the forum rule does not "fix" this one.
- **The `403` body carries the machine `reason` and `unlocksAt`, never a sentence.** B6C's
  `{ reason: 'topic_locked' }` is the precedent and its carried item 5 says the UI must match
  on the value, not the prose. `LOCK_REASONS` (Task 9.7) is the shared vocabulary.

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns=module-lock
```

Cases: future `releaseAt` ⇒ locked/`not_released`/`unlocksAt` · past `releaseAt` ⇒ unlocked ·
`releaseAt === now` ⇒ **unlocked** (boundary; state which way and be consistent with the
forum's `EDIT_WINDOW_MS` closed-boundary convention) · `sequential: false` + incomplete
predecessor ⇒ **unlocked** · `sequential: true` + incomplete predecessor ⇒ locked ·
`sequential: true` + complete predecessor ⇒ unlocked · first module ⇒ never sequential-locked ·
empty predecessor ⇒ does not lock · both rules ⇒ date wins.

---

### Task 9.11: `CourseReadService` — the member read model, prev/next, redaction, query budget ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\course-read.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\course-read.service.spec.ts` (NEW)

**Requirement refs**: R2.1.2, R2.1.4, R2.1.5, R2.3.5, R2.3.6, R2.4.4, NFR-P4, NFR-P6, NFR-S4, §3.4
**Dependencies**: Tasks 9.8, 9.10, 9.13
**Pattern to follow**: `libs/api/forum/src/lib/topics/topics-read.service.ts` — the read model
that owns the projection, the mapper and the query budget in one place.

**Implementation details**:

- `listCourses(ctx)` → `MemberCourseSummary[]`, filtered by
  `buildCourseVisibilityWhere(ctx)` + `published: true` + `NOT_DELETED`, ordered by
  `DETERMINISTIC_ORDER_BY`, each carrying `completedLessons` / `totalLessons` / `percent`.
- `getCourse(ctx, slug)` → `MemberCourseDetail` — modules in `DETERMINISTIC_ORDER_BY`, each
  with `locked` / `lockReason` / `unlocksAt` from `ModuleLockService.evaluate`, each lesson
  with `completed`.
- `getLesson(ctx, slug, lessonSlug)` → `MemberLessonDetail` — body, persisted video metadata,
  the caller's own progress, `previous` / `next`, and comments.
- 🔴 **R2.1.5: `previous`/`next` cross MODULE boundaries.** The lesson's neighbours are its
  neighbours **in course order**, not in module order — the last lesson of module 2 has the
  first lesson of module 3 as its `next`. **Compute them from the flattened, ordered lesson
  list of the whole course**, which the same query already fetches for the outline. Assert the
  three cases that break a module-scoped implementation: last-of-module → first-of-next,
  first-of-course → `previous: null`, last-of-course → `next: null`. **And assert that a
  LOCKED module's lessons are still in the traversal** — R2.4.4 says their titles may be
  visible, so skipping them would make `next` jump a module and the outline and the player
  would disagree about what comes next.
- 🔴 **R2.4.4 redaction happens in the MAPPER, before serialization** (§3.4's own words), not
  in the client and not in a serializer interceptor. `MemberLessonSummary` has no field for a
  body, a video id or comments (Task 9.7), so the redaction is structural for the outline. For
  the **lesson endpoint** the module is either unlocked (full detail) or the controller
  returned `403` — so `MemberLessonDetail` is never a redacted shape. Put a spec on the
  outline asserting that a locked module's lesson objects have **no** `bodyMarkdown`,
  **no** `youtubeVideoId` and **no** `comments` **key at all** — `undefined` is not enough,
  because `JSON.stringify` drops `undefined` but a later `?? null` would not.
- **R2.3.5's percentage is derived from COUNTS, never from seconds** (RISK-O):
  `percent = totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100)`.
  **`totalLessons === 0` must not divide.** A course with no lessons is a real state — an
  admin creates the shell first — and `NaN%` on the member's home screen is the visible
  failure. Assert it.
- **R2.3.6 "resume at the first incomplete lesson in course order"** — computed here, from the
  same flattened list, and returned as part of the course detail. It is the same derivation
  the hub's `learning` section needs (Task 9.17), and **it must have ONE implementation**:
  B6C's D-6.15a refused a second injection for exactly this reason — "a second injection would
  be a duplicate derivation of one number, which is how a card and a feed start disagreeing."
- 🔴 **The query budget (NFR-P4's shape, applied to courses).** A course detail must not be
  N+1 over modules or lessons. Pin the count in a spec the way
  `topics-read.service.spec.ts` pins the feed at five, using the `mock-learning-prisma.ts`
  double, and **write the exact composition into the assertion** — B6C's deviation note
  records that a count with an unstated composition drifts invisibly. Target: **three queries**
  for `getCourse` (course + its modules-with-lessons + the caller's progress rows for those
  lessons) and **three** for `getLesson` (the lesson with its module and course + neighbours
  from the same course tree + comments). If it cannot be done in three, **state the number you
  achieved and its composition** rather than adjusting the requirement.

**Validation notes**:

- 🔴 **NFR-P6 starts here: this file MUST NOT import `@ptah-api/youtube`.** Every video field
  it returns comes from the persisted `Lesson` columns (§4.5 — persistence _is_ the cache).
  Task 9.17 asserts this structurally by name; this task is where it is true or not.
- **NFR-S4 / R2.3.7 — the progress lookup is scoped to `ctx.userId` and nothing else.** There
  is no code path in this file that can read another member's progress, and the composite PK
  (Task 9.4) makes the alternative inefficient as well as absent. Assert that every
  `lessonProgress` call's `where` mentions `userId`.
- **`NOT_DELETED` on every read**, including the nested `include`s. Forum's `RULE-NESTED`
  exists because the top-level scan misses the reads that matter most:
  `_count: { select: { lessons: true } }` counts tombstones and silently inflates
  `totalLessons`, which then deflates every percentage in the product, and **no
  call-expression scan sees it.**

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns=course-read
```

Cases: draft course → not listed and `getCourse` throws the 404-shaped error · cohort course
invisible to a zero-cohort member · prev/next across a module boundary, both ends of the
course, and **through** a locked module · locked module's lessons carry no body/video/comments
key · `totalLessons === 0` → `percent: 0`, no `NaN` · percentage from counts not seconds ·
resume = first incomplete in course order · the query count and its stated composition · no
`@ptah-api/youtube` import.

---

### Task 9.12: `LessonVideoService` — fetch BEFORE the write, and the §4.4 mapping verbatim ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\lessons\lesson-video.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\lessons\lesson-video.service.spec.ts` (NEW)

**Requirement refs**: R2.2.1–R2.2.6, §4.1, §4.4, §4.5, NFR-R1, NFR-R2, NFR-S7, ASSUMPTION-6, ASSUMPTION-9
**Dependencies**: Tasks 9.3, 9.9
**Pattern to follow**: `libs/api/forum/src/lib/topics/topics.service.ts`'s create — the
"one transaction that writes both things, because a partial write leaves a row nothing
downstream can render" idiom (AD-9's topic + post #1).

**Implementation details**:

- `resolveAndPersist(lessonId, input, tx)` — given
  `{ youtubeVideoIdOrUrl?, videoTitle?, videoDurationSeconds? }`:
  1. `extractVideoId(input.youtubeVideoIdOrUrl)` → `null` ⇒ `400 { reason:
'youtube_video_id_invalid' }`. **This is not a §4.4 row and it is not a fetch failure** —
     it is a malformed argument, and conflating it with `not_found` would tell an admin the
     video does not exist when what they pasted was not a video reference at all.
  2. `provider.fetchVideo(id)`.
  3. Map the result to either a full metadata write or a typed HTTP error, per §4.4.
  4. **Write.**
- 🔴 **"Fetch BEFORE the write, inside the transaction boundary — either a fully-configured
  lesson or nothing" (R2.2.4).** The fetch is **awaited before `$transaction` opens**, and the
  transaction then writes the lesson row and every metadata column together. Doing the network
  call _inside_ the transaction would hold a Postgres connection open for up to 10 s per save —
  the AbortController's own budget — which is how a slow upstream becomes a pool exhaustion.
  **State this in the docblock**, because "inside the transaction boundary" reads like
  "inside `$transaction`" and it must not be.
- **The §4.4 outcome → HTTP mapping, verbatim, and this service owns the HTTP half**
  (the provider owns the `error` half — Task 9.3):

  | `YouTubeFetchResult`                         | HTTP                                                              |
  | -------------------------------------------- | ----------------------------------------------------------------- |
  | `{ ok:false, error:'not_found' }`            | `422 { reason: 'youtube_video_not_found' }`                       |
  | `{ ok:false, error:'private' }`              | `422 { reason: 'youtube_video_private' }`                         |
  | `{ ok:false, error:'not_embeddable' }`       | `422 { reason: 'youtube_video_not_embeddable' }`                  |
  | `{ ok:false, error:'malformed_response' }`   | `502 { reason: 'youtube_unavailable' }`                           |
  | `{ ok:false, error:'unavailable', status? }` | `502 { reason: 'youtube_unavailable' }`                           |
  | `{ ok:false, skipped:true }`                 | **NOT an error** — save proceeds, `videoMetadataSource: 'manual'` |
  | `{ ok:true, video }`                         | `200`/`201` with the lesson, `videoMetadataSource: 'api'`         |

  **`422` vs `502` is the load-bearing distinction**: `422` means _your id is wrong, fix it_;
  `502` means _we could not ask, try again_. A single `400` for both would make an admin
  re-check a correct id during a YouTube outage. Assert one case per row, and assert that **no
  row writes a partial lesson**.

- **R2.2.6 / feature-off, and it is the live path here (ASSUMPTION-6).** When
  `provider.isEnabled()` is false the save proceeds, storing the extracted id plus whatever
  `videoTitle` / `videoDurationSeconds` the admin typed, with `videoMetadataSource: 'manual'`
  and `videoMetadataFetchedAt: null`. **Nothing `500`s and every endpoint keeps its stable
  contract.** Assert that the id is still extracted and validated in this branch — a disabled
  integration must not become a hole through which an unvalidated string reaches the column.
- **`refreshMetadata`** — §3.4 gives it two forms, bulk (`POST refresh-metadata` with
  `{ lessonIds: string[] }`) and single (`POST :id/refresh-metadata`). **ASSUMPTION-9**:
  per-lesson atomic, batch-tolerant. Response is
  `{ refreshed: number; skipped: number; failed: { lessonId: string; reason: string }[] }`.
  With the integration off it is `200 { refreshed: 0, skipped: n, reason: 'youtube_disabled' }`
  (§4.1's exact shape). **A single all-or-nothing transaction across N lessons would make one
  deleted video block every other refresh**, which is the opposite of what a maintenance action
  is for. Assert: one bad id among three leaves the other two refreshed.
- **PRE-6**: a metadata write is an admin mutation, so it writes
  `learning.lesson.refresh_metadata` inside its own transaction via `tx`.

**Validation notes**:

- 🔴 **ASSUMPTION-6 governs this task's verification and the report must say so.**
  `YOUTUBE_API_KEY` is **empty** in this workspace, so the enabled branch cannot be exercised
  against the real API. Assert it by **injecting a `YouTubeMetadataProvider` double** that
  returns `{ ok: true, video }` — which proves the transaction boundary, the column writes and
  `videoMetadataSource: 'api'` without a key. **Say in the report that no real YouTube request
  was made**, and name the overrule: put a key in `.env`, then one `V-CURL` `POST
/v1/admin/lessons` with a known unlisted id.
- **This file is the ONLY file in `libs/api/learning` permitted to import
  `@ptah-api/youtube`** (NFR-P6, RISK-P). Task 9.17 asserts that by name. Nothing else — not
  `CourseReadService`, not `ProgressService`, not a DTO — may reference it.
- **NFR-S7**: the typed `reason` values above are the whole client-visible vocabulary. No raw
  upstream text, no `error.message` from Prisma or from `fetch`, reaches the response.
- **`videoMetadataFetchedAt` is set on an `api` write and left alone on a `manual` one.** It is
  the staleness signal §4.5 exists for, and setting it on a manual save would badge a typed
  row as freshly fetched.

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns=lesson-video
```

Cases: one per §4.4 row · a malformed id string → 400, distinct from `not_found` · **every
failure row writes NOTHING** (assert zero recorded write calls on the double) · feature-off
saves with `source: 'manual'` and a still-validated id · enabled save writes all five columns
and `source: 'api'` · bulk refresh with one bad id refreshes the other two · disabled bulk
refresh → `{ refreshed: 0, skipped: n, reason: 'youtube_disabled' }` · the fetch is awaited
**before** `$transaction` opens (assert call order on the double).

---

### Task 9.13: `ProgressService` — monotonic, server-computed completion, and the unit hazard ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\progress\completion.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\progress\completion.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\progress\progress.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\progress\progress.service.spec.ts` (NEW)

**Requirement refs**: R2.3.1–R2.3.7, §4.6, NFR-S4, NFR-P5, RISK-O, ASSUMPTION-8
**Dependencies**: Task 9.8
**Pattern to follow**: 🔴 **`libs/api/forum/src/lib/common/post-numbering.ts` and
`libs/api/forum/src/lib/read-state/unread-units.spec.ts`.** Read both before writing a line.
They are the repo's answer to this exact class of defect and they were written three days ago
at a cost of one extra dispatch.

**Implementation details**:

- 🔴 **RISK-O — three units, one named home.** `completion.ts` is the only file in this lib
  that converts between a **position in seconds**, a **duration in seconds** and a
  **completion verdict**:

  ```ts
  export const COMPLETION_THRESHOLD_RATIO = 0.9; // R2.3.2 "recommended 90%"

  /** SECONDS + SECONDS -> VERDICT. The one place the threshold is applied. */
  export function isAutoComplete(furthestPositionSeconds: number, videoDurationSeconds: number | null): boolean;

  /** SECONDS -> SECONDS. The position at which a lesson auto-completes. */
  export function completionThresholdSeconds(videoDurationSeconds: number): number;
  ```

  **A bare `furthest >= 0.9 * duration` at a call site is rejected**, for the reason B6.1 gave
  about the bare `- 1`: an unexplained arithmetic expression is what the next reader
  "corrects", and it cannot express the inverse direction at all. `completionThresholdSeconds`
  exists so the round trip is stateable as a property —
  `isAutoComplete(completionThresholdSeconds(d), d) === true` — which is what the spec asserts
  instead of two independent expectations.

- 🔴 **The spec's SHAPE is the deliverable, not just its cases.** B6.1's finding was that the
  two existing unread tests _"restated the implementation's arithmetic as the expectation, over
  two independent integers whose units never appear"_ — `10` and `4` are just numbers, and any
  subtraction of them looks as right as any other. **Those tests were not merely blind to the
  defect; they were its accomplices.** Three shape rules, all of them the point:
  1. **One source of truth per case.** The fixture is a `Playback` — a duration and a list of
     observed positions — and **both** the stored value and the expected verdict are derived
     from it. Never `expect(isAutoComplete(90, 100)).toBe(true)`.
  2. **The domain fact is restated independently.** Declare `NINETY_PERCENT = 0.9` **in the
     spec**, not imported from `completion.ts`. Importing it makes the spec inherit the
     assumption it exists to check — a spec that derives its expectation from the
     implementation's constants can only confirm the implementation is self-consistent, which
     is precisely the state F-1 shipped in.
  3. **Cover the WRITE direction too.** `markComplete`/`markIncomplete` (R2.3.3) and the
     auto-completion write are both writes; a read-side-only test cannot see a write that
     stores the wrong unit. B6.1's `markCategoryRead` round trip is the case that **refused**
     the one-line fix.
- **`updateProgress(ctx, lessonId, positionSeconds)`**:
  - **Monotonic**: `furthestPositionSeconds = max(stored, submitted)` (R2.3.1, §4.6.5) — so
    seeking backwards never regresses progress. Implement it as a **conditional write inside
    the statement** where possible, not read-then-compare-then-write: B6C's D-6.13d makes the
    same argument for the restore window — the read-compare-write shape is a TOCTOU gap between
    two snapshots, and here two concurrent players (two tabs) is a real case.
  - **Clamp the submitted value**: negative → `400`; greater than
    `videoDurationSeconds + a small tolerance` → clamp to the duration rather than reject,
    because players report a final position marginally past the end and refusing it would
    prevent the last write from ever completing the lesson. **State the tolerance and why.**
  - **Completion is computed SERVER-SIDE** (§4.6.6). **The client never sends a `completed`
    flag**, and the DTO has no such field — so it is unrepresentable, not merely ignored.
    Assert that `UpdateProgressDto` has exactly one property.
  - Sets `completionSource: 'auto'` when the threshold is crossed.
- **`setCompletion(ctx, lessonId, complete: boolean)`** — R2.3.3: manual, **reversible**,
  regardless of position, `completionSource: 'manual'`. Reversing it clears `completedAt` and
  `completionSource` but **must not reset `furthestPositionSeconds`** — the member's watch
  position is a different fact from their completion claim.
- 🔴 **ASSUMPTION-8 — a lesson with `videoDurationSeconds === null` is MANUAL-ONLY, even if it
  has a `youtubeVideoId`.** R2.3.4 keys on "no video"; §4.6.6 keys on "no
  `videoDurationSeconds`". They differ exactly in the feature-off case (R2.2.6 produces a
  lesson with an id and possibly no duration), and **the duration is the only reading that
  cannot compute a threshold against `null`.** `isAutoComplete(x, null)` returns `false`,
  always. Assert it, and assert that `updateProgress` on such a lesson still **records the
  position** — the position is useful for resume even when it can never auto-complete.
  ⚠️ **The seeded curriculum course has `youtubeVideoId: null` on all 8 lessons** (§7.3), so
  **manual-only is the live path for every lesson in this workspace.** That makes this branch
  the one Batch 10 and Batch 11 actually exercise.
- **NFR-P5 / §4.6.4 throttling is the CLIENT's job** (at most one `PUT` per 15 s), but the
  server carries the `PROGRESS_WRITES` throttle tier — B6C's D-6.12g set it at **60/min**
  because 10/min rate-limits ordinary use. Reuse the same tier name and value.

**Validation notes**:

- 🔴 **NFR-S4 / R2.3.7 — "never exposes another member's progress", enforced by the
  composite-PK shape.** Every read and every write in this file keys on
  `{ userId: ctx.userId, lessonId }`. There is no method that takes a `userId` argument, and a
  spec asserts the service's public methods' signatures contain no `userId` parameter — so the
  guarantee is checkable rather than reviewed. §1.4's rejected `@@index([lessonId])` comment
  makes the same point from the schema side; both should exist.
- **`upsert` on the composite PK is the right write shape here** (unlike the seed's case in
  Batch 8, where `upsert` was rejected because the _branch taken_ was the observable). Here
  nothing observes create-vs-update, and a read-then-insert races two tabs.
- **This file must not import `@ptah-api/youtube`** (NFR-P6). Every duration it reads is the
  persisted column.

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns="completion|progress.service"
```

Cases: the round-trip property `isAutoComplete(completionThresholdSeconds(d), d)` for a table
of durations · `duration: null` ⇒ never auto-complete, **but the position is still stored** ·
seeking backwards does not regress · a position past the end clamps rather than rejects · a
negative position → 400 · manual complete then manual incomplete leaves
`furthestPositionSeconds` untouched · auto then manual-incomplete is honoured (manual wins,
and is reversible) · **`UpdateProgressDto` has exactly one property and no `completed`** ·
no public method takes a `userId`.

---

### Task 9.14: `LessonCommentsService` — one-level nesting, and the reuse-vs-reimplement call ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\comments\lesson-comments.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\comments\lesson-comments.service.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\comments\comment-depth.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\comments\comment-depth.spec.ts` (NEW)

**Requirement refs**: R2.5.1–R2.5.5, R1.3.3 (by reference), A-8, RK-12, AD-5, §3.4
**Dependencies**: Tasks 9.8, 9.10, 9.11
**Pattern to follow**: `libs/api/forum/src/lib/posts/posts.service.ts:244-263`
(`resolveParentId` — the depth repair) and its `posts.service.spec.ts` RK-12 case.

🔴 **THE REUSE-VS-REIMPLEMENT DECISION, made here rather than left to the executor.**

R2.5.2 requires _"one level of nesting under the same rule and the same server-side
enforcement as R1.3"_. Batch 6 implemented R1.3.3 as a **repair, not a rejection**: a
`parentId` naming a post that itself has a non-null `parentId` is **re-pointed to that post's
parent**, so the reply becomes a sibling at depth 2 and the member's writing is saved.
**A `400` here would lose content over an implementation detail the member cannot see** —
that reasoning transfers unchanged.

**Verdict: RE-IMPLEMENT locally in `comment-depth.ts`, do NOT extract and share.** Both are
defensible; here is why this one:

- `resolveParentId` is a **private method** on `PostsService`, and `forum.module.spec.ts`
  asserts by exact array equality that the barrel exports **two services and none of
  `common/`** — with a stated reason (a consumer that can reach `NOT_DELETED` can hand-build a
  `where` and read the forum past every visibility clause). **Extracting means widening that
  barrel and deleting that assertion, for six lines.**
- The two are **not actually the same function**. Forum's is scoped by `topicId` and filters
  `NOT_DELETED` on `Post`; this one is scoped by `lessonId` and filters `LessonComment`. The
  **shared part is three lines of pure decision** — `return parent.parentId ?? parent.id` —
  and the rest is different in both its model and its 404 semantics.
- A third home (`libs/api/core`, or a new lib) for a three-line pure function is scope
  inflation of exactly the kind RK-1 rejects, and AD-6's lib split is already deferred.

**The mitigation for the duplication, and it is not optional**: `comment-depth.ts` exports the
pure decision as a **named function** — `resolveParentForDepthTwo(parent: { id: string;
parentId: string | null }): string` — with a docblock that **names
`libs/api/forum/src/lib/posts/posts.service.ts:244-263` as its sibling** and says the two must
change together. And `comment-depth.spec.ts` carries the **same RK-12 case in the same words**
as `posts.service.spec.ts`, so a grep for the requirement finds both.

**Implementation details**:

- `create(ctx, { lessonId, bodyMarkdown, parentId? })` — R2.5.1: the comment is visible only to
  members who can see that lesson, and **cohort gating and module locking both INHERIT**. So
  the create path calls the same visibility clause (Task 9.8) and the same lock evaluation
  (Task 9.10) the read path does: an invisible lesson is **404**, a locked module is **403
  `{ reason }`**. B6C proved the 404-not-403 posture holds **on the write path as well as the
  read** for categories; assert both here.
- **Depth repair on create**, per the decision above. Assert RK-12's exact case: a `parentId`
  naming a depth-2 comment attaches the new comment at depth 2 as its sibling, and the member's
  body is saved.
- `update` / `delete` — R2.5.4: own comment ⇒ permitted; another member's ⇒ **403 unless
  admin**. **Soft delete** (`deletedAt`/`deletedBy`), and a tombstone renders as a stated
  placeholder rather than an empty body (B7's thread page found that passing `''` to the
  renderer produces a silently blank row).
- `setAnswered(ctx, commentId, answered)` — R2.5.3: **admin OR the lesson author**. ⚠️ `Lesson`
  has **no `authorId` column** in §1.4 — the nearest thing is `Course.createdBy`. **State which
  you used.** The defensible reading is `ctx.isAdmin || comment.lesson.module.course.createdBy
=== ctx.userId`; if `createdBy` is null on the seeded course (it will be — Batch 11 writes no
  author), then admin-only is the live behaviour and that is fine. **Say so rather than
  inventing a `Lesson.authorId`** — a schema change here would need migration 4's slot.
- **R2.5.5: the comment count for display EXCLUDES soft-deleted comments.** This is forum's
  `postCount` hazard in miniature. **Do NOT denormalise a counter** — AD-11 permits exactly one
  denormalised counter in this task (`Topic.postCount`) and nothing else. Count live comments
  in the read query, and let the AD-5 structural spec's `RULE-NESTED` catch a
  `_count: { select: { comments: true } }` that forgets the filter — which is precisely the
  read that silently counts tombstones and that no call-expression scan sees.
- **A-8: no reactions on lesson comments.** `answeredAt`/`answeredBy` instead. There is no
  `REACTION_TYPES` import in this lib and there must not be one.

**Validation notes**:

- **`LessonComment.parent` is `onDelete: Restrict`** (§1.4), the same as `Post.parent`. A hard
  delete of a parent with children is refused by the database; the service only soft-deletes,
  so this never fires — but the constraint is what makes "a child can never be orphaned" true
  rather than conventional.
- **Every read spreads `NOT_DELETED`**, including the nested `children` include.
- **This file must not import `@ptah-api/youtube`** (NFR-P6).

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns="lesson-comments|comment-depth"
```

Cases: depth-3 attempt attaches at depth 2 **and the body is saved** (RK-12, same wording as
`posts.service.spec.ts`) · comment on an invisible lesson → **404** on read **and** on write ·
comment on a locked module → **403 with the machine `reason`** · another member's comment:
edit → 403, delete → 403, admin → permitted · `setAnswered` by a non-admin non-author → 403 ·
tombstone renders a placeholder, not an empty body · **the comment count excludes tombstones**
· no reaction vocabulary anywhere in the lib.

---

### Task 9.15: Controllers and DTOs — five controllers, every payload through `dtoPipe` ⏸️ PENDING

**Files**:

- `…\libs\api\learning\src\lib\courses\member-courses.controller.ts` (+ `.spec.ts`) (NEW)
- `…\libs\api\learning\src\lib\comments\member-lesson-comments.controller.ts` (+ `.spec.ts`) (NEW)
- `…\libs\api\learning\src\lib\courses\admin-courses.controller.ts` (+ `.spec.ts`) (NEW)
- `…\libs\api\learning\src\lib\courses\admin-course-modules.controller.ts` (+ `.spec.ts`) (NEW)
- `…\libs\api\learning\src\lib\courses\admin-lessons.controller.ts` (+ `.spec.ts`) (NEW)
- `…\libs\api\learning\src\lib\courses\dto\{create-course,update-course,create-module,update-module,create-lesson,update-lesson,reorder,refresh-metadata,publish}.dto.ts` (NEW)
- `…\libs\api\learning\src\lib\progress\dto\{update-progress,set-completion}.dto.ts` (NEW)
- `…\libs\api\learning\src\lib\comments\dto\{create-comment,update-comment,set-answered}.dto.ts` (NEW)
- `…\libs\api\learning\src\testing\controller-reflection.ts` (NEW — see below)

**Requirement refs**: §3.4, §3.7, §3.1, R8.1, R8.8, PRE-1, PRE-6, RI-1, RI-2, RI-3, RISK-N
**Dependencies**: Tasks 9.9–9.14
**Pattern to follow**: `libs/api/forum/src/lib/topics/member-community.controller.ts` and
`libs/api/forum/src/lib/topics/admin-community-topics.controller.ts` — guard placement, the
`dtoPipe` binding, the throttle tiers and the audit call shape. And
`libs/api/forum/src/testing/controller-reflection.ts` for the spec helpers.

🔴 **PRE-1 IS THE FIRST THING YOU DO. Read
`D:\projects\ptah-extension\libs\api\core\src\lib\common\dto-validation.pipe.ts` IN FULL
BEFORE WRITING A CONTROLLER, and state in the report that you did.** `main.ts`'s global
`ValidationPipe` is **inert**: `@nx/esbuild` does not implement `emitDecoratorMetadata`, so
`metadata.metatype` is `undefined` and `ValidationPipe.transform` short-circuits on
`if (!metatype || !this.toValidate(metadata)) return value;`. **`dtoPipe(TheDto)` restores
validation by setting `expectedType`, which is applied BEFORE that short-circuit.** The rule
is unconditional: **every whole-object `@Body()` / `@Query()` param must bind
`dtoPipe(TheDto)`; a bare `@Body() dto: X` is SILENTLY UNVALIDATED.** `passthroughDtoPipe` has
exactly one legitimate call site (`AdminRecordsController.update`) and a second must be
rejected in review — do not add one.

**The eight route prefixes, and the RI-1 check already done (RISK-N)**:

```
v1/members/courses           MemberCoursesController        (learning)   ← literal segment 3
v1/members/lesson-comments   MemberLessonCommentsController (learning)   ← literal segment 3
v1/admin/courses             AdminCoursesController         (learning)
v1/admin/course-modules      AdminCourseModulesController   (learning)
v1/admin/lessons             AdminLessonsController         (learning)
```

- **RI-1 passes.** Existing member prefixes are `v1/members/{entitlement,hub,sessions,community,search}`
  and existing admin prefixes are `v1/admin/{licenses,records,stats,users,waitlist,sessions,groups,packs,marketing,community/{categories,topics,posts}}`.
  All are disjoint literal siblings; nothing sits at bare `v1/members`, bare `v1/admin` or
  bare `v1/admin/community`. **RI-1 compares SEGMENT-WISE proper path prefixes**
  (`route-map.spec.ts:511-540`), so `v1/admin/courses` and `v1/admin/course-modules` are
  legal — segment 3 differs.
- 🔴 **DO NOT "simplify" `v1/admin/course-modules` to `v1/admin/courses/modules`.** That WOULD
  nest under `v1/admin/courses` and reproduce **RISK-J exactly** — the shape that broke the
  plan's admin controller layout in Batch 6. `PREFIX_EXCEPTIONS` holds one pre-existing entry
  and `KNOWN_PREFIX_DEBT` is `[]`; **add nothing to either.** If a prefix fails here, split it
  into disjoint literal siblings; do not write an exception.
- **RI-3 — three same-verb unifiable pairs, and the literal must be declared FIRST:**
  `PATCH v1/admin/courses/reorder` before `PATCH v1/admin/courses/:id` ·
  `PATCH v1/admin/course-modules/reorder` before `PATCH .../:id` ·
  `PATCH v1/admin/lessons/reorder` before `PATCH v1/admin/lessons/:id`.
  Reversed, Nest matches `:id === 'reorder'`. B6C made RI-3 non-vacuous for the first time
  with one such pair; this batch adds three. **Assert the ordering locally in each controller
  spec AND assert that the two paths genuinely unify** — otherwise the ordering assertion is
  decoration.
  `POST v1/admin/lessons/refresh-metadata` (bulk) and `POST v1/admin/lessons/:id/refresh-metadata`
  have different segment counts and do **not** unify — but declare the bulk one first anyway,
  for the same reason and at zero cost.

**Implementation details**:

- **Guards at CLASS level.** Member: `@UseGuards(JwtAuthGuard, MemberGuard)`. Admin:
  `@UseGuards(JwtAuthGuard, AdminGuard)` with `AdminGuard`/`AdminThrottlerGuard` **declared
  LOCALLY in `LearningModule`** (the `MemberGroupsModule` acyclicity idiom B6C used), and
  **`MemberGuard` is NOT re-declared** — a second declaration creates a second instance
  resolving entitlement out of a different injector.
- 🔴 **RISK-I / `NAMED_PRIMITIVE_PARAM_COUNT = 6` is EXACT EQUALITY.** Every `@Query()` in this
  batch binds a **whole-object DTO** through `dtoPipe`. **One `@Query('slug') slug: string`
  fails the build.** `@Param()` is not counted by that census, but prefer a DTO wherever a
  query payload exists at all. Count what you add and check the arithmetic closes (Task 9.16).
- **A distinct DTO class per payload shape, never a reused one.** B6C's D-6.12a: reusing
  `ListTopicsQueryDto` for a thread read would make `forbidNonWhitelisted` **accept**
  `?sort=unread` on a request that ignores it — a request that looks honoured and is not. Two
  shapes, two classes. Defaults are applied **outside** the DTO (a `resolve*Query()` helper),
  following 6B's rule.
- **Every optional field uses `IsOptionalNotNull()`** from Task 9.8, and
  `EXPECTED_NULLABLE_OPTIONALS` stays `[]` unless a field genuinely means "null clears this"
  (`Course.coverImageUrl`, `CourseModule.description` and `CourseModule.releaseAt` are the
  three candidates — **each one added is a line a reviewer reads**). B6.1 measured **twelve**
  `@IsOptional()` fields returning `500` on an explicit `null` across five forum DTOs; the
  structural spec from Task 9.6 stops that recurring here, but only if it is used.
- **`@Type(() => Number)` on every numeric query field** — Express hands query values over as
  strings. And the `includeDeleted`-style boolean transform accepts only `true` / `'true'` /
  `'1'`, because `'false'` is a **truthy string** (B6.1's F-3 note).
- **`UpdateProgressDto` has exactly ONE property** (`positionSeconds`). No `completed`, no
  `completionSource`. §4.6.6: the client never sends a completion flag, and the DTO makes it
  unrepresentable rather than ignored.
- **Throttle tiers, reading §3.1 literally** (B6C's D-6.12g, which is cheap to overrule and
  should be stated as such): `CONTENT_CREATION` 10/min on `POST lesson-comments`;
  `PROGRESS_WRITES` **60/min** on `PUT …/progress` and `PUT …/completion` — a member watching a
  lesson emits one write per 15 s **plus** flushes on pause/ended/teardown, and 10/min would
  rate-limit ordinary watching. §3.1 does not name edits or deletes, so those inherit the
  global 100/min.
- **`requireMemberContext(req)`** on every member handler (Task 9.8) — the removed-guard
  tripwire, not a null check.
- **PRE-6 on every admin mutation**: the audit row is written inside the mutation's own
  `$transaction` via `tx`, through the shared writer.
- **`src/testing/controller-reflection.ts`** — B6C's D-6.12c. Hoist the three metadata readers
  the five controller specs share. **The `RequestMethod.GET === 0` trap is why**: a falsy check
  silently drops every `GET` route and leaves a route-table assertion passing against a shorter
  list. Under `src/testing/`, excluded by `tsconfig.lib.json`, not exported from the barrel.
- **Creates COMPOSE through the read model** (B6C's D-6.12d): `POST /v1/admin/courses` →
  `CoursesService.create` → re-read through the admin projection, so a fresh row is
  byte-identical to a re-fetched one and **the slug used is the one the SERVICE allocated** (it
  may have resolved a collision and appended `-2`). Re-deriving a slug in the controller is
  exactly how a stable-URL guarantee breaks.

**Validation notes**:

- 🔴 **A spec bug that silently inverts a test, and it has already happened twice here.**
  (a) `function memberRequest(ctx = CTX)` fires the **default parameter** on an explicitly
  passed `undefined`, so every "guard removed" case is handed the happy-path context and
  asserts the opposite of its name — use a separate `unguardedRequest()`.
  (b) An R7.3 source assertion that greps for `MembershipService` flags the controller's own
  **docblock**, which names it in prose to explain why it is absent — point the assertion at
  **import statements and `@Inject(...)` patterns**, the idiom `admin-guards.spec.ts` G6
  already uses and documents.
- **R7.3**: no controller and no service in this lib injects `MembershipService` or
  `CohortResolver`. `req.memberContext` is read once, by the guard, and passed through. Assert
  it structurally.
- **`403` vs `404`, restated at the controller because this is where it is produced**:
  invisible course or draft ⇒ **404** (the where-clause does not find it); visible course,
  locked module ⇒ **403 `{ reason }`**. See Task 9.10's docblock note.

**Verification**:

```
npx nx test api-learning --skip-nx-cache --testPathPatterns=controller
npx nx test ptah-license-server --skip-nx-cache
```

Green. Per controller: the exact route table read off the metadata · **every payload param
binds `dtoPipe`** (asserted in the lib, so a dropped binding fails where the file lives, with
the handler named — B6C asserted this twice, once here and once in the build gate) · the
class-level guard chain · the RI-3 literal-before-param ordering **and** that the pair unifies
· `UpdateProgressDto` has one property.

---

### Task 9.16: `LearningModule`, the barrel, app wiring, and the three structural registries ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\learning\src\lib\learning.module.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\learning.module.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\learning\src\index.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\api\audit\src\lib\audit-log.types.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-license-server\src\testing\controller-registry.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-guards.spec.ts` (MODIFY)

**Requirement refs**: §2.6, §2.11, §3.7, PRE-2, R7.3, R8.5, RISK-L (by analogy)
**Dependencies**: Task 9.15
**Pattern to follow**: `libs/api/forum/src/lib/forum.module.ts` and
`libs/api/forum/src/lib/forum.module.spec.ts` — the module, and the spec that asserts the
module's own decisions where they are declared.

🔴 **PRE-2 AND THE BARREL: the resolution is KNOWN, do not rediscover it.**
PRE-2 requires every new controller in `controller-registry.ts` **in the same commit**, and
that registry imports controllers **by package name**
(`import { AdminCommunityTopicsController } from '@ptah-api/forum'`). §2.6's "exports:
`CourseReadService` and `ProgressService`" reads like a narrow barrel. **A controller the
barrel hides cannot be registered, and the census assertion — which scans `libs/api/*/src`
from disk — fails the build.** `admin-guards.spec.ts` G1 has the same requirement. Batch 6C
spent a dispatch on this (its C-2) and the resolution is:

> **Export the module, the two services, and the five CONTROLLER CLASSES — and assert the
> SERVICE export surface in the module spec instead of relying on a line count.**

The capability rule the narrow barrel protected is preserved and now **checkable**: a
controller is inert without an instance and **cannot be constructed outside Nest**, because
its constructor dependencies are precisely the services the barrel does not export; its guards
travel with the class as decorator metadata, so a reflective consumer **sees** the chain rather
than bypassing it — which is literally what G1 does. Every other api lib exports its
controllers for the same reason. **The line count was a proxy for the capability rule and it
broke first.**

So `learning.module.spec.ts` asserts, by exact array equality:

- `exports` is **exactly** `[CourseReadService, ProgressService]`;
- **seven named write/authoring services are NOT exported** (`CoursesService`,
  `ReorderService`, `LessonVideoService`, `LessonCommentsService`, `ModuleLockService`, …);
- **none of `common/` is exported** — `NOT_DELETED`, `buildCourseVisibilityWhere`,
  `DETERMINISTIC_ORDER_BY`. Widening it is a **failing test**, not an import.

**Implementation details**:

- `LearningModule` imports `YoutubeModule` (a **normal** import, not `@Optional()` — the
  feature-off posture lives inside the provider, and a missing `YoutubeModule` is a wiring
  mistake that should fail at boot), `PrismaModule`, `AuditModule`, `IdentityModule`. It
  declares `AdminGuard`/`AdminThrottlerGuard` **locally** and does **not** import
  `AdminModule`.
- 🔴 **`NotificationsModule` does NOT exist until Batch 14 (RISK-L).** §2.6 does not list it,
  but §2.7 exists and the temptation is real — R10.1's producers include lesson-comment
  replies. **Omit it, and record the omission in the module docblock with a pointer to Batch
  14 and the reason** (nothing here produces a `Notification` row yet). `learning.module.spec.ts`
  asserts **both** that the module does not import it **and** that the docblock explains why —
  so a future reader cannot see a missing import and "fix" it against a lib that does not
  exist. B6C did exactly this for `ForumModule`.
- **`app.module.ts`**: register `LearningModule` **after `MembershipModule`** (line ~69, R7.3),
  in the same region as `ForumModule` (~107), with a comment saying why the order matters
  relative to `MembershipModule` and why it does not relative to `MemberHubModule`.
  **`YoutubeModule` is NOT registered in `app.module.ts`** — it is imported by
  `LearningModule` (and, in B12, by the community lib). A second registration would create a
  second provider instance and a second `loggedDisabled` flag.
- **`controller-registry.ts`**: five new entries, path-qualified labels, imported by package
  name. `libs/api/learning/src` becomes a scanned root **automatically** — no edit to the
  discovery code, as the registry's own docblock promises.
- **`route-map.spec.ts`**: extend `EXPECTED_ROUTES` (currently **90**) with this batch's
  routes, **then fix the docblock's running total in prose**. B6C's C-4: the total was
  _already_ stale by four before Batch 6 because P1b updated the array and not the prose, and
  the anti-vacuity assertion compares against `EXPECTED_ROUTES.length` so it stayed green.
  **A count in prose is the one thing in that file no assertion can keep honest.**
- 🔴 **`controller-validation.spec.ts`**: **re-derive and RAISE `MIN_TOTAL_PAYLOAD_PARAMS`
  from 51, and justify the number in the docblock** — the way `fd1b4557e` justified lowering
  it and B6C justified raising 37 → 51 with the arithmetic written out per controller. The
  method B6C used and it works: temporarily set the constant to `9999`, run the suite, read
  the actual total out of the failure message, restore, and write the per-controller
  breakdown into the docblock so the arithmetic closes. **Leaving it at 51 makes it
  progressively more vacuous** — that is the whole argument for the floor.
  **`NAMED_PRIMITIVE_PARAM_COUNT` must still be exactly 6.** If the total moves and the named
  count moves with it, the arithmetic will not close and that is the signal.
- **`admin-guards.spec.ts`**: G1 enumerates admin controllers by hand in **two `it.each`
  tables** — add this batch's three to **both**. B6C also added two assertions that are the
  inverse of the deleted G5 (the prefixes are disjoint; the surface genuinely declares
  writes); add the analogues.
- **`audit-log.types.ts`**: the `learning.*` vocabulary from Task 9.9, plus the three target
  types. **Rewrite any "Phase 3 adds …" not-yet framing into a description of what is there**,
  the way B6C did for `community.*`, rather than appending under a stale note.

**Validation notes**:

- **`app.module.spec.ts` boots the real Nest injector.** It is what proves `IdentityModule`,
  the locally-declared guards and `YoutubeModule`'s provider are wired correctly, since no unit
  test exercises the injector. If it goes red, the cause is DI, not logic.
- **Shared-registry serialisation**: this task touches five shared files. **Nothing else may
  be in flight.**
- **Stage path-by-path when this lands.** The working tree carries a concurrent process's WIP
  and it has **staged into the index before** (Batch 8's report warns of 19 foreign staged
  files). `git add -A` would sweep an unrelated half-finished feature into this batch's commit.

**Verification**:

```
npx nx run-many -t eslint:lint,typecheck,test \
  -p api-learning,api-youtube,api-contracts-community,api-audit,api-member-hub,ptah-license-server \
  --skip-nx-cache
```

All green, 0 errors. `ptah-license-server`'s five suites (`route-map`,
`controller-validation`, `admin-guards`, `app.module`, `community-seed`) all pass. Paste the
`MIN_TOTAL_PAYLOAD_PARAMS` derivation (the `9999` failure output plus the per-controller
breakdown) into the report, and confirm `NAMED_PRIMITIVE_PARAM_COUNT` is **still 6**,
`PREFIX_EXCEPTIONS` still **1**, `KNOWN_PREFIX_DEBT` / `UNVALIDATED_DEBT` still `[]`, and
`libs/api/learning`'s `EXPECTED_EXEMPTIONS` / `EXPECTED_NULLABLE_OPTIONALS` still `[]` (or
each entry argued).

---

### Task 9.17: Hub `learning` → `'ok'`, and the NFR-P6 proof ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\learning.section.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\learning.section.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.module.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\empty-sections.section.spec.ts` (MODIFY — see below)
- `D:\projects\ptah-extension\libs\api\learning\src\lib\no-youtube-on-read.spec.ts` (NEW)

**Requirement refs**: R6.1, R6.2, R6.4, R6.6, R2.3.6, NFR-P6, NFR-R3, AD-4, RISK-P
**Dependencies**: Tasks 9.11, 9.13, 9.16
**Pattern to follow**: **`libs/api/member-hub/src/lib/sections/community.section.ts` and
`community.section.spec.ts`** — Task 6.15's result, which moved `'empty'` → `'ok'` with the
envelope unchanged and the composer gaining no line. And
`libs/web/members/src/lib/markdown-chokepoint.spec.ts` for the "importers asserted by name"
idiom the NFR-P6 structural half uses.

**Implementation details — the hub half**:

- `learning.section.ts`'s docblock already says: _"THIS FILE IS THE SEAM, NOT A PLACEHOLDER.
  Batch 9 replaces the body of `resolve` with the two-query lookup from AD-4 … and changes
  NOTHING else — not the envelope, not the composer, not the client."_ **Honour that
  literally.** `member-hub.service.ts` must not gain a line, and the response's two top-level
  keys and five section keys must be byte-identical.
- `MemberHubModule` imports `LearningModule`. **Inject `CourseReadService` ONLY**, not
  `ProgressService` — B6C's D-6.15a is the precedent and the reasoning transfers exactly:
  `MemberCourseSummary` already carries `completedLessons` / `totalLessons` / `percent`
  computed inside `CourseReadService`'s own budget, and **a second injection would be a
  duplicate derivation of one number, which is how a card and a feed start disagreeing.**
  `LearningModule` still exports both, because §2.6 fixes the surface at two and B14's
  notification badge is the obvious second reader.
- `'empty'` vs `'unavailable'` — **keep them distinct, and do NOT catch.** A learning failure
  propagates to `MemberHubService`'s `Promise.allSettled`, which logs it and degrades the
  section to `{ status: 'unavailable', data: null }` inside a `200` (AD-4, R6.4, NFR-R3).
  Catching here and returning `'empty'` reads as defensive and **destroys R6.4's fault
  signal**: the member is told "nothing to continue" on the strength of a query that failed,
  the hub looks healthy, and nothing is logged. **Assert the fault-injection case through the
  REAL composer** — `MemberHubService` constructed with a `CourseReadService` whose method
  rejects — and assert the whole hub still answers with the greeting block and the other four
  sections intact.
- **`empty-sections.section.spec.ts` will need updating**, exactly as B6C's D-6.15c found for
  `CommunitySection`: it constructs the section with no arguments. **Keep it, with an injected
  stub whose lookup genuinely returns nothing, and rewrite the docblock to record that the
  `'empty'` case is now reached THROUGH A QUERY** rather than returned unconditionally — which
  is precisely the transition worth asserting.
- **R6.2**: `listCourses`/the resume lookup is called **exactly once** per hub request, and the
  hub is still **one** request. Assert both.

**Implementation details — the NFR-P6 proof (RISK-P), and this is exit-gate clause 4**:

🔴 **"We didn't call it" passes vacuously when the code path is never exercised. Assert it two
independent ways, and BUILD THE DELIBERATE-FAILURE STEP INTO THE TASK.**

**(a) Structural** — `no-youtube-on-read.spec.ts` walks every `*.ts` under
`libs/api/learning/src/lib/` and asserts:

- the set of files importing `@ptah-api/youtube` is **exactly**
  `['lessons/lesson-video.service.ts']`, asserted **by name** (the
  `markdown-chokepoint.spec.ts` idiom — _"imported by exactly three files, asserted by name,
  so a fourth renderer is a diff rather than a discovery"_);
- **the assertion is not vacuous**: it also asserts the scan saw at least N files and that
  the one known importer really does import it, so a glob that silently matches nothing
  cannot pass (Batch 8's AD-8 grep does exactly this);
- **comments are stripped before scanning.** Half the files in this lib _discuss_ the rule in
  their docblocks — telling the next reader not to import it is exactly the documentation the
  rule wants. Matching raw text would make every warning a violation and the only way to stay
  green would be to delete the warnings. Use `ts.transpileModule({ removeComments: true })`,
  **not a regexp**: a regexp cannot tell `//` inside a URL from a line comment, and truncating
  at `https://` would create a place a needle could hide. B7's Task 7.9 hit exactly this and
  its solution is the one to copy.

**(b) Behavioural** — drive the **real** member read path
(`CourseReadService.getLesson`) against a `YouTubeMetadataProvider` double whose `fetchVideo`
**throws**, over a lesson that **has** a `youtubeVideoId` and full persisted metadata. The
read must return that metadata from the persisted columns and the double must record **zero**
calls. **The "has a video and full metadata" part is what stops it being vacuous** — a lesson
with `youtubeVideoId: null` proves nothing, and ⚠️ **every seeded lesson in this workspace has
exactly that** (§7.3), so the fixture must be constructed deliberately.

**(c) The deliberate-failure step, which is part of the task and not optional.** Temporarily
add a `this.youtube.fetchVideo(lesson.youtubeVideoId)` call to `CourseReadService.getLesson`.
**Both halves must fail** — the structural spec naming `courses/course-read.service.ts` as an
unexpected importer, and the behavioural spec on the throwing double. Revert, confirm green,
and **paste both the failing and the reverted-green runs into the report.** _A spec never seen
to fail is not evidence_ — Batch 6's carried item 2 and Batch 8's Finding 6 are both this
failure, and Batch 8's was found only because someone tried to make the test fail.

**Validation notes**:

- **The card DROPS fields rather than spreading.** B6C's rule: assert the `ContinueLearning`
  keys **exactly**, and assert that the fields `MemberCourseSummary` carries but the hub does
  not are **absent** from the serialized output. A `{ ...row }` would put every one of them
  into the hub the moment the summary type grows a field.
- **`ForumModule`'s precedent for a NORMAL (non-`@Optional()`) import applies to
  `LearningModule` too** — unlike `SessionsService`, which is genuinely feature-flagged behind
  `GOOGLE_OAUTH_*`, learning is unconditionally part of the product.

**Verification**:

```
npx nx run-many -t eslint:lint,typecheck,test -p api-member-hub,api-learning --skip-nx-cache
```

Green, plus the deliberate-failure pair. **Then the live checks** — mint a token per `V-TOKEN`
(headless path: sign the documented `JWTPayload` with `JWT_SECRET` from the workspace-root
`.env` for the dev user's real `users.id`, short expiry, **delete the token file afterwards**)
and run, **with `-b` and not `-H`** (`V-CURL`, corrected — `JwtAuthGuard` reads
`request.cookies['ptah_auth']` and never looks at the `Authorization` header):

```
curl -s -b "ptah_auth=$TOKEN" http://localhost:3000/api/v1/members/hub | jq '.sections.learning'
curl -s -b "ptah_auth=$TOKEN" http://localhost:3000/api/v1/members/courses | jq
curl -s -o /dev/null -w '%{http_code}\n' -b "ptah_auth=$TOKEN" \
  "http://localhost:3000/api/v1/members/courses/<draft-slug>"          # expect 404
curl -s -b "ptah_auth=$TOKEN" \
  "http://localhost:3000/api/v1/members/courses/<slug>/lessons/<locked-lesson>" | jq
```

Expected and **required in the report**: the hub's envelope is unchanged (two top-level keys,
five section keys) and `learning` reports `'ok'` or `'empty'` — never `'unavailable'` ·
a **draft** course is `404` · a **cohort** course is invisible (`404`, never `403`) to this
zero-cohort admin account while a **member** course is visible, and a **staff** course IS
visible to it (ASSUMPTION-7, the same one-account proof B6C ran for categories) ·
🔴 **a lesson in a locked module returns `403` with a machine `reason`, not a `404` and not a
`200` with a redacted body** — this is exit-gate clause 1 and it must be a pasted HTTP status.

**Clean up every probe row afterwards, by id, and say so.** Batch 6C, 6.1 and 7 all did; the
committed seed must read `categories=4 topics=9 posts=10` and the new tables must return to
their pre-check state. **Do not delete audit rows** written by mutations that really happened
— B6C's rule — but **do** delete rows referring to scratch entities that no longer exist,
which is B6.1's refinement of it.

---

**Batch 9 Verification (exit gate)**:

```
npx nx run-many -t eslint:lint,typecheck,test \
  -p api-youtube,api-learning,api-contracts-community,api-member-hub,api-audit,ptah-license-server \
  --skip-nx-cache
```

- 0 errors. Both new libs resolve, lint clean, and `nx graph` shows **no cycle**
  (`api-learning → api-youtube` one way; `api-member-hub → api-learning` one way).
- **Migration 3 applied** against the running `ptah_db`; five course tables present; the
  lesson-title trigram index present **with `gin_trgm_ops`** in `indexdef`; the dev
  entitlement and the Batch-8 seed intact.
- `route-map` (RI-1/RI-2/RI-3), `controller-validation`, `admin-guards` G1 and
  `app.module.spec` all green. **`NAMED_PRIMITIVE_PARAM_COUNT` still exactly 6.**
  `MIN_TOTAL_PAYLOAD_PARAMS` raised with the arithmetic in the docblock.
  `PREFIX_EXCEPTIONS` still 1 entry; `KNOWN_PREFIX_DEBT` and `UNVALIDATED_DEBT` still `[]`.
- **Both new lib-local structural specs green AND each proven to fail** (Task 9.6), with both
  runs in the report.
- **§8.2 P3 backend, all four clauses, each with pasted evidence**: a locked module returns
  **403** live · completion derives from persisted duration · with `YOUTUBE_API_KEY` unset
  nothing `500`s and an admin can save manual metadata · **no YouTube request fires on a member
  lesson read**, asserted two ways and **proven by deliberate failure**.
- The report states plainly, per ASSUMPTION-6, that **no real YouTube request was made** and
  names the one-line way to overrule it.

---

## Batch 10: P3-FE — course screens + the facade-then-player ⏸️ PENDING

**Recommended Executor**: `frontend-developer` | **Fallback**: `frontend-developer`
**Execution Mode**: sequential — one dispatch, unless the executor asks for a split, in which
case the seam is **10.1–10.5 (primitives, service, the embed chokepoint, the player, the
store) then 10.6–10.11 (pages, routes, the proofs)**.
**Rationale**: The courses list, course detail and lesson page share one view model and one
API service, and **the player, the store and the embed-URL chokepoint are a single security
and correctness design** — the facade only stays a facade if the store never constructs the
iframe early. Splitting them across dispatches is how the poster ends up loading the API.

🔴 **Execution Mode is SEQUENTIAL AFTER B9, NOT parallel with it.** The coarse plan said
"parallel (w/ B11)" and §8.1 says frontend ↮ backend within a phase is not a blocker. **That
is true in principle and wrong here**, for two reasons this refine pass can name:

1. **`z.object()` strips unknown keys but does not invent them.** A client schema that omits a
   field tolerates a server that sends it; **the reverse breaks.** So every required field must
   reach the server before the client schema declares it — which is RISK-C's asymmetry, and it
   is why B4 preceded B5 and why B10 must follow B9.
2. **B7's three findings all came from driving the real API**, and none was visible from inside
   the backend's own tests. Building B10 against a stub would defer that discovery to the e2e
   run instead of surfacing it in Task 10.2. **RISK-T.**

**Dependencies**: Batch 4 (the shell, `MEMBER_ROUTES`, the `'member'` markdown preset, the
Task 4.7 lint rule), **Batch 9 (all of it — contracts, endpoints and the live server)**.
**Preconditions**: PRE-3 (**read the BARREL, not PRE-3's number — see below**), PRE-4, PRE-7.
**Tasks**: 11 (refined at the Phase-2/Phase-3 boundary, 2026-08-05)

**Scope boundary**: no playlist, no autoplay-next, no playback-speed persistence, no captions
UI, no download, no offline. **No second markdown renderer and no second sanitizer** (NFR-S2).
No pixel baselines — B7 and B7.1 both declined them with the reason _"a baseline for a surface
this new encodes today's layout as a requirement"_, and the **full axe pass is Batch 15's**
(§8.2 P5). This batch does a **targeted** a11y pass on the player only (NFR-U4).

**Exit gate (§8.2 P3, frontend half)** — four clauses, each with a named owner task:

1. **The 8 week threads render as an ordered course** (Task 10.6/10.7, against Batch 11's seed
   — see the ordering note in Preconditions below).
2. 🔴 **No `youtube.com` / `youtube-nocookie.com` / `ytimg.com` request until the poster is
   activated** — a **Playwright network assertion** (Task 10.11, NFR-S3).
3. **axe pass on the player** (Task 10.11, NFR-U4) — and keyboard operability without a mouse.
4. **Both themes clean** (Task 10.11, NFR-U5) — `operator-member` **and**
   `operator-member-light`.

Plus: the `libs/web/members` markdown chokepoint spec still green **and re-proven to fail**
naming a new Phase-3 file · the **new** embed chokepoint spec green and proven to fail ·
the Batch-4 one-request hub assertion still passing, unchanged (R6.6).

**File set** (for the serialisation claim): `libs/web/members/**`, `libs/web/panel-ui/**`,
`apps/ptah-landing-page-e2e/**`.
🔴 **Shared-registry touchpoints: `libs/web/panel-ui/src/index.ts` ONLY** (Task 10.1). This
batch touches **no** `tsconfig.base.json`, **no** `nx.json`, **no** `eslint.config.mjs`, **no**
`app.module.ts`, **no** `route-map.spec.ts` and **no** `controller-registry.ts`.
**Batch 11's set is `apps/ptah-license-server/prisma/**` and nothing else — disjoint,
including every shared-registry file. B10 ↮ B11 is genuinely parallel** (this is the same
claim B7/B8 made and it held).
⚠️ **One caveat that decides the order if you run them together**: B10's exit-gate clause 1
("the 8 week threads render as an ordered course") **needs Batch 11's seed to exist**. If B10
and B11 run concurrently, B10's unit and component specs are unaffected but its **e2e and
browser checks must run after B11 lands\*\*. Either sequence B11 first, or let B10 seed its own
throwaway course through the admin API and clean it up by id (which B7 did for community and
is a proven pattern).

---

### Carried in from Batch 7 / Batch 7.1 — read before starting

- **PRE-3's literal "nine symbols / 8 export lines" IS STALE and the barrel says so.**
  `libs/web/panel-ui/src/index.ts` now carries a header docblock reading
  **"10 EXPORT LINES / 11 SYMBOLS. THIS COMMENT IS THE AUTHORITATIVE COUNT."**, names all
  eleven, and states that later batches read **this file**, not the precondition (RISK-M).
  Task 10.1 takes it to **11 lines / 12 symbols** and **updates that header in the same
  edit**.
- **The §5.3 promotion rule cuts both ways.** A primitive earns a place in `panel-ui` when a
  **SECOND panel ACTUALLY RENDERS IT** — not when it looks reusable. `ThreadRow` and `TagChip`
  qualified only because Task 7.10 gave them a real admin consumer **in the same batch**, and
  `community-moderation.spec.ts` carries an explicit assertion naming that dependency so the
  promotion dies with the consumer. **Task 10.1 must clear the same bar or keep
  `ProgressMeter` private.**
- **`MemberGuard` and `MemberSessionStore` live in `@ptah-web/core`**, not in
  `@ptah-web/members`. `MEMBER_ROUTES` declares **no** guard and must not regain one —
  `members.routes.spec.ts` fails if a guard reappears anywhere in the subtree, and a second
  declaration runs the entitlement probe twice per navigation.
- **`libs/web/members/src/index.ts` exports `MEMBER_ROUTES` and nothing else.** Widening the
  barrel is never the fix for a boundary error.
- **`MemberSessionStore` carries `entitled`, `isAdmin` and `cohorts` — and NO user id.** That
  is what made B7's F-3 unworkable client-side. **Progress is per-member and the server knows
  who is asking**; do not look for an id to send.
- 🔴 **`withComponentInputBinding()` is STILL NOT INSTALLED** (B7 F-4, re-confirmed by B7.1
  F-13). `apps/ptah-landing-page/src/app/app.config.ts` calls
  `provideRouter(routes, withInMemoryScrolling(...))`. **Task 10.7's lesson page takes TWO
  route params (`:slug`, `:lessonSlug`) and is the second consumer that wants it.** See Task
  10.7 for the decision.
- **`libs/web/members/jest.config.cts` already carries `marked|ngx-markdown` in
  `transformIgnorePatterns`**, and the community specs use the **real**
  `provideMarkdownRendering({ extensions: 'member' })` rather than mocking the renderer.
  Follow that — mocking it leaves NFR-S2's chokepoint claim asserted only against source text.
- **`ngx-markdown` parses in a promise**, so rendered body text arrives a microtask after
  `detectChanges()`. Asserting on `textContent` makes each case a timing test of a third-party
  library. **Read the bound `content` input of each `<ptah-markdown-block>` via
  `By.directive(MarkdownBlockComponent)`** — which is also the more precise question: _which
  text reaches the one sanitizer._ (B7's Task 7.5 technique note.)
- **Neither community composer imports `FormsModule`**, deliberately: `ngModel` writes its
  value back through a microtask, so a keystroke and the derived `canSubmit()` are one tick
  apart — invisible in a browser and it made every spec race. Consequences, both of which cost
  B7 time: `(submit)` must be the **native** event, not `(ngSubmit)` (which without
  `FormsModule` binds a listener for a DOM event that never fires, silently breaking
  Enter-to-submit), and `maxlength` must be `[attr.maxlength]`, not `[maxlength]` (a
  `FormsModule` directive input — it fails with `NG0303`).
- **A `<select>` must drive its choice through `[selected]` per option, not `[value]` on the
  select**, when the options come from an `@for` in the same change-detection pass — a select
  whose value is bound before its options exist silently resets to the first one.
- **A backtick inside an HTML comment in an inline template** terminates the template literal
  and produces `SyntaxError: Invalid shorthand property initializer` pointing at the
  _importing spec's_ line 1. It names neither the file nor the cause (B7 F-8).
- **The two cosmetic theme defects are carried to Batch 15**: the light-mode right-edge gutter
  stays dark, and the secondary nav at `text-base-content/60` needs contrast **measuring**.
  **Do not fix them here; do not make them worse.**
- **B7's five pre-existing e2e failures are NOT yours** (`admin-crud.spec.ts:16`,
  `admin-founding-invites.spec.ts:28,65`, `auth.spec.ts:65`, `pricing-waitlist.spec.ts:22`).
  They were byte-identical across B7 and B7.1. **Do not weaken those assertions**; report the
  same five and move on.
- **The `403 { reason: … }` machine value is what the UI matches on, never the sentence.**
  Locked modules use `LOCK_REASONS` (Task 9.7). `404` covers absent **and** invisible
  indistinguishably (R1.1.3) and its copy must contain none of "not allowed" / "forbidden" /
  "permission" — B7's thread page has a spec asserting exactly that and it is the right
  pattern to copy.

---

### Task 10.1: Promote `ProgressMeter` into `@ptah-web/panel-ui` — or keep it private ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\progress-meter\progress-meter.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\progress-meter\progress-meter.html` (NEW)
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\progress-meter\progress-meter.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\panel-ui\src\index.ts` (MODIFY — **header count too**)

**Requirement refs**: §5.3, R2.3.5, R9.7, NFR-U1, NFR-U2, NFR-U3, PRE-3, RISK-M
**Dependencies**: none within the batch
**Pattern to follow**: `libs/web/panel-ui/src/lib/status-badge/status-badge.ts` — standalone,
`OnPush`, `input()` signals, **zero injected services**, `templateUrl`.

**Implementation details**:

- `ProgressMeter`: `input({ completed: number, total: number, label?: string })`. **It
  computes the percentage from the two counts** rather than taking a `percent` input, so a
  caller cannot pass a percentage derived some other way — RISK-O's frontend shape.
  `total === 0` renders `0%` and **must not divide**.
- `templateUrl` + `.html`, not an inline template: **all six pre-existing `panel-ui`
  primitives use it**, and B7's D-1 established that "pattern to follow: `status-badge.ts`" is
  the stronger instruction than a file count. Three files, not two.
- **Barrel**: add one `export *` line, taking it to **11 lines / 12 symbols**, and **update the
  header docblock's numbers in the SAME edit** — that header is now the one authoritative
  count (RISK-M) and a stale number there is worse than no number.

**Validation notes**:

- 🔴 **§5.3's bar: "a primitive earns a place when a SECOND panel actually renders it."**
  `ProgressMeter` has **one** consumer in this batch (the member course list/detail). §5.3
  names it as a promotion candidate, but §5.3 also states the rule that governs, and B7's
  Task 7.1 was legitimate **only because Task 7.10 shipped an admin consumer in the same
  batch**. **There is no admin course surface in this task's plan** — §3.4's admin endpoints
  exist, but no `libs/web/admin` screen is specified for Phase 3.
  **Decision, and it is a real fork the executor must resolve rather than assume:**
  - **If a second consumer exists or is added in this batch** (the obvious candidate is an
    admin course-authoring screen, which is **NOT in scope** — RK-1), promote it, and add an
    assertion in the second consumer's spec **naming the dependency**, so the promotion dies
    with the consumer (B7's `community-moderation.spec.ts` does exactly this).
  - **Otherwise KEEP IT PRIVATE** at
    `libs/web/members/src/lib/community/../learning/components/progress-meter.ts`, exactly as
    `ReactionBar`, `UnreadPill` and the two composers stayed private, and **say in the report
    that §5.3's bar was not met** — which is the honest outcome and costs one file move later.
    **Recommended: keep it private.** §5.3's own rule is the tie-breaker, `panel-ui` already
    grew by two this phase, and a speculative extraction is the thing §5.3 exists to prevent.
    If it stays private, this task's `panel-ui` files and the barrel edit **do not happen**, and
    **Batch 10 then touches NO shared-registry file at all** — which strengthens the B10 ↮ B11
    parallelism claim.
- **NFR-U2 is NOT lint-enforced in `libs/web/panel-ui`** — the Task 4.7 rule is scoped to
  `libs/web/members/**`. If this lands in `panel-ui`, **check by hand and say in the report
  that you did**, scanning for raw hex, the `ink-*` and `amber-*` ramps, every Material-3
  token name, and **`border-base-300`** (`base-300` is a **fill and never a border**). B7 did
  this and additionally put a spec assertion on `border-base-300`'s absence from the rendered
  markup — copy that.
- **NFR-U3**: the label and the percentage are load-bearing text and must be
  `text-base-content/60` or stronger. `/40` measures 3.18:1 and fails WCAG AA for body text.
- **a11y**: `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax` and
  an `aria-label` that says **what** is progressing ("3 of 8 lessons complete"), not just a
  number. B7's `UnreadPill` lesson: a naive `noun + 's'` shipped "3 unread replys" until a
  spec caught it — use a `Record` over a union, not string concatenation.

**Verification**:

```
npx nx test web-panel-ui --skip-nx-cache        # if promoted
npx nx lint web-panel-ui --skip-nx-cache
npx nx typecheck web-members web-admin --skip-nx-cache
```

Green. If promoted: the barrel reads 11 lines and its header records the new count. If kept
private: the report says §5.3's bar was not met and names the file's private location.

---

### Task 10.2: `MemberLearningApiService` — and REPORT what it finds, do not work around it ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-learning-api.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-learning-api.service.spec.ts` (NEW)

**Requirement refs**: §3.4, R2.3.7, R7.7, NFR-S1, NFR-P5, RISK-T
**Dependencies**: Batch 9 Task 9.7 (the contracts)
**Pattern to follow**: `libs/web/members/src/lib/services/member-community-api.service.ts` —
one method per §3.4 endpoint, each parsing its response with the schema **exported by
`@ptah-contracts/community`**, through the shared
`libs/web/core/src/lib/services/validate-response.ts` `validate()`.

**Implementation details**:

- One method per §3.4 row: `listCourses`, `getCourse(slug)`,
  `getLesson(slug, lessonSlug)`, `putProgress(slug, lessonSlug, positionSeconds)`,
  `putCompletion(slug, lessonSlug, complete)`, plus the four lesson-comment methods.
- **Never re-declare a wire shape.** A second copy of the type on the client is exactly the
  drift the contracts lib exists to remove. The only locally declared schemas are small
  acknowledgement envelopes the contracts lib does not model — B7 did the same and listed
  them explicitly in its report.
- **`isMembershipRequiredError()` already exists** in
  `libs/web/core/src/lib/services/members-api.service.ts` and parses the server's
  `403 { reason: 'membership_required' }`. **Reuse it; do not re-implement it and do not
  re-export it** (a re-export gives one symbol two import paths — B7's decision). Two spec
  cases: a `membership_required` 403 is recognised, and a **`403 { reason: 'not_released' }`
  is NOT** — conflating them would bounce a member to `/pricing` for opening a module that
  unlocks next week.
- **A locked-module `403` is a first-class, expected outcome, not an error.** Surface it as a
  typed result the lesson page can render (`{ locked: true, reason, unlocksAt }`), not as a
  thrown `HttpErrorResponse` the page has to catch and re-interpret.
- **NFR-P5 / paging**: B7 resolved the apparent conflict between "the service should not be
  able to express `pageSize > 50`" and B6C's "do not re-implement server caps client-side" by
  **scope**, and the same resolution applies: `page`/`pageSize` are **never member input** on
  these surfaces — they are constants the calling page chooses — so an out-of-range value is a
  **programmer error** and `pageParams()` throws a `RangeError` before any request is made,
  one frame from the cause instead of an opaque 400 in the network tab. **A clamp was
  rejected**: the server rejects rather than clamps precisely so a caller asking for 500 rows
  does not believe it received them all.
- 🔴 **`putProgress` sends exactly `{ positionSeconds }` and NOTHING else.** No `completed`,
  no `completionSource`, no `duration`. **§4.6.6: completion is computed server-side and the
  client never sends a flag.** Put a spec on the wire body asserting its keys are exactly
  `['positionSeconds']` — B7's `thread-page.spec.ts` asserts the wire body has no `parentId`
  key for the same class of reason and it caught a real defect.

**Validation notes**:

- 🔴 **RISK-T — this task is where B9's defects will surface, and the instruction is B7's:
  REPORT, DO NOT WORK AROUND.** B7 found an off-by-one, a `500` on an explicit `null`, and a
  missing filter — **none visible from inside the backend's own tests** — and because it
  reported them rather than compensating, the fixes were a four-site unit repair and a
  `mine=true` boolean rather than a one-line patch that would have broken a write path and an
  `authorId=` enumeration hole. **If a response does not match its contract, or an endpoint
  500s, or a needed parameter does not exist: stop, measure it (SQL alongside the API
  response, the way B7's F-1 table did), and return it as a finding.** A `test.fail()` carrying
  the measurement is the right artefact when the gate clause cannot be met — it keeps the suite
  green today and turns **red the day the server is fixed**, which is exactly when someone must
  come back.
- **`z.object()` strips unknown keys** — a well-formed response parses, a response **missing a
  required field THROWS** (which proves the parse is live rather than decorative), and an
  unknown extra field is **stripped rather than rejected**. All three are spec cases B7 wrote
  and they should exist here too.
- **These services are pure data access**: no signals, no state, no routing. State lives in
  the pages and in `CoursePlayerStore`.
- **Live development against `http://localhost:3000` is encouraged** — but **use a cookie, not
  a Bearer header** (`V-CURL`, corrected).

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=member-learning-api
```

Cases per method: a well-formed response parses · a missing required field throws · an extra
field is stripped · a `403 membership_required` is recognised by the shared helper and a
`403 not_released` is not · **`putProgress`'s wire body has exactly one key** · a `pageSize`
over the cap throws a `RangeError` before any request.

---

### Task 10.3: `youtube-embed-url.ts` — the workspace's FIRST trusted-URL construction ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-embed-url.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-embed-url.spec.ts` (NEW)

**Requirement refs**: NFR-S3, §4.6.3, R2.2.7, RISK-S
**Dependencies**: none within the batch
**Pattern to follow**: `libs/web/members/src/lib/shared/highlight-text.pipe.ts` — B7's
"returns data, never an HTML string" design, whose docblock states the concrete XSS it
forecloses and why the offsets-not-markup shape exists at all. **There is no
`bypassSecurityTrustResourceUrl` precedent in this repository to copy** (RISK-S: verified by
`rg` across `libs` and `apps` — zero hits). This file is the first.

🔴 **THIS IS A SECURITY CHOKEPOINT OF THE SAME KIND AS THE MARKDOWN ONE, AND IT IS ISOLATED
FOR THAT REASON.** `bypassSecurityTrustResourceUrl` disables Angular's URL sanitizer for the
value it is given. The only thing standing between a persisted database string and an
attacker-controlled iframe origin is the validation that runs immediately before it. Putting
that validation inline in a component means the next component copies the call and not the
check.

**Implementation details**:

- **One exported pure function, no Angular dependency:**

  ```ts
  /** The canonical 11-char YouTube id shape. Imported from @ptah-api/youtube's
   *  VIDEO_ID_PATTERN?  NO — see the validation note. Declared here. */
  export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

  export function buildYoutubeEmbedUrl(videoId: string): string | null;
  ```

  Returns `null` — **never throws, never returns a partial URL** — for anything the regex
  rejects. The caller renders the poster with no player rather than an iframe pointed at
  something unvalidated.

- **The id is the ONLY interpolated value** (§4.6.3). Host and params are literals:
  `https://www.youtube-nocookie.com/embed/<id>?rel=0&modestbranding=1&enablejsapi=1`.
  **`youtube-nocookie.com`, not `youtube.com`** (NFR-S3, R2.2.7).
- **`bypassSecurityTrustResourceUrl` is NOT called in this file.** This file returns a
  `string`; **Task 10.4's component is the single place that calls the bypass**, and it calls
  it **only** on a non-`null` return from here. That split is what lets this function be
  tested without a `TestBed` and lets Task 10.11's chokepoint spec assert "exactly one call
  site, by name".
- **The regex is anchored at both ends and the length is exact.** `/^[A-Za-z0-9_-]{11}$/` —
  not `{11,}`, not unanchored. An unanchored or open-ended pattern accepts
  `abcdefghijk"></iframe><script>` and the anchoring is the entire control.

**Validation notes**:

- 🔴 **Declare the pattern HERE rather than importing `VIDEO_ID_PATTERN` from
  `@ptah-api/youtube`** — and this is deliberate, not an oversight. `libs/web/*` is
  `scope:web`, which **may** depend on `scope:api-contracts` but **not** on `scope:api`
  (`eslint.config.mjs:103-112`), so the backend constant is **not reachable** from here at all;
  the import would be a boundary error. The two copies must agree, so:
  **put the pattern's source-of-truth statement in both docblocks, naming each other**, and
  have Task 10.11's spec assert the literal pattern text matches the one in
  `libs/api/youtube/src/lib/extract-video-id.ts` by reading both files. That turns a
  convention into an assertion. _(If a shared home is wanted, the only legal one is
  `@ptah-contracts/community` — which is a defensible follow-up and is **not** this batch's.)_
- **The spec must prove the validation cannot be bypassed**, not merely that it works. Required
  hostile cases, each a real shape:
  - `abcdefghijk` → a valid URL (the control — without this the rest proves nothing);
  - 10 chars, 12 chars → `null`;
  - `abcdefghij/` and `abcdefghij+` → `null` (base64 confusion — `/` and `+` are the two
    characters that distinguish base64 from base64url, and they are the realistic wrong input);
  - `abcdefghij?` , `abcdefghij#`, `abcdefghij&` → `null` (query/fragment injection);
  - `../../evil` → `null` (path traversal into a different host path);
  - a string containing `"`, `<`, `>`, a newline, or a NUL → `null`;
  - `javascript:alert(1)` and `data:text/html,…` → `null`;
  - **a valid id with a trailing newline** → `null` — this is the one that catches an
    unanchored `$` in a multiline-flagged regex, and it is the case most likely to be missing;
  - an 11-char id that is entirely `-` and `_` → **valid** (the negative control for
    over-strictness: rejecting legal ids would break real lessons).
- **Assert the constructed URL's ORIGIN, not a substring.** `new URL(result).origin ===
'https://www.youtube-nocookie.com'` — a `toContain('youtube-nocookie')` check passes for
  `https://evil.com/?x=youtube-nocookie.com`.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=youtube-embed-url
```

Green, every hostile case above present, plus the origin assertion and the cross-file pattern
equality check.

---

### Task 10.4: `YouTubePlayerComponent` — facade first, player on activation ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-player.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-player.html` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-player.spec.ts` (NEW)

**Requirement refs**: R2.2.7, R2.3.1, §4.6.1–§4.6.4, NFR-S3, NFR-U1, NFR-U4, NFR-P6, RISK-S
**Dependencies**: Tasks 10.3, 10.5
**Pattern to follow**: `libs/web/members/src/lib/community/components/reaction-bar.ts` for the
standalone/OnPush/`input()`/`output()` shape and the action-describing `aria-label` rule.

**Implementation details** — §4.6's five steps, in order, because the order **is** the feature:

1. **Initial render is a POSTER**: the persisted `videoThumbnailUrl` in an `<img>` with a play
   button. **Zero YouTube network activity.** ⚠️ **The thumbnail URL is itself a
   `ytimg.com`/`googleusercontent` URL and loading it IS a third-party request** — see the
   validation note; this is the trap that makes exit-gate clause 2 fail on a component that is
   otherwise correct.
2. **On the member's first activation** — click **or `Enter`/`Space`** (NFR-U4) — inject
   `https://www.youtube.com/iframe_api` **once** and construct a player whose **`host` is
   `https://www.youtube-nocookie.com`**, so the iframe origin is the nocookie domain.
3. **The iframe `src` comes from `buildYoutubeEmbedUrl()` (Task 10.3), and this component is
   the SINGLE call site of `bypassSecurityTrustResourceUrl` in the workspace.** It is called
   **only** on a non-`null` return. If the function returns `null`, render the poster with a
   stated "this video is unavailable" message and **never construct an iframe**.
4. Emit playback position; **the store (Task 10.5) owns the timing**, not this component.
5. Emit `pause` / `ended` so the store can flush.

- **The API script is injected ONCE per page, not once per component.** Two lessons opened in
  one session must not append two `<script>` tags. Guard with a module-level promise, and
  assert that two activations produce one injection.
- **`enablejsapi=1` is required** for `getCurrentTime()` to work at all; it is in Task 10.3's
  literal param string.
- **NFR-U1**: `ChangeDetectionStrategy.OnPush`, signals, `inject()`. **No constructor
  injection** — the Task 4.7 lint rule is scoped to `libs/web/members/**` and will fail the
  build.
- **`DestroyRef` teardown destroys the player and clears the interval.** A leaked 1 s interval
  on a destroyed component is how a member navigating between five lessons ends up with five
  pollers writing progress for lessons they are no longer watching.

**Validation notes**:

- 🔴 **THE TRAP THAT MAKES CLAUSE 2 FAIL SILENTLY: the poster image.** §4.6.1 says the poster
  is "the persisted `videoThumbnailUrl` in an `<img>`". That URL is served by
  `i.ytimg.com` — **so a "zero YouTube network activity" claim is false the moment the poster
  renders**, and a Playwright assertion written only against `youtube.com` would pass while
  the browser has already contacted Google. Two honest options, **and the task must pick one
  and say which**:
  - **(a) Assert the narrower, true property**: no request to `youtube.com`,
    `youtube-nocookie.com`, or `googleapis.com` before activation, and **document that
    `i.ytimg.com` is contacted for the poster**. Cheap, honest, and NFR-S3's actual concern is
    the _script and cookie_ surface, not an image.
  - **(b) Proxy or self-host the thumbnail** so the facade is genuinely request-free. Correct
    but out of scope — it needs a backend image route nobody specified (RK-1).
    **Recommended: (a)**, with the ytimg host named in the component docblock **and** in the
    Playwright assertion's allowlist, so the exception is a line someone reads rather than a
    gap. **State this in the report either way** — an unstated exception is how "zero network
    activity" becomes folklore.
- **NFR-U4 keyboard operability**: the poster is a real `<button>` (not a `<div>` with a click
  handler), so `Enter`/`Space` work for free and it is in the tab order. The `aria-label` says
  what activation does and names the video ("Play: Week 1 build thread"), not "Play".
- **NFR-S2 is in force here even though this renders no markdown**: no `[innerHTML]`, no
  `bypassSecurityTrustHtml`, no direct `marked`/`dompurify` import.
  `markdown-chokepoint.spec.ts` globs `libs/web/members/**` and **this file is in scope from
  the moment it exists** — B7.1 proved exactly that by injecting a violation into
  `my-threads-page.ts` and watching the spec name it by path.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=youtube-player
```

Cases: initial render contains **no `<iframe>`** and no injected `<script>` · activation by
click **and** by `Enter` **and** by `Space` each construct the player · two activations inject
the script **once** · a `null` from `buildYoutubeEmbedUrl` renders the unavailable state and
**no iframe** · the constructed iframe's origin is `youtube-nocookie.com` · `DestroyRef`
teardown destroys the player and clears the interval.

---

### Task 10.5: `CoursePlayerStore` — 1 s poll, ≤ 1 write per 15 s, flush on teardown ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\course-player.store.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\course-player.store.spec.ts` (NEW)

**Requirement refs**: R2.3.1, R2.3.2, R2.3.3, §4.6.4–§4.6.6, NFR-P5, RISK-O
**Dependencies**: Task 10.2
**Pattern to follow**: `libs/web/members/src/lib/community/thread-page.ts`'s read-marker
logic — B7's _"the read marker posts once per open, at the highest `postNumber` on the page. A
progress write per change detection would spend the member's 60/min budget on scrolling."_
Same class of problem, same discipline.

**Implementation details**:

- A **1 s interval** reads `getCurrentTime()`; the store `PUT`s **at most once per 15 s**
  (R2.3.1, §4.6.4), and **flushes on `pause`, `ended` and `DestroyRef` teardown**.
- 🔴 **The client NEVER sends a `completed` flag** (§4.6.6). It sends `{ positionSeconds }`
  and reads `{ furthestPositionSeconds, completedAt }` back. The completion state the UI shows
  is **the server's answer**, not a local derivation. Assert that the store has no code path
  computing a threshold — **grep the file for `0.9`, `90`, and `threshold` in the spec and
  assert none appears.** That is RISK-O's frontend shape: the moment the client computes a
  percentage, there are two implementations of R2.3.2 and they will disagree at the boundary.
- **Manual completion is a separate call** (`putCompletion`), reversible (R2.3.3), and its
  response is likewise authoritative.
- **A failed `PUT` must not lose the position.** Keep the unflushed value and retry on the next
  tick rather than discarding it; a member who watches 20 minutes through a flaky connection
  and loses all of it is the failure. But **do not queue unboundedly** — keep the _latest_
  position only, because the server takes `max(stored, submitted)` and intermediate positions
  are worthless.
- **The store is per-lesson and is destroyed with the lesson page.** Navigating lesson → lesson
  reuses the component instance (B7's F-4 note about `ThreadPage`), so the store must **reset**
  on a slug change, not accumulate. Assert it.
- **Reconcile wholesale from the response, never merge** — B7's reaction lesson: a merge keeps
  a locally-guessed value alive when the two disagree.

**Validation notes**:

- **Use fake timers and assert the WRITE COUNT, not just the values.** A store that writes
  every tick passes a values-only test. Required: 60 s of playback at 1 s ticks produces
  **exactly 4** writes; `pause` at 7 s produces one flush; `ended` produces one; teardown
  produces one; and **a pause immediately after a scheduled write does not double-write.**
- **Seeking backwards produces no write** (the server clamps monotonically anyway, but sending
  it wastes the 60/min budget and makes the network tab lie about what the member did).
- **`PROGRESS_WRITES` is 60/min server-side** (B6C's D-6.12g). One write per 15 s is 4/min per
  lesson, so the budget is not the constraint — but a store that writes per change-detection
  cycle would exceed it in seconds, which is exactly the defect the assertion above catches.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=course-player.store
```

Cases: 60 s → 4 writes · flush on pause / ended / teardown, one each · no double-write at a
boundary · a failed `PUT` retains the position and retries with the **latest** value only · a
slug change resets the store · **no threshold arithmetic anywhere in the file** · seeking
backwards writes nothing.

---

### Task 10.6: Courses list and course detail pages ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\courses-page.ts` (+ `.spec.ts`) (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\course-page.ts` (+ `.spec.ts`) (NEW)

**Requirement refs**: R2.1.2, R2.1.4, R2.3.5, R2.3.6, R6.3, R9.7, R9.8, NFR-U2, NFR-U5, NFR-U6
**Dependencies**: Tasks 10.1, 10.2, 10.8
**Design source**: `docs/design-system/` — the **`course_learning`** screens, dark **and**
light. Resolve every token conflict between the approved screens and the code through
`docs/design-system/panel-theme-spec.md` (R9.8) — the screens each emit their own conflicting
Material-3 token set, which is RK-7.

**Implementation details**:

- **Courses list**: one card per `MemberCourseSummary` with cover image, title, description
  and `ProgressMeter`. **Ordered exactly as the server returned them** — R2.1.4's tie-break is
  `(sortOrder, createdAt, id)` and it is computed server-side (Task 9.8's
  `DETERMINISTIC_ORDER_BY`). **Nothing is re-sorted client-side.** B7's rule: re-sorting
  reorders only the current page, which looks like working software and breaks the moment a
  member reaches page 2.
- **Course detail**: the module outline (Task 10.8) plus a **Resume** action pointing at
  `MemberCourseDetail`'s first-incomplete lesson (R2.3.6). **The resume target comes from the
  server** (Task 9.11 computes it) — do not re-derive it by scanning the outline in the
  browser, or the card and the button will eventually disagree.
- **Empty states, never a bare zero** (R1.7.3, R6.3): no courses → `EmptyState` from
  `@ptah-web/panel-ui` with copy that names the situation ("The cohort curriculum has not been
  published yet."). A course with no modules → `EmptyState` inside the detail, not a blank
  page.
- 🔴 **A failed load renders a RETRYABLE ERROR, not an empty state.** B7's rule, and it is the
  one most worth repeating: _"'No threads yet' after a 500 tells a member the community is
  empty. It is not; we failed."_ Same here — "the curriculum has not been published yet" after
  a 500 tells a paying member the product does not exist. `role="alert"`, a retry button, and
  **the previous rows cleared** so a retry that fails cannot leave stale content under an error
  banner (B7.1's rule for My Threads).
- **A draft or invisible course is a `404`** and renders the same "not available" copy the
  thread page uses, with **none of the words "not allowed", "forbidden" or "permission"** —
  B7's `thread-page.spec.ts` asserts exactly that absence, because `404` covers absent **and**
  invisible indistinguishably (R1.1.3) and leaking the difference in copy undoes the
  where-clause's work.
- **`ProgressMeter` receives `completedLessons` and `totalLessons`**, not a percentage (Task
  10.1). One derivation of R2.3.5, server-side, rendered.
- **NFR-U6**: the courses list is small (one course in this workspace) and needs no
  pagination; **the module outline must not accumulate unbounded DOM** either, but a course is
  8 modules × 1 lesson. State that pagination was considered and is not needed, rather than
  leaving the question open.

**Validation notes**:

- **NFR-U2 IS lint-enforced here** (Task 4.7's rule, scoped to `libs/web/members/**`): no raw
  hex, no `ink-*`, no `amber-*`, no Material-3 token names, **no `border-base-300`**.
  `npx nx lint web-members` is the gate and it is green today — keep it green.
- **NFR-U5**: render in `operator-member` **and** `operator-member-light`. Batch 4 proved both
  work at the shell level; a new page can still break light mode on its own. The specific
  failure mode is `<ptah-markdown-block>`'s default `variant="invert"` — **pass
  `variant="auto"`** (B7's Task 7.3 note; both composer specs assert the rendered class
  contains `dark:prose-invert`).
- **NFR-U1**: `OnPush`, signals, `inject()`. No constructor injection.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns="courses-page|course-page"
npx nx lint web-members --skip-nx-cache
```

Cases: server order preserved and nothing re-sorted · `EmptyState` on no courses and on an
empty course · **a 500 renders a retryable error, NOT an EmptyState, and clears stale rows** ·
a 404 renders the neutral copy with none of the three forbidden words · `ProgressMeter` gets
counts not a percentage · resume points at the server's first-incomplete lesson.

---

### Task 10.7: Lesson page — two route params, and the F-4 decision ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\lesson-page.ts` (+ `.spec.ts`) (NEW)

**Requirement refs**: R2.1.5, R2.2.7, R2.3.x, R2.4.1, R2.4.2, R2.5, NFR-U4, NFR-U5, NFR-S2, §3.4
**Dependencies**: Tasks 10.2, 10.4, 10.5, 10.8, 10.9
**Pattern to follow**: `libs/web/members/src/lib/community/thread-page.ts` — the same shape of
page (one route param → one detail fetch → a renderer + a composer), and the same 403/404
discipline.

🔴 **THE F-4 DECISION, made here rather than left to the executor.**
`withComponentInputBinding()` is **still not installed** on `provideRouter` in
`apps/ptah-landing-page/src/app/app.config.ts` (B7 F-4, re-confirmed B7.1 F-13), so route
parameters cannot be bound as component inputs. `ThreadPage` was the first component that
wanted it and read `ActivatedRoute` instead. **The lesson page takes TWO params
(`:slug`, `:lessonSlug`) and is the second consumer.**

**Verdict: read `ActivatedRoute` as a SIGNAL, exactly as `ThreadPage` does. Do NOT install
`withComponentInputBinding()` in this batch.** Reasons, in order:

- It is a **one-word change with app-wide reach** — it changes how every existing routed
  component in the landing app receives parameters, and this batch's file set deliberately
  excludes `app.config.ts` (B7 named it as "the one place I wanted `app.config.ts` and did not
  take it").
- Two consumers is not yet a case; it is a second data point. **Record it in the code** so the
  count is visible to whoever eventually does it.
- **The signal (not a snapshot) is load-bearing regardless**: navigating lesson → lesson
  reuses the component instance, and a snapshot read in `ngOnInit` would show the first
  lesson forever. `ThreadPage` has a spec for exactly this; write the two-param version.

**Implementation details**:

- Body renders through `<ptah-markdown-block variant="auto">` and **nothing else** (NFR-S2,
  PRE-4). `variant="auto"` is load-bearing, not cosmetic: the component default is `'invert'`
  for the dark-only webview and would put near-white text on the near-white `base-200` of
  `operator-member-light`.
- **Player** (Task 10.4) when `youtubeVideoId` is non-null; **no player at all** when it is
  null — and ⚠️ **that is the live path for every seeded lesson** (§7.3 sets
  `youtubeVideoId: null` on all 8). So the **no-video layout is the default case here, not an
  edge case**: it must be a complete, deliberate design (body + comments + prev/next + a manual
  "Mark complete" control), not a player-shaped hole.
- **Manual completion control** (R2.3.3) — always available, reversible, and **the only
  completion affordance when there is no duration** (ASSUMPTION-8). Its label must state which
  it is ("Mark complete" vs an auto-completed "Completed — watched 90%"), because a member who
  cannot tell why a lesson is complete cannot tell whether un-completing it is safe.
- **`previous` / `next` come from the server** (R2.1.5) and **cross module boundaries**. Render
  them as links, not as computed neighbours. **A locked next-lesson still renders as a link**
  — the member may see what is coming (R2.4.4) — and clicking it lands on the `403` state.
- 🔴 **The locked state is a `403` from the API rendered as a page state, NEVER a CSS
  treatment** (R2.4.5, exit-gate clause 1's frontend half). `LockedModuleNotice` (Task 10.8)
  renders the unlock condition **in plain language** from the machine `reason` +
  `unlocksAt` — matched on `LOCK_REASONS`' values, never on the server's sentence (B6C's
  carried item 5).
- **404 vs 403 render differently, and their copy differs.** `404` = "This lesson is not
  available", with **none of** "not allowed" / "forbidden" / "permission" (it covers invisible
  as well as absent). `403` = the locked notice, which **does** say why, because the module's
  existence is already disclosed.

**Validation notes**:

- **Read the bound `content` input of `<ptah-markdown-block>` via
  `By.directive(MarkdownBlockComponent)`**, not `textContent` — `ngx-markdown` parses in a
  promise, so asserting rendered text makes each case a timing test of a third-party library
  (B7's technique note).
- **NFR-U4**: the whole page is operable without a mouse — the player poster is a `<button>`,
  prev/next are links, the completion control is a `<button>`, and focus order follows reading
  order. Task 10.11 runs axe over this page specifically.
- **NFR-S2**: no `[innerHTML]`, no `bypassSecurityTrustHtml`, no direct `marked`/`dompurify`
  import. **`markdown-chokepoint.spec.ts` asserts `@ptah-extension/markdown` is imported by
  EXACTLY THREE FILES, BY NAME** (`thread-page.ts`, `topic-composer.ts`, `reply-composer.ts`).
  **This page is a fourth**, so **that assertion's list must be extended in the same change** —
  and extending it is the point: a fourth renderer is _a diff a reviewer reads_, not a
  discovery. Task 10.11 owns the edit; this task must not silently make the spec red.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=lesson-page
```

Cases: navigating lesson → lesson updates the page (the signal, not a snapshot) · a lesson with
`youtubeVideoId: null` renders the **complete** no-video layout with a manual completion
control and **no player** · a locked module renders `LockedModuleNotice` with plain-language
copy derived from the machine reason · a 404 renders neutral copy with none of the three
forbidden words · prev/next cross a module boundary and a locked next still renders as a link ·
the body reaches `<ptah-markdown-block variant="auto">` and nothing else.

---

### Task 10.8: `ModuleOutline` and `LockedModuleNotice` ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\components\module-outline.ts` (+ `.spec.ts`) (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\components\locked-module-notice.ts` (+ `.spec.ts`) (NEW)

**Requirement refs**: R2.1.4, R2.4.1, R2.4.2, R2.4.4, R9.7, NFR-U1, NFR-U3
**Dependencies**: Task 10.1
**Pattern to follow**: `libs/web/members/src/lib/community/components/unread-pill.ts` — a
small presentational component that **renders nothing in the null case** and whose accessible
label states _which_ number it is.

**Implementation details**:

- **Both stay PRIVATE to `libs/web/members`** (§5.3): a module outline is a member concept
  with no admin equivalent in this task's scope, and a lock notice is member-facing by
  definition. **Do not promote them**, and say so in each docblock the way B7's five private
  components do.
- `ModuleOutline` renders modules in server order, each with its lessons, a per-lesson
  completed marker, and — **for a locked module** — the title and lesson titles **only**
  (R2.4.4). It renders no body, no video affordance and no comment count for a locked module,
  **and it cannot**, because `MemberLessonSummary` carries no such fields (Task 9.7's
  structural redaction). **Assert that**: a spec that the locked module's rendered DOM contains
  no `<ptah-markdown-block>` and no play affordance.
- `LockedModuleNotice` takes `{ reason: LockReason, unlocksAt: Date | null }` and renders
  **plain language** (R2.4.2's words):
  - `'not_released'` → "Unlocks on <date>" with a real `<time datetime>` element;
  - `'previous_module_incomplete'` → "Complete every lesson in <previous module title> to
    unlock this module."
    **Matched on the machine value via a `Record<LockReason, …>`, never on the server's
    sentence** — and a `Record` over the union means a future third reason is a **compile
    error**, not a blank notice. B7's `ReactionBar` uses exactly this device for
    `REACTION_TYPES` and gives the reason: _"a fifth wire value becomes a compile error in the
    label `Record`."_
- **`unlocksAt` is rendered in the member's locale**, not as an ISO string, and the `<time
datetime>` carries the machine value so a screen reader and a scraper both get something
  usable. B7's `ThreadRow` made the same call for `lastPostedAt` — a flattened string loses the
  `<time>` semantics.

**Validation notes**:

- **NFR-U3**: load-bearing muted text uses `text-base-content/60` or stronger. `/40` measures
  3.18:1 and fails WCAG AA for body text.
- **A locked module must be visibly locked without relying on colour alone** — an icon plus
  text, not a grey row. Colour-only state is a WCAG 1.4.1 failure and Batch 15's axe pass will
  find it.
- **The lock is a server fact.** These components render `locked` from the wire; they do not
  evaluate `releaseAt` in the browser. A client-side clock comparison would drift from the
  server's and would make the outline and the lesson endpoint disagree — and it is exactly the
  "hidden only by CSS" defect R2.4.5 names.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns="module-outline|locked-module-notice"
```

Cases: modules and lessons in server order, nothing re-sorted · a locked module renders titles
and **no** markdown block and **no** play affordance · each `LockReason` renders its own copy ·
an unknown reason is a compile error (assert via a type-level test or a `Record` exhaustiveness
check) · `unlocksAt` renders a `<time datetime>` · no colour-only state.

---

### Task 10.9: Lesson comments — one level, and the "Answered" treatment ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\components\lesson-comments.ts` (+ `.spec.ts`) (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\components\lesson-comment-composer.ts` (+ `.spec.ts`) (NEW)

**Requirement refs**: R2.5.1–R2.5.5, A-8, NFR-S2, NFR-U1, NFR-U3, R9.7
**Dependencies**: Tasks 10.2, 10.7
**Pattern to follow**: `libs/web/members/src/lib/community/thread-page.ts`'s reply rendering
and `libs/web/members/src/lib/community/components/reply-composer.ts`.

**Implementation details**:

- 🔴 **The indent is a BOOLEAN and nothing else** — B7's Task 7.5 decision, and it is the
  strongest guarantee available: `isReply = comment.parentId !== null`; the template has
  **exactly two branches**; there is **no recursive component**. _"A depth-3 row cannot be
  drawn because the renderer has no way to express it — a stronger guarantee than a clamp,
  because a clamp has to be correct and an absent capability does not."_ Assert it against
  **deliberately malformed depth-3 fixture data** (which the server should never emit), and
  assert the negative control too — a renderer that indented _nothing_ would also satisfy
  "never more than one level".
- **"Answered" uses `StatusBadge` from `@ptah-web/panel-ui`** (R9.7), not a new badge. B7's
  `AcceptedAnswerBadge` wraps `StatusBadge` for the same reason; **do not import
  `AcceptedAnswerBadge` itself** — it is a forum concept (accepted answer) and this is a
  different one (answered question), and conflating them would make one component answer to
  two vocabularies.
- 🔴 **A-8: NO reactions on lesson comments.** There is no `ReactionBar` on this surface and
  no `REACTION_TYPES` import in these files. Assert the absence — it is the kind of thing that
  gets added "for consistency" with the forum.
- **The composer is a plain markdown textarea with a preview**, and the preview renders through
  `<ptah-markdown-block variant="auto">`. **No WYSIWYG** — the task description rejects it
  explicitly because it introduces a second content representation and a second sanitization
  path, directly against NFR-S2.
- **Neither component imports `FormsModule`** — see the carried-in note. State is two signals
  bound with `[value]` + `(input)`; `(submit)` is the **native** event; `maxlength` is
  `[attr.maxlength]`.
- **Tombstones render a stated placeholder and NEVER reach the markdown renderer** — B7's
  thread page found that passing `''` renders nothing and leaves a silently blank row.
- **The comment count excludes tombstones** (R2.5.5) — and it comes from the server, which
  already excludes them (Task 9.14). Do not recount in the browser.

**Validation notes**:

- **NFR-S2**: these files are inside `markdown-chokepoint.spec.ts`'s glob. The composer is a
  **fifth** importer of `@ptah-extension/markdown` — see Task 10.7's note; Task 10.11 owns
  extending the by-name list.
- **NFR-U3**: `text-base-content/60` or stronger for author/timestamp metadata.
- **Every action button carries an action-describing `aria-label`** — B7's rule:
  _"'Insightful 2' tells a screen-reader user neither what pressing it does nor whether they
  already reacted."_ Here: "Mark this question answered", not "Answered".

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns="lesson-comments|lesson-comment-composer"
```

Cases: **never indents past one level even when the fixture data says depth 3** · a top-level
and a nested comment render at **different** indents (the negative control) · "Answered" uses
`StatusBadge` · **no reaction affordance and no `REACTION_TYPES` import anywhere** · the
preview goes through `<ptah-markdown-block>` · a tombstone renders a placeholder, not an empty
body · action labels describe the action.

---

### Task 10.10: Swap the three Phase-3 placeholder routes ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts` (MODIFY)

**Requirement refs**: R9.4, RK-11, §5.2
**Dependencies**: Tasks 10.6, 10.7
**Pattern to follow**: B7's Task 7.8 and B7.1's Task 7.8 completion — same file, same probe.

**Implementation details**:

- Three routes, currently `loadComponent: loadPlaceholder` with
  `data: placeholder({ surface: 'Courses' | 'Course' | 'Lesson', phase: 3, … })`:
  - `courses` → `CoursesPage`
  - `courses/:slug` → `CoursePage`
  - `courses/:slug/lessons/:lessonSlug` → `LessonPage`
- **No route path changes.** **No `canActivate` is added anywhere** — `MEMBER_ROUTES` declares
  zero guards and `members.routes.spec.ts` fails if one reappears in the subtree.
- **`loadComponent` for each**, so no sibling surface enters the hub's bundle.
- The **five remaining** placeholders (`packs`, `live`, `live/replays`, `live/request`,
  `notifications`) are **untouched** — Batches 13 and 15 own theirs.
- **Rewrite the file's header shape comment** so the three lines read `-> CoursesPage`,
  `-> CoursePage`, `-> LessonPage` rather than "(phase 3)". B7.1 rewrote the blocked-route
  docblock rather than deleting it, for a stated reason; do the same here — the comment is the
  route table a reader trusts.

**Validation notes**:

- 🔴 **RK-11: there is NO `:model` / `:model/:id` catch-all here and one must never be added.**
  `admin.routes.ts:174-183` keeps exactly that pattern and documents why: on an internal
  operator surface a generic table/detail route is a feature; **on a member-facing surface it
  is a data-exposure hazard** — it turns every future model the generic admin API can serve
  into a URL a member can type.
- **`courses/:slug/lessons/:lessonSlug` introduces two parameter segments.**
  `members.routes.spec.ts` asserts (a) no route path's **first** segment is a parameter and
  (b) **every parameter segment is drawn from an allowlist**. `:slug` is already in it;
  **`:lessonSlug` may not be** — check, and if it is absent, **add it to the allowlist in the
  same change and say so**, because that allowlist is the assertion, not a formality.
- **The deliberate-failure probe is required, because this task touches the file.** Inject a
  temporary `{ path: ':model', loadComponent: loadPlaceholder, … }` before the `account`
  route; **five of nine assertions must fire**, including the source-text one that catches a
  commented-out copy-paste; then revert and confirm `grep -c "':model'"` is `0` and 9/9 pass.
  B7 and B7.1 both ran it and both pasted both runs — do the same.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=members.routes.spec
npx nx build ptah-landing-page --skip-nx-cache
```

9/9 green, plus the probe pair. The build produces three new lazy chunks — **name them and
their sizes in the report**, as B7.1 did; a route that silently resolved to an existing chunk
means a swap did not take. ⚠️ The build carries **two pre-existing budget warnings** (initial
bundle ~1.31 MB vs a 1.00 MB budget, and FullCalendar's `skeleton.css`) which were
byte-identical across B7 and B7.1 — **they are not yours**, but if the initial bundle grows,
say by how much: three new lazy chunks should not move it at all, and if it moves, something
was statically imported that should have been lazy.

---

### Task 10.11: The NFR-S3 network proof, the embed chokepoint, e2e, both themes, axe ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\youtube-embed-chokepoint.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\markdown-chokepoint.spec.ts` (MODIFY — the by-name importer list)
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-courses.spec.ts` (NEW)
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\support\db.ts` (MODIFY — course fixtures)

**Requirement refs**: NFR-S2, NFR-S3, NFR-U4, NFR-U5, R2.1.5, R2.4.5, §8.2 P3, RISK-S
**Dependencies**: Tasks 10.3–10.10
**Pattern to follow**: `libs/web/members/src/lib/markdown-chokepoint.spec.ts` (B7's Task 7.9)
and `apps/ptah-landing-page-e2e/src/specs/members-community.spec.ts` (B7 + B7.1).

🔴 **DOES `markdown-chokepoint.spec.ts` NEED A SIBLING? YES — and here is the argument, so it
is a decision and not a habit.**
The markdown chokepoint exists because there is **one** path from untrusted text to the DOM
and it must stay one. `bypassSecurityTrustResourceUrl` creates a **second** kind of chokepoint
of the same shape: one path from a persisted string to a trusted URL, and it must stay one.
The markdown spec **cannot** cover it — its negative list is `innerHTML`,
`bypassSecurityTrustHtml`, `marked`, `dompurify`, `ngx-markdown`, and adding a resource-URL
rule to it would mean one spec enforcing two unrelated invariants whose failure messages would
have to be told apart. And **RISK-S**: there is no prior `bypassSecurityTrustResourceUrl` in
this repository at all, so there is nothing today that would notice a second one appearing.
**Ship `youtube-embed-chokepoint.spec.ts` as a sibling**, in the same directory, with a
cross-reference in both docblocks.

**Implementation details — `youtube-embed-chokepoint.spec.ts`**:

- Globs `libs/web/members/**/*.{ts,html}` and asserts:
  1. **`bypassSecurityTrustResourceUrl` appears in EXACTLY ONE file, named**
     (`lib/learning/youtube-player.ts`) — the `importers.sort()` idiom.
  2. **`buildYoutubeEmbedUrl` is the only producer of the value it receives** — the bypass call
     site's argument expression must reference it. A source-text assertion is enough here and
     the failure message says what to do instead.
  3. **No file contains a `youtube.com` or `youtube-nocookie.com` string literal outside
     `youtube-embed-url.ts` and `youtube-player.ts`** (the API script URL). A hardcoded embed
     URL anywhere else is a second construction path.
  4. **The positive half**: `youtube-embed-url.ts` really exports the function and the pattern,
     and the pattern's literal text **equals** the one in
     `libs/api/youtube/src/lib/extract-video-id.ts` (Task 10.3's cross-file check). A
     negative-only spec passes trivially on a lib that renders no video.
  5. **Anti-vacuity**: the scan saw at least N files and the known call site really is found.
- 🔴 **Strip comments before scanning, with `ts.transpileModule({ removeComments: true })`,
  not a regexp.** Half the files in this lib will _discuss_ the rule in their docblocks —
  telling the next reader not to call the bypass is exactly the documentation the rule wants,
  and matching raw text would make every warning a violation so the only way to stay green
  would be to delete the warnings. **A regexp cannot tell `//` inside a URL from a line
  comment, and truncating at `https://` would create a place a needle could hide** — B7 hit
  precisely this and its solution is the one to copy. HTML comments in inline templates are
  stripped separately. Include an anti-vacuity case proving the stripper removes both comment
  forms **and** preserves code and URLs.
- **Exclude the spec itself by absolute path, not by name pattern**, and exclude other
  `.spec.ts` files with the reason stated (a spec legitimately contains the forbidden string to
  assert its absence). Add an anti-vacuity case proving the exclusion did not over-reach.
- 🔴 **PROVE IT FAILS.** Inject `this.sanitizer.bypassSecurityTrustResourceUrl(url)` into
  `lesson-page.ts`, confirm the spec fails **and names the file by path**, revert from a
  byte-exact backup, confirm green. **Paste both runs.** B7 and B7.1 each did this for the
  markdown spec and B7.1's second probe is what proved a _new_ page was in scope.

**Implementation details — `markdown-chokepoint.spec.ts` edit**:

- Its assertion that `@ptah-extension/markdown` is imported by **exactly three files, by
  name**, becomes **five**: `thread-page.ts`, `topic-composer.ts`, `reply-composer.ts`,
  `lesson-page.ts`, `lesson-comment-composer.ts`. **Extending that list is the point** — a new
  renderer is a diff a reviewer reads, not a discovery. Re-run the deliberate-failure probe
  against a **Phase-3** file (inject `[innerHTML]` into `lesson-page.ts`) so the spec is proven
  to cover the new surface, exactly as B7.1 did for `my-threads-page.ts`.
- `search-page.ts` remains the **one declared exemption** (its excerpts are plain text by
  design — R1.7.5). Do not add a second.

**Implementation details — e2e (`members-courses.spec.ts`)**:

- 🔴 **The NFR-S3 network assertion — exit-gate clause 2, and it is the one most likely to be
  written wrongly.** Route-intercept **all** requests on the lesson page and assert that,
  **before activation**, zero requests were made to `youtube.com`, `youtube-nocookie.com`,
  `googleapis.com` or `googlevideo.com`; **then activate the poster and assert at least one
  was**. The "then activate" half is not optional: **without it the assertion passes on a page
  that renders no player at all**, which is RISK-P's frontend twin.
  ⚠️ **`i.ytimg.com` IS contacted for the poster image** — see Task 10.4's trap. The
  assertion's allowlist must name it explicitly, with the reason, so the exception is a line
  someone reads.
  ⚠️ **This test needs a lesson with a `youtubeVideoId`, and NO SEEDED LESSON HAS ONE**
  (§7.3 sets it null on all 8). **Seed a throwaway course + module + lesson with a real
  11-char id through the admin API, and tear it down by id** — B7's fixture discipline: a
  timestamped slug, teardown deletes strictly by the ids it minted, **nothing counts rows,
  asserts a table is empty, or truncates**, because Batch 11's seed is landing concurrently.
- **The journey**: courses list → course detail → resume → lesson renders body as real markdown
  → mark complete → the outline and the progress meter both update → prev/next crosses a module
  boundary.
- **The locked-module clause**: create a module with a **future `releaseAt`**, confirm the
  outline shows it locked with the date, and confirm navigating to its lesson renders the
  locked notice — **and assert the API returned `403`**, not just that the UI looks locked
  (R2.4.5, exit-gate clause 1's frontend half). Read the status off the intercepted response.
- **Both themes** (NFR-U5): visit courses, course detail and lesson in `operator-member` **and**
  `operator-member-light`, assert `[data-theme="<theme>"]` is **actually attached** (so the
  panel is really on the theme under test, not merely rendered), and attach a full-page
  screenshot per surface per theme. **Seed content first** — B7.1's lesson: the theme loop
  passed over a placeholder for a whole batch, and an empty page renders a centred icon on
  `base-200`, the least theme-sensitive thing a surface can show. **The rows are where the
  token work is.**
- **axe on the player** (NFR-U4, exit-gate clause 3): run axe against the lesson page in both
  the poster state and the activated state. The activated state embeds a third-party iframe —
  **scope the axe run to the page's own DOM and exclude the iframe**, and say so, because
  YouTube's iframe internals are not this repo's to fix and an unscoped run reports them
  forever.
- **Keyboard**: tab to the poster, press `Enter`, assert the player constructed; repeat with
  `Space`. A mouse-free path from the course list to a playing video.
- **No pixel baseline.** B7 and B7.1 both declined one with the reason _"a baseline for a
  surface this new encodes today's layout as a requirement"_. The full axe pass across every
  member surface is Batch 15's (§8.2 P5).

**Validation notes**:

- **Re-run the Batch-4 one-request hub assertion unchanged** (R6.2, R6.6). It has now survived
  two phases; the third is the one where a "continue learning" card is most tempted to fetch
  for itself. B7 added a **live** variant alongside the stubbed original rather than editing
  it, because the stubbed version proves the page issues one request while the live one proves
  the property survives the thing that could break it. **Add the Phase-3 equivalent**: count
  every `/api/v1/members/*` request the hub route issues, wait ~1.5 s to give any lazy child
  the chance to fetch, assert the hub count is exactly **1**, and assert **zero**
  `…/courses` calls.
- **B7's five pre-existing e2e failures will still be there.** Report the same five; do not
  weaken them.
- **Fixture hygiene under a concurrent seed**: Batch 11 may be running. Nothing counts rows,
  nothing truncates, teardown is by id, and clean-up order respects the FKs
  (`LessonComment` → `LessonProgress` → `Lesson` → `CourseModule` → `Course`).

**Verification**:

```
npx nx run-many -t lint,typecheck,test \
  -p web-members,web-panel-ui,web-core,ptah-landing-page --skip-nx-cache
npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
E2E_ADMIN_EMAIL=abdallah@miramarstaffing.com npx playwright test src/specs/members-courses.spec.ts --reporter=list
```

0 errors. Both chokepoint specs green **and each proven to fail**, with both runs pasted. The
e2e suite green for this file, with the same five pre-existing failures elsewhere and no new
ones.

---

**Batch 10 Verification (exit gate)**:

- **§8.2 P3 frontend, all four clauses with pasted evidence**: the 8 week threads render as an
  ordered course · **no `youtube.com` / `youtube-nocookie.com` request until the poster is
  activated, AND at least one after** (with `i.ytimg.com` named as a documented exception) ·
  axe pass on the player, iframe excluded and the exclusion stated · both themes clean, with
  **populated** surfaces and `[data-theme]` asserted.
- A locked module renders the locked notice **and the API returned 403**, read off the
  intercepted response.
- **`markdown-chokepoint.spec.ts` green, its by-name importer list extended to five, and
  re-proven to fail naming a Phase-3 file.**
- **`youtube-embed-chokepoint.spec.ts` green and proven to fail.**
- `members.routes.spec.ts` 9/9 with the RK-11 probe run and reverted; three new lazy chunks
  named with their sizes; the initial bundle unmoved.
- The one-request hub assertion still passes, **unchanged**, plus a Phase-3 live variant.
- `npx nx lint web-members` green (the NFR-U2 token rule) — and if anything landed in
  `libs/web/panel-ui`, a **hand-checked** NFR-U2 statement in the report, because the rule does
  not reach there.
- **§5.3's promotion bar for `ProgressMeter` explicitly answered** in the report — promoted
  with a named second consumer, or kept private and said so.

---

## Batch 11: P3-MIG — seed the curriculum course (8 Week topics) ⏸️ PENDING

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential internally; **parallel with Batch 10** (see the file-set claim
below), with **one ordering caveat**.
**Rationale**: One artefact — `community-seed.ts` — extended along a seam Batch 8 built for
exactly this. The summary printer is already **data-driven** (an array of rows, not a template
literal) _"so Batch 11 appends `courses`, `modules` and `lessons` entries rather than rewriting
the format"_, and `CURRICULUM_TOPIC_IDS` is already exported and already asserted disjoint from
`IMPORTED_TOPIC_IDS`. **This batch consumes seams, it does not build them.**

**Dependencies**: **Batch 8** (the seed module, its schema, its recording double, its
censuses), **Batch 9** (the five course tables — they do not exist until migration 3 applies).
**Preconditions**: PRE-7.
**Tasks**: 7 (refined at the Phase-2/Phase-3 boundary, 2026-08-05)

**Scope boundary**: this batch writes **1 course, 8 modules, 8 lessons** and **nothing else**.
No progress rows, no lesson comments, no `LessonProgress` for the dev user, and **no
`member_group_assignments`** (`context.md`: that table is deliberately empty and seeding it
would make several gates pass vacuously). It does **not** re-import the 9 community topics —
Batch 8 owns those and a second writer for the same rows is how idempotency dies. It does
**not** touch `schema.prisma` or `prisma/migrations/**`.

**File set** (for the parallel-with-B10 claim): `apps/ptah-license-server/prisma/seed/**` and
nothing else. **Batch 10's set is `libs/web/members/**`, `libs/web/panel-ui/**`,
`apps/ptah-landing-page-e2e/**`. Disjoint, including every shared-registry file** — neither
batch touches `tsconfig.base.json`, `nx.json`, `app.module.ts`, `route-map.spec.ts`,
`controller-registry.ts`, `controller-validation.spec.ts`or`eslint.config.mjs`. **Batch 11
does not even touch `project.json`** — the `seed-community` target already exists.
⚠️ **The one caveat**: **B10's exit-gate clause 1 ("the 8 week threads render as an ordered
course") needs THIS batch's rows to exist.** B10's unit and component specs are unaffected;
its **e2e and browser checks** are not. Either run B11 first, or let B10 seed a throwaway
course through the admin API and tear it down by id. **Both batches write to the same five
tables at runtime**, so whichever runs second must not count rows or assert emptiness — B7's
fixture discipline applies to both.

**Exit gate**:

- `nx run ptah-license-server:seed-community` creates **1 course, 8 modules, 8 lessons**, on
  top of Batch 8's unchanged 4 categories / 9 topics / 10 posts.
- **A second run produces ZERO creates** on every one of the six lines.
- Every lesson's `bodyMarkdown` is **byte-identical** to its source topic's post #1 `raw`,
  asserted by SHA-256 + byte length, DB vs file — **not eyeballed**.
- The summary matches §7.5's shape with Batch 8's three documented edits **plus** the three new
  entity lines, and **the arithmetic closes**: `17 = 9 + 8` topics and
  `19 = 10 written + 1 skipped + 8 curriculum` posts.
- The course is `slug=ptah-builders-cohort-1`, `visibility='cohort'`,
  `cohortKeys=['founding']` **resolved from the database, not hard-coded**, `published=true`,
  `sequential=false`.
- **The cohort key aborts loudly if no default `MemberGroup` exists** — not a fallback, not a
  wide-open course.
- **`youtubeVideoId` is `null` on all 8 lessons** ⇒ manual completion only (R2.3.4 +
  ASSUMPTION-8).
- **The AD-8 quarantine still holds**: the forbidden field name appears nowhere under
  `prisma/seed/`, **including this batch's new files** — the scan covers them.
- **Task 8.7 assertion 8 is CLOSED** (Task 11.6) — the round-trip through the `'member'`
  markdown preset, which Batch 8 correctly declined to fake.

---

### Carried in from Batch 8 — the seams, and the two things that will bite

- **`summary.ts` is data-driven.** `SeedSummary.entities` is
  `readonly { label: string; counts: EntityCounts }[]` and `formatSummary` loops it.
  **Append `courses` / `modules` / `lessons` entries; do NOT rewrite `formatSummary`.**
- **`CURRICULUM_TOPIC_IDS` (8 ids) is exported from `map-topics.ts:34`**, already asserted to
  have length 8, to be **disjoint** from `IMPORTED_TOPIC_IDS` (9), and to cover the 17 source
  ids **exactly**. **Consume it. Do not redeclare the list** — a second copy is how the two
  drift and a topic ends up in both halves or neither.
- **`SeedTransactionClient` (`community-seed.ts:114`) is a STRUCTURAL type.** Extend it with
  the `course`, `courseModule` and `lesson` delegates; **the recording double in the spec
  extends with it automatically** because it is typed against the same interface.
- **`findUnique` + `create`/`update`, NOT `upsert`** (Batch 8's Finding 4). `upsert` cannot
  tell the caller which branch it took, and _"a second run produces zero creates"_ is the exit
  gate's central observable — an upsert-based seed prints the identical summary whether it
  created 8 lessons or updated 8. The natural keys are `Course.slug`,
  `CourseModule @@unique([courseId, slug])`, `Lesson @@unique([moduleId, slug])`, and **the
  match key must be ASSERTED, not claimed** (Batch 8 asserts every `findUnique` where-clause's
  key set exactly).
- **Do NOT call `buildSlug()` from either lib's `common/slug.ts`** (Batch 8's Finding 5).
  Its collision resolver takes the set of slugs already in use, so run 2 would see run 1's
  `week-1`, resolve `week-1-2`, and **create a duplicate module**. Both `slug.ts` docblocks say
  they are create-path-only, and this is not the create path. **The slugs here are literals
  from §7.3 (`week-1` … `week-8`), and the lesson slug equals its module slug.**
- 🔴 **`raw`, never the rendered field.** AD-8's quarantine is enforced as a **source-text
  assertion over every file under `prisma/seed/`, this batch's included**, and the spec's
  needle is assembled from fragments (`['coo','ked'].join('')`) so the test that enforces the
  quarantine is not the first thing to violate it. **Assemble any needed literal the same
  way.**
- ⚠️ **`typecheck` does not cover `prisma/seed/`** (Batch 8's Finding 10):
  `tsc --noEmit -p tsconfig.app.json` has `include: ["src/**/*.ts"]`. Coverage comes from
  `ts-jest` (which type-checks the spec **and everything it imports**) and from
  `prisma/seed/tsconfig.json` run standalone. **A new seed module that the spec does not
  import is linted but NOT type-checked.** Import every new file from the spec, and run the
  standalone `tsc` explicitly.
- 🔴 **The byte-fidelity trap, and it is the single most valuable thing Batch 8 learned.** Its
  first byte-comparison **passed with `.trim()` added to the mapper**, because not one of the
  18 non-empty bodies has leading or trailing whitespace or a CR — _"a byte comparison against
  a corpus that happens to be invariant under a transform detects nothing."_ Same shape as
  Batch 6's trigram `EXPLAIN` at 0 rows. **Any "we compared it byte for byte" claim in this
  batch must say what the corpus is SENSITIVE to**, and Task 11.5 carries the hostile-body
  fixture that makes it sensitive.
- **The 11-post arithmetic is now `19 = 10 written + 1 skipped + 8 curriculum`**, not
  `11 + 8`. If the export is re-captured without small-action posts first, it becomes
  `18 = 10 + 8` and the skipped term disappears. **Read `EXPECTED_POST_COUNT` and
  `EXPECTED_NON_EMPTY_BODY_POSTS` from `discourse-export.schema.ts`; do not restate 19 or 18.**

---

### Task 11.1: Pre-flight — course tables, the seed census, the export ⏸️ PENDING

**Files**: (assertions only — no source file)
**Requirement refs**: MG-1.1, MG-1.5, RISK-G, §7.1, §7.3
**Dependencies**: Batch 9 Task 9.5 (migration 3 must have applied)

**Implementation details** — run each and paste the output into the report:

```
# 1. The five course tables exist and are EMPTY. If they are not empty, find out whose
#    rows they are before writing anything — Batch 10 may have seeded a throwaway course.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select table_name from information_schema.tables
    where table_name in ('courses','course_modules','course_lessons','lesson_progress','lesson_comments') order by 1;"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select 'courses',count(*) from courses union all select 'modules',count(*) from course_modules
   union all select 'lessons',count(*) from course_lessons;"

# 2. The cohort key MG-1.5 needs. RISK-G's original concern, re-run because the row can change.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select key, name, is_default from member_groups;"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select count(*) from member_group_assignments;"

# 3. Batch 8's committed seed is intact and this batch is adding to it, not replacing it.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select 'categories',count(*) from community_categories union all
   select 'topics',count(*) from community_topics union all
   select 'posts',count(*) from community_posts;"

# 4. The export is present and unmodified.
git log --oneline -1 -- docs/community/discourse-export.json
node -e "const d=require('./docs/community/discourse-export.json'); \
  console.log('categories', d.categories.length, 'topics', d.topics.length, \
  'posts', d.topics.reduce((n,t)=>n+t.posts.length,0));"
```

**Validation notes**:

- Expected: five tables, **all at 0** · `founding|Founding Members|t` and
  `member_group_assignments = 0` · `categories 4 topics 9 posts 10` · **`a22b03eb6`** and
  `categories 4 topics 17 posts 19`.
- 🔴 **`a22b03eb6`, NOT `6614f9e92`.** The latter is the **defective** snapshot whose 19 `raw`
  fields were `null` — the defect RK-9 exists for. Task 8.1's check 3 originally named it and
  has been corrected in this document; a checker following the old value would confirm the
  presence of the broken file.
- **RISK-G is empirically closed but the check still runs** — the row can change, and the abort
  in Task 11.3 is the control that stops a cohort-gated course from being seeded wide open.
  **If check 2 returns no default row, STOP** and set one through the existing admin surface
  first. **Do not weaken the abort.**
- **`member_group_assignments` must stay 0.** Do not seed an assignment to make anything pass.
  The zero-cohort state is what makes B9's and B10's visibility gates meaningful — with three
  entitled users and zero assignments, conflating entitlement with cohort locks all three out
  of the product on the first request, which is exactly the failure A-2 and R7.8 exist to
  catch.
- ⚠️ **If the course tables are NOT empty**, Batch 10 is probably running and has seeded a
  throwaway course. **Do not delete its rows.** Note the ids, proceed (the seed keys on
  `Course.slug = 'ptah-builders-cohort-1'`, which will not collide), and say so in the report.

**Verification**: all four checks pass with the expected values, pasted.

---

### Task 11.2: `map-course.ts` — the MG-1.5 mapping, and nothing derived at run time ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-course.ts` (NEW)

**Requirement refs**: MG-1.5, §7.3, R2.1.1, R2.1.3, R2.1.4, R2.3.4, AD-15, ASSUMPTION-8
**Dependencies**: Task 11.1
**Pattern to follow**: `apps/ptah-license-server/prisma/seed/map-topics.ts` — exported
constants, exported row interfaces, one exported `build*Rows(export, …)` pure function, and a
`MappingResult` that carries what the summary needs.

**Implementation details** — §7.3 verbatim, as data:

```
Course   slug = 'ptah-builders-cohort-1'
         title = 'Ptah Builders — Cohort 1'
         visibility = 'cohort'   cohortKeys = [<default MemberGroup.key>]
         published = true        sequential = false
         sortOrder = 100

CourseModule (8)  slug = 'week-1' … 'week-8'      sortOrder = 100, 200, … 800
  Lesson (1 each) slug = the module slug           sortOrder = 100
                  title = the SOURCE TOPIC TITLE, "Week N build thread — …" prefix RETAINED
                  bodyMarkdown = that topic's post #1 `raw`, COPIED VERBATIM
                  youtubeVideoId = null
```

- **Module titles are the descriptive halves MG-1.5 enumerates**, and they are a **literal
  table in this file**, mapped to the 8 `CURRICULUM_TOPIC_IDS` in order:
  _Foundation — workspace, boundaries, CI_ · _The domain — modelling and migrations_ ·
  _Authentication and tenancy_ · _Billing and entitlements_ · _The first vertical slice_ ·
  _Agents, memory and skills_ · _Hardening_ · _Deploy and launch_.
  **Do not derive them from the topic titles.** They are editorial content MG-1.5 supplies, and
  a derivation would silently change the moment a topic is retitled.
- **`sortOrder` is sparse (100, 200, …)**, matching `SORT_ORDER_STEP` from Task 9.8 — R8.8's
  reason: a single later insert must not force a full renumber.
- 🔴 **`sequential: false`, deliberately.** The source has no completion gate and MG-1.5 asks to
  preserve **ordering**, not to invent gating. State it in the docblock.
- 🔴 **One module per week, NOT one module of eight lessons.** R2.4.1's date-based unlock
  operates on **modules**, so per-week modules are what makes weekly release expressible later
  **without a restructure**. §7.3 says exactly this; carry the sentence in.
- 🔴 **`bodyMarkdown` is copied VERBATIM — no transform, no re-wrap, no entity decoding.**
  §7.3's own words. The one Week-N body is already `**bold**` + prose + a `- ` bullet list and
  renders correctly through `libs/frontend/markdown`'s `'member'` preset as-is (Task 11.6
  proves that rather than asserting it).
- **`youtubeVideoId: null` on all 8** ⇒ **manual completion only** (R2.3.4). Combined with
  ASSUMPTION-8 (`videoDurationSeconds === null` ⇒ manual-only), this makes the manual path the
  **live** path for every lesson in this workspace — which is why B10's no-video layout is the
  default case and not an edge case. Say so in the docblock so the frontend reader finds it.
- **`createdBy` is `null`** — A-4's reasoning transfers: no `User` row is fabricated, and the
  seed writes no author. ⚠️ **Consequence worth stating: Task 9.14's `setAnswered` "admin OR
  lesson author" check therefore resolves to admin-only for every seeded lesson**, because
  `Course.createdBy` is null. That is correct and not a defect; record it so nobody reads it as
  one.
- **The 8 lesson bodies come from `CURRICULUM_TOPIC_IDS`' post #1.** ⚠️ **Read `EXPECTED_*`
  constants from `discourse-export.schema.ts`; do not restate 17/19/18.** And note that the
  skipped empty-body post (topic 13, post #2) is in the **community** half, not the curriculum
  half — so **all 8 curriculum bodies are non-empty** and no skip logic applies here. Assert
  that rather than assuming it: a curriculum topic with an empty post #1 must **abort**, because
  a blank lesson body is a member-visible defect and there is nothing to skip to.

**Validation notes**:

- **Timestamps**: carry the source topic's `createdAt` onto the `Course`? **No — and say
  why.** §7.3 specifies timestamps for topics and posts (MG-1.7) and says nothing about the
  course. The course is a **new editorial object** assembled in 2026-08 from eight threads
  written across three weeks; giving it one of their timestamps would be a fabricated claim
  about when the curriculum was authored. **`Course.createdAt` defaults to `now()`.**
  **Lesson `createdAt`, however, SHOULD carry its source topic's** — the body is that topic's
  body and the date is a true fact about it. **State which you did for each of the three
  models**, because a reviewer will check.
- **Everything in this file is pure.** No Prisma, no `process.env`, no clock read except the
  one the caller passes in. That is what lets Task 11.5 assert the mapping without a database.

**Verification**:

```
npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=community-seed
npx tsc --noEmit --project apps/ptah-license-server/prisma/seed/tsconfig.json
```

Green. The mapping's unit cases live in Task 11.5.

---

### Task 11.3: Wire the course into `community-seed.ts` — one transaction, natural keys, the abort ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (MODIFY)

**Requirement refs**: MG-1.3, MG-1.5, §7.4, AD-15, RISK-G
**Dependencies**: Task 11.2
**Pattern to follow**: `community-seed.ts`'s existing category and topic write paths — the
`findUnique` → `create`/`update` shape, the `SeedTransactionClient` typing, and the
`refreshBodies` gate.

**Implementation details**:

- **Extend `SeedTransactionClient`** (`:114`) with `course`, `courseModule` and `lesson`
  delegates. It is a **structural type**, so the recording double in the spec picks them up
  from the same interface.
- **The whole import — categories, topics, posts AND now the course — stays in ONE
  `$transaction`** (§7.4). A mid-run failure leaves the database untouched. Batch 8 set
  `{ maxWait: 10s, timeout: 60s }` because the default 5 s interactive budget is tight for ~60
  round trips on a cold pool **and a timeout there presents as a mapping bug**. This batch adds
  ~17 more round trips — **re-check the timeout and raise it if needed, stating the new value
  and the measured wall time.**
- 🔴 **The cohort key resolves from `MemberGroup where isDefault: true` AT RUN TIME, and the
  seed ABORTS with an actionable message if none exists** (§7.3, RISK-G). Not a fallback to
  `'founding'`, not an empty `cohortKeys`, not a `visibility: 'member'` downgrade. **The abort
  is the control that stops an ungated cohort course being seeded wide open**, and it is the
  same resolution `map-categories.ts` already does for `builders-lounge` — **reuse that
  resolver rather than writing a second one.**
- **Natural keys only** (AD-15): `Course.slug`, `CourseModule @@unique([courseId, slug])`,
  `Lesson @@unique([moduleId, slug])`. **No synthetic `sourceRef` column** — RK-1 rejected one
  and the schema has none.
- **`update` payloads EXCLUDE `bodyMarkdown` by default when the row already exists** (§7.4) —
  a re-run must not clobber an admin's subsequent edit. **`--refresh-bodies` is the opt-in**,
  and it must log **one line per overwritten row** with the module slug, the lesson slug and
  both body lengths, **enough to reconstruct what was destroyed**. Batch 8's `--refresh-bodies`
  already does this for posts; extend the same logger, do not add a second.
- **`--refresh-bodies` must reach lessons.** It would be very easy to wire the new writes and
  forget the flag, and the failure is silent — the flag would appear to work while leaving
  lesson bodies stale. **Assert it** (Task 11.5).
- **An unrecognised CLI flag still aborts** (Batch 8's `parseArgs`, `:442`). Do not add a new
  flag; there is nothing this batch needs one for.

**Validation notes**:

- **The course write must not touch the community rows and vice versa.** Assert the recorded
  call sequence: category writes, topic writes, post writes, then course/module/lesson writes,
  all inside one transaction, with **no interleaving that would make a partial failure
  ambiguous**.
- **Idempotency is the central observable.** Run 2 must report `created 0` on **all six** entity
  lines and non-zero `updated`. Row counts unchanged.

**Verification**:

```
npx nx run ptah-license-server:seed-community --skip-nx-cache            # run 1
npx nx run ptah-license-server:seed-community --skip-nx-cache            # run 2
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select 'courses',count(*) from courses union all select 'modules',count(*) from course_modules
   union all select 'lessons',count(*) from course_lessons;"
```

Run 1: `courses created 1 · modules created 8 · lessons created 8`, on top of unchanged
`4 / 9 / 10`. Run 2: **zero creates on every line**, non-zero updates, row counts identical.
Paste both summaries in full.

---

### Task 11.4: Extend the summary and the arithmetic assertions ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\summary.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (MODIFY — the assertions block)

**Requirement refs**: MG-1.10, §7.5
**Dependencies**: Task 11.3
**Pattern to follow**: `summary.ts`'s existing `SeedSummary.entities` array and `formatSummary`
loop — **append rows; do not rewrite the formatter.** Batch 8 built it data-driven for this.

**Implementation details**:

- Three new `entities` rows: `courses`, `modules`, `lessons`.
- **Complete §7.5's two assertion lines, which Batch 8 left half-satisfied:**
  ```
  assertions: source topics 17 = 8 curriculum + 9 topics OK
  assertions: source posts 19 = 10 written + 1 skipped (empty source body) + 8 curriculum bodies OK
  ```
  **Both must now close with real numbers on both sides**, computed from
  `IMPORTED_TOPIC_IDS.length`, `CURRICULUM_TOPIC_IDS.length` and the `EXPECTED_*` constants —
  **not restated as literals.** Batch 8's line already reads this way for topics; the posts
  line gains the curriculum term.
- **Batch 8's three documented deviations from §7.5's literal block stand and must not be
  "fixed":**
  1. the `` 0 from `<rendered-field>` `` clause is **omitted**, because the literal string
     cannot appear in this directory (AD-8's quarantine, enforced as a source-text assertion) —
     §7.5's own text has this problem;
  2. `->` instead of `→`, because an arrow in stdout is at the mercy of the console code page
     on Windows and would garble captured evidence;
  3. the `unmatched usernames: system (19 posts)` line keeps its **trailing explanatory
     clause** — 19 is the SOURCE total while a single run writes a subset, and §8.6 explicitly
     asks that the arithmetic not read as a bug. ⚠️ **After this batch the 19 is finally fully
     accounted for** (10 + 1 + 8), so **update that clause's wording** rather than leaving it
     saying the count is partial.
- **`unmatchedUsernames` does not change**: all 19 source posts are authored by `system`,
  which matches no `User`, so `authorId = null` on the 8 lesson bodies' provenance as well.
  **No `User` row is created** (A-4) — the poisoned `user` delegate in the spec's double
  enforces it at run time, not just at compile time.

**Verification**:

```
npx nx run ptah-license-server:seed-community --skip-nx-cache
```

The summary shows six entity lines and **both** assertion lines closing. Paste it verbatim.

---

### Task 11.5: Extend `community-seed.spec.ts` — and make the byte check SENSITIVE ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.spec.ts` (MODIFY)

**Requirement refs**: MG-1, RK-9, §7.6, AD-8, AD-15
**Dependencies**: Tasks 11.2–11.4
**Pattern to follow**: the file's own existing structure — the **recording double** (so _"wrote
nothing"_ is asserted as **zero recorded calls**, not as an empty table, because an empty table
is also what a seed that never ran produces), the **poisoned `user` delegate** (a `Proxy` that
throws on any property access — omitting `user` would prove only that the seed does not
_compile_ against it), and the **derived fixtures** written to `os.tmpdir()` (a hand-copied
42 KB fixture is a snapshot of an export that **has already been re-captured once**).

**Implementation details** — the new cases:

1. **Counts**: 1 course, 8 modules, 8 lessons written; and the disjointness/coverage assertions
   extended so `CURRICULUM_TOPIC_IDS` is now **consumed** by a writer rather than only excluded
   by one. (The existing assertion that no curriculum topic is imported as a _topic_ — by id
   **and** by a `^week-\d` slug guard — must still pass, and now means something stronger.)
2. **Natural keys asserted, not claimed**: every `course`/`courseModule`/`lesson` `findUnique`
   where-clause's key set is exactly `['slug']`, `['courseId_slug']`, `['moduleId_slug']`.
3. **Idempotency**: a second run against the recording double produces zero `create` calls on
   all three new models.
4. **`--refresh-bodies` reaches lessons**: edit a lesson body, re-run **without** the flag →
   unchanged; re-run **with** it → restored, and **exactly one log line** naming the module
   slug, the lesson slug and both lengths. **This is the case most likely to be missing and its
   absence is silent.**
5. **The cohort abort**: with no default `MemberGroup`, the seed aborts and writes **nothing**
   (zero recorded calls) — including that it does not fall back to `visibility: 'member'` or to
   an empty `cohortKeys`.
6. 🔴 **BYTE FIDELITY, MADE SENSITIVE.** Batch 8's Finding 6: its first byte comparison
   **passed with `.trim()` added to the mapper**, because no export body has leading/trailing
   whitespace or a CR. **Reuse the hostile-body fixture Batch 8 built** — a derived export
   whose curriculum body carries leading and trailing whitespace, a tab, a CRLF, an HTML
   entity, a literal tag, a non-ASCII em-dash and a trailing blank line — and assert byte
   equality on the **lesson** write. **Then prove it: add `.trim()` to the lesson mapper, watch
   this case go red, revert.** Paste both runs.
7. **A curriculum topic with an empty post #1 ABORTS** (not skips). The community half skips an
   empty small-action reply because nothing is lost; a blank **lesson body** is a member-visible
   defect and there is nothing to skip to. Derived fixture, one mutation.
8. **A `raw: null` and a U+FFFD fixture still abort and write nothing** — re-run the existing
   cases with the curriculum writer present, because the abort now has more to _not_ do.
9. **No `User` row is created** — the poisoned delegate covers it, but add the explicit count
   assertion for the new writes.
10. **The AD-8 quarantine scan covers this batch's new file.** `map-course.ts` must appear in
    the scanned set, and the scan's "saw at least N files" floor must move from 11 to 12 —
    **otherwise a glob that silently matches nothing still passes.** Assemble any needed
    literal from fragments, as the spec does.

**Validation notes**:

- **The deliberate-failure discipline is the point of this task, not an extra.** Task 8.7's
  instruction — _"they must be seen to fail against a correct implementation before they are
  believed"_ — produced five mutations in Batch 8, **one of which revealed a vacuous
  assertion**. Apply at least three here: the `.trim()` on the lesson mapper (case 6), dropping
  the explicit `createdAt` from the lesson write, and removing `map-course.ts` from the
  quarantine scan's file list. **Revert each immediately and `diff` against a pre-mutation
  backup** to prove the tree is byte-identical.
- **Every new seed module must be imported by this spec** or it is linted but **not
  type-checked** (Batch 8's Finding 10). `map-course.ts` is imported here; confirm it.

**Verification**:

```
npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=community-seed
npx tsc --noEmit --project apps/ptah-license-server/prisma/seed/tsconfig.json
```

Green, with the test count stated (Batch 8 left it at **38**). All three deliberate-failure
pairs pasted, and a `diff` confirming every mutated file is back to byte-identical.

---

### Task 11.6: Close Batch 8's assertion 8 — the `'member'` preset round-trip ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\learning\seeded-body-round-trip.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\__fixtures__\curriculum-body.md` (NEW)

**Requirement refs**: §7.6, MG-1.9, NFR-S2, PRE-4, AD-1
**Dependencies**: Task 11.3 (a seeded body to copy) — **and this task lands in `libs/web/**`,
which is Batch 10's territory.\*\* See the ownership note.

🔴 **THIS CLOSES A CARRIED ITEM THAT BATCH 8 CORRECTLY REFUSED TO FAKE.**
§7.6's list ends with _"an imported body round-trips through `libs/frontend/markdown`'s
`'member'` preset without content loss"_. Batch 8 could not implement it and **did not weaken
it** — Task 8.7's own instruction was _"do not weaken the assertion to a regex over markdown
syntax; that tests nothing"_, and none was written. Its Finding 7 also corrected the predicted
blocker: `@nx/enforce-module-boundaries` **permits** the import (`ptah-license-server` is
`scope:app`, `libs/frontend/markdown` is `["scope:shared","type:ui"]`). The three **real**
blockers are:

1. `apps/ptah-license-server/jest.config.ts` sets `testEnvironment: 'node'` and DOMPurify needs
   a DOM — changing it would affect all 111 tests in that project;
2. **`createMemberSanitizer` is module-private** (`provide-markdown-rendering.ts:230`) and
   reachable only through Angular DI; the barrel exports `MarkdownBlockComponent`,
   `provideMarkdownRendering`, `MarkdownRenderingConfig` and `getMarkedExtensions` — and
   nothing else;
3. the natural home is the frontend side.

**All three dissolve in `libs/web/members`**, where jsdom is the environment, the real
`provideMarkdownRendering({ extensions: 'member' })` is already used by the community composer
specs (B7's D-6), and `marked|ngx-markdown` are already in `transformIgnorePatterns`.

**⚠️ OWNERSHIP — resolve this before starting, do not just take it.** This file is in Batch
10's file set. Two clean options and **the report must say which was used**:

- **(a) Batch 10 owns it** — fold it into Task 10.11 and drop it from Batch 11. Cleanest if the
  batches run sequentially.
- **(b) Batch 11 owns it and Batch 10 is told** — acceptable only if B10 has already landed or
  is not running. **Two batches editing `libs/web/members` concurrently is exactly the
  collision `context.md`'s serialisation rule exists to prevent.**
  **Recommended: (a)** if B10 runs first; **(b)** otherwise, with an explicit note in both
  reports.

**Implementation details**:

- **The fixture is a real seeded body, copied byte-for-byte** from `course_lessons.body_markdown`
  (or from the export's `raw` for a `CURRICULUM_TOPIC_IDS` topic — same bytes). Not a
  hand-written approximation: §7.3 records that the Week-N body is `**bold**` + prose + a `- `
  bullet list, and the round-trip is only meaningful against the content that actually ships.
- **Render through the REAL preset**, not a mock: `provideMarkdownRendering({ extensions:
'member' })` in the `TestBed`, and read the rendered output of `<ptah-markdown-block
variant="auto">`. B7's jest-config comment says exactly why: _"mocking the renderer would
  leave NFR-S2's single-chokepoint claim asserted only against source text and never against
  the path a browser actually takes."_
- **"Without content loss" needs an operational definition, and this is where a lazy version of
  this test would go wrong.** Assert, in order of strength:
  1. **Every non-whitespace character of the source appears in the rendered `textContent`**,
     in order — the strongest cheap statement of "nothing was dropped". Compute it by stripping
     markdown syntax characters from the source and asserting the residue is a subsequence of
     the rendered text.
  2. **The structural elements survive**: `<strong>` for the `**bold**`, a `<ul>` with the right
     number of `<li>` for the `- ` list, and the paragraph count.
  3. **Nothing was ADDED**: `querySelector('script')` is null, there is no `on*` attribute
     anywhere in the output, and no `<iframe>`.
  4. **Read the bound `content` input via `By.directive(MarkdownBlockComponent)`** as well —
     _which text reaches the one sanitizer_ is the more precise question, and `ngx-markdown`
     parses in a promise so `textContent` alone makes this a timing test (B7's technique note).
- **Prove it is not vacuous**: a hostile control body containing `<img src=x onerror=alert(1)>`
  and `<script>` must render those as **visible characters or be stripped**, with
  `querySelector('img')`/`('script')` null and `innerHTML` containing the escaped form. B7's
  `HighlightTextPipe` spec asserts exactly this shape and it is the right one.

**Validation notes**:

- **`libs/frontend/markdown` is NOT modified by this task.** PRE-4: the `'member'` preset lives
  inside `provide-markdown-rendering.ts` and nowhere else; no second renderer, no second
  sanitizer, no `[innerHTML]`. If this task finds it needs a new export from that lib, **that
  is a finding to report, not a change to make** — it has a VS Code webview consumer that would
  need re-verification.
- **This spec is inside `markdown-chokepoint.spec.ts`'s glob.** It legitimately contains the
  forbidden strings to assert their absence, so it must be inside that spec's `.spec.ts`
  exclusion — B7 excluded other spec files by absolute path with the reason stated, and added
  an anti-vacuity case proving the exclusion did not over-reach.

**Verification**:

```
npx nx test web-members --skip-nx-cache --testPathPatterns=seeded-body-round-trip
```

Green, with the four assertion classes and the hostile control. **State in the report that
Batch 8's Task 8.7 assertion 8 is now closed**, and where.

---

### Task 11.7: Live verification, residue, and the exit gate ⏸️ PENDING

**Files**: (assertions only — no source file)
**Requirement refs**: §7.5, §8.2 P3, PRE-7
**Dependencies**: Tasks 11.1–11.6

**Implementation details** — mint a token per `V-TOKEN` (headless: sign the documented
`JWTPayload` with `JWT_SECRET` from the workspace-root `.env` for the dev user's real
`users.id`, short expiry, **delete the token file afterwards**) and run, **with `-b` and not
`-H`**:

```
# The course is visible to the dev account? It is visibility='cohort' with cohortKeys=['founding']
# and member_group_assignments is EMPTY — so it must be INVISIBLE (404), never 403.
curl -s -o /dev/null -w '%{http_code}\n' -b "ptah_auth=$TOKEN" \
  http://localhost:3000/api/v1/members/courses/ptah-builders-cohort-1
curl -s -b "ptah_auth=$TOKEN" http://localhost:3000/api/v1/members/courses | jq 'length'

# Byte fidelity, DB vs file — SHA-256 and byte length per lesson, diffed.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select m.slug||'/'||l.slug||' '||encode(sha256(convert_to(l.body_markdown,'UTF8')),'hex')
          ||' len='||octet_length(convert_to(l.body_markdown,'UTF8'))
     from course_lessons l join course_modules m on m.id=l.module_id order by m.sort_order;"

# Ordering and the cohort key, resolved not hard-coded.
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select slug, visibility, cohort_keys, published, sequential from courses;"
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select m.sort_order, m.slug, m.title, l.slug, l.sort_order, l.youtube_video_id is null
     from course_modules m join course_lessons l on l.module_id=m.id order by m.sort_order;"
```

🔴 **THE EXPECTED RESULT IS A `404`, AND THAT IS THE GATE PASSING, NOT FAILING.** The seeded
course is `visibility: 'cohort'` with `cohortKeys: ['founding']`, and
`member_group_assignments` is **empty**, so the dev account — entitled, admin, zero cohorts —
**must not see it**: `404`, never `403` (R1.1.3's posture, applied to courses by ASSUMPTION-7).
`GET /members/courses` returns `0` courses for this account. **This is the same one-account
proof of both halves of A-2 that B6C ran live for categories.** Do **not** "fix" it by seeding
an assignment (`context.md` forbids it) or by downgrading the course to `visibility: 'member'`
(that would silently ungate the curriculum).
**To see the course, create the assignment INSIDE the check and REMOVE it afterwards** —
`insert … into member_group_assignments`, re-run the two `curl`s (expect `200` and `1`), then
delete the row by id and re-assert `member_group_assignments = 0`. **Paste all four responses
and the before/after count.**

**Validation notes**:

- **Byte fidelity is asserted by DIFFING two hash lists**, DB against file, exactly as Batch 8
  did — **byte length alongside the digest**, so a hash collision is not the only thing standing
  between a mangled body and a green check.
- **Ordering**: modules at 100…800 in the §7.3 order, one lesson each at 100,
  `youtube_video_id is null` **true** on all 8.
- **Residue**: every probe row removed **by id**, in one transaction, and the counts restated.
  Batch 6C, 6.1, 7 and 7.1 all did this. **Do not delete audit rows** written by mutations that
  really happened (B6C's rule) — but **do** delete rows referring to scratch entities that no
  longer exist (B6.1's refinement). This batch's writes are the seed's own and stay.
- **`member_group_assignments` must be back to 0** and the committed community seed must still
  read `categories=4 topics=9 posts=10`.
- ⚠️ **Batch 10 may be running.** If the course tables hold rows that are not this seed's, say
  so and leave them alone.
- **PRE-7 / staging**: the working tree carries a concurrent process's WIP and **it has staged
  into the index before** (Batch 8's report warns of 19 foreign staged files). Stage
  path-by-path: `git add apps/ptah-license-server/prisma/seed` and then
  `git diff --cached --name-only | grep -Ev '^apps/ptah-license-server/prisma/seed/'` **must
  print nothing**. `.ptah/**` is gitignored, so reports are not committable and need no
  excluding.

**Verification**:

```
npx nx run-many -t eslint:lint,typecheck,test -p ptah-license-server --skip-nx-cache
npx nx run ptah-license-server:seed-community --skip-nx-cache    # a third run: still zero creates
```

---

**Batch 11 Verification (exit gate)**:

- `seed-community` run twice produces **zero creates** the second time, on all six entity
  lines; a third run confirms it.
- The summary matches §7.5 with Batch 8's three documented edits plus the three new entity
  lines, and **both arithmetic assertions close**: `17 = 9 + 8` and
  `19 = 10 + 1 skipped + 8`.
- **1 course / 8 modules / 8 lessons**, on top of an unchanged `4 / 9 / 10`.
- Every lesson body **byte-identical** to its source `raw`, proven by a diffed SHA-256 + byte
  length list, **and the check proven SENSITIVE** by the `.trim()` mutation.
- `cohortKeys` **resolved from the database**; the seed **aborts** with no default
  `MemberGroup`, writing nothing.
- The course is **invisible (404, never 403)** to the zero-cohort dev account and **visible**
  once a temporary assignment exists — both pasted, and the assignment removed.
- **`youtubeVideoId` null on all 8** ⇒ manual completion only.
- **The AD-8 quarantine holds over this batch's new files**, with the scan's file floor moved.
- **Batch 8's Task 8.7 assertion 8 is CLOSED** (Task 11.6), or explicitly reassigned to Batch
  10 with both reports saying so.
- **At least three deliberate-failure proofs** run and reverted, with `diff` confirming
  byte-identical files.

---

# PHASE 4 — Live and private sessions (refined at the Phase-3/Phase-4 boundary, 2026-08-08)

**Ships**: a member sees one merged Live feed (Ptah streams + Google Calendar cohort
sessions + their own accepted private session), and can request a private session that an
admin accepts into a real Calendar event with a real Meet link.

---

## Batch 12: P4-BE — live sessions, private sessions, migration 4 ⏸️ PENDING

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential — and **dispatch it in THREE parts, as Batch 6 and Batch 9
were**. 16 tasks across one new directory, one extended directory, one migration and five
shared-registry files.

| Dispatch | Tasks         | Shape                                                                                                                                                  |
| -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **12A**  | 12.1 – 12.5   | Pre-flight, `schema.prisma`, **migration 4**, the contracts, the audit vocabulary. Ends with the one irreversible step and nothing built on top of it. |
| **12B**  | 12.6 – 12.9   | `live-sessions/common/`, the two live services, the session-request service. No controller, no module, no registry edit.                               |
| **12C**  | 12.10 – 12.16 | DTOs, four controllers, `LiveSessionsModule`, the three registries, the census constants, the hub section, and the exit-gate proofs.                   |

**Rationale**: Lives in `libs/api/community` **by design** (AD-6) — R4 extends
`SessionRequest` + `GoogleSessionsModule`, and a new lib would reconstruct the
discourse↔member-groups cycle the README warns about.
**Dependencies**: Batch 9 (the `youtube` lib — §8.1), Batch 5/6/9 (migration order)
**Preconditions**: PRE-1, PRE-2, **PRE-5**, PRE-6, PRE-7
**Tasks**: 16

**Scope boundary (PRE-5, RK-1)**: **no Meet API is called and none is built.** The Calendar
API already returns the link on event creation and `BuildersSession.meetLink` already
resolves it. Also out: no notifications (Batch 14 owns every producer), no websocket, no
attendance tracking, no recording pipeline, no live chat, no reminder cron, no
`LiveSession` ↔ `Course` linkage, no payment change of any kind (R4.10 — `isFreeSession`,
`paymentStatus` and `paddleTransactionId` keep their exact current semantics).

**File set** (for the serialisation claim): `libs/api/community/**`,
`libs/api-contracts/community/**`, `libs/api/audit/src/lib/audit-log.types.ts`,
`libs/api/member-hub/src/lib/sections/sessions.section.ts` (+ its spec),
`apps/ptah-license-server/prisma/schema.prisma`,
`apps/ptah-license-server/prisma/migrations/20260826090000_live_and_private_sessions/**`,
`apps/ptah-license-server/src/app/app.module.ts`,
`apps/ptah-license-server/src/testing/controller-registry.ts`,
`apps/ptah-license-server/src/common/{route-map,controller-validation}.spec.ts`.

🔴 **B12 CANNOT overlap ANYTHING that touches a registry.** It edits
`controller-registry.ts`, `route-map.spec.ts`, `controller-validation.spec.ts`,
`app.module.ts` and `schema.prisma`. It does **not** need a `tsconfig.base.json` alias —
that is the one shared file B9 touched and this batch does not, because nothing new is a
lib.

**Exit gate (§8.2 P4, backend half)** — five clauses, each with a named owner task:

1. **An accepted request produces a Calendar event whose Meet link is persisted, and whose
   id reconciles on reschedule AND on decline** (Task 12.9, proved in 12.16).
2. **With `GOOGLE_OAUTH_*` unset**: members submit, admins see the queue, accept returns
   `503 { reason: 'scheduling_unavailable' }` and **writes nothing**; nothing `500`s
   (Tasks 12.9 + 12.16). ⚠️ **This is the DEFAULT state of this workspace** — ASSUMPTION-10.
3. **The AD-3 merge emits a claimed Calendar event exactly once**, `source: 'ptah'`, with
   the Calendar `meetLink` merged in (Task 12.8), asserted **and proven by deliberate
   failure**.
4. **`MemberSessionRequest` never carries `calendarEventId`, `paymentStatus`,
   `paddleTransactionId`, `isFreeSession` or any requester identity** (Task 12.10 mapper +
   the NFR-S4 field-absence spec), asserted the way `MemberPack`'s `notes` absence is.
5. **F-1 is closed**: `Course`, `CourseModule` and `Lesson` carry `deleted_by`, and
   `CoursesService`'s three soft deletes write it (Tasks 12.2 + 12.3 + 12.5).

Plus the standing structural gates: `route-map` (RI-1/RI-2/RI-3) · `controller-validation`
(`NAMED_PRIMITIVE_PARAM_COUNT` **exactly 6**, `MIN_TOTAL_PAYLOAD_PARAMS` re-derived and
raised) · `admin-guards` G1 · `app.module.spec` boots · migration 4 applied against the
running `ptah_db` and confirmed by `npx prisma migrate status`.

---

### Ground truth Phase 4 inherits — read before starting

**Verified against the tree on 2026-08-08. Do not re-derive these and do not plan against
the plan's stale facts.**

1. **`libs/api/community` is `["scope:api","type:feature"]`** (`project.json`), so it MAY
   depend on `api-youtube` (`type:util`). RISK-Q/RISK-F do not bite. It already carries its
   own `eslint.config.mjs` and `package.json`, so `npx nx eslint:lint api-community` exists.
2. **The lib has NO `common/` directory today.** `libs/api/forum/src/lib/common/` and
   `libs/api/learning/src/lib/common/` are the two existing sibling copies of
   `member-context.ts`, `admin-audit.ts`, `soft-delete.ts`, `optional-field.ts` and
   `visibility.ts`. Task 12.6 makes a **third** copy, deliberately — see ASSUMPTION-11.
3. **Four of the five Phase-4 contracts ALREADY EXIST** and were shipped by Batch 2:
   `HubSessionSummary` + `HUB_SESSION_KINDS` (`member-live.contract.ts`),
   `MemberSessionRequest` (`member-session-request.contract.ts`), `AdminSessionRequest`
   (`admin/admin-session-request.contract.ts`), `SESSION_REQUEST_STATUSES`
   (`shared/session-request-status.ts`). **Do not re-declare them.** `member-live.contract.ts`
   says in terms that `LiveFeedItem` and the replay list are added **in THIS file** by
   Batch 12. Only `LiveFeedItem`, the `GET /members/live` envelope and `AdminLiveSession`
   are new.
4. **`HUB_SESSION_KINDS` already declares `'calendar' | 'live' | 'private'`.** Task 12.15
   therefore adds **data**, not a field (R6.6). `sessions.section.ts`'s `earliest()`
   docblock already names this batch as the caller that will concatenate two ordered lists
   into an unordered one — it already sorts rather than trusting.
5. **`GoogleCalendarProvider` has every method R4 needs and none needs writing**:
   `createEvent(input, sendUpdates='none')` with `conferenceDataVersion=1` (which is what
   actually mints the Meet link), `patchEvent`, `deleteEvent` (204 → `ok:true`; 410 →
   `ok:false, status:410`, to be treated as idempotent, not fatal), and `isEnabled()` /
   `isWritable()`. **Every method returns a value and NEVER throws** — feature-off is
   `{ ok:false, skipped:true }` with no network round-trip. PRE-5 is discharged by reading
   this file, not by building anything.
6. **`google-event.mapper.ts` already resolves the Meet link** from `hangoutLink` /
   `conferenceData`. Reuse `toBuildersSession` / the link resolver; do not write a second
   one. **This is the whole of PRE-5.**
7. **The disabled-log-once idiom is `sessions.service.ts:60` + `:427-438`**
   (`private loggedDisabled` + `private isEnabledOrLogOnce()`), NOT `GoogleAuthProvider`'s
   `loggedScopeVerdict`. RISK-R, still true.
8. **Census constants**: `MIN_TOTAL_PAYLOAD_PARAMS = 67` (`controller-validation.spec.ts:197`,
   a **floor**), `NAMED_PRIMITIVE_PARAM_COUNT = 6` (`:223`, **exact equality** — one
   `@Query('status') status: string` anywhere in this batch fails the build),
   `UNVALIDATED_DEBT = []` (`:78`). `PREFIX_EXCEPTIONS` holds one pre-existing entry and
   `KNOWN_PREFIX_DEBT` is `[]` — **add nothing to either**.
9. **The four new prefixes are disjoint literal siblings — checked segment-wise, the way
   RI-1 actually checks (RISK-N's shape, and it does NOT recur).**
   `v1/members/live` vs the seven existing `v1/members/*` literals — segment 3 differs.
   `v1/members/session-requests` vs `v1/members/sessions` — segment 3 differs (and note
   these are not even _string_ prefixes of each other).
   `v1/admin/live-sessions` and `v1/admin/session-requests` vs `v1/admin/sessions`,
   `v1/admin/courses`, `v1/admin/course-modules`, `v1/admin/lessons`, `v1/admin/packs`,
   `v1/admin/groups`, `v1/admin/community/{categories,topics,posts}` — segment 3 differs in
   every pair. ⚠️ **Do NOT "simplify" `v1/admin/live-sessions` to `v1/admin/sessions/live`**
   — that WOULD nest under `v1/admin/sessions` and reproduce RISK-J exactly.
10. **`AdminAuditAction` and `AdminAuditTargetType` have no `LiveSession` or
    `SessionRequest` member yet.** Task 12.5 adds them. Referencing one before it exists
    does not compile — which is the good outcome and is how Batch 9B found F-1.
11. **9B's F-1 is still open and this batch closes it.** `Course`, `CourseModule` and
    `Lesson` have `deleted_at` and no `deleted_by`; only `LessonComment` has both.
    `libs/api/learning/src/lib/common/admin-audit.ts` and `CoursesService`'s class docblock
    both record the gap in prose and both must be updated when the column lands. **Migration
    4 is the slot 9B's F-1 named.**
12. **The command shapes that work here** (unchanged from B9): `nx lint` **does not exist**
    for `libs/api/*` — the target is `eslint:lint`. Jest 30's flag is `--testPathPatterns=`.
    `npm run test` runs 3 unrelated projects and is never the gate. **Never `nx affected`** —
    a second process commits to this branch. Always an explicit project list with
    `--skip-nx-cache`.
13. 🔴 **`V-MIG` IS SUPERSEDED. Do NOT run `prisma migrate dev`, `db push` or
    `migrate reset`.** Hand-author the folder; generate the DDL with
    `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
    apply with `npx prisma migrate deploy`; confirm with `npx prisma migrate status`.
    **Prisma 7.7.0 writes a dotenv banner to STDOUT that corrupts a redirected `.sql`** —
    strip it. `prisma.config.ts` loads `apps/ptah-license-server/.env`, **which does not
    exist**, so `DATABASE_URL` must be passed explicitly on the command line.

---

### Risks surfaced by the Phase-4 refine pass

| #          | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Sev      | Mitigation                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RISK-U** | 🔴 **The accept path spans two systems and the failure window between them is the requirement.** §3.5 fixes the order — Calendar event FIRST, DB row SECOND — and mandates that a DB failure after a successful create **deletes the event** before returning. Written the natural way (`$transaction` around both) the event survives a rollback and the member is invited to a session the product has no record of; written in the other order the DB says `scheduled` while no event exists. **Neither failure is visible to a unit test that mocks one side.** | **HIGH** | Task 12.9 puts the whole sequence in ONE named method with the compensating delete in a `catch`, and its spec asserts all four rows of the §3.5 table **including** that the compensating `deleteEvent` was called with the id that was created. Task 12.16 proves the compensation by **deliberate failure** — force the DB write to throw, watch `deleteEvent` fire, revert. |
| **RISK-V** | 🔴 **The AD-3 merge de-duplicates on `calendarEventId`, and `listEvents` returns EXPANDED RECURRENCE INSTANCES whose ids are NOT the master id.** `sessions.service.ts:236-239` already documents this trap for cohort scoping: comparing only `event.id` leaks/duplicates every occurrence of a recurring series, and the master id lives in `recurringEventId`. A `LiveSession` that claims a recurring master would therefore de-duplicate **zero** of its instances and the feed would show every session twice.                                                | **HIGH** | Task 12.8's claim-set check matches **BOTH** `event.id` **AND** `event.recurringEventId`, exactly as `scopeToCohort` does, and the spec carries a recurring-instance fixture whose `id !== recurringEventId`. Deliberate-failure proof: drop the `recurringEventId` arm, watch the duplicate appear, revert.                                                                   |
| **RISK-W** | **`LiveFeedItem.state` is derived from a clock, and a naive `startsAt < now < endsAt` makes a session with `endsAt: null` never live and a replay-less past session `'upcoming'` for ever.** Three states over two nullable timestamps and two nullable video ids is more branching than it looks.                                                                                                                                                                                                                                                                  | MED      | Task 12.8 declares the derivation in **one** pure exported function with `now` as an explicit parameter (never `new Date()` inside), and its spec is table-driven over the full cross-product of (`endsAt` null/set) × (`replayYoutubeVideoId` null/set) × (before/during/after). `LIVE_FALLBACK_MINUTES` is a named constant for the `endsAt: null` case, not a literal.      |
| **RISK-X** | **`SessionRequest.status` is a bare Postgres `String` with a `@default("pending")` and an inline comment listing four values.** `SESSION_REQUEST_STATUSES` in the contracts lib is the only other declaration and nothing connects them. A typo'd `'sheduled'` writes cleanly.                                                                                                                                                                                                                                                                                      | MED      | Task 12.9 pins every status literal it writes with `satisfies SessionRequestStatus`, the way `visibility.ts` pins its three with `satisfies Visibility`. No bare string literal reaches a `status:` field.                                                                                                                                                                     |
| **RISK-Y** | **The `@unique` on `calendar_event_id` is the invariant AD-2 exists for, and a `P2002` on it is reachable in production** — two admins accepting two requests that Google reconciles to one event, or a retried accept. An unhandled `P2002` is a `500` carrying a Prisma constraint name.                                                                                                                                                                                                                                                                          | MED      | Task 12.9 catches `P2002` on that column specifically and answers `409 { reason: 'calendar_event_already_claimed' }`, with the raw error logged and dropped (NFR-S7). Asserted.                                                                                                                                                                                                |

---

### Assumptions this refine pass takes (not in the plan; flag if wrong)

- 🔴 **ASSUMPTION-10 — the Google happy path CANNOT be verified live in this workspace, and
  that is a fact about the environment, not a licence to skip it.** `GOOGLE_OAUTH_*` is
  unset, so `isEnabled()` is `false` and every live `V-CURL` against accept/reschedule/
  decline exercises the **feature-off** branch and returns `503`. That makes exit-gate
  clause 2 free and clause 1 unverifiable live. **Therefore**: (a) every §3.5 row is
  asserted against a `GoogleCalendarProvider` **double** whose `createEvent` /
  `patchEvent` / `deleteEvent` return the documented `GoogleApiResult` shapes, with a real
  `events.insert` response body pasted into the spec; (b) the report states plainly that no
  real Google request was made. **Cheapest way to overrule**: real `GOOGLE_OAUTH_*`
  credentials in `.env` plus one live accept against a throwaway request.
- **ASSUMPTION-11 — `libs/api/community` gets a THIRD copy of the five `common/` helpers,
  not an import from `forum` or `learning`.** Both existing copies carry a docblock stating
  the reason (forum's `common/` is deliberately not barrel-exported and
  `forum.module.spec.ts` asserts that surface by exact array equality, because a consumer
  that can reach `NOT_DELETED` can hand-build a `where` and read past every visibility
  clause). A third copy is ~90 lines of pure branch logic pinned by its own spec in each
  lib; the alternative is widening a public barrel and deleting an assertion. **Each new
  file names its two siblings and says "the three must change together."**
- **ASSUMPTION-12 — `LiveSession.visibility` / `cohortKeys` are evaluated with the SAME
  three-branch rule as a forum category and a course, including `staff` ⇒ admin-only.**
  Plan §1.5 gives `LiveSession` the identical `visibility` + `cohortKeys String[]` pair and
  says nothing about who sees `staff`. Task 12.6 mirrors `buildCourseVisibilityWhere` with
  the same "omit the cohort branch entirely when `ctx.cohortKeys` is empty" rule and the
  same `satisfies Visibility` pin. One branch in one file to overrule.
- **ASSUMPTION-13 — a `LiveSession` has NO `published` flag, so unlike a course there is no
  draft posture.** Plan §1.5 gives it none. A session is visible the moment it is created
  and visible to whom `visibility` says. If a draft posture is wanted it is one column and
  one clause — say so before B13 renders the admin surface.
- **ASSUMPTION-14 — F-1's `deleted_by` also lands on `live_sessions`.** 9B recommends the
  column for `Course`/`CourseModule`/`Lesson`; plan §1.5's `LiveSession` has `deletedAt`
  and no `deletedBy`, which would reproduce exactly the gap F-1 raised, in a model authored
  _in the same migration that fixes it_. Four columns, not three. **Cheap to overrule**: one
  line of schema and one of DDL.

---

### Task 12.1: Pre-flight — the four facts this batch is not allowed to guess ⏸️ PENDING

**Files**: none (verification only)
**Requirement refs**: PRE-1/2/5/6/7, §1.8, ground-truth items 8–11
**Dependencies**: none — this is the batch's root

**Implementation details** — run and paste all of it:

- `docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select migration_name from _prisma_migrations order by started_at desc limit 3;"` → **migration 3 `20260819090000_courses` MUST be present and applied before migration 4 is authored.**
- `npx prisma migrate status` → `Database schema is up to date!`
- `select column_name from information_schema.columns where table_name='session_requests'` → the **eleven** current columns, so the four added are provably new.
- `grep -n "deletedBy" apps/ptah-license-server/prisma/schema.prisma` → three hits (`Topic`, `Post`, `LessonComment`) — F-1's evidence, re-confirmed rather than trusted.
- The three census constants and both prefix ledgers, read from source with line numbers.
- Read `libs/api/core/src/lib/common/dto-validation.pipe.ts` (PRE-1) and
  `google-calendar.provider.ts` + `google-event.mapper.ts` (PRE-5) — and state PRE-5's
  discharge in one sentence: **the Meet link already resolves; nothing is built.**

**Verification**: every value above pasted verbatim in the report. A mismatch on migration 3 **STOPS the batch** — migrations are forward-only and sequential.

---

### Task 12.2: `schema.prisma` — `LiveSession`, four `SessionRequest` columns, and F-1's four `deleted_by` ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma` (MODIFY)

**Requirement refs**: §1.5, AD-2, AD-3, R3, R4, R4.6, R4.10, 9B's F-1, ASSUMPTION-13/-14
**Dependencies**: 12.1
**Pattern to follow**: the `Course` model added by Batch 9A (same file, `visibility` +
`cohortKeys String[]` + `deletedAt` + `createdBy`).

**Implementation details**:

- `LiveSession` **verbatim from plan §1.5**, plus `deletedBy String? @map("deleted_by")` (ASSUMPTION-14) and the `@@map("live_sessions")` / `@@index([startsAt])` it already specifies.
- `SessionRequest` gains exactly four columns: `calendarEventId String? @unique @map("calendar_event_id")`, `meetLink String? @map("meet_link")`, `durationMinutes Int? @map("duration_minutes")`, `declineReason String? @map("decline_reason")`. **`@unique` is the load-bearing part** (AD-2): it makes "two requests reconciled to one event" unrepresentable, and Postgres treats NULLs as distinct so pending requests stay unconstrained.
- `@@index([status])` → `@@index([status, createdAt])` — R4.4's queue is `status=pending ORDER BY created_at ASC`, and the single-column index cannot serve the ordering.
- **F-1**: `deletedBy String? @map("deleted_by")` on `Course`, `CourseModule` and `Lesson`.
- ⚠️ **No `User` back-relation for `LiveSession`.** `createdBy` / `deletedBy` are plain `String?` admin ids, matching `Course.createdBy`. Adding a relation here would be a schema change plan §1.7 does not ask for.
- ⚠️ **Every existing `SessionRequest` field is left EXACTLY as it is** (R4.10) — `isFreeSession`, `paymentStatus`, `paddleTransactionId` keep their defaults, their comments and their meanings.

**Verification**: `npx prisma validate` and `npx prisma format --check`; `git diff` on the file shows **only** the additions above.

---

### Task 12.3: Migration 4 — hand-authored, applied, and confirmed ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\20260826090000_live_and_private_sessions\migration.sql` (NEW)

**Requirement refs**: §1.8 row 4, NFR-M3, RISK-K, ground-truth item 13
**Dependencies**: 12.2

**Implementation details**:

- 🔴 **DO NOT RUN `prisma migrate dev`, `db push` OR `migrate reset`.** Create the directory by hand.
- Generate the DDL with
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
  **strip Prisma 7's dotenv stdout banner**, and review every statement before saving.
- The name suffix is `live_and_private_sessions` and the timestamp `20260826090000` — it sorts **after** migration 3's `20260819090000` and there is nothing in between.
- Expected statements: `CREATE TABLE "live_sessions"` + its `@@index([startsAt])` + the `calendar_event_id` unique index; four `ALTER TABLE "session_requests" ADD COLUMN`; its unique index; `DROP INDEX session_requests_status_idx` + `CREATE INDEX session_requests_status_created_at_idx`; three `ALTER TABLE … ADD COLUMN "deleted_by"`.
- ⚠️ **No `pg_trgm` index in this migration.** Migrations 2 and 3 own the only three (A-7); a live session has no searchable long text and RK-1 licenses no fourth.
- ⚠️ **Every added column is nullable or has a default**, so the migration is safe against a populated `session_requests` and is independently deployable (NFR-M3).
- Apply with `npx prisma migrate deploy`, then `npx prisma migrate status`.

**Verification**: `migrate status` → _"Database schema is up to date!"_ with **20** migrations · `\d session_requests` shows the four columns and both index changes · `\d live_sessions` shows the table · `select count(*) from live_sessions` → `0` · a re-run of `migrate diff` produces an **empty** script (schema and database agree). All pasted.

---

### Task 12.4: Contracts — `LiveFeedItem`, the `GET /members/live` envelope, `AdminLiveSession` ⏸️ PENDING

**Files**:

- `libs\api-contracts\community\src\lib\member\member-live.contract.ts` (MODIFY — the file that says Batch 12 extends it)
- `libs\api-contracts\community\src\lib\admin\admin-live.contract.ts` (NEW)
- `libs\api-contracts\community\src\index.ts` (MODIFY)

**Requirement refs**: §2.10, §3.5, AD-3, R3.3, R3.6, RK-8, NFR-S4
**Dependencies**: 12.1
**Pattern to follow**: `member-session-request.contract.ts` / `admin-session-request.contract.ts` — the RK-8 pair already shipped for the other half of this batch.

**Implementation details**:

- `LiveFeedItem` **from AD-3 verbatim**: `{ id, source: 'ptah' | 'calendar', state: 'upcoming' | 'live' | 'replay', title, startsAt, endsAt, youtubeVideoId, meetLink, durationSeconds }` + `LIVE_SOURCES` / `LIVE_STATES` const tuples and type guards, matching how `HUB_SESSION_KINDS` is declared.
- The envelope: `{ upcoming: LiveFeedItem[]; live: LiveFeedItem[]; replays: Paged<LiveFeedItem>; calendarAvailable: boolean }` — `Paged` imported from `shared/paged`, which already exists.
- ⚠️ **`calendarAvailable` is on the ENVELOPE, not per item.** R3.6: with Calendar disabled the surface renders YouTube-sourced sessions and shows the member **no error**. A per-item flag would make "the calendar is down" a property of items that do not exist.
- ⚠️ **`id` is NOT globally unique across sources** — say so, the way `HubSessionSummary.id` does. Pair it with `source`.
- `AdminLiveSession` **re-declares** its fields — no `extends`, in either direction. It carries what the member shape does not: `visibility`, `cohortKeys`, `description`, `calendarEventId`, `replayYoutubeVideoId`, every `video*` metadata column, `createdBy`, `deletedAt`, `createdAt`, `updatedAt`.
- Every new member type gets a `satisfies z.ZodType<T>` runtime schema; **admin types get no schema** — matching `AdminSessionRequest` / `AdminPack`, which have none (the member panel is the only Zod-parsing client).

**Verification**: `npx nx test api-contracts-community` — `contract-boundary.spec.ts` green (it is the test that fails on any `extends` across the member/admin line) · `npx nx typecheck api-contracts-community`.

---

### Task 12.5: The audit vocabulary, and closing 9B's F-1 in the two files that record it ⏸️ PENDING

**Files**:

- `libs\api\audit\src\lib\audit-log.types.ts` (MODIFY)
- `libs\api\learning\src\lib\common\admin-audit.ts` (MODIFY — the docblock that says the column does not exist)
- `libs\api\learning\src\lib\courses\courses.service.ts` (MODIFY — write `deletedBy`; its class docblock records the gap)

**Requirement refs**: PRE-6, R8.5, 9B's F-1, exit-gate clause 5
**Dependencies**: 12.3 (the column must exist before `Prisma.CourseUpdateInput` accepts it)

**Implementation details**:

- `AdminAuditAction` gains, grouped and commented like the `community.*` and `learning.*` blocks: `community.live_session.{create,update,delete,restore,refresh_metadata}` and `community.session_request.{accept,reschedule,decline}`.
- `AdminAuditTargetType` gains `'LiveSession'` and `'SessionRequest'` — **Prisma model names**, like every other member of the union.
- 🔴 **The F-1 half is the point of this task.** `CoursesService.deleteCourse` / `deleteModule` / `deleteLesson` already **take** a `deletedBy: string` and cannot write it. Now they can: add `deletedBy` to the three tombstone `update` payloads, and **rewrite the two prose blocks that say the column does not exist** (`admin-audit.ts`'s `requireAdminUserId` docblock and `CoursesService`'s class docblock) so the next reader is not told a false thing. The audit-in-transaction posture (PRE-6) is **unchanged** — the column corroborates the audit row, it does not replace it.
- ⚠️ **`libs/api/learning` is otherwise foreign to this batch.** These are the two files 9B's F-1 named and nothing else there is touched.

**Verification**: `npx nx run-many -t typecheck,test -p api-audit,api-learning --skip-nx-cache` · the `courses.service.spec.ts` delete cases assert `deletedBy` is in the payload · **`api-learning:eslint:lint`'s 12 pre-existing errors are unchanged in count and identity** (F-1 of the _Batch 11 report_ — a different F-1, and not this batch's to fix).

---

### Task 12.6: `live-sessions/common/` — the third copy, and the AD-5 structural spec that covers this lib ⏸️ PENDING

**Files** (all NEW, under `libs\api\community\src\lib\live-sessions\common\`):
`member-context.ts` · `admin-audit.ts` · `soft-delete.ts` · `optional-field.ts` · `visibility.ts` · `visibility.spec.ts` · `soft-delete-filter.spec.ts` · `nullable-dto.spec.ts`

**Requirement refs**: AD-5, AD-10, ASSUMPTION-11/-12, PRE-1, PRE-6, NFR-S7
**Dependencies**: 12.4
**Pattern to follow**: `libs/api/learning/src/lib/common/*` — the most recent copy, file for file.

**Implementation details**:

- Each file opens by naming **both** siblings (`libs/api/forum/src/lib/common/<same>.ts`, `libs/api/learning/src/lib/common/<same>.ts`) and stating **"the three must change together."**
- `visibility.ts` exports `buildLiveSessionVisibilityWhere(ctx)` returning `Prisma.LiveSessionWhereInput` — three branches, the cohort branch **omitted entirely** when `ctx.cohortKeys` is empty, `satisfies Visibility` on all three literals. ⚠️ **No `published` clause** (ASSUMPTION-13): `LiveSession` has no such column and inventing one here would be a schema decision made in a where-builder.
- `soft-delete.ts` exports `NOT_DELETED`, `RESTORE_WINDOW_DAYS = 30`, `RESTORE_WINDOW_MS`, `restorableWhere(now)`, `assertRestored(count)` — the window is a `WHERE` clause, never a JavaScript comparison, so there is no unfiltered pre-flight read to exempt.
- 🔴 **`soft-delete-filter.spec.ts` MUST scope itself to `live-sessions/` and NOT to the whole lib.** The lib-local convention (`LIB_ROOT = resolve(__dirname, '..')` + an `endsWith` assertion) would here point at `src/lib/live-sessions` — but `circle/`, `packs/`, `member-groups/` and `google-sessions/` predate AD-5 and read models with no `deletedAt` at all. Set the root to this directory, assert the root's shape, and **state in the docblock that the rest of the lib is deliberately out of scope** — otherwise the spec either fails on four innocent directories or is silently widened to exempt them.
- `nullable-dto.spec.ts` scans this directory's `*.dto.ts` with an `EXPECTED_EXEMPTIONS` census that starts `[]` and should stay `[]`.

**Verification**: `npx nx test api-community --skip-nx-cache` · **each new spec proven to FAIL** by a deliberate mutation that is then reverted and `diff`-confirmed byte-identical.

---

### Task 12.7: `live-sessions.service.ts` — CRUD, authoring-time YouTube metadata, soft delete + restore ⏸️ PENDING

**Files**: `live-sessions.service.ts` (NEW) + `.spec.ts` (NEW)
**Requirement refs**: R3.1, R3.2, R3.4, R8, R8.5, §2.9, §4.5, ASSUMPTION-13
**Dependencies**: 12.6
**Pattern to follow**: `libs/api/learning/src/lib/lessons/lesson-video.service.ts` for the YouTube half, `courses.service.ts` for the CRUD + tombstone + restore half.

**Implementation details**:

- Create / update / delete (soft) / restore / list-for-admin. Every read spreads `NOT_DELETED`; every mutation takes an `AuditHook` called with the mutation's own `tx` (PRE-6).
- **YouTube metadata is fetched AT WRITE TIME and persisted** (§4.5, R3.2) — `youtubeVideoId` **and** `replayYoutubeVideoId` both resolve through the **same** `YouTubeMetadataProvider` the lessons path uses. ⚠️ **`@ptah-api/youtube` verbatim, not a second provider** (`youtube/src/index.ts`'s docblock names `libs/api/community` Batch 12 as its second consumer).
- **Feature-off tolerant**: `YOUTUBE_API_KEY` unset ⇒ `{ ok:false, skipped:true }` ⇒ the session is created with the id the admin typed and **null metadata**, never a `500` (R2.2.6's posture, applied to R3).
- **`refresh-metadata` is a MANUAL admin action** — no cron, deliberately (RK-6).
- 🔴 **NO READ-PATH YOUTUBE CALL** — the NFR-P6 rule, applied to this surface. Only this file imports `@ptah-api/youtube` in this directory; `live-feed.service.ts` must not.
- `deletedBy` is written (ASSUMPTION-14) and the actor id is **demanded, never substituted** (`requireAdminUserId`).

**Verification**: `npx nx test api-community` · the feature-off create asserted against a provider double returning `{ ok:false, skipped:true }` · the enabled path asserted against a double returning `{ ok:true, video }` (ASSUMPTION-10) · restore-at-exactly-30-days succeeds, at 31 days `409`.

---

### Task 12.8: `live-feed.service.ts` — the AD-3 merge, and the two traps in it ⏸️ PENDING

**Files**: `live-feed.service.ts` (NEW) + `.spec.ts` (NEW), `live-feed-state.ts` (NEW) + `.spec.ts` (NEW)
**Requirement refs**: AD-3, R3.3, R3.4, R3.6, RISK-V, RISK-W, exit-gate clause 3
**Dependencies**: 12.7
**Pattern to follow**: `sessions.service.ts`'s `scopeToCohort` for the recurrence-instance handling; `member-hub.service.ts` for `Promise.allSettled` composition.

**Implementation details**:

- Read `LiveSession[]` (Postgres, visibility-filtered, `NOT_DELETED`) and `BuildersSession[]` (`SessionsService.readUpcomingSessions`) **in parallel**, then fold into one `LiveFeedItem[]`.
- 🔴 **RISK-V — the claim set matches BOTH `event.id` AND `event.recurringEventId`.** A Calendar event claimed by a `LiveSession.calendarEventId` is emitted **once**, `source: 'ptah'`, with the Calendar's `meetLink` merged in. Comparing only `id` de-duplicates zero instances of a recurring series.
- 🔴 **RISK-W — `state` is ONE pure exported function taking `now` as a parameter**, never `new Date()` inside. `LIVE_FALLBACK_MINUTES` is a named constant covering `endsAt: null`. Table-driven spec over the full cross-product.
- **`calendarAvailable: false` degrades, it never errors** (R3.6): the Calendar half returning `{ ok:false }` yields the Ptah-sourced feed plus the flag, and **no error reaches the member**. The reason is logged, not surfaced.
- ⚠️ **This file does NOT import `@ptah-api/youtube`.** Every video field is a persisted column.

**Verification**: `npx nx test api-community` · **exit-gate clause 3 asserted and proven by deliberate failure** — drop the `recurringEventId` arm, watch the duplicate appear, revert, `diff` clean · a fixture where `id !== recurringEventId` is mandatory.

---

### Task 12.9: `session-requests.service.ts` — the §3.5 table, verbatim, including the compensating delete ⏸️ PENDING

**Files**: `google-sessions\session-requests.service.ts` (NEW) + `.spec.ts` (NEW)
**Requirement refs**: R4.1–R4.10, §3.5, AD-2, PRE-5, PRE-6, RISK-U, RISK-X, RISK-Y, exit-gate clauses 1, 2, 4
**Dependencies**: 12.6
**Pattern to follow**: `admin-sessions.service.ts` (the existing Calendar write path in this same directory).

**Implementation details**:

- Member: `listOwn(ctx)` (**own only**, R4.3 — the `where` carries `userId`, it is not a filter applied after the read), `submit(ctx, dto)` → `pending`, `cancelOwn(ctx, id)` → own **and** `pending` only, `403` otherwise.
- Admin: `listQueue({status})` **oldest first** (R4.4) with requester identity; `accept`, `reschedule`, `decline`.
- 🔴 **`accept` is ONE named method and the order is the requirement (RISK-U):**
  1. Google unset ⇒ `503 { reason: 'scheduling_unavailable' }`, **nothing written**.
  2. `createEvent(..., createMeetLink: true)` fails ⇒ `502 { reason: 'calendar_event_failed' }`, **nothing written**, request stays `pending`.
  3. Event created but no Meet link resolves ⇒ **`deleteEvent(createdId)` first**, then `502 { reason: 'meet_link_unresolved' }`, nothing written.
  4. DB write throws after a successful create ⇒ **`deleteEvent(createdId)` in the `catch`**, then rethrow. This is the row §3.5 states as "the only sequence that satisfies _no partial state SHALL be persisted_".
  5. Success ⇒ all four columns in **one** transaction, with the audit row enlisted in it (PRE-6).
- **Reschedule and decline locate the event BY THE PERSISTED `calendarEventId`** (R4.6) — never by `(title, startsAt)`. A `scheduled` request with a null `calendarEventId` is a **defect**, and the code says so with a named refusal rather than a silent no-op.
- `deleteEvent` returning **410 Gone is idempotent success**, not a failure (the provider's own docblock says so).
- **RISK-X**: every status literal pinned `satisfies SessionRequestStatus`.
- **RISK-Y**: `P2002` on `calendar_event_id` ⇒ `409 { reason: 'calendar_event_already_claimed' }`, raw error logged and dropped.
- ⚠️ **R4.10 — the payment fields are read and echoed, never written.** This service does not touch `isFreeSession`, `paymentStatus` or `paddleTransactionId`.

**Verification**: `npx nx test api-community` · **all four §3.5 rows asserted**, including that the compensating `deleteEvent` was called **with the id that was created** · the feature-off `503` asserted against `isEnabled() === false` · **exit-gate clause 1 proven by deliberate failure** in 12.16.

---

### Task 12.10: DTOs, and the two response mappers that decide what a member may see ⏸️ PENDING

**Files**: `live-sessions\dto\{create-live-session,update-live-session,list-live.query,list-admin-live.query,refresh-live-metadata}.dto.ts`, `google-sessions\dto\{create-session-request,accept-session-request,reschedule-session-request,decline-session-request,list-session-requests.query}.dto.ts` (all NEW) + the mappers + `member-session-request-fields.spec.ts` (NEW)

**Requirement refs**: PRE-1, NFR-S4, R4.3, exit-gate clause 4, RISK-I
**Dependencies**: 12.9
**Pattern to follow**: `libs/api/learning/src/lib/courses/dto/*` and `member-packs`' NFR-S5 field-absence spec.

**Implementation details**:

- 🔴 **Every `@Body()` and `@Query()` payload param binds `dtoPipe(TheDto)`** (PRE-1). A bare `@Body() dto: X` is silently unvalidated.
- 🔴 **`NAMED_PRIMITIVE_PARAM_COUNT` IS AN EXACT-EQUALITY ASSERTION AT 6.** Therefore **every** query surface in this batch — `?status=`, `?includeDeleted&from&to`, the replay page — is a **whole-object Query DTO**, never `@Query('status') status: string`. `@Param('id')` is not a payload param and does not count.
- Nullable optional fields use `IsOptionalNotNull()` / `NullMeansAbsent()` from 12.6's `optional-field.ts` — never a bare `@IsOptional()` on a field whose type cannot be `null` (B6.1's twelve-field sweep).
- `AcceptSessionRequestDto { startsAt: ISO string; durationMinutes: int }` — `durationMinutes` bounded (min 15, max 240) so `endsAt` is always reconstructible on reschedule.
- 🔴 **`toMemberSessionRequest` is the NFR-S4 chokepoint** and its spec asserts, over a fully-populated Prisma row, that the output object's **own keys** are exactly the nine `MemberSessionRequest` fields — so `calendarEventId`, `userId`, `paymentStatus`, `paddleTransactionId` and `isFreeSession` are **absent**, not merely undefined. Same shape as `MemberPack`'s `notes` assertion.

**Verification**: `npx nx test api-community` · the field-absence spec proven to fail by adding one forbidden key, then reverted.

---

### Task 12.11: The two member controllers ⏸️ PENDING

**Files**: `live-sessions\member-live.controller.ts` (+ spec), `google-sessions\member-session-requests.controller.ts` (+ spec)
**Requirement refs**: §3.5, R3.6, R4.3, AD-12, PRE-1, RI-1
**Dependencies**: 12.10
**Pattern to follow**: `member-courses.controller.ts` — guard order, `requireMemberContext`, the prefix docblock.

**Implementation details**:

- `@Controller('v1/members/live')` and `@Controller('v1/members/session-requests')` — **literal segment 3 on both** (AD-12). No route in either parameterises segment 3.
- `@UseGuards(JwtAuthGuard, MemberGuard)` at **CLASS** level, in that order, so a handler added later is guarded by default.
- `requireMemberContext(req, …)` — the removed-guard tripwire, not a null check.
- `DELETE session-requests/:id` → `{ canceled: true }` for own + `pending`; `403` otherwise.
- Throttle: submit is a content-creation write and takes the `CONTENT_CREATION` tier; reads inherit the global 100/min.

**Verification**: `npx nx test api-community,ptah-license-server` · `route-map.spec.ts` green after 12.14.

---

### Task 12.12: The two admin controllers ⏸️ PENDING

**Files**: `live-sessions\admin-live-sessions.controller.ts` (+ spec), `google-sessions\admin-session-requests.controller.ts` (+ spec)
**Requirement refs**: §3.5, R4.4, R4.7, R8, PRE-1, PRE-6, RI-1, ground-truth item 9
**Dependencies**: 12.10
**Pattern to follow**: `admin-courses.controller.ts` — `@UseGuards(JwtAuthGuard, AdminGuard, AdminThrottlerGuard)`, `adminActor(req)`, `auditHook(...)` passed **into** the service call.

**Implementation details**:

- `@Controller('v1/admin/live-sessions')` and `@Controller('v1/admin/session-requests')`. ⚠️ **Not `v1/admin/sessions/live`** — that nests under the existing `v1/admin/sessions` and reproduces RISK-J.
- Every mutation passes an `auditHook` so the audit row commits **inside** the mutation's transaction (PRE-6).
- The accept/reschedule/decline handlers translate the service's typed failures into the §3.5 statuses; **no raw Google or Prisma text reaches the client** (NFR-S7).

**Verification**: `npx nx test api-community,ptah-license-server` · `admin-guards.spec.ts` G1 green (every `v1/admin/*` route is `AdminGuard`-protected).

---

### Task 12.13: `LiveSessionsModule`, the `GoogleSessionsModule` additions, `app.module.ts`, the barrel ⏸️ PENDING

**Files**: `live-sessions\live-sessions.module.ts` (NEW) + `.spec.ts`, `google-sessions\google-sessions.module.ts` (MODIFY), `libs\api\community\src\index.ts` (MODIFY), `apps\ptah-license-server\src\app\app.module.ts` (MODIFY)

**Requirement refs**: §2.9, §2.11, RISK-L
**Dependencies**: 12.11, 12.12

**Implementation details**:

- `LiveSessionsModule` imports `ConfigModule, PrismaModule, IdentityModule, MembershipModule, AuditModule, YoutubeModule` and declares `AdminGuard` + `AdminThrottlerGuard` **locally** (the acyclicity idiom `MemberGroupsModule` established). `MemberGuard` is **NOT** re-declared — `MembershipModule` is `@Global()` and a second declaration would resolve entitlement out of a different injector.
- ⚠️ **`NotificationsModule` IS DELIBERATELY ABSENT (RISK-L)** — `libs/api/notifications` does not exist until **Batch 14**. Copy `LearningModule`'s paragraph explaining the absence so the next reader sees a decision, not an oversight, and assert its presence the way `learning.module.spec.ts` does.
- ⚠️ **`SessionsService` is needed by `LiveFeedService` and is exported by `@Global() GoogleSessionsModule`** — inject it `@Optional()`, exactly as `SessionsSection` does, so an unregistered module degrades `calendarAvailable` to `false` rather than failing module construction.
- `GoogleSessionsModule` gains `SessionRequestsService` + the two new controllers, and **exports `SessionRequestsService`** so 12.15's hub section can read accepted private sessions.
- `app.module.ts`: `LiveSessionsModule` in the same region as `ForumModule` / `LearningModule`.
- Barrel: export the four controller classes (PRE-2 requires the registry to import them by package name) and **only** the services a consumer legitimately needs. Assert the service export surface by **exact array equality**.

**Verification**: `npx nx test ptah-license-server` — `app.module.spec.ts` boots · `live-sessions.module.spec.ts` green.

---

### Task 12.14: The three registries and the census constants ⏸️ PENDING

**Files**: `apps\ptah-license-server\src\testing\controller-registry.ts`, `src\common\route-map.spec.ts`, `src\common\controller-validation.spec.ts` (all MODIFY)
**Requirement refs**: PRE-2, RI-1/2/3, RISK-I, ground-truth items 8–9
**Dependencies**: 12.13

**Implementation details**:

- Four entries in `ALL_CONTROLLERS`, with a comment block naming the batch and the prefix-disjointness reasoning, matching the P2 and P3 blocks.
- `EXPECTED_ROUTES`: **extend the ARRAY, then fix the prose count.** The docblock's running total is the one thing in that file no assertion keeps honest.
- `MIN_TOTAL_PAYLOAD_PARAMS`: **re-derive** from the actual discovered total and raise it, with the arithmetic written down. It is a floor.
- 🔴 **`NAMED_PRIMITIVE_PARAM_COUNT` MUST REMAIN EXACTLY 6.** If it moved, a query surface was written as a named primitive instead of a DTO — **fix the controller, never the constant**.
- **Add nothing to `PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT` or `UNVALIDATED_DEBT`.** All three stay as they are.

**Verification**: `npx nx test ptah-license-server --skip-nx-cache` · the census assertion green · both prefix ledgers unchanged, shown by `git diff`.

---

### Task 12.15: The hub `sessions` section — a three-way merge that changes no envelope ⏸️ PENDING

**Files**: `libs\api\member-hub\src\lib\sections\sessions.section.ts` (MODIFY) + its spec
**Requirement refs**: R6.1, R6.6, R6.4, NFR-R1/R3, ground-truth items 3–4
**Dependencies**: 12.13
**Pattern to follow**: Task 9.17's treatment of `learning.section.ts` — replace the body, change nothing else.

**Implementation details**:

- The section now folds **three** sources into one "what is next": Calendar (`kind: 'calendar'`, already shipped), the next visible `LiveSession` (`kind: 'live'`), and this member's own next **accepted** private session (`kind: 'private'`).
- 🔴 **`HUB_SESSION_KINDS` ALREADY DECLARES ALL THREE. This is a DATA change, not a contract change** (R6.6) — the envelope, the composer and the client are untouched, and the B3 one-request assertion must still pass four phases later.
- `earliest()` already sorts rather than trusting order, and its docblock already names this batch as the reason. **Use it; do not replace it.**
- ⚠️ **`'unavailable'` is now a PER-SOURCE question.** Calendar being down must **not** hide a `LiveSession` that is genuinely next. The section reports `'ok'` when **any** source answered and produced a next session; `'unavailable'` only when every consulted source failed; `'empty'` when sources answered and there is nothing. Spell the truth table out in the docblock — this is the one place the existing two-state logic is genuinely insufficient.
- Both new reads are `@Optional()`-injected for the same reason `SessionsService` is.

**Verification**: `npx nx test api-member-hub --skip-nx-cache` · a case where Calendar fails **and** a `LiveSession` exists returns `'ok'`, not `'unavailable'` · `V-CURL` on `GET /v1/members/hub` still `200` with every section present.

---

### Task 12.16: Live verification, the deliberate-failure proofs, and the exit gate ⏸️ PENDING

**Files**: none new (verification)
**Requirement refs**: the whole exit gate, ASSUMPTION-10, RISK-U, RISK-V
**Dependencies**: 12.15

**Implementation details** — run it, paste it, do not summarise it:

- `V-HEALTH` → 200. `V-TOKEN` headless. `V-CURL` on `GET /v1/members/live` → `200` with `calendarAvailable: false` and **no error** (R3.6); on `GET /v1/members/session-requests` → `[]`; `POST` one → `201 pending`; `DELETE` it → `{ canceled: true }`.
- `V-CURL` on `POST /v1/admin/session-requests/:id/accept` with Google unset → **`503 { reason: 'scheduling_unavailable' }`**, and `V-DB` proves the row is **still `pending` with all four columns null** — exit-gate clause 2, which is free in this environment and must be shown to be actually free rather than assumed.
- `V-DB`: `\d session_requests`, `\d live_sessions`, and the three `deleted_by` columns.
- **At least three deliberate-failure proofs**, each reverted and `diff`-confirmed byte-identical: (1) drop RISK-V's `recurringEventId` arm → the duplicate appears; (2) remove the compensating `deleteEvent` from `accept`'s catch → the RISK-U assertion goes red; (3) add a forbidden key to `toMemberSessionRequest` → the NFR-S4 spec goes red.
- The full batch gate: `npx nx run-many -t eslint:lint,typecheck,test -p api-community,api-contracts-community,api-member-hub,api-audit,api-learning,ptah-license-server --skip-nx-cache`, with **baseline vs post totals per project** and `api-learning:eslint:lint`'s 12 pre-existing errors shown unchanged.

**Verification**: every clause of the exit gate above, each with its pasted evidence, in `batch-12-report.md`.

---

## Batch 13: P4-FE — live, replays, request-a-session ✅ COMPLETE

> **Resume map — written 2026-08-09 by the second executor, after the first session's
> process was killed mid-flight.** The first session decomposed this batch (everything below
> this line) and wrote tasks 13.1–13.9 to disk WITHOUT committing them. The second session
> adopted that work, judged it, fixed three defects in it, and finished 13.10.
>
> | Task                                   | State on arrival                                                | Where it ended up            |
> | -------------------------------------- | --------------------------------------------------------------- | ---------------------------- |
> | 13.1 Test identity                     | ✅ session 1 — rows live in the DB, by known id                 | Torn down and proven deleted |
> | 13.2 `MemberLiveApiService`            | ✅ session 1, uncommitted                                       | `5cc1fdd80`                  |
> | 13.3 `MemberSessionRequestsApiService` | ✅ session 1, uncommitted                                       | `5cc1fdd80`                  |
> | 13.4 §5.3 promotion decision           | ✅ session 1 — **declined**, kept private                       | no barrel edit               |
> | 13.5 `SessionCard`                     | ✅ session 1, uncommitted                                       | `fc6e30773`                  |
> | 13.6 `LivePage`                        | ✅ session 1, uncommitted                                       | `fc6e30773`                  |
> | 13.7 `ReplaysPage`                     | ✅ session 1, uncommitted                                       | `fc6e30773`                  |
> | 13.8 `RequestSessionPage`              | ✅ session 1, uncommitted — **2 real bugs**, fixed in session 2 | `fc6e30773`                  |
> | 13.9 Route swap                        | ✅ session 1, uncommitted                                       | `8a761df03`                  |
> | **13.10 The proofs**                   | ⏸️ **spec written, never RUN** — this was the true resume point | `db584deaa`                  |
>
> 🔴 **The first session's work was green but not proven.** Running 13.10 for the first time
> found a **real WCAG AA failure** (`e9181716f`) and a **vacuous test** that passed with the
> binding it claimed to guard deleted. Neither was visible from `nx test`.

**Recommended Executor**: `frontend-developer` | **Fallback**: `frontend-developer`
**Execution Mode**: sequential — one dispatch. If a split is needed the seam is
**13.1–13.5 (identity, the two API services, the §5.3 promotion call, the card) then
13.6–13.10 (the three pages, the routes, the proofs)**.
**Rationale**: the Live page, the Replays page and the Request page share ONE feed contract,
ONE status vocabulary and ONE "a degraded Calendar is not an error" rule. Splitting them
across dispatches is how one of the three ends up rendering `calendarAvailable: false` as a
red banner.
**Dependencies**: Batch 4 (the shell, `MEMBER_ROUTES`, the Task 4.7 lint rule), **Batch 12
(all of it — the contracts, the four routes and the live server)**
**Preconditions**: PRE-3 (**read the BARREL, not PRE-3's number**), PRE-4, PRE-7
**Tasks**: 10 (refined at the Phase-4 backend/frontend boundary, 2026-08-09)

**Scope boundary (RK-1)**: no admin live-session authoring screen, no admin request queue
screen (§3.5's seven admin routes exist and stay unrendered — that is Phase 8's, not this
task's). No calendar month grid unless §5.3's bar is met (see Task 13.4). No reminders, no
ICS export, no "add to my calendar", no attendance, no chat, no notifications (Batch 14 owns
every producer). **No second markdown renderer and no second sanitizer** (NFR-S2). No pixel
baselines — B7, B7.1 and B10 all declined them for the same reason. The **full** axe pass is
Batch 15's; this batch does a targeted pass on the three new surfaces.

🔴 **NO WRITE TOUCHES GOOGLE CALENDAR FROM THIS BATCH.** Batch 12's gate created and deleted
REAL events on the founder's calendar. `POST /v1/members/session-requests` writes a DB row and
makes no Calendar call — that one is safe and is the only write this batch performs live.
**`POST /v1/admin/session-requests/:id/accept` and `/reschedule` and `/decline` are FORBIDDEN
here.** If a task appears to need one, stop and report.

**Exit gate (§8.2 P4, frontend half)** — five clauses, each with a named owner task:

1. **The Live surface renders a POPULATED feed** — upcoming, a live-now indicator and replays
   in one view, **visually distinguished by STATE, not by which system produced each**
   (Tasks 13.5 + 13.6, R3.3, R3.5).
2. 🔴 **`calendarAvailable: false` renders the surface with NO ERROR shown to the member**
   (Tasks 13.6 + 13.10, R3.6) — asserted in a unit spec **and** in a Playwright run that
   stubs the response, and **proven by deliberate failure**.
3. **A member sees their own requests and no other member's**, with status, scheduled time and
   Meet link (Tasks 13.3 + 13.8, R4.3) — proven with TWO seeded identities, not one.
4. **Both themes clean** — `operator-member` **and** `operator-member-light`, on POPULATED
   surfaces (Task 13.10, NFR-U5).
5. **axe pass on all three new surfaces** (Task 13.10, NFR-U4).

Plus the standing gates: `members.routes.spec.ts` green with **zero** placeholder routes left
under `live/*` · the markdown chokepoint spec still green **and re-proven to fail** ·
`npx nx lint web-members` green (the Task 4.7 token rule) · the Batch-4 one-request hub
assertion still passing, unchanged (R6.6) · `nx build ptah-landing-page --configuration=production`
still green with no NEW budget warning.

**File set** (for the serialisation claim): `libs/web/members/**`, `libs/web/panel-ui/**`,
`apps/ptah-landing-page-e2e/**`.
🔴 **Shared-registry touchpoints: `libs/web/panel-ui/src/index.ts` ONLY, and only if Task
13.4 promotes.** This batch touches **no** `tsconfig.base.json`, **no** `nx.json`, **no**
`eslint.config.mjs`, **no** `app.module.ts`, **no** `route-map.spec.ts`, **no**
`controller-registry.ts`, **no** `schema.prisma` and **no** migration.

---

### 🔴 Ground truth Phase 4-FE inherits — verified against the tree and the running stack on 2026-08-09

**Do not re-derive these and do not plan against the plan's stale facts.**

1. 🔴 **`ASSUMPTION-10` IS DEAD. `GOOGLE_OAUTH_*` IS CONFIGURED** (B12's F-1). `GET
/v1/members/live` returns the founder's REAL calendar — B12 measured **50 upcoming items
   with real Meet links and real titles** (`PRO ESTATE MEETING`). **Design every screen
   against a POPULATED feed.** A single real recurring master expands to **43 instances**
   which the backend de-duplicates to one when claimed; the list rendering must not assume
   small N and must not assume distinct titles.
2. 🔴 **`YOUTUBE_API_KEY` IS EMPTY** (ASSUMPTION-6, still true). Every `LiveSession` in this
   workspace has `videoMetadataSource: 'manual'`, a **null thumbnail** and whatever duration
   an admin typed. **The no-thumbnail card is the DEFAULT case here, not an edge case** —
   `durationSeconds` is `null` on every calendar-sourced item too.
3. 🔴 **The database was wiped between B11 and B12 and RE-SEEDED only for content.** Measured
   at the start of this batch: `users=0`, `licenses=0`, `subscriptions=0`,
   `member_group_assignments=0`, `live_sessions=0`, `session_requests=0`; `member_groups=1`
   (`mgrp_founding_seed_0000000000` / key `founding`), `courses=1`, `community_categories=4`,
   `community_topics=9`. **`V-TOKEN` in this file names a user id that NO LONGER EXISTS.**
   Task 13.1 creates the identity; nothing else may assume one.
4. 🔴 **`--skip-nx-cache` DOES NOT REFRESH THE NX PROJECT GRAPH** (B12's F-11). A green
   `enforce-module-boundaries` under that flag can be meaningless — that is how B9C reported
   zero lint errors while `api-learning` was red for three batches. **Use `npx nx reset` when
   a boundary verdict is what is being claimed.** `nx reset` itself may fail with `EPERM` on
   `.nx/workspace-data` while a concurrent Nx process holds it; the graph refresh still takes
   effect.
5. 🔴 **THE `503 scheduling_unavailable` CLAUSE IS UNREACHABLE LIVE AND THIS BATCH CANNOT
   CLOSE IT.** It lives on `POST /v1/admin/session-requests/:id/accept`, an **admin** route no
   member surface calls, and it is unreachable precisely because Google IS configured. A
   Playwright `page.route()` stub is a CLIENT stub, not a stubbed `GoogleAuthProvider` — it
   proves the frontend's rendering, not the server's branch. **What this batch owns is R3.6's
   member-facing twin (`calendarAvailable: false`); B12's F-1 stays open and must be reported
   as still open.**
6. **The project names are `web-members`, `web-panel-ui`, `web-core`, `web-admin`,
   `ptah-landing-page`, `ptah-landing-page-e2e`.** There is no project called `members`.
   `nx lint` DOES exist for `libs/web/*` (unlike `libs/api/*`, where the target is
   `eslint:lint`). Jest 30's flag is `--testPathPatterns=`. **Never `nx affected`** — a second
   process commits to this branch.
7. **BASELINES, captured at `5f9572956` BEFORE any edit** (one `run-many`, `--skip-nx-cache`):
   `web-members` **32 suites / 510 tests**, `web-panel-ui` **2 / 14**, `web-core` **4 / 25**.
   Lint: `web-members` ✔ clean, `web-panel-ui` ✔ clean, `web-core` 5 warnings,
   `ptah-landing-page` 17 warnings — **0 errors anywhere**. `nx build ptah-landing-page
--configuration=production` succeeds with **two pre-existing budget warnings** (initial
   bundle 1.32 MB against a 1.00 MB budget; `@fullcalendar/angular/skeleton.css` 20.71 kB
   against 4.00 kB). **Both warnings are the baseline. A third one is this batch's.**
8. **The wire types are shipped and live** — `LiveFeedItem`, `MemberLiveResponse`,
   `liveFeedItemSchema`, `memberLiveResponseSchema` in
   `member-live.contract.ts`; `MemberSessionRequest` + `memberSessionRequestSchema` in
   `member-session-request.contract.ts`; `SESSION_REQUEST_STATUSES` in
   `shared/session-request-status.ts`; `Paged<T>` + `pagedSchema` +
   `DEFAULT_PAGE_SIZE`(25)/`MAX_PAGE_SIZE`(50)/`FIRST_PAGE`(1) in `shared/paged.ts`.
   **Do not re-declare any of them client-side.**
9. **Only `replays` is paged.** `upcoming` and `live` are bare arrays by contract, and the
   server takes `?page`/`?pageSize` for the replay archive only. `pageSize > 50` is a **`400`,
   not a silent clamp** — so the client must not ask for more.
10. **`sessionTopicId` IS A FREE STRING, NOT A FOREIGN KEY.** There is no `SessionTopic` table
    (`create-session-request.dto.ts` says so in terms) — the DTO bounds it at 1…120 chars and
    validates membership of nothing. The existing catalogue is **`SESSION_TOPICS` in
    `@ptah-web/core`** (`config/sessions.config.ts`, three topics:
    `nx-monorepo-mastery`, `orchestration-workflow`, `getting-started-ptah`), already rendered
    by the public `libs/web/account` sessions grid. **Reuse it — do not author a second
    catalogue** and do not invent a topics endpoint.
11. 🔴 **THERE IS A SECOND, OLDER REQUEST PATH AND IT IS NOT THIS ONE.**
    `POST /v1/sessions/request` (+ `GET /v1/sessions/eligibility`) is the marketing-site flow
    `libs/web/account/.../sessions-grid.component.ts` drives, and it runs a Paddle checkout
    when the member has no free session left. `POST /v1/members/session-requests` consults
    **no** eligibility and takes **no** payment: `is_free_session` defaults to `false` and
    `payment_status` to `'none'` (measured). That is R4.10 working as specified — Phase 4 adds
    a flow and redesigns no monetization — but it means **the member panel must not promise a
    free session and must not quote a price.** Say the request is reviewed and scheduled by
    the team, and report the open decision.
12. 🔴 **`text-base-content/60` IS THE PRESCRIBED MUTED-TEXT MECHANISM AND IT WAS NOT REMOVED
    FROM THIS REPOSITORY.** `docs/design-system/panel-theme-spec.md` §1 recommends it over a
    hardcoded muted hex, §2's table ships `base-content/{20,40,60,80}` as the measured `ink-*`
    equivalents, and the Task 4.7 lint rule's own `material-3` message prescribes
    `on-surface-variant -> text-base-content/60`. There are **275 occurrences across
    `libs/web` and the landing app at HEAD**, and no commit removes them. **What §2 actually
    forbids is `base-content/40` for body text** — it composites to 3.18:1 and fails WCAG AA;
    it is legal only for glanceable metadata. **Rule for this batch: `/60` or stronger for
    anything a member must read, `/40` never, and carry hierarchy with size and weight
    wherever a token is not needed at all.**
13. **`MemberGuard` and `MemberSessionStore` live in `@ptah-web/core`**, `MEMBER_ROUTES`
    declares no guard and must not regain one, and `libs/web/members/src/index.ts` exports
    `MEMBER_ROUTES` and nothing else. `MemberSessionStore` carries `entitled`, `isAdmin` and
    `cohorts` — and **no user id**.
14. **`libs/web/members/src/lib/__fixtures__/curriculum-bodies/*.md` is untracked Batch-10
    leftover** (8 files, `week-1.md` … `week-8.md`) and **no spec in the tree references it**.
    It is not this batch's to delete. Leave it, and say so.

---

### Risks surfaced by the Phase 4-FE refine pass

| #           | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                              | Sev      | Mitigation                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-Z**  | 🔴 **A degraded Calendar is a DIFFERENT MESSAGE FROM AN EMPTY SCHEDULE, and the naive render collapses them.** `calendarAvailable: false` with zero Ptah sessions produces an EMPTY feed — and "No sessions scheduled" is then a lie told to a paying member whose calendar we simply could not read. It is the exact inverse of B7's rule that a failure is not an empty state, and it is invisible in every test that fixes the flag to `true`. | **HIGH** | Task 13.6 branches on `calendarAvailable` BEFORE it branches on emptiness, and its spec is table-driven over the full cross-product of (`calendarAvailable` true/false) × (items present/absent) — four cells, four distinct renders, each asserted by its copy. Deliberate-failure proof in 13.10: collapse the branch, watch the "no sessions" cell fail. |
| **RISK-AA** | 🔴 **`LiveFeedItem.id` IS NOT UNIQUE ACROSS SOURCES and the contract says so.** A `LiveSession` cuid and a Google event id share one field. `@for (… ; track item.id)` across a concatenated list is an Angular duplicate-key error at best and a silently wrong DOM re-use at worst — and a claimed recurring master makes a collision plausible rather than theoretical.                                                                        | **HIGH** | Every `@for` over feed items tracks **`source + ':' + id`** through one exported `feedItemKey()` helper, never `item.id`. Its spec asserts that two items with the same `id` and different `source` produce different keys.                                                                                                                                 |
| **RISK-AB** | **A real recurring master expands to 43 instances, so "upcoming" is not a short list.** A flat `@for` renders 43 near-identical rows with the same title and no visual grouping, which reads as a rendering bug.                                                                                                                                                                                                                                  | MED      | Task 13.6 groups by calendar day with a heading per day, and reveals incrementally (25 at a time) with the remaining count stated. **Client-side reveal only — no invented server parameter**; `upcoming` takes no `?page` and asking for one is a `400`.                                                                                                   |
| **RISK-AC** | **`state` is derived SERVER-SIDE from one clock read and the client must not recompute it.** `LiveFeedItem`'s docblock is explicit: two clocks make an item `'live'` in one place and `'upcoming'` in another on the same screen, and the disagreement is invisible in every test that fixes one of them.                                                                                                                                         | MED      | No `new Date()` comparison against `startsAt` anywhere in this batch. The live-now indicator is driven by `item.state === 'live'` and nothing else; a spec asserts the three pages contain no `Date.now()`/`new Date()` used for state.                                                                                                                     |
| **RISK-AD** | **`durationSeconds` and `videoDurationSeconds` are both integers ending in `Seconds`** and B6.1's whole finding was that four such sites were consistently wrong with no single-site test able to see it. The replay card renders a runtime; the player takes a position.                                                                                                                                                                         | MED      | One exported `formatDuration(seconds)` with the unit in the parameter name and a docblock naming RISK-O; the replay card takes `durationSeconds` and nothing on these three pages takes a position at all.                                                                                                                                                  |

---

### Assumptions this refine pass takes (not in the plan; flag if wrong)

- **ASSUMPTION-15 — the three new surfaces distinguish items by STATE, not by SOURCE.** R3.3
  says "visually distinguished but not requiring the member to know which system produced
  each", and the contract's own docblock says the `source` discriminant "is expected to be
  used for behaviour, not for a 'source: Google' badge". So: `live` gets a pulsing LIVE NOW
  marker, `upcoming` gets a date, `replay` gets a runtime and a play affordance — and
  **nothing anywhere renders the word Google, Calendar or Ptah as a provenance badge.** One
  template branch to overrule.
- **ASSUMPTION-16 — the replay player is the EXISTING `YouTubePlayer`, reused, not a second
  one.** `libs/web/members/src/lib/learning/youtube-player.ts` already implements the
  facade-then-player design (NFR-S3), the nocookie host and the `youtube-embed-url.ts`
  chokepoint that `youtube-embed-chokepoint.spec.ts` pins to ONE file. A second embed
  constructor would fail that spec, which is the good outcome. **It stays in `learning/` and
  the replays page imports it across directories** rather than being moved — a move would
  churn six specs for no behaviour change. Cheap to overrule with a file move.
- **ASSUMPTION-17 — `additionalNotes` is rendered as an ESCAPED TEXT NODE, never as
  markdown.** It is member-authored free text with no markdown affordance in the composer,
  `MemberSessionRequest` does not name it `bodyMarkdown`, and R4.8's `declineReason` is
  admin-authored plain prose. **No renderer is added to these three pages**, so
  `markdown-chokepoint.spec.ts`'s importer list is unchanged at six.
- **ASSUMPTION-18 — the request page offers `SESSION_TOPICS` and also accepts nothing else.**
  A `<select>` over the three existing topics, submitting `topic.id`. **No free-text topic
  field**, because a free string on the wire plus a free string in the UI means the admin
  queue fills with unmatched values nothing can group. One `<select>` to overrule.

---

### Task 13.1: Pre-flight — create the test identity this batch cannot borrow ✅ COMPLETE

**Files**: none (verification + a throwaway identity)

**Requirement refs**: B12 F-3, `context.md` "Seeded entitlement", `V-TOKEN`, PRE-7
**Dependencies**: none
**Pattern to follow**: `apps/ptah-landing-page-e2e/src/support/db.ts` — `seedUser()` /
`cleanupUser()`, which insert by a minted `randomUUID()` and delete by that id.

**Implementation details**:

- 🔴 **THERE IS NO ENTITLED MEMBER IN THIS WORKSPACE.** `users=0`, `licenses=0`,
  `subscriptions=0` (measured). Every prior batch's `V-TOKEN` recipe names
  `abdallah@miramarstaffing.com` / `DEV-BUILDERS-VALIDATION-0001`, and **neither row exists.**
- **Use the helper that already exists rather than inventing one.** `seedUser(email, { builder:
true })` writes a `users` row plus an ACTIVE `subscriptions` row, which is what
  `BuildersMembershipService` resolves entitlement from. For the headless `curl` half, mirror
  B12's shape and add a `licenses` row with a **known id** as well, so both entitlement paths
  are exercised and both are deletable by id.
- **Create by KNOWN id, delete by THAT id, inside one `BEGIN`/`COMMIT`.** No `TRUNCATE`, no
  blanket `DELETE`, no `delete from users` without a `where`. Record the literal ids in the
  report.
- **Create ONE `member_group_assignments` row** against the surviving `founding` group
  (`mgrp_founding_seed_0000000000`) so the cohort-visibility branch of the feed is exercised —
  and **delete it in the same teardown**. `context.md` forbids seeding an assignment
  _permanently_; creating one inside a verification and removing it afterwards is the pattern
  Batch 1 established and is what makes the zero-cohort default survive.
- **Create a SECOND identity with NO cohort assignment.** Exit-gate clause 3 ("a member sees
  no other member's requests") cannot be proved with one account — a `listOwn` that returned
  everything looks perfectly healthy with a single row in the table.
- Mint the token by signing the documented `JWTPayload` with `JWT_SECRET` from the
  workspace-root `.env` (`mintJwt()` in `support/auth.ts` is the reference implementation) and
  send it as **`curl -b "ptah_auth=$TOKEN"`**, never as an `Authorization` header — the
  corrected `V-CURL`.

**Validation notes**:

- 🔴 **DO NOT CREATE A GOOGLE CALENDAR EVENT.** Read paths only. `POST
/v1/members/session-requests` is the ONE write this batch may perform live and it makes no
  Calendar call.
- Capture `V-HEALTH` (`GET /api/health` → 200) and the four route mappings before anything
  else, so a later failure is attributable.
- Record the row census BEFORE and AFTER, in the report, as B12 did.

**Verification**:

```
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "<census>"
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health
curl -s -b "ptah_auth=$TOKEN" http://localhost:3000/api/v1/members/live | jq 'keys'
```

`200`, four keys, and a census that returns to its pre-batch values at the end.

---

### Task 13.2: `MemberLiveApiService` — and REPORT what the live feed contains ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-live-api.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-live-api.service.spec.ts` (NEW)

**Requirement refs**: §3.5, R3.3, R3.6, NFR-S1, NFR-P5, RISK-T
**Dependencies**: 13.1
**Pattern to follow**: `libs/web/members/src/lib/services/member-learning-api.service.ts` —
`@Injectable({providedIn:'root'})`, `inject(HttpClient)`, one method per endpoint, every
response through `validate(schema, 'GET /members/…')` from `@ptah-web/core`, **relative URLs**
(`apiInterceptor` prepends the base and sets `withCredentials`), **no signals and no cached
state**.

**Implementation details**:

- `read(page?, pageSize?)` → `Observable<MemberLiveResponse>` parsed with
  `memberLiveResponseSchema`. Send `?page`/`?pageSize` **only when supplied**; do not send the
  defaults, so the server's echoed `page`/`pageSize` remain the authority.
- **A `pageSize > MAX_PAGE_SIZE` guard THROWS CLIENT-SIDE rather than issuing a request that
  will `400`.** Copy `member-community-api.service.ts`'s `pageParams()` shape if it has one;
  otherwise state that this surface's guard is new and why.
- Export `feedItemKey(item)` = `` `${item.source}:${item.id}` `` from this file (RISK-AA) with
  a docblock quoting the contract's "NOT globally unique across sources" line.
- Export `formatDuration(durationSeconds: number)` — the unit is in the name (RISK-AD/RISK-O).
  `null` is not passed to it; the caller branches.
- **REPORT, DO NOT WORK AROUND.** B10's Task 10.2 rule: if the live response disagrees with
  the contract, the finding is the deliverable. Paste the real first item.

**Validation notes**:

- The spec uses `HttpTestingController` and asserts the **request URL and params** as well as
  the parse — a service that silently sends `?page=1` when nothing was asked is a different
  request from the one the contract describes.
- Assert `validate()` REJECTS a body missing `calendarAvailable`, and assert `z.object()`
  strips an unknown extra key rather than failing (RISK-C's asymmetry, in the tolerant
  direction).

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=member-live-api`

---

### Task 13.3: `MemberSessionRequestsApiService` — three methods, own-only by construction ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-session-requests-api.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-session-requests-api.service.spec.ts` (NEW)

**Requirement refs**: §3.5, R4.2, R4.3, R4.8, NFR-S4
**Dependencies**: 13.1
**Pattern to follow**: as 13.2.

**Implementation details**:

- `list()` → `MemberSessionRequest[]` (a bare array, **not** `Paged`), `submit({sessionTopicId,
additionalNotes?})` → `201 MemberSessionRequest`, `cancel(id)` → `{ canceled: boolean }`.
- 🔴 **`additionalNotes` IS OMITTED FROM THE WIRE WHEN EMPTY, NOT SENT AS `null` OR `''`.**
  The DTO is `@IsOptionalNotNull() @NullMeansAbsent() @MaxLength(5000)`. `member-learning-api.
service.ts`'s `createComment` makes the identical conversion for the identical reason —
  copy that shape, do not re-derive it.
- **`forbidNonWhitelisted` IS LIVE** (B12 measured `POST` with an unknown field → `400`). The
  request body carries **exactly** `sessionTopicId` and optionally `additionalNotes` — no
  `status`, no `scheduledAt`, no `isFreeSession`. A spec asserts the sent body's keys.
- **The client re-reads the list after a write** rather than splicing the response in — the
  same rule the lesson-comment path follows, and here it is also what keeps a cancel from
  leaving a row the server no longer agrees about.
- **`DELETE` answers `403` for "not yours", "already scheduled" AND "nonexistent",
  indistinguishably**, by design (an existence oracle otherwise). The copy for that `403` must
  contain none of "not allowed" / "forbidden" / "permission" — B7's thread-page spec asserts
  exactly that and it is the pattern to copy.

**Validation notes**:

- Assert the parse REJECTS a body carrying `calendarEventId` … no: `z.object()` strips it.
  **Assert instead that the parsed object has no `calendarEventId` own key** — which is the
  client half of NFR-S4 and is the assertion that would catch a future contract widening.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=member-session-requests-api`

---

### Task 13.4: `SessionCard` / `CalendarMonth` — promote to `@ptah-web/panel-ui`, or keep private ✅ COMPLETE — DECLINED, both kept private

**Files** (only if promoted):

- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\session-card\session-card.{ts,html,spec.ts}` (NEW)
- `D:\projects\ptah-extension\libs\web\panel-ui\src\index.ts` (MODIFY — **header count too**)

**Requirement refs**: §5.3, R9.7, PRE-3, RISK-M
**Dependencies**: none within the batch

**Implementation details / the decision**:

- 🔴 **§5.3's bar: "a primitive earns a place here when a SECOND panel ACTUALLY RENDERS IT."**
  The coarse plan names `SessionCard` and `CalendarMonth` as promotion candidates with
  `builders/sessions/sessions-list` and the `admin_sessions_calendar` screen as the admin
  consumers. **Neither admin screen is in this task's scope (RK-1)** — §3.5's admin routes
  exist and this batch renders none of them. This is the SAME fork Task 10.1 faced and
  resolved by keeping `ProgressMeter` private.
- **Recommended: keep BOTH private**, at `libs/web/members/src/lib/live/components/`, and
  **say in the report that §5.3's bar was not met**. `panel-ui` then has **zero** shared-registry
  edits this batch, which strengthens the parallelism claim and costs one file move later.
- 🔴 **`CalendarMonth` is additionally rejected on its own merits and that should be stated
  rather than deferred**: a month grid answers "what is on the 14th", and the feed the server
  serves is three ORDERED LISTS with no month boundary and a paged replay archive that spans
  years. Building a month view means either re-fetching per month (a parameter the endpoint
  does not take) or paginating a grid client-side. **The day-grouped schedule in Task 13.6 is
  the shape the data actually has.** Overruling this means adding a server range filter first.
- If promoted anyway: the barrel goes to **12 lines / 13 symbols** and the header docblock's
  numbers change **in the same edit** (RISK-M), and the second consumer's spec carries an
  assertion naming the dependency so the promotion dies with the consumer.
- **NFR-U2 is NOT lint-enforced in `libs/web/panel-ui`** — the Task 4.7 rule is scoped to
  `libs/web/members/**`. If anything lands there, hand-check for raw hex, `ink-*`, `amber-*`,
  Material-3 names and **`border-base-300`**, and say in the report that you did.

**Verification**: `npx nx lint web-panel-ui web-members --skip-nx-cache` · if promoted,
`npx nx test web-panel-ui --skip-nx-cache` and the barrel header reads the new count.

---

### Task 13.5: `SessionCard` + `LiveNowIndicator` — one card, three states, no provenance badge ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\live\components\session-card.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\live\components\session-card.spec.ts` (NEW)

**Requirement refs**: R3.3, R3.4, R3.5, R9.7, NFR-U2, NFR-U3, NFR-U4, ASSUMPTION-15, RISK-AC
**Dependencies**: 13.2 (for `formatDuration`)
**Pattern to follow**: `libs/web/members/src/lib/hub/sections/next-session-card.ts` — standalone,
`OnPush`, `input.required()`, `DatePipe`, `EmptyState`/`StatusBadge` from `@ptah-web/panel-ui`,
inline template, **zero injected services**.

**Implementation details**:

- `item = input.required<LiveFeedItem>()`. Renders title, a `<time [attr.datetime]>` start,
  the end when present, `meetLink` as a real `<a target="_blank" rel="noopener noreferrer">`
  when present, and `durationSeconds` through `formatDuration` when present.
- 🔴 **THE STATE COMES FROM `item.state` AND NOTHING ELSE (RISK-AC).** No `new Date()`, no
  `Date.now()`, no comparison against `startsAt`. A spec asserts the rendered marker changes
  when only `state` changes, with `startsAt` held fixed — which is the assertion a
  clock-recomputing implementation fails.
- 🔴 **NO PROVENANCE BADGE (ASSUMPTION-15, R3.3).** The words "Google", "Calendar" and "Ptah"
  appear nowhere in the rendered output. A spec asserts their absence against an item of each
  `source`. `source` is used only where behaviour genuinely differs.
- **`durationSeconds: null` and `youtubeVideoId: null` are the DEFAULT here, not edge cases**
  (ground truth 2). The card must look finished with both absent — no empty runtime slot, no
  dead play button.
- **A missing `meetLink` says so** rather than rendering a dead Join button — `next-session-
card.ts` already establishes the copy ("The join link is published by the host closer to the
  start time"); reuse the sentence, do not invent a second one.
- a11y: the live-now marker is not colour-only — it carries text (`LIVE NOW`) and the card's
  accessible name states the state. Touch target ≥ 44 px on the Join/Play affordance.

**Validation notes**:

- NFR-U3: title at full `base-content`; date/duration metadata at `text-base-content/60`;
  **`/40` nowhere** (ground truth 12).
- Assert `border-base-300` is absent from the rendered markup (B7's pattern), in addition to
  the lint rule.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=session-card`

---

### Task 13.6: `LivePage` — `/members/live`, four cells, degraded before empty ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\live\live-page.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\live\live-page.spec.ts` (NEW)

**Requirement refs**: R3.3, R3.5, R3.6, R6.4, R9.7, RISK-Z, RISK-AA, RISK-AB
**Dependencies**: 13.2, 13.5
**Pattern to follow**: `libs/web/members/src/lib/learning/courses-page.ts` — signals, `load()`
in the constructor, `loading` / `errorMessage` signals, `takeUntilDestroyed(this.destroyRef)`,
`describeLoadFailure()`, **rows CLEARED on failure** so a failed retry cannot leave stale
content under an error banner.

**Implementation details**:

- Renders `live` first (there is rarely one and it is the most urgent), then `upcoming`
  grouped by calendar day, then a link through to Replays. **`replays` is NOT rendered here** —
  it has its own route and its own paging.
- 🔴 **RISK-Z — THE BRANCH ORDER IS: error → loading → `calendarAvailable === false` →
  empty → list.** The spec is table-driven over the full cross-product of
  (`calendarAvailable` true/false) × (items present/absent). Four cells, four distinct renders:
  - `false` + empty → _"We could not read the session calendar just now."_ + _"Nothing has been
    cancelled — scheduled sessions will reappear here as soon as the calendar responds."_
    **`role="status"`, NOT `role="alert"`, and no error colour.** It is information, not a
    failure the member caused or can fix (R3.6 — **no error is shown to the member**).
  - `false` + items → the list, plus the same quiet note that it may be incomplete.
  - `true` + empty → _"No sessions scheduled yet."_ (`EmptyState`).
  - `true` + items → the list, no note.
- 🔴 **RISK-AA — every `@for` tracks `feedItemKey(item)`, never `item.id`.**
- **RISK-AB — group by calendar day** with a heading per day, and reveal 25 at a time with the
  remaining count stated on the button (_"Show 18 more"_). **Client-side reveal only** — the
  `upcoming` list takes no server page parameter and inventing one is a `400`.
- **A failure of the whole request is a retryable error, never an empty state** (R6.4, B7's
  rule). `calendarAvailable: false` is **not** that failure and must not render as one — that
  distinction is the whole of this task.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=live-page`

---

### Task 13.7: `ReplaysPage` — `/members/live/replays`, paged, reusing the facade player ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\live\replays-page.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\live\replays-page.spec.ts` (NEW)

**Requirement refs**: R3.4, NFR-S3, NFR-P5, ASSUMPTION-16, RISK-AD
**Dependencies**: 13.2, 13.5
**Pattern to follow**: `libs/web/members/src/lib/community/feed-page.ts` for the paging idiom;
`libs/web/members/src/lib/learning/lesson-page.ts` for hosting `YouTubePlayer`.

**Implementation details**:

- Reads the same `GET /members/live` and renders **`replays.items` only**, with `page` /
  `pageSize` / `total` / `hasMore` driving the pager. `pageSize` stays at the contract default
  (25) and never exceeds `MAX_PAGE_SIZE` (50).
- 🔴 **THE PLAYER IS THE EXISTING `YouTubePlayer` (ASSUMPTION-16, NFR-S3).** Import it from
  `../learning/youtube-player`. **Do not construct an iframe or an embed URL here** —
  `youtube-embed-chokepoint.spec.ts` pins the bypass to ONE file and will fail loudly, which
  is the good outcome. Extend that spec's importer list in the same change if it enumerates
  consumers.
- **Playback is inline and opt-in**: the card shows a poster; activating it mounts the player
  for that one item. Only one player is mounted at a time.
- **A replay with `youtubeVideoId: null` cannot occur by contract** (`'replay'` is only emitted
  when there is something to replay) — assert that in the spec rather than writing a defensive
  branch that can never run, and report it if the live feed contradicts it.
- `durationSeconds` through `formatDuration` (RISK-AD).

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=replays-page` ·
`npx nx test web-members --skip-nx-cache --testPathPatterns=youtube-embed-chokepoint` still green.

---

### Task 13.8: `RequestSessionPage` — `/members/live/request`, own requests only ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\live\request-session-page.ts` (NEW)
- `D:\projects\ptah-extension\libs\web\members\src\lib\live\request-session-page.spec.ts` (NEW)

**Requirement refs**: R4.2, R4.3, R4.8, R9.7, NFR-S4, ASSUMPTION-17, ASSUMPTION-18, ground truth 11
**Dependencies**: 13.3
**Pattern to follow**: `libs/web/members/src/lib/community/components/topic-composer.ts` — and
its two traps: **no `FormsModule`** (`ngModel` writes back through a microtask, so a keystroke
and the derived `canSubmit()` are one tick apart and every spec races), `(submit)` is the
**native** event not `(ngSubmit)`, and `maxlength` is `[attr.maxlength]` not `[maxlength]`.

**Implementation details**:

- A `<select>` over `SESSION_TOPICS` from `@ptah-web/core` (ASSUMPTION-18), submitting
  `topic.id`. **A `<select>` whose options come from an `@for` in the same change-detection
  pass must drive its choice through `[selected]` per option, not `[value]` on the select** —
  B7's finding, and it silently resets to the first option otherwise.
- A notes `<textarea>` with `[attr.maxlength]="5000"` matching the DTO, a live remaining count,
  and **empty → the key is omitted from the wire**, not sent as `''`.
- Below the composer: **this member's own requests**, each with `StatusBadge` over
  `SESSION_REQUEST_STATUSES`, the scheduled time when set, the Meet link when set, and
  `declineReason` when set (R4.8 — member-visible by design). `DetailDrawer` for the full row
  (R9.7).
- **`pending` rows carry a Withdraw action**; nothing else does. A `403` on withdraw re-reads
  the list and shows a neutral sentence — no "forbidden", no "not allowed", no "permission".
- 🔴 **`additionalNotes` AND `declineReason` RENDER AS ESCAPED TEXT NODES (ASSUMPTION-17,
  PRE-4, NFR-S2).** No `[innerHTML]`, no markdown component, no renderer import. The chokepoint
  spec's importer list stays at six.
- 🔴 **THE COPY PROMISES NO PRICE AND NO FREE SESSION (ground truth 11).** This endpoint runs
  no eligibility check and takes no payment; `is_free_session` defaults to `false` and
  `payment_status` to `'none'`. Say the request is reviewed and scheduled by the team. A spec
  asserts the rendered copy contains no currency symbol and neither "free" nor "$100".

**Validation notes**:

- The throttle is **10/min** on create (`CONTENT_CREATION`). A `429` gets its own sentence, not
  the generic failure copy.
- The status vocabulary is `SESSION_REQUEST_STATUSES`, imported — **no locally-declared union**.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=request-session-page`

---

### Task 13.9: Swap the three placeholder routes ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.spec.ts` (MODIFY)

**Requirement refs**: R9.4, RK-11, §5.2
**Dependencies**: 13.6, 13.7, 13.8
**Pattern to follow**: Task 10.10 — the three course routes were swapped the same way.

**Implementation details**:

- `live`, `live/replays` and `live/request` each get a `loadComponent`, **three separate lazy
  chunks**, replacing `loadPlaceholder` + `placeholder({…})`. Record the new chunk names and
  sizes from the production build.
- **The `data: placeholder(…)` blocks go with them.** After this task `MemberPlaceholderData`
  has two consumers left (`packs`, `notifications`) — say so, and do not delete the placeholder
  component.
- **No new parameter segment.** These three routes have none, so
  `members.routes.spec.ts`'s allowlist (`:slug`, `:lessonSlug`, `:id`) is unchanged. **No
  guard reappears anywhere in the subtree** — the spec fails if one does.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=members.routes` ·
the RK-11 probe run and reverted.

---

### Task 13.10: The proofs — e2e, both themes, axe, and the deliberate failures ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-live.spec.ts` (NEW)
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\support\db.ts` (MODIFY — live fixtures)

**Requirement refs**: exit-gate clauses 1–5, NFR-U4, NFR-U5, NFR-M1
**Dependencies**: 13.9
**Pattern to follow**: `apps/ptah-landing-page-e2e/src/specs/members-courses.spec.ts` — seeds
and tears down **by id**, with **per-statement isolation** and a warning on failure. **Do not
restore the single-`try` shape**: B10's first e2e run left nine orphaned courses behind
because one failing child delete abandoned the parent.

**Implementation details**:

- New fixtures: `seedLiveSession(...)` / `cleanupLiveSession(id)` writing `live_sessions`
  directly, with `visibility: 'member'` and `cohort_keys: '{}'` (the e2e Builder holds no
  assignment — the same reason `seedCourse` does it). **`calendar_event_id` stays NULL** —
  claiming a real event id is a write against a table whose `@unique` is load-bearing and it
  would change what the founder's real feed returns.
- 🔴 **ANTI-VACUITY FIRST, EVERY TIME.** Assert the seeded row is genuinely present and that
  the feed is genuinely populated before asserting anything about how it renders. B10's NFR-S3
  assertion was true-because-empty until it was made to fail.
- **Clause 2 — `calendarAvailable: false`** is proved with `page.route()` intercepting
  `**/api/v1/members/live` and rewriting the flag, asserting the surface renders, that the
  quiet note is present with `role="status"`, and that **no element with `role="alert"` and no
  error-coloured class exists**. 🔴 **State plainly that this is a CLIENT stub and does not
  close B12's F-1** (ground truth 5).
- **Clause 3 — own-only** uses BOTH seeded identities: identity A submits a request, identity B
  loads `/members/live/request`, and the assertion is that A's topic and notes are **absent**
  from B's page. A single-identity assertion proves nothing.
- **Clause 4 — both themes** on POPULATED surfaces, `[data-theme="…"]` asserted as actually
  attached, three surfaces × two themes = six screenshots.
- **Clause 5 — axe** on all three surfaces. Keep B10's scope (`include: [['body']]`,
  `exclude: [['iframe']]`) and say so. `@axe-core/playwright` is still not a devDependency —
  B10 loaded it from a CDN and **failed loudly** if the load failed; do the same and re-record
  the item for Batch 15.
- **At least three deliberate-failure proofs, each reverted and `diff`-confirmed
  byte-identical**: (i) collapse RISK-Z's branch order and watch the `false`+empty cell fail;
  (ii) change `feedItemKey` to `item.id` and watch the collision assertion fail; (iii) make the
  card recompute `state` from `new Date()` and watch the fixed-`startsAt` assertion fail.

**Validation notes**:

- **B7's five pre-existing e2e failures are NOT yours** (`admin-crud.spec.ts:16`,
  `admin-founding-invites.spec.ts:28,65`, `auth.spec.ts:65`, `pricing-waitlist.spec.ts:22`).
  Report the same five and move on; do not weaken those assertions.
- Re-run the Batch-4 one-request hub assertion **unchanged** — it must still pass four phases
  later (R6.6).

**Verification**:

```
npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core,ptah-landing-page --skip-nx-cache
npx nx build ptah-landing-page --configuration=production
npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
```

Green, with the baselines in ground truth 7 as the comparison. Then the e2e run, then the
three deliberate failures with both runs pasted.

---

# PHASE 5 — Packs, notifications and closeout (refined at the Phase-4/Phase-5 boundary, 2026-08-10)

**Ships**: a member finds every pack repo link in-product with the access story told
_before_ the GitHub 404, and learns that something needs their attention from a badge on
their own nav — with no email, no socket and no Discourse anywhere in either repository.

---

## Batch 14: P5-BE — member packs, notifications, migration 5 ✅ COMPLETE (`54650edee`)

### 🔴 Phase 5 refinement — findings

**The three coarse batches were written before Phases 3 and 4 shipped, and before 32 further
commits landed on this branch. Nine of their claims are now wrong.** Every row below was
verified against the tree at `4b0313783` on 2026-08-10. Nothing is silently dropped and
nothing stale is silently kept.

| #       | Coarse text said                                                                                                       | Actually true at `4b0313783`                                                                                                                                                                                                                                                                                    | Disposition                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **F-A** | B14.4: rewrite the `packs.types.ts` `:1-16` docblock to remove _"posted inside that cohort's Discourse group"_         | **That sentence is already gone.** Batch 5 (P1b) rewrote it. `packs.types.ts:8-19` now reads _"the repo link handed to the cohort"_ and already names Batch 14. `admin-packs.controller.ts:38-50` likewise.                                                                                                     | **Task 14.6, RESHAPED** — the work is retiring the _"until that lands"_ tense  |
| **F-B** | B14.2: _"mirroring how `PacksService` refuses to inject `BuildersMembershipService`"_                                  | **`BuildersMembershipService` DOES NOT EXIST** — P1b deleted it. The live symbols are `MembershipService` and `MemberGroupsService`, and `packs.service.ts:34-37` names those two. `member-pack.contract.ts:37` already states the corrected sentence.                                                          | **Task 14.7, CORRECTED NAMES**                                                 |
| **F-C** | B14 implies the Phase-5 contracts are this batch's                                                                     | **Every Phase-5 contract already ships.** `MemberPack` + `memberPackSchema`, `MemberNotification` + `memberNotificationSchema`, `HubNotificationSummary`, `NOTIFICATION_KINDS` (5), `NOTIFICATION_TARGET_TYPES` (4), `isNotificationKind`, and `AdminPack.memberVisible`/`.accessNote`. Batch 2 wrote them all. | **Task 14.4 is a RECONCILE, not an author**                                    |
| **F-D** | B14.7: hub `packs` and `notifications` sections → `'ok'`                                                               | `HUB_SECTION_STATUSES` is `['ok','empty','unavailable']` and **status is data-dependent**. With `packs` at 0 rows and no notifications, the honest post-batch answer is still `'empty'`. A resolver hard-coded to `'ok'` would be a new lie replacing an old one.                                               | **Task 14.16, RESTATED** — read the table, derive the status, seed to see `ok` |
| **F-E** | Plan §2.7 puts `member-packs.*` under `libs/api/community/src/lib/packs/`                                              | **Structural test G6 asserts every controller in `PacksModule` is mounted under `v1/admin/`**, and `packs.module.ts:29-36` says `PacksService` is deliberately not `@Global`. A member controller added to `PacksModule` fails G6.                                                                              | **Task 14.8 — new `MemberPacksModule`, same directory, different module**      |
| **F-F** | (unstated) the `@Cron` prune is routine                                                                                | **`@nestjs/schedule` (`^6.1.1`, `package.json:109`) is installed and wired NOWHERE.** Zero `ScheduleModule`, zero `@Cron` in the whole repo. B14's prune is the **first scheduled job in this server**, and a `@Cron` without `ScheduleModule.forRoot()` is inert and silent.                                   | **Task 14.9 — RISK-AE, the highest risk in this batch**                        |
| **F-G** | Commit plan: valid scopes are the 13 listed at line 9463                                                               | **`a13b12cac` expanded `scope-enum` to ~100 scopes**, including `api-community`, `api-member-hub`, `api-forum`, `web-members`, `web-panel-ui`, `migration`, `e2e` — but **there is no `api-notifications`**, and `.commitlintrc.json` is MODIFIED right now by TASK_2026_197.                                   | **Keep `license-server` / `landing`. Do NOT touch `.commitlintrc.json`.**      |
| **F-H** | PRE-7: _"`TASK_2026_176` is active in the same specs directory"_                                                       | **`.ptah/specs` is TRACKED IN GIT since `eb10c5cb8`.** `git status` right now shows `M .ptah/specs/TASK_2026_179/task.md`, `TASK_2026_184/task.md`, `TASK_2026_197/tasks.md` — three FOREIGN carriers. The active neighbours are 171, 173, 189, **197**, not 176.                                               | **PRE-7 amended below; `git add .ptah/specs` is now a hazard**                 |
| **F-I** | B13 carried forward: _"`@axe-core/playwright` is STILL not a devDependency"_                                           | **It IS.** `package.json:202` — `"@axe-core/playwright": "^4.12.1"`. Both CDN loaders (`members-courses.spec.ts:663`, `members-live.spec.ts:504`) still assert in comments that it is absent.                                                                                                                   | **Task 15.10 — closed by migrating BOTH loaders**                              |
| **F-J** | B13 F-9: `libs/web/members/src/lib/__fixtures__/` is untracked                                                         | **Closed by `80444178e`** (`chore(landing): track the member curriculum body fixtures`). Still has no consumer.                                                                                                                                                                                                 | **Closed. Do not re-report.**                                                  |
| **F-K** | B12 ground truth 13: `prisma.config.ts` loads a `.env` that does not exist, so pass `DATABASE_URL` on the command line | **Fixed by `4898d2601`** — it now loads the repo-root `.env` too. The manual `DATABASE_URL` workaround is no longer needed (harmless if kept).                                                                                                                                                                  | **Task 14.3 simplified**                                                       |
| **F-L** | B16.5: `rg -i discourse` across **both** repositories returns zero hits outside the export JSON and this task's specs  | **NOT SATISFIABLE AS WRITTEN.** 19 non-spec, non-export hits remain and **6 of them are inside immutable Prisma migration SQL** that NFR-M3 forbids editing. Another is Prisma's generated client echoing a schema comment.                                                                                     | **Task 16.5 — the gate is amended and the amendment is the deliverable**       |
| **F-M** | B16.1-16.3: inventory the community **skills** at `D:/projects/seshat` and rewrite or delete each                      | 🔴 **`D:/projects/seshat` CONTAINS ZERO SKILLS AND IS NOT A GIT REPOSITORY.** It is five markdown files (`BRIEF`, `OPERATIONS`, `PRD`, `README`, `.gitignore`) plus a `reference/` directory of junctions. Five skills are _declared_ in `PRD.md:213-219` and none was ever created.                            | **B16 RESHAPED — see the Batch 16 findings block**                             |

**B12's F-1 — the still-open finding B13 recorded — IS CLOSED BY THIS BATCH, in Task 14.14.**
B13's F-7 was right that a `page.route()` client stub cannot prove a server branch, and right
that closing it needs _"a server-side test that stubs `GoogleAuthProvider`"_ belonging to
_"whoever next touches `session-requests.service.ts`"_. **That is Task 14.14**, which wires the
`session_request.status` producer into `accept` / `reschedule` / `decline` — the three methods
that carry the `503`. `session-requests.service.spec.ts:139` already constructs the service with
`calendar as unknown as GoogleCalendarProvider`, so a double whose `isEnabled()` returns `false`
is a two-line addition against an existing harness. **If Task 14.14 does not close it, the report
must re-file it explicitly rather than let it lapse.**

---

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential — and **dispatch it in THREE parts, as Batch 6, 9 and 12 were.**
17 tasks across one new lib, one extended lib, one migration, the first scheduled job in this
server, and five shared-registry files.

| Dispatch | Tasks         | Shape                                                                                                                                                             |
| -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **14A**  | 14.1 – 14.6   | Pre-flight, `schema.prisma`, **migration 5**, the contracts reconcile, the admin DTO + nullable census, the R5.6 docblocks. Ends after the one irreversible step. |
| **14B**  | 14.7 – 14.12  | `member-packs` service + controller + module; `libs/api/notifications` scaffold, service, retention cron, controller. No producer, no registry edit.              |
| **14C**  | 14.13 – 14.17 | The four producers, the four RISK-L spec rewrites, the registries, the two hub sections, and the exit-gate proofs.                                                |

**Rationale**: packs and notifications are one batch because they share migration 5 and both
land hub sections that must move together (R6.6 — the hub envelope changes once or not at all).
They are **not** one dispatch: 14A ends on an applied migration, and nothing may be built on
top of it inside the same dispatch that authored it.

**Dependencies**: Batch 6 (forum — the notification **producers** need topics and posts to
exist, §8.1), Batch 12 (migration order, and the `session_request.status` producer's three
methods), Batch 3 (the hub sections this extends)
**Preconditions**: PRE-1, PRE-2, PRE-6, **PRE-7 as amended by F-H**
**Tasks**: 17

**Scope boundary (RK-1, AD-14, §5)**: 🔴 **no websocket, no SSE, no email, no push, no digest.
Poll only.** `libs/api/licensing`'s existing `@Sse` endpoint is **NOT** extended and **NOT**
imported. Also out: no admin notification surface (R10 is a member-owned inbox; an admin
"see everyone's notifications" screen is not in scope and would go in `admin/` re-declared);
no notification preferences or mute settings; no per-kind opt-out; no `announcement` producer
(the fifth kind is declared in the contract and has **no** producer in this task — say so);
no GitHub access provisioning and no pack **content** (R5.7 — only the discovery and
link-delivery channel moved in-product); no change to `Pack`'s existing columns.

**File set** (for the serialisation claim): `libs/api/notifications/**` (NEW),
`libs/api/community/src/lib/packs/**`, `libs/api/forum/src/lib/posts/**`,
`libs/api/forum/src/lib/forum.module.spec.ts`,
`libs/api/learning/src/lib/learning.module.spec.ts`,
`libs/api/community/src/lib/google-sessions/**`,
`libs/api/community/src/lib/live-sessions/live-sessions.module.{ts,spec.ts}`,
`libs/api/core/src/lib/common/nullable-dto.spec.ts`,
`libs/api/member-hub/src/lib/sections/{packs,notifications}.section.ts` (+ new specs),
`libs/api/audit/src/lib/audit-log.types.ts`,
`apps/ptah-license-server/prisma/schema.prisma`,
`apps/ptah-license-server/prisma/migrations/20260902090000_packs_visibility_and_notifications/**`,
`apps/ptah-license-server/src/app/app.module.ts`,
`apps/ptah-license-server/src/testing/controller-registry.ts`,
`apps/ptah-license-server/src/common/{route-map,controller-validation}.spec.ts`,
`tsconfig.base.json` (**one alias**, `@ptah-api/notifications`).

🔴 **B14 CANNOT OVERLAP ANYTHING.** It edits `tsconfig.base.json` — the one shared file B12
avoided — plus `schema.prisma`, `app.module.ts`, `controller-registry.ts`, `route-map.spec.ts`,
`controller-validation.spec.ts` and the shared nullable-DTO census. `context.md`'s
serialisation rule exists for exactly this shape.

**Exit gate (§8.2 P5, backend half)** — six clauses, each with a named owner task:

1. **`MemberPack` serialization asserts `notes` is absent under all circumstances** (Task 14.7,
   R5.2 / NFR-S5) — asserted on the mapper AND on a live `V-CURL` body, **and proven by
   deliberate failure**.
2. **A member's own action creates NO notification for them** (Task 14.10, R10.2) — the
   suppression lives in `create()` and nowhere else, proven by a producer-level test that
   drives the real `createReply` path with author == actor.
3. **The retention prune deletes READ rows older than 90 days and NOTHING else** (Task 14.11,
   R10.6) — unread-and-ancient survives, read-and-recent survives, and the job is proven to be
   **actually scheduled**, not merely callable (RISK-AE).
4. **`GET /members/packs` filters on `memberVisible: true` and nothing else** (Task 14.7, A-1) —
   with a `cohortKey`-bearing pack visible to a zero-cohort member, and a static assertion that
   the service imports and injects neither `CohortResolver` nor `MembershipService`.
5. **Migration 5 makes no existing pack member-visible** (Task 14.3) — `member_visible` defaults
   to `false`, proven by counting `packs where member_visible = true` before and after.
6. **B12's F-1 is closed**: the `503 scheduling_unavailable` branch is exercised **server-side**
   with a `GoogleCalendarProvider` double whose `isEnabled()` is `false`, on all three of
   `accept` / `reschedule` / `decline`, asserting the DB row is untouched (Task 14.14).

Plus the standing structural gates: `route-map` (RI-1/RI-2/RI-3, both ledgers still empty) ·
`controller-validation` (`NAMED_PRIMITIVE_PARAM_COUNT` **exactly 6**, `MIN_TOTAL_PAYLOAD_PARAMS`
re-derived and raised from **76**, `UNVALIDATED_DEBT` still `[]`) · the nullable-DTO census
(`libs/api/core/src/lib/common/nullable-dto.spec.ts`) green with its list re-derived ·
`admin-guards` G1 · packs G6 · `app.module.spec` boots · migration 5 applied against the
running `ptah_db` and confirmed by `npx prisma migrate status`.

---

### 🔴 Ground truth Phase 5 inherits — verified against the tree at `4b0313783` on 2026-08-10

**Do not re-derive these and do not plan against the plan's stale facts.**

1. 🔴 **THE BRANCH MOVED 32 COMMITS PAST B13.** B13 ended at `db584deaa`; HEAD is
   `4b0313783`. Three of those commits touch this task's file set: `a3830108d` (the
   `@IsOptional()` null hole, 59 fields), `4898d2601` (`prisma.config.ts` loads the repo-root
   `.env`), `80444178e` (tracked B13's F-9 fixtures). **B13's ground-truth-7 baselines are
   stale — re-measure before claiming a delta.**
2. 🔴 **EVERY PHASE-5 CONTRACT ALREADY SHIPS** (F-C). `MemberPack` + `memberPackSchema`
   (`member/member-pack.contract.ts`, 80 lines), `MemberNotification` +
   `memberNotificationSchema` and `HubNotificationSummary` + `hubNotificationSummarySchema`
   (`member/member-notification.contract.ts`), `NOTIFICATION_KINDS` (5) /
   `NOTIFICATION_TARGET_TYPES` (4) / `isNotificationKind` (`shared/notification-kind.ts`),
   `Paged<T>` + `pagedSchema` + `DEFAULT_PAGE_SIZE`(25)/`MAX_PAGE_SIZE`(50)/`FIRST_PAGE`(1)
   (`shared/paged.ts`), and `AdminPack.memberVisible` + `.accessNote`
   (`admin/admin-pack.contract.ts:64-71`). All exported from `src/index.ts:134-150`.
   **Do not re-declare any of them.**
3. 🔴 **`MemberNotification` CARRIES `actorName: string | null`, NOT `actorId`** — and
   `User` has **no `name` column**. It has `firstName String?` and `lastName String?`
   (`schema.prisma:27-28`). The mapper must compose a display name from those two, and
   **must NOT fall back to `email`** — another member's email is exactly the field NFR-S4
   keeps off member responses, and the contract says so in terms at `:62-66`. Both-null is a
   real case in this database; decide the fallback string once, in the mapper, and pin it.
4. 🔴 **`bodyPreview` IS PLAIN TEXT AND THE CONTRACT SAYS IT IS NOT SANITIZED**
   (`member-notification.contract.ts:71`). It is an excerpt of member-authored markdown.
   **The producer stores an excerpt; the client renders an escaped text node.** No renderer,
   no `[innerHTML]`, and `markdown-chokepoint.spec.ts`'s importer list stays at **six**.
5. 🔴 **`libs/api/notifications` DOES NOT EXIST AND FOUR MODULES ASSERT THAT IT DOES NOT.**
   `live-sessions.module.spec.ts:54-77`, `forum.module.spec.ts:34-50`,
   `learning.module.spec.ts:45-50` and `google-sessions.module.ts:67` each carry a RISK-L
   block. `live-sessions.module.spec.ts:79` additionally pins **"imports exactly the six
   modules that DO exist"**. Adding `NotificationsModule` breaks all of them **by design** —
   Task 14.14 rewrites them in the same change, and a batch that adds the import without
   rewriting them is reporting a red board rather than a finished one.
6. 🔴 **`session-requests.service.ts` IS UNDER `google-sessions/`, NOT `live-sessions/`** —
   `libs/api/community/src/lib/google-sessions/session-requests.service.ts`. The three
   status transitions are `accept` (`:255`), `reschedule` (`:385`), `decline` (`:486`), plus
   the member-side `cancelOwn` (`:169`) and `submit` (`:131`). All three admin transitions
   already run inside `prisma.$transaction`, so a notification write enlists in the existing
   transaction — the same shape `PacksService` uses for its audit row (PRE-6).
7. 🔴 **`SCHEDULING_UNAVAILABLE` (`:704`) HAS THREE CALL SITES**, not one: `accept:261`,
   `reschedule:390`, `decline:494`. B12's F-1 named only the first. Closing it means all three.
8. 🔴 **`@nestjs/schedule` IS INSTALLED AND WIRED NOWHERE** (F-F). `package.json:109`,
   `^6.1.1`. Zero `ScheduleModule` and zero `@Cron` in the entire repo.
   `apps/ptah-license-server/CLAUDE.md` mentions a "trial-reminder cron" — **that is not
   `@nestjs/schedule`** and is not a precedent to copy.
9. 🔴 **THE NULLABLE-DTO CENSUS IS NEW, SHARED, AND SCANS EVERY `*.dto.ts` UNDER `libs/api`
   WITH NO BY-NAME EXCLUSIONS** (`a3830108d`). It lives at
   `libs/api/core/src/lib/common/nullable-dto.spec.ts`. `EXPECTED_NULLABLE_OPTIONALS` holds
   **11** entries (four of them already `pack.dto.ts`'s `notes`/`cohortKey` pairs),
   `MIN_DTO_FILES = 50`, `LIBS_WITH_DTOS` lists **8** libs. `IsOptionalNotNull` and
   `NullMeansAbsent` were **promoted to `@ptah-api/core`**; the per-lib copies are now
   re-exports. **`accessNote` is genuinely nullable and must be censused; `memberVisible` is
   a boolean and must be `@IsOptionalNotNull()` and must NOT appear in the census.**
10. **Census constants, read from source**: `MIN_TOTAL_PAYLOAD_PARAMS = 76`
    (`controller-validation.spec.ts:224`, a **floor**), `NAMED_PRIMITIVE_PARAM_COUNT = 6`
    (`:250`, **exact equality** — one `@Query('status') status: string` anywhere in this
    batch fails the build), `UNVALIDATED_DEBT = []` (`:78`). ⚠️ **`PREFIX_EXCEPTIONS` and
    `KNOWN_PREFIX_DEBT` are in `route-map.spec.ts`, not `controller-validation.spec.ts`** —
    `:508` (one entry, `PublicMarketingController`) and `:558` (**empty**). **Add nothing to
    either.** `controller-registry.ts` holds **38** controllers and auto-discovers
    `libs/api/*/src`, so a new lib's controllers are found whether or not they are registered
    — and the census then fails until they are.
11. **RI-1 disjointness for the two new prefixes, checked segment-wise the way RI-1 actually
    checks.** `v1/members/packs` and `v1/members/notifications` against the nine existing
    member prefixes (`entitlement`, `hub`, `sessions`, `session-requests`, `live`,
    `community`, `courses`, `lesson-comments`, `search`) — segment 3 differs in every pair.
    ⚠️ `unread-count`, `:id/read` and `read-all` are **method paths inside** the one
    `v1/members/notifications` controller, not sibling prefixes.
12. **`CohortResolver` IS REAL, IS `@Global`, AND IS THEREFORE INJECTABLE FROM ANYWHERE** —
    `libs/api/membership/src/lib/cohort-resolver.service.ts:29`, one public method
    `resolveCohortKeys(userId): Promise<readonly string[]>`, provided by the `@Global()`
    `MembershipModule`. That is precisely why the absence assertion in Task 14.7 is worth
    writing: nothing structural stops the injection.
13. **The `Pack` table holds ZERO rows in this workspace** and `member_groups` holds one
    (`key='founding'`, `is_default=true`). Exit-gate clause 4 therefore needs the batch to
    **seed its own throwaway packs and tear them down by id** — a zero-row table makes every
    filter assertion vacuous.
14. **The command shapes that work here** (unchanged from B9/B12): `nx lint` **does not
    exist** for `libs/api/*` — the target is `eslint:lint`. Jest 30's flag is
    `--testPathPatterns=`. `npm run test` runs 3 unrelated projects and is never the gate.
    **Never `nx affected`** — a second process commits to this branch. Always an explicit
    project list with `--skip-nx-cache`, and `npx nx reset` when a **boundary** verdict is
    what is being claimed (B12's F-11).
15. 🔴 **`V-MIG` IS STILL SUPERSEDED. Do NOT run `prisma migrate dev`, `db push` or
    `migrate reset`.** Hand-author the folder; generate the DDL with
    `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
    strip Prisma 7's dotenv stdout banner; apply with `npx prisma migrate deploy`; confirm
    with `npx prisma migrate status`. **`DATABASE_URL` no longer needs passing explicitly**
    (F-K) but doing so is harmless. There are **20** migrations today; migration 5 makes 21.

---

### Risks surfaced by the Phase-5 refine pass

| #           | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Sev      | Mitigation                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-AE** | 🔴 **A `@Cron` WITHOUT `ScheduleModule.forRoot()` IS INERT, SILENT, AND UNIT-TEST-GREEN.** This is the first scheduled job in this server (ground truth 8). Every natural test calls `prune()` directly, so the decorator's wiring is never exercised — the prune passes its unit spec forever and never runs once in production. R10.6 is then satisfied on paper and unsatisfied in fact, and the failure is invisible until the table is years old.         | **HIGH** | Task 14.9 registers `ScheduleModule.forRoot()` in `app.module.ts` **in the same task that creates the lib**, and Task 14.11's spec asserts the wiring **structurally** — reflect the `SchedulerRegistry` out of a booted `Test.createTestingModule` and assert a cron job with the job's name is registered, not merely that the method exists.                  |
| **RISK-AF** | 🔴 **ONE CALL SITE PRODUCES TWO NOTIFICATION KINDS, AND THE SAME PERSON CAN EARN BOTH.** `topic.reply` and `post.child_reply` both come out of `PostsService.createReply()` (`:117`) — there is no `createChildReply`. When the topic author IS the parent post's author (the common case in a two-message thread), a naive producer writes **two rows for one event**, and R10.2's self-suppression does not catch it because neither recipient is the actor. | **HIGH** | Task 14.13 resolves the recipient set as a **de-duplicated set of user ids** before any write, and emits **one** row per distinct recipient with the more specific kind winning (`post.child_reply` over `topic.reply`). Its spec drives the real `createReply` with author == parent-author and asserts **exactly one** row. Deliberate-failure proof in 14.17. |
| **RISK-AG** | 🔴 **A MEMBER-FACING CONTROLLER IN `PacksModule` FAILS STRUCTURAL TEST G6** (F-E), and the plan's file layout (§2.7) puts `member-packs.controller.ts` in the `packs/` directory, which reads as "same module". `packs.module.ts:29-36` also refuses to be `@Global` precisely so a member-facing injection is impossible from elsewhere.                                                                                                                      | **HIGH** | Task 14.8 creates a **separate `MemberPacksModule`** in the same directory, importing nothing from `PacksModule` and providing its own `MemberPacksService`. `PacksModule` is byte-identical except for its docblock. G6 stays true as `admin-packs.controller.ts:48-50` predicted.                                                                              |
| **RISK-AH** | **`markRead` AND `read-all` ARE OWNERSHIP-SCOPED WRITES ON A GUESSABLE ID.** A cuid is not a secret, and `POST /members/notifications/:id/read` that filters on `id` alone lets any member mark any other member's notification read. It is a low-value write, which is exactly why it is the one that gets written without a `userId` clause.                                                                                                                 | MED      | Every write is an `updateMany` with `{ id, userId: ctx.userId }` in the **`where`**, never a `findUnique` followed by an ownership check — the two-step version has a window and reads as correct. A spec drives identity B against identity A's notification id and asserts `{ marked: 0 }` and the row untouched. NFR-S8.                                      |
| **RISK-AI** | **THE 60 s POLL IS THE MOST-CALLED ENDPOINT IN THE PRODUCT AND IT IS A `COUNT`.** Every open member tab issues it. Written as `findMany().length`, or without the composite index, it degrades linearly with a member's history and is the first thing to fall over.                                                                                                                                                                                           | MED      | `unreadCount` is `prisma.notification.count({ where: { userId, readAt: null } })` and nothing else, served by `@@index([userId, readAt, createdAt])` (plan §1.6). A spec asserts the query shape; the exit gate measures the live endpoint.                                                                                                                      |
| **RISK-AJ** | **`route` IS STORED AT WRITE TIME AND IS AN UNVALIDATED STRING ON A NAVIGATION PATH.** The client navigates to whatever the server stored. A producer that builds it from a slug with no constraint can persist an absolute URL, and the client's `router.navigateByUrl` then becomes an open redirect that survives every future routing change because the value is frozen in the row.                                                                       | MED      | One exported `buildNotificationRoute(targetType, target)` in `notification-kinds.ts`, returning a string pinned to start with `/members/` by a `satisfies`-style guard and a spec over all four target types. The client additionally refuses any stored `route` not starting with `/members/` (Task 15.4) — **defence at both ends**.                           |
| **RISK-AK** | **`memberVisible` DEFAULTS TO `false`, SO EVERY EXIT-GATE ASSERTION IS VACUOUSLY TRUE ON THIS DATABASE.** `packs` holds zero rows; after migration 5 it holds zero rows with a new column. "No pack leaked" and "the filter works" both pass against an empty table.                                                                                                                                                                                           | MED      | Task 14.1 and Task 14.17 seed **three** throwaway packs by known id — visible+cohort-labelled, visible+unlabelled, hidden — and assert the member sees exactly two, one of them cohort-labelled, with `notes` absent from both. Torn down by id, with a census proving it (B13's residue discipline).                                                            |
| **RISK-AL** | **`MIN_TOTAL_PAYLOAD_PARAMS` IS A FLOOR AND RAISING IT IS EASY TO FORGET.** It is 76. This batch adds payload params and the suite still passes if the number is left alone — the floor only fails downward.                                                                                                                                                                                                                                                   | LOW      | Task 14.15 **re-derives** the total from the run's own output and raises the constant, and the report pastes the old and new numbers. Same discipline B9 and B12 used.                                                                                                                                                                                           |

---

### Assumptions this refine pass takes (not in the plan; flag if wrong)

- **ASSUMPTION-19 — `libs/api/notifications` gets a FOURTH copy of the `common/` helpers it
  needs, or none at all.** `forum`, `learning` and `community` each carry their own
  `member-context.ts` / `admin-audit.ts` / `soft-delete.ts` copies (ASSUMPTION-11). A
  notification has **no** visibility rule, **no** soft delete and **no** admin mutation — it
  is owned by exactly one user and read by exactly that user. **So this lib copies nothing**
  and imports `MemberContext` as a type from `@ptah-api/membership`, the way the hub sections
  do. One import to overrule.
- **ASSUMPTION-20 — the `announcement` kind ships with NO producer.** It is declared in
  `NOTIFICATION_KINDS` and its target type is `LiveSession`, but R10.1's admin-publish action
  has no admin surface in this task (RK-1 keeps §3.5's admin routes unrendered). Writing a
  producer for an action nobody can take is dead code. **The kind stays in the enum, the
  service accepts it, and the report says plainly that four of five kinds have producers.**
- **ASSUMPTION-21 — notifications are created in the producer's OWN transaction, best-effort
  only where none exists.** The three admin session-request transitions and `createReply`
  already run inside `prisma.$transaction`, so the notification enlists there (PRE-6's shape)
  and a failed notification rolls the reply back. `accept()` is the one exception —
  §3.5 mandates Calendar-first / DB-second with a compensating delete (RISK-U), so the
  notification goes **after** the transaction commits, best-effort, logged on failure. A
  notification is not worth deleting a real Calendar event over.
- **ASSUMPTION-22 — `MemberNotification.actorName` falls back to `'A member'`, never to an
  email and never to `null` when the actor exists.** `null` is reserved for a genuinely
  system-generated row (ground truth 3). A user with both name columns null is a real row in
  this database, and rendering "replied to your topic" with a blank subject is worse than a
  generic one. One constant in one mapper to overrule.
- **ASSUMPTION-23 — the retention prune runs DAILY at a fixed off-peak hour, not hourly.**
  R10.6 says "prunable by a scheduled job" and names no cadence. 90 days is the window;
  running the sweep more than once a day buys nothing and puts a global
  `deleteMany` over `@@index([createdAt])` on a schedule. `CronExpression.EVERY_DAY_AT_4AM`,
  named as a constant, with the window (`RETENTION_DAYS = 90`) as a second named constant.
- **ASSUMPTION-24 — migration 5 keeps the plan's literal name
  `20260902090000_packs_visibility_and_notifications`.** The batch index (line ~108) says to
  let Prisma generate the timestamp, but B12 kept the plan's literal and the last applied
  migration is `20260826090000_live_and_private_sessions`, so `20260902090000` sorts strictly
  after with nothing in between. **Task 14.1 re-checks that no newer migration landed** — if
  one has, the timestamp moves and the suffix does not.

---

### Task 14.1: Pre-flight — the seven facts this batch is not allowed to guess ✅ COMPLETE

**Files**: none (verification only)
**Requirement refs**: PRE-1/2/6/7, §1.8, ground truth 1, 8, 9, 10, 13, 15, ASSUMPTION-24
**Dependencies**: none — this is the batch's root

**Implementation details** — run and paste all of it:

- `docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select migration_name from _prisma_migrations order by started_at desc limit 3;"` → 🔴 **`20260826090000_live_and_private_sessions` MUST be present and applied, and NOTHING may sort after `20260902090000`.** If something does, move the timestamp and say so (ASSUMPTION-24).
- `npx prisma migrate status` → _"Database schema is up to date!"_ with **20** migrations.
- `select column_name from information_schema.columns where table_name='packs' order by ordinal_position;` → the **eleven** current columns, so the two added are provably new. `select count(*) from packs;` → the pre-batch count (expected `0`).
- `select count(*) from packs where member_visible = true;` → **must error** (the column does not exist yet). This is the before-half of exit-gate clause 5.
- Read `libs/api/core/src/lib/common/dto-validation.pipe.ts` (PRE-1) **and** `libs/api/core/src/lib/common/optional-field.ts` + `nullable-dto.spec.ts` (ground truth 9) — state in one sentence which of `memberVisible` / `accessNote` is census-eligible and why.
- Paste `MIN_TOTAL_PAYLOAD_PARAMS`, `NAMED_PRIMITIVE_PARAM_COUNT`, `UNVALIDATED_DEBT` from `controller-validation.spec.ts` **and** `PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT` from `route-map.spec.ts`, each with its line number (ground truth 10 — the two files are different and the coarse plan conflated them).
- `grep -rn "ScheduleModule\|@Cron" --include=*.ts libs/api apps/ptah-license-server` → **zero hits** (RISK-AE's evidence, re-confirmed rather than trusted).
- `grep -rn "NotificationsModule" --include=*.spec.ts libs/api` → the **four** RISK-L sites Task 14.14 must rewrite.
- `git log --oneline -1` → confirm HEAD, and `git status --short` → confirm the foreign WIP set (F-H). **Name the foreign files in the report so no later `git add` is ambiguous.**

**Verification**: every value above pasted verbatim. A migration mismatch **STOPS the batch** — migrations are forward-only and sequential.

---

### Task 14.2: `schema.prisma` — two `Pack` columns, the `Notification` model, two `User` back-relations ✅ COMPLETE

**Files**: `apps/ptah-license-server/prisma/schema.prisma` (MODIFY)

**Requirement refs**: §1.2, §1.6, §1.7, A-1, R5.5, R10, ASSUMPTION-22
**Dependencies**: 14.1
**Pattern to follow**: the `LiveSession` model added by Batch 12 (same file) for a fresh model; the `Course.createdBy` precedent for a plain `String?` admin column.

**Implementation details**:

- `Pack` gains exactly two columns, inserted after `notes` so the admin/member pair reads together:
  - `memberVisible Boolean @default(false) @map("member_visible")` — 🔴 **the default is load-bearing (A-1, exit-gate clause 5): no existing pack becomes visible by migration.** Carry plan §1.2's comment verbatim, including _"cohortKey is NOT it and never becomes it."_
  - `accessNote String? @map("access_note")` — with plan §1.2's comment, including _"Distinct from `notes`, which stays admin-internal (R5.2)."_
- ⚠️ **No index on `member_visible`.** Plan §1.2 rejects it in terms: _"tens of rows, always read in full."_ Adding one is a deviation that must be argued, not assumed.
- `Notification` **verbatim from plan §1.6**, including both indexes and their comments: `@@index([userId, readAt, createdAt])` serves **both** the badge count (R10.4) and the newest-first list (R10.3); `@@index([createdAt])` serves the R10.6 global prune that the `userId`-leading index cannot.
- Both relations from §1.6: `user` (`onDelete: Cascade` — a notification is personal state with no meaning once the user is gone) and `actor` (`onDelete: SetNull` — the row survives the actor's deletion and reads as system-generated).
- `User` gains exactly the two back-relations from §1.7: `notifications Notification[] @relation("NotificationRecipient")` and `actedNotifications Notification[] @relation("NotificationActor")`, in the same commented region as the Phase-2/3/4 back-relations.
- ⚠️ **Every existing `Pack` field is left EXACTLY as it is.** `notes`, `cohortKey`, the `cohort` FK and `@@index([cohortKey])` keep their comments and meanings.

**Verification**: `npx prisma validate` and `npx prisma format --check`; `git diff` on the file shows **only** the additions above and no reformatting of untouched models.

---

### Task 14.3: Migration 5 — hand-authored, applied, and confirmed ✅ COMPLETE

**Files**: `apps/ptah-license-server/prisma/migrations/20260902090000_packs_visibility_and_notifications/migration.sql` (NEW)

**Requirement refs**: §1.8 row 5, NFR-M3, RISK-K, RISK-AK, ground truth 15, ASSUMPTION-24
**Dependencies**: 14.2

**Implementation details**:

- 🔴 **DO NOT RUN `prisma migrate dev`, `db push` OR `migrate reset`.** Create the directory by hand.
- Generate the DDL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, **strip Prisma 7's dotenv stdout banner**, and review every statement before saving. `DATABASE_URL` no longer needs passing explicitly (F-K).
- Expected statements, and **nothing else**: `ALTER TABLE "packs" ADD COLUMN "member_visible" BOOLEAN NOT NULL DEFAULT false`; `ALTER TABLE "packs" ADD COLUMN "access_note" TEXT`; `CREATE TABLE "member_notifications"`; its two indexes; its two foreign keys.
- ⚠️ **No `pg_trgm` index.** Migrations 2 and 3 own the only three (A-7); a notification has no searchable long text and RK-1 licenses no fourth.
- ⚠️ **Both added `packs` columns are nullable-or-defaulted**, so the migration is safe against a populated table and independently deployable (NFR-M3).
- Apply with `npx prisma migrate deploy`, then `npx prisma migrate status`.

**Verification**: `migrate status` → _"Database schema is up to date!"_ with **21** migrations · `\d packs` shows both columns with `member_visible` defaulting to `false` · `\d member_notifications` shows the table, both indexes and both FKs · `select count(*) from packs where member_visible = true;` → **`0`** (exit-gate clause 5, the after-half) · `select count(*) from member_notifications;` → `0` · a re-run of `migrate diff` produces an **empty** script. All pasted.

---

### Task 14.4: Contracts — reconcile, do not author ✅ COMPLETE

**Files**:

- `libs/api-contracts/community/src/lib/member/member-notification.contract.ts` (MODIFY — the three small response envelopes only)
- `libs/api-contracts/community/src/index.ts` (MODIFY — only if a new symbol is exported)

**Requirement refs**: §3.6, R10.3, R10.4, RK-8, ground truth 2, F-C
**Dependencies**: 14.1
**Pattern to follow**: `member-live.contract.ts` — a member contract file that says which batch extends it and then is extended exactly that far.

**Implementation details**:

- 🔴 **START BY READING WHAT ALREADY EXISTS.** `MemberPack`, `memberPackSchema`, `MemberNotification`, `memberNotificationSchema`, `HubNotificationSummary`, `hubNotificationSummarySchema`, `NOTIFICATION_KINDS`, `NOTIFICATION_TARGET_TYPES` and `isNotificationKind` **all ship**. **Re-declaring any of them is the failure mode this task exists to prevent.**
- What is genuinely missing is only the three write-response envelopes from plan §3.6's table: `{ readAt: string }` for `POST :id/read` and `{ marked: number }` for `POST read-all`. Declare them here **only if** they need a client-side parse; if the client treats them as fire-and-refetch (Task 15.4's stated design), say so and add **nothing**.
- The list response is `Paged<MemberNotification>` built from the existing `pagedSchema(memberNotificationSchema)` — **not** a new type.
- Update `member-notification.contract.ts`'s docblock: it currently says _"the only part Phase 1 emits … until Batch 14 lands R10."_ That tense is now false. State what ships.
- ⚠️ **No `admin/*` notification contract.** R10 is a member-owned inbox (scope boundary); `contract-boundary.spec.ts` enforces the split in both directions and must stay green untouched.

**Verification**: `npx nx run-many -t eslint:lint,typecheck,test -p api-contracts-community --skip-nx-cache` green, with `contract-boundary.spec.ts` and `member-progress-privacy.spec.ts` unchanged. The report states **explicitly** how many symbols this task added (expected: 0–2).

---

### Task 14.5: `pack.dto.ts` — two admin fields, and the shared nullable census ✅ COMPLETE

**Files**:

- `libs/api/community/src/lib/packs/dto/pack.dto.ts` (MODIFY)
- `libs/api/core/src/lib/common/nullable-dto.spec.ts` (MODIFY — `EXPECTED_NULLABLE_OPTIONALS`)

**Requirement refs**: R8.4, R5.5, A-1, PRE-1, ground truth 9, `a3830108d`
**Dependencies**: 14.2
**Pattern to follow**: the same file's existing `notes` / `cohortKey` handling — both are already censused nullable optionals.

**Implementation details**:

- `UpdatePackDto` gains `memberVisible?: boolean` and `accessNote?: string | null`. `CreatePackDto` gains the same two, `memberVisible` defaulting to `false` at the service layer rather than in the DTO (the column default is the authority).
- 🔴 **THE TWO FIELDS TAKE OPPOSITE DECORATORS AND THAT IS THE WHOLE POINT OF `a3830108d`:**
  - `memberVisible` is `boolean` on a non-nullable declared type → **`@IsOptionalNotNull()` + `@IsBoolean()`**. A present `null` must be a `400` naming the field, not a silent skip. **It must NOT appear in `EXPECTED_NULLABLE_OPTIONALS`.**
  - `accessNote` is genuinely nullable — `null` clears the column, exactly like `notes` — so it stays **`@IsOptional()`** and **MUST be added to `EXPECTED_NULLABLE_OPTIONALS`** as `community/src/lib/packs/dto/pack.dto.ts:UpdatePackDto.accessNote` (and the `CreatePackDto` entry if it is declared nullable there too). The census fails otherwise, which is the mechanism working.
- ⚠️ **A new census entry is a review event** — the spec's own docblock says so. State in the report, in one sentence, why `accessNote` accepting `null` is correct (it is the "clear this stored column" case) and why `memberVisible` accepting `null` would not be.
- `PATCH /v1/admin/packs/:id` binds `dtoPipe(UpdatePackDto)` already; confirm it, do not re-bind (PRE-1).

**Verification**: `npx nx test api-core --skip-nx-cache --testPathPatterns=nullable-dto` green with the census re-derived · `npx nx test api-community --skip-nx-cache --testPathPatterns=admin-packs` green · a hand `V-CURL` `PATCH` with `{"memberVisible": null}` → **`400` naming the field**, and with `{"accessNote": null}` → **`200`, column cleared**. Both pasted.

---

### Task 14.6: R5.6 — retire the conditional tense in three docblocks ✅ COMPLETE

**Files**:

- `libs/api/community/src/lib/packs/packs.types.ts` (MODIFY — the `:1-23` docblock, and `PackResponse`'s field list)
- `libs/api/community/src/lib/packs/admin-packs.controller.ts` (MODIFY — the `:29-50` docblock)
- `libs/api/community/src/lib/packs/packs.service.ts` (MODIFY — the `:24-47` class docblock)
- `libs/api/community/src/lib/packs/packs.module.ts` (MODIFY — the `:9-37` docblock)

**Requirement refs**: R5.6, R5.7, A-1, F-A, F-B, RISK-AG
**Dependencies**: 14.5
**Pattern to follow**: how `sessions.section.ts`'s docblock named its future caller and was then corrected by that caller.

**Implementation details**:

- 🔴 **THE DISCOURSE SENTENCE IS ALREADY GONE (F-A).** Batch 5 rewrote it. Do **not** go looking for _"posted inside that cohort's Discourse group"_ — it is not there, and `rg -i discourse` over `libs/api/community/src/lib/packs/` returns **zero**. Confirm that in the report rather than performing a no-op edit.
- What is actually stale is the **conditional tense**, in four places:
  - `packs.types.ts:17-19` — _"Until that lands there is no member-facing endpoint reading this table."_ → it lands here. State the shipped channel in the present tense, keep _"delivering a link is not granting access"_ verbatim (R5.7).
  - `packs.types.ts:28-29` — `notes` is described as _"never shown to a member; no member surface exists."_ The second clause becomes false. The first must become **stronger**, not weaker: name the NFR-S5 assertion and the `MemberPack` re-declaration that make it structural.
  - `admin-packs.controller.ts:39-50` — _"THIS MODULE HAS NO MEMBER-FACING SIBLING TODAY"_ and _"Phase 5 (Batch 14) adds…"_. It now has a sibling **module**, and G6 is still true because the sibling is not in `PacksModule`. Say exactly that (RISK-AG).
  - `packs.service.ts:27-32` — _"THERE IS NO MEMBER-FACING READ PATH, BY DESIGN"_. Still true **of this service**; false of the table. Narrow the claim to the service and name `MemberPacksService` as the read path that exists, with the reason the two are separate.
- ⚠️ **`packs.service.ts:34-37` names `MembershipService` and `MemberGroupsService`, not `BuildersMembershipService`** (F-B). Keep the live names. `BuildersMembershipService` does not exist and referencing it would re-introduce a ghost.
- `PackResponse` gains `memberVisible: boolean` and `accessNote: string | null` (the admin shape mirrors `AdminPack`), and `toPackResponse` maps both.
- ⚠️ **Ptah still serves no pack content and provisions no GitHub access (R5.7).** Every one of these docblocks must still say so after the edit. A reviewer should be able to grep `R5.7` and find it.

**Verification**: `npx nx run-many -t eslint:lint,typecheck,test -p api-community --skip-nx-cache` green · `rg -i discourse libs/api/community/src/lib/packs/` → **0** · `rg "BuildersMembershipService" libs/api/community/` → **0** · `git diff --stat` shows four files, docblocks and one interface only.

---

### Task 14.7: `MemberPacksService` — `memberVisible` only, and the two absences that are the control ✅ COMPLETE

**Files**:

- `libs/api/community/src/lib/packs/member-packs.service.ts` (NEW)
- `libs/api/community/src/lib/packs/member-packs.service.spec.ts` (NEW — incl. the NFR-S5 field-absence assertion)
- `libs/api/community/src/lib/packs/packs.types.ts` (MODIFY — add `toMemberPack`)

**Requirement refs**: R5.1, **R5.2**, R5.3, **R5.4 / A-1**, R5.5, NFR-S4, **NFR-S5**, RISK-AK, ground truth 12
**Dependencies**: 14.6
**Pattern to follow**: `libs/api/learning/src/lib/courses/course-read.service.ts` — a member read service whose only dependency is `PrismaService` and whose mapper is a pure exported function.

**Implementation details**:

- `list(ctx: MemberContext): Promise<MemberPack[]>` → `prisma.pack.findMany({ where: { memberVisible: true }, include: COHORT_INCLUDE, orderBy: { title: 'asc' } })` mapped through `toMemberPack`.
- 🔴 **THE `where` CLAUSE IS EXACTLY `{ memberVisible: true }` AND NOTHING ELSE (A-1).** No `cohortKey` clause, no `ctx.cohortKeys` clause, no visibility helper. `ctx` is taken as a parameter **for the guard contract's sake and is deliberately unread by the query** — say so in the docblock, because an unused parameter otherwise reads as a bug and the next reader "fixes" it into a filter.
- 🔴 **`toMemberPack` is a STANDALONE mapper that names its eight output fields explicitly.** No spread of the Prisma row, no `omit`, no `delete`. `notes`, `createdBy`, `createdAt`, `updatedAt`, `cohortKey` and `memberVisible` are absent **because they were never written**, not because they were removed — a spread-then-delete mapper leaks the day someone adds a column.
- `cohortName` comes from `COHORT_INCLUDE`'s `cohort.name`, `null` when unlabelled or the cohort was deleted (`onDelete: SetNull`).
- **The service injects `PrismaService` and NOTHING ELSE.** No `AuditLogService` (a read), no `MembershipService`, no `MemberGroupsService`, no `CohortResolver`.

**Validation notes** — the spec carries four assertions, and two of them are about absence:

- 🔴 **NFR-S5 (exit-gate clause 1)**: for a pack whose `notes` is a non-empty string, `expect(Object.keys(result[0])).not.toContain('notes')` **and** `expect(JSON.stringify(result)).not.toContain(theNotesValue)`. The second is what catches a `notes` value smuggled into another field.
- 🔴 **The absence-of-injection assertion, written the way `admin-courses.controller.spec.ts:484-504` writes it**: read `member-packs.service.ts` as source text and assert it matches **neither** `/import\s[^;]*\bCohortResolver\b[^;]*from/` **nor** `/@Inject\(\s*CohortResolver\s*\)/`, and the same pair for `MembershipService` and `MemberGroupsService`. `CohortResolver` is `@Global` and injectable from anywhere (ground truth 12) — nothing structural stops it, so this test **is** the control.
- **A-1 positively**: three fixture packs — visible+cohort-labelled, visible+unlabelled, hidden — against a **zero-cohort** `ctx`. The member sees exactly two, and the cohort-labelled one is among them. A cohort-filtering implementation returns one and fails here (RISK-AK).
- **`accessNote` survives the mapper** as its own field and is never conflated with `notes` (R5.5).

**Verification**: `npx nx test api-community --skip-nx-cache --testPathPatterns=member-packs`

---

### Task 14.8: `MemberPacksController` + `MemberPacksModule` — a new module, not a new controller in `PacksModule` ✅ COMPLETE

**Files**:

- `libs/api/community/src/lib/packs/member-packs.controller.ts` (NEW)
- `libs/api/community/src/lib/packs/member-packs.controller.spec.ts` (NEW)
- `libs/api/community/src/lib/packs/member-packs.module.ts` (NEW)
- `libs/api/community/src/index.ts` (MODIFY — export `MemberPacksModule`)

**Requirement refs**: §3.6, R5.1, PRE-1, PRE-2, **RISK-AG / G6**, ground truth 11
**Dependencies**: 14.7
**Pattern to follow**: `libs/api/community/src/lib/live-sessions/member-live.controller.ts` — the most recent member controller in this lib, with the `MemberGuard` chain and the AD-12-style prefix discipline.

**Implementation details**:

- `@Controller('v1/members/packs')` with the member guard chain declared at **class** level, mirroring `MemberLiveController` exactly. One handler: `@Get()` → `MemberPack[]`.
- 🔴 **A BARE ARRAY, NOT `Paged`.** Plan §3.6's table says `MemberPack[]`, and §1.2 rejects an index on `member_visible` because the table is _"tens of rows, always read in full."_ Paginating it would contradict both. **No `@Query` params at all** — which also keeps `NAMED_PRIMITIVE_PARAM_COUNT` at exactly 6 (ground truth 10).
- 🔴 **`MemberPacksModule` IS A SEPARATE MODULE (RISK-AG).** It provides `MemberPacksService`, declares its own guard providers the way `PacksModule` does, and **imports nothing from `PacksModule`**. `PacksModule` is unchanged except for Task 14.6's docblock. **G6 — "every controller in `PacksModule` is mounted under `v1/admin/`" — must still pass, unmodified.** If a task appears to need G6 weakened, stop and report.
- Both modules live in the same directory on purpose (plan §2.9's layout); the report states that co-location is not co-registration and names the test that proves it.

**Validation notes**:

- The spec asserts the class-level guards (a method-only guard is leak risk L1, asserted by G1).
- A structural assertion that `MemberPacksModule`'s `controllers` array contains **exactly one** controller and that it is **not** in `PacksModule`'s.

**Verification**: `npx nx test api-community --skip-nx-cache --testPathPatterns="member-packs|packs.module"` · `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="admin-guards"` — G1 and G6 both green and **untouched**.

---

### Task 14.9: `libs/api/notifications` scaffold — and `ScheduleModule.forRoot()`, the first cron in this server ✅ COMPLETE

**Files**:

- `libs/api/notifications/{project.json,eslint.config.mjs,package.json,jest.config.cts,tsconfig*.json,README.md}` (NEW)
- `libs/api/notifications/src/index.ts` (NEW)
- `libs/api/notifications/src/lib/notifications.module.ts` (NEW — `@Global()`)
- `libs/api/notifications/src/lib/notifications.module.spec.ts` (NEW)
- `libs/api/notifications/src/lib/notification-kinds.ts` (NEW — `buildNotificationRoute`)
- `tsconfig.base.json` (MODIFY — **one** alias, `@ptah-api/notifications`)
- `apps/ptah-license-server/src/app/app.module.ts` (MODIFY — `ScheduleModule.forRoot()` **and** `NotificationsModule`)

**Requirement refs**: §2.7, R10, **RISK-AE**, **RISK-AJ**, ASSUMPTION-19, RISK-F
**Dependencies**: 14.3
**Pattern to follow**: `libs/api/membership` — the other `@Global()` lib in this task, and the one whose tag set must be matched (RISK-F: a `type:util` lib may depend only on `type:util` libs; check the tag census before scaffolding and state which tags this lib takes and why).

**Implementation details**:

- 🔴 **`ScheduleModule.forRoot()` LANDS HERE, IN THE SAME TASK THAT CREATES THE LIB (RISK-AE).** `@nestjs/schedule@^6.1.1` is installed and imported nowhere in the repo. A `@Cron` added in Task 14.11 without this line is **inert, silent, and unit-test-green forever**. Register it in `app.module.ts`'s `imports` beside `EventEmitterModule.forRoot()`, with a comment saying it exists for `NotificationRetentionService` and that it is the first scheduled job in this server.
- `NotificationsModule` is `@Global()` — plan §2.7's stated reason is that producers live in three libs (`forum`, `learning`, `community`) and an explicit import in each would make the dependency graph carry an edge per producer. **Say that in the module docblock**, and contrast it with `PacksModule`, which refuses `@Global` for the opposite reason.
- **`ASSUMPTION-19`: this lib copies NO `common/` helpers.** A notification has no visibility rule, no soft delete and no admin mutation. `MemberContext` is imported as a **type** from `@ptah-api/membership`. Record the decision in the module docblock so the next reader does not add a fourth copy by symmetry.
- `notification-kinds.ts` exports **`buildNotificationRoute(targetType, target)`** (RISK-AJ) — the single place a stored `route` is constructed, returning a string that **must** start with `/members/`, with a spec over all four `NOTIFICATION_TARGET_TYPES`. It re-exports nothing from the contracts lib; `NotificationKind` and `NotificationTargetType` are imported as types.
- ⚠️ **One `tsconfig.base.json` alias.** This is the shared file that forces B14's serialisation (`context.md`'s rule). Add it once, at the top of the batch, and touch the file no further.

**Validation notes**:

- `notifications.module.spec.ts` asserts the module is `@Global()`, exports exactly the service surface Task 14.10 defines, and **does not export the Prisma client or any `where`-builder** — the same reasoning `forum.module.spec.ts` uses for its `common/` non-export.
- A spec asserts `buildNotificationRoute` returns a `/members/`-prefixed path for all four target types and **throws** for an unknown one.

**Verification**: `npx nx show project api-notifications` resolves · `npx nx run-many -t eslint:lint,typecheck,test -p api-notifications --skip-nx-cache` green · `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=app.module` boots with the real injector.

---

### Task 14.10: `NotificationsService` — one suppression, one ownership clause, one count ✅ COMPLETE

**Files**:

- `libs/api/notifications/src/lib/notifications.service.ts` (NEW)
- `libs/api/notifications/src/lib/notifications.service.spec.ts` (NEW)

**Requirement refs**: **R10.2**, R10.3, R10.4, NFR-S4, NFR-S7, NFR-S8, NFR-P5, **RISK-AH**, **RISK-AI**, ASSUMPTION-21, ASSUMPTION-22, ground truth 3
**Dependencies**: 14.9
**Pattern to follow**: `libs/api/forum/src/lib/read-state/*.service.ts` — a per-member service whose every write is ownership-scoped in the `where`.

**Implementation details** — four methods, and each one has exactly one thing that can go wrong:

- 🔴 **`create({ recipientId, actorId, kind, targetType, targetId, title, bodyPreview, route, tx? })` RETURNS WITHOUT WRITING WHEN `recipientId === actorId` (R10.2).** This is the whole reason the service exists rather than four inline `prisma.notification.create` calls: **suppression lives in ONE place so no producer can forget it.** It returns `null` (not a thrown error, not a written row) and the producers ignore the return. The docblock states that a producer must **never** pre-check the equality itself — a second copy of the rule is a second place for it to drift.
  - `tx?` is an optional `Prisma.TransactionClient` so a producer can enlist the write in its own transaction (ASSUMPTION-21), exactly as `AuditLogService.write` accepts one (PRE-6).
- **`list(ctx, { page, pageSize })` → `Paged<MemberNotification>`, newest first (R10.3).** `pageSize` defaults to 25, maxes at 50, and `> 50` is a **`400`, not a silent clamp** (NFR-P5, and the shape every other paged member endpoint in this task already uses).
- 🔴 **`markRead(ctx, id)` and `markAllRead(ctx)` ARE `updateMany` WITH `userId` IN THE `where` (RISK-AH).** Never `findUnique` → check → `update`: that has a window and reads as correct. `markRead` returns `{ readAt }` from a re-read, or the not-found shape when `count === 0` — **and the not-found and not-yours responses are indistinguishable**, because a distinguishable one is an existence oracle over guessable cuids.
- 🔴 **`unreadCount(ctx)` IS `prisma.notification.count({ where: { userId, readAt: null } })` AND NOTHING ELSE (RISK-AI).** Not `findMany().length`. This is the most-called endpoint in the product — every open member tab hits it every 60 s — and it is served by `@@index([userId, readAt, createdAt])`.
- **The mapper resolves `actorName` from `firstName`/`lastName` and NEVER from `email`** (ground truth 3, NFR-S4). Both-null on an existing actor yields the ASSUMPTION-22 constant, not `null`; `null` is reserved for a genuinely actor-less row. One named constant, one mapper, one spec.
- Prisma errors map through the sanitized-exception pattern (`packs.service.ts:277-313`); no raw `error.message` reaches a client (NFR-S7).

**Validation notes**:

- 🔴 **The R10.2 assertion is exit-gate clause 2** and is asserted **twice**: once directly on `create()`, and once in Task 14.13 through the real producer path. A unit-only assertion proves the branch exists; the producer test proves it is on the path that matters.
- The RISK-AH assertion drives identity B against identity A's notification id and asserts `{ marked: 0 }` **and** that A's row still reads `readAt: null` afterwards.
- A `NOTIFICATION_KINDS`-exhaustive test: every one of the five kinds round-trips through `create` → `list` → parse against `memberNotificationSchema`. `announcement` is included even though it has no producer (ASSUMPTION-20).
- Assert the serialized shape has **no** `userId` and **no** `actorId` own key — the client gets `actorName` and nothing that identifies another member (NFR-S4).

**Verification**: `npx nx test api-notifications --skip-nx-cache --testPathPatterns=notifications.service`

---

### Task 14.11: `NotificationRetentionService` — 90 days, READ rows only, and proven to be scheduled ✅ COMPLETE

**Files**:

- `libs/api/notifications/src/lib/notification-retention.service.ts` (NEW)
- `libs/api/notifications/src/lib/notification-retention.service.spec.ts` (NEW)

**Requirement refs**: **R10.6**, NFR-M3, **RISK-AE**, ASSUMPTION-23
**Dependencies**: 14.10

**Implementation details**:

- One method, `prune(now: Date = new Date())` → `{ deleted: number }`, decorated `@Cron(CronExpression.EVERY_DAY_AT_4AM, { name: PRUNE_JOB_NAME })`.
- 🔴 **THE `where` IS `{ readAt: { not: null }, createdAt: { lt: cutoff } }` — BOTH CLAUSES.** Dropping the `readAt` clause deletes a member's unread backlog, which is the one thing the inbox exists to hold. R10.6 says _"older than a retention window **and already read**"_; the conjunction is the requirement.
- `RETENTION_DAYS = 90` and `PRUNE_JOB_NAME` are **named constants**, not literals (ASSUMPTION-23). `now` is an explicit parameter with a default and is **never** `new Date()` inside the query — the same rule Task 12.8 took for `LiveFeedItem.state`, and the reason this spec can be deterministic.
- The `deleteMany` is served by `@@index([createdAt])`, the second index §1.6 adds for exactly this global sweep.
- Logs the count at `info`; a failure is caught and logged, never thrown — a cron that throws takes nothing useful with it and a scheduler that stops retrying is worse than a noisy log.

**Validation notes** — three cases, and the third is the one that matters:

1. **Read + 91 days old → deleted.**
2. **Four survivors, asserted individually**: unread + 91 days old (survives — the clause that matters), read + 89 days old (survives), unread + 89 days old (survives), and a row created exactly at the cutoff boundary (state the inclusive/exclusive choice and pin it).
3. 🔴 **THE WIRING ASSERTION (RISK-AE).** Boot a `Test.createTestingModule` including `ScheduleModule.forRoot()` and `NotificationsModule`, resolve `SchedulerRegistry`, and assert **a cron job named `PRUNE_JOB_NAME` is registered**. A spec that only calls `prune()` directly passes forever against a decorator nobody wired, and that is precisely the failure this batch is at risk of (ground truth 8). **Prove it by deliberate failure in Task 14.17: remove `ScheduleModule.forRoot()` and watch this one test — and only this one — go red.**

**Verification**: `npx nx test api-notifications --skip-nx-cache --testPathPatterns=retention` · exit-gate clause 3 evidence pasted, including the registry read.

---

### Task 14.12: `MemberNotificationsController` + DTOs ✅ COMPLETE

**Files**:

- `libs/api/notifications/src/lib/member-notifications.controller.ts` (NEW)
- `libs/api/notifications/src/lib/member-notifications.controller.spec.ts` (NEW)
- `libs/api/notifications/src/lib/dto/list-notifications.query.dto.ts` (NEW)

**Requirement refs**: §3.6, R10.3, R10.4, R10.5, PRE-1, PRE-2, ground truth 10, 11
**Dependencies**: 14.11
**Pattern to follow**: `libs/api/learning/src/lib/comments/member-lesson-comments.controller.ts` — a member controller with a paged list and two small writes.

**Implementation details**:

- `@Controller('v1/members/notifications')`, member guard chain at **class** level. Four handlers, exactly as plan §3.6's table gives them:
  - `@Get()` → `Paged<MemberNotification>`, binding `dtoPipe(ListNotificationsQueryDto)` on the **whole** query object (PRE-1 — a bare `@Query() q: X` is silently unvalidated).
  - `@Get('unread-count')` → `{ unreadCount: number }`.
  - `@Post(':id/read')` → `{ readAt }`.
  - `@Post('read-all')` → `{ marked: number }`.
- 🔴 **NO NAMED PRIMITIVE `@Query`/`@Param` OF `string` TYPE BEYOND `:id`.** `NAMED_PRIMITIVE_PARAM_COUNT` is asserted at **exactly 6** (ground truth 10); a single `@Query('page') page: string` here fails the build. Page and pageSize arrive inside the DTO.
- ⚠️ **`unread-count` and `read-all` are literal segments under one controller prefix**, not sibling controllers. RI-1 sees one prefix, `v1/members/notifications`, disjoint at segment 3 from all nine existing member prefixes (ground truth 11).
- ⚠️ **No `@Sse`, no `@Header('Cache-Control')` games, no long-poll.** AD-14 is a plain `GET` on a 60 s client timer. `libs/api/licensing`'s `@Sse` endpoint is not imported, not extended, not referenced.
- **`@Post(':id/read')` returns `200`, not `201`** — it is idempotent state, not a creation. Pin it with `@HttpCode(200)` and a spec, because Nest's default for `@Post` is `201` and a client that branches on the status would be reading a lie.

**Validation notes**: the spec asserts the class-level guard chain (G1), that `pageSize=51` is a `400` rather than a clamp, and that re-reading an already-read notification is a no-op returning the original `readAt` rather than moving it.

**Verification**: `npx nx test api-notifications --skip-nx-cache` · `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="route-map|controller-validation|admin-guards"`

---

### Task 14.13: The forum producers — three kinds, one call site, one recipient set ✅ COMPLETE

**Files**:

- `libs/api/forum/src/lib/posts/posts.service.ts` (MODIFY — `createReply`, `:117`)
- `libs/api/forum/src/lib/posts/posts.service.spec.ts` (MODIFY)
- `libs/api/forum/src/lib/posts/accepted-answer.service.ts` (MODIFY — `accept`, `:62`)
- `libs/api/forum/src/lib/posts/accepted-answer.service.spec.ts` (MODIFY)
- `libs/api/forum/src/lib/forum.module.ts` (MODIFY — the RISK-L docblock)

**Requirement refs**: **R10.1**, **R10.2**, §8.1 (P2 `forum` blocks P5 producers), **RISK-AF**, ASSUMPTION-21
**Dependencies**: 14.12
**Pattern to follow**: how `PacksService` enlists its audit row in the mutation's own `$transaction` (PRE-6) — same shape, different table.

**Implementation details**:

- 🔴 **`topic.reply` AND `post.child_reply` COME OUT OF ONE METHOD (RISK-AF).** `PostsService.createReply()` is the only reply path; there is no `createChildReply`. The distinction is `input.parentId`.
- 🔴 **RESOLVE A DE-DUPLICATED RECIPIENT SET BEFORE ANY WRITE.** Candidates are the topic's author (`topic.reply`) and, when `parentId` is present, the parent post's author (`post.child_reply`). **When they are the same person — the common case in a two-message thread — that is ONE notification, with the more specific kind (`post.child_reply`) winning.** R10.2's self-suppression does not catch this, because neither recipient is the actor.
- Both writes enlist in `createReply`'s existing `$transaction` (ASSUMPTION-21), so a failed notification rolls the reply back rather than leaving a silently un-notified thread.
- `post.accepted` is produced in `AcceptedAnswerService.accept()` for the accepted post's author. `assertMayAccept(ctx, topic.authorId)` already means the actor is the topic author or an admin; the recipient is the **post** author, and R10.2 suppresses the self-accept case at `create()`.
- 🔴 **The depth repair changes the recipient.** `createReply`'s docblock (`:101-116`) records that a `parentId` naming a depth-2 post is silently re-pointed to that post's parent. **The notification must follow the REPAIRED parent, not the requested one** — otherwise a member is told their reply was replied to when the reply landed elsewhere in the tree. Assert it.
- `forum.module.ts`'s RISK-L docblock is rewritten in **this** change (see Task 14.14 for the specs).
- ⚠️ **`bodyPreview` is an excerpt of the reply's markdown, truncated at a named constant, stored as plain text** (ground truth 4). No rendering, no sanitizing, no HTML.

**Validation notes** — three assertions, each made to fail before it is allowed to pass:

- **RISK-AF**: author of the topic **is** the author of the parent post; one reply from a third member → **exactly one** row, kind `post.child_reply`.
- **Exit-gate clause 2 through the real path**: the topic author replies to their own topic → **zero** rows. This is the assertion that proves the suppression is on the path, not merely in the service.
- **The repair case**: reply with a `parentId` at depth 2 → the notification's `targetId` and recipient match the **repaired** parent.

**Verification**: `npx nx run-many -t eslint:lint,typecheck,test -p api-forum,api-notifications --skip-nx-cache`

---

### Task 14.14: The `session_request.status` producer, the four RISK-L rewrites, and B12's F-1 ✅ COMPLETE

**Files**:

- `libs/api/community/src/lib/google-sessions/session-requests.service.ts` (MODIFY — `accept:255`, `reschedule:385`, `decline:486`)
- `libs/api/community/src/lib/google-sessions/session-requests.service.spec.ts` (MODIFY)
- `libs/api/community/src/lib/google-sessions/google-sessions.module.ts` (MODIFY — RISK-L docblock)
- `libs/api/community/src/lib/live-sessions/live-sessions.module.{ts,spec.ts}` (MODIFY — RISK-L, incl. the "exactly six modules" count)
- `libs/api/forum/src/lib/forum.module.spec.ts` (MODIFY — RISK-L block)
- `libs/api/learning/src/lib/learning.module.spec.ts` (MODIFY — RISK-L block)

**Requirement refs**: R10.1, R10.2, R4.8, **B12's F-1 / B13's F-7**, ASSUMPTION-21, ground truth 5, 6, 7
**Dependencies**: 14.13

**Implementation details**:

- Produce `session_request.status` on all three admin transitions, recipient = the request's owner, `targetType: 'SessionRequest'`, `route` from `buildNotificationRoute` (RISK-AJ). `decline` carries `declineReason` into `bodyPreview` (R4.8 — admin-authored plain prose, no rendering).
- 🔴 **`accept()` IS THE ONE PRODUCER THAT DOES NOT ENLIST IN THE TRANSACTION (ASSUMPTION-21).** §3.5 mandates Calendar-first / DB-second with a compensating `deleteEvent` (RISK-U). The notification goes **after** the commit, best-effort, logged on failure. A failed notification must never trigger the compensation and delete a real Calendar event. State this in the method's docblock beside RISK-U's existing note.
- `cancelOwn` produces **nothing** — the actor is the recipient, so `create()` suppresses it anyway (R10.2); the point is that no producer is wired there at all, and the report says so.
- 🔴 **THE FOUR RISK-L SITES ARE REWRITTEN IN THIS SAME CHANGE (ground truth 5).** Each currently asserts `NotificationsModule` is absent and that the docblock says why. Since the module is `@Global()` (Task 14.9), **the correct rewrite may be that these modules still import nothing** — a `@Global()` provider needs no import. **Decide deliberately and say which:** if the assertion survives unchanged because `@Global` makes the import unnecessary, that is a stronger outcome than deleting it, and `live-sessions.module.spec.ts:79`'s "exactly six modules" then also survives. **Do not delete an assertion that is still true.** What must change either way is the prose: `Batch 14` and `does not exist` are now false.
- 🔴 **B12's F-1 CLOSES HERE.** `session-requests.service.spec.ts:139` already builds the service with `calendar as unknown as GoogleCalendarProvider`. Add a describe block with a double whose `isEnabled()` returns `false` and assert, for **each** of `accept` / `reschedule` / `decline`: the thrown error carries `reason: SCHEDULING_UNAVAILABLE`, the response is a `503`, **the DB row is untouched**, and **no notification was created**. That is the server-side branch B13's F-7 said only a server-side stub could reach.

**Validation notes**: the three `503` cases and the three happy-path cases are asserted as a pair per method, so a change that fixes one and breaks the other cannot pass. `decline`'s third branch (`calendarEventId !== null` **and** Google off, `:494`) is its own case — B12's F-1 named only `accept`.

**Verification**: `npx nx run-many -t eslint:lint,typecheck,test -p api-community,api-forum,api-learning,api-notifications --skip-nx-cache` — and the report states **explicitly** whether B12's F-1 is closed, with the pasted test output, or re-filed with a reason.

---

### Task 14.15: The three registries, the census constants, and the DTO census reach ✅ COMPLETE

**Files**:

- `apps/ptah-license-server/src/testing/controller-registry.ts` (MODIFY — 38 → 40)
- `apps/ptah-license-server/src/common/route-map.spec.ts` (MODIFY — `EXPECTED_ROUTES`)
- `apps/ptah-license-server/src/common/controller-validation.spec.ts` (MODIFY — `MIN_TOTAL_PAYLOAD_PARAMS`)
- `apps/ptah-license-server/src/app/app.module.ts` (MODIFY — `MemberPacksModule`)
- `libs/api/core/src/lib/common/nullable-dto.spec.ts` (MODIFY — `LIBS_WITH_DTOS`)
- `libs/api/audit/src/lib/audit-log.types.ts` (MODIFY — only if a new audit action is written)

**Requirement refs**: PRE-2, ground truth 10, 11, **RISK-AL**
**Dependencies**: 14.14

**Implementation details**:

- Register `MemberPacksController` and `MemberNotificationsController` in `ALL_CONTROLLERS` **in the same commit that creates them** (PRE-2). The count goes **38 → 40**, and the registry's own count-trail docblock (`:56-58`) gains its Phase-5 clause. The census auto-discovers `libs/api/*/src`, so a missing entry fails rather than passes.
- `EXPECTED_ROUTES` gains the five routes from plan §3.6's table. **`PREFIX_EXCEPTIONS` and `KNOWN_PREFIX_DEBT` gain NOTHING** — both ledgers are deliberately at their floor (one entry / empty), and the two new prefixes are segment-wise disjoint (ground truth 11).
- 🔴 **`MIN_TOTAL_PAYLOAD_PARAMS` IS A FLOOR AND MUST BE RE-DERIVED AND RAISED (RISK-AL).** It is **76**. Read the new total off the suite's own output, raise the constant, and paste both numbers. Leaving it at 76 passes and is wrong.
- **`NAMED_PRIMITIVE_PARAM_COUNT` stays at exactly 6.** If this batch made it 7, the fix is the controller, not the constant.
- `LIBS_WITH_DTOS` gains `'notifications'`. ⚠️ **The per-lib reach assertion is one-directional** — a lib not listed does not fail — **so this is a deliberate coverage strengthening, not a build fix.** Say so, because a reviewer will otherwise assume the suite forced it.
- `AdminAuditAction` / `AdminAuditTargetType`: **only if** an admin mutation in this batch writes an audit row. The pack `memberVisible` toggle rides the existing `PATCH /admin/packs/:id` audit action; a notification is not an admin mutation. **The expected diff here is zero — state that rather than inventing a vocabulary entry.**

**Verification**: `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="route-map|controller-validation|controller-registry|admin-guards|app.module"` · `npx nx test api-core --skip-nx-cache --testPathPatterns=nullable-dto`

---

### Task 14.16: The two hub sections — read the table, derive the status ✅ COMPLETE

**Files**:

- `libs/api/member-hub/src/lib/sections/packs.section.ts` (MODIFY)
- `libs/api/member-hub/src/lib/sections/packs.section.spec.ts` (NEW — the section has never had one)
- `libs/api/member-hub/src/lib/sections/notifications.section.ts` (MODIFY)
- `libs/api/member-hub/src/lib/sections/notifications.section.spec.ts` (NEW)
- `libs/api/member-hub/src/lib/sections/empty-sections.section.spec.ts` (MODIFY — two fewer subjects)
- `libs/api/member-hub/src/lib/member-hub.module.ts` (MODIFY — the two collaborators)

**Requirement refs**: R6.1, R6.3, **R6.4**, **R6.6**, R10.4, **F-D**
**Dependencies**: 14.15
**Pattern to follow**: `sessions.section.ts` — the only section that already has a real collaborator, `@Optional() @Inject`-ed so an unregistered module degrades one card rather than failing construction.

**Implementation details**:

- 🔴 **THE COARSE INSTRUCTION "→ `'ok'`" IS WRONG AS LITERALLY WRITTEN (F-D).** `HUB_SECTION_STATUSES` is `['ok','empty','unavailable']` and **status is a function of the data**: rows present → `'ok'`; source answered with nothing → `'empty'`; source failed or is disabled → `'unavailable'` (R6.3/R6.4, and `hub-section.ts`'s docblock states the distinction is the one thing the vocabulary exists to preserve). With `packs` at 0 rows and no notifications, the correct post-batch answer on **this** database is still `'empty'` — which is why the verification below seeds.
- `PacksSection` injects `MemberPacksService` and returns `{ status: rows.length ? 'ok' : 'empty', data: rows }`. `data` is `[]`, never `null`.
- `NotificationsSection` injects `NotificationsService` and returns `{ status: count > 0 ? 'ok' : 'empty', data: { unreadCount: count } }`. ⚠️ **`data` stays an OBJECT** so a later per-kind breakdown does not change the envelope (R6.6).
- 🔴 **THE RESOLVER DOES NOT CATCH FOR FAULT ISOLATION.** `hub-section.ts`'s port docblock is explicit: a resolver returns `'unavailable'` only for a condition it can NAME, and otherwise lets the failure propagate to the composer's `Promise.allSettled` (R6.4). A `try/catch` here would make the single fault boundary untestable and would report an outage as `'empty'`.
- **The hub envelope does not change** — both slots already exist with the right types (`member-hub.contract.ts:122,124`). This is R6.6 working: four phases of extension, one client request.
- Both docblocks currently say _"PHASE 1"_ and _"until Batch 14 lands"_. Rewrite to the present tense and delete the deferral.
- Remove the two sections from `empty-sections.section.spec.ts`'s subject list **in the same change**, or it asserts `'empty'` against a resolver that can now say `'ok'`.

**Validation notes**: each new spec covers three cells — populated (`'ok'`), genuinely empty (`'empty'`), and collaborator throws (**propagates**, is not swallowed) — and the composer's existing R6.4 fault-injection case is re-run unchanged.

**Verification**: `npx nx run-many -t eslint:lint,typecheck,test -p api-member-hub --skip-nx-cache` · `V-CURL` `GET /v1/members/hub` **before and after seeding**, showing the same section flipping `'empty'` → `'ok'` with no envelope change.

---

### Task 14.17: Live verification, the deliberate-failure proofs, and the exit gate ✅ COMPLETE

**Files**: none new (verification)
**Requirement refs**: the whole exit gate, RISK-AE, RISK-AF, RISK-AH, RISK-AK
**Dependencies**: 14.16

**Implementation details** — run it, paste it, do not summarise it:

- `V-HEALTH` → `200`. `V-TOKEN` headless, **minted in memory and never written to a file** (B13's residue finding). `V-CURL` uses the `ptah_auth` **cookie**, never an `Authorization` header.
- 🔴 **SEED THREE THROWAWAY PACKS BY KNOWN ID (RISK-AK)** — visible+cohort-labelled, visible+unlabelled, hidden — because a zero-row table makes every filter assertion vacuous. Then:
  - `GET /v1/members/packs` → `200`, **exactly two items**, one with a non-null `cohortName`, and `notes` absent from both bodies (exit-gate clauses 1 and 4). Paste the raw body.
  - Re-run as a **second identity with no cohort assignment** — the same two packs. A cohort-filtering implementation differs here.
- `GET /v1/members/notifications` → `200` empty `Paged`; `GET .../unread-count` → `{ unreadCount: 0 }`. Then drive a **real** forum reply from identity B on identity A's topic and re-read as A → one row, correct `route`, `actorName` present and **not an email**. Then `POST :id/read` → `200 { readAt }`, and the count drops. Then have A reply to A's own topic → **count unchanged** (exit-gate clause 2, live).
- `POST /v1/members/notifications/:id/read` **as identity B against A's id** → `{ marked: 0 }`, and A's row still unread (RISK-AH, live).
- `V-DB`: `\d packs`, `\d member_notifications`, `select count(*) from packs where member_visible = true;` before and after the seed.
- **At least four deliberate-failure proofs**, each reverted and `diff`-confirmed byte-identical:
  1. 🔴 **Remove `ScheduleModule.forRoot()`** → **only** Task 14.11's registry assertion goes red, and every other notification test stays green. **This is the proof that RISK-AE is real and that the guard against it works.**
  2. Drop the `readAt: { not: null }` clause from the prune → the unread-and-ancient survivor assertion goes red.
  3. Collapse the recipient set in `createReply` to two unconditional writes → the RISK-AF single-row assertion goes red.
  4. Add `notes` to `toMemberPack`'s output → the NFR-S5 field-absence assertion goes red **in both of its halves**.
- The full batch gate: `npx nx run-many -t eslint:lint,typecheck,test -p api-notifications,api-community,api-contracts-community,api-member-hub,api-forum,api-learning,api-core,api-audit,ptah-license-server --skip-nx-cache`, with **baseline vs post totals per project**. ⚠️ **Re-measure the baselines** — HEAD moved 32 commits past B13 and ground truth 7's figures are stale (ground truth 1). `api-learning:eslint:lint`'s pre-existing errors, if still present, are shown unchanged and are not this batch's.
- 🔴 **Tear the seed down by id, in one `BEGIN`/`COMMIT`, and paste the census proving it.** No `TRUNCATE`, no blanket `DELETE`, no `DELETE FROM packs` without a `WHERE`.

**Verification**: every clause of the exit gate above, each with its pasted evidence, in `batch-14-report.md`. The report states plainly whether B12's F-1 is closed and by which test.

---

## Batch 15: P5-FE — packs, notifications badge, full a11y and e2e pass ✅ COMPLETE (`12ed2703f` · `3345904dd` · `a05714286` · `7408121b6`)

### ✅ USER DECISION 2026-08-10 — Task 15.6 gets a real server endpoint

**Batch 15A proved Task 15.6's validation note is unbuildable as written** (`batch-15a-report.md`
§5.3). The note asks bulk mark-read to issue _one_ `read-all`-shaped request; the server exposes
only `POST :id/read` (one row) and `POST read-all` (**the entire inbox, across every page**), and
there is **no mark-unread endpoint at all**. A `SelectionToolbar` acting on a partial selection
therefore had no API that could honour its own semantics, and `read-all` would permanently mark
rows the member never selected — including rows on pages they have never seen.

**Decision: add a server-side `POST` taking an id array.** Mark-unread was explicitly considered
and **NOT** chosen — the operation stays irreversible, so ownership validation and the array cap
are the load-bearing protections.

- **Backend**: dispatched as a focused follow-up to committed Batch 14, not as part of Batch 15.
  Its own commit, scope `license-server`. Contract in `libs/api-contracts/community/**`.
  Ownership (a member may mark only their OWN rows) is the security property and is proven live
  with two distinct identities.
- **Frontend**: **Batch 15B** wires `MemberNotificationsStore.markSelectedRead(ids)` to the new
  endpoint. 15A's equivalence-guarded fallback (`read-all` only when `page === 1 && !hasMore &&
total === items.length`, otherwise N requests) **stays as the safety net** — it is already
  covered by three pinning tests and must not be deleted when the endpoint lands.
- **Sequencing**: the endpoint lands BEFORE 15B so that 15B's e2e proves the shipped behaviour
  rather than an interim one.

**Also carried into 15B from 15A §5.5**: the `SelectionToolbar` spec is a cross-panel improvement
benefiting four existing admin consumers and **should be committed separately** from the member
batch so it stays independently revertible — the same shape as B13's `panel-ui` WCAG fix
(`e9181716f`).

**Recommended Executor**: `frontend-developer` | **Fallback**: `frontend-developer`
**Execution Mode**: sequential — one dispatch. If a split is needed the seam is
**15.1–15.4 (identity, the two API services, the store) then 15.5–15.11 (the pages, the
badge, the routes, the a11y migration, the proofs)**.
**Rationale**: the packs page, the notifications page and the nav badge share ONE store, ONE
poll cadence and ONE "a stored route is not a trusted route" rule. Splitting them is how the
badge ends up reading a second signal (R9.3's exact prohibition).
**Dependencies**: Batch 4 (the shell, `MEMBER_ROUTES`, the Task 4.7 lint rule), **Batch 14
(all of it — the two endpoints, the hub sections and the live server)**
**Preconditions**: **PRE-3 (read the BARREL, not PRE-3's number — it is stale, see ground
truth 3)**, PRE-4, **PRE-7 as amended by F-H**
**Tasks**: 11

**Scope boundary (RK-1)**: 🔴 **no websocket, no SSE, no service worker, no `Notification`
browser API, no sound, no desktop toast.** Poll only (AD-14). Also out: no notification
preferences screen, no per-kind filter, no admin surface, no pack **detail** page (the list
carries `repoUrl` and `accessNote`; there is nothing else to show — R5.7 means Ptah serves no
pack content), no pack search or tag filter (tens of rows), no infinite scroll. **No second
markdown renderer and no second sanitizer** (NFR-S2) — `bodyPreview` is an **escaped text
node** (ground truth 4 of Batch 14).

**File set** (for the serialisation claim): `libs/web/members/**`, `libs/web/panel-ui/**`,
`apps/ptah-landing-page-e2e/**`, `package.json` (**only if** an axe dependency move is
needed — see ground truth 5).
🔴 **This batch touches no `tsconfig.base.json`, no `nx.json`, no `eslint.config.mjs`, no
`app.module.ts`, no `route-map.spec.ts`, no `controller-registry.ts`, no `schema.prisma` and
no migration.**

**Exit gate (§8.2 P5, frontend half)** — five clauses, each with a named owner task:

1. **Members reach every pack repo link without Discourse**, with `accessNote` rendered
   **before** the link so a GitHub 404 is not the first signal (Tasks 15.5 + 15.11, R5.1,
   R5.5).
2. 🔴 **The unread count is accurate on the nav `badgeCount`, and there is exactly ONE badge
   mechanism** (Tasks 15.4 + 15.7, R9.3, R10.4) — asserted structurally, not just visually.
3. **Full NFR-P / NFR-U / axe pass across every member surface, in both themes** (Task 15.10),
   🔴 **including EMPTY surfaces** — B13's F-1 was a real WCAG failure that survived three
   phases because every prior pass ran against populated ones.
4. **e2e coverage for every member surface** (Task 15.11, NFR-M1) — the four with none today
   are `/members/packs`, `/members/notifications`, `/members/account` and `/members/search`.
5. **The R6.2 one-request assertion re-run UNCHANGED and still passing** (Task 15.11, R6.6) —
   both halves, the stubbed one and the live one.

Plus the standing gates: `members.routes.spec.ts` green with **zero** placeholder routes left
and `MemberPhasePlaceholder` deleted · the markdown chokepoint spec still green **and
re-proven to fail**, importer list unchanged at **six** · `npx nx lint web-members` green (the
Task 4.7 token rule) · `nx build ptah-landing-page --configuration=production` green with **no
NEW budget warning**.

---

### 🔴 Ground truth Phase 5-FE inherits — verified against the tree at `4b0313783` on 2026-08-10

1. 🔴 **EVERYTHING THE BADGE NEEDS ALREADY EXISTS AND NONE OF IT IS NEW WORK.**
   `PanelNavItem.badgeCount?: number` is declared at `libs/web/panel-ui/src/lib/panel-nav.types.ts:36`
   and **`PanelLayout` already renders it in BOTH nav branches** — `panel-layout.html:147`
   (primary) and `:171` (secondary), each `@if (item.badgeCount) { <span class="badge
badge-primary badge-xs …"> }`. The Notifications item is `primary: false`
   (`member-nav.config.ts:122-126`), so it renders through the **secondary** branch.
   **There is no `panel-nav` component** — the nav is an `<ng-template #navLink>` inside
   `panel-layout.html:130-187`. **Task 15.7 writes no template and no primitive.**
2. 🔴 **THE RESHAPE POINT ALREADY EXISTS TOO.** `member-layout.ts:77-81` is already a
   `computed<readonly PanelNavGroup[]>` that rebuilds the array for the admin-link case:
   `this.session.isAdmin() ? [...MEMBER_NAV_GROUPS, MEMBER_ADMIN_NAV_GROUP] : MEMBER_NAV_GROUPS`.
   Its docblock (`:66-71`) commits Batch 15's `badgeCount` to **this same computed**.
   `member-nav.config.ts:26-35` states R9.3 in terms: _"Introducing a second badge mechanism
   — a bespoke chip in the member template, a separate signal read inside the shell — is what
   R9.3 forbids, because then two things claim to be 'the unread count' and they disagree the
   first time one of them is missed."_ **`MEMBER_NAV_GROUPS` itself is `readonly` and is not
   mutated.**
3. 🔴 **PRE-3's NUMBER IS STALE AND THE BARREL SAYS SO ITSELF.** `libs/web/panel-ui/src/index.ts`
   is now **10 export lines / 11 symbols** (`PanelNavItem`, `PanelNavGroup`, `BadgeVariant`,
   `PanelLayout`, `StatTile`, `StatusBadge`, `EmptyState`, `DetailDrawer`, `SelectionToolbar`,
   `ThreadRow`, `TagChip`) — Batch 7 promoted `ThreadRow` and `TagChip`. Its header docblock
   is the authoritative count and must be updated **in the same edit** as any list change
   (RISK-M). **Read the barrel, not PRE-3.**
4. 🔴 **`SelectionToolbar` EXISTS, IS EXPORTED, AND HAS FOUR WORKING ADMIN CONSUMERS** —
   `libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.ts`, API
   `count = input<number>(0)`, `itemNoun = input<string>('item')`, `cleared = output<void>()`,
   `role="region" aria-label="Bulk actions"`, hidden entirely at `count() === 0`, actions
   projected through a bare `<ng-content />`. The cleanest template to mirror is
   `libs/web/admin/src/lib/users/users-list.html:59-72`. ⚠️ **It has NO spec file** —
   Task 15.6 is its first test.
5. 🔴 **`@axe-core/playwright` IS NOW A DEV DEPENDENCY** — `package.json:202`, `^4.12.1`
   (F-I). B10's and B13's carried-forward item is **closed by installation and open by
   usage**: both CDN loaders still run and both still carry comments asserting the package is
   absent — `members-courses.spec.ts:653-674` and `members-live.spec.ts:496-514`, two
   near-identical copies with **different `AxeViolation` shapes** (`nodes: number` vs
   `targets: string[]` + `summary: string`; the live one is the better shape).
   **Task 15.10 owns collapsing them into one shared support helper.**
6. 🔴 **`MemberPlaceholderData` IS DOWN TO EXACTLY TWO CONSUMERS AND THIS BATCH IS THE LAST
   ONE.** `members.routes.ts:104-112` (`packs`) and `:181-189` (`notifications`) are the only
   `loadPlaceholder` call sites. `member-phase-placeholder.ts`'s own docblock says _"the last
   one to do so deletes this file"_, and `members.routes.ts:211-219` says the same. **Task
   15.8 deletes the component, both helpers and the type.**
7. 🔴 **`member-guard-wiring.spec.ts:232-245` WILL BREAK, ITS OWN COMMENT PREDICTS IT, AND
   IT MUST NOT BE WEAKENED.** The case _"a placeholder member surface is not bounced either"_
   navigates to `/members/packs` and was moved there by B13 precisely because
   `/members/live/replays` became a fetching surface. Its comment: _"Batch 15 will have to
   move it again, or answer the request the way the `/members` case above does."_
8. 🔴 **THERE IS NO APPROVED DESIGN FOR ANY OF THIS BATCH'S SURFACES.** R9.8 says _"match the
   8 approved screens in `docs/design-system/stitch_ptah_builders_member_home/`"_ — that
   directory holds member home, community feed, discussion thread, course learning (each in
   both themes) and an admin sessions calendar. **There is no Packs, Notifications or Account
   screen.** Derive from `panel-theme-spec.md` and the shipped member surfaces, and **say in
   the report that no approved screen existed** rather than implying one was matched.
9. 🔴 **THE ONLY POLLING PRECEDENT IN `libs/web/members` IS A LOCAL CLOCK, NOT A NETWORK
   POLL.** `course-player.store.ts:93,195` holds `setInterval` at `POLL_INTERVAL_MS = 1_000`
   — but that tick reads a clock; the network write is separately gated at
   `WRITE_INTERVAL_MS = 15_000`. Zero RxJS `timer(`/`interval(` anywhere in the lib. The
   store pattern to copy is that file: `@Injectable()` **without** `providedIn` (with the
   documented `use-injectable-provided-in` disable and its justification), private
   `signal<T>()` + public `.asReadonly()` + `computed()`, and
   `inject(DestroyRef).onDestroy(() => …)` teardown.
10. **The API-service pattern is `member-live-api.service.ts`**: `@Injectable({ providedIn:
'root' })`, `inject(HttpClient)`, one method per endpoint, every response through
    `validate(schema, 'GET /members/…')` from `@ptah-web/core`, **relative URLs**
    (`apiInterceptor` prepends the base and sets `withCredentials`), **no signals and no
    cached state**, free helper functions alongside the class, and a client-side guard that
    throws before issuing a request the server would `400`. Seven sibling services exist,
    **every one with a spec**; `member-packs-api.service.ts` and
    `member-notifications-api.service.ts` do not.
11. **`/members/account` ALREADY EXISTS AND IS FULLY IMPLEMENTED** —
    `account/account-page.ts` (258 lines), routed at `members.routes.ts:195-199`, three
    sections, issues no request beyond `AuthService.getCurrentUser()`. **It has NO spec.**
    The coarse task "Account page" is therefore **not** authoring work (Task 15.9).
12. **e2e fixtures: `apps/ptah-landing-page-e2e/src/support/db.ts` has community, course and
    live-session helpers and NO packs or notifications helpers.** The convention to extend:
    unique/timestamped slug, teardown by minted id in FK order, **per-statement**
    `try`/`catch` with a `console.warn` — 🔴 **do not restore the single-`try` shape**, which
    is how B10's first run orphaned nine courses.
13. **B7's five pre-existing e2e failures are still not yours** (`admin-crud.spec.ts:16`,
    `admin-founding-invites.spec.ts:28,65`, `auth.spec.ts:65`, `pricing-waitlist.spec.ts:22`).
    Report the same five and move on.
14. 🔴 **RE-MEASURE THE BASELINES.** B13 recorded `web-members` **38 suites / 706 tests**,
    `web-panel-ui` 3/19, `web-core` 4/25 at `db584deaa` — **32 commits ago**. The build
    baseline was two budget warnings (initial 1.32 MB vs 1.00 MB; `@fullcalendar` skeleton.css
    20.71 kB), but `TASK_2026_187` has since been closing bundle work. **Measure at HEAD
    before the first edit and compare against that.**

---

### Risks surfaced by the Phase 5-FE refine pass

| #           | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                           | Sev      | Mitigation                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-AM** | 🔴 **A 60 s `setInterval` IN A ROOT-PROVIDED STORE OUTLIVES EVERY TEST AND EVERY LOGOUT.** `MemberNotificationsStore` is the first network poll in this lib. Left running it fires after sign-out (a `401` loop), after the member leaves `/members` (a request from a page that is gone), and inside Jest (open handles, and a suite that passes locally and hangs in CI). A `providedIn: 'root'` store has no natural teardown point.        | **HIGH** | Task 15.4 follows `CoursePlayerStore` exactly: `@Injectable()` **without** `providedIn`, provided at the `MemberLayout` route level so it dies with the panel, `inject(DestroyRef).onDestroy()` clearing the handle, and the timer **started by an explicit `start()` the layout calls** rather than in the constructor. A spec asserts the handle is cleared. |
| **RISK-AN** | 🔴 **THE BADGE IS THE ONE THING R9.3 FORBIDS DOING TWICE, AND THE SECOND COPY IS THE EASY ONE TO WRITE.** A bespoke chip in `member-layout.html`, or a second `unreadCount()` read inside a page, satisfies every visual check and disagrees with the nav the first time one of them is missed. The template already renders `badgeCount`, so the wrong version _also works_.                                                                  | **HIGH** | Task 15.7 changes **only** the existing `navGroups` computed. A structural spec globs `libs/web/members/**/*.{ts,html}` and asserts **zero** occurrences of `badge-` classes outside `panel-ui`, and that `unreadCount()` is read in **exactly one** file. Deliberate-failure proof: add a second chip, watch the spec go red.                                 |
| **RISK-AO** | 🔴 **`notification.route` IS A SERVER-STORED STRING THE CLIENT NAVIGATES TO.** Opening a notification does `router.navigateByUrl(n.route)`. A stored absolute URL, a `//evil.example` protocol-relative value, or a path outside `/members` turns the inbox into an open redirect — and the value is **frozen in the row**, so it survives every later fix.                                                                                    | **HIGH** | Task 15.4 refuses any `route` not matching `/^\/members\//`, falls back to the notifications page, and logs. This is the client half of RISK-AJ's server-side `buildNotificationRoute` — **defence at both ends**, because either alone is one bug away from the hole.                                                                                         |
| **RISK-AP** | 🔴 **"MARK READ ON OPEN" RACES THE NAVIGATION AND THE POLL.** Opening a notification marks it read (R10.3) _and_ navigates away. If the badge is refreshed by the 60 s poll only, it stays stale for up to a minute after the member acted; if it is decremented optimistically _and_ the poll lands mid-flight, the count flickers back up and then down.                                                                                     | MED      | The store owns the count and is the only writer. `markRead` decrements optimistically, issues the request, and on success **replaces** the count from the server's `unread-count`; on failure it restores. The poll is skipped while a write is in flight. Asserted with an unflushed request, the way B13's F-4 regression test is.                           |
| **RISK-AQ** | **THE PACKS PAGE HAS TWO EMPTY STATES AND THEY MEAN DIFFERENT THINGS.** "No packs are available to you yet" (the server answered, `memberVisible` is false everywhere) and "we could not load your packs" (the request failed) are the same blank screen if the page branches on `items.length` first. This is RISK-Z's shape, and B13 proved it is the failure that actually ships.                                                           | MED      | Task 15.5 branches `error → loading → empty → list`, four distinct renders asserted by their copy, with the error branch carrying a retry and `role="alert"` and the empty branch `EmptyState` with `role="status"`. Deliberate-failure proof in 15.11.                                                                                                        |
| **RISK-AR** | **`EmptyState`'S HINT WAS THE LAST WCAG FAILURE AND THE CLASS OF DEFECT IS NOT EXHAUSTED** (B13's F-1). The Task 4.7 token lint rule is scoped to `libs/web/members/**` and reads **nothing** in `libs/web/panel-ui/**`. `panel-layout.html` and `stat-tile.html` still carry `/40` on `aria-hidden` icons (legal), and `libs/web/auth/auth-page.component.ts:125` carries it on a **divider label** (text). Nothing enforces the distinction. | MED      | Task 15.10 points axe at **empty** surfaces specifically, and adds a `panel-ui` spec scoping the `/40` prohibition to text-bearing elements rather than to the file. Out-of-scope hits in `libs/web/admin` and `libs/web/auth` are **reported, not fixed** (RK-1) — they are another surface's.                                                                |

---

### Assumptions this refine pass takes (not in the plan; flag if wrong)

- **ASSUMPTION-25 — the packs list is ONE flat list, not grouped by cohort.** A-1 says
  `cohortName` is a display label that grants and revokes nothing. Grouping by it would render
  the label as structure and re-create, visually, exactly the access illusion A-1 exists to
  refuse. `cohortName` renders as a `TagChip` beside the pack's own tags. One template branch
  to overrule.
- **ASSUMPTION-26 — `accessNote` renders as an ESCAPED TEXT NODE, above the repo link.**
  It is admin-authored plain prose (R5.5) with no markdown affordance in the admin form, and
  `MemberPack` does not name it `bodyMarkdown`. **No renderer is added to this page**, so the
  chokepoint importer list stays at six (ASSUMPTION-17 continuing to hold). Placement above
  the link is the requirement, not a preference: R5.5 says the member must be told _"in
  advance"_.
- **ASSUMPTION-27 — a pack with a null `accessNote` shows a single shared default line**, not
  a blank gap. `accessNote` is nullable and every pack in this workspace has it null on day
  one. Silence at the exact spot R5.5 exists to fill is the failure mode; one constant string
  ("Access is granted on GitHub — ask in the community if the link 404s") in one place.
- **ASSUMPTION-28 — the notifications page marks read on OPEN only, never on scroll or on
  view.** R10.3 says _"opening one SHALL navigate to the source and mark it read"_ and says
  nothing about visibility. A read-on-view implementation empties the inbox for a member who
  merely glanced at it, and it is unfalsifiable from the server side. Bulk mark-read is the
  explicit alternative and it is `SelectionToolbar`'s job (R9.7).
- **ASSUMPTION-29 — the poll interval is 60 s exactly, as a named constant, and is NOT
  backed off.** R10.5 says _"≥ 60 s"_. Adaptive backoff is a second piece of state that
  disagrees with the first the moment a tab is restored. `POLL_INTERVAL_MS = 60_000` beside
  `CoursePlayerStore`'s constants, plus the eager fetch on every navigation, is the whole
  design (AD-14).

---

### Task 15.1: Pre-flight — the identity, the seed, and the baselines this batch cannot borrow ✅ COMPLETE (`7408121b6`)

**Files**: none (verification + a throwaway identity and fixtures)
**Requirement refs**: `V-TOKEN`, PRE-7, ground truth 12, 14, RISK-AK
**Dependencies**: none — this is the batch's root
**Pattern to follow**: `apps/ptah-landing-page-e2e/src/support/db.ts` — `seedUser()` / `cleanupUser()`, insert by minted id, delete by that id.

**Implementation details**:

- `V-HEALTH` → `200`. Confirm Batch 14 shipped: `V-CURL` `GET /v1/members/packs` → `200` and `GET /v1/members/notifications/unread-count` → `200 { unreadCount: 0 }`. **If either 404s, STOP** — this batch has no backend to build against.
- Create **two** identities by known id (A and B), as B13 did. B is required for the RISK-AH ownership case and the own-only notification case; one identity proves nothing about isolation.
- Seed **three packs** (visible+labelled, visible+unlabelled, hidden) and, from identity B, a real forum reply on a topic identity A authored — so A has a real notification with a real `actorName` and a real `route`. 🔴 **Report what the live bodies actually contain**, including whether `actorName` is populated or fell back (B14's ASSUMPTION-22).
- 🔴 **MEASURE THE BASELINES AT HEAD, BEFORE THE FIRST EDIT** (ground truth 14): one
  `npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core --skip-nx-cache`
  and one `npx nx build ptah-landing-page --configuration=production`. Paste suite/test counts
  per project, the warning list, and the initial bundle size. **B13's figures are 32 commits
  stale and are not the comparison.**
- `git status --short` → name the foreign WIP (F-H), including the three foreign
  `.ptah/specs/**` carriers, so no later `git add` is ambiguous.

**Verification**: every value pasted. Mint the JWT **in memory**; write no token file (B13's residue finding). Record the teardown SQL for Task 15.11 now, not later.

---

### Task 15.2: `MemberPacksApiService` ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/services/member-packs-api.service.ts` (NEW)
- `libs/web/members/src/lib/services/member-packs-api.service.spec.ts` (NEW)

**Requirement refs**: §3.6, R5.1, R5.3, NFR-S1, ground truth 10
**Dependencies**: 15.1
**Pattern to follow**: `member-live-api.service.ts` — verbatim shape.

**Implementation details**:

- One method: `list(): Observable<MemberPack[]>`, parsed with `z.array(memberPackSchema)` through `validate(schema, 'GET /members/packs')`. **`memberPackSchema` is imported from `@ptah-contracts/community` and is NOT re-declared** (Batch 14 ground truth 2).
- 🔴 **NO `?page` / `?pageSize`.** The server returns a bare array by contract (Task 14.8). A client that sends pagination params is describing a different endpoint.
- No signals, no cached state, relative URL.

**Validation notes**:

- Assert the request URL **and** that **no** params are sent.
- Assert the parse **rejects** a body missing `accessNote`, and that `z.object()` **strips** an unknown extra key (RISK-C's asymmetry, in the tolerant direction).
- 🔴 **Assert the parsed object has no `notes` own key** — the client half of NFR-S5, and the assertion that would catch a future contract widening. Feed it a body that _does_ carry `notes` and assert it is stripped.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=member-packs-api`

---

### Task 15.3: `MemberNotificationsApiService` ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/services/member-notifications-api.service.ts` (NEW)
- `libs/web/members/src/lib/services/member-notifications-api.service.spec.ts` (NEW)

**Requirement refs**: §3.6, R10.3, R10.4, R10.5, NFR-P5, NFR-S1
**Dependencies**: 15.1
**Pattern to follow**: as 15.2, plus `member-community-api.service.ts`'s paged-request shape.

**Implementation details**:

- Four methods, one per endpoint: `list(page?, pageSize?)` → `Paged<MemberNotification>` via `pagedSchema(memberNotificationSchema)`; `unreadCount()` → `{ unreadCount: number }` via `hubNotificationSummarySchema`; `markRead(id)`; `markAllRead()`.
- Send `?page`/`?pageSize` **only when supplied** so the server's echoed values stay the authority; a `pageSize > MAX_PAGE_SIZE` **throws client-side** rather than issuing a request that will `400`.
- 🔴 **`unreadCount()` PARSES THROUGH `hubNotificationSummarySchema` — THE SAME SCHEMA THE HUB SECTION USES.** One shape, one parse, two callers. A second inline `z.object({ unreadCount: z.number() })` here is the beginning of the drift R6.6 exists to prevent.
- **No signals here.** The polling and the count live in the store (Task 15.4); this service is pure data access, like its six siblings.

**Validation notes**: assert the four request URLs and methods; assert `markRead` is a `POST` expecting **`200`**, not `201` (Task 14.12 pins the server side); assert the parsed notification has **no `userId` and no `actorId`** own key (NFR-S4's client half).

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=member-notifications-api`

---

### Task 15.4: `MemberNotificationsStore` — one count, one timer, one route guard ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/state/member-notifications.store.ts` (NEW)
- `libs/web/members/src/lib/state/member-notifications.store.spec.ts` (NEW)

**Requirement refs**: **R10.4**, **R10.5**, AD-14, **RISK-AM**, **RISK-AO**, **RISK-AP**, ASSUMPTION-29
**Dependencies**: 15.3
**Pattern to follow**: `libs/web/members/src/lib/learning/course-player.store.ts` — the only store in this lib, and the one whose teardown discipline this task depends on (ground truth 9).

**Implementation details**:

- Public surface: `unreadCount()` (readonly signal), `items()`, `loading()`, `error()`, `start()`, `refresh()`, `markRead(id)`, `markAllRead()`, `openRoute(n)`.
- 🔴 **`@Injectable()` WITHOUT `providedIn`, PROVIDED AT THE `MemberLayout` ROUTE LEVEL (RISK-AM).** A root-provided store with a 60 s timer outlives sign-out, outlives leaving `/members`, and leaves an open handle in Jest. Copy `CoursePlayerStore`'s eslint-disable **and its justification comment**. The timer is started by an explicit `start()` the layout calls — **never in the constructor** — and cleared in `inject(DestroyRef).onDestroy()`.
- `POLL_INTERVAL_MS = 60_000` as a named constant (ASSUMPTION-29). **Plus an eager fetch on every navigation** (R10.5, AD-14) — subscribe to `Router` `NavigationEnd` inside the layout-scoped store, not with a second timer.
- 🔴 **`openRoute(n)` REFUSES ANY STORED `route` NOT MATCHING `/^\/members\//` (RISK-AO)**, falling back to `/members/notifications` and logging. The server builds it through `buildNotificationRoute` (RISK-AJ); this is the second end of the same defence, and neither end may be dropped on the grounds that the other exists.
- 🔴 **THE STORE IS THE ONLY WRITER OF THE COUNT (RISK-AP).** `markRead` decrements optimistically, issues the request, replaces the count from the server on success and restores it on failure; **the poll is skipped while a write is in flight**. `openRoute` marks read _then_ navigates.

**Validation notes**:

- **RISK-AM**: assert `onDestroy` clears the handle — advance a fake timer past 60 s after destruction and assert **no** request. `http.verify()` in `afterEach` is what makes a stray one fail.
- **RISK-AO**: table-driven over `'https://evil.example'`, `'//evil.example'`, `'/admin/users'`, `'/members/community/topics/x'` — only the last navigates.
- **RISK-AP**: leave the `markRead` request unflushed, fire the poll, assert no count flicker and no second write — the shape of B13's F-4 regression test.
- An error from the poll **must not** clear `unreadCount()` — a failed refresh tells us nothing about the count, and zeroing it is the badge lying.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=member-notifications.store`

---

### Task 15.5: `PacksPage` — `/members/packs`, the access note before the link ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/packs/packs-page.ts` (NEW)
- `libs/web/members/src/lib/packs/packs-page.spec.ts` (NEW)

**Requirement refs**: **R5.1**, **R5.5**, R5.7, R9.7, NFR-U1/U2/U3/U4, **RISK-AQ**, ASSUMPTION-25/26/27
**Dependencies**: 15.2
**Pattern to follow**: `courses-page.ts` — a member list surface with the same four-cell branch discipline.

**Implementation details**:

- Renders title, description, tags, `cohortName` and `repoUrl` per pack (R5.1). Tags and `cohortName` use the promoted **`TagChip`**; the empty branch uses **`EmptyState`** (R9.7 — reuse, do not re-implement).
- 🔴 **`accessNote` RENDERS ABOVE THE `repoUrl` LINK, ALWAYS** (R5.5, ASSUMPTION-26) — the requirement is that the member is told _"in advance"_, so placement is load-bearing, not cosmetic. Null falls back to one shared constant line (ASSUMPTION-27); a blank gap at exactly the spot R5.5 exists to fill is the failure.
- 🔴 **FOUR DISTINCT RENDERS, BRANCHED `error → loading → empty → list` (RISK-AQ).** "We could not load your packs" (retryable, `role="alert"`) is a different message from "No packs are available to you yet" (`EmptyState`, `role="status"`). Branching on `items.length` first collapses them.
- The external link carries `rel="noopener noreferrer"` and an accessible name that includes the pack title — a page of links all reading "Open repository" is unusable on a screen reader.
- **One flat list, no cohort grouping** (ASSUMPTION-25).
- ⚠️ **Nothing on this page implies Ptah grants access** (R5.7). No "Request access" button, no entitlement check, no gate.
- `ChangeDetectionStrategy.OnPush`, signals, `inject()` (NFR-U1). Tokens only — `/60` or stronger for anything a member must read, `/40` never (NFR-U3, B13's F-1).

**Validation notes**: the spec is table-driven over the four cells, each asserted **by its copy**; plus one case that a pack with `accessNote: null` still renders the fallback line, and one that `notes` appears nowhere in the rendered HTML even when the fixture carries it.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=packs-page` · `npx nx lint web-members --skip-nx-cache`

---

### Task 15.6: `NotificationsPage` + bulk mark-read ✅ COMPLETE (`7408121b6 + 12ed2703f`)

**Files**:

- `libs/web/members/src/lib/notifications/notifications-page.ts` (NEW)
- `libs/web/members/src/lib/notifications/notifications-page.spec.ts` (NEW)
- `libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.spec.ts` (NEW — its first spec)

**Requirement refs**: **R10.3**, R10.4, **R9.7**, NFR-P5, NFR-S2, ASSUMPTION-28, ground truth 4 (B14)
**Dependencies**: 15.4
**Pattern to follow**: `libs/web/admin/src/lib/users/users-list.html:59-72` — the cleanest of the four existing `SelectionToolbar` consumers.

**Implementation details**:

- Newest first, read/unread state visually distinct (R10.3), paged at the contract's 25 with the server's echoed `page`/`pageSize` as the authority.
- 🔴 **`bodyPreview` IS AN ESCAPED TEXT NODE.** It is an excerpt of member-authored markdown that the contract states is **not sanitized** (B14 ground truth 4). No `<ptah-markdown-block>`, no `[innerHTML]`, no `bypassSecurityTrustHtml`. `markdown-chokepoint.spec.ts`'s importer list stays at **six** — and Task 15.11 re-proves that spec can still fail.
- Opening a notification calls `store.openRoute(n)` — marks read, then navigates (R10.3). **Read on open only, never on scroll or on view** (ASSUMPTION-28).
- **`SelectionToolbar` for bulk mark-read (R9.7)** — `[count]="selected().length" itemNoun="notification" (cleared)="clearSelection()"`, with a "Mark read" action projected into its `<ng-content />`. Reused from `@ptah-web/panel-ui`, **not re-implemented**, and **no barrel edit** (it is already exported — ground truth 4).
- `SelectionToolbar` gets its first spec in this task: it renders nothing at `count() === 0`, pluralises `itemNoun`, emits `cleared`, and exposes `role="region"` with its label. That is a **cross-panel improvement** benefiting the four admin consumers, in the same shape as B13's F-1 fix — and, like that one, it should be **committed separately** so it stays revertible independent of the batch.
- Relative timestamps via the existing `relative-time`/`highlight-text` shared pipes if present; do not author a second date formatter.

**Validation notes**: assert the unread marker is driven by `readAt === null` and nothing else; assert bulk mark-read issues **one** `read-all`-shaped request rather than N; assert an empty inbox renders `EmptyState` and not an error.

**Verification**: `npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui --skip-nx-cache --testPathPatterns="notifications-page|selection-toolbar"`

---

### Task 15.7: `badgeCount` — one binding, in the computed that already exists ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/member-layout/member-layout.ts` (MODIFY — the `navGroups` computed, `:77-81`)
- `libs/web/members/src/lib/member-layout/member-nav-badge.spec.ts` (NEW)

**Requirement refs**: **R9.3**, R10.4, **RISK-AN**, ground truth 1, 2
**Dependencies**: 15.4

**Implementation details**:

- 🔴 **THIS TASK WRITES NO TEMPLATE AND NO PRIMITIVE.** `PanelNavItem.badgeCount` is declared (`panel-nav.types.ts:36`) and `PanelLayout` already renders it in **both** nav branches (`panel-layout.html:147`, `:171`). The Notifications item is `primary: false`, so it renders through the **secondary** branch — assert that branch specifically, because a test written against the primary one passes for the wrong item.
- The **only** change is inside `member-layout.ts:77-81`'s existing `computed<readonly PanelNavGroup[]>`: rebuild `MEMBER_NAV_GROUPS` with the Community group's Notifications item's `badgeCount` replaced by `store.unreadCount()`. The admin-link branch composes with it, it does not fork from it.
- 🔴 **`MEMBER_NAV_GROUPS` IS `readonly` AND IS NOT MUTATED.** Map to a new array. A mutation would leak the count into the module-level constant and across tests.
- `badgeCount` is **hidden at 0** by the template's `@if (item.badgeCount)` — pass `0`, not `undefined`, and let the existing branch do the hiding. Do not add a second falsy check.
- **No parallel badge mechanism** (R9.3). `member-nav.config.ts:26-35` states the prohibition; this task is the one that discharges it.

**Validation notes**:

- Assert the count moves the rendered badge when the store's signal moves, **and** that it disappears at 0.
- 🔴 **RISK-AN, structurally**: glob `libs/web/members/**/*.{ts,html}` and assert `unreadCount()` is read in **exactly one** file, and that no member template contains a `badge-` class of its own. Deliberate-failure proof in 15.11: add a second chip and watch it go red.
- Assert `MEMBER_NAV_GROUPS` is referentially unchanged after the computed runs.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns="member-layout|member-nav-badge"`

---

### Task 15.8: Swap the last two placeholder routes and delete the placeholder ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/members.routes.ts` (MODIFY — `:104-112`, `:181-189`, `:211-229`, and the header comment)
- `libs/web/members/src/lib/members.routes.spec.ts` (MODIFY)
- `libs/web/members/src/lib/placeholder/member-phase-placeholder.ts` (**DELETE**)
- `libs/web/members/src/lib/member-guard-wiring.spec.ts` (MODIFY — `:232-245`)

**Requirement refs**: R9.4, R9.5, ground truth 6, 7
**Dependencies**: 15.5, 15.6, 15.7

**Implementation details**:

- Swap both `loadComponent: loadPlaceholder` entries for real `loadComponent` imports and delete their `data:` blocks.
- 🔴 **DELETE `member-phase-placeholder.ts`, `loadPlaceholder()`, `placeholder()` AND THE `MemberPlaceholderData` IMPORT.** Three files' docblocks say this batch is the one that does it (ground truth 6): the component's own (_"the last one to do so deletes this file"_) and `members.routes.ts:211-219`. Leaving them is leaving dead code that three comments promised would go.
- 🔴 **`member-guard-wiring.spec.ts:232-245` MUST BE FIXED, NOT WEAKENED (ground truth 7).** Its case is _"a surface with NO activation fetch is not bounced"_ and `/members/packs` is about to acquire one. Its own comment offers the two legitimate repairs: move it to a surface that still has no fetch, or **answer the request the way the `/members` case above it does**. 🔴 **Prefer answering the request** — every member surface now fetches, so moving it again just defers the problem one more batch, and the assertion is about the guard, not about the absence of data.
- `members.routes.spec.ts` re-runs its R9.4 walk unchanged: no first segment beginning with `:`, every parameter drawn from `{ ':slug', ':lessonSlug', ':id' }`, and the literals `':model'` / `':model/:id'` nowhere.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns="members.routes|member-guard-wiring"` · `rg "MemberPlaceholderData|loadPlaceholder|member-phase-placeholder" libs/web` → **0 hits**.

---

### Task 15.9: `AccountPage` — it already exists; give it a spec and an a11y pass ✅ COMPLETE (`7408121b6`)

**Files**:

- `libs/web/members/src/lib/account/account-page.spec.ts` (NEW)
- `libs/web/members/src/lib/account/account-page.ts` (MODIFY — only if the spec or the a11y pass finds something)

**Requirement refs**: R9.6, R9.7, NFR-U1–U5, NFR-M1, ground truth 11
**Dependencies**: 15.8

**Implementation details**:

- 🔴 **THE COARSE TASK SAYS "ACCOUNT PAGE" AS THOUGH IT NEEDS AUTHORING. IT DOES NOT.**
  `account/account-page.ts` is 258 lines, routed at `members.routes.ts:195-199`, standalone,
  OnPush, three sections, and issues no request beyond `AuthService.getCurrentUser()`.
  **What it has never had is a test.** Say so in the report rather than rewriting a shipped
  surface.
- The spec covers: the identity section renders the signed-in email; the appearance section's
  theme toggle persists across a re-instantiation (R9.6 — `localStorage`, AD-13); the billing
  section renders without a subscription; sign-out is reachable by keyboard with a visible
  focus state (NFR-U4).
- Fix only what the spec or the axe pass actually finds, and **report each fix as a finding**
  rather than folding it into the task — it is pre-existing code, in the shape of B13's F-1.

**Verification**: `npx nx test web-members --skip-nx-cache --testPathPatterns=account-page`

---

### Task 15.10: The a11y migration — one axe helper, from the dependency, pointed at EMPTY surfaces ✅ COMPLETE (`7408121b6 + 3345904dd + a05714286`)

**Files**:

- `apps/ptah-landing-page-e2e/src/support/axe.ts` (NEW — the single shared helper)
- `apps/ptah-landing-page-e2e/src/specs/members-courses.spec.ts` (MODIFY — delete its CDN copy)
- `apps/ptah-landing-page-e2e/src/specs/members-live.spec.ts` (MODIFY — delete its CDN copy)
- `libs/web/panel-ui/src/lib/empty-state/empty-state.spec.ts` (MODIFY)

**Requirement refs**: **NFR-U4**, NFR-U3, NFR-U5, **F-I**, **RISK-AR**, B13's F-1 and its carried-forward item 2
**Dependencies**: 15.9

**Implementation details**:

- 🔴 **`@axe-core/playwright` IS ALREADY INSTALLED — `package.json:202`, `^4.12.1` (F-I).** B10 and B13 each recorded "not a devDependency" and each loaded axe from `cdn.jsdelivr.net`; **that is now false and both spec files still say it in comments.** Replace both loaders with `AxeBuilder` from the package, and **delete the two CDN copies and their stale comments**.
- 🔴 **THE TWO COPIES HAVE DIFFERENT VIOLATION SHAPES** (ground truth 5): `members-courses.spec.ts:640` reports `nodes: number`, `members-live.spec.ts:483-484` reports `targets: string[]` + `summary: string`. **Keep the live one's shape** — it is the one that made B13's F-1 diagnosable — and collapse both onto it.
- Keep B10's scope (`include: [['body']]`, `exclude: [['iframe']]`) and **say so**, so the narrowing is a recorded decision rather than an accident.
- 🔴 **POINT AXE AT EMPTY SURFACES SPECIFICALLY (RISK-AR).** B13's F-1 — a real 3.2:1 WCAG AA failure on a shipping component — survived three phases because every prior pass ran against **populated** surfaces and `EmptyState`'s hint only renders when a surface is empty. Every surface in this batch's sweep is run **twice**: populated and empty.
- Strengthen `empty-state.spec.ts` so the `/40` prohibition is scoped to **text-bearing elements** rather than to the file, keeping the `aria-hidden` decorative icon legal — the distinction B13 drew but did not enforce.
- ⚠️ **`libs/web/auth/auth-page.component.ts:125` and six `<p>` sites in `libs/web/admin` also carry `/40` on text.** They are **out of scope (RK-1)** — another surface's. **Report them; do not fix them.**

**Verification**: `npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache` · `npx nx test web-panel-ui --skip-nx-cache` · `rg "cdn.jsdelivr.net" apps/ptah-landing-page-e2e` → **0 hits**.

---

### Task 15.11: The proofs — e2e for every member surface, both themes, and the deliberate failures ✅ COMPLETE (`7408121b6`)

**Files**:

- `apps/ptah-landing-page-e2e/src/specs/members-packs.spec.ts` (NEW)
- `apps/ptah-landing-page-e2e/src/specs/members-notifications.spec.ts` (NEW)
- `apps/ptah-landing-page-e2e/src/specs/members-account.spec.ts` (NEW)
- `apps/ptah-landing-page-e2e/src/support/db.ts` (MODIFY — packs + notification fixtures)
- `apps/ptah-landing-page-e2e/src/specs/members-content.spec.ts` (**re-run unchanged**)

**Requirement refs**: exit-gate clauses 1–5, **NFR-M1**, **R6.2 / R6.6**, NFR-U4, NFR-U5, ground truth 12, 13
**Dependencies**: 15.10
**Pattern to follow**: `members-live.spec.ts` — the most recent, and the one whose seed/teardown discipline this task inherits.

**Implementation details**:

- New fixtures: `seedPack(slugPrefix, { memberVisible, cohortKey, accessNote, notes })` / `cleanupPacks(ids)` and `seedNotification(userId, { kind, actorId, route })` / `cleanupNotifications(userId)`. 🔴 **Per-statement `try`/`catch` with a `console.warn`** — do not restore the single-`try` shape that orphaned nine courses in B10's first run (ground truth 12).
- 🔴 **ANTI-VACUITY FIRST, EVERY TIME.** Assert the seeded rows are genuinely present and the surface genuinely populated **before** asserting anything about how it renders. B10's NFR-S3 assertion was true-because-empty until it was made to fail.
- **Clause 1 — packs**: seeded `notes` value appears **nowhere** in the page source; `accessNote` is present and **precedes** the `repoUrl` link in DOM order; the hidden pack is absent; the cohort-labelled pack is present for a **zero-cohort** member.
- **Clause 2 — badge**: identity B replies to identity A's topic; A loads `/members/hub` and the nav badge reads `1`; A opens it, is navigated to the thread, and the badge clears — **with no page reload**.
- 🔴 **Clause 4 — coverage**: the four uncovered surfaces get a spec each (`/members/packs`, `/members/notifications`, `/members/account`, `/members/search`). `/members/search` has only indirect coverage today via `members-community.spec.ts:392`; either promote it or state plainly that it remains indirect and why.
- 🔴 **Clause 5 — R6.2, RE-RUN UNCHANGED (R6.6).** `members-content.spec.ts` carries **two** halves — the stubbed one-request assertion (~`:71`) and the live one (~`:126`, _"the live hub still costs exactly one request now that community returns real data"_). **Both must pass with two more hub sections now returning real data, and neither may be edited.** If one fails, that is the finding.
- **Both themes on POPULATED surfaces**, `[data-theme="…"]` asserted as actually attached (NFR-U5).
- **At least four deliberate-failure proofs**, each reverted and `diff`-confirmed byte-identical:
  1. 🔴 **Add a second unread chip to `member-layout.html`** → RISK-AN's structural spec goes red. **This is the proof R9.3 is enforced and not merely stated.**
  2. Collapse RISK-AQ's branch order on `PacksPage` → the "could not load" cell renders "No packs" and its assertion fails.
  3. Change `openRoute` to navigate unconditionally → RISK-AO's `//evil.example` case goes red.
  4. Bind `[innerHTML]` on `bodyPreview` → `markdown-chokepoint.spec.ts` goes red and the importer list moves off six.

**Validation notes**: B7's five pre-existing e2e failures are **not yours** (ground truth 13) — report the same five and do not weaken those assertions. Tear down both identities and every fixture **by id**, in one `BEGIN`/`COMMIT`, and paste the census proving the database is back to its pre-batch state.

**Verification**:

```
npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core,ptah-landing-page --skip-nx-cache
npx nx build ptah-landing-page --configuration=production
npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
```

Green, against **Task 15.1's freshly measured baselines** (ground truth 14), not B13's. Then the e2e run, then the four deliberate failures with both runs pasted.

---

## Batch 16: P5-CLOSEOUT — final documentation sweep (Seshat/MG-4 half CUT) 🔄 IMPLEMENTED

### ✅ USER DECISION 2026-08-10 — the Seshat half is OUT OF SCOPE for this task

**Tasks 16.1–16.3 (inventory / retarget / changed-removed list at `D:/projects/seshat`) are
CUT.** The user's call: that work belongs to a session opened in Seshat's own workspace, not
driven cross-repo from `ptah-extension`.

The refinement's own findings support it independently — `D:/projects/seshat` has **no `.git`
and no parent repo**, so every edit made from here would be irreversible and unreviewable,
and there are **zero skills to retarget** (the five are declared at `PRD.md:213-219` and were
never created). Retargeting its spec is a Seshat-workspace task with a Seshat-workspace
reviewer.

**Consequences for this task:**

- **MG-4 is not satisfied by TASK_2026_177 and must not be reported as satisfied.** Batch 16's
  report records it as deferred-by-decision, naming this block — not as done, and not as lapsed.
- **Batch 16 keeps only its in-repo half**: the `CLAUDE.md` module-index pass (see F-N — the
  real scope is 25 undocumented `libs/api` / `libs/web` / `libs/api-contracts` projects, not
  "seven new libs") and the NFR-M5 gate amendment (F-L).
- **The `rg -i discourse` gate collapses to ONE repository**, not two. `ptah-extension` only.
- **Batch 16 no longer depends on anything outside this repo**, so its `backend-developer`
  executor and its position after B14/B15 are unchanged, but its risk profile drops to normal.

### 🔴 Batch 16 findings — both of its premises are false

**F-M — `D:/projects/seshat` CONTAINS ZERO SKILLS AND IS NOT A GIT REPOSITORY.**

The path **exists**. What is in it is five files and one directory:

```
D:\projects\seshat\.gitignore     D:\projects\seshat\BRIEF.md
D:\projects\seshat\OPERATIONS.md  D:\projects\seshat\PRD.md
D:\projects\seshat\README.md      D:\projects\seshat\reference\   (junctions to two repos)
```

- **No `.git` directory, and no parent is a repo either.** `git status` there returns
  `fatal: not a git repository`. 🔴 **There is no revert. Every edit is irreversible.**
- **No `.claude/`, no `skills/`, no `SKILL.md`, no `*skill*` directory anywhere.**
- **Five skills are DECLARED at `PRD.md:213-219` and none was ever created**:
  `seshat-weekly-cadence`, `seshat-discourse-ops`, `seshat-course-mapping`,
  `seshat-build-log`, `seshat-cohort-pulse`. Four subagents are declared at `PRD.md:141-204`
  (`curriculum-cartographer`, `build-log-writer`, `community-steward`, `session-producer`)
  and none exists either.
- `PRD.md:311-315` **predicted exactly this failure mode**: _"`ptah_harness_create_skill`
  writes to disk during the conversation, not at apply. A skill listed in `createdSkills` but
  never actually created produces no file. Verify each skill exists before applying."_

**So MG-4.1's "inventory the community skills" has an answer, and it is "there are none."**
MG-4.2's _"a rewritten skill contains no Discourse endpoint"_ has no subject. **What actually
carries the Discourse coupling is the SPEC — 49 hits across the four markdown files** —
and the spec is what a future `apply` would build the skills from. **Retargeting the spec is
therefore the only way MG-4 can be satisfied at all**, and it is what this batch does.

**Seshat's spec is stale in seven load-bearing ways** — every path it cites is gone:

| Seshat asserts                                                                  | Reality in `ptah-extension` at `4b0313783`                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BRIEF.md:14-15` — integration lives in `libs/api/community/src/lib/discourse/` | **Directory deleted.** The lib now holds `circle`, `google-sessions`, `live-sessions`, `member-groups`, `packs`  |
| `BRIEF.md:16` — `scripts/discourse-seed-community.mjs`                          | **File deleted**                                                                                                 |
| `OPERATIONS.md:19-20`, `PRD.md:80-83` — `apps/ptah-discourse-theme/`            | **Directory deleted**; only stale `dist/` output remains                                                         |
| `PRD.md:88` — `docs/deploy/discourse-digitalocean.md`                           | **File deleted**                                                                                                 |
| `OPERATIONS.md:92` — `admin-community.controller.ts` is `@Get`-only             | **File deleted**; its four routes are recorded as removed in `route-map.spec.ts:230-232`                         |
| `PRD.md:70-71` — `DISCOURSE_API_KEY` / `DISCOURSE_THEME_API_KEY` are live       | **No reader remains**; the vars are gone and `.env.prod:106` says the keys must be **revoked**, not merely unset |
| `OPERATIONS.md:16` — the site is `https://community.ptah.live`                  | The community is in-product at `/members`                                                                        |

**F-L — the NFR-M5 gate as written is NOT SATISFIABLE, and pretending otherwise is the
failure mode.** `rg -i discourse` over `ptah-extension`, excluding `.ptah/specs` and the
export JSON, returns **19 hits**, and **none of them is live code**:

| Group                      | Count | Disposition                                                                                                                                                                                                     |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma migration SQL       | **6** | 🔴 **IMMUTABLE.** `20260719160000_add_member_groups`, `20260801120000_add_packs`, and `20260805090000_drop_discourse_group` — whose **directory name** also matches. NFR-M3 forbids editing applied migrations. |
| `.env*` tombstone comments | **7** | Carry a **live operational instruction** — `.env.prod:106` says two keys must be **revoked**. Deleting them deletes the instruction.                                                                            |
| Generated Prisma client    | **1** | `libs/api/core/.../generated-prisma-client/internal/class.ts` inlines `schema.prisma`'s comment text. Disappears automatically when `schema.prisma:461` is reworded and the client regenerates.                 |
| Source prose / history     | **5** | `schema.prisma:461`, `route-map.spec.ts:231`, `member-topic.contract.ts:30`, `forum/README.md:3`, `forum/.../visibility.ts:83` — historical rationale, deliberately kept                                        |

**Zero live Discourse code, endpoints, env vars or SSO paths remain.** `apps/ptah-discourse-theme/`
and `.github/workflows/deploy-community-theme.yml` are **both gone**, and **zero**
`package.json` scripts mention discourse or community-theme — so B16's coarse items 4 and 5
are partly already done.

**F-N — the CLAUDE.md module-index task is far larger than "seven new libs".** Root
`CLAUDE.md` has **zero** references to `libs/api/**`, `libs/web/**` or `libs/api-contracts/**`
— `grep -n "libs/api\|libs/web\|@ptah-api\|@ptah-web"` returns nothing. The Module Index
documents `backend`, `frontend` and `shared` and **omits `api`, `api-contracts`, `web` and
`showcase-manifest` entirely**. **25 projects — 14 `libs/api`, 10 `libs/web`, 1
`libs/api-contracts` — have no CLAUDE.md and no index entry anywhere.** Separately,
**`ptah-discourse-theme` is ALREADY absent from the Apps list**, so that half of the coarse
item is a no-op to confirm rather than perform.

⚠️ **`CLAUDE.md` IS MODIFIED IN THE WORKING TREE RIGHT NOW** by the concurrent TASK_2026_197
session (F-H). **Re-read it immediately before editing and stage it by explicit path.**

---

**Recommended Executor**: `backend-developer` | **Fallback**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: `D:/projects/seshat` is **outside this repository, outside this task's test
coverage, and — as F-M establishes — outside version control entirely.** Nothing here can be
caught by a test and nothing can be reverted by a checkout, so every change is verified by
hand and the changed/removed list **is** the deliverable (MG-4.3). Sequenced last so the API
surface it targets is final.
**Dependencies**: Batch 14, Batch 15
**Preconditions**: **PRE-7 as amended by F-H** — never write into another task's folder;
`.ptah/specs` is now **tracked** and three foreign carriers are modified; Seshat is a
different, unversioned repository, so **confirm the path and take a backup before any write**
**Tasks**: 6

**Scope boundary (RK-1)**: 🔴 **Do NOT create the five declared skills.** MG-4 asks for the
community skills to be _"rewritten against the new API or deleted"_ — authoring five skills
that never existed is building a harness, not retargeting one, and it is a separate task with
its own review. **Do NOT edit anything under `D:/projects/seshat/reference/`** — those are
junctions into `property-hub` and this very repository, and a write through one lands in the
real tree. **Do NOT edit applied Prisma migrations** (NFR-M3). **Do NOT delete the `.env*`
tombstone comments** without carrying their revoke instruction somewhere durable. **Do NOT
touch `.commitlintrc.json`** (F-G — foreign WIP).

**Exit gate (§8.2 P5, closeout)** — four clauses:

1. **The Seshat changed/removed list is delivered** (Task 16.3, MG-4.3), naming every file
   touched, every declaration removed, and every skill **not** created, with the reason.
2. **No Discourse reference remains in either repository except the four enumerated,
   justified classes** (Task 16.5) — and the amended gate is written into this file so the
   next reader does not re-open a closed question.
3. **`libs/api/**`and`libs/web/**` are documented** (Task 16.4, MG-3.2) and
   `ptah-discourse-theme` is confirmed absent from the module index.
4. **`task.md`'s `status:` line moves to `in_review`** (Task 16.6) — edited on that one line,
   never rewritten.

---

### Task 16.1: Pre-flight — confirm the path, confirm the absence, take the backup 🚫 CUT (user decision 2026-08-10)

**Files**: none in either repository (verification + one backup copy outside both)
**Requirement refs**: MG-4.1, MG-4.3, PRE-7, F-M
**Dependencies**: none — this is the batch's root

**Implementation details**:

- Confirm `D:/projects/seshat` **exists** before any write (PRE-7). If it does not, **STOP and report** — MG-4 is then unsatisfiable and that is the finding.
- 🔴 **Confirm it is NOT a git repository** (`git -C D:/projects/seshat status` → `fatal: not a git repository`) and **state the consequence in the report: there is no revert.**
- 🔴 **Take a timestamped backup copy of the four markdown files before touching them**, outside both repositories and outside `.ptah/`. This is the only rollback that will exist.
- Confirm `reference/property-hub` and `reference/ptah-extension` are **junctions**, and record that **nothing under `reference/` is written to** — a write through a junction lands in the real tree.
- Re-run the skill census and paste it: `find D:/projects/seshat -iname "SKILL.md"` → **empty**; `D:/projects/seshat/.claude/` → **absent**. **Do not take F-M on trust; it is a snapshot.**
- `git -C D:/projects/ptah-extension status --short` → name the foreign WIP, **including `CLAUDE.md`**, before Task 16.4 touches it.

**Verification**: every command and its output pasted, including the backup path.

---

### Task 16.2: The Seshat inventory — five declared skills, four subagents, zero files 🚫 CUT (user decision 2026-08-10)

**Files**: none (read-only)
**Requirement refs**: **MG-4.1**, MG-4.3
**Dependencies**: 16.1

**Implementation details**:

- Produce the inventory MG-4.1 asks for, **as it actually is**: for each of the five declared skills (`PRD.md:213-219`) and four declared subagents (`PRD.md:141-204`) — name, declaration site, triggers, what it would do, whether it is community-related, and **whether it exists on disk (all: no)**.
- Classify each by what retargeting requires:
  - **`seshat-discourse-ops` — DELETE the declaration.** It is defined entirely by the two-key rule, the theme deploy, the `@discourse/mcp` invocation profiles and the six admin surfaces. **Every one of those is gone.** There is nothing to rewrite it _into_; the in-product admin surfaces are `libs/api/forum`'s admin controllers and they are reached through the admin panel, not an MCP server.
  - **`community-steward` (subagent) — DELETE.** Same reasoning; `PRD.md:181` defines it as _"Read the forum through the `@discourse/mcp` server."_
  - **`seshat-cohort-pulse` — REWRITE.** The need ("who has gone quiet") survives the platform change and is now answerable from the member API. `OPERATIONS.md:89-92` says in terms that this is the one legitimate custom surface _"which Discourse structurally cannot answer."_
  - **`seshat-weekly-cadence` — REWRITE (narrowly).** Its only coupling is open decision **D4** (Discourse Calendar plugin vs Google Meet), which Phase 4 settled: Ptah owns live sessions and Google Calendar supplies the Meet link. **Close D4 in the spec.**
  - **`seshat-course-mapping`, `seshat-build-log` — UNCHANGED.** Zero Discourse references. Say so explicitly; "no change" is a finding, not an omission.
- Enumerate all **49** Discourse hits across the four files with counts per file (`BRIEF.md` 8, `OPERATIONS.md` 16, `PRD.md` 23, `README.md` 2) so Task 16.3's after-count is checkable.

**Verification**: the inventory table, in the report. **No file is written in this task.**

---

### Task 16.3: Retarget the Seshat spec, and deliver the changed/removed list 🚫 CUT (user decision 2026-08-10)

**Files** (all outside this repository; **no test covers any of them**):

- `D:/projects/seshat/BRIEF.md` (MODIFY — 8 hits)
- `D:/projects/seshat/OPERATIONS.md` (MODIFY — 16 hits)
- `D:/projects/seshat/PRD.md` (MODIFY — 23 hits)
- `D:/projects/seshat/README.md` (MODIFY — 2 hits)

**Requirement refs**: **MG-4.2**, **MG-4.3**, R5.7, AD-14, §5
**Dependencies**: 16.2

**Implementation details**:

- 🔴 **NO DISCOURSE ENDPOINT, NO ADMIN-API CALL, NO SSO REFERENCE SURVIVES IN ANY RETARGETED SECTION (MG-4.2).** That means: the `@discourse/mcp` server registration (`PRD.md:234-252`), the two-key table (`PRD.md:66-71`, `OPERATIONS.md:29-30`), the theme-deploy ownership (`PRD.md:80-83`, `OPERATIONS.md:19-21`), the seeded-content note (`OPERATIONS.md:21`), and `community.ptah.live` (`OPERATIONS.md:16`). ⚠️ **A search for "sso" across seshat already returns zero** — record that rather than implying a removal.
- Replace them with what is true: the community is **in-product** at `/members`, served by
  `libs/api/forum`, `libs/api/learning`, `libs/api/community` and `libs/api/notifications`;
  cohort membership is `member_groups` + `member_group_assignments`; **notifications are
  in-app, poll-only — no email, no websocket, no SSE (AD-14, §5)**; packs deliver a **link**,
  never content or GitHub access (R5.7).
- **Close open decision D4** (`OPERATIONS.md:67`, `PRD.md:341`): Phase 4 settled it.
- 🔴 **Update the historical-accuracy note honestly.** Where a section records _why_ something
  is the way it is, keep the history and mark it as history — the failure mode is a spec that
  reads as though Discourse never existed and then cannot explain the `discourse-export.json`
  the seed still reads.
- 🔴 **DELETE the `seshat-discourse-ops` skill declaration and the `community-steward`
  subagent declaration**, and renumber/repoint every reference to them — including
  `PRD.md:221-222`'s _"Priority if the builder wants to trim: `seshat-discourse-ops` and
  `seshat-course-mapping` are load-bearing"_, which now names a deleted skill.
- ⚠️ **`README.md:75` — _"It does not replace Discourse. Discourse remains the forum."_** is
  the single most wrong sentence in the repository and must go.

**The deliverable (MG-4.3)** — a table in `batch-16-report.md`, because **no test covers any
of this**:

| File | Sections rewritten | Declarations removed | Discourse hits before → after | Verified how |
| ---- | ------------------ | -------------------- | ----------------------------- | ------------ |

Plus an explicit list of **skills NOT created and why** (scope boundary), and a plain
statement that **seshat is unversioned, so the backup from Task 16.1 is the only rollback**.

**Verification**: `rg -ic discourse D:/projects/seshat --glob '!reference'` → **0**, pasted
before and after. Every retargeted claim spot-checked against a real path in this repository —
**a spec that cites a path that does not exist is the exact defect being repaired**, and
re-introducing one would be the batch failing on its own terms.

---

### Task 16.4: `CLAUDE.md` — document the libs the module index has never seen (26 + thoth-runtime + showcase-manifest) 🔄 IMPLEMENTED

**Files**:

- `CLAUDE.md` (MODIFY — the Module Index)

**Requirement refs**: MG-3.2, NFR-M5, **F-N**
**Dependencies**: 16.3

**Implementation details**:

- 🔴 **RE-READ `CLAUDE.md` IMMEDIATELY BEFORE EDITING.** It is modified in the working tree by the concurrent TASK_2026_197 session (F-H), and it must be staged by explicit path.
- 🔴 **`ptah-discourse-theme` IS ALREADY ABSENT from the Apps list.** Confirm it and say so; do not perform a no-op edit and report it as work.
- Add **two new Module Index sections** — `### API Libs (license server)` and `### Web Libs (landing + panels)` — placed beside the existing `Backend Libs` / `Frontend Libs` / `Shared` sections, following their exact one-line-per-lib format.
  - **API**: `admin`, `audit`, `billing`, `community`, `core`, `email`, `forum`, `identity`, `learning`, `licensing`, `marketing`, `member-hub`, `membership`, `notifications`, `youtube` (15 after Batch 14), plus `api-contracts/community`.
  - **Web**: `account`, `admin`, `auth`, `core`, `landing`, `legal`, `members`, `panel-ui`, `pricing`, `ui`.
- ⚠️ **The coarse text says "all seven new libs described". The honest count is different and should be stated**: this task added `membership`, `api-contracts/community`, `member-hub`, `forum`, `learning`, `youtube`, `notifications` (**seven** api-side) plus `web/members` and `web/panel-ui`. **Documenting only those nine while leaving sixteen siblings undocumented would leave the index still structurally blind** (F-N) — so the sections are complete or they are not worth adding.
- ⚠️ Every new lib gets a **one-line description only**. **Do NOT author 25 per-lib `CLAUDE.md` files** — that is a separate task, and the scope boundary applies. Note the gap in the report as a follow-up.
- Mark the ★ chokepoints consistently with the existing sections (`api-contracts/community` is the RK-8 member/admin split; `libs/frontend/markdown` remains the XSS chokepoint).

**Verification**: `grep -n "libs/api\|libs/web" CLAUDE.md` → non-empty · `rg -i "discourse" CLAUDE.md` → **0** · `git diff CLAUDE.md` shows **only** the Module Index additions and **none** of TASK_2026_197's in-flight changes.

---

### Task 16.5: The NFR-M5 sweep, and the amendment that makes it honest 🔄 IMPLEMENTED

**Files**:

- `apps/ptah-license-server/prisma/schema.prisma` (MODIFY — the one comment at `:461`, optional)
- this file, `tasks.md` (MODIFY — record the amended gate)

**Requirement refs**: **NFR-M5**, MG-3.3, NFR-M3, **F-L**
**Dependencies**: 16.4

**Implementation details**:

- Run plan §6.5's command and paste it in full:
  ```
  rg -i discourse --glob '!node_modules' --glob '!.nx' --glob '!coverage' \
                  --glob '!dist' --glob '!.ptah' \
                  --glob '!docs/community/discourse-export.json'
  ```
- 🔴 **IT WILL NOT RETURN ZERO, AND THE CORRECT RESPONSE IS TO AMEND THE GATE, NOT TO FORCE THE NUMBER (F-L).** Six of the residual hits are inside **applied Prisma migrations**, which NFR-M3 forbids editing — including the directory name `20260805090000_drop_discourse_group`, which cannot be renamed without breaking `_prisma_migrations`. **Editing them to satisfy a search would be a real defect introduced to satisfy a cosmetic gate.**
- **The amended gate, written here so it is not re-litigated**: NFR-M5 is satisfied when `rg -i discourse` returns hits in **only** these five classes, each enumerated with its count: (1) `.ptah/specs/**` — this task's own record; (2) `docs/community/discourse-export.json` and the seed pipeline that reads it; (3) applied Prisma migration SQL and directory names — **immutable by NFR-M3**; (4) `.env*` tombstone comments — which carry a **live key-revocation instruction**; (5) source docblocks recording history deliberately. **Anything outside those five is a defect.** Today: **19** hits, all inside classes 3–5.
- Optionally reword `schema.prisma:461`'s comment; note that `libs/api/core/.../generated-prisma-client/internal/class.ts`'s hit is **generated** and clears itself on regeneration — **never hand-edit generated output**.
- 🔴 **The `.env*` tombstones stay unless their instruction is carried elsewhere.** `.env.prod:106` says two keys must be **revoked**, not merely unset. If they have been revoked, say so and then delete; if not, **the comment is the only record and deleting it loses an open security action**.
- Delete the two stale gitignored artefact directories if present — `coverage/apps/ptah-license-server/discourse/` (coverage HTML for three deleted source files) and `dist/apps/ptah-discourse-theme/`. Both are untracked; **neither is ever staged**.
- Confirm the already-done half of the coarse item: `apps/ptah-discourse-theme/` **gone**, `.github/workflows/deploy-community-theme.yml` **gone**, **zero** `package.json` scripts matching discourse or community-theme.
- `npx nx graph` → no orphaned project, no broken dependency.

**Verification**: both `rg` runs (this repo and seshat) pasted in full, with the five-class table and its counts, and the amended gate recorded in this file.

#### ✅ NFR-M5 — THE AMENDED GATE, AS RECORDED BY BATCH 16 ON 2026-08-10

**This supersedes the original NFR-M5 wording and F-L's provisional numbers. Do not
re-open it.** The original gate — _"`rg -i discourse` across both repositories returns zero
hits outside the export JSON and this task's specs"_ — is **not satisfiable**, for two
independent reasons: the residual hits are load-bearing, and the second repository is out of
scope (see the `✅ USER DECISION 2026-08-10` block at the head of this batch).

**Scope**: **`ptah-extension` only.** The Seshat half is deferred by explicit user decision.

**NFR-M5 is satisfied when every `rg -i discourse` hit falls in one of these six classes**,
each enumerated with its count. **Anything outside them is a defect.**

| #   | Class                                                                          | Files                  | Hits   | Why it stays                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------ | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.ptah/specs/**`                                                               | this task's own record | n/a    | The task record must describe what it removed                                                                                                                 |
| 2   | `docs/community/discourse-export.json` **and the seed pipeline that reads it** | 8                      | **77** | MG-1.1: the seed reads the committed export and nothing else. The type names (`DiscourseExport*`) name the _input format_, which really is a Discourse export |
| 3   | Applied Prisma migration SQL **and directory names**                           | 3                      | **6**  | 🔴 **IMMUTABLE (NFR-M3).** `20260805090000_drop_discourse_group` is a _directory name_; renaming it breaks `_prisma_migrations`                               |
| 4   | `.env*` tombstone comments                                                     | 3                      | **7**  | 🔴 **`.env.prod:106` carries a live key-revocation instruction.** Deleting the comment deletes the instruction                                                |
| 5   | Source prose / history docblocks                                               | 6                      | **7**  | Deliberate historical rationale; a spec that reads as though Discourse never existed cannot explain the export the seed still reads                           |
| 6   | Generated Prisma client (gitignored)                                           | 1                      | **1**  | `libs/api/core/.../generated-prisma-client/internal/class.ts` inlines `schema.prisma`'s comment. **Never hand-edit generated output**                         |

**Class 2 is new relative to F-L**, which put the residual at 19 by silently excluding the
seed pipeline that the stated `rg` command does **not** exclude. **Class 5 is 7, not F-L's 5** —
`apps/ptah-landing-page-e2e/src/specs/members-packs.spec.ts` added two when Batch 15 quoted
§8.2's own clause _"Members reach every pack repo link without Discourse"_. **`schema.prisma`'s
comment is at `:479`, not `:461`.**

**The substantive half of NFR-M5 — the half that is actually true — holds:**
**zero live Discourse code, endpoints, env vars, SSO paths, apps, workflows or npm scripts remain.**

**🔴 DEFERRED, NOT SATISFIED: MG-4 (the Seshat community-skill harness).** Deferred by the
`✅ USER DECISION 2026-08-10` block at the head of this batch — that work belongs to a session
opened in `D:/projects/seshat`'s own workspace. It must be re-filed as its own task; it must
not be reported as done and it must not be allowed to lapse silently.

---

### Task 16.6: Final verification and handoff 🔄 IMPLEMENTED

**Files**: `.ptah/specs/TASK_2026_177/task.md` (MODIFY — **the `status:` line only**)
**Requirement refs**: §8.2 P5, PRE-7, F-H
**Dependencies**: 16.5

**Implementation details**:

- Re-run every phase's standing gate one last time and paste it: the full backend `run-many`, the full frontend `run-many`, the production build, and the e2e suite. Compare against **Task 15.1's** baselines.
- Walk §8.2's P5 row clause by clause and mark each against the task that discharged it:
  _"Members reach every pack repo link without Discourse"_ (15.11) · _"`MemberPack`
  serialization test asserts `notes` absent"_ (14.7) · _"Unread count accurate on the nav
  `badgeCount`"_ (15.7) · _"Retention prune verified"_ (14.11) · _"Seshat changed/removed
  list delivered"_ (16.3) · _"Full NFR-P / NFR-U / axe pass; e2e for every member surface"_
  (15.10, 15.11).
- 🔴 **State whether B12's F-1 was closed by Task 14.14 or re-filed**, and carry forward any
  finding that Phase 5 could not close — including the 25 libs still without a per-lib
  `CLAUDE.md`, the `/40` text sites in `libs/web/admin` and `libs/web/auth`, and the
  `announcement` notification kind that ships with no producer (ASSUMPTION-20).
- 🔴 **Edit `task.md`'s `status:` line to `in_review`. Do NOT rewrite the carrier with
  `Write`**, and remember `description` must stay a `>-` block scalar.
- ⚠️ **`.ptah/specs` IS TRACKED NOW (F-H).** `tasks.md`, `batch-14/15/16-report.md` and
  `task.md` are **staged changes**, and `TASK_2026_179/task.md`, `TASK_2026_184/task.md` and
  `TASK_2026_197/tasks.md` are **foreign modifications in the same directory**. 🔴 **Never
  `git add .ptah/specs`.** Stage this task's files one path at a time.

**Verification**: the completion summary in `batch-16-report.md`, with every §8.2 P5 clause
mapped to the task and the evidence that discharged it.

---

## Commit plan — one commit per batch

**Only the team-leader commits.** Executors never run `git commit`; a developer worrying
about a commit writes stubs to reach it. The commit lands only after
`code-logic-reviewer` returns `APPROVED` (see the review loop below).

### Valid scopes — commitlint rejects anything else

`webview` · `vscode` · `vscode-lm-tools` · `deps` · `release` · `ci` · `docs` · `hooks` ·
`scripts` · `landing` · `license-server` · `electron` · `cli`

**There is no `community`, `members`, `forum`, `api` or `prisma` scope.** Backend work
(`libs/api/**`, `libs/api-contracts/**`, `apps/ptah-license-server/**`, Prisma migrations,
seeds) is `license-server`. Member and admin frontend work (`libs/web/**`,
`apps/ptah-landing-page*/**`, and the `libs/frontend/markdown` `'member'` preset, which
exists solely to serve the member panel) is `landing`. An invalid scope fails the hook,
and `--no-verify` is forbidden (PRE-7).

| Batch   | Subject line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B1**  | `feat(license-server): consolidate builders membership into libs/api/membership`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B2**  | `feat(license-server): add api-contracts/community wire types with member/admin split`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **B3**  | `feat(license-server): add member hub aggregate and entitlement probe`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **B4**  | `feat(landing): add members panel shell, routes and member markdown preset`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **B5**  | `refactor(license-server): remove the discourse integration and drop discourse_group`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **B6**  | `feat(license-server): add native community forum api`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **B7**  | `feat(landing): add member community feed, thread and composers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B8**  | `feat(license-server): seed migrated community content and decommission discourse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **B9**  | `feat(license-server): add courses api with youtube metadata`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **B10** | `feat(landing): add member course player with facade youtube embed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **B11** | `feat(license-server): seed the cohort 1 curriculum course`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **B12** | `feat(license-server): add live sessions and private session scheduling`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **B13** | ✅ **shipped as FIVE commits, not one** — `5cc1fdd80` services · `fc6e30773` card + 3 pages · `8a761df03` routes · `e9181716f` the `panel-ui` WCAG fix (**kept separate: a pre-existing defect, independently revertible**) · `db584deaa` e2e                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **B14** | `feat(license-server): add member packs and in-app notifications`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **B15** | ✅ **shipped as FOUR commits, not one** — `12ed2703f` `feat(license-server): add bulk mark-read for member notifications` (**the endpoint this batch proved was missing; landed FIRST so the frontend never calls a route that does not exist**) · `3345904dd` `fix(landing): make the detail drawer inert while hidden` (**kept separate: a pre-existing `serious` a11y defect, benefits the four admin consumers equally, independently revertible** — exactly B13's `e9181716f` precedent) · `a05714286` `test(landing): cover the selection toolbar and widen the empty-state sweep` (test-only, cross-panel) · `7408121b6` `feat(landing): add member packs, notification badge and accessibility pass` |
| **B16** | `docs: retarget community skills and close out the discourse removal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Where a batch spans two scopes**, split into two commits rather than inventing one:

- **B5** carries the backend deletion (`license-server`) plus the theme-app and workflow
  retirement. Land the second half as `ci: retire the discourse theme deploy pipeline`
  (deletes `apps/ptah-discourse-theme/`, `.github/workflows/deploy-community-theme.yml`,
  the `package.json` deploy scripts) and any doc-only residue as
  `docs: remove discourse setup and deployment guides`.
- **B7** and **B15** both touch `libs/web/panel-ui` for primitive promotions; those stay
  inside the `landing` scope.

Every commit body lists its tasks and ends with the trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

Before staging, run `git status --short` and `git diff --name-only` and stage the batch's
files **explicitly**. Do not `git add -A`: the working tree carries unrelated WIP and
`TASK_2026_176` is active in the same specs directory (RK-10 / PRE-7).

---

## Execution loop — who does what

| Executor does                     | Team-leader does                      | Orchestrator does            |
| --------------------------------- | ------------------------------------- | ---------------------------- |
| Writes real code, no stubs        | Verifies every file exists            | Spawns the executor          |
| Self-tests against the live stack | Returns `NEEDS REVIEW`                | Spawns `code-logic-reviewer` |
| Marks tasks 🔄 IMPLEMENTED        | Commits after `APPROVED`              | Feeds the verdict back       |
| Reports file paths                | Marks ✅ COMPLETE, assigns next batch | Spawns the next batch        |

`REJECTED` → no commit; the orchestrator re-spawns the **same** executor with the issue
list. CLI delegation stays disabled for the re-spawn as well.

---

## Status icons

| Status         | Meaning                               | Who sets              |
| -------------- | ------------------------------------- | --------------------- |
| ⏸️ PENDING     | Not started                           | team-leader (initial) |
| 🔄 IN PROGRESS | Assigned to an executor               | team-leader           |
| 🔄 IMPLEMENTED | Developer done, awaiting verification | developer             |
| ✅ COMPLETE    | Verified, reviewed and committed      | team-leader           |
| ❌ FAILED      | Verification failed                   | team-leader           |
