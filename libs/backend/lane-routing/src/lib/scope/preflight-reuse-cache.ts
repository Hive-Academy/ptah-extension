import type { PreflightResult } from '../contracts/route-decide-result.schema';
import type { HostRoutingSetting } from './host-routing-setting';

interface CacheEntry {
  readonly revision: number;
  readonly modelFingerprint: string;
  readonly result: PreflightResult;
}

interface SessionState {
  continuity: 'known' | 'pending' | 'unknown';
  currentRevision: number | null;
  entry?: CacheEntry;
}

/** In-memory, revision-validated pre-flight reuse, keyed by the caller's tab id. */
export class PreflightReuseCache {
  private readonly sessions = new Map<string, SessionState>();
  private static readonly MAX_SESSIONS = 100;

  constructor(private readonly setting: HostRoutingSetting) {}

  beginTurn(key: string): void {
    const state = this.session(key);
    state.continuity = 'pending';
  }

  confirmRevision(key: string, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      this.markUnknown(key);
      return;
    }
    const state = this.session(key);
    state.continuity = 'known';
    state.currentRevision = revision;
    if (state.entry?.revision !== revision) delete state.entry;
  }

  markUnknown(key: string): void {
    const state = this.session(key);
    state.continuity = 'unknown';
    delete state.entry;
  }

  put(key: string, entry: CacheEntry): void {
    if (!this.setting.isEnabled()) {
      this.clear();
      return;
    }
    const state = this.sessions.get(key);
    if (
      state === undefined ||
      state.continuity !== 'known' ||
      entry.revision !== state.currentRevision
    ) return;
    state.entry = entry;
    this.touch(key, state);
  }

  get(key: string, modelFingerprint: string): PreflightResult | null {
    if (!this.setting.isEnabled()) {
      this.clear();
      return null;
    }
    const state = this.sessions.get(key);
    if (state === undefined) return null;
    this.touch(key, state);
    if (state.continuity !== 'known' || state.entry === undefined) return null;
    if (
      state.entry.revision !== state.currentRevision ||
      state.entry.modelFingerprint !== modelFingerprint
    ) {
      delete state.entry;
      return null;
    }
    return state.entry.result;
  }

  invalidate(key: string): void {
    this.sessions.delete(key);
  }

  clear(): void {
    this.sessions.clear();
  }

  private session(key: string): SessionState {
    const state = this.sessions.get(key) ?? {
      continuity: 'unknown' as const,
      currentRevision: null,
    };
    this.touch(key, state);
    return state;
  }

  private touch(key: string, state: SessionState): void {
    this.sessions.delete(key);
    this.sessions.set(key, state);
    if (this.sessions.size > PreflightReuseCache.MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
  }
}
