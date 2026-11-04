/**
 * Launch path of the provider carry-over (TASK_2026_865), loaded on demand.
 *
 * `ProviderCarryOverService` keeps the state and the synchronous API every
 * chat send and session resolution reads; this module holds the offer check,
 * both triggers, the launch RPC and its failure mapping. The service imports
 * it with a dynamic `import()` the first time a refusal or `/compact` needs
 * it, so it stays out of the webview's initial bundle. Never import it
 * statically from eager code.
 */
import {
  CARRY_OVER_LATE_RESOLUTION_MS,
  CARRY_OVER_RESOLUTION_DEADLINE_MS,
  CHAT_ADMISSION_RPC_TIMEOUT_MS,
} from '@ptah-extension/shared';
import type { ChatCarryOverResult } from '@ptah-extension/shared';
import {
  CARRY_OVER_BUSY_TEXT,
  CARRY_OVER_CHECK_TIMEOUT_MS,
  CARRY_OVER_EXPIRED_TEXT,
  CARRY_OVER_IN_FLIGHT_TEXT,
  CARRY_OVER_NOTICE_MS,
  CARRY_OVER_RECOVERY_MS,
  CARRY_OVER_START_FAILED_TEXT,
  CARRY_OVER_UNREADABLE_TEXT,
  type CarryOverCompactOrigin,
  type CarryOverCompactResult,
  type CarryOverLaunchContext,
  type CarryOverLaunchOutcome,
  type CarryOverOffer,
  type PendingCarryOver,
} from './provider-carry-over.service';

/**
 * `ClaudeRpcService.call` reports its own give-up (timeout, abort) as a failed
 * result with these error prefixes; nothing else tells it from a host answer.
 */
const RENDERER_GIVE_UP_PREFIXES = ['RPC timeout', 'RPC aborted'] as const;

/**
 * Ask the host whether the refusal of banner `generation` can be carried
 * over, and publish the offer when it can and the banner is unchanged. The
 * decision uses the banner's origin only, never its message (AC 1.4).
 */
export async function offerFor(
  ctx: CarryOverLaunchContext,
  generation: number,
): Promise<void> {
  const banner = ctx.authState.authRequiredBanner();
  if (banner?.generation !== generation || !banner.origin) return;
  const { sessionId, tabId, workspacePath } = banner.origin;

  const result = await ctx.rpc.call('chat:carry-over-check', {
    sessionId,
    workspacePath,
  });
  if (!result.isSuccess() || !result.data.eligible) return;
  // A newer refusal or a dismissal during the check makes this one stale.
  if (ctx.authState.authRequiredBanner()?.generation !== generation) return;

  ctx.offer.set({
    generation,
    sessionId,
    tabId,
    workspacePath,
    providerId: result.data.providerId,
    providerName: result.data.providerName,
  });
}

/** Button trigger: re-check the offer at click time, then launch (AC 7.2). */
export async function start(
  ctx: CarryOverLaunchContext,
  offer: CarryOverOffer,
): Promise<void> {
  if (ctx.authState.authRequiredBanner()?.generation !== offer.generation) {
    ctx.clearOffer(offer.generation);
    return;
  }
  const lookup = ctx.tabs.findTabByIdAcrossWorkspaces(offer.tabId);
  if (!lookup) {
    // The refused tab is gone: drop the offer and its banner (AC 4.5).
    ctx.clearOffer(offer.generation);
    ctx.authState.clearAuthRequiredBanner(offer.generation);
    return;
  }
  if (lookup.tab.claudeSessionId !== offer.sessionId) {
    ctx.clearOffer(offer.generation);
    return;
  }
  pruneClosedTabs(ctx);
  // Already starting (double click, second view): keep the offer (AC 5.4).
  if (ctx.isPending(offer.tabId) || ctx.isBusy(offer.sessionId)) return;

  const entry: PendingCarryOver = {
    requestId: crypto.randomUUID(),
    sessionId: offer.sessionId,
    generation: offer.generation,
    origin: {
      sessionId: offer.sessionId,
      tabId: offer.tabId,
      workspacePath: offer.workspacePath,
    },
    bannerProviderId: ctx.authState.authRequiredBanner()?.providerId ?? null,
    providerName: offer.providerName,
    trigger: 'button',
    rpcSettled: false,
  };
  ctx.setPending(offer.tabId, entry);
  await launch(ctx, offer.tabId, entry, lookup.tab.name);
}

