# Requirements Document — TASK_2026_201

**Founding cohort free access — approve a waitlist row to a complimentary Builders licence instead of a paid checkout invite**

Type: FEATURE · Depth: Full · Surface: `apps/ptah-license-server` + `libs/api/**` + `libs/web/admin` (web product only; no extension/Electron/CLI surface is touched)

---

## Introduction

### Business context

The Ptah Builders founding early-adopter programme was designed as **free access for the first cohort** — no card, no Paddle — with paid checkout enabled only later, once reputation exists. `context.md` records the founder's words verbatim.

The waitlist capture on `/pricing` is correct and stays. What is wrong is everything downstream of it: **the only implemented path out of the waitlist sells.**

### The contradiction, stated precisely

Two workflows exist and they contradict each other:

| Surface                                                                        | What it promises                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `POST /v1/admin/waitlist/invite` → `EmailService.sendFoundingInvite`             | Paid membership at a 70% founding discount, linking to Paddle checkout  |
| `/pricing` with `buildersCheckoutEnabled: false`                                | A free waitlist application form                                        |

A recipient who clicks the invite CTA lands on the waitlist form they already filled in. The invite is a dead end in both directions.

Three concrete defects sit inside that:

1. **The mail sells.** `email.service.ts:691-698` (`buildFoundingCheckoutUrl`) builds `${FRONTEND_URL}/pricing?promo=founding&cycle=<cycle>&d=<paddleDiscountId>`; the template at `email.service.ts:765-788` quotes "70% founding discount", "`$290/year` → `$87` for your first year", "`$29/month` → `$8.70/month`", a 30-day money-back guarantee, and "Renewals are at the list price". Subject line: "You're invited — founding member pricing" (`email.service.ts:159`).
2. **The discount id already mailed is wrong.** The sent wave carries `dsc_01kz178gb27gbe49mz0g2cbs6g`, which matches neither live discount in `docs/deploy/founder-setup-checklist.md:40-43`. Moot once the mail stops linking to checkout.
3. **There is no free path at all.** No endpoint composes "waitlist row → complimentary licence → founding cohort → you're in" as one action.

### The gap is narrower than it looks, and that is the point

Every entitlement primitive the free design needs **already exists and already works**:

| Primitive                                            | Where                                                                                            | Behaviour today                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Complimentary licence issuance                        | `libs/api/licensing/src/lib/license/services/license.service.ts:467-624`                          | Find-or-creates user by email (`:388-399`), presets `30d\|1y\|5y\|custom\|never` (`:406-448`), `source: 'complimentary'` (`:557`) |
| Entitlement predicate                                 | `libs/api/membership/src/lib/membership.service.ts:69-93`                                        | Active subscription **OR** active non-expired `builders` licence — a comp licence grants identical access to a payer's           |
| The `founding` cohort                                 | `apps/ptah-license-server/prisma/migrations/20260719160000_add_member_groups/migration.sql:51-63` | Seeded, `is_default = true`, gates forum categories and live sessions by `cohortKeys`                                            |
| Cohort assignment                                     | `libs/api/community/src/lib/member-groups/member-groups.service.ts:318-334`, `:438-494`            | Idempotent upsert (`assignDefaultGroup`) / bulk assign with audit (`assignMany`)                                                 |
| Admin UI shell                                        | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts`                                            | Segmented New / Invited / Converted / All queue with selection toolbar                                                          |
| Complimentary-member pricing badge                    | `libs/web/pricing/src/lib/components/pricing-grid.component.ts:719`                               | Non-interactive `member` CTA variant                                                                                            |

**Partial approval already exists and is wired wrong.** `waitlist-pipeline.html:148-155` renders an "Approve → Builders" button — but only inside `@case ('invited')` (`waitlist-pipeline.html:143-144`), so a row can only be approved **after** it has been mailed the paid invite. That button opens `IssueCompLicenseModalComponent` bound to the row email (`waitlist-pipeline.ts:317-321`), which defaults to a 1-year grant with reason "Early adopter approval" (`issue-comp-license-modal.ts:156-163`) and POSTs to `/v1/admin/licenses/complimentary`. What that path does **not** do:

- it never assigns the `founding` cohort — the member enters `/members` and sees no cohort-gated content;
- it stamps `convertedAt` (`license.service.ts:594-601` → `waitlist.service.ts:113-127`), permanently polluting the paid-conversion funnel metric with free grants;
- it sends "Your Ptah Premium License Key" (`email.service.ts:55`), a transactional key mail, not a "you're in, free" welcome;
- it cannot be applied in bulk, and 25 sequential calls would trip the 20/min throttle on `admin-licenses.controller.ts:69` mid-cohort.

### Value proposition

One admin action turns a waitlist row into a fully entitled, cohort-placed founding member who is told, in one email, that they are in and that it is free. One workflow replaces two contradictory ones. No customer sees a price until the founder chooses to show one.

---

## In Scope

1. A server-side **approve-to-cohort** action (`POST /v1/admin/waitlist/approve`) that atomically grants entitlement, places the member in `founding`, records approval state, and audits — for one row or a bounded batch.
2. **Retargeting the founding mail away from checkout by replacement**: no paid-invite template survives in the codebase; the surviving mail is the free approval welcome.
3. Retiring `POST /v1/admin/waitlist/invite` and its admin UI, replaced by approve.
4. A `Waitlist.approvedAt` column + migration, and correcting the existing comp-licence path so a free grant no longer stamps `convertedAt`.
5. Admin UI: approve from **New** and **Invited**, bulk approve, an **Approved** stage, and removal of the "70% off" copy at `waitlist-invite-modal.html:9-12`.
6. Neutralising the second live paid-pitch surface — the DB-seeded `Founding / Waitlist Invite` marketing-campaign template.
7. Audit action `waitlist.approve`, throttling, DTO validation binding, and the specs that gate all of it.

## Out of Scope

Copied from `context.md` and extended.

- **Flipping `buildersCheckoutEnabled` in any environment.** It stays `false`. It is the mechanism this design needs, not an obstacle.
- **Removing `environment.checkout.ts`, the `checkout` build/serve targets, or the client-side flag.** Waitlist mode is a supported product state, not dead code. The launch flip remains `docs/deploy/founder-setup-checklist.md` §2.5.
- **Any correction or apology email wave.** No real customers exist. No reconciliation of already-notified rows.
- **The curriculum restructure** — TASK_2026_202.
- **Extended:** the 70% offer copy on public marketing surfaces (`libs/web/landing`, `libs/web/pricing`, `apps/ptah-docs`, `marketing/scripts/**`, `apps/ptah-video-studio/**`). Those describe the future paid offer and are correct once checkout opens.
- **Extended:** deactivating the dead `FOUNDING35` / `FOUNDING50` Paddle discounts (`founder-setup-checklist.md` §2.1, unchecked). A Paddle-console chore with no code change; unblocked but not performed here.
- **Extended:** removing `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` from `.env.example` or deployment config. The code references in `email.service.ts:709-714` go; the variables stay for the eventual checkout launch.
- **Extended:** any change to `MembershipService.isBuildersMember` (`membership.service.ts:69-93`). A comp licence already satisfies it. Touching the single definition of "paid member" is a security-predicate change disguised as a feature, and R7.2's gate exists to prevent exactly that.
- **Extended:** the extension / Electron / CLI licence-activation UX. A comp licence key verifies through the existing path unchanged.

---

## Functional Requirements

### Requirement 1: Approve a waitlist row to the founding cohort

**User Story:** As the founder administering the Builders waitlist, I want to select one or more waitlist rows and approve them in a single action, so that each approved person becomes a fully entitled, cohort-placed founding member without ever seeing a price.

**Endpoint:** `POST /api/v1/admin/waitlist/approve`, on `AdminWaitlistController` (`libs/api/admin/src/lib/admin-waitlist.controller.ts`), inheriting the class-level `@UseGuards(JwtAuthGuard, AdminGuard)` at `:43`.

**Request:** `ApproveWaitlistDto` — `{ ids: string[] }`, waitlist row ids. `@ArrayMinSize(1)`, `@ArrayMaxSize(50)`, `@IsString({ each: true })`. Duration is **not** client-supplied: the grant is always `1y` (`context.md` decision — the cohort is two weeks, a `30d` preset would expire ~two weeks after it ends and yank the course and forum archive away exactly when goodwill matters; `1y` costs nothing before checkout and makes "founding member" mean something after).

**Per-row work, in order:**

1. Claim the row (see R5) and load `{ id, email, notifiedAt, approvedAt }`.
2. Find-or-create the `User` by lowercased email — the semantics already implemented at `license.service.ts:388-399`.
3. Create a `License`: `plan: 'builders'`, `status: 'active'`, `source: 'complimentary'`, `expiresAt = now + 365d`, `createdBy = <actor email>`.
4. Create the `MemberGroupAssignment` linking the user to the `founding` `MemberGroup`.
5. Stamp `Waitlist.approvedAt` (R4).
6. Write the `waitlist.approve` audit row (R6).
7. **After commit**, send exactly one welcome mail (R2, R3).

#### Acceptance Criteria

1. WHEN an admin POSTs `{ ids: [<one un-approved row>] }` THEN the response SHALL be `200` with a per-row outcome of `approved`, and the database SHALL contain: one `License` with `plan='builders'`, `source='complimentary'`, `status='active'`, `expiresAt` within 365 days ±1 of now; one `MemberGroupAssignment` to the group whose `key = 'founding'`; a non-null `Waitlist.approvedAt`; and one `admin_audit_log` row with `action='waitlist.approve'`.
2. WHEN the approved person subsequently authenticates THEN `MembershipService.isBuildersMember` (`membership.service.ts:79-89`) SHALL return `true` via the licence branch with no subscription present, and `CohortResolver.resolveCohortKeys` (`cohort-resolver.service.ts:50-57`) SHALL include `'founding'`.
3. WHEN `ids` contains 50 rows THEN all 50 SHALL be processed in the one request, and no row's outcome SHALL depend on another row's success.
4. WHEN `ids` is empty, contains more than 50 entries, or is absent THEN the request SHALL be rejected `400` by validation before any write occurs.
5. WHEN the `founding` `MemberGroup` cannot be found THEN the request SHALL fail `500` with a sanitized message, no licence SHALL be issued for any row, and the cause SHALL be logged server-side. A silent fallback to the default group is FORBIDDEN — the cohort is named in the requirement, and resolving it by `isDefault` would silently retarget the whole cohort the day a second group is made default.
6. WHEN a waitlist id in `ids` does not exist THEN that row's outcome SHALL be `not_found`, the remaining rows SHALL still be processed, and the response SHALL be `200`.

---

### Requirement 2: Atomicity — define the boundary, and put email outside it

**User Story:** As the founder, I want a half-approved member to be impossible, so that I never have someone holding a licence but missing from the cohort — a state nobody would notice until that member complains that the course is empty.

**The boundary, stated precisely.** Steps 1–6 of R1 execute inside **one Prisma `$transaction` per row**. Step 7 (email) executes **after commit, outside the transaction**.

**Why the transaction ends where it does.** Every step 1–6 is a database write whose partial application produces a state no surface reports: a licence without a cohort is a member who can enter `/members` and sees nothing gated; a cohort assignment without a licence is a member the entitlement guard rejects; an `approvedAt` without either is a row the admin will never look at again. None of those raise an error anywhere. Email is different in kind — it leaves the database entirely, it cannot be rolled back once Resend accepts it, and holding a transaction open across `sendWithRetry`'s three attempts would pin a connection for the retry window. So mail is best-effort and post-commit, exactly as `license.service.ts:603-621` already treats it.

**Grant is authoritative; mail is advisory.** A committed grant with a failed mail is a real member who has not been told — recoverable by re-sending. A sent mail with a rolled-back grant is a promise the system cannot honour. The ordering makes the second impossible.

**The mechanism constraint the architect must resolve.** `LicenseService.createComplimentaryLicense` (`license.service.ts:467-624`) opens its **own** transaction (`:532`) and performs `markConverted` (`:594-601`) and `sendLicenseKey` (`:603-621`) after it, so it cannot be called as-is from inside an outer transaction without either nesting or splitting the boundary. Exactly one of the following is acceptable, and the choice must be recorded in the implementation plan:

- **(a)** Refactor `createComplimentaryLicense` to accept an optional `tx` (the pattern `AuditLogService.write` already supports via `WriteAuditLogParams.tx`, used at `license.service.ts:533-534`) and to accept the post-commit side effects as caller-supplied.
- **(b)** Extract the licence-creation core (recipient resolution, expiry computation, conflict check, keyed create with the P2002 retry at `license.service.ts:529-578`) into a `tx`-aware private method that both `createComplimentaryLicense` and the approve action call.

**(c) — calling `POST /v1/admin/licenses/complimentary` over HTTP, or invoking `createComplimentaryLicense` and then writing the cohort assignment in a separate transaction — is FORBIDDEN.** It reintroduces exactly the half-state this requirement exists to eliminate, and it is what the current admin UI already does.

#### Acceptance Criteria

1. WHEN the `MemberGroupAssignment` create fails for a row THEN no `License` row SHALL exist for that row's user from this request, `approvedAt` SHALL remain null, no audit row SHALL be written, and no email SHALL be sent.
2. WHEN the audit write fails inside the transaction THEN the whole row SHALL roll back. (This differs deliberately from `admin-waitlist.controller.ts:84-104` and `member-groups.service.ts:599-611`, where an audit failure is swallowed because the invites had already gone out. Here the audit row is inside the boundary — `audit-log.types.ts:45-48` PRE-6 — so there is nothing to preserve by swallowing it.)
3. WHEN the transaction commits but the email send throws THEN the row's outcome SHALL be `approved` with a `warning` of code `APPROVAL_EMAIL_FAILED`, the licence and cohort assignment SHALL persist, and the failure SHALL be logged server-side — mirroring the `LICENSE_EMAIL_FAILED` shape at `license.service.ts:616-619`.
4. WHEN row 3 of a 10-row batch throws THEN rows 1–2 and 4–10 SHALL be committed and reported individually, and the HTTP status SHALL be `200` with row 3 reported as failed.
5. WHEN any per-row failure is reported to the client THEN the payload SHALL carry a stable code only. Raw `error.message` SHALL NOT reach the client (CLAUDE.md NestJS standard; the sanitization pattern is `membership.service.ts:104-112`).

---

### Requirement 3: The mail stops selling — retarget by replacement

**User Story:** As an approved founding member, I want the email I receive to tell me I am in and that it is free, and to hand me one link that takes me to what I was promised, so that I never have to work out whether I am being asked to pay.

**Removal is total.** `sendFoundingInvite` (`email.service.ts:150-166`), `getFoundingInviteTemplate` (`:706-798`) and `buildFoundingCheckoutUrl` (`:691-698`) are deleted, along with the `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` reads at `:709-714`. Retargeting the existing template in place is rejected: the whole failure being fixed is that two contradictory workflows were alive at once, and leaving a paid-invite sender in the codebase next to a free-approval sender is the same failure with new copy.

**The replacement.** One method — working name `sendFoundingCohortWelcome` — plus its template.

- **Subject:** states inclusion and freeness, and names no price. Recommended: `You're in — Ptah Builders, free for the founding cohort`.
- **Body MUST state:** they are in; access is free; no card and no payment is required now or when the cohort ends; what they get (the SaaS-building course, weekly live sessions, the members' community, the packs); the access window (their licence runs a year, so the course and the forum archive stay reachable long after the two-week cohort); and how to get in — sign in with **this** email address.
- **One primary CTA**, linking to `${FRONTEND_URL}/members`, with `FRONTEND_URL` read through `ConfigService` with the established `|| 'https://ptah.live'` fallback (`email.service.ts:707-708`).
- **Body MUST NOT contain:** any monetary amount, any percentage discount, any `/pricing` link, any `promo=` or `d=` query parameter, any money-back-guarantee or renewal-pricing language.
- **The licence key travels in this mail.** Approval therefore suppresses the separate `sendLicenseKey` mail (`email.service.ts:41-62`), so an approved member receives exactly one message. Two mails — a "premium license key" and a "you're in" — arriving together is precisely the mixed signal this task removes.
- Visual language stays the dark/gold house style already used by every sibling template.

#### Acceptance Criteria

1. WHEN the repository is searched after this task THEN `buildFoundingCheckoutUrl`, `getFoundingInviteTemplate` and `sendFoundingInvite` SHALL NOT exist, and no email template in `libs/api/email` SHALL contain the substring `promo=founding`.
2. WHEN the founding welcome template is rendered THEN its HTML SHALL contain `/members` and SHALL NOT match `/pricing`, `promo=`, `&d=`, `%` adjacent to "off", `$`, "discount", "money-back", or "renew".
3. WHEN a row is approved THEN exactly one outbound message SHALL be sent to that address by the approval, and it SHALL carry the licence key.
4. WHEN `FRONTEND_URL` is unset THEN the CTA SHALL resolve to `https://ptah.live/members` rather than a malformed or relative URL.
5. WHEN the template is rendered THEN it SHALL read every configuration value through `ConfigService` and SHALL NOT reference `process.env` directly.
6. A spec SHALL assert criteria 1 and 2 against the rendered template **and** the file's source text, in the manner of the source-text invariants already asserted in `membership.service.spec.ts`. A reviewer noticing a price is not a control; a failing test is.

---

### Requirement 4: Approval state — a new column, and `convertedAt` reclaimed

**User Story:** As the founder, I want "approved for free" and "paid me money" to be different facts in the database, so that when checkout opens my conversion number is not silently inflated by every free grant I ever made.

**Schema change.** `Waitlist` (`apps/ptah-license-server/prisma/schema.prisma:463-474`) gains `approvedAt DateTime? @map("approved_at")`, with an additive migration. The model carries only `notifiedAt` and `convertedAt` today; neither can carry this meaning.

**Correcting the existing path.** `createComplimentaryLicense` currently calls `waitlist.markConverted` (`license.service.ts:594-601` → `waitlist.service.ts:113-127`), stamping `convertedAt` for every complimentary grant. A gift is not a conversion. That call SHALL stamp `approvedAt` instead, leaving `convertedAt` written by exactly one thing: the Paddle provisioning fan-out (`paddle.module.ts:11`, `WAITLIST_CONVERSION_SINK`).

**The three stamps, disjoint:**

| Column        | Written by                                       | Means                                          |
| ------------- | ------------------------------------------------ | ---------------------------------------------- |
| `notifiedAt`  | the retired invite wave (historical only)        | was mailed the withdrawn paid invite           |
| `approvedAt`  | approve-to-cohort, and comp-licence issuance     | granted free founding access                   |
| `convertedAt` | the Paddle fan-out only                          | paid                                           |

#### Acceptance Criteria

1. WHEN the migration is applied THEN `waitlist.approved_at` SHALL exist as nullable, existing rows SHALL be unaffected, and the migration SHALL be additive with no data backfill.
2. WHEN a row is approved THEN `approvedAt` SHALL be set and `convertedAt` SHALL remain null.
3. WHEN a complimentary licence is issued through `POST /v1/admin/licenses/complimentary` for an address with a waitlist row THEN `approvedAt` SHALL be stamped and `convertedAt` SHALL remain null.
4. WHEN a Paddle subscription is provisioned for an address with a waitlist row THEN `convertedAt` SHALL be stamped, unchanged from today.
5. WHEN the admin stats endpoint is read THEN it SHALL expose an `approved` count alongside `total`, `notified` and `converted`, so the pipeline header (`waitlist-pipeline.ts:217-229`) and the Overview funnel can render the fourth stage.
6. WHEN the stamping helper runs against a row that is already stamped THEN it SHALL be a no-op and SHALL NOT move the existing timestamp, preserving the `updateMany`-with-null-guard idempotence at `waitlist.service.ts:115-118`.

---

### Requirement 5: Idempotency — approving twice must not grant twice

**User Story:** As the founder, I want a double-click, a retry, or two admins acting at once to produce one licence and one email, so that a member is never handed two overlapping grants or told twice that they are in.

**The claim is the guard, and it lives inside the transaction.** Approval begins with a conditional claim:

```
UPDATE waitlist SET approved_at = now() WHERE id = :id AND approved_at IS NULL
```

`count = 0` means somebody else already approved this row: the outcome is `already_approved`, no licence is created, no assignment is made, no mail is sent. Because the claim is the first statement inside the row's transaction, a later rollback releases it — a failed attempt does not permanently poison the row.

**Why an existence check would not have been enough.** `createComplimentaryLicense`'s conflict guard (`license.service.ts:501-524`) only detects an active **non**-complimentary licence — it explicitly filters `source: { not: 'complimentary' }` (`:506`). A second complimentary licence therefore stacks silently today, with no 409 and no warning. That is precisely the hole a naive "does this user already have a licence?" check would leave open, and it is why the waitlist row, not the licence table, is the idempotency key.

**`stackOnTopOfPaid` is not used by this path.** Approval never passes it. If the address already holds an active paid licence, the row is reported `already_paid` and skipped — a person who has already paid does not need a free grant, and stacking one on top of their subscription is an unrequested and unaudited change to their entitlement.

#### Acceptance Criteria

1. WHEN the same waitlist id is approved twice THEN the second call SHALL return `already_approved`, and the total count of licences, cohort assignments, audit rows and emails attributable to that row SHALL each remain 1.
2. WHEN two requests approve the same row concurrently THEN exactly one SHALL win the conditional update and exactly one SHALL report `already_approved`; neither SHALL return `500`.
3. WHEN a user is already assigned to `founding` (`@@unique([userId, groupId])`, `schema.prisma:132`) THEN the P2002 SHALL be handled as "already assigned" rather than surfacing as an error, matching the handling at `member-groups.service.ts:469-479`.
4. WHEN the target address already holds an active non-complimentary `builders` licence THEN the outcome SHALL be `already_paid`, no licence SHALL be issued, no mail SHALL be sent, and `stackOnTopOfPaid` SHALL NOT be set anywhere in this path.
5. WHEN a row's transaction rolls back after the claim THEN `approvedAt` SHALL be null afterwards and the row SHALL be approvable on a retry.
6. WHEN a licence-key collision occurs THEN the existing 3-attempt P2002 retry (`license.service.ts:529-578`) SHALL still apply, and a retried attempt SHALL NOT produce two licences.

---

### Requirement 6: Already-notified rows — an open behaviour question, closed

**User Story:** As the founder, I want to approve people who already received the withdrawn paid invite without any special ceremony, so that a bad email I sent to test rows does not become a workflow.

**Semantics.** `notifiedAt` is **not** a precondition for approval, **not** a blocker, and **not** modified by approval. Approve accepts a row in any state.

- Rows with `notifiedAt` set are approved identically to fresh rows. There is no reconciliation, no apology, and no correction wave (`context.md` decision — no real customers exist).
- `notifiedAt` is preserved as the historical record of "was sent the withdrawn paid invite". It is never re-stamped, never cleared.
- Because the paid invite is being deleted (R3), `notifiedAt` becomes a dead-ended historical column: nothing writes it after this task. It is not dropped — dropping it would destroy the only record of who received the wrong mail.
- The approve response and audit metadata carry `wasNotified: boolean` so the founder can see, per approval, whether that person had previously been sent the dead link.

#### Acceptance Criteria

1. WHEN a row with a non-null `notifiedAt` is approved THEN it SHALL be granted exactly as a row with a null `notifiedAt`, and `notifiedAt` SHALL be unchanged afterwards.
2. WHEN any row is approved THEN the audit metadata SHALL include `wasNotified` reflecting whether `notifiedAt` was set at approval time.
3. WHEN approvals complete THEN no correction, apology or retraction email SHALL be generated by any code path added in this task.
4. WHEN the admin UI is used THEN approval SHALL be reachable from both the **New** and **Invited** tabs — closing the current gate at `waitlist-pipeline.html:143-144`, where the Approve button exists only under `@case ('invited')` and a New row therefore cannot be approved without first mailing it the paid invite.

---

### Requirement 7: Audit and observability

**User Story:** As the founder, I want to be able to answer "who let this person into the founding cohort for free, and when" from the audit log alone, so that a free-access programme is as accountable as a paid one.

**A distinct action is warranted.** `license.complimentary.issue` (`audit-log.types.ts:17`) answers "who gifted a licence". It does not name the waitlist row, does not record the cohort, and cannot distinguish a founding-cohort approval from an ad-hoc gift to a conference contact. `waitlist.approve` is added to the `AdminAuditAction` union (`audit-log.types.ts:11-27`).

- `action: 'waitlist.approve'`, `targetType: 'Waitlist'`, `targetId: <waitlist row id>`.
- `metadata`: `{ email, userId, userWasCreated, licenseId, durationPreset: '1y', expiresAt, groupKey: 'founding', wasNotified }`.
- Written **inside** the row's transaction via `WriteAuditLogParams.tx`, matching `license.service.ts:533-549` and the standing PRE-6 rule at `audit-log.types.ts:45-48`.
- If the implementation reuses the licence-creation core, a `license.complimentary.issue` row may also be written. That is acceptable — two rows answering two different questions — but the `waitlist.approve` row is the one whose absence is a defect.

**Logging.** One structured line per row (actor, waitlist id, email, outcome, licence id) and one wave summary, mirroring `admin-waitlist.controller.ts:80-82`. The licence key SHALL NOT appear in any log line.

#### Acceptance Criteria

1. WHEN a row is approved THEN exactly one `admin_audit_log` row with `action='waitlist.approve'` SHALL exist, carrying the actor email, IP and user-agent resolved the way `admin-licenses.controller.ts:75-84` resolves them.
2. WHEN the row's transaction rolls back THEN no `waitlist.approve` audit row SHALL exist for it.
3. WHEN a row is skipped (`already_approved`, `already_paid`, `not_found`) THEN no audit row SHALL be written for it — an audit log of non-events buries the events.
4. WHEN any log line is emitted by this path THEN it SHALL NOT contain a licence key.
5. WHEN a wave completes THEN one summary line SHALL record actor, requested count, and the tally per outcome.

---

### Requirement 8: Authorization, validation binding and throttling

**User Story:** As the founder, I want approval locked to admins and bounded per minute, but bounded in a way that cannot strand a cohort half-approved.

**Authorization.** Class-level `JwtAuthGuard` → `AdminGuard` (`admin-waitlist.controller.ts:43`), route-level `AdminThrottlerGuard` (per-admin-email bucket), consistent with both sibling routes.

**⚠️ Validation binding is mandatory and load-bearing.** The `@Body()` parameter MUST bind `dtoPipe(ApproveWaitlistDto)`. A bare `@Body() dto: X` is **silently unvalidated** in this server: esbuild does not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the global `ValidationPipe` short-circuits, rendering every `class-validator` decorator inert. See `admin-licenses.controller.ts:35-48` and `admin-waitlist.controller.ts:29-41`; `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the build if a binding is dropped. On this route the binding is the **only** bound on how many grants and outbound emails one request can produce.

**Throttling, and why the endpoint must exist server-side.** `POST /licenses/complimentary` is 20/min per admin (`admin-licenses.controller.ts:69`); the invite wave is 10/min (`admin-waitlist.controller.ts:67`). A bulk approval driven from the browser as N calls to the comp-licence route would trip at row 21, leaving a cohort of 25 half-approved — a partial state with no owner and no report. Approve is therefore **one request performing N grants**, and the ceiling comes from the DTO, not the throttle:

- `@Throttle({ default: { limit: 10, ttl: 60_000 } })` — matching the wave route it replaces.
- `@ArrayMaxSize(50)` on `ids`.
- Effective hard ceiling: **500 grants and 500 outbound emails per minute per admin.**

#### Acceptance Criteria

1. WHEN an unauthenticated or non-admin caller POSTs to the route THEN the response SHALL be `401`/`403` and no write SHALL occur.
2. WHEN `controller-validation.spec.ts` runs THEN it SHALL cover the new route and SHALL fail if the `dtoPipe(ApproveWaitlistDto)` binding is absent.
3. WHEN `ids` exceeds 50 entries THEN the response SHALL be `400` before any licence is issued or any email is sent.
4. WHEN an admin exceeds 10 approve requests in 60 seconds THEN the 11th SHALL be throttled, bucketed per admin email.
5. WHEN a client is built for this feature THEN it SHALL NOT implement bulk approval as repeated calls to `POST /v1/admin/licenses/complimentary`.
6. WHEN any error is returned THEN it SHALL carry a stable code and a fixed sentence; raw persistence or provider error text SHALL NOT reach the client.

---

### Requirement 9: Admin UI — approve replaces invite

**User Story:** As the founder working the waitlist queue, I want one obvious button that says "approve to the founding cohort" and no button that says "send founding invites", so that the wrong action is not available to me at 2am.

Changes in `libs/web/admin/src/lib/waitlist/`:

- **Remove** the invite path: `WaitlistInviteModal` (component, template and its "70% off the first year" copy at `waitlist-invite-modal.html:9-12`), `onInviteOldest` / `onSendFoundingInvites` / `onInviteClose` / `onInviteSent` (`waitlist-pipeline.ts:287-314`), the "Invite oldest N" quick action (`waitlist-pipeline.html:45-51`), and the `AdminApiService` invite method.
- **Add** approve: a per-row action on **New** and **Invited**, plus bulk approve through the existing `SelectionToolbar` (`waitlist-pipeline.ts:121`), with a confirmation step that states the grant plainly — "N people, free Builders access for 1 year, added to Founding Members, one email each" — and a result summary broken down by outcome.
- **Add** the `Approved` stage: `WaitlistTab` (`waitlist-pipeline.ts:40`) gains `approved` with server filter `approved:true`; `WaitlistRow` (`:43-50`) gains `approvedAt`; `stageLabel` / `stageVariant` (`:344-354`) rank Converted → Approved → Invited → New; the header summary (`:217-229`) gains the approved count from R4.5.
- **Retain** `IssueCompLicenseModalComponent` for the Users-detail (`userId`) and Licenses-list (`mode: 'search'`) paths. Its waitlist-mode branch (`issue-comp-license-modal.ts:53`, `:67-69`, `:156-163`) is retired — the approve action now owns duration, reason and cohort placement, and leaving a second way to half-approve a waitlist row from the admin panel would recreate the defect this task removes.
- Angular standards apply: signals + `inject()`, `ChangeDetectionStrategy.OnPush`.

#### Acceptance Criteria

1. WHEN the waitlist page is rendered THEN no control SHALL exist that sends a founding-pricing invite, and no string matching "70%", "$87", "$8.70" or "off the first year" SHALL appear in `libs/web/admin`.
2. WHEN rows are selected on **New** or **Invited** THEN a bulk approve action SHALL be offered, and the confirmation SHALL state the count, the free 1-year grant, the `Founding Members` cohort and that one email is sent per person.
3. WHEN an approve request returns THEN the UI SHALL display the per-outcome tally (approved / already approved / already paid / not found / failed) and SHALL refresh both the row list and the header summary.
4. WHEN a row has `approvedAt` set THEN its stage chip SHALL read `Approved`, and the row SHALL appear under the `Approved` tab.
5. WHEN the `Approved` tab is deep-linked via `?tab=approved` THEN it SHALL activate correctly through the existing `normalizeTab` URL sync (`waitlist-pipeline.ts:255-259`).
6. WHEN an approve request fails THEN the UI SHALL surface the server's sanitized message and SHALL leave the selection intact so the admin can retry.

---

### Requirement 10: Neutralise the second paid-pitch surface

**User Story:** As the founder, I want there to be no remaining way to accidentally mail the withdrawn 70% offer, so that fixing the code path is actually a fix.

A **second** live surface carries the same paid pitch: the `Founding / Waitlist Invite` row in `marketing_campaign_templates`, seeded and then repaired by `apps/ptah-license-server/prisma/migrations/20260806000000_fix_founding_invite_offer_copy/migration.sql:36-56`, subject `Your founding Builder invite is ready, {{firstName}}`. It is reachable from the admin marketing campaign sender and survives every code change made in R3. That migration's own header (`:1-35`) documents the standing rule this fix must follow.

- A **new** migration SHALL neutralise the row. Editing an already-applied migration file is FORBIDDEN — it breaks Prisma's per-migration checksum and forces a database reset (`migration.sql:9-13`).
- The new migration SHALL use `ON CONFLICT ("name") DO UPDATE`, never `DO NOTHING`, so it repairs an existing row rather than no-op'ing on databases that already seeded it (`migration.sql:17-21`, the exact bug that migration was written to fix).
- Disposition — rewrite to free-cohort copy, or delete the row — is a founder decision; see Clarifications.

#### Acceptance Criteria

1. WHEN the migration is applied to a database holding the 70% copy, to one holding the older "price locked in" copy, and to a fresh database THEN all three SHALL end in the same correct state.
2. WHEN the migration is applied twice THEN the second run SHALL be a no-op write.
3. WHEN any previously-applied migration file is inspected THEN it SHALL be byte-identical to its pre-task content.
4. WHEN `marketing_campaign_templates` is queried after the migration THEN no row SHALL contain a `/pricing?promo=founding` link or a founding discount percentage.

---

## Non-Functional Requirements

### Performance

- A 50-row approval SHALL complete within 30 s wall-clock; each row's transaction SHALL complete within 500 ms at p95.
- No email send SHALL occur while a database transaction is open (R2). `sendWithRetry`'s three attempts must never pin a connection.
- Reads added to the admin stats endpoint SHALL not add a query per row; the approved count is one aggregate.

### Security

- Admin-only, enforced by guards, never by client-side hiding.
- Sanitized errors only; no Prisma text, connection strings, table names or provider messages reach a client (`membership.service.ts:104-112` is the pattern).
- Licence keys never logged, never included in audit metadata.
- Mail is only ever sent to the email persisted on the approved waitlist row — an approval SHALL NOT accept a caller-supplied recipient address.
- No change to `MembershipService.isBuildersMember`. R7.2's gate (`rg 'isBuildersMember'` finds exactly one implementation) SHALL still hold afterwards.
- Configuration read exclusively through `ConfigService`.

### Reliability

- Per-row failure isolation: one bad row never aborts a batch.
- The only unrecoverable-by-retry state is "granted, mail failed", and it is explicitly visible (per-row warning + server log) and manually re-mailable.
- Every write in the path is idempotent under retry (R5).
- Migrations are additive and re-runnable.

### Data integrity

- `approvedAt`, `convertedAt` and `notifiedAt` have disjoint writers and disjoint meanings (R4). The paid-conversion metric SHALL be uncontaminated by free grants from the moment this ships.

### Maintainability and testability

- No parallel implementations, no feature flags gating old-versus-new behaviour, no compatibility shim. The paid-invite path is deleted, not deprecated.
- `controller-validation.spec.ts` covers the new route's DTO binding.
- A source-text spec asserts the welcome template contains no price, discount or checkout link (R3.6).
- Unit coverage for: rollback on cohort-assignment failure; post-commit email failure returning a warning with the grant intact; double approval; concurrent approval; already-paid skip; already-notified approval.
- `nx lint`, `nx typecheck` and `nx test` pass for `ptah-license-server`, every touched `libs/api/*`, and `libs/web/admin`. `catch (error: unknown)` throughout.

### Boundaries

- `libs/api/**` must not import `libs/backend/**` or `libs/frontend/**`; `libs/web/**` reaches the server only through `libs/api-contracts/**` and its HTTP client.
- `MemberGroupsModule` is `@Global()` (evidenced by the `@Optional() @Inject(MemberGroupsService)` pattern at `admin.service.ts:142-147` with no module import in `admin.module.ts:42-48`). The approve path may inject `MemberGroupsService` without a new module edge — but its dependency SHALL be **required**, not `@Optional()`. The optional pattern exists so a stats read or a webhook fan-out degrades gracefully; here, a missing cohort service means the member is not placed in the cohort, which is the exact half-state R2 forbids.

---

## Success Metrics

| Metric                                                                   | Target                     |
| ------------------------------------------------------------------------ | -------------------------- |
| Live code paths that mail a founding price or a checkout link             | 0                          |
| Admin actions required to take a waitlist row to a fully entitled member  | 1                          |
| Emails received by an approved member per approval                        | exactly 1                  |
| Approved members holding a licence but missing from `founding`            | 0                          |
| Free grants counted in the paid-conversion metric                         | 0                          |
| Approvals reaching the founding cohort without an audit row               | 0                          |

---

## Stakeholder Impact

| Stakeholder                | Impact | Involvement                | Success criterion                                                               |
| -------------------------- | ------ | -------------------------- | -------------------------------------------------------------------------------- |
| Founder (sole admin)       | High   | Requirements, acceptance   | Approves a cohort in one action; never mails a price before choosing to          |
| Founding-cohort members     | High   | Recipients                 | One unambiguous email; access works on first sign-in; nothing asks for a card    |
| Future paying members       | Medium | None yet                   | Checkout remains intact and un-flipped; the paid offer is authored fresh later   |
| Server maintainer           | Medium | Implementation             | One approval path; no dual workflow to keep consistent                           |

## Risk Register

| Risk                                                                                        | P   | I        | Mitigation                                                                                              |
| ------------------------------------------------------------------------------------------- | --- | -------- | -------------------------------------------------------------------------------------------------------- |
| Half-approved member (licence without cohort) — the current UI's behaviour                    | Med | High     | R2 transaction boundary; mechanism (c) explicitly forbidden; rollback test is an exit gate               |
| Bulk approval strands a cohort mid-wave on the 20/min comp-licence throttle                   | Med | High     | R8 — one server-side request, DTO-bounded batch, per-row isolation                                       |
| Duplicate licences from a double-click (the `source: { not: 'complimentary' }` gap)           | Med | Med      | R5 conditional-claim inside the transaction; the waitlist row is the idempotency key, not the licence    |
| A price survives somewhere and reaches a member                                              | Med | High     | R3 deletes rather than retargets; R10 covers the DB template; source-text spec, not review               |
| `convertedAt` pollution silently corrupts the funnel forever                                 | High | Med      | R4 — new column, and the existing comp path corrected in the same change                                 |
| Cohort key `founding` resolved by `isDefault` and silently retargeted later                   | Low | High     | R1.5 — resolve by `key`, hard-fail if absent, no fallback                                                |
| Editing an applied migration forces a dev-database reset                                     | Low | High     | R10 — new migration only; asserted by criterion 10.3                                                     |
| Approved member's access expires mid-programme                                               | Low | High     | `1y` preset (`context.md` decision); the two-week cohort ends ~50 weeks before expiry                    |

---

## Clarifications Needed

Three founder decisions. None blocks architecture from starting on R1–R8; all three must be answered before the corresponding batch is implemented.

### 1. Disposition of the `Founding / Waitlist Invite` marketing template (R10)

The DB-seeded campaign template still carries the 70% pitch and is independently mailable from the admin marketing sender.

- **Option A (Recommended)** — Rewrite the row's subject and body to the free founding-cohort copy. The campaign sender keeps a usable founding template, and the offer is stated once, consistently, in both the transactional and the campaign channel.
- **Option B** — Delete the row. Nothing can mail it by accident, but the marketing sender loses its only founding template and the next campaign starts from a blank body.
- **Option C** — Leave it, on the grounds that it is only reachable deliberately. Rejected in the recommendation: "only reachable deliberately" is exactly how the current invite wave got sent.

### 2. Does `POST /v1/admin/waitlist/invite` go away entirely? (R3, R9)

- **Option A (Recommended)** — Delete the endpoint, `WaitlistService.inviteBatch` (`waitlist.service.ts:144-186`), the invite modal and the `waitlist.invite` audit action's future use. Approval is the only path out of the waitlist. Two workflows is the defect being fixed; keeping a mailer alive next to it re-opens the door.
- **Option B** — Keep the endpoint but repoint it at a content-free "the founding cohort opens soon, watch this inbox" heads-up, sent before approval. Costs a second template and a second mail per member for a message approval already delivers.
- **Option C** — Keep it dormant and unwired from the UI. Rejected: an endpoint with no caller and a paid-invite mailer behind it is a loaded gun in the repository.

### 3. Access after the two-week cohort — what does the welcome mail promise? (R3)

The `1y` licence is already decided; this is about what the email **says**, which is the part members will hold you to.

- **Option A (Recommended)** — "Your access runs through <date one year out>." Concrete, matches the licence exactly, and makes "founding member" mean something once checkout opens.
- **Option B** — "Your access continues after the cohort ends; we'll tell you well before anything changes." Softer, keeps room to extend or convert, but a member who later checks their licence sees a date the mail never gave them.
- **Option C** — Say nothing about duration. Rejected: silence about duration on a free grant is the question every recipient will ask first.
