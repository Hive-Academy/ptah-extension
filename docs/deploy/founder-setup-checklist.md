# Founder Setup Checklist — Open-Source + Builders Launch

Single ledger of every configuration step for the open-source + Ptah Builders
model. Items marked ✅ DEV are already configured locally by the dev session.

> [!NOTE]
> **The self-hosted forum was dropped (TASK_2026_177).** Its setup section, its
> env vars and the DigitalOcean deep-dive this file used to point at are gone;
> the community is an in-product surface under `/members`.
> Decommissioning the running production instance is a separate, ordered
> procedure — see `.ptah/specs/task_2026_177/decommission-runbook.md`.

---

## 1. Already configured (dev) — nothing to do

| Item                                                                                         | Where                                                        | Status |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Paddle sandbox product "Ptah Builders"                                                       | `pro_01kxx5795byye8459t6affa2m8`                             | ✅ DEV |
| Sandbox price $29/mo                                                                         | `pri_01kxx5bgmepb6w0y43sqk7szaz` → `.env` + `environment.ts` | ✅ DEV |
| Sandbox price $290/yr                                                                        | `pri_01kxx5eb8m36kn6t3h1ss8dy0b` → `.env` + `environment.ts` | ✅ DEV |
| Sandbox discount FOUNDING70M (70% × 12 cycles, monthly)                                      | `dsc_01kz178gb27gbe49mz0g2cbs6g` → `.env`                    | ✅ DEV |
| Sandbox discount FOUNDING70Y (70% first payment, yearly)                                     | `dsc_01kz17avfpf5pxrgrqjbyq5bfn` → `.env`                    | ✅ DEV |
| `BUILDERS_CHECKOUT_ENABLED=false` (waitlist mode)                                            | `.env`                                                       | ✅ DEV |
| DB migrations applied to local Postgres (waitlist, legacy purge + circle col, member groups) | `ptah_postgres` container                                    | ✅ DEV |
| Default member group `founding` ("Founding Members")                                         | seeded by the member-groups migration                        | ✅ DEV |

## 2. Launch-blocking — production configuration (in order)

### 2.1 Live Paddle (mirror of the sandbox setup)

> [!IMPORTANT]
> **The discounts in this section are ON HOLD — the Early Adopter offer is a
> free grant, not 70% off.** An admin approves a waitlist row at
> `/admin/waitlist`, the server issues a free 1-year Builders licence, and the
> person never reaches a Paddle checkout. The paid founding-invite wave was
> deleted in TASK_2026_201.
>
> **Keep every row below.** The Early Adopter window is time-boxed. When it
> closes, Builders switches to self-serve Paddle checkout and this setup is the
> live path again. Do not delete the products, prices or discounts from Paddle,
> and do not write new offer copy against the 70% figure while the window is
> open.

- [x] Create product **Ptah Builders** (Standard digital goods) at
      https://vendors.paddle.com → `pro_01kz1d03jqd00gt6jgmbv3a8ve` (2026-08-02).
- [x] Price **$29.00/month** "Builders Monthly (Founding Member)", no trial →
      `pri_01kz1d200y7qqed9djyazrbskz`.
- [x] Price **$290.00/year** "Builders Yearly (Founding Member)", no trial →
      `pri_01kz1d31ax08swgnv20p55h1xc`.
- [x] Discount **FOUNDING70M**: 70%, recurring **12 billing periods**, checkout
      code enabled, restricted to the monthly price ($8.70/month for the first
      12 cycles, then the $29 list price) → `dsc_01kz1d5yxk1naqrtctbwyfbfaf`.
- [x] Discount **FOUNDING70Y**: 70%, one payment, checkout code enabled,
      restricted to the yearly price ($87 for the first year, then the $290
      list price) → `dsc_01kz1d8xwjt9wq17c9rdqcy29j`.
- [ ] ⚠️ The old FOUNDING35 / FOUNDING50 discounts are dead. Paddle discounts
      cannot be edited once used, so the 70% offer needs **new** discounts and
      new `dsc_` ids. Any invite already sent carries the old `dsc_` id in its
      link — **deactivate the old discounts in Paddle** so stale links can't
      still check out at 35% / 50%.
- [ ] Tip: create the production API key with **discounts: write** scope so
      this can be automated next time.
- [x] Values → `.env.prod`: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
      `PADDLE_PRICE_ID_BUILDERS_MONTHLY/_YEARLY`,
      `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY/_YEARLY` (all live ids set 2026-08-02).
- [x] Values → `apps/ptah-landing-page/src/environments/environment.production.ts`:
      live `pri_` ids in place (checkout stays guard-blocked by
      `buildersCheckoutEnabled: false` until launch).
- [ ] ⚠️ `.env.prod` deploy sync: the deploy-server workflow now writes
      `/opt/ptah-extension/.env.prod` from the `ENV_PROD_FILE` GitHub secret on
      every deploy. After ANY local `.env.prod` change run:
      `gh secret set ENV_PROD_FILE < .env.prod` — never hand-edit env on the
      droplet, it will be overwritten.
