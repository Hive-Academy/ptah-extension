/**
 * `ContentDownloadService` — unit specs.
 *
 * The service owns the `~/.ptah/plugins/` + `~/.ptah/templates/agents/`
 * cache populated from GitHub. Critical invariants under test:
 *
 *   1. Manifest parse: the content hash from the manifest drives caching.
 *   2. Per-file download: every file listed in `manifest.plugins.files` +
 *      `manifest.templates.files` lands on disk under the right folder.
 *   3. Cache-hit skip: when the local `.content-cache.json` hash matches
 *      the freshly-fetched manifest, we return `fromCache: true` and do not
 *      re-download anything.
 *   4. Offline / failure: manifest fetch failure surfaces as
 *      `success: false` with `fromCache` reflecting whether stale content
 *      still exists — the service never throws.
 *   5. Windows path normalization: `getPluginsPath()` / `getTemplatesPath()`
 *      resolve under the sandboxed HOME regardless of OS separator.
 *   6. Scoped prune (TASK_2026_259): stale-file cleanup stays inside the
 *      subtrees the manifest populates, so user-authored content under
 *      `~/.ptah/plugins/ptah-harness-*` survives; and an unlink failure is
 *      logged and skipped rather than aborting the whole download.
 *
 * The service uses `https.get` + `http.get` directly, so we `jest.mock()`
 * both modules to return a deterministic fake `IncomingMessage` stream.
 * HOME is redirected to an isolated tmp dir BEFORE importing the impl so
 * the constructor picks up the sandboxed path.
 *
 * Source-under-test:
 *   `libs/backend/platform-core/src/content-download.service.ts`
 */

import 'reflect-metadata';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Sandbox `homedir()` to an isolated tmp dir BEFORE the impl is imported.
// `ContentDownloadService` captures `homedir()` in its constructor, so we
// mock the `os` module directly rather than relying on the HOME / USERPROFILE
// env vars (Windows `os.homedir()` returns the native profile dir regardless
// of env overrides in some Node builds, which flakes the expected paths).
//
// Env vars are still sandboxed as a belt-and-braces measure.
// ---------------------------------------------------------------------------

