---
id: TASK_2026_201
status: in_review
type: FEATURE
title: >-
  Founding cohort free access — approve a waitlist row to a complimentary
  Builders licence instead of a paid checkout invite
description: >-
  The founding early-adopter programme was designed as FREE access for the
  first cohort — no card, no Paddle — but the only implemented invite path
  sells. `POST /v1/admin/waitlist/invite` calls
  `EmailService.sendFoundingInviteEmail`, hard-wired to a paid checkout link
  (`email.service.ts:696` builds `/pricing?promo=founding&cycle=<c>&d=<dsc_>`),
  and the discount id carried by the wave already sent
  (`dsc_01kz178gb27gbe49mz0g2cbs6g`) matches NEITHER live 70% discount recorded
  in `docs/deploy/founder-setup-checklist.md:40-43`. Recipients who click land
  on `/pricing`, which correctly renders the waitlist CTA because
  `buildersCheckoutEnabled` is false, so the invite is a dead end in both
  directions. Every entitlement primitive the free design needs already exists
  and is unused by this path — `POST /v1/admin/licenses/complimentary`
  (presets `30d|1y|5y|never|custom`, `source: 'complimentary'`, audit action
  `license.complimentary.issue`), `MembershipService.isBuildersMember`
  (`membership.service.ts:80`, satisfied by a non-expired `builders` licence
  with no subscription), the `founding` member group gating live sessions and
  forum categories by `cohortKeys`, and the pricing grid's `member` CTA variant
  (`pricing-grid.component.ts:719`) that renders a complimentary-member badge.
  Add the missing approval action that composes them — issue a 1y comp licence,
  join the `founding` cohort, send a "you're in, free" mail — transactionally,
  and retarget the invite email away from checkout. No customers exist yet, so
  no correction wave and no reconciliation of already-notified rows is in
  scope. `buildersCheckoutEnabled` stays false throughout; the launch flip
  remains `docs/deploy/founder-setup-checklist.md` §2.5.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
