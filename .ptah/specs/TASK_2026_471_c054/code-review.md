# Code Review — `TASK_2026_471_c054`

## Verdict
APPROVE WITH NITS — The implementation cleanly resolves the DI bundling regression, maps all prompt cards to verified disk commands/skills, and delivers agent task assignment across card and list views while preserving 100% test compatibility and strict architectural boundaries.

## Blocking findings
none

## Non-blocking findings

1. `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:569`
   - Defect: The `<summary>Assign to agent…</summary>` element inside `<details>` is missing `[attr.tabindex]="rovingTabIndex(task.id)"`.
   - Failure scenario: While sibling buttons and dropdown items in the row explicitly bind `rovingTabIndex(task.id)`, the HTML `<summary>` element has a default browser tabindex of 0. On any unfocused row, this leaves `<summary>` in the normal tab sequence, violating the roving tabindex invariant where each non-focused row must have all descendant controls set to `tabindex="-1"`. Keyboard users tabbing through the list will land on the `<summary>` elements of all startable rows.
   - Fix: Add `[attr.tabindex]="rovingTabIndex(task.id)"` to `<summary>`.

2. `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:47-55`
   - Defect: Coupled RPC failure handling discards specialist subagents if CLI detection fails or returns an error.
   - Failure scenario: If `agent:detectClis` fails or returns an error while `autocomplete:agents` succeeds, the condition `if (!agentsResult.success || !clisResult.success ...)` discards all discovered local specialist roles and resets the roster to Full Orchestrator only.
   - Fix: Process `agentsResult` and `clisResult` independently (or via `Promise.allSettled`) so that local workspace specialists remain available even if host rival CLI detection fails.

3. `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:66`
   - Defect: Missing nullish fallback on `clisResult.data.clis`.
   - Failure scenario: While `agentsResult.data.agents ?? []` handles an absent `agents` array gracefully, `clisResult.data.clis.filter(...)` does not provide a fallback. If a successful RPC returns a payload lacking `.clis`, a `TypeError: Cannot read properties of undefined (reading 'filter')` is thrown (caught by the catch block, but resulting in an unnecessary fallback to orchestrator-only).
   - Fix: Use `(clisResult.data.clis ?? []).filter(...)`.

4. `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:450` and `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:571`
   - Defect: Unconditional `<li class="menu-title ...">Orchestrator</li>` menu header rendering.
   - Failure scenario: Unlike `specialistAgents()` and `laneAgents()` which are wrapped in `@if (...length > 0)`, the "Orchestrator" header renders unconditionally. If `agentTargets` is passed as an empty array (for example before discovery completes or in isolated testing), the menu displays an empty section with just the "Orchestrator" title and no items.
   - Fix: Wrap the section header in `@if (orchestratorAgents().length > 0)`.

5. `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:587,615,644`
   - Defect: List view cannot start an assigned agent with git worktree isolation.
   - Failure scenario: In `task-card.component.ts`, isolation is controlled via the card's `isolate()` toggle and passed into `onStart(target)`. In `task-list.component.ts`, clicking any agent from the submenu hardcodes `onStart(task.id, false, target)`. Users in list view have no mechanism to launch an assigned specialist or CLI lane with worktree isolation.
   - Fix: Consider adding an "Assign isolated to agent…" section or respecting a row/view isolation preference.

6. `libs/backend/task-specs/src/lib/task-doctor.service.ts:353`
   - Defect: Missing metadata reflection unit test for `TaskDoctorService`.
   - Failure scenario: While `registry-generator.service.spec.ts:161-176` added an explicit test asserting `@inject(TASK_SPECS_TOKENS.TASK_SCANNER)` survives metadata-stripped esbuild bundles, `TaskDoctorService`'s constructor parameter `@inject(TASK_SPECS_TOKENS.TASK_WRITER)` has no corresponding metadata reflection test. Future refactors could accidentally drop the decorator without breaking Jest.
   - Fix: Add a mirroring test in `task-doctor.service.spec.ts` asserting `Reflect.getOwnMetadata('injectionTokens', TaskDoctorService)`.

## Checked and clean

- **Angular conventions**: Verified `ChangeDetectionStrategy.OnPush` on all touched components (`PromptSuggestionsComponent:62`, `TaskCardComponent:81`, `TaskColumnComponent:33`, `TaskBoardComponent:63`, `TaskListComponent:156`, `TasksViewComponent:113`). All components are standalone; state is managed via Angular signals (`signal`, `computed`, `input`, `output`) and dependencies are injected via `inject()`. No constructor parameters or `BehaviorSubject` facades were introduced.
- **Boundary violations**: Verified zero leaks between frontend and backend. No backend libraries are imported into frontend code (`tasks-ui` imports only `@angular/*`, `@ptah-extension/core`, and `@ptah-extension/shared`). No new RPC methods or namespace prefixes were added; `libs/shared/src/lib/types/rpc.types.ts` and `libs/backend/vscode-core/src/messaging/rpc-handler.ts` remain completely untouched, reusing existing `autocomplete:agents` and `agent:detectClis` RPC endpoints.
- **Behaviour preservation**: Verified in `task-start.service.ts:148-166` and `task-start.service.spec.ts:52-138` that default launches without a specified target, or with an explicit orchestrator target, emit the exact, byte-identical prompt `/orchestrate <taskId>` (and with isolation `/orchestrate <taskId>\n\nIsolate all implementation...`).
- **Error handling**: Verified `catch (error: unknown)` in `task-agent-discovery.service.ts:85-93` properly narrows with `instanceof Error` before accessing `.message`. Errors never bubble or throw into the Tasks surface, gracefully degrading to `[ORCHESTRATOR_TARGET]`.
- **Accessibility**: Roving tabindex invariant checked in `task-board.component.spec.ts:178-185`. The test honestly updated focusable node counts from 36 to 42 (12 to 14 nodes per card for the new trigger button and dropdown container) and verified that 0 stranded descendants exist on unfocused cards (`expect(strandedDescendants).toEqual([])`).
- **Test quality**: 1,300 tests pass across all affected projects (`@ptah-extension/task-specs`: 517 tests; `@ptah-extension/chat-ui`: 186 tests; `@ptah-extension/tasks-ui`: 597 tests). New tests in `task-start.service.spec.ts`, `task-agent-discovery.service.spec.ts`, `task-card.component.spec.ts`, `task-list.component.spec.ts`, and `registry-generator.service.spec.ts` assert real behavior (prompt strings, token metadata, filtering, event payloads) rather than superficial mock calls. No existing tests were weakened or deleted.
- **Piece 2 accuracy**: Spot-checked all 28 prompt cards across all 6 categories in `prompt-suggestions.component.ts:184-375` against `.claude/commands/` and `.claude/skills/`. All 17 slash-command prompts map directly to existing files (e.g. `.claude/commands/review-code.md`, `.claude/skills/tribunal/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`, etc.), and all natural-language prompts correspond to active features. No cards invent absent skills or commands.
- **Dead code**: Verified that all new types (`AgentCategory`, `TaskAgentTarget`, `TaskStartRequest`) and `TaskAgentDiscoveryService` are properly exported in `libs/frontend/tasks-ui/src/index.ts` and actively consumed by `TasksViewComponent` and board components.
