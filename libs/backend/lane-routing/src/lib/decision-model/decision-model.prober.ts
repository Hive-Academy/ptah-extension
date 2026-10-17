/**
 * Readiness probe of a decision endpoint (Component 6, decision #42, DC14).
 *
 * Moved out of `DecisionModelConfig` with the daemon behaviour unchanged:
 * - `daemon`: `GET /api/version` (>= 0.35.0, 0.40.0 for `laya*`), then
 *   `POST {}` to `/v1/systemone` and to a control path no server serves.
 * - `endpoint`: the two POSTs only (no `/api/version`, criterion 3.1), each
 *   with `authorization: Bearer <key>` when the endpoint has a key.
 *
 * Every request shares one abort budget (1500 ms by default). The probe body
 * is always `{}`: no request text and no model id leave the host. A key is
 * never logged and never sent where the transport rule (D4) forbids it.
 * `probe` never rejects; a failed request becomes a fixed-text answer.
 */
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { keyTransportAllowed } from './decision-endpoint.url';
import { DECISION_MODEL_DETAIL, errorName } from './decision-model.detail';
import {
  buildProbeUrls,
  checkVersion,
  discriminate,
  type ProbeAnswer,
} from './decision-model.probe';
import type { DecisionEndpointProbe } from './decision-model.target';
import type { DecisionModelProbeResult } from './decision-model.types';
import type { SystemOneFetch } from './system-one.client';

/** The probe modes that make requests (`none` is never probed). */
export type DecisionProbeMode = Exclude<DecisionEndpointProbe, 'none'>;

export interface DecisionProbeRequest {
  readonly mode: DecisionProbeMode;
  /** Normalised base URL; probe URLs keep its path (DC11). */
  readonly baseUrl: string;
  /** Picks the daemon version floor; never sent. */
  readonly model: string;
  /** Endpoint mode only: the key bound to `baseUrl`. Ignored in daemon mode. */
  readonly apiKey?: string;
}

/** The config's constructor seams, passed through unchanged. */
export interface DecisionEndpointProberSeams {
  readonly fetch: SystemOneFetch;
  /** Shared budget of one probe (`DECISION_MODEL_PROBE_TIMEOUT_MS`). */
  readonly timeoutMs: number;
}

interface ProbeInit {
  readonly method: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export class DecisionEndpointProber {
  constructor(
    private readonly logger: LaneRoutingLogger,
    private readonly seams: DecisionEndpointProberSeams,
  ) {}

  /** Never rejects. */
  async probe(
    request: DecisionProbeRequest,
  ): Promise<DecisionModelProbeResult> {
    const urls = buildProbeUrls(request.baseUrl);
    if (!urls) {
      return {
        outcome: 'unreachable',
        detail: 'base url is not a valid absolute url',
      };
    }
    const apiKey =
      request.mode === 'endpoint' && request.apiKey
        ? request.apiKey
        : undefined;
    if (apiKey !== undefined && !keyTransportAllowed(urls.route)) {
      // The resolver blocks this case first; checked again so a key never
      // crosses plain http to another host (D4). No request is made.
      return this.logged({
        outcome: 'auth',
        detail: DECISION_MODEL_DETAIL.keyNeedsHttps,
      });
    }
    const signal = AbortSignal.timeout(this.seams.timeoutMs);

    if (request.mode === 'daemon') {
      const version = await this.send(urls.version, { method: 'GET' }, signal);
      const versionResult = checkVersion(version, request.model);
      if (versionResult) {
        return this.logged(versionResult);
      }
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (apiKey !== undefined) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
    const init: ProbeInit = { method: 'POST', headers, body: '{}' };
    const [route, control] = await Promise.all([
      this.send(urls.route, init, signal),
      this.send(urls.control, init, signal),
    ]);
    const result = discriminate(route, control);
    if (request.mode === 'endpoint' && result.outcome === 'auth') {
      return this.logged({
        outcome: 'auth',
        detail:
          apiKey === undefined
            ? DECISION_MODEL_DETAIL.keyRequired
            : DECISION_MODEL_DETAIL.keyRefused,
      });
    }
    return this.logged(result);
  }

  private async send(
    url: string,
    init: ProbeInit,
    signal: AbortSignal,
  ): Promise<ProbeAnswer> {
    try {
      const response = await this.seams.fetch(url, { ...init, signal });
      const body = await response.text();
      return { kind: 'answered', status: response.status, body };
    } catch (error: unknown) {
      // Classified by the abort signal, never by message (its only source is
      // the probe budget). The message is untrusted: a dependency can echo a
      // header, the key or a URL in it, so only the error name is logged
      // (`SystemOneClient.classifyTransportFailure`). The row detail is fixed
      // text and the request URL is not logged.
      const timedOut = signal.aborted;
      this.logger.warn('[lane-routing] decision model probe request failed', {
        method: init.method,
        timedOut,
        timeoutMs: this.seams.timeoutMs,
        errorName: errorName(error),
      });
      return {
        kind: 'failed',
        detail: timedOut
          ? DECISION_MODEL_DETAIL.timedOut
          : DECISION_MODEL_DETAIL.unreachable,
      };
    }
  }

  private logged(result: DecisionModelProbeResult): DecisionModelProbeResult {
    this.logger.debug('[lane-routing] decision model probe', {
      outcome: result.outcome,
      detail: result.detail,
    });
    return result;
  }
}
