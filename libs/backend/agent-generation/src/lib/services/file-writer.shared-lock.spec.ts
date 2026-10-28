/**
 * Wizard writer vs pack installer through the shared destination lock
 * (TASK_2026_701 A2).
 *
 * Both writers replace an existing agent file only after re-checking it
 * against the baseline the user decided on. They share one process-wide
 * per-destination lock from `@ptah-extension/platform-core`, so when both
 * hold the same valid baseline exactly one replaces the file and the other
 * reports `changed-since-preview`.
 *
 * Every file lives under a fresh `mkdtemp` root that is removed afterwards.
 * The wizard writer's file-system port delegates to the real filesystem so
 * both writers see the same bytes.
 */

import 'reflect-metadata';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

import {
  AgentPackDownloadService,
  destinationWriteLock,
  hashPackContent,
} from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import { hashContent } from '@ptah-extension/harness-sync';
import { AgentFileWriterService } from './file-writer.service';
import type { GeneratedAgent } from '../types/core.types';

const BASELINE = '# React Expert (old)\n';
const WIZARD = '# React Expert (wizard)\n';
const PACK = '# React Expert (pack)\n';
const FILE = 'react-expert.md';

/** A real-filesystem port for the wizard writer. */
function realFileSystemPort(): MockFileSystemProvider {
  const port = createMockFileSystemProvider();
  port.readFile.mockImplementation((p: string) =>
    fsPromises.readFile(p, 'utf-8'),
  );
  port.writeFile.mockImplementation((p: string, content: string) =>
    fsPromises.writeFile(p, content, 'utf-8'),
  );
  port.writeFileExclusive.mockImplementation((p: string, content: string) =>
    fsPromises.writeFile(p, content, { encoding: 'utf-8', flag: 'wx' }),
  );
  port.createDirectory.mockImplementation(async (p: string) => {
    await fsPromises.mkdir(p, { recursive: true });
  });
  return port;
}

/** Wait until `count` holders run or wait on `dest` in the shared lock. */
async function waitForLockQueue(dest: string, count: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (destinationWriteLock.pendingCount(dest) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `shared lock queue for ${dest} never reached ${count} holders ` +
      `(saw ${destinationWriteLock.pendingCount(dest)})`,
  );
}

describe('wizard writer and pack installer share the destination lock (A2)', () => {
  let root: string;
  let agentsDir: string;
  let dest: string;
  let wizard: AgentFileWriterService;
  let pack: AgentPackDownloadService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-shared-lock-spec-'));
    agentsDir = path.join(root, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    dest = path.join(agentsDir, FILE);
    fs.writeFileSync(dest, BASELINE);
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    wizard = new AgentFileWriterService(logger as never, realFileSystemPort());
    pack = new AgentPackDownloadService();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function wizardAgent(): GeneratedAgent {
    return {
      sourceTemplateId: 'react-expert',
      sourceTemplateVersion: '1.0.0',
      content: WIZARD,
      variables: {},
      customizations: [],
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
      filePath: dest,
    };
  }

  it('a wizard replace and a pack replace with the same baseline: exactly one writes', async () => {
    // Hold the destination so both writers pass their guard against the
    // baseline and then queue on the lock before either re-check runs.
    let releaseHolder: () => void = () => undefined;
    const holder = destinationWriteLock.run(
      dest,
      () =>
        new Promise<void>((resolve) => {
          releaseHolder = resolve;
        }),
    );

    const wizardWrite = wizard.writeAgent(wizardAgent(), {
      mode: 'replace-allowed',
      baseline: { state: 'present', hash: hashContent(BASELINE) },
    });
    const packInstall = pack.installFiles(agentsDir, [
      {
        file: FILE,
        content: PACK,
        guard: { mode: 'replace', baselineHash: hashPackContent(BASELINE) },
      },
    ]);

    // Holder + wizard + pack, keyed by one destination however spelled.
    await waitForLockQueue(dest, 3);
    releaseHolder();
    await holder;

    const [wizardResult, packOutcomes] = await Promise.all([
      wizardWrite,
      packInstall,
    ]);
    const wizardStatus = wizardResult.value?.status;
    const packOutcome = packOutcomes[0]?.outcome;

    expect([wizardStatus, packOutcome].sort()).toEqual([
      'changed-since-preview',
      'written',
    ]);
    const winner = wizardStatus === 'written' ? WIZARD : PACK;
    expect(fs.readFileSync(dest, 'utf-8')).toBe(winner);
    expect(fs.readdirSync(agentsDir)).toEqual([FILE]);
    expect(destinationWriteLock.pendingCount(dest)).toBe(0);
  });

  it('wizard first: the pack replace that follows keeps the wizard bytes', async () => {
    const written = await wizard.writeAgent(wizardAgent(), {
      mode: 'replace-allowed',
      baseline: { state: 'present', hash: hashContent(BASELINE) },
    });
    const outcomes = await pack.installFiles(agentsDir, [
      {
        file: FILE,
        content: PACK,
        guard: { mode: 'replace', baselineHash: hashPackContent(BASELINE) },
      },
    ]);

    expect(written.value?.status).toBe('written');
    expect(outcomes).toEqual([
      { file: FILE, outcome: 'changed-since-preview' },
    ]);
    expect(fs.readFileSync(dest, 'utf-8')).toBe(WIZARD);
  });
});
