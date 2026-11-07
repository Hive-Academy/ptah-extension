import { WebSocket } from 'ws';
import type { WorkerPaths } from '@ptah-extension/worker-runtime';
import type {
  AdminMethod,
  WorkerMethodParams,
  WorkerMethodResult,
} from '@ptah-extension/worker-protocol';
import { runningEndpoint } from './status';

/**
 * Calls one admin method on the running worker. The admin key never leaves
 * this process: `auth` carries an HMAC of the key over the connection's
 * `hello` challenge, so a listener that is not the worker learns nothing it
 * can reuse. As an early refusal, `endpoint.json` must name a live process of
 * this user and `hello` must carry this machine's worker ID.
 */
export async function adminCall<M extends AdminMethod>(
  paths: WorkerPaths,
  method: M,
  params: WorkerMethodParams<M>,
): Promise<WorkerMethodResult<M>> {
  const { adminProof, readAdminKey, workerMachineId } =
    await import('@ptah-extension/worker-runtime');
  const { PROTOCOL_VERSION, parseResult } =
    await import('@ptah-extension/worker-protocol');
  const endpoint = await runningEndpoint(paths);
  const socket = new WebSocket(
    `ws://${endpoint.host === '::1' ? '[::1]' : endpoint.host}:${endpoint.port}/rpc`,
    { handshakeTimeout: 2000 },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const hello = parseResult(
      'hello',
      await request(socket, 'hello', {
        protocol: { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION },
        client: { name: 'ptah-worker', version: '1' },
      }),
    );
    const expected = workerMachineId();
    if (
      !hello.ok ||
      hello.value.worker.machineId !== expected ||
      endpoint.machineId !== expected ||
      !hello.value.adminChallenge
    )
      throw new Error(
        'The listener on the worker port is not this worker; no admin proof was sent.',
      );
    const key = await readAdminKey(paths);
    await request(socket, 'auth', {
      adminProof: adminProof(key, hello.value.adminChallenge),
    });
    const parsed = parseResult(method, await request(socket, method, params));
    if (!parsed.ok) throw new Error('Invalid worker response');
    return parsed.value;
  } finally {
    socket.close();
  }
}

function request(
  socket: WebSocket,
  method: string,
  params: unknown,
): Promise<unknown> {
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('worker service is not running'));
    }, 2000);
    const onMessage = (raw: Buffer) => {
      let frame: unknown;
      try {
        frame = JSON.parse(raw.toString('utf8'));
      } catch {
        // degradation-audit: reported - a non-JSON frame is not our reply; the
        // call still settles through its own reply or the 2 s timeout error.
        return;
      }
      if (
        !frame ||
        typeof frame !== 'object' ||
        !('id' in frame) ||
        frame.id !== id
      )
        return;
      cleanup();
      if ('ok' in frame && frame.ok === true && 'result' in frame)
        resolve(frame.result);
      else reject(new Error(`Worker command failed${errorCode(frame)}`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('worker service is not running'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('close', onClose);
    };
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.send(JSON.stringify({ v: 1, kind: 'req', id, method, params }));
  });
}

/** The wire error code of a refused reply, as `: CODE`, or nothing. */
function errorCode(frame: object): string {
  if (
    !('error' in frame) ||
    typeof frame.error !== 'object' ||
    frame.error === null ||
    !('code' in frame.error) ||
    typeof frame.error.code !== 'string'
  )
    return '';
  return `: ${frame.error.code}`;
}
