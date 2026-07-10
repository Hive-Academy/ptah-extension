import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import { registerMessagingGatewayServices } from './register';
import { GATEWAY_TOKENS } from './tokens';
import type { IGatewaySessionLister } from '../session-lister.interface';
import type { ISessionActivityProbe } from '../session-activity.interface';
import type { Logger } from '@ptah-extension/vscode-core';

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
