# Local-First Testing Setup — Builders + Discourse + Sessions

Goal: exercise the **full founder stack on your own machine** before touching
production — Discourse SSO round-trip, Google Calendar/Meet sessions, and the
Paddle Builders checkout — then promote the identical config to prod.

Companion docs (prod detail lives there, not duplicated here):

- `founder-setup-checklist.md` — the master launch ledger.
- `discourse-digitalocean.md` — prod Discourse install (§1–6) + Google (§7).

All the application code (SSO provider, admin group-sync, calendar attendee
management, checkout) is already written and unit-tested. Everything below is
**configuration + provisioning**, identical in shape locally and in prod.

---

## Topology (important — Discourse is NOT in our compose)

The official free Discourse "development install" runs from **Discourse's own
source repo** via its `d/boot_dev` launcher, which owns its container stack
(Postgres, Redis, unicorn, ember-cli, mailcatcher). It is not a service in our
`docker-compose.yml`, and shouldn't be — the `discourse/discourse_dev` image is
driven by those scripts, not plain compose.

```
Your machine
├── docker-compose.yml (this repo)   postgres + license-server + ngrok   :3000
│      └── extra_hosts: community.localhost → host-gateway  (reaches Discourse)
└── ~/discourse  (github.com/discourse/discourse)   its own stack        :4200
       booted with `d/boot_dev`  — side-by-side, talk over localhost
```

Because DiscourseConnect SSO is a chain of **browser 302 redirects**, the browser
only needs to reach `license-server` (`:3000`) and `Discourse` (`:4200`). The one
server-to-server path is the license server calling Discourse's admin API for
group-sync — handled by the `community.localhost` host alias below.

---

## Current status

| Workstream                             | Local status                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSO endpoint (crypto/redirect/reject)  | ✅ **verified** — `node scripts/discourse-sso-smoke.mjs` (all checks green)                                                                                                                                                                              |
| Discourse dev container + admin config | ✅ **complete** — `discourse/discourse_dev` in WSL Ubuntu (Rails on host 3001), SSO + `builders` group + gated category + API key configured, `node scripts/discourse-e2e.mjs` fully green (round-trip, gating, admin-sync, config)                      |
| Google Calendar / Meet sessions        | ✅ **complete** — `Ptah Sessions` OAuth client, `GOOGLE_OAUTH_*` + `BUILDERS_SESSION_EVENT_ID` (`cfjfqv3bc65e1lj1ikthei4i40`, weekly + Meet) in `.env`, `node scripts/google-sessions-smoke.mjs` fully green (token → list → master event with meetLink) |
| Paddle Builders checkout (sandbox)     | ⬜ Workstream C (sandbox already wired, flag off)                                                                                                                                                                                                        |

Prereqs already satisfied in `.env`: `DISCOURSE_SSO_SECRET`, `JWT_SECRET`,
sandbox Paddle Builders price + discount ids, `RESEND_API_KEY`, `NGROK_AUTHTOKEN`,
`API_PUBLIC_URL=http://localhost:3000`, `FRONTEND_URL=http://localhost:4200`.

> [!NOTE]
> The landing page dev server (`nx serve ptah-landing-page`) also defaults to
> `:4200`. Don't run it at the same time as Discourse's ember-cli. Test checkout
> (Workstream C) and Discourse (Workstream A) in separate sessions, or move one
> to another port.

---

## Workstream A — Discourse SSO (local dev container) ✅ DONE & VERIFIED

Runs the official `discourse/discourse_dev` container inside the existing
**WSL2 Ubuntu-24.04** distro (source must live in the Linux filesystem — a
Discourse requirement). Rails is remapped to host **3001** so it coexists with the
license server on 3000. Everything below has been executed and verified by
`node scripts/discourse-e2e.mjs` (all round-trip + gating + admin-sync checks green).

All Ubuntu commands run as `root` in the distro: `wsl -d Ubuntu-24.04 -u root`.

### A0. Prerequisites (one-time)

- **Docker Desktop → Settings → Resources → WSL Integration** → enable
  **Ubuntu-24.04** → Apply & Restart. Verify: `wsl -d Ubuntu-24.04 -- docker ps`.

### A1. Clone into the Ubuntu filesystem + fix ownership

```bash
# inside Ubuntu-24.04 (root)
git clone --depth 1 https://github.com/discourse/discourse.git /root/discourse
# The dev container's `discourse` user is uid 1000; the source must be writable by
# it (we cloned as root/uid 0). Chown everything EXCEPT the postgres data dir:
chown 1000:1000 /root/discourse
find /root/discourse -mindepth 1 -maxdepth 1 ! -name data -exec chown -R 1000:1000 {} +
```

### A2. Remap the Rails port (avoid the :3000 clash) + boot

```bash
cd /root/discourse
sed -i 's/:3000:3000/:3001:3000/' d/boot_dev   # host 3001 → container 3000
./d/boot_dev                                    # pull image + start container
```

> [!NOTE]
> `d/boot_dev` tries `d/bundle install` via `docker exec -it` (a TTY), which fails
> in a non-interactive/detached shell. Gems are already baked into the image, so
> that failure is harmless — but **pnpm deps are NOT baked** and must be installed
> explicitly (next step), or `db:migrate` aborts at `assets:precompile`.

### A3. Install JS deps, create + migrate the DB

Helper — run any container command as the `discourse` user via a **login shell**
(tools like `bundle`/`pnpm`/`rails` are only on the login `PATH`):

```bash
DX(){ docker exec -i -u discourse:discourse -w /src discourse_dev bash -lc "$*"; }
DX pnpm install                      # ~1 min; populates node_modules/.pnpm
DX 'bin/rails db:create'
DX 'bin/rails db:migrate'            # loads the full schema (~349 tables) + seeds
```

