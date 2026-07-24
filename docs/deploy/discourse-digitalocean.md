# Discourse-on-DigitalOcean Deployment Runbook

Deploys Discourse at `community.ptah.live` for the paid Builders forum, wired to the
license server (`api.ptah.live`) as its DiscourseConnect SSO provider. The SSO
endpoint and admin group-sync client already exist in code — see
`apps/ptah-license-server/src/discourse/` (`DiscourseController`,
`DiscourseSsoService`, `DiscourseAdminProvider`, `DiscourseProvisioningService`).
This runbook covers the Discourse-side install only.

Reference (read-only, not modified by this runbook): `docker-compose.prod.yml`,
`caddy/Caddyfile`, `.env.prod.example` — the existing `api.ptah.live` stack.

---

## 1. Droplet Sizing

Discourse's official `discourse_docker` install requires:

- **2 GB RAM minimum**, **4 GB recommended**
- On a 2 GB droplet, **1 GB swap is mandatory** (`./discourse-setup` will warn/fail without it)

### Check current droplet headroom

The existing `api.ptah.live` droplet runs Postgres + license-server + Caddy. Per
`docs/deployment/DIGITALOCEAN.md` the budget config is a **1 GB droplet** — that
has no headroom for Discourse. Verify before deciding:

```bash
ssh root@YOUR_DROPLET_IP
free -h                                   # total/used/available RAM
docker stats --no-stream                  # per-container RSS (postgres/license-server/caddy)
df -h /                                   # disk headroom (Discourse image + DB ≈ 3-5 GB)
```

Decision rule:

- Droplet is **≥ 4 GB** with **≥ 2 GB available** after `docker stats` overhead → co-locate Discourse on the existing droplet (separate `discourse_docker` install, own containers, does not touch `docker-compose.prod.yml`).
- Droplet is **1-2 GB** (the documented default) → **provision a dedicated droplet**. Discourse's own installer manages its own Docker containers and is not designed to share a compose stack with unrelated services.

### Dedicated droplet (recommended path)

```bash
doctl compute droplet create ptah-community \
  --region nyc1 \
  --size s-1vcpu-2gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | head -1)
```

- `s-1vcpu-2gb` ($12/mo) meets the minimum; `s-2vcpu-4gb` ($24/mo) is recommended if
  budget allows and traffic is expected to grow. Start at $12/mo and resize later
  (`doctl compute droplet-action resize`) if `free -h` shows sustained pressure.

### Swap setup (2 GB droplet)

```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p
free -h   # confirm 1.0G swap
```

---

## 2. Install Discourse (official `discourse_docker`)

On the target droplet (dedicated or the existing one, per the Section 1 decision):

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y git docker-compose-plugin

mkdir -p /var/discourse
git clone https://github.com/discourse/discourse_docker.git /var/discourse
cd /var/discourse
chmod 700 containers

