import 'reflect-metadata';
import type { CodexUsageCounters, CodexUsageEvidence } from '@ptah-extension/codex-runtime';
import { calculateExactMessageCost, SessionId } from '@ptah-extension/shared';
import { CodexSessionUsageOwner, MAX_USAGE_THREADS, codexUsageCheckpointSchema } from './codex-session-usage-owner';

const SESSION = SessionId.from('12345678-1234-4234-8234-123456789abc');
const ROOT = 'native-thread-root';

const totals = (input: number, output = 0, read = 0, creation = 0): CodexUsageCounters => ({
  uncachedInputTokens: input, outputTokens: output, cacheReadTokens: read,
  cacheCreationTokens: creation, reasoningOutputTokens: 0,
  totalTokens: input + output + read + creation,
});
function evidence(threadId: string, turnId: string, total: CodexUsageCounters,
  options: Partial<CodexUsageEvidence> = {}): CodexUsageEvidence {
  return {
    threadId, turnId, total, last: total, timestamp: 1,
    terminalState: 'none', resetOrStale: false, accepted: true,
    epoch: 0, cacheSemanticsAmbiguous: false, lastExceedsTotal: false,
    diagnostics: [], ...options,
  };
}

describe('CodexSessionUsageOwner', () => {
  it('restores native model, context and subscription price from the checkpoint', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'turn-1', totals(7_435, 7, 12_672), {
      modelId: 'gpt-6-luna', modelContextWindow: 128_000,
      lastRequestTotalTokens: 10_000, terminalState: 'completed',
    }));
    const price = calculateExactMessageCost('gpt-6-luna', {
      input: 7_435, output: 7, cacheHit: 12_672, cacheCreation: 0,
    }, { billingMode: 'subscription', cacheSemantics: 'disjoint', usageObserved: true });
    if (price.totalCost === null) throw new Error('Expected native model price');
    owner.recordTurnPrice(price);
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, owner.serialize());
    expect(restored.snapshot()).toMatchObject({
      model: 'gpt-6-luna', totalCost: price.totalCost,
      costBasis: 'covered-by-subscription',
      pricingCoverage: 'full',
      contextSnapshot: { model: 'gpt-6-luna', contextTokens: 10_000,
        contextWindow: 128_000 },
    });
  });

  it('restores an API-key price as an estimate', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'turn-1', totals(7_435, 7, 12_672), {
      modelId: 'gpt-6-luna', terminalState: 'completed',
    }));
    const price = calculateExactMessageCost('gpt-6-luna', {
      input: 7_435, output: 7, cacheHit: 12_672, cacheCreation: 0,
    }, { billingMode: 'api-key', cacheSemantics: 'disjoint', usageObserved: true });
    if (price.totalCost === null) throw new Error('Expected native model price');
    owner.recordTurnPrice(price);
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, owner.serialize());
    expect(restored.snapshot()).toMatchObject({
      totalCost: price.totalCost, costBasis: 'estimated', pricingCoverage: 'full',
    });
  });

  it('parses a pre-fix checkpoint without model, context or billing mode', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'old-turn', totals(10)));
    const checkpoint = owner.serialize();
    const legacy = { ...checkpoint, threads: checkpoint.threads.map((thread) => ({
      threadId: thread.threadId, turnId: thread.turnId, epoch: thread.epoch,
      timestamp: thread.timestamp, terminalState: thread.terminalState,
      counters: thread.counters, accrued: thread.accrued,
    })) };
    expect(codexUsageCheckpointSchema.safeParse(legacy).success).toBe(true);
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, legacy);
    expect(restored.isRestoredCheckpoint()).toBe(true);
    expect(restored.snapshot()).toMatchObject({
      model: null, totalCost: null, costBasis: 'unknown', pricingCoverage: 'none',
    });
  });

  it('keeps a new model and window even when usage counters are unchanged', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'turn', totals(10)));
    expect(owner.accept(evidence(ROOT, 'turn', totals(10), {
      modelId: 'gpt-6-luna', modelContextWindow: 128_000,
      lastRequestTotalTokens: 150_000,
    }))).toBe(true);
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, owner.serialize());
    expect(restored.snapshot()).toMatchObject({
      model: 'gpt-6-luna', contextSnapshot: {
        contextTokens: 128_000, contextWindow: 128_000,
      },
    });
  });

  it('drops a stale context window when the model changes', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'one', totals(10), {
      modelId: 'gpt-4o', modelContextWindow: 100_000,
    }));
    owner.accept(evidence(ROOT, 'two', totals(20), {
      modelId: 'gpt-4o-mini', timestamp: 2,
    }));
    expect(owner.serialize().threads[0]?.modelContextWindow).toBeUndefined();
  });

  it('persists child usage observed before its root or parent as partial coverage', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence('child', 'one', totals(7), { parentThreadId: 'parent' }));
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, owner.serialize());
    expect(restored.getDiagnostics()).toEqual([]);
    expect(restored.snapshot().coverage).toBe('partial');
    expect(restored.serialize().childTotal.uncachedInputTokens).toBe(7);
  });

  it('rejects self-parent corruption even in a partial checkpoint', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence('child', 'one', totals(7), { parentThreadId: 'parent' }));
    const checkpoint = owner.serialize();
    const corrupt = { ...checkpoint, threads: checkpoint.threads.map((thread) =>
      ({ ...thread, parentThreadId: thread.threadId })) };
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, corrupt);
    expect(restored.isRestoredCheckpoint()).toBe(false);
    expect(restored.getDiagnostics()).toContain('invalid-checkpoint');
  });

  it('counts child and pre-compaction epochs, including failed and interrupted turns', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT, 'disjoint');
    owner.accept(evidence(ROOT, 'before-compact', totals(10, 2, 3, 4), { terminalState: 'failed' }));
    owner.accept(evidence('child', 'subagent', totals(5, 1), { parentThreadId: ROOT, terminalState: 'interrupted' }));
    owner.accept(evidence(ROOT, 'after-compact', totals(14, 4, 4, 4), { timestamp: 2 }));
    expect(owner.snapshot().tokens).toEqual({ input: 19, output: 5, cacheRead: 4, cacheCreation: 4 });
    expect(owner.snapshot().coverage).toBe('complete');
  });

  it('deduplicates repeated and stale evidence and holds a decrease at the safe total', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    const first = evidence(ROOT, 'one', totals(10));
    expect(owner.accept(first)).toBe(true);
    expect(owner.accept(first)).toBe(false);
    expect(owner.accept(evidence(ROOT, 'one', totals(9), { timestamp: 2 }))).toBe(false);
    expect(owner.snapshot().tokens.input).toBe(10);
    expect(owner.snapshot().coverage).toBe('partial');
    expect(owner.accept(evidence(ROOT, 'one', totals(12), { timestamp: 3 }))).toBe(true);
    expect(owner.snapshot().tokens.input).toBe(12);
  });

  it('adds a proved reset epoch without losing earlier usage', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'one', totals(10)));
    owner.accept(evidence(ROOT, 'two', totals(3), {
      epoch: 1, timestamp: 2, resetOrStale: true, diagnostics: ['counter-reset'],
    }));
    const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, owner.serialize());
    expect(restored.snapshot().tokens.input).toBe(13);
    restored.accept(evidence(ROOT, 'two', totals(5), { epoch: 1, timestamp: 3 }));
    expect(restored.snapshot().tokens.input).toBe(15);
  });

  it('lets late usage supersede terminal usage for the same turn', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'one', totals(8), { terminalState: 'failed' }));
    owner.accept(evidence(ROOT, 'one', totals(11), { timestamp: 2, terminalState: 'none' }));
    expect(owner.snapshot().tokens.input).toBe(11);
    expect(owner.serialize().threads[0]?.terminalState).toBe('failed');
  });

  it('starts empty and partial with a diagnostic on corrupt or unknown-version checkpoints', () => {
    for (const raw of [{ version: 99 }, { version: 1, threads: 'bad' }]) {
      const owner = CodexSessionUsageOwner.restore(SESSION, ROOT, raw);
      expect(owner.snapshot().tokens.input).toBe(0);
      expect(owner.snapshot().coverage).toBe('partial');
      expect(owner.getDiagnostics()).toHaveLength(1);
    }
  });

  it('keeps child usage separate until disjoint inclusion is asserted', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'parent', totals(10), { modelId: 'root-model' }));
    owner.accept(evidence('native-child', 'child', totals(5), { parentThreadId: ROOT }));
    expect(owner.snapshot().tokens.input).toBe(10);
    expect(owner.snapshot().model).toBe('root-model');
    expect(owner.snapshot().coverage).toBe('partial');
    expect(owner.serialize().childTotal.uncachedInputTokens).toBe(5);
    expect(owner.serialize().childInclusion).toBe('unverified');
    expect(CodexSessionUsageOwner.restore(SESSION, ROOT, owner.serialize()).snapshot().tokens.input).toBe(10);
  });

  it('reports conflicting classes, inconsistent classes, and reasoning overflow', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT);
    owner.accept(evidence(ROOT, 'turn', totals(10, 2)));
    expect(owner.accept(evidence(ROOT, 'turn', totals(9, 3), { timestamp: 2 }))).toBe(false);
    expect(owner.getDiagnostics()).toContain('class-conflict');
    owner.accept(evidence(ROOT, 'turn', totals(11, 3), {
      timestamp: 3, lastExceedsTotal: true,
    }));
    expect(owner.getDiagnostics()).toContain('classes-inconsistent');
    expect(owner.accept(evidence(ROOT, 'turn', {
      ...totals(12, 3), reasoningOutputTokens: 4,
    }, { timestamp: 4 }))).toBe(false);
    expect(owner.getDiagnostics()).toContain('reasoning-exceeds-output');
  });

  it('caps persisted threads and reports coverage loss', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT, 'disjoint');
    owner.accept(evidence(ROOT, 'root', totals(1)));
    for (let index = 1; index < MAX_USAGE_THREADS; index += 1)
      owner.accept(evidence(`child-${index}`, 'turn', totals(1), { parentThreadId: ROOT }));
    expect(owner.accept(evidence('overflow', 'turn', totals(1), { parentThreadId: ROOT }))).toBe(false);
    expect(owner.serialize().threads).toHaveLength(MAX_USAGE_THREADS);
    expect(owner.getDiagnostics()).toContain('thread-limit');
    expect(codexUsageCheckpointSchema.safeParse({
      ...owner.serialize(), threads: [...owner.serialize().threads, owner.serialize().threads[0]],
    }).success).toBe(false);
  });

  it('rejects accrued counters below current counters and orphan children on restore', () => {
    const owner = new CodexSessionUsageOwner(SESSION, ROOT, 'disjoint');
    owner.accept(evidence(ROOT, 'turn', totals(10)));
    owner.accept(evidence('child', 'turn', totals(2), { parentThreadId: ROOT }));
    const checkpoint = owner.serialize();
    const badAccrued = { ...checkpoint, threads: checkpoint.threads.map((thread) =>
      thread.threadId === ROOT ? { ...thread, accrued: totals(9) } : thread) };
    const orphan = { ...checkpoint, threads: checkpoint.threads.map((thread) =>
      thread.threadId === 'child' ? { ...thread, parentThreadId: 'missing' } : thread) };
    for (const raw of [badAccrued, orphan]) {
      const restored = CodexSessionUsageOwner.restore(SESSION, ROOT, raw);
      expect(restored.getDiagnostics()).toContain('invalid-checkpoint');
      expect(restored.snapshot().tokens.input).toBe(0);
    }
  });
});
