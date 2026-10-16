# Frontend implementation — `TASK_2026_677_efcd`, batch B-2

**Verdict**: COMPLETE. B-2.1 is done. tasks-ui, shared and task-specs checks are green.

**Tasks completed**: B-2.1 — create `@ptah-extension/tasks-ui/presentation` and the tasks-changed feed.

## Files

Root: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\`

- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\tasks-ui\src\presentation.ts`
  — narrow entry. It re-exports `TASK_STATUS_LABELS`, `WORKFLOW_ARTIFACTS` (+ `WorkflowArtifact` type),
  `TASK_STATUS_INK`, `deriveTaskStage`, `orderTaskDocuments`, `TaskStage`, `TASKS_CHANGED_MESSAGE_TYPE`,
  `TasksChangedFeed` and `TasksChangedEvent`. It exports nothing from `TasksStore` or the board.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\tasks-ui\src\lib\tasks-changed.ts`
  — `TASKS_CHANGED_MESSAGE_TYPE = 'tasks:changed'`, moved here from the store.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\tasks-ui\src\lib\task-stage.ts`
  — `TASK_STATUS_INK`, the internal ladder `TASK_STAGE_LADDER`, `TaskStage` (`'Requirements' | 'Design' | 'Plan'
  | 'Build' | 'Review' | 'Test'`), `deriveTaskStage`, `orderTaskDocuments`. It contains no quoted filenames.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\tasks-ui\src\lib\services\tasks-changed-feed.service.ts`
  — `TasksChangedFeed` (`providedIn: 'root'`, `implements MessageHandler`). It validates each push and exposes
  `changes: Signal<{seq, change: TasksChangedNotification} | null>`. It fetches nothing and owns no timer.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts`
  — the store now imports `TASKS_CHANGED_MESSAGE_TYPE` from `../tasks-changed` and re-exports it under the same
  name. `services.ts` is unchanged, and so is store behaviour.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\tsconfig.base.json` — one path entry
  `@ptah-extension/tasks-ui/presentation` -> `./libs/frontend/tasks-ui/src/presentation.ts`, placed right after
  `/services`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\shared\src\lib\types\task-spec.contract.ts`
  — coordinator decision (b). Adds named constants `TASK_DESCRIPTION_FILE`, `IMPLEMENTATION_PLAN_FILE`,
  `TEST_REPORT_FILE`, `CODE_STYLE_REVIEW_FILE`, `CODE_LOGIC_REVIEW_FILE`, `VISUAL_REVIEW_FILE`,
  `VISUAL_DESIGN_SPECIFICATION_FILE`, `DESIGN_SPEC_FILE` and `DESIGN_HANDOFF_FILE`. `CONTEXT_FILE`, `BATCHES_FILE` and
  `LEGACY_BATCHES_FILE` move above `DOC_FILES`. `DOC_FILES` and `LEGACY_DOC_FILES` are now built from those
  constants, so each of those literals appears once. `DOC_FILES` has the same order and contents (18-entry tuple,
  same literal types). The shared index needed no edit: `libs/shared/src/index.ts:43` already does
  `export * from './lib/types/task-spec.contract'`.

Not touched (owned elsewhere): `apps/ptah-extension-webview/src/app/app.config.ts`. B-3 owns the
`{ provide: MESSAGE_HANDLERS, useExisting: TasksChangedFeed, multi: true }` registration (batches.md:397, plan §3.3
line 183). Until B-3 lands, `TasksChangedFeed` exists but receives no messages.

## Evidence per requirement

- `/presentation` exposes no store internals. `presentation.ts` imports only from `lib/task-presentation`,
  `lib/task-stage`, `lib/tasks-changed` and `lib/services/tasks-changed-feed.service`. None of these import
  `TasksStore` or any component. The feed imports `MessageHandler` from `@ptah-extension/core` as `import type`.
- The `TASK_STATUS_INK` mapping matches plan B:134-139 exactly. The utilities exist in
  `apps/ptah-extension-webview/tailwind.config.js:31-35` (`base-content-muted`, `state-run|need|err|done`), and
  tasks-ui is inside the app's content globs via `createGlobPatternsForDependencies`.
- `deriveTaskStage` returns the furthest ladder step that has at least one present file, or `null` when no
  ladder file is present (a folder with only `task.md` returns `null`). The ladder follows plan B:140-146 and
  design-spec.md:562-564. Build accepts `BATCHES_FILE` or `LEGACY_BATCHES_FILE`. Every ladder file is a `DOC_FILES`
  member (B O4 check done against `task-spec.contract.ts`), so none was dropped.
- `orderTaskDocuments` returns, in this order:
  1. `CARRIER_FILE`, only when it is present;
  2. the `DOC_FILES` entries, in contract order;
  3. `handoff-N.md`, matched with the regex `/^handoff-(\d+)\.md$/` and sorted numerically by N;
  4. everything else, sorted with a locale-independent comparison.

  Only entries from the input are returned, and duplicates are removed.
