/**
 * Dashboard Namespace Builder
 *
 * TASK_2026_493_9f58, deliverable 4. One method: validate a declarative
 * dashboard spec and push it to the surface. The agent emits JSON from the
 * fixed catalog in `@ptah-extension/shared/mcp-apps-contracts` and never writes
 * HTML.
 *
 * Pattern: `harness-namespace.builder.ts`'s `proposeConfig` — zod at the
 * boundary, then ONE dispatch of a validated payload. Three deliberate
 * differences from that precedent:
 *
 * 1. It returns an outcome object instead of throwing on rejection. The tool
 *    result has to carry the validation reason as plain text with
 *    `isError: true` and send NO push message (`context.md` "Transport
 *    contract"), and a discriminated result expresses "no broadcast happened"
 *    to the dispatcher in a way a thrown error cannot.
 * 2. It is the measurement point for the byte budget. `jsonUtf8Bytes` from
 *    `@ptah-extension/platform-core` is the byte check `context.md` requires,
 *    and this is the only place in this task that calls it: measured here,
 *    BEFORE the dispatch, on the value the agent actually sent.
 * 3. Delivery is OBSERVED, and a failed delivery is a third outcome — see
 *    `createDashboardBroadcast` for what went wrong when it was not.
 */

import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  DashboardSpecProposedPayload,
  MessagePayloadMap,
} from '@ptah-extension/shared';
import {
  DASHBOARD_LIMITS,
  describeDashboardLimits,
  renderDashboardSpecText,
  validateDashboardSpec,
} from '@ptah-extension/shared/mcp-apps-contracts';

/** Who made the tool call. Both fields go straight onto the push payload. */
export interface DashboardProposeSpecCaller {
  /** Absent for an anonymous MCP caller — see `mcp-request-context.ts`. */
  readonly sessionId?: string;
  /** The MCP request id of the `tools/call`. */
  readonly toolCallId: string;
}

/**
 * What happened when the validated spec was handed to the surfaces.
 *
 * `no-surface` is a SUCCESS and is not merged into `delivered`: a host with no
 * UI at all — the CLI, a headless MCP caller — is the deliberate text-fallback
 * path, not a failure. Keeping it a separate status means the difference stays
 * legible in a log and cannot be mistaken for a silent drop.
 */
export type DashboardDeliveryOutcome =
  | { readonly status: 'delivered'; readonly surfaces: number }
  | { readonly status: 'no-surface' }
  | {
      readonly status: 'failed';
      /** Surfaces that DID receive the whole payload. May be > 0. */
      readonly delivered: number;
      readonly surfaces: number;
      readonly reason: string;
    };

/** A bridge may refuse storage before attempting delivery of a validated spec. */
export type DashboardBroadcast = (
  type: typeof MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED,
  payload: DashboardSpecProposedPayload,
) => Promise<
  | DashboardDeliveryOutcome
  | { readonly status: 'refused'; readonly reason: string }
>;

/** The validated v1 and v2 messages supported by surface delivery. */
export type DashboardPushType =
  | typeof MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED
  | typeof MESSAGE_TYPES.SURFACE_UPDATED;

/**
 * The slice of `WebviewManager` the delivery needs. Structural, so the
 * namespace never imports a VS Code type and this file stays testable with a
 * two-method fake.
 */
export interface DashboardSurfaceHost {
  getActiveWebviews(): readonly string[];
  sendMessage<T extends DashboardPushType>(
    viewType: string,
    type: T,
    payload: MessagePayloadMap[T],
  ): Promise<boolean>;
}

