/**
 * The actor of an MCP message retry or cancel (finding 4, Phase 1 review).
 *
 * Ownership is decided by the actor's sender key, so the actor must come from
 * the credential binding the HTTP gate accepted, never from URL fields: a
 * caller can choose any `/agent/{id}` or `/session/{id}` path. A token minted
 * for a lane acts as that verified lane; a token minted for a chat session
 * acts as that parent session. No binding kind marks the user, so there is no
 * user path here; the renderer RPC is the user's control surface.
 */
import { AgentId, type AgentMessageSender } from '@ptah-extension/shared';
import { getCallerBinding } from '../mcp-core/mcp-request-context';

export type AgentMessageControlIdentityCode = 'identity-missing' | 'identity-unverified';

/** The caller has no verified identity that could own a message. */
export class AgentMessageControlIdentityError extends Error {
  constructor(readonly code: AgentMessageControlIdentityCode) {
    super(
      code === 'identity-missing'
        ? 'Message retry and cancel need a caller bound to a lane or a session.'
        : 'Message retry and cancel need a verified caller credential.',
    );
    this.name = 'AgentMessageControlIdentityError';
  }
}

/**
 * The lane an ack comes from (Component 13): only a credential bound to an
 * agent, and never the untokened read-only caller whose binding is its URL.
 */
export function mcpAckCallerAgentId(): AgentId | undefined {
  const binding = getCallerBinding();
  if (!binding || binding.capability === 'read-only' || binding.kind !== 'agent') return undefined;
  return binding.agentId !== undefined && AgentId.validate(binding.agentId)
    ? AgentId.from(binding.agentId) : undefined;
}

/** Derive the control actor from the verified binding, or throw. */
export function mcpControlActor(): AgentMessageSender {
  const binding = getCallerBinding();
  if (!binding) throw new AgentMessageControlIdentityError('identity-missing');
  // Read-only covers the untokened legacy caller, whose binding is built from its URL.
  if (binding.capability === 'read-only') throw new AgentMessageControlIdentityError('identity-unverified');
  if (binding.kind === 'agent' && binding.agentId !== undefined && AgentId.validate(binding.agentId))
    return { kind: 'lane', agentId: AgentId.from(binding.agentId), verified: true };
  const sessionId = binding.kind === 'session' ? binding.sessionId : undefined;
  if (sessionId?.trim()) return { kind: 'parent', sessionId };
  throw new AgentMessageControlIdentityError('identity-missing');
}
