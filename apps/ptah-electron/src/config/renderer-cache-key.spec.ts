import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * THE COPY-RENDERER CACHE KEY AS AN EXECUTABLE ARTEFACT (TASK_2026_226).
 *
 * WHY THIS TEST EXISTS.
 * `apps/ptah-electron/project.json` had no `implicitDependencies`, so
 * `ptah-electron` carried no project-graph edge to `ptah-extension-webview`
 * (the renderer is copied as a build artifact, not imported as code — `nx
 * graph` confirms zero edge between the two projects without this field).
 * `copy-renderer` declared `outputs` but no `inputs`, which (per
 * `node_modules/nx/src/hasher/task-hasher.ts` `DEFAULT_INPUTS`) makes Nx fall
 * back to `["default", "^default"]` for hashing — but `^default` only
 * traverses REAL project-graph edges, and there wasn't one. A change confined
 * to `libs/frontend/**` therefore never entered `copy-renderer`'s hash.
 *
 * That alone was not yet dangerous: `copy-renderer` also had no `cache` field
 * at all, and `isCacheableTask` in `node_modules/nx/src/tasks-runner/utils.js`
 * requires `task.cache === true` (there is no `nx.json`
 * `tasksRunnerOptions.default.options.cacheableOperations` fallback in this
 * workspace) — so before TASK_2026_226, `copy-renderer` was NEVER cached and
 * therefore could never restore a stale directory. It was slow-but-safe, not
 * silently-stale.
 *
 * Reproduced empirically (TASK_2026_226): with ONLY `cache: true` added and
 * no `implicitDependencies`, editing a string in
 * `libs/frontend/dashboard/.../dashboard-grid.component.html` and running
 * `nx copy-renderer ptah-electron` printed a clean success and a `[local
 * cache]` hit, while `dist/apps/ptah-electron/renderer/` did not contain the
 * edit even though `dist/apps/ptah-extension-webview/browser/` did — the
 * exact symptom TASK_2026_222 hit. Adding `implicitDependencies:
 * ["ptah-extension-webview"]` (and nothing else — no per-target `inputs`,
 * which would duplicate the same edge for every current and future
 * cache-key-bearing target on this project) closed it: the same edit then
 * produced a genuine cache miss and a fresh copy.
 *
 * `build-dev` was also cache-undefined at diagnosis time, but does NOT get
 * the same fix here: it has no `outputs` declared, and its five nested
 * `nx <target>` shell-outs (`build-main`, `build-preload`,
 * `build-embedder-worker`, `build-voice-worker`, and the webview build
 * itself) are each already independently, correctly cached. Turning on
 * caching for the `build-dev` wrapper without an `outputs` declaration would
 * let a cache hit skip invoking all five children with nothing to restore or
 * verify — worse than the bug this task fixes. RI-5/RI-6 pin that `build-dev`
 * stays exactly as it is so nobody "fixes" it into that trap.
 *
 * A comment cannot fail a build. This can.
 *
 * Deliberately dependency-free — pure JSON parse of `project.json`, no Nx
 * project-graph load, no daemon, no build. Fast and immune to unrelated
 * workspace churn.
 */

const PROJECT_JSON_PATH = resolve(__dirname, '..', '..', 'project.json');

interface NxTargetConfig {
  cache?: boolean;
  inputs?: unknown;
  outputs?: unknown;
  dependsOn?: string[];
}

interface NxProjectConfig {
  implicitDependencies?: string[];
  targets: Record<string, NxTargetConfig>;
}

const raw = readFileSync(PROJECT_JSON_PATH, 'utf8');
const config = JSON.parse(raw) as NxProjectConfig;

describe('apps/ptah-electron/project.json renderer cache key', () => {
  // Anti-vacuity: if project.json stops parsing or loses its target map, every
  // RI below would either throw before asserting or pass against `undefined`.
  it('anti-vacuity: project.json parses and declares the copy-renderer target', () => {
    expect(config.targets).toBeDefined();
    expect(config.targets['copy-renderer']).toBeDefined();
    expect(config.targets['build-dev']).toBeDefined();
  });

  // RI-1 — THE GRAPH EDGE. Without this, `^default` has nothing to traverse
  // into `ptah-extension-webview`, no matter what `copy-renderer.inputs` says.
  it('RI-1: ptah-electron declares an implicit dependency on ptah-extension-webview', () => {
    expect(config.implicitDependencies ?? []).toContain(
      'ptah-extension-webview',
    );
  });

  // RI-2 — CACHING MUST STAY ON. `"cache": false` (or leaving it unset, which
  // behaves identically per `isCacheableTask`) "fixes" staleness by making
  // every e2e run pay a full copy every time. That is the wrong answer this
  // task explicitly rejected.
  it('RI-2: copy-renderer has caching explicitly enabled', () => {
    expect(config.targets['copy-renderer'].cache).toBe(true);
  });

  // RI-3 — ONE MECHANISM, NOT TWO. The fix is the implicit project-graph edge
  // (RI-1) plus Nx's own `DEFAULT_INPUTS` fallback (`["default", "^default"]`,
  // applied automatically whenever `inputs` is unset). Adding an explicit
  // `inputs` array here as well would be the exact cargo-culting this task
  // was told to avoid, and would have to be kept in sync by hand instead of
  // riding the project-graph edge for free.
  it('RI-3: copy-renderer does not duplicate the fix with an explicit inputs array', () => {
    expect(config.targets['copy-renderer'].inputs).toBeUndefined();
  });

  // RI-4 — sanity: the ordering dependency this whole mechanism sits next to
  // must still exist, or copy-renderer could run before the webview build
  // that feeds it.
  it('RI-4: copy-renderer still orders itself after the webview build', () => {
    expect(config.targets['copy-renderer'].dependsOn ?? []).toContain(
      'ptah-extension-webview:build',
    );
  });

  // RI-5 / RI-6 — build-dev must stay unfixed in the "add cache: true" sense.
  // See the file header: it has no `outputs`, so caching it would let a hit
  // skip its five nested builds with nothing to restore.
  it('RI-5: build-dev is not marked cacheable (no outputs to safely restore)', () => {
    expect(config.targets['build-dev'].cache).not.toBe(true);
  });

  it('RI-6: build-dev declares no outputs (the reason RI-5 must hold)', () => {
    expect(config.targets['build-dev'].outputs).toBeUndefined();
  });
});
