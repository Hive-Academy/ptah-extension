import 'reflect-metadata';
import { homedir } from 'os';
import { promises as fsPromises } from 'fs';
import type {
  ICallerWorkspaceResolver,
  IMcpServerStatus,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { CliDetectionResult, CliType } from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from '@ptah-extension/shared';
import {
  AgentSpawnEnvironment,
  DEFAULT_CONCURRENT_AGENTS,
  MAX_CONCURRENT_AGENTS,
  MIN_CONCURRENT_AGENTS,
} from './agent-spawn-environment.service';
import {
  MIN_SDK_IDLE_RELEASE_MS,
  SDK_IDLE_RELEASE_MS,
} from './agent-process-manager-helpers';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      realpath: jest.fn((p: string) => Promise.resolve(p)),
    },
  };
});

const ROOT_A = 'D:\\projects\\workspace-a';
const ROOT_B = 'D:\\projects\\workspace-b';
const mockedRealpath = fsPromises.realpath as jest.MockedFunction<
  typeof fsPromises.realpath
>;

type EnvironmentArgs = ConstructorParameters<typeof AgentSpawnEnvironment>;

interface EnvironmentHarness {
  environment: AgentSpawnEnvironment;
  logger: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
  sentryService: { captureException: jest.Mock };
  cliDetection: {
    getAdapter: jest.Mock;
    getDetection: jest.Mock;
    getInstalledClis: jest.Mock;
  };
}

