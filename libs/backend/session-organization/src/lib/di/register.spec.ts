/**
 * registerSessionOrganizationServices — binds only with the SQLite connection,
 * and the recorder port is the service instance (one instance, not two).
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockOutputChannel } from '@ptah-extension/platform-core/testing';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { SessionOrganizationStore } from '../session-organization.store';
import { SessionOrganizationService } from '../session-organization.service';
import { SessionOrganizationCaptureService } from '../session-organization-capture.service';
import { registerSessionOrganizationServices } from './register';
import { SESSION_ORGANIZATION_TOKENS } from './tokens';

/** The host-provided dependencies, as fakes. Nothing here is ever opened. */
function withHostDependencies(options: {
  connection: boolean;
}): DependencyContainer {
  const c = rootContainer.createChildContainer();
  if (options.connection) {
    c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: { isOpen: false },
    });
  }
  c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
    useValue: { onMetadataChanged: jest.fn(() => () => undefined) },
  });
  c.register(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY, {
    useValue: { register: jest.fn(() => () => undefined) },
  });
  c.register(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY, {
    useValue: { register: jest.fn(() => () => undefined) },
  });
  c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: createMockOutputChannel(),
  });
  return c;
}

describe('registerSessionOrganizationServices', () => {
  it('binds nothing when the SQLite connection is not registered', () => {
    const c = withHostDependencies({ connection: false });

    registerSessionOrganizationServices(c);

    expect(c.isRegistered(SESSION_ORGANIZATION_TOKENS.STORE, true)).toBe(false);
    expect(c.isRegistered(SESSION_ORGANIZATION_TOKENS.SERVICE, true)).toBe(
      false,
    );
    expect(
      c.isRegistered(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, true),
    ).toBe(false);
    expect(c.isRegistered(SessionOrganizationCaptureService, true)).toBe(false);
    expect(c.isRegistered(SessionOrganizationService, true)).toBe(false);
  });

  it('binds store, service, capture service and recorder with the connection', () => {
    const c = withHostDependencies({ connection: true });

    registerSessionOrganizationServices(c);

    expect(c.resolve(SESSION_ORGANIZATION_TOKENS.STORE)).toBeInstanceOf(
      SessionOrganizationStore,
    );
    expect(c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE)).toBeInstanceOf(
      SessionOrganizationService,
    );
    expect(c.resolve(SessionOrganizationCaptureService)).toBeInstanceOf(
      SessionOrganizationCaptureService,
    );
    expect(
      c.resolve(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER),
    ).toBeInstanceOf(SessionOrganizationService);
  });

  it('resolves the recorder port and the service to the same singleton', () => {
    const c = withHostDependencies({ connection: true });

    registerSessionOrganizationServices(c);

    const service = c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE);
    expect(c.resolve(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER)).toBe(
      service,
    );
    expect(c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE)).toBe(service);
    expect(c.resolve(SessionOrganizationService)).toBe(service);
    expect(c.resolve(SESSION_ORGANIZATION_TOKENS.STORE)).toBe(
      c.resolve(SESSION_ORGANIZATION_TOKENS.STORE),
    );
    expect(c.resolve(SessionOrganizationCaptureService)).toBe(
      c.resolve(SessionOrganizationCaptureService),
    );
  });

  it('has no side effects: registering subscribes to nothing', () => {
    const c = withHostDependencies({ connection: true });
    const metadata = c.resolve<{ onMetadataChanged: jest.Mock }>(
      SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    );
    const registry = c.resolve<{ register: jest.Mock }>(
      SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
    );
    const postToolUse = c.resolve<{ register: jest.Mock }>(
      SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    );

    registerSessionOrganizationServices(c);
    c.resolve(SessionOrganizationCaptureService);

    expect(metadata.onMetadataChanged).not.toHaveBeenCalled();
    expect(registry.register).not.toHaveBeenCalled();
    expect(postToolUse.register).not.toHaveBeenCalled();
  });
});
