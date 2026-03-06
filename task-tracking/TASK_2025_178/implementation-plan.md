# TASK_2025_178: Implementation Plan

## Strategy: Fix by Rule Type (most mechanical first)

Fixing by rule type is more systematic than by project because:

- Each rule has a single, repeatable fix pattern
- Auto-fix tools can batch many changes at once
- Lower risk of introducing bugs when changes are uniform
- Easier to review (all changes in a commit follow the same pattern)

---

## Phase 1: `no-unused-vars` (115 warnings) — SAFEST, DO FIRST

**Fix pattern**: Remove unused variables, prefix with `_`, or delete unused imports.

**Auto-fix**: ESLint cannot auto-fix this, but the pattern is mechanical:

- Unused function params → prefix with `_` (e.g., `_options`)
- Unused local vars → delete the declaration
- Unused imports → delete the import line
- Unused catch vars → use `catch` without binding (or `_error`)

### Batches (by project, parallelizable):

| Batch | Project                         | Count   | Files                                                                                           |
| ----- | ------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| 1A    | agent-sdk                       | 30      | ~12 files (ptah-cli-registry, session-lifecycle-manager, helpers, specs)                        |
| 1B    | ptah-extension-vscode           | 21      | ~7 files (rpc-handlers, webview-html-generator, ptah-extension)                                 |
| 1C    | vscode-core                     | 19      | ~5 files (file-system-manager, status-bar-manager, output-manager, rpc-handler)                 |
| 1D    | chat                            | 14      | ~8 files (chat.store, streaming-handler, execution-tree-builder, specs)                         |
| 1E    | llm-abstraction                 | 9       | ~6 files (llm-secrets, copilot-sdk.adapter, codex-cli.adapter.spec, agent-process-manager.spec) |
| 1F    | workspace-intelligence          | 7       | ~5 files (specs: services, reporting, performance, ast-analysis, tree-sitter)                   |
| 1G    | vscode-lm-tools                 | 6       | ~3 files (namespace builders)                                                                   |
| 1H    | core + template-generation + ui | 5+3+1=9 | ~5 files                                                                                        |

**Commit**: `fix(lint): resolve 115 no-unused-vars warnings across workspace`

---

## Phase 2: `explicit-member-accessibility` (119 warnings) — MECHANICAL

**Fix pattern**: Add `public` keyword before class properties/methods that lack visibility modifiers.

**Auto-fix**: ESLint CAN auto-fix this rule with `--fix`.

### Batches:

| Batch | Project           | Count | Files                                                                                          |
| ----- | ----------------- | ----- | ---------------------------------------------------------------------------------------------- |
| 2A    | setup-wizard      | 111   | ~15 files (all components + services — wizard-view, welcome, scan-progress, analysis-\*, etc.) |
| 2B    | ptah-landing-page | 8     | ~2 files (trial-ended-modal, docs-collapsible-card)                                            |

**Auto-fix command**: `npx nx lint setup-wizard --fix` and `npx nx lint ptah-landing-page --fix` should handle most of these.

**Commit**: `fix(lint): add explicit member accessibility modifiers (119 warnings)`

---

## Phase 3: `no-explicit-any` (134 warnings) — REQUIRES JUDGMENT

**Fix pattern**: Replace `any` with proper types. Varies by context:

- Function params → use specific interface or `unknown`
- Generic containers → use proper generic type
- API responses → create/use existing response interfaces
- Test mocks → use `jest.Mocked<T>` or `Partial<T>`
- Catch blocks → use `unknown` + type guard

### Batches (by project):