- Feed validation (plan B:153-157): a payload that is not an object, has a non-string `workspaceRoot`, or has
  `folderNames` that is not a string array is dropped. `reason` is also checked against the shared union
  (`'watcher' | 'write' | 'reindex'`), so the published value really is a `TasksChangedNotification`.
  `folderNames` is copied. `seq` goes up only for accepted pushes.
- Jest mapper: no `jest.config.ts` under `libs/` or `apps/` maps `tasks-ui/services` (grep returned nothing), so I
  added no mapper. Per the validation note, B-4 adds one only if the chat suite fails to resolve the alias.
- Secondary-entry mirroring: `tasks-ui/project.json`, `tsconfig*.json` and `eslint.config.mjs` declare nothing
  for `services` (grep returned nothing), so `tsconfig.base.json` was the only place to change.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Ladder filenames come from new named constants in the shared contract (coordinator's option b) | (a) allowlist `task-stage.ts` in the contract guard; (b) named constants in `task-spec.contract.ts`; (c) destructure `DOC_FILES` by position | `libs/backend/task-specs/src/lib/contract.guard.spec.ts` Duty 1 fails any quoted `DOC_FILES` or carrier name outside its allowlist, scanning all of `apps/` and `libs/`; the contract only had `CARRIER_FILE`, `BATCHES_FILE`, `LEGACY_BATCHES_FILE` and `CONTEXT_FILE` as named constants. I escalated to the coordinator, who chose (b) and recorded it in decisions.md | yes |
| `TaskStage` is the union of the step labels, and the ladder stays private | export the ladder; use an enum | design-spec.md:545 shows `Stage: Design`; consumers only need `deriveTaskStage` and the label; this keeps the public API small | yes |
| The feed also validates `reason` | validate only `workspaceRoot` and `folderNames` | the published type requires `reason`; without the check, the cast would be unchecked | yes |

## Risks handled

- Shared worktree and parallel batches: I edited only B-2 files plus the shared contract the coordinator added
  to B-2. Other changes in the tree (`chat-ui/src/index.ts`, `ui/.../monogram-tile/index.ts`, webview
  styles, tailwind config, `state-ink-contrast.spec.ts`, task docs) belong to C-1 and B-1, and I left them alone.
- `tsconfig.base.json` (B-2 is its only owner): I added one entry next to `/services`.
- Contract guard ratchet: `task-stage.ts` contains no quoted filename. Its filenames come from the new shared
  constants, and the task-specs suite, which runs the guard, is green.
- Store behaviour: only the constant moved. The 651 tasks-ui tests are green with no spec changes, which also
  shows the re-export works.

## Verification (tail only)

All checks ran through `node .ptah/tmp/check-run.mjs`, one at a time, from the worktree root.

- `b2-typecheck` `npx nx typecheck @ptah-extension/tasks-ui --parallel=1 --skip-nx-cache` -> exit 0,
  `Successfully ran target typecheck for project @ptah-extension/tasks-ui`.
- `b2-lint` `npx nx lint @ptah-extension/tasks-ui --parallel=1 --skip-nx-cache` -> exit 0, `0 errors, 6
  warnings`, all pre-existing: `max-lines` and `no-useless-assignment` in the board components, and `max-lines`
  in `tasks-store.service.ts`, which was already over 1900 lines. My edit adds 1 net line.
- `b2-test` `npx nx test @ptah-extension/tasks-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  -> exit 0, `Test Suites: 20 passed, 20 total; Tests: 651 passed, 651 total`.
- `b2-shared-typecheck` `npx nx typecheck @ptah-extension/shared ...` -> exit 0, success.
- `b2-shared-lint` `npx nx lint @ptah-extension/shared ...` -> exit 0, `0 errors, 6 warnings`, none of them in
  `task-spec.contract.ts` (grep count 0).
- `b2-shared-test` `npx nx test @ptah-extension/shared --coverage=false --maxWorkers=2 ...` -> exit 0,
  `Test Suites: 113 passed; Tests: 3594 passed`.
- `b2-taskspecs` `npx nx test @ptah-extension/task-specs --coverage=false --maxWorkers=2 ...` -> exit 0,
  `Test Suites: 18 passed; Tests: 523 passed`. This includes `contract.guard.spec.ts`. The project name is
  `@ptah-extension/task-specs` (from `libs/backend/task-specs/project.json`).
- `ptah_get_diagnostics` on the four new or changed TS files: 0 errors in the requested files. The tool reports
  errors in sibling spec files and `capability-id-codec.ts`, but those are its own config (target and spec typing),
  and `nx typecheck` passes for both projects.
- Not run: the webview typecheck or lint. The app is not changed in B-2, and `app.config.ts` belongs to B-3.

## Plan deviations

- I added the shared contract constants (decision above). The plan assumed `DOC_FILES` constants existed; only
  four did.
- `app.config.ts` is listed in plan part B §2 but was moved to B-3 by implementation-plan.md §3.3. I did not touch it.

## Out-of-scope observations

- I wrote no new specs because of the batch rule. The pure helpers `deriveTaskStage`, `orderTaskDocuments` and the
  feed parser have no unit coverage yet. Plan B:566 lists `deriveTaskStage` and `orderTaskDocuments` as pure seams for T2.
