import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import type {
  WorkerEndpointRecord,
  WorkerPaths,
} from '@ptah-extension/worker-runtime';

/**
 * No worker service runs: `endpoint.json` is missing or invalid, its owner
 * process is dead, or nothing accepts on its port. A local command may then
 * fall back to editing the worker files itself.
 */
export class WorkerNotRunningError extends Error {
  readonly code = 'WORKER_NOT_RUNNING';
  constructor() {
    super('worker service is not running');
    this.name = 'WorkerNotRunningError';
  }
}

/**
 * The running worker's endpoint. Throws {@link WorkerNotRunningError} when no
 * worker runs, and a plain error when the record cannot prove its owner (an
 * older worker, or a live process of another user).
 */
export async function runningEndpoint(
  paths: WorkerPaths,
): Promise<WorkerEndpointRecord> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(paths.endpoint, 'utf8'));
  } catch {
    throw new WorkerNotRunningError();
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('host' in value) ||
    !('port' in value) ||
    (value.host !== '127.0.0.1' && value.host !== '::1') ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  )
    throw new WorkerNotRunningError();
  if (
    !('pid' in value) ||
    !('machineId' in value) ||
    typeof value.pid !== 'number' ||
    typeof value.machineId !== 'string'
  )
    throw new Error(
      'worker endpoint.json does not name its owner; restart the worker service',
    );
  const endpoint: WorkerEndpointRecord = {
    host: value.host,
    port: value.port,
    pid: value.pid,
    machineId: value.machineId,
  };
  const { processState } = await import('@ptah-extension/worker-runtime');
  const owner = processState(endpoint.pid);
  if (owner === 'dead') throw new WorkerNotRunningError();
  if (owner === 'foreign')
    throw new Error(
      'worker endpoint.json names a process of another user; the admin key was not sent',
    );
  await new Promise<void>((resolve, reject) => {
    const socket = connect(endpoint.port, endpoint.host);
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      reject(new WorkerNotRunningError());
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new WorkerNotRunningError());
    });
  });
  return endpoint;
}
