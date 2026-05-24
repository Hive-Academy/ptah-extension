/**
 * Unit tests for `McpLicenseGate` — Phase 4 of TASK_2026_128.
 *
 * Coverage matrix (6 tools × {community/pro/expired/null} status):
 *
 *   1. `session_submit` — denied unless Pro.
 *   2. `agent_spawn cli=gemini` — always allowed.
 *   3. `agent_spawn cli=codex|copilot|cursor` — always allowed.
 *   4. `agent_spawn ptahCliId=openrouter` — denied unless Pro.
 *   5. `agent_status/read/stop/steer` targeting a Ptah CLI agent — denied unless Pro.
 *   6. `agent_status/read/stop/steer` targeting a rival CLI agent — always allowed.
 *   7. `agent_list` — always allowed.
 *
 * Predicate edge-cases:
 *   - `shouldGateAsPtahCli` returns true for an unknown agent (fail-closed).
 *   - `shouldGateAsPtahCli` returns true when AgentProcessManager throws.
 *   - `shouldGateAsPtahCli` returns false for a confirmed rival-CLI agent.
 *
 * License lookup edge-cases:
 *   - `getCachedStatus() === null` → `license_required`.
 *   - `status.valid === false` → `license_required`.
 *   - `isPremiumTier(status) === false` → `pro_tier_required`.
 *   - `getCachedStatus()` throws → fail-closed `license_required`.
 *
 * The gate is verified to be SIDE-EFFECT-FREE: it returns a value, never throws.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => {
  const isPremiumTier = jest.fn(
    (status: { tier?: string; valid?: boolean }) =>
      status.valid === true &&
      (status.tier === 'pro' || status.tier === 'trial_pro'),
  );
  return {
    TOKENS: {
      LOGGER: Symbol.for('Logger'),
      LICENSE_SERVICE: Symbol.for('LicenseService'),
      AGENT_PROCESS_MANAGER: Symbol.for('AgentProcessManager'),
    },
    isPremiumTier,
  };
});

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  AgentProcessManager: class {},
}));

import type { Logger, LicenseService } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from '@ptah-extension/cli-agent-runtime';
import {
  McpLicenseGate,
  PRO_ONLY_MCP_TOOLS,
  PTAH_PRICING_URL,
  type GateResult,
} from './mcp-license-gate';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeLicense(
  status:
    | { tier: 'community'; valid: true }
    | { tier: 'pro'; valid: true; plan: { isPremium: true } }
    | { tier: 'trial_pro'; valid: true }
    | { tier: 'expired'; valid: false; reason: 'expired' }
    | null
    | { throws: true },
): LicenseService {
  const getCachedStatus = jest.fn(() => {
    if (status !== null && 'throws' in status) {
      throw new Error('license lookup boom');
    }
    return status;
  });
  return { getCachedStatus } as unknown as LicenseService;
}

function makeAgentMgr(
  table: Record<string, 'ptah-cli' | 'gemini' | 'codex' | 'copilot' | 'cursor'>,
  options: { throwOn?: string } = {},
): AgentProcessManager {
  const getStatus = jest.fn((agentId?: string) => {
    if (agentId === undefined) return [];
    if (options.throwOn === agentId) {
      throw new Error('agent lookup boom');
    }
    const cli = table[agentId];
    if (cli === undefined) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return {
      agentId,
      cli,
      task: 'noop',
      workingDirectory: 'D:/cwd',
      status: 'running',
      startedAt: '2026-05-24T00:00:00Z',
    };
  });
  return { getStatus } as unknown as AgentProcessManager;
}

function makeGate(
  license: LicenseService,
  agents: AgentProcessManager,
): McpLicenseGate {
  return new McpLicenseGate(makeLogger(), license, agents);
}

const PRO_STATUS = {
  tier: 'pro',
  valid: true,
  plan: { isPremium: true },
} as const;
const TRIAL_PRO_STATUS = { tier: 'trial_pro', valid: true } as const;
const COMMUNITY_STATUS = { tier: 'community', valid: true } as const;
const EXPIRED_STATUS = {
  tier: 'expired',
  valid: false,
  reason: 'expired',
} as const;

describe('McpLicenseGate', () => {
  describe('PRO_ONLY_MCP_TOOLS constant', () => {
    it('contains exactly the 6 candidate tools', () => {
      expect(PRO_ONLY_MCP_TOOLS).toEqual([
        'session_submit',
        'agent_spawn',
        'agent_status',
        'agent_read',
        'agent_stop',
        'agent_steer',
      ]);
    });

    it('matches the gated tool names exposed by an instance', () => {
      const gate = makeGate(makeLicense(PRO_STATUS), makeAgentMgr({}));
      expect(gate.getGatedToolNames()).toEqual(Array.from(PRO_ONLY_MCP_TOOLS));
    });

    it('does not include agent_list (free read-only)', () => {
      expect(PRO_ONLY_MCP_TOOLS).not.toContain('agent_list');
    });
  });

  describe('session_submit', () => {
    it.each([
      ['community', COMMUNITY_STATUS, 'pro_tier_required'],
      ['expired', EXPIRED_STATUS, 'license_required'],
      ['null', null, 'license_required'],
    ] as Array<
      [string, typeof COMMUNITY_STATUS | typeof EXPIRED_STATUS | null, string]
    >)('denies for %s license', (_label, status, reason) => {
      const gate = makeGate(makeLicense(status), makeAgentMgr({}));
      const res = gate.evaluate('session_submit', { task: 'go' });
      expect(res.allowed).toBe(false);
      expect((res as Exclude<GateResult, { allowed: true }>).reason).toBe(
        reason,
      );
    });

    it('allows for Pro license', () => {
      const gate = makeGate(makeLicense(PRO_STATUS), makeAgentMgr({}));
      expect(gate.evaluate('session_submit', { task: 'go' })).toEqual({
        allowed: true,
      });
    });

    it('allows for Trial Pro license', () => {
      const gate = makeGate(makeLicense(TRIAL_PRO_STATUS), makeAgentMgr({}));
      expect(gate.evaluate('session_submit', { task: 'go' })).toEqual({
        allowed: true,
      });
    });
  });

  describe('agent_spawn', () => {
    it.each(['gemini', 'codex', 'copilot', 'cursor'] as const)(
      'allows free-tier agent_spawn cli=%s',
      (cli) => {
        const gate = makeGate(makeLicense(COMMUNITY_STATUS), makeAgentMgr({}));
        expect(gate.evaluate('agent_spawn', { task: 't', cli })).toEqual({
          allowed: true,
        });
      },
    );

    it('denies agent_spawn ptahCliId=* on community', () => {
      const gate = makeGate(makeLicense(COMMUNITY_STATUS), makeAgentMgr({}));
      const res = gate.evaluate('agent_spawn', {
        task: 't',
        ptahCliId: 'openrouter',
      });
      expect(res.allowed).toBe(false);
      expect((res as Exclude<GateResult, { allowed: true }>).reason).toBe(
        'pro_tier_required',
      );
    });

    it('allows agent_spawn ptahCliId=* on Pro', () => {
      const gate = makeGate(makeLicense(PRO_STATUS), makeAgentMgr({}));
      expect(
        gate.evaluate('agent_spawn', {
          task: 't',
          ptahCliId: 'openrouter',
        }),
      ).toEqual({ allowed: true });
    });

    it('treats empty ptahCliId string as free-tier (no gate)', () => {
      const gate = makeGate(makeLicense(COMMUNITY_STATUS), makeAgentMgr({}));
      expect(
        gate.evaluate('agent_spawn', {
          task: 't',
          cli: 'gemini',
          ptahCliId: '',
        }),
      ).toEqual({ allowed: true });
    });
  });

  describe('agent_status / agent_read / agent_stop / agent_steer', () => {
    const agentTable = {
      'agent-ptah': 'ptah-cli' as const,
      'agent-gemini': 'gemini' as const,
    };

    it.each(['agent_status', 'agent_read', 'agent_stop', 'agent_steer'])(
      '%s targeting a ptah-cli agent → denied on community',
      (tool) => {
        const gate = makeGate(
          makeLicense(COMMUNITY_STATUS),
          makeAgentMgr(agentTable),
        );
        const res = gate.evaluate(tool, { agentId: 'agent-ptah' });
        expect(res.allowed).toBe(false);
        expect((res as Exclude<GateResult, { allowed: true }>).reason).toBe(
          'pro_tier_required',
        );
      },
    );

    it.each(['agent_status', 'agent_read', 'agent_stop', 'agent_steer'])(
      '%s targeting a gemini agent → allowed on community',
      (tool) => {
        const gate = makeGate(
          makeLicense(COMMUNITY_STATUS),
          makeAgentMgr(agentTable),
        );
        expect(gate.evaluate(tool, { agentId: 'agent-gemini' })).toEqual({
          allowed: true,
        });
      },
    );

    it.each(['agent_status', 'agent_read', 'agent_stop', 'agent_steer'])(
      '%s targeting a ptah-cli agent → allowed on Pro',
      (tool) => {
        const gate = makeGate(
          makeLicense(PRO_STATUS),
          makeAgentMgr(agentTable),
        );
        expect(gate.evaluate(tool, { agentId: 'agent-ptah' })).toEqual({
          allowed: true,
        });
      },
    );

    it('agent_status with no agentId is allowed (list-all variant)', () => {
      const gate = makeGate(
        makeLicense(COMMUNITY_STATUS),
        makeAgentMgr(agentTable),
      );
      expect(gate.evaluate('agent_status', {})).toEqual({ allowed: true });
    });
  });

  describe('agent_list', () => {
    it('is never gated', () => {
      const gate = makeGate(makeLicense(COMMUNITY_STATUS), makeAgentMgr({}));
      expect(gate.evaluate('agent_list', {})).toEqual({ allowed: true });
    });
  });

  describe('shouldGateAsPtahCli predicate', () => {
    it('returns true for a ptah-cli agent', () => {
      const gate = makeGate(
        makeLicense(PRO_STATUS),
        makeAgentMgr({ 'a-1': 'ptah-cli' }),
      );
      expect(gate.shouldGateAsPtahCli('a-1')).toBe(true);
    });

    it('returns false for a gemini agent', () => {
      const gate = makeGate(
        makeLicense(PRO_STATUS),
        makeAgentMgr({ 'a-1': 'gemini' }),
      );
      expect(gate.shouldGateAsPtahCli('a-1')).toBe(false);
    });

    it('fails closed (returns true) for an unknown agent id', () => {
      const gate = makeGate(makeLicense(PRO_STATUS), makeAgentMgr({}));
      expect(gate.shouldGateAsPtahCli('does-not-exist')).toBe(true);
    });

    it('fails closed when AgentProcessManager throws unexpectedly', () => {
      const gate = makeGate(
        makeLicense(PRO_STATUS),
        makeAgentMgr({ 'a-1': 'gemini' }, { throwOn: 'a-1' }),
      );
      expect(gate.shouldGateAsPtahCli('a-1')).toBe(true);
    });
  });

  describe('license edge-cases', () => {
    it('fails closed when getCachedStatus throws', () => {
      const gate = makeGate(makeLicense({ throws: true }), makeAgentMgr({}));
      const res = gate.evaluate('session_submit', { task: 'go' });
      expect(res.allowed).toBe(false);
      expect((res as Exclude<GateResult, { allowed: true }>).reason).toBe(
        'license_required',
      );
    });

    it('never throws (side-effect-free contract)', () => {
      const gate = makeGate(makeLicense({ throws: true }), makeAgentMgr({}));
      expect(() =>
        gate.evaluate('session_submit', { task: 'go' }),
      ).not.toThrow();
      expect(() =>
        gate.evaluate('agent_status', { agentId: 'a-1' }),
      ).not.toThrow();
    });

    it('allows expired license to use ungated tools (agent_list)', () => {
      const gate = makeGate(makeLicense(EXPIRED_STATUS), makeAgentMgr({}));
      expect(gate.evaluate('agent_list', {})).toEqual({ allowed: true });
    });
  });

  describe('PTAH_PRICING_URL', () => {
    it('is the canonical marketing URL', () => {
      expect(PTAH_PRICING_URL).toBe('https://ptah.live/pricing');
    });
  });
});
