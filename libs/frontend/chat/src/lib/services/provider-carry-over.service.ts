/**
 * ProviderCarryOverService - renderer side of the provider carry-over
 * (TASK_2026_865).
 *
 * After a workspace's provider switch, continuing a chat that belongs to the
 * old provider is refused (AUTH_REQUIRED). This service turns that refusal
 * into an offer to continue in a new chat on the active provider, from a
 * bounded summary the host builds. Two triggers share one launch:
 *
 * - the banner button (`offerFor` -> `start`), bound to the refusal that
 *   produced it through the banner's generation and origin;
 * - `/compact` on a mismatched session (`tryCompact` -> `startFromCompact`).
 *
 * One `pending` entry per tab holds the tab busy from the launch until the new
 * session is bound (`claimSessionResolution` / `completeBinding`) or the launch
 * is definitively over. Every UI effect of a late result runs only while the
 * original tab, session and banner generation still own the UI (`ownsUi`).
 *
 * A launch whose RPC result is indeterminate (a throw, a renderer timeout or
 * abort, a success envelope without data) may or may not have started a
 * session, so it keeps the tab only for `CARRY_OVER_RECOVERY_MS`. Then the tab
 * is released for a retry with a short notice, and the expired launch leaves a
 * marker for `CARRY_OVER_LATE_RESOLUTION_MS`: a resolution it produces late is
 * skipped and aborted, so it can neither bind the tab nor clobber a retry. An
 * error envelope from the host is definite: the tab is released at once.
 *
 * The renderer never holds transcript text: the host reads and renders it.
 * The launch path (offer check, both triggers, the launch RPC) lives in
 * `provider-carry-over-launch.ts`, loaded with a dynamic `import()` on first
 * use so it stays out of the initial bundle; this file keeps the state and
 * the synchronous API sends and resolutions read.
 * Timers: one recovery timer per tab with an indeterminate launch, cleared
 * whenever its entry leaves `pending`; the notice's `ActionBannerService`
 * auto-clear.
 */
