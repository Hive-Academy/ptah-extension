/**
 * `AgentPackDownloadService` — unit specs.
 *
 * The service pulls curated agent packs (a manifest listing `.md` agent
 * files) from GitHub. Critical invariants under test:
 *
 *   1. Pack manifest: `fetchPackInfo()` returns the structured info when
 *      the manifest is valid, and degrades gracefully (empty `agents` +
 *      error description) when it is not.
 *   2. Plan: `planDownload()` fetches into memory, classifies each
 *      destination (`new` / `identical` / `differs` / `unreadable`) and
 *      writes nothing. A failed file download fails that file only.
 *   3. Input validation: non-`.md` filenames, absolute paths, and traversal
 *      attempts are rejected before any HTTP call happens.
 *   4. Guarded install (TASK_2026_701 B8): create-only by default; replace
 *      only against the baseline the plan saw; unreadable is always kept;
 *      equal bytes are `unchanged`.
 *   5. Concurrency (A22): no existence-only cache short-circuit; installs
 *      into different roots never share outcomes; installs into one root
 *      are serialized; only network fetches are deduplicated by URL.
 *
 * Every destination is a fresh `mkdtemp` directory under an isolated tmp
 * home. `https` + `http` are mocked to serve deterministic responses.
 *
 * Source-under-test:
 *   `libs/backend/platform-core/src/agent-pack-download.service.ts`
 */

import 'reflect-metadata';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';

const TEST_HOME = fs.mkdtempSync(
  path.join(nodeOs.tmpdir(), 'ptah-agent-pack-spec-'),
);

afterAll(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock `https` + `http` — same pattern as content-download.service.spec.ts.
// ---------------------------------------------------------------------------

interface MockResponseConfig {
  statusCode: number;
  body?: string;
  location?: string;
  error?: Error;
}

type UrlMatcher = (url: string) => boolean;

interface RouteHandler {
  match: UrlMatcher;
  respond: (url: string) => MockResponseConfig;
}

const mockRoutes: RouteHandler[] = [];
const recordedRequests: string[] = [];

function resetMockHttp(): void {
  mockRoutes.length = 0;
  recordedRequests.length = 0;
}

function addRoute(match: UrlMatcher, respond: RouteHandler['respond']): void {
  mockRoutes.push({ match, respond });
}

function fakeHttpGet(
  url: string,
  callback: (
    res: EventEmitter & {
      statusCode?: number;
      headers?: Record<string, string>;
      setEncoding: (e: string) => void;
      resume: () => void;
    },
  ) => void,
): EventEmitter & {
  setTimeout: (ms: number, cb: () => void) => void;
  destroy: (err?: Error) => void;
} {
  recordedRequests.push(url);

  const req = new EventEmitter() as EventEmitter & {
    setTimeout: (ms: number, cb: () => void) => void;
    destroy: (err?: Error) => void;
  };
  req.setTimeout = () => undefined;
  req.destroy = (err?: Error) => {
    if (err) req.emit('error', err);
  };

  const handler = mockRoutes.find((h) => h.match(url));
  const config: MockResponseConfig = handler
    ? handler.respond(url)
    : { statusCode: 404, body: 'no route' };

  setImmediate(() => {
    if (config.error) {
      req.emit('error', config.error);
      return;
    }

    const res = new EventEmitter() as EventEmitter & {
      statusCode?: number;
      headers?: Record<string, string>;
      setEncoding: (e: string) => void;
      resume: () => void;
    };
    res.statusCode = config.statusCode;
    res.headers = config.location ? { location: config.location } : {};
    res.setEncoding = () => undefined;
    res.resume = () => undefined;

    callback(res);

    setImmediate(() => {
      if (config.body !== undefined) res.emit('data', config.body);
      res.emit('end');
    });
  });

  return req;
}

jest.mock('https', () => ({
  get: jest.fn((url: string, cb: Parameters<typeof fakeHttpGet>[1]) =>
    fakeHttpGet(url, cb),
  ),
}));

jest.mock('http', () => ({
  get: jest.fn((url: string, cb: Parameters<typeof fakeHttpGet>[1]) =>
    fakeHttpGet(url, cb),
  ),
}));

/**
 * Pass-through `fs/promises` whose `readFile` can be paused after it settles,
 * so a test can hold two writers right after their initial destination read
 * (A2 interleaving). With no gate set it behaves exactly like the real one.
 */
const mockReadGate: { hold: ((file: string) => Promise<void>) | null } = {
  hold: null,
};

jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    readFile: async (file: string, encoding: BufferEncoding) => {
      let text: string | undefined;
      let failure: unknown;
      let failed = false;
      try {
        text = await actual.readFile(file, encoding);
      } catch (error: unknown) {
        failure = error;
        failed = true;
      }
      if (mockReadGate.hold) await mockReadGate.hold(String(file));
      if (failed) throw failure;
      return text;
    },
  };
});