- [ ] Webhook destination for the prod server already exists from the legacy
      setup — verify it still points at `https://api.ptah.live/webhooks/paddle`.

### 2.2 Google Calendar + Meet (runbook §7 — ~15 min)

- [ ] OAuth client (**Internal** audience — you have Workspace; otherwise
      publish to Production. NEVER leave in Testing: 7-day token cap).
- [ ] Refresh token via OAuth Playground (scope
      `https://www.googleapis.com/auth/calendar`).
- [ ] Recurring weekly Builders session event **with Google Meet**, copy event id.
- [ ] Fill in `.env` (dev) and `.env.prod`: `GOOGLE_OAUTH_CLIENT_ID`,
      `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`,
      `GOOGLE_CALENDAR_ID`, `BUILDERS_SESSION_EVENT_ID`.

### 2.4 Database + deploy

- [ ] `npm run prisma:migrate:deploy` against the production database
      (Neon production branch) — applies waitlist, legacy-purge/circle,
      member-groups migrations. The legacy-purge migration converts any old
      pro/trial rows to community (idempotent).
- [ ] Deploy license server + landing page.

### 2.5 The launch flip (one moment, all together)

- [ ] `.env.prod`: `BUILDERS_CHECKOUT_ENABLED=true`
- [ ] `environment.production.ts`: `buildersCheckoutEnabled: true`

> **The founding wave is NOT part of this flip.** TASK_2026_201 deleted
> `POST /v1/admin/waitlist/invite`, `WaitlistInviteModal` and the **Send
> Founding Invites** control that used to live here — the founding cohort is
> free, so there is no checkout link to mail and nothing to gate on
> `BUILDERS_CHECKOUT_ENABLED`. Approving the wave is §2.6 and can be done
> before, during or after the flip.

### 2.6 The founding wave (free — independent of the flip)

- [ ] Provision the `founding` member group at `/admin/groups` **first**. If it
      is missing, approval fails closed for the whole batch before any row is
      touched.
- [ ] Admin → Waitlist → select the founding wave → **Approve to Founding
      Cohort**. Each approved row gets a free 1-year `builders` complimentary
      licence, the `founding` cohort, an `approvedAt` stamp and one welcome
      email carrying the licence key — all in one transaction per row.
- [ ] Read the **outcome tally**, not a success banner: every row reports
      `approved`, `already_approved`, `already_paid`, `not_found` or `failed`.
      A partly-applied batch is designed behaviour.
- [ ] `convertedAt` stays owned by the Paddle fan-out — free grants stamp
      `approvedAt`, so they never enter paid-conversion metrics.

Full procedure: `docs/community/curriculum-reseed-runbook.md` §5–6 for the
cohort schedule, and `.ptah/specs/TASK_2026_201/completion-report.md` §5.1 for
the approval flow.

## 3. Cohort management (ongoing, no code needed)

- New joiners are auto-assigned to whichever group is **default** at signup
  (`/admin/groups`). Cohort assignments survive cancellation (identity keeps,
  access group is removed).
- To open a new wave: `/admin/groups` → create e.g. `wave-2` ("Builders Wave 2")
  → toggle **default**. Founding members keep their badge forever.
- Bulk-assign existing members: Assign Members action (paste emails).

## 4. Not launch-blocking (parked decisions)

- [ ] OSS license choice (MIT/Apache vs AGPL) — blocks making the repo public,
      nothing else (from `docs/handoff-open-source-elevation.md`).
- [ ] Repo public + marketplace listing copy refresh.
- [ ] Final read-through of the rewritten legal pages (terms/refund/privacy) —
      all LEGAL REVIEW markers resolved, but a human pass before launch is wise.
- [ ] Wave-1 videos recorded (`marketing/scripts/01..03`), rendered via the
      self-shot pipeline (`apps/ptah-video-studio/RECORDING.md`), uploaded with
      the tone-swept kit metadata.
- [ ] Circle (dormant alternative): only if the in-product community is ever
      outgrown — Business plan $199/mo required for the API; set `CIRCLE_*` envs
      to enable.

## 5. Environment variable matrix

| Variable                                      | Dev (`.env`)           | Prod (`.env.prod`)         |
| --------------------------------------------- | ---------------------- | -------------------------- |
| `PADDLE_PRICE_ID_BUILDERS_MONTHLY/_YEARLY`    | ✅ sandbox             | ⬜ live ids (§2.1)         |
| `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY/_YEARLY` | ✅ sandbox             | ⬜ live ids (§2.1)         |
| `BUILDERS_CHECKOUT_ENABLED`                   | `false`                | ⬜ `true` at launch (§2.5) |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` | ⬜ (§2.2)              | ⬜ (§2.2)                  |
| `GOOGLE_CALENDAR_ID`                          | ✅ `primary`           | ✅ `primary`               |
| `BUILDERS_SESSION_EVENT_ID`                   | ⬜ (§2.2)              | ⬜ (§2.2)                  |
| `YOUTUBE_API_KEY`                             | ⬜ unset (feature off) | ⬜ unset (feature off)     |
| `CIRCLE_*`                                    | unset (dormant)        | unset (dormant)            |
