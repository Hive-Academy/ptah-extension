import 'reflect-metadata';
import { describe, it, expect, jest } from '@jest/globals';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { ElectronSetupWizardService } from './electron-setup-wizard.service';

describe('ElectronSetupWizardService', () => {
  it('preserves the landing path and sends generation to the main consumer', async () => {
    const broadcastMessage = jest.fn(
      async (_type: string, _payload: unknown) => undefined,
    );
    const service = new ElectronSetupWizardService(
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { broadcastMessage },
    );
    expect((await service.launchWizard('/workspace')).isOk()).toBe(true);
    expect(broadcastMessage).toHaveBeenCalledWith(MESSAGE_TYPES.SWITCH_VIEW, {
      view: 'setup-wizard',
    });
    broadcastMessage.mockClear();
    const payload = {
      workspacePath: '/workspace',
      workflow: 'setup-agent-generation' as const,
      origin: 'independent-start' as const,
    };
    expect((await service.openGeneration(payload)).isOk()).toBe(true);
    expect(broadcastMessage.mock.calls).toEqual([
      [MESSAGE_TYPES.SWITCH_VIEW, { view: 'orchestra-canvas' }],
      [MESSAGE_TYPES.SETUP_GENERATION_OPEN, payload],
    ]);
  });

  it('returns a retryable error when the main push fails', async () => {
    const broadcastMessage = jest.fn(async (_type: string) => {
      throw new Error('not ready');
    });
    const service = new ElectronSetupWizardService(
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { broadcastMessage },
    );
    const result = await service.openGeneration({
      workspacePath: '/workspace',
      workflow: 'setup-project-prompt',
      origin: 'independent-start',
    });
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toMatch(/Try again/);
  });
});
