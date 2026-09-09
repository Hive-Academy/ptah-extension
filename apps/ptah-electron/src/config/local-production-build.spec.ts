import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const project = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'project.json'), 'utf8'),
);
const rootPackage = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'),
);

describe('local-production packaging configuration', () => {
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
