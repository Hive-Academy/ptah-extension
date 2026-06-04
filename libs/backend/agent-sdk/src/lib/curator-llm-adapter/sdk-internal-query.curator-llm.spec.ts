import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SdkInternalQueryCuratorLlm,
  CURATOR_FALLBACK_MODEL,
} from './sdk-internal-query.curator-llm';
import { CuratorLlmQueryError } from './curator-llm-query.error';
import type { InternalQueryService } from '../internal-query';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(curatorModel: string): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T): T | undefined => {
        if (key === 'memory.curatorModel') {
          return curatorModel as unknown as T;
        }
        return fallback;
      },
    ),
  } as unknown as IWorkspaceProvider;
}

function makeWorkspaceFromConfig(
  config: Record<string, unknown>,
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T): T | undefined => {
        if (key in config) return config[key] as unknown as T;
        return fallback;
      },
    ),
  } as unknown as IWorkspaceProvider;
}

function makeThrowingWorkspace(): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(() => {
      throw new Error('settings file unreadable');
    }),
  } as unknown as IWorkspaceProvider;
}

async function* streamFrom(text: string): AsyncIterable<unknown> {
  yield {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  };
  yield { type: 'result' };
}

function makeInternalQuery(opts: {
  text?: string;
  throwOnExecute?: Error;
  capture?: { model?: string };
}): InternalQueryService {
  return {
    execute: jest.fn(async (config: { model: string }) => {
      if (opts.capture) opts.capture.model = config.model;
      if (opts.throwOnExecute) throw opts.throwOnExecute;
      return { stream: streamFrom(opts.text ?? '') };
    }),
  } as unknown as InternalQueryService;
}

const EXTRACT_TRANSCRIPT = 'some real transcript content for extraction';

describe('SdkInternalQueryCuratorLlm — resolveCuratorModel', () => {
  it('uses the configured memory.curatorModel when set', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('claude-sonnet-4-5-20250101'),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('falls back to CURATOR_FALLBACK_MODEL when unset', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe(CURATOR_FALLBACK_MODEL);
    expect(CURATOR_FALLBACK_MODEL).toBe('claude-haiku-4-5-20251001');
  });

  it('falls back when the configured value is whitespace only', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('   '),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe(CURATOR_FALLBACK_MODEL);
  });

  it('trims the configured value before sending it as the model id', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('  claude-sonnet-4-5-20250101  '),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('falls back to CURATOR_FALLBACK_MODEL when getConfiguration throws', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeThrowingWorkspace(),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe(CURATOR_FALLBACK_MODEL);
  });
});

describe('SdkInternalQueryCuratorLlm — cross-provider guard', () => {
  it('ignores curatorModel and uses the fallback when curatorProvider differs from the active provider', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'glm-4.6',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe(CURATOR_FALLBACK_MODEL);
  });

  it('uses curatorModel when curatorProvider matches the active anthropic provider', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'anthropic',
        authMethod: 'apiKey',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('uses curatorModel when curatorProvider matches the active third-party provider', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'glm-4.6',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'thirdParty',
        anthropicProviderId: 'z-ai',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('glm-4.6');
  });

  it('uses curatorModel when curatorProvider is unset (no guard applied)', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': '',
        authMethod: 'apiKey',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });
});

describe('SdkInternalQueryCuratorLlm — error vs empty', () => {
  it('re-throws CuratorLlmQueryError on SDK/transport failure', async () => {
    const internalQuery = makeInternalQuery({
      throwOnExecute: new Error('404 model not found'),
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).rejects.toBeInstanceOf(
      CuratorLlmQueryError,
    );
  });

  it('returns [] (does not throw) when model output is empty', async () => {
    const internalQuery = makeInternalQuery({ text: '' });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual([]);
  });

  it('returns [] when model output is non-JSON garbage', async () => {
    const internalQuery = makeInternalQuery({ text: 'not json at all' });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual([]);
  });
});
