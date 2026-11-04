import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import type { WorkerPaths } from '@ptah-extension/worker-runtime';

export interface WorkerEndpoint {
  host: string;
  port: number;
}

export async function runningEndpoint(
  paths: WorkerPaths,
): Promise<WorkerEndpoint> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(paths.endpoint, 'utf8'));
  } catch {
    throw new Error('worker service is not running');
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
    throw new Error('worker service is not running');
  const endpoint = value as WorkerEndpoint;
  await new Promise<void>((resolve, reject) => {
    const socket = connect(endpoint.port, endpoint.host);
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      reject(new Error('worker service is not running'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('worker service is not running'));
    });
  });
  return endpoint;
}
