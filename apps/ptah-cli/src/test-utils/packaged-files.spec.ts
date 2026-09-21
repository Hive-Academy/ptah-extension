/**
 * Guards the file set that actually ships inside the published
 * `@hive-academy/ptah-cli` npm tarball (TASK_2026_437 Batch 10 review fix).
 *
 * `code-logic-review.md` Batch 10 Blocking #1 found that `publish-cli.yml`
 * built the CLI with a hand-rolled `nx build ptah-cli` + `nx build ptah-tui`
 * + manual `package.json` copy sequence instead of the `restore-cli-manifest`
 * target, and that its own "Verify dist contents" step never checked for
 * `embedder-worker.mjs` / `integrity-worker.mjs` / `workspace-watch-host.mjs`
 * — so a real publish shipped a tarball missing all three worker/host
 * bundles while every CI step reported green. `CliWorkspaceWatcher` and
 * `SqliteIntegrityService`'s worker spawn then degrade SILENTLY on the
 * missing file (by design for a dev-time race, not for a broken release).
 *
 * This file is the single source of truth for "these bundles must exist in
 * `dist/apps/ptah-cli` AND be listed in `package.json` `files` before
 * `npm pack`", shared by ordinary `nx test ptah-cli` (this spec, gated by
 * `describeIfBuiltOrFail` like the sibling `esm-bundle-gate.spec.ts`) and by
 * `publish-cli.yml`'s "Verify dist contents" step (hand-checked against this
 * same list, not derived from it — a shell step cannot `import` a spec file
 * a Jest project). If a third bundle is ever added, update
 * `REQUIRED_CLI_BUNDLES` here AND the `for f in ...` list in
 * `publish-cli.yml` "Verify dist contents".
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeIfBuiltOrFail } from './build-artifact-gate';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const APP_DIR = join(REPO_ROOT, 'apps', 'ptah-cli');
const DIST_DIR = join(REPO_ROOT, 'dist', 'apps', 'ptah-cli');
const APP_MANIFEST_PATH = join(APP_DIR, 'package.json');
const PUBLISH_WORKFLOW_PATH = join(
  REPO_ROOT,
  '.github',
  'workflows',
  'publish-cli.yml',
);

/**
 * Every bundle `dist/apps/ptah-cli` must contain and `package.json` `files`
 * must list before `npm pack`/`npm publish` run. Anti-vacuity for this list
 * itself is the "at least 5" assertion below — a shrink of this array would
 * still need every remaining entry to individually be present, but would
 * silently stop checking a real bundle, so the length check catches that.
 */
const REQUIRED_CLI_BUNDLES = [
  'main.mjs',
  'tui.mjs',
  'embedder-worker.mjs',
  'integrity-worker.mjs',
  'workspace-watch-host.mjs',
] as const;

/**
 * The subset of {@link REQUIRED_CLI_BUNDLES} that `ptah-cli:test`'s own
 * `dependsOn` graph builds (`build-esbuild`, `build-embedder-worker`,
 * `build-integrity-worker`, `build-workspace-watch-host` —
 * `apps/ptah-cli/project.json` "test"). `tui.mjs` is `ptah-tui`'s own
 * target, built by `restore-cli-manifest`/`cli-e2e.yml`/the publish
 * workflow, never by `ptah-cli`'s own `test`; asserting its on-disk presence
 * here would fail a plain `nx test ptah-cli` run whenever `ptah-tui` had not
 * separately been built, which is a false positive, not the bug this file
 * exists to catch. `tui.mjs` is still checked above in "files"/"Verify dist
 * contents" — those checks are static text/JSON, not artifact presence.
 */
const LOCALLY_BUILT_BUNDLES = REQUIRED_CLI_BUNDLES.filter(
  (name) => name !== 'tui.mjs',
);

const appManifest = JSON.parse(readFileSync(APP_MANIFEST_PATH, 'utf8')) as {
  files?: string[];
};
const manifestFiles = appManifest.files ?? [];

const publishWorkflow = readFileSync(PUBLISH_WORKFLOW_PATH, 'utf8');

/**
 * Extracts the whitespace-delimited token list from `publish-cli.yml`'s
 * "Verify dist contents" step's `run:` body -- specifically the `for f in
 * ...; do` clause, which is the actual gate that fails the workflow when a
 * bundle is missing on disk. Scoped to just that one step (stops at the next
 * `- name:` at the same indentation) and to just the `for f in ...` clause
 * within it, on purpose: a plain `publishWorkflow.toContain(bundleName)`
 * substring check over the WHOLE file would also match a bundle name
 * mentioned only in a step title or a comment -- which is exactly what this
 * step's own title ("Verify dist contents (better-sqlite3 ABI + ...)" style
 * naming used elsewhere in this repo) could do, making the check pass even
 * if the `for f in ...` line itself silently dropped a name.
 *
 * Not YAML-parsed: `js-yaml` is present only as a transitive dependency
 * (`package-lock.json`), never a direct one, and no existing spec in this
 * repo parses a workflow file as structured YAML (`packaged-deps.spec.ts` in
 * `ptah-electron`, the nearest precedent, reads the workflow as raw text and
 * does substring checks the same way this file did before this fix) --
 * adding a real YAML dependency for one shell-embedded `for` loop is more
 * machinery than the check needs. Returns `null` if the step or the
 * `for f in ...` clause cannot be found, so a caller fails loud (anti-vacuity)
 * instead of silently checking against an empty token list.
 */
