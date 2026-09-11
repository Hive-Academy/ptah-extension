# TASK_2026_413 Code-Style & Architecture Conformance Review

- **Target Worktree**: `D:/projects/ptah-extension/.claude/worktrees/git-review-controls`
- **Branch**: `fix/git-review-controls` (base `712478de8`)
- **Scope**: Batches 1–6 uncommitted changes
- **Verdict**: **APPROVE_WITH_FIXES**
- **Score**: **8/10**
- **Total Findings**: **8** (0 Blocking, 2 Serious, 6 Minor)

---

## Executive Summary

The implementation of TASK_2026_413 (Batches 1–6) delivers a high-quality restoration of Git controls and read-only historical branch comparison. It strictly honors the core architectural pillars:

- **Hexagonal Architecture**: Backend libraries communicate solely through `platform-core` ports (`IEditorLauncher`, `IWorkspaceProvider`, `IFileSystemProvider`). No adapter leaks exist outside composition roots. Frontend libraries never import backend code; [`@ptah-extension/shared`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/shared) remains the strict bridge.
- **Angular 21 Standards**: All new and modified components are standalone, enforce `ChangeDetectionStrategy.OnPush`, consume state via Angular signals (`signal`, `computed`), and utilize `inject()` rather than constructor injection. No `[innerHTML]` bindings or third-party sanitizers were introduced. DaisyUI / Ptah theme tokens and `lucide-angular` icons are used exclusively without hardcoded color values.
- **RPC Safety & Boundaries**: Strict Zod schemas validate inputs at every RPC boundary (`git:reviewChanges`, `git:reviewFile`, `editor:openFile`, `file:open`). No internal re-validation occurs. `RpcMethodRegistry` and allowlists are correctly updated. Path traversal and workspace root verification are strictly enforced.
- **Test Integrity**: Unit tests across 21 `git-ui` test suites (285 tests) and Playwright Electron E2E tests run and pass at the default 1200×800 window size and 700 px dock width without artificial widening hacks.

Two **Serious** architectural concerns (the continued growth of [`GitInfoService`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/vscode-core/src/services/git-info.service.ts) beyond 2,800 lines without applying the facade rule, and over-exporting internal UI atoms and tree utilities in [`libs/frontend/git-ui/src/index.ts`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/index.ts)) alongside minor testing and documentation cleanups should be addressed to ensure long-term maintainability.

---

## Findings by Severity

### Serious Findings

#### 1. File Size & Single Concern Violation: `GitInfoService` Grew Past 2,800 Lines Without Facade Split

