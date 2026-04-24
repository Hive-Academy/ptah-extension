/**
 * session-importer.service — unit specs.
 *
 * Covers `SessionImporterService.scanAndImport`, which seeds
 * `SessionMetadataStore` from Claude CLI's JSONL directory. Import happens
 * via two pathways that must coexist:
 *
 *   1. `sessions-index.json` (Claude CLI's canonical catalog) — primary
 *      source. Unknown future `version` values MUST be rejected so we never
 *      mis-interpret a drifted schema.
 *   2. Flat `.jsonl` scan — fallback when the index is absent or exhausted.
 *      `agent-*.jsonl` (subagent files) are filtered out to avoid polluting
 *      the sidebar.
 *
 * Child-session guardrail: sessions whose id appears in any parent's
 * `cliSessions[*].sdkSessionId` must be imported as children (hidden), not
 * as top-level sidebar entries.
 *
 * `node:fs` and `node:os` are mocked at module level. The source uses
 * `import * as fs from 'fs'` so `fs/promises` is accessed via `fs.promises`.
 */

import 'reflect-metadata';

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    open: jest.fn(),
  },
}));

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

import * as fs from 'fs';
import * as os from 'os';
import { SessionImporterService } from './session-importer.service';
import { SessionMetadataStore } from './session-metadata-store';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

const WORKSPACE = '/workspace/my-project';
// escapePath: replace [:\\/] with '-'
const ESCAPED = '-workspace-my-project';
const SESSIONS_DIR = `/home/testuser/.claude/projects/${ESCAPED}`;

// Access the mocked fs.promises surface — cast once to typed handles so the
// tests stay `as any`-free.
const fsPromises = fs.promises as jest.Mocked<typeof fs.promises>;
const mockedHomedir = os.homedir as jest.MockedFunction<typeof os.homedir>;

/**
 * Shape of a single `sessions-index.json` entry. Mirrors the `SessionsIndexEntry`
 * interface in the source under test, redeclared locally so the spec does not
 * depend on non-exported internals.
 */
interface IndexEntry {
  sessionId: string;
  fullPath?: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  customTitle?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

function makeIndex(entries: IndexEntry[], version = 1): string {
  return JSON.stringify({ version, entries });
}

/**
 * Primes `findSessionsDirectory` (private helper) via its public fs
 * consumers: access(projectsDir) → readdir(projectsDir).
 *
 * Queues exactly one access resolution (for projectsDir) so that subsequent
 * `mockResolvedValueOnce` / `mockRejectedValueOnce` calls in the test body
 * apply to the NEXT access invocation (usually `access(indexPath)` in
 * `importFromSessionsIndex`).
 */
function primeFindSessionsDir(matchingDir = ESCAPED): void {
  fsPromises.access.mockResolvedValueOnce(undefined); // access(projectsDir) OK
  fsPromises.readdir.mockResolvedValueOnce([matchingDir] as unknown as Awaited<
    ReturnType<typeof fsPromises.readdir>
  >);
}

describe('SessionImporterService', () => {
  let store: SessionMetadataStore;
  let importer: SessionImporterService;
  let logger: MockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue('/home/testuser');
    logger = createMockLogger();
    const storage = createMockStateStorage();
    store = new SessionMetadataStore(storage, asLogger(createMockLogger()));
    importer = new SessionImporterService(asLogger(logger), store);
  });

  // -------------------------------------------------------------------------
  // No sessions directory → 0 imports
  // -------------------------------------------------------------------------

