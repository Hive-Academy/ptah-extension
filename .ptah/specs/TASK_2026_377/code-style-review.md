# Code style and structure review

**Score:** 6.5/10  
**Verdict:** NEEDS CHANGES

## Findings

HIGH — `libs/web/admin/src/lib/builders/community/community-moderation.ts:169` — The route component now owns three feature-sized concerns: moderation queue state, category CRUD/reorder state, and new-thread form state; the result is 864 lines of TypeScript, an 887-line template, and a 772-line coupled spec — six months from now, a change to any one workflow will require navigating and retesting one shared state machine, while the course surface beside it already demonstrates the house pattern of extracting focused standalone OnPush components — extract a category-management component and a new-thread modal/component with typed inputs/outputs; keep `CommunityModeration` as the smart route orchestrator that refreshes the shared category and topic data.

MEDIUM — `libs/api/forum/src/lib/topics/topics.service.ts:507` — `createAsAdmin()` duplicates the member `create()` slug-allocation loop, collision retry, topic insert, and opening-post insert instead of reusing one persistence path — later changes to slug policy, opening-post invariants, selected columns, or error mapping must be made twice and can silently diverge between member and admin authoring — extract a private, parameter-object-based `createWithOpeningPost()`/`persistTopic()` helper; leave category authorization in the two public entry points, pass author/flags/audit as inputs, and adapt the shared result to each public return type.

MEDIUM — `libs/api/forum/src/lib/topics/dto/create-admin-topic.dto.ts:6` — the new validating DTO does not implement the new shared `AdminCreateTopicRequest` contract, and the backend otherwise never references that request type — the web client and Nest boundary can now rename, remove, or change a field independently while both projects still compile — import the contract with `import type` and declare `CreateAdminTopicDto implements AdminCreateTopicRequest`, matching the existing `MarkNotificationsReadDto` pattern.

MEDIUM — `libs/web/admin/src/lib/services/admin-learning-api.service.ts:316` — five new response schemas (`coursesEnvelopeSchema`, `reorderResultSchema`, `deletedResponseSchema`, `restoredResponseSchema`, and `refreshMetadataResultSchema`) omit `satisfies z.ZodType<T>`, contradicting the service's line-42 guarantee that every response schema carries that proof — a hand-maintained return type can drift from runtime parsing without a compile-time failure — bind the array schema to `z.ZodType<AdminCourse[]>` and introduce precise response types before the other schemas so each can use `satisfies z.ZodType<...>`.

MEDIUM — `libs/web/admin/src/lib/services/admin-builders-api.service.ts:351` — the newly added `reorderedResponseSchema` is inferred rather than checked with `satisfies z.ZodType<ReorderedResponse>` — this creates an exception inside a section whose own contract comment promises every community response schema is checked, making future contract edits rely on reviewer memory — define the response type before the schema and add the explicit `satisfies` binding.

LOW — `libs/api/learning/src/lib/courses/admin-course-modules.controller.ts:153` — live documentation still says course scheduling has no admin UI and is driven by `curl`; the same obsolete claim remains in `dto/schedule-modules.dto.ts:18`, while new comments in `courses-list.ts:24`, `admin.routes.ts:198`, and `admin-nav.config.ts:157` also attribute that quote to `AdminCoursesController`, where it does not exist — maintainers will infer the wrong caller and follow a false source reference when changing the preview/apply contract — update the controller and DTO comments to describe the portal preview/confirm flow, and correct or remove the historical controller citation in the new frontend comments.

## Confirmed consistency

- No web file imports `libs/api/**`; shared wire types come through `@ptah-contracts/community`. Existing Nx tags preserve the enforced `scope:web` / `scope:api` / `scope:api-contracts` walls.
- Controllers inject services, not `PrismaService`; Prisma access remains in services.
- All added Angular components are standalone, OnPush, signal/inject based, and contain no `[innerHTML]` or Zone-dependent code. No scoped addition uses `any`, `@ts-ignore`, or an un-narrowed catch value.
- `admin-learning-api.service.ts` at 770 lines is one coherent HTTP boundary with grouped request types, schemas, and endpoint methods; splitting it only to satisfy the 700-line warning would create fragment sprawl. `course-detail.ts` is 526 lines and already delegates forms and lesson authoring, so no facade split is warranted there.
- The duplicate two-field delete/restore schemas across the two admin clients are too small to justify a shared helper by themselves. Consolidate them only if shared contract types are introduced while fixing the missing `satisfies` proofs.
- The changed specs follow their sibling suites' route-metadata, HTTP-testing, and fixture-builder styles.

## Verification

`npx nx run-many -t eslint:lint -p web-admin api-forum api-learning api-contracts-community --skip-nx-cache` passed for all four projects. It reported 13 pre-existing warnings, all outside the reviewed paths.
