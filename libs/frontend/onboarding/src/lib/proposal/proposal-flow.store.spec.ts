import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  HarnessBuilderRecordsService,
  HarnessProposalHydrationService,
  HarnessSessionController,
} from '@ptah-extension/harness-builder';
import { TabManagerService } from '@ptah-extension/chat-state';
import { NotificationService, VSCodeService } from '@ptah-extension/core';
import { mergeHarnessConfigUpdates } from '@ptah-extension/shared';
import {
  diffHarnessConfig,
  HARNESS_FLOW_MODE,
  ProposalFlowStore,
} from './proposal-flow.store';

describe('diffHarnessConfig', () => {
  it('marks new and changed fields only after comparing folded snapshots', () => {
    const previous = {
      persona: {
        label: 'Researcher',
        description: 'Research',
        goals: ['Find'],
      },
    };
    const next = {
      persona: { label: 'Analyst', description: 'Research', goals: ['Find'] },
      name: 'Team',
    };
    const tags = diffHarnessConfig(previous, next);
    expect(tags.get('persona.label')).toBe('changed');
    expect(tags.get('name')).toBe('new');
    expect(tags.has('persona.description')).toBe(false);
    expect(diffHarnessConfig({}, next).get('persona')).toBe('new');
  });
});

describe('ProposalFlowStore', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('writes user overrides when restoring a folded revision', () => {
    const record = signal<{
      tabId: string;
      workspacePath: string;
      sessionId?: string;
    }>({ tabId: 'tab-1', workspacePath: '/ws' });
    const revisions = signal([
      {
        id: 'rev-1',
        sessionId: 's',
        ordinal: 1,
        updatedAt: '2026-10-30T00:00:00Z',
        isConfigComplete: false,
        config: { name: 'Earlier' },
      },
      {
        id: 'rev-2',
        sessionId: 's',
        ordinal: 2,
        updatedAt: '2026-10-30T00:01:00Z',
        isConfigComplete: false,
        config: { name: 'Current' },
      },
    ]);
    const phase = signal('busy');
    const writeSnapshot = jest.fn().mockReturnValue(true);
    const setSnapshot = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        ProposalFlowStore,
        { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
        {
          provide: HarnessSessionController,
          useValue: { session: () => ({ record, phase }) },
        },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            revisions,
            status: signal('ready'),
            config: signal({ name: 'Current' }),
            setSnapshot,
            bind: jest.fn(),
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: {
            writeSnapshot,
            readSnapshot: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '/ws' }) },
        },
      ],
    });
    const store = TestBed.inject(ProposalFlowStore);
    expect(store.changeTags().get('name')).toBe('changed');
    expect(store.restoreRevision('rev-1')).toBe(true);
    expect(writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        configUpdates: { name: 'Earlier' },
        fields: { name: expect.objectContaining({ source: 'user' }) },
      }),
    );
    expect(setSnapshot).toHaveBeenCalledWith(writeSnapshot.mock.calls[0][0]);
    expect(store.reviewEligible()).toBe(false);
    record.set({
      tabId: 'tab-1',
      workspacePath: '/ws',
      sessionId: 'session-1',
    });
    expect(store.reviewEligible()).toBe(true);
  });
  it.each(['reused', 'started'] as const)(
    'stops a conflicting %s session before its first proposal exists',
    async (rebindKind) => {
      const activeRecord = signal(null);
      const startCurrent = jest
        .fn()
        .mockResolvedValueOnce({
          kind: 'conflict',
          otherMode: 'configure-harness',
          otherTabId: 'other-tab',
        })
        .mockResolvedValueOnce({ kind: 'started', tabId: 'new-tab' });
      const startOther = jest
        .fn()
        .mockResolvedValue({ kind: rebindKind, tabId: 'other-tab' });
      const leave = jest.fn().mockResolvedValue('left');
      TestBed.configureTestingModule({
        providers: [
          ProposalFlowStore,
          { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
          {
            provide: HarnessSessionController,
            useValue: {
              session: (mode: string) =>
                mode === 'new-project'
                  ? {
                      record: activeRecord,
                      phase: signal('idle'),
                      start: startCurrent,
                    }
                  : { record: signal(null), start: startOther },
              activeSessionIn: () => ({
                mode: 'configure-harness',
                tabId: 'other-tab',
              }),
              leave,
            },
          },
          {
            provide: HarnessProposalHydrationService,
            useValue: {
              revisions: signal([]),
              status: signal('ready'),
              config: signal({}),
              bind: jest.fn(),
            },
          },
          {
            provide: HarnessBuilderRecordsService,
            useValue: {
              readSnapshot: jest.fn().mockReturnValue(null),
              readSession: jest.fn().mockReturnValue({
                mode: 'configure-harness',
                teamIntent: 'A research team',
              }),
            },
          },
          {
            provide: TabManagerService,
            useValue: { activeWorkspacePath: '/ws' },
          },
          {
            provide: VSCodeService,
            useValue: { config: signal({ workspaceRoot: '/ws' }) },
          },
        ],
      });
      const store = TestBed.inject(ProposalFlowStore);
      const request = {
        mode: 'new-project' as const,
        workspaceRoot: '/ws',
        intake: {
          what: 'A product',
          audience: 'unsure' as const,
          platform: 'node-ts' as const,
          stack: 'recommend' as const,
        },
      };
      expect(await store.start(request)).toBeNull();
      expect(await store.resolveConflict('discard')).toBe('new-tab');
      expect(startOther).toHaveBeenCalledWith({
        mode: 'configure-harness',
        workspaceRoot: '/ws',
        intent: 'A research team',
      });
      expect(leave).toHaveBeenCalledWith('configure-harness', 'discard');
    },
  );
  it('rebinds a session with an unavailable proposal so the composer can retry', async () => {
    const record = signal<{
      tabId: string;
      workspacePath: string;
      sessionId?: string;
    } | null>(null);
    const start = jest.fn().mockImplementation(async () => {
      record.set({ tabId: 'tab', workspacePath: '/ws', sessionId: 'session' });
      return { kind: 'reused', tabId: 'tab' };
    });
    const status = signal('loading');
    TestBed.configureTestingModule({
      providers: [
        ProposalFlowStore,
        { provide: HARNESS_FLOW_MODE, useValue: 'configure-harness' },
        {
          provide: HarnessSessionController,
          useValue: {
            session: () => ({
              record,
              phase: signal('done'),
              restore: jest.fn().mockResolvedValue('proposal-unavailable'),
              start,
            }),
            activeSessionIn: () => ({
              mode: 'configure-harness',
              tabId: 'tab',
            }),
          },
        },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            revisions: signal([]),
            status,
            config: signal({}),
            bind: jest
              .fn()
              .mockImplementation(async () => status.set('unavailable')),
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: {
            readSnapshot: jest.fn().mockReturnValue(null),
            readSession: jest.fn().mockReturnValue({
              mode: 'configure-harness',
              teamIntent: 'A research team',
            }),
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '/ws' }) },
        },
      ],
    });
    const store = TestBed.inject(ProposalFlowStore);
    await store.restore('tab');
    expect(start).toHaveBeenCalledWith({
      mode: 'configure-harness',
      workspaceRoot: '/ws',
      intent: 'A research team',
    });
    expect(record()?.tabId).toBe('tab');
    expect(store.restoreState()).toBe('proposal-unavailable');
  });
  it('compares canonical Windows and trailing-slash workspace roots for review and restore', async () => {
    const record = signal({
      tabId: 'tab',
      workspacePath: 'c:/work/repo',
      sessionId: 'session',
    });
    const restore = jest.fn();
    const bind = jest.fn().mockResolvedValue(undefined);
    const revisions = signal([
      { id: 'rev', ordinal: 1, config: { name: 'Repo' } },
    ]);
    const activePath = signal('C:\\Work\\Repo\\');
    const tabs = {
      get activeWorkspacePath() {
        return activePath();
      },
    };
    TestBed.configureTestingModule({
      providers: [
        ProposalFlowStore,
        { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
        {
          provide: HarnessSessionController,
          useValue: {
            session: () => ({ record, phase: signal('done'), restore }),
          },
        },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            revisions,
            status: signal('ready'),
            config: signal({ name: 'Repo' }),
            bind,
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: { readSnapshot: () => null },
        },
        { provide: TabManagerService, useValue: tabs },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '' }) },
        },
      ],
    });
    const store = TestBed.inject(ProposalFlowStore);
    expect(store.reviewEligible()).toBe(true);
    await store.restore('tab');
    expect(restore).not.toHaveBeenCalled();
    activePath.set('c:/work/repo/');
    expect(store.reviewEligible()).toBe(true);
    revisions.set([]);
    expect(store.reviewEligible()).toBe(false);
  });
  it('merges a restored revision with existing overrides and marks only changed fields', () => {
    const record = signal({
      tabId: 'tab',
      workspacePath: '/ws',
      sessionId: 's',
    });
    const revisions = signal([
      {
        id: 'old',
        ordinal: 1,
        config: {
          name: 'Old',
          prompt: { systemPrompt: 'same', enhancedSections: {} },
        },
      },
      {
        id: 'now',
        ordinal: 2,
        config: {
          name: 'Now',
          prompt: { systemPrompt: 'same', enhancedSections: {} },
        },
      },
    ]);
    const existing = {
      version: 1,
      workspaceRoot: '/ws',
      tabId: 'tab',
      configUpdates: { persona: { label: 'Chosen' } },
      fields: {
        persona: {
          source: 'user',
          chosenAt: '2026-10-30T00:00:00Z',
          updatedAt: '2026-10-30T00:00:00Z',
        },
      },
      lastApplied: { name: 'Previously applied' },
    };
    const writeSnapshot = jest.fn().mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        ProposalFlowStore,
        { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
        {
          provide: HarnessSessionController,
          useValue: { session: () => ({ record, phase: signal('done') }) },
        },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            revisions,
            status: signal('ready'),
            config: signal({ name: 'Now' }),
            bind: jest.fn(),
            setSnapshot: jest.fn(),
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: { readSnapshot: () => existing, writeSnapshot },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '/ws' }) },
        },
      ],
    });
    expect(TestBed.inject(ProposalFlowStore).restoreRevision('old')).toBe(true);
    const snapshot = writeSnapshot.mock.calls[0][0];
    expect(snapshot.configUpdates).toEqual({
      persona: { label: 'Chosen' },
      name: 'Old',
    });
    expect(snapshot.fields.persona).toEqual(existing.fields.persona);
    expect(snapshot.fields.name.source).toBe('user');
    expect(snapshot.fields.prompt).toBeUndefined();
    expect(snapshot.lastApplied).toEqual(existing.lastApplied);
  });
  it('removes a restored name override when the next revision matches the agent value', () => {
    const record = signal({
      tabId: 'tab',
      workspacePath: '/ws',
      sessionId: 's',
    });
    const revisions = signal([
      { id: 'old', ordinal: 1, config: { name: 'Old' } },
      { id: 'now', ordinal: 2, config: { name: 'Now' } },
    ]);
    const snapshots: Array<
      Parameters<HarnessBuilderRecordsService['writeSnapshot']>[0]
    > = [];
    const writeSnapshot = jest.fn(
      (
        snapshot: Parameters<HarnessBuilderRecordsService['writeSnapshot']>[0],
      ) => {
        snapshots.push(snapshot);
        return true;
      },
    );
    TestBed.configureTestingModule({
      providers: [
        ProposalFlowStore,
        { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
        {
          provide: HarnessSessionController,
          useValue: { session: () => ({ record, phase: signal('done') }) },
        },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            revisions,
            status: signal('ready'),
            config: signal({ name: 'Now' }),
            bind: jest.fn(),
            setSnapshot: jest.fn(),
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: {
            readSnapshot: () => snapshots.at(-1) ?? null,
            writeSnapshot,
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '/ws' }) },
        },
      ],
    });
    const store = TestBed.inject(ProposalFlowStore);
    expect(store.restoreRevision('old')).toBe(true);
    expect(snapshots[0].configUpdates.name).toBe('Old');
    expect(snapshots[0].fields.name?.source).toBe('user');
    expect(store.restoreRevision('now')).toBe(true);
    expect(snapshots[1].configUpdates.name).toBeUndefined();
    expect(snapshots[1].fields.name).toBeUndefined();
    expect(
      mergeHarnessConfigUpdates(
        revisions()[1].config,
        snapshots[1].configUpdates,
      ).name,
    ).toBe('Now');
  });
  it('reports an uncertain or throwing cancelled stop through notifications', async () => {
    const leave = jest
      .fn()
      .mockResolvedValueOnce('uncertain')
      .mockRejectedValueOnce(new Error('close failed'));
    const upsert = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        ProposalFlowStore,
        { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
        {
          provide: HarnessSessionController,
          useValue: {
            session: () => ({ record: signal(null), phase: signal('idle') }),
            leave,
          },
        },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            revisions: signal([]),
            status: signal('ready'),
            config: signal({}),
            bind: jest.fn(),
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: { readSnapshot: () => null },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '/ws' }) },
        },
        { provide: NotificationService, useValue: { upsert } },
      ],
    });
    const store = TestBed.inject(ProposalFlowStore);
    await expect(store.discardCancelledStart()).resolves.toBeUndefined();
    await expect(store.discardCancelledStart()).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(store.actionError()).toContain('Could not discard');
  });
});