/**
 * Build the observed delivery function (revision 1, finding 2).
 *
 * WHAT THIS REPLACES, and why it is not just an `await`. The first version
 * wired the namespace to `void webviewManager.broadcastMessage(type, payload)`.
 * Two defects in one line. `broadcastMessage` is `async` and builds its
 * per-view promise as `Promise.resolve(view.webview.postMessage(...)).catch(…)`
 * (`webview-manager.ts:304`), so a surface whose `postMessage` THROWS — a
 * sidebar being disposed — throws while that argument is evaluated, before the
 * `.catch` is attached; the rejection then surfaced on the promise that `void`
 * had just discarded. A reviewer replayed the real method against a throwing
 * surface and got `delivery failure outcome accepted` followed by
 * `UNHANDLED: disposed during postMessage`. So the caller was told the
 * dashboard had been emitted, and the rejection escaped the request's error
 * handler.
 *
 * Adding `await` would fix only that half. `broadcastMessage` deliberately
 * swallows and logs an ordinary REJECTED post promise (`:304-314`), so awaiting
 * it returns `undefined` just as happily when nothing was delivered. There is
 * no delivery signal on that method to await.
 *
 * `getActiveWebviews()` + `sendMessage()` is the public pair that does report
 * one: `sendMessage` returns `false` for a surface that is gone and catches a
 * throwing or rejecting `postMessage` itself (`:211-226`), so it yields a real
 * per-surface boolean and nothing escapes. A surface disposed between the
 * enumeration and the send reports `false` and is counted as not delivered —
 * conservative on purpose, because "the user may not have seen this" is the
 * answer that matters.
 */
