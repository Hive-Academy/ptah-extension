/**
 * startSessionOrganization — subscribes host-wide, never throws, and the
 * returned disposable releases the subscriptions.
 *
 * The session-id-resolved registry is the REAL one, so its `size` shows the
 * subscription actually landed and was actually released.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockOutputChannel,
  type MockOutputChannel,
} from '@ptah-extension/platform-core/testing';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  PostToolUseCallbackRegistry,
  SDK_TOKENS,
  SessionIdResolvedCallbackRegistry,
  UserPromptExpansionCallbackRegistry,
  UserPromptSubmitCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { SessionOrganizationCaptureService } from '../session-organization-capture.service';
import { registerSessionOrganizationServices } from './register';
import { startSessionOrganization } from './start';

interface Harness {
  c: DependencyContainer;
  output: MockOutputChannel;
  registry: SessionIdResolvedCallbackRegistry;
  postToolUse: PostToolUseCallbackRegistry;
  prompts: UserPromptSubmitCallbackRegistry;
  expansions: UserPromptExpansionCallbackRegistry;
  metadataRelease: jest.Mock;
  onMetadataChanged: jest.Mock;
}

type RegistryLogger = ConstructorParameters<
  typeof SessionIdResolvedCallbackRegistry
>[0];

function harness(
  options: { connection?: boolean; metadataThrows?: boolean } = {},
): Harness {
  const c = rootContainer.createChildContainer();
  const output = createMockOutputChannel();
  const logger = createMockLogger() as unknown as RegistryLogger;
  const registry = new SessionIdResolvedCallbackRegistry(logger);
  const postToolUse = new PostToolUseCallbackRegistry(logger);
  const prompts = new UserPromptSubmitCallbackRegistry(logger);
  const expansions = new UserPromptExpansionCallbackRegistry(logger);
  const metadataRelease = jest.fn();
  const onMetadataChanged = jest.fn(() => {
    if (options.metadataThrows) throw new Error('metadata store offline');
    return metadataRelease;
  });
  if (options.connection ?? true) {
    c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: {
        isOpen: false,
        onDidOpen: () => ({ dispose: () => undefined }),
      },
    });
  }
  c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
    useValue: { onMetadataChanged },
  });
  c.register(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY, {
    useValue: registry,
  });
  c.register(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY, {
    useValue: postToolUse,
  });
  c.register(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY, {
    useValue: prompts,
  });
  c.register(SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY, {
    useValue: expansions,
  });
  c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: createMockFileSystemProvider(),
  });
  c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, { useValue: output });
  registerSessionOrganizationServices(c);
  return {
    c,
    output,
    registry,
    postToolUse,
    prompts,
    expansions,
    metadataRelease,
    onMetadataChanged,
  };
}

describe('startSessionOrganization', () => {
  it('subscribes host-wide and logs nothing on success', () => {
    const h = harness();

    startSessionOrganization(h.c);

    expect(h.onMetadataChanged).toHaveBeenCalledTimes(1);
    // capture + auto-link
    expect(h.registry.size).toBe(2);
    // capture (PR links) + todo progress
    expect(h.postToolUse.size).toBe(2);
    expect(h.prompts.size).toBe(1);
    expect(h.expansions.size).toBe(1);
    expect(h.output.__state.lines).toEqual([]);
  });

  it('starts auto-link and todo progress even when capture fails', () => {
    const h = harness({ metadataThrows: true });

    startSessionOrganization(h.c);

    expect(h.registry.size).toBe(1);
    expect(h.postToolUse.size).toBe(1);
    expect(h.prompts.size).toBe(1);
  });

  it('releases every subscription when the result is disposed', () => {
    const h = harness();

    const handle = startSessionOrganization(h.c);
    handle.dispose();

    expect(h.metadataRelease).toHaveBeenCalledTimes(1);
    expect(h.registry.size).toBe(0);
    expect(h.postToolUse.size).toBe(0);
    expect(h.prompts.size).toBe(0);
    expect(h.expansions.size).toBe(0);
  });

  it('reports one line and never throws when releasing the subscriptions throws', () => {
    const h = harness();
    const handle = startSessionOrganization(h.c);
    jest
      .spyOn(h.c.resolve(SessionOrganizationCaptureService), 'dispose')
      .mockImplementation(() => {
        throw new Error('release failed');
      });

    expect(() => handle.dispose()).not.toThrow();

    expect(h.output.__state.lines).toEqual([
      '[SessionOrganization] capture dispose failed (non-fatal): release failed',
    ]);
  });

  it('logs one line per part and returns a disposable when the lib was not registered', () => {
    const h = harness({ connection: false });

    let handle: { dispose(): void } | undefined;
    expect(() => {
      handle = startSessionOrganization(h.c);
    }).not.toThrow();

    expect(h.output.__state.lines).toHaveLength(3);
    for (const line of h.output.__state.lines) {
      expect(line).toContain('[SessionOrganization]');
    }
    expect(h.onMetadataChanged).not.toHaveBeenCalled();
    expect(() => handle?.dispose()).not.toThrow();
  });

  it('logs one line per failed part and never throws when a dependency fails to resolve', () => {
    const h = harness();
    // A child that shadows the metadata store with a throwing factory.
    const child = h.c.createChildContainer();
    child.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
      useFactory: () => {
        throw new Error('metadata store unavailable');
      },
    });
    registerSessionOrganizationServices(child);

    let handle: { dispose(): void } | undefined;
    expect(() => {
      handle = startSessionOrganization(child);
    }).not.toThrow();

    // Every part resolves the service, which needs the metadata store.
    expect(h.output.__state.lines).toHaveLength(3);
    for (const line of h.output.__state.lines) {
      expect(line).toContain('metadata store unavailable');
    }
    expect(() => handle?.dispose()).not.toThrow();
  });

  it('logs one line and never throws when subscribing throws', () => {
    const h = harness({ metadataThrows: true });

    expect(() => startSessionOrganization(h.c)).not.toThrow();

    expect(h.output.__state.lines).toHaveLength(1);
    expect(h.output.__state.lines[0]).toContain('metadata store offline');
  });

  it('never throws when there is no output channel to report to', () => {
    const c = rootContainer.createChildContainer();

    expect(() => startSessionOrganization(c).dispose()).not.toThrow();
  });
});
