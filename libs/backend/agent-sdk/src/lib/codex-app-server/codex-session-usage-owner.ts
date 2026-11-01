import { z } from 'zod';
import type { CodexUsageCounters, CodexUsageEvidence } from '@ptah-extension/codex-runtime';
import type { SessionStatsEntry } from '@ptah-extension/shared';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const MAX_USAGE_THREADS = 256;
const countersSchema = z.object({
  uncachedInputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheCreationTokens: count,
  reasoningOutputTokens: count,
  totalTokens: count,
}).strict();
const threadSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  parentThreadId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  epoch: count,
  timestamp: count,
  terminalState: z.enum(['none', 'completed', 'failed', 'interrupted']),
  counters: countersSchema,
  accrued: countersSchema,
}).strict();
export const codexUsageCheckpointSchema = z.object({
  version: z.literal(2),
  sessionId: z.string().min(1),
  rootThreadId: z.string().min(1),
  revision: count,
  coverage: z.enum(['complete', 'partial']),
  childInclusion: z.enum(['disjoint', 'unverified']),
  cacheSemanticsAmbiguous: z.boolean(),
  /** Batch 3 pricing provenance placeholders. Null means no catalog was applied. */
  catalogSource: z.string().nullable(),
  catalogVersion: z.string().nullable(),
  total: countersSchema,
  childTotal: countersSchema,
  threads: z.array(threadSchema).max(MAX_USAGE_THREADS),
}).strict();
export type CodexUsageCheckpoint = z.infer<typeof codexUsageCheckpointSchema>;
export type CodexUsageOwnerDiagnostic = 'invalid-checkpoint' | 'unknown-version' | 'session-mismatch' |
  'root-mismatch' | 'counter-decrease' | 'missing-parent' | 'missing-epoch' |
  'class-conflict' | 'classes-inconsistent' | 'reasoning-exceeds-output' |
  'thread-limit' | 'child-inclusion-unverified';

const ZERO: CodexUsageCounters = Object.freeze({
  uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheCreationTokens: 0, reasoningOutputTokens: 0, totalTokens: 0,
});
const keys = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'reasoningOutputTokens', 'totalTokens'] as const;
type Thread = z.infer<typeof threadSchema>;
type MutableCounters = Record<keyof CodexUsageCounters, number>;

function sum(left: CodexUsageCounters, right: CodexUsageCounters): MutableCounters | null {
  const result: MutableCounters = { ...left };
  for (const key of keys) {
    result[key] += right[key];
    if (!Number.isSafeInteger(result[key])) return null;
  }
  return result;
}

function equal(left: CodexUsageCounters, right: CodexUsageCounters): boolean {
  return keys.every((key) => left[key] === right[key]);
}

/** One owner per Ptah session. Native cumulative counters are never summed as notifications. */
export class CodexSessionUsageOwner {
  private readonly threads = new Map<string, Thread>();
  private total: CodexUsageCounters = ZERO;
  private childTotal: CodexUsageCounters = ZERO;
  private revision = 0;
  private coverage: 'complete' | 'partial' = 'complete';
  private cacheSemanticsAmbiguous = false;
  private readonly diagnostics = new Set<CodexUsageOwnerDiagnostic>();

  constructor(readonly sessionId: string, readonly rootThreadId: string,
    private readonly childInclusion: 'disjoint' | 'unverified' = 'unverified') {}

