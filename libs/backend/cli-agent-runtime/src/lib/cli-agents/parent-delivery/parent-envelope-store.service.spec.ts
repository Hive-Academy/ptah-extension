import type { Logger } from '@ptah-extension/vscode-core';
import { ParentEnvelopeStoreService } from './parent-envelope-store.service';

describe('ParentEnvelopeStoreService', () => {
  const logger = { warn: jest.fn() } as Partial<Logger> as Logger;
  const envelope = (n: number, kind: 'report' | 'completion' = 'report') => ({
    id: `lane-delivery:${n}` as const,
    dedupeKey: String(n), parentSessionId: 'parent', agentId: 'agent', kind,
    body: `body ${n}`, createdAt: Date.now() + n,
  });

  it('deduplicates pending work and retains it after a failed attempt', () => {
    const store = new ParentEnvelopeStoreService(logger);
    const first = store.enqueue(envelope(1));
    store.markFailed('1', 'send failed');
    expect(store.enqueue(envelope(1))?.id).toBe(first?.id);
    expect(store.pending('parent')).toHaveLength(1);
    store.markDelivered('1');
    expect(store.pending('parent')).toHaveLength(0);
    expect(store.find('1')?.state).toBe('delivered');
  });

  it('evicts the oldest report when a completion arrives at capacity', () => {
    const store = new ParentEnvelopeStoreService(logger);
    for (let n = 0; n < 32; n++) store.enqueue(envelope(n));
    expect(store.enqueue(envelope(32, 'completion'))?.state).toBe('pending');
    expect(store.find('0')?.state).toBe('expired');
    expect(store.pending('parent')).toHaveLength(32);
  });
  it('keeps the resolved parent at 32 pending envelopes after tab re-key', () => {
    const store = new ParentEnvelopeStoreService(logger);
    for (let n = 0; n < 32; n++) store.enqueue(envelope(n));
    store.enqueue({ ...envelope(33), parentSessionId: 'tab-1' });
    store.resolveParentSessionId('tab-1', 'parent');
    expect(store.pending('parent')).toHaveLength(32);
    expect(store.find('0')?.state).toBe('expired');
  });
});
