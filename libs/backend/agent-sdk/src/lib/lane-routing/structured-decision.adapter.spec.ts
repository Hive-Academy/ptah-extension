import 'reflect-metadata';

import * as os from 'node:os';

import type { Logger } from '@ptah-extension/vscode-core';
import type { StructuredDecisionRequest } from '@ptah-extension/lane-routing';

import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import {
  USER_ACTION_QUERY_LANE,
  type InternalQueryConfig,
  type InternalQueryHandle,
} from '../internal-query';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import {
  StructuredDecisionAdapter,
  StructuredDecisionError,
} from './structured-decision.adapter';

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { choice: { type: 'string', enum: ['o1', 'o2'] } },
  required: ['choice'],
};

const AUTH: OneShotAuthOverride = {
  env: { ANTHROPIC_API_KEY: 'test-key' },
};

function makeLogger(): Pick<Logger, 'warn' | 'debug'> {
  return { warn: jest.fn(), debug: jest.fn() };
}

class FakeQuery {
  readonly calls: InternalQueryConfig[] = [];
  stream: AsyncIterable<SDKMessage> = (async function* () {
    // Intentionally empty.
  })();

  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    this.calls.push(config);
    const stream = this.stream;
    return {
      stream,
      abort: () => undefined,
      close: () => undefined,
    };
  }
}

class FakeResolver implements IProviderAuthResolver {
  constructor(
    private readonly impl: (
      providerId: string,
    ) => Promise<OneShotAuthOverride | null>,
  ) {}

  resolve(providerId: string): Promise<OneShotAuthOverride | null> {
    return this.impl(providerId);
  }
}

class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

class ConnectionRefused extends Error {
  readonly code = 'ECONNREFUSED';

  constructor() {
    super('connect ECONNREFUSED 127.0.0.1:443');
    this.name = 'Error';
  }
}

function request(
  signal: AbortSignal = new AbortController().signal,
): StructuredDecisionRequest {
  return {
    providerId: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5',
    prompt: 'Pick one option.',
    jsonSchema: SCHEMA,
    signal,
  };
}

function resultMessage(fields: {
  readonly subtype: 'success' | 'error_during_execution';
  readonly isError: boolean;
  readonly structuredOutput?: unknown;
  readonly apiErrorStatus?: number;
}): SDKMessage {
  const message: Record<string, unknown> = {
    type: 'result',
    subtype: fields.subtype,
    is_error: fields.isError,
    api_error_status: fields.apiErrorStatus,
  };
  if (fields.structuredOutput !== undefined) {
    message['structured_output'] = fields.structuredOutput;
  }
  if (!isSdkMessage(message)) {
    throw new Error('test result is not an SDK message');
  }
  return message;
}

function isSdkMessage(value: Record<string, unknown>): value is SDKMessage {
  return value['type'] === 'result' && typeof value['subtype'] === 'string';
}

async function* messages(
  ...items: readonly SDKMessage[]
): AsyncGenerator<SDKMessage> {
  for (const item of items) yield item;
}

function adapterFor(
  query: FakeQuery,
  resolver: IProviderAuthResolver | null,
): StructuredDecisionAdapter {
  return new StructuredDecisionAdapter(makeLogger(), query, resolver);
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (error: unknown) {
    return error;
  }
}

