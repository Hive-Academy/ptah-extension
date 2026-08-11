import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * THE COPY-RENDERER CACHE KEY AS AN EXECUTABLE ARTEFACT (TASK_2026_226,
 * extended by TASK_2026_229).
 *
 * TASK_2026_229 ADDENDUM.
 * TASK_2026_226 made `copy-renderer` cache-correct, but left its
 * `dependsOn: ["ptah-extension-webview:build"]` unpinned -- which resolves
 * to the webview's `defaultConfiguration` (production), always, regardless
 * of caller. `build-dev` built the SAME webview app in `development` config
 * as an internal, ungraphed shell-out. Proven live and reproducible
 * (TASK_2026_229): running the exact sequence `.github/workflows/
 * electron-e2e.yml` used --  bare `nx run ptah-electron:build-dev` then bare
 * `nx run ptah-electron:copy-renderer` -- silently replaced a correct
 * development bundle (unminified, sourcemapped) with a production one
 * (minified, no sourcemaps) in `dist/apps/ptah-electron/renderer`, with no
 * error, no warning, and (confirmed by deliberately seeding a genuine
 * pre-edit production cache entry and then editing source) NOT because of
 * any Nx cache misbehavior -- production's own cache correctly invalidated
 * on the edit every time this was tried. The bug is a deterministic
 * configuration mismatch, not a cache bug and not fundamentally a race,
 * though `apps/ptah-electron-e2e/project.json`'s `e2e`/`showcase`/
 * `e2e:nightly` targets additionally re-trigger both as unordered sibling
 * `dependsOn` entries, which layers a real race on top for that path.
 *
 * Nx has no mechanism to pin a configuration on a `dependsOn` edge
 * (`TargetDependencyConfig` has no `configuration` field; a 3-segment
 * `"project:target:configuration"` dependsOn string does not parse as one --
 * confirmed against `node_modules/nx/src/config/workspace-json-project-json.d.ts`
 * and `readProjectAndTargetFromTargetString` in
 * `node_modules/nx/src/tasks-runner/utils.js`). So `copy-renderer` cannot be
 * made to correctly serve both `package` (wants production) and
 * `e2e`/`showcase`/`e2e:nightly` (want development) by itself.
 *
 * Fix: a second, explicit target, `copy-renderer-dev`, hardcodes
 * `--configuration=development` on its own `nx build` shell-out and runs the
 * copy script after it via `parallel: false` -- no `dependsOn`-based
 * configuration inference, no sibling-ordering race. `build-dev` no longer
 * builds the webview at all (that responsibility moved entirely to
 * `copy-renderer-dev`), removing the duplicate, uncoordinated second trigger
 * that made two builds of the same directory possible in the first place.
 * `copy-renderer` (plain) is untouched and still the sole `package`
 * dependency -- RI-1 through RI-6 below still pin it exactly as TASK_2026_226
 * left it.
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
 * TASK_2026_232 ADDENDUM — WHY RI-2 IS NOW INVERTED.
 * TASK_2026_226 reproduced the TASK_2026_222 symptom via a MISSING HASH INPUT
 * (no graph edge, so a `libs/frontend/**` edit never entered copy-renderer's
 * hash, so Nx replayed a stale cache entry). RI-1 closes that. TASK_2026_232
 * found a SECOND, independent mechanism with the same signature, which RI-1
 * does not touch, because it fires when the hash is entirely CORRECT:
 *
 *   `node_modules/nx/src/tasks-runner/task-orchestrator.js` `applyCachedResult`
 *   only restores a cache hit's outputs when
 *   `shouldCopyOutputsFromCache(outputs, hash)` is true, which delegates to the
 *   daemon's `outputsHashesMatch`. That is NOT a content hash — see
 *   `node_modules/nx/src/daemon/server/outputs-tracking.js`: it is an
 *   in-memory `recordedHashes[outputPath] = taskHash` map in the daemon
 *   process, invalidated only by the outputs file-watcher, and
 *   `processFileChangesInOutputs` IGNORES any change event arriving within
 *   2000 ms of the record (`now - timestamps[output] > 2000`). When the map
 *   still says "matches", Nx skips the copy and replays the cached terminal
 *   output verbatim.
 *
 * Reproduced live (TASK_2026_232) in an isolated probe workspace on this same
 * Nx 22.6.5, with a target of exactly this shape (`cache: true` + `outputs`):
 * after externally overwriting the output directory, `nx copy probe` printed
 *
 *   > nx run probe:copy  [existing outputs match the cache, left as is]
 *   [copy] Cleaned old out directory
 *   [copy] Copied ...\src -> ...\out
 *   [copy] Done
 *   NX   Successfully ran target copy for project probe
 *
 * while the output directory still held the externally-written content and
 * none of those three log lines had actually happened. That is the
 * TASK_2026_222 symptom exactly, including why running the script directly
 * fixed it instantly (bypasses Nx, so it always really runs). It is
 * nondeterministic — the same corruption invalidated correctly on two earlier
 * attempts — because it is a watcher-timing race.
 *
 * On HEAD this exposed `nx package`, and any lane sharing
 * `dist/apps/ptah-electron/renderer` with another that writes it via
 * `copy-renderer-dev`. Removing `cache: true` restores the "always slow,
 * never stale" state TASK_2026_226 itself described as safe.
 *
 * A comment cannot fail a build. This can.
 *
 * Deliberately dependency-free — pure JSON parse of `project.json`, no Nx
 * project-graph load, no daemon, no build. Fast and immune to unrelated
 * workspace churn.
 */

