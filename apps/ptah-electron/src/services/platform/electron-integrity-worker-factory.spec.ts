/**
 * ElectronIntegrityWorkerFactory — asserts the adapter defers to
 * `electron.utilityProcess` and nothing else: the fork uses the CONFIGURED
 * path (a wrong path is the one failure that degrades silently to "never
 * checked"), no `init` is posted (unlike the embedder — this worker is
 * single-shot and takes the db path on the request), and the returned handle
 * maps `message`, `exit` and `kill` onto the child.
 */
jest.mock('electron', () => {
  const utilityProcess = { fork: jest.fn() };
  return { __esModule: true, utilityProcess, default: { utilityProcess } };
});

import electron from 'electron';
import { ElectronIntegrityWorkerFactory } from './electron-integrity-worker-factory';

const fork = (electron as unknown as { utilityProcess: { fork: jest.Mock } })
  .utilityProcess.fork;

function makeChild() {
  return {
    postMessage: jest.fn(),
    on: jest.fn(),
    kill: jest.fn(),
  };
}

/** Invokes the listener the adapter registered on the child for `event`. */
function emit(child: { on: jest.Mock }, event: string, arg: unknown): void {
  const call = child.on.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no listener registered for '${event}'`);
  (call[1] as (value: unknown) => void)(arg);
}

describe('ElectronIntegrityWorkerFactory', () => {
  let child: ReturnType<typeof makeChild>;

  beforeEach(() => {
    fork.mockReset();
    child = makeChild();
    fork.mockReturnValue(child);
  });

  it('forks the configured worker path in a named utilityProcess', () => {
    new ElectronIntegrityWorkerFactory('/dist/integrity-worker.mjs').spawn();

    expect(fork).toHaveBeenCalledTimes(1);
    expect(fork).toHaveBeenCalledWith('/dist/integrity-worker.mjs', [], {
      serviceName: 'ptah-integrity-worker',
    });
  });

  it('posts no init message — the worker takes the db path on the request', () => {
    new ElectronIntegrityWorkerFactory('/dist/integrity-worker.mjs').spawn();

    // The embedder factory posts an `init` here. This one must not: an extra
    // leading message would be parsed as an unrecognised request by a worker
    // that answers exactly once.
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('forwards postMessage and kill to the child', () => {
    const handle = new ElectronIntegrityWorkerFactory('/w.mjs').spawn();

    handle.postMessage({ type: 'check', id: 1, dbPath: '/db.sqlite' });
    handle.kill();

    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'check',
      id: 1,
      dbPath: '/db.sqlite',
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('delivers message payloads to the message listener', () => {
    const handle = new ElectronIntegrityWorkerFactory('/w.mjs').spawn();
    const onMessage = jest.fn();
    handle.on('message', onMessage);

    emit(child, 'message', { type: 'result', id: 1, verdict: 'ok' });

    expect(onMessage).toHaveBeenCalledWith({
      type: 'result',
      id: 1,
      verdict: 'ok',
    });
  });

  it('maps the numeric exit code onto the exit listener', () => {
    const handle = new ElectronIntegrityWorkerFactory('/w.mjs').spawn();
    const onExit = jest.fn();
    handle.on('exit', onExit);

    emit(child, 'exit', 0);
    emit(child, 'exit', 3);

    expect(onExit.mock.calls).toEqual([[0], [3]]);
  });

  it('spawns a fresh child per call — the worker is single-shot', () => {
    const factory = new ElectronIntegrityWorkerFactory('/w.mjs');
    const second = makeChild();
    fork.mockReturnValueOnce(child).mockReturnValueOnce(second);

    const a = factory.spawn();
    const b = factory.spawn();

    expect(fork).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);
  });
});
