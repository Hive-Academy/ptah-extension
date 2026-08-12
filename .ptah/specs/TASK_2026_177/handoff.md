# Handoff — TASK_2026_177, resuming at Batch 7 / Batch 8

**Written**: 2026-08-04, end of the session that closed Phase 1.
**Updated**: 2026-08-05, end of the session that closed **Batch 6**.
**Branch**: `ak/license-server-validation-pipe`. Do NOT switch or create branches.
**Repo**: `D:/projects/ptah-extension`
**HEAD**: `9260336e7` (Batch 6). ⚠️ Another process commits to this branch too — HEAD moved
twice mid-batch during the Batch 6 session. Expect it to have moved again.

> ⚠️ **This file is not in git.** `.gitignore:128` matches `.ptah/**`, so this handoff,
> `tasks.md`, `implementation-plan.md`, `context.md` and `decommission-runbook.md` all live
> on disk only. They are the task's memory. Do not assume a fresh clone has them.

---

## 1. Where the work actually is

**Phase 1 is CLOSED. Batch 6 is CLOSED — the Phase 2 backend half is built and committed.**

| Batch                                  | State                                               | Commit                                                             |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| B1 P1a `libs/api/membership`           | ✅                                                  | `e954a531a`                                                        |
| B2 P1c `libs/api-contracts/community`  | ✅                                                  | `6349c4b3e`                                                        |
| B3 P1d `libs/api/member-hub`           | ✅                                                  | `3d5484f40`                                                        |
| B4 P1e `libs/web/members` shell        | ✅                                                  | `cdc1a1ef5` (+ `d1b57ec0f`, `a7edf152c`, `af2d22653`, `496ad5c5c`) |
| B5 P1b Discourse removal + migration 1 | ✅                                                  | `fd1b4557e`                                                        |
| — migration drift repair               | ✅                                                  | `097853b39`                                                        |
| B6 P2-BE forum + migration 2           | ✅                                                  | `9260336e7` (85 files, 436 `api-forum` tests)                      |
| **B7 P2-FE community screens**         | ⏸️ **NEXT — 11 tasks, decomposed**                  |                                                                    |
| **B8 P2-MIG MG-1 seed**                | ⏸️ **NEXT — 8 tasks, decomposed**                   |                                                                    |
| B9–B16                                 | ⏸️ batch-level only — refine at each phase boundary |                                                                    |

**Start here**: `tasks.md`, the **Batch 6 result** block (immediately after Batch 6's exit
gate). It records the census constants B7 must not guess, six carried-forward items, and
three corrections made to `tasks.md` itself because the document was wrong. Then Batch 7,
Task 7.1 — or Batch 8, which `tasks.md` declares **parallel-safe with B7** on a disjoint
file set (B7 = `libs/web/**` + `apps/ptah-landing-page-e2e/**`; B8 =
`apps/ptah-license-server/prisma/**`). Neither touches a shared registry file, which is the
condition `context.md`'s serialisation rule actually requires.

The three Batch 6 dispatch reports — `batch-6a-report.md`, `batch-6b-report.md`,
`batch-6c-report.md` — hold the detail behind that summary. **B7's most useful read is 6C's
"What Batch 7's executor should know" section.**

⚠️ **Batch 6 built the backend against `MemberCategory` / `MemberTopicSummary` /
`MemberTopicDetail` / `MemberPost` / `MemberSearchResults` in `@ptah-contracts/community`.
Those are live and shipped — B7 no longer builds against stubs.** Two contract decisions
are still cheap to overrule _until B7 renders them_, and expensive after:
`MemberCategory.unreadCount` counts **topics with unread activity**, not posts; and
`MemberTopicDetail.acceptedPost` is **always populated** when a live accepted answer exists,
including when it is off the requested page (the docblock's final sentence says the
opposite and contradicts the paragraph above it — delete that sentence).

---

## 2. Read these, in this order

1. **`tasks.md`** — the whole file. Specifically:
   - The **Batch 5 result** block (≈line 1720). It records every deviation Phase 1 took.
   - **Batch 6** (from ≈line 1902). Your work.
   - The **risks table**, including RISK-H through RISK-M added by the Phase 2 refine.
2. **`implementation-plan.md`** — §1.3 forum schema, §1.8 migration order, §2.5
   `libs/api/forum`, §3.3 Phase 2 contracts, §7 the MG-1 seed design, §8.1/8.2 build order
   and exit gates.
3. **`context.md`** — why Discourse was dropped, and the live validation environment.
4. **`decommission-runbook.md`** — executed; read only if you need the production history.

---

## 3. Ground truth that contradicts the plan — verify before trusting a document

The plan was written before Phase 1 ran. These facts are now different, and each one is
recorded in `tasks.md` too:

