import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIN_BYTES,
  SAMPLE_ORDER_PREFIX,
  classifySession,
  sampleSessions,
  type SessionScan,
} from './sample-sessions';
import { sha256 } from './verify-candidate-manifest';

const CWD = 'D:\\work\\synthetic-repo';

/** A synthetic transcript padded past the 200 KiB floor. */
function transcript(timestamps: string[], cwd = CWD, pad = MIN_BYTES): string {
  const lines = timestamps.map((timestamp, i) =>
    JSON.stringify({
      type: i % 2 === 0 ? 'user' : 'assistant',
      timestamp,
      cwd,
      message: { content: 'synthetic' },
    }),
  );
  const filler = JSON.stringify({
    type: 'attachment',
    content: 'x'.repeat(pad),
  });
  return `${[...lines, filler].join('\n')}\n`;
}

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listAll(path)));
    else out.push(path);
  }
  return out;
}

describe('classifySession', () => {
  const scan = (overrides: Partial<SessionScan>): SessionScan => ({
    file: 'a.jsonl',
    bytes: MIN_BYTES + 1,
    lines: 3,
    unparseableLines: 0,
    firstTimestamp: '2026-10-02T10:00:00.000Z',
    lastTimestamp: '2026-10-02T11:00:00.000Z',
    cwds: [CWD],
    ...overrides,
  });

  it('assigns seed, eval, straddling and outside windows by all line timestamps', () => {
    expect(classifySession(scan({}), []).window).toBe('eval');
    expect(
      classifySession(
        scan({
          firstTimestamp: '2026-09-06T00:00:00.000Z',
          lastTimestamp: '2026-09-30T23:59:59.000Z',
        }),
        [],
      ).window,
    ).toBe('seed');
    expect(
      classifySession(
        scan({
          firstTimestamp: '2026-09-30T23:00:00.000Z',
          lastTimestamp: '2026-10-01T01:00:00.000Z',
        }),
        [],
      ).window,
    ).toBe('straddling');
    expect(
      classifySession(
        scan({
          firstTimestamp: '2026-10-07T00:00:00.000Z',
          lastTimestamp: '2026-10-07T01:00:00.000Z',
        }),
        [],
      ).window,
    ).toBe('outside');
  });

  it('excludes 619 worktree sessions, bench temp homes, out-of-range sizes and sessions without timestamps', () => {
    expect(
      classifySession(
        scan({
          cwds: [CWD, 'D:\\r\\.claude-worktrees\\task-619-tool-benchmark'],
        }),
        [],
      ).exclusion,
    ).toBe('worktree-619-cwd');
    expect(
      classifySession(scan({ cwds: ['C:\\Temp\\bench-home\\ws'] }), [
        'C:\\Temp',
      ]).exclusion,
    ).toBe('bench-temp-cwd');
    expect(classifySession(scan({ bytes: 10 }), []).exclusion).toBe(
      'size-out-of-range',
    );
    expect(
      classifySession(scan({ bytes: 6 * 1024 * 1024 }), []).exclusion,
    ).toBe('size-out-of-range');
    expect(
      classifySession(scan({ firstTimestamp: null, lastTimestamp: null }), [])
        .exclusion,
    ).toBe('no-timestamps');
  });

  it('orders by sha256(prefix + filename)', () => {
    expect(classifySession(scan({ file: 'f.jsonl' }), []).orderKey).toBe(
      sha256(`${SAMPLE_ORDER_PREFIX}f.jsonl`),
    );
  });
});

