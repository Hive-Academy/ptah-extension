/**
 * AgentProcessManager — workspace scoping through the optional
 * ICallerWorkspaceResolver port (TASK_2026_364 Batch C).
 *
 * Pins the failure behaviour of plan section 4 on the agent surface:
 * - no port registered (the CLI host, unit tests) → the platform provider
 *   answers, exactly as before the port existed;
 * - the port's answer outranks the provider for spawn validation and status;
 * - `getStatus()` lists only the caller's workspace;
 * - `getStatus(agentId)` for a live agent in ANOTHER workspace says so — it
 *   must never be mistakable for `Agent not found`. Two sessions read that
 *   ambiguity as "the agent died" on 2026-08-31 and both began overwriting
 *   files a live agent was still writing.
 */
import 'reflect-metadata';
import type {
  ICallerWorkspaceResolver,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { AgentId, AgentProcessInfo } from '@ptah-extension/shared';
import { AgentProcessManager } from './agent-process-manager.service';

// The roots below are synthetic Windows paths that exist on no machine.
// `validateWorkingDirectory` skips `realpath` on win32 but calls it everywhere
// else, so without this mock the whole file passes on a developer's Windows box
// and fails on the ubuntu CI runner with ENOENT. Identity-resolve, so the
// `startsWith` prefix check downstream still measures what it is here to
// measure. Same mock, same reason, as `agent-process-manager.service.spec.ts`.
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

function makeManager(options: {
  providerRoot: string | undefined;
  resolver?: ICallerWorkspaceResolver | null;
}): AgentProcessManager {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue(options.providerRoot),
    getWorkspaceFolders: jest
      .fn()
      .mockReturnValue(options.providerRoot ? [options.providerRoot] : []),
    getConfiguration: jest.fn(
      (_section: string, _key: string, dflt?: unknown) => dflt,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;

  type Args = ConstructorParameters<typeof AgentProcessManager>;
  return new AgentProcessManager(
    logger as unknown as Args[0],
    { getAdapter: jest.fn() } as unknown as Args[1],
    {
      getRunningBySession: jest.fn().mockReturnValue([]),
    } as unknown as Args[2],
    workspaceProvider as unknown as Args[3],
    { captureException: jest.fn() } as unknown as Args[4],
    { effort: { get: jest.fn(() => '') } } as unknown as Args[5],
    null,
    null,
    options.resolver ?? null,
  );
}

function seedAgent(
  manager: AgentProcessManager,
  agentId: string,
  workingDirectory: string,
): void {
  const info: AgentProcessInfo = {
    // Spec-local ids are readable labels, not real UUIDv4 AgentIds.
    agentId: agentId as AgentId,
    cli: 'codex',
    task: 'test task',
    workingDirectory,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  (
    manager as unknown as {
      agents: Map<string, { info: AgentProcessInfo }>;
    }
  ).agents.set(agentId, { info });
}

function validateWorkingDirectory(
  manager: AgentProcessManager,
  dir: string,
): Promise<void> {
  return (
    manager as unknown as {
      validateWorkingDirectory(dir: string): Promise<void>;
    }
  ).validateWorkingDirectory(dir);
}

describe('AgentProcessManager workspace scoping (TASK_2026_364)', () => {
  describe('no resolver registered — the CLI host, and every pre-port caller', () => {
    it('validates the working directory against the platform provider root, as before', async () => {
      const manager = makeManager({ providerRoot: ROOT_A });
      await expect(
        validateWorkingDirectory(manager, `${ROOT_A}\\sub`),
      ).resolves.toBeUndefined();
      await expect(validateWorkingDirectory(manager, ROOT_B)).rejects.toThrow(
        /within workspace root/,
      );
    });

    it('getStatus() scoped by the provider root hides nothing the provider owns', () => {
      const manager = makeManager({ providerRoot: ROOT_A });
      seedAgent(manager, 'agent-1', `${ROOT_A}\\sub`);
      const list = manager.getStatus() as AgentProcessInfo[];
      expect(list.map((a) => String(a.agentId))).toEqual(['agent-1']);
    });

    it('getStatus() with no provider root and no resolver returns everything (pre-scoping behaviour)', () => {
      const manager = makeManager({ providerRoot: undefined });
      seedAgent(manager, 'agent-1', ROOT_A);
      seedAgent(manager, 'agent-2', ROOT_B);
      const list = manager.getStatus() as AgentProcessInfo[];
      expect(list).toHaveLength(2);
    });
  });

  describe('resolver registered — the caller workspace outranks the provider', () => {
    it('a spawn into the CALLER workspace passes although the provider points at another (the 2026-08-31 regression)', async () => {
      const manager = makeManager({
        providerRoot: ROOT_B,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      await expect(
        validateWorkingDirectory(
          manager,
          `${ROOT_A}\\.claude-worktrees\\native-loop`,
        ),
      ).resolves.toBeUndefined();
    });

    it('a resolver answering undefined (anonymous caller, UI RPC) falls to the provider root — unchanged', async () => {
      const manager = makeManager({
        providerRoot: ROOT_A,
        resolver: { resolveCallerWorkspaceRoot: () => undefined },
      });
      await expect(
        validateWorkingDirectory(manager, `${ROOT_A}\\sub`),
      ).resolves.toBeUndefined();
    });

    it('a resolver refusal (declared workspace not open) propagates — it must not degrade to the provider root', async () => {
      const manager = makeManager({
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
        validateWorkingDirectory(manager, `${ROOT_B}\\sub`),
      ).rejects.toThrow(/declared workspace/);
    });

    it('getStatus() lists only the caller workspace, matched case- and separator-insensitively', () => {
      const manager = makeManager({
        providerRoot: ROOT_B,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      seedAgent(manager, 'agent-a', 'd:/projects/WORKSPACE-A/sub');
      seedAgent(manager, 'agent-b', `${ROOT_B}\\sub`);
      const list = manager.getStatus() as AgentProcessInfo[];
      expect(list.map((a) => String(a.agentId))).toEqual(['agent-a']);
    });

    it('does not leak a sibling directory that shares the root as a name prefix', () => {
      const manager = makeManager({
        providerRoot: undefined,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      seedAgent(manager, 'agent-sibling', `${ROOT_A}-two\\sub`);
      expect(manager.getStatus() as AgentProcessInfo[]).toHaveLength(0);
    });

    it('getStatus(agentId) for an agent of ANOTHER workspace names that workspace — never "not found"', () => {
      const manager = makeManager({
        providerRoot: ROOT_B,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      seedAgent(manager, 'agent-b', `${ROOT_B}\\sub`);
      expect(() => manager.getStatus('agent-b')).toThrow(
        /belongs to another workspace/,
      );
      expect(() => manager.getStatus('agent-b')).toThrow(/did not disappear/);
      expect(() => manager.getStatus('agent-b')).not.toThrow(/not found/i);
    });

    it('getStatus(agentId) for a truly unknown id still says "Agent not found"', () => {
      const manager = makeManager({
        providerRoot: ROOT_A,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      expect(() => manager.getStatus('no-such-agent')).toThrow(/not found/i);
    });

    it('getStatus(agentId) inside the caller workspace answers normally', () => {
      const manager = makeManager({
        providerRoot: ROOT_B,
        resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
      });
      seedAgent(manager, 'agent-a', `${ROOT_A}\\sub`);
      const status = manager.getStatus('agent-a') as AgentProcessInfo;
      expect(status.status).toBe('running');
    });
  });
});
