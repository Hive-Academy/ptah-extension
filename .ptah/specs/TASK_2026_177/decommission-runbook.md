# Decommission runbook — `community.ptah.live`

**Task**: TASK_2026_177, Batch 5 (P1b).
**Status**: ✅ **EXECUTED 2026-08-04**. See §5 for the log. Kept as the record of what was done and why.
**Written**: 2026-08-04, before any production action, per the batch brief.

---

## 0. What this covers, and what it does not

This runbook retires the **production** self-hosted forum at
`community.ptah.live`. The repository half of the removal is already done and is
NOT repeated here — the code, routes, env vars, theme app, deploy workflow and
Caddy vhost are gone from the working tree.

**Out of scope, deliberately:** the operator's **local** `discourse_dev`
container in WSL and its volumes. It still holds the 17 topics / 19 posts /
4 categories that Batch 8 seeds the native forum from. **Do not stop it, do not
delete it, do not remove its volume.** Only the compose _wiring_ that pointed at
it was removed (`extra_hosts`, the four `discourse-dev-*.sh` helpers, the
`npm run docker:up` chaining). The container itself is untouched and stays that
way until Batch 8 has verified the seed against it.

### The one hard ordering constraint

> **DNS FIRST, THEN THE CADDYFILE DEPLOY.**

Caddy provisions certificates on demand for the names in its config, and it
retries. If `community.ptah.live` still has an `A` record pointing at the droplet
after the vhost is removed, inbound requests for that host hit a Caddy with no
matching site block, and any renewal still queued for the name fails repeatedly
and floods the container log with ACME errors. Removing the DNS record first
makes the name simply stop resolving, which is the clean end state.

Step 4 (DNS) must therefore complete **before or in the same maintenance window
as** step 6 (deploying the Caddyfile change). Steps 1–3 are safe in any order
relative to DNS.

---

## 1. Facts established before writing this

| Fact                                                                   | Evidence                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Production forum is **empty**                                          | `context.md` "Standing decision", recorded before the task started                                       |
| The real content is **local only** — 17 topics, 19 posts, 4 categories | `context.md`; every topic is a single seed post                                                          |
| Content is already **exported and committed**                          | `docs/community/discourse-export.json`, commit `6614f9e92`                                               |
| The container is **not defined in this repository**                    | It is a `discourse_docker` install at `/var/discourse/containers/app.yml` on a DigitalOcean droplet      |
| It joins the app network via `docker_args`                             | Which is why `caddy/Caddyfile` proxied to it as bare hostname `app:80` rather than to a published port   |
| Its `127.0.0.1:8081` host binding was a debug convenience only         | Recorded in the Caddyfile comment now deleted                                                            |
| The prod network is `ptah_prod_network`                                | `docker-compose.prod.yml:139`                                                                            |
| Caddy certificates live in the `ptah_caddy_data` volume                | `docker-compose.prod.yml:129`; **this volume must survive** — it holds `api.ptah.live`'s certificate too |

---

## 2. Credentials to revoke — do this even though the service is going away

Unsetting an environment variable stops **this server** using a key. It does not
stop anyone else who has the value. Both of the following were live in
`.env.prod` and are now removed from it; **removal is not revocation.**