import {
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import {
  AuthStateService,
  ClaudeRpcService,
  VSCodeService,
  type AuthRequiredBannerOrigin,
} from '@ptah-extension/core';
import {
  CHAT_ADMISSION_RPC_TIMEOUT_MS,
  type SessionId,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ActionBannerService } from './action-banner.service';

/** Cap on the `/compact` eligibility check before today's path runs. */
export const CARRY_OVER_CHECK_TIMEOUT_MS = 5_000;

/** How long the carry-over notice stays on the tab. */
export const CARRY_OVER_NOTICE_MS = 15_000;

/** Fixed outcome text while a carry-over holds the tab. */
export const CARRY_OVER_BUSY_TEXT = 'A new chat is starting in this tab.';

/** Fixed text when the old conversation could not be read (AC 5.1). */
export const CARRY_OVER_UNREADABLE_TEXT =
  "Couldn't read this conversation to continue it.";

/**
 * How long a launch with an indeterminate RPC result keeps the tab before it
 * is released for a retry. It starts after the RPC gave up, which is already
 * `CHAT_ADMISSION_RPC_TIMEOUT_MS` past the host's admission budget, so a live
 * host has had its chance to resolve the session (Finding 2).
 */
export const CARRY_OVER_RECOVERY_MS = 30_000;

/**
 * How long after a recovery expiry a late `SESSION_ID_RESOLVED` of the expired
 * launch is still recognised as one, and skipped and aborted.
 */
export const CARRY_OVER_LATE_RESOLUTION_MS = CHAT_ADMISSION_RPC_TIMEOUT_MS;

/** Fixed text when the host answered the launch with an error envelope. */
export const CARRY_OVER_START_FAILED_TEXT =
  "Couldn't start the new chat. Try again.";

/** Notice when an indeterminate launch was released after the deadline. */
export const CARRY_OVER_EXPIRED_TEXT = "The new chat didn't start. Try again.";

/** The one-line notice shown after the new chat is bound (AC 4.3, 8.4). */
export function carryOverNotice(providerName: string): string {
  return (
    `Continued with ${providerName} in a new chat from a summary of this ` +
    `conversation. The original conversation is unchanged. This ` +
    `conversation's text was sent to ${providerName}.`
  );
}

/** An eligible carry-over offer, bound to one banner generation (AC 7.1). */
export interface CarryOverOffer {
  readonly generation: number;
  readonly sessionId: SessionId;
  readonly tabId: string;
  readonly workspacePath: string;
  readonly providerId: string;
  readonly providerName: string;
}

/** The chat a `/compact` carry-over is asked for. */
export interface CarryOverCompactOrigin {
  readonly sessionId: SessionId;
  readonly tabId: string;
  readonly workspacePath: string;
  readonly name?: string;
}

/** Result of a launch, shaped like `SendOutcome`. */
export interface CarryOverLaunchOutcome {
  readonly success: boolean;
  readonly error?: string;
  readonly errorAlreadyShown?: boolean;
}

/**
 * Result of a `/compact` trigger:
 * - `'not-eligible'`: run today's `/compact` (`chat:continue`) unchanged;
 * - `'check-failed'`: the eligibility check errored or timed out. The caller
 *   runs today's path, except where it knows the session's provider differs
 *   from the active one (decisions.md row 38, P4 = A);
 * - `'busy'`: a carry-over already holds this tab or session;
 * - otherwise the launch outcome.
 */
export type CarryOverCompactResult =
  'not-eligible' | 'check-failed' | 'busy' | CarryOverLaunchOutcome;

/** Result of `claimSessionResolution`. */
export type CarryOverClaim = 'none' | 'bind' | 'skip';

export interface PendingCarryOver {
  readonly sessionId: SessionId;
  /** Banner generation this launch owns, or null when no banner owns it. */
  readonly generation: number | null;
  readonly origin: AuthRequiredBannerOrigin;
  readonly bannerProviderId: string | null;
  readonly providerName: string;
  readonly trigger: 'button' | 'compact';
  /** True once the host accepted the start; the entry waits for the bind. */
  readonly rpcSettled: boolean;
}

/** An indeterminate launch released after `CARRY_OVER_RECOVERY_MS`. */
export interface ExpiredCarryOver {
  readonly sessionId: SessionId;
  /** `Date.now()` after which a resolution is no longer attributed to it. */
  readonly until: number;
}

/**
 * What the lazily loaded launch path reads and writes. Built once by the
 * service; the launch module gets no other handle on its state.
 */
export interface CarryOverLaunchContext {
  readonly rpc: ClaudeRpcService;
  readonly vscode: VSCodeService;
  readonly authState: AuthStateService;
  readonly tabs: TabManagerService;
  readonly actionBanner: ActionBannerService;
  readonly offer: WritableSignal<CarryOverOffer | null>;
  readonly pending: Signal<ReadonlyMap<string, PendingCarryOver>>;
  readonly recoveryTimers: Map<string, ReturnType<typeof setTimeout>>;
  readonly expired: Map<string, ExpiredCarryOver>;
  isPending(tabId: string): boolean;
  isBusy(sessionId: string): boolean;
  setPending(tabId: string, entry: PendingCarryOver): void;
  deletePending(tabId: string, entry: PendingCarryOver): void;
  clearOffer(generation: number): void;
  clearRecoveryTimer(tabId: string): void;
}

type LaunchModule = typeof import('./provider-carry-over-launch');

/** The launch module once loaded; shared by every service instance. */
let launchModule: LaunchModule | undefined;
let launchLoading: Promise<LaunchModule> | undefined;

/**
 * Load the launch module once. A failed load is not cached, so the next
 * trigger retries it.
 */
function loadLaunchModule(): Promise<LaunchModule> {
  launchLoading ??= import('./provider-carry-over-launch').then(
    (module) => (launchModule = module),
    (error: unknown) => {
      launchLoading = undefined;
      throw error;
    },
  );
  return launchLoading;
}

@Injectable({ providedIn: 'root' })
export class ProviderCarryOverService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly authState = inject(AuthStateService);
  private readonly tabs = inject(TabManagerService);
  private readonly actionBanner = inject(ActionBannerService);

  private readonly _offer = signal<CarryOverOffer | null>(null);
  private readonly _pending = signal<ReadonlyMap<string, PendingCarryOver>>(
    new Map(),
  );
  /** Recovery deadline of a tab's indeterminate launch (Finding 2). */
  private readonly recoveryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Per tab: the last expired launch, until its late-resolution window ends. */
  private readonly expired = new Map<string, ExpiredCarryOver>();

  private readonly launchContext: CarryOverLaunchContext = {
    rpc: this.rpc,
    vscode: this.vscode,
    authState: this.authState,
    tabs: this.tabs,
    actionBanner: this.actionBanner,
    offer: this._offer,
    pending: this._pending,
    recoveryTimers: this.recoveryTimers,
    expired: this.expired,
    isPending: (tabId) => this.isPending(tabId),
    isBusy: (sessionId) => this.isBusy(sessionId),
    setPending: (tabId, entry) => this.setPending(tabId, entry),
    deletePending: (tabId, entry) => this.deletePending(tabId, entry),
    clearOffer: (generation) => this.clearOffer(generation),
    clearRecoveryTimer: (tabId) => this.clearRecoveryTimer(tabId),
  };

  /**
   * The current offer, shown only while its banner generation is the one on
   * screen. A cleared or replaced banner hides it for good: generations only
   * grow, so an old offer never matches again.
   */
  readonly offer = computed<CarryOverOffer | null>(() => {
    const offer = this._offer();
    if (!offer) return null;
    return this.authState.authRequiredBanner()?.generation === offer.generation
      ? offer
      : null;
  });

  /** Whether a carry-over holds this tab (sends and launches are refused). */
  isPending(tabId: string): boolean {
    return this._pending().has(tabId);
  }

  /** Whether a carry-over for this session is in flight in any tab. */
  isBusy(sessionId: string): boolean {
    for (const entry of this._pending().values()) {
      if (entry.sessionId === sessionId) return true;
    }
    return false;
  }

  /**
   * Ask the host whether the refusal of banner `generation` can be carried
   * over, and publish the offer when it can and the banner is unchanged.
   */
  async offerFor(generation: number): Promise<void> {
    const launch = launchModule ?? (await loadLaunchModule());
    return launch.offerFor(this.launchContext, generation);
  }

  /**
   * Button trigger: re-check the offer at click time, then launch (AC 7.2).
   * A failed load of the launch path leaves the offer in place for a retry.
   */
  async start(offer: CarryOverOffer): Promise<void> {
    let launch = launchModule;
    if (!launch) {
      try {
        launch = await loadLaunchModule();
      } catch (error) {
        // degradation-audit: reported — the click does nothing and the offer stays; the next click retries the load.
        console.warn('[ProviderCarryOver] launch path failed to load', {
          error: error instanceof Error ? error.name : typeof error,
        });
        return;
      }
    }
    return launch.start(this.launchContext, offer);
  }

  /**
   * `/compact` trigger, step 1: check eligibility with a 5 s cap, then start
   * the carry-over when the session is eligible.
   */
  async tryCompact(
    origin: CarryOverCompactOrigin,
  ): Promise<CarryOverCompactResult> {
    const launch = launchModule ?? (await loadLaunchModule());
    return launch.tryCompact(this.launchContext, origin);
  }

  /**
   * `/compact` trigger, step 2: launch for an eligible session. When the
   * banner shows this tab's own refusal, the launch owns that banner, so a
   * success clears it and its offer.
   */
  async startFromCompact(
    request: CarryOverCompactOrigin & {
      readonly providerId: string;
      readonly providerName: string;
    },
  ): Promise<CarryOverCompactResult> {
    const launch = launchModule ?? (await loadLaunchModule());
    return launch.startFromCompact(this.launchContext, request);
  }

  /**
   * Called on `SESSION_ID_RESOLVED` for `tabId` before any attach. Pure for
   * `'none'` and `'bind'`; `'skip'` drops the entry, and for a rebound tab
   * aborts the new session (AC 7.6, 7.7).
   */
  claimSessionResolution(tabId: string, realSessionId: string): CarryOverClaim {
    const entry = this._pending().get(tabId);
    if (!entry) return this.claimExpired(tabId, realSessionId);
    if (realSessionId === entry.sessionId) return 'none';
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (!lookup) {
      this.deletePending(tabId, entry);
      return 'skip';
    }
    if (lookup.tab.claudeSessionId !== entry.sessionId) {
      this.deletePending(tabId, entry);
      this.abortSession(realSessionId as SessionId);
      return 'skip';
    }
    return 'bind';
  }

  /**
   * Called after the tab was attached to the new session: show the notice,
   * clear the banner this launch owns, and release the tab. Idempotent.
   */
  completeBinding(tabId: string): void {
    const entry = this._pending().get(tabId);
    if (!entry) return;
    this.deletePending(tabId, entry);
    if (entry.generation !== null) {
      this.authState.clearAuthRequiredBanner(entry.generation);
      this.clearOffer(entry.generation);
    }
    this.actionBanner.showInfo(
      carryOverNotice(entry.providerName),
      tabId,
      CARRY_OVER_NOTICE_MS,
    );
  }

  /** A chat error for the tab ends any carry-over it holds. No notice. */
  onChatError(tabId: string): void {
    const entry = this._pending().get(tabId);
    if (entry) this.deletePending(tabId, entry);
  }

  /**
   * A resolution for a tab with no pending entry. Within the late window of
   * an expired launch, a new session id that the tab is not already bound to
   * is that launch's late result (or a duplicate of a retry that already
   * bound): skip it and abort it, once. Anything else is `'none'`.
   */
  private claimExpired(tabId: string, realSessionId: string): CarryOverClaim {
    const marker = this.expired.get(tabId);
    if (!marker) return 'none';
    if (Date.now() > marker.until) {
      this.expired.delete(tabId);
      return 'none';
    }
    if (realSessionId === marker.sessionId) return 'none';
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (lookup?.tab.claudeSessionId === realSessionId) return 'none';
    this.expired.delete(tabId);
    this.abortSession(realSessionId as SessionId);
    return 'skip';
  }

  private clearRecoveryTimer(tabId: string): void {
    const timer = this.recoveryTimers.get(tabId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.recoveryTimers.delete(tabId);
  }

  private clearOffer(generation: number): void {
    if (this._offer()?.generation === generation) this._offer.set(null);
  }

  private setPending(tabId: string, entry: PendingCarryOver): void {
    this._pending.update((pending) => new Map(pending).set(tabId, entry));
  }

  /** Delete only this entry, never a newer one for the same tab. */
  private deletePending(tabId: string, entry: PendingCarryOver): void {
    if (this._pending().get(tabId) !== entry) return;
    this.clearRecoveryTimer(tabId);
    this._pending.update((pending) => {
      const next = new Map(pending);
      next.delete(tabId);
      return next;
    });
  }

  private abortSession(sessionId: SessionId): void {
    const warn = (error: unknown): void => {
      console.warn(
        '[ProviderCarryOver] chat:abort failed for a skipped carry-over',
        {
          sessionId,
          error: error instanceof Error ? error.name : typeof error,
        },
      );
    };
    try {
      // degradation-audit: reported — `warn` logs a failed abort of a skipped carry-over session.
      this.rpc.call('chat:abort', { sessionId }).catch(warn);
    } catch (error) {
      warn(error);
    }
  }
}