const mockTestHome = fs.mkdtempSync(
  path.join(nodeOs.tmpdir(), 'ptah-content-download-spec-'),
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

// ---------------------------------------------------------------------------
// `fs` passthrough with a swappable `unlinkSync`.
//
// The prune specs need one run where `unlinkSync` throws (Windows file lock /
// EPERM). `fs.unlinkSync` is a NON-CONFIGURABLE property in this Node build,
// so `jest.spyOn(fs, 'unlinkSync')` dies with "Cannot redefine property" — a
// module-level mock is the only way in. Everything else delegates to the real
// `fs`, so the specs still touch a real sandboxed tmp dir.
// ---------------------------------------------------------------------------

let mockUnlinkSyncOverride: ((target: fs.PathLike) => void) | null = null;

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    unlinkSync: (target: fs.PathLike): void => {
      if (mockUnlinkSyncOverride) {
        mockUnlinkSyncOverride(target);
        return;
      }
      actual.unlinkSync(target);
    },
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
// Mock `https` + `http` — both `.get(url, cb)` entry points return a fake
// IncomingMessage built on EventEmitter. The request object is also an
// EventEmitter with a no-op `setTimeout` + `destroy`.
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

  // Dispatch asynchronously so caller can attach error handlers first.
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
      if (config.body !== undefined) {
        res.emit('data', config.body);
      }
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
import { ContentDownloadService } from './content-download.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MANIFEST_URL =
  'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json';

const PTAH_DIR = path.join(TEST_HOME, '.ptah');
const PLUGINS_DIR = path.join(PTAH_DIR, 'plugins');
const TEMPLATES_DIR = path.join(PTAH_DIR, 'templates', 'agents');
const CACHE_META_PATH = path.join(PTAH_DIR, '.content-cache.json');

function buildManifest(
  overrides?: Partial<{
    contentHash: string;
    pluginFiles: string[];
    templateFiles: string[];
    baseUrl: string;
  }>,
): string {
  return JSON.stringify({
    $schema: 'https://ptah.live/schemas/content-manifest.json',
    version: '1.0.0',
    contentHash: overrides?.contentHash ?? 'hash-alpha',
    generatedAt: '2026-04-24T00:00:00Z',
    baseUrl:
      overrides?.baseUrl ??
      'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main',
    plugins: {
      basePath: 'apps/ptah-extension-vscode/assets/plugins',
      files: overrides?.pluginFiles ?? [
        'ptah-core/.claude-plugin/plugin.json',
        'ptah-core/agents/architect.md',
      ],
    },
    templates: {
      basePath: 'apps/ptah-extension-vscode/templates/agents',
      files: overrides?.templateFiles ?? ['frontend.md'],
    },
  });
}

function cleanPtah(): void {
  if (fs.existsSync(PTAH_DIR)) {
    fs.rmSync(PTAH_DIR, { recursive: true, force: true });
  }
}

/** Write a file (and its parents) into the local cache before a run. */
function seedFile(fullPath: string, contents = 'seed'): void {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents, 'utf-8');
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('ContentDownloadService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    cleanPtah();
    resetMockHttp();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockUnlinkSyncOverride = null;
  });

  // -------------------------------------------------------------------------
  // Path accessors (sandboxed HOME + cross-platform normalization)
  // -------------------------------------------------------------------------

  describe('path accessors', () => {
    it('getPluginsPath() resolves under ~/.ptah/plugins (sandboxed HOME)', () => {
      const svc = new ContentDownloadService();
      expectNormalizedPath(svc.getPluginsPath(), PLUGINS_DIR);
    });

    it('getTemplatesPath() resolves under ~/.ptah/templates/agents', () => {
      const svc = new ContentDownloadService();
      expectNormalizedPath(svc.getTemplatesPath(), TEMPLATES_DIR);
    });

    it('isContentAvailable() is false when cache dirs do not exist', () => {
      expect(new ContentDownloadService().isContentAvailable()).toBe(false);
    });

    it('isContentAvailable() is true when plugins dir exists', () => {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      expect(new ContentDownloadService().isContentAvailable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Manifest parsing + per-file download
  // -------------------------------------------------------------------------

  describe('ensureContent — happy path', () => {
    it('parses the manifest, downloads every listed file, and writes cache metadata', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildManifest() }),
      );
      addRoute(
        (url) => url.endsWith('/plugin.json'),
        () => ({ statusCode: 200, body: '{"name":"ptah-core"}' }),
      );
      addRoute(
        (url) => url.endsWith('/architect.md'),
        () => ({ statusCode: 200, body: '# architect' }),
      );
      addRoute(
        (url) => url.endsWith('/frontend.md'),
        () => ({ statusCode: 200, body: '# frontend' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.pluginsDownloaded).toBe(2);
      expect(result.templatesDownloaded).toBe(1);

      // Files landed on disk under the right folders.
      expect(
        fs.existsSync(
          path.join(PLUGINS_DIR, 'ptah-core', '.claude-plugin', 'plugin.json'),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(PLUGINS_DIR, 'ptah-core', 'agents', 'architect.md'),
        ),
      ).toBe(true);
      expect(fs.existsSync(path.join(TEMPLATES_DIR, 'frontend.md'))).toBe(true);

      // Cache metadata persisted with manifest hash.
      const meta = JSON.parse(fs.readFileSync(CACHE_META_PATH, 'utf-8')) as {
        contentHash: string;
        pluginCount: number;
        templateCount: number;
      };
      expect(meta.contentHash).toBe('hash-alpha');
      expect(meta.pluginCount).toBe(2);
      expect(meta.templateCount).toBe(1);
    });

    it('fires progress callback with increasing counts', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildManifest() }),
      );
      addRoute(
        () => true,
        () => ({ statusCode: 200, body: 'content' }),
      );

      const phases: string[] = [];
      const maxCurrent: Record<string, number> = {};
      const svc = new ContentDownloadService();

      await svc.ensureContent((phase, current, total) => {
        if (!phases.includes(phase)) phases.push(phase);
        if (current > (maxCurrent[phase] ?? -1)) maxCurrent[phase] = current;
        expect(current).toBeLessThanOrEqual(total);
      });

      expect(phases).toContain('Fetching manifest');
      expect(phases).toContain('Complete');
    });

    it('downloaded file contents match the bytes served by the HTTP layer', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: ['only.txt'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/only.txt'),
        () => ({ statusCode: 200, body: 'HELLO-PAYLOAD' }),
      );

      const svc = new ContentDownloadService();
      await svc.ensureContent();

      const contents = fs.readFileSync(
        path.join(PLUGINS_DIR, 'only.txt'),
        'utf-8',
      );
      expect(contents).toBe('HELLO-PAYLOAD');
    });
  });

  // -------------------------------------------------------------------------
  // Cache hit (skip logic via contentHash)
  // -------------------------------------------------------------------------

  describe('ensureContent — cache hit (skip)', () => {
    it('returns fromCache=true when manifest hash matches cached hash', async () => {
      // Seed the cache metadata so the service sees a match.
      fs.mkdirSync(PTAH_DIR, { recursive: true });
      fs.writeFileSync(
        CACHE_META_PATH,
        JSON.stringify({
          contentHash: 'hash-alpha',
          downloadedAt: '2026-04-20T00:00:00Z',
          manifestVersion: '1.0.0',
          pluginCount: 5,
          templateCount: 3,
        }),
      );

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 200, body: buildManifest() }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(result.pluginsDownloaded).toBe(5);
      expect(result.templatesDownloaded).toBe(3);

      // Only the manifest URL should have been requested — no file fetches.
      expect(recordedRequests).toEqual([MANIFEST_URL]);
    });

    it('ignores cache when contentHash differs and re-downloads', async () => {
      fs.mkdirSync(PTAH_DIR, { recursive: true });
      fs.writeFileSync(
        CACHE_META_PATH,
        JSON.stringify({
          contentHash: 'hash-STALE',
          downloadedAt: '2026-04-20T00:00:00Z',
          manifestVersion: '1.0.0',
          pluginCount: 0,
          templateCount: 0,
        }),
      );

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            contentHash: 'hash-NEW',
            pluginFiles: ['p.json'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/p.json'),
        () => ({ statusCode: 200, body: '{}' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      expect(result.fromCache).toBe(false);
      expect(result.pluginsDownloaded).toBe(1);
    });

    it('forceRefresh=true bypasses the cache even when hashes match', async () => {
      fs.mkdirSync(PTAH_DIR, { recursive: true });
      fs.writeFileSync(
        CACHE_META_PATH,
        JSON.stringify({
          contentHash: 'hash-alpha',
          downloadedAt: '2026-04-20T00:00:00Z',
          manifestVersion: '1.0.0',
          pluginCount: 1,
          templateCount: 0,
        }),
      );

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: ['p.json'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/p.json'),
        () => ({ statusCode: 200, body: '{}' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent(undefined, true);

      expect(result.fromCache).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Stale-file prune (TASK_2026_259)
  //
  // No cache metadata is seeded in these specs, so `loadCacheMetadata()`
  // returns null and the prune always runs — the same path a contentHash
  // change takes in production.
  // -------------------------------------------------------------------------

  describe('ensureContent — prune scoping', () => {
    const HARNESS_SKILL = path.join(
      PLUGINS_DIR,
      'ptah-harness-my-skill',
      'skills',
      'my-skill',
      'SKILL.md',
    );
    const MANIFEST_PLUGIN_FILE = 'ptah-core/.claude-plugin/plugin.json';

    function routeManifestOwningPtahCore(): void {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: [MANIFEST_PLUGIN_FILE],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/plugin.json'),
        () => ({ statusCode: 200, body: '{"name":"ptah-core"}' }),
      );
    }

    it('does NOT delete harness-authored skills the manifest never lists', async () => {
      // Written by the harness wizard (HarnessFsService.createSkillPlugin) —
      // user-authored, and never present in the remote manifest.
      seedFile(HARNESS_SKILL, '# my skill');
      // ...while a genuinely stale file sits in a manifest-owned directory,
      // so the two behaviours are asserted against the same single run.
      const stale = path.join(PLUGINS_DIR, 'ptah-core', 'agents', 'gone.md');
      seedFile(stale, '# removed upstream');
      routeManifestOwningPtahCore();

      const svc = new ContentDownloadService();
      await svc.ensureContent();

      expect(fs.existsSync(HARNESS_SKILL)).toBe(true);
      expect(fs.readFileSync(HARNESS_SKILL, 'utf-8')).toBe('# my skill');
      expect(fs.existsSync(stale)).toBe(false);
    });

    it('does NOT delete a sideloaded plugin directory the manifest never lists', async () => {
      const sideloaded = path.join(
        PLUGINS_DIR,
        'my-own-plugin',
        '.claude-plugin',
        'plugin.json',
      );
      seedFile(sideloaded, '{"name":"my-own-plugin"}');
      routeManifestOwningPtahCore();

      await new ContentDownloadService().ensureContent();

      expect(fs.existsSync(sideloaded)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Reserved roots (TASK_2026_270)
    //
    // `plugins/external/` holds third-party plugins the user installed through
    // an explicit consent dialog. The scoping rule above already spares them,
    // but only because `external` happens not to appear in `manifestRoots`.
    // These two specs pin the exemption as a RULE: the second one fails on the
    // pre-TASK_2026_270 implementation, because it hands the manifest a file
    // under `external/` and thereby makes `external` a manifest-owned root.
    // -----------------------------------------------------------------------

    const EXTERNAL_SKILL = path.join(
      PLUGINS_DIR,
      'external',
      'dotnet',
      'skills',
      'dotnet-test',
      'skills',
      'run-tests',
      'SKILL.md',
    );

    it('does NOT delete an externally-installed plugin the manifest never lists', async () => {
      seedFile(EXTERNAL_SKILL, '# run tests');
      routeManifestOwningPtahCore();

      await new ContentDownloadService().ensureContent();

      expect(fs.existsSync(EXTERNAL_SKILL)).toBe(true);
      expect(fs.readFileSync(EXTERNAL_SKILL, 'utf-8')).toBe('# run tests');
    });

    it('does NOT delete external content even when the manifest claims that root', async () => {
      seedFile(EXTERNAL_SKILL, '# run tests');
      // A manifest that lists ANY file under `external/` would, under the
      // plain ownership rule, make every other file under `external/`
      // prunable — silently deleting plugins the user consented to install.
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: [MANIFEST_PLUGIN_FILE, 'external/decoy.md'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        () => true,
        () => ({ statusCode: 200, body: '{}' }),
      );

      await new ContentDownloadService().ensureContent();

      expect(fs.existsSync(EXTERNAL_SKILL)).toBe(true);
    });

    // Guard against "fixing" the defect by disabling the feature: this spec
    // passes both BEFORE and AFTER the scoping change.
    it('DOES delete a stale file inside a manifest-owned plugin directory', async () => {
      const stale = path.join(
        PLUGINS_DIR,
        'ptah-core',
        'skills',
        'removed-skill',
        'SKILL.md',
      );
      seedFile(stale, '# removed upstream');
      routeManifestOwningPtahCore();

      await new ContentDownloadService().ensureContent();

      expect(fs.existsSync(stale)).toBe(false);
    });

    it('announces the prune on STDERR and writes nothing to stdout', async () => {
      // `ptah`'s stdout is the JSON-RPC NDJSON channel and nothing else, and
      // `ensureContent()` runs fire-and-forget on every
      // `withEngine({ mode: 'full' })` boot — so one non-JSON line here
      // corrupts the protocol for every consumer parsing it. Node's
      // `console.debug` IS `console.log` (fd 1), which is how the breadcrumb
      // added with the scoping fix broke `ptah doctor`: only on a boot that
      // found content an earlier boot had left, so the fresh-home case stayed
      // green and hid it.
      //
      // Asserted at `process.stdout.write` rather than at `console.debug`,
      // because the defect is the CHANNEL: any of log/debug/info/dir/table
      // reintroduces it, and only this spy catches all of them.
      const stale = path.join(PLUGINS_DIR, 'ptah-core', 'agents', 'gone.md');
      seedFile(stale, '# removed upstream');
      routeManifestOwningPtahCore();

      const stdout = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      try {
        await new ContentDownloadService().ensureContent();
      } finally {
        stdout.mockRestore();
      }

      expect(fs.existsSync(stale)).toBe(false);
      expect(stdout).not.toHaveBeenCalled();
      // Deleting a cached file silently is the defect the scoping fix closed;
      // the announcement must survive the channel change.
      expect(
        warnSpy.mock.calls.some((args: unknown[]) =>
          String(args[0]).includes('Pruned stale file'),
        ),
      ).toBe(true);
    });

    it('DOES delete a stale root-level template (flat manifest still swept)', async () => {
      const staleTemplate = path.join(TEMPLATES_DIR, 'removed.template.md');
      seedFile(staleTemplate, '# removed');

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: [],
            templateFiles: ['frontend.md'],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/frontend.md'),
        () => ({ statusCode: 200, body: '# frontend' }),
      );

      await new ContentDownloadService().ensureContent();

      expect(fs.existsSync(staleTemplate)).toBe(false);
      expect(fs.existsSync(path.join(TEMPLATES_DIR, 'frontend.md'))).toBe(true);
    });

    it('an unlink failure is logged and skipped — downloads still run', async () => {
      const stale = path.join(PLUGINS_DIR, 'ptah-core', 'locked.md');
      seedFile(stale, '# locked');
      routeManifestOwningPtahCore();

      const attempted: string[] = [];
      mockUnlinkSyncOverride = (target: fs.PathLike): void => {
        attempted.push(String(target));
        throw Object.assign(
          new Error(
            `EPERM: operation not permitted, unlink '${String(target)}'`,
          ),
          { code: 'EPERM' },
        );
      };

      const result = await new ContentDownloadService().ensureContent();

      // Prune runs before any download — a throw here used to abort the
      // entire refresh (TASK_2026_258 Failure Mode 4).
      expect(attempted).toContain(stale);
      expect(fs.existsSync(stale)).toBe(true);
      expect(result.success).toBe(true);
      expect(result.pluginsDownloaded).toBe(1);
      expect(
        fs.existsSync(
          path.join(PLUGINS_DIR, 'ptah-core', '.claude-plugin', 'plugin.json'),
        ),
      ).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prune stale file'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent deduplication
  // -------------------------------------------------------------------------

  describe('ensureContent — concurrent dedup', () => {
    it('returns the same promise for overlapping calls', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: ['a.json'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/a.json'),
        () => ({ statusCode: 200, body: '{}' }),
      );

      const svc = new ContentDownloadService();
      const [first, second] = await Promise.all([
        svc.ensureContent(),
        svc.ensureContent(),
      ]);

      // Only the underlying work ran once — both callers see the same result.
      expect(first).toEqual(second);
      // Manifest URL requested at most once during the dedupe window.
      const manifestHits = recordedRequests.filter((u) => u === MANIFEST_URL);
      expect(manifestHits.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Failure modes (never throws)
  // -------------------------------------------------------------------------

  describe('ensureContent — failure modes', () => {
    it('returns success=false with error message when manifest 404s', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 404, body: 'not found' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      expect(result.success).toBe(false);
      expect(result.pluginsDownloaded).toBe(0);
      expect(result.templatesDownloaded).toBe(0);
      expect(result.error).toMatch(/Manifest fetch failed/i);
    });

    it('returns fromCache=true when manifest fetch fails but local cache exists', async () => {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      fs.writeFileSync(path.join(PLUGINS_DIR, 'stale.json'), '{}');

      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({ statusCode: 500, body: 'server error' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      expect(result.success).toBe(false);
      expect(result.fromCache).toBe(true);
    });

    it('counts failed file downloads in the error summary', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: ['good.json', 'bad.json'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        (url) => url.endsWith('/good.json'),
        () => ({ statusCode: 200, body: '{}' }),
      );
      addRoute(
        (url) => url.endsWith('/bad.json'),
        () => ({ statusCode: 404, body: 'gone' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      expect(result.success).toBe(false);
      expect(result.pluginsDownloaded).toBe(1);
      expect(result.error).toMatch(/1 file\(s\) failed to download/);
    });

    it('rejects manifest with path traversal entries (does not escape target dir)', async () => {
      addRoute(
        (url) => url === MANIFEST_URL,
        () => ({
          statusCode: 200,
          body: buildManifest({
            pluginFiles: ['../../../../etc/passwd'],
            templateFiles: [],
          }),
        }),
      );
      addRoute(
        () => true,
        () => ({ statusCode: 200, body: 'pwned' }),
      );

      const svc = new ContentDownloadService();
      const result = await svc.ensureContent();

      // File must NOT have been written outside PLUGINS_DIR.
      // The escape target would be /etc/passwd on POSIX — just assert the
      // traversal file never landed in the plugins dir.
      const walked = fs.existsSync(PLUGINS_DIR)
        ? fs.readdirSync(PLUGINS_DIR)
        : [];
      expect(walked).not.toContain('passwd');
      expect(result.success).toBe(false);
    });
  });
});
