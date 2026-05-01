/**
 * `AgentPackDownloadService` — unit specs.
 *
 * The service pulls curated agent packs (a manifest listing `.md` agent
 * files) from GitHub into a caller-supplied target directory. Critical
 * invariants under test:
 *
 *   1. Pack manifest: `fetchPackInfo()` returns the structured info when
 *      the manifest is valid, and degrades gracefully (empty `agents` +
 *      error description) when it is not.
 *   2. Download targeting: `downloadAgents(manifestUrl, files, targetDir)`
 *      unpacks each `.md` file into `targetDir`, never outside it.
 *   3. Input validation: non-`.md` filenames, absolute paths, and traversal
 *      attempts are rejected before any HTTP call happens.
 *   4. Cache hit: when the manifest's `contentHash` matches the stored
 *      cache entry AND every requested file is present on disk, the
 *      service returns `fromCache: true` without re-downloading.
 *   5. Offline / failure: every failure mode (manifest fetch, file fetch,
 *      invalid manifest) surfaces as a `success: false` result — the
 *      public API never throws.
 *
 * HOME is redirected to an isolated tmp dir BEFORE importing the impl so
 * the constructor picks up the sandboxed `~/.ptah/` path for the cache
 * metadata file. `https` + `http` are mocked to serve deterministic
 * responses.
 *
 * Source-under-test:
 *   `libs/backend/platform-core/src/agent-pack-download.service.ts`
 */

import 'reflect-metadata';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Sandbox `homedir()` to an isolated tmp dir BEFORE the impl is imported.
// The service captures `homedir()` in its constructor, so we mock the `os`
// module directly (env var sandboxing is insufficient on some Windows Node
// builds where `os.homedir()` returns the native profile dir).
// ---------------------------------------------------------------------------

const mockTestHome = fs.mkdtempSync(
  path.join(nodeOs.tmpdir(), 'ptah-agent-pack-spec-'),
);
const TEST_HOME = mockTestHome;
const prevHome = process.env['HOME'];
const prevUserProfile = process.env['USERPROFILE'];
process.env['HOME'] = mockTestHome;
process.env['USERPROFILE'] = mockTestHome;

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => mockTestHome,
  };
});

