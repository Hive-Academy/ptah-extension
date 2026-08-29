/**
 * jsonl-reader.service — unit specs.
 *
 * Covers `JsonlReaderService`, the file-I/O primitive behind session history
 * reading. All behaviour tested here is observable on the public API:
 *
 *   - `findSessionsDirectory` — escapes workspace paths to Claude's
 *     `~/.claude/projects/<escaped>/` layout and falls back through
 *     exact → lowercase → hyphen/underscore-normalized → partial matches.
 *   - `readJsonlMessages` — parses one message per non-blank line, skips
 *     malformed lines (with a `debug` log, never throws), and enforces a
 *     50 MB size cap via `SdkError` before opening the file.
 *   - `loadAgentSessions` — prefers nested `<parent>/subagents/` layout and
 *     falls back to the legacy flat `agent-*.jsonl` layout. For the legacy
 *     layout it filters agent files whose first message's `sessionId`
 *     matches the parent session id.
 *
 * `node:fs/promises` (source uses `import * as fs from 'fs/promises'`),
 * `node:fs` (for `createReadStream`) and `node:os` are mocked at module-level
 * so path resolution is deterministic across the Windows + POSIX CI matrix.
 *
 * File CONTENT is primed through {@link primeFileContent}: since
 * TASK_2026_323 the reader streams rather than `readFile`-ing, so a fixture is
 * an in-memory `Readable` rather than a resolved string. The assertions below
 * are unchanged — only the priming seam moved.
 *
 * Follows the direct-constructor style of
 * `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts`.
 */

import 'reflect-metadata';
import * as path from 'path';
import { Readable } from 'node:stream';
import { expectNormalizedPath } from '@ptah-extension/shared/testing';

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  readdir: jest.fn(),
  readFile: jest.fn(),
  stat: jest.fn(),
}));

jest.mock('node:fs', () => ({
  createReadStream: jest.fn(),
}));

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

import * as fs from 'fs/promises';
import { createReadStream } from 'node:fs';
import * as os from 'os';
import { JsonlReaderService } from './jsonl-reader.service';
import { SdkError } from '../../errors';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

// Bridge: production `Logger` is a nominal class with private fields, so a
// structural mock fails assignability at the constructor boundary. Cast at a
// single named seam rather than sprinkling `as unknown as` at every callsite.
function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Typed mock handles — no `as any`.
// ---------------------------------------------------------------------------

const mockedAccess = fs.access as jest.MockedFunction<typeof fs.access>;
const mockedReaddir = fs.readdir as jest.MockedFunction<typeof fs.readdir>;
const mockedReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
const mockedStat = fs.stat as jest.MockedFunction<typeof fs.stat>;
const mockedHomedir = os.homedir as jest.MockedFunction<typeof os.homedir>;
const mockedCreateReadStream = createReadStream as jest.MockedFunction<
  typeof createReadStream
>;

/**
 * Build a minimal `fs.Stats`-ish object. `readJsonlMessages` only reads
 * `stats.size` so we keep the fixture tight and cast through `unknown`
 * rather than a full Stats instance.
 */
function statsWithSize(size: number): Awaited<ReturnType<typeof fs.stat>> {
  return { size } as unknown as Awaited<ReturnType<typeof fs.stat>>;
}

/**
 * Stats carrying BOTH halves of the transcript-cache validity token
 * (TASK_2026_353). `statsWithSize` deliberately omits `mtimeMs`, which the
 * reader treats as "no token" and therefore does not cache — that is what
 * keeps the pre-existing cases above single-parse and unaffected.
 */
function statsOf(
  size: number,
  mtimeMs: number,
): Awaited<ReturnType<typeof fs.stat>> {
  return { size, mtimeMs } as unknown as Awaited<ReturnType<typeof fs.stat>>;
}

/** Stats for `~/.claude/projects` itself: the memo's validity token. */
function dirStats(mtimeMs: number): Awaited<ReturnType<typeof fs.stat>> {
  return { mtimeMs, isDirectory: () => true } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >;
}

/** One in-memory read stream carrying `content` as a single Buffer chunk. */
function streamOf(content: string): ReturnType<typeof createReadStream> {
  return Readable.from([Buffer.from(content, 'utf8')]) as unknown as ReturnType<
    typeof createReadStream
  >;
}

/**
 * Queue file contents for the next N `createReadStream` calls, in order —
 * the streaming equivalent of `readFile.mockResolvedValueOnce(...)`. A fresh
 * `Readable` is built per call because a stream is consumed exactly once.
 */
function primeFileContent(...contents: readonly string[]): void {
  for (const content of contents) {
    mockedCreateReadStream.mockImplementationOnce(() => streamOf(content));
  }
}