describe('sampleSessions', () => {
  let root: string;
  let sourceDir: string;
  let benchDataDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ptah-620-sessions-'));
    sourceDir = join(root, 'source');
    benchDataDir = join(root, 'bench');
    await mkdir(sourceDir);
    await mkdir(benchDataDir);
    for (let i = 0; i < 6; i += 1) {
      await writeFile(
        join(sourceDir, `eval-${i}.jsonl`),
        transcript(['2026-10-02T10:00:00Z', '2026-10-03T10:00:00Z']),
        'utf8',
      );
    }
    await writeFile(
      join(sourceDir, 'seed-0.jsonl'),
      transcript(['2026-09-10T10:00:00Z', '2026-09-11T10:00:00Z']),
      'utf8',
    );
    await writeFile(
      join(sourceDir, 'small.jsonl'),
      transcript(['2026-10-02T10:00:00Z'], CWD, 10),
      'utf8',
    );
    await writeFile(
      join(sourceDir, 'wt619.jsonl'),
      transcript(
        ['2026-10-02T10:00:00Z'],
        'D:\\r\\.claude-worktrees\\task-619-x',
      ),
      'utf8',
    );
    await writeFile(join(sourceDir, 'notes.txt'), 'not a transcript', 'utf8');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('copies the sampled sessions with a hash manifest into the bench dir and leaves the source untouched', async () => {
    const sourceBefore = await Promise.all(
      (await readdir(sourceDir))
        .sort()
        .map(
          async (f) =>
            [
              f,
              await readFile(join(sourceDir, f), 'utf8'),
              (await stat(join(sourceDir, f))).mtimeMs,
            ] as const,
        ),
    );
    const result = await sampleSessions({
      benchDataDir,
      sourceDir,
      sampleSize: 4,
      tempRoots: [],
    });

    const expected = [0, 1, 2, 3, 4, 5]
      .map((i) => `eval-${i}.jsonl`)
      .sort((a, b) =>
        sha256(SAMPLE_ORDER_PREFIX + a).localeCompare(
          sha256(SAMPLE_ORDER_PREFIX + b),
        ),
      )
      .slice(0, 4);
    expect(result.manifest.sessions.map((s) => s.file)).toEqual(expected);
    for (const s of result.manifest.sessions) {
      const copy = await readFile(
        join(result.outputDir, 'transcripts', s.file),
      );
      expect(sha256(copy)).toBe(s.sha256);
      expect(s.opaqueId).toMatch(/^RS-[0-9A-F]{12}$/);
    }
    expect(result.manifest.counts).toMatchObject({
      files: 9,
      'window:eval': 6,
      'window:seed': 1,
      'excluded:size-out-of-range': 1,
      'excluded:worktree-619-cwd': 1,
      eligibleEval: 6,
    });

    // Nothing outside the bench dir changed and nothing was written beside the source.
    const sourceAfter = await Promise.all(
      (await readdir(sourceDir))
        .sort()
        .map(
          async (f) =>
            [
              f,
              await readFile(join(sourceDir, f), 'utf8'),
              (await stat(join(sourceDir, f))).mtimeMs,
            ] as const,
        ),
    );
    expect(sourceAfter).toEqual(sourceBefore);
    expect((await readdir(root)).sort()).toEqual(['bench', 'source']);
    const written = await listAll(benchDataDir);
    expect(
      written.every((p) =>
        p.startsWith(join(benchDataDir, 'sessions', 'gt-memory-real-v1')),
      ),
    ).toBe(true);
    expect(written).toHaveLength(5);
  });

  it('refuses to replace an existing sample without overwrite', async () => {
    await sampleSessions({
      benchDataDir,
      sourceDir,
      sampleSize: 2,
      tempRoots: [],
    });
    await expect(
      sampleSessions({ benchDataDir, sourceDir, sampleSize: 2, tempRoots: [] }),
    ).rejects.toThrow('already exists');
  });

  it('fails without writing when there are too few eligible sessions', async () => {
    await expect(
      sampleSessions({
        benchDataDir,
        sourceDir,
        sampleSize: 20,
        tempRoots: [],
      }),
    ).rejects.toThrow('Only 6 eligible');
    expect(await listAll(benchDataDir)).toEqual([]);
  });

  it('refuses a bench dir inside the source dir', async () => {
    await expect(
      sampleSessions({
        benchDataDir: join(sourceDir, 'bench'),
        sourceDir,
        sampleSize: 1,
        tempRoots: [],
      }),
    ).rejects.toThrow('must not contain each other');
  });
});
