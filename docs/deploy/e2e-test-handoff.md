# E2E Test Handoff — Landing Page & Builders Pack

Verify **every landing-page feature and the full Builders pack** works as expected —
locally first, against the real stack (license server + Discourse + Google Calendar +
Paddle sandbox). This is the foundation for automated e2e (Playwright) and, later,
marketing videos.

> [!IMPORTANT]
> **Current automated coverage = none for the landing page.** No `playwright.config`,
> no `ptah-landing-page-e2e` project, zero `*.spec.ts`. Every flow below is manual
> today. What _is_ automated lives in `scripts/` (SSO + sessions + Discourse round-trip)
> and covers the backend contracts, not the UI. Section 6 is the plan to close the gap.

Companion docs: `local-testing-setup.md` (stack bring-up), `founder-setup-checklist.md`
(flags/discounts), `discourse-digitalocean.md` (SSO internals).

---

## 1. Test environment — bring up the full stack

| Component                                              | How                                                                            | Reachable at            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------- |
| Postgres + license server + ngrok                      | `docker compose up -d` (add `--profile webhook-testing` for ngrok)             | `http://localhost:3000` |
| Discourse dev container (SSO + members community link) | `local-testing-setup.md` → Workstream A (WSL Ubuntu). Rails server: A5 command | `http://localhost:3001` |
| Google Calendar/Meet (members sessions)                | Already wired (`.env` `GOOGLE_OAUTH_*`)                                        | —                       |
| **Landing page**                                       | `nx serve ptah-landing-page`                                                   | `http://localhost:4200` |

The landing dev server proxies `/api` and `/webhooks` → `localhost:3000`
(`apps/ptah-landing-page/proxy.conf.json`), so the SPA and API are same-origin.

**Smoke the backend before UI testing** (all should be green):

```bash
node scripts/discourse-sso-smoke.mjs      # SSO endpoint crypto/redirect/reject
node scripts/google-sessions-smoke.mjs    # Google refresh-token → calendar read
node scripts/discourse-e2e.mjs            # full SSO round-trip + group gating + admin sync
```

> [!WARNING]
> `docker compose restart` does **not** reload `.env`. After changing any flag/secret,
> use `docker compose up -d --force-recreate license-server`.

### 1.1 The two Builders modes (flag matrix)

Most Builders behavior forks on **one flag set in two places** — keep them in sync:

| Mode                   | `environment.ts` `buildersCheckoutEnabled` | `.env` `BUILDERS_CHECKOUT_ENABLED` | Behavior                                                  |
| ---------------------- | ------------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| **Waitlist** (default) | `false`                                    | `false`                            | Every Builders CTA → `/#waitlist`; checkout guard-blocked |
| **Checkout**           | `true`                                     | `true`                             | Builders CTAs open Paddle sandbox checkout                |

- Flipping the **server** flag: edit `.env` → `docker compose up -d --force-recreate license-server`.
- Flipping the **client** flag: edit `apps/ptah-landing-page/src/environments/environment.ts` → restart `nx serve` (compile-time).
- The server exposes its flag via `GET /api/v1/licenses/me` `.checkoutEnabled` — the client trusts that at runtime for guard-blocking, but the CTA rendering uses the compile-time flag, so **both must match** to test a mode cleanly.

### 1.2 Fast auth for e2e (bypass WorkOS UI)

Auth is a WorkOS-backed HTTP-only `ptah_auth` JWT cookie (HS256, signed with `.env`
`JWT_SECRET`) + a `ptah_auth_hint` localStorage flag the SPA uses to decide whether to
probe `GET /api/auth/me`. For gated pages (`/profile`, `/members`) you don't need the
real login UI — mint a token and inject it (same technique as `scripts/discourse-e2e.mjs`):

1. Seed a user (+ subscription for a Builder) in Postgres — see the `seedUser()` helper
   in `scripts/discourse-e2e.mjs` (`INSERT INTO users …` / `INSERT INTO subscriptions …`).
2. Mint `ptah_auth` = HS256 JWT `{ sub:<userId>, email, tier, iat, exp }` with `JWT_SECRET`
   (see `mintJwt()` in that same script).
3. In Playwright: `context.addCookies([{ name:'ptah_auth', value:<jwt>, domain:'localhost', path:'/' }])`
   and `page.addInitScript(() => localStorage.setItem('ptah_auth_hint','1'))`.

Use the **real** WorkOS UI only when testing the auth flows themselves (Section 5).

> [!TIP]
> Consider adding `scripts/mint-ptah-jwt.mjs <email> [--builder]` (thin wrapper over the
> seed+mint helpers already in `discourse-e2e.mjs`) so manual testers and Playwright share
> one fixture path.

---

