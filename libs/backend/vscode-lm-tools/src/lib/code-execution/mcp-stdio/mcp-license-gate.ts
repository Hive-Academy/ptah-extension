/**
 * MCP per-tool premium gate — Phase 4 of TASK_2026_128.
 *
 * Mirrors `PRO_ONLY_METHOD_PREFIXES` in
 * `libs/backend/vscode-core/src/messaging/rpc-handler.ts:106-112` but operates
 * on MCP tool-call dispatch, not internal RPC. The gate is side-effect-free —
 * it returns a {@link GateResult} that the dispatcher converts into an MCP
 * `result.isError: true` envelope. It NEVER throws and NEVER uses JSON-RPC
 * custom error codes; tool-level errors must travel inside the MCP `result`
 * per the spec (see `mcp-serve.ts` and the HTTP server for consistency).
 *
 * Premium-gating policy (mirrors the desktop wire policy):
 *
 *   - `session_submit`                                  → Pro (Team Leader)
 *   - `agent_spawn` when args.ptahCliId is set          → Pro (premium provider)
 *   - `agent_spawn` with cli=gemini|codex|copilot|...   → Free (user binaries)
 *   - `agent_status|read|stop|steer` against a Ptah CLI → Pro (no free-bypass)
 *   - `agent_status|read|stop|steer` against a rival    → Free (own binaries)
 *   - `agent_list`                                      → Free (read-only)
 */

import { injectable, inject } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type LicenseService,
  isPremiumTier,
} from '@ptah-extension/vscode-core';
import { AgentProcessManager } from '@ptah-extension/cli-agent-runtime';

/** DI token for the per-tool premium gate (Phase 4). */
export const MCP_LICENSE_GATE_TOKEN = Symbol.for('McpLicenseGate');

/**
 * Predicate consulted at gate evaluation time. Receives the raw `arguments`
 * object from the inbound `tools/call`. Returns `true` when the tool call
 * matches a Pro-gated shape and must be license-checked.
 */
export type ProGatePredicate = (args: Record<string, unknown>) => boolean;

export interface ProGate {
  readonly tool: string;
  readonly when?: ProGatePredicate;
}

/**
 * Side-effect-free result returned by {@link McpLicenseGate.evaluate}. The
 * dispatcher converts a denial into an MCP `result.isError: true` envelope.
 */
export type GateResult =
  | { allowed: true }
  | { allowed: false; reason: 'license_required' | 'pro_tier_required' };

/**
 * Marketing pricing URL surfaced in the structured denial envelope. Kept as
 * a constant so tests can assert it without string drift.
 */
export const PTAH_PRICING_URL = 'https://ptah.live/pricing';

/**
 * Build the wire-name list once and freeze it. Adding a new gated tool here
 * is the single edit needed to extend the Pro surface.
 *
 * Note: predicates that target ptah-cli agents (`agent_status|read|stop|steer`)
 * are constructed at gate-instance time so they can resolve
 * {@link AgentProcessManager} through DI rather than referencing it
 * statically. See {@link McpLicenseGate.buildGates}.
 */
