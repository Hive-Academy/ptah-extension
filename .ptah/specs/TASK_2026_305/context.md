# Context — Enable the Resend webhook in production

## How this surfaced

Found while reconciling `.env.prod` against the live droplet
(`/opt/ptah-extension/.env.prod`, 167.71.9.106) on 2026-08-22. The committed
`.env.prod.example` had drifted badly from what the code actually reads:
`UNSUBSCRIBE_TOKEN_SECRET` was missing from it entirely despite being
boot-fatal, 13 keys with zero readers were still being carried, and
`RESEND_WEBHOOK_SECRET` and `MARKETING_POSTAL_ADDRESS` were absent from both
the template and production.

`MARKETING_POSTAL_ADDRESS` was filled in that same pass. This task covers the
webhook, which needs a dashboard change and an end-to-end verification, not
just a value.

## Why nothing is visibly broken

The absence is silent in both directions, which is why it survived this long:

- Nothing is configured to POST to `/webhooks/resend`, so the route is never
  exercised and the guard never rejects anything. There is no error in the logs
  to notice.
- Transactional email is unaffected. That path runs on `RESEND_API_KEY` through
  `ResendProvider` and has always worked. Only the marketing side is starved.

So the current state is not a running defect — it is missing coverage that
becomes a real problem on first campaign send.

## What already exists (no application code needed)

The receiving half is complete:

- `libs/api/marketing/src/lib/marketing/controllers/resend-webhook.controller.ts`
  — mounted at the public path `webhooks/resend`, guarded by
  `ResendWebhookGuard`, returns 200 so Resend does not retry on success.
- `apps/ptah-license-server/src/main.ts` — registers a route-scoped
  `bodyParser.raw` before the global pipes so `req.rawBody` is available for
  signature verification, and excludes `webhooks/resend` from the global `api`
  prefix.
- `libs/api/marketing/src/lib/marketing/guards/resend-webhook.guard.ts:18` —
  Svix HMAC check. Strips a leading `whsec_` if present, so either form of the
  secret works. Throws `UnauthorizedException` when the secret is blank.
- `libs/api/marketing/src/lib/marketing/services/marketing.service.ts:431-462` —
  handles `email.bounced` and `email.complained` by calling `flipOptOut` with
  reasons `user.bounced` / `user.complained`, and bumps `bouncedCount` /
  `complainedCount` on the campaign. `email.delivery_delayed` bumps
  `bouncedCount`. Retries are de-duped by `svix-id`.

The webhook payload param is deliberately left unbound by `dtoPipe` — see the
comment in the controller and the `EXCLUDED` list in
`apps/ptah-license-server/src/common/controller-validation.spec.ts`. Do not
"fix" that while working here; a vendor adding a field must not 400.

## Work

1. Create the webhook endpoint in the Resend dashboard pointing at
   `https://api.ptah.live/webhooks/resend`. Subscribe at minimum to
   `email.bounced`, `email.complained` and `email.delivery_delayed`.
2. Copy the Svix signing secret into `RESEND_WEBHOOK_SECRET` in `.env.prod`
   (the key is already present and blank, with the reasoning inline).
3. Republish the env to the deploy action — `gh secret set ENV_PROD_FILE <
.env.prod` — then deploy. The action overwrites the droplet copy on every
   run, so the droplet must never be hand-edited.
4. Verify signature rejection: POST to the endpoint with a bad signature and
   confirm 401, and confirm a correctly signed delivery returns 200.
5. Verify the actual behaviour end to end, which is the point of the task —
   send to a Resend simulator bounce address, confirm the event arrives, and
   confirm the recipient is flipped to opted-out and is genuinely excluded from
   the next send. A 200 on the webhook is not sufficient evidence.

## Open questions

- Should `email.delivered` / `email.opened` / `email.clicked` also be
  subscribed? They are not handled today, and subscribing to unhandled events
  costs nothing but adds noise. Recommend starting with the three that are
  handled.
- Bounce classification: the handler treats `email.bounced` as opt-out without
  distinguishing hard from soft bounces. Worth checking whether a soft bounce
  (mailbox full, temporary) should really suppress permanently, or whether that
  needs a follow-up.

## Related

- `TASK_2026_177` — decommissioned the self-hosted forum. Unrelated to this,
  but the same env reconciliation pass removed its five dead `DISCOURSE_*` keys
  and flagged `DISCOURSE_SSO_SECRET` / `DISCOURSE_API_KEY` for revocation at
  source. See `.ptah/specs/task_2026_177/decommission-runbook.md`.
