import { TestBed } from '@angular/core/testing';
import { SessionId } from '@ptah-extension/shared';
import { ClaudeSessionId, ConversationId } from './identity/ids';
import { ConversationRegistry } from './conversation-registry.service';

function sid(): ClaudeSessionId {
  return SessionId.create() as ClaudeSessionId;
}

describe('ConversationRegistry — TASK_2026_106 Phase 1', () => {
  let registry: ConversationRegistry;

  beforeEach(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // ignore
    }
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ConversationRegistry);
  });

  describe('create()', () => {
    it('mints a fresh ConversationId and registers it', () => {
      const id = registry.create();
      expect(ConversationId.validate(id)).toBe(true);
      const record = registry.getRecord(id);
      expect(record).not.toBeNull();
      expect(record?.id).toBe(id);
      expect(record?.sessions).toEqual([]);
      expect(record?.compactionInFlight).toBe(false);
      expect(record?.lastCompactionAt).toBeNull();
    });

    it('seeds with an initial session when provided', () => {
      const s = sid();
      const id = registry.create(s);
      expect(registry.getRecord(id)?.sessions).toEqual([s]);
    });

    it('creates distinct conversations on every call', () => {
      const a = registry.create();
      const b = registry.create();
      expect(a).not.toBe(b);
      expect(registry.conversations()).toHaveLength(2);
    });
  });

  describe('appendSession()', () => {
    it('appends a session id at the head', () => {
      const s1 = sid();
      const s2 = sid();
      const id = registry.create(s1);
      registry.appendSession(id, s2);
      expect(registry.getRecord(id)?.sessions).toEqual([s1, s2]);
    });

    it('is idempotent when the session is already current head', () => {
      const s = sid();
      const id = registry.create(s);
      registry.appendSession(id, s);
      registry.appendSession(id, s);
      expect(registry.getRecord(id)?.sessions).toEqual([s]);
    });

    it('still allows re-appending an older session if a newer one is on top', () => {
      const a = sid();
      const b = sid();
      const id = registry.create(a);
      registry.appendSession(id, b);
      registry.appendSession(id, a);
      expect(registry.getRecord(id)?.sessions).toEqual([a, b, a]);
    });

    it('throws on unknown conversation id', () => {
      const orphan = ConversationId.create();
      expect(() => registry.appendSession(orphan, sid())).toThrow(
        /unknown conversation/,
      );
    });
  });

  describe('findByCurrentSession()', () => {
    it('returns the conversation whose head matches', () => {
      const s = sid();
      const id = registry.create(s);
      expect(registry.findByCurrentSession(s)?.id).toBe(id);
    });

    it('returns null when the session is in history but not head', () => {
      const a = sid();
      const b = sid();
      const id = registry.create(a);
      registry.appendSession(id, b);
      expect(registry.findByCurrentSession(a)).toBeNull();
      expect(registry.findByCurrentSession(b)?.id).toBe(id);
    });

    it('returns null when no conversation contains the session', () => {
      registry.create(sid());
      expect(registry.findByCurrentSession(sid())).toBeNull();
    });
  });

  describe('findContainingSession()', () => {
    it('returns the conversation that has the session anywhere in its history', () => {
      const a = sid();
      const b = sid();
      const id = registry.create(a);
      registry.appendSession(id, b);
      expect(registry.findContainingSession(a)?.id).toBe(id);
      expect(registry.findContainingSession(b)?.id).toBe(id);
    });

    it('returns null when no conversation contains it', () => {
      registry.create(sid());
      expect(registry.findContainingSession(sid())).toBeNull();
    });
  });

  describe('compaction lifecycle', () => {
    it('marks compaction in flight and records timestamp on complete', () => {
      const id = registry.create(sid());
      registry.markCompactionStart(id);
      expect(registry.getRecord(id)?.compactionInFlight).toBe(true);

      registry.markCompactionComplete(id);
      const after = registry.getRecord(id);
      expect(after?.compactionInFlight).toBe(false);
      expect(after?.lastCompactionAt).not.toBeNull();
      expect(typeof after?.lastCompactionAt).toBe('number');
    });

    it('throws on unknown conversation id', () => {
      const orphan = ConversationId.create();
      expect(() => registry.markCompactionStart(orphan)).toThrow();
      expect(() => registry.markCompactionComplete(orphan)).toThrow();
    });

    it('stamps the explicit timestamp when provided (edge-triggered PostCompact path)', () => {
      const id = registry.create(sid());
      registry.markCompactionStart(id);

      const explicit = 1_700_000_000_123;
      registry.markCompactionComplete(id, explicit);

      const state = registry.compactionStateFor(id);
      expect(state?.inFlight).toBe(false);
      expect(state?.lastCompactionAt).toBe(explicit);
    });

    it('falls back to Date.now() when no timestamp is provided (legacy path)', () => {
      const id = registry.create(sid());
      const before = Date.now();
      registry.markCompactionComplete(id);
      const after = Date.now();

      const state = registry.compactionStateFor(id);
      expect(state?.lastCompactionAt).not.toBeNull();
      const stamp = state?.lastCompactionAt as number;
      expect(stamp).toBeGreaterThanOrEqual(before);
      expect(stamp).toBeLessThanOrEqual(after);
    });

    it('throws on unknown conversation id even when a timestamp is supplied', () => {
      const orphan = ConversationId.create();
      expect(() => registry.markCompactionComplete(orphan, 123)).toThrow();
    });
  });

  // Compaction-on-conversation read API used by the chat view's
  // `resolvedIsCompacting` signal so every tab bound to a compacting
  // conversation sees the banner together.
  describe('compactionStateFor() (TASK_2026_106 Phase 4c)', () => {
    it('returns null for an unknown conversation id', () => {
      const orphan = ConversationId.create();
      expect(registry.compactionStateFor(orphan)).toBeNull();
    });

    it('reflects start and complete events on the conversation', () => {
      const id = registry.create(sid());
      // Initially false / null.
      const initial = registry.compactionStateFor(id);
      expect(initial?.inFlight).toBe(false);
      expect(initial?.lastCompactionAt).toBeNull();

      registry.markCompactionStart(id);
      const started = registry.compactionStateFor(id);
      expect(started?.inFlight).toBe(true);

      registry.markCompactionComplete(id);
      const completed = registry.compactionStateFor(id);
      expect(completed?.inFlight).toBe(false);
      expect(typeof completed?.lastCompactionAt).toBe('number');
    });
  });

  describe('compaction marker merge', () => {
    it('token-then-summary yields a fully-merged marker', () => {
      const id = registry.create(sid());
      registry.setCompactionMarkerTokens(id, {
        preTokens: 5000,
        postTokens: 1200,
        durationMs: 800,
        completedAt: 100,
      });
      registry.setCompactionMarkerSummary(id, {
        summary: 'recap',
        completedAt: 200,
      });
      const m = registry.compactionMarkerFor(id);
      expect(m).toEqual({
        summary: 'recap',
        preTokens: 5000,
        postTokens: 1200,
        durationMs: 800,
        completedAt: 200,
      });
    });

    it('summary-then-token yields a fully-merged marker', () => {
      const id = registry.create(sid());
      registry.setCompactionMarkerSummary(id, {
        summary: 'recap',
        completedAt: 200,
      });
      registry.setCompactionMarkerTokens(id, {
        preTokens: 5000,
        postTokens: 1200,
        durationMs: 800,
        completedAt: 100,
      });
      const m = registry.compactionMarkerFor(id);
      expect(m).toEqual({
        summary: 'recap',
        preTokens: 5000,
        postTokens: 1200,
        durationMs: 800,
        completedAt: 200,
      });
    });

    it('either-missing writer yields a partial marker', () => {
      const id = registry.create(sid());
      registry.setCompactionMarkerTokens(id, {
        preTokens: 5000,
        postTokens: 1200,
        durationMs: null,
        completedAt: 100,
      });
      const m = registry.compactionMarkerFor(id);
      expect(m?.summary).toBeNull();
      expect(m?.preTokens).toBe(5000);
      expect(m?.postTokens).toBe(1200);
      expect(m?.durationMs).toBeNull();
    });

    it('a later null never clobbers an already-set field', () => {
      const id = registry.create(sid());
      registry.setCompactionMarkerTokens(id, {
        preTokens: 5000,
        postTokens: 1200,
        durationMs: 800,
        completedAt: 100,
      });
      registry.setCompactionMarkerTokens(id, {
        preTokens: null,
        postTokens: null,
        durationMs: null,
        completedAt: 50,
      });
      const m = registry.compactionMarkerFor(id);
      expect(m?.preTokens).toBe(5000);
      expect(m?.postTokens).toBe(1200);
      expect(m?.durationMs).toBe(800);
      expect(m?.completedAt).toBe(100);
    });

    it('no-ops on unknown conversation id', () => {
      const orphan = ConversationId.create();
      expect(() =>
        registry.setCompactionMarkerTokens(orphan, {
          preTokens: 1,
          postTokens: 1,
          durationMs: 1,
          completedAt: 1,
        }),
      ).not.toThrow();
      expect(registry.compactionMarkerFor(orphan)).toBeNull();
    });

    it('persists to localStorage and lazily rehydrates when in-memory is null', () => {
      const id = registry.create(sid());
      registry.setCompactionMarkerSummary(id, {
        summary: 'persisted recap',
        completedAt: 300,
      });
      const raw = globalThis.localStorage.getItem(
        `ptah:compaction-marker:${id}`,
      );
      expect(raw).toBeTruthy();

      const fresh = registry.create();
      const key = `ptah:compaction-marker:${fresh}`;
      globalThis.localStorage.setItem(
        key,
        JSON.stringify({
          summary: 'from-disk',
          preTokens: 42,
          postTokens: 7,
          durationMs: null,
          completedAt: 900,
        }),
      );
      const rehydrated = registry.compactionMarkerFor(fresh);
      expect(rehydrated).toEqual({
        summary: 'from-disk',
        preTokens: 42,
        postTokens: 7,
        durationMs: null,
        completedAt: 900,
      });
    });

    it('merges across a localStorage round-trip when in-memory record is stale', () => {
      const id = registry.create(sid());
      const key = `ptah:compaction-marker:${id}`;
      globalThis.localStorage.setItem(
        key,
        JSON.stringify({
          summary: 'disk-summary',
          preTokens: null,
          postTokens: null,
          durationMs: null,
          completedAt: 10,
        }),
      );
      registry.setCompactionMarkerTokens(id, {
        preTokens: 999,
        postTokens: 100,
        durationMs: 50,
        completedAt: 20,
      });
      const m = registry.compactionMarkerFor(id);
      expect(m?.summary).toBe('disk-summary');
      expect(m?.preTokens).toBe(999);
      expect(m?.completedAt).toBe(20);
    });
  });

  describe('remove()', () => {
    it('drops the conversation from the registry', () => {
      const id = registry.create();
      registry.remove(id);
      expect(registry.getRecord(id)).toBeNull();
      expect(registry.conversations()).toHaveLength(0);
    });

    it('is a no-op on unknown id', () => {
      const orphan = ConversationId.create();
      expect(() => registry.remove(orphan)).not.toThrow();
    });
  });

  describe('snapshot immutability', () => {
    it('returned records cannot mutate the registry', () => {
      const s = sid();
      const id = registry.create(s);
      const snap = registry.getRecord(id);
      expect(snap).not.toBeNull();
      // sessions array is frozen
      expect(() => (snap?.sessions as ClaudeSessionId[]).push(sid())).toThrow();
      // mutation attempt did not affect the registry
      expect(registry.getRecord(id)?.sessions).toEqual([s]);
    });
  });

  describe('reactivity', () => {
    it('conversations signal updates on create and remove', () => {
      expect(registry.conversations()).toHaveLength(0);
      const id = registry.create();
      expect(registry.conversations()).toHaveLength(1);
      registry.remove(id);
      expect(registry.conversations()).toHaveLength(0);
    });
  });
});
