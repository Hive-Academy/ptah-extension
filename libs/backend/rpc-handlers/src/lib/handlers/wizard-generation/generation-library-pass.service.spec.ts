import 'reflect-metadata';

// Same transitive-import guard as the handler specs: the agent-generation
// barrel reaches workspace-intelligence, whose tree-sitter loader evaluates
// `import.meta.url` at load time (unparseable under ts-jest's CJS transform).
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: { Node: 'node', General: 'general', Unknown: 'unknown' },
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
}));
import { createMockLogger } from '@ptah-extension/shared/testing';
import { Logger } from '@ptah-extension/vscode-core';
import type { GenerationAgentOutcome } from '@ptah-extension/shared';
import {
  GenerationLibraryPassService,
  libraryScopeOf,
  type RunLibraryScope,
} from './generation-library-pass.service';

const ROOT = '/ws';
const AT_ROOT: RunLibraryScope = {
  harnessRoot: ROOT,
  outputRoot: ROOT,
  atHarnessRoot: true,
};

function logger(): Logger {
  return Object.assign(
    Object.create(Logger.prototype),
    createMockLogger(),
  ) as Logger;
}

function outcome(
  agentId: string,
  status: GenerationAgentOutcome['status'],
): GenerationAgentOutcome {
  return {
    agentId,
    filePath: `${ROOT}/.claude/agents/${agentId}.md`,
    status,
    rejectedSections: 0,
    tailoredSections: 0,
  };
}

function written(...ids: string[]) {
  return { writtenCount: ids.length, outcomes: ids.map((id) => outcome(id, 'written')) };
}

function make(
  opts: {
    gate?: boolean;
    propagation?: 'refreshed' | 'failed' | 'skipped' | 'throws' | 'absent';
    mirror?: boolean;
  } = {},
) {
  const gate = { enable: jest.fn().mockReturnValue(true) };
  const propagateWithReport = jest.fn().mockImplementation(async () => {
    if (opts.propagation === 'throws') throw new Error('reconcile failed');
    return {
      health: { targets: [{ target: 'codex', detected: true }] },
      userLayer: opts.propagation ?? 'refreshed',
    };
  });
  const readCloneOrigin = jest
    .fn()
    .mockImplementation(async (_kind: string, slug: string) => ({
      diverged: true,
      pendingSourceHash: `sha256:${slug}`,
    }));
  const origins = {
    read: jest.fn().mockResolvedValue({
      a: { hash: 'sha256:a', writtenAt: 1 },
      b: { hash: 'sha256:other', writtenAt: 1 },
    }),
  };
  const service = new GenerationLibraryPassService(
    logger(),
    origins,
    opts.gate === false ? undefined : gate,
    opts.propagation === 'absent' ? undefined : { propagateWithReport },
    opts.mirror === false ? undefined : { readCloneOrigin },
  );
  return { service, gate, propagateWithReport, readCloneOrigin, origins };
}

describe('GenerationLibraryPassService', () => {
  it('runs no pass when nothing was written and keeps the earlier propagation', async () => {
    const { service, propagateWithReport } = make();
    const previous = { consent: 'granted' as const, status: 'completed' as const };

    const facts = await service.afterRun(
      AT_ROOT,
      { writtenCount: 0, outcomes: [outcome('a', 'kept')] },
      previous,
    );

    expect(facts).toEqual({
      propagation: previous,
      library: { pass: 'not-applicable', diverged: [] },
    });
    expect(propagateWithReport).not.toHaveBeenCalled();
  });

  it('grants no consent and runs no pass outside the harness root', async () => {
    const { service, gate, propagateWithReport } = make();

    const facts = await service.afterRun(
      { harnessRoot: ROOT, outputRoot: `${ROOT}/pkg`, atHarnessRoot: false },
      written('a'),
    );

    expect(facts.library.pass).toBe('not-applicable');
    expect(facts.propagation).toEqual({
      consent: 'not-granted',
      status: 'not-attempted',
    });
    expect(gate.enable).not.toHaveBeenCalled();
    expect(propagateWithReport).not.toHaveBeenCalled();
  });

  it('an updated Library lists only written agents whose copy diverged from this write', async () => {
    const { service, gate } = make();

    const facts = await service.afterRun(AT_ROOT, written('a', 'b'));

    expect(gate.enable).toHaveBeenCalledWith(ROOT);
    expect(facts).toEqual({
      propagation: { consent: 'granted', status: 'completed', targets: ['codex'] },
      library: { pass: 'updated', diverged: ['a'] },
    });
  });

  it.each([
    ['a failed refresh', 'failed', 'failed'],
    ['a thrown propagation', 'throws', 'failed'],
    ['a skipped refresh', 'skipped', 'not-applicable'],
    ['a host without propagation', 'absent', 'not-applicable'],
  ] as const)(
    'reports %s as libraryPass %s and lists no diverged copy',
    async (_label, propagation, pass) => {
      const { service, readCloneOrigin } = make({ propagation });

      const facts = await service.afterRun(AT_ROOT, written('a'));

      expect(facts.library).toEqual({ pass, diverged: [] });
      expect(readCloneOrigin).not.toHaveBeenCalled();
    },
  );

  it('lists no diverged copy on a host without a Library mirror', async () => {
    const { service, origins } = make({ mirror: false });

    const facts = await service.afterRun(AT_ROOT, written('a'));

    expect(facts.library).toEqual({ pass: 'updated', diverged: [] });
    expect(origins.read).not.toHaveBeenCalled();
  });

  it('reports consent not granted on a host without the sync gate', async () => {
    const { service } = make({ gate: false });

    const facts = await service.afterRun(AT_ROOT, written('a'));

    expect(facts.propagation.consent).toBe('not-granted');
    expect(facts.library.pass).toBe('updated');
  });
});

describe('libraryScopeOf', () => {
  it('writes under the workspace when the manifest predates output roots', () => {
    const scope = libraryScopeOf(ROOT, {
      target: {
        harnessRoot: ROOT,
        openedFolder: ROOT,
        chosen: 'harness-root',
        openedIsHarnessRoot: true,
      },
    });
    expect(scope).toEqual({
      harnessRoot: ROOT,
      outputRoot: ROOT,
      atHarnessRoot: true,
    });
  });
});
