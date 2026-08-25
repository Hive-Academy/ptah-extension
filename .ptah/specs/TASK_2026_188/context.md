# Context — TASK_2026_188

## The failure shape

`@IsOptional()` does not mean "may be omitted". It means "skip every validator
on this property when the value is `null` **or** `undefined`". On a field
declared `title?: string`, an explicit `{"title": null}` does not merely satisfy
`@IsString()`, `@MinLength()` and `@MaxLength()` — those decorators are **never
run**. The `null` then reaches a service typed as though it cannot exist and
fails there, below the HTTP boundary, as an unhandled exception.

Measured live against the running server during TASK_2026_177 Phase 2:

```
PATCH …/topics/:id       {"title":null}       -> 500
PATCH …/categories/:id   {"visibility":null}  -> 500
```

Twelve fields across five forum DTOs behaved this way and Batch 6.1 swept them.
A `null` on a write path must be a `400` at worst; a `500` is the raw,
uncontrolled failure NFR-S7 exists to prevent, and in a log it is
indistinguishable from a real outage.

The whole analysis is already written down, at length, in the header of
`libs/api/community/src/lib/live-sessions/common/optional-field.ts`.
Read that file before touching anything here.

## Why every one of these is reachable

`libs/api/core/src/lib/common/dto-validation.pipe.ts` is the mechanism, and its
docblock is the authority:

> ⚠️ EVERY `@Body()` / `@Query()` payload param MUST bind `dtoPipe(TheDto)`.
> A bare `@Body() dto: X` is SILENTLY UNVALIDATED.

The reason is that this app is bundled by `@nx/esbuild`, and **esbuild does not
implement `emitDecoratorMetadata`**. Without `design:paramtypes`, Nest's global
`ValidationPipe` in `main.ts` gets `metatype === undefined` and short-circuits on
its first line, so every class-validator decorator in the server is inert.
`dtoPipe` restores validation by passing `expectedType` explicitly.

That cuts both ways here. `dtoPipe` is what makes the length caps, the
`@IsUUID` checks and `forbidNonWhitelisted` live — and it is also what makes
`@IsOptional()`'s null hole live. Every DTO class in the census below was
confirmed present in a `dtoPipe(...)` binding in a controller under `libs/api`,
so each field is an input an external caller can actually set to `null`. This is
not a tidiness exercise.

A concrete, citable instance —
`libs/api/community/src/lib/packs/packs.service.ts:165`:

```ts
if (input.slug !== undefined) data.slug = input.slug;
```

`null !== undefined`, so `PATCH /api/v1/admin/packs/:id` with `{"slug": null}`
writes `data.slug = null` into a Prisma update against a `NOT NULL` column. Same
line-shape at `:172` for `tags`.

Note the honest counter-example in the same file: `query.search` is used as
`...(query.search ? { OR: […] } : {})`, so `{"search": null}` degrades benignly
rather than throwing. **The 500 is the common outcome, not a universal one.**
Treat "unvalidated null reaches typed code" as the defect; do not promise a 500
per field in a report without checking the consumer.

## The convention already exists — do not invent one

`libs/api/community/src/lib/live-sessions/common/optional-field.ts`, and its two
sibling re-declarations at `libs/api/forum/src/lib/common/optional-field.ts` and
`libs/api/learning/src/lib/common/optional-field.ts`, export the settled answer.

**`IsOptionalNotNull()` — the default.** Wraps
`ValidateIf((_o, value) => value !== undefined)`. `@ValidateIf` gates the whole
property: an omitted key validates vacuously, and a present key — _including_
`null` — is judged by the `@IsString()` / `@IsInt()` / `@IsBoolean()` already on
the field, so the 400 names the property and the expected type.

**`NullMeansAbsent()` — narrow.** A `@Transform` that maps `null` to `undefined`,
for the rare field where `null` and absent genuinely denote the same thing. Say
so at the call site. It is not a general softener: on
`UpdateLiveSessionDto.title` it would turn "clear the title" into "change
nothing", a request that looks honoured and is not.