./discourse-setup
```

`discourse-setup` prompts interactively for:

| Prompt             | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| Hostname           | `community.ptah.live`                                        |
| Developer emails   | your admin email(s)                                          |
| SMTP address       | `smtp.resend.com`                                            |
| SMTP port          | `465`                                                        |
| SMTP username      | `resend`                                                     |
| SMTP password      | the license server's `RESEND_API_KEY` value                  |
| Notification email | `notifications@ptah.live` (or `FROM_EMAIL` from `.env.prod`) |

**SMTP note**: the license server sends transactional email via the Resend HTTP API
(`RESEND_API_KEY` in `.env.prod`, consumed by
`apps/ptah-license-server/src/email/services/email.service.ts`), not SMTP. Discourse
only supports SMTP, so reuse the **same Resend account** through its SMTP relay
(`smtp.resend.com:465`, username `resend`, password = the Resend API key). Do not
provision a second email provider — this keeps sender reputation and domain
verification (`ptah.live`) consolidated under one account.

### DNS

In DigitalOcean **Networking > Domains** (same zone that already holds the `api` A
record):

```
A    community    <droplet-public-ip>    (dedicated droplet)
```

or, if co-located on the existing droplet, point `community` at the same IP as `api`.

```bash
dig A community.ptah.live   # confirm propagation before running discourse-setup
```

---

## 3. Reverse Proxy Decision

**Option A — Discourse's bundled nginx + Let's Encrypt (recommended, dedicated droplet)**

`discourse-setup` on its own droplet already provisions nginx + certbot inside the
`app` container, bound to ports 80/443 of that droplet. No extra config needed —
this is the simpler path and the one to use when Section 1 concludes a dedicated
droplet.

```bash
cd /var/discourse
./launcher rebuild app     # builds + starts, obtains cert automatically
```

**Option B — Behind the existing Caddy (only if co-locating on the `api.ptah.live` droplet)**

Discourse's container must not bind host ports 80/443 (Caddy already owns those).
In `/var/discourse/containers/app.yml`, remap the `templates/web.template.yml`
expose ports so Discourse listens internally only, e.g. `127.0.0.1:8081:80`, then
add a block to `caddy/Caddyfile` for a human to apply (**do not run this from this
runbook — hand it to whoever owns `caddy/Caddyfile`**):

```caddyfile
community.ptah.live {
    request_body {
        max_size 20MB
    }

    reverse_proxy 127.0.0.1:8081 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    encode gzip

    log {
        output stdout
        format console
    }
}
```

After adding the block, `docker compose -f docker-compose.prod.yml restart caddy`
(Caddy auto-obtains the cert for the new domain on restart, same ACME flow as
`api.ptah.live`).

Recommendation: **use Option A** (standalone droplet with bundled nginx). It avoids
port-remapping Discourse's launcher templates (a common source of upgrade breakage)
and keeps the `api.ptah.live` stack's resource envelope (currently sized for 1 GB)
untouched.

---

## 4. DiscourseConnect (SSO) Wiring

The license server is already the SSO provider — endpoint
`GET https://api.ptah.live/api/v1/sso/discourse`
(`apps/ptah-license-server/src/discourse/discourse.controller.ts`), signing with
`DISCOURSE_SSO_SECRET` (`apps/ptah-license-server/src/discourse/discourse-sso.service.ts`).

### Generate the shared secret

```bash
openssl rand -hex 32
```

### Add to the license server's `.env.prod`

`.env.prod.example` does not yet list Discourse vars — add this block manually
(the license server code already reads them via `ConfigService`):

```bash
# =============================================================================
# DISCOURSE (Builders community SSO + admin group sync)
# =============================================================================
DISCOURSE_URL=https://community.ptah.live
DISCOURSE_SSO_SECRET=<same value entered in Discourse admin below>
DISCOURSE_API_KEY=<from Section 5>
DISCOURSE_API_USERNAME=system
DISCOURSE_BUILDERS_GROUP=builders
```

Then on the license server host:

```bash
nano .env.prod         # paste the block above with real values
chmod 600 .env.prod
docker compose -f docker-compose.prod.yml up -d license-server   # picks up new env
```

### Configure Discourse admin settings

`community.ptah.live/admin/site_settings/category/login`:

| Setting                             | Value                                                      |
| ----------------------------------- | ---------------------------------------------------------- |
| `enable discourse connect`          | ✅ true                                                    |
| `discourse connect url`             | `https://api.ptah.live/api/v1/sso/discourse`               |
| `discourse connect secret`          | the `DISCOURSE_SSO_SECRET` value generated above           |
| `enable local logins`               | ❌ false (SSO-only; prevents bypassing entitlement gating) |
| `discourse connect overrides email` | ✅ true                                                    |

### Create the `builders` group + gated category

```
Admin > Groups > New Group
  Name: builders
  Visibility: Owners and members
  Membership: (leave manual — SSO add_groups/remove_groups manages it)
```

```
Admin > Categories > New Category (e.g. "Builders Lounge")
  Security tab:
    Remove "everyone"
    Add group "builders" with See/Reply/Create permission
```

