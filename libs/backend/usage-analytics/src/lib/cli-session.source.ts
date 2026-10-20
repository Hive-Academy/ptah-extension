import type { UsageSource, UsageSourceResult } from './usage-source.types';

/** Existing public CLI readers expose totals, not dated model/token records. */
export class CliSessionSource implements UsageSource {
  constructor(private readonly providerId: 'antigravity' | 'ollama-cloud') {}

  async read(_workspacePath: string, _since: number, _until: number): Promise<UsageSourceResult> {
    return {
      contributions: [],
      status: {
        sourceId: this.providerId, status: 'unavailable',
        reason: 'No dated local model usage history is available',
      },
    };
  }
}
