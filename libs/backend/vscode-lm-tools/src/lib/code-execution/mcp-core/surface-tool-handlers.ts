/**
 * Case bodies for `ptah_surface_update` and `ptah_surface_get_state`
 * (TASK_2026_538, plan Component 13).
 *
 * The dispatcher supplies the caller from trusted MCP request context and
 * turns the reply into a JSON-RPC response; this file only maps namespace
 * outcomes to agent-facing text. It never reads scope from the arguments:
 * they are forwarded untouched, and the namespace's strict validation rejects
 * any routing or session key an agent adds.
 */

import type {
  SurfaceCaller,
  SurfaceGetStateOutcome,
  SurfaceNamespace,
  SurfaceUpdateOutcome,
} from '../namespace-builders/surface-namespace.builder';
import type { DashboardDeliveryOutcome } from '../namespace-builders/dashboard-namespace.builder';
import {
  nonThrowingSurfaceLog,
  type SurfaceLog,
} from '../../surface/surface-log';
import {
  SURFACE_GET_STATE_TOOL_NAME,
  SURFACE_UPDATE_TOOL_NAME,
} from './surface-tools';

/** What the dispatcher needs to build a success or an `isError` result. */
export interface SurfaceToolReply {
  readonly isError: boolean;
  readonly text: string;
}

export type SurfaceToolName =
  typeof SURFACE_UPDATE_TOOL_NAME | typeof SURFACE_GET_STATE_TOOL_NAME;

function describeDelivery(delivery: DashboardDeliveryOutcome): string {
  switch (delivery.status) {
    case 'delivered':
      return `delivered to ${delivery.surfaces} attached surface(s)`;
    case 'no-surface':
      return 'no UI surface is attached, so this text is the whole answer';
    case 'failed':
      return `failed: ${delivery.delivered} of ${delivery.surfaces} attached surface(s) received it`;
  }
}

/** Map an update outcome; delivery-failed keeps the committed text. */
export function surfaceUpdateReply(
  outcome: SurfaceUpdateOutcome,
): SurfaceToolReply {
  switch (outcome.status) {
    case 'accepted':
      return {
        isError: false,
        text:
          `Surface ${outcome.surfaceId} committed at revision ${outcome.revision}; ` +
          `delivery ${describeDelivery(outcome.delivery)}.\n\n${outcome.text}`,
      };
    case 'delivery-failed':
      // The reason already states the committed revision and "do not resend";
      // the state text follows so the content is not lost over a transport fault.
      return { isError: true, text: `${outcome.reason}\n\n${outcome.text}` };
    case 'render-only':
      return { isError: false, text: outcome.text };
    case 'rejected':
    case 'unavailable':
      return { isError: true, text: outcome.reason };
  }
}

/** Map a read outcome; not-found is an answer, not a failure. */
export function surfaceGetStateReply(
  outcome: SurfaceGetStateOutcome,
): SurfaceToolReply {
  switch (outcome.status) {
    case 'found':
    case 'not-found':
      return { isError: false, text: outcome.text };
    case 'rejected':
    case 'unavailable':
      return { isError: true, text: outcome.reason };
  }
}

/**
 * Public text for an unexpected failure in the surface path (review F2). It
 * never carries the exception: raw detail goes only to the guarded log. An
 * update may already have committed, so the agent is told to read first.
 */
export const SURFACE_TOOL_UNEXPECTED_FAILURE =
  'The surface tool failed unexpectedly on the host. A write may or may not have been ' +
  `committed: read the current state with ${SURFACE_GET_STATE_TOOL_NAME} before any retry.`;

/** Route one surface tool call to its namespace method. */
export async function handleSurfaceToolCall(
  name: SurfaceToolName,
  args: unknown,
  surface: SurfaceNamespace,
  caller: SurfaceCaller,
  logger: SurfaceLog,
): Promise<SurfaceToolReply> {
  try {
    if (name === SURFACE_UPDATE_TOOL_NAME)
      return surfaceUpdateReply(await surface.update(args, caller));
    return surfaceGetStateReply(await surface.getState(args, caller));
  } catch (error: unknown) {
    nonThrowingSurfaceLog(logger).warn(
      `[Surface] ${name} failed unexpectedly`,
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { isError: true, text: SURFACE_TOOL_UNEXPECTED_FAILURE };
  }
}