### A4. Configure Discourse (SSO + group + category + API key)

Non-interactive via `rails runner` — **setting order matters** (`discourse_connect_url`
before `enable_discourse_connect`; `email_editable=false` before `auth_overrides_email`).
Write `/root/discourse/local-setup.rb`:

```ruby
SECRET = "<DISCOURSE_SSO_SECRET from .env>"
SiteSetting.discourse_connect_url = "http://localhost:3000/api/v1/sso/discourse"
SiteSetting.discourse_connect_secret = SECRET
SiteSetting.enable_discourse_connect = true
SiteSetting.email_editable = false
SiteSetting.auth_overrides_email = true
SiteSetting.enable_local_logins = false

g = Group.find_by(name: "builders") || Group.create!(name: "builders")
g.visibility_level = Group.visibility_levels[:members]; g.save!

cat = Category.find_by(slug: "builders-lounge") ||
      Category.create!(name: "Builders Lounge", slug: "builders-lounge", user_id: Discourse.system_user.id)
cat.set_permissions("builders" => :full); cat.save!   # removes "everyone"

ApiKey.where(description: "ptah-license-server group sync").destroy_all
ak = ApiKey.new(description: "ptah-license-server group sync", created_by_id: Discourse.system_user.id)
ak.save!
puts "API_KEY=#{ak.key}"
```

```bash
DX 'bin/rails runner local-setup.rb'   # prints API_KEY=... — copy it
```

### A5. Start the Rails server (persistent, detached)

`RAILS_DEVELOPMENT_HOSTS=host.docker.internal` lets the license-server **container**
reach Discourse for admin group-sync (see networking note below). Started via
`docker exec -d`, so it does NOT auto-restart with the container — re-run after a
reboot / `./launcher`-style restart.

```bash
docker exec -d -u discourse:discourse -w /src \
  -e RAILS_DEVELOPMENT_HOSTS=host.docker.internal \
  discourse_dev bash -lc "bin/rails server -b 0.0.0.0 -p 3000 > /src/log/railss.log 2>&1"
# health: curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/srv/status  → 200
```

### A6. Wire `.env` + recreate the license server

```bash
DISCOURSE_URL=http://localhost:3001         # browser + Ubuntu curl reach Discourse here
DISCOURSE_API_KEY=<API_KEY from A4>
DISCOURSE_API_USERNAME=system
```

```bash
docker compose up -d --force-recreate license-server   # NOT `restart` — restart does
                                                        # not reload .env changes
```

### A7. Verify (automated, deterministic)

```bash
node scripts/discourse-sso-smoke.mjs   # endpoint crypto/redirect/reject
node scripts/discourse-e2e.mjs         # full round-trip vs real Discourse:
#   1. Builder subscriber  → SSO → auto-added to `builders`
#   2. Community user      → SSO → excluded from `builders`
#   3. Admin group-sync    → PUT/DELETE /groups/{id}/members (Paddle fan-out contract)
#   4. Config              → SSO-only enforced
```

Manual browser round-trip (optional): log into the landing page so the `ptah_auth`
cookie is set, then hit `http://localhost:3001` → **Log In** → you land back on the
forum already authenticated (no Discourse password prompt).

> [!IMPORTANT]
> **Local networking (localhost vs host.docker.internal).** The browser/curl reach
> Discourse at `localhost:3001`; the license-server _container_ cannot use
> `localhost` (that's the container itself) — it reaches Discourse at
> `host.docker.internal:3001` (allowed via `RAILS_DEVELOPMENT_HOSTS`). We keep
> `DISCOURSE_URL=localhost:3001` because the browser SSO redirect must resolve, and
> the container-side admin-sync **contract is verified** by `discourse-e2e.mjs`
> Phase 3 (and the container's reachability was confirmed directly). **In prod this
> split disappears** — `DISCOURSE_URL=https://community.ptah.live` is one public
> host reachable by both the browser and the container.

---

## Workstream B — Google Calendar / Meet (local = prod, ~15 min)

The license server reads the weekly Builders session from **your** Google
Calendar and adds/removes members as attendees on the recurring event. The OAuth
client + refresh token are **the same in dev and prod** — do this once and reuse
the five values in `.env.prod` later. It's the one workstream only you can do
(it clicks through your Google account), so knock it out while Discourse builds.

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

Sandbox product, prices, and the FOUNDING35/50 discounts are already in `.env`
and the landing page (`environment.ts` points its checkout at the sandbox price
ids). Checkout is guard-blocked by a flag; flip it locally to test:

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

| Local                                           | Production                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| Discourse dev container (`d/boot_dev`)          | `discourse_docker` on a DO droplet (`discourse-digitalocean.md` §1–6) |
| `DISCOURSE_URL=http://community.localhost:4200` | `https://community.ptah.live` + DNS A record + Resend SMTP            |
| Paddle **sandbox** ids                          | Paddle **live** product/prices/discounts (checklist §2.1)             |
| `.env` (dev secrets)                            | `.env.prod` (add the Discourse block — see runbook §4)                |
| local Postgres (migrated)                       | `prisma migrate deploy` against the prod DB (checklist §2.4)          |
| Google OAuth (same client)                      | **reuse the same client/token**                                       |
| `BUILDERS_CHECKOUT_ENABLED=false`               | flip to `true` at launch (checklist §2.5)                             |

Is it hard? No — the code is done and you've already proven the wiring locally.
Prod is provisioning a droplet, one DNS record, mirroring the Paddle product, and
copying env values. The launch flip (checklist §2.5) is the only "all at once"
moment.