const PROJECT_JSON_PATH = resolve(__dirname, '..', '..', 'project.json');
const E2E_PROJECT_JSON_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'ptah-electron-e2e',
  'project.json',
);

interface NxRunCommandsOptions {
  command?: string;
  commands?: string[];
  parallel?: boolean;
}

interface NxTargetConfig {
  cache?: boolean;
  inputs?: unknown;
  outputs?: unknown;
  dependsOn?: string[];
  options?: NxRunCommandsOptions;
}

interface NxProjectConfig {
  implicitDependencies?: string[];
  targets: Record<string, NxTargetConfig>;
}

interface NxDependsOnEntry {
  target: string;
  projects?: string[];
}

interface NxE2eTargetConfig {
  dependsOn?: NxDependsOnEntry[];
}

interface NxE2eProjectConfig {
  targets: Record<string, NxE2eTargetConfig>;
}

const raw = readFileSync(PROJECT_JSON_PATH, 'utf8');
const config = JSON.parse(raw) as NxProjectConfig;

const e2eRaw = readFileSync(E2E_PROJECT_JSON_PATH, 'utf8');
const e2eConfig = JSON.parse(e2eRaw) as NxE2eProjectConfig;

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

  // RI-2 — CACHING MUST STAY OFF. REVERSED BY TASK_2026_232; read the
  // "TASK_2026_232 ADDENDUM" in the file header before flipping this back.
  //
  // TASK_2026_226 turned caching ON here and pinned it, arguing that the
  // alternative made "every e2e run pay a full copy every time". That
  // justification no longer holds: TASK_2026_229 moved e2e/showcase/
  // e2e:nightly onto `copy-renderer-dev` (RI-11/12/13 below), which is
  // uncacheable and pays the full copy every time regardless. Plain
  // `copy-renderer`'s only remaining consumer is `package` — a rare, heavy
  // operation where one file copy is noise.
  //
  // Against that ~zero saving, `cache: true` buys a real correctness hole:
  // on a cache hit Nx consults the daemon's in-memory outputs-tracking map
  // and, if it believes the directory is untouched, SKIPS restoration
  // entirely while replaying the cached terminal output verbatim (status
  // `local-cache-kept-existing`, rendered as "existing outputs match the
  // cache, left as is"). A target whose entire job is "make this directory
  // match" must never be allowed to skip on a belief about the directory
  // that it did not verify.
  it('RI-2: copy-renderer is NOT marked cacheable', () => {
    expect(config.targets['copy-renderer'].cache).not.toBe(true);
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

  // RI-7 -- THE DUPLICATE TRIGGER IS GONE. build-dev's development webview
  // build was the second, ungraphed place the webview could be rebuilt --
  // removing it is what makes `copy-renderer-dev` the single authority.
  // If a `nx build ptah-extension-webview` (or `nx run
  // ptah-extension-webview:build`) shell-out ever creeps back into
  // build-dev's commands, this fails.
  it('RI-7: build-dev no longer builds ptah-extension-webview itself', () => {
    const commands = config.targets['build-dev'].options?.commands ?? [];
    expect(commands.some((c) => c.includes('ptah-extension-webview'))).toBe(
      false,
    );
  });

  // RI-8 -- copy-renderer-dev exists and hardcodes development. This is the
  // caller-facing half of the fix: no `dependsOn`-based configuration
  // inference (Nx has none to offer -- see file header), so the
  // configuration must be a literal flag on its own `nx build` shell-out.
  it('RI-8: copy-renderer-dev exists and builds the webview in development config', () => {
    const commands = config.targets['copy-renderer-dev']?.options?.commands;
    expect(commands).toBeDefined();
    expect(
      (commands ?? []).some(
        (c) =>
          c.includes('ptah-extension-webview') &&
          c.includes('--configuration=development'),
      ),
    ).toBe(true);
  });

  // RI-9 -- ORDERING WITHOUT A GRAPH EDGE. copy-renderer-dev cannot rely on
  // `dependsOn` (that's how the original race happened); parallel:false is
  // the actual guarantee that the webview dev build completes before the
  // copy script runs.
  it('RI-9: copy-renderer-dev runs its commands sequentially, webview build before the copy script', () => {
    const options = config.targets['copy-renderer-dev']?.options;
    expect(options?.parallel).toBe(false);
    const commands = options?.commands ?? [];
    const buildIdx = commands.findIndex((c) =>
      c.includes('ptah-extension-webview'),
    );
    const copyIdx = commands.findIndex((c) => c.includes('copy-renderer.js'));
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(copyIdx).toBeGreaterThan(buildIdx);
  });

  // RI-10 -- copy-renderer-dev must NOT be cache:true. Same trap RI-5 guards
  // on build-dev: its first step is an ungraphed `nx build` shell-out with
  // no `outputs` declared on THIS wrapper target, so a cache hit here would
  // skip that shell-out with nothing correct to restore.
  it('RI-10: copy-renderer-dev is not marked cacheable', () => {
    expect(config.targets['copy-renderer-dev']?.cache).not.toBe(true);
  });
});

