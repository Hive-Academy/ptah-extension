# Dependency Upgrade Audit: commander, uuid, marked, gridstack

Comprehensive analysis of four deferred package migrations in `D:\projects\ptah-extension` across CommonJS and ESM consumers.

---

## 1. commander ^14.0.1 -> 15.x

### Package Metadata

- **Current Version in package.json**: `^14.0.1` (root and `apps/ptah-cli`)
- **Latest Stable Version**: `15.0.0` (confirmed via `npm view commander version` and `npm view commander dist-tags`)
- **Module Format**: **ESM-only**. `npm view commander@15.0.0 exports type main` confirms `"type": "module"`, `"main": "./index.js"`, and `"exports": { ".": { "types": "./typings/index.d.ts", "default": "./index.js" } }`. It declares no `"require"` export condition and provides no CommonJS build.
- **Engines Requirement**: `"engines": { "node": ">=22.12.0" }`. The repository runs on Node 24 (`.nvmrc` specifies `24`), which satisfies this requirement.

### Consumers Table

| File                              | Line | Module format of its project                                                                        | Breaks? |
| :-------------------------------- | :--- | :-------------------------------------------------------------------------------------------------- | :------ |
| `apps/ptah-cli/src/cli/router.ts` | 9    | ESM (`@nx/esbuild:esbuild` format: `["esm"]`, output `main.mjs`, `package.json` `"type": "module"`) | No      |

_(Note: `apps/ptah-tui/project.json:59` lists `"commander"` as an external build string but does not import or consume it)._

### API Breaking Changes Analysis

1. **ESM-Only Distribution**: `apps/ptah-cli` compiles to ESM (`dist/apps/ptah-cli/main.mjs`). Under Node 24, Node's native module loader executes `import { Command, Option } from 'commander'` without issue. Jest unit tests in `apps/ptah-cli` do not import `router.ts` at runtime (`apps/ptah-cli/src/cli/commands/*.spec.ts` only use `import type { GlobalOptions } from '../router.js'`, which is erased by TypeScript, and `apps/ptah-cli/src/cli/io/finalize-exit.spec.ts` reads `main.ts` as a raw text string). Smoke and E2E tests run the built `main.mjs` binary via `node`, which runs natively on Node 24.
2. **Option Default Handling**: Commander 15 changed default value semantics for negatable flags: only a lone `--no-*` option sets its default value to `true`; defaults are no longer implicitly set when both positive and negative options are declared. In `apps/ptah-cli/src/cli/router.ts`, only lone negatable options are defined (`--no-color` at line 194, `--no-force` at line 1942, and `--no-expose-workspace-tools` at line 2654). None declare a conflicting positive option on the same command, so their default value of `true` is preserved.
3. **Subpath Export Removal**: Commander 15 removed the deprecated `commander/esm.mjs` subpath export. `router.ts` imports from the root package `'commander'`, so this removal is not encountered.
4. **Core Command / Option API**: All methods called on `Command` and `Option` (`name`, `description`, `version`, `helpOption`, `addOption`, `option`, `requiredOption`, `command`, `argument`, `action`, `addHelpText`, `opts`, `parseAsync`) remain fully intact with identical signatures.

VERDICT: SAFE

(No required code changes).

---

## 2. uuid ^11.1.0 -> 14.x

### Package Metadata

- **Current Version in package.json**: `^11.1.0`
- **Latest Stable Version**: `14.0.2` (dist-tags: `latest: 14.0.2`, `legacy-13: 13.0.2`, `legacy-12: 12.0.1`, `legacy-11: 11.1.1`)
- **Module Format**: **ESM-only**. `npm view uuid@14.0.2 exports type main` confirms `"type": "module"` and `"exports": { ".": { "node": { "types": "./dist/index.d.ts", "default": "./dist-node/index.js" }, "default": "./dist/index.js" }, "./package.json": "./package.json" }`. No `"require"` condition is declared. CommonJS support was removed in `uuid` v12.0.0.
- **Engines Requirement**: Node >= 20 (dropped Node 18 in v14.0.0; expects global `crypto`). Workspace runs Node 24.

### Consumers Table

