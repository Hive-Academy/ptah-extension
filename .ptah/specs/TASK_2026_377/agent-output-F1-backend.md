# F1 backend implementation

## Changed files

- `libs/api/forum/src/lib/topics/topics.service.ts`
- `libs/api/forum/src/lib/topics/topics.service.spec.ts`
- `libs/api/forum/src/lib/topics/dto/create-admin-topic.dto.ts`
- `libs/api/learning/src/lib/courses/courses.service.ts`
- `libs/api/learning/src/lib/courses/courses.service.spec.ts`
- `libs/api/learning/src/lib/courses/admin-courses.controller.spec.ts`
- `libs/api/learning/src/lib/courses/admin-course-modules.controller.ts`
- `libs/api/learning/src/lib/courses/dto/schedule-modules.dto.ts`

## Behavior and tests

- Member and admin topic creation now share one private parameter-object persistence path for slug allocation/retry, the topic and opening-post transaction, and optional in-transaction audit. Their category lookups and public return shapes remain distinct.
- Create-time Prisma `P2003` is now a sanitized `404 Category not found`; the existing update/delete `Topic not found` mapping is unchanged. A category-deletion race regression test covers the create mapping.
- `CreateAdminTopicDto` implements `AdminCreateTopicRequest` through a type-only contracts import.
- Admin course outlines use `lessonComment.groupBy` with `NOT_DELETED` and `_count._all`, producing one aggregate row per lesson instead of materializing every live comment. Service and controller fixtures assert the grouped query and count mapping.
- Scheduling documentation now describes the `/admin/builders/courses/:id` portal preview/confirm flow. No route or member-path behavior changed.

## Verification

- `npx nx run-many -t typecheck test -p api-forum api-learning --skip-nx-cache` — passed after updating the colocated controller fixture; `api-forum` 21 suites/544 tests and `api-learning` 22 suites/555 tests.
- `npx nx run-many -t typecheck test eslint:lint -p api-forum api-learning ptah-license-server --skip-nx-cache` — passed all nine targets; `ptah-license-server` 7 suites/172 tests. ESLint reported seven pre-existing warnings outside the edited files and zero errors.
- Scoped Ptah TypeScript diagnostics — zero errors and zero warnings.
- Prettier check and `git diff --check` for the edited backend files — passed.

Plan deviations: none. `EXPECTED_EXEMPTIONS` was not changed.
