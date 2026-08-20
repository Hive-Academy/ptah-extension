# api-community

Member-facing community surface carved out of `apps/ptah-license-server`:
member cohorts, Builders sessions (Google Calendar), the packs registry, and
Circle provisioning.

Depends on `@ptah-api/core`, `@ptah-api/identity`, `@ptah-api/audit`.

## Why these four directories are ONE lib — and why that reason is now GONE

`member-groups/`, `google-sessions/`, `packs/` and `circle/` could each look
like a domain of its own. They are still co-located, but **the constraint that
forced it has been removed** and this section records that so the next reader
does not mistake inertia for a rule.

A fifth directory used to sit here: the external-forum integration deleted by
TASK_2026_177 P1b. It and `member-groups/` referenced **each other**, and Nx
forbids a dependency cycle between projects — so splitting them would have made
the workspace ungraphable, not merely untidy. The coupling was bidirectional and
load-bearing in both directions: the provisioning fan-out resolved a member's
cohort to pick the forum group to sync, and assigning a cohort re-ran
provisioning so group membership followed.

**There was never a NestJS module cycle**, and that is the part worth carrying
forward. Both modules were `@Global()`, so their exported services resolved
through the global provider scope and never imported each other. The cycle
existed only at the _file_ level — which is exactly the level Nx's project graph
reads. `@Global()` hid the coupling from Nest, but not from Nx.

With that directory deleted, the cycle is gone: `google-sessions/` still reads
`member-groups.service` (cohort-scoped session events), but nothing reads back.
The remaining four are a plain one-way graph, which is what makes **AD-6's lib
split possible** — the split is now a free choice about cohesion rather than
something the graph forbids. When it happens, the shape is the same as the
auth↔license break solved by `@ptah-api/identity`: extract the shared piece
(cohort resolution) into a lib both can depend on.

## Running unit tests

Run `nx test api-community` to execute the unit tests via [Jest](https://jestjs.io).
