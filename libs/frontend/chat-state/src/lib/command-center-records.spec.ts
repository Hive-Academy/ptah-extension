import { TestBed } from '@angular/core/testing';
import {
  CommandCenterRecordsService,
  type CommandCenterRunManifest,
} from './command-center-records';

const manifest: CommandCenterRunManifest = {
  runId: 'b5fa2ef3-a71c-4e13-8f33-b861f65e7744',
  rootTabId: 'root',
  rootSdkId: 'sdk',
  move: 'council',
  specTaskId: 'task',
  lanes: [{ laneId: 'lane-1' }],
  rounds: 2,
  startedAt: 123,
};
const sibling: CommandCenterRunManifest = {
  ...manifest,
  runId: 'ca22a5f9-0871-4a9c-a68d-2a0c0774a14d',
  startedAt: 100,
};
const otherRoot: CommandCenterRunManifest = {
  ...manifest,
  runId: '64d98ce1-8ab0-45dc-9dfb-56f519ac5328',
  rootTabId: 'other',
};

describe('CommandCenterRecordsService', () => {
  let records: CommandCenterRecordsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    records = TestBed.inject(CommandCenterRecordsService);
  });

  it('keeps last session and active marker scoped to their workspace', () => {
    expect(
      records.writeLastSession('/one', {
        sdkSessionId: 'sdk',
        tabId: 'root',
        updatedAt: 1,
      }),
    ).toBe(true);
    expect(records.setActiveTabId('/one', 'root')).toBe(true);
    expect(records.readLastSession('/one')).toEqual({
      sdkSessionId: 'sdk',
      tabId: 'root',
      updatedAt: 1,
    });
    expect(records.readActiveTabId('/one')).toBe('root');
    expect(records.readLastSession('/two')).toBeUndefined();
    expect(records.readActiveTabId('/two')).toBeUndefined();
    expect(records.setActiveTabId('/one', null)).toBe(true);
    expect(records.readActiveTabId('/one')).toBeUndefined();
    expect(records.readLastSession('/one')?.sdkSessionId).toBe('sdk');
  });

  it('keeps two role-less runs under one root after reload, sorted by start time', () => {
    expect(records.writeRunManifest('/one', manifest)).toBe(true);
    expect(records.writeRunManifest('/one', sibling)).toBe(true);
    expect(records.readRunManifests('/one', 'root')).toEqual([
      sibling,
      manifest,
    ]);
    expect(
      TestBed.inject(CommandCenterRecordsService).readRunManifests(
        '/one',
        'root',
      ),
    ).toEqual([sibling, manifest]);
    expect(records.readRunManifests('/two', 'root')).toEqual([]);
  });

  it('migrates old root-keyed records on the next write and retains role values', () => {
    const key = 'ptah.tabs.ws._2Fone.command-center';
    const old = {
      ...manifest,
      lanes: [{ laneId: 'lane-1', role: 'reviewer' }],
    };
    localStorage.setItem(key, JSON.stringify({ runs: { root: old } }));
    expect(records.readRunManifests('/one', 'root')).toEqual([old]);
    expect(records.writeRunManifest('/one', sibling)).toBe(true);
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as {
      runs: Record<string, unknown>;
    };
    expect(Object.keys(stored.runs).sort()).toEqual(
      [manifest.runId, sibling.runId].sort(),
    );
    expect(records.readRunManifests('/one', 'root')).toEqual([sibling, old]);
  });

  it.each(['run-first', 'root-first'])(
    'keeps the run-keyed body when stored %s',
    (order) => {
      const key = 'ptah.tabs.ws._2Fone.command-center';
      const runBody = {
        ...manifest,
        startedAt: 200,
        lanes: [{ laneId: 'new' }],
      };
      const rootBody = {
        ...manifest,
        startedAt: 100,
        lanes: [{ laneId: 'old' }],
      };
      const entries =
        order === 'run-first'
          ? [
              [manifest.runId, runBody],
              [manifest.rootTabId, rootBody],
            ]
          : [
              [manifest.rootTabId, rootBody],
              [manifest.runId, runBody],
            ];
      localStorage.setItem(
        key,
        JSON.stringify({ runs: Object.fromEntries(entries) }),
      );
      expect(records.readRunManifests('/one', 'root')).toEqual([runBody]);
      expect(records.writeRunManifest('/one', sibling)).toBe(true);
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        runs: Record<string, unknown>;
      };
      expect(stored.runs).toEqual({
        [manifest.runId]: runBody,
        [sibling.runId]: sibling,
      });
    },
  );

  it('keeps the newer of two root-keyed bodies for one run', () => {
    const key = 'ptah.tabs.ws._2Fone.command-center';
    const older = { ...manifest, startedAt: 100 };
    const newer = { ...manifest, rootTabId: 'other', startedAt: 200 };
    localStorage.setItem(
      key,
      JSON.stringify({ runs: { other: newer, root: older } }),
    );
    expect(records.readRunManifests('/one', 'other')).toEqual([newer]);
    expect(records.readRunManifests('/one', 'root')).toEqual([]);
  });

  it('drops corrupt and mismatched entries without losing valid runs', () => {
    const key = 'ptah.tabs.ws._2Fone.command-center';
    localStorage.setItem(
      key,
      JSON.stringify({
        lastSession: { sdkSessionId: 1, updatedAt: 'bad' },
        activeTabId: 7,
        runs: {
          [manifest.runId]: manifest,
          [sibling.runId]: { ...sibling, rounds: 'bad' },
          unrelated: otherRoot,
        },
      }),
    );
    expect(records.readLastSession('/one')).toBeUndefined();
    expect(records.readActiveTabId('/one')).toBeUndefined();
    expect(records.readRunManifests('/one', 'root')).toEqual([manifest]);
    expect(records.readRunManifests('/one', 'other')).toEqual([]);
    localStorage.setItem(key, '{');
    expect(records.readRunManifests('/one', 'root')).toEqual([]);
  });

  it('rejects an empty role while accepting absent and non-empty roles', () => {
    expect(
      records.writeRunManifest('/one', {
        ...manifest,
        lanes: [{ laneId: 'lane-1', role: '' }],
      }),
    ).toBe(false);
    expect(records.readRunManifests('/one', 'root')).toEqual([]);
    expect(records.writeRunManifest('/one', manifest)).toBe(true);
    expect(
      records.writeRunManifest('/one', {
        ...sibling,
        lanes: [{ laneId: 'lane-2', role: 'reviewer' }],
      }),
    ).toBe(true);
    expect(records.readRunManifests('/one', 'root')).toHaveLength(2);
  });

  it('removes one run or every run of a root without touching other roots or last session', () => {
    records.writeLastSession('/one', {
      sdkSessionId: 'sdk',
      tabId: 'root',
      updatedAt: 1,
    });
    records.writeRunManifest('/one', manifest);
    records.writeRunManifest('/one', sibling);
    records.writeRunManifest('/one', otherRoot);
    expect(records.removeRunManifest('/one', manifest.runId)).toBe(true);
    expect(records.readRunManifests('/one', 'root')).toEqual([sibling]);
    expect(records.removeRunManifests('/one', 'root')).toBe(true);
    expect(records.readRunManifests('/one', 'root')).toEqual([]);
    expect(records.readRunManifests('/one', 'other')).toEqual([otherRoot]);
    expect(records.readLastSession('/one')?.sdkSessionId).toBe('sdk');
  });
});