describe('StructuredDecisionAdapter', () => {
  it('returns structured output and sends outputFormat for the requested provider', async () => {
    const query = new FakeQuery();
    query.stream = messages(
      resultMessage({
        subtype: 'success',
        isError: false,
        structuredOutput: { choice: 'o1' },
      }),
    );
    const adapter = adapterFor(query, new FakeResolver(async () => AUTH));

    await expect(adapter.complete(request())).resolves.toEqual({
      choice: 'o1',
    });

    expect(query.calls).toHaveLength(1);
    const call = query.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call.model).toBe('anthropic/claude-sonnet-4.5');
    expect(call.prompt).toBe('Pick one option.');
    expect(call.outputFormat).toEqual({ type: 'json_schema', schema: SCHEMA });
    expect(call.auth).toBe(AUTH);
    expect(call.toolAccess).toBe('none');
    expect(call.lane).toBe(USER_ACTION_QUERY_LANE);
    expect(call.mcpServerRunning).toBe(false);
    expect(call.maxTurns).toBe(1);
    expect(call.cwd).toBe(os.tmpdir());
  });

  it('omits auth when the resolver says this provider is the active one', async () => {
    const query = new FakeQuery();
    query.stream = messages(
      resultMessage({
        subtype: 'success',
        isError: false,
        structuredOutput: { choice: 'o2' },
      }),
    );
    const adapter = adapterFor(query, new FakeResolver(async () => null));

    await expect(adapter.complete(request())).resolves.toEqual({
      choice: 'o2',
    });
    expect(query.calls[0]?.auth).toBeUndefined();
  });

  it('maps a resolver throw to auth and does not call the query', async () => {
    const query = new FakeQuery();
    const adapter = adapterFor(
      query,
      new FakeResolver(async () => {
        throw new ProviderAuthError('bad key sk-secret-value');
      }),
    );

    const error = await settle(adapter.complete(request()));

    expect(error).toBeInstanceOf(StructuredDecisionError);
    if (!(error instanceof StructuredDecisionError)) return;
    expect(error.kind).toBe('auth');
    expect(error.message).not.toContain('sk-secret-value');
    expect(query.calls).toHaveLength(0);
  });

  it('maps a missing auth resolver to auth', async () => {
    const query = new FakeQuery();
    const adapter = adapterFor(query, null);

    const error = await settle(adapter.complete(request()));

    expect(error).toBeInstanceOf(StructuredDecisionError);
    if (!(error instanceof StructuredDecisionError)) return;
    expect(error.kind).toBe('auth');
    expect(query.calls).toHaveLength(0);
  });

  it('maps a thrown network error to unreachable', async () => {
    const query = new FakeQuery();
    const execute = query.execute.bind(query);
    query.execute = async (config) => {
      await execute(config);
      throw new ConnectionRefused();
    };
    const adapter = adapterFor(query, new FakeResolver(async () => AUTH));

    const error = await settle(adapter.complete(request()));

    expect(error).toBeInstanceOf(StructuredDecisionError);
    if (!(error instanceof StructuredDecisionError)) return;
    expect(error.kind).toBe('unreachable');
    expect(error.message).not.toContain('127.0.0.1');
  });

  it('maps a network-class result to unreachable', async () => {
    const query = new FakeQuery();
    query.stream = messages(
      resultMessage({
        subtype: 'error_during_execution',
        isError: true,
        apiErrorStatus: 503,
      }),
    );
    const adapter = adapterFor(query, new FakeResolver(async () => AUTH));

    const error = await settle(adapter.complete(request()));

    expect(error).toBeInstanceOf(StructuredDecisionError);
    if (!(error instanceof StructuredDecisionError)) return;
    expect(error.kind).toBe('unreachable');
  });

  it('maps a result with no structured output to bad-output', async () => {
    const query = new FakeQuery();
    query.stream = messages(
      resultMessage({ subtype: 'success', isError: false }),
    );
    const adapter = adapterFor(query, new FakeResolver(async () => AUTH));

    const error = await settle(adapter.complete(request()));

    expect(error).toBeInstanceOf(StructuredDecisionError);
    if (!(error instanceof StructuredDecisionError)) return;
    expect(error.kind).toBe('bad-output');
  });

  it('does not call the query when the signal is already aborted', async () => {
    const query = new FakeQuery();
    const controller = new AbortController();
    controller.abort();
    const adapter = adapterFor(query, new FakeResolver(async () => AUTH));

    const error = await settle(adapter.complete(request(controller.signal)));

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) return;
    expect(error.name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(StructuredDecisionError);
    expect(query.calls).toHaveLength(0);
  });

  it('rejects an abort that lands before the result is accepted', async () => {
    const controller = new AbortController();
    const query = new FakeQuery();
    query.stream = (async function* () {
      controller.abort();
      yield resultMessage({
        subtype: 'success',
        isError: false,
        structuredOutput: { choice: 'o1' },
      });
    })();
    const adapter = adapterFor(query, new FakeResolver(async () => AUTH));

    const error = await settle(adapter.complete(request(controller.signal)));

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) return;
    expect(error.name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(StructuredDecisionError);
  });

  it('isReady is true when the resolver returns a credential or null', async () => {
    const withCredential = adapterFor(
      new FakeQuery(),
      new FakeResolver(async () => AUTH),
    );
    const activeProvider = adapterFor(
      new FakeQuery(),
      new FakeResolver(async () => null),
    );

    await expect(withCredential.isReady('openrouter')).resolves.toBe(true);
    await expect(activeProvider.isReady('anthropic')).resolves.toBe(true);
  });

  it('isReady is false when the provider is unusable or the resolver is absent', async () => {
    const unusable = adapterFor(
      new FakeQuery(),
      new FakeResolver(async () => {
        throw new ProviderAuthError('not authenticated');
      }),
    );
    const absent = adapterFor(new FakeQuery(), null);

    await expect(unusable.isReady('openrouter')).resolves.toBe(false);
    await expect(absent.isReady('openrouter')).resolves.toBe(false);
  });
});
