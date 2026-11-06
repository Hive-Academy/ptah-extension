import type { WorkerGrant } from '@ptah-extension/worker-protocol';
import { workerError, type WorkerError } from '@ptah-extension/worker-protocol';
import { WorkerSessionIndex } from './worker-session-index';

export type WorkerResource =
  | { readonly kind: 'machine' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'token' };

export class WorkerAuthorizer {
  constructor(
    private readonly machineId: string,
    private readonly sessions: WorkerSessionIndex,
  ) {}

  async check(
    grant: WorkerGrant,
    resources: readonly WorkerResource[],
  ): Promise<WorkerError | undefined> {
    const denied = workerError('NOT_FOUND_OR_FORBIDDEN');
    if (grant.machineId !== this.machineId) return denied;
    for (const resource of resources) {
      if (
        resource.kind === 'workspace' &&
        !grant.workspaceIds.includes(resource.workspaceId)
      )
        return denied;
      if (
        resource.kind === 'session' &&
        !(await this.sessions.workspaceOf(resource.sessionId, grant))
      )
        return denied;
    }
    return undefined;
  }
}
