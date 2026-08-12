# api-contracts-community

`@ptah-contracts/community` — the wire contracts for the native community
platform (TASK_2026_177). Member and admin request/response shapes for the
forum, courses, live and private sessions, packs and notifications.

**Type-only, plus Zod where a runtime boundary exists.** No NestJS, no Prisma,
no Angular, no Node globals, no other workspace lib.

## Why this lib exists

Two reasons, and both are structural rather than organisational.

### 1. It is the one legitimate bridge between `scope:api` and `scope:web`

`eslint.config.mjs` pre-declared a `scope:api-contracts` tag with **zero
projects using it**. Its constraint is:

```js
{ sourceTag: 'scope:api-contracts', onlyDependOnLibsWithTags: ['scope:api-contracts'] }
```

Since this is the only project carrying the tag, that constraint makes it a pure
leaf: it may depend on nothing. Meanwhile `scope:api`, `scope:web`, `scope:app`
and `scope:landing` are all permitted to depend on `scope:api-contracts`. That
asymmetry is the whole design — the license server and the member panel can each
import the same declaration of a response shape without either becoming
reachable from the other. This lib is that tag's first consumer.

### 2. It makes the member/admin split a compile-time property (RK-8)

The precedent it inverts is in
`libs/api/community/src/lib/google-sessions/google-sessions.types.ts`:

```ts
export interface AdminSession extends BuildersSession { … }
```

That docblock is unusually candid about why the two are separate types at all:
`description` and `attendees` are admin-only **specifically** so that widening
the member-facing response cannot leak every other member's email address. The
inheritance is safe there only because `BuildersSession` — the base — is frozen,
and nothing structural enforces that freeze.

This task authors six such pairs across five phases. At that count, "please
re-declare admin fields rather than extending" is not a convention anyone will
hold. So it is not a convention here:

> **`member/` and `admin/` never reference each other, in either direction, with
> no exceptions.** No import, no re-export, no `import type`, no
> `import('…')` type, no bare string literal that resolves across. You cannot
> `extend`, intersect, `Omit`, `Pick` or alias a type you cannot name.

`src/lib/contract-boundary.spec.ts` fails the build on any violation. Five
rules, each closing the way around the previous one:

| Rule         | What it forbids                                          | Why it is not redundant                                                                                                                    |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `R-CONTAIN`  | any reference from `member/` to `admin/` or back         | The load-bearing one. You cannot `extend`, intersect, `Omit`, `Pick` or alias a type you cannot name.                                      |
| `R-LEAF`     | `shared/` referencing `member/` or `admin/`              | Without it, `shared/x.ts` re-exports `MemberPack`, `admin/` imports it from `shared/`, and `R-CONTAIN` sees only a legal edge.             |
| `R-HERITAGE` | `extends`/`implements` naming a type from the other side | Unreachable in practice thanks to `R-CONTAIN`, and asserted anyway so the failure says _inheritance_ when someone tries.                   |
| `R-NOTES`    | a property named exactly `notes` under `member/`         | R5.2 / NFR-S5. `Pack.notes` is admin-internal; `MemberPack.accessNote` (R5.5) is the different, member-audience field.                     |
| `R-BARREL`   | any declaration in `src/index.ts`                        | The barrel sits outside `src/lib/`, so the scan never sees it, and it is the one file that legitimately names both sides. Re-exports only. |

A sixth assertion keeps the scan honest: nothing may sit loose under `src/lib/`
except `*.spec.ts`, because a file outside the three directories would be
covered by no rule at all — the analysis would quietly stop applying rather
than fail.

That spec's anti-vacuity block is load-bearing: the real tree contains zero
heritage clauses, so the inheritance rule would pass no matter what the analyser
did. Fabricated sources are pushed through the same function to prove it flags
each evasion — and, in the negative control, that it does _not_ flag the legal
shapes.

## Layout

