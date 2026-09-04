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
        cli: 'codex',
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

    // -----------------------------------------------------------------------
    // TASK_2026_306 Defect C — the 8 KB metadata prefix is a BYTE bound, so
    // its trailing line is normally cut mid-token. `JSON.parse`ing every split
    // line therefore threw on almost every real file and the method-level
    // catch dropped it: 11 of 11 files discarded, `Import complete:
    // {"imported":0}` the only visible signal.
    //
    // The four cases below are the boundary: tolerate the truncated tail,
    // fall back to the filename when NOTHING complete is in the prefix, and
    // still refuse both genuine corruption and title-only sidecars.
    // -----------------------------------------------------------------------
    describe('8 KB prefix truncation (TASK_2026_306)', () => {
      // These cases need PERSISTENT (`mockResolvedValue`) fs stubs — the
      // post-import prune pass re-opens every imported file, so a `...Once`
      // queue runs dry mid-scan. The outer `jest.clearAllMocks()` clears call
      // records but NOT implementations, so drop them here rather than leaking
      // an always-succeeding `access` into the specs that follow.
      afterEach(() => {
        fsPromises.access.mockReset();
        fsPromises.open.mockReset();
        fsPromises.readdir.mockReset();
        fsPromises.stat.mockReset();
      });

      /**
       * A faithful positional `fd.read`: honours the caller's length bound and
       * reports the real `bytesRead`, so a file longer than 8192 bytes yields a
       * prefix cut wherever byte 8192 lands. The existing helper above copies
       * the whole file in regardless, which is exactly the condition the defect
       * could not occur under.
       *
       * Not `...Once` — `pruneTitleOnlySessions` re-opens every imported file
       * afterwards, and that pass must see the same bytes.
       */
      function mockPositionalRead(fileContent: Buffer): void {
        fsPromises.open.mockResolvedValue({
          read: jest.fn(
            async (buf: Buffer, off: number, len: number, pos: number) => {
              const end = Math.min(fileContent.length, pos + len);
              const bytesRead = Math.max(0, end - pos);
              if (bytesRead > 0) fileContent.copy(buf, off, pos, end);
              return { bytesRead, buffer: buf };
            },
          ),
          close: jest.fn(async () => undefined),
        } as unknown as Awaited<ReturnType<typeof fsPromises.open>>);
      }

      /** Prime the flat-`.jsonl` fallback for exactly one file. */
      function primeFlatScan(filename: string): void {
        primeFindSessionsDir();
        fsPromises.access.mockRejectedValueOnce(new Error('ENOENT')); // no index
        fsPromises.readdir.mockResolvedValueOnce([
          filename,
        ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
        fsPromises.stat.mockResolvedValueOnce({
          mtimeMs: 1_700_000_000_000,
        } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);
        // pruneTitleOnlySessions: the backing file still exists.
        fsPromises.access.mockResolvedValue(undefined);
      }

      it('imports a session whose prefix is cut mid-token (the reported case)', async () => {
        // Record 1 carries the session id; record 2 is long enough that byte
        // 8192 lands inside its string. Nothing resolves a name, so the loop
        // does reach the truncated record — which is what used to throw.
        const content = Buffer.from(
          JSON.stringify({
            type: 'system',
            subtype: 'init',
            session_id: 'sess-trunc',
          }) +
            '\n' +
            JSON.stringify({
              type: 'assistant',
              message: { content: 'A'.repeat(9000) },
            }) +
            '\n',
        );
        expect(content.length).toBeGreaterThan(8192);

        primeFlatScan('sess-trunc.jsonl');
        mockPositionalRead(content);

        const imported = await importer.scanAndImport(WORKSPACE);

        expect(imported).toBe(1);
        const all = await store.getForWorkspace(WORKSPACE);
        expect(all.map((m) => m.sessionId)).toEqual(['sess-trunc']);
        expect(all[0].name).toMatch(/^Session /);
      });

      it('falls back to the filename when the first record alone exceeds the prefix', async () => {
        // One 12 KB record: the prefix contains no newline at all, so after
        // dropping the cut tail there is no complete record to judge from.
        // `session_id` is not reachable and the filename is the only source —
        // the primary path for large modern CLI files, not a corner case.
        const content = Buffer.from(
          JSON.stringify({
            type: 'system',
            subtype: 'init',
            session_id: 'unreachable',
            payload: 'B'.repeat(12000),
          }) + '\n',
        );

        primeFlatScan('big-first-record.jsonl');
        mockPositionalRead(content);

        const imported = await importer.scanAndImport(WORKSPACE);

        expect(imported).toBe(1);
        const all = await store.getForWorkspace(WORKSPACE);
        expect(all.map((m) => m.sessionId)).toEqual(['big-first-record']);
      });

      it('still returns nothing for a genuinely corrupt file, and warns', async () => {
        // Short read, ends on a newline: every record here is COMPLETE and
        // none is JSON. That is corruption, not truncation, and tolerating it
        // would turn a real failure into a silent phantom session.
        const content = Buffer.from('not json at all\nalso not json\n');

        primeFlatScan('corrupt-session.jsonl');
        mockPositionalRead(content);

        const imported = await importer.scanAndImport(WORKSPACE);

        expect(imported).toBe(0);
        expect(await store.getForWorkspace(WORKSPACE)).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('No parseable records'),
          expect.objectContaining({ completeLines: 2 }),
        );
      });

      it('still skips an ai-title sidecar (no phantom "Session <date>" entry)', async () => {
        const content = Buffer.from(
          JSON.stringify({ type: 'ai-title', title: 'Some title' }) + '\n',
        );

        primeFlatScan('title-only.jsonl');
        mockPositionalRead(content);

        const imported = await importer.scanAndImport(WORKSPACE);

        expect(imported).toBe(0);
        expect(await store.getForWorkspace(WORKSPACE)).toEqual([]);
      });

      // ---------------------------------------------------------------------
      // TASK_2026_308 F3-1 — the sidecar guard had a hole underneath it.
      //
      // The guard skipped itself when NOTHING complete parsed, because that is
      // what a first record larger than the whole 8 KB prefix looks like and a
      // real session must not be thrown away on no evidence. But "nothing
      // parsed" also describes a whitespace-only file, and a SHORT read means
      // the whole file is in hand — there is no record past byte 8192 to give
      // it the benefit of the doubt. Such a file walked straight through to
      // the filename fallback and was imported as the exact phantom
      // "Session <date>" entry the guard exists to prevent.
      //
      // The refusal is a CONJUNCTION of two signals that were both already in
      // hand: non-whitespace bytes (does this file hold anything?) and
      // `bytesRead < METADATA_PREFIX_BYTES` (have we seen all of it?). Neither
      // alone is sound. `parsedRecords` cannot serve as the first, because it
      // counts parse SUCCESSES and so reads zero for a file we merely failed
      // to parse. Dropping the second would rest the guard on "no producer
      // writes 8 KB of leading blank lines", which is an assumption about
      // producers, not a proof — and false for a file that is whitespace
      // through byte 8192 and a real session afterwards.
      //
      // So: refuse only with the whole file in hand and nothing in it. The
      // cases below are the boundary that draws, including the two it
      // deliberately declines to close.
      // ---------------------------------------------------------------------
      describe('short contentless files (TASK_2026_308 F3-1)', () => {
        it('does not import a whitespace-only file shorter than the prefix', async () => {
          // 7 bytes: no complete record, and the short read proves there is
          // nothing else in the file. Not a session.
          const content = Buffer.from('\n   \n\t\n');
          expect(content.length).toBeLessThan(8192);

          primeFlatScan('whitespace-only.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(0);
          expect(await store.getForWorkspace(WORKSPACE)).toEqual([]);
        });

        it('still falls back to the filename when a short read was NOT the whole file', async () => {
          // Same "nothing parsed" symptom, opposite cause: one 12 KB record,
          // so the prefix is full and the session marker sits past its end.
          // The gate must key on `bytesRead`, not on the empty record list,
          // or this legitimate file is discarded with the phantom.
          const content = Buffer.from(
            JSON.stringify({
              type: 'system',
              subtype: 'init',
              session_id: 'unreachable',
              payload: 'C'.repeat(12000),
            }) + '\n',
          );

          primeFlatScan('prefix-full.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(1);
          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['prefix-full']);
        });

        // THE SPEC THAT STOPS THE GUARD BEING "IMPROVED" INTO DATA LOSS.
        //
        // A whitespace prefix is only evidence of an empty file when the whole
        // file is in hand. Drop the `bytesRead` conjunct — on the tempting
        // grounds that 8 KB of blank lines cannot be a session — and this file
        // is refused on a full prefix nobody can see past, and a real session
        // disappears from the sidebar.
        it('imports a session whose real content begins past a whitespace prefix', async () => {
          const content = Buffer.concat([
            Buffer.alloc(8192, 0x20),
            Buffer.from(
              JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: 'late-start-id',
              }) + '\n',
            ),
          ]);
          expect(content.length).toBeGreaterThan(8192);

          primeFlatScan('late-start.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          // The session marker is unreachable inside the prefix, so the
          // filename carries the id — which for a CLI-written file IS the real
          // session id. Badly named beats absent.
          expect(imported).toBe(1);
          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['late-start']);
        });

        // ACCEPTED LIMITATION, pinned so it is a decision and not a surprise.
        //
        // At exactly the prefix length `bytesRead === METADATA_PREFIX_BYTES`,
        // which is indistinguishable from a truncated read — this file and the
        // one above are byte-identical for the first 8192 bytes. Nothing here
        // can separate them without a second read, and refusing both would
        // sacrifice the real session above to suppress the phantom below. A
        // phantom is cosmetic; a dropped session is not. If you are here to
        // close this case, a second read is the only sound way, and it is not
        // worth a syscall on every import for a file shape nobody produces.
        it('still imports a whitespace-only file of exactly the prefix length (accepted phantom)', async () => {
          const content = Buffer.alloc(8192, 0x20);
          expect(content.length).toBe(8192);

          primeFlatScan('whitespace-8192.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(1);
          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['whitespace-8192']);
          expect(all[0].name).toMatch(/^Session /);
        });

        it('imports a BOM-prefixed session with its real id and name', async () => {
          // `Buffer.toString('utf-8')` does not strip a UTF-8 BOM and
          // `JSON.parse` throws on a leading U+FEFF, so the system-init record
          // carrying the session id is unparseable. This is a REAL session and
          // must not be lost — and the right outcome is the real id from the
          // record, not a filename guess.
          const content = Buffer.from(
            String.fromCharCode(0xfeff) +
              JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: 'bom-real-id',
              }) +
              '\n' +
              JSON.stringify({
                type: 'user',
                message: { role: 'user', content: 'Ship the thing' },
              }) +
              '\n',
          );

          primeFlatScan('bom-session.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(1);
          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['bom-real-id']);
          expect(all[0].name).toBe('Ship the thing');
        });

        // The single-line case, which behaves DIFFERENTLY from the two-line one
        // above and is the more common shape for a fresh session.
        //
        // With only one record there is no second, parseable line to carry the
        // file. Before the BOM strip that record failed to parse, so
        // `parsedRecords === 0` with `lines.length === 1` and the file was
        // discarded by the `No parseable records` branch — a real session lost
        // with only a debug-level warn to show for it. Stripping at decode
        // rescues it AND recovers the canonical `session_id`, which the
        // filename fallback could only have guessed at.
        it('imports a single-record BOM-prefixed session with its real id', async () => {
          const content = Buffer.from(
            String.fromCharCode(0xfeff) +
              JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: 'bom-solo-id',
              }) +
              '\n',
          );

          primeFlatScan('bom-solo.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(1);
          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['bom-solo-id']);
          expect(logger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('No parseable records'),
            expect.anything(),
          );
        });

        // Pins the boundary the new discriminator must NOT move. A short file
        // whose one complete record is real but unparseable has been handled
        // by the `No parseable records` branch above this guard since
        // TASK_2026_306 — that branch is deliberate ("corrupt rather than
        // merely truncated") and runs FIRST, so the content signal never sees
        // this file. Passes before and after the F3-1 change by construction;
        // it exists to keep that true.
        it('still refuses a short file whose only record is unparseable, and warns', async () => {
          const content = Buffer.from('{"type":"user","message":{"cont\n');

          primeFlatScan('half-written.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(0);
          expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('No parseable records'),
            expect.objectContaining({ completeLines: 1 }),
          );
        });

        it('still imports a short file that does hold a user turn', async () => {
          // The gate keys on session CONTENT, not on file size. A tiny real
          // session with no reachable `session_id` still resolves its id from
          // the filename, exactly as before.
          const content = Buffer.from(
            JSON.stringify({
              type: 'user',
              message: { role: 'user', content: 'Hi there' },
            }) + '\n',
          );

          primeFlatScan('tiny-real-session.jsonl');
          mockPositionalRead(content);

          const imported = await importer.scanAndImport(WORKSPACE);

          expect(imported).toBe(1);
          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['tiny-real-session']);
          expect(all[0].name).toBe('Hi there');
        });
      });

      // ---------------------------------------------------------------------
      // The prune pass under a BOM (TASK_2026_308).
      //
      // `decodePrefix` is shared with `isTitleOnlySidecar`, so making the
      // importer BOM-aware made the PRUNE BOM-aware in the same stroke — and
      // the prune DELETES stored session metadata. Its refusal to touch a real
      // session rests on two things: it returns true only on a positive
      // `ai-title` sighting, and it bails the moment it sees a system or user
      // line. Both were previously vacuous for a BOM-prefixed file, because
      // nothing parsed at all. Now that records really do parse, that
      // reasoning is load-bearing and needs to be held down by tests rather
      // than by argument.
      // ---------------------------------------------------------------------
      describe('title-only prune under a BOM (TASK_2026_308)', () => {
        afterEach(() => {
          fsPromises.access.mockReset();
          fsPromises.open.mockReset();
          fsPromises.readdir.mockReset();
          fsPromises.stat.mockReset();
        });

        function mockPositionalRead(fileContent: Buffer): void {
          fsPromises.open.mockResolvedValue({
            read: jest.fn(
              async (buf: Buffer, off: number, len: number, pos: number) => {
                const end = Math.min(fileContent.length, pos + len);
                const bytesRead = Math.max(0, end - pos);
                if (bytesRead > 0) fileContent.copy(buf, off, pos, end);
                return { bytesRead, buffer: buf };
              },
            ),
            close: jest.fn(async () => undefined),
          } as unknown as Awaited<ReturnType<typeof fsPromises.open>>);
        }

        /**
         * A scan that discovers nothing new, so the only pass with any effect
         * is `pruneTitleOnlySessions` over what is already in the store.
         */
        function primePruneOnlyScan(): void {
          primeFindSessionsDir();
          fsPromises.access.mockRejectedValueOnce(new Error('ENOENT')); // no index
          fsPromises.readdir.mockResolvedValueOnce(
            [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
          );
          fsPromises.access.mockResolvedValue(undefined); // backing file exists
        }

        it('does not prune a BOM-prefixed real session', async () => {
          await store.create('bom-keep', WORKSPACE, 'Real work');
          const content = Buffer.from(
            String.fromCharCode(0xfeff) +
              JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: 'bom-keep',
              }) +
              '\n',
          );

          primePruneOnlyScan();
          mockPositionalRead(content);

          await importer.scanAndImport(WORKSPACE);

          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['bom-keep']);
        });

        it('does not prune a BOM-prefixed file that carries both a title and a turn', async () => {
          // The mixed shape is the one that could go wrong: the `ai-title`
          // sighting is now real, so only the system/user bail stops the
          // delete. It must win regardless of record order.
          await store.create('bom-mixed', WORKSPACE, 'Titled work');
          const content = Buffer.from(
            String.fromCharCode(0xfeff) +
              JSON.stringify({ type: 'ai-title', title: 'Some title' }) +
              '\n' +
              JSON.stringify({
                type: 'user',
                message: { role: 'user', content: 'Real turn' },
              }) +
              '\n',
          );

          primePruneOnlyScan();
          mockPositionalRead(content);

          await importer.scanAndImport(WORKSPACE);

          const all = await store.getForWorkspace(WORKSPACE);
          expect(all.map((m) => m.sessionId)).toEqual(['bom-mixed']);
        });

        // The positive counterpart. Without it the two specs above would pass
        // against a prune that had been accidentally disabled altogether, and
        // this is the one of the three that actually changed behaviour: before
        // the BOM strip this sidecar parsed to nothing and survived forever.
        it('prunes a BOM-prefixed title-only sidecar', async () => {
          await store.create('bom-title', WORKSPACE, 'Session 1/1/2026');
          const content = Buffer.from(
            String.fromCharCode(0xfeff) +
              JSON.stringify({ type: 'ai-title', title: 'Some title' }) +
              '\n',
          );

          primePruneOnlyScan();
          mockPositionalRead(content);

          await importer.scanAndImport(WORKSPACE);

          expect(await store.getForWorkspace(WORKSPACE)).toEqual([]);
        });
      });
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

  // -------------------------------------------------------------------------
  // TASK_2026_331 B1.T5 — the scan runs behind an OPEN window now, so it must
  // hand the event loop back between sessions and stop when the app quits.
  // -------------------------------------------------------------------------

  describe('event-loop yielding and abort', () => {
    /**
     * Prime an index import with `count` entries whose `.jsonl` files all exist.
     */
    function primeIndexWith(count: number): void {
      primeFindSessionsDir();
      fsPromises.access
        .mockResolvedValueOnce(undefined) // indexPath
        .mockResolvedValue(undefined); // each session's .jsonl
      fsPromises.readFile.mockResolvedValueOnce(
        makeIndex(
          Array.from({ length: count }, (_, i) => ({
            sessionId: `sess-${i}`,
            modified: `2026-01-0${i + 1}T00:00:00.000Z`,
          })),
        ),
      );
      // Empty flat scan so the fallback pass adds nothing.
      fsPromises.readdir.mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );
    }

    it('schedules a macrotask between sessions, not just a microtask', async () => {
      // A microtask loop never lets an I/O callback or an IPC message run —
      // the whole import would still execute in one event-loop turn and the
      // window would freeze exactly as it did before this change.
      const setImmediateSpy = jest.spyOn(global, 'setImmediate');
      primeIndexWith(3);

      await importer.scanAndImport(WORKSPACE);

      expect(setImmediateSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
      setImmediateSpy.mockRestore();
    });

    it('does not hold the event loop for the whole scan', async () => {
      // A macrotask queued from the test runs BETWEEN sessions, not after all
      // of them, which is the observable consequence of yielding.
      primeIndexWith(3);

      let ranDuringScan = false;
      const scan = importer.scanAndImport(WORKSPACE);
      setImmediate(() => {
        ranDuringScan = true;
      });
      await scan;

      expect(ranDuringScan).toBe(true);
    });

    it('imports nothing when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const imported = await importer.scanAndImport(WORKSPACE, 50, {
        signal: controller.signal,
      });

      expect(imported).toBe(0);
      expect(fsPromises.access).not.toHaveBeenCalled();
    });

    it('stops importing once the signal fires mid-scan', async () => {
      const controller = new AbortController();
      primeIndexWith(4);
      // Abort as soon as the first session has been written.
      const originalSave = store.save.bind(store);
      jest
        .spyOn(store, 'save')
        .mockImplementation(
          async (metadata: Parameters<typeof originalSave>[0]) => {
            controller.abort();
            return originalSave(metadata);
          },
        );

      const imported = await importer.scanAndImport(WORKSPACE, 50, {
        signal: controller.signal,
      });

      expect(imported).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_331 B7 — one scan per workspace root at a time.
  //
  // Two independent callers resolve this same service and both call
  // `scanAndImport` for the startup workspace: the Electron boot
  // (`boot-heavy-services.ts`) and the `workspace:switch` RPC handler. The
  // handler's own recency/backoff/in-flight guards read maps only the HANDLER
  // writes, so the boot import was invisible to them and the same root was
  // scanned twice on every launch. The dedup therefore lives here, in the one
  // object both callers share.
  // -------------------------------------------------------------------------

  describe('in-flight deduplication by normalized workspace root', () => {
    const PROJECTS_SUFFIX = '/.claude/projects';

    // The overload sets on `fs.promises.readdir` / `readFile` are unusable with
    // `mockImplementation`, so address them as plain mocks. The `slash` helper
    // exists because `path.join` produces `\` on win32 and `/` elsewhere, and
    // these assertions must read the same on both.
    const readdirMock = fsPromises.readdir as unknown as jest.Mock;
    const readFileMock = fsPromises.readFile as unknown as jest.Mock;

    function slash(value: unknown): string {
      return String(value).replace(/\\/g, '/');
    }

    /** How many times a scan walked `~/.claude/projects` — i.e. scans started. */
    function scansStarted(): number {
      return readdirMock.mock.calls.filter((call) =>
        slash(call[0]).endsWith(PROJECTS_SUFFIX),
      ).length;
    }

    /** How many times a scan read a `sessions-index.json`. */
    function indexReads(): number {
      return readFileMock.mock.calls.filter((call) =>
        slash(call[0]).endsWith('sessions-index.json'),
      ).length;
    }

    function entriesFor(ids: string[]): string {
      return makeIndex(
        ids.map((sessionId, i) => ({
          sessionId,
          modified: `2026-01-0${i + 1}T00:00:00.000Z`,
        })),
      );
    }

    /**
     * Serve `~/.claude/projects` from `projectDirs` and each project's
     * `sessions-index.json` from `indexByDir`. Every other `readdir` (the flat
     * `.jsonl` fallback) is empty, and every `access` resolves.
     *
     * Implementations rather than `*Once` queues: two concurrent scans consume
     * a shared queue in an order the test cannot predict.
     */
    function primeProjects(
      projectDirs: string[],
      indexByDir: Record<string, string[]>,
    ): void {
      fsPromises.access.mockResolvedValue(undefined);
      readdirMock.mockImplementation((target: unknown) =>
        slash(target).endsWith(PROJECTS_SUFFIX)
          ? Promise.resolve(projectDirs)
          : Promise.resolve([]),
      );
      readFileMock.mockImplementation((target: unknown) => {
        const seen = slash(target);
        const dir = Object.keys(indexByDir).find((d) => seen.includes(d));
        return dir === undefined
          ? Promise.reject(new Error(`unexpected readFile: ${seen}`))
          : Promise.resolve(entriesFor(indexByDir[dir]));
      });
    }

    beforeEach(() => {
      // `jest.clearAllMocks()` in the outer hook clears CALLS but keeps
      // implementations, and earlier blocks in this file install persistent
      // ones. Reset so each case below starts from a blank fs.
      fsPromises.access.mockReset();
      readdirMock.mockReset();
      readFileMock.mockReset();
      (fsPromises.open as unknown as jest.Mock).mockReset();
    });

    it('runs ONE scan for two concurrent calls and gives both the same count', async () => {
      primeProjects([ESCAPED], { [ESCAPED]: ['sess-a', 'sess-b'] });

      const [first, second] = await Promise.all([
        importer.scanAndImport(WORKSPACE),
        importer.scanAndImport(WORKSPACE),
      ]);

      expect(scansStarted()).toBe(1);
      expect(indexReads()).toBe(1);
      // Both are 2 — not 2 and 0. A second scan would find every session
      // already in the store and report an honest-looking zero, which is
      // exactly how the duplicate stayed invisible.
      expect(first).toBe(2);
      expect(second).toBe(2);
    });

    it('runs a separate scan for each distinct root', async () => {
      const ALPHA = '/workspace/alpha';
      const BETA = '/workspace/beta';
      primeProjects(['-workspace-alpha', '-workspace-beta'], {
        '-workspace-alpha': ['alpha-1', 'alpha-2'],
        '-workspace-beta': ['beta-1'],
      });

      const [alpha, beta] = await Promise.all([
        importer.scanAndImport(ALPHA),
        importer.scanAndImport(BETA),
      ]);

      expect(scansStarted()).toBe(2);
      expect(alpha).toBe(2);
      expect(beta).toBe(1);
    });

    it('joins a Windows and a POSIX spelling of the same directory', async () => {
      // The startup root and the root the renderer echoes back through
      // `workspace:switch` differ by separator, trailing separator and drive
      // case on Windows. Keyed raw, these are two roots and two scans.
      primeProjects(['c--repos-x-'], { 'c--repos-x-': ['win-1'] });

      const [fromBoot, fromSwitch] = await Promise.all([
        importer.scanAndImport('C:\\Repos\\X\\'),
        importer.scanAndImport('c:/repos/x'),
      ]);

      expect(scansStarted()).toBe(1);
      expect(fromBoot).toBe(1);
      expect(fromSwitch).toBe(1);
    });

    it('clears the entry once a scan settles, so a later call scans again', async () => {
      primeProjects([ESCAPED], { [ESCAPED]: ['sess-a'] });

      await importer.scanAndImport(WORKSPACE);
      expect(scansStarted()).toBe(1);

      // A real re-scan — switching away and back — must still work. This is
      // deliberately NOT a permanent "already imported" latch; how OFTEN a
      // completed import is worth repeating is the RPC handler's time-based
      // policy, not this map's.
      await importer.scanAndImport(WORKSPACE);
      expect(scansStarted()).toBe(2);
    });

    it('propagates a rejection to every joined caller and clears the entry', async () => {
      // `findSessionsDirectory` guards `access` but not `readdir`, so a failing
      // projects directory rejects out of the whole scan.
      fsPromises.access.mockResolvedValue(undefined);
      readdirMock.mockRejectedValue(new Error('projects unreadable'));

      // Handlers attached at creation: the shared promise must never be a
      // moment away from an unhandled rejection just because a joiner is slow.
      const first = importer.scanAndImport(WORKSPACE).catch((e: unknown) => e);
      const second = importer.scanAndImport(WORKSPACE).catch((e: unknown) => e);

      const [firstError, secondError] = await Promise.all([first, second]);

      expect(scansStarted()).toBe(1);
      expect(firstError).toBeInstanceOf(Error);
      expect(secondError).toBeInstanceOf(Error);
      expect((firstError as Error).message).toBe('projects unreadable');
      expect((secondError as Error).message).toBe('projects unreadable');

      // A failure must not wedge the root shut.
      await importer.scanAndImport(WORKSPACE).catch(() => undefined);
      expect(scansStarted()).toBe(2);
    });
  });
});