| File                                                                               | Line | Module format of its project                                                            | Breaks? |
| :--------------------------------------------------------------------------------- | :--- | :-------------------------------------------------------------------------------------- | :------ |
| `libs/backend/agent-sdk/src/lib/permission/permission-description.ts`              | 13   | CommonJS (`libs/backend/agent-sdk/project.json` build target format: `["cjs"]`)         | Yes     |
| `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`                         | 1    | CommonJS (`libs/backend/agent-sdk/project.json` build target format: `["cjs"]`)         | Yes     |
| `libs/backend/cli-agent-runtime/src/lib/cli-adapters/copilot-permission-bridge.ts` | 20   | CommonJS (`libs/backend/cli-agent-runtime/project.json` build target format: `["cjs"]`) | Yes     |
| `libs/frontend/chat-state/src/lib/identity/ids.ts`                                 | 22   | ESM (Angular webview bundle), CommonJS in Jest (`jest.config.ts` via `ts-jest`)         | Yes     |
| `libs/shared/src/lib/types/agent-process.types.ts`                                 | 6    | CommonJS (`libs/shared/project.json` build target format: `["cjs"]`)                    | Yes     |
| `libs/shared/src/lib/types/branded.types.ts`                                       | 7    | CommonJS (`libs/shared/project.json` build target format: `["cjs"]`)                    | Yes     |

### API Breaking Changes Analysis