export function createDashboardBroadcast(
  getHost: () => DashboardSurfaceHost | undefined,
  logger: { debug(msg: string): void },
): <T extends DashboardPushType>(
  type: T,
  payload: MessagePayloadMap[T],
) => Promise<DashboardDeliveryOutcome> {
  return async (type, payload) => {
    let host: DashboardSurfaceHost;
    let surfaces: readonly string[];
    try {
      const resolvedHost = getHost();
      if (!resolvedHost) {
        try {
          logger.debug(
            '[Dashboard] no webview host registered; the tool result is the whole answer here',
          );
        } catch (error: unknown) {
          void error; // Logging must not change the delivery classification.
        }
        return { status: 'no-surface' };
      }
      host = resolvedHost;
      surfaces = host.getActiveWebviews();
    } catch (error: unknown) {
      // Host lookup and enumeration can race disposal. Report the failure;
      // there is no known surface count and no send has been attempted.
      return {
        status: 'failed',
        delivered: 0,
        surfaces: 0,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (surfaces.length === 0) {
      return { status: 'no-surface' };
    }

    // Defer each send so both synchronous throws and rejected promises count
    // as non-delivery. Every surface is attempted, in push call order.
    const results = await Promise.all(
      surfaces.map((viewType) =>
        Promise.resolve()
          .then(() => host.sendMessage(viewType, type, payload))
          .then((ok) => ok === true, () => false),
      ),
    );
    const delivered = results.filter(Boolean).length;

    if (delivered === surfaces.length) {
      return { status: 'delivered', surfaces: surfaces.length };
    }

    return {
      status: 'failed',
      delivered,
      surfaces: surfaces.length,
      reason: `${surfaces.length - delivered} of ${surfaces.length} attached surface(s) did not accept the spec`,
    };
  };
}

/**
 * What the tool reports back.
 *
 * `accepted` carries the plain-text rendering so the CLI and VS Code hosts —
 * which have no dashboard page — get the dashboard itself rather than an
 * acknowledgement. `rejected` carries a plain-text reason and guarantees that
 * nothing was dispatched. `delivery-failed` is the third answer and is NOT a
 * success: the spec was valid and was dispatched, but at least one attached
 * surface did not take it. It still carries the text, because the caller should
 * not lose the content over a transport problem.
 */
export type DashboardProposeSpecOutcome =
  | {
      readonly status: 'accepted';
      readonly specId: string;
      readonly revision: number;
      readonly bytes: number;
      readonly text: string;
      readonly delivery: DashboardDeliveryOutcome;
    }
  | {
      readonly status: 'delivery-failed';
      readonly specId: string;
      readonly revision: number;
      readonly bytes: number;
      readonly text: string;
      readonly reason: string;
      readonly delivery: DashboardDeliveryOutcome;
    }
  | {
      readonly status: 'rejected';
      readonly reason: string;
    };

export interface DashboardNamespaceDependencies {
  /**
   * Pushes the validated spec to every attached surface and reports the
   * outcome. Typed to the one message this namespace may send, so it cannot
   * become a general-purpose broadcast channel (the harness precedent takes
   * `(string, unknown)`).
   */
  broadcast: DashboardBroadcast;
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
  };
}

/** Namespace shape exposed on `ptah.dashboard`. */
export interface DashboardNamespace {
  /**
   * Validate `spec` and, only if it is wholly valid, push it to the surface.
   *
   * Atomic and fail-closed: an unknown `schemaVersion`, an unknown
   * `catalogVersion`, an unknown component kind, a duplicate component id or
   * any breached budget rejects the WHOLE spec. There is no partial emit and
   * no best-effort render. Validation rejection happens strictly before any
   * dispatch, and is reported separately from a delivery failure — they are
   * different answers to the caller.
   */
  proposeSpec(
    spec: unknown,
    caller: DashboardProposeSpecCaller,
  ): Promise<DashboardProposeSpecOutcome>;
}

export function buildDashboardNamespace(
  deps: DashboardNamespaceDependencies,
): DashboardNamespace {
  const { broadcast, logger } = deps;

  return {
    async proposeSpec(
      spec: unknown,
      caller: DashboardProposeSpecCaller,
    ): Promise<DashboardProposeSpecOutcome> {
      // `validateDashboardSpec` is contractually non-throwing, so there is no
      // try/catch here that would blur validation failure into delivery
      // failure. See its `catch` and `findStructuralBreach`.
      const validation = validateDashboardSpec(spec, jsonUtf8Bytes);

      if (!validation.ok) {
        logger.warn(
          `[Dashboard] proposeSpec rejected (${validation.bytes ?? 'unmeasurable'} bytes): ${validation.reason}`,
        );
        return {
          status: 'rejected',
          reason:
            `Dashboard spec rejected: ${validation.reason} ` +
            `Limits: ${describeDashboardLimits()}. Nothing was sent to the UI.`,
        };
      }

      const { spec: validated, bytes } = validation;
      const text = renderDashboardSpecText(validated);
      const identity = `spec ${validated.specId} revision ${validated.revision}`;

      const delivery = await broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, {
        spec: validated,
        sessionId: caller.sessionId,
        toolCallId: caller.toolCallId,
      });

      if (delivery.status === 'refused') {
        return {
          status: 'rejected',
          reason: `Dashboard ${identity} was rejected and was not stored: ${delivery.reason}. Nothing was sent to the UI.`,
        };
      }

      if (delivery.status === 'failed') {
        logger.warn(
          `[Dashboard] proposeSpec validated ${identity} but delivery failed: ${delivery.reason}`,
        );
        return {
          status: 'delivery-failed',
          specId: validated.specId,
          revision: validated.revision,
          bytes,
          text,
          reason:
            `Dashboard ${identity} is valid but was NOT fully delivered to the UI: ` +
            `${delivery.reason}. ${delivery.delivered} surface(s) did receive it, so the ` +
            'user may be looking at this dashboard already — re-send rather than assuming ' +
            'nothing arrived. The dashboard follows as text.',
          delivery,
        };
      }

      logger.info(
        `[Dashboard] proposeSpec accepted ${identity} (${bytes}/${DASHBOARD_LIMITS.maxSpecBytes} bytes, ` +
          `delivery ${delivery.status})`,
      );

      return {
        status: 'accepted',
        specId: validated.specId,
        revision: validated.revision,
        bytes,
        text,
        delivery,
      };
    },
  };
}
