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
 * A launch the host accepted waits for its resolution only
 * `CARRY_OVER_RESOLUTION_DEADLINE_MS`, then expires the same way (R2).
 *
 * Each launch carries a request ID (`requestId`, a UUID) that the host
 * stamps on its tab's next `SESSION_ID_RESOLVED` as `carryOverRequestId`.
 * A tagged resolution binds only the pending launch with the same ID; one
 * from an expired or replaced launch is aborted (R1). The host's tag lapses
 * before this tab's release, and until the old launch is retired the host
 * refuses a retry on the tab (`IN_FLIGHT`, shown as a short notice). So an
 * untagged resolution never binds a pending launch: it is aborted as an
 * expired launch's late result. After the release, an untagged resolution
 * for a tab still on the refused session is the expired launch's and is
 * aborted; one for a tab that started a new chat binds as usual.
 *
 * The renderer never holds transcript text: the host reads and renders it.
 * The launch path (offer check, both triggers, the launch RPC) lives in
 * `provider-carry-over-launch.ts`, loaded with a dynamic `import()` on first
 * use so it stays out of the initial bundle; this file keeps the state and
 * the synchronous API sends and resolutions read.
 * Timers: one deadline timer per pending tab (the recovery deadline of an
 * indeterminate launch or the resolution deadline of an accepted one),
 * cleared whenever its entry leaves `pending` and on destroy; the notice's
 * `ActionBannerService` auto-clear.
 */
import {
  Injectable,
  computed,
  type OnDestroy,
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
  CARRY_OVER_LATE_RESOLUTION_MS,
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

/** Fixed text when the host answered the launch with an error envelope. */
export const CARRY_OVER_START_FAILED_TEXT =
  "Couldn't start the new chat. Try again.";

/** Notice when an indeterminate launch was released after the deadline. */
export const CARRY_OVER_EXPIRED_TEXT = "The new chat didn't start. Try again.";

/** Notice when the host refused the launch while an earlier one may start. */
export const CARRY_OVER_IN_FLIGHT_TEXT =
  'The previous new chat may still be starting. Try again in a moment.';

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
  /** UUID of this launch, sent as `requestId` and echoed on its resolution. */
  readonly requestId: string;
  readonly sessionId: SessionId;
  /** Banner generation this launch owns, or null when no banner owns it. */
  readonly generation: number | null;
  readonly origin: AuthRequiredBannerOrigin;
  readonly bannerProviderId: string | null;
  readonly providerName: string;
  readonly trigger: 'button' | 'compact';
  /**
   * True once the host accepted the start; the entry waits for the bind,
   * at most `CARRY_OVER_RESOLUTION_DEADLINE_MS`.
   */
  readonly rpcSettled: boolean;
}

/**
 * A launch released at its deadline without a resolution, keyed by its
 * request ID in `expired`.
 */
export interface ExpiredCarryOver {
  readonly tabId: string;
  readonly sessionId: SessionId;
  /**
   * `Date.now()` after which a resolution of the tab, tagged with the
   * launch's request ID or untagged, is no longer attributed to it.
   */
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
export class ProviderCarryOverService implements OnDestroy {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly authState = inject(AuthStateService);
  private readonly tabs = inject(TabManagerService);
  private readonly actionBanner = inject(ActionBannerService);

  private readonly _offer = signal<CarryOverOffer | null>(null);
  private readonly _pending = signal<ReadonlyMap<string, PendingCarryOver>>(
    new Map(),
  );
  /** Deadline of a tab's unresolved launch (Finding 2, R2). */
  private readonly recoveryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Expired launches by request ID, until their late windows end. */
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
   * aborts the new session (AC 7.6, 7.7). `requestId` is the resolution's
   * `carryOverRequestId`: when present, only the launch with that ID binds
   * (R1); when absent, the tab-based rules apply.
   */
  claimSessionResolution(
    tabId: string,
    realSessionId: string,
    requestId?: string,
  ): CarryOverClaim {
    const entry = this._pending().get(tabId);
    if (requestId !== undefined) {
      return this.claimTagged(tabId, realSessionId, requestId, entry);
    }
    if (!entry) return this.claimExpired(tabId, realSessionId);
    return this.claimUntaggedPending(tabId, realSessionId, entry);
  }

  /** Releases the deadline timers when the injector is destroyed. */
  ngOnDestroy(): void {
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
  }

  /**
   * An untagged resolution while a launch holds the tab. The launch is
   * tagged and the host stamps its resolution until after the tab's
   * release, so this is not it: an older launch's late result, or one the
   * host could not stamp. Never bind it; abort it, unless it is the old
   * session or the session the tab is already bound to. The pending launch
   * keeps waiting for its own resolution unless its tab is gone or rebound.
   */
  private claimUntaggedPending(
    tabId: string,
    realSessionId: string,
    entry: PendingCarryOver,
  ): CarryOverClaim {
    if (realSessionId === entry.sessionId) return 'none';
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (lookup?.tab.claudeSessionId === realSessionId) return 'none';
    if (!lookup || lookup.tab.claudeSessionId !== entry.sessionId) {
      this.deletePending(tabId, entry);
    }
    this.abortSession(realSessionId as SessionId);
    return 'skip';
  }

  /** Whether a carry-over binds `realSessionId` to `entry`'s tab. */
  private claimPending(
    tabId: string,
    realSessionId: string,
    entry: PendingCarryOver,
  ): CarryOverClaim {
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
   * A resolution the host tagged with a launch's request ID. The pending
   * launch with that ID claims it as usual. Otherwise it belongs to a launch
   * this tab no longer waits for: an expired one, or one replaced by the
   * pending retry. Skip and abort it, so it can neither bind the tab nor
   * complete the retry. With nothing pending and no live marker it is
   * `'none'`, as an untagged resolution would be.
   */
  private claimTagged(
    tabId: string,
    realSessionId: string,
    requestId: string,
    entry: PendingCarryOver | undefined,
  ): CarryOverClaim {
    if (entry?.requestId === requestId) {
      return this.claimPending(tabId, realSessionId, entry);
    }
    const marker = this.expired.get(requestId);
    if (marker) this.expired.delete(requestId);
    const expiredLaunch = marker !== undefined && Date.now() <= marker.until;
    if (!expiredLaunch && !entry) return 'none';
    // Never abort the session the tab is already bound to.
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (lookup?.tab.claudeSessionId === realSessionId) return 'none';
    this.abortSession(realSessionId as SessionId);
    return 'skip';
  }

  /**
   * An untagged resolution for a tab with no pending entry. Within the late
   * window of the tab's latest expired launch, a new session id is that
   * launch's late result (or a duplicate of a retry that already bound):
   * skip it and abort it, once. It is `'none'` when the tab is already bound
   * to it, or when the tab holds no session: a new chat started in the
   * released tab is waiting for exactly this resolution (Finding 2).
   */
  private claimExpired(tabId: string, realSessionId: string): CarryOverClaim {
    const now = Date.now();
    let latest: [string, ExpiredCarryOver] | undefined;
    for (const [requestId, marker] of this.expired) {
      if (marker.tabId === tabId && now <= marker.until) {
        latest = [requestId, marker];
      }
    }
    if (!latest) return 'none';
    const [requestId, marker] = latest;
    if (realSessionId === marker.sessionId) return 'none';
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (lookup?.tab.claudeSessionId === realSessionId) return 'none';
    if (lookup && !lookup.tab.claudeSessionId) return 'none';
    this.expired.delete(requestId);
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