| Secret                    | Where it was                                                                                                  | What to do                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCOURSE_API_KEY`       | `.env.prod`, minted 2026-08-03 on the prod forum, description "ptah-license-server group sync", user `system` | Revoke in the forum admin **before** destroying the container (step 3) — after that the admin UI is gone and the key can only be invalidated by destroying its store. If the container is already gone when you read this, the key dies with the database; record that outcome rather than assuming it. |
| `DISCOURSE_SSO_SECRET`    | `.env.prod`; the SAME value was also in dev `.env`                                                            | An HMAC shared secret with no third party left to present it — the endpoint that verified it (`GET /api/v1/sso/discourse`) is deleted. No revocation action exists. Treat the value as burned: never reuse it for anything.                                                                             |
| `DISCOURSE_THEME_API_KEY` | dev `.env` only, scoped to the LOCAL container                                                                | No production action. Dies with the local container whenever the operator retires it.                                                                                                                                                                                                                   |

There is also a **Resend SMTP** relay configured inside the forum (user
`resend`, password = `RESEND_API_KEY`). That is the _shared_ Ptah key, still used
by the license server — **do not rotate it as part of this decommission** unless
you intend to rotate it everywhere.

---

## 3. Procedure

Each step is written so it can be verified before the next one starts. Every
destructive step is marked ⚠️ and **requires explicit confirmation from the user
for that specific step** — a blanket "go ahead" earlier does not authorise a
later one.

### Step 1 — Snapshot the droplet (NON-destructive, do this first)

DigitalOcean → Droplets → the droplet → **Snapshots** → _Take Snapshot_.

The droplet also runs the **license server, Postgres and Caddy**. This snapshot
is the rollback for every step that follows, and it is the reason the later steps
can be taken without hesitation. Note the snapshot name and time here when taken.

> Snapshotting a running droplet is supported but DigitalOcean recommends
> powering off for a consistent image. **Do not power off** — that takes the API
> down. A live snapshot is sufficient here because nothing being deleted holds
> data we want.

### Step 2 — Confirm there is nothing to lose (NON-destructive)

On the droplet:

```bash
cd /var/discourse
./launcher enter app
# inside the container:
rails runner 'puts "topics=#{Topic.count} posts=#{Post.count} users=#{User.count}"'
exit
```

Expect topic/post counts at or near zero, consistent with `context.md`'s finding
that production is empty. **If this shows real content, STOP** — it was never
exported, and `docs/community/discourse-export.json` came from the local
container, not this one. Export before continuing.

### Step 3 — ⚠️ Stop and destroy the forum container

Revoke the admin API key first (§2) while the admin UI still exists.

```bash
cd /var/discourse
./launcher stop app          # verify the site is down, and that api.ptah.live still answers
./launcher destroy app       # removes the container; /var/discourse and data remain
```

Between `stop` and `destroy`, confirm the rest of the stack is unaffected:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.ptah.live/api/health   # expect 200
docker ps                                                                   # ptah_caddy, ptah_license_server, postgres still up
```

`launcher destroy` removes the container only. The forum's Postgres/Redis data
lives under `/var/discourse/shared/` and survives until step 5.

### Step 4 — ⚠️ Delete the DNS record (BEFORE step 6)

DigitalOcean → Networking → Domains → `ptah.live` → delete the `A` record for
`community`.

Verify:

```bash
dig +short community.ptah.live      # expect: empty
```

Allow for the record's TTL before treating a stale answer as a failure.

⚠️ Delete **only** the `community` record. `ptah.live`, `www`, `api` and `docs`
are live services on the same zone.

### Step 5 — ⚠️ Reclaim disk

Only after step 3 is confirmed and you are satisfied nothing needs recovering.

```bash
du -sh /var/discourse            # measure before
rm -rf /var/discourse            # removes the install, its config AND shared/ data
docker image prune -a            # reclaims the discourse base images
docker volume ls                 # inspect BEFORE pruning
```

⚠️ **Do NOT run `docker volume prune`.** `ptah_caddy_data` holds the Let's
Encrypt certificate for `api.ptah.live`; losing it forces re-issuance against
Let's Encrypt rate limits. Postgres volumes on the same host hold live customer
data. Remove forum volumes **by name only**, after listing and identifying them.

### Step 6 — Deploy the Caddyfile without the vhost

This is the repository change already made in Batch 5. It reaches production
through the normal server deploy. **Only after step 4 is confirmed.**

Verify afterwards:

```bash
docker exec ptah_caddy caddy validate --config /etc/caddy/Caddyfile
docker logs ptah_caddy --tail 100        # expect: no ACME errors for community.ptah.live
curl -s -o /dev/null -w '%{http_code}\n' https://api.ptah.live/api/health   # expect 200
```

### Step 7 — Consider the droplet size

`founder-setup-checklist.md` recommended a dedicated `s-1vcpu-2gb` for the forum
and noted the current droplet is 1GB. With the forum gone the memory pressure it
created is gone too. **No action required**, and resizing is explicitly NOT part
of this decommission — recorded only so the sizing note is not later read as an
outstanding to-do.

---

## 4. Rollback

There is no partial rollback and none is needed: the application code that
integrated with this forum no longer exists, so a restored forum would be an
orphan with nothing pointing at it.

If the droplet itself is damaged by steps 3–5, restore the step-1 snapshot. That
recovers the license server, Postgres and Caddy along with everything else. It
would also resurrect the forum, which is harmless — it would simply be
unreachable, since DNS and the vhost are gone.

---

## 5. Execution log

Fill in as steps are performed. An unticked box means NOT DONE — do not infer
completion from a later box being ticked.