afterAll(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevUserProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevUserProfile;
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
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

import { expectNormalizedPath } from '@ptah-extension/shared/testing';
import { AgentPackDownloadService } from './agent-pack-download.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MANIFEST_URL =
  'https://raw.githubusercontent.com/Hive-Academy/test-pack/main/agent-pack-manifest.json';
const BASE_URL =
  'https://raw.githubusercontent.com/Hive-Academy/test-pack/main';

const PTAH_DIR = path.join(TEST_HOME, '.ptah');
const PACK_CACHE_PATH = path.join(PTAH_DIR, '.agent-pack-cache.json');

function buildPackManifest(
  overrides?: Partial<{
    name: string;
    version: string;
    contentHash: string;
    baseUrl: string;
    agents: Array<{
      file: string;
      name: string;
      description: string;
      category: string;
    }>;
  }>,
): string {
  return JSON.stringify({
    name: overrides?.name ?? 'Frontend Agents',
    version: overrides?.version ?? '1.0.0',
    description: 'Curated frontend agents',
    contentHash: overrides?.contentHash ?? 'pack-hash-alpha',
    baseUrl: overrides?.baseUrl ?? BASE_URL,
    agents: overrides?.agents ?? [
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

function makeTargetDir(): string {
  return fs.mkdtempSync(path.join(TEST_HOME, 'target-'));
}

function cleanPtah(): void {
  if (fs.existsSync(PTAH_DIR)) {
    fs.rmSync(PTAH_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('AgentPackDownloadService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    cleanPtah();
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
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );

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
  // downloadAgents — happy path (unpack into target dir)
  // -------------------------------------------------------------------------

  describe('downloadAgents — happy path', () => {
    it('downloads each requested agent file into the target directory', async () => {
      const targetDir = makeTargetDir();

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );
      addRoute(
        (url) => url.endsWith('/react-expert.md'),
        () => ({ statusCode: 200, body: '# React Expert' }),
      );
      addRoute(
        (url) => url.endsWith('/css-master.md'),
        () => ({ statusCode: 200, body: '# CSS Master' }),
      );

      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['react-expert.md', 'css-master.md'],
        targetDir,
      );

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.agentsDownloaded).toBe(2);

      const reactPath = path.join(targetDir, 'react-expert.md');
      const cssPath = path.join(targetDir, 'css-master.md');
      expect(fs.existsSync(reactPath)).toBe(true);
      expect(fs.existsSync(cssPath)).toBe(true);
      expect(fs.readFileSync(reactPath, 'utf-8')).toBe('# React Expert');
      expect(fs.readFileSync(cssPath, 'utf-8')).toBe('# CSS Master');

      // Target dir resolution is cross-platform normalized.
      expectNormalizedPath(reactPath, path.join(targetDir, 'react-expert.md'));
    });

    it('invokes the progress callback with (completed, total) tuples', async () => {
      const targetDir = makeTargetDir();

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildPackManifest({
            agents: [
              {
                file: 'a.md',
                name: 'A',
                description: 'a',
                category: 'x',
              },
            ],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/a.md'),
        () => ({ statusCode: 200, body: '# A' }),
      );

      const progress: Array<[number, number]> = [];
      const svc = new AgentPackDownloadService();
      await svc.downloadAgents(MANIFEST_URL, ['a.md'], targetDir, (d, t) =>
        progress.push([d, t]),
      );

      // At least the terminal (1, 1) tuple must be reported.
      expect(progress[progress.length - 1]).toEqual([1, 1]);
    });

    it('persists agent pack cache metadata under ~/.ptah/.agent-pack-cache.json', async () => {
      const targetDir = makeTargetDir();
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );
      addRoute(
        () => true,
        () => ({ statusCode: 200, body: '# content' }),
      );

      const svc = new AgentPackDownloadService();
      await svc.downloadAgents(
        MANIFEST_URL,
        ['react-expert.md', 'css-master.md'],
        targetDir,
      );

      expect(fs.existsSync(PACK_CACHE_PATH)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(PACK_CACHE_PATH, 'utf-8')) as {
        packs: Record<string, { contentHash: string; agentCount: number }>;
      };
      expect(meta.packs[MANIFEST_URL]?.contentHash).toBe('pack-hash-alpha');
      expect(meta.packs[MANIFEST_URL]?.agentCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // downloadAgents — cache hit
  // -------------------------------------------------------------------------

  describe('downloadAgents — cache hit', () => {
    it('returns fromCache=true when hash matches AND every requested file exists on disk', async () => {
      const targetDir = makeTargetDir();

      // Pre-populate the target dir with the files we are about to request.
      fs.writeFileSync(
        path.join(targetDir, 'react-expert.md'),
        '# cached react',
      );
      fs.writeFileSync(path.join(targetDir, 'css-master.md'), '# cached css');

      // Pre-populate the cache metadata so the service thinks it's current.
      fs.mkdirSync(PTAH_DIR, { recursive: true });
      fs.writeFileSync(
        PACK_CACHE_PATH,
        JSON.stringify({
          packs: {
            [MANIFEST_URL]: {
              contentHash: 'pack-hash-alpha',
              downloadedAt: '2026-04-20T00:00:00Z',
              version: '1.0.0',
              agentCount: 2,
            },
          },
        }),
      );

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );

      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['react-expert.md', 'css-master.md'],
        targetDir,
      );

      expect(result.fromCache).toBe(true);
      expect(result.agentsDownloaded).toBe(2);
      // Only the manifest was requested — no agent .md bytes fetched.
      expect(recordedRequests).toEqual([MANIFEST_URL]);
    });

    it('forces re-download when a cached file is missing on disk', async () => {
      const targetDir = makeTargetDir();

      // Cache metadata says we have 2 agents, but the files do not exist.
      fs.mkdirSync(PTAH_DIR, { recursive: true });
      fs.writeFileSync(
        PACK_CACHE_PATH,
        JSON.stringify({
          packs: {
            [MANIFEST_URL]: {
              contentHash: 'pack-hash-alpha',
              downloadedAt: '2026-04-20T00:00:00Z',
              version: '1.0.0',
              agentCount: 2,
            },
          },
        }),
      );

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );
      addRoute(
        (url) => url.endsWith('.md'),
        () => ({ statusCode: 200, body: '# re-downloaded' }),
      );

      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['react-expert.md', 'css-master.md'],
        targetDir,
      );

      expect(result.fromCache).toBe(false);
      expect(result.agentsDownloaded).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Validation (rejects before any HTTP call)
  // -------------------------------------------------------------------------

  describe('downloadAgents — input validation', () => {
    it('rejects an empty agent file list', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(MANIFEST_URL, [], targetDir);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No agent files/);
      expect(recordedRequests).toEqual([]);
    });

    it('rejects path traversal in file names', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['../../evil.md'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/path traversal/i);
      expect(recordedRequests).toEqual([]);
    });

    it('rejects absolute paths', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['/etc/passwd'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/path traversal/i);
    });

    it('rejects non-.md file types', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['script.sh'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/only \.md files/i);
    });

    it('rejects files with control characters', async () => {
      const targetDir = makeTargetDir();
      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['bad\x00file.md'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/control characters/i);
    });

    it('rejects files that are not listed in the fetched manifest', async () => {
      const targetDir = makeTargetDir();

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );

      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['not-in-manifest.md'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found in manifest/i);
    });
  });

  // -------------------------------------------------------------------------
  // Failure modes (never throws)
  // -------------------------------------------------------------------------

  describe('downloadAgents — failure modes', () => {
    it('surfaces manifest fetch errors without throwing', async () => {
      const targetDir = makeTargetDir();
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 500, body: 'server error' }),
      );

      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['react-expert.md'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Manifest fetch failed/);
    });

    it('counts partial file download failures', async () => {
      const targetDir = makeTargetDir();

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );
      addRoute(
        (url) => url.endsWith('/react-expert.md'),
        () => ({ statusCode: 200, body: '# ok' }),
      );
      addRoute(
        (url) => url.endsWith('/css-master.md'),
        () => ({ statusCode: 404, body: 'gone' }),
      );

      const svc = new AgentPackDownloadService();
      const result = await svc.downloadAgents(
        MANIFEST_URL,
        ['react-expert.md', 'css-master.md'],
        targetDir,
      );

      expect(result.success).toBe(false);
      expect(result.agentsDownloaded).toBe(1);
      expect(result.error).toMatch(/1 file\(s\) failed to download/);
    });

    it('dedupes concurrent calls with the same (manifestUrl, files) tuple', async () => {
      const targetDir = makeTargetDir();

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildPackManifest() }),
      );
      addRoute(
        (url) => url.endsWith('.md'),
        () => ({ statusCode: 200, body: '# content' }),
      );

      const svc = new AgentPackDownloadService();
      const [first, second] = await Promise.all([
        svc.downloadAgents(
          MANIFEST_URL,
          ['react-expert.md', 'css-master.md'],
          targetDir,
        ),
        svc.downloadAgents(
          MANIFEST_URL,
          ['react-expert.md', 'css-master.md'],
          targetDir,
        ),
      ]);

      expect(first).toEqual(second);
      const manifestHits = recordedRequests.filter((u) => u === MANIFEST_URL);
      expect(manifestHits.length).toBe(1);
    });
  });
});