**`@IsOptional()` — the exception, and it now needs a census entry.** Keep it
only where the declared type really admits `null` (`?: string | null`), i.e.
where `null` is a real value meaning "clear this column".

Two things the file already rules out, so nobody re-litigates them:

- Adding an explicit "not null" validator **alongside** `@IsOptional()` does not
  work. `@IsOptional()` short-circuits the property before any sibling validator
  is consulted, so the new one never runs.
- The three copies are a deliberate re-declaration, not an import
  (ASSUMPTION-11). Each lives in a `common/` its own module spec asserts is
  **not** barrel-exported; widening a public barrel for two decorators was
  judged the worse trade. A fourth copy for the libs this task touches is the
  consistent move — but see the open question below.

The enforcement half is `nullable-dto.spec.ts`, of which three copies exist:

| Spec                                                                   | Scan root                                                                                          | Guards                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `libs/api/forum/src/lib/common/nullable-dto.spec.ts`                   | `forum/src/lib` — lib-wide                                                                         | all forum DTOs                                |
| `libs/api/learning/src/lib/common/nullable-dto.spec.ts`                | `learning/src/lib` — lib-wide                                                                      | all learning DTOs                             |
| `libs/api/community/src/lib/live-sessions/common/nullable-dto.spec.ts` | `live-sessions/` **plus** `google-sessions/dto/`, with `admin-session.dto.ts` excluded **by name** | live-sessions + new google-sessions DTOs only |

That third row is Batch 12's F-8, and the by-name exclusion is the debt marker
this task closes. `libs/api/admin`, `libs/api/identity`, `libs/api/licensing`,
`libs/api/marketing`, `libs/api/billing` and `community/{packs,member-groups}`
are guarded by **nothing**.

## The verified census

Counted from source on 2026-08-09, not copied from Batch 12. Method: every
`^\s*@IsOptional()` in `libs/api/**/*.dto.ts`, paired with the property
declaration that follows it, classified by whether the declared type admits
`null`.

```
70  @IsOptional() decorators in libs/api
11  sit on a nullable declared type  -> legitimate, census entries
59  do not                            -> defects
```

### The three files Batch 12 named — 36 decorators, 30 defects

**`libs/api/community/src/lib/google-sessions/dto/admin-session.dto.ts` — 12 of 12 are defects**

| Class                  | Fields                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `ListSessionsQueryDto` | `daysAhead`                                                                                 |
| `CreateSessionDto`     | `description`, `createMeetLink`, `attendees`                                                |
| `UpdateSessionDto`     | `title`, `description`, `startsAt`, `endsAt`, `createMeetLink`, `attendees`, `notifyGuests` |
| `SendInvitationsDto`   | `attendees`                                                                                 |

Not one field in this file declares a nullable type. `UpdateSessionDto` is the
`PATCH /v1/admin/sessions/:eventId` body Batch 12 flagged for a live re-check.

**`libs/api/community/src/lib/member-groups/dto/member-group.dto.ts` — 10 of 12 are defects**

| Class                      | Defect fields                                | Legitimate (`\| null`)          |
| -------------------------- | -------------------------------------------- | ------------------------------- |
| `CreateMemberGroupDto`     | `description`, `sessionEventId`, `isDefault` | —                               |
| `UpdateMemberGroupDto`     | `name`, `isDefault`                          | `description`, `sessionEventId` |
| `AssignMembersDto`         | `userIds`, `emails`                          | —                               |
| `ListGroupMembersQueryDto` | `page`, `pageSize`, `search`                 | —                               |

