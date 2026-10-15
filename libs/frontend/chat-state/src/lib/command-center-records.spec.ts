import { TestBed } from '@angular/core/testing';
import { CommandCenterRecordsService, type CommandCenterRunManifest } from './command-center-records';

const manifest: CommandCenterRunManifest = {
  runId: 'b5fa2ef3-a71c-4e13-8f33-b861f65e7744',
  rootTabId: 'root',
  rootSdkId: 'sdk',
  move: 'council',
  specTaskId: 'task',
  lanes: [{ laneId: 'lane-1', role: 'reviewer' }],
  rounds: 2,
  startedAt: 123,
};

describe('CommandCenterRecordsService', () => {
  let records: CommandCenterRecordsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    records = TestBed.inject(CommandCenterRecordsService);
  });

  it('writes and reads workspace-scoped last session and active marker', () => {
    expect(records.writeLastSession('/one', { sdkSessionId: 'sdk', tabId: 'root', updatedAt: 1 })).toBe(true);
    expect(records.setActiveTabId('/one', 'root')).toBe(true);
    expect(records.readLastSession('/one')).toEqual({ sdkSessionId: 'sdk', tabId: 'root', updatedAt: 1 });
    expect(records.readActiveTabId('/one')).toBe('root');
    expect(records.readLastSession('/two')).toBeUndefined();
    expect(records.readActiveTabId('/two')).toBeUndefined();
    expect(records.setActiveTabId('/one', null)).toBe(true);
    expect(records.readActiveTabId('/one')).toBeUndefined();
    expect(records.readLastSession('/one')?.sdkSessionId).toBe('sdk');
  });

  it('keeps last session after closing its tab and removes the run independently', () => {
    records.writeLastSession('/one', { sdkSessionId: 'sdk', tabId: 'root', updatedAt: 1 });
    records.writeRunManifest('/one', manifest);
    records.setActiveTabId('/one', null);
    records.removeRunManifest('/one', 'root');
    expect(records.readLastSession('/one')?.sdkSessionId).toBe('sdk');
    expect(records.readRunManifest('/one', 'root')).toBeUndefined();
    expect(records.readRunManifest('/two', 'root')).toBeUndefined();
  });

  it('round-trips run manifests by root and drops malformed entries', () => {
    expect(records.writeRunManifest('/one', manifest)).toBe(true);
    expect(records.readRunManifest('/one', 'root')).toEqual(manifest);
    const key = 'ptah.tabs.ws._2Fone.command-center';
    localStorage.setItem(key, JSON.stringify({
      lastSession: { sdkSessionId: 1, updatedAt: 'bad' },
      activeTabId: 7,
      runs: { root: { ...manifest, rounds: 'bad' }, other: manifest },
    }));
    expect(records.readLastSession('/one')).toBeUndefined();
    expect(records.readActiveTabId('/one')).toBeUndefined();
    expect(records.readRunManifest('/one', 'root')).toBeUndefined();
    expect(records.readRunManifest('/one', 'other')).toBeUndefined();
    localStorage.setItem(key, '{');
    expect(records.readRunManifest('/one', 'root')).toBeUndefined();
  });
});