  describe('when sessions directory is missing', () => {
    it('returns 0 and does not touch the metadata store', async () => {
      // access on projects dir fails → findSessionsDirectory returns null.
      fsPromises.access.mockRejectedValueOnce(new Error('ENOENT'));

      const imported = await importer.scanAndImport(WORKSPACE);
      expect(imported).toBe(0);
      expect(await store.getAll()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // sessions-index.json path
  // -------------------------------------------------------------------------

  describe('sessions-index.json (primary import path)', () => {
    it('imports entries newest-first, enriched with summary/firstPrompt', async () => {
      primeFindSessionsDir();

      // `importFromSessionsIndex` calls access(indexPath) then readFile(indexPath).
      fsPromises.access
        .mockResolvedValueOnce(undefined) // indexPath access
        // subsequent access calls are for each session's .jsonl existence
        .mockResolvedValue(undefined);

      fsPromises.readFile.mockResolvedValueOnce(
        makeIndex([
          {
            sessionId: 'sess-old',
            created: '2026-01-01T00:00:00.000Z',
            modified: '2026-01-01T00:00:00.000Z',
            firstPrompt: 'Old session',
          },
          {
            sessionId: 'sess-new',
            created: '2026-02-01T00:00:00.000Z',
            modified: '2026-02-01T00:00:00.000Z',
            summary: 'Newer session summary',
          },
        ]),
      );

      const imported = await importer.scanAndImport(WORKSPACE);

      expect(imported).toBe(2);
      const all = await store.getForWorkspace(WORKSPACE);
      expect(all.map((m) => m.sessionId)).toEqual(['sess-new', 'sess-old']); // newest first
      expect(all.find((m) => m.sessionId === 'sess-new')?.name).toBe(
        'Newer session summary',
      );
      // firstPrompt truncated to 50 chars + "..." appended only when longer.
      expect(all.find((m) => m.sessionId === 'sess-old')?.name).toBe(
        'Old session',
      );
    });

    it('skips sessions flagged as isSidechain', async () => {
      primeFindSessionsDir();
      fsPromises.access
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(undefined);
      fsPromises.readFile.mockResolvedValueOnce(
        makeIndex([
          {
            sessionId: 'sidechain',
            isSidechain: true,
            modified: '2026-01-01T00:00:00.000Z',
          },
          { sessionId: 'main', modified: '2026-01-02T00:00:00.000Z' },
        ]),
      );
      // For the JSONL fallback pass, make readdir empty so we don't double-count.
      fsPromises.readdir.mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );

      await importer.scanAndImport(WORKSPACE);
      const ids = (await store.getForWorkspace(WORKSPACE)).map(
        (m) => m.sessionId,
      );
      expect(ids).toContain('main');
      expect(ids).not.toContain('sidechain');
    });

    it('rejects unknown index versions (format drift guardrail)', async () => {
      primeFindSessionsDir();
      fsPromises.access.mockResolvedValueOnce(undefined);
      fsPromises.readFile.mockResolvedValueOnce(
        JSON.stringify({ version: 999, entries: [{ sessionId: 'ignored' }] }),
      );
      // JSONL fallback also empty
      fsPromises.readdir.mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );

      const imported = await importer.scanAndImport(WORKSPACE);
      expect(imported).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown sessions-index.json version'),
        expect.objectContaining({ version: 999 }),
      );
    });

    it('skips entries whose .jsonl file is missing on disk (ghost sessions)', async () => {
      primeFindSessionsDir();
      // Entries are iterated newest-first. With modified dates below, the
      // order is: ghost-2 (Jan 02) → ghost-1 (Jan 01). Queue access results
      // to match: indexPath OK, then ghost-2 MISSING, then ghost-1 OK.
      fsPromises.access
        .mockResolvedValueOnce(undefined) // index exists
        .mockRejectedValueOnce(new Error('ENOENT')) // ghost-2 .jsonl — missing
        .mockResolvedValueOnce(undefined); // ghost-1 .jsonl — exists
      fsPromises.readFile.mockResolvedValueOnce(
        makeIndex([
          { sessionId: 'ghost-1', modified: '2026-01-01T00:00:00.000Z' },
          { sessionId: 'ghost-2', modified: '2026-01-02T00:00:00.000Z' },
        ]),
      );
      fsPromises.readdir.mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );

      const imported = await importer.scanAndImport(WORKSPACE);
      expect(imported).toBe(1);
      const ids = (await store.getForWorkspace(WORKSPACE)).map(
        (m) => m.sessionId,
      );
      expect(ids).toEqual(['ghost-1']);
    });

    it('imports a referenced child session as hidden (createChild path)', async () => {
      // Seed the parent BEFORE running the importer so the
      // isReferencedAsChildSession check finds the sdkSessionId.
      await store.create('parent-1', WORKSPACE, 'parent');
      await store.addCliSession('parent-1', {
        cliSessionId: 'cli-ref',
        cli: 'gemini',
        agentId: 'agent-1' as never,
        task: 't',
        startedAt: '2026-01-01T00:00:00.000Z',
        status: 'completed',
        sdkSessionId: 'kid-1',
      });

      primeFindSessionsDir();
      fsPromises.access
        .mockResolvedValueOnce(undefined) // index exists
        .mockResolvedValue(undefined); // session .jsonl exists
      fsPromises.readFile.mockResolvedValueOnce(
        makeIndex([
          { sessionId: 'kid-1', modified: '2026-01-01T00:00:00.000Z' },
        ]),
      );
      fsPromises.readdir.mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );

      await importer.scanAndImport(WORKSPACE);

      const visible = await store.getForWorkspace(WORKSPACE);
      // Parent-1 only — kid-1 is hidden as a child session.
      expect(visible.map((m) => m.sessionId)).toEqual(['parent-1']);
      const all = await store.getForWorkspace(WORKSPACE, true);
      const kid = all.find((m) => m.sessionId === 'kid-1');
      expect(kid?.isChildSession).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Flat .jsonl scan fallback
  // -------------------------------------------------------------------------

  describe('flat .jsonl fallback path', () => {
    it('filters out agent-*.jsonl files from the session list', async () => {
      primeFindSessionsDir();
      // index missing → fallback branch
      fsPromises.access.mockRejectedValueOnce(new Error('ENOENT'));
      // readdir for flat scan returns a mix of main + agent files.
      fsPromises.readdir.mockResolvedValueOnce([
        'sess-flat.jsonl',
        'agent-subagent-1.jsonl', // must be excluded
        'not-a-session.txt',
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);

      // stat for sess-flat.jsonl
      fsPromises.stat.mockResolvedValueOnce({
        mtimeMs: 1_700_000_000_000,
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

      // extractMetadata opens the file and reads 8KB.
      const fileContent = Buffer.from(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-flat',
        }) +
          '\n' +
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'First user message' },
          }) +
          '\n',
      );
      fsPromises.open.mockResolvedValueOnce({
        read: jest.fn(
          async (buf: Buffer, _off: number, _len: number, _pos: number) => {
            fileContent.copy(buf, 0, 0, fileContent.length);
            return { bytesRead: fileContent.length, buffer: buf };
          },
        ),
        close: jest.fn(async () => undefined),
      } as unknown as Awaited<ReturnType<typeof fsPromises.open>>);

      const imported = await importer.scanAndImport(WORKSPACE);
      expect(imported).toBe(1);
      const ids = (await store.getForWorkspace(WORKSPACE)).map(
        (m) => m.sessionId,
      );
      expect(ids).toEqual(['sess-flat']);
    });

    it('does not re-import sessions already in the metadata store', async () => {
      await store.create('pre-existing', WORKSPACE, 'already here');

      primeFindSessionsDir();
      fsPromises.access.mockRejectedValueOnce(new Error('ENOENT'));
      fsPromises.readdir.mockResolvedValueOnce([
        'pre-existing.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      fsPromises.stat.mockResolvedValueOnce({
        mtimeMs: 1_700_000_000_000,
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

      const imported = await importer.scanAndImport(WORKSPACE);
      expect(imported).toBe(0);
      const all = await store.getForWorkspace(WORKSPACE);
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('already here'); // unchanged
    });
  });
});
