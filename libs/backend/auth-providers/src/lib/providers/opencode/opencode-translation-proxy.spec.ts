import 'reflect-metadata';
import * as http from 'http';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  OPENCODE_MODEL_ROUTES,
  getAnthropicProvider,
  type OpenCodeProviderId,
} from '@ptah-extension/shared';
import { providerQuotaStore } from '../../auth/provider-quota.store';
import { OpenCodeTranslationProxy } from './opencode-translation-proxy';
import type { IOpenCodeAuthService } from './opencode-provider.types';

class TestProxy extends OpenCodeTranslationProxy {
  origin?: string;
  timeout = 600_000;
  public override normalizeModelId(id: string) {
    return super.normalizeModelId(id);
  }
  public override resolveUpstreamProtocol(id: string) {
    return super.resolveUpstreamProtocol(id);
  }
  public override async getApiEndpoint() {
    const actual = await super.getApiEndpoint();
    return this.origin ? this.origin + new URL(actual).pathname : actual;
  }
  protected override getUpstreamTimeoutMs() {
    return this.timeout;
  }
}

const nativeResponse = JSON.stringify({
  id: 'msg_native',
  type: 'message',
  role: 'assistant',
  content: [
    { type: 'text', text: 'hello' },
    { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a' } },
  ],
  model: 'minimax-m3',
  stop_reason: 'tool_use',
  usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 1 },
});
const nativeSse =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_native","usage":{"input_tokens":3}}}\n\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"upstream event"}}\n\n';
const chatResponse = {
  id: 'chat_1',
  object: 'chat.completion',
  model: 'glm-5.3',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'hello',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
};
const responsesResponse = {
  id: 'resp_1',
  status: 'completed',
  model: 'grok-4.7',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'hello' }],
    },
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"a"}',
      status: 'completed',
    },
  ],
  usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
};

