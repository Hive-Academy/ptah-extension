import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentRoleDefinition, AuthEnv } from '@ptah-extension/shared';

jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
  },
}));

const mockModeOverride: { mode?: 'preset-append' | 'standalone' } = {};

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    assembleSystemPrompt: jest.fn((input: unknown) => {
      const result = actual.assembleSystemPrompt(input);
      return mockModeOverride.mode
        ? { ...result, mode: mockModeOverride.mode }
        : result;
    }),
  };
});

import { PtahCliSpawnOptions } from './ptah-cli-spawn-options.service';
import { renderRoleBlock } from '../../cli-agents/cli-adapters/cli-adapter.utils';

const AUTH_ENV = {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:51830',
} as unknown as AuthEnv;

const ROLE: AgentRoleDefinition = {
  name: 'backend-developer',
  description: 'Writes server code',
  body: 'ROLE_BODY_MARKER: implement the batch in dependency order.',
  sourcePath: '/repo/.claude/agents/backend-developer.md',
  bytes: 58,
};

const GUIDANCE = 'GUIDANCE_MARKER: follow the repo rules.';

function buildService(): PtahCliSpawnOptions {
  return new PtahCliSpawnOptions(
    createMockLogger() as unknown as Logger,
    { createHooks: jest.fn().mockReturnValue({}) } as never,
    { createHooks: jest.fn().mockReturnValue({}) } as never,
    { getConfig: jest.fn().mockReturnValue({ enabled: false }) } as never,
    {
      getProjectGuidanceContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    undefined,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
  );
}

describe('PtahCliSpawnOptions — role delivery', () => {
  afterEach(() => {
    mockModeOverride.mode = undefined;
  });

  it('appends the role block after the project guidance', async () => {
    const assembly = await buildService().assembleSpawnOptions(
      AUTH_ENV,
      '/repo',
      GUIDANCE,
      'opus',
      undefined,
      undefined,
      ROLE,
    );

    const content = assembly.systemPromptContent ?? '';
    const guidanceIndex = content.indexOf('## Project Guidance');
    const roleIndex = content.indexOf(renderRoleBlock(ROLE, 'ptah-cli'));
    expect(guidanceIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(guidanceIndex);
    expect(content.indexOf(GUIDANCE)).toBeLessThan(roleIndex);
    expect(content.endsWith(renderRoleBlock(ROLE, 'ptah-cli'))).toBe(true);
  });

  it('carries no role section when no role is given', async () => {
    const assembly = await buildService().assembleSpawnOptions(
      AUTH_ENV,
      '/repo',
      GUIDANCE,
      'opus',
    );

    const content = assembly.systemPromptContent ?? '';
    expect(content).toContain('## Project Guidance');
    expect(content).not.toContain('## Role:');
    expect(content).not.toContain('ROLE_BODY_MARKER');
  });

  it('carries the role section when there is no project guidance', async () => {
    const assembly = await buildService().assembleSpawnOptions(
      AUTH_ENV,
      '/repo',
      undefined,
      'opus',
      undefined,
      undefined,
      ROLE,
    );

    const content = assembly.systemPromptContent ?? '';
    expect(content).not.toContain('## Project Guidance');
    expect(content).toContain(`## Role: ${ROLE.name}`);
    expect(content).toContain(ROLE.body);
  });

  it.each(['preset-append', 'standalone'] as const)(
    'carries the role section in %s mode',
    async (mode) => {
      mockModeOverride.mode = mode;

      const assembly = await buildService().assembleSpawnOptions(
        AUTH_ENV,
        '/repo',
        GUIDANCE,
        'opus',
        undefined,
        undefined,
        ROLE,
      );

      expect(assembly.systemPromptMode).toBe(mode);
      expect(assembly.systemPromptContent).toContain(
        renderRoleBlock(ROLE, 'ptah-cli'),
      );
    },
  );
});
