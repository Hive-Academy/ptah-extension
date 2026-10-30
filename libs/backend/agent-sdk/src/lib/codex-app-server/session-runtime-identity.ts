import {
  sessionRuntimeIdentityMismatch,
  type SessionId,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';

export interface SessionRuntimeIdentityLookup {
  /** undefined means unknown session; an empty binding means missing identity. */
  lookup(sessionId: SessionId):
    | {
        readonly live?: SessionRuntimeIdentity;
        readonly persisted?: SessionRuntimeIdentity;
        /** Raw caller-spelled workspace path, never the normalized identity key. */
        readonly workspacePath?: string;
      }
    | undefined;
}

export class SessionRuntimeRoutingError extends Error {
  constructor(
    readonly code: 'unknown-session' | 'missing-identity' | 'identity-mismatch',
    readonly sessionId: SessionId,
    readonly field?: string,
  ) {
    super(`Session runtime routing failed: ${code}`);
    this.name = 'SessionRuntimeRoutingError';
  }
}

/** Identity for a stored Claude session that predates native runtime metadata. */
export function legacyClaudeSessionRuntimeIdentity(input: {
  readonly sessionId: SessionId;
  readonly workspaceId: string;
  readonly providerId?: string;
}): SessionRuntimeIdentity {
  return {
    version: 1,
    sessionId: input.sessionId,
    runtime: 'claude-sdk',
    providerId: input.providerId ?? 'claude-cli',
    workspaceId: input.workspaceId,
  };
}

// Missing metadata is normal for tabs and newly created Claude sessions.
export function resolveSessionRuntimeIdentity(
  identities: SessionRuntimeIdentityLookup,
  sessionId: SessionId,
): SessionRuntimeIdentity | undefined {
  const binding = identities.lookup(sessionId);
  if (!binding) return undefined;
  const identity = binding.live ?? binding.persisted;
  if (!identity)
    throw new SessionRuntimeRoutingError('missing-identity', sessionId);
  for (const candidate of [binding.live, binding.persisted]) {
    if (candidate && candidate.sessionId !== sessionId)
      throw new SessionRuntimeRoutingError(
        'identity-mismatch',
        sessionId,
        'sessionId',
      );
  }
  if (binding.live && binding.persisted) {
    const field = sessionRuntimeIdentityMismatch(
      binding.live,
      binding.persisted,
    );
    if (field)
      throw new SessionRuntimeRoutingError(
        'identity-mismatch',
        sessionId,
        field,
      );
  }
  return identity;
}
