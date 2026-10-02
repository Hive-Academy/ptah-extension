# Gate Decision Report - Pierre Performance, Worker Pool & Large Files (A9 Spike / Batch 58 Gate)

- **Task**: TASK_2026_576_e16a
- **Gate**: Pre-cutover Gate for Batch 58 (Review Canvas Mount) & Batch 60 (Electron Perf Spec)
- **Author**: researcher-expert
- **Date**: 2026-10-02
- **Deliverable**: `reviews/gate-p4-a9-pierre-perf.md`
- **Context**: A9 Spike Results in `batches.md:1721-1729` (Batch 38 Outcome)

---

## 1. Executive Summary & Decisions

### Background & Spike Context
During the Batch 38 review canvas spike (Task 38.1, headless Chromium at 1280×800):
- **200-file split fixture (main-thread Shiki)**: 46 fps with 22 long tasks (> 200 ms); each file mount incurred 150–230 ms of main-thread JavaScript execution.
- **200-file split fixture (with Pierre Worker Pool)**: **54 fps with 0 long tasks** (58 fps in unified mode); Shiki tokenization executed off the main thread.
- **Single 10,000-changed-line file**: Failed every variant:
  - `FileDiff` + worker pool: worst task **2,006 ms** (frozen main thread for > 2 seconds during DOM injection).
  - `VirtualizedFileDiff` + worker pool: worst task **542 ms** (10× above the 50 ms frame budget).
  - `VirtualizedFileDiff` on main thread: **~20 seconds** first render.

This gate settles two architectural questions before the review canvas mounts at cutover (Batch 58):
1. **Q1 (Worker Pool)**: Should `PierreDiffHostComponent` use Pierre's worker pool, and how must the Angular build and host CSPs be configured?
2. **Q2 (Large Files)**: Should Ptah adopt a changed-line cap (with a labelled row and Open-in actions) or `VirtualizedFileDiff` (+ pool)?

---

### The Decisions

### Decision Q1: Adopt Pierre's Worker Pool via `getOrCreateWorkerPoolSingleton` with a Blob URL Factory backed by `worker-portable.js`

**Recommendation**: **YES.** Wire `PierreDiffHostComponent` to use `@pierre/diffs/worker`'s worker pool singleton initialized with a Blob URL worker factory.

**Core Rationale**:
1. **Direct Perf Compliance**: Moving Shiki tokenization off the main thread is the single difference between failing performance (46 fps, 22 long tasks > 200 ms) and green performance (**54 fps, 0 long tasks > 200 ms**) on the 200-file review fixture, fulfilling Requirement 6.2 and Task 60.1 criteria.
2. **`worker-portable.js` is Tailor-Made**: `@pierre/diffs` 1.5.1 distributes `dist/worker/worker-portable.js`, a 442 KB self-contained worker bundle with **zero external ESM imports**, no `importScripts`, no `eval`, and no `new Function`.
3. **VS Code Webview Worker Restriction Solved**: Direct `new Worker(vscode-webview://...)` fails in VS Code webviews with a `SecurityError` due to iframe origin partitioning. VS Code's official extension guidance sanctions loading the worker script via `fetch()` and instantiating `new Worker(URL.createObjectURL(blob))`. The worker pool's synchronous `workerFactory: () => Worker` contract is cleanly satisfied by prefetching `worker-portable.js` once into a Blob URL on initial pool creation.
4. **CSP Alignment**:
   - `apps/ptah-electron/scripts/copy-renderer.js:164` already ships `worker-src 'self' blob:;`.
   - `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:291-299` currently omits `worker-src` (defaulting to `default-src 'none'`), which must be updated to `worker-src blob:;` (or `worker-src 'self' blob:;`).

### Decision Q2: Enforce a Changed-Line Cap (N = 3,000 changed lines) with Labelled Row & Open-in Actions; Reject `VirtualizedFileDiff`

