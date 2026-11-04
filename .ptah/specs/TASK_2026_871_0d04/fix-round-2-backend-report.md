# Backend fix round 2

## Findings

- **A / original 4, including Minor 4:** `libs/backend/task-specs/src/lib/task-index.service.ts:473-480` rechecks directory type and canonical path after enumeration, before the `too_many` decision. Timestamps no longer decide identity. The filesystem port's `FileStat` has no `dev` or `ino`, so no port change was made. Specs: `task-index.service.spec.ts:771,785,806` cover persistent swap, ordinary timestamp change, and swapped 201-name directory.
- **B / new Serious 1:** `task-index.service.ts:356-362` uses the contained, checked, 200-name folder listing for detail and fails with a logged state instead of returning an empty list. `task-index.service.ts:483-488` logs the original listing error. Specs: `task-index.service.spec.ts:825,835` cover a failing read, swapped directory, and the cap. The successful `tasks:get` shape is unchanged.
- **C / new Serious 2:** `task-index.service.ts:428-444` rechecks the canonical folder and file paths, directory type, and containment after the bounded no-follow read; changed paths discard the bytes and return `rejected`. Spec: `task-index.service.spec.ts:850` covers parent and file path changes during the read.
- **Minor 5:** `task-index.service.ts:449-455` logs the original filesystem Error before mapping a failed document read to `unreadable`. Existing spec covers a failed bounded read (`task-index.service.spec.ts:904`).
- **Deferred Minor 6:** conflict enrichment and bulk-label error mapping live in `libs/backend/rpc-handlers`, outside this round's `libs/backend/task-specs/**` scope. The frontend stale-error finding is also outside scope and assigned to another agent.

## Verification

- `npm run verify -- -t typecheck,lint,test -p @ptah-extension/task-specs -- --testPathPatterns=task-index`: exit 1 before checks; Nx default plugins and `@nx/eslint` / `@nx/jest` plugins failed with `spawn EPERM`.
- `npx jest --config libs/backend/task-specs/jest.config.ts --runInBand --coverage=false --testPathPatterns=task-index`: exit 0; 2 suites, 86 tests passed.
- `npx tsc --noEmit --project libs/backend/task-specs/tsconfig.spec.json`: exit 0.
- `npx eslint libs/backend/task-specs/src/lib/task-index.service.ts libs/backend/task-specs/src/lib/task-index.service.spec.ts`: exit 0; 0 errors, 1 existing warning at spec line 106 (`no-non-null-assertion`).
- Scoped `ptah_get_diagnostics` after final edit: 0 errors, 0 warnings.

## Decisions

- **Directory identity:** compare canonical path and directory type. Options: timestamp comparison, `dev`/`ino`, or canonical path/type. Evidence: `FileStat` exposes only type, ctime, mtime, size; the assigned scope excludes a port change. Reversible: yes. A swap-and-restore during enumeration remains undetectable.
- **Detail listing failure:** throw through the existing sanitized `tasks:get` error path. Options: optional response state or throw. Evidence: the existing RPC contract already sanitizes thrown errors, and the task requires backward compatibility. Reversible: yes.
- **Document race:** recheck canonical directory and file paths after read. Options: handle-relative open or post-read check. Evidence: the port has no `openat`-style operation and the assignment excludes platform-core. Reversible: yes. A swap-and-restore inside the read window remains an accepted limitation.
- **200-name cap:** classify only after the post-check. The port's `readDirectory` materializes all entries, so the cap limits returned names but cannot stop enumeration early. Reversible: yes.

