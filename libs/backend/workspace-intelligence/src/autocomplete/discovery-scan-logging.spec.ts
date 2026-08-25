/**
 * TASK_2026_315 C5 — a missing agent/skill directory is not a per-call log line.
 *
 * The captured Electron log (`tmp/logs/log.log:849`, `:873`) carried
 *
 *     [AgentDiscovery] Directory C:\Users\abdal\.claude\agents not accessible: ENOENT: ...
 *
 * once per `autocomplete:agents`, with no `[DEBUG]`/`[INFO]` prefix — a raw
 * `console.debug`, unlike every other line in that log. A user who has never
 * authored a user-level agent has no `~/.claude/agents`, so this is the NORMAL
 * state of most machines being announced repeatedly through a channel that
 * bypasses the log-level filter entirely.
 *
 * The two halves of the fix are separable and both are pinned here:
 *
 * 1. Reporting goes through the injected `Logger`, at DEBUG for an absent
 *    directory, and only the FIRST time per directory.
 * 2. A directory that exists and the OS refuses (EACCES) is a different event
 *    and still surfaces, at WARN. Swallowing a real permission fault along with
 *    the expected miss would be a worse bug than the noise.
 */

import 'reflect-metadata';

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
}));

import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { AgentDiscoveryService } from './agent-discovery.service';
import { CommandDiscoveryService } from './command-discovery.service';

const readdir = fsPromises.readdir as unknown as jest.Mock;
const readFile = fsPromises.readFile as unknown as jest.Mock;

const isWin = process.platform === 'win32';
const ROOT = isWin ? 'D:\\proj' : '/proj';

const PROJECT_AGENTS = path.join(ROOT, '.claude/agents');

type StubLogger = {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

function stubLogger(): StubLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function makeAgentService(logger: StubLogger) {
  const ctor = AgentDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => AgentDiscoveryService;
  return new ctor(
    { getWorkspaceRoot: jest.fn(() => ROOT) },
    { createFileWatcher: jest.fn() },
    logger,
  );
}

function makeCommandService(
  logger: StubLogger,
  sentry = { captureException: jest.fn() },
) {
  const ctor = CommandDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => CommandDiscoveryService;
  return new ctor(
    { getWorkspaceRoot: jest.fn(() => ROOT) },
    { createFileWatcher: jest.fn() },
    sentry,
    logger,
  );
}

/** Count logger calls whose message names the given tag. */
function callsMatching(mock: jest.Mock, tag: string): unknown[][] {
  return mock.mock.calls.filter(
    (call) => typeof call[0] === 'string' && call[0].includes(tag),
  );
}

beforeEach(() => {
  readdir.mockReset();
  readFile.mockReset();
});

describe('AgentDiscoveryService directory-scan reporting', () => {
  it('routes a missing directory through the logger, never console', async () => {
    const consoleDebug = jest
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);
    readdir.mockRejectedValue(
      errnoError('ENOENT', `ENOENT: no such file or directory, scandir`),
    );
    const logger = stubLogger();

    await makeAgentService(logger).discoverAgents(ROOT);

    expect(consoleDebug).not.toHaveBeenCalled();
    expect(
      callsMatching(logger.debug, '[AgentDiscovery]').length,
    ).toBeGreaterThan(0);
    consoleDebug.mockRestore();
  });

  it('reports an absent directory ONCE across repeated calls', async () => {
    readdir.mockRejectedValue(errnoError('ENOENT', 'ENOENT: scandir'));
    const logger = stubLogger();
    const service = makeAgentService(logger);

    await service.discoverAgents(ROOT);
    await service.discoverAgents(ROOT);
    await service.discoverAgents(ROOT);

    // Two distinct directories fail (project + user), each reported once —
    // three calls must not produce six lines.
    expect(callsMatching(logger.debug, '[AgentDiscovery]')).toHaveLength(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('surfaces an unreadable directory at warn, not swallowed with the miss', async () => {
    readdir.mockImplementation(async (dir: string) => {
      if (path.normalize(dir) === path.normalize(PROJECT_AGENTS)) {
        throw errnoError('EACCES', 'EACCES: permission denied, scandir');
      }
      throw errnoError('ENOENT', 'ENOENT: no such file or directory');
    });
    const logger = stubLogger();

    await makeAgentService(logger).discoverAgents(ROOT);

    const warns = callsMatching(logger.warn, '[AgentDiscovery]');
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ code: 'EACCES' });
    // The expected miss on the user directory still went to debug.
    expect(callsMatching(logger.debug, '[AgentDiscovery]')).toHaveLength(1);
  });

  it('re-reports a directory that regresses after reading successfully', async () => {
    const logger = stubLogger();
    const service = makeAgentService(logger);

    readdir.mockRejectedValue(errnoError('ENOENT', 'ENOENT: scandir'));
    await service.discoverAgents(ROOT);
    expect(callsMatching(logger.debug, '[AgentDiscovery]')).toHaveLength(2);

    // Both directories come back.
    readdir.mockResolvedValue([]);
    await service.discoverAgents(ROOT);
    expect(callsMatching(logger.debug, '[AgentDiscovery]')).toHaveLength(2);

    // And go away again — a fresh fault, so a fresh report.
    readdir.mockRejectedValue(errnoError('ENOENT', 'ENOENT: scandir'));
    await service.discoverAgents(ROOT);
    expect(callsMatching(logger.debug, '[AgentDiscovery]')).toHaveLength(4);
  });

  it('re-reports the same directory when its failure MODE changes', async () => {
    const logger = stubLogger();
    const service = makeAgentService(logger);

    readdir.mockRejectedValue(errnoError('ENOENT', 'ENOENT: scandir'));
    await service.discoverAgents(ROOT);
    expect(logger.warn).not.toHaveBeenCalled();

    readdir.mockRejectedValue(errnoError('EACCES', 'EACCES: denied'));
    await service.discoverAgents(ROOT);

    expect(callsMatching(logger.warn, '[AgentDiscovery]')).toHaveLength(2);
  });
});

describe('CommandDiscoveryService skills-directory reporting', () => {
  const SKILLS_DIR = path.join(ROOT, '.claude/skills');

  /**
   * `scanWorkspaceSkills` is private and reached through `discoverCommands`.
   * Driving it directly keeps the assertion on the one catch block C5 names,
   * without depending on the rest of the command walk.
   */
  function scanSkills(
    service: CommandDiscoveryService,
    dir: string,
  ): Promise<unknown> {
    return (
      service as unknown as {
        scanWorkspaceSkills: (d: string) => Promise<unknown>;
      }
    ).scanWorkspaceSkills(dir);
  }

  it('does not raise a Sentry exception for a skills directory that is simply absent', async () => {
    readdir.mockRejectedValue(errnoError('ENOENT', 'ENOENT: scandir'));
    const logger = stubLogger();
    const sentry = { captureException: jest.fn() };
    const service = makeCommandService(logger, sentry);

    await scanSkills(service, SKILLS_DIR);
    await scanSkills(service, SKILLS_DIR);

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(callsMatching(logger.debug, '[CommandDiscovery]')).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still warns AND reports to Sentry when the directory is unreadable', async () => {
    readdir.mockRejectedValue(errnoError('EACCES', 'EACCES: denied'));
    const logger = stubLogger();
    const sentry = { captureException: jest.fn() };

    await scanSkills(makeCommandService(logger, sentry), SKILLS_DIR);

    expect(callsMatching(logger.warn, '[CommandDiscovery]')).toHaveLength(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
