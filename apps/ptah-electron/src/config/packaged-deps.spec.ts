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
 * zone.js, monaco-editor, gridstack, lucide-angular -- ~20 packages, ~164 MB,
 * all of them already bundled into the renderer's own JS output. One of them
 * was `@angular-eslint/eslint-plugin-template`, a LINT plugin. (`@xterm/*`
 * shipped here too until the terminal feature was removed.) That is not just
 * waste. electron-builder walks the dependency tree from this
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

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
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

const ROOT_MANIFEST_PATH = join(REPO_ROOT, 'package.json');
const COPY_WEBVIEW_PATH = join(REPO_ROOT, 'scripts', 'copy-webview.js');
const WEBVIEW_PROJECT_JSON_PATH = join(
  REPO_ROOT,
  'apps',
  'ptah-extension-webview',
  'project.json',
);
const WEBVIEW_OUTPUT_DIR = join(
  REPO_ROOT,
  'dist',
  'apps',
  'ptah-extension-webview',
  'browser',
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronOnlyChunks = require(
  join(REPO_ROOT, 'scripts', 'electron-only-chunks.js'),
) as {
  isElectronOnlyInput(input: string): boolean;
  assertStatsMatchBuild(stats: ChunkStats, browserDir: string): void;
  assertEagerClosureKept(stats: ChunkStats, electronOnly: string[]): void;
};

interface ChunkStats {
  outputs: Record<
    string,
    {
      inputs?: Record<string, unknown>;
      imports?: { path: string; kind: string }[];
    }
  >;
}

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
        name === 'zone.js' ||
        name === 'monaco-editor' ||
        name === 'ngx-monaco-editor-v2' ||
        name === 'gridstack' ||
        name === 'lucide-angular' ||
        name === 'dompurify',
    );
    expect(rendererOnly).toEqual([]);
  });

  // Requirement 8.2: no Monaco anywhere in what ships.
  it('declares no Monaco package in the root or the Electron manifest', () => {
    const rootManifest = JSON.parse(
      readFileSync(ROOT_MANIFEST_PATH, 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      overrides?: Record<string, unknown>;
    };
    const names = [
      ...Object.keys(rootManifest.dependencies ?? {}),
      ...Object.keys(rootManifest.devDependencies ?? {}),
      ...Object.keys(rootManifest.overrides ?? {}),
      ...Object.keys(appManifest.dependencies ?? {}),
    ];
    expect(names.filter((n) => /monaco/i.test(n))).toEqual([]);
  });

  it('ships no assets/monaco in the webview assets or its build output', () => {
    expect(readFileSync(WEBVIEW_PROJECT_JSON_PATH, 'utf8')).not.toMatch(
      /monaco/i,
    );
    expect(existsSync(join(WEBVIEW_OUTPUT_DIR, 'assets', 'monaco'))).toBe(
      false,
    );
  });

  // Requirement 5.8 (R12): the VSIX copy skips the Electron-only chunks; the
  // Electron renderer copy (copy-renderer.js) copies the whole browser folder.
  describe('electron-only chunk rule', () => {
    const { isElectronOnlyInput } = electronOnlyChunks;

    it('copy-webview.js filters the VSIX copy by the generated list', () => {
      const script = readFileSync(COPY_WEBVIEW_PATH, 'utf8');
      expect(script).toContain("require('./electron-only-chunks')");
      expect(script).toMatch(/cpSync\([^)]*filter/s);
    });

    it('treats CodeMirror and the review/editor surfaces as Electron-only', () => {
      expect(
        isElectronOnlyInput(
          '../../node_modules/@codemirror/view/dist/index.js',
        ),
      ).toBe(true);
      expect(
        isElectronOnlyInput('../../node_modules/@lezer/common/dist/index.js'),
      ).toBe(true);
      expect(
        isElectronOnlyInput(
          'libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts',
        ),
      ).toBe(true);
      expect(
        isElectronOnlyInput('libs/frontend/git-ui/src/lib/review-canvas/x.ts'),
      ).toBe(true);
      expect(
        isElectronOnlyInput('libs/frontend/git-ui/src/lib/review-shell/x.ts'),
      ).toBe(true);
      expect(
        isElectronOnlyInput(
          'libs/frontend/git-ui/src/lib/commit/commit-composer.component.ts',
        ),
      ).toBe(true);
    });

    it('keeps Pierre, eager git-ui services and unrelated code', () => {
      expect(
        isElectronOnlyInput('../../node_modules/@pierre/diffs/dist/index.js'),
      ).toBe(false);
      expect(
        isElectronOnlyInput('../../node_modules/shiki/dist/wasm.mjs'),
      ).toBe(false);
      expect(
        isElectronOnlyInput(
          'libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts',
        ),
      ).toBe(false);
      expect(
        isElectronOnlyInput(
          'libs/frontend/git-ui/src/lib/services/git-status.service.ts',
        ),
      ).toBe(false);
      expect(isElectronOnlyInput('libs/frontend/chat/src/lib/x.ts')).toBe(
        false,
      );
    });

    describe('stale or mismatched stats.json (MIN-1)', () => {
      const stats: ChunkStats = {
        outputs: {
          'main.js': {
            imports: [{ path: 'chunk-Ab.js', kind: 'import-statement' }],
          },
          'chunk-Ab.js': {},
        },
      };
      let dir: string;

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'electron-only-chunks-'));
      });
      afterEach(() => rmSync(dir, { recursive: true, force: true }));

      it('accepts a browser folder holding exactly the described JS files', () => {
        writeFileSync(join(dir, 'main.js'), '');
        writeFileSync(join(dir, 'chunk-Ab.js'), '');
        writeFileSync(join(dir, 'styles.css'), '');
        expect(() =>
          electronOnlyChunks.assertStatsMatchBuild(stats, dir),
        ).not.toThrow();
      });

      it('refuses a described chunk that was not built, or a built one stats.json does not name', () => {
        writeFileSync(join(dir, 'main.js'), '');
        expect(() =>
          electronOnlyChunks.assertStatsMatchBuild(stats, dir),
        ).toThrow(/does not match/);
        writeFileSync(join(dir, 'chunk-Ab.js'), '');
        writeFileSync(join(dir, 'chunk-New.js'), '');
        expect(() =>
          electronOnlyChunks.assertStatsMatchBuild(stats, dir),
        ).toThrow(/1 built but not described/);
      });

      it('refuses a missing browser folder', () => {
        expect(() =>
          electronOnlyChunks.assertStatsMatchBuild(stats, join(dir, 'nope')),
        ).toThrow(/not found/);
      });

      it('refuses a list that drops a chunk main.js imports statically', () => {
        expect(() =>
          electronOnlyChunks.assertEagerClosureKept(stats, ['chunk-Ab.js']),
        ).toThrow(/chunk-Ab\.js/);
        expect(() =>
          electronOnlyChunks.assertEagerClosureKept(stats, []),
        ).not.toThrow();
      });

      it('copy-webview.js compares skipped paths case-sensitively off Windows', () => {
        const script = readFileSync(COPY_WEBVIEW_PATH, 'utf8');
        expect(script).toMatch(/process\.platform === 'win32'/);
      });
    });
  });
});
