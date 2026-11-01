import { loggableErrorName } from '@ptah-extension/shared';

import type { LaneRoutingLogger } from '../lane-routing-logger';
import type {
  ModelDispatch,
  ModelRequestOutcome,
  SystemOneCaller,
} from '../pipeline/model-refine';
import { systemOneClientOptions } from '../pipeline/model-refine';
import type { OpenedCaller } from '../pipeline/phase-plan';
import { DECISION_REQUEST_TIMEOUT_MS } from '../routing-constants';
import type { DecisionModelConfig } from './decision-model.config';
import type { DecisionModelKind } from './decision-model.types';
import type { StructuredDecisionCompleter } from './structured-decision.port';
import {
  SystemOneClient,
  type SystemOneClientOptions,
} from './system-one.client';

export interface DecisionCallerDependencies {
  readonly config: DecisionModelConfig;
  readonly logger: LaneRoutingLogger;
  readonly structured?: StructuredDecisionCompleter;
  readonly seams?: {
    readonly systemOne?: (options: SystemOneClientOptions) => SystemOneCaller;
  };
}

/** Opens and dispatches one decision-model request for each routing caller. */
export class DecisionCaller {
  constructor(private readonly deps: DecisionCallerDependencies) {}

  async openCaller(): Promise<OpenedCaller> {
    const selection = this.deps.config.getSelection();
    if (selection.kind === 'unset') return { kind: 'unset' };
    if (selection.kind === 'structured') {
      if (this.deps.structured === undefined) {
        this.deps.logger.warn(
          '[lane-routing] structured decision port is not registered',
          { providerId: selection.providerId },
        );
        return { kind: 'blocked', cause: 'provider-error' };
      }
      return {
        kind: 'structured',
        providerId: selection.providerId,
        model: selection.model,
      };
    }
    try {
      // Resolve the target from the same selection used for a live 404 re-check.
      const target = await this.deps.config.resolveSystemOneTarget(selection);
      if (target === null) return { kind: 'blocked', cause: 'unreachable' };
      if (selection.kind === 'jev' && target.apiKey === undefined) {
        return { kind: 'blocked', cause: 'auth' };
      }
      return {
        kind: 'system-one',
        selection,
        target,
        provider: systemOneProvider(selection.kind),
      };
    } catch (error: unknown) {
      this.deps.logger.warn(
        '[lane-routing] decision model target could not be resolved',
        { name: loggableErrorName(error) },
      );
      return { kind: 'blocked', cause: 'unreachable' };
    }
  }

  dispatchFor(caller: OpenedCaller): ModelDispatch {
    if (caller.kind === 'structured') {
      const structured = this.deps.structured;
      if (structured === undefined) {
        throw new Error('structured decision port is not registered');
      }
      return {
        kind: 'structured',
        completer: structured,
        providerId: caller.providerId,
        model: caller.model,
        signal: AbortSignal.timeout(DECISION_REQUEST_TIMEOUT_MS),
      };
    }
    if (caller.kind !== 'system-one') {
      throw new Error('decision model dispatch requires a caller');
    }
    const options = systemOneClientOptions(caller.target);
    const factory =
      this.deps.seams?.systemOne ??
      ((next: SystemOneClientOptions) =>
        new SystemOneClient(next, { logger: this.deps.logger }));
    return {
      kind: 'system-one',
      caller: factory(options),
      model: caller.target.model,
    };
  }

  /** Re-check live 404/405 results; only a failed probe can mark unsupported. */
  async noteLive(
    caller: OpenedCaller,
    outcome: ModelRequestOutcome,
  ): Promise<void> {
    if (caller.kind !== 'system-one' || !outcome.sent) return;
    if (outcome.notFoundDetail !== null) {
      await this.deps.config.recheckAfterLiveNotFound(
        { selection: caller.selection, baseUrl: caller.target.baseUrl },
        outcome.notFoundDetail,
      );
      return;
    }
    if (outcome.succeeded) this.deps.config.recordLiveSuccess();
  }
}

function systemOneProvider(
  kind: Exclude<DecisionModelKind, 'unset' | 'structured'>,
): 'ollama' | 'jev' {
  switch (kind) {
    case 'jev':
      return 'jev';
    case 'ollama':
    case 'ollama-cloud':
    case 'custom':
      return 'ollama';
  }
}
