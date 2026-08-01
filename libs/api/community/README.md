# api-community

Member-facing community surface carved out of `apps/ptah-license-server`:
Discourse SSO + provisioning, member cohorts, Builders sessions (Google
Calendar), the packs registry, and Circle provisioning.

Depends on `@ptah-api/core`, `@ptah-api/identity`, `@ptah-api/audit`.

## Why these five directories are ONE lib

`discourse/`, `member-groups/`, `google-sessions/`, `packs/` and `circle/`
could each look like a domain of its own. They are co-located because
**`discourse` and `member-groups` reference each other**, and Nx forbids a
dependency cycle between projects — splitting them would make the workspace
ungraphable, not merely untidy.

The coupling is bidirectional and load-bearing:

- `discourse/discourse-provisioning.service.ts` → `member-groups/member-groups.service`
  (the provisioning fan-out resolves a member's cohort to pick the Discourse
  group to sync)
- `member-groups/member-groups.controller.ts` → `discourse/discourse-provisioning.service`
  (assigning a cohort re-runs provisioning so group membership follows)

`google-sessions/` also reads `member-groups.service` (cohort-scoped session
events), which pins it to the same side of the boundary.

**There is no NestJS module cycle.** `DiscourseModule` and `MemberGroupsModule`
do not import each other — both are `@Global()`, so their exported services
resolve through the global provider scope. The cycle exists only at the _file_
level, which is exactly the level Nx's project graph reads. That is the
distinction worth remembering: `@Global()` hid the coupling from Nest, but not
from Nx.

If these ever need separating, the break has the same shape as the auth↔license
one solved by `@ptah-api/identity`: extract the shared piece (cohort resolution)
into a lib both can depend on, rather than having them depend on each other.

## Running unit tests

Run `nx test api-community` to execute the unit tests via [Jest](https://jestjs.io).
