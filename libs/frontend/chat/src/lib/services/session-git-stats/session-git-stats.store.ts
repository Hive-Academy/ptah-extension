import {
  DestroyRef,
  Injectable,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import type { CompactGitState } from '@ptah-extension/chat-ui';
import {
  VSCodeService,
  rpcCall,
  type MessageHandler,
} from '@ptah-extension/core';
import { MESSAGE_TYPES, type GitInfoResult } from '@ptah-extension/shared';

const MAX_CONCURRENT_READS = 2;
const DEBOUNCE_MS = 1_000;
const FRESHNESS_MS = 5_000;
const RPC_TIMEOUT_MS = 15_000;
const NONE: CompactGitState = { kind: 'none' };

function normalizeRoot(root: string): string {
  const slashed = root.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGitInfo(value: unknown): value is GitInfoResult {
  return (
    isRecord(value) &&
    typeof value['isGitRepo'] === 'boolean' &&
    Array.isArray(value['files']) &&
    value['files'].every(
      (file: unknown) =>
        isRecord(file) &&
        (file['isDirectory'] === undefined ||
          typeof file['isDirectory'] === 'boolean') &&
        (file['binary'] === undefined || typeof file['binary'] === 'boolean') &&
        (file['additions'] === undefined ||
          file['additions'] === null ||
          (typeof file['additions'] === 'number' &&
            Number.isFinite(file['additions']) &&
            file['additions'] >= 0)) &&
        (file['deletions'] === undefined ||
          file['deletions'] === null ||
          (typeof file['deletions'] === 'number' &&
            Number.isFinite(file['deletions']) &&
            file['deletions'] >= 0)),
    )
  );
}

function toState(result: GitInfoResult): CompactGitState {
  if (!result.isGitRepo) return NONE;
  if (result.statusUnavailable)
    return { kind: 'unknown', reason: 'unavailable' };
  let additions = 0;
  let deletions = 0;
  let partial = false;
  for (const file of result.files) {
    if (file.isDirectory) continue;
    if (file.binary || file.additions == null || file.deletions == null)
      partial = true;
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  return { kind: 'known', additions, deletions, partial };
}

interface RootEntry {
  readonly root: string;
  readonly tabs: Map<string, number>;
  generation: number;
  readAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  queued: boolean;
  inFlight: boolean;
  rerun: boolean;
}

export function sessionWorkingRoot(
  tab: TabState,
  partitionPath: string | null,
  fallback: string | undefined,
): string | null {
  return tab.agentOrigin?.worktreePath ?? partitionPath ?? fallback ?? null;
}

/** Git status shared by cards whose sessions use the same working root. */
@Injectable({ providedIn: 'root' })
export class SessionGitStatsStore implements MessageHandler {
  private readonly vscode = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly entries = new Map<string, RootEntry>();
  private readonly queue: RootEntry[] = [];
  private readonly states = signal<ReadonlyMap<string, CompactGitState>>(
    new Map(),
  );
  private activeReads = 0;
  private destroyed = false;

  readonly handledMessageTypes = [
    MESSAGE_TYPES.GIT_STATUS_UPDATE,
    MESSAGE_TYPES.SESSION_TURN_ENDED,
    MESSAGE_TYPES.SESSION_TURN_FAILED,
  ] as const;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      for (const entry of this.entries.values()) {
        if (entry.timer !== null) clearTimeout(entry.timer);
      }
      this.entries.clear();
      this.queue.length = 0;
      this.states.set(new Map());
    });
  }

  track(root: string, tabId: string): () => void {
    const key = normalizeRoot(root);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        root,
        tabs: new Map(),
        generation: 0,
        readAt: 0,
        timer: null,
        queued: false,
        inFlight: false,
        rerun: false,
      };
      this.entries.set(key, entry);
      this.request(entry, false);
    }
    entry.tabs.set(tabId, (entry.tabs.get(tabId) ?? 0) + 1);
    const captured = entry;
    return () => {
      if (this.entries.get(key) !== captured) return;
      const count = captured.tabs.get(tabId) ?? 0;
      if (count > 1) captured.tabs.set(tabId, count - 1);
      else captured.tabs.delete(tabId);
      if (captured.tabs.size > 0) return;
      if (captured.timer !== null) clearTimeout(captured.timer);
      this.entries.delete(key);
      this.removeQueued(captured);
      const next = new Map(untracked(this.states));
      next.delete(key);
      this.states.set(next);
    };
  }

  stateFor(root: string | null): CompactGitState {
    return root ? (this.states().get(normalizeRoot(root)) ?? NONE) : NONE;
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === MESSAGE_TYPES.GIT_STATUS_UPDATE) {
      const payload = message.payload;
      if (!isRecord(payload)) return;
      const root =
        typeof payload['workspaceRoot'] === 'string'
          ? payload['workspaceRoot']
          : this.vscode.config().workspaceRoot;
      const entry = this.entries.get(normalizeRoot(root ?? ''));
      if (!entry) return;
      entry.generation++;
      entry.rerun = false;
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
      this.removeQueued(entry);
      entry.readAt = Date.now();
      this.setState(
        entry,
        isGitInfo(payload)
          ? toState(payload)
          : { kind: 'unknown', reason: 'unavailable' },
      );
      return;
    }
    if (
      message.type !== MESSAGE_TYPES.SESSION_TURN_ENDED &&
      message.type !== MESSAGE_TYPES.SESSION_TURN_FAILED
    )
      return;
    const sessionId = isRecord(message.payload)
      ? message.payload['sessionId']
      : undefined;
    if (typeof sessionId !== 'string') return;
    for (const entry of this.entries.values()) {
      if (
        [...entry.tabs.keys()].some(
          (tabId) =>
            this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab
              .claudeSessionId === sessionId,
        )
      ) {
        this.request(entry, true);
      }
    }
  }

  private request(entry: RootEntry, forced: boolean): void {
    if (!forced && Date.now() - entry.readAt < FRESHNESS_MS) return;
    if (entry.inFlight) {
      entry.rerun = true;
      return;
    }
    if (entry.queued) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (this.entries.get(normalizeRoot(entry.root)) !== entry || entry.queued)
        return;
      entry.queued = true;
      this.queue.push(entry);
      this.drain();
    }, DEBOUNCE_MS);
  }

  private removeQueued(entry: RootEntry): void {
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
    entry.queued = false;
  }

  private drain(): void {
    while (
      !this.destroyed &&
      this.activeReads < MAX_CONCURRENT_READS &&
      this.queue.length > 0
    ) {
      const entry = this.queue.shift();
      if (!entry) return;
      entry.queued = false;
      if (this.entries.get(normalizeRoot(entry.root)) !== entry) continue;
      void this.read(entry);
    }
  }

  private async read(entry: RootEntry): Promise<void> {
    entry.inFlight = true;
    this.activeReads++;
    const generation = entry.generation;
    try {
      const result = await rpcCall<GitInfoResult>(
        this.vscode,
        'git:info',
        { workspaceRoot: entry.root },
        RPC_TIMEOUT_MS,
      );
      if (
        this.entries.get(normalizeRoot(entry.root)) === entry &&
        entry.generation === generation
      ) {
        if (result.success && isGitInfo(result.data)) {
          this.setState(entry, toState(result.data));
        } else {
          console.warn('[SessionGitStatsStore] Git read failed.', result.error);
          this.setState(entry, { kind: 'unknown', reason: 'failed' });
        }
        entry.readAt = Date.now();
      }
    } catch (error: unknown) {
      if (
        this.entries.get(normalizeRoot(entry.root)) === entry &&
        entry.generation === generation
      ) {
        console.warn('[SessionGitStatsStore] Git read failed.', error);
        this.setState(entry, { kind: 'unknown', reason: 'failed' });
        entry.readAt = Date.now();
      }
    } finally {
      entry.inFlight = false;
      this.activeReads--;
      if (
        this.entries.get(normalizeRoot(entry.root)) === entry &&
        entry.rerun
      ) {
        entry.rerun = false;
        this.request(entry, true);
      }
      this.drain();
    }
  }

  private setState(entry: RootEntry, state: CompactGitState): void {
    this.states.set(
      new Map(untracked(this.states)).set(normalizeRoot(entry.root), state),
    );
  }
}
