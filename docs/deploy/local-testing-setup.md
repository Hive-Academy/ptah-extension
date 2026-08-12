# Local-First Testing Setup — Builders + Sessions

Goal: exercise the **full founder stack on your own machine** before touching
production — Google Calendar/Meet sessions and the Paddle Builders checkout —
then promote the identical config to prod.

> [!NOTE]
> **Workstream A (forum SSO) was removed by TASK_2026_177.** The self-hosted
> forum, its SSO provider endpoint, its admin group-sync and the local dev
> container that backed all three are gone; the community is an in-product
> surface under `/members`. The lettering of the remaining workstreams (B, C) is
> deliberately UNCHANGED so the cross-references in
> `founder-setup-checklist.md` and `e2e-test-handoff.md` still resolve.
>
> If a forum container is still running on your machine or on the production
> droplet, tearing it down is a separate ordered procedure —
> `.ptah/specs/task_2026_177/decommission-runbook.md`.

Companion docs (prod detail lives there, not duplicated here):

- `founder-setup-checklist.md` — the master launch ledger.

All the application code (calendar attendee management, checkout) is already
written and unit-tested. Everything below is **configuration + provisioning**,
identical in shape locally and in prod.

---

## Current status

| Workstream                         | Local status                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Calendar / Meet sessions    | ✅ **complete** — `Ptah Sessions` OAuth client, `GOOGLE_OAUTH_*` + `BUILDERS_SESSION_EVENT_ID` (`cfjfqv3bc65e1lj1ikthei4i40`, weekly + Meet) in `.env`, `node scripts/google-sessions-smoke.mjs` fully green (token → list → master event with meetLink) |
| Paddle Builders checkout (sandbox) | ⬜ Workstream C (sandbox already wired, flag off)                                                                                                                                                                                                        |

Prereqs already satisfied in `.env`: `JWT_SECRET`, sandbox Paddle Builders price

- discount ids, `RESEND_API_KEY`, `NGROK_AUTHTOKEN`,
  `FRONTEND_URL=http://localhost:4200`.

---

## Workstream B — Google Calendar / Meet (local = prod, ~15 min)

The license server reads the weekly Builders session from **your** Google
Calendar and adds/removes members as attendees on the recurring event. The OAuth
client + refresh token are **the same in dev and prod** — do this once and reuse
the five values in `.env.prod` later. It's the one workstream only you can do
(it clicks through your Google account), so knock it out first.

The code path: `GOOGLE_OAUTH_*` → refresh-token grant at
`oauth2.googleapis.com/token` → Calendar v3 REST (no `googleapis` package). Scope
needed: `https://www.googleapis.com/auth/calendar` (read events + patch attendees).

### B1. Create the OAuth client (Google Cloud Console)

1. https://console.cloud.google.com → create/select a project (e.g. `ptah-community`).
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → Google Auth Platform → Branding**: app name `Ptah Sessions`,
   support email = your account. (Since 2024 the consent screen lives here, under
   Google Auth Platform — _not_ the old "OAuth consent screen" menu.)
4. **Audience** tab — this choice matters:
   - **Internal** (available if your account is Google Workspace) — **pick this.**
     No verification, no test-user list, refresh tokens never hit the testing cap.
   - If Internal is greyed out → choose **External**, then **Audience → Publish
     app → Production**. Do **not** leave it in **Testing**: testing-mode refresh
     tokens are hard-capped at **7 days** and the integration would silently die
     weekly. The "unverified app" warning is irrelevant — you're the only user.
5. **Clients** tab → **Create client** → type **Web application** → under
   **Authorized redirect URIs** add `https://developers.google.com/oauthplayground`
   → **Create** → copy the **Client ID** and **Client Secret**.

### B2. Mint the refresh token (OAuth Playground)

1. https://developers.google.com/oauthplayground → ⚙ (top-right) → check
   **Use your own OAuth credentials** → paste Client ID + Secret.
2. Left panel **Step 1**: in the "Input your own scopes" box enter
   `https://www.googleapis.com/auth/calendar` → **Authorize APIs** → sign in with
   your account → **Allow**.
3. **Step 2**: **Exchange authorization code for tokens** → copy the **Refresh
   token** (the playground sends `access_type=offline` + `prompt=consent`, so a
   refresh token is always issued).