describe('apps/ptah-electron-e2e/project.json dev renderer wiring (TASK_2026_229)', () => {
  // Anti-vacuity.
  it('anti-vacuity: e2e project.json parses and declares the three dev-build targets', () => {
    expect(e2eConfig.targets).toBeDefined();
    expect(e2eConfig.targets['e2e']).toBeDefined();
    expect(e2eConfig.targets['showcase']).toBeDefined();
    expect(e2eConfig.targets['e2e:nightly']).toBeDefined();
  });

  // RI-11/12/13 -- each of the three e2e-family targets must depend on
  // copy-renderer-dev, not plain copy-renderer. Plain copy-renderer always
  // resolves ptah-extension-webview:build to production (its dependsOn is
  // unpinned and Nx has no per-edge configuration override) -- pointing
  // these targets back at it silently reintroduces TASK_2026_229's bug.
  it.each(['e2e', 'showcase', 'e2e:nightly'])(
    'RI: %s depends on ptah-electron:copy-renderer-dev, not plain copy-renderer',
    (targetName) => {
      const dependsOn = e2eConfig.targets[targetName].dependsOn ?? [];
      const targets = dependsOn.map((d) => d.target);
      expect(targets).toContain('copy-renderer-dev');
      expect(targets).not.toContain('copy-renderer');
    },
  );
});
