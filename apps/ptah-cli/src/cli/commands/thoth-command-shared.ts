import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

export function oneshot(): {
  mode: 'full';
  requireSdk: false;
  thoth: 'oneshot';
} {
  return { mode: 'full', requireSdk: false, thoth: 'oneshot' };
}

export async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
