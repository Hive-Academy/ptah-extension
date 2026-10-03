import 'reflect-metadata';
import { isFileBasedSettingKey } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ReasoningSettings } from '@ptah-extension/settings-core';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';

/**
 * TASK_2026_555 D8 regression: the spawn-time readers must use the writer's
 * key form — `('ptah', 'agentOrchestration.<key>')` — because the workspace
 * providers route a read to the file store only when
 * `section === 'ptah' && isFileBasedSettingKey(key)`
 * (vscode-workspace-provider.ts getConfiguration / electron-workspace-provider.ts).
 * The pre-fix readers passed `('ptah.agentOrchestration', '<key>')`, which
 * missed the file route entirely, so values written by `agent:setConfig`
 * never reached a spawned CLI.
 *
 * This fake reproduces that routing rule exactly, with the two maps the real
 * providers hold: the file-backed `~/.ptah/settings.json` store and the host
 * configuration (VS Code settings.json). A value that lives in the wrong map
 * must not resolve — that asymmetry is the bug detector.
 */
function makeRoutingEnvironment(
  options: {
    fileStore?: Record<string, unknown>;
    hostConfig?: Record<string, unknown>;
    effort?: string;
  } = {},
): { environment: AgentSpawnEnvironment; write: jest.Mock } {
  const fileStore: Record<string, unknown> = { ...options.fileStore };
  // Host configuration is keyed by the full dotted path, the way VS Code
  // resolves `ptah.agentOrchestration.codexModel` in settings.json.
  const hostConfig: Record<string, unknown> = { ...options.hostConfig };

  const getConfiguration = jest.fn(
    <T>(section: string, key: string, defaultValue?: T): T | undefined => {
      const fullKey = section === '' ? key : `${section}.${key}`;
      if (section === 'ptah' && isFileBasedSettingKey(key)) {
        return (
          fileStore[key] !== undefined ? fileStore[key] : defaultValue
        ) as T | undefined;
      }
      return (
        hostConfig[fullKey] !== undefined ? hostConfig[fullKey] : defaultValue
      ) as T | undefined;
    },
  );
  const setConfiguration = jest.fn(
    async (section: string, key: string, value: unknown): Promise<void> => {
      if (section === 'ptah' && isFileBasedSettingKey(key)) {
        fileStore[key] = value;
        return;
      }
      hostConfig[`${section}.${key}`] = value;
    },
  );

  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:\\projects\\workspace-a'),
    getWorkspaceFolders: jest
      .fn()
      .mockReturnValue(['D:\\projects\\workspace-a']),
    getConfiguration,
    setConfiguration,
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const cliDetection = {
    getAdapter: jest.fn(() => ({})),
    getDetection: jest.fn(() => Promise.resolve(undefined)),
    getInstalledClis: jest.fn(() => Promise.resolve([])),
  };
  const sentryService = { captureException: jest.fn() };
  const reasoningSettings = {
    effort: { get: jest.fn(() => options.effort ?? '') },
  } as unknown as ReasoningSettings;

  const environment = new AgentSpawnEnvironment(
    logger as never,
    cliDetection as never,
    workspaceProvider,
    reasoningSettings,
    sentryService as never,
    null,
    null,
    null,
  );
  return { environment, write: setConfiguration };
}

