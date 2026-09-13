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
  terminate(): void;
}

type FailureResponse = Extract<
  ElectronStateWorkerResponse,
  { type: 'failure' }
>;

const COMMIT_REQUEST_TYPES: ReadonlySet<ElectronStateWorkerRequest['type']> =
  new Set([
    'update',
    'delete',
    'commit-scalar-write',
    'commit-json-sequence-write',
    'split-array-value',
  ]);

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

function failureRecord(
  operationId: number,
  code: ElectronStateWorkerFailureCode,
): FailureResponse {
  return { type: 'failure', operationId, code };
}

function undeliveredResponseFailure(
  request: ElectronStateWorkerRequest,
  response: ElectronStateWorkerResponse,
): FailureResponse {
  if (response.type === 'failure') return response;
  if (COMMIT_REQUEST_TYPES.has(request.type)) {
    return {
      type: 'failure',
      operationId: request.operationId,
      code: 'commit-failed',
      landed: true,
    };
  }
  return failureRecord(request.operationId, 'internal-error');
}

function postFailure(
  port: ElectronStateWorkerMessagePort,
  failure: FailureResponse,
): boolean {
  let delivered = true;
  try {
    port.postMessage(failure);
  } catch {
    delivered = false;
    port.terminate();
  }
  return delivered;
}

async function processMessage(
  handler: ElectronStateWorkerRequestHandler,
  port: ElectronStateWorkerMessagePort,
  input: unknown,
): Promise<boolean> {
  let request: ElectronStateWorkerRequest;
  try {
    request = parseElectronStateWorkerRequest(input);
  } catch {
    return postFailure(
      port,
      failureRecord(operationIdOf(input), 'invalid-request'),
    );
  }
  let code: ElectronStateWorkerFailureCode = 'internal-error';
  let parsed: ElectronStateWorkerResponse;
  try {
    const response = await handler.handle(request);
    code = 'response-too-large';
    assertElectronStateWorkerPayloadWithinBudget(response);
    code = 'internal-error';
    parsed = parseElectronStateWorkerResponse(response);
  } catch (error: unknown) {
    return postFailure(
      port,
      failureRecord(
        request.operationId,
        error instanceof ElectronStateWorkerProtocolError &&
          error.code === 'PAYLOAD_TOO_LARGE'
          ? 'response-too-large'
          : code,
      ),
    );
  }
  try {
    port.postMessage(parsed, transferListOf(parsed));
    return true;
  } catch {
    return postFailure(port, undeliveredResponseFailure(request, parsed));
  }
}

export function createElectronStateWorkerMessageLoop(
  handler: ElectronStateWorkerRequestHandler,
  port: ElectronStateWorkerMessagePort,
): ElectronStateWorkerMessageListener {
  let chain: Promise<void> = Promise.resolve();
  let terminated = false;
  return (input: unknown) => {
    const run = async (): Promise<void> => {
      if (terminated) return;
      terminated = !(await processMessage(handler, port, input));
    };
    chain = chain.then(run, run);
  };
}
