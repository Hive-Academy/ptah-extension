/**
 * SessionRegistry — restart identity spec (TASK_2026_466, defect 2).
 *
 * The incident: tab `03497c14-…` ran session `7d2539d1-…` (pid 2368), was
 * restarted into `16434295-…` (pid 17564), and the old SDK process was never
 * stopped. Both processes then held the same registry name, and hours later
 * the tab resolved back to the dead session.
 *
 * Three rules are pinned here, and the third is the interleaving the incident
 * actually took: the old process is STILL ALIVE when the new one registers.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { AISessionConfig } from '@ptah-extension/shared';

import { SessionRegistry } from './session-registry.service';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeConfig(): AISessionConfig {
  return { model: 'test-model', projectPath: '/tmp/test' } as AISessionConfig;
}

const TAB = '03497c14-1111-4111-8111-111111111111';
const OLD_SESSION = '7d2539d1-2222-4222-8222-222222222222';
const NEW_SESSION = '16434295-3333-4333-8333-333333333333';

describe('SessionRegistry — a tab restarted into a second process', () => {
  it('aborts the displaced record so the restart leaves no orphan process', () => {
    const registry = new SessionRegistry(makeLogger());
    const oldCtrl = new AbortController();
    const newCtrl = new AbortController();

    registry.register(TAB, makeConfig(), oldCtrl);
    registry.bindRealSessionId(TAB, OLD_SESSION);
    expect(oldCtrl.signal.aborted).toBe(false);

    registry.register(TAB, makeConfig(), newCtrl);

    // The abort controller is the only handle left on the displaced query, and
    // aborting it is what `endSession` itself relies on to stop the process.
    expect(oldCtrl.signal.aborted).toBe(true);
    expect(newCtrl.signal.aborted).toBe(false);
  });

  it('drops the displaced record from BOTH indexes', () => {
    const registry = new SessionRegistry(makeLogger());

    registry.register(TAB, makeConfig(), new AbortController());
    registry.bindRealSessionId(TAB, OLD_SESSION);
    const replacement = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
    );

    // The old real id resolved a record that no longer owned its tab.
    expect(registry.find(OLD_SESSION)).toBeUndefined();
    expect(registry.find(TAB)).toBe(replacement);
    expect(registry.getActiveSessionCount()).toBe(1);
  });

  it('lets the NEW process bind, because the fresh record starts unbound', () => {
    const registry = new SessionRegistry(makeLogger());

    registry.register(TAB, makeConfig(), new AbortController());
    registry.bindRealSessionId(TAB, OLD_SESSION);
    registry.register(TAB, makeConfig(), new AbortController());

    expect(registry.bindRealSessionId(TAB, NEW_SESSION)).toBe('bound');
    expect(registry.find(TAB)?.realSessionId).toBe(NEW_SESSION);
    expect(registry.find(NEW_SESSION)).toBe(registry.find(TAB));
  });

  it('refuses the displaced process that is STILL ALIVE and reports late', () => {
    // The interleaving from the incident: the old process outlives the
    // restart and emits its own init hours after the new one registered.
    const registry = new SessionRegistry(makeLogger());
    const oldRec = registry.register(TAB, makeConfig(), new AbortController());
    registry.bindRealSessionId(TAB, OLD_SESSION);
    registry.register(TAB, makeConfig(), new AbortController());
    registry.bindRealSessionId(TAB, NEW_SESSION);

    // Late report from the displaced process, carrying its OWN token.
    expect(registry.bindRealSessionId(TAB, OLD_SESSION, oldRec.token)).toBe(
      'stale-mismatch',
    );
    // Without a token either — a consumer that does not hold one.
    expect(registry.bindRealSessionId(TAB, OLD_SESSION)).toBe('stale-mismatch');

    expect(registry.find(TAB)?.realSessionId).toBe(NEW_SESSION);
    expect(registry.find(OLD_SESSION)).toBeUndefined();
  });

  it('follows the record OWN query onto a new id when it proves identity', () => {
    // A resume with `forkSession` registers under the resumed id and the SDK
    // answers with the forked one. That is the same record, so the binding
    // must move rather than be refused.
    const registry = new SessionRegistry(makeLogger());
    const rec = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
      OLD_SESSION,
    );

    expect(registry.bindRealSessionId(TAB, NEW_SESSION, rec.token)).toBe(
      'rebound',
    );
    expect(registry.find(TAB)?.realSessionId).toBe(NEW_SESSION);
    expect(registry.find(NEW_SESSION)).toBe(rec);
    expect(registry.find(OLD_SESSION)).toBeUndefined();
  });

  it('reports every other bind outcome distinctly', () => {
    const registry = new SessionRegistry(makeLogger());

    expect(registry.bindRealSessionId(TAB, '   ')).toBe('invalid');
    expect(registry.bindRealSessionId(TAB, NEW_SESSION)).toBe('no-record');

    registry.register(TAB, makeConfig(), new AbortController());
    expect(registry.bindRealSessionId(TAB, NEW_SESSION)).toBe('bound');
    expect(registry.bindRealSessionId(TAB, NEW_SESSION)).toBe('already-bound');
  });
  // -------------------------------------------------------------------
  // Review finding 1: a LATE cleanup of the displaced record must not
  // deregister the replacement. `remove` runs after asynchronous work —
  // a failed initialization in `SessionQueryExecutor`, or an awaited
  // interrupt in `SessionControl.endRecord` — and by then the tab key can
  // belong to someone else.
  // -------------------------------------------------------------------

  it('keeps the replacement discoverable when the DISPLACED record cleans up late', () => {
    const registry = new SessionRegistry(makeLogger());

    // A registers tab T and binds, then stalls inside its initialization.
    const displaced = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
    );
    registry.bindRealSessionId(TAB, OLD_SESSION);

    // B registers T, displaces A, and becomes the current record.
    const replacement = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
    );
    registry.bindRealSessionId(TAB, NEW_SESSION);

    // A now throws and its catch removes its own record.
    registry.remove(displaced);

    // B is still running, so both indexes must still resolve it.
    expect(registry.find(TAB)).toBe(replacement);
    expect(registry.find(NEW_SESSION)).toBe(replacement);
    expect(registry.getActiveSessionIds()).toEqual([NEW_SESSION]);
    // And a later bind against the tab still finds an owner.
    expect(registry.bindRealSessionId(TAB, NEW_SESSION)).toBe('already-bound');
  });

  it('leaves the replacement bySessionId entry alone when the displaced record shared the id', () => {
    // `endRecord(A)` awaits an interrupt while B registers under the same tab
    // and binds the SAME real session id. A's delayed removal must not take
    // B's `bySessionId` entry with it.
    const registry = new SessionRegistry(makeLogger());

    const displaced = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
    );
    registry.bindRealSessionId(TAB, OLD_SESSION);

    const replacement = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
    );
    registry.bindRealSessionId(TAB, OLD_SESSION);

    registry.remove(displaced);

    expect(registry.find(TAB)).toBe(replacement);
    expect(registry.find(OLD_SESSION)).toBe(replacement);
  });

  it('still removes a record that DOES own both keys', () => {
    const registry = new SessionRegistry(makeLogger());
    const rec = registry.register(TAB, makeConfig(), new AbortController());
    registry.bindRealSessionId(TAB, NEW_SESSION);

    registry.remove(rec);

    expect(registry.find(TAB)).toBeUndefined();
    expect(registry.find(NEW_SESSION)).toBeUndefined();
    expect(registry.getActiveSessionIds()).toEqual([]);
  });

  it('never writes the rebind token into a log line', () => {
    // The token is the proof `bindRealSessionId` accepts to MOVE a binding.
    // Anything that can read the log would otherwise hold that capability.
    const logger = makeLogger();
    const registry = new SessionRegistry(logger);

    const displaced = registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
    );
    registry.register(TAB, makeConfig(), new AbortController());

    const logged = (logger.warn as jest.Mock).mock.calls
      .flat()
      .map((entry) => String(entry))
      .join(' | ');
    expect(logged).toContain('Displacing the record');
    expect(logged).not.toContain(displaced.token);
  });
});
