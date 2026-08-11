# TASK_2026_201 — Founding cohort free access

## User intent

The founding early-adopter programme was always meant to be **free** for the
first cohort. In the founder's words: "having waitlist for early adopters and
allow them to join without adding credit card or ever go through paddle, but
have access to my first SaaS building sessions ... then afterwards I can do one
more completely free builders session or something before I enable the checkout
mode eventually once I have a solid reputation built already".

The waitlist workflow on `/pricing` is **correct and stays**. What is wrong is
the invite that goes out from the admin panel: it sells.

## How this surfaced

The founder clicked the founding invite link from his own inbox
(`/pricing?promo=founding&cycle=monthly&d=dsc_01kz178gb27gbe49mz0g2cbs6g`) and
landed on the waitlist CTA rather than a Paddle modal. That render is correct —
`buildersCheckoutEnabled` is false — but it exposed that two contradictory
workflows exist: an email promising discounted paid membership, and a page
offering free waitlist application.

## Decisions taken

| Decision | Value | Rationale |
| --- | --- | --- |
| Already-invited recipients | **No correction wave** | Founder confirmed: "we don't have any real customer yet". No reconciliation of already-notified waitlist rows, no apology mail. |
| Comp licence duration | **`1y`** | The cohort is 2 weeks. A `30d` preset expires ~2 weeks after it ends, yanking the course and forum archive away from founding members exactly when their goodwill matters. `1y` costs nothing pre-checkout and makes "founding member" mean something once checkout opens. |
| `buildersCheckoutEnabled` | **stays `false`** | It is the mechanism this design needs, not an obstacle. Earlier in the session removing the client-side flag was floated and is explicitly REJECTED — waitlist mode is a supported product state, not dead code. Launch flip stays `docs/deploy/founder-setup-checklist.md` §2.5. |
| Task split | 201 (this) + 202 (curriculum) | The "you're in" email IS this feature's notification path; fixing `sendFoundingInviteEmail` as a separate bugfix would write it twice. |
| CLI delegation | **disabled** | Checkpoint 0.1 — billing/licensing/membership logic plus customer-facing copy is tightly coupled, the case the heuristics say to keep in shared context. |

## Strategy

FEATURE, Full depth: PM → Architect → Team-Leader → QA.

## What already exists (do not rebuild)

- `POST /api/v1/admin/licenses/complimentary` — `admin-licenses.controller.ts:67`.
  Presets `30d | 1y | 5y | never | custom`. Persists `source: 'complimentary'`
  so MRR dashboards filter it out. Audit action `license.complimentary.issue`.
  Will NOT revoke an existing active licence; returns 409 unless
  `stackOnTopOfPaid: true`. Throttled 20/min per admin email.
- `MembershipService.isBuildersMember` — `membership.service.ts:80`. Entitlement
  is "active subscription **OR** non-expired `builders` licence", so a comp
  licence grants the member panel, forum, course and live sessions identically
  to a payer. This is the single definition; `libs/api/membership/README.md`
  records that it used to exist three times and R7.2 gates against regression.
- `founding` member group / cohort — already gates live sessions
  (`live-sessions.service.ts`) and forum categories by `cohortKeys`.
- Pricing grid `member` CTA variant — `pricing-grid.component.ts:719`, renders a
  non-interactive complimentary-member badge.

## The actual gap

`POST /v1/admin/waitlist/invite` (`admin-waitlist.controller.ts:53`) selects the
oldest un-notified rows and calls `EmailService.sendFoundingInviteEmail`, which
is hard-wired to paid checkout at `email.service.ts:696`. There is no
approve-to-cohort action composing the primitives above.

## Known defects folded in

1. The already-sent wave carries `dsc_01kz178gb27gbe49mz0g2cbs6g`, matching
   neither live 70% discount in `founder-setup-checklist.md:40-43`
   (`dsc_01kz1d5yxk1naqrtctbwyfbfaf` monthly / `dsc_01kz1d8xwjt9wq17c9rdqcy29j`
   yearly). Becomes moot if the invite stops linking to checkout, but the dead
   FOUNDING35/FOUNDING50 discounts still want deactivating in Paddle
   (checklist §2.1, unchecked).
2. Rows already marked notified will be skipped by the un-notified selector on
   any re-invite. Only test rows are affected (no real customers), but the
   approve action needs a defined behaviour for an already-notified row.

## Out of scope

- Flipping `buildersCheckoutEnabled` in any environment.
- Removing `environment.checkout.ts` or the `checkout` build/serve targets.
- Any correction/apology email wave.
- The curriculum restructure — that is TASK_2026_202.

---

## Checkpoint 1 outcomes — founder decisions (2026-08-11)

The three `## Clarifications Needed` items in `task-description.md` are CLOSED.
These override the PM's recommendations where they differ.

### C1 — `Founding / Waitlist Invite` marketing template: **DELETE the row**

Founder: "i won't use the admin to send founding cohort."

The PM recommended rewriting it to free-cohort copy. **Rejected.** The rewrite
was justified by "the campaign sender keeps a usable founding template", and the
founder has now stated he will not use that sender for this cohort at all. A
template nobody will send is not an asset; it is a loaded gun with better copy.

- A NEW migration deletes the row by `name`. Editing the applied migration
  `20260806000000_fix_founding_invite_offer_copy/migration.sql` remains
  FORBIDDEN (per-migration checksum → forced database reset).
- The delete SHALL be idempotent — safe on a database that never seeded the row
  and on one that did.
- R10's acceptance criteria still apply, restated for a delete: after the
  migration no row in `marketing_campaign_templates` carries a
  `/pricing?promo=founding` link or a founding discount percentage.

### C2 — `POST /v1/admin/waitlist/invite`: **DELETE entirely** (PM Option A)

Confirmed. Deleted along with `WaitlistService.inviteBatch`
(`waitlist.service.ts:144-186`), the invite modal, and the admin UI controls.

Reasoning refined during the checkpoint discussion: the founding programme needs
two kinds of outbound — transactional ("you're in, here's your key") and
announcement ("we start Monday"). The approval mail owns the first completely.
`inviteBatch` is a PER-ROW mailer being asked to do a GROUP job — the wrong shape
for the only work that remains. It is not repointed; it is removed.

Nothing in this task replaces the announcement channel. The founder is not using
the admin sender for it, so no announcement capability is built here.

### C3 — Welcome-mail duration copy: **neither PM option; use the scope framing**

Both offered options frame a gift as a countdown. The mail leads with what the
member KEEPS, not when they are cut off:

> Founding members keep the course, the recordings and the community for a full
> year — the two-week cohort is the live part, not the whole of it.

The literal expiry date goes in the licence-details block lower in the mail, so
a member checking specifics finds it. Warm at the top, precise at the bottom.

R3's prohibitions are unchanged and still binding: no monetary amount, no
percentage, no `/pricing` link, no `promo=`/`d=` parameter, no money-back or
renewal language. The source-text spec (R3.6) gates all of it.
