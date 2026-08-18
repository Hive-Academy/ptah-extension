/**
 * PtahCliSpawnOptions — output-style resolution for a spawned agent
 * (TASK_2026_197).
 *
 * The registry spec proves the flag reaches the SDK. This one proves the two
 * things that decide WHICH flag:
 *
 *  1. the activation is resolved with `userSettingSourceIncluded: true`, because
 *     `PtahCliRegistry` hardcodes `settingSources: ['user', 'project', 'local']`
 *     for every spawn. Without it the resolver takes its inject branch for a
 *     user-tier style on a localhost provider — and since the SDK also reads
 *     that file through the 'user' source, the style would be applied TWICE
 *     (R3 / Req 5.3);
 *  2. the resolution is scoped to the spawn's own cwd, so a project-tier style
 *     belongs to the repo the agent works in.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import type { OutputStyleSessionActivationService } from '@ptah-extension/output-styles';
// The service imports `AGENT_GENERATION_TOKENS` from `agent-generation`, whose
// barrel reaches `workspace-intelligence`'s tree-sitter loader and its
// `import.meta.url` — which this Jest transform cannot parse. Only the DI token
// is needed here, and the enhanced-prompts collaborator is injected directly.
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
  },
}));

import { PtahCliSpawnOptions } from './ptah-cli-spawn-options.service';

const AUTH_ENV = {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:51830',
} as unknown as AuthEnv;

function buildService(
  fields: { outputStyleName?: string; outputStyleBody?: string } | 'absent',
): {
  service: PtahCliSpawnOptions;
  resolveSessionFields: jest.Mock;
} {
  const resolveSessionFields = jest.fn().mockResolvedValue(fields);
  const activation =
    fields === 'absent'
      ? undefined
      : ({
          resolveSessionFields,
        } as unknown as OutputStyleSessionActivationService);

  const service = new PtahCliSpawnOptions(
    createMockLogger() as unknown as Logger,
    { createHooks: jest.fn().mockReturnValue({}) } as never,
    { createHooks: jest.fn().mockReturnValue({}) } as never,
    { getConfig: jest.fn().mockReturnValue({ enabled: false }) } as never,
    {
      getProjectGuidanceContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    undefined,
    activation,
  );

  return { service, resolveSessionFields };
}

describe('PtahCliSpawnOptions — output style', () => {
  it('states userSettingSourceIncluded, scoped to the spawn cwd', async () => {
    const { service, resolveSessionFields } = buildService({
      outputStyleName: 'Terse',
    });

    await service.assembleSpawnOptions(AUTH_ENV, '/repo');

    expect(resolveSessionFields).toHaveBeenCalledWith({
      workspaceRoot: '/repo',
      userSettingSourceIncluded: true,
    });
  });

  it('returns the active style name on the assembly', async () => {
    const { service } = buildService({ outputStyleName: 'Terse' });

    const assembly = await service.assembleSpawnOptions(AUTH_ENV, '/repo');

    expect(assembly.outputStyleName).toBe('Terse');
  });

  it('returns no style name when nothing is selected', async () => {
    const { service } = buildService({});

    const assembly = await service.assembleSpawnOptions(AUTH_ENV, '/repo');

    expect(assembly.outputStyleName).toBeUndefined();
  });

  it('appends the body to the system prompt on the inject branch', async () => {
    const { service } = buildService({ outputStyleBody: 'Answer tersely.' });

    const assembly = await service.assembleSpawnOptions(AUTH_ENV, '/repo');

    expect(assembly.systemPromptContent).toContain('Answer tersely.');
    expect(assembly.outputStyleName).toBeUndefined();
  });

  it('spawns unstyled when the host never registered the service', async () => {
    const { service } = buildService('absent');

    const assembly = await service.assembleSpawnOptions(AUTH_ENV, '/repo');

    expect(assembly.outputStyleName).toBeUndefined();
  });
});
