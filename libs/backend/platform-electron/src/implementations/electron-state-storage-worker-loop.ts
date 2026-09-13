import {
  ElectronStateWorkerProtocolError,
  assertElectronStateWorkerPayloadWithinBudget,
  parseElectronStateWorkerRequest,
  parseElectronStateWorkerResponse,
  type ElectronStateWorkerFailureCode,
  type ElectronStateWorkerRequest,
  type ElectronStateWorkerResponse,
} from './electron-state-storage-worker-protocol';

export interface ElectronStateWorkerMessagePort {
  postMessage(value: unknown, transferList?: ArrayBuffer[]): void;
}

export interface ElectronStateWorkerRequestHandler {
  handle(
    request: ElectronStateWorkerRequest,
  ): Promise<ElectronStateWorkerResponse>;
}

export type ElectronStateWorkerMessageListener = (input: unknown) => void;

function operationIdOf(input: unknown): number {
  if (input === null || typeof input !== 'object') return 1;
  const candidate = (input as { operationId?: unknown }).operationId;
  return typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate > 0
    ? candidate
    : 1;
}

function transferListOf(response: ElectronStateWorkerResponse): ArrayBuffer[] {
  if (
    response.type !== 'snapshot-page' &&
    response.type !== 'value-paged' &&
    response.type !== 'scalar-page'
  ) {
    return [];
  }
  return response.operations.flatMap((operation) =>
    operation.kind === 'string-slice'
      ? [operation.bytes.buffer as ArrayBuffer]
      : [],
  );
}

function postFailure(
  port: ElectronStateWorkerMessagePort,
  operationId: number,
  code: ElectronStateWorkerFailureCode,
): void {
  try {
    port.postMessage({ type: 'failure', operationId, code });
  } catch {
    // degradation-audit: optional-capability - the port itself refused a
    // three-field failure record, so there is no channel left to report on.
    // The host's pending request surfaces through its own crash or handshake
    // path, and the request chain must keep serving later operations.
  }
}

async function processMessage(
  handler: ElectronStateWorkerRequestHandler,
  port: ElectronStateWorkerMessagePort,
  input: unknown,
): Promise<void> {
  let request: ElectronStateWorkerRequest | null = null;
  try {
    request = parseElectronStateWorkerRequest(input);
  } catch {
    postFailure(port, operationIdOf(input), 'invalid-request');
  }
  if (!request) return;
  let code: ElectronStateWorkerFailureCode = 'internal-error';
  try {
    const response = await handler.handle(request);
    code = 'response-too-large';
    assertElectronStateWorkerPayloadWithinBudget(response);
    code = 'internal-error';
    const parsed = parseElectronStateWorkerResponse(response);
    port.postMessage(parsed, transferListOf(parsed));
  } catch (error: unknown) {
    postFailure(
      port,
      request.operationId,
      error instanceof ElectronStateWorkerProtocolError &&
        error.code === 'PAYLOAD_TOO_LARGE'
        ? 'response-too-large'
        : code,
    );
  }
}

export function createElectronStateWorkerMessageLoop(
  handler: ElectronStateWorkerRequestHandler,
  port: ElectronStateWorkerMessagePort,
): ElectronStateWorkerMessageListener {
  let chain: Promise<void> = Promise.resolve();
  return (input: unknown) => {
    const run = (): Promise<void> => processMessage(handler, port, input);
    chain = chain.then(run, run);
  };
}