| #   | Step                               | Destructive | Confirmed    | Done   | Notes / evidence                                                                                                                                                                                                                        |
| --- | ---------------------------------- | ----------- | ------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Droplet snapshot                   | no          | **DECLINED** | ⬜     | User chose to skip. Recorded so nobody later assumes a rollback point exists — **there is none**.                                                                                                                                       |
| 2   | Content count check                | no          | —            | ✅     | `topics=7 posts=8 users=3 categories=5 uploads=16`. See the ⚠️ finding below.                                                                                                                                                           |
| 3   | Revoke API keys                    | ⚠️          | ✅           | ✅     | **TWO** keys, both live and unrevoked: id=1 `ptah-license-server group sync`, id=2 `ptah-theme-deploy`. Both revoked 14:36:43 UTC.                                                                                                      |
| 4   | `launcher stop app`                | ⚠️          | ✅           | ✅     | Verified after: api 200, ptah.live 200, docs 200, community 502. Clean separation.                                                                                                                                                      |
| 5   | `launcher destroy app`             | ⚠️          | ✅           | ✅     | Container removed. Three survivors up: license server, postgres, caddy.                                                                                                                                                                 |
| 6   | Delete `community` DNS A record    | ⚠️          | ✅           | ✅     | Deleted via dashboard, confirmation dialog matched `A / community.ptah.live / 167.71.9.106`. Authoritative NS returns **NXDOMAIN**. All sibling records verified present after.                                                         |
| 7   | `rm -rf /var/discourse` + images   | ⚠️          | ✅           | ✅     | **6.1 GB reclaimed**: 14G→7.9G, 28%→17%. Removed `local_discourse/app:latest` (5.55GB) and `discourse/base:2.0.20260726-0220` (4.93GB).                                                                                                 |
| 8   | Volumes removed by name            | ⚠️          | —            | ➖ N/A | **No Discourse volumes existed.** `discourse_docker` bind-mounts `/var/discourse/shared`; it never created named volumes. Only `ptah_caddy_config`, `ptah_caddy_data`, `ptah_postgres_prod_data` are on the host — all three untouched. |
| 9   | Deploy Caddyfile without the vhost | no          | ✅           | ✅     | Done manually rather than waiting for a deploy — see below. `caddy validate` → `Valid configuration`, then `caddy reload`. `api.ptah.live` is now the only site block. Backup at `/opt/ptah-extension/caddy/Caddyfile.bak-task177`.     |

---

## 5b. Addendum — MG-5 close-out (Batch 8, Task 8.8, 2026-08-05)

Written by `backend-developer` during Batch 8. **No infrastructure command was run
from this batch** (PRE-7): everything below is a record of work already performed
by Batch 5 and by the user, plus two decisions that had no home in §5.

### Correction to the Batch 8 brief

`tasks.md` Task 8.8 states that "the runbook was written and left unexecuted by
Batch 5". **That is wrong** — §5's log is complete, all nine steps are ticked or
explicitly marked `DECLINED`/`N/A`, and §6 records three findings from the run.
Batch 8 therefore had nothing to backfill. What §5 genuinely did not cover is the
local container and MG-5.2, which is what this addendum adds.

### The local `discourse_dev` container

| Item                     | State                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §0 said                  | "Do not stop it, do not delete it… until Batch 8 has verified the seed against it."                                                                                                                                                          |
| Reality                  | **Deleted by the user** before Batch 8 ran.                                                                                                                                                                                                  |
| Consequence              | None. §0's instruction was written on the assumption that the container was a verification source. It never was: MG-1.1 requires the importer to read **only** `docs/community/discourse-export.json`, and it does.                          |
| Verification substituted | The seeded database is compared against the export **file**, byte for byte (SHA-256 per body, `community-seed.spec.ts` + a `psql`/`node` hash diff). That is reproducible, runs in CI, and does not depend on a service anyone can turn off. |

**§0's "out of scope, do not delete" block is now historical.** It is left in place
rather than edited, because rewriting a runbook's premise after the fact is how a
record stops being a record.

### MG-5.2 — the `301` from `community.ptah.live`: **DECISION (b), NOT APPLICABLE**

MG-5.2 asked for a `301` redirect from `community.ptah.live` to the member
community surface. It cannot be executed as written and is now closed.

- **There is nothing to redirect from.** The `A` record was deleted in §5 step 6
  and the authoritative nameservers return `NXDOMAIN`. A redirect needs a
  resolving host and a listening server; neither exists.