## 2. Builders Pack — Waitlist mode (checkout OFF) — **priority**

Preconditions: both flags `false` (default). Public unless noted.

### 2.1 Join the Builders waitlist

- **Route:** `/` (anchor `#waitlist`, also surfaced on `/pricing`, `/profile`) — no guard
- **Steps:** scroll to Builders section → click "Join the Waitlist" → enter email → submit
- **Backend:** `POST /api/v1/waitlist { email, source }` (throttle 5/min)
- **Expect:** idle→submitting→**joined** ("You're a founding member"). Duplicate email →
  **already_joined** message (200 vs 201 first join). Invalid email → server `@IsEmail`
  rejects (client regex is permissive). `source` tag reflects surface (landing/pricing/profile).
- **Edge:** >5 submits/min → 429; server `message` surfaced on error, else generic fallback.

### 2.2 Pricing page renders in waitlist mode

- **Route:** `/pricing` — no guard
- **Steps:** view Free-vs-Builders capability matrix
- **Expect:** Builders CTA is a **plain link** to `/#waitlist` (not a checkout button);
  promo-code option **hidden**; founding callout says "checkout isn't open yet — join waitlist".
  Free CTA opens the VS Code marketplace in a new tab.

### 2.3 Auto-checkout is blocked while closed

- **Route:** `/pricing?autoCheckout=builders-monthly`
- **Expect:** no checkout opens; `autoCheckoutError` = "Builders checkout is not open yet.
  Please join the waitlist."

### 2.4 Members area gates a non-member gracefully

- **Route:** `/members` (AuthGuard) — auth'd **community** user (no active Builders sub/license)
- **Backend:** `GET /api/v1/members/sessions` → **403 `{reason:'membership_required'}`**
- **Expect:** renders the **builders pitch** (value props + CTAs to `/#waitlist` and `/#builders`),
  never a raw error or dead-end.

---

## 3. Builders Pack — Checkout mode (checkout ON) + Paddle sandbox

Preconditions: flip **both** flags to `true` (§1.1). Paddle sandbox token + Builders
monthly/yearly price ids are already in `environment.ts` and `.env`. Use a Paddle
**sandbox test card** at checkout.

### 3.1 Checkout while logged out → login bounce

- **Route:** `/pricing` → click Builders CTA (now a button) logged out
- **Expect:** redirect to `/login?returnUrl=/pricing&plan=builders-monthly` (or `-yearly`).

### 3.2 Checkout while logged in (monthly)

- **Backend chain:** `POST /subscriptions/validate-checkout {priceId}` → `GET /subscriptions/checkout-info`
  → Paddle overlay → on `checkout.completed`: `GET /api/v1/licenses/me` (retry 3×/2s)
- **Expect:** dark Paddle overlay prefilled with `paddleCustomerId` (else email); on success →
  navigate `/profile`, tier becomes **builders**. 5-min inactivity timeout; `checkout.closed`/`error`
  reset state.
- **Verify server side:** a `subscriptions` row (status `active`/`trialing`) exists for the user;
  `GET /api/v1/licenses/me` reports `tier: 'builders'`.

### 3.3 Duplicate-subscription block

- **Steps:** click checkout as an already-subscribed user
- **Backend:** `validate-checkout` → `{canCheckout:false, reason:'existing_subscription', customerPortalUrl}`
- **Expect:** validation alert + "Manage your subscription" portal link; overlay never opens.
  (Note: a validation **network error** proceeds anyway by design — logged.)

### 3.4 Post-login auto-checkout

- **Route:** `/pricing?autoCheckout=builders-monthly|builders-yearly` (return from login)
- **Expect:** auto-opens checkout; already-Builders → param stripped, no-op; invalid plan key → error;
  Paddle not ready within 10s → error.

### 3.5 Founding invite deep-link → discounted checkout

- **Route:** `/pricing?promo=founding&cycle=monthly|yearly&d=<dsc_id>` (CTA in the founding-invite email)
- **Expect:** founding callout "discount ready at checkout"; `cycle=yearly` selects the yearly price id;
  the emailed `d=` (a Paddle `dsc_...` id) is applied and **wins over** a manually typed promo code.
- **Discount source:** `d` comes from `.env` `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY`/`_YEARLY`
  (FOUNDING35 = 35%×12mo, FOUNDING50 = 50% first year — Paddle-side codes, not literals in code).

### 3.6 Manual promo code

- **Steps:** expand "Promo code" → type a code → checkout
- **Expect:** code (uppercased) applied at Paddle; option hidden while checkout closed or for existing subs.

### 3.7 Manage subscription / customer portal

- **Backend:** `POST /api/v1/subscriptions/portal-session {}` → `{url, expiresAt}`
- **Expect:** Paddle portal opens new tab; on window refocus `/pricing` refreshes subscription state.
  Unauth → `/login?returnUrl=/pricing`.