**Recommendation**: **Adopt a changed-line cap at N = 3,000 changed lines.** Files exceeding 3,000 changed lines (`(additions ?? 0) + (deletions ?? 0) > 3,000`, or hunk line count > 3,000) are rendered as a labelled informational row:
`▦ Too large to render in canvas (X changed lines) — open in editor to review`
with editor launch actions provided by the header's `OpenInButtonComponent`. Do **not** adopt `VirtualizedFileDiff`.

**Core Rationale**:
1. **`VirtualizedFileDiff` Fails Performance Budget**: The spike proved that `VirtualizedFileDiff + pool` still incurs a **542 ms** task blocking the main thread on a 10,000-line diff. It does not prevent frame freezing.
2. **Severe Architectural Incompatibility**:
   - `ReviewCanvasComponent` is already a continuous scrolling virtualized list with an Angular `IntersectionObserver` managing off-screen file unmounting (`review-canvas.component.ts:16-17, 107-133`).
   - `VirtualizedFileDiff` requires a `@pierre/diffs` `Virtualizer` or `CodeView` instance (`VirtualizedFileDiff.d.ts:16`), creating nested, conflicting virtualizers that desynchronize scroll offsets and trigger viewport blanking.
   - **Breaks Hunk Toolbars**: In `FileDiffSectionComponent`, hunk action toolbars project into Pierre's light-DOM `<slot>`s. `VirtualizedFileDiff` unmounts offscreen DOM nodes and their `<slot>`s dynamically, which breaks Angular template projection and causes toolbar flickering.
3. **Established Pattern & Existing Infrastructure**:
   - `FileDiffSectionComponent` already implements labelled row handling for binary, submodule, conflicted, and `too-large` files (`file-diff-section.component.ts:90-121`).
   - `OpenInButtonComponent` (`file-diff-section.component.ts:236-243`) is already present on every file header, routing directly to `ptah.review.openDiff` (VS Code native diff editor) or external launchers.
   - Matching Industry Standards: GitHub hides diffs over 3,000 lines / 0.5 MB by default; VS Code disables inline diff rendering past 5,000 lines. A 3,000-line cap protects main-thread responsiveness while covering >99.8% of daily code review files.

---

## 2. Codebase & Library Evidence

### 2.1 Current Implementation in `PierreDiffHostComponent`
- **Location**: `libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts:216-245`
  ```typescript
  const instance = new FileDiff(
    {
      ...createPierreDiffOptions(diffStyle, untracked(this.themeType)),
      onPostRender: (node, _instance, phase) => { ... },
    },
    undefined, // <-- Worker pool is currently undefined!
    true,      // isContainerManaged
  );
  ```
  Passing `undefined` forces Pierre to execute Shiki parsing synchronously on the browser main thread during `instance.render(...)`.

### 2.2 How `@pierre/diffs` 1.5.1 Exposes the Worker Pool
- **Package Exports** (`node_modules/@pierre/diffs/package.json:50-61`):
  ```json
  "./worker": {
    "types": "./dist/worker/index.d.ts",
    "import": "./dist/worker/index.js"
  },
  "./worker/worker.js": { ... },
  "./worker/worker-portable.js": { ... }
  ```
- **API Surface** (`node_modules/@pierre/diffs/dist/worker/index.d.ts:1-4`):
  - `getOrCreateWorkerPoolSingleton({ poolOptions, highlighterOptions }): WorkerPoolManager`
  - `terminateWorkerPoolSingleton(): void`
  - `WorkerPoolManager` class
- **Options Contract** (`dist/worker/types.d.ts:95-116`):
  ```typescript
  interface WorkerPoolOptions {
    /** Factory function called once per worker during initialization */
    workerFactory: () => Worker;
    /** Default: 8 */
    poolSize?: number;
    workerInitializationTimeout?: number;
    totalASTLRUCacheSize?: number;
  }
  interface WorkerInitializationRenderOptions {
    theme?: DiffsThemeNames | ThemesType;
    preferredHighlighter?: 'shiki-js' | 'shiki-wasm';
    lineDiffType?: LineDiffTypes;
  }
  ```