1. **ESM-Only Drop of CommonJS (v12+)**: `libs/shared`, `libs/backend/agent-sdk`, and `libs/backend/cli-agent-runtime` build to CommonJS (`format: ["cjs"]`). Transpiled `require('uuid')` calls fail at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED` or `ERR_REQUIRE_ESM`.
2. **Jest Test Runner Breakage**: All Jest test suites in the repository run under CommonJS (`ts-jest`) with standard `testPathIgnorePatterns: ['/node_modules/']`. Because `uuid` 14.x contains no CommonJS exports, running any test that transitively requires `ids.ts`, `branded.types.ts`, or `agent-process.types.ts` throws an unhandled ESM syntax/resolution error in Jest.
3. **API Signatures**: The runtime function signature `v4()` and `validate()` did not change, but access is blocked by the module format boundary.
4. **Remediation Strategy**: All 6 call sites only require generating standard UUID v4 strings or testing UUID format. Node 20+ and modern evergreen browsers natively support `crypto.randomUUID()`. Replacing `uuid` with native `crypto.randomUUID()` (and `UUID_REGEX.test(...)` for validation) eliminates the npm dependency completely, resolving both CommonJS runtime crashes and Jest failures.

VERDICT: NEEDS CODE CHANGE

1. D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts:6 - Remove `import { v4 as uuidv4 } from 'uuid';` and replace line 21 `uuidv4() as AgentId` with `crypto.randomUUID() as AgentId`.
2. D:\projects\ptah-extension\libs\shared\src\lib\types\branded.types.ts:7 - Remove `import { v4 as uuidv4 } from 'uuid';` and replace lines 55, 120, 157, 194 `uuidv4() as ...` with `crypto.randomUUID() as ...`.
3. D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\identity\ids.ts:22 - Remove `import { v4 as uuidv4 } from 'uuid';` and replace lines 68, 95, 127 `uuidv4() as ...` with `crypto.randomUUID() as ...`.
4. D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\permission\permission-description.ts:13 - Remove `import { v4 as uuidv4 } from 'uuid';` and replace line 183 with `randomUUID()` imported from `'node:crypto'`.
5. D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts:1 - Remove `import { v4 as uuidv4, validate as isUuid } from 'uuid';`, replace line 869 with `randomUUID()` from `'node:crypto'`, and replace lines 632-633 with `UUID_REGEX.test(...)`.
6. D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\copilot-permission-bridge.ts:20 - Remove `import { v4 as uuidv4 } from 'uuid';` and replace line 229 with `randomUUID()` from `'node:crypto'`.

---

## 3. marked -> 18.x

### Package Metadata

- **Current Version in package.json**: `^17.0.0` (root and `libs/frontend/markdown`)
- **Latest Stable Version**: `18.0.13` (confirmed via `npm view marked version` and `npm view marked dist-tags`)
- **Module Format**: **ESM-only**. `npm view marked@18.0.13 exports type main` confirms `"type": "module"`, `"main": "./lib/marked.esm.js"`, and `"exports": { ".": { "types": "./lib/marked.d.ts", "default": "./lib/marked.esm.js" } }`. Marked has been ESM-only since v13.
- **Security Notice**: `libs/frontend/markdown` is the single XSS sanitization chokepoint for all AI-generated content (combining marked extensions with DOMPurify). Changes here are security-critical. Early 18.x releases (18.0.0, 18.0.1) suffered from CVE-2026-41680 (tokenizer infinite recursion ReDoS), which is fully resolved in target 18.0.13.

### Consumers Table

| File                                                                | Line | Module format of its project                                             | Breaks? |
| :------------------------------------------------------------------ | :--- | :----------------------------------------------------------------------- | :------ |
| `libs/frontend/markdown/src/lib/marked-extensions.ts`               | 12   | ESM (`@nx/angular:ng-packagr-lite` -> Angular Package Format ESM bundle) | No      |
| `libs/frontend/markdown/src/lib/marked-extensions.spec.ts`          | 1    | ESM (`@nx/angular:ng-packagr-lite` -> Angular Package Format ESM bundle) | No      |
| `libs/frontend/markdown/src/lib/provide-markdown-rendering.spec.ts` | 16   | ESM (`@nx/angular:ng-packagr-lite` -> Angular Package Format ESM bundle) | No      |

_(Note: `libs/web/members/src/lib/markdown-chokepoint.spec.ts:83` references the literal string `"from 'marked'"` in an architectural lint asserting that no second parser is introduced; it is not an import of marked)._

### API Breaking Changes Analysis

1. **Peer Dependency Compatibility**: `libs/frontend/markdown` consumes marked through `ngx-markdown` (`^22.0.2`). Inspection of `npm view ngx-markdown@22.0.2 peerDependencies` confirms it natively supports `"marked": "^17.0.0 || ^18.0.0"`.
2. **Type-Only Consumption**: The codebase never imports `marked` as a runtime JavaScript object; it only imports `type { MarkedExtension, Tokens } from 'marked'`. The typings for `MarkedExtension`, `Tokens.Generic`, `Tokens.Blockquote`, `Tokens.Paragraph`, `Tokens.Text`, `Tokens.Code`, `Tokens.Heading`, `Tokens.List`, `Tokens.ListItem`, and `Tokens.Link` remain structurally compatible in 18.x.
3. **Block Token Blank Line Trimming**: Marked 18.0.0 introduces breaking changes trimming trailing blank lines from block tokens (specifically tables, headings, and paragraphs). In `libs/frontend/markdown/src/lib/marked-extensions.ts`, regex matchers such as `CALLOUT_REGEX = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i` inspect the leading prefix of `para.raw` and `para.text`, unaffected by trailing newline trimming. Custom renderers (`heading`, `code`, `blockquote`, `list`, `link`) continue to return DOMPurify-compliant markup.

VERDICT: SAFE

(No required code changes).

---

## 4. gridstack -> 13.x

### Package Metadata

- **Current Version in package.json**: `^12.5.0`
- **Latest Stable Version**: `13.3.0` (confirmed via `npm view gridstack version` and `npm view gridstack dist-tags`)
- **Module Format**: Root `gridstack` has `"main": "./dist/gridstack.js"` (UMD/CommonJS). The Angular wrapper `gridstack/dist/angular` has `"module": "fesm2015/gridstack-angular.mjs"`, `"fesm2020": "fesm2020/gridstack-angular.mjs"`, `"exports": { ".": { "types": "./index.d.ts", "default": "./fesm2020/gridstack-angular.mjs" } }` (ESM-only APF format, unchanged from 12.x).

### Consumers Table

| File                                                              | Line | Module format of its project                                    | Breaks? |
| :---------------------------------------------------------------- | :--- | :-------------------------------------------------------------- | :------ |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` | 12   | ESM (Angular 21 library under `@ptah-extension/canvas`)         | No      |
| `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts` | 9    | ESM (Angular 21 library under `@ptah-extension/tribunal-panel`) | Yes     |

