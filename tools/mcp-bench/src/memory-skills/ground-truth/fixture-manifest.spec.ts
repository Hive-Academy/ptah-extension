import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildManifest,
  canonicalJson,
  canonicalJsonlHash,
  readManifest,
  sha256File,
  verifyManifest,
  writeManifest,
} from './fixture-manifest';
import { factSchema } from './label-schemas';
import { matchesFact } from '../matching/fact-matcher';

const CSV = 'opaqueId,raterId,c1,c2,c3,c4,c5,c6,c7,c8,total,pass,ratedAt\n';
const FACTS = '{"a":2,"b":1}\n';
const SESSION = '{"role":"user","text":"we ship on Fridays"}\n';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('canonical JSONL hashing', () => {
  it('sorts object keys at every depth', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }),
    ).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('hashes each record as an LF-terminated canonical line', () => {
    const text = '{"a":2,"b":1}\n{"z":"x"}\n';
    expect(canonicalJsonlHash([{ b: 1, a: 2 }, { z: 'x' }])).toBe(sha256(text));
  });

  it('is insensitive to key order in the input records', () => {
    expect(canonicalJsonlHash([{ a: 1, b: 2 }])).toBe(
      canonicalJsonlHash([{ b: 2, a: 1 }]),
    );
  });

  it('hashes an empty record set to the sha256 of the empty string', () => {
    expect(canonicalJsonlHash([])).toBe(sha256(''));
  });
});

describe('fixture manifest', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-bench-manifest-'));
    await writeFile(join(dir, 'memory-facts.v1.jsonl'), FACTS, 'utf8');
    await writeFile(join(dir, 'skill-labels.v1.csv'), CSV, 'utf8');
    await mkdir(join(dir, 'sessions'));
    await writeFile(join(dir, 'sessions', 'seed-001.jsonl'), SESSION, 'utf8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds a manifest of sorted relative paths and raw-byte hashes', async () => {
    const manifest = await buildManifest(dir);
    expect(manifest.schemaVersion).toBe(1);
    expect(Object.keys(manifest.files)).toEqual([
      'memory-facts.v1.jsonl',
      'sessions/seed-001.jsonl',
      'skill-labels.v1.csv',
    ]);
    expect(manifest.files['memory-facts.v1.jsonl']).toBe(sha256(FACTS));
    expect(manifest.files['sessions/seed-001.jsonl']).toBe(sha256(SESSION));
    expect(manifest.files['skill-labels.v1.csv']).toBe(sha256(CSV));
  });

  it('round-trips through writeManifest and verifies clean', async () => {
    const manifest = await buildManifest(dir);
    await writeManifest(dir, manifest);
    expect(await readManifest(dir)).toEqual(manifest);
    expect(await buildManifest(dir)).toEqual(manifest);
    const verification = await verifyManifest(dir);
    expect(verification.ok).toBe(true);
    expect(verification.mismatches).toEqual([]);
  });

  it('fails when a CSV hash differs from the manifest', async () => {
    const recorded = await readManifest(dir);
    await writeFile(join(dir, 'skill-labels.v1.csv'), 'opaqueId\n', 'utf8');
    const verification = await verifyManifest(dir);
    expect(verification.ok).toBe(false);
    expect(verification.mismatches).toEqual([
      {
        relPath: 'skill-labels.v1.csv',
        kind: 'hash-mismatch',
        expected: recorded.files['skill-labels.v1.csv'],
        actual: sha256('opaqueId\n'),
      },
    ]);
    await writeFile(join(dir, 'skill-labels.v1.csv'), CSV, 'utf8');
    expect((await verifyManifest(dir)).ok).toBe(true);
  });

  it('reports a recorded file that is gone', async () => {
    const session = join(dir, 'sessions', 'seed-001.jsonl');
    await rm(session);
    const verification = await verifyManifest(dir);
    expect(verification.ok).toBe(false);
    expect(verification.mismatches).toContainEqual({
      relPath: 'sessions/seed-001.jsonl',
      kind: 'missing',
      expected: sha256(SESSION),
      actual: null,
    });
    await writeFile(session, SESSION, 'utf8');
    expect((await verifyManifest(dir)).ok).toBe(true);
  });

  it('reports a file the manifest does not record', async () => {
    await writeFile(join(dir, 'planted-negatives.v1.jsonl'), '[]\n', 'utf8');
    const verification = await verifyManifest(dir);
    expect(verification.ok).toBe(false);
    expect(verification.mismatches).toContainEqual({
      relPath: 'planted-negatives.v1.jsonl',
      kind: 'unexpected',
      expected: null,
      actual: sha256('[]\n'),
    });
    await rm(join(dir, 'planted-negatives.v1.jsonl'));
    expect((await verifyManifest(dir)).ok).toBe(true);
  });
});

describe('committed memory-skills fixtures', () => {
  const fixtureDir = join(
    __dirname,
    '..',
    '..',
    '..',
    'fixtures',
    'memory-skills',
  );

  it('records every listed fixture with its current hash', async () => {
    const manifest = await readManifest(fixtureDir);
    for (const [relPath, expected] of Object.entries(manifest.files)) {
      const actual = await sha256File(join(fixtureDir, relPath));
      expect([relPath, actual]).toEqual([relPath, expected]);
    }
  });

  it('makes every durable fact match its own statement', async () => {
    const facts = (
      await readFile(join(fixtureDir, 'memory-facts.v1.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => factSchema.parse(JSON.parse(line)));
    for (const fact of facts.filter((fact) => fact.category !== 'abstention')) {
      expect(matchesFact(fact, { content: fact.statement })).toBe(true);
    }
  });
});
