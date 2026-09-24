import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import type { SurfaceEnvelope } from '@ptah-extension/shared';
import {
  SurfaceGetStateInputSchema,
  describeSurfaceLimits,
  formatSurfaceIssues,
  renderSurfaceText,
  validateSurfaceUpdateInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceAgentReadResult,
  SurfaceStateService,
} from '../../surface';
import {
  nonThrowingSurfaceLog,
  type SurfaceLog,
} from '../../surface/surface-log';
import type { DashboardDeliveryOutcome } from './dashboard-namespace.builder';

/** Scope supplied by the dispatcher from trusted MCP request context. */
export interface SurfaceCaller {
  readonly sessionId?: string;
  readonly toolCallId: string;
}

type SurfaceFailure =
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string };

interface SurfaceCommittedOutcome {
  readonly surfaceId: string;
  readonly revision: number;
  readonly text: string;
  readonly delivery: DashboardDeliveryOutcome;
}

export type SurfaceUpdateOutcome =
  | (SurfaceCommittedOutcome & { readonly status: 'accepted' })
  | (SurfaceCommittedOutcome & {
      readonly status: 'delivery-failed';
      readonly reason: string;
    })
  | SurfaceFailure
  | { readonly status: 'render-only'; readonly text: string };

export type SurfaceGetStateOutcome =
  | Extract<SurfaceAgentReadResult, { status: 'found' | 'not-found' }>
  | SurfaceFailure;

export interface SurfaceNamespace {
  update(input: unknown, caller: SurfaceCaller): Promise<SurfaceUpdateOutcome>;
  getState(
    input: unknown,
    caller: SurfaceCaller,
  ): Promise<SurfaceGetStateOutcome>;
}

export interface SurfaceNamespaceDependencies {
  readonly service?: Pick<
    SurfaceStateService,
    'applyAgentUpdate' | 'describeForAgent'
  >;
  readonly logger: SurfaceLog;
}

/** An anonymous snapshot has no host revision and never enters the store. */
function renderAnonymous(surface: SurfaceEnvelope): string {
  const { dataModel = {}, ...structure } = surface;
  return (
    renderSurfaceText({
      surfaceId: surface.surfaceId,
      revision: 0,
      content: { contract: 'dashboard-spec/2', surface: structure, dataModel },
      selection: null,
      lastSubmit: null,
    }) +
    '\nno interactive surface is attached; this snapshot is not stored (revision 0 is uncommitted).'
  );
}

/** Validate before scope/availability checks; the facade owns all state and pushes. */
export function buildSurfaceNamespace(
  deps: SurfaceNamespaceDependencies,
): SurfaceNamespace {
  const { service } = deps;
  const logger = nonThrowingSurfaceLog(deps.logger);
  const unavailable = (): SurfaceFailure => ({
    status: 'unavailable',
    reason: 'surface state unavailable on this host',
  });
  const rejected = (reason: string): SurfaceFailure => {
    logger.warn(`[Surface] request rejected: ${reason}`);
    return { status: 'rejected', reason };
  };

  return {
    async update(input, caller) {
      // This helper performs the bounded walk BEFORE recursive schema parsing.
      const validation = validateSurfaceUpdateInput(input, jsonUtf8Bytes);
      if (!validation.ok)
        return rejected(
          `Surface update rejected: ${validation.reason} Limits: ${describeSurfaceLimits()}. Nothing was changed or pushed.`,
        );
      const validated = validation.input;
      if (!caller.sessionId) {
        if (
          validated.operation === 'create' ||
          validated.operation === 'replace'
        )
          return {
            status: 'render-only',
            text: renderAnonymous(validated.surface),
          };
        return {
          status: 'unavailable',
          reason: 'surface state unavailable for this caller',
        };
      }
      if (!service) return unavailable();

      const result = service.applyAgentUpdate(
        caller.sessionId,
        validated,
        caller.toolCallId,
      );
      if (result.status !== 'applied')
        return rejected(
          `${result.status === 'not-found' ? 'not-found' : result.reason}: ${result.detail}`,
        );
      const delivery = await result.delivery;
      const text =
        result.view === null
          ? `Deleted surface ${result.surfaceId} at revision ${result.revision}.`
          : renderSurfaceText(result.view);
      const committed = {
        surfaceId: result.surfaceId,
        revision: result.revision,
        text,
        delivery,
      };
      if (delivery.status === 'failed') {
        const retryReason = {
          create:
            'the surface was already created; read its current state before another update',
          replace: 'the same replacement would be stale',
          patch: 'the same patch would be stale',
          delete:
            'the surface was already deleted; a retry cannot repeat that deletion',
        }[validated.operation];
        const reason =
          `Surface ${result.surfaceId} committed revision ${result.revision}, but delivery failed: ${delivery.reason}. ` +
          `${delivery.delivered} of ${delivery.surfaces} attached surface(s) received it; do not resend; ${retryReason}.`;
        logger.warn(`[Surface] ${reason}`);
        return { status: 'delivery-failed', ...committed, reason };
      }
      logger.info(
        `[Surface] accepted ${result.surfaceId} revision ${result.revision}; delivery ${delivery.status}`,
      );
      return { status: 'accepted', ...committed };
    },

    async getState(input, caller) {
      // The read schema is flat and non-recursive; only updates carry trees.
      let validation: ReturnType<typeof SurfaceGetStateInputSchema.safeParse>;
      try {
        validation = SurfaceGetStateInputSchema.safeParse(input);
      } catch (error: unknown) {
        void error;
        return rejected(
          'Surface state request must be a readable JSON object.',
        );
      }
      if (!validation.success)
        return rejected(formatSurfaceIssues(validation.error.issues));
      if (!caller.sessionId)
        return {
          status: 'not-found',
          text: 'no surface state for this caller',
        };
      if (!service) return unavailable();
      const result = service.describeForAgent(
        caller.sessionId,
        validation.data,
      );
      if (result.status === 'rejected' || result.status === 'too-large')
        return rejected(result.text);
      return result;
    },
  };
}
