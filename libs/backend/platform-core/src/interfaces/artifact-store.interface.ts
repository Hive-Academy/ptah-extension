import type {
  ArtifactListResponse,
  ArtifactPublishInput,
  ArtifactPublishResult,
} from '@ptah-extension/shared';

/** Trusted host identity, resolved before calling the store. Never use agent input. */
export interface ArtifactScope {
  workspaceRoot: string;
  sessionId: string;
}

export type ArtifactStoreErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PATH'
  | 'TOO_LARGE'
  | 'NOT_FOUND'
  | 'UNSUPPORTED';

/** Safe error code; callers must not put source HTML or paths in messages. */
export class ArtifactStoreError extends Error {
  constructor(public readonly code: ArtifactStoreErrorCode) {
    super(`Artifact store: ${code}`);
    this.name = 'ArtifactStoreError';
  }
}

/**
 * Publish commits bytes and metadata atomically, or rejects with a typed error
 * and leaves no partial record. INVALID_PATH includes escapes, symlinks and
 * missing files; TOO_LARGE applies to UTF-8 bytes from either source.
 * Read by id returns null for an unknown id. The protocol adapter must enforce
 * authorization before exposing bytes to a renderer.
 */
export interface IArtifactStore {
  publish(scope: ArtifactScope, input: ArtifactPublishInput): Promise<ArtifactPublishResult>;
  list(scope: ArtifactScope): Promise<ArtifactListResponse>;
  readBytes(id: string): Promise<Uint8Array | null>;
}
