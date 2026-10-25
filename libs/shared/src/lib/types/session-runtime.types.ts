import type { EffortLevel } from './ai-provider.types';
import type { SessionId } from './branded.types';
import type { PermissionLevel } from './model-autopilot.types';

export type SessionRuntimeKind = 'claude-sdk' | 'codex-app-server';

interface SessionRuntimeIdentityBase {
  readonly version: 1;
  readonly sessionId: SessionId;
  readonly providerId: string;
  readonly workspaceId: string;
}

/** Persisted runtime binding; Codex homes are already normalized by the host. */
export type SessionRuntimeIdentity = SessionRuntimeIdentityBase &
  (
    | { readonly runtime: 'claude-sdk'; readonly codex?: never }
    | {
        readonly runtime: 'codex-app-server';
        readonly codex: { readonly normalizedHome: string };
      }
  );

/** Compare resume bindings in stable priority order, not their session IDs. */
export function sessionRuntimeIdentityMismatch(
  a: SessionRuntimeIdentity,
  b: SessionRuntimeIdentity,
): 'providerId' | 'workspaceId' | 'runtime' | 'normalizedHome' | null {
  if (a.providerId !== b.providerId) return 'providerId';
  if (a.workspaceId !== b.workspaceId) return 'workspaceId';
  if (a.runtime !== b.runtime) return 'runtime';
  if (a.codex?.normalizedHome !== b.codex?.normalizedHome)
    return 'normalizedHome';
  return null;
}

export interface RuntimeHostCapabilities {
  readonly nativeCodex: boolean;
}

export type RuntimeConsumer = 'chat' | 'gateway' | 'lane';

/** Credential-free seed: never carries tokens, env, proxy URLs or headers. */
export interface CodexProfileSeed {
  readonly providerId: 'openai-codex';
  readonly consumer: RuntimeConsumer;
  readonly workspacePath: string;
  /** Case-preserving resolved path. */
  readonly home: string;
  /** Normalized identity key. */
  readonly normalizedHome: string;
  readonly model: string;
  readonly existingIdentity?: SessionRuntimeIdentity;
}

export interface AppliedSettings {
  readonly timing: 'effectiveNow' | 'nextTurn';
  readonly revision: number;
}

export interface SessionRuntimeControls {
  setPermission(
    sessionId: SessionId,
    level: PermissionLevel,
  ): Promise<AppliedSettings>;
  setModel(sessionId: SessionId, model: string): Promise<AppliedSettings>;
  setEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
  ): Promise<AppliedSettings>;
  interrupt(sessionId: SessionId): Promise<boolean>;
  compact(sessionId: SessionId): Promise<void>;
}

export type SessionApprovalDecision =
  'accept' | 'acceptForSession' | 'decline' | 'cancel';

export interface PermissionPromptCancelledPayload {
  readonly sessionId: string;
  readonly requestId: string;
  readonly reason: 'timeout' | 'disposed' | 'turn-ended' | 'superseded';
}
