/**
 * Plan-limit text on both `ptah_agent_spawn` transports (TASK_2026_596,
 * Batch 14, F52 transport legs; design §5.2).
 *
 * - The limit lookup runs only after `agent.spawn` settled.
 * - Success and the role / command-line-too-long failures carry the limit
 *   block of the lane the request named, with the same `Limit state`.
 * - The protocol transport still re-throws any other error to its generic
 *   handler; the stdio transport still answers `agent_spawn failed`.
 * - A failing lookup never changes the outcome or its text.
 */
// The cli-agent-runtime barrel reaches tsyringe, which needs the polyfill.
import 'reflect-metadata';
import {
  AgentRoleError,
  CliCommandLineTooLongError,
} from '@ptah-extension/cli-agent-runtime';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  applicableLimits,
  classifyLaneState,
  FRESHNESS_MS,
  NEAR_LIMIT_PERCENT,
  type AgentId,
  type CliDetectionResult,
  type PlanLimitWindow,
  type SpawnAgentRequest,
  type SpawnAgentResult,
} from '@ptah-extension/shared';
import type {
  AgentNamespace,
  MCPRequest,
  MCPResponse,
  PtahAPI,
} from '../types';
import { AgentToolDispatcher } from '../mcp-stdio/agent-tool.dispatcher';
import type { AgentLimit } from './agent-limit.formatter';
import { formatAgentSpawn } from './mcp-response-formatter';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';

const NOW = Date.now();
const MIN = 60_000;

const NEAR_WINDOW: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 94 },
  usedSource: 'provider-api',
  resetsAt: NOW + 3 * 60 * MIN,
  resetSource: 'provider-api',
  lastResetAt: NOW - 60 * MIN,
  observedAt: NOW - MIN,
};

const CODEX_ROW: CliDetectionResult = {
  cli: 'codex',
  installed: true,
  messagingMode: 'steer',
};
const GLM_ROW: CliDetectionResult = {
  cli: 'ptah-cli',
  installed: true,
  messagingMode: 'queue',
  ptahCliId: 'glm-1',
  ptahCliName: 'Glm',
  providerId: 'ollama-cloud',
};

const CODEX_NEAR: AgentLimit = {
  row: CODEX_ROW,
  lookup: 'ok',
  state: classifyLaneState(
    applicableLimits(
      {
        owner: {
          key: 'provider#account:c0de',
          providerId: 'provider',
          identityKind: 'account',
          label: 'Account',
        },
        status: 'available',
        windowSetEstablished: true,
        windows: [NEAR_WINDOW],
        ownerEvidence: [],
      },
      null,
    ),
    {
      now: NOW,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
    },
  ),
};
const GLM_TIMED_OUT: AgentLimit = {
  row: GLM_ROW,
  lookup: 'timeout',
  state: classifyLaneState(undefined, {
    now: NOW,
    nearLimitPercent: NEAR_LIMIT_PERCENT,
    freshnessMs: FRESHNESS_MS,
    lookupFailure: 'timed-out',
  }),
};
const LIMITS: readonly AgentLimit[] = [CODEX_NEAR, GLM_TIMED_OUT];

const SPAWNED: SpawnAgentResult = {
  agentId: 'a-1' as AgentId,
  cli: 'codex',
  status: 'running',
  startedAt: '2026-10-03T12:00:00.000Z',
};

const CODEX_STATE = '**Limit state:** near limit (5-hour session 94%)';
const GLM_STATE = '**Limit state:** unknown (limit lookup timed out)';

type AgentStub = Pick<AgentNamespace, 'spawn' | 'list' | 'limits'>;

interface Harness {
  readonly spawn: jest.Mock<Promise<SpawnAgentResult>, [SpawnAgentRequest]>;
  readonly list: jest.Mock<Promise<CliDetectionResult[]>, []>;
  readonly limits: jest.Mock<
    Promise<readonly AgentLimit[] | undefined>,
    [readonly CliDetectionResult[]]
  >;
  readonly ptahAPI: PtahAPI;
}

function harness(outcome: SpawnAgentResult | Error): Harness {
  const spawn = jest.fn<Promise<SpawnAgentResult>, [SpawnAgentRequest]>(
    async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  );
  const list = jest.fn<Promise<CliDetectionResult[]>, []>(async () => [
    CODEX_ROW,
    GLM_ROW,
  ]);
  const limits = jest.fn<
    Promise<readonly AgentLimit[] | undefined>,
    [readonly CliDetectionResult[]]
  >(async () => LIMITS);
  const agent: AgentStub = { spawn, list, limits };
  return {
    spawn,
    list,
    limits,
    ptahAPI: { agent: agent as AgentNamespace } as PtahAPI,
  };
}

function quietLogger(): Logger {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return logger as Pick<Logger, keyof typeof logger> as Logger;
}

function resultText(response: MCPResponse | null): {
  text: string;
  isError: boolean;
} {
  const result = response?.result as
    { content: Array<{ text: string }>; isError?: boolean } | undefined;
  return {
    text: result?.content[0]?.text ?? '',
    isError: result?.isError === true,
  };
}

