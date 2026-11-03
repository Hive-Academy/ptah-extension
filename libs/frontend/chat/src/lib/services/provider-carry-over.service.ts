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
 * The renderer never holds transcript text: the host reads and renders it.
 * No timers besides the notice's `ActionBannerService` auto-clear.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AuthStateService,
  ClaudeRpcService,
  VSCodeService,
  type AuthRequiredBannerOrigin,
} from '@ptah-extension/core';
import {
  CHAT_ADMISSION_RPC_TIMEOUT_MS,
  type ChatCarryOverResult,
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
  | 'not-eligible'
  | 'check-failed'
  | 'busy'
  | CarryOverLaunchOutcome;

/** Result of `claimSessionResolution`. */
export type CarryOverClaim = 'none' | 'bind' | 'skip';

interface PendingCarryOver {
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
   * over, and publish the offer when it can and the banner is unchanged. The
   * decision uses the banner's origin only, never its message (AC 1.4).
   */
  async offerFor(generation: number): Promise<void> {
    const banner = this.authState.authRequiredBanner();
    if (banner?.generation !== generation || !banner.origin) return;
    const { sessionId, tabId, workspacePath } = banner.origin;

    const result = await this.rpc.call('chat:carry-over-check', {
      sessionId,
      workspacePath,
    });
    if (!result.isSuccess() || !result.data.eligible) return;
    // A newer refusal or a dismissal during the check makes this one stale.
    if (this.authState.authRequiredBanner()?.generation !== generation) return;

    this._offer.set({
      generation,
      sessionId,
      tabId,
      workspacePath,
      providerId: result.data.providerId,
      providerName: result.data.providerName,
    });
  }

  /** Button trigger: re-check the offer at click time, then launch (AC 7.2). */
  async start(offer: CarryOverOffer): Promise<void> {
    if (this.authState.authRequiredBanner()?.generation !== offer.generation) {
      this.clearOffer(offer.generation);
      return;
    }
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(offer.tabId);
    if (!lookup) {
      // The refused tab is gone: drop the offer and its banner (AC 4.5).
      this.clearOffer(offer.generation);
      this.authState.clearAuthRequiredBanner(offer.generation);
      return;
    }
    if (lookup.tab.claudeSessionId !== offer.sessionId) {
      this.clearOffer(offer.generation);
      return;
    }
    this.pruneClosedTabs();
    // Already starting (double click, second view): keep the offer (AC 5.4).
    if (this.isPending(offer.tabId) || this.isBusy(offer.sessionId)) return;

    const entry: PendingCarryOver = {
      sessionId: offer.sessionId,
      generation: offer.generation,
      origin: {
        sessionId: offer.sessionId,
        tabId: offer.tabId,
        workspacePath: offer.workspacePath,
      },
      bannerProviderId:
        this.authState.authRequiredBanner()?.providerId ?? null,
      providerName: offer.providerName,
      trigger: 'button',
      rpcSettled: false,
    };
    this.setPending(offer.tabId, entry);
    await this.launch(offer.tabId, entry, lookup.tab.name);
  }

  /**
   * `/compact` trigger, step 1: check eligibility with a 5 s cap, then start
   * the carry-over when the session is eligible.
   */
  async tryCompact(
    origin: CarryOverCompactOrigin,
  ): Promise<CarryOverCompactResult> {
    let result;
    try {
      result = await this.rpc.call(
        'chat:carry-over-check',
        { sessionId: origin.sessionId, workspacePath: origin.workspacePath },
        { timeout: CARRY_OVER_CHECK_TIMEOUT_MS },
      );
    } catch {
      // degradation-audit: reported — 'check-failed' is a distinct result; the caller fails closed or keeps today's /compact (P4 = A).
      return 'check-failed';
    }
    if (!result.isSuccess()) return 'check-failed';
    if (!result.data.eligible) return 'not-eligible';
    return this.startFromCompact({
      ...origin,
      providerId: result.data.providerId,
      providerName: result.data.providerName,
    });
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
    this.pruneClosedTabs();
    if (this.isPending(request.tabId) || this.isBusy(request.sessionId)) {
      return 'busy';
    }
    const banner = this.authState.authRequiredBanner();
    const ownsBanner =
      banner?.origin?.sessionId === request.sessionId &&
      banner.origin.tabId === request.tabId;
    const entry: PendingCarryOver = {
      sessionId: request.sessionId,
      generation: ownsBanner ? banner.generation : null,
      origin: {
        sessionId: request.sessionId,
        tabId: request.tabId,
        workspacePath: request.workspacePath,
      },
      bannerProviderId: ownsBanner ? banner.providerId : null,
      providerName: request.providerName,
      trigger: 'compact',
      rpcSettled: false,
    };
    this.setPending(request.tabId, entry);
    return this.launch(request.tabId, entry, request.name);
  }

  /**
   * Called on `SESSION_ID_RESOLVED` for `tabId` before any attach. Pure for
   * `'none'` and `'bind'`; `'skip'` drops the entry, and for a rebound tab
   * aborts the new session (AC 7.6, 7.7).
   */
  claimSessionResolution(
    tabId: string,
    realSessionId: string,
  ): CarryOverClaim {
    const entry = this._pending().get(tabId);
    if (!entry || realSessionId === entry.sessionId) return 'none';
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

  private async launch(
    tabId: string,
    entry: PendingCarryOver,
    name: string | undefined,
  ): Promise<CarryOverCompactResult> {
    let result;
    try {
      result = await this.rpc.call(
        'chat:carry-over',
        {
          sessionId: entry.sessionId,
          tabId,
          workspacePath: entry.origin.workspacePath,
          ...(name ? { name } : {}),
          ...(this.vscode.isElectron ? { ptahUiFence: true } : {}),
        },
        { timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS },
      );
    } catch {
      return this.transportFailure();
    }
    // A transport failure or timeout is not definitive: the host may still
    // start the session. The entry stays until the resolution, a chat error
    // for the tab, or the tab's removal.
    if (!result.isSuccess()) return this.transportFailure();

    const data = result.data;
    if (data.success) {
      const current = this._pending().get(tabId);
      if (current === entry) {
        this.setPending(tabId, { ...entry, rpcSettled: true });
      }
      return { success: true };
    }

    this.deletePending(tabId, entry);
    return this.mapFailure(tabId, entry, data);
  }

  private mapFailure(
    tabId: string,
    entry: PendingCarryOver,
    failure: Extract<ChatCarryOverResult, { success: false }>,
  ): CarryOverCompactResult {
    const owns = this.ownsUi(tabId, entry);
    const compact = entry.trigger === 'compact';
    switch (failure.reason) {
      case 'NOT_ELIGIBLE':
        if (compact) return 'not-eligible';
        if (owns && entry.generation !== null) {
          this.clearOffer(entry.generation);
        }
        return { success: false, errorAlreadyShown: true };
      case 'IN_FLIGHT':
        return { success: false, error: CARRY_OVER_BUSY_TEXT };
      case 'HISTORY_UNREADABLE':
        if (owns && entry.generation !== null) {
          this.authState.flagAuthRequired(
            entry.bannerProviderId,
            CARRY_OVER_UNREADABLE_TEXT,
            entry.origin,
          );
          return { success: false, errorAlreadyShown: true };
        }
        return { success: false, error: CARRY_OVER_UNREADABLE_TEXT };
      case 'START_FAILED': {
        const providerId = failure.providerId ?? entry.bannerProviderId;
        if (owns && entry.generation !== null) {
          this.authState.flagAuthRequired(
            providerId,
            failure.error,
            entry.origin,
          );
          return { success: false, errorAlreadyShown: true };
        }
        // No banner owns the tab (compact only). Only an auth refusal of the
        // active provider becomes its banner, without an origin, so no offer
        // is made for the active provider's own refusal. Other failures are
        // the tab's send failure.
        if (owns && failure.errorCode === 'AUTH_REQUIRED') {
          this.authState.flagAuthRequired(providerId, failure.error);
          return { success: false, errorAlreadyShown: true };
        }
        return { success: false, error: failure.error };
      }
    }
  }

  /**
   * A late result may change the UI only while the tab still exists and is
   * bound to the carried-over session and, when a banner owns the launch,
   * that banner is still the one showing (F2).
   */
  private ownsUi(tabId: string, entry: PendingCarryOver): boolean {
    const lookup = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (!lookup || lookup.tab.claudeSessionId !== entry.sessionId) {
      return false;
    }
    return (
      entry.generation === null ||
      this.authState.authRequiredBanner()?.generation === entry.generation
    );
  }

  private transportFailure(): CarryOverLaunchOutcome {
    return { success: false, error: CARRY_OVER_BUSY_TEXT };
  }

  /**
   * Drop entries of tabs that no longer exist (an unresolved launch whose tab
   * was closed), so `pending` stays bounded by the open tabs and a closed
   * tab never keeps its session busy.
   */
  private pruneClosedTabs(): void {
    for (const [tabId, entry] of this._pending()) {
      if (!this.tabs.findTabByIdAcrossWorkspaces(tabId)) {
        this.deletePending(tabId, entry);
      }
    }
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
    this._pending.update((pending) => {
      const next = new Map(pending);
      next.delete(tabId);
      return next;
    });
  }

  private abortSession(sessionId: SessionId): void {
    const warn = (error: unknown): void => {
      console.warn('[ProviderCarryOver] chat:abort failed for a skipped carry-over', {
        sessionId,
        error: error instanceof Error ? error.name : typeof error,
      });
    };
    try {
      // degradation-audit: reported — `warn` logs a failed abort of a skipped carry-over session.
      this.rpc.call('chat:abort', { sessionId }).catch(warn);
    } catch (error) {
      warn(error);
    }
  }
}