function extractVerifyDistFileList(workflowText: string): string[] | null {
  const stepMarker = '- name: Verify dist contents';
  const stepStart = workflowText.indexOf(stepMarker);
  if (stepStart < 0) return null;

  const restOfFile = workflowText.slice(stepStart + stepMarker.length);
  const nextStepMatch = /\n {6}- name:/.exec(restOfFile);
  const stepBody =
    nextStepMatch != null
      ? restOfFile.slice(0, nextStepMatch.index)
      : restOfFile;

  const forLoopMatch = /for f in([\s\S]*?);\s*do/.exec(stepBody);
  if (forLoopMatch == null) return null;

  return forLoopMatch[1]
    .split(/\s+/)
    .map((token) => token.replace(/\\$/, '').trim())
    .filter((token) => token.length > 0 && token !== '\\');
}

const verifyDistFileList = extractVerifyDistFileList(publishWorkflow);

describe('extractVerifyDistFileList (self-test)', () => {
  it('anti-vacuity: extracts a non-empty token list from the real workflow', () => {
    expect(verifyDistFileList).not.toBeNull();
    expect((verifyDistFileList ?? []).length).toBeGreaterThan(0);
  });

  // The regression this pins: the previous check was
  // `publishWorkflow.toContain(bundleName)` over the WHOLE file, which would
  // still pass if a bundle were named only in this step's own title/a
  // comment and silently dropped from the actual `for f in ...` line.
  it('does not satisfy a bundle name present only in a comment/title, not the for-loop', () => {
    const fixture = [
      '      # workspace-watch-host.mjs is mentioned here in a comment only',
      '      - name: Verify dist contents (workspace-watch-host.mjs)',
      '        run: |',
      '          DIST=dist/apps/ptah-cli',
      '          for f in main.mjs tui.mjs; do',
      '            if [[ ! -f "$DIST/$f" ]]; then',
      '              exit 1',
      '            fi',
      '          done',
      '      - name: Next step',
      '        run: echo done',
    ].join('\n');

    const tokens = extractVerifyDistFileList(fixture);
    expect(tokens).not.toBeNull();
    expect(tokens).toEqual(['main.mjs', 'tui.mjs']);
    expect(tokens ?? []).not.toContain('workspace-watch-host.mjs');
  });
});

describe('published CLI bundle set (anti-vacuity)', () => {
  it('REQUIRED_CLI_BUNDLES names at least the five known bundles', () => {
    expect(REQUIRED_CLI_BUNDLES.length).toBeGreaterThanOrEqual(5);
  });

  it('apps/ptah-cli/package.json parses with a non-empty files array', () => {
    expect(Array.isArray(appManifest.files)).toBe(true);
    expect(manifestFiles.length).toBeGreaterThan(0);
  });
});

describe.each(REQUIRED_CLI_BUNDLES)(
  '%s — required CLI bundle',
  (bundleName) => {
    it('is listed in package.json "files"', () => {
      expect(manifestFiles).toContain(bundleName);
    });

    it('is a token in publish-cli.yml "Verify dist contents"\'s for-loop (not just mentioned anywhere in the file)', () => {
      expect(verifyDistFileList ?? []).toContain(bundleName);
    });
  },
);

describe('publish-cli.yml build sequence', () => {
  it('builds through restore-cli-manifest, not a hand-rolled build+build+copy sequence', () => {
    // The regression this pins: `nx build ptah-cli` (deleteOutputPath: true)
    // followed by a separate `nx build ptah-tui` and a manual package.json
    // copy bypasses the one dependsOn graph (build-embedder-worker ->
    // build-integrity-worker -> build-workspace-watch-host -> ptah-tui:build
    // -> manifest copy) that actually produces every bundle in the right
    // order. `restore-cli-manifest` is that graph; requiring the workflow to
    // call it directly is the fix.
    // The publish job uses npm's local binary shim rather than `npx`, which can
    // install a package on demand and run lifecycle scripts (SonarCloud
    // githubactions:S6505 / S8543). It must not reach into Nx package internals:
    // Nx 23 removed `nx/bin/nx.js`, while the generated shim follows `bin`.
    expect(publishWorkflow).toContain(
      'node_modules/.bin/nx run ptah-cli:restore-cli-manifest',
    );
  });
});

// Gated on main.mjs specifically (not the directory) -- `existsSync` on a
// directory is true even when the build is only partially complete, which
// is exactly the "missing bundle, no error" failure mode this file exists
// to catch.
const describeBuilt = describeIfBuiltOrFail(
  join(DIST_DIR, 'main.mjs'),
  'nx run ptah-cli:restore-cli-manifest',
);

describeBuilt('dist/apps/ptah-cli (built artifact)', () => {
  it.each(LOCALLY_BUILT_BUNDLES)(
    '%s exists on disk with size > 0',
    (bundleName) => {
      const filePath = join(DIST_DIR, bundleName);
      expect(existsSync(filePath)).toBe(true);
      expect(statSync(filePath).size).toBeGreaterThan(0);
    },
  );
});
