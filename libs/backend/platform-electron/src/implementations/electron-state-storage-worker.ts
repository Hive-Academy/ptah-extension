import { parentPort } from 'node:worker_threads';
import { createElectronStateWorkerMessageLoop } from './electron-state-storage-worker-loop';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

if (!parentPort) {
  throw new Error(
    'Electron state storage worker requires a worker_threads parent port',
  );
}
const workerParentPort = parentPort;

workerParentPort.on(
  'message',
  createElectronStateWorkerMessageLoop(new ElectronStateWorkerRuntime(), {
    postMessage: (value, transferList) =>
      workerParentPort.postMessage(value, transferList),
    terminate: () => process.exit(1),
  }),
);