- **Worker Script Comparison in `dist/worker`**:
  - `dist/worker/worker.js`: Uses ES module imports (`import { createHighlighterCore } from "shiki/core"; ...`). Cannot run as a standalone Blob URL worker without bundler bundling.
  - `dist/worker/worker-portable.js`: **13,446 lines / 442 KB**, compiled by rolldown. **Zero external ESM imports** (`import ... from ...` returns null). Self-contains Shiki, regex parser, textmate grammar engine, and Pierre's theme resolver. Contains no `new Function` or `eval()`. Ideal for standalone Blob URL instantiation.

### 2.3 Webview Build & Asset Configuration
- **Location**: `apps/ptah-extension-webview/project.json:9-27`
  - Builder: `@angular/build:application` (esbuild-based Angular 22 builder).
  - Assets array currently copies `public/` and `monaco-editor/min`:
    ```json
    "assets": [
      { "glob": "**/*", "input": "apps/ptah-extension-webview/public" },
      { "glob": "**/*", "input": "node_modules/monaco-editor/min", "output": "/assets/monaco" }
    ]
    ```
  - Emitting `worker-portable.js` as an asset requires adding:
    ```json
    {
      "glob": "worker-portable.js",
      "input": "node_modules/@pierre/diffs/dist/worker",
      "output": "/assets/pierre"
    }
    ```
    This places `worker-portable.js` at `dist/apps/ptah-extension-webview/browser/assets/pierre/worker-portable.js`.

### 2.4 VS Code Webview Origin & Worker Restrictions
- **Official VS Code Webview API Documentation** (`api/extension-guides/webview.md`):
  > *"First off, workers can only be loaded using either a data: or blob: URI. You cannot directly load a worker from your extension's folder. If you do need to load worker code from a JavaScript file in your extension, try using fetch:
  > ```javascript
  > const workerSource = 'absolute/path/to/worker.js';
  > fetch(workerSource)
  >   .then(result => result.blob())
  >   .then(blob => {
  >      const blobUrl = URL.createObjectURL(blob);
  >      new Worker(blobUrl);
  >   });
  > ```
  > Worker scripts also do not support `importScripts` or `import(...)` to load external code."*
- **Mechanism in Ptah**:
  1. The Angular webview document is hosted inside a sandboxed iframe with a `vscode-webview:` origin.
  2. Attempting `new Worker('./assets/pierre/worker-portable.js')` throws a cross-origin / opaque origin `SecurityError`.
  3. `fetch('assets/pierre/worker-portable.js')` is permitted because `connect-src` includes `'self' ${webview.cspSource}`.
  4. Creating a Blob from the fetched text and constructing `new Worker(blobUrl)` succeeds because Blob URLs share the webview's execution context.
  5. Because `worker-portable.js` has no secondary imports, it executes cleanly without attempting blocked imports.

