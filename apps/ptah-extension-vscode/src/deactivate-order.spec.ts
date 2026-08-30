/**
 * Regression guard: `deactivate()` must reap AGENTS before it stops their
 * translation PROXIES.
 *
 * A per-agent proxy exists to serve a live agent process. Stopping it first
 * leaves that process alive and talking to a closed socket, so it fails its way
 * out instead of being aborted — the opposite of the clean reap `deactivate()`
 * is there to perform. Electron has always torn down in this order; the
 * extension carried a comment saying "agents before proxies" directly above
 * code that did the reverse, which is how the wrong order survived review
 * (TASK_2026_326, regression from TASK_2026_323 B11).
 *
 * This is a static-analysis test, matching the precedent set by
 * `apps/ptah-cli/src/batch1-signal-handler.spec.ts`: importing `main.ts` boots
 * the `vscode` module and the whole phased DI graph, so the ordering is pinned
 * by reading the source rather than by executing it.
 *
 * Source-under-test: apps/ptah-extension-vscode/src/main.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const MAIN_TS_PATH = path.resolve(__dirname, 'main.ts');

const AGENT_DISPOSE = 'agentProcessManager.disposeAll()';
const PROXY_DISPOSE = 'ptahCliRegistry.disposeAll()';
const METADATA_FLUSH = 'flushSessionMetadataStores()';

describe('deactivate() teardown order', () => {
  let deactivateBody: string;

  beforeAll(() => {
    const source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
    const start = source.indexOf('export async function deactivate');
    expect(start).toBeGreaterThan(-1);
    deactivateBody = source.slice(start);
  });

  it('disposes the agent processes and the Ptah CLI proxies exactly once each', () => {
    expect(deactivateBody.split(AGENT_DISPOSE)).toHaveLength(2);
    expect(deactivateBody.split(PROXY_DISPOSE)).toHaveLength(2);
  });

  it('disposes agents BEFORE proxies', () => {
    const agentIndex = deactivateBody.indexOf(AGENT_DISPOSE);
    const proxyIndex = deactivateBody.indexOf(PROXY_DISPOSE);

    expect(agentIndex).toBeGreaterThan(-1);
    expect(proxyIndex).toBeGreaterThan(-1);
    expect(agentIndex).toBeLessThan(proxyIndex);
  });

  it('awaits the agent disposal — this host has a real budget to wait in', () => {
    // `deactivate()` is awaited by VS Code, so unlike Electron's synchronous
    // `will-quit` this host can genuinely wait for the reap rather than firing
    // it and hoping. A fire-and-forget here would let the container be cleared
    // out from under the release.
    expect(deactivateBody).toContain(`await ${AGENT_DISPOSE}`);
  });
});

/**
 * The session metadata store coalesces a burst of writes into one update at
 * the end of its queue drain, so a CLI agent that exits in the last seconds of
 * a session leaves its reference STAGED, not stored. Nothing used to drain it
 * on the way out and the reference was simply lost (TASK_2026_324 finding 3).
 *
 * The order is the other half of the fix: reaping an agent is what PRODUCES
 * the final `addCliSession` write, so a flush placed before the reap drains a
 * queue that is about to grow.
 */
describe('deactivate() session metadata flush', () => {
  let deactivateBody: string;

  beforeAll(() => {
    const source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
    const start = source.indexOf('export async function deactivate');
    expect(start).toBeGreaterThan(-1);
    deactivateBody = source.slice(start);
  });

  it('drains the coalesced write queue exactly once', () => {
    expect(deactivateBody.split(METADATA_FLUSH)).toHaveLength(2);
  });

  it('flushes AFTER the agents are reaped, not before', () => {
    expect(deactivateBody.indexOf(AGENT_DISPOSE)).toBeLessThan(
      deactivateBody.indexOf(METADATA_FLUSH),
    );
  });

  it('awaits the flush — a started write is not a stored one', () => {
    expect(deactivateBody).toContain(`await ${METADATA_FLUSH}`);
  });
});
