import 'reflect-metadata';
import * as http from 'http';
import https from 'https';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { CodexTranslationProxy } from './codex-translation-proxy';
import type { ICodexAuthService } from './codex-provider.types';

const response = {
  status: 'completed',
  output: [
    { type: 'message', content: [{ type: 'output_text', text: 'summary' }] },
  ],
  usage: { input_tokens: 10, output_tokens: 2 },
};

function post(
  url: string,
  stream: boolean | undefined,
  requestBody: Record<string, unknown> = {},
) {
  return new Promise<{ body: string; type: string | undefined }>(
    (resolve, reject) => {
      const req = http.request(
        `${url}/v1/messages`,
        { method: 'POST' },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () =>
            resolve({ body, type: res.headers['content-type'] }),
          );
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(
        JSON.stringify({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 50,
          stream,
          ...requestBody,
        }),
      );
    },
  );
}

function createAuth(endpoint: string): ICodexAuthService {
  return {
    getApiEndpoint: () => endpoint,
    getHeaders: async () => ({ 'content-type': 'application/json' }),
    ensureTokensFresh: async () => false,
    isAuthenticated: async () => true,
    listModels: async () => [],
    clearCache: () => undefined,
    getTokenStatus: async () => ({ authenticated: true, stale: false }),
    startWatchingAuthFile: () => undefined,
    stopWatchingAuthFile: () => undefined,
  };
}

describe('Codex upstream transport selection', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['https://chatgpt.com/backend-api/codex', false, true],
    ['https://chatgpt.com/backend-api/codex', undefined, true],
    ['https://chatgpt.com/backend-api/codex', true, true],
    ['https://api.openai.com/v1', false, false],
    ['https://api.openai.com/v1', undefined, false],
    ['https://example.com/backend-api/codex', false, false],
    ['https://chatgpt.com/other', false, false],
  ] as const)(
    '%s caller stream=%s upstream stream=%s',
    async (endpoint, stream, upstreamStream) => {
      let body = '';
      const fakeRequest = new EventEmitter() as EventEmitter & {
        write: (chunk: string) => void;
        end: () => void;
        destroy: () => void;
      };
      fakeRequest.write = (chunk) => {
        body += chunk;
      };
      fakeRequest.destroy = () => {
        fakeRequest.emit('close');
      };
      jest.spyOn(https, 'request').mockImplementation((...args: unknown[]) => {
        const callback = args[2] as (res: http.IncomingMessage) => void;
        fakeRequest.end = () => {
          const upstream = new PassThrough() as PassThrough & {
            statusCode: number;
            headers: object;
          };
          upstream.statusCode = 200;
          upstream.headers = {};
          callback(upstream as unknown as http.IncomingMessage);
          if (upstreamStream) {
            upstream.end(
              'data: {"type":"response.output_text.delta","delta":"summary"}\n\n' +
                `data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`,
            );
          } else upstream.end(JSON.stringify(response));
        };
        return fakeRequest as unknown as http.ClientRequest;
      });
      const auth = createAuth(endpoint);
      const proxy = new CodexTranslationProxy(
        createMockLogger() as unknown as Logger,
        auth,
      );
      try {
        const { url } = await proxy.start();
        const result = await post(url, stream);
        expect(JSON.parse(body).stream).toBe(upstreamStream ? true : undefined);
        if (stream) {
          expect(result.type).toBe('text/event-stream');
          expect(result.body).toContain('event: message_stop');
        } else {
          expect(result.type).toContain('application/json');
          expect(JSON.parse(result.body)).toMatchObject({
            content: [{ type: 'text', text: 'summary' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 2 },
          });
        }
      } finally {
        await proxy.stop();
      }
    },
  );

  it.each([
    ['omitted', { description: 'inspect', prompt: 'check it' }],
    [
      'explicit worktree',
      { description: 'inspect', prompt: 'check it', isolation: 'worktree' },
    ],
  ] as const)(
    'preserves optional Agent isolation in the final request and %s input in the response',
    async (_label, agentInput) => {
      let outboundBody = '';
      const fakeRequest = new EventEmitter() as EventEmitter & {
        write: (chunk: string) => void;
        end: () => void;
        destroy: () => void;
      };
      fakeRequest.write = (chunk) => {
        outboundBody += chunk;
      };
      fakeRequest.destroy = () => {
        fakeRequest.emit('close');
      };
      jest.spyOn(https, 'request').mockImplementation((...args: unknown[]) => {
        const callback = args[2] as (res: http.IncomingMessage) => void;
        fakeRequest.end = () => {
          const upstream = new PassThrough() as PassThrough & {
            statusCode: number;
            headers: object;
          };
          upstream.statusCode = 200;
          upstream.headers = {};
          callback(upstream as unknown as http.IncomingMessage);
          upstream.end(
            JSON.stringify({
              status: 'completed',
              output: [
                {
                  type: 'function_call',
                  call_id: 'call_agent',
                  name: 'Agent',
                  arguments: JSON.stringify(agentInput),
                },
              ],
              usage: { input_tokens: 10, output_tokens: 2 },
            }),
          );
        };
        return fakeRequest as unknown as http.ClientRequest;
      });

      const proxy = new CodexTranslationProxy(
        createMockLogger() as unknown as Logger,
        createAuth('https://api.openai.com/v1'),
      );
      try {
        const { url } = await proxy.start();
        const result = await post(url, false, {
          tools: [
            {
              name: 'Agent',
              description: 'Launch an agent',
              input_schema: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  prompt: { type: 'string' },
                  isolation: {
                    type: 'string',
                    enum: ['worktree', 'remote'],
                  },
                },
                required: ['description', 'prompt'],
              },
            },
          ],
        });

        const outbound = JSON.parse(outboundBody);
        expect(outbound.tools[0]).toMatchObject({
          name: 'Agent',
          strict: false,
          parameters: { required: ['description', 'prompt'] },
        });
        expect(outbound.tools[0].parameters.required).not.toContain(
          'isolation',
        );

        const inbound = JSON.parse(result.body);
        expect(inbound.content[0]).toMatchObject({
          type: 'tool_use',
          name: 'Agent',
          input: agentInput,
        });
        expect(inbound.content[0].input).toEqual(agentInput);
      } finally {
        await proxy.stop();
      }
    },
  );
});
