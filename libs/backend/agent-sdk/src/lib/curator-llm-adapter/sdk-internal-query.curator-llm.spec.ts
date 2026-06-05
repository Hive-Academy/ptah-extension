import 'reflect-metadata';
import * as os from 'os';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SdkInternalQueryCuratorLlm,
  CURATOR_FALLBACK_MODEL,
} from './sdk-internal-query.curator-llm';
import { CuratorLlmQueryError } from './curator-llm-query.error';
import type { ICuratorAuthResolver } from './curator-auth-resolver.port';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import type { InternalQueryService } from '../internal-query';
import type { AuthEnv } from '@ptah-extension/shared';

class FakeCuratorAuthError extends Error {
  readonly providerId: string;
  constructor(providerId: string, message: string) {
    super(message);
    this.name = 'CuratorAuthError';
    this.providerId = providerId;
  }
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(
  curatorModel: string,
  workspaceRoot?: string,
): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => workspaceRoot),
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
    getWorkspaceRoot: jest.fn(() => undefined),
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
    getWorkspaceRoot: jest.fn(() => undefined),
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

interface ExecuteCapture {
  model?: string;
  cwd?: string;
  auth?: OneShotAuthOverride;
  authWasPresent?: boolean;
}

function makeInternalQuery(opts: {
  text?: string;
  throwOnExecute?: Error;
  capture?: ExecuteCapture;
}): InternalQueryService {
  return {
    execute: jest.fn(
      async (config: {
        model: string;
        cwd: string;
        auth?: OneShotAuthOverride;
      }) => {
        if (opts.capture) {
          opts.capture.model = config.model;
          opts.capture.cwd = config.cwd;
          opts.capture.auth = config.auth;
          opts.capture.authWasPresent = 'auth' in config;
        }
        if (opts.throwOnExecute) throw opts.throwOnExecute;
        return { stream: streamFrom(opts.text ?? '') };
      },
    ),
  } as unknown as InternalQueryService;
}

function makeResolver(
  impl: (id: string) => Promise<OneShotAuthOverride | null>,
): ICuratorAuthResolver & { resolve: jest.Mock } {
  return { resolve: jest.fn(impl) } as unknown as ICuratorAuthResolver & {
    resolve: jest.Mock;
  };
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

describe('SdkInternalQueryCuratorLlm — query cwd', () => {
  it('roots the internal query at the active workspace, not process.cwd()', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('', '/home/abdo/project'),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.cwd).toBe('/home/abdo/project');
    expect(capture.cwd).not.toBe(process.cwd());
  });

  it('falls back to the user home dir when no workspace folder is open', async () => {
    const capture: ExecuteCapture = {};
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
    expect(capture.cwd).toBe(os.homedir());
  });
});

describe('SdkInternalQueryCuratorLlm — no cross-provider downgrade', () => {
  it('uses the configured curatorModel verbatim even when curatorProvider differs from the active provider', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const resolver = makeResolver(async () => ({
      env: { ANTHROPIC_BASE_URL: 'https://example.test' } as AuthEnv,
    }));
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'glm-4.6',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('glm-4.6');
  });

  it('uses the configured curatorModel when curatorProvider matches the active provider', async () => {
    const capture: ExecuteCapture = {};
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
});

describe('SdkInternalQueryCuratorLlm — curator auth routing', () => {
  it('resolves auth and passes the override into execute when the resolver returns one', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const override: OneShotAuthOverride = {
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:51999' } as AuthEnv,
      baseUrl: 'http://127.0.0.1:51999',
    };
    const resolver = makeResolver(async () => override);
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'glm-4.6',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(resolver.resolve).toHaveBeenCalledWith('z-ai');
    expect(capture.auth).toBe(override);
    expect(capture.model).toBe('glm-4.6');
  });

  it('proceeds with auth=undefined and warns when the resolver throws CuratorAuthError', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const logger = makeLogger();
    const resolver = makeResolver(async () => {
      throw new FakeCuratorAuthError(
        'github-copilot',
        'curator provider not authenticated',
      );
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      logger,
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'github-copilot',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.auth).toBeUndefined();
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
    expect(logger.warn).toHaveBeenCalledWith(
      '[memory-curator] curator provider auth unavailable; riding active provider',
      expect.objectContaining({ curatorProviderId: 'github-copilot' }),
    );
  });

  it('returns auth=undefined when the resolver yields null (rides active provider)', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const resolver = makeResolver(async () => null);
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': '',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(resolver.resolve).toHaveBeenCalledWith('');
    expect(capture.auth).toBeUndefined();
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('rides active provider (auth=undefined) when no resolver is injected (off-Electron)', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.auth).toBeUndefined();
    expect(capture.authWasPresent).toBe(true);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('rethrows non-CuratorAuthError resolver failures', async () => {
    const internalQuery = makeInternalQuery({ text: '{"memories":[]}' });
    const resolver = makeResolver(async () => {
      throw new Error('unexpected resolver crash');
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).rejects.toBeInstanceOf(
      CuratorLlmQueryError,
    );
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
