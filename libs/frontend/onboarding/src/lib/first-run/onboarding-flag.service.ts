import { Injectable, inject, signal, type Signal } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import { z } from 'zod';

/** The one localStorage key onboarding owns. `v1`: shown once per version. */
export const ONBOARDING_FLAG_KEY = 'ptah.onboarding.v1';

/** Written and removed once at construction to learn whether storage works. */
const PROBE_KEY = 'ptah.onboarding.probe';

const LOG_CONTEXT = 'OnboardingFlagService';

/**
 * The stored record. Strict: an unknown key makes the record unreadable, and
 * an unreadable record never causes a redirect and is never overwritten.
 */
const onboardingFlagSchema = z.strictObject({
  shownAt: z.iso.datetime().optional(),
  dismissedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  // Parsed on its own by `readySchema`; a malformed value is dropped, never
  // costing the top-level fields.
  ready: z.unknown().optional(),
});

/** The Get ready pre-step progress slice. Lenient: invalid reads as `{}`. */
const readySchema = z.object({
  claudeAt: z.iso.datetime().optional(),
  settingsAt: z.iso.datetime().optional(),
  skippedAt: z.iso.datetime().optional(),
});

/** Get ready pre-step progress (spec 12.D1). */
export interface OnboardingReadyFlag {
  /** Stage 1 was left by Continue while Claude Code was ready. */
  readonly claudeAt?: string;
  /** Stage 2 was left by "Continue to setup". */
  readonly settingsAt?: string;
  /** Either stage was left by "Continue anyway" or "Skip for now" (latest wins). */
  readonly skippedAt?: string;
}

export interface OnboardingFlag {
  /** When the automatic first-run redirect landed on onboarding. */
  readonly shownAt?: string;
  /** When the user left with "Skip for now" or "Back to chat". */
  readonly dismissedAt?: string;
  /** When an Analyze run reached Done or a harness apply succeeded. */
  readonly completedAt?: string;
  /** Get ready pre-step progress; absent on records written before it. */
  readonly ready?: OnboardingReadyFlag;
}

type TopLevelField = Exclude<keyof OnboardingFlag, 'ready'>;

type FlagRead =
  | { readonly kind: 'ok'; readonly flag: OnboardingFlag }
  | { readonly kind: 'unreadable' };

/**
 * The onboarding first-run record in `localStorage['ptah.onboarding.v1']`.
 *
 * Every storage access is guarded, and every failure ends in "no redirect":
 * - storage that fails the construction probe, or a stored record that cannot
 *   be read, makes {@link isFirstRunEligible} false;
 * - a `markShown()` that cannot be written suppresses the redirect for the
 *   rest of the session, so chat stays reachable and nothing loops.
 *
 * Every `mark*` method re-reads the stored record and merges into it, so no
 * write drops another writer's fields. The service only stores; it computes
 * no route.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingFlagService {
  private readonly logger = inject(LoggingService);

  private readonly _storageAvailable = signal(false);
  private readonly _flag = signal<OnboardingFlag>({});
  private readable = false;
  private suppressed = false;

  /** The stored record; `{}` when absent or unreadable. */
  readonly flag: Signal<OnboardingFlag> = this._flag.asReadonly();
  /** Whether the construction probe could write to localStorage. */
  readonly storageAvailable: Signal<boolean> =
    this._storageAvailable.asReadonly();

  constructor() {
    this._storageAvailable.set(this.probe());
    if (!this._storageAvailable()) return;
    const read = this.read();
    this.readable = read.kind === 'ok';
    if (read.kind === 'ok') this._flag.set(read.flag);
  }

  /**
   * Whether the automatic first-run redirect may run: storage works, the
   * record is readable, no write failed this session, and onboarding was
   * never shown, dismissed or completed.
   */
  isFirstRunEligible(): boolean {
    const flag = this._flag();
    return (
      this._storageAvailable() &&
      this.readable &&
      !this.suppressed &&
      !flag.shownAt &&
      !flag.dismissedAt &&
      !flag.completedAt
    );
  }

  /** Commit the first-run redirect. A failed write suppresses the redirect. */
  markShown(): void {
    if (!this.update('shownAt')) this.suppressed = true;
  }

  markDismissed(): void {
    this.update('dismissedAt');
  }

  markCompleted(): void {
    this.update('completedAt');
  }

  /**
   * Stamp one Get ready pre-step field. A failed write is swallowed and does
   * not suppress the redirect: `ready` never affects eligibility.
   */
  markReady(key: keyof OnboardingReadyFlag): void {
    const now = new Date().toISOString();
    this.write(
      (flag) => ({ ...flag, ready: { ...flag.ready, [key]: now } }),
      key,
    );
  }

  /**
   * Stamp `field` with the current time, merged into the record as stored
   * now. Returns whether the record was persisted.
   *
   * The in-memory flag is updated even when the write fails, so this session
   * behaves as if the write had succeeded. An unreadable stored record is
   * left untouched: it may belong to a newer build.
   */
  private update(field: TopLevelField): boolean {
    const now = new Date().toISOString();
    return this.write((flag) => ({ ...flag, [field]: now }), field);
  }

  /** Apply `change` to the record as stored now and persist it. */
  private write(
    change: (flag: OnboardingFlag) => OnboardingFlag,
    field: string,
  ): boolean {
    if (!this._storageAvailable()) {
      this._flag.update(change);
      return false;
    }
    const read = this.read();
    if (read.kind === 'unreadable') {
      this.readable = false;
      this._flag.update(change);
      this.logger.warn(
        LOG_CONTEXT,
        'Stored onboarding record is unreadable; not overwriting it',
      );
      return false;
    }
    const next = change(read.flag);
    this._flag.set(next);
    try {
      globalThis.localStorage.setItem(
        ONBOARDING_FLAG_KEY,
        JSON.stringify(next),
      );
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported — the storage failure is logged without exposing it to the UI.
      this.logger.warn(LOG_CONTEXT, 'Could not persist the onboarding record', {
        field,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private read(): FlagRead {
    try {
      const raw = globalThis.localStorage.getItem(ONBOARDING_FLAG_KEY);
      if (raw === null) return { kind: 'ok', flag: {} };
      const parsed = onboardingFlagSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return { kind: 'unreadable' };
      const { ready, ...topLevel } = parsed.data;
      if (ready === undefined) return { kind: 'ok', flag: topLevel };
      const readyParsed = readySchema.safeParse(ready);
      return {
        kind: 'ok',
        flag: {
          ...topLevel,
          ready: readyParsed.success ? readyParsed.data : {},
        },
      };
    } catch {
      // degradation-audit: reported - an unreadable record (storage throws or
      // invalid JSON) makes the first-run redirect ineligible; the caller
      // never redirects on it and never overwrites it.
      return { kind: 'unreadable' };
    }
  }

  private probe(): boolean {
    try {
      const storage = globalThis.localStorage;
      storage.setItem(PROBE_KEY, '1');
      storage.removeItem(PROBE_KEY);
      return true;
    } catch {
      // degradation-audit: reported - unavailable storage disables the
      // automatic first-run redirect for this session (no redirect, no loop).
      this.logger.warn(LOG_CONTEXT, 'localStorage is unavailable');
      return false;
    }
  }
}
