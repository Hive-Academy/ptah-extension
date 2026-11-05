import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import {
  HandoffChainClient,
  linkedSessionEntries,
  parseHandoffChainResult,
} from './handoff-chain.client';

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const C = 'cccccccc-3333-4333-8333-333333333333';

describe('parseHandoffChainResult', () => {
  it('accepts sessions with a string or null label', () => {
    expect(
      parseHandoffChainResult({
        sessions: [
          { sessionId: A, label: 'One' },
          { sessionId: B, label: null },
        ],
      }),
    ).toEqual({
      sessions: [
        { sessionId: A, label: 'One' },
        { sessionId: B, label: null },
      ],
    });
  });

  it.each([
    ['undefined', undefined],
    ['an array', []],
    ['no sessions', {}],
    ['non-array sessions', { sessions: 'x' }],
    ['an empty session id', { sessions: [{ sessionId: '', label: null }] }],
    ['a numeric label', { sessions: [{ sessionId: A, label: 3 }] }],
    ['a missing label', { sessions: [{ sessionId: A }] }],
    [
      'one bad entry among good ones',
      { sessions: [{ sessionId: A, label: 'ok' }, null] },
    ],
  ])('refuses %s', (_label, value) => {
    expect(parseHandoffChainResult(value)).toBeNull();
  });
});

describe('linkedSessionEntries', () => {
  const chain = [
    { sessionId: A, label: 'A' },
    { sessionId: B, label: 'B' },
    { sessionId: C, label: null },
  ];

  it.each([
    [A, ['current', 'in', 'in']],
    [B, ['from', 'current', 'in']],
    [C, ['from', 'from', 'current']],
  ])('derives relations root first on %s', (open, relations) => {
    expect(linkedSessionEntries(chain, open).map((e) => e.relation)).toEqual(
      relations,
    );
  });

  it('marks no row current when the open id is absent, and invents none', () => {
    const entries = linkedSessionEntries(chain, 'not-in-chain');
    expect(entries).toHaveLength(3);
    expect(entries.some((e) => e.relation === 'current')).toBe(false);
  });
});

describe('HandoffChainClient', () => {
  // Loosely typed on purpose: the malformed-result cases return payloads the
  // typed RPC registry would not allow.
  let rpc: { call: jest.Mock<Promise<unknown>, [string, unknown]> };
  let client: HandoffChainClient;

  beforeEach(() => {
    rpc = { call: jest.fn<Promise<unknown>, [string, unknown]>() };
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpc }],
    });
    client = TestBed.inject(HandoffChainClient);
  });
  afterEach(() => TestBed.resetTestingModule());

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('loads the chain once per retained session through ClaudeRpcService', async () => {
    rpc.call.mockResolvedValue(
      rpcSuccess({
        sessions: [
          { sessionId: A, label: 'A' },
          { sessionId: B, label: 'B' },
        ],
      }),
    );
    client.retain(B);
    client.retain(B);
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(rpc.call).toHaveBeenCalledWith('session:handoffChain', {
      sessionId: B,
    });
    expect(client.entriesFor(B)()).toEqual([
      { sessionId: A, label: 'A', relation: 'from' },
      { sessionId: B, label: 'B', relation: 'current' },
    ]);
  });

  it('clears to [] on a malformed result, without Zod', async () => {
    rpc.call.mockResolvedValue(
      rpcSuccess({ sessions: [{ sessionId: 7, label: null }] }),
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    client.retain(B);
    await flush();
    expect(client.entriesFor(B)()).toEqual([]);
    warn.mockRestore();
  });

  it('clears to [] on an RPC failure or a thrown call', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    rpc.call.mockResolvedValueOnce(rpcError('boom'));
    client.retain(A);
    rpc.call.mockRejectedValueOnce(new Error('transport'));
    client.retain(B);
    await flush();
    expect(client.entriesFor(A)()).toEqual([]);
    expect(client.entriesFor(B)()).toEqual([]);
    warn.mockRestore();
  });

  it('reloads once on sessionHandoff:linked for a shown session in the chain', async () => {
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        sessions: [
          { sessionId: A, label: 'A' },
          { sessionId: B, label: 'B' },
        ],
      }),
    );
    client.retain(A);
    await flush();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        sessions: [
          { sessionId: A, label: 'A' },
          { sessionId: B, label: 'B' },
          { sessionId: C, label: 'C' },
        ],
      }),
    );
    // B -> C names neither end as A, but A's chain already holds B.
    client.onLinked({ fromSessionId: B, toSessionId: C });
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(client.entriesFor(A)().map((e) => e.relation)).toEqual([
      'current',
      'in',
      'in',
    ]);
  });

  it('ignores a link that touches no shown session', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ sessions: [] }));
    client.retain(A);
    await flush();
    client.onLinked({ fromSessionId: B, toSessionId: C });
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });

  it('drops a stale response when a newer load answered first', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        sessions: [
          { sessionId: A, label: 'A' },
          { sessionId: B, label: 'new' },
        ],
      }),
    );
    client.retain(B);
    client.onLinked({ fromSessionId: A, toSessionId: B });
    await flush();
    resolveFirst(rpcSuccess({ sessions: [{ sessionId: B, label: 'old' }] }));
    await flush();
    expect(client.entriesFor(B)().map((e) => e.label)).toEqual(['A', 'new']);
  });

  it('drops the chain on the last release and ignores a late answer', async () => {
    let resolveLoad: (value: unknown) => void = () => undefined;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    client.retain(B);
    client.release(B);
    resolveLoad(rpcSuccess({ sessions: [{ sessionId: B, label: 'B' }] }));
    await flush();
    expect(client.entriesFor(B)()).toEqual([]);
  });
});
