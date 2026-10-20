import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import type { UsageContribution, UsageSource, UsageSourceResult } from '../usage-source.types';
import { FileFactsCache, inRange, workspaceMatches, type ParsedFile } from './file-facts';

// xAI defines one USD as 10^10 ticks: https://docs.x.ai/developers/cost-tracking
const TICKS_PER_USD = 10_000_000_000;
const nonnegative = z.number().int().nonnegative();
const modelUsage = z.object({ inputTokens: nonnegative.default(0), outputTokens: nonnegative.default(0), cachedReadTokens: nonnegative.default(0), cacheCreationTokens: nonnegative.default(0), costUsdTicks: nonnegative.optional() }).passthrough();
const turn = z.object({ timestamp: z.union([z.number(), z.string()]).optional(), params: z.object({ update: z.object({ sessionUpdate: z.string(), prompt_id: z.string().optional(), usage: z.object({ modelUsage: z.record(z.string(), modelUsage).optional(), inputTokens: nonnegative.optional(), outputTokens: nonnegative.optional(), cachedReadTokens: nonnegative.optional(), cacheCreationTokens: nonnegative.optional(), costUsdTicks: nonnegative.optional() }).optional() }) }), _meta: z.object({ agentTimestampMs: nonnegative.optional() }).optional() }).passthrough();

export class GrokSource implements UsageSource {
  private readonly cache = new FileFactsCache();
  constructor(private readonly home = process.env['GROK_HOME'] || path.join(os.homedir(), '.grok')) {}

  async read(workspacePath: string, since: number, until: number): Promise<UsageSourceResult> {
    const root = path.join(this.home, 'sessions');
    let workspaces: string[];
    try { workspaces = await fs.readdir(root); } catch { return { contributions: [], status: { sourceId: 'grok', status: 'unavailable', reason: 'Grok session store missing' } }; }
    const facts: UsageContribution[] = []; let malformed = 0; let partial = false; let scannedFiles = 0;
    for (const encoded of workspaces) {
      let cwd: string | undefined;
      try { cwd = decodeURIComponent(encoded); } catch { partial = true; }
      if (!cwd && workspacePath) partial = true;
      if (!workspaceMatches(cwd, workspacePath)) continue;
      let sessions: string[];
      try { sessions = await fs.readdir(path.join(root, encoded)); } catch { partial = true; continue; }
      for (const session of sessions) {
        if (scannedFiles >= 10_000) { partial = true; break; }
        const file = path.join(root, encoded, session, 'updates.jsonl');
        try {
          const parsed = await this.cache.read(file, (lines, mtime) => this.parse(lines, file, mtime));
          scannedFiles++; malformed += parsed.malformed; partial ||= parsed.partial;
          facts.push(...inRange(parsed.facts, since, until));
        } catch { partial = true; malformed++; }
      }
    }
    return { contributions: facts, status: { sourceId: 'grok', status: partial || malformed ? 'partial' : 'complete', scannedFiles, malformedRecords: malformed, ...(partial ? { reason: 'Some session timestamps or files were unavailable' } : {}) } };
  }

  private async parse(lines: AsyncIterable<string>, file: string, mtimeMs: number): Promise<ParsedFile> {
    const facts: UsageContribution[] = []; let malformed = 0; let partial = false; let index = 0;
    for await (const line of lines) {
      index++;
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { malformed++; continue; }
      const result = turn.safeParse(raw);
      if (!result.success) { malformed++; continue; }
      const update = result.data.params.update;
      if (update.sessionUpdate !== 'turn_completed' || !update.usage) continue;
      const rawTime = result.data.timestamp;
      const timestampMs = typeof rawTime === 'number' ? (rawTime < 1e11 ? rawTime * 1000 : rawTime) : typeof rawTime === 'string' ? Date.parse(rawTime) : result.data._meta?.agentTimestampMs ?? mtimeMs;
      if (rawTime === undefined && result.data._meta?.agentTimestampMs === undefined) partial = true;
      if (!Number.isFinite(timestampMs)) { malformed++; continue; }
      const models = update.usage.modelUsage;
      if (!models || Object.keys(models).length === 0) { partial = true; continue; }
      for (const [modelId, usage] of Object.entries(models)) {
        if (usage.cachedReadTokens > usage.inputTokens) { malformed++; continue; }
        facts.push({ key: `${path.basename(path.dirname(file))}:${update.prompt_id ?? `${timestampMs}:${index}`}:${modelId}`, timestampMs, providerId: 'grok', modelId, inputUncachedTokens: usage.inputTokens - usage.cachedReadTokens, cacheReadTokens: usage.cachedReadTokens, cacheWriteTokens: usage.cacheCreationTokens, outputTokens: usage.outputTokens, ...(usage.costUsdTicks !== undefined ? { reportedCostUsd: usage.costUsdTicks / TICKS_PER_USD } : {}), requestCount: 1, sourceId: 'grok' });
      }
    }
    return { facts, malformed, partial };
  }
}