> [!NOTE]
> **CTA state matrix** (`pricing/utils/plan-card-state.utils.ts`) drives label/style from
> subscription context: `community | active | canceled | past_due | paused`. Worth a dedicated
> table-driven test — seed each subscription `status` and assert CTA text/variant + portal-vs-checkout action.

---

## 4. Members area content (authenticated Builder)

Precondition: auth'd user with an **active Builders subscription or active `builders` license**
(entitlement resolved from the DB, not the JWT). Route `/members` (AuthGuard).

- **4.1 Sessions list** — `GET /api/v1/members/sessions` (throttle 30/min) → 3 sections
  (Upcoming Live Sessions, Community, Course & Artifacts). Empty → "No sessions scheduled in
  the next 60 days." Response is Zod-validated; malformed → retry state.
- **4.2 Session card "Join"** — opens the Google `meetLink` in a new tab; locale-aware date +
  start–end in viewer TZ; recurring badge when `recurring:true`; no Join button when `meetLink` null.
  (Backed by the real event we created — `google-sessions-smoke.mjs` proves the data.)
- **4.3 Community / Discourse link** — "Open Community" opens `communityUrl` (= server `DISCOURSE_URL`).
  Null → "Your community space is being set up."
- **4.4 Cohort badges** — `memberGroups[]` rendered as badges; founding → `badge-warning`, else `badge-ghost`.

---

## 5. Auth flows (WorkOS)