async function overHttp(
  h: Harness,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const deps: ProtocolHandlerDependencies = {
    ptahAPI: h.ptahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: quietLogger(),
  };
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: 'limits',
    method: 'tools/call',
    params: { name: 'ptah_agent_spawn', arguments: args },
  };
  return resultText(await handleMCPRequest(request, deps));
}

async function overStdio(
  h: Harness,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const dispatcher = new AgentToolDispatcher(h.ptahAPI, quietLogger());
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: 'limits',
    method: 'tools/call',
  };
  return resultText(await dispatcher.dispatch('agent_spawn', request, args));
}

const ROLE_ERROR = new AgentRoleError('unknown_role', 'no role named x');
const TOO_LONG = new CliCommandLineTooLongError(
  9_000,
  8_191,
  2,
  8_500,
  'UTF-16 units',
);

describe.each([
  ['protocol', overHttp],
  ['stdio', overStdio],
] as const)('ptah_agent_spawn limit block over %s', (_name, call) => {
  it('appends the target lane block on success, after the spawn settled', async () => {
    const h = harness(SPAWNED);
    const { text, isError } = await call(h, { task: 'Review', cli: 'codex' });

    expect(isError).toBe(false);
    expect(text).toContain('## Agent Spawned');
    expect(text).toContain(CODEX_STATE);
    expect(text).toContain('The spawn was still started.');
    expect(h.list.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.spawn.mock.invocationCallOrder[0],
    );
    expect(h.limits).toHaveBeenCalledWith([CODEX_ROW, GLM_ROW]);
  });

  it('shows the same Limit state on a role failure as on success', async () => {
    const h = harness(ROLE_ERROR);
    const { text, isError } = await call(h, {
      task: 'Review',
      cli: 'codex',
      role: 'reviewer',
    });

    expect(isError).toBe(true);
    expect(text).toContain('role unknown_role: no role named x');
    expect(text).toContain(CODEX_STATE);
    expect(text).toContain('The spawn was still attempted.');
  });

  it('shows the Limit state on a command-line-too-long failure', async () => {
    const h = harness(TOO_LONG);
    const { text, isError } = await call(h, { task: 'Review', cli: 'codex' });

    expect(isError).toBe(true);
    expect(text).toMatch(
      /command line too long \(9000 against a limit of 8191\)/,
    );
    expect(text).toContain(CODEX_STATE);
  });

  it('resolves a failed Ptah CLI spawn to its own lane by ptahCliId', async () => {
    const h = harness(ROLE_ERROR);
    const { text } = await call(h, {
      task: 'Review',
      ptahCliId: 'glm-1',
      role: 'reviewer',
    });

    expect(text).toContain(GLM_STATE);
    expect(text).not.toContain(CODEX_STATE);
  });

  it('keeps a role failure text unchanged when the lookup throws', async () => {
    const h = harness(ROLE_ERROR);
    h.limits.mockRejectedValue(new Error('lookup down'));
    const { text, isError } = await call(h, {
      task: 'Review',
      cli: 'codex',
      role: 'reviewer',
    });

    expect(isError).toBe(true);
    expect(text).toMatch(/role unknown_role: no role named x$/);
    expect(text).not.toContain('Limit state');
  });

  it('keeps the success text unchanged when the lookup throws', async () => {
    const h = harness(SPAWNED);
    h.list.mockRejectedValue(new Error('detection down'));
    const { text, isError } = await call(h, { task: 'Review', cli: 'codex' });

    expect(isError).toBe(false);
    expect(text).toBe(formatAgentSpawn(SPAWNED));
  });
});

describe('ptah_agent_spawn generic failure', () => {
  it('protocol: still re-throws to the generic handler, with no lookup', async () => {
    const h = harness(new Error('no slot'));
    const { text, isError } = await overHttp(h, {
      task: 'Review',
      cli: 'codex',
    });

    expect(isError).toBe(true);
    expect(text).toBe('Tool ptah_agent_spawn failed: no slot');
    expect(h.list).not.toHaveBeenCalled();
    expect(h.limits).not.toHaveBeenCalled();
  });

  it('stdio: still answers agent_spawn failed, with the target lane block', async () => {
    const h = harness(new Error('no slot'));
    const { text, isError } = await overStdio(h, {
      task: 'Review',
      cli: 'codex',
    });

    expect(isError).toBe(true);
    expect(text.startsWith('agent_spawn failed: no slot\n\n')).toBe(true);
    expect(text).toContain(CODEX_STATE);
  });

  it('stdio: keeps the generic text unchanged when the lookup throws', async () => {
    const h = harness(new Error('no slot'));
    h.limits.mockRejectedValue(new Error('lookup down'));
    const { text } = await overStdio(h, { task: 'Review', cli: 'codex' });

    expect(text).toBe('agent_spawn failed: no slot');
  });
});