- **File & Line**: [`libs/backend/vscode-core/src/services/git-info.service.ts:1035`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/vscode-core/src/services/git-info.service.ts#L1035) (grew by +330 lines, lines 2038–2730; total file lines: 2,811)
- **Evidence**:
  ```typescript
  // ESLint warning: File has too many lines (2811). Maximum allowed is 700 max-lines
  async reviewChanges(workspacePath: string, base: string, head: string): Promise<GitReviewChangesResult> { ... }
  async reviewFile(workspacePath: string, request: ReviewFileRequest): Promise<GitReviewFileResult> { ... }
  ```
- **Analysis**: Root `CLAUDE.md:168` mandates a 700-line soft ceiling and a deliberate architectural review past 1,000 lines. When splitting is warranted, the **facade rule** must be applied: keep the public class name, DI token, and method signatures, and extract the new domain capability into an injected collaborator. Batches 1–2 added 330 lines representing an entirely distinct concern: historical PR-style branch review (ref verification, merge-base computation, NUL-delimited numstat parsing, name-status parsing, and token/blob reads cached in `issuedReviews`). Adding this logic directly into `GitInfoService` inflates an already monolithic file.
- **Minimal Fix**:
  Extract the historical review domain methods (`reviewChanges`, `reviewFile`, `resolveReviewRef`, `readNumstat`, `readUntrackedNumstat`, `parseNumstat`, `parseReviewNames`, and the `issuedReviews` Map) into a dedicated collaborator class (e.g. `GitHistoricalReviewService` in `libs/backend/vscode-core/src/services/`). Inject `GitHistoricalReviewService` into `GitInfoService`, and retain the public `reviewChanges` and `reviewFile` methods on `GitInfoService` as delegating facade methods.

---

#### 2. Public API Over-Exporting in `git-ui` Barrel

- **File & Line**: [`libs/frontend/git-ui/src/index.ts:33-39`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/index.ts#L33-L39)
- **Evidence**:
  ```typescript
  export { BranchPickerDropdownComponent } from './lib/branch-picker/branch-picker-dropdown.component';
  export { BranchDetailsPopoverComponent } from './lib/branch-picker/branch-details-popover.component';
  export { GitReviewToolbarComponent } from './lib/review/git-review-toolbar.component';
  export { GitReviewPanelComponent } from './lib/review/git-review-panel.component';
  export { GitReviewFileRowComponent } from './lib/review/git-review-file-row.component';
  export { buildChangedFileTree } from './lib/source-control/changed-file-tree';
  export type { ChangedFileTreeNode } from './lib/source-control/changed-file-tree';
  ```
- **Analysis**: Monorepo guidelines (`CLAUDE.md:164` and `libs/frontend/git-ui/src/index.ts:8-10`) state that the public entry point `src/index.ts` must only export public interfaces and container components, without over-exporting internal implementation details (`MonacoLoaderService and git-read-error-messages are deliberately NOT exported: they are implementation detail`). None of the 7 exported symbols above are consumed outside of `libs/frontend/git-ui`; they are internal child components of `GitDockComponent` and `GitDockHeaderComponent`. Exporting them pollutes the library's public surface and increases maintenance coupling.
- **Minimal Fix**:
  Remove lines 33–39 from [`libs/frontend/git-ui/src/index.ts`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/index.ts). Keep only top-level surfaces (`GitDockComponent`, `GitDockHeaderComponent`), public services, and diff tab types.

---

### Minor Findings

#### 3. Direct Protected Method Invocation in Component Unit Test

- **File & Line**: [`libs/frontend/git-ui/src/lib/git-dock/git-dock.component.spec.ts:257-263`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.spec.ts#L257-L263)
- **Evidence**:

  ```typescript
  it('routes a file Open In click through the workspace-safe launcher', () => {
    const fixture = TestBed.createComponent(GitDockComponent);
    const component = fixture.componentInstance as unknown as {
      onFileClicked: (request: OpenInRequest) => void;
    };

    component.onFileClicked({ target: 'kiro', path: 'src/a.ts' });
    ...
  ```

- **Analysis**: Monorepo testing conventions explicitly forbid casting `componentInstance as unknown` to directly call protected or private methods when an output event or rendered click should be exercised ("no direct protected-method calls where a rendered click should be used"). While `git-dock.mount.spec.ts` covers the rendered DOM click flow, this unit test still circumvents Angular encapsulation.
- **Minimal Fix**:
  Trigger the child component's output event through `By.directive` or test template binding:
  ```typescript
  const panel = fixture.debugElement.query(By.directive(SourceControlPanelStubComponent)).componentInstance;
  panel.fileClicked.emit({ target: 'kiro', path: 'src/a.ts' });
  ```

---

#### 4. Duplicated File Tree Builders in `git-ui`

- **File & Line**: [`libs/frontend/git-ui/src/lib/source-control/changed-file-tree.ts:19-79`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/source-control/changed-file-tree.ts#L19-L79) vs [`libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts:44-80`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts#L44-L80)
- **Evidence**:
  `buildChangedFileTree` in `changed-file-tree.ts` and `buildFileTree` in `source-control-panel.component.ts` both split file paths on `/` and build hierarchical folder/file tree node graphs.
- **Analysis**: While the implementation report noted keeping working-tree tree building isolated from historical searchable review, having two distinct tree-building algorithms and node structures (`GitFileTreeNode` vs `ChangedFileTreeNode`) in the same library increases cognitive load and introduces divergent path-normalization behavior (e.g. Windows `\` handling).
- **Minimal Fix**:
  Refactor both into a single generalized tree-builder utility in `libs/frontend/git-ui/src/lib/source-control/` that accepts optional sorting and query filter predicates.

---

#### 5. Forbidden Non-Null Assertions in Review Spec

- **File & Line**: [`libs/backend/vscode-core/src/services/git-info.service.review.spec.ts:87-88,113-114`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/vscode-core/src/services/git-info.service.review.spec.ts#L87-L88)
- **Evidence**:
  ```typescript
  87:  baseSha: result.mergeBaseSha!,
  88:  headSha: result.head!.sha,
  ...
  113: baseSha: result.mergeBaseSha!,
  114: headSha: result.head!.sha,
  ```
  Triggers ESLint warnings: `@typescript-eslint/no-non-null-assertion`.
- **Analysis**: Non-null assertions (`!`) are disallowed by project lint rules. In test suites, values should be narrowed with Jest assertions (`expect(result.head).toBeDefined()`) or safe fallbacks.
- **Minimal Fix**:
  Safely assign and assert prior to calling `reviewFile`:
  ```typescript
  expect(result.mergeBaseSha).toBeDefined();
  expect(result.head).toBeDefined();
  const baseSha = result.mergeBaseSha ?? '';
  const headSha = result.head?.sha ?? '';
  ```

---

#### 6. Missing Colocated Unit Spec for `workspace-file-path.ts`

- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts:1-59`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts#L1-L59)
- **Evidence**: `workspace-file-path.ts` exists without a colocated `workspace-file-path.spec.ts`.
- **Analysis**: While `workspace-file-path.ts` successfully deduplicated workspace path resolution and security checks between `EditorRpcHandlers` and `ElectronFileOpenRpcHandlers`, repository testing standards prescribe colocated unit test specs for helper utilities to exhaustively test edge cases (path traversals, case-insensitive Windows comparisons, directory rejections).
- **Minimal Fix**:
  Add `workspace-file-path.spec.ts` in [`libs/backend/rpc-handlers/src/lib/handlers/`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/) testing root matching, relative paths without roots, directory paths, and path traversal attempts.

---

#### 7. Stale JSDoc Comment in `GitDockComponent`

- **File & Line**: [`libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:38-40`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts#L38-L40)
- **Evidence**:
  ```typescript
  * The branch-picker dropdown and details popover are intentionally NOT
  * hosted here — those 7 RPCs and their UI stay in the contract for
  * TASK_2026_386.
  ```
- **Analysis**: This JSDoc comment was written when the branch picker was deferred. In TASK_2026_413, `GitDockHeaderComponent` explicitly hosts `BranchPickerDropdownComponent` and `BranchDetailsPopoverComponent`. The comment is now contradictory and misleading.
- **Minimal Fix**:
  Remove or update lines 38–40 in `git-dock.component.ts` to document that the header now hosts the restored branch picker and details popover.

---

#### 8. Restored Branch Picker Omits Historical Recency Sorting & Bounds

- **File & Line**: [`libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:68-93`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts#L68-L93)
- **Evidence**:
  The historical implementation in `libs/frontend/editor/src/lib/branch-picker/branch-picker-dropdown.component.ts` enforced `MAX_VISIBLE_BRANCHES = 10` and `sortByRecency()`. The restored version renders all branches matching the query without pagination or recency sorting.
- **Analysis**: In repositories with hundreds of local and remote branches, rendering all branches into the DOM simultaneously inside `max-h-72` can degrade DOM performance and harms usability when scrolling without an active filter.
- **Minimal Fix**:
  Add a default visible cap (e.g. top 15 branches) when `query()` is empty, or sort local branches by recency.

---

## Architectural & Style Conformance Matrix

| Category                 | Requirement                                       | Status       | Notes                                                                                                        |
| :----------------------- | :------------------------------------------------ | :----------- | :----------------------------------------------------------------------------------------------------------- |
| **Hexagonal Core**       | Backend libs depend only on `platform-core` ports | **CONFORMS** | No adapter leaks outside composition roots. `IEditorLauncher` and `IFileSystemProvider` injected via tokens. |
| **Monorepo Boundaries**  | Frontend ⇄ Backend isolation                      | **CONFORMS** | Zero imports from `libs/backend` into `libs/frontend`. `@ptah-extension/shared` is the sole bridge.          |
| **Angular Architecture** | Standalone & `OnPush` detection                   | **CONFORMS** | All 11 new/modified components specify `standalone: true` and `ChangeDetectionStrategy.OnPush`.              |
| **Angular Reactivity**   | Signals + `inject()`                              | **CONFORMS** | Pure signals (`signal`, `computed`, `input`, `output`); no constructor DI, no `BehaviorSubject` facades.     |
| **Template Security**    | No `[innerHTML]` on untrusted data                | **CONFORMS** | Zero `[innerHTML]` added. Clean Angular template bindings.                                                   |
| **Styling & Icons**      | DaisyUI tokens + `lucide-angular`                 | **CONFORMS** | Standard DaisyUI tokens (`btn`, `bg-base-200`, `text-success`, `text-error`); no hardcoded hex/rgb colors.   |
| **RPC Contracts**        | Zod schemas at external boundaries                | **CONFORMS** | `git:reviewChanges`, `git:reviewFile`, `editor:openFile`, `file:open` strictly validated with Zod.           |
| **Error Handling**       | `catch (error: unknown)` with narrowing           | **CONFORMS** | All new catch blocks correctly narrow with `error instanceof Error`.                                         |
| **Type Safety**          | No `@ts-ignore` directives                        | **CONFORMS** | Zero `@ts-ignore` or `@ts-expect-error` introduced.                                                          |
| **Naming Conventions**   | `kebab-case.ts` and standard suffixes             | **CONFORMS** | Files use `kebab-case.ts`; classes end in `Component`, `Service`, or `RpcHandlers`.                          |
| **Deduplication**        | Shared workspace path resolver                    | **CONFORMS** | `workspace-file-path.ts` deduplicated logic across `EditorRpcHandlers` and `ElectronFileOpenRpcHandlers`.    |
| **E2E Layout**           | Real 1200×800 window size                         | **CONFORMS** | Window-widening workarounds eliminated; Monaco content widget narrow-width styling fixed.                    |

---

## Maintenance Cost Six Months Out

1. **Monolithic Service Ratchet**: If `GitInfoService` continues accumulating features without applying the facade rule, it will exceed 3,000 lines, making future modifications to Git status, worktrees, and diffing prone to regression. Extracting `GitHistoricalReviewService` now keeps each concern isolated and easily testable.
2. **Public Barrel Pollution**: If internal components and tree builders remain exported from `libs/frontend/git-ui/src/index.ts`, other developers and apps will start importing them directly, cementing them into the public API and preventing future refactoring of the internal review UI.
3. **Dual Tree Builders**: Maintaining two distinct tree builders in `git-ui` duplicates maintenance overhead whenever path handling or folder display semantics change.
