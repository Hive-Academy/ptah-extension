import { inject, injectable } from 'tsyringe';
import { SessionStatsReaderService } from '@ptah-extension/agent-sdk';
import type { UsageSource, UsageSourceResult, UsageContribution } from '../usage-source.types';

@injectable()
export class ClaudeLedgerSource implements UsageSource {
  constructor(@inject(SessionStatsReaderService) private readonly reader: SessionStatsReaderService) {}

  async read(workspacePath: string, since: number, until: number, signal?: AbortSignal): Promise<UsageSourceResult> {
    const contributions: UsageContribution[] = [];
    let unreadable = 0;
    let untimestamped = 0;
    let limited = false;
    try {
      for await (const entry of this.reader.scanDatedUsage({ workspacePath, since, until, signal, maxFiles: 10_000, maxRecords: 100_000 })) {
        if (entry.kind === 'limit') { limited = true; break; }
        if (entry.kind === 'unreadable') { unreadable += entry.count; continue; }
        if (entry.kind === 'untimestamped') { untimestamped += entry.count; continue; }
        if (entry.kind !== 'usage') continue;
        const r = entry.record;
        contributions.push({
          key: r.key, timestampMs: r.timestampMs, providerId: 'anthropic',
          modelId: r.model, inputUncachedTokens: r.input, outputTokens: r.output,
          cacheReadTokens: r.cacheRead, cacheWriteTokens: r.cacheCreation,
          sourceId: 'claude-ledger', sessionId: r.key.slice(0, 36),
          sessionTitle: `Session ${r.key.slice(0, 8)}`,
          ...(r.subagentId ? { subagentId: r.subagentId } : {}),
        });
      }
    } catch {
      return { contributions, status: { sourceId: 'claude-ledger', status: 'partial', reason: signal?.aborted ? 'time-budget' : 'Transcript scan interrupted' } };
    }
    return {
      contributions,
      status: {
        sourceId: 'claude-ledger', status: unreadable || untimestamped || limited ? 'partial' : 'complete',
        ...(limited ? { reason: 'scan-limit' } : unreadable || untimestamped ? { reason: 'Some transcripts were unreadable or lacked timestamps' } : {}),
        ...(unreadable ? { malformedRecords: unreadable } : {}),
      },
    };
  }
}
