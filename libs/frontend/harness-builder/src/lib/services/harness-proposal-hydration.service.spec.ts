import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import type {
  HarnessConfigProposedPayload,
  HarnessGetProposalResult,
  HarnessProposalRevision,
} from '@ptah-extension/shared';
import { type HarnessUserSnapshot } from './harness-builder-records.service';
import { HarnessProposalHydrationService } from './harness-proposal-hydration.service';
import { HarnessRpcService } from './harness-rpc.service';

const root = '/workspace/a';
const t1 = '2026-10-15T10:00:00.000Z';
const t2 = '2026-10-15T11:00:00.000Z';
const t3 = '2026-10-15T12:00:00.000Z';
const persona = (label: string) => ({ label, description: label, goals: [] });

function revision(
  id: string,
  label: string,
  turnStartedAt?: string,
): HarnessProposalRevision {
  return {
    id,
    configUpdates: { persona: persona(label) },
    isConfigComplete: true,
    updatedAt: t3,
    ...(turnStartedAt ? { turnStartedAt } : {}),
  };
}

function proposal(
  sessionId: string,
  revisions: HarnessProposalRevision[],
): HarnessGetProposalResult {
  return {
    proposal: {
      version: 1,
      workspaceRoot: root,
      sessionId,
      configUpdates: {},
      isConfigComplete: true,
      updatedAt: t3,
      revisions,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function push(
  sessionId: string,
  saved: HarnessProposalRevision,
): HarnessConfigProposedPayload {
  return {
    sessionId,
    configUpdates: saved.configUpdates,
    isConfigComplete: saved.isConfigComplete,
    revision: saved,
  };
}

describe('HarnessProposalHydrationService', () => {
  let service: HarnessProposalHydrationService;
  let rpc: { getProposal: jest.Mock };

  beforeEach(() => {
    rpc = { getProposal: jest.fn().mockResolvedValue({ proposal: null }) };
    TestBed.configureTestingModule({
      providers: [
        HarnessProposalHydrationService,
        { provide: HarnessRpcService, useValue: rpc },
        {
          provide: LoggingService,
          useValue: { warn: jest.fn(), error: jest.fn() },
        },
      ],
    });
    service = TestBed.inject(HarnessProposalHydrationService);
  });

  it('orders by turn start or write time and restores a newer unattributed revision', async () => {
    rpc.getProposal.mockResolvedValue(
      proposal('own', [
        { ...revision('new', 'new'), updatedAt: t3, isConfigComplete: true },
        {
          ...revision('old', 'old', t1),
          updatedAt: t2,
          isConfigComplete: false,
        },
      ]),
    );
    await service.bind(root, 'tab', ['own']);
    expect(service.config().persona?.label).toBe('new');
    expect(service.isConfigComplete()).toBe(true);
    expect(service.status()).toBe('ready');
    service.handlePush(
      push('own', { ...revision('older', 'older', t1), updatedAt: t2 }),
    );
    expect(service.config().persona?.label).toBe('new');
  });

  it('keeps a newer unattributed live revision after an older attributed revision', async () => {
    rpc.getProposal.mockResolvedValue(
      proposal('own', [
        {
          ...revision('old', 'old', t1),
          updatedAt: t2,
          isConfigComplete: false,
        },
      ]),
    );
    await service.bind(root, 'tab', ['own']);
    service.handlePush(
      push('own', { ...revision('new', 'new'), updatedAt: t3 }),
    );
    expect(service.config().persona?.label).toBe('new');
    expect(service.isConfigComplete()).toBe(true);
  });

  it('reads proposals from the bound original workspace path', async () => {
    const originalRoot = '\\\\wsl.localhost\\Ubuntu\\home\\User\\Proj';
    await service.bind(originalRoot, 'tab', ['own']);
    expect(rpc.getProposal).toHaveBeenCalledWith('own', originalRoot);
  });

  it('keeps a bound session with no proposal in the empty ready state', async () => {
    await service.bind(root, 'tab', ['own']);
    expect(service.config()).toEqual({});
    expect(service.status()).toBe('ready');
  });

  it('reports unavailable when a previously seen proposal is missing on re-entry', async () => {
    rpc.getProposal.mockResolvedValueOnce(
      proposal('own', [revision('saved', 'saved', t1)]),
    );
    await service.bind(root, 'tab', ['own']);
    expect(service.status()).toBe('ready');

    await service.bind(root, 'tab', ['own']);
    expect(service.config()).toEqual({});
    expect(service.status()).toBe('unavailable');
  });

  it('keeps a user choice against older and unattributed proposals, then accepts a later turn', async () => {
    const snapshot: HarnessUserSnapshot = {
      version: 1,
      workspaceRoot: root,
      tabId: 'tab',
      configUpdates: { persona: persona('user') },
      fields: { persona: { source: 'user', chosenAt: t2, updatedAt: t2 } },
    };
    rpc.getProposal.mockResolvedValue(
      proposal('own', [
        revision('legacy', 'legacy'),
        revision('old', 'old', t1),
      ]),
    );
    await service.bind(root, 'tab', ['own'], snapshot);
    expect(service.config().persona?.label).toBe('user');
    service.handlePush(push('own', revision('new', 'new', t3)));
    expect(service.config().persona?.label).toBe('new');
    service.handlePush(push('own', revision('late-old', 'old', t1)));
    expect(service.config().persona?.label).toBe('new');
  });

  it.each([t1, t3])(
    'keeps a user choice over a later unattributed revision after a turn at %s',
    async (turnStart) => {
      const snapshot: HarnessUserSnapshot = {
        version: 1,
        workspaceRoot: root,
        tabId: 'tab',
        configUpdates: { persona: persona('user') },
        fields: { persona: { source: 'user', chosenAt: t2, updatedAt: t2 } },
      };
      rpc.getProposal.mockResolvedValue(
        proposal('own', [
          { ...revision('attributed', 'attributed', turnStart), updatedAt: t3 },
          {
            ...revision('unattributed', 'unattributed'),
            updatedAt: '2026-10-15T13:00:00.000Z',
          },
        ]),
      );
      await service.bind(root, 'tab', ['own'], snapshot);
      expect(service.config().persona?.label).toBe('user');
    },
  );

  it('buffers a push during the read and deduplicates it after hydration', async () => {
    const read = deferred<HarnessGetProposalResult>();
    const saved = revision('same', 'one', t1);
    rpc.getProposal.mockReturnValue(read.promise);
    const binding = service.bind(root, 'tab', ['own']);
    service.handlePush(push('own', saved));
    read.resolve(proposal('own', [saved]));
    await binding;
    expect(service.config().persona?.label).toBe('one');
    expect(service.status()).toBe('ready');
  });

  it('drops an overlapping older read and ignores foreign pushes', async () => {
    const oldRead = deferred<HarnessGetProposalResult>();
    rpc.getProposal
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(
        proposal('new-session', [revision('new', 'new', t3)]),
      );
    const first = service.bind(root, 'old-tab', ['old-session']);
    await service.bind(root, 'new-tab', ['new-session']);
    oldRead.resolve(proposal('old-session', [revision('old', 'old', t1)]));
    await first;
    service.handlePush(push('old-session', revision('foreign', 'foreign', t3)));
    expect(service.config().persona?.label).toBe('new');
  });

  it('does not read a workspace latest proposal or accept a cross-workspace record', async () => {
    await service.bind(root, 'new-tab', []);
    expect(rpc.getProposal).not.toHaveBeenCalled();
    expect(service.config()).toEqual({});
    rpc.getProposal.mockResolvedValue({
      proposal: {
        ...proposal('own', [revision('r1', 'foreign', t3)]).proposal!,
        workspaceRoot: '/workspace/b',
      },
    });
    await service.bind(root, 'new-tab', ['own']);
    expect(service.config()).toEqual({});
    expect(service.status()).toBe('unavailable');
  });

  it('merges list entries by stable id when a later revision omits them', async () => {
    const old: HarnessProposalRevision = {
      id: 'a',
      turnStartedAt: t1,
      updatedAt: t1,
      isConfigComplete: false,
      configUpdates: {
        mcp: {
          servers: [{ name: 'one', url: 'https://one.test', enabled: true }],
          enabledTools: {},
        },
      },
    };
    const newer: HarnessProposalRevision = {
      id: 'b',
      turnStartedAt: t3,
      updatedAt: t3,
      isConfigComplete: true,
      configUpdates: {
        mcp: {
          servers: [{ name: 'two', url: 'https://two.test', enabled: true }],
          enabledTools: {},
        },
      },
    };
    rpc.getProposal.mockResolvedValue(proposal('own', [newer, old]));
    await service.bind(root, 'tab', ['own']);
    expect(service.config().mcp?.servers.map((item) => item.name)).toEqual([
      'one',
      'two',
    ]);
  });
});

describe('HarnessProposalHydrationService folded revisions', () => {
  it('exposes ordered cumulative snapshots without user overrides', async () => {
    const getProposal = jest.fn().mockResolvedValue(proposal('session-1', [
      { id: 'later', configUpdates: { name: 'Later name' }, isConfigComplete: true, updatedAt: t2, turnStartedAt: t2 },
      { id: 'earlier', configUpdates: { persona: persona('Agent') }, isConfigComplete: false, updatedAt: t1, turnStartedAt: t1 },
    ]));
    TestBed.configureTestingModule({ providers: [
      HarnessProposalHydrationService,
      { provide: HarnessRpcService, useValue: { getProposal } },
      { provide: LoggingService, useValue: { warn: jest.fn(), error: jest.fn() } },
    ] });
    const hydration = TestBed.inject(HarnessProposalHydrationService);
    const snapshot: HarnessUserSnapshot = {
      version: 1, workspaceRoot: root, tabId: 'tab-1',
      configUpdates: { persona: persona('User') },
      fields: { persona: { source: 'user', chosenAt: t3, updatedAt: t3 } },
    };
    await hydration.bind(root, 'tab-1', ['session-1'], snapshot);
    expect(hydration.revisions().map((entry) => [entry.id, entry.ordinal])).toEqual([['earlier', 1], ['later', 2]]);
    expect(hydration.revisions()[0].config.persona?.label).toBe('Agent');
    expect(hydration.revisions()[1].config.persona?.label).toBe('Agent');
    expect(hydration.config().persona?.label).toBe('User');
  });
});
