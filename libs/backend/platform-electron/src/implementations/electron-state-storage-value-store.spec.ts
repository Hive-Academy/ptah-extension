import type {
  ElectronStateBlob,
  ElectronStateManifest,
} from './electron-state-storage-manifest';
import { ElectronStateValueStore } from './electron-state-storage-value-store';
import {
  estimateElectronStateJsonBytes,
  type JsonValue,
} from './electron-state-storage-worker-protocol';

function blob(key: string, generation: number): ElectronStateBlob {
  return {
    relativePath: `values/${key}.${generation}.json`,
    generation,
    byteLength: 1,
    sha256: 'a'.repeat(64),
  };
}

function manifest(
  generation: number,
  keys: Record<string, number>,
): ElectronStateManifest {
  return {
    schemaVersion: 2,
    generation,
    previousGeneration: generation > 1 ? generation - 1 : null,
    commitId: '018f55cb-3f18-7d5e-a1a4-000000000001',
    commitKind: 'mutation',
    committedAtEpochMs: 0,
    sourceV1Sha256: 'b'.repeat(64),
    mutationEpoch: 1,
    values: Object.fromEntries(
      Object.entries(keys).map(([key, blobGeneration]) => [
        key,
        blob(key, blobGeneration),
      ]),
    ),
  };
}

function countingReader(values: Record<string, JsonValue>): {
  read: (entry: ElectronStateBlob) => Promise<JsonValue>;
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    read: async (entry) => {
      reads.push(entry.relativePath);
      const key = entry.relativePath.split('/')[1].split('.')[0];
      return values[key];
    },
  };
}

describe('ElectronStateValueStore', () => {
  it('answers has and keys from the manifest without reading values', async () => {
    const { read, reads } = countingReader({ a: 1, b: 2 });
    const store = new ElectronStateValueStore(read);
    store.setManifest(manifest(1, { a: 1, b: 1 }));

    expect(store.has('a')).toBe(true);
    expect(store.has('missing')).toBe(false);
    expect(store.has('toString')).toBe(false);
    expect(store.keys()).toEqual(['a', 'b']);
    await expect(store.get('missing')).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('reads a value once and serves repeats from the cache', async () => {
    const { read, reads } = countingReader({ a: { n: 1 } });
    const store = new ElectronStateValueStore(read);
    store.setManifest(manifest(1, { a: 1 }));

    await store.get('a');
    await store.get('a');

    expect(reads).toEqual(['values/a.1.json']);
    expect(store.stats()).toMatchObject({
      entries: 1,
      bytes: estimateElectronStateJsonBytes({ n: 1 }),
    });
  });

  it('re-reads a key whose blob changed in a newer manifest', async () => {
    const { read, reads } = countingReader({ a: 'x' });
    const store = new ElectronStateValueStore(read);
    store.setManifest(manifest(1, { a: 1 }));
    await store.get('a');

    store.setManifest(manifest(2, { a: 2 }));
    expect(store.stats().entries).toBe(0);
    await store.get('a');

    expect(reads).toEqual(['values/a.1.json', 'values/a.2.json']);
  });

  it('evicts least recently used values to stay within its byte bound', async () => {
    const text = 'x'.repeat(100);
    const entryBytes = estimateElectronStateJsonBytes(text);
    const { read, reads } = countingReader({ a: text, b: text, c: text });
    const store = new ElectronStateValueStore(read, entryBytes * 2);
    store.setManifest(manifest(1, { a: 1, b: 1, c: 1 }));

    await store.get('a');
    await store.get('b');
    await store.get('a');
    await store.get('c');
    await store.get('a');
    await store.get('b');

    expect(store.stats().bytes).toBeLessThanOrEqual(entryBytes * 2);
    expect(reads.filter((entry) => entry === 'values/b.1.json')).toHaveLength(
      2,
    );
    expect(reads.filter((entry) => entry === 'values/a.1.json')).toHaveLength(
      1,
    );
  });

  it('never caches a value larger than the whole bound', async () => {
    const { read, reads } = countingReader({ big: 'x'.repeat(1000) });
    const store = new ElectronStateValueStore(read, 64);
    store.setManifest(manifest(1, { big: 1 }));

    await store.get('big');
    await store.get('big');

    expect(store.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(reads).toHaveLength(2);
  });

  it('remembers committed values and evicts named keys on demand', async () => {
    const { read, reads } = countingReader({});
    const store = new ElectronStateValueStore(read);
    const next = manifest(1, { a: 1, b: 1 });
    store.setManifest(next);
    store.remember('a', next.values['a'], 'committed');
    store.remember('b', next.values['b'], 'other');

    await expect(store.get('a')).resolves.toBe('committed');
    store.evict(['a']);

    expect(store.stats().entries).toBe(1);
    expect(reads).toEqual([]);
  });
});
