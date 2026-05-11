/**
 * SessionRegistry — unit spec (TASK_2026_118 Batch 8, Task 8.1).
 *
 * Covers all 8 cases from implementation-plan.md §6a:
 *
 * 1. register() inserts into byTabId only; find(tabId) returns record;
 *    find(fakeRealUUID) returns undefined.
 * 2. bindRealSessionId() adds bySessionId entry; find(realUUID) returns the
 *    SAME object reference as find(tabId) — identity equality, not deep eq.
 * 3. No-rekey invariant: after bindRealSessionId(), byTabId.size === 1 and
 *    bySessionId.size === 1; one record is reachable via two keys.
 * 4. remove() deletes from both indexes; subsequent find on both tabId and
 *    realId returns undefined.
 * 5. bindRealSessionId guard: second call on a record whose realSessionId is
 *    already set is a no-op; rec.realSessionId stays at the first value and no
 *    second bySessionId entry is created.
 * 6. getActiveSessionIds() returns [tabId] before bind, [realId] after bind;
 *    ordering puts _lastActiveTabId first when multiple sessions exist.
 * 7. _lastActiveTabId fallback: register two sessions, remove the most recent;
 *    find for the removed one returns undefined while the other remains intact.
 * 8. clearAll() empties byTabId, bySessionId, and resets _lastActiveTabId to null.
 *
 * The registry is a plain class (not injectable); tests instantiate it directly.
 * Logger is a stub satisfying the nominal Logger interface.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { AISessionConfig } from '@ptah-extension/shared';

import {
  SessionRegistry,
  type SessionRecord,
} from './session-registry.service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeConfig(overrides: Partial<AISessionConfig> = {}): AISessionConfig {
  return {
    model: 'test-model',
    projectPath: '/tmp/test',
    ...overrides,
  } as AISessionConfig;
}

function makeRegistry(): { registry: SessionRegistry; logger: Logger } {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);
  return { registry, logger };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SessionRegistry', () => {
  // -------------------------------------------------------------------------
  // Case 1: register() inserts into byTabId only
  // -------------------------------------------------------------------------

  describe('register()', () => {
    it('returns a SessionRecord with the correct tabId and realSessionId=null', () => {
      const { registry } = makeRegistry();
      const ctrl = new AbortController();

      const rec = registry.register('tab_1', makeConfig(), ctrl);

      expect(rec.tabId).toBe('tab_1');
      expect(rec.realSessionId).toBeNull();
      expect(rec.query).toBeNull();
      expect(rec.abortController).toBe(ctrl);
    });

    it('find(tabId) returns the registered record', () => {
      const { registry } = makeRegistry();
      const rec = registry.register(
        'tab_1',
        makeConfig(),
        new AbortController(),
      );

      const found = registry.find('tab_1');

      expect(found).toBe(rec);
    });

    it('find(fakeRealUUID) returns undefined when only tabId is registered', () => {
      const { registry } = makeRegistry();
      registry.register('tab_1', makeConfig(), new AbortController());

      const notFound = registry.find('some-real-uuid-that-was-never-bound');

      expect(notFound).toBeUndefined();
    });

    it('records currentModel from config.model', () => {
      const { registry } = makeRegistry();
      const rec = registry.register(
        'tab_model',
        makeConfig({ model: 'claude-opus-4' }),
        new AbortController(),
      );

      expect(rec.currentModel).toBe('claude-opus-4');
    });
  });

  // -------------------------------------------------------------------------
  // Case 2: bindRealSessionId() adds bySessionId entry with identity equality
  // -------------------------------------------------------------------------

  describe('bindRealSessionId()', () => {
    it('find(realUUID) returns the SAME object reference as find(tabId)', () => {
      const { registry } = makeRegistry();
      registry.register('tab_1', makeConfig(), new AbortController());

      registry.bindRealSessionId('tab_1', 'real-uuid-abc');

      const byTab = registry.find('tab_1');
      const byReal = registry.find('real-uuid-abc');

      expect(byTab).toBeDefined();
      expect(byReal).toBeDefined();
      // Object.is() / toBe both check reference identity
      expect(Object.is(byTab, byReal)).toBe(true);
      expect(byTab).toBe(byReal);
    });

    it('sets rec.realSessionId to the bound UUID', () => {
      const { registry } = makeRegistry();
      registry.register('tab_1', makeConfig(), new AbortController());

      registry.bindRealSessionId('tab_1', 'real-uuid-xyz');

      const rec = registry.find('tab_1') as SessionRecord;
      expect(rec.realSessionId).toBe('real-uuid-xyz');
    });

    it('mutation via one lookup is immediately visible via the other (shared object)', () => {
      const { registry } = makeRegistry();
      registry.register('tab_1', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_1', 'real-uuid-shared');

      // Mutate via tabId lookup
      const byTab = registry.find('tab_1') as SessionRecord;
      byTab.query = { fakeQuery: true } as unknown as SessionRecord['query'];

      // Visible via realSessionId lookup
      const byReal = registry.find('real-uuid-shared') as SessionRecord;
      expect(byReal.query).toBe(byTab.query);
    });
  });

  // -------------------------------------------------------------------------
  // Case 3: No-rekey invariant — ONE record, TWO index entries
  // -------------------------------------------------------------------------

  describe('no-rekey invariant', () => {
    it('after bindRealSessionId, only one record exists reachable via two keys', () => {
      const { registry } = makeRegistry();
      registry.register('tab_1', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_1', 'real-uuid-norekey');

      // Access the private maps via cast to verify sizes
      const r = registry as unknown as {
        byTabId: Map<string, SessionRecord>;
        bySessionId: Map<string, SessionRecord>;
      };

      expect(r.byTabId.size).toBe(1);
      expect(r.bySessionId.size).toBe(1);

      // Both map entries point at the identical object
      const tabRec = r.byTabId.get('tab_1');
      const realRec = r.bySessionId.get('real-uuid-norekey');
      expect(tabRec).toBe(realRec);
    });

    it('find(tabId) === find(realId) — the central design property', () => {
      const { registry } = makeRegistry();
      registry.register('tab_central', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_central', 'real-central');

      expect(registry.find('tab_central')).toBe(registry.find('real-central'));
    });
  });

  // -------------------------------------------------------------------------
  // Case 4: remove() deletes from both indexes
  // -------------------------------------------------------------------------

  describe('remove()', () => {
    it('after remove, find(tabId) returns undefined', () => {
      const { registry } = makeRegistry();
      registry.register('tab_rm', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_rm', 'real-rm');
      const rec = registry.find('tab_rm') as SessionRecord;

      registry.remove(rec);

      expect(registry.find('tab_rm')).toBeUndefined();
    });

    it('after remove, find(realId) returns undefined', () => {
      const { registry } = makeRegistry();
      registry.register('tab_rm2', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_rm2', 'real-rm2');
      const rec = registry.find('tab_rm2') as SessionRecord;

      registry.remove(rec);

      expect(registry.find('real-rm2')).toBeUndefined();
    });

    it('remove on a record with realSessionId=null does not throw', () => {
      const { registry } = makeRegistry();
      registry.register('tab_norealid', makeConfig(), new AbortController());
      const rec = registry.find('tab_norealid') as SessionRecord;

      expect(() => registry.remove(rec)).not.toThrow();
      expect(registry.find('tab_norealid')).toBeUndefined();
    });

    it('both byTabId and bySessionId are empty after removing the only record', () => {
      const { registry } = makeRegistry();
      registry.register('tab_only', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_only', 'real-only');
      const rec = registry.find('tab_only') as SessionRecord;

      registry.remove(rec);

      const r = registry as unknown as {
        byTabId: Map<string, SessionRecord>;
        bySessionId: Map<string, SessionRecord>;
      };
      expect(r.byTabId.size).toBe(0);
      expect(r.bySessionId.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Case 5: bindRealSessionId guard — second call is a no-op
  // -------------------------------------------------------------------------

  describe('bindRealSessionId guard (set-once invariant)', () => {
    it('second call does not overwrite rec.realSessionId', () => {
      const { registry, logger } = makeRegistry();
      registry.register('tab_guard', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_guard', 'first-real-uuid');

      // Second call — should be ignored
      registry.bindRealSessionId('tab_guard', 'second-real-uuid');

      const rec = registry.find('tab_guard') as SessionRecord;
      expect(rec.realSessionId).toBe('first-real-uuid');
    });

    it('second call does not create an extra bySessionId entry', () => {
      const { registry } = makeRegistry();
      registry.register('tab_guard2', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_guard2', 'first-real');
      registry.bindRealSessionId('tab_guard2', 'second-real');

      const r = registry as unknown as {
        bySessionId: Map<string, SessionRecord>;
      };
      // Only the first UUID should be in the index
      expect(r.bySessionId.has('first-real')).toBe(true);
      expect(r.bySessionId.has('second-real')).toBe(false);
      expect(r.bySessionId.size).toBe(1);
    });

    it('logs a warning on the second call', () => {
      const { registry, logger } = makeRegistry();
      registry.register('tab_warn', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_warn', 'real-first');
      registry.bindRealSessionId('tab_warn', 'real-second');

      expect((logger.warn as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('no-ops silently when tabId is not found', () => {
      const { registry, logger } = makeRegistry();

      expect(() =>
        registry.bindRealSessionId('nonexistent-tab', 'some-real'),
      ).not.toThrow();
      expect((logger.warn as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Case 6: getActiveSessionIds() ordering
  // -------------------------------------------------------------------------

  describe('getActiveSessionIds()', () => {
    it('returns [tabId] before bindRealSessionId', () => {
      const { registry } = makeRegistry();
      registry.register('tab_ids_1', makeConfig(), new AbortController());

      const ids = registry.getActiveSessionIds();

      expect(ids).toEqual(['tab_ids_1']);
    });

    it('returns [realId] after bindRealSessionId', () => {
      const { registry } = makeRegistry();
      registry.register('tab_ids_2', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_ids_2', 'real-ids-uuid');

      const ids = registry.getActiveSessionIds();

      expect(ids).toEqual(['real-ids-uuid']);
    });

    it('places _lastActiveTabId first when multiple sessions exist', () => {
      const { registry } = makeRegistry();
      // Register first then second — second becomes _lastActiveTabId
      registry.register('tab_a', makeConfig(), new AbortController());
      registry.register('tab_b', makeConfig(), new AbortController());

      // tab_b is _lastActiveTabId (registered last)
      const ids = registry.getActiveSessionIds();
      expect(ids[0]).toBe('tab_b');
      expect(ids).toContain('tab_a');
    });

    it('markActive updates ordering — last marked tab appears first', () => {
      const { registry } = makeRegistry();
      registry.register('tab_x', makeConfig(), new AbortController());
      registry.register('tab_y', makeConfig(), new AbortController());

      // Manually promote tab_x to most-recently-active
      registry.markActive('tab_x');

      const ids = registry.getActiveSessionIds();
      expect(ids[0]).toBe('tab_x');
    });

    it('returns empty array when no sessions are registered', () => {
      const { registry } = makeRegistry();
      expect(registry.getActiveSessionIds()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Case 7: _lastActiveTabId fallback after remove
  // -------------------------------------------------------------------------

  describe('_lastActiveTabId fallback after remove', () => {
    it('find for removed session returns undefined while other session remains intact', () => {
      const { registry } = makeRegistry();
      registry.register('tab_keep', makeConfig(), new AbortController());
      registry.register('tab_remove', makeConfig(), new AbortController());

      // tab_remove is _lastActiveTabId at this point
      const recToRemove = registry.find('tab_remove') as SessionRecord;
      registry.remove(recToRemove);

      expect(registry.find('tab_remove')).toBeUndefined();
      expect(registry.find('tab_keep')).toBeDefined();
    });

    it('_lastActiveTabId falls back to remaining session after removing the most-recent', () => {
      const { registry } = makeRegistry();
      registry.register('tab_older', makeConfig(), new AbortController());
      registry.register('tab_newer', makeConfig(), new AbortController());

      // tab_newer is _lastActiveTabId
      const rec = registry.find('tab_newer') as SessionRecord;
      registry.remove(rec);

      // After removal, _lastActiveTabId should fall back (tab_older remains)
      // Verify via getActiveSessionIds which uses _lastActiveTabId for ordering
      const ids = registry.getActiveSessionIds();
      expect(ids).toEqual(['tab_older']);
    });

    it('_lastActiveTabId becomes null when all sessions are removed', () => {
      const { registry } = makeRegistry();
      registry.register('tab_solo', makeConfig(), new AbortController());
      const rec = registry.find('tab_solo') as SessionRecord;

      registry.remove(rec);

      const r = registry as unknown as { _lastActiveTabId: string | null };
      expect(r._lastActiveTabId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Case 8: clearAll() empties all state
  // -------------------------------------------------------------------------

  describe('clearAll()', () => {
    it('empties byTabId and bySessionId and resets _lastActiveTabId to null', () => {
      const { registry } = makeRegistry();
      registry.register('tab_clear_1', makeConfig(), new AbortController());
      registry.register('tab_clear_2', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_clear_1', 'real-clear-1');

      registry.clearAll();

      const r = registry as unknown as {
        byTabId: Map<string, SessionRecord>;
        bySessionId: Map<string, SessionRecord>;
        _lastActiveTabId: string | null;
      };
      expect(r.byTabId.size).toBe(0);
      expect(r.bySessionId.size).toBe(0);
      expect(r._lastActiveTabId).toBeNull();
    });

    it('find() returns undefined for any key after clearAll()', () => {
      const { registry } = makeRegistry();
      registry.register('tab_gone', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_gone', 'real-gone');

      registry.clearAll();

      expect(registry.find('tab_gone')).toBeUndefined();
      expect(registry.find('real-gone')).toBeUndefined();
    });

    it('getActiveSessionIds() returns empty array after clearAll()', () => {
      const { registry } = makeRegistry();
      registry.register('tab_c1', makeConfig(), new AbortController());
      registry.register('tab_c2', makeConfig(), new AbortController());

      registry.clearAll();

      expect(registry.getActiveSessionIds()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Additional: entries() and getActiveSessionCount()
  // -------------------------------------------------------------------------

  describe('entries() and getActiveSessionCount()', () => {
    it('entries() iterates byTabId entries', () => {
      const { registry } = makeRegistry();
      registry.register('tab_e1', makeConfig(), new AbortController());
      registry.register('tab_e2', makeConfig(), new AbortController());

      const keys = Array.from(registry.entries()).map(([k]) => k);
      expect(new Set(keys)).toEqual(new Set(['tab_e1', 'tab_e2']));
    });

    it('getActiveSessionCount() reflects registered sessions', () => {
      const { registry } = makeRegistry();
      expect(registry.getActiveSessionCount()).toBe(0);

      registry.register('tab_cnt_1', makeConfig(), new AbortController());
      expect(registry.getActiveSessionCount()).toBe(1);

      registry.register('tab_cnt_2', makeConfig(), new AbortController());
      expect(registry.getActiveSessionCount()).toBe(2);

      const rec = registry.find('tab_cnt_1') as SessionRecord;
      registry.remove(rec);
      expect(registry.getActiveSessionCount()).toBe(1);
    });
  });
});
