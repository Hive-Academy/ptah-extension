import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { SubagentBudgetStopCallbackRegistry } from './subagent-budget-stop-callback-registry';

describe('SubagentBudgetStopCallbackRegistry', () => {
  it('isolates a throwing listener and lets later listeners receive the id-only signal', () => {
    const logger = Object.assign(Object.create(Logger.prototype) as Logger, {
      error: jest.fn(),
    });
    const registry = new SubagentBudgetStopCallbackRegistry(logger);
    const received: string[] = [];
    registry.register(() => { throw new Error('listener failed'); });
    const unregister = registry.register(({ agentId }) => { received.push(agentId); });
    registry.notifyAll({ agentId: 'agent_1', parentSessionId: 'parent', timestamp: 123 });
    expect(received).toEqual(['agent_1']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    unregister();
    expect(registry.size).toBe(1);
  });
});
