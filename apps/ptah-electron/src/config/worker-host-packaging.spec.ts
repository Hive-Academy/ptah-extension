import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = join(__dirname, '..', '..', '..', '..');
const app = join(root, 'apps', 'ptah-electron');
const project = JSON.parse(readFileSync(join(app, 'project.json'), 'utf8')) as {
  implicitDependencies: string[];
  targets: Record<
    string,
    {
      dependsOn?: string[];
      options?: {
        main?: string;
        outputPath?: string;
        outputFileName?: string;
        tsConfig?: string;
        esbuildOptions?: {
          alias?: Record<string, string>;
          banner?: { js?: string };
        };
        external?: string[];
        commands?: string[];
      };
    }
  >;
};
const builderText = readFileSync(join(app, 'electron-builder.yml'), 'utf8');
const builder = parse(builderText) as {
  linux?: {
    extraResources?: Array<{ from: string; to: string; filter?: string[] }>;
  };
  fuses?: Record<string, unknown>;
};
const launcherPath = join(app, 'worker-host', 'ptah-worker');
const launcher = readFileSync(launcherPath, 'utf8');
const unit = readFileSync(
  join(app, 'worker-host', 'ptah-worker.service'),
  'utf8',
);

it('builds the worker host beside the workspace watch host', () => {
  const target = project.targets['build-worker-host'];
  expect(project.implicitDependencies).toContain('@ptah-extension/worker-host');
  expect(target.options).toMatchObject({
    main: 'libs/backend/worker-host/src/worker-host.entry.ts',
    outputPath: 'dist/apps/ptah-electron',
    outputFileName: 'worker-host.mjs',
    tsConfig: 'apps/ptah-electron/tsconfig.worker-host.json',
  });
  expect(target.options?.esbuildOptions?.alias?.['vscode']).toBe(
    './libs/backend/cli-engine/src/lib/shims/vscode-shim.ts',
  );
  expect(target.options?.esbuildOptions?.banner?.js).toContain('createRequire');
  expect(project.targets['build'].dependsOn).toContain('build-worker-host');
  expect(project.targets['build-dev'].options?.commands).toContain(
    'nx build-worker-host ptah-electron',
  );
  const dependencies = JSON.parse(
    readFileSync(join(app, 'package.json'), 'utf8'),
  ) as {
    dependencies: Record<string, string>;
  };
  for (const external of target.options?.external ?? []) {
    expect(dependencies.dependencies).toHaveProperty(external);
  }
});

it('ships the executable launcher and systemd template outside app.asar', () => {
  expect(builder.linux?.extraResources).toContainEqual({
    from: '../../../apps/ptah-electron/worker-host',
    to: 'bin',
    filter: ['ptah-worker', 'ptah-worker.service'],
  });
  expect(statSync(launcherPath).mode & 0o111).not.toBe(0);
  expect(launcher).toContain('#!/bin/sh');
  expect(launcher).toContain('readlink "$script"');
  // app.asar is a file; a shell test of a path inside it is always false.
  expect(launcher).not.toMatch(/\[ [^\]]*app\.asar\/worker-host\.mjs/);
  expect(launcher).toContain('[ ! -f "$archive" ]');
  expect(launcher).toContain(
    'ELECTRON_RUN_AS_NODE=1 exec "$appdir/ptah-desktop" "$appdir/resources/app.asar/worker-host.mjs" "$@"',
  );
  expect(unit).toContain(
    'ExecStart=/opt/Ptah/resources/bin/ptah-worker serve --port 41873',
  );
  for (const line of [
    'Restart=on-failure',
    'RestartSec=5',
    'KillSignal=SIGTERM',
    'TimeoutStopSec=20',
    '[Install]',
    'WantedBy=default.target',
  ]) {
    expect(unit).toContain(line);
  }
  expect(builder.fuses?.['RunAsNode']).not.toBe(false);
  expect(builder.fuses?.['runAsNode']).not.toBe(false);
  expect(builderText).not.toMatch(
    /(?:RunAsNode|runAsNode|enableRunAsNode)\s*:\s*false/i,
  );
  const validateDeps = readFileSync(
    join(app, 'scripts', 'validate-deps.js'),
    'utf8',
  );
  expect(validateDeps).toContain("'worker-host.mjs'");
  // Widening the optional set hides a real missing dependency; keep it reviewed.
  expect(validateDeps).toContain(
    "const OPTIONAL_WORKER_HOST_IMPORTS = new Set(['keytar']);",
  );
  expect(project.targets['validate-deps']?.dependsOn).toContain(
    'build-worker-host',
  );
});
