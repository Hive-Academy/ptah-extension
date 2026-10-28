import { describe, it, expect } from '@jest/globals';
import type { AgentModelLayers } from '@ptah-extension/shared';
import { resolveClaudeAgentModel } from './agent-model-resolution';

describe('resolveClaudeAgentModel', () => {
  it('uses a workspace override first', () => {
    const layers: AgentModelLayers = {
      workspace: { 'backend-developer': { claude: ' sonnet ' } },
      machine: { 'backend-developer': { claude: 'haiku' } },
    };

    expect(resolveClaudeAgentModel(layers, 'backend-developer', 'opus')).toEqual(
      { value: 'sonnet', origin: 'workspace' },
    );
  });

  it('falls back to a machine override', () => {
    const layers: AgentModelLayers = {
      workspace: { 'other-agent': { claude: 'sonnet' } },
      machine: { '*': { claude: 'haiku' } },
    };

    expect(resolveClaudeAgentModel(layers, 'backend-developer', 'opus')).toEqual(
      { value: 'haiku', origin: 'machine' },
    );
  });

  it('uses the trimmed template model when no override applies', () => {
    expect(resolveClaudeAgentModel(null, 'backend-developer', ' opus ')).toEqual(
      { value: 'opus', origin: 'template' },
    );
    expect(
      resolveClaudeAgentModel({}, 'backend-developer', 'opus'),
    ).toEqual({ value: 'opus', origin: 'template' });
  });

  it('returns no model when neither an override nor a template model exists', () => {
    expect(resolveClaudeAgentModel(null, 'backend-developer', undefined)).toEqual(
      { value: null, origin: 'none' },
    );
    expect(resolveClaudeAgentModel(null, 'backend-developer', '   ')).toEqual({
      value: null,
      origin: 'none',
    });
  });

  it('ignores an override Claude Code would reject and reports it', () => {
    const layers: AgentModelLayers = {
      workspace: { 'backend-developer': { claude: 'gpt-5' } },
    };

    expect(resolveClaudeAgentModel(layers, 'backend-developer', 'opus')).toEqual(
      { value: 'opus', origin: 'template', ignoredOverride: 'gpt-5' },
    );
    expect(
      resolveClaudeAgentModel(layers, 'backend-developer', undefined),
    ).toEqual({ value: null, origin: 'none', ignoredOverride: 'gpt-5' });
  });

  it('never reads another provider leaf', () => {
    const layers: AgentModelLayers = {
      workspace: { 'backend-developer': { codex: 'gpt-5' } },
    };

    expect(resolveClaudeAgentModel(layers, 'backend-developer', 'opus')).toEqual(
      { value: 'opus', origin: 'template' },
    );
  });
});
