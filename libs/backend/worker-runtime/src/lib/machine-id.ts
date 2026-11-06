import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * This machine's worker ID, as the worker reports it in `hello` and grants.
 * Derived from the host name, so the service and the local operator commands
 * compute the same value.
 */
export function workerMachineId(host: string = hostname()): string {
  return `machine_${createHash('sha256').update(host).digest('hex').slice(0, 16)}`;
}
