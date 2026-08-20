import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import { registerMessagingGatewayServices } from './register';
import { GATEWAY_TOKENS } from './tokens';
import { AdapterLifecycleService } from '../adapter-lifecycle.service';
import { OutboundDeliveryService } from '../outbound-delivery.service';
import type { IGatewaySessionLister } from '../session-lister.interface';
import type { ISessionActivityProbe } from '../session-activity.interface';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('registerMessagingGatewayServices — command-plane collaborator fallbacks', () => {
  it('installs inert no-op session lister + activity probe when the host registers neither (CLI / VS Code hosts must still resolve GatewayService)', async () => {
    const container = rootContainer.createChildContainer();

    registerMessagingGatewayServices(container, createLogger());

    expect(container.isRegistered(GATEWAY_TOKENS.GATEWAY_SESSION_LISTER)).toBe(
      true,
    );
    expect(
      container.isRegistered(GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE),
    ).toBe(true);

    const lister = container.resolve<IGatewaySessionLister>(
      GATEWAY_TOKENS.GATEWAY_SESSION_LISTER,
    );
    await expect(lister.listForWorkspace('/any/workspace')).resolves.toEqual({
      sessions: [],
      truncated: false,
    });

    const probe = container.resolve<ISessionActivityProbe>(
      GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE,
    );
    expect(probe.isActive('any-session-uuid')).toBe(false);
  });

  it('preserves a host-registered real lister + probe (Electron wires them before calling — guard must not clobber)', () => {
    const container = rootContainer.createChildContainer();

    const realLister: IGatewaySessionLister = {
      listForWorkspace: async () => ({
        sessions: [{ sessionId: 's1', name: 'Real', lastActiveAt: 1 }],
        truncated: false,
      }),
    };
    const realProbe: ISessionActivityProbe = { isActive: () => true };
    container.register(GATEWAY_TOKENS.GATEWAY_SESSION_LISTER, {
      useValue: realLister,
    });
    container.register(GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE, {
      useValue: realProbe,
    });

    registerMessagingGatewayServices(container, createLogger());

    expect(
      container.resolve<IGatewaySessionLister>(
        GATEWAY_TOKENS.GATEWAY_SESSION_LISTER,
      ),
    ).toBe(realLister);
    expect(
      container.resolve<ISessionActivityProbe>(
        GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE,
      ),
    ).toBe(realProbe);
  });
});

describe('registerMessagingGatewayServices — façade collaborators (TASK_2026_271)', () => {
  /**
   * Stub out the leaf dependencies of the two collaborators. tsyringe resolves
   * the LAST registration for a token, so registering these AFTER
   * `registerMessagingGatewayServices` replaces the heavy real ones (stores
   * need a live SQLite connection, the command service needs the whole
   * control plane) without touching production wiring.
   */
  function containerWithStubbedLeaves() {
    const container = rootContainer.createChildContainer();
    registerMessagingGatewayServices(container, createLogger());

    container.register(TOKENS.LOGGER, { useValue: createLogger() });
    container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: {
        getConfiguration: jest.fn(),
        setConfiguration: jest.fn(),
      },
    });
    container.register(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT, {
      useValue: {
        isEncryptionAvailable: () => true,
        encrypt: jest.fn(),
        decrypt: jest.fn(),
      },
    });
    container.register(SETTINGS_TOKENS.GATEWAY_SETTINGS, { useValue: {} });
    container.register(GATEWAY_TOKENS.GATEWAY_COMMAND_SERVICE, {
      useValue: { handleCommand: jest.fn(), handleAutocomplete: jest.fn() },
    });
    container.register(GATEWAY_TOKENS.GATEWAY_BINDING_STORE, { useValue: {} });
    container.register(GATEWAY_TOKENS.GATEWAY_MESSAGE_STORE, { useValue: {} });
    return container;
  }

  it('registers both collaborator tokens as singletons', () => {
    const container = containerWithStubbedLeaves();

    expect(
      container.isRegistered(GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE),
    ).toBe(true);
    expect(
      container.isRegistered(GATEWAY_TOKENS.GATEWAY_OUTBOUND_DELIVERY),
    ).toBe(true);

    const lifecycle = container.resolve<AdapterLifecycleService>(
      GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE,
    );
    const outbound = container.resolve<OutboundDeliveryService>(
      GATEWAY_TOKENS.GATEWAY_OUTBOUND_DELIVERY,
    );

    expect(lifecycle).toBeInstanceOf(AdapterLifecycleService);
    expect(outbound).toBeInstanceOf(OutboundDeliveryService);
    // Singletons: the façade and the delivery service must see the SAME
    // lifecycle instance, or `adapterFor()` would look at an empty adapter map.
    expect(container.resolve(GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE)).toBe(
      lifecycle,
    );
    expect(container.resolve(GATEWAY_TOKENS.GATEWAY_OUTBOUND_DELIVERY)).toBe(
      outbound,
    );
  });

  it('gives OutboundDeliveryService the same lifecycle singleton the façade gets', () => {
    const container = containerWithStubbedLeaves();

    const lifecycle = container.resolve<AdapterLifecycleService>(
      GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE,
    );
    const outbound = container.resolve<OutboundDeliveryService>(
      GATEWAY_TOKENS.GATEWAY_OUTBOUND_DELIVERY,
    );

    expect(
      (outbound as unknown as { lifecycle: AdapterLifecycleService }).lifecycle,
    ).toBe(lifecycle);
  });

  it('keeps every gateway token description globally unique (Ptah-prefixed convention)', () => {
    const descriptions = Object.values(GATEWAY_TOKENS).map(
      (s) => s.description,
    );

    expect(descriptions).toContain('PtahGatewayAdapterLifecycle');
    expect(descriptions).toContain('PtahGatewayOutboundDelivery');
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(descriptions.every((d) => d?.startsWith('Ptah'))).toBe(true);
  });
});
