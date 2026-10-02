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
  createMockOutputChannel,
  type MockOutputChannel,
} from '@ptah-extension/platform-core/testing';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  PostToolUseCallbackRegistry,
  SDK_TOKENS,
  SessionIdResolvedCallbackRegistry,
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
  const metadataRelease = jest.fn();
  const onMetadataChanged = jest.fn(() => {
    if (options.metadataThrows) throw new Error('metadata store offline');
    return metadataRelease;
  });
  if (options.connection ?? true) {
    c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: { isOpen: false },
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
  c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, { useValue: output });
  registerSessionOrganizationServices(c);
  return {
    c,
    output,
    registry,
    postToolUse,
    metadataRelease,
    onMetadataChanged,
  };
}

describe('startSessionOrganization', () => {
  it('subscribes host-wide and logs nothing on success', () => {
    const h = harness();

    startSessionOrganization(h.c);

    expect(h.onMetadataChanged).toHaveBeenCalledTimes(1);
    expect(h.registry.size).toBe(1);
    expect(h.postToolUse.size).toBe(1);
    expect(h.output.__state.lines).toEqual([]);
  });

  it('releases every subscription when the result is disposed', () => {
    const h = harness();

    const handle = startSessionOrganization(h.c);
    handle.dispose();

    expect(h.metadataRelease).toHaveBeenCalledTimes(1);
    expect(h.registry.size).toBe(0);
    expect(h.postToolUse.size).toBe(0);
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

  it('logs one line and returns a disposable when the lib was not registered', () => {
    const h = harness({ connection: false });

    let handle: { dispose(): void } | undefined;
    expect(() => {
      handle = startSessionOrganization(h.c);
    }).not.toThrow();

    expect(h.output.__state.lines).toHaveLength(1);
    expect(h.output.__state.lines[0]).toContain('[SessionOrganization]');
    expect(h.onMetadataChanged).not.toHaveBeenCalled();
    expect(() => handle?.dispose()).not.toThrow();
  });

  it('logs one line and never throws when a dependency fails to resolve', () => {
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

    expect(h.output.__state.lines).toHaveLength(1);
    expect(h.output.__state.lines[0]).toContain('metadata store unavailable');
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
