import type { WorkerGrant } from '@ptah-extension/worker-protocol';

/** A session lookup only ever queries workspaces included in this token's grant. */
export class WorkerSessionIndex {
  private readonly sessions = new Map<string, string>();
  private refreshed = false;

  constructor(
    private readonly list: (workspaceId: string) => Promise<readonly string[]>,
  ) {}

  async workspaceOf(
    sessionId: string,
    grant: WorkerGrant,
  ): Promise<string | undefined> {
    const cached = this.sessions.get(sessionId);
    if (cached && grant.workspaceIds.includes(cached)) return cached;
    if (!this.refreshed || !cached) await this.refresh(grant);
    const found = this.sessions.get(sessionId);
    return found && grant.workspaceIds.includes(found) ? found : undefined;
  }

  async refresh(grant: WorkerGrant): Promise<void> {
    for (const workspaceId of grant.workspaceIds) {
      for (const sessionId of await this.list(workspaceId)) {
        this.sessions.set(sessionId, workspaceId);
      }
    }
    this.refreshed = true;
  }

  remember(sessionId: string, workspaceId: string): void {
    this.sessions.set(sessionId, workspaceId);
  }
}
