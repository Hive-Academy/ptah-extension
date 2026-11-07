/**
 * ElectronWalCheckpointWorkerFactory — the fork uses the configured path under
 * its own service name, posts nothing on spawn, and the handle maps `message`
 * and `kill` onto the child.
 */
jest.mock('electron', () => {
  const utilityProcess = { fork: jest.fn() };
  return { __esModule: true, utilityProcess, default: { utilityProcess } };
});

import electron from 'electron';
import { ElectronWalCheckpointWorkerFactory } from './electron-wal-checkpoint-worker-factory';

function forkMock(): jest.Mock {
  const utilityProcess: unknown = Reflect.get(electron, 'utilityProcess');
  const candidate: unknown =
    typeof utilityProcess === 'object' && utilityProcess !== null
      ? Reflect.get(utilityProcess, 'fork')
      : undefined;
  if (!jest.isMockFunction(candidate)) {
    throw new Error('electron.utilityProcess.fork is not mocked');
  }
  return candidate;
}

const fork = forkMock();

function makeChild() {
  return { postMessage: jest.fn(), on: jest.fn(), kill: jest.fn() };
}

describe('ElectronWalCheckpointWorkerFactory', () => {
  let child: ReturnType<typeof makeChild>;

  beforeEach(() => {
    fork.mockReset();
    child = makeChild();
    fork.mockReturnValue(child);
  });

  it('forks the configured worker path in a named utilityProcess and posts nothing', () => {
    new ElectronWalCheckpointWorkerFactory('/dist/wal-checkpoint-worker.mjs').spawn();

    expect(fork).toHaveBeenCalledWith('/dist/wal-checkpoint-worker.mjs', [], {
      serviceName: 'ptah-wal-checkpoint-worker',
    });
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('forwards messages and kill to the child', () => {
    const worker = new ElectronWalCheckpointWorkerFactory('/w.mjs').spawn();
    const onMessage = jest.fn();
    worker.on('message', onMessage);
    const listener: unknown = child.on.mock.calls.find(
      ([name]) => name === 'message',
    )?.[1];
    if (typeof listener !== 'function') throw new Error('no message listener');
    listener({ type: 'checkpoint-result' });

    worker.postMessage({ type: 'checkpoint' });
    worker.kill();

    expect(onMessage).toHaveBeenCalledWith({ type: 'checkpoint-result' });
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'checkpoint' });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