| Batch | Project                                                       | Count        | Difficulty                                            |
| ----- | ------------------------------------------------------------- | ------------ | ----------------------------------------------------- |
| 3A    | vscode-lm-tools                                               | 34           | Medium — namespace builders need typed API signatures |
| 3B    | workspace-intelligence                                        | 23           | Medium — AST/quality assessment interfaces            |
| 3C    | chat                                                          | 21           | Low-Medium — template `$any()` casts + service types  |
| 3D    | setup-wizard                                                  | 18           | Low — component state types                           |
| 3E    | vscode-core                                                   | 9            | Medium — API wrapper generics                         |
| 3F    | agent-sdk + llm-abstraction                                   | 8+8=16       | Medium — SDK types, provider types                    |
| 3G    | template-generation + shared + ptah-extension-vscode + others | 5+3+3+1+1=13 | Low-Medium                                            |

**Commit**: `fix(lint): replace no-explicit-any with proper types (134 warnings)`

---

## Phase 4: `no-non-null-assertion` (135 warnings) — REQUIRES CARE

**Fix pattern**: Replace `!` assertions with safe alternatives:

- Optional chaining: `obj!.prop` → `obj?.prop`
- Null check: `if (obj) { use(obj.prop); }`
- Non-null assertion with comment: `// eslint-disable-next-line` (rare, only when guaranteed non-null)
- Default values: `obj!.prop` → `obj?.prop ?? defaultValue`

### Batches (by project):

| Batch | Project                               | Count    | Risk                                              |
| ----- | ------------------------------------- | -------- | ------------------------------------------------- |
| 4A    | workspace-intelligence                | 48       | Medium — AST traversal often has guaranteed nodes |
| 4B    | llm-abstraction                       | 25       | Medium — provider registry, service chaining      |
| 4C    | vscode-lm-tools                       | 18       | Medium — MCP handler/builder chains               |
| 4D    | agent-sdk                             | 14       | Medium — SDK message processing                   |
| 4E    | setup-wizard                          | 9        | Low — component null guards                       |
| 4F    | vscode-core                           | 8        | Low — API wrappers                                |
| 4G    | shared + chat + ptah-extension-vscode | 6+5+2=13 | Low                                               |

**Commit**: `fix(lint): replace non-null assertions with safe null handling (135 warnings)`

---

## Phase 5: Angular Template Issues (16 warnings + 1 error) — SMALL

### 5A: `@angular-eslint/template/prefer-ngsrc` (1 ERROR)

- **File**: `chat-input.component.ts` line 106
- **Fix**: Replace `[src]` with `[ngSrc]`, import `NgOptimizedImage`

### 5B: `@angular-eslint/template/no-any` (8 warnings)

- **Project**: chat
- **Fix**: Remove `$any()` casts, use proper typed expressions

### 5C: `@angular-eslint/template/click-events-have-key-events` (7 warnings)

- **Project**: setup-wizard
- **Fix**: Add `(keydown.enter)="handler()"` alongside `(click)="handler()"`

**Commit**: `fix(lint): resolve Angular template issues (ngsrc, $any, keyboard events)`

---

## Execution Order

```
Phase 1 (no-unused-vars)        ← Safest, cleans dead code, may reduce other warnings
    ↓
Phase 2 (explicit-member-access) ← Auto-fixable, mechanical
    ↓
Phase 3 (no-explicit-any)        ← Improves type safety
    ↓
Phase 4 (no-non-null-assertion)  ← Improves null safety
    ↓
Phase 5 (Angular templates)      ← Small, finishes cleanup
    ↓
Final: Verify `nx run-many --target=lint --all` = 0 warnings, 0 errors
```

## Estimated Scope

- **Total warnings to fix**: 519 warnings + 1 error = **520 issues**
- **Files affected**: ~100 files across 14 projects
- **Commits**: 5 (one per phase) + 1 verification commit if needed

## Risk Mitigation

1. **Run tests after each phase** to catch regressions: `npx nx run-many --target=test --all`
2. **Phase 1 first** because removing unused code can't break anything
3. **Phase 2 auto-fix** is purely additive (adding `public` keyword)
4. **Phase 3-4** require more judgment — review carefully in test files vs production code
5. **Never suppress warnings** with `eslint-disable` unless there's a documented justification
