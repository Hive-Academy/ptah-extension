import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexSource } from './codex.source';

describe('CodexSource', () => {
  let home: string;
  beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-codex-')); });
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

  it('reports a missing session store', async () => {
    expect((await new CodexSource(home).read('', 0, 100)).status.status).toBe('unavailable');
  });

  it('reads per-event deltas with UTC range, cache split, and malformed count', async () => {
    const folder = path.join(home, 'sessions', '2026', '10', '20');
    await fs.mkdir(folder, { recursive: true });
    const line = (timestamp: string, payload: object, type = 'event_msg') => JSON.stringify({ timestamp, type, payload });
    const file = path.join(folder, 'rollout-a.jsonl');
    await fs.writeFile(file, [
      line('2026-10-20T00:00:00Z', { cwd: '/work', model: 'gpt-5' }, 'session_meta'),
      line('2026-10-20T00:00:01Z', { type: 'token_count', info: { total_token_usage: { input_tokens: 999 }, last_token_usage: { input_tokens: 20, cached_input_tokens: 8, cache_write_input_tokens: 2, output_tokens: 3 } } }),
      line('2026-10-21T00:00:00Z', { type: 'token_count', info: { last_token_usage: { input_tokens: 4, output_tokens: 1 } } }),
      '{broken',
    ].join('\n'));
    const source = new CodexSource(home);
    const start = Date.parse('2026-10-20T00:00:00Z');
    const end = Date.parse('2026-10-21T00:00:00Z');
    const result = await source.read('/work', start, end);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ inputUncachedTokens: 12, cacheReadTokens: 8, cacheWriteTokens: 2, outputTokens: 3, modelId: 'gpt-5' });
    expect(result.status.malformedRecords).toBe(1);
    expect(result.status.status).toBe('partial');
    expect((await source.read('/work', start, end)).contributions).toHaveLength(1);
    await fs.appendFile(file, '\n' + line('2026-10-20T00:00:02Z', { type: 'token_count', info: { last_token_usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 1 } } }));
    expect((await source.read('/work', start, end)).contributions).toHaveLength(2);
  });

  it('keeps a stable event key when a session is copied to another rollout file', async () => {
    const folder = path.join(home, 'sessions', '2026', '10', '20');
    await fs.mkdir(folder, { recursive: true });
    const lines = [
      JSON.stringify({ timestamp: '2026-10-20T00:00:00Z', type: 'session_meta', payload: { id: 'session-1', cwd: '/work' } }),
      JSON.stringify({ timestamp: '2026-10-20T00:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 4, output_tokens: 1 } } } }),
    ].join('\n');
    await fs.writeFile(path.join(folder, 'rollout-a.jsonl'), lines);
    await fs.writeFile(path.join(folder, 'rollout-b.jsonl'), lines);
    const result = await new CodexSource(home).read('/work', Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-21T00:00:00Z'));
    expect(result.contributions).toHaveLength(2);
    expect(result.contributions[0].key).toBe(result.contributions[1].key);
  });
});