⚠️ The `UpdateMemberGroupDto` docblock currently _documents_ the null hole as
intended behaviour ("`@IsOptional()` skips validation for both `null` and
`undefined`"). For `description` and `sessionEventId` that is correct and stays.
For `name` and `isDefault` the same sentence is covering a defect. Rewrite the
docblock in the same change; leaving it is worse than the decorator.

**`libs/api/community/src/lib/packs/dto/pack.dto.ts` — 8 of 12 are defects**

| Class               | Defect fields                                     | Legitimate (`\| null`) |
| ------------------- | ------------------------------------------------- | ---------------------- |
| `ListPacksQueryDto` | `search`, `cohortKey`                             | —                      |
| `CreatePackDto`     | `tags`                                            | `notes`, `cohortKey`   |
| `UpdatePackDto`     | `slug`, `title`, `description`, `repoUrl`, `tags` | `notes`, `cohortKey`   |

Same docblock problem on `UpdatePackDto`.

### What Batch 12 did not count — 34 decorators, 29 defects

None of these libs has a `nullable-dto.spec.ts` of any kind.

| File                                                                        | Defect fields                                                                                                          | n   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --- |
| `libs/api/admin/src/lib/admin.dto.ts`                                       | `ListQueryDto`: `page`, `pageSize`, `sortBy`, `sortOrder`, `search`, `filter`; `InviteWaitlistDto`: `ids`, `batchSize` | 8   |
| `libs/api/admin/src/lib/dto/delete-user.dto.ts`                             | `acknowledgePaidSubscription`                                                                                          | 1   |
| `libs/api/identity/src/lib/dto/magic-link.dto.ts`                           | `returnUrl`, `plan`                                                                                                    | 2   |
| `libs/api/identity/src/lib/dto/signup.dto.ts`                               | `firstName`, `lastName`                                                                                                | 2   |
| `libs/api/licensing/src/lib/license/dto/create-license.dto.ts`              | `sendEmail`                                                                                                            | 1   |
| `libs/api/licensing/src/lib/license/dto/issue-complimentary-license.dto.ts` | `userId`, `email`, `customExpiresAt`, `sendEmail`, `stackOnTopOfPaid`                                                  | 5   |
| `libs/api/marketing/src/lib/contact/dto/contact-message.dto.ts`             | `category`                                                                                                             | 1   |
| `libs/api/marketing/src/lib/marketing/dto/save-template.dto.ts`             | `variables`                                                                                                            | 1   |
| `libs/api/marketing/src/lib/marketing/dto/send-campaign.dto.ts`             | `templateId`, `subject`, `htmlBody`, `segment`, `userIds`                                                              | 5   |
| `libs/api/marketing/src/lib/session/dto/session-request.dto.ts`             | `additionalNotes`, `paddleTransactionId`                                                                               | 2   |
| `libs/api/marketing/src/lib/waitlist/dto/join-waitlist.dto.ts`              | `source`                                                                                                               | 1   |

🔴 `SignupDto`, `MagicLinkDto`, `JoinWaitlistDto`, `ContactMessageDto` and
`SessionRequestDto` are **unauthenticated** surfaces. Everything Batch 12 named
is behind `AdminGuard`. This half of the census is the more exposed half, and it
is the half nobody had counted.

`ListQueryDto` in `libs/api/admin` is the generic admin list envelope bound
across several admin controllers, so its 6 fields are one edit with a wide
footprint — the cheapest ratio in the whole census.

### The 11 legitimate entries — leave these alone

| File                                                | Field                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `community/…/member-groups/dto/member-group.dto.ts` | `UpdateMemberGroupDto.description`, `UpdateMemberGroupDto.sessionEventId`                          |
| `community/…/packs/dto/pack.dto.ts`                 | `CreatePackDto.notes`, `CreatePackDto.cohortKey`, `UpdatePackDto.notes`, `UpdatePackDto.cohortKey` |
| `forum/…/categories/dto/create-category.dto.ts`     | `description`                                                                                      |
| `forum/…/categories/dto/update-category.dto.ts`     | `description`                                                                                      |
| `learning/…/courses/dto/update-course.dto.ts`       | `coverImageUrl`                                                                                    |
| `learning/…/courses/dto/update-module.dto.ts`       | `description`, `releaseAt`                                                                         |

The forum and learning five are already enumerated in their libs' existing
census arrays. The community six are not enumerated anywhere yet — adding them
to a census is part of this task, not a side effect of it.

## How far Batch 12 was off

Batch 12's closing note said "**~30** pre-F-2 `@IsOptional()` fields remain in
`packs/`, `member-groups/` and `google-sessions/dto/admin-session.dto.ts`", and
sized the fix at "~30 decorator swaps plus a live re-check of
`PATCH /v1/admin/sessions/:eventId`".

- For those three files the estimate is **exactly right on defects**: 30. It was
  low on total decorators (36) because six of them are legitimate nullables that
  must be _kept_ and _censused_ rather than swapped.
- Workspace-wide it is **48% of the real number**. 59 defects, not 30. The
  missing 29 live in four libs the batch had no reason to look at.
- The estimate also omits the enforcement half. ~30 swaps is the easy part; the
  `nullable-dto.spec.ts` roots and the census arrays are what stop this coming
  back, and Batch 12's own F-8 exists precisely because a re-rooting decision was
  deferred.

## Open question the implementer must decide first

**How many more copies of `optional-field.ts` and `nullable-dto.spec.ts`?**

The current shape is one pair per lib (`forum`, `learning`) plus one re-rooted
pair inside `community/live-sessions`. Closing this census touches
`community` (three more directories), `admin`, `identity`, `licensing` and
`marketing`. Four more verbatim copies of a ~90-line decorator file is where
ASSUMPTION-11's "duplication beats widening a barrel" argument stops being
obviously right.

Two candidates, and this is a decision to make deliberately rather than by
momentum:

- **Copy per lib**, consistent with today and with ASSUMPTION-11. Cheap,
  mechanical, and makes seven copies.
- **Promote to `libs/api/core`**, which already owns `dtoPipe` — the sibling
  server-wide validation primitive — and is already imported by every one of
  these controllers. This is the one lib where the "widening a public barrel"
  objection does not apply, because the barrel is already wide and already
  carries exactly this kind of thing. It would mean collapsing three existing
  copies, which is a larger diff than this task otherwise needs.

Get a decision before writing code. Do not half-do it.

## Acceptance

- All 59 defect fields converted to `IsOptionalNotNull()` (or, where argued at
  the call site, `NullMeansAbsent()`).
- All 11 legitimate nullable fields still on `@IsOptional()` and enumerated in a
  census that a spec asserts against the real tree.
- A `nullable-dto.spec.ts` (however many copies the decision above lands on)
  whose scan roots cover **every** `*.dto.ts` under `libs/api`, with no
  by-name exclusions left. The `admin-session.dto.ts` exclusion in
  `community/…/live-sessions/common/nullable-dto.spec.ts` is deleted, not
  widened.
- The `UpdatePackDto` and `UpdateMemberGroupDto` docblocks rewritten — both
  currently describe the null hole as the design.
- Live re-check of `PATCH /api/v1/admin/sessions/:eventId` with
  `{"title": null}` returning `400` with the property named, per Batch 12's
  sizing note.
- Spot-check the two unauthenticated surfaces too: `POST /api/v1/auth/signup`
  with `{"firstName": null}` and `POST /api/v1/waitlist` with
  `{"source": null}`.

## Notes

- The database was reset between Batch 11 and Batch 12 (`TASK_2026_177` F-3).
  Any live check needs `nx run ptah-license-server:seed-community` re-run and a
  dev user re-created first.
- `@IsOptional()` → `IsOptionalNotNull()` does **not** change whitelisting
  behaviour. `dtoPipe` runs `whitelist: true`, which strips properties carrying
  no validation metadata; `@ValidateIf` registers metadata of its own, so the
  field survives the whitelist exactly as before. Stated here because it is the
  first thing that looks like it might break.
- `libs/api/billing` has zero `@IsOptional()` decorators. It needs a scan root
  for the future, not a sweep.