  static restore(sessionId: string, rootThreadId: string, raw: unknown): CodexSessionUsageOwner {
    const parsed = codexUsageCheckpointSchema.safeParse(raw);
    const owner = new CodexSessionUsageOwner(sessionId, rootThreadId,
      parsed.success ? parsed.data.childInclusion : 'unverified');
    if (!parsed.success) {
      // Caller logs the returned diagnostic when persisted data is rejected.
      owner.markPartial(typeof raw === 'object' && raw !== null && 'version' in raw && raw.version !== 2
        ? 'unknown-version' : 'invalid-checkpoint');
      return owner;
    }
    const saved = parsed.data;
    if (saved.sessionId !== sessionId || saved.rootThreadId !== rootThreadId) {
      owner.markPartial(saved.sessionId !== sessionId ? 'session-mismatch' : 'root-mismatch');
      return owner;
    }
    const seen = new Set<string>();
    let root: CodexUsageCounters = ZERO;
    let children: CodexUsageCounters = ZERO;
    for (const thread of saved.threads) {
      if (seen.has(thread.threadId) || thread.counters.reasoningOutputTokens > thread.counters.outputTokens ||
        keys.some((key) => thread.accrued[key] < thread.counters[key])) {
        owner.markPartial('invalid-checkpoint');
        return owner;
      }
      seen.add(thread.threadId);
      const next = sum(thread.threadId === rootThreadId ? root : children, thread.accrued);
      if (!next) { owner.markPartial('invalid-checkpoint'); return owner; }
      if (thread.threadId === rootThreadId) root = next;
      else children = next;
    }
    const computedTotal = saved.childInclusion === 'disjoint' ? sum(root, children) : root;
    if (saved.revision < saved.threads.length ||
      (saved.threads.length > 0 && !seen.has(rootThreadId)) ||
      saved.threads.some((thread) => thread.threadId !== rootThreadId &&
        (!thread.parentThreadId || thread.parentThreadId === thread.threadId ||
          !seen.has(thread.parentThreadId))) ||
      !computedTotal || !equal(computedTotal, saved.total) || !equal(children, saved.childTotal) ||
      (children.totalTokens > 0 && saved.childInclusion === 'unverified' && saved.coverage !== 'partial')) {
      owner.markPartial('invalid-checkpoint');
      return owner;
    }
    for (const thread of saved.threads) owner.threads.set(thread.threadId, thread);
    owner.total = saved.total;
    owner.childTotal = saved.childTotal;
    owner.revision = saved.revision;
    owner.coverage = saved.coverage;
    owner.cacheSemanticsAmbiguous = saved.cacheSemanticsAmbiguous;
    return owner;
  }

  getDiagnostics(): readonly CodexUsageOwnerDiagnostic[] { return [...this.diagnostics]; }

