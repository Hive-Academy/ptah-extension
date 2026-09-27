/**
 * The grammars the language registry parses with are exactly the grammar rows
 * `scripts/tree-sitter-grammars.json` marks `active` (Batch 29a2).
 *
 * The manifest is what `scripts/copy-wasm.js` bundles and what the Electron,
 * CLI and VSIX packed-artifact verifiers require. A registry grammar with no
 * active row would ship without its `.wasm` (the language then fails to load
 * at runtime and reports `grammar-unavailable`); an active row no registry
 * language uses ships dead weight. Activation batches (29b-31, 30k) flip a row
 * and add its language module together, so this spec keeps both in step.
 */
import * as fs from 'fs';
import * as path from 'path';
import { LANGUAGE_IDS } from '@ptah-extension/platform-core';
import { LANGUAGE_REGISTRY } from './language-registry';
import { GRAMMAR_FILE_MAP } from './tree-sitter.config';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'tree-sitter-grammars.json',
);

interface ManifestAsset {
  readonly id: string;
  readonly kind: string;
  readonly active: boolean;
  readonly filename: string;
}

function readManifestAssets(): ManifestAsset[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const assets = (parsed as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) {
    throw new Error(`${MANIFEST_PATH} has no assets array`);
  }
  return assets as ManifestAsset[];
}

/** Active grammar file names in the manifest, sorted. */
function activeManifestGrammars(assets: readonly ManifestAsset[]): string[] {
  return assets
    .filter((asset) => asset.kind === 'grammar' && asset.active === true)
    .map((asset) => asset.filename)
    .sort();
}

/** Grammar file names the registry parses with, sorted. */
function registryGrammars(): string[] {
  return LANGUAGE_IDS.map((id) => LANGUAGE_REGISTRY[id].grammarFile)
    .filter((grammarFile): grammarFile is string => grammarFile !== null)
    .sort();
}

/** Grammar files present on one side only, each tagged with its side. */
function grammarDrift(
  registry: readonly string[],
  manifest: readonly string[],
): string[] {
  return [
    ...registry
      .filter((file) => !manifest.includes(file))
      .map((file) => `registry-only:${file}`),
    ...manifest
      .filter((file) => !registry.includes(file))
      .map((file) => `manifest-only:${file}`),
  ];
}

describe('grammar manifest ↔ language registry (29a2)', () => {
  const assets = readManifestAssets();

  it('registry grammars equal the manifest active grammar rows', () => {
    const registry = registryGrammars();
    const manifest = activeManifestGrammars(assets);

    expect(registry.length).toBeGreaterThan(0);
    expect(grammarDrift(registry, manifest)).toEqual([]);
    expect(registry).toEqual(manifest);
  });

  it('every parsed language loads its registry grammar (the parser reads GRAMMAR_FILE_MAP)', () => {
    for (const [language, grammarFile] of Object.entries(GRAMMAR_FILE_MAP)) {
      const id = language as keyof typeof GRAMMAR_FILE_MAP;
      expect(LANGUAGE_REGISTRY[id].grammarFile).toBe(grammarFile);
      expect(LANGUAGE_REGISTRY[id].capabilities.parse).toBe(true);
    }
    expect(Object.keys(GRAMMAR_FILE_MAP).sort()).toEqual(
      LANGUAGE_IDS.filter((id) => LANGUAGE_REGISTRY[id].grammarFile !== null)
        .slice()
        .sort(),
    );
  });

  it('each active grammar row names a distinct file', () => {
    const manifest = activeManifestGrammars(assets);
    expect(new Set(manifest).size).toBe(manifest.length);
  });

  it('detects drift in either direction', () => {
    const registry = registryGrammars();
    const [first, ...rest] = registry;
    const deactivated = assets.map((asset) =>
      asset.filename === first ? { ...asset, active: false } : asset,
    );
    const activated = [
      ...assets,
      {
        id: 'synthetic',
        kind: 'grammar',
        active: true,
        filename: 'tree-sitter-synthetic.wasm',
      },
    ];

    expect(grammarDrift(registry, activeManifestGrammars(deactivated))).toEqual(
      [`registry-only:${first}`],
    );
    expect(grammarDrift(rest, activeManifestGrammars(assets))).toEqual([
      `manifest-only:${first}`,
    ]);
    expect(grammarDrift(registry, activeManifestGrammars(activated))).toEqual([
      'manifest-only:tree-sitter-synthetic.wasm',
    ]);
  });
});
