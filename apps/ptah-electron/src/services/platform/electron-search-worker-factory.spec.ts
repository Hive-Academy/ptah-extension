/**
 * ElectronSearchWorkerFactory — the fork uses the configured worker path in a
 * named utilityProcess, posts nothing itself (`SearchWorkerClient` sends
 * `init`), and reads the sqlite-vec path at every spawn so a respawn after a
 * late vec load picks it up.
 */
jest.mock('electron', () => {
  const utilityProcess = { fork: jest.fn() };
  return { __esModule: true, utilityProcess, default: { utilityProcess } };
});

import electron from 'electron';
import { ElectronSearchWorkerFactory } from './electron-search-worker-factory';

const fork = jest.mocked(electron.utilityProcess.fork);

describe('ElectronSearchWorkerFactory', () => {
  let child: { postMessage: jest.Mock; on: jest.Mock; kill: jest.Mock };

  beforeEach(() => {
    fork.mockReset();
    child = { postMessage: jest.fn(), on: jest.fn(), kill: jest.fn() };
    // A structural stand-in for Electron's UtilityProcess.
    fork.mockReturnValue(Object.assign(Object.create(null), child));
  });

  it('forks the configured worker path in a named utilityProcess without posting', () => {
    new ElectronSearchWorkerFactory('/dist/search-worker.mjs', '/db/ptah.sqlite', () => undefined).spawn();

    expect(fork).toHaveBeenCalledWith('/dist/search-worker.mjs', [], {
      serviceName: 'ptah-sqlite-search',
    });
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('reads the vec path at every call', () => {
    const resolveVecPath = jest
      .fn<string | undefined, []>()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('/unpacked/vec0.dll');
    const factory = new ElectronSearchWorkerFactory('/dist/search-worker.mjs', '/db/ptah.sqlite', resolveVecPath);

    expect(factory.databaseConfig()).toEqual({ dbPath: '/db/ptah.sqlite', vecPath: undefined });
    expect(factory.databaseConfig()).toEqual({ dbPath: '/db/ptah.sqlite', vecPath: '/unpacked/vec0.dll' });
  });
});