@injectable()
export class McpLicenseGate {
  private readonly gates: ReadonlyArray<ProGate>;

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,
  ) {
    this.gates = this.buildGates();
  }

  /**
   * Evaluate the gate for an inbound `tools/call`. Returns `{ allowed: true }`
   * when the tool is unrestricted OR when the caller carries a valid Pro
   * license. Otherwise returns a denial with the precise reason so the
   * dispatcher can render a helpful upgrade hint.
   *
   * The method is fully synchronous and side-effect-free apart from a single
   * `logger.info` line on denial.
   */
  evaluate(name: string, args: unknown): GateResult {
    const argRecord = isRecord(args) ? args : {};
    const matchingGate = this.gates.find(
      (g) =>
        g.tool === name &&
        (g.when === undefined || this.runPredicate(g, argRecord, name)),
    );
    if (matchingGate === undefined) {
      return { allowed: true };
    }

    let status: ReturnType<LicenseService['getCachedStatus']>;
    try {
      status = this.licenseService.getCachedStatus();
    } catch (err) {
      this.logger.warn(
        '[McpLicenseGate] license lookup failed; failing closed',
        {
          tool: name,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return { allowed: false, reason: 'license_required' };
    }
    if (status === null) {
      this.logger.info('[McpLicenseGate] denied: no cached license', {
        tool: name,
      });
      return { allowed: false, reason: 'license_required' };
    }
    if (!status.valid) {
      this.logger.info('[McpLicenseGate] denied: license invalid', {
        tool: name,
        tier: status.tier,
        reason: status.reason,
      });
      return { allowed: false, reason: 'license_required' };
    }
    if (!isPremiumTier(status)) {
      this.logger.info('[McpLicenseGate] denied: pro tier required', {
        tool: name,
        tier: status.tier,
      });
      return { allowed: false, reason: 'pro_tier_required' };
    }
    return { allowed: true };
  }

  /**
   * Policy predicate consulted by the Pro-gated ptah-cli predicates
   * (`agent_status|read|stop|steer` when targeting a ptah-cli agent).
   *
   * Returns `true` in TWO distinct cases:
   *
   *   1. Confirmed match — the agent exists and its `cli` field is
   *      `'ptah-cli'`. The gate denies the call unless the caller has a
   *      Pro license.
   *   2. Fail-closed unknown — the agent does NOT exist, `getStatus`
   *      throws, or the lookup returns the list shape (which signals the
   *      passed agentId is not a single known agent). The gate denies the
   *      call to prevent a caller from bypassing the premium gate by
   *      referencing an unknown agentId.
   *
   * Returns `false` ONLY for confirmed rival-CLI agents (gemini, codex,
   * copilot, cursor), which are free-tier.
   *
   * The polarity is intentional: the predicate answers
   * "should we gate this as a ptah-cli premium operation?", not
   * "is this strictly a ptah-cli agent?". A maintainer changing this to a
   * stricter "true iff confirmed ptah-cli" semantics would re-open the
   * unknown-agent bypass.
   */
  shouldGateAsPtahCli(agentId: string): boolean {
    try {
      const info = this.agentProcessManager.getStatus(agentId);
      if (Array.isArray(info)) {
        // getStatus(undefined) returns a list; we passed a string so the
        // single-info branch is the expected shape. Treat the list branch
        // as a fail-closed signal.
        return true;
      }
      return info.cli === 'ptah-cli';
    } catch (err) {
      this.logger.debug('[McpLicenseGate] agent lookup failed; fail-closed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }

  /**
   * Snapshot the gate list for tests / diagnostics. Exposes the tool names
   * but not the predicate functions (which close over instance state).
   */
  getGatedToolNames(): readonly string[] {
    return this.gates.map((g) => g.tool);
  }

  private buildGates(): ReadonlyArray<ProGate> {
    const requirePtahCli: ProGatePredicate = (a) =>
      typeof a['agentId'] === 'string' &&
      (a['agentId'] as string).length > 0 &&
      this.shouldGateAsPtahCli(a['agentId'] as string);
    return Object.freeze<ProGate[]>([
      { tool: 'session_submit' },
      {
        tool: 'agent_spawn',
        when: (a) =>
          typeof a['ptahCliId'] === 'string' &&
          (a['ptahCliId'] as string).length > 0,
      },
      { tool: 'agent_status', when: requirePtahCli },
      { tool: 'agent_read', when: requirePtahCli },
      { tool: 'agent_stop', when: requirePtahCli },
      { tool: 'agent_steer', when: requirePtahCli },
    ]);
  }

  private runPredicate(
    gate: ProGate,
    args: Record<string, unknown>,
    name: string,
  ): boolean {
    try {
      return gate.when !== undefined ? gate.when(args) : true;
    } catch (err) {
      this.logger.warn('[McpLicenseGate] predicate threw; failing closed', {
        tool: name,
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }
}

/**
 * Pure list of tools that are *candidates* for premium gating. The actual
 * decision happens per-call inside {@link McpLicenseGate.evaluate} because
 * some entries (e.g. `agent_spawn`) are conditional on the arguments. This
 * constant exists so adjacent docs/tooling can enumerate the surface
 * without instantiating the gate.
 */
export const PRO_ONLY_MCP_TOOLS: readonly string[] = Object.freeze([
  'session_submit',
  'agent_spawn',
  'agent_status',
  'agent_read',
  'agent_stop',
  'agent_steer',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