function makeEnvironment(
  options: {
    providerRoot?: string | undefined;
    config?: Record<string, unknown>;
    effort?: string;
    installed?: CliType[];
    harnessPreflight?: { ensure: jest.Mock } | null;
    mcpServerStatus?: IMcpServerStatus | null;
    resolver?: ICallerWorkspaceResolver | null;
  } = {},
): EnvironmentHarness {
  const config = options.config ?? {};
  const installed = options.installed ?? ['codex'];
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const providerRoot =
    'providerRoot' in options ? options.providerRoot : ROOT_A;
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue(providerRoot),
    getWorkspaceFolders: jest
      .fn()
      .mockReturnValue(providerRoot ? [providerRoot] : []),
    getConfiguration: jest.fn(
      (_section: string, key: string, dflt?: unknown) => {
        const lastSegment = key.split('.').pop() ?? key;
        return lastSegment in config ? config[lastSegment] : dflt;
      },
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
  const detectionOf = (cli: CliType): CliDetectionResult => ({
    cli,
    installed: installed.includes(cli),
    messagingMode: 'queue',
  });
  const cliDetection = {
    getAdapter: jest.fn(() => ({})),
    getDetection: jest.fn((cli: CliType) => Promise.resolve(detectionOf(cli))),
    getInstalledClis: jest.fn(() =>
      Promise.resolve(installed.map((cli) => detectionOf(cli))),
    ),
  };
  const sentryService = { captureException: jest.fn() };
  const environment = new AgentSpawnEnvironment(
    logger as unknown as EnvironmentArgs[0],
    cliDetection as unknown as EnvironmentArgs[1],
    workspaceProvider,
    {
      effort: { get: jest.fn(() => options.effort ?? '') },
    } as unknown as EnvironmentArgs[3],
    sentryService as unknown as EnvironmentArgs[4],
    (options.harnessPreflight ?? null) as unknown as EnvironmentArgs[5],
    options.mcpServerStatus ?? null,
    options.resolver ?? null,
  );
  return { environment, logger, sentryService, cliDetection };
}

describe('AgentSpawnEnvironment', () => {
  beforeEach(() => {
    mockedRealpath.mockImplementation(async (p) => String(p));
  });

  describe('resolveReasoningEffort()', () => {
    it('lets the UI effort selection drive codex and copilot', () => {
      const { environment } = makeEnvironment({
        effort: 'high',
        config: { codexReasoningEffort: 'low' },
      });
      expect(environment.resolveReasoningEffort('codex')).toBe('high');
      expect(environment.resolveReasoningEffort('copilot')).toBe('high');
    });

    it("maps UI 'max' to 'xhigh' for codex", () => {
      const { environment } = makeEnvironment({ effort: 'max' });
      expect(environment.resolveReasoningEffort('codex')).toBe('xhigh');
    });

    it('falls back to the per-CLI config and drops an unknown value', () => {
      expect(
        makeEnvironment({
          config: { copilotReasoningEffort: 'medium' },
        }).environment.resolveReasoningEffort('copilot'),
      ).toBe('medium');
      expect(
        makeEnvironment({
          config: { codexReasoningEffort: 'turbo' },
        }).environment.resolveReasoningEffort('codex'),
      ).toBeUndefined();
    });

    it.each([
      ['minimal', 'low'],
      ['medium', 'medium'],
      ['xhigh', 'high'],
      ['max', 'high'],
      ['', undefined],
    ])("clamps antigravity effort '%s' to %s", (effort, expected) => {
      const { environment } = makeEnvironment({ effort });
      expect(environment.resolveReasoningEffort('antigravity')).toBe(expected);
    });

    it('passes pi effort through raw and ignores the UI selection', () => {
      const { environment } = makeEnvironment({
        effort: 'low',
        config: { piReasoningEffort: 'max' },
      });
      expect(environment.resolveReasoningEffort('pi')).toBe('max');
    });

    it('is undefined for a CLI with no effort channel', () => {
      const { environment } = makeEnvironment({ effort: 'high' });
      expect(environment.resolveReasoningEffort('cursor')).toBeUndefined();
    });
  });

  describe('resolveAutoApprove()', () => {
    it('reads the copilot setting with a true default', () => {
      expect(makeEnvironment().environment.resolveAutoApprove('copilot')).toBe(
        true,
      );
      expect(
        makeEnvironment({
          config: { copilotAutoApprove: false },
        }).environment.resolveAutoApprove('copilot'),
      ).toBe(false);
    });

    it('is undefined for every other CLI', () => {
      const { environment } = makeEnvironment();
      expect(environment.resolveAutoApprove('codex')).toBeUndefined();
      expect(environment.resolveAutoApprove('pi')).toBeUndefined();
    });
  });

  describe('resolveModel()', () => {
    it('prefers the requested model over the configured one', () => {
      const { environment } = makeEnvironment({
        config: { codexModel: 'gpt-configured' },
      });
      expect(environment.resolveModel('codex', 'gpt-requested')).toBe(
        'gpt-requested',
      );
    });

    it('reads the per-CLI model key when no model is requested', () => {
      const { environment } = makeEnvironment({
        config: { opencodeModel: 'gpt-5-codex' },
      });
      expect(environment.resolveModel('opencode', undefined)).toBe(
        'gpt-5-codex',
      );
    });

    it('is undefined for a CLI without a model key', () => {
      const { environment } = makeEnvironment({
        config: { codexModel: 'unused' },
      });
      expect(environment.resolveModel('ptah-cli', undefined)).toBeUndefined();
    });
  });

  describe('maxConcurrentAgents()', () => {
    it('clamps a configured value above the maximum down to 20', () => {
      const { environment } = makeEnvironment({
        config: { maxConcurrentAgents: 200 },
      });

      expect(environment.maxConcurrentAgents()).toBe(20);
    });

    it.each([0, -5])(
      'clamps a configured %i up to the minimum of 1',
      (configured) => {
        const { environment } = makeEnvironment({
          config: { maxConcurrentAgents: configured },
        });

        expect(environment.maxConcurrentAgents()).toBe(1);
      },
    );

    it('preserves a configured value inside the supported range', () => {
      const { environment } = makeEnvironment({
        config: { maxConcurrentAgents: 12 },
      });

      expect(environment.maxConcurrentAgents()).toBe(12);
    });

    it('falls back to 5 for a non-finite configured value', () => {
      const { environment } = makeEnvironment({
        config: { maxConcurrentAgents: Number.NaN },
      });

      expect(environment.maxConcurrentAgents()).toBe(5);
    });

    it('exports the bounds the clamp enforces', () => {
      expect([
        MIN_CONCURRENT_AGENTS,
        DEFAULT_CONCURRENT_AGENTS,
        MAX_CONCURRENT_AGENTS,
      ]).toEqual([1, 5, 20]);
    });
  });

  describe('sdkIdleReleaseMs()', () => {
    it('uses the default when nothing is configured', () => {
      expect(makeEnvironment().environment.sdkIdleReleaseMs()).toBe(
        SDK_IDLE_RELEASE_MS,
      );
    });

    it('raises a configured window below the floor to the floor', () => {
      const { environment } = makeEnvironment({
        config: { sdkIdleReleaseMs: 500 },
      });
      expect(environment.sdkIdleReleaseMs()).toBe(MIN_SDK_IDLE_RELEASE_MS);
    });

    it('keeps a configured window above the floor', () => {
      const { environment } = makeEnvironment({
        config: { sdkIdleReleaseMs: 20_000 },
      });
      expect(environment.sdkIdleReleaseMs()).toBe(20_000);
    });

    it.each([
      ['a non-number', 'soon'],
      ['zero', 0],
      ['a negative number', -1],
      ['NaN', Number.NaN],
    ])('falls back to the default for %s', (_label, value) => {
      const { environment } = makeEnvironment({
        config: { sdkIdleReleaseMs: value },
      });
      expect(environment.sdkIdleReleaseMs()).toBe(SDK_IDLE_RELEASE_MS);
    });
  });

  describe('preferredCli()', () => {
    it('returns the first preferred CLI that is installed', async () => {
      const { environment } = makeEnvironment({
        installed: ['codex', 'pi'],
        config: { preferredAgentOrder: ['copilot', 'pi', 'codex'] },
      });
      await expect(environment.preferredCli()).resolves.toBe('pi');
    });

    it('skips unknown and disabled preferred entries and falls to auto-detect', async () => {
      const { environment } = makeEnvironment({
        installed: ['antigravity', 'codex'],
        config: {
          preferredAgentOrder: ['not-a-cli', 'antigravity'],
          disabledClis: ['antigravity'],
        },
      });
      await expect(environment.preferredCli()).resolves.toBe('codex');
    });

    it('returns null when every installed CLI is disabled', async () => {
      const { environment } = makeEnvironment({
        installed: ['codex'],
        config: { disabledClis: ['codex'] },
      });
      await expect(environment.preferredCli()).resolves.toBeNull();
    });
  });

  describe('workspace scope', () => {
    it('prefers the caller resolver over the provider root', () => {
      const { environment } = makeEnvironment({
        providerRoot: ROOT_B,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      expect(environment.scopedWorkspaceRoot()).toBe(ROOT_A);
    });

    it('falls to the home directory when nothing is open', () => {
      const { environment } = makeEnvironment({ providerRoot: undefined });
      expect(environment.scopedWorkspaceRoot()).toBeUndefined();
      expect(environment.workspaceRoot()).toBe(homedir());
    });

    it('treats an undefined scope and a missing directory as visible', () => {
      const { environment } = makeEnvironment();
      expect(environment.isWithinScope(ROOT_B, undefined)).toBe(true);
      expect(
        environment.isWithinScope(undefined, normalizeWorkspaceRoot(ROOT_A)),
      ).toBe(true);
    });

    it('matches the root and its children but not a prefix sibling', () => {
      const { environment } = makeEnvironment();
      const scopeKey = normalizeWorkspaceRoot(ROOT_A);
      expect(
        environment.isWithinScope('d:/projects/WORKSPACE-A', scopeKey),
      ).toBe(true);
      expect(environment.isWithinScope(`${ROOT_A}\\sub`, scopeKey)).toBe(true);
      expect(environment.isWithinScope(`${ROOT_A}-two\\sub`, scopeKey)).toBe(
        false,
      );
    });
  });

  describe('validateWorkingDirectory() — no resolver registered', () => {
    it('validates the working directory against the platform provider root, as before', async () => {
      const { environment } = makeEnvironment({ providerRoot: ROOT_A });
      await expect(
        environment.validateWorkingDirectory(`${ROOT_A}\\sub`),
      ).resolves.toBeUndefined();
      await expect(
        environment.validateWorkingDirectory(ROOT_B),
      ).rejects.toThrow(/within workspace root/);
    });

    it('rejects a symlink or junction whose physical target escapes the workspace', async () => {
      const { environment } = makeEnvironment({ providerRoot: ROOT_A });
      mockedRealpath.mockImplementation(async (input) => {
        const value = String(input);
        if (value === `${ROOT_A}\\linked-out`) return 'D:\\outside\\payload';
        return value;
      });

      await expect(
        environment.validateWorkingDirectory(`${ROOT_A}\\linked-out`),
      ).rejects.toThrow(/within workspace root/);
    });

    it('fails closed when physical path resolution fails', async () => {
      const { environment } = makeEnvironment({ providerRoot: ROOT_A });
      mockedRealpath.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(
        environment.validateWorkingDirectory(`${ROOT_A}\\missing`),
      ).rejects.toThrow(/Cannot resolve working directory scope: ENOENT/);
    });

    it('rejects a Windows sibling whose path only shares the workspace prefix', async () => {
      const { environment } = makeEnvironment({ providerRoot: ROOT_A });
      await expect(
        environment.validateWorkingDirectory(`${ROOT_A}-evil\\sub`),
      ).rejects.toThrow(/within workspace root/);
    });

    it('rejects an empty working directory', async () => {
      const { environment } = makeEnvironment({ providerRoot: ROOT_A });
      await expect(environment.validateWorkingDirectory('  ')).rejects.toThrow(
        'Working directory is required but was empty.',
      );
    });
  });

  describe('validateWorkingDirectory() — resolver registered', () => {
    it('a spawn into the CALLER workspace passes although the provider points at another (the 2026-08-31 regression)', async () => {
      const { environment } = makeEnvironment({
        providerRoot: ROOT_B,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      await expect(
        environment.validateWorkingDirectory(
          `${ROOT_A}\\.claude-worktrees\\native-loop`,
        ),
      ).resolves.toBeUndefined();
    });

    it('a resolver answering undefined (anonymous caller, UI RPC) falls to the provider root — unchanged', async () => {
      const { environment } = makeEnvironment({
        providerRoot: ROOT_A,
        resolver: { resolveCallerWorkspaceRoot: () => undefined },
      });
      await expect(
        environment.validateWorkingDirectory(`${ROOT_A}\\sub`),
      ).resolves.toBeUndefined();
    });

    it('a resolver refusal (declared workspace not open) propagates — it must not degrade to the provider root', async () => {
      const { environment } = makeEnvironment({
        providerRoot: ROOT_B,
        resolver: {
          resolveCallerWorkspaceRoot: () => {
            throw new Error(
              "The caller declared workspace 'D:\\closed', but that folder is not open in this window",
            );
          },
        },
      });
      await expect(
        environment.validateWorkingDirectory(`${ROOT_B}\\sub`),
      ).rejects.toThrow(/declared workspace/);
    });
  });

  describe('mcpPort()', () => {
    it('is undefined when no MCP server status is registered', () => {
      expect(makeEnvironment().environment.mcpPort()).toBeUndefined();
    });

    it('returns the bound port from the status port', () => {
      const { environment } = makeEnvironment({
        mcpServerStatus: { getPort: () => 51821 } as IMcpServerStatus,
      });
      expect(environment.mcpPort()).toBe(51821);
    });

    it('reports a status failure to Sentry and disables MCP', () => {
      const { environment, sentryService } = makeEnvironment({
        mcpServerStatus: {
          getPort: () => {
            throw new Error('status unavailable');
          },
        } as unknown as IMcpServerStatus,
      });
      expect(environment.mcpPort()).toBeUndefined();
      expect(sentryService.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        { errorSource: 'AgentProcessManager.resolveMcpPort' },
      );
    });
  });

  describe('runHarnessPreflight()', () => {
    it('is a no-op without a preflight', async () => {
      await expect(
        makeEnvironment().environment.runHarnessPreflight(ROOT_A),
      ).resolves.toBeUndefined();
    });

    it('runs the preflight for the working directory', async () => {
      const ensure = jest.fn(() => Promise.resolve());
      const { environment } = makeEnvironment({ harnessPreflight: { ensure } });
      await environment.runHarnessPreflight(`${ROOT_A}\\sub`);
      expect(ensure).toHaveBeenCalledWith(`${ROOT_A}\\sub`);
    });

    it('swallows a preflight failure and logs it', async () => {
      const ensure = jest.fn(() => Promise.reject(new Error('disk full')));
      const { environment, logger } = makeEnvironment({
        harnessPreflight: { ensure },
      });
      await expect(
        environment.runHarnessPreflight(ROOT_A),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('disk full'),
      );
    });
  });
});
