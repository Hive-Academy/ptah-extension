import 'reflect-metadata';
import type { DatedUsageScanEntry, SessionStatsReaderService } from '@ptah-extension/agent-sdk';
import type {
  ClaudeAccountNamedRoute,
  ClaudeAccountResolvedResourceContext,
} from '@ptah-extension/auth-providers-tokens';
import { ClaudeLedgerSource, MAX_OBSERVED_CLAUDE_ROUTES } from './claude-ledger.source';

const SESSION = '11111111-2222-4333-8444-555555555555';
const T = Date.UTC(2026, 9, 1);

// Already-admitted test fixture, matching the agent-sdk account-context specs.
function named(
  config: string,
  options: { fileId?: string; fingerprint?: string; epoch?: number } = {},
): ClaudeAccountResolvedResourceContext {
  return {
    kind: 'named',
    route: {
      kind: 'named',
      provider: 'claude',
      profileId: 'fixture',
      canonicalConfigDir: config,
      routeFingerprint: options.fingerprint ?? config,
      routeRevision: 1,
      authEpoch: options.epoch ?? 1,
      runId: 'run',
    } as ClaudeAccountNamedRoute,
    accountDataDir: `${config}/ptah`,
    filesystemIdentity: { volumeId: 'volume', fileId: options.fileId ?? config },
  };
}

interface FakeRoot {
  readonly input: number;
  readonly messageId?: string;
  readonly fail?: boolean;
}

/** Mirrors SessionStatsReaderService key shape: named keys carry the route-revision-epoch prefix. */
function fakeReader(roots: Record<string, FakeRoot>) {
  const calls: string[] = [];
  const reader = {
    async *scanDatedUsage(
      _request: unknown,
      context?: ClaudeAccountResolvedResourceContext,
    ): AsyncGenerator<DatedUsageScanEntry> {
      const name = context?.kind === 'named' ? context.route.canonicalConfigDir : 'ambient';
      calls.push(name);
      const root = roots[name];
      if (!root || root.fail) throw new Error('unavailable');
      const prefix =
        context?.kind === 'named'
          ? `${JSON.stringify([context.route.routeFingerprint, context.route.routeRevision, context.route.authEpoch])}:`
          : '';
      yield {
        kind: 'usage',
        record: {
          key: `${prefix}${SESSION}:${root.messageId ?? 'msg-1'}`,
          timestampMs: T,
          model: 'claude-sonnet-4-6',
          input: root.input,
          output: 1,
          cacheRead: 0,
          cacheCreation: 0,
        },
      };
    },
  };
  return { reader: reader as unknown as SessionStatsReaderService, calls };
}

const read = (source: ClaudeLedgerSource, roots: readonly ClaudeAccountResolvedResourceContext[]) =>
  source.readRoots('/workspace', T - 1, T + 1, roots);

describe('ClaudeLedgerSource account routes', () => {
  it('reads ambient alone when no route is observed, keeping the session id', async () => {
    const { reader, calls } = fakeReader({ ambient: { input: 5 } });
    const result = await new ClaudeLedgerSource(reader).read('/workspace', T - 1, T + 1);
    expect(calls).toEqual(['ambient']);
    expect(result.status).toEqual({ sourceId: 'claude-ledger', status: 'complete' });
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ sessionId: SESSION, inputUncachedTokens: 5 });
  });

  it('counts a physical route once when it is discovered twice', async () => {
    const { reader, calls } = fakeReader({ '/a': { input: 7 }, ambient: { input: 1 } });
    const first = named('/a', { fileId: 'dir-a', fingerprint: 'fp-1' });
    const alias = named('/a', { fileId: 'dir-a', fingerprint: 'fp-2', epoch: 2 });
    const result = await read(new ClaudeLedgerSource(reader), [first, alias, first]);
    expect(calls).toEqual(['ambient', '/a']);
    expect(result.contributions.map((c) => c.inputUncachedTokens)).toEqual([1, 7]);
  });

  it('keeps two directories of one owner as separate transcripts with route-scoped keys', async () => {
    const { reader } = fakeReader({ ambient: { input: 0 }, '/a': { input: 3 }, '/b': { input: 4 } });
    const result = await read(new ClaudeLedgerSource(reader), [named('/a'), named('/b')]);
    const routed = result.contributions.filter((c) => c.inputUncachedTokens > 0);
    expect(routed).toHaveLength(2);
    expect(new Set(routed.map((c) => c.key)).size).toBe(2);
    expect(routed.every((c) => c.sessionId === SESSION)).toBe(true);
    expect(routed.reduce((sum, c) => sum + c.inputUncachedTokens, 0)).toBe(7);
  });

  it('keeps event keys stable across a re-login so history is not re-keyed', async () => {
    const { reader } = fakeReader({ ambient: { input: 0 }, '/a': { input: 2 } });
    const source = new ClaudeLedgerSource(reader);
    const before = await read(source, [named('/a', { fileId: 'dir-a', epoch: 1 })]);
    const after = await read(source, [named('/a', { fileId: 'dir-a', epoch: 9, fingerprint: 'fp-new' })]);
    expect(after.contributions.map((c) => c.key)).toEqual(before.contributions.map((c) => c.key));
  });

  it('retains ambient history alongside observed named routes', async () => {
    const { reader, calls } = fakeReader({ ambient: { input: 1 }, '/a': { input: 2 } });
    const source = new ClaudeLedgerSource(reader);
    source.observeRoute(named('/a'));
    source.observeRoute({ kind: 'ambient' } as ClaudeAccountResolvedResourceContext);
    const result = await source.read('/workspace', T - 1, T + 1);
    expect(calls).toEqual(['ambient', '/a']);
    expect(result.contributions.map((c) => c.inputUncachedTokens)).toEqual([1, 2]);
  });

  it('marks an unavailable named root partial without dropping or substituting other roots', async () => {
    const { reader, calls } = fakeReader({ ambient: { input: 1 }, '/a': { input: 2, fail: true }, '/b': { input: 3 } });
    const result = await read(new ClaudeLedgerSource(reader), [named('/a'), named('/b')]);
    expect(calls).toEqual(['ambient', '/a', '/b']);
    expect(result.contributions.map((c) => c.inputUncachedTokens)).toEqual([1, 3]);
    expect(result.status).toMatchObject({ status: 'partial', reason: 'Some account transcripts were unavailable' });
  });

  it('bounds observed routes and forgets a removed route', async () => {
    const { reader, calls } = fakeReader({ ambient: { input: 0 } });
    const source = new ClaudeLedgerSource(reader);
    for (let i = 0; i <= MAX_OBSERVED_CLAUDE_ROUTES; i++) source.observeRoute(named(`/r${i}`));
    source.forgetRoute(named('/r1'));
    await source.read('/workspace', T - 1, T + 1);
    expect(calls).toHaveLength(MAX_OBSERVED_CLAUDE_ROUTES);
    expect(calls).not.toContain('/r0');
    expect(calls).not.toContain('/r1');
    expect(calls).toContain(`/r${MAX_OBSERVED_CLAUDE_ROUTES}`);
  });
});