| The plan says                                      | Reality                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production forum is empty                          | It held **7 topics, 8 posts, 3 users, 16 uploads** — all Discourse's own seed content, authored by `system`, zero human posts. Substantively empty, literally not. **Destroyed 2026-08-04.**                                                                                                                                                                                                   |
| MG-5 decommission is gated on Batch 8              | **Already done.** Container, DNS record, disk and API keys destroyed. MG-5 was folded into B5 on the user's decision.                                                                                                                                                                                                                                                                          |
| Verify the MG-1 seed against the live container    | **Impossible — the local container was deleted by the user.** Seed source is `docs/community/discourse-export.json` (committed `6614f9e92`; verified 4 categories, 17 topics). B8 re-specifies verification as a byte-identical `bodyMarkdown` vs `raw` check.                                                                                                                                 |
| MG-5.2: `301` from `community.ptah.live`           | **Not applicable.** The DNS record is gone, so there is nothing to redirect from. Closed — zero human posts, no link equity.                                                                                                                                                                                                                                                                   |
| `docker-compose.yml` has a `discourse_dev` service | It never did. The container was driven by Discourse's own `d/boot_dev` in WSL. Only the compose _wiring_ existed and it is removed.                                                                                                                                                                                                                                                            |
| §2.5's admin controller layout                     | **Would fail the build (RISK-J).** It puts `admin-topics` at `v1/admin/community` while `admin-categories` sits at `v1/admin/community/categories` — a strict path-prefix, which `route-map.spec.ts` RI-1 rejects. Both `PREFIX_EXCEPTIONS` and `KNOWN_PREFIX_DEBT` are empty arrays. Task 6.13 lands three siblings at `…/categories`, `…/topics`, `…/posts` with nothing at the bare prefix. |
| §2.5's `ForumModule` imports `NotificationsModule` | That module does not exist until B14 (RISK-L). Copying the list verbatim gives an unresolvable import and a red `app.module.spec.ts`.                                                                                                                                                                                                                                                          |
| §7.2's seed target uses `npx tsx`                  | `tsx` is in neither `dependencies` nor `devDependencies`. Repo convention is `npx ts-node --project <tsconfig>` (four existing scripts).                                                                                                                                                                                                                                                       |
| Seed can use `new PrismaClient()`                  | It cannot. Prisma 7 here has no `datasource.url` — the URL lives in `prisma.config.ts` and the `PrismaPg` adapter is supplied at runtime. Mirror `PrismaService`.                                                                                                                                                                                                                              |

---

## 4. Two traps that already cost this task time

### 4.1 The migration drift — FIXED, do not reintroduce the pattern

`4db8de4df` edited an **already-applied** migration in place. That made `prisma migrate dev`
demand a full database reset, and — worse — because the template's INSERT ends in
`ON CONFLICT DO NOTHING`, the edit could never reach databases that had already seeded the
row. The local DB was still promising a _lifetime price lock_ that had been publicly
withdrawn, in the template `Admin → Waitlist → Send Founding Invites` actually mails.

Fixed in `097853b39`: the applied migration is restored to its pre-edit content, and
`20260806000000_fix_founding_invite_offer_copy` carries the intent forward with `DO UPDATE`.

> **The rule this re-establishes: never edit an applied migration. Add a new one.**

✅ **RISK-K IS CLOSED — verified empirically 2026-08-05, not inferred.** Every one of the
18 rows in `_prisma_migrations` was compared against the `sha256sum` of its
`migration.sql` on disk: **all 18 match, including
`20260724120000_seed_marketing_templates_v2`.** `prisma migrate dev` will not demand a
reset. This paragraph originally said so, `tasks.md` Task 6.4 said the opposite, and Batch
6 followed `tasks.md` — correctly, because hand-authoring is safe either way and _running_
`migrate dev` to find out was the one experiment with a destructive failure mode. **This
sentence is the check nobody had actually run:**

```bash
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select migration_name || '|' || checksum from _prisma_migrations order by 1;"
# compare each against: sha256sum apps/ptah-license-server/prisma/migrations/<name>/migration.sql
```

Batch 9's migration 3 may therefore use `prisma migrate dev --create-only` normally.
`--from-config-datasource` remains the safer habit — it reads the live database and creates
no shadow — but it is no longer a workaround for anything. **Re-run the checksum comparison
before trusting this**, since any future edit to an applied migration re-opens it.

⚠️ **Also corrected in `tasks.md`: Task 6.4's `migrate diff` command cannot run on the
installed Prisma 7.7.0** — `--from-url` and `--to-schema-datamodel` were both removed. The
working form is `--from-config-datasource --to-schema`, and Prisma 7 writes a dotenv banner
to stdout that corrupts a redirected `migration.sql`. Both are fixed in place.

### 4.2 Concurrent WIP in the working tree (PRE-7 / RK-10)

