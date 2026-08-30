/**
 * Guards the dependency set that actually ships inside the packaged Electron
 * app.
 *
 * `build-main` runs with `generatePackageJson: true`, and Nx builds that
 * manifest from the PROJECT GRAPH -- which includes
 * `implicitDependencies: ["ptah-extension-webview"]` (pinned by
 * renderer-cache-key.spec.ts RI-1, and load-bearing for cache correctness).
 * Nx cannot tell a build-time edge from a runtime one, so the renderer's npm
 * packages land in the packaged app's production dependencies: @angular/*,
 * zone.js, monaco-editor, @xterm/*, gridstack, lucide-angular -- 20 packages,
 * ~164 MB, all of them already bundled into the renderer's own JS output. One
 * of them was `@angular-eslint/eslint-plugin-template`, a LINT plugin.
 *
 * That is not just waste. electron-builder walks the dependency tree from this
 * manifest and validates each package's declared deps against what is
 * installed. monaco-editor pins `"dompurify": "3.2.7"` exactly, while the root
 * package.json deliberately overrides it to `^3.3.2`. npm honours the override
 * and hoists a single dompurify; electron-builder does NOT read `overrides`
 * (traversalNodeModulesCollector reads monaco-editor/package.json directly),
 * so packaging died with:
 *
 *     production dependency not found  parent=monaco-editor
 *       dependency=dompurify version=3.2.7
 *
 * prune-dist-deps.js reconciles the generated manifest back to the
 * hand-maintained one. These specs pin the wiring that makes it run, and the
 * invariant it depends on.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const APP_DIR = join(REPO_ROOT, 'apps', 'ptah-electron');
const PROJECT_JSON_PATH = join(APP_DIR, 'project.json');
const APP_MANIFEST_PATH = join(APP_DIR, 'package.json');
const PUBLISH_WORKFLOW_PATH = join(
  REPO_ROOT,
  '.github',
  'workflows',
  'publish-electron.yml',
);

const PRUNE_COMMAND = 'apps/ptah-electron/scripts/prune-dist-deps.js';

interface NxProjectConfig {
  targets?: Record<
    string,
    { options?: { commands?: Array<string | { command?: string }> } }
  >;
}

function commandsOf(config: NxProjectConfig, target: string): string[] {
  return (config.targets?.[target]?.options?.commands ?? []).map((entry) =>
    typeof entry === 'string' ? entry : (entry.command ?? ''),
  );
}

const config = JSON.parse(
  readFileSync(PROJECT_JSON_PATH, 'utf8'),
) as NxProjectConfig;

const appManifest = JSON.parse(readFileSync(APP_MANIFEST_PATH, 'utf8')) as {
  dependencies?: Record<string, string>;
};

const publishWorkflow = readFileSync(PUBLISH_WORKFLOW_PATH, 'utf8');

describe('packaged electron dependency set', () => {
  // Anti-vacuity: every assertion below reads one of these, and would pass
  // against `undefined` or an empty list if the file stopped parsing.
  it('anti-vacuity: project.json parses with both packaging targets', () => {
    expect(config.targets).toBeDefined();
    expect(commandsOf(config, 'build').length).toBeGreaterThan(0);
    expect(commandsOf(config, 'package').length).toBeGreaterThan(0);
    expect(Object.keys(appManifest.dependencies ?? {}).length).toBeGreaterThan(
      0,
    );
  });

  it('the build target prunes the generated manifest', () => {
    expect(commandsOf(config, 'build')).toContain(`node ${PRUNE_COMMAND}`);
  });

  // The prune must run AFTER patch-dist-overrides, which also rewrites the
  // generated manifest -- running it first would just be overwritten.
  it('the build target prunes after patching the dist overrides', () => {
    const commands = commandsOf(config, 'build');
    const patchIndex = commands.findIndex((c) =>
      c.includes('patch-dist-overrides.js'),
    );
    const pruneIndex = commands.findIndex((c) => c.includes(PRUNE_COMMAND));
    expect(patchIndex).toBeGreaterThanOrEqual(0);
    expect(pruneIndex).toBeGreaterThan(patchIndex);
  });

  it('the package target prunes before electron-builder runs', () => {
    const commands = commandsOf(config, 'package');
    const pruneIndex = commands.findIndex((c) => c.includes(PRUNE_COMMAND));
    const builderIndex = commands.findIndex((c) =>
      c.startsWith('electron-builder '),
    );
    expect(pruneIndex).toBeGreaterThanOrEqual(0);
    expect(builderIndex).toBeGreaterThan(pruneIndex);
  });

  // The CI hazard that makes the pre-pack re-run load-bearing: build-main's
  // outputs include dist/apps/ptah-electron/package.json, so restoring its
  // cache between `nx build` and packaging resurrects the unpruned manifest.
  // This is the same reason copy-wasm.js is re-run there.
  it('the publish workflow re-runs the prune immediately before packing', () => {
    expect(publishWorkflow).toContain(`node ${PRUNE_COMMAND}`);

    const pruneIndex = publishWorkflow.indexOf(`node ${PRUNE_COMMAND}`);
    const packIndex = publishWorkflow.indexOf('npx electron-builder --config');
    expect(packIndex).toBeGreaterThan(pruneIndex);
  });

  // The invariant prune-dist-deps.js relies on: the hand-maintained manifest is
  // the source of truth for what the packaged app needs at runtime, and
  // validate-deps.js independently asserts it covers every external import in
  // main.mjs. If a renderer-only package were ever added here by hand, the
  // prune would faithfully keep it and packaging would break again.
  it('the hand-maintained manifest declares no renderer-only package', () => {
    const declared = Object.keys(appManifest.dependencies ?? {});
    const rendererOnly = declared.filter(
      (name) =>
        name.startsWith('@angular/') ||
        name.startsWith('@xterm/') ||
        name === 'zone.js' ||
        name === 'monaco-editor' ||
        name === 'ngx-monaco-editor-v2' ||
        name === 'gridstack' ||
        name === 'lucide-angular' ||
        name === 'dompurify',
    );
    expect(rendererOnly).toEqual([]);
  });
});
