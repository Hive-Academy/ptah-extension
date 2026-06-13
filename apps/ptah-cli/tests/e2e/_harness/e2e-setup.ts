/**
 * E2E setup (setupFilesAfterEnv) — CI-only flaky-test retry net.
 *
 * The harness ({@link ./cli-runner}) already retries the surgical case: a
 * spawned CLI that dies with a native fail-fast crash signature BEFORE emitting
 * any terminal JSON-RPC envelope. This file is the belt over those braces — a
 * jest-circus whole-test retry that covers any *other* transient the harness
 * can't see (e.g. a child that crashes mid-stream after a partial envelope, or
 * an OS-level resource blip on a loaded runner).
 *
 * Gated on `CI` so it NEVER masks a real regression during local development:
 * locally a flaky test still fails loudly. Each retry re-runs the spec's
 * `beforeEach`/`afterEach`, so every attempt gets a fresh isolated tmp home —
 * the tests are idempotent across retries.
 *
 * Requires the jest-circus runner (Jest 30 default) for `jest.retryTimes`.
 */

const CI_RETRY_ATTEMPTS = 2;

if (process.env['CI']) {
  jest.retryTimes(CI_RETRY_ATTEMPTS, { logErrorsBeforeRetry: true });
}
