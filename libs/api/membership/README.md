# api-membership

The **single** definition of "is this person a paid Ptah Builders member", plus
the cohort lookup and the request guard that resolve it once per request.

Depends on `@ptah-api/core` (`PrismaService`) and `@ptah-api/identity`
(`RequestUser`, the `req.user` shape `JwtAuthGuard` populates). Both are
`type:util`, which is what this lib's own `type:util` tag requires — a
`type:feature` collaborator would fail `@nx/enforce-module-boundaries`.

## Why this is a LIB and not a directory

`isBuildersMember` used to exist three times: once in a
`BuildersMembershipService` inside the external-forum integration directory,
once inline in `google-sessions/members.controller.ts`, and once inline in the
forum SSO controller beside the first. Three copies of one security predicate is
how the definition of "paid member" drifts.

The obvious fix — one service inside `libs/api/community` — would not have
survived the work that followed it. That whole directory was **deleted
wholesale** by TASK_2026_177 P1b, and a shared service living inside a doomed
directory has to be remembered and rescued by hand at deletion time. That is a
procedural guarantee, and procedural guarantees are exactly what fail during a
large deletion.

**The deletion has since happened, and this lib was not touched by it** — which
is the design working. Two of the three implementations died with their
directory; this one is the survivor, and R7.2's gate (`rg 'isBuildersMember'`
finds exactly one implementation) holds because of where it lives, not because
anyone remembered to move it.

Putting the definition in a **different Nx project** makes its survival
**structural rather than procedural** (RK-4): `rm -rf` on that directory cannot
reach it, the dependency direction is enforced by the project graph, and
`nx graph` shows the surviving edge. That is the entire reason for the extra
`project.json`.

## What is in here

| File                         | Role                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `membership.types.ts`        | `MemberContext` + the `req.memberContext` Express augmentation                     |
| `membership.service.ts`      | THE `isBuildersMember` — subscription first, then a non-expired `builders` license |
| `cohort-resolver.service.ts` | `MemberGroupAssignment` → the member's cohort keys                                 |
| `guards/member.guard.ts`     | Runs after `JwtAuthGuard`; resolves the context ONCE and attaches it               |
| `membership.module.ts`       | `@Global()`; must be registered before every consumer                              |

## The two predicates are deliberately separate (A-2)

**Entitlement** — "may this person enter `/members` at all" — comes from
`License` / `Subscription` and from nothing else. **Cohort** — "which gated
content do they see" — comes from `MemberGroupAssignment`.

Fusing them would mean a member whom an admin forgot to place in a cohort gets
_denied access_ instead of _seeing less content_. So an entitled member with
zero assignments resolves to `cohortKeys: []`, is allowed through the guard, and
sees every `member`-visibility surface (R7.8). Empty is normal, never an error.

## Admin is NOT a membership shortcut

`MemberContext.isAdmin` is informational — it exists so a member-facing response
can render an admin affordance. It is resolved in `MemberGuard` **after** the
entitlement decision has already been made and enforced, so `isBuildersMember ||
isAdmin` is not merely discouraged here, it is unreachable. Admin surfaces keep
their own separate authorized path (`AdminGuard` + `ADMIN_EMAILS`), which is the
invariant `apps/ptah-license-server/src/admin/admin-guards.spec.ts` G4 asserts.

Consequently `membership.service.ts` contains no reference to `ADMIN_EMAILS`,
`AdminGuard` or `isAdmin`, exactly as its predecessor did not.

## Usage

```ts
@Controller('v1/members/<literal>')
@UseGuards(JwtAuthGuard, MemberGuard) // order matters — JwtAuthGuard first
export class SomeMemberController {
  @Get()
  handle(@Req() req: Request) {
    const ctx = req.memberContext; // resolved ONCE, by the guard
  }
}
```

Never re-derive entitlement or cohort keys inside a service (R7.3). The guard is
the single server-side enforcement point (NFR-S8); a controller cannot forget to
apply it without also losing `req.memberContext`.