Another process works in this repo **at the same time**. During this session it left
untracked `tmp-leak-*` scratch files in `libs/backend/platform-core` that failed ESLint and
the electron build gate, which forced one commit through with `--no-verify`. It later cleaned
them up itself and both gates now pass.

**Rules that follow:**

- **Never `git add -A`.** Stage path-by-path and verify with
  `git diff --cached --name-only | grep -E "<foreign paths>"` before every commit.
- Foreign territory today: `libs/backend/**`, `libs/frontend/**`, `libs/shared/**`,
  `apps/ptah-extension-vscode/**`, `apps/ptah-electron/**`, `content-manifest.json`,
  `skills-lock.json`. **Yours**: `libs/api/**`, `libs/api-contracts/**`, `libs/web/**`,
  `apps/ptah-license-server/**`, `apps/ptah-landing-page*/**`.
- If a hook fails on a path you did not touch, **wait for the other process rather than
  reaching for `--no-verify`**. That was the right answer and it was missed once.

---

## 5. Preconditions that bind every remaining batch

| #         | Precondition                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PRE-1** | Read `libs/api/core/src/lib/common/dto-validation.pipe.ts` before touching a controller. A bare `@Body() dto: X` is **silently unvalidated** — esbuild emits no `emitDecoratorMetadata`. Every whole-object `@Body()`/`@Query()` param MUST bind `dtoPipe(TheDto)`.                           |
| **PRE-2** | Every new controller goes into `apps/ptah-license-server/src/testing/controller-registry.ts` **in the same commit that creates it**, or the census assertion fails the build.                                                                                                                 |
| **PRE-3** | ⚠️ **Going stale.** It says `@ptah-web/panel-ui` exports "nine symbols / 8 export lines". B7 promotes `ThreadRow` and `TagChip`, changing that. Task 7.1 records the new count in the barrel's header — treat `panel-ui/src/index.ts` as the authority, not PRE-3's literal numbers (RISK-M). |
| **PRE-4** | The `'member'` markdown preset lives **only** in `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`. No second renderer, no second sanitizer, no `[innerHTML]`.                                                                                                                   |
| **PRE-6** | `AuditLogService.write` accepts a `tx`. Every admin mutation enlists its audit row in the mutation's own `$transaction`.                                                                                                                                                                      |
| **PRE-7** | See §4.2. Never write into another task's spec folder. Never bypass hooks.                                                                                                                                                                                                                    |

Also live, and easy to trip:

- `apps/ptah-license-server/src/common/controller-validation.spec.ts` holds
  `MIN_TOTAL_PAYLOAD_PARAMS = 37` (a floor — raise it, with justification, when you add
  controllers) and `NAMED_PRIMITIVE_PARAM_COUNT = 6` (**exact equality** — one
  `@Query('q') q: string` fails the build). RISK-I.
- `route-map.spec.ts` `EXPECTED_ROUTES` must diff for every route added.
- Structural test **G5 was deleted** in B5 (it asserted the admin community controller was
  read-only; the native surface owns writes by design). G4 and G6 now point at
  `MembershipService`. Do not "restore" G5.
- `audit-log.types.ts` has a comment reserving `community.*` audit actions for Phase 2.
  **Batch 6 owns adding them.**

---

## 6. Environment

Stack runs locally; verify against it, not against mocks.

🔴 **`V-CURL` as written in `tasks.md` never authenticated, and every batch that recorded it
as passing was wrong.** `JwtAuthGuard` reads `request.cookies['ptah_auth']` and never looks
at the `Authorization` header, so `-H "Authorization: Bearer $TOKEN"` returns `401`. The
working form is `curl -s -b "ptah_auth=$TOKEN" …`. Fixed in `tasks.md`'s handle table, along
with a headless `V-TOKEN` recipe (mint a short-lived token with `JWT_SECRET` from the
workspace-root `.env` — a sub-agent cannot use the prescribed browser login).

| Service            | Where                                                             |
| ------------------ | ----------------------------------------------------------------- |
| License server     | `http://localhost:3000` — `/api/health` → 200                     |
| Postgres (dev)     | container `ptah_postgres`, db `ptah_db`, user `ptah` (superuser)  |
| Landing dev server | `nx serve ptah-landing-page` → `:4200`, proxies `/api` to `:3000` |

```bash
docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "<sql>"

# Migrations. DATABASE_URL lives in the WORKSPACE-ROOT .env, but prisma.config.ts
# loads apps/ptah-license-server/.env, which does not exist — so pass it explicitly:
cd apps/ptah-license-server && DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" npx prisma migrate dev
```

Verified for migration 2: local Postgres is **16.13**, `pg_trgm` **1.6** is available, and
the `ptah` role is **superuser** — `CREATE EXTENSION pg_trgm` will apply. Production is a
`postgres:16-alpine` container on the droplet where `ptah` is **also** superuser, so it
applies there too (this is why RISK-H was downgraded HIGH → LOW).

