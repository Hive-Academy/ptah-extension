# api-member-hub

`@ptah-api/member-hub` — the two endpoints the `/members` panel needs before it
can render anything:

| Endpoint                          | Guards                        | Answer                                                |
| --------------------------------- | ----------------------------- | ----------------------------------------------------- |
| `GET /api/v1/members/entitlement` | `JwtAuthGuard`                | `{ entitled, cohorts, isAdmin }` — **200, never 403** |
| `GET /api/v1/members/hub`         | `JwtAuthGuard`, `MemberGuard` | `MemberHubResponse` — five sections, one request      |

Wire types come from `@ptah-contracts/community` and are **not** re-exported
here. Entitlement and cohort resolution come from `@ptah-api/membership` and are
**not** re-implemented here.

## The two things this lib exists to get right

### 1. `Promise.allSettled`, not `Promise.all` (AD-4, R6.4)

The hub is one request returning five sections. `Promise.all` rejects on the
first rejection and throws away the four results that succeeded — so a single
failing section blanks the member's home screen. That is the exact outcome R6.4
forbids, and it is why plan AD-4 also rejected the one-big-denormalised-query
alternative: a single SQL statement spanning six domains fails whole.

`MemberHubService.compose` therefore fans out with `allSettled` and turns a
rejected resolver into `{ status: 'unavailable', data: <empty shape> }` inside a
`200`. The rejection reason is logged and dropped — it may name tables, columns
and connection strings (NFR-S7).

`member-hub.service.spec.ts` forces each of the five resolvers to reject in turn
and requires the other four to come back intact. **`Promise.all` cannot pass
that test**, which is what stops the choice regressing in a later phase.

### 2. The envelope is frozen for all five phases (R6.6)

All five sections are declared now, in Phase 1, even though only `sessions` is
populated:

| Section         | Phase 1                                         | Filled by            |
| --------------- | ----------------------------------------------- | -------------------- |
| `sessions`      | **populated** from Google Calendar              | extended by Batch 12 |
| `learning`      | `{ status: 'empty', data: null }`               | Batch 9              |
| `community`     | `{ status: 'empty', data: [] }`                 | Batch 6              |
| `packs`         | `{ status: 'empty', data: [] }`                 | Batch 14             |
| `notifications` | `{ status: 'empty', data: { unreadCount: 0 } }` | Batch 14             |

Declaring them late would make every phase an envelope change. Declaring them
now makes every phase a **data** change: one new `*.section.ts`, one constructor
parameter and one line in the composer. The client still issues exactly one
request, which R6.2 asserts as an e2e network-count test written in Phase 1 and
re-run unchanged afterwards.

`'empty'` and `'unavailable'` are **not** interchangeable. "You have no unread
topics" and "the forum is down" are different messages. The four unfilled
sections are `'empty'` — nothing has failed, the tables simply do not exist yet.

## Why the entitlement probe is not behind `MemberGuard`

`MemberGuard` answers a non-member with `403 { reason: 'membership_required' }`.
That is right for every surface serving member content and wrong for a probe
whose job is to _report_ the answer. The frontend guard has to tell three states
apart:

```
401                        → not logged in     → /login?returnUrl=…
200 { entitled: false }    → logged in, unpaid → the upgrade surface
200 { entitled: true, … }  → member            → render /members
```

R7.7 forbids answering the middle case with an empty panel or a raw `403`.
Encoding it as a `200` body means the client never parses an exception body to
make a navigation decision.

The probe is hit on **every** `/members/*` navigation, so it composes nothing:
at most the entitlement lookup, one cohort-assignment read, and one cohort-name
read that is skipped entirely for a member with no cohorts. A non-member costs
the entitlement lookup alone.

## Zero cohorts is the normal case, not an edge case

`member_group_assignments` is empty in the live database. An entitled member with
no assignment resolves to `cohortKeys: []`, is allowed through the guard, sees
every `member`-visibility surface and matches no `cohort`-gated content (R7.8,
A-2). `[]` is a success value on both endpoints and never an error path —
conflating entitlement with cohort would lock every paying member out.

## Files

| File                               | Role                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| `member-entitlement.controller.ts` | the probe; `JwtAuthGuard` only                                        |
| `member-hub.controller.ts`         | `GET v1/members/hub`; class-level `JwtAuthGuard`, `MemberGuard`       |
| `member-hub.service.ts`            | the `Promise.allSettled` composer + the `member` greeting block       |
| `cohort-badges.service.ts`         | cohort **keys** → `{ key, name }` badges; never re-derives membership |
| `sections/hub-section.ts`          | the resolver port + the shared empty shapes                           |
| `sections/*.section.ts`            | one resolver each; one public `resolve(ctx)` method                   |

`CohortBadgesService` deliberately does **not** call
`MemberGroupsService.getGroupsForUser`, which would have been shorter: that
method re-reads `member_group_assignments` and so answers "which cohorts is this
member in" a second time. One predicate, one implementation — the same rule that
produced `@ptah-api/membership`.

## Registration order matters

`MemberHubModule` must be imported **after** `MembershipModule` (`@Global`, R7.3)
and after `GoogleSessionsModule`. The first is load-bearing — a global module's
providers exist only once it has been instantiated. The second costs only the
`sessions` card, because `SessionsSection` takes `SessionsService` with
`@Optional()`.

## Adding a Phase-N section

1. Add `sections/<name>.section.ts` implementing `HubSectionResolver<T>`.
2. Add it to `MemberHubModule`'s `providers`.
3. Add a constructor parameter, an entry in the `allSettled` tuple and one
   `unwrap` line in `MemberHubService`.

The envelope, the controller and the client do not change. The resolvers are
injected **by name** rather than as an array so that step 3 is a compile error
until it is done — an injected array would silently compose N−1 sections and
ship an envelope with a missing key.
