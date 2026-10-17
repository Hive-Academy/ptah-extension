/**
 * Decision-model eval against Ollama Cloud (live).
 *
 * Proves, with a real key, that the decision model answers routing questions
 * correctly, stably and in time. It makes about 40 REAL calls per run, so it
 * is `describe.skip` unless `PTAH_LIVE_PROBES=1` AND `OLLAMA_API_KEY` is set.
 * The key is read from the environment only; it is never printed, and no
 * request header is ever printed.
 *
 * ```
 * PTAH_LIVE_PROBES=1 OLLAMA_API_KEY=<key> npx jest \
 *   -c libs/backend/lane-routing/jest.config.ts \
 *   libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts \
 *   --coverage=false --maxWorkers=2
 * ```
 *
 * `PTAH_LIVE_DECISION_MODEL` picks the model; otherwise `clef:27b-cloud` when
 * the catalog lists it, else the first catalog entry.
 */
import 'reflect-metadata';
import { toCloudId } from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DecisionModelCatalog } from './decision-model.catalog';
import { DecisionEndpointProber } from './decision-model.prober';
import { SystemOneClient } from './system-one.client';
import {
  LIVE_QUESTION_KEY,
  LIVE_ROUTING_FIXTURES,
  buildFixtureBody,
  type LiveRoutingFixture,
} from './system-one.live.fixtures';

const live =
  process.env['PTAH_LIVE_PROBES'] === '1' &&
  (process.env['OLLAMA_API_KEY'] ?? '').length > 0;
const describeLive = live ? describe : describe.skip;

const CLOUD_BASE_URL = 'https://ollama.com';
const DEFAULT_MODEL = 'clef:27b-cloud';
/** Generous, so latency is measured and never cut short by the product budget. */
const CLIENT_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const RUNS = 3;
const SUITE_TIMEOUT_MS = 15 * 60 * 1000;

const silentLogger: LaneRoutingLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Hosted form of a cloud id: `x:cloud` -> `x`, `x:tag-cloud` -> `x:tag`. */
function toHostedId(cloudId: string): string {
  if (cloudId.endsWith(':cloud')) return cloudId.slice(0, -':cloud'.length);
  if (cloudId.endsWith('-cloud')) return cloudId.slice(0, -'-cloud'.length);
  return cloudId;
}