### Detailed API Call Inventory & Compatibility

#### `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`

| File:Line | API Call / Symbol                                                 | Status in 13.x                                                    |
| :-------- | :---------------------------------------------------------------- | :---------------------------------------------------------------- |
| Line 12   | `import { GridStackOptions } from 'gridstack'`                    | Survives (interface exported from root)                           |
| Line 13   | `import { type GridStackNode } from 'gridstack'`                  | Survives (interface exported from root)                           |
| Line 14   | `import { type GridStackWidget } from 'gridstack'`                | Survives (interface exported from root)                           |
| Line 17   | `import { GridstackComponent } from 'gridstack/dist/angular'`     | Survives (Angular component exported from wrapper)                |
| Line 18   | `import { GridstackItemComponent } from 'gridstack/dist/angular'` | Survives (Angular component exported from wrapper)                |
| Line 19   | `import { type elementCB } from 'gridstack/dist/angular'`         | Survives (type exported from wrapper)                             |
| Line 100  | `<gridstack>` selector                                            | Survives                                                          |
| Line 101  | `[options]="gsOptions"` (`options` input on `GridstackComponent`) | Survives (`@Input() set options(o: GridStackOptions)`)            |
| Line 105  | `(changeCB)="onGridChange()"` (`changeCB` output)                 | Survives (`@Output() changeCB: EventEmitter<nodesCB>`)            |
| Line 106  | `(dragStartCB)="onGestureStart('drag', $event)"`                  | Survives (`@Output() dragStartCB: EventEmitter<elementCB>`)       |
| Line 107  | `(dragCB)="onGestureMove($event)"`                                | Survives (`@Output() dragCB: EventEmitter<elementCB>`)            |
| Line 108  | `(resizeStartCB)="onGestureStart('resize', $event)"`              | Survives (`@Output() resizeStartCB: EventEmitter<elementCB>`)     |
| Line 109  | `(dragStopCB)="onGestureStop('drag', $event)"`                    | Survives (`@Output() dragStopCB: EventEmitter<elementCB>`)        |
| Line 110  | `(resizeStopCB)="onGestureStop('resize', $event)"`                | Survives (`@Output() resizeStopCB: EventEmitter<elementCB>`)      |
| Line 113  | `<gridstack-item>` selector and `[options]="item.options"`        | Survives (`@Input() set options(val: GridStackNode)`)             |
| Line 193  | `viewChild(GridstackComponent)`                                   | Survives                                                          |
| Line 406  | `this.gridComp()?.grid`                                           | Survives (`get grid(): GridStack \| undefined`)                   |
| Line 410  | `(grid as unknown as { onResize?: () => void }).onResize?.()`     | Survives (`onResize(): void` on `GridStack`)                      |
| Line 422  | `grid?.setStatic(locked)`                                         | Survives (`setStatic(val: boolean, updateClass?: boolean)`)       |
| Line 467  | `event.el.gridstackNode?.id`                                      | Survives (`gridstackNode` on `GridItemHTMLElement`)               |
| Line 552  | `grid.engine.nodes`                                               | Survives (`engine: GridStackEngine`, `nodes: GridStackNode[]`)    |
| Line 750  | `grid.setStatic(false)`                                           | Survives                                                          |
| Line 753  | `grid.cellHeight(cellHeight)`                                     | Survives (`cellHeight(val?: number \| string, update?: boolean)`) |
| Line 758  | `grid.load(positioned.map(...), false)`                           | Survives (`load(items: GridStackWidget[], addRemove?: boolean)`   |
| Line 769  | `grid.getCellHeight()`                                            | Survives (`getCellHeight(): number`)                              |
| Line 778  | `grid.setStatic(true)`                                            | Survives                                                          |
| Line 812  | `grid.movable?.(node.el, movable)`                                | Survives (`movable(els: GridStackElement, val: boolean)`)         |
| Line 813  | `grid.resizable?.(node.el, resizable)`                            | Survives (`resizable(els: GridStackElement, val: boolean)`)       |
| Line 828  | `element.gridstackNode`                                           | Survives (`gridstackNode` on `GridItemHTMLElement`)               |

#### `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts`

| File:Line    | API Call / Symbol                                                 | Status in 13.x                                                                                                                                                                                                                                                                                         |
| :----------- | :---------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line 9       | `import { GridStackOptions } from 'gridstack'`                    | Survives (interface exported from root)                                                                                                                                                                                                                                                                |
| Line 11      | `import { GridstackComponent } from 'gridstack/dist/angular'`     | Survives                                                                                                                                                                                                                                                                                               |
| Line 12      | `import { GridstackItemComponent } from 'gridstack/dist/angular'` | Survives                                                                                                                                                                                                                                                                                               |
| Line 13      | `import { nodesCB } from 'gridstack/dist/angular'`                | **BREAKS as a value import**. In 13.x, `nodesCB` is declared strictly as `export declare type nodesCB = { event: Event; nodes: GridStackNode[] }`. Importing `nodesCB` as a JavaScript value symbol causes compile/bundler errors under strict bundler resolution. Must be imported as `type nodesCB`. |
| Line 36-37   | `imports: [GridstackComponent, GridstackItemComponent]`           | Survives                                                                                                                                                                                                                                                                                               |
| Line 154     | `<gridstack>` selector                                            | Survives                                                                                                                                                                                                                                                                                               |
| Line 155     | `[options]="gsOptions"`                                           | Survives                                                                                                                                                                                                                                                                                               |
| Line 156     | `(changeCB)="onGridChange($event)"`                               | Survives                                                                                                                                                                                                                                                                                               |
| Line 159-166 | `<gridstack-item [options]="...">`                                | Survives                                                                                                                                                                                                                                                                                               |
| Line 234     | `viewChild(GridstackComponent)`                                   | Survives                                                                                                                                                                                                                                                                                               |
| Line 240-248 | `gsOptions: GridStackOptions` definition                          | Survives                                                                                                                                                                                                                                                                                               |
| Line 302     | `this.gridComp()?.grid?.setStatic(next)`                          | Survives                                                                                                                                                                                                                                                                                               |
| Line 305     | `onGridChange(data: nodesCB)` accessing `data.nodes`              | Survives (when typed with `type nodesCB`)                                                                                                                                                                                                                                                              |
| Line 309-312 | `node.id`, `node.x`, `node.y`, `node.w`, `node.h`                 | Survives                                                                                                                                                                                                                                                                                               |

### Angular Wrapper Breaking Change Investigation

Gridstack 13 PR #3310 ("Angular wrapper using component+props (instead of selector+input)") changed the convention for **dynamic JSON component creation**:

- Dynamic widget descriptor `{ selector: 'app-chart', input: { ... } }` was replaced by `{ component: 'app-chart', props: { ... } }`.
- Static registration `GridstackComponent.addComponentToSelectorType([...])` was renamed to `GridstackComponent.registerComponents([...])`.
- Neither `canvas-workspace-grid.component.ts` nor `tribunal-page.component.ts` uses dynamic component instantiation or `addComponentToSelectorType`. Both use the template `@for` loop declaring `<gridstack-item [options]="...">` directly in HTML, which remains supported and documented in Gridstack 13 (`angular/README.md#ngfor-with-wrapper`).

However, `tribunal-page.component.ts` imports `nodesCB` as a value on line 13. In GridStack 13, `nodesCB` is a pure TypeScript type alias and has no corresponding JavaScript runtime export. Additionally, the corresponding unit test stub in `libs/frontend/tribunal-panel/src/test-gridstack-stub.ts` line 32 (`export const nodesCB = undefined;`) must be updated to export `nodesCB` as a type.

VERDICT: NEEDS CODE CHANGE

1. D:\projects\ptah-extension\libs\frontend\tribunal-panel\src\lib\tribunal-page.component.ts:13 - Change `nodesCB` to `type nodesCB` in the import statement from `'gridstack/dist/angular'`.
2. D:\projects\ptah-extension\libs\frontend\tribunal-panel\src\test-gridstack-stub.ts:32 - Change `export const nodesCB = undefined;` to `export type nodesCB = { event: Event; nodes: unknown[] };`.
