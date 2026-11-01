import {
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import {
  ClaudeAmbientStatusService,
  ProvidersSettingsStateService,
  VSCodeService,
  type ClaudeAmbientStatusView,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { CliDetectionResult } from '@ptah-extension/shared';

export type ClaudeReadinessState =
  'checking' | 'ready' | 'missing' | 'signed-out' | 'error';

/** Which copy variant the `error` state shows (spec §12.2). */
export type ClaudeReadinessErrorCause = 'timeout' | 'unreadable' | 'local';

export interface ClaudeReadinessView {
  readonly state: ClaudeReadinessState;
  /** Non-null only for `error`. */
  readonly errorCause: ClaudeReadinessErrorCause | null;
  /** From the Claude row; null unless installed. */
  readonly path: string | null;
  readonly version: string | null;
}

export interface ClaudeReadinessInputs {
  readonly detection: ProvidersSettingsSection<readonly CliDetectionResult[]>;
  readonly ambient: ClaudeAmbientStatusView;
}

function view(
  state: ClaudeReadinessState,
  row: CliDetectionResult | undefined,
  errorCause: ClaudeReadinessErrorCause | null = null,
): ClaudeReadinessView {
  const installed = row?.installed === true;
  return {
    state,
    errorCause,
    path: installed ? (row.path ?? null) : null,
    version: installed ? (row.version ?? null) : null,
  };
}

/**
 * The Claude Code readiness shown by the Get ready stages, the banner and
 * the strip. First match wins (spec §12.2 table, made exact in the
 * implementation plan): checking, missing, error, signed-out, ready.
 */
export function deriveClaudeReadiness(
  input: ClaudeReadinessInputs,
): ClaudeReadinessView {
  const { detection, ambient } = input;
  const row = detection.data?.find((entry) => entry.cli === 'claude');
  const result = ambient.result;

  if (
    detection.status === 'unloaded' ||
    detection.status === 'loading' ||
    ambient.status === 'checking' ||
    ambient.status === 'idle' ||
    ambient.status === 'inert'
  ) {
    return view('checking', undefined);
  }
  if (
    (detection.status === 'ready' && row?.installed === false) ||
    (result?.state === 'unknown' && result.reason === 'cli-missing')
  ) {
    return view('missing', row);
  }
  if (detection.status === 'error' || !row || ambient.localFailure || !result) {
    return view('error', row, 'local');
  }
  if (result.state === 'unknown') {
    const cause: ClaudeReadinessErrorCause =
      result.reason === 'timeout' || result.reason === 'unreadable'
        ? result.reason
        : 'local';
    return view('error', row, cause);
  }
  return view(result.state === 'connected' ? 'ready' : 'signed-out', row);
}

/**
 * The single derived Claude readiness (onboarding → core only).
 *
 * Reads go through the two root owners: `ProvidersSettingsStateService`
 * (`agent:detectClis`) and `ClaudeAmbientStatusService`
 * (`provider:getAmbientClaudeStatus`). Both never throw and drop stale
 * replies, so a mount read overlapping the embedded settings page's own read
 * is safe. Persists nothing; no timers, polling or constructor I/O. Outside
 * Electron every `refresh` is a no-op.
 */
@Injectable({ providedIn: 'root' })
export class ClaudeReadinessStore {
  private readonly providers = inject(ProvidersSettingsStateService);
  private readonly ambient = inject(ClaudeAmbientStatusService);
  private readonly _rechecking = signal(0);

  /** Electron only; read once. */
  readonly available: boolean = inject(VSCodeService).isElectron;

  readonly view: Signal<ClaudeReadinessView> = computed(() =>
    deriveClaudeReadiness({
      detection: this.providers.cliDetection(),
      ambient: this.ambient.view(),
    }),
  );

  /** A Re-check (`refresh(true)`) started here is in flight. */
  readonly rechecking: Signal<boolean> = computed(() => this._rechecking() > 0);

  /**
   * `fresh: false` is the mount read (host cache allowed); `fresh: true` is
   * Re-check (new probe). Resolves with the settled state.
   */
  async refresh(fresh: boolean): Promise<ClaudeReadinessState> {
    if (!this.available) return this.view().state;
    if (fresh) this._rechecking.update((count) => count + 1);
    try {
      await Promise.all([
        this.providers.redetectClis(),
        this.ambient.read(fresh),
      ]);
    } finally {
      if (fresh) this._rechecking.update((count) => count - 1);
    }
    return this.view().state;
  }
}