⚠️ `npm run test` runs only **3** projects (vscode, webview, shared) and touches none of the
api libs. For backend work the real gate is an explicit
`nx run-many -t eslint:lint,typecheck,test -p <projects> --skip-nx-cache`.

⚠️ `nx lint` does not exist for `libs/api/*` — use `npx nx eslint:lint`. It **does** exist
for `libs/web/*`.

---

## 7. Production state (post-decommission)

Droplet `ptah-api-prod`, `167.71.9.106`, Ubuntu 24.04, 2 GB / 50 GB, AMS3. Runs the license
server, Postgres and Caddy. **Never destroy it.** SSH as `root` works with key auth.

- Forum container, `/var/discourse`, its images and its DNS record: **gone**. 6.1 GB
  reclaimed (14G → 7.9G).
- Both forum API keys revoked before teardown.
- `api.ptah.live` is the **only** Caddy site block. Backup of the prior config at
  `/opt/ptah-extension/caddy/Caddyfile.bak-task177`.
- 🔴 **Open item**: check GitHub repo secrets for a leftover `ptah-theme-deploy` or other
  `DISCOURSE_*` secret. A second API key existed on the server that appeared in no env file
  — it was almost certainly an Actions secret. Revoked server-side; the secret itself may
  still be sitting in GitHub.

**Production is 7 migrations behind, and that is normal, not broken.** The deployed image
was built 2026-06-13 and carries only the 9 migrations prod has applied. The Dockerfile CMD
is `npx prisma migrate deploy && node main.cjs`, so the next deploy applies all pending
migrations in order _before_ the app boots — schema and code always land together. A failing
migration therefore means a **failed deploy**, not a corrupted running app.

---

## 8. Open decisions the next session inherits

1. 🔴 **Blogs have nowhere to live.** The user asked for a blog seed. There is **no blog
   model** in the schema and none in the plan; `apps/ptah-docs` is file-based Astro
   Starlight. Needs a design decision — DB-backed model in the license server, an Astro
   content collection, or marketing pages — before any blog seed is meaningful. Does **not**
   block Batch 6.
2. **ASSUMPTION-4/-5**, recorded inside Batch 6 and flagged for overrule: `visibility:
'staff'` categories are visible to **admins only** (with a mandatory 404 spec), and the
   R1.2.3 post edit window is **24 hours** as one constant. Both defaults look right; neither
   is confirmed by the user.
3. **AD-6's `libs/api/community` split** is now _possible_ (B5 removed the file-level cycle)
   but deliberately **deferred** — B6 does not touch that lib, and B12/B14 are about to
   rewrite three of its four surviving directories. Recommended owner: a follow-up after B16.
4. **The `4db8de4df` marketing-copy change** is now split across two migrations. If its owner
   objects to the restore, the alternative was patching `_prisma_migrations.checksum`, which
   blesses the edit on one database only and would have left the withdrawn price-lock promise
   in place. State that trade-off rather than silently re-editing.

---

## 9. Working agreements from this session

- **Commits**: the orchestrator's team-leader owns them by default. The user overrode that
  and asked for direct commits; both `fd1b4557e` and `097853b39` were made that way.
- **`--no-verify`**: forbidden by the brief. Used exactly once, on `fd1b4557e`, on the user's
  explicit instruction after the failure was shown to be foreign. `097853b39` passed all
  hooks. Do not normalise it.
- **CLI delegation is DISABLED** (`context.md`, Checkpoint 0.1). Sub-agents only — no
  `codex`, no `copilot`, no `ptah-cli`.
- The user is technical, pushes back on wrong analysis, and prefers being told what is
  uncertain over being given a confident guess. When they challenge a conclusion, **check
  before defending it** — twice this session they were right and the analysis was wrong
  (the deploy workflow does run migrations; the `tmp-leak` files should simply have been
  waited out).

---

## 10. First moves for the new session

```bash
cd D:/projects/ptah-extension
git log --oneline -3                 # expect 097853b39 at HEAD
git status --porcelain               # expect ONLY foreign WIP
```

Then read `tasks.md` Batch 6 and start at **Task 6.1** (scaffold `libs/api/forum`,
`scope:api` / `type:feature`, plus `common/` with the AD-5 `NOT_DELETED` structural spec).

Batch 6's exit gate (§8.2 P2, backend half): a depth-3 reply attaches at depth 2
server-side · NFR-P4 25-topic feed ≤ 5 queries, asserted · soft-delete filter spec green ·
`route-map` + `controller-validation` green.

**Scope boundary (RK-1), enforced**: no trust levels, no spam heuristics, no flag queues, no
digests, no websockets, no denormalized reaction counters, no reconciliation job, no
`tsvector`, no external search. §5 of the requirements is normative.