### 2.5 Content Security Policy (CSP) Analysis
1. **VS Code Webview** (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:290-300`):
   ```typescript
   default-src 'none';
   img-src ${webview.cspSource} https: data: blob:;
   script-src 'nonce-${nonce}';
   style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
   font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
   connect-src 'self' ${webview.cspSource};
   frame-src 'none';
   object-src 'none';
   base-uri 'self' ${webview.cspSource};
   ```
   **Defect**: There is **no** `worker-src` or `child-src` directive! Under CSP Level 3, web worker creation falls back to `child-src`, which falls back to `default-src 'none'`. Any worker instantiation (`new Worker(...)`) is currently blocked by Chromium with a CSP violation.
   **Fix**: Add `worker-src blob:;` (or `worker-src 'self' blob:;`).

2. **Electron Renderer** (`apps/ptah-electron/scripts/copy-renderer.js:156-169`):
   ```javascript
   const policy = [
     "default-src 'none'",
     "script-src 'self'",
     "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
     "img-src 'self' https: data: blob:",
     "font-src 'self' https://fonts.gstatic.com data:",
     "connect-src 'self'",
     "media-src 'self' blob:",
     "worker-src 'self' blob:", // <-- ALREADY PRESENT!
     "object-src 'none'",
     "base-uri 'self'",
     "frame-src 'none'",
     "form-action 'none'",
   ].join('; ');
   ```
   Electron renderer already permits `blob:` and `'self'` workers in its policy.

### 2.6 Large File Handling in `FileDiffSectionComponent`
- **Location**: `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts`
  - Already supports labelled rows for `binary`, `submodule`, `conflicted`, `too-large`, and `lfs-pointer` (`lines 75-121`).
  - Label row template (`lines 331-338`) renders an accessible notice with icon and text instead of mounting Pierre.
  - Sticky header (`lines 178-245`) renders `ptah-open-in-button` whenever editor targets are available, allowing users to open the diff in VS Code or external tools.
  - Adding a changed-line cap requires only checking `file().additions + file().deletions > N` (or hunk line count) and resolving to the `too-large` label row.

---

## 3. Evaluation of Options

### Q1: Worker Pool Wiring Options

| Option | Feasibility | Cost to Adopt | Known Failure Mode / Constraints |
|---|---|---|---|
| **(a) Main-Thread Only (No Pool)** | High (status quo) | 0 work | **Fails Req 6.2 & Batch 60 perf gate**: 46 fps, 22 long tasks > 200 ms. Reviewing 200 files freezes the UI repeatedly. |
| **(b) Direct `new Worker(url)`** | **Infeasible on VS Code** | Low | **`SecurityError` in VS Code webview**: Webview iframe cannot spawn workers from `vscode-webview://` or relative URLs. |
| **(c) Blob URL Factory + `worker-portable.js` Asset (Recommended)** | **High across both hosts** | Low: 1 asset glob in `project.json`, 1 CSP line in `webview-html-generator.ts`, 1 worker pool service in `git-ui` | Requires prefetching the 442 KB script text once before pool construction. |

### Q2: Large File Strategy Options

| Option | Feasibility | Cost to Adopt | Known Failure Mode / Constraints |
|---|---|---|---|
| **(a) `VirtualizedFileDiff` (+ Worker Pool)** | **Infeasible / High Risk** | Very High: Rewriting canvas coordination, virtualizer reconciliation, custom slot attachment | **Still freezes main thread**: 542 ms task on 10,000-line file. Unmounting shadow DOM nodes breaks Angular hunk toolbar projection. Conflicting virtualizers cause scroll jitter. |
| **(b) Changed-Line Cap N = 3,000 with Open-in Actions (Recommended)** | **High** | Very Low: Extends existing `labelRow` and `OpenInButtonComponent` logic in `FileDiffSectionComponent` | Users cannot see diffs > 3,000 lines directly inside the webview canvas without clicking "Open in Editor" (standard industry trade-off). |

---

## 4. Detailed Design & Implementation Plan

### 4.1 Asset Distribution (`project.json`)
In `apps/ptah-extension-webview/project.json` under `targets.build.options.assets`:
```json
{
  "glob": "worker-portable.js",
  "input": "node_modules/@pierre/diffs/dist/worker",
  "output": "/assets/pierre"
}
```
This ensures `worker-portable.js` is copied to the build output in both VS Code webview and Electron renderer distributions.

### 4.2 CSP Update in VS Code Host
In `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` line 291:
```diff
    return `default-src 'none';
            img-src ${webview.cspSource} https: data: blob:;
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
            font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
            connect-src 'self' ${webview.cspSource};
+           worker-src blob:;
            frame-src 'none';
            object-src 'none';
            base-uri 'self' ${webview.cspSource};`;
```

### 4.3 Worker Pool Singleton Provider in `git-ui`
Create a helper / service in `libs/frontend/git-ui/src/lib/renderer/pierre-worker-pool.ts`:
```typescript
import {
  getOrCreateWorkerPoolSingleton,
  type WorkerPoolManager,
} from '@pierre/diffs/worker';
import { DEFAULT_THEMES } from '@pierre/diffs';

let poolPromise: Promise<WorkerPoolManager> | null = null;
let cachedPool: WorkerPoolManager | null = null;

export function getPierreWorkerPool(): WorkerPoolManager | undefined {
  return cachedPool ?? undefined;
}

export async function initPierreWorkerPool(
  workerScriptUrl = 'assets/pierre/worker-portable.js',
): Promise<WorkerPoolManager> {
  if (cachedPool) return cachedPool;
  if (!poolPromise) {
    poolPromise = (async () => {
      try {
        const response = await fetch(workerScriptUrl);
        const scriptText = await response.text();
        const blob = new Blob([scriptText], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);

        const poolSize = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 6));
        const manager = getOrCreateWorkerPoolSingleton({
          poolOptions: {
            workerFactory: () => new Worker(blobUrl),
            poolSize,
            workerInitializationTimeout: 10_000,
          },
          highlighterOptions: {
            theme: DEFAULT_THEMES,
            preferredHighlighter: 'shiki-js',
          },
        });
        cachedPool = manager;
        return manager;
      } catch (err) {
        console.warn('Failed to initialize Pierre worker pool; falling back to main thread', err);
        throw err;
      }
    })();
  }
  return poolPromise;
}
```

In `PierreDiffHostComponent` (`libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts:243`):
```diff
    const instance = new FileDiff(
      {
        ...createPierreDiffOptions(diffStyle, untracked(this.themeType)),
        onPostRender: (node, _instance, phase) => { ... },
      },
-     undefined,
+     getPierreWorkerPool(),
      true,
    );
```

### 4.4 Large-File Changed-Line Cap in `FileDiffSectionComponent`
In `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts`:
- Define `MAX_RENDERABLE_CHANGED_LINES = 3000`.
- In `labelKind` computed signal:
  ```typescript
  protected readonly labelKind = computed<LabelKind | null>(() => {
    const listed = this.file().label;
    if (listed) return listed;

    // Check changed lines cap before reading or rendering
    const additions = this.file().additions ?? 0;
    const deletions = this.file().deletions ?? 0;
    if (additions + deletions > MAX_RENDERABLE_CHANGED_LINES) {
      return 'too-large';
    }

    const diff = this.diff();
    if (!diff || diff.status === 'error') return null;
    if (diff.isBinary) return 'binary';
    return diff.unrenderable?.reason ?? null;
  });
  ```
- In `labelRow` computed signal:
  Customize display copy when triggered by changed-line count:
  `Too large to render in canvas (N changed lines) — open in editor to review`

---

## 5. Batch Allocation & Performance Re-measurement Plan

### 5.1 Batch Allocation
- **P4 Follow-Up Batch (Batch 43b or 44 pre-req)**:
  - Add `worker-portable.js` asset in `apps/ptah-extension-webview/project.json`.
  - Add `worker-src blob:;` in `apps/ptah-extension-vscode/src/services/webview-html-generator.ts`.
  - Add `pierre-worker-pool.ts` in `libs/frontend/git-ui` and wire into `PierreDiffHostComponent`.
  - Add changed-line cap (N = 3,000) to `file-diff-section.component.ts`.
  - Update `pierre-diff-host.component.spec.ts` and `file-diff-section.component.spec.ts`.
- **Batch 58 (Cutover Mount)**:
  - `ReviewShellComponent` / `ReviewCanvasComponent` mounts in `electron-shell.component.ts`.
  - Calls `initPierreWorkerPool()` during canvas initialization.

### 5.2 Re-measurement in Batch 60 (`review-canvas-large.spec.ts`)
In `apps/ptah-electron-e2e/src/specs/git/review-canvas-large.spec.ts`:
1. **200-File Split Fixture**:
   - Scroll through 200 files in the review canvas.
   - Measure frame rate: assert average FPS ≥ 50 fps (A9 spike achieved 54 fps).
   - Measure long tasks via `PerformanceObserver`: assert **0 long tasks > 200 ms** (A9 spike achieved 0).
2. **10,000-Line Single File Fixture**:
   - Canvas mounts a file with 10,000 additions/deletions.
   - Assert `[data-testid="file-label-row"]` renders with text containing `"Too large to display"`.
   - Assert Pierre custom element (`diffs-container`) is **not** mounted.
   - Assert main thread is not blocked (task duration < 16 ms).
   - Assert `ptah-open-in-button` is visible and keyboard-navigable.