function post(url: string, body: string, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    body: string;
    headers: http.IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = http.request(
      `${url}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('OpenCodeTranslationProxy', () => {
  let upstream: http.Server;
  let origin: string;
  let requests: Array<{
    path: string;
    headers: http.IncomingHttpHeaders;
    raw: string;
  }>;
  let respond: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: Record<string, unknown>,
  ) => void;
  const proxies: TestProxy[] = [];
  const logger = createMockLogger();

  async function proxy(id: OpenCodeProviderId, auth?: IOpenCodeAuthService) {
    const p = new TestProxy(
      logger as unknown as Logger,
      id,
      auth ?? {
        isAuthenticated: async () => true,
        getApiKey: async () => `${id}-key`,
        getHeaders: async () => ({
          Authorization: `Bearer ${id}-key`,
          'Content-Type': 'application/json',
        }),
      },
    );
    p.origin = origin;
    proxies.push(p);
    const { url } = await p.start();
    return { p, url };
  }

  beforeEach(async () => {
    providerQuotaStore.clear();
    jest.clearAllMocks();
    requests = [];
    respond = (req, res, body) => {
      const native = req.url?.endsWith('/messages');
      const responses = req.url?.endsWith('/responses');
      if (body.stream) {
        res.setHeader('content-type', 'text/event-stream');
        if (native) res.end(nativeSse);
        else if (responses) {
          const events = [
            {
              type: 'response.output_text.delta',
              output_index: 0,
              delta: 'hello',
            },
            {
              type: 'response.output_item.added',
              output_index: 1,
              item: {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_1',
                name: 'read_file',
                arguments: '',
              },
            },
            {
              type: 'response.function_call_arguments.delta',
              output_index: 1,
              delta: '{"path":"a"}',
            },
            {
              type: 'response.output_item.done',
              output_index: 1,
              item: responsesResponse.output[1],
            },
            { type: 'response.completed', response: responsesResponse },
          ];
          res.end(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join('') + 'data: [DONE]\n\n',
          );
        } else
          res.end(
            `data: ${JSON.stringify({
              id: 'chat_1',
              object: 'chat.completion.chunk',
              model: 'glm-5.3',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    content: 'hello',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'read_file',
                          arguments: '{"path":"a"}',
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: chatResponse.usage,
            })}\n\ndata: [DONE]\n\n`,
          );
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(
          native
            ? nativeResponse
            : JSON.stringify(responses ? responsesResponse : chatResponse),
        );
      }
    };
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        requests.push({ path: req.url ?? '', headers: req.headers, raw });
        respond(req, res, JSON.parse(raw) as Record<string, unknown>);
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing fake upstream address');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((p) => p.stop()));
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
    providerQuotaStore.clear();
  });

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s resolves every reviewed route and only explicit tier aliases',
    async (id) => {
      const { p } = await proxy(id);
      for (const [model, lane] of Object.entries(OPENCODE_MODEL_ROUTES[id])) {
        expect(p.resolveUpstreamProtocol(model)).toBe(lane);
        expect(p.normalizeModelId(model)).toBe(model);
      }
      const tiers = getAnthropicProvider(id)?.defaultTiers;
      for (const tier of ['sonnet', 'opus', 'haiku'] as const)
        expect(p.normalizeModelId(tier)).toBe(tiers?.[tier]);
      expect(p.normalizeModelId('default')).toBe(tiers?.sonnet);
      expect(p.resolveUpstreamProtocol('toString')).toBeUndefined();
      expect(p.resolveUpstreamProtocol('unknown')).toBeUndefined();
    },
  );

  it.each([
    ['opencode-zen', 'claude-sonnet-5', '/zen/v1/messages'],
    ['opencode-zen', 'minimax-m3', '/zen/v1/chat/completions'],
    ['opencode-zen', 'gpt-5.6-luna', '/zen/v1/responses'],
    ['opencode-go', 'minimax-m3', '/zen/go/v1/messages'],
    ['opencode-go', 'glm-5.3', '/zen/go/v1/chat/completions'],
    ['opencode-go', 'gpt-5.6-luna', '/zen/go/v1/responses'],
  ] as const)(
    '%s %s forwards both stream modes to %s with its own Bearer key',
    async (id, model, path) => {
      const { url } = await proxy(id);
      for (const stream of [false, true]) {
        const raw = JSON.stringify({
          model,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'hello' }],
          stream,
        });
        const result = await post(url, raw, {
          Authorization: 'Bearer local-placeholder',
          'x-api-key': 'untrusted-client-key',
          'anthropic-beta': 'test-beta',
        });
        expect(result.status).toBe(200);
        const request = requests[requests.length - 1];
        expect(request.path).toBe(path);
        expect(request.headers.authorization).toBe(`Bearer ${id}-key`);
        expect(request.headers['x-api-key']).toBeUndefined();
        if (path.endsWith('/messages')) {
          expect(request.raw).toBe(raw);
          expect(request.headers['anthropic-version']).toBe('2023-06-01');
          expect(request.headers['anthropic-beta']).toBe('test-beta');
          expect(result.body).toBe(stream ? nativeSse : nativeResponse);
        } else if (!stream) {
          const translated = JSON.parse(result.body);
          expect(translated.content).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: 'text', text: 'hello' }),
              expect.objectContaining({
                type: 'tool_use',
                name: 'read_file',
                input: { path: 'a' },
              }),
            ]),
          );
          expect(translated.usage).toMatchObject({
            input_tokens: 3,
            output_tokens: 2,
          });
        } else {
          expect(result.body).toContain('message_stop');
          expect(result.body).toContain('read_file');
          expect(result.body).toContain('hello');
          expect(result.body).toContain('output_tokens');
        }
        if (path.endsWith('/responses')) {
          expect(JSON.parse(request.raw)).toMatchObject({ store: false });
          expect(Boolean(JSON.parse(request.raw).stream)).toBe(stream);
        }
      }
    },
  );

  it.each(['minimax-m3', 'minimax-m2.7', 'minimax-m2.5'])(
    '%s concurrently uses Zen Chat and Go Messages without sharing credentials',
    async (model) => {
      const [zen, go] = await Promise.all([
        proxy('opencode-zen'),
        proxy('opencode-go'),
      ]);
      const raw = JSON.stringify({
        model,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      });
      const results = await Promise.all([
        post(zen.url, raw),
        post(go.url, raw),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/zen/v1/chat/completions',
            headers: expect.objectContaining({
              authorization: 'Bearer opencode-zen-key',
            }),
          }),
          expect.objectContaining({
            path: '/zen/go/v1/messages',
            headers: expect.objectContaining({
              authorization: 'Bearer opencode-go-key',
            }),
          }),
        ]),
      );
    },
  );

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s rejects unknown, foreign and excluded IDs before reading auth',
    async (id) => {
      const getHeaders = jest.fn(async () => ({}));
      const { url } = await proxy(id, {
        getHeaders,
        isAuthenticated: async () => false,
        getApiKey: async () => null,
      });
      const foreign = id === 'opencode-zen' ? 'longcat-2.0' : 'claude-sonnet-5';
      for (const model of [
        'unknown',
        foreign,
        'gemini-3.8-flash',
        'jev-1.13',
        'toString',
      ]) {
        const result = await post(
          url,
          JSON.stringify({ model, max_tokens: 1, messages: [] }),
        );
        expect(result.status).toBe(400);
        expect(JSON.parse(result.body).error).toEqual({
          type: 'invalid_request_error',
          message: `Model '${model}' is not supported by ${getAnthropicProvider(id)?.name} in this Ptah version. Choose a listed model or update Ptah.`,
        });
      }
      expect(getHeaders).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    },
  );

  it('normalizes native aliases without dropping extension fields', async () => {
    const { url } = await proxy('opencode-zen');
    const body = {
      model: 'sonnet',
      max_tokens: 64,
      messages: [],
      thinking: { type: 'adaptive' },
      metadata: { user_id: 'test' },
    };
    expect((await post(url, JSON.stringify(body))).status).toBe(200);
    expect(JSON.parse(requests[0].raw)).toEqual({
      ...body,
      model: 'claude-sonnet-5',
    });
  });

  it('rejects invalid envelopes and a missing native version before forwarding', async () => {
    const { url } = await proxy('opencode-go');
    for (const body of [
      '{',
      'null',
      '{}',
      '{"model":2}',
      '{"model":"minimax-m3","messages":[]}',
    ]) {
      expect((await post(url, body)).status).toBe(400);
    }
    const result = await post(
      url,
      JSON.stringify({ model: 'minimax-m3', max_tokens: 1, messages: [] }),
      { 'anthropic-version': '' },
    );
    expect(result.status).toBe(400);
    expect(result.body).toContain('anthropic-version');
    expect(requests).toHaveLength(0);
  });

  it.each([401, 403, 402, 500, 503])(
    'sanitizes upstream %s without retrying or switching lanes',
    async (status) => {
      respond = (_req, res) => {
        res.writeHead(status);
        res.end('PRIVATE-UPSTREAM-KEY-AND-BODY');
      };
      const { url } = await proxy('opencode-go');
      const result = await post(
        url,
        JSON.stringify({ model: 'minimax-m3', max_tokens: 1, messages: [] }),
      );
      expect(result.status).toBe(status);
      expect(result.body).toContain('OpenCode Go');
      expect(result.body).not.toContain('PRIVATE-UPSTREAM');
      if (status === 401)
        expect(result.body).toContain(
          "Update that subscription's key in Settings > Authentication.",
        );
      expect(requests).toHaveLength(1);
      for (const log of [
        logger.debug,
        logger.info,
        logger.warn,
        logger.error,
      ]) {
        expect(JSON.stringify((log as jest.Mock).mock.calls)).not.toContain(
          'PRIVATE-UPSTREAM',
        );
        expect(JSON.stringify((log as jest.Mock).mock.calls)).not.toContain(
          'opencode-go-key',
        );
      }
    },
  );

  it('keeps rate-limit cooldowns separate for Zen and Go', async () => {
    respond = (req, res) => {
      if (req.url?.startsWith('/zen/go/')) res.end(nativeResponse);
      else {
        res.writeHead(429, { 'retry-after': '30' });
        res.end('private');
      }
    };
    const zen = await proxy('opencode-zen');
    const go = await proxy('opencode-go');
    const raw = JSON.stringify({
      model: 'minimax-m3',
      max_tokens: 1,
      messages: [],
    });
    const limited = await post(zen.url, raw);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('30');
    expect(limited.body).toContain('rate_limit_error');
    expect((await post(go.url, raw)).status).toBe(200);
  });

  it('times out native upstream requests without retrying', async () => {
    respond = () => {
      /* Deliberately leave the fake upstream pending. */
    };
    const { p, url } = await proxy('opencode-go');
    p.timeout = 20;
    expect(
      (
        await post(
          url,
          JSON.stringify({ model: 'minimax-m3', max_tokens: 1, messages: [] }),
        )
      ).status,
    ).toBe(504);
    expect(requests).toHaveLength(1);
  });
});