  accept(evidence: CodexUsageEvidence): boolean {
    if (!evidence.accepted) return false;
    const prior = this.threads.get(evidence.threadId);
    if (!prior && this.threads.size >= MAX_USAGE_THREADS) {
      this.markPartial('thread-limit'); return false;
    }
    if (!prior && evidence.epoch > 0) this.markPartial('missing-epoch');
    const reset = prior !== undefined && evidence.epoch > prior.epoch &&
      evidence.resetOrStale && evidence.diagnostics.includes('counter-reset');
    const firstProvedReset = !prior && evidence.epoch > 0 && evidence.resetOrStale &&
      evidence.diagnostics.includes('counter-reset');
    if (prior && evidence.epoch < prior.epoch) return false;
    if (prior && evidence.epoch > prior.epoch && !reset) {
      this.markPartial('counter-decrease');
      return false;
    }
    if (prior && evidence.epoch === prior.epoch && evidence.timestamp < prior.timestamp) return false;
    if (evidence.resetOrStale && !reset && !firstProvedReset) {
      this.markPartial('counter-decrease');
      return false;
    }
    if (prior && !reset && evidence.total.totalTokens === prior.counters.totalTokens &&
      keys.some((key) => evidence.total[key] !== prior.counters[key])) {
      this.markPartial('class-conflict'); return false;
    }
    if (evidence.lastExceedsTotal || evidence.diagnostics.includes('classes-inconsistent'))
      this.markPartial('classes-inconsistent');
    this.cacheSemanticsAmbiguous ||= evidence.cacheSemanticsAmbiguous;
    const baseline = reset || !prior ? ZERO : prior.counters;
    const delta: Record<keyof CodexUsageCounters, number> = { ...ZERO };
    for (const key of keys) {
      if (evidence.total[key] < baseline[key]) {
        this.markPartial('counter-decrease');
        return false;
      }
      delta[key] = evidence.total[key] - baseline[key];
    }
    if (evidence.total.reasoningOutputTokens > evidence.total.outputTokens) {
      this.markPartial('reasoning-exceeds-output');
      return false;
    }
    const accrued = sum(prior?.accrued ?? ZERO, delta);
    const isRoot = evidence.threadId === this.rootThreadId;
    const root = isRoot ? sum(this.rootAccrued(), delta) : this.rootAccrued();
    const children = isRoot ? this.childTotal : sum(this.childTotal, delta);
    const total = root && children
      ? this.childInclusion === 'disjoint' ? sum(root, children) : root
      : null;
    if (!accrued || !children || !total) {
      this.markPartial('counter-decrease'); return false;
    }
    const terminalState = evidence.terminalState === 'none' && prior?.turnId === evidence.turnId
      ? prior.terminalState : evidence.terminalState;
    const changed = keys.some((key) => delta[key] > 0);
    if (!changed && prior && !reset && evidence.turnId === prior.turnId && terminalState === prior.terminalState) return false;
    this.total = total;
    this.childTotal = children;
    this.threads.set(evidence.threadId, {
      threadId: evidence.threadId, turnId: evidence.turnId,
      ...(evidence.parentThreadId ? { parentThreadId: evidence.parentThreadId } :
        prior?.parentThreadId ? { parentThreadId: prior.parentThreadId } : {}),
      ...(evidence.modelId ? { modelId: evidence.modelId } :
        prior?.modelId ? { modelId: prior.modelId } : {}),
      epoch: evidence.epoch, timestamp: evidence.timestamp,
      terminalState, counters: evidence.total, accrued,
    });
    this.revision += 1;
    if (!isRoot && !evidence.parentThreadId && !prior?.parentThreadId)
      this.markPartial('missing-parent');
    if (!isRoot && this.childInclusion === 'unverified')
      this.markPartial('child-inclusion-unverified');
    return true;
  }

  serialize(): CodexUsageCheckpoint {
    return {
      version: 2, sessionId: this.sessionId, rootThreadId: this.rootThreadId,
      revision: this.revision, coverage: this.coverage, childInclusion: this.childInclusion,
      cacheSemanticsAmbiguous: this.cacheSemanticsAmbiguous,
      // Batch 3 will fill pricing provenance after applying a catalog.
      catalogSource: null, catalogVersion: null, total: this.total, childTotal: this.childTotal,
      threads: [...this.threads.values()].sort((a, b) => a.threadId.localeCompare(b.threadId)),
    };
  }

  snapshot(messageCount = 0): SessionStatsEntry {
    const model = this.threads.get(this.rootThreadId)?.modelId ??
      [...this.threads.values()].sort((a, b) => a.threadId.localeCompare(b.threadId))[0]?.modelId ?? null;
    return {
      sessionId: this.sessionId, model,
      totalCost: null, tokens: {
        input: this.total.uncachedInputTokens, output: this.total.outputTokens,
        cacheRead: this.total.cacheReadTokens, cacheCreation: this.total.cacheCreationTokens,
      },
      tokenCount: this.total.uncachedInputTokens + this.total.outputTokens + this.total.cacheReadTokens + this.total.cacheCreationTokens,
      messageCount, status: this.threads.size ? 'ok' : 'empty',
      coverage: this.coverage, pricingCoverage: 'none', scope: 'session',
    };
  }

  private rootAccrued(): CodexUsageCounters {
    return this.threads.get(this.rootThreadId)?.accrued ?? ZERO;
  }

  private markPartial(reason: CodexUsageOwnerDiagnostic): void {
    this.coverage = 'partial';
    this.diagnostics.add(reason);
  }
}