describe('AgentSpawnEnvironment — agentOrchestration settings routing (D8)', () => {
  it('reads a model written with the writer key form through the file store', () => {
    const { environment, write } = makeRoutingEnvironment();
    // The form agent:setConfig uses (agent-rpc.handlers.ts setAgentOrchestration).
    write('ptah', 'agentOrchestration.codexModel', 'gpt-5.2-codex');

    expect(environment.resolveModel('codex', undefined)).toEqual({
      model: 'gpt-5.2-codex',
      source: 'setting',
    });
  });

  it('reads the per-CLI effort key the writer writes when no UI effort is set', () => {
    const { environment, write } = makeRoutingEnvironment();
    write('ptah', 'agentOrchestration.copilotReasoningEffort', 'medium');

    expect(environment.resolveReasoningEffort('copilot').effort).toBe('medium');
  });

  // Rewritten for TASK_2026_597 R2.3: the order was "UI effort first, setting
  // second"; a concrete setting now wins, and `inherit` yields the UI effort.
  it('lets a concrete file-stored effort win over the UI effort selection', () => {
    const { environment } = makeRoutingEnvironment({
      fileStore: { 'agentOrchestration.codexReasoningEffort': 'low' },
      effort: 'high',
    });

    expect(environment.resolveReasoningEffort('codex')).toEqual({
      effort: 'low',
      step: 2,
      ignored: [],
    });
  });

  it('yields the UI effort when the file-stored effort is inherit', () => {
    const { environment } = makeRoutingEnvironment({
      fileStore: { 'agentOrchestration.codexReasoningEffort': 'inherit' },
      effort: 'high',
    });

    expect(environment.resolveReasoningEffort('codex')).toEqual({
      effort: 'high',
      step: 3,
      ignored: [],
    });
  });

  it.each(['codex', 'copilot'] as const)(
    'never hands a stored inherit to %s argv',
    (cli) => {
      const { environment } = makeRoutingEnvironment({
        fileStore: { [`agentOrchestration.${cli}ReasoningEffort`]: 'inherit' },
      });

      const resolved = environment.resolveReasoningEffort(cli);
      expect(resolved.effort).toBeUndefined();
      expect(resolved.step).toBe(6);
    },
  );

  it('reads pi effort raw from the file store over the UI selection', () => {
    const { environment } = makeRoutingEnvironment({
      fileStore: { 'agentOrchestration.piReasoningEffort': 'max' },
      effort: 'low',
    });

    expect(environment.resolveReasoningEffort('pi').effort).toBe('max');
  });

  it('resolves a stored pi inherit to the UI effort, never to inherit', () => {
    const withChat = makeRoutingEnvironment({
      fileStore: { 'agentOrchestration.piReasoningEffort': 'inherit' },
      effort: 'high',
    }).environment;
    const withoutChat = makeRoutingEnvironment({
      fileStore: { 'agentOrchestration.piReasoningEffort': 'inherit' },
    }).environment;

    expect(withChat.resolveReasoningEffort('pi')).toEqual({
      effort: 'high',
      step: 3,
      ignored: [],
    });
    expect(withoutChat.resolveReasoningEffort('pi').effort).toBeUndefined();
    expect(
      withoutChat.resolveReasoningEffort('pi', { roleName: 'senior-tester' }),
    ).toEqual({ effort: 'medium', step: 4, ignored: [] });
  });

  it('reads the Codex lane budgets from the file store', () => {
    const { environment } = makeRoutingEnvironment({
      fileStore: {
        'agentOrchestration.codexAutoCompactTokens': 90000,
        'agentOrchestration.codexToolOutputTokenLimit': 0,
        'agentOrchestration.codexWebSearch': false,
      },
    });

    expect(environment.resolveLaneBudgets()).toEqual({
      autoCompactTokens: 90000,
      toolOutputTokenLimit: 0,
      webSearch: false,
    });
  });

  it('reads copilot auto-approve from the file store', () => {
    const off = makeRoutingEnvironment({
      fileStore: { 'agentOrchestration.copilotAutoApprove': false },
    }).environment;
    const on = makeRoutingEnvironment().environment;

    expect(off.resolveAutoApprove('copilot')).toBe(false);
    expect(on.resolveAutoApprove('copilot')).toBe(true);
  });

  it('keeps the defaults when the file store has no value', () => {
    const { environment } = makeRoutingEnvironment();

    expect(environment.resolveModel('codex', undefined)).toEqual({
      model: 'gpt-6-sol',
      source: 'ptah-default',
    });
    expect(environment.resolveAutoApprove('copilot')).toBe(true);
    expect(environment.resolveReasoningEffort('pi').effort).toBeUndefined();
    expect(environment.resolveLaneBudgets()).toEqual({
      autoCompactTokens: 120000,
      toolOutputTokenLimit: 2500,
      webSearch: true,
    });
  });

  it('does not read the host configuration for these file-routed keys', () => {
    // A hand-edited host value under the legacy section form was the ONLY way
    // the pre-fix reader could see these keys. They are not contributed in
    // the VS Code manifest and no Ptah writer ever stored them there, so the
    // file store is the single source of truth (see batch-4-report.md).
    const { environment } = makeRoutingEnvironment({
      hostConfig: {
        'ptah.agentOrchestration.codexModel': 'stale-host-value',
        'ptah.agentOrchestration.copilotAutoApprove': false,
      },
    });

    expect(environment.resolveModel('codex', undefined).source).toBe(
      'ptah-default',
    );
    expect(environment.resolveAutoApprove('copilot')).toBe(true);
  });
});
