import 'reflect-metadata';

import type { AISessionConfig } from '@ptah-extension/shared';
import type { HostKind } from '@ptah-extension/vscode-core';
import { PTAH_CORE_SYSTEM_PROMPT, PTAH_UI_HINT } from '../prompt-harness';
import {
  assembleSystemPrompt,
  SdkQueryOptionsBuilder,
} from './sdk-query-options-builder';

interface BuilderWithSystemPrompt {
  buildSystemPrompt(
    sessionConfig?: AISessionConfig,
  ): Promise<{ append?: string }>;
}

function makeBuilder(hostKind?: HostKind): BuilderWithSystemPrompt {
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  const builder = new ctor(
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    },
    noopHooks,
    { getConfig: jest.fn().mockReturnValue({ enabled: true }) },
    noopHooks,
    noopHooks,
    {},
    {
      resolveModelId: jest.fn(),
      hasCachedModels: jest.fn(),
      getSupportedModels: jest.fn(),
    },
    {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    },
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    undefined,
    undefined,
    undefined,
    hostKind,
  );
  return builder as unknown as BuilderWithSystemPrompt;
}

async function assembledFor(
  hostKind: HostKind | undefined,
  sessionConfig: Partial<AISessionConfig>,
): Promise<string> {
  const prompt = await makeBuilder(hostKind).buildSystemPrompt(
    sessionConfig as AISessionConfig,
  );
  return prompt.append ?? '';
}

function expectHintAbsent(prompt: string): void {
  expect(prompt).not.toContain(PTAH_UI_HINT);
}

describe('SdkQueryOptionsBuilder ptah-ui hint gate', () => {
  it.each([
    [
      'electron explicit coding',
      'electron',
      { mcpToolProfile: 'coding' },
      true,
    ],
    [
      'electron coding disabled or absent',
      'electron',
      { mcpToolProfile: 'coding', ptahUiFence: false },
      false,
    ],
    ['electron apps', 'electron', { mcpToolProfile: 'apps' }, false],
    [
      'undefined spoofed',
      undefined,
      { mcpToolProfile: 'coding', ptahUiFence: true },
      false,
    ],
    [
      'vscode spoofed',
      'vscode',
      { mcpToolProfile: 'coding', ptahUiFence: true },
      false,
    ],
    [
      'tui spoofed',
      'tui',
      { mcpToolProfile: 'coding', ptahUiFence: true },
      false,
    ],
    [
      'cli spoofed',
      'cli',
      { mcpToolProfile: 'coding', ptahUiFence: true },
      false,
    ],
  ] as const)('%s', async (_label, hostKind, sessionConfig, expected) => {
    const prompt = await assembledFor(hostKind, {
      ...sessionConfig,
      ...(expected ? { ptahUiFence: true } : {}),
    });

    if (!expected) {
      expectHintAbsent(prompt);
      if (_label === 'electron coding disabled or absent') {
        expectHintAbsent(
          await assembledFor(hostKind, { mcpToolProfile: 'coding' }),
        );
      }
      return;
    }
    expect(prompt.split(PTAH_UI_HINT)).toHaveLength(2);
    expect(prompt).toContain(`${PTAH_CORE_SYSTEM_PROMPT}\n\n${PTAH_UI_HINT}`);
    expect(await assembledFor(hostKind, { ptahUiFence: true })).toContain(
      PTAH_UI_HINT,
    );
  });
});

describe('assembleSystemPrompt ptah-ui hint', () => {
  it('omits the hint when ptahUiHint is absent', () => {
    expect(
      assembleSystemPrompt({
        providerId: null,
        resolvedModel: undefined,
        mcpServerRunning: true,
      }).content,
    ).not.toContain(PTAH_UI_HINT);
  });
});
