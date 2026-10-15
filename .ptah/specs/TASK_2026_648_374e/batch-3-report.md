# Batch 3 report

## Changed files

- `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts` and `.spec.ts` (new), `services/index.ts`
- `libs/frontend/chat/src/lib/components/atoms/workflow-badge.component.ts` and `.spec.ts` (new), `components/index.ts`
- `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts` and `.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`, `.html`, and `app-shell.organization.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` and `.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts` and `.spec.ts`, `canvas-focus-header.component.ts`, and `canvas-focus-header.component.spec.ts`

## Launcher contract notes

`WorkflowTabLauncherService.open` validates kind and nonempty title, then awaits `SurfaceRouterService.navigateToSurface('chat')` (`workflow-tab-launcher.service.ts:32`; router API `core/src/lib/routing/surface-router.service.ts:128`). A cancelled or failed navigation returns its safe outcome without creating a tab. After a landed navigation, it creates a normal tab (`:40`), tags it immediately (`:41`), sets the optional first-send preamble (`:43`; reused `chat-state/src/lib/tab-manager.service.ts:1972`), and requests canvas adoption only in grid layout (`:47`). It scopes the visible composer prefill to the tile in grid mode or the active main panel in single mode (`:54`). Adoption and prefill follow `chat-store/task-prompt-bridge.service.ts:81-92`. The launcher does not start a backend chat, claim a session, change surface mode, send a message, or log prompt material.

## Badge placements

The shared badge validates with `isWorkflowKind` and uses theme tokens. It appears in the tab bar from `tab.workflow` (`tab-bar.component.ts:105`), in sidebar session rows from `workflowForSession(session.id, activeWorkspacePath)` (`app-shell.component.html:296`), on expanded canvas rail cards from `current.workflow` (`canvas-rail-card.component.ts:134`), and as its own element in the focus header from the looked-up tab (`canvas-focus-header.component.ts:103`). Untagged rows render no badge.

## Session deletion

- Successful sidebar delete: `app-shell.component.ts:960` calls `forgetWorkflowSession(session.id, activeWorkspacePath)`.
- Successful delete-original path: `chat-view.component.ts:1929` calls `forgetWorkflowSession(originalId, activeWorkspacePath)`.

## Verification

- `npx prettier --write <changed files>`: completed, 15 files formatted.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`: 4/4 targets passed. An initial run found a canvas lookup accessor error, which was fixed before the passing run.
- `npx nx test @ptah-extension/chat --parallel=1 --maxWorkers=2`: 212/212 suites passed; 3,945 passed, 2 skipped, 0 failed. Earlier runs exposed test setup gaps in the sidebar and delete-original specs; both were corrected. Jest reported a worker exit warning after the passing run.
- `npx nx test @ptah-extension/canvas --parallel=1 --maxWorkers=2`: 23/23 suites passed; 372 passed, 0 failed. An earlier run exposed a missing `TabManagerService` stub in the focus-header spec; it was corrected.
- `ptah_get_diagnostics` was called after edits, but its compiler result was unavailable after a 45-second timeout. The required Nx typecheck passed.

## Decisions

| Decision                                                       | Options                                               | Evidence                                                                                                                | Reversible |
| -------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| Await the result-bearing surface router before tab creation    | `setCurrentView` fire-and-forget; `navigateToSurface` | `SurfaceRouterService.navigateToSurface` reports cancelled and failed outcomes; the task requires no tab in either case | Yes        |
| Use the existing composer prefill and canvas adoption requests | New transport; existing `AppStateManager` requests    | `task-prompt-bridge.service.ts:81-92` and canvas adoption effect already handle the two layouts                         | Yes        |
| Keep the badge as a small shared presentational component      | Inline labels at four sites; shared badge             | The same validated five-kind label contract is needed in chat and canvas                                                | Yes        |

## Deviations

- The task prompt referenced `services/task-prompt-bridge.service.ts`; the file in this worktree is `services/chat-store/task-prompt-bridge.service.ts`.
- The existing app-shell organization test overrides component imports, so its test setup needed the new badge import. The existing ChatView and canvas focus-header specs also needed new service stubs.

## Fix round

- `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts`: tagged tab shows the Configure Harness badge and accessible label; an ordinary tab has no badge.
- `libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts`: a session mapped to `harness-new-project` shows New Project, a null mapping renders no badge content, and the lookup receives the session ID and `/work` workspace. This spec also covers sidebar deletion: success calls `forgetWorkflowSession('tagged', '/work')`, while a failed delete does not.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`: expanded tagged card shows the badge and accessible label, expanded ordinary card has no badge, and collapsed tagged card retains its existing button and 56px height without a badge.
- `libs/frontend/chat/src/lib/components/atoms/workflow-badge.component.ts`: the computed label now narrows a local `workflow` value with `isWorkflowKind`, with no cast.

Fix round verification, run sequentially:

- `npx prettier --write <4 changed source/spec files>`: 4/4 formatted, 0 failed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`: 4/4 targets passed, 0 failed.
- `npx nx test @ptah-extension/chat --parallel=1 --maxWorkers=2`: target passed, 0 failed; 212 suites, 3,948 passed and 2 skipped **inferred** from the previous verified 3,945 passing tests plus the three new passing cases. The output capture retained the success line but omitted Jest's count lines.
- `npx nx test @ptah-extension/canvas --parallel=1 --maxWorkers=2`: 23/23 suites passed, 374/374 tests passed, 0 failed.