`DiscourseSsoService.buildResponse` asserts `add_groups=builders` for active
Builders members and `remove_groups=builders` otherwise on every SSO login — so a
lapsed subscription is pulled out of the group (and loses category access) on next
visit, not just at webhook time.

---

## 5. Admin API Key (for license-server group sync)

`DiscourseAdminProvider` (`apps/ptah-license-server/src/discourse/discourse-admin.provider.ts`)
uses this key to add/remove `builders` membership from the Paddle webhook fan-out
(`PaddleService.fanOutBuildersProvisioning` / deprovisioning), independent of the
SSO-time assertion — it covers users who already have a Discourse account but
haven't logged back in since their subscription changed.

```
Admin > API > New API Key
  Description: ptah-license-server group sync
  User Level: Single User
  User: system  (or a dedicated service account — do not use a personal admin account)
  Scope: Granular
    - Groups: Add/Remove members
    - Users: Show, List (for the by-external-id / email lookup)
```

Copy the generated key into `.env.prod` as `DISCOURSE_API_KEY`, and the chosen
username as `DISCOURSE_API_USERNAME` (matches the block in Section 4).

`DiscourseAdminProvider.isEnabled()` is `false` until `DISCOURSE_URL`,
`DISCOURSE_API_KEY`, and `DISCOURSE_API_USERNAME` are all set — until then the
integration silently no-ops (logged once), so it's safe to deploy the SSO piece
first and the admin sync piece second.

---

## 6. Backups, Upgrades, Smoke Test

### Backups (DO Spaces)

```
Admin > Backups > Backup Settings
  enable backups: true
  backup location: S3
  s3 backup bucket: <your-space-name>
  s3 endpoint: https://<region>.digitaloceanspaces.com
  s3 access key id / secret access key: <Spaces access keys>
  s3 region: <region, e.g. nyc3>
  backup frequency: 1 (daily)
  maximum backups: 14
```

Trigger a manual backup once to confirm the Spaces bucket receives it:
`Admin > Backups > Backup`.

### Upgrade cadence

```bash
cd /var/discourse
git pull
./launcher rebuild app
```

Run monthly, or immediately for security advisories (watch
`https://github.com/discourse/discourse/releases`). `./launcher rebuild app` is
zero-downtime-ish (brief restart) — schedule off-peak.

### Smoke-test checklist

- [ ] `curl -I https://community.ptah.live` → `200`/`301`, valid cert
- [ ] SSO round-trip: log into `ptah.live`, click "Community" link, land on
      `community.ptah.live` already authenticated (no separate Discourse login
      prompt)
- [ ] A Builders-tier account is auto-added to the `builders` group on first SSO
      login and can see/post in the gated category
- [ ] A non-Builders (community-tier) account is denied local login (SSO-only) and,
      if previously a member, is auto-removed from `builders` on next SSO login
- [ ] Paddle subscription cancel → webhook fires → `DiscourseProvisioningService`
      audit log entry (`discourse.group.sync`, `ok:true`) shows the group removal,
      independent of the user logging back in
- [ ] Test email (new-user notification or password-reset-style email from
      Discourse) delivers via the Resend SMTP relay
- [ ] `./launcher rebuild app` completes cleanly and the site comes back up

---

## 7. Google Calendar + Meet Setup (Builders live sessions)

The license server reads the Builders session schedule from Google Calendar and
adds/removes members as attendees on the recurring session event. One-time
setup on the founder's Google account (~15 minutes).

> [!IMPORTANT]
> Since 2024 the OAuth consent screen lives under **APIs & Services → Google
> Auth Platform** in the Cloud Console (tabs: Branding / Audience / Clients) —
> not the old "OAuth consent screen" menu older guides reference.

### 7.1 Create the OAuth client

1. https://console.cloud.google.com → create/select a project (e.g. `ptah-community`).
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → Google Auth Platform → Branding**: app name `Ptah Sessions`,
   support email = founder account.