Use the real UI here. Route `/login` `/signup` (GuestGuard → auth'd users bounce to `/profile`).

- **5.1 Email/password sign-in** — `POST /api/auth/login/email` (5/min) → sets hint, `navigateAfterAuth`
  to `/profile` or `returnUrl` (+`autoCheckout`). `email_verification_required` → verification flow.
- **5.2 Sign-up + 6-digit verification** — `POST /api/auth/signup` → `POST /api/auth/verify-email` (10/min);
  resend `POST /api/auth/resend-verification` (3/min). `source=vscode` → special "Account Created" screen.
- **5.3 Social OAuth (GitHub/Google)** — full-page `GET /api/auth/oauth/{github|google}?returnUrl&plan`
  (WorkOS PKCE) → callback sets cookie → `FRONTEND_URL?auth_hint=1`; `AuthInitializerService` hydrates.
- **5.4 Magic link** — `POST /api/auth/magic-link` (3/min); verify `GET /api/auth/verify?token=` (2-min).
  Always success server-side (no email enumeration).
- **5.5 Return-URL open-redirect guard** — only own-origin + `apiBaseUrl`-origin absolute returnUrls
  full-page-navigate (e.g. the Discourse SSO bounce); anything else → `/profile`. **Security regression check.**
- **5.6 Logout** — `POST /api/auth/logout` clears the hint/cookie.

---

## 6. Profile page (`/profile`, AuthGuard)

- **6.1** Load account — `GET /api/v1/licenses/me`; error → retry; connects SSE after load.
- **6.2** Real-time SSE — `POST /api/auth/stream/ticket` → `GET /api/v1/events/subscribe?ticket=`;
  refreshes on `license.updated` / `subscription.status_changed` / `reconciliation.completed`
  (ticket 30s single-use, auto-reconnect w/ backoff).
- **6.3** Sync with Paddle — `POST /api/v1/subscriptions/reconcile` → toast.
- **6.4** Manage subscription — `POST /api/v1/subscriptions/portal-session`.
- **6.5** Reveal license key — `POST /api/v1/licenses/me/reveal-key` (3/min) → `ptah_lic_...`.
- **6.6** Tabs: Account / Sessions / Contact (the `/sessions` and `/contact` routes themselves redirect here).

---

## 7. Admin dashboard (`/admin/**`, AdminAuthGuard) — incl. Founding Invites

Real gate = server `ADMIN_EMAILS` allowlist (fail-closed); the guard is UX only. All under `/api/v1/admin`.
Test with an admin-allowlisted account (add your test email to `ADMIN_EMAILS` in `.env`).

- **7.1 Overview** — `GET /api/v1/admin/stats` → waitlist funnel + members-by-tier + groups; derived
  conversion % / builders share (null-guarded).
- **7.2 Model list** — `GET /api/v1/admin/{model}` (page/pageSize≤100/sort/search) for
  `users, licenses, subscriptions, waitlist, session-requests, failed-webhooks, admin-audit-log, marketing-*`.
  Unknown slug → 400.
- **7.3 Record detail/edit** — `GET`/`PATCH /admin/{model}/{id}`; read-only models → 405; empty body → 400.
- **7.4 ⭐ Send Founding Invites** (`/admin/waitlist` → modal) — **selected ids** (table) OR **oldest N**
  (batchSize, default 25) → `POST /api/v1/admin/waitlist/invite {ids?}|{batchSize?}` (10/min). `ids` wins.
  Server emails founding-invite checkout links (with the founding discount ids), stamps `notifiedAt`,
  skips already-notified → `{invited, skipped}` + `waitlist.invite` audit row. **Verify:** the email
  link matches `${FRONTEND_URL}/pricing?promo=founding&cycle=…&d=…` (§3.5); re-invite skips notified rows.
- **7.5 Issue complimentary license** — `POST /admin/licenses/complimentary` (20/min), `plan:'builders'`,
  duration preset 30d/1y/5y/custom/never; optional `LICENSE_EMAIL_FAILED` warning. **This is the fastest
  way to create a Builder for testing §4** without Paddle.
- **7.6 Member groups (cohorts)** — CRUD + assign/unassign; `key` immutable; `isDefault:true` clears prior
  default; best-effort Discourse group sync.
- **7.7 Marketing** — segments / templates / `POST /admin/marketing/send` (3/min); bulk email ≤500 ids.
- **7.8 Delete user** — deletion-preview → `DELETE /users/:id` (5/min) needs `confirmEmail` (+ ack if paid sub).

---

## 8. Recommended automation plan (close the zero-coverage gap)

No e2e project exists — scaffold one. Suggested order (Builders-first, per priority):

1. **Scaffold** `apps/ptah-landing-page-e2e` (Playwright) with an `e2e` target; base URL
   `http://localhost:4200`; a global setup that runs the `scripts/*-smoke.mjs` preflight and
   seeds/cleans fixtures via the `discourse-e2e.mjs` DB helpers.
2. **Auth fixtures** — a `builderPage` / `communityPage` / `adminPage` fixture using the §1.2
   cookie+localStorage injection (fast, deterministic; no WorkOS in the loop).
3. **P0 specs (Builders pack):** 2.1 waitlist join, 2.2 pricing waitlist rendering, 2.4 members
   403 → pitch, 4.1–4.4 members content (Builder), 7.4 founding invites (assert email link shape).
4. **P1 specs (checkout mode):** 3.1–3.7 — Paddle overlay is a cross-origin iframe; assert **up to**
   the overlay opening + the post-`completed` state via a stubbed/replayed `checkout.completed`
   (don't drive Paddle's iframe in CI). The state matrix (§3 note) is pure-function testable.
5. **P2 specs (auth + profile + admin):** Section 5 real-WorkOS flows behind a tag (run locally, not CI);
   6.x profile + SSE; 7.x admin model CRUD.
6. **Keep the backend-contract scripts** (`discourse-e2e.mjs` etc.) running as the API-level layer
   beneath the UI specs.

**Coverage today vs. target:**

| Layer                                                         | Today              | Target           |
| ------------------------------------------------------------- | ------------------ | ---------------- |
| SSO / members-sessions / admin-group-sync (API)               | ✅ `scripts/*.mjs` | keep             |
| Landing UI (waitlist, pricing, members, auth, profile, admin) | ❌ none            | Playwright P0→P2 |

---

## 9. Release regression checklist (quick manual pass)

- [ ] `/` loads; all sections render; Builders `#waitlist` submits (2.1)
- [ ] `/pricing` matrix correct for the current flag mode (2.2 / 3.x)
- [ ] Waitlist mode: every Builders CTA → `/#waitlist`; no checkout button (2.2–2.3)
- [ ] Checkout mode: CTA opens Paddle overlay; success → `/profile` tier=builders (3.2)
- [ ] `/members` — community user → pitch (2.4); Builder → sessions + Meet link + community link + cohort badge (4.x)
- [ ] Auth: email login, signup+verify, social, magic link, logout (5.x); returnUrl guard (5.5)
- [ ] `/profile` — account loads, reveal key, manage subscription, SSE refresh (6.x)
- [ ] `/admin` — allowlisted-only; stats + a model list load; **Send Founding Invites** emails correct link (7.1/7.4)
- [ ] Legal pages render (`/terms-and-conditions`, `/privacy`, `/refund`)
- [ ] Guards: guest→`/profile` bounce, `/members`/`/profile` guest→`/login`, `/admin` non-admin→`/profile`

---

## 10. Videos (follow-up — after functionality is green)

Out of scope for this pass. Once the P0/P1 flows above are verified/green, record narrated
walkthroughs via the **`video-showcase`** pipeline (Playwright capture → Remotion render) — the
same Playwright flows authored in §8 double as the capture scripts. Track per-flow: waitlist join,
checkout, members tour, founding-invite admin flow. Do **not** start videos until the flows they
depict pass.
