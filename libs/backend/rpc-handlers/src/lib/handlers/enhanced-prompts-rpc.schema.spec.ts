jest.mock('@ptah-extension/agent-generation', () => ({
  ProjectAnalysisResultSchema: jest.requireActual('zod').z.object({}),
}));

import {
  EnhancedPromptsRunWizardParamsSchema,
  EnhancedPromptsRegenerateParamsSchema,
  EnhancedPromptsRunBindingSchema,
} from './enhanced-prompts-rpc.schema';

const tabBinding = {
  tabId: 'tab-1',
  workflow: 'setup-project-prompt',
  workspacePath: '/workspace',
};

describe('enhanced prompts bound schemas', () => {
  it('accepts a guidance tab on existing start methods', () => {
    expect(
      EnhancedPromptsRunWizardParamsSchema.safeParse({
        workspacePath: '/workspace',
        tabBinding,
      }).success,
    ).toBe(true);
    expect(
      EnhancedPromptsRegenerateParamsSchema.safeParse({
        workspacePath: '/workspace',
        tabBinding,
        model: 'sonnet',
      }).success,
    ).toBe(true);
  });

  it('rejects agent workflow and malformed exact-run bindings', () => {
    expect(
      EnhancedPromptsRunWizardParamsSchema.safeParse({
        workspacePath: '/workspace',
        tabBinding: { ...tabBinding, workflow: 'setup-agent-generation' },
      }).success,
    ).toBe(false);
    expect(
      EnhancedPromptsRunBindingSchema.safeParse({
        ...tabBinding,
        runId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});