4. **Audience** tab — this choice matters:
   - **Internal** (available because the account is on Google Workspace) —
     RECOMMENDED. No verification, no test-user list, and refresh tokens never
     hit the testing-mode cap.
   - If Internal is unavailable, choose **External** and then **PUBLISH the app
     to Production** (Audience → "Publish app"). Do NOT leave it in Testing:
     **Testing-mode refresh tokens are hard-capped at 7 days** and the calendar
     integration would silently die weekly. The "unverified app" warning on the
     consent screen is irrelevant — the founder is the only user who ever
     consents.
5. **Clients** tab → Create client → type **Web application** → add
   `https://developers.google.com/oauthplayground` under **Authorized redirect
   URIs** → copy the **Client ID** and **Client Secret**.

### 7.2 Mint the refresh token (OAuth Playground)

1. https://developers.google.com/oauthplayground → gear icon (top right) →
   check **Use your own OAuth credentials** → paste Client ID + Secret.
2. Step 1: enter scope `https://www.googleapis.com/auth/calendar` → **Authorize
   APIs** → sign in with the founder account → allow.
3. Step 2: **Exchange authorization code for tokens** → copy the
   **Refresh token** (the playground requests `access_type=offline` +
   `prompt=consent` automatically, so a refresh token is always issued).
4. Env values (`.env` locally, `.env.prod` in production):

```
GOOGLE_OAUTH_CLIENT_ID=<client id>
GOOGLE_OAUTH_CLIENT_SECRET=<client secret>
GOOGLE_OAUTH_REFRESH_TOKEN=<refresh token>
GOOGLE_CALENDAR_ID=primary
```

> [!NOTE]
> Google expires refresh tokens after **6 months of non-use**, but the license
> server refreshes on every sessions read/write, so normal operation keeps it
> alive indefinitely. If it is ever revoked (password reset, manual revoke at
> https://myaccount.google.com/permissions), repeat step 7.2 only.

### 7.3 Create the recurring session event

1. In Google Calendar (founder account), create the weekly Builders session:
   e.g. "Ptah Builders — Weekly Live Session", weekly recurrence, and **Add
   Google Meet video conferencing** (the Meet link is what members see on
   `/members`).
2. Get the event id: open the event → the browser URL contains
   `eid=<base64>`; decode it (`echo '<eid>' | base64 -d` → `eventId calendarId`)
   or list it via the API:

```bash
curl -s -H "Authorization: Bearer <access token from playground>" \
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?q=Builders" \
  | grep '"id"'
```

3. Set the **master** (non-instance) id:

```
BUILDERS_SESSION_EVENT_ID=<event id>
```

Leave blank to keep the `/members` schedule working without automatic
attendee management.

4. Recording: with the Google Workspace plan, start recording from inside Meet
   at session time (Activities → Recording). Recordings land in the founder's
   Drive → link them in the members' area / course repo afterwards.

### 7.4 Smoke test

- [ ] `GET /api/v1/members/sessions` as a Builders account returns the weekly
      event with a `meetLink`
- [ ] Issue a test Builders license (admin complimentary flow) → the member's
      email appears as an attendee on the calendar event (no invite email is
      sent — the server patches with `sendUpdates=none`)
- [ ] Cancel the test subscription → attendee removed, `sessions.attendee.remove`
      audit entry present

---

## 8. Full Setup Order (founder checklist)

1. Google Cloud OAuth client + refresh token (§7.1–7.2) — 15 min, no dependencies.
2. Recurring Meet event + `BUILDERS_SESSION_EVENT_ID` (§7.3).
3. DO droplet + DNS `community.ptah.live` (§1–2).
4. `./discourse-setup` with Resend SMTP (§2), admin account created.
5. DiscourseConnect + admin API key + `builders` group/category (§4–5).
6. All env values into `.env.prod` (`GOOGLE_*`, `BUILDERS_SESSION_EVENT_ID`,
   `DISCOURSE_*`, `API_PUBLIC_URL`) → deploy license server.
7. Backups to Spaces (§6), then run both smoke-test checklists (§6 + §7.4).
