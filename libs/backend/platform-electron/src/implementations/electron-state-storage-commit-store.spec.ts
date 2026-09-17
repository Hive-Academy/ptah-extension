import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateStorageRecoveryRequiredError } from '@ptah-extension/platform-core';
import {
  ElectronStateCommitError,
  ElectronStateCommitStore,
  type ElectronStateDurableStep,
  type ElectronStateFaultInjector,
} from './electron-state-storage-commit-store';
import type { ElectronStateManifest } from './electron-state-storage-manifest';
import type { JsonValue } from './electron-state-storage-worker-protocol';

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

const PRE_POINTER_STEPS = DURABLE_STEPS.filter(
  (step) => step !== 'current-renamed' && step !== 'current-verified',
);

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

function failAfter(
  target: ElectronStateDurableStep,
): ElectronStateFaultInjector {
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

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function commitLegacyFile(
  store: ElectronStateCommitStore,
  legacyPath: string,
): Promise<ElectronStateManifest> {
  const text = await fs.readFile(legacyPath, 'utf8');
  const values = JSON.parse(text) as Record<string, JsonValue>;
  return await store.commitInitialStream(sha256Hex(text), async (sink) => {
    for (const [key, value] of Object.entries(values)) {
      await sink.put(key, value);
    }
  });
}

async function openStore(
  legacyPath: string,
  v2Path: string,
  faultInjector?: ElectronStateFaultInjector,
): Promise<{
  store: ElectronStateCommitStore;
  manifest: ElectronStateManifest;
}> {
  const store = new ElectronStateCommitStore(legacyPath, v2Path, faultInjector);
  const loaded = await store.initialize();
  if (loaded.kind === 'current') return { store, manifest: loaded.manifest };
  return { store, manifest: await commitLegacyFile(store, legacyPath) };
}

async function openFailingStore(
  legacyPath: string,
  v2Path: string,
  step: ElectronStateDurableStep,
): Promise<{
  store: ElectronStateCommitStore;
  manifest: ElectronStateManifest;
}> {
  await openStore(legacyPath, v2Path);
  return await openStore(legacyPath, v2Path, failAfter(step));
}

async function currentValue(
  legacyPath: string,
  v2Path: string,
): Promise<{ value: unknown; manifest: ElectronStateManifest }> {
  const store = new ElectronStateCommitStore(legacyPath, v2Path);
  const loaded = await store.initialize();
  if (loaded.kind !== 'current') throw new Error('expected a current store');
  return {
    value: await store.readValue(loaded.manifest.values['value']),
    manifest: loaded.manifest,
  };
}

function blobName(key: string, generation: number): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.${generation}.json`;
}

describe('ElectronStateCommitStore boot and initial commit', () => {
  it('returns the legacy file path without reading or committing anything', async () => {
    const { legacyPath, v2Path, legacyBytes } = await fixture();
    const loaded = await new ElectronStateCommitStore(
      legacyPath,
      v2Path,
    ).initialize();

    expect(loaded).toEqual({ kind: 'legacy', legacyFilePath: legacyPath });
    await expect(fs.access(v2Path)).rejects.toBeDefined();
    expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyBytes);
  });

  it('returns the legacy arm for an absent v1 file', async () => {
    const { dir } = await fixture();
    const legacyFilePath = path.join(dir, 'missing.json');
    const loaded = await new ElectronStateCommitStore(
      legacyFilePath,
      path.join(dir, 'missing.v2'),
    ).initialize();

    expect(loaded).toEqual({ kind: 'legacy', legacyFilePath });
  });

  it('leaves an incomplete v2 in place until the initial stream commit runs', async () => {
    const { legacyPath, v2Path, dir } = await fixture();
    await fs.mkdir(path.join(v2Path, 'values'), { recursive: true });
    await fs.writeFile(path.join(v2Path, 'values', 'stray.json'), '1', 'utf8');
    const store = new ElectronStateCommitStore(legacyPath, v2Path);

    expect((await store.initialize()).kind).toBe('legacy');
    await fs.access(path.join(v2Path, 'values', 'stray.json'));

    await commitLegacyFile(store, legacyPath);
    const quarantined = (await fs.readdir(dir)).filter((name) =>
      name.startsWith('workspace-state.v2.quarantine.'),
    );
    expect(quarantined).toHaveLength(1);
    await expect(
      fs.access(path.join(v2Path, 'values', 'stray.json')),
    ).rejects.toBeDefined();
  });

  it('refuses a second put of the same key before publication', async () => {
    const { legacyPath, v2Path } = await fixture();
    const store = new ElectronStateCommitStore(legacyPath, v2Path);
    await store.initialize();

    const failure = await store
      .commitInitialStream(sha256Hex('{}'), async (sink) => {
        await sink.put('value', 1);
        await sink.put('value', 2);
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(ElectronStateCommitError);
    expect((failure as ElectronStateCommitError).phase).toBe('pre-publication');
    await expect(fs.access(path.join(v2Path, 'CURRENT'))).rejects.toBeDefined();
  });

  it('publishes nothing when produce throws and boots legacy again', async () => {
    const { legacyPath, v2Path, legacyBytes } = await fixture();
    const store = new ElectronStateCommitStore(legacyPath, v2Path);
    await store.initialize();

    const failure = await store
      .commitInitialStream(sha256Hex(legacyBytes), async (sink) => {
        await sink.put('value', 'partial');
        throw new Error('produce failed');
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(ElectronStateCommitError);
    expect((failure as ElectronStateCommitError).phase).toBe('pre-publication');
    await expect(fs.access(path.join(v2Path, 'CURRENT'))).rejects.toBeDefined();
    expect(
      await new ElectronStateCommitStore(legacyPath, v2Path).initialize(),
    ).toEqual({ kind: 'legacy', legacyFilePath: legacyPath });
  });

  it('writes stream blobs byte-identical to mutation blobs of the same value', async () => {
    const { legacyPath, v2Path } = await fixture();
    const value: JsonValue = {
      text: 'a\u{1F600}\u754C "quoted" \\ back',
      list: [1, 2.5, null, true],
    };
    const store = new ElectronStateCommitStore(legacyPath, v2Path);
    await store.initialize();
    const initial = await store.commitInitialStream(
      sha256Hex('{}'),
      async (sink) => {
        await sink.put('stream', value);
      },
    );
    const mutated = await store.commitMutation(
      new Map([['mutation', value]]),
      initial,
    );

    const streamBytes = await fs.readFile(
      path.join(v2Path, initial.values['stream'].relativePath),
    );
    const mutationBytes = await fs.readFile(
      path.join(v2Path, mutated.values['mutation'].relativePath),
    );
    expect(Buffer.compare(streamBytes, mutationBytes)).toBe(0);
    expect(initial.values['stream'].sha256).toBe(
      mutated.values['mutation'].sha256,
    );
    expect(initial.values['stream'].byteLength).toBe(
      mutated.values['mutation'].byteLength,
    );
  });

  it('boots a committed store by verifying blobs without parsing them', async () => {
    const { legacyPath, v2Path } = await fixture();
    await openStore(legacyPath, v2Path);
    const parse = jest.spyOn(JSON, 'parse');
    const store = new ElectronStateCommitStore(legacyPath, v2Path);

    const loaded = await store.initialize();
    const parsedTexts = parse.mock.calls.map(([text]) => String(text));
    parse.mockRestore();

    expect(loaded.kind).toBe('current');
    expect(parsedTexts.some((text) => text === '"legacy"')).toBe(false);
    if (loaded.kind === 'current') {
      expect(await store.readValue(loaded.manifest.values['value'])).toBe(
        'legacy',
      );
    }
  });

  it.each(DURABLE_STEPS)(
    'initial commit failure after %s leaves v1 authoritative or the verified current commit',
    async (step) => {
      const { legacyPath, v2Path, legacyBytes } = await fixture();
      const failing = new ElectronStateCommitStore(
        legacyPath,
        v2Path,
        failAfter(step),
      );
      const loaded = await failing.initialize();
      if (loaded.kind !== 'legacy') throw new Error('expected legacy boot');

      await expect(
        commitLegacyFile(failing, loaded.legacyFilePath),
      ).rejects.toBeInstanceOf(ElectronStateCommitError);

      const recovered = await openStore(legacyPath, v2Path);
      expect(
        await recovered.store.readValue(recovered.manifest.values['value']),
      ).toBe('legacy');
      expect(recovered.manifest.mutationEpoch).toBe(0);
      expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyBytes);
    },
  );
});

describe('ElectronStateCommitStore durable-step recovery', () => {
  it.each(DURABLE_STEPS)(
    'mutation failure after %s selects old/new valid v2 and never v1',
    async (step) => {
      const { legacyPath, v2Path } = await fixture();
      const baseline = await openStore(legacyPath, v2Path);
      const failing = await openFailingStore(legacyPath, v2Path, step);

      await expect(
        failing.store.commitMutation(
          new Map([['value', 'mutated']]),
          failing.manifest,
        ),
      ).rejects.toThrow(ElectronStateCommitError);

      const recovered = await currentValue(legacyPath, v2Path);
      const currentMoved =
        step === 'current-renamed' || step === 'current-verified';
      expect(recovered.value).toBe(currentMoved ? 'mutated' : 'legacy');
      if (currentMoved) {
        expect(recovered.manifest.mutationEpoch).toBe(1);
      } else {
        expect(recovered.manifest.commitId).toBe(baseline.manifest.commitId);
      }
    },
  );

  it.each(DURABLE_STEPS)(
    'classifies a failure after %s by whether CURRENT publication was attempted',
    async (step) => {
      const { legacyPath, v2Path } = await fixture();
      const failing = await openFailingStore(legacyPath, v2Path, step);

      const failure = await failing.store
        .commitMutation(new Map([['value', 'mutated']]), failing.manifest)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(failure).toBeInstanceOf(ElectronStateCommitError);
      expect((failure as ElectronStateCommitError).phase).toBe(
        step === 'current-renamed' || step === 'current-verified'
          ? 'post-publication'
          : 'pre-publication',
      );
      expect((failure as ElectronStateCommitError).generation).toBe(
        failing.manifest.generation + 1,
      );
    },
  );

  it('fails closed when current v2 is corrupt after mutation', async () => {
    const { legacyPath, v2Path } = await fixture();
    const { store, manifest } = await openStore(legacyPath, v2Path);
    await store.commitMutation(new Map([['value', 'mutated']]), manifest);
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
    ['short', 'blob-length-mismatch'],
  ] as const)(
    'fails closed at boot for a %s current blob after mutation',
    async (damage, reason) => {
      const { legacyPath, v2Path } = await fixture();
      const { store, manifest } = await openStore(legacyPath, v2Path);
      const mutated = await store.commitMutation(
        new Map([['value', 'mutated']]),
        manifest,
      );
      const blobPath = path.join(v2Path, mutated.values['value'].relativePath);
      if (damage === 'missing') await fs.rm(blobPath);
      else if (damage === 'short') await fs.writeFile(blobPath, '"', 'utf8');
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

  it.each([
    ['missing', 'blob-missing'],
    ['tampered', 'blob-hash-mismatch'],
    ['short', 'blob-length-mismatch'],
  ] as const)(
    'rejects a %s blob on a verified per-key read after boot',
    async (damage, reason) => {
      const { legacyPath, v2Path } = await fixture();
      const { store, manifest } = await openStore(legacyPath, v2Path);
      const blob = manifest.values['value'];
      const blobPath = path.join(v2Path, blob.relativePath);
      if (damage === 'missing') await fs.rm(blobPath);
      else if (damage === 'short') await fs.writeFile(blobPath, '"', 'utf8');
      else await fs.writeFile(blobPath, '"legacX"', 'utf8');

      await expect(store.readValue(blob)).rejects.toEqual(
        expect.objectContaining<Partial<StateStorageRecoveryRequiredError>>({
          reason,
        }),
      );
    },
  );

  it('does not fall back to v1 or prior v2 when CURRENT disappears after mutation', async () => {
    const { legacyPath, v2Path } = await fixture();
    const { store, manifest } = await openStore(legacyPath, v2Path);
    await store.commitMutation(new Map([['value', 'mutated']]), manifest);
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
    const { store, manifest } = await openStore(legacyPath, v2Path);
    await store.commitMutation(new Map([['value', 'mutated']]), manifest);

    expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyBytes);
    expect((await fs.readdir(path.join(v2Path, 'manifests'))).sort()).toEqual([
      'manifest.1.json',
      'manifest.2.json',
    ]);
  });
});

describe('ElectronStateCommitStore fresh generation allocation (N2)', () => {
  it.each(PRE_POINTER_STEPS)(
    'a failure after %s never blocks the next commit, on the same instance or after a restart',
    async (step) => {
      const { legacyPath, v2Path } = await fixture();
      const failing = await openFailingStore(legacyPath, v2Path, step);
      const baseGeneration = failing.manifest.generation;

      await expect(
        failing.store.commitMutation(
          new Map([['value', 'attempted']]),
          failing.manifest,
        ),
      ).rejects.toThrow(ElectronStateCommitError);

      const sameInstance = await failing.store.commitMutation(
        new Map([['value', 'same-instance']]),
        failing.manifest,
      );
      expect(sameInstance.generation).toBe(baseGeneration + 2);
      expect(sameInstance.previousGeneration).toBe(baseGeneration);
      expect(await currentValue(legacyPath, v2Path)).toMatchObject({
        value: 'same-instance',
      });

      const restarted = await openStore(legacyPath, v2Path);
      const afterRestart = await restarted.store.commitMutation(
        new Map([['value', 'after-restart']]),
        restarted.manifest,
      );
      expect(afterRestart.generation).toBe(baseGeneration + 3);
      expect(await currentValue(legacyPath, v2Path)).toMatchObject({
        value: 'after-restart',
      });
    },
  );

  it.each(PRE_POINTER_STEPS)(
    'a restart straight after a failure at %s commits a fresh readable generation',
    async (step) => {
      const { legacyPath, v2Path } = await fixture();
      const failing = await openFailingStore(legacyPath, v2Path, step);
      await expect(
        failing.store.commitMutation(
          new Map([['value', 'attempted']]),
          failing.manifest,
        ),
      ).rejects.toThrow(ElectronStateCommitError);

      const restarted = await openStore(legacyPath, v2Path);
      expect(restarted.manifest.generation).toBe(failing.manifest.generation);
      const next = await restarted.store.commitMutation(
        new Map([['value', 'after-restart']]),
        restarted.manifest,
      );

      expect(next.generation).toBeGreaterThan(failing.manifest.generation);
      expect(await currentValue(legacyPath, v2Path)).toMatchObject({
        value: 'after-restart',
      });
    },
  );

  it('a published manifest N+1 without a CURRENT move stays readable at N and the next commit is N+2', async () => {
    const { legacyPath, v2Path } = await fixture();
    const failing = await openFailingStore(
      legacyPath,
      v2Path,
      'manifest-verified',
    );
    const generation = failing.manifest.generation;
    await expect(
      failing.store.commitMutation(
        new Map([['value', 'orphaned']]),
        failing.manifest,
      ),
    ).rejects.toThrow(ElectronStateCommitError);
    await fs.access(
      path.join(v2Path, 'manifests', `manifest.${generation + 1}.json`),
    );

    const restarted = await openStore(legacyPath, v2Path);
    expect(restarted.manifest.generation).toBe(generation);
    expect(
      await restarted.store.readValue(restarted.manifest.values['value']),
    ).toBe('legacy');
    const next = await restarted.store.commitMutation(
      new Map([['value', 'next']]),
      restarted.manifest,
    );
    expect(next.generation).toBe(generation + 2);
  });

  it('an orphan blob of generation N+1 alone forces the next commit to N+2', async () => {
    const { legacyPath, v2Path } = await fixture();
    const { manifest } = await openStore(legacyPath, v2Path);
    await fs.writeFile(
      path.join(v2Path, 'values', blobName('other', manifest.generation + 1)),
      '"orphan"',
      'utf8',
    );

    const restarted = await openStore(legacyPath, v2Path);
    const next = await restarted.store.commitMutation(
      new Map([['value', 'next']]),
      restarted.manifest,
    );

    expect(next.generation).toBe(manifest.generation + 2);
  });

  it('ignores staging temp files when scanning occupied generations', async () => {
    const { legacyPath, v2Path } = await fixture();
    const { manifest } = await openStore(legacyPath, v2Path);
    await fs.writeFile(
      path.join(
        v2Path,
        'values',
        `${blobName('other', manifest.generation + 5)}.op.tmp`,
      ),
      '"staged"',
      'utf8',
    );

    const restarted = await openStore(legacyPath, v2Path);
    const next = await restarted.store.commitMutation(
      new Map([['value', 'next']]),
      restarted.manifest,
    );

    expect(next.generation).toBe(manifest.generation + 1);
  });
});

describe('ElectronStateCommitStore publication evidence', () => {
  it('reads the pointer and verifies a manifest published by a failed commit', async () => {
    const { legacyPath, v2Path } = await fixture();
    const failing = await openFailingStore(
      legacyPath,
      v2Path,
      'current-verified',
    );
    const failure = await failing.store
      .commitMutation(new Map([['value', 'published']]), failing.manifest)
      .then(
        () => null,
        (error: unknown) => error as ElectronStateCommitError,
      );

    const pointer = await failing.store.readPointer();
    expect(pointer.generation).toBe(failure?.generation);
    const adopted = await failing.store.loadPublishedManifest(pointer);
    expect(await failing.store.readValue(adopted.values['value'])).toBe(
      'published',
    );
  });

  it('refuses a published manifest whose freshly written blob was damaged', async () => {
    const { legacyPath, v2Path } = await fixture();
    const { store, manifest } = await openStore(legacyPath, v2Path);
    const mutated = await store.commitMutation(
      new Map([['value', 'mutated']]),
      manifest,
    );
    await fs.writeFile(
      path.join(v2Path, mutated.values['value'].relativePath),
      '"MUTATED"',
      'utf8',
    );

    await expect(
      store.loadPublishedManifest(await store.readPointer()),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StateStorageRecoveryRequiredError>>({
        reason: 'blob-hash-mismatch',
      }),
    );
  });

  it('keeps the epoch rules for migration commits', async () => {
    const { legacyPath, v2Path } = await fixture();
    const { store, manifest } = await openStore(legacyPath, v2Path);

    const migration = await store.commitMigration(
      new Map([['index', { items: [] }]]),
      manifest,
    );
    expect(migration).toMatchObject({
      commitKind: 'migration',
      mutationEpoch: 0,
    });
    const mutation = await store.commitMutation(
      new Map([['value', 'x']]),
      migration,
    );
    const afterMutation = await store.commitMigration(
      new Map([['index', { items: [1] }]]),
      mutation,
    );
    expect(afterMutation).toMatchObject({
      commitKind: 'mutation',
      mutationEpoch: 2,
    });
  });
});
