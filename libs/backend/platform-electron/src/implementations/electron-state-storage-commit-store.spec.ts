import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateStorageRecoveryRequiredError } from '@ptah-extension/platform-core';
import {
  ElectronStateCommitStore,
  type ElectronStateDurableStep,
} from './electron-state-storage-commit-store';

const DURABLE_STEPS: readonly ElectronStateDurableStep[] = [
  'blob-written',
  'blob-flushed',
  'blob-renamed',
  'blob-verified',
  'manifest-written',
  'manifest-flushed',
  'manifest-renamed',
  'manifest-verified',
  'current-written',
  'current-flushed',
  'current-renamed',
  'current-verified',
];

const tmpDirs: string[] = [];

async function fixture(): Promise<{
  dir: string;
  legacyPath: string;
  v2Path: string;
  legacyBytes: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-v2-commit-'));
  tmpDirs.push(dir);
  const legacyPath = path.join(dir, 'workspace-state.json');
  const v2Path = path.join(dir, 'workspace-state.v2');
  const legacyBytes = '{\n  "value": "legacy"\n}\n';
  await fs.writeFile(legacyPath, legacyBytes, 'utf8');
  return { dir, legacyPath, v2Path, legacyBytes };
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function failAfter(target: ElectronStateDurableStep) {
  let fired = false;
  return {
    after(step: ElectronStateDurableStep): void {
      if (!fired && step === target) {
        fired = true;
        throw new Error(`injected:${step}`);
      }
    },
  };
}

describe('ElectronStateCommitStore durable-step recovery', () => {
  it.each(DURABLE_STEPS)(
    'initial migration failure after %s selects retained v1 or the verified current commit',
    async (step) => {
      const { legacyPath, v2Path, legacyBytes } = await fixture();
      const failing = new ElectronStateCommitStore(
        legacyPath,
        v2Path,
        failAfter(step),
      );

      await expect(failing.initialize()).rejects.toThrow(`injected:${step}`);

      const recovered = await new ElectronStateCommitStore(
        legacyPath,
        v2Path,
      ).initialize();
      expect(recovered.values).toEqual({ value: 'legacy' });
      expect(recovered.manifest.mutationEpoch).toBe(0);
      expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyBytes);
    },
  );

  it.each(DURABLE_STEPS)(
    'mutation failure after %s selects old/new valid v2 and never v1',
    async (step) => {
      const { legacyPath, v2Path } = await fixture();
      const baseline = await new ElectronStateCommitStore(
        legacyPath,
        v2Path,
      ).initialize();
      const failing = new ElectronStateCommitStore(
        legacyPath,
        v2Path,
        failAfter(step),
      );
      const loaded = await failing.initialize();

      await expect(
        failing.commitMutation(
          { value: 'mutated' },
          new Set(['value']),
          loaded.manifest,
        ),
      ).rejects.toThrow(`injected:${step}`);

      const recovered = await new ElectronStateCommitStore(
        legacyPath,
        v2Path,
      ).initialize();
      const currentMoved =
        step === 'current-renamed' || step === 'current-verified';
      expect(recovered.values['value']).toBe(
        currentMoved ? 'mutated' : 'legacy',
      );
      if (currentMoved) {
        expect(recovered.manifest.mutationEpoch).toBe(1);
      } else {
        expect(recovered.manifest.commitId).toBe(baseline.manifest.commitId);
      }
    },
  );

  it('fails closed when current v2 is corrupt after mutation', async () => {
    const { legacyPath, v2Path } = await fixture();
    const store = new ElectronStateCommitStore(legacyPath, v2Path);
    const loaded = await store.initialize();
    await store.commitMutation(
      { value: 'mutated' },
      new Set(['value']),
      loaded.manifest,
    );
    const current = JSON.parse(
      await fs.readFile(path.join(v2Path, 'CURRENT'), 'utf8'),
    ) as { manifestRelativePath: string };
    await fs.writeFile(
      path.join(v2Path, current.manifestRelativePath),
      '{"damaged":true}',
      'utf8',
    );

    await expect(
      new ElectronStateCommitStore(legacyPath, v2Path).initialize(),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StateStorageRecoveryRequiredError>>({
        code: 'STATE_STORAGE_RECOVERY_REQUIRED',
        reason: 'manifest-invalid',
      }),
    );
  });

  it.each([
    ['missing', 'blob-missing'],
    ['hash-invalid', 'blob-hash-mismatch'],
  ] as const)(
    'fails closed for a %s current blob after mutation',
    async (damage, reason) => {
      const { legacyPath, v2Path } = await fixture();
      const store = new ElectronStateCommitStore(legacyPath, v2Path);
      const loaded = await store.initialize();
      await store.commitMutation(
        { value: 'mutated' },
        new Set(['value']),
        loaded.manifest,
      );
      const current = JSON.parse(
        await fs.readFile(path.join(v2Path, 'CURRENT'), 'utf8'),
      ) as { manifestRelativePath: string };
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(v2Path, current.manifestRelativePath),
          'utf8',
        ),
      ) as { values: Record<string, { relativePath: string }> };
      const blobPath = path.join(v2Path, manifest.values['value'].relativePath);
      if (damage === 'missing') await fs.rm(blobPath);
      else await fs.writeFile(blobPath, '"changed"', 'utf8');

      await expect(
        new ElectronStateCommitStore(legacyPath, v2Path).initialize(),
      ).rejects.toEqual(
        expect.objectContaining<Partial<StateStorageRecoveryRequiredError>>({
          code: 'STATE_STORAGE_RECOVERY_REQUIRED',
          reason,
        }),
      );
    },
  );

  it('does not fall back to v1 or prior v2 when CURRENT disappears after mutation', async () => {
    const { legacyPath, v2Path } = await fixture();
    const store = new ElectronStateCommitStore(legacyPath, v2Path);
    const loaded = await store.initialize();
    await store.commitMutation(
      { value: 'mutated' },
      new Set(['value']),
      loaded.manifest,
    );
    await fs.rm(path.join(v2Path, 'CURRENT'));

    await expect(
      new ElectronStateCommitStore(legacyPath, v2Path).initialize(),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StateStorageRecoveryRequiredError>>({
        reason: 'current-pointer-invalid',
      }),
    );
  });

  it('retains v1 and the prior v2 generation after a successful mutation', async () => {
    const { legacyPath, v2Path, legacyBytes } = await fixture();
    const store = new ElectronStateCommitStore(legacyPath, v2Path);
    const loaded = await store.initialize();
    await store.commitMutation(
      { value: 'mutated' },
      new Set(['value']),
      loaded.manifest,
    );

    expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyBytes);
    expect((await fs.readdir(path.join(v2Path, 'manifests'))).sort()).toEqual([
      'manifest.1.json',
      'manifest.2.json',
    ]);
  });
});
