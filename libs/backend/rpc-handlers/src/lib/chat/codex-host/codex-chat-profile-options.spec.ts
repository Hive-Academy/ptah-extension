import {
  classifyCodexChatOptions,
  CodexChatOptionError,
} from './codex-chat-profile-options';

describe('classifyCodexChatOptions', () => {
  it('preserves every reviewed option without mutating the input', () => {
    const config = Object.freeze({
      projectPath: '/workspace',
      workspaceId: '/workspace',
      model: 'gpt-5.4',
      tabId: 'tab',
      prompt: 'hello',
      name: 'chat',
      sessionName: 'session',
      sessionTitle: 'title',
      runtime: 'codex-app-server',
      permissionLevel: 'ask',
      effort: 'high',
      systemPrompt: 'system',
      ptahUiFence: true,
      mcpToolProfile: 'coding',
      enhancedPromptsContent: 'instructions',
      outputStyleBody: 'style',
      files: ['file.ts'],
      images: [{ data: 'image', mediaType: 'image/png' }],
      mcpServerRunning: true,
      mcpServersOverride: {
        smithery: { type: 'http', url: 'https://example.invalid/mcp' },
      },
    });
    expect(classifyCodexChatOptions(config)).toEqual({
      supported: config,
      stripped: [],
      rejected: [],
    });
    expect(classifyCodexChatOptions(config).supported).not.toBe(config);
  });

  it('accepts the coding tool profile for the UI hint gate', () => {
    const mcpToolProfile = 'coding';
    expect(classifyCodexChatOptions({ ptahUiFence: true, mcpToolProfile })).toEqual({
      supported: { ptahUiFence: true, mcpToolProfile }, stripped: [], rejected: [],
    });
  });

  it.each(['apps', 'default', '', null, false, 0] as const)(
    'rejects the defined non-coding tool profile %s while accepting the fence',
    (mcpToolProfile) => {
      expect(classifyCodexChatOptions({ ptahUiFence: true, mcpToolProfile })).toEqual({
        supported: { ptahUiFence: true },
        stripped: [],
        rejected: ['mcpToolProfile'],
      });
    },
  );

  it.each([true, false])('accepts the UI fence when %s', (ptahUiFence) => {
    expect(classifyCodexChatOptions({ ptahUiFence })).toEqual({
      supported: { ptahUiFence }, stripped: [], rejected: [],
    });
  });

  it.each([true, false])('strips host and Claude flags but keeps MCP keys when %s', (value) => {
    const config = Object.freeze({
      tabId: 'tab',
      mcpServerRunning: value,
      workflowsDisabled: value,
      includePartialMessages: value,
      mcpServersOverride: {},
    });
    expect(classifyCodexChatOptions(config)).toEqual({
      supported: { tabId: 'tab', mcpServerRunning: value, mcpServersOverride: {} },
      stripped: ['workflowsDisabled', 'includePartialMessages'],
      rejected: [],
    });
    expect(config.mcpServerRunning).toBe(value);
  });

  it.each([
    ['temperature', 0.5],

    ['futureOption', null],
    ['futureOption', false],
    ['futureOption', 0],
    ['futureOption', ''],
  ] as const)('rejects defined %s without returning its value', (key, value) => {
    expect(classifyCodexChatOptions({ [key]: value })).toEqual({
      supported: {},
      stripped: [],
      rejected: [key],
    });
  });

  it('supports MCP servers and strips only the remaining ambient options', () => {
    const mcpServersOverride = {
      smithery: { url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer secret-token-x' } },
      oauth: { url: 'https://example.invalid/oauth' },
    };
    const config = Object.freeze({
      mcpServersOverride,
      thinking: { type: 'adaptive' },
      outputStyleName: 'Explanatory',
      effort: 'high',
      outputStyleBody: 'style',
    });
    const result = classifyCodexChatOptions(config);
    expect(result).toEqual({
      supported: { mcpServersOverride, effort: 'high', outputStyleBody: 'style' },
      stripped: ['thinking', 'outputStyleName'],
      rejected: [],
    });
    expect(result.stripped).not.toContain('mcpServersOverride');
    expect(result.stripped).not.toContain('mcpServerRunning');
  });

  it('ignores undefined supported, stripped, rejected and future options', () => {
    expect(classifyCodexChatOptions({
      model: undefined,
      ptahUiFence: undefined,
      mcpToolProfile: undefined,
      mcpServerRunning: undefined,
      thinking: undefined,
      outputStyleName: undefined,
      mcpServersOverride: undefined,
      futureOption: undefined,
    })).toEqual({ supported: {}, stripped: [], rejected: [] });
  });

  it('exports a coded error naming only the rejected key', () => {
    const error = new CodexChatOptionError('temperature');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'CodexChatOptionError',
      code: 'unsupported-option',
      key: 'temperature',
      message: 'Codex chat does not support the "temperature" option.',
    });
  });
});
