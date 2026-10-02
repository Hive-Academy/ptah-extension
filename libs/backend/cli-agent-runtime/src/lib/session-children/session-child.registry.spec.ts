/**
 * `SessionChildRegistry` — the in-memory parent → child link (TASK_2026_584).
 *
 * The property every test here defends: the concurrency cap cannot be
 * exceeded by two starts racing for the last slot, and a child is reachable
 * by every id the rest of the system knows it by.
 */
import 'reflect-metadata';

import { resolve } from 'path';

import {
  SESSION_CHILD_ENDED_HISTORY_SIZE,
  SessionChildRegistry,
  type SessionChildRecord,
} from './session-child.registry';

const PARENT = '11111111-2222-4333-8444-555555555555';
const PARENT_SDK = '99999999-2222-4333-8444-555555555555';

function record(
  childSessionId: string,
  overrides: Partial<SessionChildRecord> = {},
): SessionChildRecord {
  return {
    childSessionId,
    parentSessionId: PARENT,
    label: `child ${childSessionId}`,
    task: 'do the thing',
    branch: `feat/${childSessionId}`,
    baseRef: 'abc123',
    workspaceRoot: resolve('/ws'),
    worktreePath: resolve(`/ws-worktrees/${childSessionId}`),
    deliverables: [],
    subagentPtahTools: 'available',
    startedAt: '2026-10-01T10:00:00.000Z',
    turnsSettled: 0,
    reportsDelivered: 0,
    reportsRefused: 0,
    ...overrides,
  };
}

function addChild(
  registry: SessionChildRegistry,
  id: string,
  overrides: Partial<SessionChildRecord> = {},
): SessionChildRecord {
  const reservation = registry.reserveSlot(Number.MAX_SAFE_INTEGER);
  if (!reservation) throw new Error('no slot');
  return registry.add(record(id, overrides), reservation);
}

