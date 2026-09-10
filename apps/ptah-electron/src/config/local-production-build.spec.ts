import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Configuration } from 'app-builder-lib';

const { doMergeConfigs, validateConfiguration } =
  require('app-builder-lib/out/util/config/config') as {
    doMergeConfigs: (configs: Configuration[]) => Configuration;
    validateConfiguration: (
      config: Configuration,
      logger: { isEnabled: boolean },
    ) => Promise<void>;
  };
const { load } = require('js-yaml') as {
  load: (yaml: string) => Configuration;
};

const project = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'project.json'), 'utf8'),
);
const rootPackage = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'),
);

describe('local-production packaging configuration', () => {
  it('validates the merged unsigned overlay against the installed builder schema', async () => {
    const previous = process.env['PTAH_LOCAL_PRODUCTION_GIT_SHA'];
    let overlay: Configuration = {};
    try {
      process.env['PTAH_LOCAL_PRODUCTION_GIT_SHA'] = 'a'.repeat(40);
      jest.isolateModules(() => {
        overlay =
          require('../../electron-builder.local-production.cjs') as Configuration;
      });
    } finally {
      if (previous === undefined)
        delete process.env['PTAH_LOCAL_PRODUCTION_GIT_SHA'];
      else process.env['PTAH_LOCAL_PRODUCTION_GIT_SHA'] = previous;
    }
    const base = load(
      readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8'),
    );
    const merged = doMergeConfigs([base, overlay]);
    await expect(
      validateConfiguration(merged, { isEnabled: false }),
    ).resolves.toBeUndefined();
    expect(merged.appId).toBe('com.ptah.desktop');
    expect(merged.productName).toBe('Ptah');
    expect(merged.win?.signtoolOptions?.sign).toBeNull();
    expect(merged.win?.signAndEditExecutable).not.toBe(false);
    expect(merged.forceCodeSigning).toBe(false);
    expect(merged.publish).toBeNull();
    expect(merged.extraMetadata?.['ptahBuildIdentity']).toEqual({
      kind: 'local-production',
      gitSha: 'a'.repeat(40),
    });
  });

  it('is an uncached additive target with isolated output and the production dependencies', () => {
    const target = project.targets['package-local-production'];
    expect(target.cache).toBe(false);
    expect(target.outputs).toEqual([
      '{workspaceRoot}/dist/release/local-production',
    ]);
    expect(target.dependsOn).toEqual([
      'build',
      'copy-renderer',
      'rebuild-native',
    ]);
    expect(target.options.commands).toEqual([
      'node scripts/copy-wasm.js dist/apps/ptah-electron',
      'node apps/ptah-electron/scripts/patch-transformers-onnx-dep.js',
      'node apps/ptah-electron/scripts/prune-dist-deps.js',
      'node apps/ptah-electron/scripts/package-local-production.js',
      'node apps/ptah-electron/scripts/verify-packed-native.js',
      'node apps/ptah-electron/scripts/verify-packed-wasm.js',
      'node apps/ptah-electron/scripts/verify-packed-onnx.js',
    ]);
  });

  it('leaves the production package target and root command unchanged', () => {
    expect(project.targets.package.options.commands).toEqual([
      'node scripts/copy-wasm.js dist/apps/ptah-electron',
      'node apps/ptah-electron/scripts/patch-transformers-onnx-dep.js',
      'node apps/ptah-electron/scripts/prune-dist-deps.js',
      'electron-builder --config electron-builder.yml --project dist/apps/ptah-electron',
      'node apps/ptah-electron/scripts/verify-packed-native.js',
      'node apps/ptah-electron/scripts/verify-packed-wasm.js',
      'node apps/ptah-electron/scripts/verify-packed-onnx.js',
    ]);
    expect(rootPackage.scripts['electron:package']).toBe(
      'nx package ptah-electron',
    );
  });
});
