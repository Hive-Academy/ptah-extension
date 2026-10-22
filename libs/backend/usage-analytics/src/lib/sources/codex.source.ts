import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { UsageSource, UsageSourceResult, UsageContribution } from '../usage-source.types';
import { FileFactsCache, inRange, workspaceMatches, type ParsedFile } from './file-facts';

const usage = z.object({ input_tokens: z.number().int().nonnegative().default(0), cached_input_tokens: z.number().int().nonnegative().default(0), cache_write_input_tokens: z.number().int().nonnegative().default(0), output_tokens: z.number().int().nonnegative().default(0) }).passthrough();
const lineSchema = z.object({ timestamp: z.string().optional(), type: z.string(), payload: z.record(z.string(), z.unknown()).optional() }).passthrough();
const payloadSchema = z.object({ type: z.string().optional(), info: z.object({ last_token_usage: usage.optional() }).optional(), model: z.string().optional(), cwd: z.string().optional() }).passthrough();

export class CodexSource implements UsageSource {
  private readonly cache = new FileFactsCache();
  constructor(private readonly home = process.env['CODEX_HOME'] || path.join(os.homedir(), '.codex')) {}

  async read(workspacePath: string, since: number, until: number): Promise<UsageSourceResult> {
    const root = path.join(this.home, 'sessions');
    try { await fs.access(root); } catch { return { contributions: [], status: { sourceId: 'codex', status: 'unavailable', reason: 'Codex session store missing' } }; }
    const facts: UsageContribution[] = [];
    let malformed = 0; let partial = false; let scannedFiles = 0;
    for (let day = Math.floor(since / 86_400_000) * 86_400_000; day < until; day += 86_400_000) {
      const date = new Date(day);
      const folder = path.join(root, String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0'));
      let names: string[];
      try { names = (await fs.readdir(folder)).filter((n) => /^rollout-.*\.jsonl$/.test(n)); } catch { continue; }
      for (const name of names) {
        if (scannedFiles >= 10_000) { partial = true; break; }
        try {
          const file = path.join(folder, name);
          const parsed = await this.cache.read(file, (lines) => this.parse(lines, file));
          scannedFiles++; malformed += parsed.malformed; partial ||= parsed.partial;
          const dated = inRange(parsed.facts, since, until);
          if (workspacePath && dated.some((f) => !f.workspaceRoot)) partial = true;
          facts.push(...dated.filter((f) => workspaceMatches(f.workspaceRoot, workspacePath)));
        } catch { partial = true; malformed++; }
      }
    }
    return { contributions: facts, status: { sourceId: 'codex', status: partial || malformed ? 'partial' : 'complete', scannedFiles, malformedRecords: malformed, ...(partial ? { reason: 'Some files or workspace metadata were unavailable' } : {}) } };
  }

  private async parse(lines: AsyncIterable<string>, file: string): Promise<ParsedFile> {
    const facts: UsageContribution[] = []; let malformed = 0; let partial = false;
    let model = 'unknown'; let cwd: string | undefined; let sessionId: string | undefined;
    for await (const line of lines) {
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { malformed++; continue; }
      const entry = lineSchema.safeParse(raw);
      if (!entry.success) { malformed++; continue; }
      const payload = payloadSchema.safeParse(entry.data.payload);
      if (!payload.success) { malformed++; continue; }
      if (entry.data.type === 'session_meta') {
        cwd = payload.data.cwd ?? cwd;
        const meta = z.object({ id: z.string().min(1) }).safeParse(entry.data.payload);
        if (meta.success) sessionId = meta.data.id;
      }
      if (entry.data.type === 'turn_context' || entry.data.type === 'session_meta') model = payload.data.model ?? model;
      if (entry.data.type !== 'event_msg' || payload.data.type !== 'token_count') continue;
      const tokens = usage.safeParse(payload.data.info?.last_token_usage);
      if (!tokens.success) { malformed++; continue; }
      const timestampMs = Date.parse(entry.data.timestamp ?? '');
      if (!Number.isFinite(timestampMs) || tokens.data.cached_input_tokens > tokens.data.input_tokens) { malformed++; continue; }
      const eventId = createHash('sha256').update(JSON.stringify([entry.data.timestamp, model, tokens.data])).digest('hex');
      facts.push({ key: `${sessionId ?? path.basename(file)}:${eventId}`, timestampMs, sessionId: sessionId ?? path.basename(file), sessionTitle: "Session " + (sessionId ?? path.basename(file)).slice(0, 8), providerId: 'codex', modelId: model, workspaceRoot: cwd, inputUncachedTokens: tokens.data.input_tokens - tokens.data.cached_input_tokens, cacheReadTokens: tokens.data.cached_input_tokens, cacheWriteTokens: tokens.data.cache_write_input_tokens, outputTokens: tokens.data.output_tokens, sourceId: 'codex', requestCount: 1 });
    }
    return { facts, malformed, partial };
  }
}