import {
  AgentPackDownloadService,
  hashPackContent,
  type AgentPackFilePlan,
  type AgentPackPlanResult,
} from './agent-pack-download.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MANIFEST_URL =
  'https://raw.githubusercontent.com/Hive-Academy/test-pack/main/agent-pack-manifest.json';
const BASE_URL =
  'https://raw.githubusercontent.com/Hive-Academy/test-pack/main';

const REACT = '# React Expert\n';
const CSS = '# CSS Master\n';

function buildPackManifest(
  overrides?: Partial<{ name: string; baseUrl: string }>,
): string {
  return JSON.stringify({
    name: overrides?.name ?? 'Frontend Agents',
    version: '1.0.0',
    description: 'Curated frontend agents',
    contentHash: 'pack-hash-alpha',
    baseUrl: overrides?.baseUrl ?? BASE_URL,
    agents: [
      {
        file: 'react-expert.md',
        name: 'React Expert',
        description: 'React specialist',
        category: 'frontend',
      },
      {
        file: 'css-master.md',
        name: 'CSS Master',
        description: 'Styling specialist',
        category: 'frontend',
      },
    ],
  });
}

function servePack(files: Record<string, string> = {}): void {
  const bodies: Record<string, string> = {
    'react-expert.md': REACT,
    'css-master.md': CSS,
    ...files,
  };
  addRoute(
    (url) => url === MANIFEST_URL,
    () => ({ statusCode: 200, body: buildPackManifest() }),
  );
  addRoute(
    (url) => url.startsWith(`${BASE_URL}/`),
    (url) => {
      const body = bodies[url.slice(BASE_URL.length + 1)];
      return body === undefined
        ? { statusCode: 404, body: 'gone' }
        : { statusCode: 200, body };
    },
  );
}

function makeTargetDir(): string {
  return fs.mkdtempSync(path.join(TEST_HOME, 'target-'));
}

function okPlan(result: AgentPackPlanResult): AgentPackFilePlan[] {
  if (!result.ok) throw new Error(`plan failed: ${result.error}`);
  return result.files;
}

function fetchedRow(
  files: AgentPackFilePlan[],
  file: string,
): Extract<AgentPackFilePlan, { fetched: true }> {
  const row = files.find((f) => f.file === file);
  if (!row || !row.fetched) throw new Error(`${file} was not fetched`);
  return row;
}