/** Same content for every `createReadStream` call (multi-file fixtures). */
function primeFileContentAlways(content: string): void {
  mockedCreateReadStream.mockImplementation(() => streamOf(content));
}

describe('JsonlReaderService', () => {
  let service: JsonlReaderService;
  let logger: MockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue('/home/testuser');
    logger = createMockLogger();
    service = new JsonlReaderService(asLogger(logger));
  });

  // -------------------------------------------------------------------------
  // findSessionsDirectory
  // -------------------------------------------------------------------------

  describe('findSessionsDirectory', () => {
    const WORKSPACE_POSIX = '/workspace/my-project';
    // escapedPath replaces `:` `\` `/` with `-`.
    const ESCAPED_POSIX = '-workspace-my-project';

    it('returns null when ~/.claude/projects does not exist', async () => {
      mockedAccess.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(
        service.findSessionsDirectory(WORKSPACE_POSIX),
      ).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Projects directory does not exist'),
        expect.objectContaining({ projectsDir: expect.any(String) }),
      );
    });

    it('returns an exact match when the escaped path is present', async () => {
      mockedAccess.mockResolvedValueOnce(undefined);
      mockedReaddir.mockResolvedValueOnce([
        ESCAPED_POSIX,
        'unrelated-dir',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const result = await service.findSessionsDirectory(WORKSPACE_POSIX);
      expect(result).not.toBeNull();
      expectNormalizedPath(
        result as string,
        path.posix.join('/home/testuser/.claude/projects', ESCAPED_POSIX),
      );
    });

    it('falls back to a case-insensitive match', async () => {
      mockedAccess.mockResolvedValueOnce(undefined);
      mockedReaddir.mockResolvedValueOnce([
        '-WORKSPACE-MY-PROJECT',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const result = await service.findSessionsDirectory(WORKSPACE_POSIX);
      expect(result).not.toBeNull();
      expectNormalizedPath(
        result as string,
        path.posix.join(
          '/home/testuser/.claude/projects',
          '-WORKSPACE-MY-PROJECT',
        ),
      );
    });

    it('falls back to a hyphen/underscore-normalized match', async () => {
      // Claude CLI may normalize `_` → `-` (or vice versa).
      mockedAccess.mockResolvedValueOnce(undefined);
      mockedReaddir.mockResolvedValueOnce([
        '-workspace-my_project',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const result = await service.findSessionsDirectory(WORKSPACE_POSIX);
      expect(result).not.toBeNull();
      expectNormalizedPath(
        result as string,
        path.posix.join(
          '/home/testuser/.claude/projects',
          '-workspace-my_project',
        ),
      );
    });

    it('falls back to a partial match on the workspace basename', async () => {
      mockedAccess.mockResolvedValueOnce(undefined);
      mockedReaddir.mockResolvedValueOnce([
        'something-else-my-project-xyz',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const result = await service.findSessionsDirectory(WORKSPACE_POSIX);
      expect(result).not.toBeNull();
      // Accept whichever directory the partial matcher picks — that it is
      // non-null is the asserted contract; the exact fallback choice is
      // an implementation detail.
      expect(result).toContain('something-else-my-project-xyz');
    });

    it('returns null and logs a warn when nothing matches', async () => {
      mockedAccess.mockResolvedValueOnce(undefined);
      mockedReaddir.mockResolvedValueOnce([
        'totally-unrelated',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      await expect(
        service.findSessionsDirectory(WORKSPACE_POSIX),
      ).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Sessions directory not found'),
        expect.objectContaining({ workspacePath: WORKSPACE_POSIX }),
      );
    });

    it('escapes Windows drive letters (C:\\... → -C--...)', async () => {
      // The escape rule replaces `:` `\` `/` with `-`.
      const winWorkspace = 'C:\\Users\\alice\\project';
      const escapedWin = 'C--Users-alice-project';
      mockedAccess.mockResolvedValueOnce(undefined);
      mockedReaddir.mockResolvedValueOnce([escapedWin] as unknown as Awaited<
        ReturnType<typeof fs.readdir>
      >);

      const result = await service.findSessionsDirectory(winWorkspace);
      expect(result).not.toBeNull();
      expect(result).toContain(escapedWin);
    });

    // -----------------------------------------------------------------------
    // TASK_2026_353 — one scan per workspace while ~/.claude/projects is
    // unchanged. Baseline: 24 identical scans of the same 18-entry directory
    // in one boot (tmp/logs/log.log).
    // -----------------------------------------------------------------------
    describe('memoisation', () => {
      const DIRS = [ESCAPED_POSIX] as unknown as Awaited<
        ReturnType<typeof fs.readdir>
      >;

      it('scans ~/.claude/projects once while its mtime is unchanged', async () => {
        mockedAccess.mockResolvedValue(undefined);
        mockedStat.mockResolvedValue(dirStats(1000));
        mockedReaddir.mockResolvedValue(DIRS);

        const first = await service.findSessionsDirectory(WORKSPACE_POSIX);
        const second = await service.findSessionsDirectory(WORKSPACE_POSIX);
        const third = await service.findSessionsDirectory(WORKSPACE_POSIX);

        expect(mockedReaddir).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
        expect(third).toBe(first);
      });

      it('rescans once the projects directory mtime moves', async () => {
        mockedAccess.mockResolvedValue(undefined);
        mockedReaddir.mockResolvedValue(DIRS);
        mockedStat.mockResolvedValueOnce(dirStats(1000));
        await service.findSessionsDirectory(WORKSPACE_POSIX);

        mockedStat.mockResolvedValueOnce(dirStats(2000));
        await service.findSessionsDirectory(WORKSPACE_POSIX);

        expect(mockedReaddir).toHaveBeenCalledTimes(2);
      });

      it('scans per workspace — one memo does not answer for another', async () => {
        mockedAccess.mockResolvedValue(undefined);
        mockedStat.mockResolvedValue(dirStats(1000));
        mockedReaddir.mockResolvedValue([
          ESCAPED_POSIX,
          '-workspace-other',
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        const a = await service.findSessionsDirectory(WORKSPACE_POSIX);
        const b = await service.findSessionsDirectory('/workspace/other');

        expect(mockedReaddir).toHaveBeenCalledTimes(2);
        expect(a).toContain(ESCAPED_POSIX);
        expect(b).toContain('-workspace-other');
      });

      it('memoises the negative answer too — it can only change with the mtime', async () => {
        mockedAccess.mockResolvedValue(undefined);
        mockedStat.mockResolvedValue(dirStats(1000));
        mockedReaddir.mockResolvedValue([
          'totally-unrelated',
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        await expect(
          service.findSessionsDirectory(WORKSPACE_POSIX),
        ).resolves.toBeNull();
        await expect(
          service.findSessionsDirectory(WORKSPACE_POSIX),
        ).resolves.toBeNull();

        expect(mockedReaddir).toHaveBeenCalledTimes(1);
      });

      it('falls back to a full scan when the projects directory cannot be stat-ed', async () => {
        mockedAccess.mockResolvedValue(undefined);
        mockedStat.mockRejectedValue(new Error('EPERM'));
        mockedReaddir.mockResolvedValue(DIRS);

        await service.findSessionsDirectory(WORKSPACE_POSIX);
        await service.findSessionsDirectory(WORKSPACE_POSIX);

        expect(mockedReaddir).toHaveBeenCalledTimes(2);
      });

      it('drops the memo when the projects directory disappears', async () => {
        mockedAccess.mockResolvedValueOnce(undefined);
        mockedStat.mockResolvedValue(dirStats(1000));
        mockedReaddir.mockResolvedValue(DIRS);
        await service.findSessionsDirectory(WORKSPACE_POSIX);

        mockedAccess.mockRejectedValueOnce(new Error('ENOENT'));
        await expect(
          service.findSessionsDirectory(WORKSPACE_POSIX),
        ).resolves.toBeNull();

        mockedAccess.mockResolvedValueOnce(undefined);
        await service.findSessionsDirectory(WORKSPACE_POSIX);

        expect(mockedReaddir).toHaveBeenCalledTimes(2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // readJsonlMessages
  // -------------------------------------------------------------------------

  describe('readJsonlMessages', () => {
    it('parses one message per non-blank line', async () => {
      const jsonl = [
        JSON.stringify({
          uuid: 'u1',
          sessionId: 's1',
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'hello' },
        }),
        '', // blank line — ignored
        JSON.stringify({
          uuid: 'u2',
          sessionId: 's1',
          timestamp: '2026-01-01T00:00:01.000Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            usage: {
              input_tokens: 1,
              output_tokens: 2,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
      ].join('\n');
      mockedStat.mockResolvedValueOnce(statsWithSize(Buffer.byteLength(jsonl)));
      primeFileContent(jsonl);

      const out = await service.readJsonlMessages('/tmp/session.jsonl');

      expect(out).toHaveLength(2);
      expect(out[0].uuid).toBe('u1');
      expect(out[0].type).toBe('user');
      expect(out[1].type).toBe('assistant');
      // Usage is lifted from message.usage onto the top-level message
      // for downstream aggregation.
      expect(out[1].usage).toEqual({
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      });
    });

    it('skips malformed JSONL lines with a debug log (never throws)', async () => {
      const jsonl = [
        JSON.stringify({ uuid: 'good-1', type: 'user' }),
        'this is NOT json',
        '{ truly broken',
        JSON.stringify({ uuid: 'good-2', type: 'assistant' }),
      ].join('\n');
      mockedStat.mockResolvedValueOnce(statsWithSize(Buffer.byteLength(jsonl)));
      primeFileContent(jsonl);

      const out = await service.readJsonlMessages('/tmp/session.jsonl');

      // The two good lines survive; the two broken ones are dropped.
      expect(out.map((m) => m.uuid)).toEqual(['good-1', 'good-2']);
      // At least one debug call for the malformed lines (format drift).
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed JSONL line'),
        expect.objectContaining({ filePath: '/tmp/session.jsonl' }),
      );
    });

    it('derives `type` from message.role when top-level type is missing (format drift shim)', async () => {
      // Older/drifted JSONL omits the top-level `type` but has message.role.
      const jsonl = JSON.stringify({
        uuid: 'no-type',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      });
      mockedStat.mockResolvedValueOnce(statsWithSize(Buffer.byteLength(jsonl)));
      primeFileContent(jsonl);

      const out = await service.readJsonlMessages('/tmp/session.jsonl');
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('assistant');
    });

    it('rejects files over the 50 MB cap with SdkError before reading content', async () => {
      // `await expect(...).rejects.toThrow(...)` invokes the thunk once, so we
      // need exactly one stat reply — any extra primed replies stay queued
      // for an unrelated later test if `jest.clearAllMocks` misfires.
      mockedStat.mockResolvedValueOnce(statsWithSize(51 * 1024 * 1024));

      const promise = service.readJsonlMessages('/tmp/huge.jsonl');
      await expect(promise).rejects.toThrow(SdkError);
      await expect(promise).rejects.toThrow(/too large/i);

      // If the cap check is bypassed, a 51MB parse lands on the backend main
      // thread; assert we never even opened the file.
      expect(mockedCreateReadStream).not.toHaveBeenCalled();
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('returns an empty array for an empty file', async () => {
      mockedStat.mockResolvedValueOnce(statsWithSize(0));
      primeFileContent('');

      await expect(
        service.readJsonlMessages('/tmp/empty.jsonl'),
      ).resolves.toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // loadAgentSessions
  // -------------------------------------------------------------------------

  describe('loadAgentSessions', () => {
    const sessionsDir = '/home/testuser/.claude/projects/-ws';
    const parentId = 'parent-session';

    it('prefers the nested <parent>/subagents/ layout', async () => {
      // First readdir → subagents dir
      mockedReaddir.mockResolvedValueOnce([
        'agent-nested-1.jsonl',
        'agent-nested-2.jsonl',
        'unrelated.txt',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // readJsonlMessages calls for each nested file: stat + readFile
      const nestedMsg = JSON.stringify({
        uuid: 'n1',
        sessionId: parentId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'user',
        message: { role: 'user', content: 'warmup' },
      });
      mockedStat.mockResolvedValue(statsWithSize(Buffer.byteLength(nestedMsg)));
      primeFileContentAlways(nestedMsg);

      const out = await service.loadAgentSessions(sessionsDir, parentId);

      expect(out).toHaveLength(2);
      expect(out.map((a) => a.agentId).sort()).toEqual([
        'agent-nested-1',
        'agent-nested-2',
      ]);
      // All loaded from the nested subagents dir, not the legacy flat layout —
      // so the second readdir (legacy fallback) must not fire.
      expect(mockedReaddir).toHaveBeenCalledTimes(1);
    });

    it('falls back to the legacy flat layout when nested dir is missing', async () => {
      // Nested readdir throws (dir missing) → fallback to legacy.
      mockedReaddir.mockRejectedValueOnce(new Error('ENOENT'));
      mockedReaddir.mockResolvedValueOnce([
        'agent-legacy-1.jsonl',
        `${parentId}.jsonl`, // main session file, ignored by agent filter
        'agent-legacy-foreign.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Legacy layout filters by first-message sessionId. Build:
      //   - agent-legacy-1 matches parentId → kept
      //   - agent-legacy-foreign belongs to another session → dropped
      const ours = JSON.stringify({
        uuid: 'l1',
        sessionId: parentId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'user',
        message: { role: 'user', content: 'hi' },
      });
      const foreign = JSON.stringify({
        uuid: 'l2',
        sessionId: 'different-session',
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'user',
        message: { role: 'user', content: 'hi' },
      });
      // Stat returns file size for each agent read; first is ours, second foreign.
      mockedStat
        .mockResolvedValueOnce(statsWithSize(Buffer.byteLength(ours)))
        .mockResolvedValueOnce(statsWithSize(Buffer.byteLength(foreign)));
      primeFileContent(ours, foreign);

      const out = await service.loadAgentSessions(sessionsDir, parentId);

      expect(out.map((a) => a.agentId)).toEqual(['agent-legacy-1']);
    });

    it('returns [] when neither layout is present', async () => {
      mockedReaddir.mockRejectedValueOnce(new Error('ENOENT'));
      mockedReaddir.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(
        service.loadAgentSessions(sessionsDir, parentId),
      ).resolves.toEqual([]);
    });

    it('skips unreadable agent files instead of throwing', async () => {
      mockedReaddir.mockResolvedValueOnce([
        'agent-broken.jsonl',
        'agent-ok.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const ok = JSON.stringify({
        uuid: 'ok',
        sessionId: parentId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'user',
        message: { role: 'user', content: 'hi' },
      });
      // First file — stat throws (broken).
      mockedStat.mockRejectedValueOnce(new Error('EACCES'));
      // Second file — succeeds.
      mockedStat.mockResolvedValueOnce(statsWithSize(Buffer.byteLength(ok)));
      primeFileContent(ok);

      const out = await service.loadAgentSessions(sessionsDir, parentId);

      expect(out.map((a) => a.agentId)).toEqual(['agent-ok']);
    });
  });

  // -------------------------------------------------------------------------
  // Parsed-transcript cache (TASK_2026_353)
  //
  // `chat:resume` parses the same transcript twice — `readSessionHistory()`
  // then `readHistoryAsMessages()` — and `session:stats-batch` parses it a
  // third time moments later. The validity token is (size, mtimeMs).
  // -------------------------------------------------------------------------
  describe('transcript cache', () => {
    const FILE = '/tmp/session.jsonl';
    const LINE = JSON.stringify({
      uuid: 'u1',
      sessionId: 's1',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'hello' },
    });
    const SIZE = Buffer.byteLength(LINE);

    it('parses once for repeated reads of an unchanged file', async () => {
      mockedStat.mockResolvedValue(statsOf(SIZE, 5000));
      primeFileContentAlways(LINE);

      const first = await service.readJsonlMessages(FILE);
      const second = await service.readJsonlMessages(FILE);

      expect(mockedCreateReadStream).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('re-parses when the mtime moves', async () => {
      primeFileContentAlways(LINE);
      mockedStat.mockResolvedValueOnce(statsOf(SIZE, 5000));
      await service.readJsonlMessages(FILE);

      mockedStat.mockResolvedValueOnce(statsOf(SIZE, 6000));
      await service.readJsonlMessages(FILE);

      expect(mockedCreateReadStream).toHaveBeenCalledTimes(2);
    });

    it('re-parses when the size moves under the same mtime', async () => {
      primeFileContentAlways(LINE);
      mockedStat.mockResolvedValueOnce(statsOf(SIZE, 5000));
      await service.readJsonlMessages(FILE);

      mockedStat.mockResolvedValueOnce(statsOf(SIZE + 10, 5000));
      await service.readJsonlMessages(FILE);

      expect(mockedCreateReadStream).toHaveBeenCalledTimes(2);
    });

    it('keys on the file path — one transcript never answers for another', async () => {
      mockedStat.mockResolvedValue(statsOf(SIZE, 5000));
      primeFileContentAlways(LINE);

      await service.readJsonlMessages(FILE);
      await service.readJsonlMessages('/tmp/other.jsonl');

      expect(mockedCreateReadStream).toHaveBeenCalledTimes(2);
    });

    it('hands each caller its own array, so one caller cannot corrupt the next', async () => {
      mockedStat.mockResolvedValue(statsOf(SIZE, 5000));
      primeFileContentAlways(LINE);

      const first = await service.readJsonlMessages(FILE);
      first.length = 0;
      const second = await service.readJsonlMessages(FILE);

      expect(second).toHaveLength(1);
    });

    it('does not serve a cached parse to readJsonlTail', async () => {
      mockedStat.mockResolvedValue(statsOf(SIZE, 5000));
      primeFileContentAlways(LINE);

      await service.readJsonlMessages(FILE);
      const tail = await service.readJsonlTail(FILE, { maxBytes: SIZE * 2 });

      expect(mockedCreateReadStream).toHaveBeenCalledTimes(2);
      expect(tail).toHaveLength(1);
    });
  });
});
