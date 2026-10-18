import 'reflect-metadata';
import { describe, it, expect, jest } from '@jest/globals';
import { registerSetupAgentsCommand } from './setup-agents-command';
import type { SetupGenerationOpenPayload } from '@ptah-extension/shared';

jest.mock('vscode', () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] },
  window: { showErrorMessage: jest.fn() },
}));

describe('registerSetupAgentsCommand', () => {
  it('opens the landing by default and routes an explicit workflow to main', async () => {
    let handler:
      ((request?: { workflow?: unknown }) => Promise<void>) | undefined;
    const launchWizard = jest.fn(async (_workspacePath: string) => ({
      isErr: () => false,
    }));
    const openGeneration = jest.fn(
      async (_payload: SetupGenerationOpenPayload) => ({ isErr: () => false }),
    );
    const commandManager = {
      registerCommand: jest.fn((command: { handler: typeof handler }) => {
        handler = command.handler;
      }),
    };
    registerSetupAgentsCommand(
      { resolve: () => ({ launchWizard, openGeneration }) } as never,
      commandManager as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    );
    await handler?.();
    expect(launchWizard).toHaveBeenCalledWith('/workspace');
    expect(openGeneration).not.toHaveBeenCalled();
    await handler?.({ workflow: 'setup-agent-generation' });
    expect(openGeneration).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      workflow: 'setup-agent-generation',
      origin: 'independent-start',
    });
  });
});
