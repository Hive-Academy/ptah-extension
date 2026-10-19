import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { AttentionItem, AttentionKind, AttentionSoundCue } from './attention.types';
export { attentionRequestKey } from '@ptah-extension/shared';

export const ATTENTION_RECENT_LIMIT = 75;
export const ATTENTION_SOUND_BURST_MS = 350;
export const ATTENTION_SOUND_COOLDOWN_MS = 2000;

const REQUEST_KINDS: ReadonlySet<AttentionKind> = new Set([
  'permission', 'question', 'lane-permission',
]);

interface TransientClock {
  remainingMs: number;
  startedAt: number;
  paused: boolean;
}

export function attentionConditionKey(workspacePath: string, conditionKey: string): string {
  return `c:${encodeURIComponent(workspacePath)}:${encodeURIComponent(conditionKey)}`;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly entries = signal<readonly AttentionItem[]>([]);
  private readonly sources = new Map<string, Map<string, AttentionItem>>();
  private readonly sounded = new Set<string>();
  private readonly dismissed = new Map<string, string>();
  private readonly hiddenRecent = new Set<string>();
  private readonly suppressed = new Map<string, Set<'panel' | 'inline'>>();
  private readonly individuallyPaused = new Set<string>();
  private readonly clocks = new Map<string, TransientClock>();
  private readonly revision = signal(0);
  private readonly soundState = signal<AttentionSoundCue | null>(null);
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private soundTimeout: ReturnType<typeof setTimeout> | undefined;
  private soundSequence = 0;
  private lastSoundAt = Number.NEGATIVE_INFINITY;
  private allPaused = false;

  readonly needsYou = computed(() => this.entries().filter(item => REQUEST_KINDS.has(item.kind)).reverse());
  readonly badgeCount = computed(() => this.needsYou().length);
  readonly recentNotices = computed(() => {
    this.revision();
    return this.entries().filter(item => this.isRecent(item) && !this.hiddenRecent.has(item.key)).reverse();
  });
  readonly snackbars = computed(() => {
    this.revision();
    return this.entries().filter(item =>
      !this.dismissed.has(item.key) && !this.suppressed.has(item.key) &&
      (REQUEST_KINDS.has(item.kind) || this.clocks.has(item.key)),
    ).reverse();
  });
  readonly canClearAll = computed(() => {
    this.revision();
    return this.recentNotices().length > 0 || this.entries().some(item =>
      this.isRecent(item) && this.clocks.has(item.key) && !this.dismissed.has(item.key),
    );
  });
  /** A new sequence asks the shell sound service to play once, subject to its mute setting. */
  readonly soundCue = this.soundState.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.timeout) clearTimeout(this.timeout);
      if (this.soundTimeout) clearTimeout(this.soundTimeout);
    });
  }

  upsert(item: AttentionItem): void {
    if (!item.key || !Number.isSafeInteger(item.generation)) return;
    if (item.kind === 'info' || item.kind === 'success') return;
    const perSource = this.sources.get(item.key) ?? new Map<string, AttentionItem>();
    const previousSource = perSource.get(item.source);
    if (previousSource && item.generation < previousSource.generation) return;
    perSource.set(item.source, item);
    this.sources.set(item.key, perSource);
    const presented = perSource.get('chat') ?? perSource.get('host') ?? item;
    const prior = this.entries().find(entry => entry.key === item.key);
    const newLifecycle = !prior;
    if (newLifecycle) {
      this.dismissed.delete(item.key);
      this.hiddenRecent.delete(item.key);
      this.clocks.delete(item.key);
      this.individuallyPaused.delete(item.key);
    } else if (prior?.presentationKey !== item.presentationKey) {
      this.dismissed.delete(item.key);
    }
    if (!REQUEST_KINDS.has(item.kind) && !this.clocks.has(item.key) &&
        (newLifecycle || prior?.presentationKey !== item.presentationKey)) {
      const duration = item.kind === 'failure' ? 8000 : item.kind === 'warning' ? 10000 : 6000;
      this.clocks.set(item.key, { remainingMs: duration, startedAt: Date.now(), paused: this.allPaused });
    }
    if (prior && [...new Set([...Object.keys(prior), ...Object.keys(presented)])].every(field => field === 'actions'
      ? presented.actions.length === prior.actions.length && presented.actions.every((action, index) =>
        action.id === prior.actions[index].id && action.label === prior.actions[index].label &&
        action.disabledReason === prior.actions[index].disabledReason)
      : Object.is(presented[field as keyof AttentionItem], prior[field as keyof AttentionItem]))) return;
    const next = prior
      ? this.entries().map(entry => entry.key === item.key ? presented : entry)
      : [...this.entries(), presented];
    const recent = next.filter(entry => this.isRecent(entry));
    const excess = recent.length - ATTENTION_RECENT_LIMIT;
    const evicted = new Set([...recent.filter(entry => this.hiddenRecent.has(entry.key)),
      ...recent.filter(entry => !this.hiddenRecent.has(entry.key))].slice(0, Math.max(0, excess)).map(entry => entry.key));
    if (excess > 0) {
      for (const old of recent.filter(entry => evicted.has(entry.key))) {
        this.clocks.delete(old.key);
        this.individuallyPaused.delete(old.key);
        this.dismissed.delete(old.key);
        this.hiddenRecent.delete(old.key);
      }
    }
    for (const key of evicted) this.sources.delete(key);
    this.entries.set(next.filter(entry => !evicted.has(entry.key)));
    this.touch();
    this.scheduleExpiry();
    if (item.soundEligible && !this.sounded.has(item.key)) {
      this.sounded.add(item.key);
      this.queueSound(item.key);
    }
  }

  resolve(key: string, generation?: number, source?: string): void {
    const perSource = this.sources.get(key);
    if (perSource) {
      for (const [name, value] of perSource) {
        if (source && name !== source) continue;
        if (generation !== undefined && generation < value.generation) continue;
        perSource.delete(name);
      }
      if (perSource.size) {
        const presented = perSource.get('chat') ?? perSource.get('host') ?? [...perSource.values()][0];
        this.entries.update(entries => entries.map(entry => entry.key === key ? presented : entry));
        this.touch();
        return;
      }
      this.sources.delete(key);
      this.sounded.delete(key);
    }
    const item = this.entries().find(entry => entry.key === key);
    if (!item || (generation !== undefined && generation < item.generation && !perSource)) return;
    this.entries.update(entries => entries.filter(entry => entry.key !== key));
    this.clocks.delete(key);
    this.individuallyPaused.delete(key);
    this.dismissed.delete(key);
    this.hiddenRecent.delete(key);
    this.suppressed.delete(key);
    this.touch();
    this.scheduleExpiry();
  }

  dismissPresentation(key: string): void {
    const item = this.entries().find(entry => entry.key === key);
    if (!item) return;
    this.dismissed.set(key, item.presentationKey ?? '');
    this.clocks.delete(key);
    this.touch();
    this.scheduleExpiry();
  }

  dismissRecent(key: string): void {
    const item = this.entries().find(entry => entry.key === key);
    if (!item || !this.isRecent(item)) return;
    this.hiddenRecent.add(key);
    this.dismissPresentation(key);
  }

  clearAll(): void {
    for (const item of this.entries()) {
      if (!this.isRecent(item)) continue;
      this.hiddenRecent.add(item.key);
      this.dismissed.set(item.key, item.presentationKey ?? '');
      this.clocks.delete(item.key);
    }
    this.touch();
    this.scheduleExpiry();
  }

  /** The presenter controls focused/visible surface suppression. */
  setSnackbarSuppressed(key: string, suppressed: boolean, reason: 'panel' | 'inline' = 'panel'): void {
    const reasons = this.suppressed.get(key) ?? new Set<'panel' | 'inline'>();
    if (reasons.has(reason) === suppressed) return;
    if (suppressed) reasons.add(reason);
    else reasons.delete(reason);
    if (reasons.size) this.suppressed.set(key, reasons);
    else this.suppressed.delete(key);
    this.touch();
  }

  pauseAll(): void {
    if (this.allPaused) return;
    this.allPaused = true;
    for (const clock of this.clocks.values()) this.pauseClock(clock);
    this.scheduleExpiry();
  }

  resumeAll(): void {
    if (!this.allPaused) return;
    this.allPaused = false;
    for (const [key, clock] of this.clocks) {
      if (clock.paused && !this.individuallyPaused.has(key)) {
        clock.paused = false;
        clock.startedAt = Date.now();
      }
    }
    this.scheduleExpiry();
  }

  pauseSnackbar(key: string): void {
    const clock = this.clocks.get(key);
    if (clock) {
      this.individuallyPaused.add(key);
      this.pauseClock(clock);
    }
    this.scheduleExpiry();
  }

  resumeSnackbar(key: string): void {
    const clock = this.clocks.get(key);
    this.individuallyPaused.delete(key);
    if (clock && !this.allPaused) {
      clock.paused = false;
      clock.startedAt = Date.now();
    }
    this.scheduleExpiry();
  }

  private isRecent(item: AttentionItem): boolean {
    return item.kind === 'failure' || item.kind === 'warning';
  }

  private touch(): void { this.revision.update(value => value + 1); }

  private pauseClock(clock: TransientClock): void {
    if (clock.paused) return;
    clock.remainingMs = Math.max(0, clock.remainingMs - (Date.now() - clock.startedAt));
    clock.paused = true;
  }

  private scheduleExpiry(): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    let next = Number.POSITIVE_INFINITY;
    const now = Date.now();
    for (const [key, clock] of this.clocks) {
      if (clock.paused) continue;
      const left = clock.remainingMs - (now - clock.startedAt);
      if (left <= 0) {
        this.clocks.delete(key);
        this.dismissed.set(key, '');
        this.touch();
      } else next = Math.min(next, left);
    }
    if (Number.isFinite(next)) this.timeout = setTimeout(() => this.scheduleExpiry(), next);
  }

  private queueSound(key: string): void {
    if (this.soundTimeout) return;
    this.soundTimeout = setTimeout(() => {
      this.soundTimeout = undefined;
      const now = Date.now();
      if (now - this.lastSoundAt < ATTENTION_SOUND_COOLDOWN_MS) return;
      this.lastSoundAt = now;
      this.soundState.set({ sequence: ++this.soundSequence, key });
    }, ATTENTION_SOUND_BURST_MS);
  }
}