/**
 * `/compact` trigger, step 1: check eligibility with a 5 s cap, then start
 * the carry-over when the session is eligible.
 */
export async function tryCompact(
  ctx: CarryOverLaunchContext,
  origin: CarryOverCompactOrigin,
): Promise<CarryOverCompactResult> {
  let result;
  try {
    result = await ctx.rpc.call(
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
  return startFromCompact(ctx, {
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
export async function startFromCompact(
  ctx: CarryOverLaunchContext,
  request: CarryOverCompactOrigin & {
    readonly providerId: string;
    readonly providerName: string;
  },
): Promise<CarryOverCompactResult> {
  pruneClosedTabs(ctx);
  if (ctx.isPending(request.tabId) || ctx.isBusy(request.sessionId)) {
    return 'busy';
  }
  const banner = ctx.authState.authRequiredBanner();
  const ownsBanner =
    banner?.origin?.sessionId === request.sessionId &&
    banner.origin.tabId === request.tabId;
  const entry: PendingCarryOver = {
    requestId: crypto.randomUUID(),
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
  ctx.setPending(request.tabId, entry);
  return launch(ctx, request.tabId, entry, request.name);
}

async function launch(
  ctx: CarryOverLaunchContext,
  tabId: string,
  entry: PendingCarryOver,
  name: string | undefined,
): Promise<CarryOverCompactResult> {
  let result;
  try {
    result = await ctx.rpc.call(
      'chat:carry-over',
      {
        sessionId: entry.sessionId,
        tabId,
        workspacePath: entry.origin.workspacePath,
        ...(name ? { name } : {}),
        ...(ctx.vscode.isElectron ? { ptahUiFence: true } : {}),
        requestId: entry.requestId,
      },
      { timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS },
    );
  } catch {
    // degradation-audit: reported — an indeterminate launch: the tab stays busy until the recovery deadline, then a notice offers a retry.
    return indeterminate(ctx, tabId, entry);
  }
  if (!result.isSuccess()) {
    // The renderer giving up (or a success envelope without data) is not
    // definitive: the host may still start the session.
    if (result.success || isRendererGiveUp(result.error)) {
      return indeterminate(ctx, tabId, entry);
    }
    // The host answered with an error envelope: it refused the request
    // before any start (schema rejection or a handler throw).
    ctx.deletePending(tabId, entry);
    return mapFailure(ctx, tabId, entry, {
      success: false,
      reason: 'START_FAILED',
      error: CARRY_OVER_START_FAILED_TEXT,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    });
  }

  const data = result.data;
  if (data.success) {
    if (ctx.pending().get(tabId) === entry) {
      // The host started the session; its resolution should follow in
      // seconds. A lost one must not hold the tab forever (R2).
      const accepted: PendingCarryOver = { ...entry, rpcSettled: true };
      ctx.setPending(tabId, accepted);
      armDeadline(ctx, tabId, accepted, CARRY_OVER_RESOLUTION_DEADLINE_MS);
    }
    return { success: true };
  }

  ctx.deletePending(tabId, entry);
  return mapFailure(ctx, tabId, entry, data);
}

function mapFailure(
  ctx: CarryOverLaunchContext,
  tabId: string,
  entry: PendingCarryOver,
  failure: Extract<ChatCarryOverResult, { success: false }>,
): CarryOverCompactResult {
  const owns = ownsUi(ctx, tabId, entry);
  const compact = entry.trigger === 'compact';
  switch (failure.reason) {
    case 'NOT_ELIGIBLE':
      if (compact) return 'not-eligible';
      if (owns && entry.generation !== null) {
        ctx.clearOffer(entry.generation);
      }
      return { success: false, errorAlreadyShown: true };
    case 'IN_FLIGHT':
      // The host still holds an earlier launch of this tab (or session) that
      // may yet start. The offer stays; the button gets a short notice.
      if (!compact && owns) {
        ctx.actionBanner.showInfo(
          CARRY_OVER_IN_FLIGHT_TEXT,
          tabId,
          CARRY_OVER_NOTICE_MS,
        );
      }
      return { success: false, error: CARRY_OVER_BUSY_TEXT };
    case 'HISTORY_UNREADABLE':
      if (owns && entry.generation !== null) {
        ctx.authState.flagAuthRequired(
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
        ctx.authState.flagAuthRequired(providerId, failure.error, entry.origin);
        return { success: false, errorAlreadyShown: true };
      }
      // No banner owns the tab (compact only). Only an auth refusal of the
      // active provider becomes its banner, without an origin, so no offer
      // is made for the active provider's own refusal. Other failures are
      // the tab's send failure.
      if (owns && failure.errorCode === 'AUTH_REQUIRED') {
        ctx.authState.flagAuthRequired(providerId, failure.error);
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
function ownsUi(
  ctx: CarryOverLaunchContext,
  tabId: string,
  entry: PendingCarryOver,
): boolean {
  const lookup = ctx.tabs.findTabByIdAcrossWorkspaces(tabId);
  if (!lookup || lookup.tab.claudeSessionId !== entry.sessionId) {
    return false;
  }
  return (
    entry.generation === null ||
    ctx.authState.authRequiredBanner()?.generation === entry.generation
  );
}

function isRendererGiveUp(error: string | undefined): boolean {
  return RENDERER_GIVE_UP_PREFIXES.some(
    (prefix) => error?.startsWith(prefix) === true,
  );
}

/**
 * The host may or may not have started the session: keep the tab busy for
 * `CARRY_OVER_RECOVERY_MS` (a resolution or chat error ends it sooner),
 * then release it. The outcome is the busy text, as the tab is still held.
 */
function indeterminate(
  ctx: CarryOverLaunchContext,
  tabId: string,
  entry: PendingCarryOver,
): CarryOverLaunchOutcome {
  armDeadline(ctx, tabId, entry, CARRY_OVER_RECOVERY_MS);
  return { success: false, error: CARRY_OVER_BUSY_TEXT };
}

/**
 * Expire `entry` after `ms` unless it leaves `pending` first. One timer per
 * tab: `deletePending` clears it, and a newer deadline replaces it.
 */
function armDeadline(
  ctx: CarryOverLaunchContext,
  tabId: string,
  entry: PendingCarryOver,
  ms: number,
): void {
  if (ctx.pending().get(tabId) !== entry) return;
  ctx.clearRecoveryTimer(tabId);
  ctx.recoveryTimers.set(
    tabId,
    setTimeout(() => expire(ctx, tabId, entry), ms),
  );
}

/**
 * Release an unresolved launch at its deadline: the tab is free for a retry,
 * the offer stays, and the launch's request ID is marked expired so a
 * resolution it produces late is aborted, not bound.
 */
function expire(
  ctx: CarryOverLaunchContext,
  tabId: string,
  entry: PendingCarryOver,
): void {
  ctx.recoveryTimers.delete(tabId);
  if (ctx.pending().get(tabId) !== entry) return;
  ctx.deletePending(tabId, entry);
  ctx.expired.set(entry.requestId, {
    tabId,
    sessionId: entry.sessionId,
    until: Date.now() + CARRY_OVER_LATE_RESOLUTION_MS,
  });
  const lookup = ctx.tabs.findTabByIdAcrossWorkspaces(tabId);
  if (lookup?.tab.claudeSessionId === entry.sessionId) {
    ctx.actionBanner.showInfo(
      CARRY_OVER_EXPIRED_TEXT,
      tabId,
      CARRY_OVER_NOTICE_MS,
    );
  }
}

/**
 * Drop entries of tabs that no longer exist (an unresolved launch whose tab
 * was closed), so `pending` stays bounded by the open tabs and a closed
 * tab never keeps its session busy.
 */
function pruneClosedTabs(ctx: CarryOverLaunchContext): void {
  for (const [tabId, entry] of ctx.pending()) {
    if (!ctx.tabs.findTabByIdAcrossWorkspaces(tabId)) {
      ctx.deletePending(tabId, entry);
    }
  }
  const now = Date.now();
  for (const [requestId, marker] of ctx.expired) {
    if (
      now > marker.until ||
      !ctx.tabs.findTabByIdAcrossWorkspaces(marker.tabId)
    ) {
      ctx.expired.delete(requestId);
    }
  }
}
