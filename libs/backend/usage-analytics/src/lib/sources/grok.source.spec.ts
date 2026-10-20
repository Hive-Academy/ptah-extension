import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GrokSource } from './grok.source';

describe('GrokSource', () => {
  let home: string;
  beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-grok-')); });
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

  it('reports missing store', async () => {
    expect((await new GrokSource(home).read('', 0, 100)).status.status).toBe('unavailable');
  });

  it('uses per-model ticks, UTC range, and stable prompt keys', async () => {
    const folder = path.join(home, 'sessions', encodeURIComponent('/work'), 's1');
    await fs.mkdir(folder, { recursive: true });
    const event = (timestamp: number, prompt: string) => ({ timestamp, params: { update: { sessionUpdate: 'turn_completed', prompt_id: prompt, usage: { modelUsage: { 'grok-4': { inputTokens: 100, cachedReadTokens: 40, outputTokens: 5, costUsdTicks: 2_000_000_000 } } } } } });
    await fs.writeFile(path.join(folder, 'updates.jsonl'), [JSON.stringify(event(Date.parse('2026-10-20T23:59:59Z') / 1000, 'p1')), JSON.stringify(event(Date.parse('2026-10-20T23:59:59Z') / 1000, 'p1')), JSON.stringify(event(Date.parse('2026-10-21T00:00:00Z') / 1000, 'p2')), '{bad'].join('\n'));
    const result = await new GrokSource(home).read('/work', Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-21T00:00:00Z'));
    expect(result.contributions).toHaveLength(2); // Summary deduplicates matching prompt keys.
    expect(result.contributions[0]).toMatchObject({ inputUncachedTokens: 60, cacheReadTokens: 40, reportedCostUsd: 0.2 });
    expect(result.contributions[0].key).toBe(result.contributions[1].key);
    expect(result.status.malformedRecords).toBe(1);
  });

  it('uses the session and prompt when copied workspace files have different paths', async () => {
    const event = JSON.stringify({ timestamp: Date.parse('2026-10-20T12:00:00Z'), params: { update: { sessionUpdate: 'turn_completed', prompt_id: 'p1', usage: { modelUsage: { 'grok-4': { inputTokens: 10, outputTokens: 1 } } } } } });
    for (const workspace of ['/one', '/two']) {
      const folder = path.join(home, 'sessions', encodeURIComponent(workspace), 'same-session');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'updates.jsonl'), event);
    }
    const result = await new GrokSource(home).read('', Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-21T00:00:00Z'));
    expect(result.contributions).toHaveLength(2);
    expect(result.contributions[0].key).toBe(result.contributions[1].key);
  });

  it('counts one message for a turn with multiple models', async () => {
    const folder = path.join(home, 'sessions', encodeURIComponent('/work'), 's1');
    await fs.mkdir(folder, { recursive: true });
    const at = Date.parse('2026-10-20T12:00:00Z');
    const event = { timestamp: at, params: { update: { sessionUpdate: 'turn_completed', prompt_id: 'p1', usage: { modelUsage: { 'grok-4': { inputTokens: 10, outputTokens: 1 }, 'grok-3': { inputTokens: 20, outputTokens: 2 } } } } } };
    await fs.writeFile(path.join(folder, 'updates.jsonl'), JSON.stringify(event));
    const result = await new GrokSource(home).read('/work', at, at + 1);
    expect(result.contributions).toHaveLength(2);
    expect(result.contributions.map((row) => row.requestCount)).toEqual([1, 0]);
    expect(result.contributions.map((row) => row.inputUncachedTokens)).toEqual([10, 20]);
  });
});
