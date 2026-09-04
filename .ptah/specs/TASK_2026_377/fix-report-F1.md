# TASK_2026_377 — Review-fix batch F1

## Result

All requested F1 findings are fixed. The required three-project Nx gate passed
all nine targets. No files were staged or committed.

## Files changed by F1

- `libs/api/forum/src/lib/topics/topics.service.ts`
- `libs/api/forum/src/lib/topics/topics.service.spec.ts`
- `libs/api/forum/src/lib/topics/dto/create-admin-topic.dto.ts`
- `libs/api/learning/src/lib/courses/courses.service.ts`
- `libs/api/learning/src/lib/courses/courses.service.spec.ts`
- `libs/api/learning/src/lib/courses/admin-courses.controller.spec.ts`
- `libs/api/learning/src/lib/courses/admin-course-modules.controller.ts`
- `libs/api/learning/src/lib/courses/dto/schedule-modules.dto.ts`

## Findings resolved

1. **Topics persistence duplication — Style MEDIUM**
   - Added one private parameter-object helper,
     `persistTopicWithOpeningPost`, shared by `create` and `createAsAdmin`.
   - The helper owns slug allocation, bounded collision retries, the transaction,
     the topic insert, opening-post insert, and optional in-transaction audit.
   - Member and admin category authorization remain in their public methods.
     Their signatures, flags, logging, and public return shapes remain unchanged.

2. **Create-path `P2003` mapping — Logic F6**
   - Create persistence now maps Prisma `P2003` to
     `404 Category not found`.
   - The existing update/delete mapping remains `404 Topic not found`.
   - Added a regression spec for category deletion between lookup and insert.

3. **Admin topic DTO contract — Style MEDIUM**
   - `CreateAdminTopicDto` now implements `AdminCreateTopicRequest` through a
     type-only import from `@ptah-contracts/community`.

4. **Outline comment aggregation — Logic F7**
   - `getOutlineForAdmin` now uses `lessonComment.groupBy` by `lessonId`, with
     the existing `NOT_DELETED` filter and `_count._all`.
   - Updated service and controller fixtures to mock `groupBy` and verify that
     aggregate counts are assigned to the correct lessons, with zero retained
     for lessons absent from the aggregate rows.
   - `EXPECTED_EXEMPTIONS` is unchanged.

5. **Scheduling documentation — Style LOW**
   - Replaced the stale curl/no-admin-UI comments with the portal
     `/admin/builders/courses/:id` preview/confirm flow.

## Verification

Command:

```text
npx nx run-many -t typecheck test eslint:lint -p api-forum api-learning ptah-license-server --skip-nx-cache
```

Evidence:

- Header: `Running targets typecheck, test, eslint:lint for 3 projects`
- Projects: `api-forum`, `api-learning`, `ptah-license-server`
- Result: all 9 targets passed
- `api-forum`: 21 suites, 544 tests passed
- `api-learning`: 22 suites, 555 tests passed
- `ptah-license-server`: 7 suites, 172 tests passed
- Total: 50 suites, 1,271 tests passed
- Typecheck: all 3 projects passed
- ESLint: zero errors; seven pre-existing warnings outside the edited files;
  no new warnings
- `git diff --check`: passed for both permitted code subtrees

## Scope controls

- Code edits stayed within `libs/api/forum/src/lib/topics/**` and
  `libs/api/learning/src/lib/courses/**`.
- Deliverables were written only under `.ptah/specs/TASK_2026_377`.
- No member-path or route changes were made.
- No `@ts-ignore` was added; catches remain typed as `unknown`.
- No commit or staging operation was performed.