### B3. Create the recurring Meet event

1. In Google Calendar (same account) create the weekly session, e.g. "Ptah
   Builders — Weekly Live Session", **weekly recurrence**, and **Add Google Meet
   video conferencing** (that Meet link is what members see on `/members`).
2. Get the **master** event id (not a single instance):
   ```bash
   # any access token from the Playground works here
   curl -s -H "Authorization: Bearer <access-token>" \
     "https://www.googleapis.com/calendar/v3/calendars/primary/events?q=Builders" \
     | grep '"id"'
   ```
   or open the event in the browser, take the `eid=` param and
   `echo '<eid>' | base64 -d` → `eventId calendarId`.

### B4. Paste the five values into `.env`

The keys are already staged (empty) in `.env` around **line 264** — fill them:

```bash
GOOGLE_OAUTH_CLIENT_ID=<from B1>
GOOGLE_OAUTH_CLIENT_SECRET=<from B1>
GOOGLE_OAUTH_REFRESH_TOKEN=<from B2>
GOOGLE_CALENDAR_ID=primary
BUILDERS_SESSION_EVENT_ID=<master event id from B3>   # leave blank to keep read-only
```

```bash
docker compose restart license-server
```

### B5. Verify

```bash
# mirrors the provider exactly — token grant + list + master-event fetch.
# No Builders DB account needed. Green = the /members/sessions endpoint will work.
node scripts/google-sessions-smoke.mjs
```

Then the endpoint-level checks (need a Builders account — do after Workstream A/C
seeds one):

- `GET http://localhost:3000/api/v1/members/sessions` as a Builders account →
  the weekly event with a `meetLink`.
- Issue a complimentary Builders license (admin) → the member's email appears as
  an attendee on the event (no invite email — the server patches `sendUpdates=none`).
- Cancel it → attendee removed, `sessions.attendee.remove` audit entry present.

> [!NOTE]
> Google expires refresh tokens after **6 months of non-use**, but the server
> refreshes on every sessions read/write, so normal traffic keeps it alive
> indefinitely. If it's ever revoked, repeat **B2 only** — the client (B1) stays.

---

## Workstream C — Paddle Builders checkout (sandbox)

Sandbox product and prices are already in `.env` and the landing page
(`environment.ts` points its checkout at the sandbox price ids). The founding
discounts **FOUNDING70M** / **FOUNDING70Y** must be (re)created in the Paddle
sandbox at **70%** — the old 35%/50% `dsc_` ids in `.env` are stale and cannot
be edited in Paddle once used. Checkout is guard-blocked by a flag; flip it
locally to test:

1. `.env` → `BUILDERS_CHECKOUT_ENABLED=true`
2. `apps/ptah-landing-page/src/environments/environment.ts` →
   `buildersCheckoutEnabled: true`
3. Webhooks: the `ngrok` container is already running
   (`docker compose --profile webhook-testing up -d` if not). Point the Paddle
   **sandbox** webhook destination at the ngrok URL
   (`docker compose logs ngrok | grep url=`) `+ /webhooks/paddle`.
4. Run the landing page (`nx serve ptah-landing-page`) and complete a sandbox
   checkout with a Paddle test card. Confirm the subscription row is created and
   the user's tier flips to `builders`.

Revert the two flags to `false` when done so local mirrors the waitlist default.

---

## Promote to production (the delta)

Once all three workstreams pass locally, prod is the **same config with real
values**. Follow `founder-setup-checklist.md` §2 in order; the deltas from local:

| Local                             | Production                                                   |
| --------------------------------- | ------------------------------------------------------------ |
| Paddle **sandbox** ids            | Paddle **live** product/prices/discounts (checklist §2.1)    |
| `.env` (dev secrets)              | `.env.prod`                                                  |
| local Postgres (migrated)         | `prisma migrate deploy` against the prod DB (checklist §2.4) |
| Google OAuth (same client)        | **reuse the same client/token**                              |
| `BUILDERS_CHECKOUT_ENABLED=false` | flip to `true` at launch (checklist §2.5)                    |

Is it hard? No — the code is done and you've already proven the wiring locally.
Prod is provisioning a droplet, one DNS record, mirroring the Paddle product, and
copying env values. The launch flip (checklist §2.5) is the only "all at once"
moment.
