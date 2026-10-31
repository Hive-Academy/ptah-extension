import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';

import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { HostRoutingSetting } from './host-routing-setting';

function settingFor(stored: unknown, selection: unknown) {
  const configValues: Record<string, unknown> = {
    'ptah.agentOrchestration.decisionModel': selection,
  };
  if (stored !== undefined)
    configValues['ptah.agentOrchestration.hostRouting'] = stored;
  const workspace = createMockWorkspaceProvider({ config: configValues });
  const logger: LaneRoutingLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = new DecisionModelConfig(
    workspace,
    createMockSecretStorage(),
    createMockStateStorage(),
    logger,
  );
  return { setting: new HostRoutingSetting(workspace, config), workspace };
}

describe('HostRoutingSetting', () => {
  it.each([
    [false, { kind: 'ollama', model: 'nimble' }, false],
    [true, { kind: 'ollama', model: 'nimble' }, true],
    [undefined, { kind: 'ollama', model: 'nimble' }, true],
    ['invalid', { kind: 'ollama', model: 'nimble' }, true],
    [false, { kind: 'unset' }, false],
    [true, { kind: 'unset' }, false],
    [undefined, { kind: 'unset' }, false],
  ])('reads %p with selection %p as %p', (stored, selection, expected) => {
    expect(settingFor(stored, selection).setting.isEnabled()).toBe(expected);
  });

  it('reads configuration live and disables routing if a read fails', () => {
    const { setting, workspace } = settingFor(true, {
      kind: 'ollama',
      model: 'nimble',
    });
    expect(setting.isEnabled()).toBe(true);
    jest.spyOn(workspace, 'getConfiguration').mockImplementation(() => {
      throw new Error('private value');
    });
    expect(setting.isEnabled()).toBe(false);
  });

  it('notifies only for the host-routing switch and the decision model, until disposed', () => {
    const { setting, workspace } = settingFor(true, {
      kind: 'ollama',
      model: 'nimble',
    });
    const listener = jest.fn();
    const subscription = setting.onDidChange(listener);
    workspace.__state.fireConfigurationChange(
      'ptah.agentOrchestration.hostRouting',
    );
    workspace.__state.fireConfigurationChange(
      'ptah.agentOrchestration.decisionModel',
    );
    workspace.__state.fireConfigurationChange('ptah.unrelated');
    expect(listener).toHaveBeenCalledTimes(2);
    subscription.dispose();
    workspace.__state.fireConfigurationChange(
      'ptah.agentOrchestration.hostRouting',
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
