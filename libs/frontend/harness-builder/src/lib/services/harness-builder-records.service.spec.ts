import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import {
  commitBuilderUpdates,
  fullConfig,
} from '../components/sidebar/builder-sidebar-helpers';
import { HarnessProposalHydrationService } from './harness-proposal-hydration.service';
import { HarnessRpcService } from './harness-rpc.service';
import {
  HARNESS_RECORD_PREFIX,
  HarnessBuilderRecordsService,
  type HarnessUserSnapshot,
} from './harness-builder-records.service';

const root = '/workspace/a';
const at = '2026-10-15T10:00:00.000Z';

function snapshot(tabId: string): HarnessUserSnapshot {
  return {
    version: 1,
    workspaceRoot: root,
    tabId,
    configUpdates: {
      persona: { label: 'Builder', description: 'Build', goals: [] },
    },
    fields: { persona: { source: 'user', chosenAt: at, updatedAt: at } },
  };
}

describe('HarnessBuilderRecordsService', () => {
  let records: HarnessBuilderRecordsService;
  let hydration: HarnessProposalHydrationService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        HarnessBuilderRecordsService,
        HarnessProposalHydrationService,
        {
          provide: HarnessRpcService,
          useValue: {
            getProposal: jest.fn().mockResolvedValue({ proposal: null }),
          },
        },
        {
          provide: LoggingService,
          useValue: { warn: jest.fn(), error: jest.fn() },
        },
      ],
    });
    records = TestBed.inject(HarnessBuilderRecordsService);
    hydration = TestBed.inject(HarnessProposalHydrationService);
  });

  it('round trips a snapshot only for its pinned workspace and tab', () => {
    expect(records.writeSnapshot(snapshot('tab-1'))).toBe(true);
    expect(records.readSnapshot(root, 'tab-1')).toEqual(snapshot('tab-1'));
    expect(records.readSnapshot('/workspace/b', 'tab-1')).toBeNull();
    expect(records.readSnapshot(root, 'tab-2')).toBeNull();
  });

  it('keeps a loaded preset name and Claude MD choices through Apply', async () => {
    await hydration.bind(root, 'tab-1', []);
    const preset = fullConfig({}, root);
    preset.name = 'Preset name';
    preset.claudeMd.generateProjectClaudeMd = false;
    preset.claudeMd.customSections = { Notes: 'Keep this section' };
    commitBuilderUpdates(records, hydration, root, 'tab-1', {}, preset);
    const saved = records.readSnapshot(root, 'tab-1');
    expect(saved?.configUpdates.name).toBe('Preset name');
    expect(saved?.configUpdates.claudeMd?.generateProjectClaudeMd).toBe(false);
    expect(fullConfig(hydration.config(), root).claudeMd).toEqual(
      preset.claudeMd,
    );
    expect(fullConfig(hydration.config(), root).name).toBe('Preset name');
  });

  it('deletes invalid version, mismatched key and malformed shape independently', () => {
    records.writeSnapshot(snapshot('good'));
    const cases = [
      { version: 2 },
      { tabId: 'another-tab' },
      {
        fields: { persona: { source: 'user', chosenAt: 'bad', updatedAt: at } },
      },
    ];
    for (const [index, change] of cases.entries()) {
      const tabId = `bad-${index}`;
      const key = `${HARNESS_RECORD_PREFIX}.snapshot.${encodeURIComponent(root)}.${tabId}`;
      localStorage.setItem(
        key,
        JSON.stringify({ ...snapshot(tabId), ...change }),
      );
      expect(records.readSnapshot(root, tabId)).toBeNull();
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(records.readSnapshot(root, 'good')).toEqual(snapshot('good'));
  });

  it('validates stack details and removes only a malformed stack record', () => {
    const result = {
      success: true as const,
      seedPrompt: 'start',
      intake: {
        what: 'Project',
        audience: 'internal' as const,
        stack: 'recommend' as const,
      },
      plugins: {
        enabledBundled: ['core'],
        missingExternal: [],
        availableSkillIds: ['review'],
      },
    };
    expect(records.writeStackProfile(root, 'tab-1', result)).toBe(true);
    expect(
      records.readStackProfile(root, 'tab-1')?.plugins.enabledBundled,
    ).toEqual(['core']);
    const key = `${HARNESS_RECORD_PREFIX}.stack.${encodeURIComponent(root)}.tab-1`;
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(
      key,
      JSON.stringify({ ...saved, plugins: { enabledBundled: 'bad' } }),
    );
    expect(records.readStackProfile(root, 'tab-1')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('replacing a draft purges the old tab without touching another tab or workspace', () => {
    records.writeSnapshot(snapshot('old'));
    records.writeSnapshot(snapshot('other'));
    records.writeDraft(root, 'configure-harness', 'old');
    expect(records.replaceDraft(root, 'configure-harness', 'new')).toBe(true);
    expect(records.readDraft(root, 'configure-harness')?.tabId).toBe('new');
    expect(records.readSnapshot(root, 'old')).toBeNull();
    expect(records.readSnapshot(root, 'other')).toEqual(snapshot('other'));
    expect(records.readDraft('/workspace/b', 'configure-harness')).toBeNull();
  });

  it('sweeps orphan tabs and clears a closed tab without resurrection', () => {
    records.writeSnapshot(snapshot('closed'));
    records.writeSnapshot(snapshot('live'));
    records.writeDraft(root, 'configure-harness', 'closed');
    records.sweepOrphans(root, new Set(['live']));
    expect(records.readSnapshot(root, 'closed')).toBeNull();
    expect(records.readDraft(root, 'configure-harness')).toBeNull();
    expect(records.readSnapshot(root, 'live')).toEqual(snapshot('live'));
    records.clearTab(root, 'live');
    expect(records.readSnapshot(root, 'live')).toBeNull();
  });
});

describe('Harness session record persistence', () => {
  it('round trips through strict zod validation and clears with the tab', () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [
      HarnessBuilderRecordsService,
      { provide: LoggingService, useValue: { warn: jest.fn(), error: jest.fn() } },
    ] });
    const records = TestBed.inject(HarnessBuilderRecordsService);
    const session = {
      version: 1 as const, tabId: 'tab-session', mode: 'new-project' as const,
      workspacePath: root, intake: { what: 'Scheduler', audience: 'b2b' as const, stack: 'recommend' as const },
      intakeHash: 'abc', sendAttempt: { count: 1, ackedAt: at },
    };
    expect(records.writeSession(session)).toBe(true);
    expect(records.readSession(root, 'tab-session')).toEqual(session);
    const key = `${HARNESS_RECORD_PREFIX}.session.${encodeURIComponent(root)}.tab-session`;
    localStorage.setItem(key, JSON.stringify({ ...session, unexpected: true }));
    expect(records.readSession(root, 'tab-session')).toBeNull();
    expect(records.writeSession(session)).toBe(true);
    records.clearTab(root, 'tab-session');
    expect(records.readSession(root, 'tab-session')).toBeNull();
  });
});
