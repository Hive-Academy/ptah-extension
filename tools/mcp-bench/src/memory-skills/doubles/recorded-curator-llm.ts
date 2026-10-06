/**
 * Record/replay double for `ICuratorLLM` (benchmark-design.md 6.2, R-M5).
 *
 * Record mode wraps the real adapter and appends one cassette entry per call.
 * Replay mode serves entries by key and holds no real adapter at all, so a
 * cassette miss can only surface as `CassetteMissError` — never as a live
 * model call (R-M5: model calls in CI are forbidden).
 *
 * Keys are `sha256(method + canonical JSON of the inputs)` with `signal` and
 * `options` excluded (batches.md Assumptions). For `resolve` the `related`
 * candidates are sorted by id before keying: candidate order comes from the
 * embedder, which is the one input the design's R9 assumption does not trust
 * across win32 (record) and linux (CI replay). A reordered candidate list
 * therefore replays the same entry instead of missing.
 *
 * The liveness suites (design 3.8) force fault modes per key in replay mode:
 * a non-network throw, zero drafts, a timeout, or a `stalled` extraction. The
 * re-scan invariant reads `callCounts()`: the second scan of the same
 * transcripts must add zero calls.
 */

import type {
  CuratorCallOptions,
  CuratorExtraction,
  ExtractedMemoryDraft,
  ICuratorLLM,
  ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';

import {
  CassetteMode,
  CassetteStore,
  canonicalJson,
  cassetteKey,
  sha256Hex,
} from './cassette-store';

/** The fault modes the liveness suites select per key (design 3.8). */
export type CuratorFaultMode = 'throw' | 'zero-drafts' | 'timeout' | 'stalled';

export interface RecordedCuratorLlmOptions {
  readonly store: CassetteStore;
  /** Model id written into every entry (design 6.2: a cassette set has one). */
  readonly model: string;
  /** The real adapter to wrap. Required in record mode; refused in replay. */
  readonly inner?: ICuratorLLM;
  /** Replay-only fault modes, keyed by cassette key. */
  readonly faults?: Readonly<Record<string, CuratorFaultMode>>;
}

/** Calls seen by the double, per method, across its life. */
export interface CuratorCallCounts {
  readonly extract: number;
  readonly resolve: number;
}

/** The `related` candidate shape of `ICuratorLLM.resolve`. */
type RelatedCandidate = {
  readonly id: string;
  readonly subject: string | null;
  readonly content: string;
};

/** The cassette key of one `extract` call. */
export function curatorExtractKey(transcript: string): string {
  return cassetteKey('extract', { transcript });
}

/**
 * The cassette key of one `resolve` call. Candidates are sorted by id (R9) so
 * the key does not depend on embedding order.
 */
export function curatorResolveKey(
  drafts: readonly ExtractedMemoryDraft[],
  related: readonly RelatedCandidate[],
): string {
  return cassetteKey('resolve', {
    drafts,
    related: sortByKey(related),
  });
}

function sortByKey(related: readonly RelatedCandidate[]): RelatedCandidate[] {
  return [...related].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export class RecordedCuratorLlm implements ICuratorLLM {
  private readonly inner: ICuratorLLM | undefined;
  private readonly counts = { extract: 0, resolve: 0 };

  constructor(private readonly options: RecordedCuratorLlmOptions) {
    const store = options.store;
    const mode: CassetteMode = store.mode;
    if (mode === 'record' && !options.inner) {
      throw new Error('RecordedCuratorLlm: record mode requires `inner`');
    }
    if (mode === 'replay' && options.inner) {
      throw new Error(
        'RecordedCuratorLlm: replay mode refuses `inner` — a miss must ' +
          'surface as CassetteMissError, never as a live model call',
      );
    }
    if (options.faults && mode === 'record') {
      throw new Error('RecordedCuratorLlm: fault modes are replay-only');
    }
    this.inner = options.inner;
  }

  /** Calls seen so far. The re-scan invariant asserts the second scan adds 0. */
  callCounts(): CuratorCallCounts {
    return { ...this.counts };
  }

  async extract(
    transcript: string,
    signal?: AbortSignal,
    options?: CuratorCallOptions,
  ): Promise<CuratorExtraction> {
    this.counts.extract++;
    const key = curatorExtractKey(transcript);
    if (this.options.store.mode === 'replay') {
      const fault = this.faultFor(key);
      if (fault) {
        return fault.extraction(key);
      }
      return this.options.store.lookup('extract', key)
        .response as CuratorExtraction;
    }
    const response = await this.requireInner().extract(
      transcript,
      signal,
      options,
    );
    this.options.store.record({
      key,
      method: 'extract',
      model: this.options.model,
      promptSha: sha256Hex(transcript),
      response,
    });
    return response;
  }

  async resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly RelatedCandidate[],
    signal?: AbortSignal,
    options?: CuratorCallOptions,
  ): Promise<readonly ResolvedMemoryDraft[]> {
    this.counts.resolve++;
    const key = curatorResolveKey(drafts, related);
    if (this.options.store.mode === 'replay') {
      const fault = this.faultFor(key);
      if (fault) {
        return fault.resolves(key);
      }
      return this.options.store.lookup('resolve', key)
        .response as readonly ResolvedMemoryDraft[];
    }
    const response = await this.requireInner().resolve(
      drafts,
      related,
      signal,
      options,
    );
    this.options.store.record({
      key,
      method: 'resolve',
      model: this.options.model,
      promptSha: sha256Hex(
        canonicalJson({ drafts, related: sortByKey(related) }),
      ),
      response,
    });
    return response;
  }

  private faultFor(key: string): CuratorFault | null {
    const mode = this.options.faults?.[key];
    return mode ? curatorFault(mode) : null;
  }

  private requireInner(): ICuratorLLM {
    if (!this.inner) {
      throw new Error('RecordedCuratorLlm: record mode requires `inner`');
    }
    return this.inner;
  }
}

/** One selected fault mode, applied to both curator methods where it can. */
interface CuratorFault {
  /** The `extract` behaviour of the fault. */
  extraction(key: string): CuratorExtraction;
  /** The `resolve` behaviour of the fault. */
  resolves(key: string): readonly ResolvedMemoryDraft[];
}

function curatorFault(mode: CuratorFaultMode): CuratorFault {
  switch (mode) {
    case 'throw':
      return {
        extraction: (key) => {
          throw injected(key, 'throw');
        },
        resolves: (key) => {
          throw injected(key, 'throw');
        },
      };
    case 'timeout':
      return {
        extraction: (key) => {
          throw timeout(key);
        },
        resolves: (key) => {
          throw timeout(key);
        },
      };
    case 'zero-drafts':
      return {
        extraction: () => ({ status: 'extracted', drafts: [] }),
        resolves: () => [],
      };
    case 'stalled':
      return {
        extraction: () => ({
          status: 'stalled',
          reason: 'provider-unreachable',
          providerId: '',
        }),
        // `resolve` deliberately has no stalled arm: the port's own contract
        // keeps a stall lossless there, so a fault that cannot exist is a
        // configuration error rather than a silent no-op.
        resolves: (key) => {
          throw new Error(
            `RecordedCuratorLlm: fault 'stalled' is not valid for resolve ` +
              `(key ${key})`,
          );
        },
      };
  }
}

/** A plain, non-network error — the liveness class (a) of design 3.8. */
function injected(key: string, mode: CuratorFaultMode): Error {
  return new Error(`RecordedCuratorLlm: injected fault '${mode}' (key ${key})`);
}

/** A timeout-shaped error — the liveness class (c) of design 3.8. */
function timeout(key: string): Error {
  const error = new Error(
    `RecordedCuratorLlm: call timed out (injected fault 'timeout', key ${key})`,
  );
  error.name = 'TimeoutError';
  return error;
}
