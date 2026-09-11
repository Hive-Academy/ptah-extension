import { parentPort } from 'node:worker_threads';
import {
  assertElectronStateWorkerPayloadWithinBudget,
  parseElectronStateWorkerRequest,
  parseElectronStateWorkerResponse,
  type ElectronStateWorkerResponse,
} from './electron-state-storage-worker-protocol';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

if (!parentPort) {
  throw new Error(
    'Electron state storage worker requires a worker_threads parent port',
  );
}
const workerParentPort = parentPort;

const runtime = new ElectronStateWorkerRuntime();
let requestChain = Promise.resolve();

workerParentPort.on('message', (input: unknown) => {
  requestChain = requestChain.then(async () => {
    let response: ElectronStateWorkerResponse;
    try {
      const request = parseElectronStateWorkerRequest(input);
      response = await runtime.handle(request);
    } catch {
      const operationId =
        input !== null &&
        typeof input === 'object' &&
        Number.isSafeInteger((input as { operationId?: unknown }).operationId)
          ? ((input as { operationId: number }).operationId ?? 1)
          : 1;
      response = {
        type: 'failure',
        operationId,
        code: 'invalid-request',
      };
    }
    assertElectronStateWorkerPayloadWithinBudget(response);
    const parsedResponse = parseElectronStateWorkerResponse(response);
    const transferList =
      parsedResponse.type === 'snapshot-page'
        ? parsedResponse.operations.flatMap((operation) =>
            operation.kind === 'string-slice' ? [operation.bytes.buffer] : [],
          )
        : [];
    workerParentPort.postMessage(parsedResponse, transferList);
  });
});
