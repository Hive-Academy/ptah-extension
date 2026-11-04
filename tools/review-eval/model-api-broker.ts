import { createServer, type Server } from 'node:net';
import { z } from 'zod';

const brokerRequest = z.object({
  method: z.literal('POST'),
  path: z.enum(['/v1/responses', '/v1/chat/completions']),
  body: z.string().max(4_000_000),
}).strict();
const brokerConfig = z.object({
  endpoint: z.literal('https://api.openai.com/'),
  credential: z.string().min(1),
  socketPath: z.string().min(1),
}).strict();
export type BrokerRequest = z.infer<typeof brokerRequest>;
export type BrokerEvent = { method: string; path: string; allowed: boolean; reason?: string };

export class ModelBrokerDeniedError extends Error {
  readonly code = 'MODEL_BROKER_DENIED';
  constructor(reason: string) { super(reason); this.name = 'ModelBrokerDeniedError'; }
}

export function validateModelCall(input: unknown): BrokerRequest {
  const parsed = brokerRequest.safeParse(input);
  if (!parsed.success) throw new ModelBrokerDeniedError('Method or model path denied');
  return parsed.data;
}

/** A host-only, path restricted broker. The namespace proxy sends newline framed JSON over the bound Unix socket. */
export function createModelApiBroker(input: unknown, onEvent: (event: BrokerEvent) => void,
  transport: typeof fetch = fetch): Server {
  const parsedConfig = brokerConfig.safeParse(input);
  if (!parsedConfig.success) throw new ModelBrokerDeniedError('Broker configuration denied');
  const config = parsedConfig.data;
  const origin = new URL(config.endpoint);
  return createServer(socket => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4_100_000) { socket.destroy(); return; }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const frame = buffer.slice(0, newline);
      buffer = '';
      void (async () => {
        let untrusted: unknown;
        try { untrusted = JSON.parse(frame); } catch { untrusted = undefined; }
        let call: BrokerRequest;
        try { call = validateModelCall(untrusted); }
        catch { onEvent({ method: 'unknown', path: 'unknown', allowed: false, reason: 'invalid request' }); socket.end('{"error":"denied"}\n'); return; }
        const url = new URL(call.path, origin);
        if (url.origin !== origin.origin) { onEvent({ method: call.method, path: call.path, allowed: false, reason: 'origin mismatch' }); socket.end('{"error":"denied"}\n'); return; }
        try {
          const response = await transport(url, { method: call.method, body: call.body,
            headers: { Authorization: `Bearer ${config.credential}`, 'Content-Type': 'application/json' }, redirect: 'manual' });
          if (response.status >= 300 && response.status < 400) throw new ModelBrokerDeniedError('Redirect denied');
          onEvent({ method: call.method, path: call.path, allowed: true });
          socket.end(JSON.stringify({ status: response.status, body: await response.text() }) + '\n');
        } catch {
          onEvent({ method: call.method, path: call.path, allowed: false, reason: 'transport failure or redirect' });
          socket.end('{"error":"denied"}\n');
        }
      })();
    });
  });
}
