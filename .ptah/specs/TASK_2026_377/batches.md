# TASK_2026_377 — Batches

All batches are file-disjoint. No batch commits. Each batch writes `batch-report-BN.md`
into this folder.

| Batch | Lane | Executor   | Mode              | Status                                                                              | Files owned                                                                                                                                                                                                                    |
| ----- | ---- | ---------- | ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1    | A    | codex      | wave 1            | IMPLEMENTED (gate green, 3 projects)                                                | `libs/api/forum/**`, `libs/api-contracts/community/src/lib/admin/admin-topic.contract.ts`                                                                                                                                      |
| B2    | A    | claude cli | wave 2 (after B1) | IMPLEMENTED (agent lost on host restart; orchestrator re-ran gate: 194 tests green) | `libs/web/admin/src/lib/builders/community/**`, `libs/web/admin/src/lib/services/admin-builders-api.service.ts`                                                                                                                |
| B3    | A    | claude cli | wave 1            | IMPLEMENTED (gate green; gap 6.1 → B5)                                              | `libs/web/admin/src/lib/builders/courses/**` (new), `libs/web/admin/src/lib/services/admin-learning-api.service.ts` (new), `libs/web/admin/src/lib/admin.routes.ts`, `libs/web/admin/src/lib/admin-layout/admin-nav.config.ts` |
| B4    | B    | claude cli | wave 1            | IMPLEMENTED (report verified)                                                       | `D:\projects\seshat\PRD.md`, `D:\projects\seshat\OPERATIONS.md`                                                                                                                                                                |
| B5    | A    | codex      | wave 2            | IMPLEMENTED (gate green, 3 projects, 760 tests)                                     | `libs/api/learning/**`, `libs/api-contracts/community/src/lib/admin/admin-course.contract.ts`, `apps/ptah-license-server/src/common/route-map.spec.ts`                                                                         |
| B6    | A    | claude cli | wave 3 (after B5) | IMPLEMENTED (gate green, 199 tests)                                                 | `libs/web/admin/src/lib/builders/courses/**`, `libs/web/admin/src/lib/services/admin-learning-api.service.ts`                                                                                                                  |

## Review fix batches (after code-logic-review.md 8/10 and code-style-review.md 6.5/10)

| Batch | Executor   | Status                                                                          | Files owned                                                                                                             | Findings                                                                                      |
| ----- | ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| F1    | codex      | IMPLEMENTED (1271 tests, 3 projects)                                            | `libs/api/forum/src/lib/topics/**`, `libs/api/learning/src/lib/courses/**`                                              | logic F6, F7; style: createAsAdmin dedupe, DTO implements contract, stale scheduling comments |
| F2    | claude cli | IMPLEMENTED (225 tests; route component 864→506 lines)                          | `libs/web/admin/src/lib/builders/community/**`, `admin-builders-api.service.ts`                                         | logic F1, F2, F3, F8; style HIGH extract components, `satisfies` on reorderedResponseSchema   |
| F3    | claude cli | IMPLEMENTED (courses suites 31 tests; stale-response guard, releaseAt baseline) | `libs/web/admin/src/lib/builders/courses/**`, `admin-learning-api.service.ts`, `admin.routes.ts`, `admin-nav.config.ts` | logic F4, F5; style: missing `satisfies`, wrong controller attribution in comments            |

## B5 — Admin course outline read (backend)

`GET v1/admin/courses/:id/modules` → every live module of the course with its live lessons
(draft included, no member visibility filter). Closes B3 §6.1. Optional in the same batch:
`?includeDeleted` is NOT added (design event per the controller docblock).

## B6 — Courses screen switches to the outline read (frontend)

`CourseDetail.loadModules()` reads B5's route; delete the "lessons seen this session" notice
in `ModuleLessons`; lessons enumerate from the server.

## B1 — Admin-authored thread route (backend)

`POST v1/admin/community/topics` on `AdminCommunityTopicsController`. Body
`{ categoryId, title, body, pinned?, locked? }`. Author = admin user id. Category looked up
without the member visibility filter. Topic + post #1 in one transaction (AD-9), audit row
`community.topic.create` inside that transaction (PRE-6). Returns `201 { id, slug }`.
Contract types `AdminCreateTopicRequest` / `AdminCreatedTopic` in the admin-topic contract.

## B2 — Community screen: categories + new thread (frontend)

On `CommunityModeration`: a Categories section (create, edit, reorder, delete with the 409
message) and a "New thread" form that posts to B1's route. Service methods
`createCommunityCategory`, `updateCommunityCategory`, `reorderCommunityCategories`,
`deleteCommunityCategory`, `createCommunityTopic` with Zod-validated responses.

## B3 — Courses screen (frontend)

`/admin/builders/courses` (list, create, publish toggle, reorder, delete) and
`/admin/builders/courses/:id` (modules + lessons CRUD, reorder, refresh-metadata). New
`AdminLearningApiService`. Nav entry "Courses" under Builders Content.

## B4 — Seshat re-target (docs)

PRD.md and OPERATIONS.md: replace Discourse facts with the native forum + admin portal,
retire the two-key rule and the Discourse MCP, add a dated decision-log entry, resolve D4,
annotate D5. Append and annotate. Never delete history. No git there.

## Verification gate per batch

- `npx nx run-many -t lint typecheck test -p <project names from project.json>`
- Report header must show the expected project count.