/** A directory where a file is expected: reading it fails with EISDIR. */
function makeUnreadable(targetDir: string, file: string): void {
  fs.mkdirSync(path.join(targetDir, file));
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('AgentPackDownloadService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    resetMockHttp();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // fetchPackInfo
  // -------------------------------------------------------------------------

  describe('fetchPackInfo', () => {
    it('returns the structured info when manifest is valid', async () => {
      servePack();

      const svc = new AgentPackDownloadService();
      const info = await svc.fetchPackInfo(MANIFEST_URL);

      expect(info.name).toBe('Frontend Agents');
      expect(info.version).toBe('1.0.0');
      expect(info.agents).toHaveLength(2);
      expect(info.agents[0]?.file).toBe('react-expert.md');
      expect(info.source).toBe(MANIFEST_URL);
    });

    it('returns a zero-agent placeholder + error description when manifest 404s', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 404, body: 'not found' }),
      );

      const svc = new AgentPackDownloadService();
      const info = await svc.fetchPackInfo(MANIFEST_URL);

      expect(info.agents).toEqual([]);
      expect(info.source).toBe(MANIFEST_URL);
      expect(info.description).toMatch(/Failed to load/);
    });

    it('returns a zero-agent placeholder when manifest is missing required fields', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: JSON.stringify({ name: 'partial' }) }),
      );

      const svc = new AgentPackDownloadService();
      const info = await svc.fetchPackInfo(MANIFEST_URL);

      expect(info.agents).toEqual([]);
      expect(info.description).toMatch(/Failed to load/);
    });
  });

  // -------------------------------------------------------------------------
  // planDownload
  // -------------------------------------------------------------------------

  describe('planDownload', () => {
    it('classifies new, identical, differs and unreadable destinations and writes nothing', async () => {
      servePack({ 'a.md': 'A', 'b.md': 'B', 'c.md': 'C', 'd.md': 'D' });
      // Takes precedence over servePack's manifest: lists the four files.
      mockRoutes.unshift({
        match: (url) => url === MANIFEST_URL,
        respond: () => ({
          statusCode: 200,
          body: JSON.stringify({
            name: 'Four',
            version: '1.0.0',
            description: 'four files',
            contentHash: 'h',
            baseUrl: BASE_URL,
            agents: ['a.md', 'b.md', 'c.md', 'd.md'].map((file) => ({
              file,
              name: file,
              description: file,
              category: 'x',
            })),
          }),
        }),
      });
      const targetDir = makeTargetDir();
      fs.writeFileSync(path.join(targetDir, 'b.md'), 'B');
      fs.writeFileSync(path.join(targetDir, 'c.md'), 'local edit');
      makeUnreadable(targetDir, 'd.md');
      const before = fs.readdirSync(targetDir).sort();

      const svc = new AgentPackDownloadService();
      const files = okPlan(
        await svc.planDownload(
          MANIFEST_URL,
          ['a.md', 'b.md', 'c.md', 'd.md'],
          targetDir,
        ),
      );

      expect(files.map((f) => (f.fetched ? f.state : 'failed'))).toEqual([
        'new',
        'identical',
        'differs',
        'unreadable',
      ]);
      const differs = fetchedRow(files, 'c.md');
      expect(differs.content).toBe('C');
      expect(differs.localText).toBe('local edit');
      expect(differs.baselineHash).toBe(hashPackContent('local edit'));
      expect(fetchedRow(files, 'b.md').baselineHash).toBe(hashPackContent('B'));
      expect(fetchedRow(files, 'a.md').baselineHash).toBeUndefined();
      expect(fetchedRow(files, 'd.md').localText).toBeUndefined();
      expect(fs.readdirSync(targetDir).sort()).toEqual(before);
      expect(fs.readFileSync(path.join(targetDir, 'c.md'), 'utf-8')).toBe(
        'local edit',
      );
    });

    it('scopes a single-file plan to that file', async () => {
      servePack();
      const svc = new AgentPackDownloadService();

      const files = okPlan(
        await svc.planDownload(MANIFEST_URL, ['css-master.md'], makeTargetDir()),
      );

      expect(files.map((f) => f.file)).toEqual(['css-master.md']);
      expect(recordedRequests).toEqual([
        MANIFEST_URL,
        `${BASE_URL}/css-master.md`,
      ]);
    });

    it('fails only the file whose download fails', async () => {
      servePack();
      mockRoutes.unshift({
        match: (url) => url.endsWith('/css-master.md'),
        respond: () => ({ statusCode: 500, body: 'boom' }),
      });
      const svc = new AgentPackDownloadService();

      const files = okPlan(
        await svc.planDownload(
          MANIFEST_URL,
          ['react-expert.md', 'css-master.md'],
          makeTargetDir(),
        ),
      );

      expect(fetchedRow(files, 'react-expert.md').state).toBe('new');
      const failed = files.find((f) => f.file === 'css-master.md');
      expect(failed).toEqual(
        expect.objectContaining({ fetched: false, error: expect.stringMatching(/HTTP 500/) }),
      );
    });

    it('surfaces manifest fetch errors without throwing', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 500, body: 'server error' }),
      );
      const svc = new AgentPackDownloadService();

      const result = await svc.planDownload(
        MANIFEST_URL,
        ['react-expert.md'],
        makeTargetDir(),
      );

      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(/Manifest fetch failed/),
      });
    });

    it('rejects files that are not listed in the fetched manifest', async () => {
      servePack();
      const svc = new AgentPackDownloadService();

      const result = await svc.planDownload(
        MANIFEST_URL,
        ['not-in-manifest.md'],
        makeTargetDir(),
      );

      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(/not found in manifest/i),
      });
    });

    it.each<[string[], RegExp]>([
      [[], /No agent files/],
      [['../../evil.md'], /path traversal/i],
      [['/etc/passwd.md'], /path traversal/i],
      [['script.sh'], /only \.md files/i],
      [['bad\x00file.md'], /control characters/i],
    ])(
      'rejects %j before any HTTP call',
      async (agentFiles: string[], message: RegExp) => {
        const svc = new AgentPackDownloadService();

        const result = await svc.planDownload(
          MANIFEST_URL,
          agentFiles,
          makeTargetDir(),
        );

        expect(result).toEqual({
          ok: false,
          error: expect.stringMatching(message),
        });
        expect(recordedRequests).toEqual([]);
      },
    );

    it('shares one network fetch per URL between concurrent plans', async () => {
      servePack();
      const svc = new AgentPackDownloadService();

      await Promise.all([
        svc.planDownload(MANIFEST_URL, ['react-expert.md'], makeTargetDir()),
        svc.planDownload(MANIFEST_URL, ['react-expert.md'], makeTargetDir()),
      ]);

      expect(recordedRequests.filter((u) => u === MANIFEST_URL)).toHaveLength(
        1,
      );
    });
  });

  // -------------------------------------------------------------------------
  // installFiles — guards
  // -------------------------------------------------------------------------

  describe('installFiles', () => {
    const file = 'react-expert.md';

    it('creates a new file under the default create-only guard', async () => {
      const targetDir = path.join(makeTargetDir(), '.claude', 'agents');
      const svc = new AgentPackDownloadService();

      const outcomes = await svc.installFiles(targetDir, [
        { file, content: REACT, guard: { mode: 'create-only' } },
      ]);

      expect(outcomes).toEqual([{ file, outcome: 'written' }]);
      expect(fs.readFileSync(path.join(targetDir, file), 'utf-8')).toBe(REACT);
      expect(fs.readdirSync(targetDir)).toEqual([file]);
    });

    it('reports identical bytes as unchanged without writing', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, file);
      fs.writeFileSync(dest, REACT);
      const mtime = fs.statSync(dest).mtimeMs;
      const svc = new AgentPackDownloadService();

      const outcomes = await svc.installFiles(targetDir, [
        { file, content: REACT, guard: { mode: 'create-only' } },
      ]);

      expect(outcomes).toEqual([{ file, outcome: 'unchanged' }]);
      expect(fs.statSync(dest).mtimeMs).toBe(mtime);
    });

    it('keeps a differing local file under create-only and keep', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, file);
      fs.writeFileSync(dest, 'mine');
      const svc = new AgentPackDownloadService();

      const outcomes = await svc.installFiles(targetDir, [
        { file, content: REACT, guard: { mode: 'create-only' } },
        { file, content: REACT, guard: { mode: 'keep' } },
      ]);

      expect(outcomes.map((o) => o.outcome)).toEqual(['kept', 'kept']);
      expect(fs.readFileSync(dest, 'utf-8')).toBe('mine');
    });

    it('never replaces an unreadable destination, even under a replace guard (D13 forced keep)', async () => {
      const targetDir = makeTargetDir();
      makeUnreadable(targetDir, file);
      const svc = new AgentPackDownloadService();

      const outcomes = await svc.installFiles(targetDir, [
        {
          file,
          content: REACT,
          guard: { mode: 'replace', baselineHash: hashPackContent('x') },
        },
      ]);

      expect(outcomes).toEqual([{ file, outcome: 'kept' }]);
      expect(fs.statSync(path.join(targetDir, file)).isDirectory()).toBe(true);
    });

    it('replaces only when the destination still matches the planned baseline', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, file);
      fs.writeFileSync(dest, 'A');
      const svc = new AgentPackDownloadService();

      const replaced = await svc.installFiles(targetDir, [
        {
          file,
          content: REACT,
          guard: { mode: 'replace', baselineHash: hashPackContent('A') },
        },
      ]);
      expect(replaced).toEqual([{ file, outcome: 'written' }]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(REACT);

      fs.writeFileSync(dest, 'B');
      const stale = await svc.installFiles(targetDir, [
        {
          file,
          content: CSS,
          guard: { mode: 'replace', baselineHash: hashPackContent('A') },
        },
      ]);
      expect(stale).toEqual([{ file, outcome: 'changed-since-preview' }]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe('B');
    });

    it('writes a replace whose destination was deleted since the plan', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();

      const outcomes = await svc.installFiles(targetDir, [
        {
          file,
          content: REACT,
          guard: { mode: 'replace', baselineHash: hashPackContent('A') },
        },
      ]);

      expect(outcomes).toEqual([{ file, outcome: 'written' }]);
    });

    it('fails an item whose name is not a plain .md file', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();

      const outcomes = await svc.installFiles(targetDir, [
        { file: '../escape.md', content: 'x', guard: { mode: 'create-only' } },
      ]);

      expect(outcomes).toEqual([
        expect.objectContaining({ file: '../escape.md', outcome: 'failed' }),
      ]);
      expect(fs.existsSync(path.join(TEST_HOME, 'escape.md'))).toBe(false);
    });

    // POSIX reports ENOTDIR on the read (kept); Windows reports ENOENT, so the
    // write is attempted and fails. Either way nothing is written.
    it('never writes through a target directory that is a file, and still installs elsewhere', async () => {
      const root = makeTargetDir();
      // The target "directory" is a file, so reading under it fails.
      const blocked = path.join(root, 'blocked');
      fs.writeFileSync(blocked, 'not a directory');
      const svc = new AgentPackDownloadService();

      const [blockedOutcome, okOutcome] = await Promise.all([
        svc.installFiles(blocked, [
          { file, content: REACT, guard: { mode: 'create-only' } },
        ]),
        svc.installFiles(root, [
          { file: 'css-master.md', content: CSS, guard: { mode: 'create-only' } },
        ]),
      ]);

      expect(blockedOutcome).toHaveLength(1);
      expect(['kept', 'failed']).toContain(blockedOutcome[0]?.outcome);
      expect(okOutcome).toEqual([{ file: 'css-master.md', outcome: 'written' }]);
      expect(fs.readFileSync(blocked, 'utf-8')).toBe('not a directory');
    });
  });

  // -------------------------------------------------------------------------
  // Cache and concurrency (A22)
  // -------------------------------------------------------------------------

  describe('re-install and concurrency', () => {
    it('re-plans a cached pack against a hand-edited file: Keep leaves it byte-identical, Replace with the planned baseline writes it', async () => {
      servePack();
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, 'react-expert.md');
      const svc = new AgentPackDownloadService();

      const first = okPlan(
        await svc.planDownload(MANIFEST_URL, ['react-expert.md'], targetDir),
      );
      await svc.installFiles(targetDir, [
        {
          file: 'react-expert.md',
          content: fetchedRow(first, 'react-expert.md').content,
          guard: { mode: 'create-only' },
        },
      ]);
      fs.writeFileSync(dest, 'hand edited');

      const second = fetchedRow(
        okPlan(
          await svc.planDownload(MANIFEST_URL, ['react-expert.md'], targetDir),
        ),
        'react-expert.md',
      );
      expect(second.state).toBe('differs');

      const kept = await svc.installFiles(targetDir, [
        {
          file: 'react-expert.md',
          content: second.content,
          guard: { mode: 'keep' },
        },
      ]);
      expect(kept).toEqual([{ file: 'react-expert.md', outcome: 'kept' }]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe('hand edited');

      const replaced = await svc.installFiles(targetDir, [
        {
          file: 'react-expert.md',
          content: second.content,
          guard: {
            mode: 'replace',
            baselineHash: second.baselineHash ?? '',
          },
        },
      ]);
      expect(replaced).toEqual([
        { file: 'react-expert.md', outcome: 'written' },
      ]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(REACT);
    });

    it('gives concurrent installs into different roots their own outcomes', async () => {
      const rootA = makeTargetDir();
      const rootB = makeTargetDir();
      fs.writeFileSync(path.join(rootA, 'react-expert.md'), 'edit A');
      fs.writeFileSync(path.join(rootB, 'react-expert.md'), 'edit B');
      const svc = new AgentPackDownloadService();

      const [a, b] = await Promise.all([
        svc.installFiles(rootA, [
          {
            file: 'react-expert.md',
            content: REACT,
            guard: { mode: 'keep' },
          },
        ]),
        svc.installFiles(rootB, [
          {
            file: 'react-expert.md',
            content: REACT,
            guard: {
              mode: 'replace',
              baselineHash: hashPackContent('edit B'),
            },
          },
        ]),
      ]);

      expect(a).toEqual([{ file: 'react-expert.md', outcome: 'kept' }]);
      expect(b).toEqual([{ file: 'react-expert.md', outcome: 'written' }]);
      expect(
        fs.readFileSync(path.join(rootA, 'react-expert.md'), 'utf-8'),
      ).toBe('edit A');
      expect(
        fs.readFileSync(path.join(rootB, 'react-expert.md'), 'utf-8'),
      ).toBe(REACT);
    });

    it('serializes concurrent installs into one root so each sees the previous write', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, 'react-expert.md');
      fs.writeFileSync(dest, 'A');
      const svc = new AgentPackDownloadService();
      const guard = {
        mode: 'replace' as const,
        baselineHash: hashPackContent('A'),
      };

      const [first, second] = await Promise.all([
        svc.installFiles(targetDir, [
          { file: 'react-expert.md', content: REACT, guard },
        ]),
        // Same directory spelled differently: still one queue.
        svc.installFiles(path.join(targetDir, '.', ''), [
          { file: 'react-expert.md', content: CSS, guard },
        ]),
      ]);

      expect(first).toEqual([{ file: 'react-expert.md', outcome: 'written' }]);
      expect(second).toEqual([
        { file: 'react-expert.md', outcome: 'changed-since-preview' },
      ]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(REACT);
      expect(fs.readdirSync(targetDir)).toEqual(['react-expert.md']);
    });
  });

  // -------------------------------------------------------------------------
  // A2: writers outside this service's queue
  // -------------------------------------------------------------------------

  describe('no-clobber against writers outside the queue (A2)', () => {
    afterEach(() => {
      mockReadGate.hold = null;
    });

    /**
     * Hold every read of `dest` until the test releases it; resolves once
     * `count` reads are held.
     */
    function holdReads(
      dest: string,
      count: number,
    ): { allHeld: Promise<void>; release: Array<() => void> } {
      const release: Array<() => void> = [];
      let signal: () => void = () => undefined;
      const allHeld = new Promise<void>((resolve) => {
        signal = resolve;
      });
      mockReadGate.hold = (file) => {
        if (file !== dest || release.length >= count) return Promise.resolve();
        return new Promise<void>((resume) => {
          release.push(resume);
          if (release.length === count) signal();
        });
      };
      return { allHeld, release };
    }

    it('two create-only installers paused after their read: the second keeps the first', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, 'react-expert.md');
      // Two instances: separate queues, like the wizard writer or another
      // process racing this one.
      const a = new AgentPackDownloadService();
      const b = new AgentPackDownloadService();
      const gate = holdReads(dest, 2);

      const first = a.installFiles(targetDir, [
        { file: 'react-expert.md', content: REACT, guard: { mode: 'create-only' } },
      ]);
      const second = b.installFiles(targetDir, [
        { file: 'react-expert.md', content: CSS, guard: { mode: 'create-only' } },
      ]);
      await gate.allHeld;

      gate.release[0]?.();
      expect(await first).toEqual([
        { file: 'react-expert.md', outcome: 'written' },
      ]);
      gate.release[1]?.();
      expect(await second).toEqual([
        { file: 'react-expert.md', outcome: 'kept' },
      ]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(REACT);
      expect(fs.readdirSync(targetDir)).toEqual(['react-expert.md']);
    });

    it('a replace of a file deleted since the plan does not clobber a concurrent create', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, 'react-expert.md');
      const a = new AgentPackDownloadService();
      const b = new AgentPackDownloadService();
      const gate = holdReads(dest, 2);

      const creator = a.installFiles(targetDir, [
        { file: 'react-expert.md', content: REACT, guard: { mode: 'create-only' } },
      ]);
      const replacer = b.installFiles(targetDir, [
        {
          file: 'react-expert.md',
          content: CSS,
          guard: { mode: 'replace', baselineHash: hashPackContent('old') },
        },
      ]);
      await gate.allHeld;

      gate.release[0]?.();
      await creator;
      gate.release[1]?.();
      expect(await replacer).toEqual([
        { file: 'react-expert.md', outcome: 'changed-since-preview' },
      ]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(REACT);
      expect(fs.readdirSync(targetDir)).toEqual(['react-expert.md']);
    });

    it('a replace re-checks the baseline right before its rename', async () => {
      const targetDir = makeTargetDir();
      const dest = path.join(targetDir, 'react-expert.md');
      fs.writeFileSync(dest, 'old');
      const svc = new AgentPackDownloadService();
      const gate = holdReads(dest, 1);

      const install = svc.installFiles(targetDir, [
        {
          file: 'react-expert.md',
          content: REACT,
          guard: { mode: 'replace', baselineHash: hashPackContent('old') },
        },
      ]);
      await gate.allHeld;
      // An editor saves after the initial (matching) read.
      fs.writeFileSync(dest, 'edited');
      gate.release[0]?.();

      expect(await install).toEqual([
        { file: 'react-expert.md', outcome: 'changed-since-preview' },
      ]);
      expect(fs.readFileSync(dest, 'utf-8')).toBe('edited');
      expect(fs.readdirSync(targetDir)).toEqual(['react-expert.md']);
    });
  });
});