describe('SessionChildRegistry', () => {
  describe('slot reservation', () => {
    it('refuses the second of two racing reservations when the cap is 1', () => {
      const registry = new SessionChildRegistry();

      const first = registry.reserveSlot(1);
      const second = registry.reserveSlot(1);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('counts live children and outstanding reservations together', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a');

      expect(registry.reserveSlot(2)).not.toBeNull();
      expect(registry.reserveSlot(2)).toBeNull();
    });

    it('frees the slot when a reservation is released, and release is idempotent', () => {
      const registry = new SessionChildRegistry();
      const reservation = registry.reserveSlot(1);
      if (!reservation) throw new Error('expected a reservation');

      registry.release(reservation);
      registry.release(reservation);

      expect(registry.reserveSlot(1)).not.toBeNull();
      expect(registry.reserveSlot(1)).toBeNull();
    });

    it('consumes the reservation on add, so the slot is held by the child', () => {
      const registry = new SessionChildRegistry();
      const reservation = registry.reserveSlot(1);
      if (!reservation) throw new Error('expected a reservation');

      registry.add(record('a'), reservation);

      expect(registry.liveCount()).toBe(1);
      expect(registry.reserveSlot(1)).toBeNull();
      // A consumed reservation cannot be spent twice.
      expect(() => registry.add(record('b'), reservation)).toThrow(
        /not outstanding/,
      );
    });

    it('frees the slot when the child ends', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a');
      registry.markEnded('a', 'stopped', 'stopped-by-parent');

      expect(registry.liveCount()).toBe(0);
      expect(registry.reserveSlot(1)).not.toBeNull();
    });

    it('refuses a duplicate child id', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a');
      const reservation = registry.reserveSlot(5);
      if (!reservation) throw new Error('expected a reservation');

      expect(() => registry.add(record('a'), reservation)).toThrow(
        /already exists/,
      );
    });
  });

  describe('lookups', () => {
    it('finds a child by its tab id and, once bound, by its SDK id', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'tab-1');

      expect(registry.get('sdk-1')).toBeUndefined();
      registry.bindSdkSessionId('tab-1', 'sdk-1');

      expect(registry.get('tab-1')?.sdkSessionId).toBe('sdk-1');
      expect(registry.get('sdk-1')?.childSessionId).toBe('tab-1');
      expect(registry.get(' tab-1 ')?.childSessionId).toBe('tab-1');
      expect(registry.get(undefined)).toBeUndefined();
    });

    it('re-binding the SDK id drops the old index entry', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'tab-1', { sdkSessionId: 'sdk-old' });

      registry.bindSdkSessionId('tab-1', 'sdk-new');

      expect(registry.get('sdk-old')).toBeUndefined();
      expect(registry.get('sdk-new')?.childSessionId).toBe('tab-1');
    });

    it('finds a child by cwd regardless of trailing separators', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', { worktreePath: resolve('/ws-worktrees/a') });

      expect(
        registry.findByCwd(`${resolve('/ws-worktrees/a')}/`)?.childSessionId,
      ).toBe('a');
      expect(
        registry.findByCwd(resolve('/ws-worktrees/a/../a'))?.childSessionId,
      ).toBe('a');
      expect(registry.findByCwd(resolve('/ws-worktrees/b'))).toBeUndefined();
      expect(registry.findByCwd(undefined)).toBeUndefined();
    });

    it('strips a long run of mixed trailing separators, and only trailing ones', () => {
      const registry = new SessionChildRegistry();
      const worktree = resolve('/ws-worktrees/a');
      addChild(registry, 'a', { worktreePath: worktree });

      const started = Date.now();
      expect(
        registry.findByCwd(`${worktree}${'/\\'.repeat(20_000)}`)
          ?.childSessionId,
      ).toBe('a');
      // A separator run followed by another character is not trailing; the
      // old `[\\/]+$` regex backtracked quadratically on exactly this input.
      expect(
        registry.findByCwd(`${worktree}${'\\/'.repeat(20_000)}x`),
      ).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    if (process.platform === 'win32') {
      it('matches cwd case-insensitively on Windows', () => {
        const registry = new SessionChildRegistry();
        addChild(registry, 'a', { worktreePath: 'D:\\WS-Worktrees\\A' });

        expect(registry.findByCwd('d:\\ws-worktrees\\a')?.childSessionId).toBe(
          'a',
        );
      });
    }

    it('prefers a live child over an ended one in the same worktree path', () => {
      const registry = new SessionChildRegistry();
      const shared = resolve('/ws-worktrees/same');
      addChild(registry, 'old', { worktreePath: shared });
      registry.markEnded('old', 'ended', 'gone');
      addChild(registry, 'new', { worktreePath: shared });

      expect(registry.findByCwd(shared)?.childSessionId).toBe('new');
    });

    it('treats a live child as a child for the depth guard, by either id', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', { sdkSessionId: 'sdk-a' });

      expect(registry.isChild('a')).toBe(true);
      expect(registry.isChild('sdk-a')).toBe(true);
      expect(registry.isChild(PARENT)).toBe(false);
      expect(registry.isChild(undefined)).toBe(false);
    });

    it('still treats an ended child as a child for the depth guard (depth 1)', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', { sdkSessionId: 'sdk-a' });

      registry.markEnded('a', 'stopped', 'stopped-by-parent');

      expect(registry.isChild('a')).toBe(true);
      expect(registry.isChild('sdk-a')).toBe(true);
      expect(registry.live()).toHaveLength(0);
    });

    it('lists the children of a parent by tab id or SDK id', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', { parentSdkSessionId: PARENT_SDK });
      addChild(registry, 'b');
      addChild(registry, 'c', { parentSessionId: 'someone-else' });

      expect(
        registry.childrenOf([PARENT]).map((r) => r.childSessionId),
      ).toEqual(['a', 'b']);
      // A parent resumed in a new tab is known only by its SDK id.
      expect(
        registry
          .childrenOf(['new-tab', PARENT_SDK])
          .map((r) => r.childSessionId),
      ).toEqual(['a']);
      expect(registry.childrenOf([undefined, ''])).toEqual([]);
    });
  });

  describe('counters and updates', () => {
    it('counts delivered and refused reports and keeps the last refused summary', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a');

      registry.markReportDelivered('a');
      registry.markReportRefused('a', 'first');
      registry.markReportRefused('a', 'second');

      const child = registry.get('a');
      expect(child?.reportsDelivered).toBe(1);
      expect(child?.reportsRefused).toBe(2);
      expect(child?.lastRefusedReport).toBe('second');
      expect(registry.markReportDelivered('missing')).toBeUndefined();
    });

    it('replaces the record on update and clears a field set to undefined', () => {
      const registry = new SessionChildRegistry();
      const before = addChild(registry, 'a');

      registry.update('a', {
        pendingPermission: {
          toolName: 'Bash',
          description: 'curl',
          deniesAt: '2026-10-01T10:01:00.000Z',
        },
        turnsSettled: 2,
      });
      expect(registry.get('a')?.pendingPermission?.toolName).toBe('Bash');

      const after = registry.update('a', { pendingPermission: undefined });
      expect(after).toBeDefined();
      expect('pendingPermission' in (after as object)).toBe(false);
      expect(after?.turnsSettled).toBe(2);
      // The earlier reference is untouched.
      expect(before.turnsSettled).toBe(0);
    });

    it('keeps the SDK index consistent when update changes the SDK id', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', { sdkSessionId: 'sdk-1' });

      registry.update('a', { sdkSessionId: 'sdk-2' });

      expect(registry.get('sdk-1')).toBeUndefined();
      expect(registry.get('sdk-2')?.childSessionId).toBe('a');
    });

    it('marks a child ended once; the first status and reason win', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', {
        pendingPermission: {
          toolName: 'Bash',
          description: 'x',
          deniesAt: '2026-10-01T10:01:00.000Z',
        },
      });

      registry.markEnded('a', 'stopped', 'stopped-by-parent', 't1');
      registry.markEnded('a', 'ended', 'ended outside the spawner', 't2');

      const child = registry.get('a');
      expect(child?.terminalStatus).toBe('stopped');
      expect(child?.endReason).toBe('stopped-by-parent');
      expect(child?.endedAt).toBe('t1');
      expect(child?.pendingPermission).toBeUndefined();
    });

    it('removes a child entirely on rollback', () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'a', { sdkSessionId: 'sdk-a' });

      expect(registry.remove('a')).toBe(true);
      expect(registry.remove('a')).toBe(false);
      expect(registry.get('a')).toBeUndefined();
      expect(registry.get('sdk-a')).toBeUndefined();
      expect(registry.liveCount()).toBe(0);
    });
  });

  describe('pruning', () => {
    it(`keeps at most ${SESSION_CHILD_ENDED_HISTORY_SIZE} ended records and never prunes live ones`, () => {
      const registry = new SessionChildRegistry();
      addChild(registry, 'live');
      const total = SESSION_CHILD_ENDED_HISTORY_SIZE + 5;
      for (let i = 0; i < total; i++) {
        addChild(registry, `e${i}`, { sdkSessionId: `sdk-e${i}` });
        registry.markEnded(`e${i}`, 'ended', 'done');
      }

      expect(registry.get('live')).toBeDefined();
      // The five oldest are gone, together with their SDK index entries.
      for (let i = 0; i < 5; i++) {
        expect(registry.get(`e${i}`)).toBeUndefined();
        expect(registry.get(`sdk-e${i}`)).toBeUndefined();
      }
      expect(registry.get(`e${total - 1}`)).toBeDefined();
      expect(registry.childrenOf([PARENT])).toHaveLength(
        SESSION_CHILD_ENDED_HISTORY_SIZE + 1,
      );
      expect(registry.live().map((r) => r.childSessionId)).toEqual(['live']);
    });

    it(`pins the ended-history bound at 20; a pruned child is no longer known (attributed or depth-guarded)`, () => {
      expect(SESSION_CHILD_ENDED_HISTORY_SIZE).toBe(20);

      const registry = new SessionChildRegistry();
      for (let i = 0; i <= SESSION_CHILD_ENDED_HISTORY_SIZE; i++) {
        addChild(registry, `e${i}`);
        registry.markEnded(`e${i}`, 'ended', 'done');
      }

      // The 21st ended record pushed the oldest out of the history.
      expect(registry.isChild('e0')).toBe(false);
      expect(registry.get('e0')).toBeUndefined();
      expect(registry.isChild('e1')).toBe(true);
      expect(registry.childrenOf([PARENT])).toHaveLength(
        SESSION_CHILD_ENDED_HISTORY_SIZE,
      );
    });

    it('prunes to an explicit bound on demand', () => {
      const registry = new SessionChildRegistry();
      for (let i = 0; i < 3; i++) {
        addChild(registry, `e${i}`);
        registry.markEnded(`e${i}`, 'ended', 'done');
      }

      registry.pruneEnded(1);

      expect(registry.get('e0')).toBeUndefined();
      expect(registry.get('e1')).toBeUndefined();
      expect(registry.get('e2')).toBeDefined();
    });
  });
});