```
src/
  index.ts                         the barrel; the only place all three
                                   directories meet, and it only re-exports
  lib/
    shared/                        vocabularies both sides may import.
      visibility.ts                Visibility (R1.1.1), MemberCohortBadge
      reaction-type.ts             the fixed four (R1.4.3), ReactionCounts
      notification-kind.ts         the five kinds + target types (R10, §1.6)
      session-request-status.ts    the four lifecycle states (R4)
      paged.ts                     Paged<T> + the NFR-P5 caps
    member/                        member-facing payloads
    admin/                         admin-facing payloads, re-declared
    contract-boundary.spec.ts      the rule, as an executable artefact
```

**`shared/` holds vocabularies, never payloads.** A string union has no fields,
so sharing one cannot widen either response — that is the test for whether
something belongs there. An object type is a payload: it lives on its own side
and is re-declared on the other.

`shared/` is itself forbidden from referencing `member/` or `admin/`. Without
that rule, `shared/x.ts` could re-export `MemberPack` and `admin/` could import
it from there, satisfying the containment rule while defeating its purpose.

### Two deliberate departures from plan §2.10's sketch

- **`Paged<T>` is in `shared/paged.ts`, not `member/paged.contract.ts`.** It is
  the envelope for _every_ list endpoint, admin ones included. Leaving it under
  `member/` would force the boundary spec to carry an allowlist exception for
  `admin/* → member/paged.contract`, and an exception is the first crack in a
  rule whose entire value is that it has none.
- **`SessionRequestStatus` is in `shared/`** for the same reason: both the
  member contract and the admin contract need it.

## Phase 1 scope, and who adds what next

Phase 1 declares the hub envelope and the section payloads it references.
Fuller per-surface types land in their own phase's batch, **in the file that
already exists here** — the directories and the rule exist now so nothing lands
outside them later.

| Contract                                                                                                      | Status    | Owner            |
| ------------------------------------------------------------------------------------------------------------- | --------- | ---------------- |
| `MemberHubResponse`, `HubSection`, `MemberEntitlementResponse`                                                | done (P1) | Batch 2          |
| `HubTopicSummary`, `ContinueLearning`, `HubSessionSummary`, `HubNotificationSummary`, `MemberPack`            | done (P1) | Batch 2          |
| `MemberSessionRequest` / `AdminSessionRequest`, `AdminPack`                                                   | done (P1) | Batch 2          |
| `MemberCategory`, `MemberTopicSummary`, `MemberTopicDetail`, `MemberPost` → `member/member-topic.contract.ts` | pending   | Batch 6 (P2-BE)  |
| `admin/admin-topic.contract.ts`                                                                               | pending   | Batch 6 (P2-BE)  |
| `MemberCourseSummary`, `MemberCourseDetail`, `MemberLessonDetail` → `member/member-course.contract.ts`        | pending   | Batch 9 (P3-BE)  |
| `admin/admin-course.contract.ts`                                                                              | pending   | Batch 9 (P3-BE)  |
| `LiveFeedItem` → `member/member-live.contract.ts`                                                             | pending   | Batch 12 (P4-BE) |
| `admin/admin-live.contract.ts`                                                                                | pending   | Batch 12 (P4-BE) |

The three pending `admin/*` files are **not** scaffolded empty. A file with no
declarations is a placeholder, and this repo does not ship placeholders; the
table above is the manifest, and the boundary spec applies to whatever lands.

## The hub envelope is frozen

`MemberHubResponse` declares all five sections in Phase 1, even though four of
them report `'empty'` until their phase lands. R6.6 is only satisfiable if the
shape never changes — later phases change _which sections report `'ok'`_, never
the envelope, and never the request count (R6.2, asserted as an e2e
network-count test written in Phase 1 and re-run unchanged thereafter).

Additive growth happens **inside** a section's payload type, never on
`sections`. `HUB_SESSION_KINDS` is the pattern: it declares `'live'` and
`'private'` in Phase 1 although Phase 1 only ever emits `'calendar'`, so Phase 4
adds data rather than a discriminant.

## Running the checks

```bash
npx nx eslint:lint api-contracts-community   # boundary tag + rules
npx nx typecheck api-contracts-community
npx nx test api-contracts-community          # the boundary spec
```
