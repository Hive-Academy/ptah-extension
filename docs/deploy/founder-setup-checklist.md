# Founder Setup Checklist — Open-Source + Builders Launch

Single ledger of every configuration step for the open-source + Ptah Builders
model. Companion deep-dive: `discourse-digitalocean.md` (Discourse §1–6, Google
§7). Items marked ✅ DEV are already configured locally by the dev session.

---

## 1. Already configured (dev) — nothing to do

| Item                                                                                         | Where                                                        | Status |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Paddle sandbox product "Ptah Builders"                                                       | `pro_01kxx5795byye8459t6affa2m8`                             | ✅ DEV |
| Sandbox price $29/mo                                                                         | `pri_01kxx5bgmepb6w0y43sqk7szaz` → `.env` + `environment.ts` | ✅ DEV |
| Sandbox price $290/yr                                                                        | `pri_01kxx5eb8m36kn6t3h1ss8dy0b` → `.env` + `environment.ts` | ✅ DEV |
| Sandbox discount FOUNDING35 (35% × 12 cycles, monthly)                                       | `dsc_01kxx97wk4794g0evqvbcxy8n7` → `.env`                    | ✅ DEV |
| Sandbox discount FOUNDING50 (50% first payment, yearly)                                      | `dsc_01kxx9ahyztf5j4qqg2tvz7xmy` → `.env`                    | ✅ DEV |
| `BUILDERS_CHECKOUT_ENABLED=false` (waitlist mode)                                            | `.env`                                                       | ✅ DEV |
| `DISCOURSE_SSO_SECRET` (generated, reusable in Discourse admin)                              | `.env`                                                       | ✅ DEV |
| `API_PUBLIC_URL=http://localhost:3000`                                                       | `.env`                                                       | ✅ DEV |
| DB migrations applied to local Postgres (waitlist, legacy purge + circle col, member groups) | `ptah_postgres` container                                    | ✅ DEV |
| Default member group `founding` ("Founding Members")                                         | seeded by the member-groups migration                        | ✅ DEV |

## 2. Launch-blocking — production configuration (in order)

### 2.1 Live Paddle (mirror of the sandbox setup)

- [ ] Create product **Ptah Builders** (Standard digital goods) at
      https://vendors.paddle.com → copy `pro_...` id.
- [ ] Price **$29.00/month** "Builders Monthly (Founding Member)", no trial.
- [ ] Price **$290.00/year** "Builders Yearly (Founding Member)", no trial.
- [ ] Discount **FOUNDING35**: 35%, recurring **12 billing periods**, checkout
      code enabled, restricted to the monthly price.
- [ ] Discount **FOUNDING50**: 50%, one payment, checkout code enabled,
      restricted to the yearly price.
- [ ] Tip: create the production API key with **discounts: write** scope so
      this can be automated next time.
- [ ] Values → `.env.prod`: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
      `PADDLE_PRICE_ID_BUILDERS_MONTHLY/_YEARLY`,
      `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY/_YEARLY`.
- [ ] Values → `apps/ptah-landing-page/src/environments/environment.production.ts`:
      replace `pri_BUILDERS_MONTHLY_REPLACE_ME` / `pri_BUILDERS_YEARLY_REPLACE_ME`
      (checkout is guard-blocked until these are real).
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

### 2.3 Discourse on DigitalOcean (runbook §1–6)

- [ ] Droplet (dedicated `s-1vcpu-2gb` recommended — current droplet is 1GB) + 1GB swap.
- [ ] DNS `A community.ptah.live → droplet IP`.
- [ ] `discourse_docker` install; SMTP = Resend relay
      (`smtp.resend.com:465`, user `resend`, password = `RESEND_API_KEY`).
- [ ] Admin: enable DiscourseConnect provider, URL
      `https://api.ptah.live/api/v1/sso/discourse`, secret = the
      `DISCOURSE_SSO_SECRET` value (reuse dev's or generate fresh for prod).
- [ ] Admin API key (scoped: groups manage + users list/show).
- [ ] Groups: `builders` (access, members-only category) and
      `builders-founding` (cohort badge group — synced automatically).
- [ ] `.env.prod`: `DISCOURSE_URL=https://community.ptah.live`,
      `DISCOURSE_SSO_SECRET`, `DISCOURSE_API_KEY`,
      `DISCOURSE_API_USERNAME`, `API_PUBLIC_URL=https://api.ptah.live`.
- [ ] Spaces backups + both smoke-test checklists (runbook §6 + §7.4).

### 2.4 Database + deploy

- [ ] `npm run prisma:migrate:deploy` against the production database
      (Neon production branch) — applies waitlist, legacy-purge/circle,
      member-groups migrations. The legacy-purge migration converts any old
      pro/trial rows to community (idempotent).
- [ ] Deploy license server + landing page.

### 2.5 The launch flip (one moment, all together)

- [ ] `.env.prod`: `BUILDERS_CHECKOUT_ENABLED=true`
- [ ] `environment.production.ts`: `buildersCheckoutEnabled: true`
- [ ] Admin → Waitlist → select founding wave → **Send Founding Invites**
      (emails carry the discount checkout links; conversions stamp
      `convertedAt` and auto-join the `founding` group).

## 3. Cohort management (ongoing, no code needed)

- New joiners are auto-assigned to whichever group is **default** at signup
  (`/admin/groups`). Cohort assignments survive cancellation (identity keeps,
  access group is removed).
- To open a new wave: `/admin/groups` → create e.g. `wave-2` ("Builders Wave 2",
  Discourse group `builders-wave-2` if you want a forum badge) → toggle
  **default**. Founding members keep their badge forever.
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
- [ ] Circle (dormant alternative): only if Discourse is ever outgrown —
      Business plan $199/mo required for the API; set `CIRCLE_*` envs to enable.

## 5. Environment variable matrix

| Variable                                              | Dev (`.env`)               | Prod (`.env.prod`)         |
| ----------------------------------------------------- | -------------------------- | -------------------------- |
| `PADDLE_PRICE_ID_BUILDERS_MONTHLY/_YEARLY`            | ✅ sandbox                 | ⬜ live ids (§2.1)         |
| `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY/_YEARLY`         | ✅ sandbox                 | ⬜ live ids (§2.1)         |
| `BUILDERS_CHECKOUT_ENABLED`                           | `false`                    | ⬜ `true` at launch (§2.5) |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`         | ⬜ (§2.2)                  | ⬜ (§2.2)                  |
| `GOOGLE_CALENDAR_ID`                                  | ✅ `primary`               | ✅ `primary`               |
| `BUILDERS_SESSION_EVENT_ID`                           | ⬜ (§2.2)                  | ⬜ (§2.2)                  |
| `DISCOURSE_URL`                                       | unset (feature off)        | ⬜ (§2.3)                  |
| `DISCOURSE_SSO_SECRET`                                | ✅ generated               | ⬜ reuse or fresh (§2.3)   |
| `DISCOURSE_API_KEY`                                   | unset (feature off)        | ⬜ (§2.3)                  |
| `DISCOURSE_API_USERNAME` / `DISCOURSE_BUILDERS_GROUP` | ✅ defaults                | ✅ defaults                |
| `API_PUBLIC_URL`                                      | ✅ `http://localhost:3000` | ⬜ `https://api.ptah.live` |
| `CIRCLE_*`                                            | unset (dormant)            | unset (dormant)            |