/** Nearest-rank percentile of an ascending-sorted, non-empty list. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

describeLive('decision model on Ollama Cloud (live)', () => {
  const apiKey = process.env['OLLAMA_API_KEY'] ?? '';
  let model = process.env['PTAH_LIVE_DECISION_MODEL'] ?? '';
  let catalogModels: readonly string[] = [];
  let probeMs = 0;

  function client(
    overrides: { model?: string; apiKey?: string; timeoutMs?: number } = {},
  ): SystemOneClient {
    return new SystemOneClient({
      baseUrl: CLOUD_BASE_URL,
      model: overrides.model ?? model,
      apiKey: overrides.apiKey ?? apiKey,
      timeoutMs: overrides.timeoutMs ?? CLIENT_TIMEOUT_MS,
    });
  }

  function payloadOf(fixture: LiveRoutingFixture, forModel = model) {
    const body = buildFixtureBody(forModel, fixture);
    return { state: body.state, questions: body.questions };
  }

  beforeAll(async () => {
    const catalog = new DecisionModelCatalog(
      { ollamaBaseUrl: () => 'http://127.0.0.1:11434' },
      silentLogger,
    );
    const result = await catalog.list('ollama-cloud');
    catalogModels = result.models;
    if (model === '') {
      model = catalogModels.includes(DEFAULT_MODEL)
        ? DEFAULT_MODEL
        : (catalogModels[0] ?? DEFAULT_MODEL);
    }
  }, 60_000);

  it('lists the decision model in the cloud catalog (6.3)', () => {
    expect(catalogModels.length).toBeGreaterThan(0);
    expect(catalogModels).toContain(model);
  });

  it('accepts the id form the product sends (6.10, A1)', async () => {
    const fixture = LIVE_ROUTING_FIXTURES[0];
    const suffixed = toCloudId(model);
    const hosted = toHostedId(suffixed);
    const accepted: Record<string, boolean> = {};
    for (const id of [hosted, suffixed]) {
      const outcome = await client({ model: id }).decide(
        payloadOf(fixture, id),
      );
      accepted[id] = outcome.ok;
    }
    console.log(`DECISION_LIVE_MODEL_ID_FORMS ${JSON.stringify(accepted)}`);
    expect(accepted[suffixed]).toBe(true);
  }, SUITE_TIMEOUT_MS);

  it('probes ready with the key and auth with a bad key (A2)', async () => {
    const prober = new DecisionEndpointProber(silentLogger, {
      fetch,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const startedAt = performance.now();
    const ready = await prober.probe({
      mode: 'endpoint',
      baseUrl: CLOUD_BASE_URL,
      model,
      apiKey,
    });
    probeMs = Math.round(performance.now() - startedAt);
    expect(ready.outcome).toBe('ready');

    const bad = await prober.probe({
      mode: 'endpoint',
      baseUrl: CLOUD_BASE_URL,
      model,
      apiKey: 'invalid-live-probe-key',
    });
    expect(bad.outcome).toBe('auth');
  }, 60_000);

  it('answers every fixture correctly in every run, with valid confidence and probabilities (6.4, 6.5, 5.1, 6.6)', async () => {
    const wrong: string[] = [];
    const invalid: string[] = [];
    const durations: number[] = [];

    for (let run = 1; run <= RUNS; run += 1) {
      for (const fixture of LIVE_ROUTING_FIXTURES) {
        const where = `fixture "${fixture.id}" run ${run}`;
        const startedAt = performance.now();
        const outcome = await client().decide(payloadOf(fixture));
        durations.push(Math.round(performance.now() - startedAt));

        if (!outcome.ok) {
          wrong.push(`${where}: call failed (${outcome.cause}: ${outcome.detail})`);
          continue;
        }
        const answer = outcome.result.answers[LIVE_QUESTION_KEY];
        if (!answer) {
          wrong.push(`${where}: no answer for "${LIVE_QUESTION_KEY}"`);
          continue;
        }
        if (answer.choice !== fixture.expected) {
          wrong.push(
            `${where}: expected ${fixture.expected}, got ${answer.choice}`,
          );
        }
        const { confidence, probabilities } = answer;
        if (
          confidence === undefined ||
          !Number.isFinite(confidence) ||
          confidence < 0 ||
          confidence > 1
        ) {
          invalid.push(`${where}: confidence ${String(confidence)} not in [0,1]`);
        }
        if (probabilities === undefined) {
          invalid.push(`${where}: probabilities missing`);
        } else {
          const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
          if (Math.abs(sum - 1) > 0.01) {
            invalid.push(`${where}: probabilities sum to ${sum}`);
          }
        }
      }
    }

    const coldMs = durations[0];
    const warm = durations.slice(1).sort((a, b) => a - b);
    const latency = {
      coldMs,
      p50Ms: percentile(warm, 50),
      p95Ms: percentile(warm, 95),
      probeMs,
    };
    console.log(`DECISION_LIVE_LATENCY ${JSON.stringify(latency)}`);

    expect(wrong).toEqual([]);
    expect(invalid).toEqual([]);
  }, SUITE_TIMEOUT_MS);

  describe('error mapping (6.7)', () => {
    it('maps a bad key to cause auth', async () => {
      const outcome = await client({ apiKey: 'invalid-live-probe-key' }).decide(
        payloadOf(LIVE_ROUTING_FIXTURES[0]),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.cause).toBe('auth');
    }, 60_000);

    it('maps an unknown model to provider-error with notFound', async () => {
      const unknown = 'ptah-live-no-such-model:cloud';
      const outcome = await client({ model: unknown }).decide(
        payloadOf(LIVE_ROUTING_FIXTURES[0], unknown),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.cause).toBe('provider-error');
        expect(outcome.notFound).toBe(true);
      }
    }, 60_000);

    it('maps a 1 ms budget to cause timeout', async () => {
      const outcome = await client({ timeoutMs: 1 }).decide(
        payloadOf(LIVE_ROUTING_FIXTURES[0]),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.cause).toBe('timeout');
    }, 60_000);
  });
});