- **There is no link equity to preserve.** §6.1 establishes that production held
  7 topics and 8 posts, **all** of them Discourse's own seed content authored by
  `system`, and **zero human-authored posts**. A forum with no human posts had no
  audience, no inbound links worth preserving and nothing indexed that a member
  would search for.
- **Option (a) — re-create the DNS record and serve the redirect — is available
  and was not taken.** It costs one DNS record plus one Caddy redirect rule. It
  becomes the right call only if someone knows of a _published_ external link to
  the old forum. Nobody has produced one.

**Recorded outcome: option (b). Accept `NXDOMAIN`.** MG-5.2 is closed as _not
applicable_, not silently dropped. If a published link surfaces later, option (a)
is a ten-minute change and this paragraph is the pointer to it.

### MG-5.3's gate is moot

MG-5.3 said the decommission must happen "never before MG-1 is verified in
production". The thing that gate protected was **authored content living only
inside a forum**. That content has been on disk and in git since `6614f9e92`
(corrected by `a22b03eb6`), so it was never at risk from the teardown — and the
forum the gate protected against no longer exists to gate on. The ordering
requirement is retired; it is not being waived.

### 🔴 Still open — one action for the user

**Check the GitHub repository secrets for a leftover `ptah-theme-deploy` or other
`DISCOURSE_*` secret and delete it.**
`Settings → Secrets and variables → Actions` (check the _Dependabot_ and
_Environments_ tabs too — a secret scoped to an environment does not appear in the
repository list).

This is §6.2 restated, still unresolved. The key itself was revoked server-side on
2026-08-04 and the service it authenticated against is destroyed, so this is
hygiene rather than live exposure — but a credential that outlives its service is
exactly what gets reused. **An agent cannot read repository secrets and did not
try.**

---

## 6. What the execution found that the plan did not

### ⚠️ 1. Production was NOT empty — but the conclusion still holds

`context.md` asserts _"community.ptah.live (production) is **empty**"_. It was not: 7 topics,
8 posts, 3 users, 5 categories, 16 uploads.

**Every one was Discourse's own seed content**, created 2026-08-02 (the day it was stood
up), all authored by `system`:

```
[1] About the Site Feedback category      [5] Welcome to Ptah Community! 👋
[2] About the Staff category              [6] Admin Guide: Getting Started
[3] About the General category            [7] About the Builders Lounge category
[4] Guidelines
```

Users were `discobot` (bot), `system` (bot) and `abdallah-khalil` (admin, **0 posts**).
So there was **zero human-authored content** and nothing to export — "empty" was true in
substance and imprecise in wording. **Step 2's guard did its job**: had these been real
topics, the procedure would have stopped here.

### ⚠️ 2. There was a SECOND API key nobody had recorded

`.env.prod` carried only `DISCOURSE_API_KEY`. The server held **two**: id=2
`ptah-theme-deploy` as well. It was presumably supplied to the deleted
`deploy-community-theme.yml` workflow from a GitHub Actions secret, which is why it never
appeared in any env file.

🔴 **CARRIED FORWARD — check GitHub repo secrets** for a leftover theme-deploy secret (and
any `DISCOURSE_*` secret) and delete it. The key itself is revoked and its server is gone,
so this is hygiene rather than exposure, but a secret that outlives its service is exactly
the kind of thing that gets reused.

### ⚠️ 3. Step 9 was done by hand, deliberately

The runbook assumed the Caddyfile reached production "through the normal server deploy".
Waiting would have left Caddy holding a `community.ptah.live` certificate and a site block
pointing at a destroyed container — it would have kept attempting renewal for a name that
no longer resolves, which is the exact failure the DNS-first ordering exists to prevent.

The deployed file was diffed against the committed one first: **the only difference was the
block being removed**, `api.ptah.live` byte-identical. Backup taken, `caddy validate` run
before `caddy reload` (Caddy retains the running config if validation fails). The next
deploy writes the same content, so this is consistent, not a divergence.

### Residual, harmless

`ptah_caddy_data` still contains `community.ptah.live.crt`. It is inert — no site block
references it and the name does not resolve — and it was left alone **on purpose**: that
volume also holds `api.ptah.live.crt`, and Let's Encrypt rate-limits re-issuance. Do not go
digging in it to tidy up one dead file.

### Final state, verified

```
api.ptah.live/api/health  -> 200
ptah.live                 -> 200
docs.ptah.live            -> 200
community.ptah.live       -> NXDOMAIN (authoritative)
containers: ptah_license_server_prod (healthy), ptah_postgres_prod (healthy), ptah_caddy
disk: 7.9G / 48G used (17%)
```
