/**
 * DI container smoke spec for CompactionBoundaryGenerationRegistry (TASK_2026_414
 * regression, PR #493).
 *
 * `CompactionBoundaryGenerationRegistry`'s unit spec constructs it with `new`
 * directly and never exercised container resolution, so a defaulted-primitive
 * constructor parameter with no explicit type annotation
 * (`constructor(private readonly maxEntries = 256)`) shipped registered as
 * `useClass`. TypeScript emits `Object` for that parameter's
 * `design:paramtypes` entry (no annotation means no metadata type, syntactically,
 * regardless of the inferred default's type), and tsyringe's constructor
 * auto-wiring then tries to resolve a dependency literally named "Object" and
 * throws `TypeInfo not known for "Object"` — which every consumer's DI chain
 * surfaces as "Cannot inject the dependency ... position #N", not as an error
 * naming the registry itself. `cli-agent-runtime`'s
 * `register.ptah-cli-registry.smoke.spec.ts` caught this only because
 * `PtahCliRegistry` transitively pulls in `SdkMessageTransformer`; this spec
 * pins the same failure at its source, inside the project that owns it, by
 * resolving through the real `registerSdkServices` container rather than
 * mocking the registry away.
 *
 * Verifies that:
 * 1. `SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY` resolves.
 * 2. `SDK_TOKENS.SDK_MESSAGE_TRANSFORMER` resolves, with the same registry
 *    singleton injected.
 * 3. `SDK_TOKENS.SDK_SESSION_HISTORY_READER` resolves, with the same registry
 *    singleton injected.
 */

import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  registerSdkServices,
  SdkMessageTransformer,
  SessionHistoryReaderService,
  // Relative, not `@ptah-extension/agent-sdk`: a project may not import itself
  // by alias (`@nx/enforce-module-boundaries`). This is still the public
  // barrel, so the smoke test proves the same surface.
} from '../../index';
// `@ptah-extension/auth-providers-tokens` only, never the full
// `@ptah-extension/auth-providers` lib: auth-providers depends on agent-sdk
// one way (its own CLAUDE.md states this explicitly, to break what would
// otherwise be a cycle through the provider registry). Importing the full lib
// from an agent-sdk spec closes that cycle at the Nx project-graph level and
// breaks every app's build task graph
// (`ptah-cli:test -> ...:build-esbuild:production -> rpc-handlers:build ->
// agent-sdk:build -> auth-providers:build -> agent-sdk:build`, reproduced and
// reverted while writing this spec). The zero-dep tokens package is agent-sdk's
// existing, real dependency (see AuthEnv/ModelResolver injections throughout
// this lib) and is all a smoke test needs.
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';

const ENHANCED_PROMPTS_SERVICE = Symbol.for('SdkEnhancedPromptsService');
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),
  },
}));

function createMockLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

function buildSmokeContainer(): DependencyContainer {
  const c = rootContainer.createChildContainer();
  const logger = createMockLogger();

  c.register(TOKENS.LOGGER, { useValue: logger });

  // Platform dependencies required by ConfigWatcher during registerSdkServices
  c.register(TOKENS.CONFIG_MANAGER, {
    useValue: {
      get: jest.fn(() => undefined),
      set: jest.fn(async () => undefined),
      getWithDefault: jest.fn((_key, defaultValue) => defaultValue),
      watch: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: {
      get: jest.fn(async () => undefined),
      store: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });

  // Host platform & collaborator fakes required for SDK service resolution
  c.register(TOKENS.AUTH_SECRETS_SERVICE, {
    useValue: {
      getProviderKey: jest.fn(async () => undefined),
      hasProviderKey: jest.fn(async () => false),
    },
  });
  c.register(TOKENS.SUBAGENT_REGISTRY_SERVICE, {
    useValue: {
      register: jest.fn(),
      unregister: jest.fn(),
      get: jest.fn(),
    },
  });
  c.register(TOKENS.GIT_INFO_SERVICE, { useValue: {} });
  c.register(Symbol.for('WorkspaceScopeResolver'), {
    useValue: { read: jest.fn(() => undefined) },
  });
  c.register(TOKENS.SENTRY_SERVICE, {
    useValue: { captureException: jest.fn(), captureMessage: jest.fn() },
  });
  c.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: { broadcastMessage: jest.fn(async () => undefined) },
  });
  c.register(ENHANCED_PROMPTS_SERVICE, {
    useValue: {
      setAnalysisReader: jest.fn(),
      getStatus: jest.fn(),
    },
  });
  c.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: {
      platform: process.platform,
      arch: process.arch,
      osVersion: 'test',
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getConfiguration: jest.fn(() => ({ get: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    },
  });

  // Stubbed directly rather than via `registerAuthProvidersServices` — see the
  // import comment above. Only the tokens SdkMessageTransformer,
  // SessionHistoryReaderService and their transitive SDK dependencies actually
  // inject are needed here.
  c.register(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV, { useValue: {} });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER, {
    useValue: { resolve: jest.fn((tier: string) => tier) },
  });
  c.register(SDK_TOKENS.PRICING_PROVIDER, {
    useValue: { getPricePerMillionTokens: jest.fn(() => undefined) },
  });

  registerSdkServices(c, logger);
  // SessionLifecycleManager pulls in the full query runner and auth strategy
  // platform stacks. Stub it after registerSdkServices, same as
  // cli-agent-runtime's smoke spec, to isolate resolution of the transformer
  // and history reader under test — neither exercises session lifecycle here.
  c.register(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { useValue: {} });

  return c;
}

describe('registerSdkServices — CompactionBoundaryGenerationRegistry DI smoke', () => {
  let container: DependencyContainer;

  beforeEach(() => {
    container = buildSmokeContainer();
  });

  it('resolves SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY', () => {
    const registry = container.resolve<object>(
      SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY,
    );

    expect(registry).toBeDefined();
    expect(registry.constructor.name).toBe(
      'CompactionBoundaryGenerationRegistry',
    );
  });

  it('injects the real CompactionBoundaryGenerationRegistry singleton into SdkMessageTransformer', () => {
    const transformer = container.resolve<SdkMessageTransformer>(
      SDK_TOKENS.SDK_MESSAGE_TRANSFORMER,
    );
    const registry = container.resolve(
      SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY,
    );

    expect(transformer).toBeInstanceOf(SdkMessageTransformer);
    const injected = (
      transformer as unknown as {
        compactionBoundaryRegistry: unknown;
      }
    ).compactionBoundaryRegistry;
    expect(injected).toBe(registry);
  });

  it('injects the real CompactionBoundaryGenerationRegistry singleton into SessionHistoryReaderService', () => {
    const reader = container.resolve<SessionHistoryReaderService>(
      SDK_TOKENS.SDK_SESSION_HISTORY_READER,
    );
    const registry = container.resolve(
      SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY,
    );

    expect(reader).toBeInstanceOf(SessionHistoryReaderService);
    const injected = (
      reader as unknown as {
        compactionBoundaryRegistry: unknown;
      }
    ).compactionBoundaryRegistry;
    expect(injected).toBe(registry);
  });
});
