---
id: TASK_2026_305
status: backlog
type: DEVOPS
title: >-
  Enable the Resend webhook in production so bounces and spam complaints
  actually suppress
description: >-
  `RESEND_WEBHOOK_SECRET` has never been set in production. Nothing has broken
  because nothing calls the endpoint — with no webhook configured in the Resend
  dashboard, `/webhooks/resend` receives no requests and `ResendWebhookGuard`
  never runs. The consequence is silent and one-directional; the receiver is
  fully built and wired, it is simply starved of input. `ResendWebhookController`
  is mounted, excluded from the global `api` prefix, and given a scoped raw-body
  parser in `main.ts` for Svix HMAC verification, and
  `MarketingService.handleResendWebhook` already consumes `email.bounced`,
  `email.complained` and `email.delivery_delayed`, flipping the recipient to
  opted-out via `flipOptOut` and bumping the campaign counters. Because no
  event ever arrives, there is currently NO bounce suppression and NO
  spam-complaint suppression — the platform would keep mailing hard-bounced
  addresses and people who have already reported it as spam. That is the exact
  behaviour that destroys sender reputation at the ESP and the domain level, and
  it is a CAN-SPAM and GDPR exposure the moment the first real marketing
  campaign goes out. Risk is therefore latent today and becomes acute on first
  send, which makes this a launch blocker for the marketing campaign feature
  rather than a defect in the current running system. Scope is configuration and
  verification, not new application code — create the webhook in the Resend
  dashboard, put the Svix signing secret into `.env.prod` and `ENV_PROD_FILE`,
  redeploy, then prove end to end that a bounced address is actually suppressed
  on the next send. Related unset var `MARKETING_POSTAL_ADDRESS` was filled in
  the same pass and is not part of this task.
---

# Enable the Resend webhook so bounces and complaints suppress

Machine-owned metadata carrier. Prose lives in `./context.md`.
