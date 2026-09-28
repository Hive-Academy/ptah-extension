/**
 * Repeat-status throttle for `ptah_agent_status` / `agent_status`
 * (TASK_2026_559 Batch 13; research/agent-task-harness.md, Wave 1.8).
 *
 * A second status call for the same agent, from the same caller, within 60 s
 * of the last full answer, while nothing it showed changed, is answered with
 * one line instead of the full body. Shared by the HTTP and stdio surfaces;
 * each words the line for what its callers can wait on.
 */

import type { AgentProcessInfo } from '@ptah-extension/shared';

/** How long a repeat call is answered with one line while nothing changed. */
export const AGENT_STATUS_REPEAT_WINDOW_MS = 60_000;

/** Who is asking: the transport-declared identity, never a model argument. */
export interface AgentStatusCaller {
  readonly agentId?: string;
  readonly sessionId?: string;
}

/** A repeat the caller should get the short answer for. */
export interface UnchangedAgentStatus {
  readonly agentId: string;
  readonly status: AgentProcessInfo['status'];
  /** ISO time of the last full answer this caller received. */
  readonly since: string;
}

/** The last full status body one caller received for one agent. */
interface AgentStatusDelivery {
  /** When it was delivered, on the caller-supplied clock (epoch ms). */
  readonly at: number;
  /** What it showed that can change while the agent runs. */
  readonly fingerprint: string;
}

/**
 * Per owner (one MCP server's `PtahAPI`), keyed by caller and agentId. Weak,
 * so a map lives exactly as long as its server; bounded by pruning every
 * entry older than the window on each call.
 */
const deliveriesByOwner = new WeakMap<
  object,
  Map<string, AgentStatusDelivery>
>();

/**
 * The short answer for a repeat status poll, or `null` when the full body
 * must be returned (it is then recorded as delivered).
 *
 * The full body is returned when: no single agentId was asked for; the caller
 * has neither an agent nor a session identity (callers that cannot be told
 * apart must not throttle one another); the agent is not `running` (a
 * terminal status is never hidden, and its entry is dropped); the status or
 * the CLI session id changed; or the last full body is 60 s old. A short
 * answer does not extend the window. A failed status lookup never reaches
 * here, so an error is never hidden either.
 */
export function checkRepeatAgentStatus(
  owner: object,
  caller: AgentStatusCaller,
  agentId: unknown,
  result: AgentProcessInfo | AgentProcessInfo[],
  now: number,
): UnchangedAgentStatus | null {
  let deliveries = deliveriesByOwner.get(owner);
  if (!deliveries) {
    deliveries = new Map();
    deliveriesByOwner.set(owner, deliveries);
  }
  for (const [key, delivery] of deliveries) {
    const age = now - delivery.at;
    if (age >= AGENT_STATUS_REPEAT_WINDOW_MS || age < 0) {
      deliveries.delete(key);
    }
  }

  const callerKey = callerKeyOf(caller);
  if (
    typeof agentId !== 'string' ||
    callerKey === undefined ||
    Array.isArray(result)
  ) {
    return null;
  }

  const key = `${callerKey}\u0000${agentId}`;
  if (result.status !== 'running') {
    deliveries.delete(key);
    return null;
  }
  const fingerprint = `${result.status}\u0000${result.cliSessionId ?? ''}`;
  const last = deliveries.get(key);
  if (last !== undefined && last.fingerprint === fingerprint) {
    return {
      agentId,
      status: result.status,
      since: new Date(last.at).toISOString(),
    };
  }
  deliveries.set(key, { at: now, fingerprint });
  return null;
}

function callerKeyOf(caller: AgentStatusCaller): string | undefined {
  if (caller.agentId !== undefined) return `agent:${caller.agentId}`;
  if (caller.sessionId !== undefined) return `session:${caller.sessionId}`;
  return undefined;
}
