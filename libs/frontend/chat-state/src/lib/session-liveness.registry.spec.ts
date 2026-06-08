/**
 * SessionLivenessRegistry — signal-backed liveness status map coverage.
 *
 * Exercises mark* setters, reactive status() lookup, clear removal,
 * identity-stable no-op on unchanged value, and empty-sessionId guard.
 */

import { TestBed } from '@angular/core/testing';
import { SessionLivenessRegistry } from './session-liveness.registry';

describe('SessionLivenessRegistry', () => {
  let svc: SessionLivenessRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SessionLivenessRegistry] });
    svc = TestBed.inject(SessionLivenessRegistry);
  });

  describe('mark* setters', () => {
    it('markStreaming sets streaming', () => {
      svc.markStreaming('s1');
      expect(svc.statuses().get('s1')).toBe('streaming');
    });

    it('markAwaitingBackground sets awaiting-background', () => {
      svc.markAwaitingBackground('s1');
      expect(svc.statuses().get('s1')).toBe('awaiting-background');
    });

    it('markIdle sets idle', () => {
      svc.markIdle('s1');
      expect(svc.statuses().get('s1')).toBe('idle');
    });

    it('markFailed sets failed', () => {
      svc.markFailed('s1');
      expect(svc.statuses().get('s1')).toBe('failed');
    });
  });

  describe('status() reactivity', () => {
    it('reflects later mark and clear', () => {
      const sig = svc.status('s1');
      expect(sig()).toBeUndefined();

      svc.markStreaming('s1');
      expect(sig()).toBe('streaming');

      svc.markFailed('s1');
      expect(sig()).toBe('failed');

      svc.clear('s1');
      expect(sig()).toBeUndefined();
    });

    it('tracks only the queried sessionId', () => {
      const sig = svc.status('s1');
      svc.markStreaming('s2');
      expect(sig()).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('removes the entry', () => {
      svc.markIdle('s1');
      svc.clear('s1');
      expect(svc.statuses().has('s1')).toBe(false);
    });

    it('is an identity-stable no-op when sessionId is absent', () => {
      const before = svc.statuses();
      svc.clear('missing');
      expect(svc.statuses()).toBe(before);
    });
  });

  describe('identity stability', () => {
    it('returns the SAME map reference when the value is unchanged', () => {
      svc.markStreaming('s1');
      const before = svc.statuses();
      svc.markStreaming('s1');
      expect(svc.statuses()).toBe(before);
    });

    it('returns a NEW map reference when the value changes', () => {
      svc.markStreaming('s1');
      const before = svc.statuses();
      svc.markIdle('s1');
      expect(svc.statuses()).not.toBe(before);
    });
  });

  describe('empty sessionId guard', () => {
    it('ignores an empty sessionId on a mutator', () => {
      const before = svc.statuses();
      svc.markStreaming('');
      expect(svc.statuses()).toBe(before);
      expect(svc.statuses().size).toBe(0);
    });
  });

  describe('liveWorkspaces()', () => {
    it('records workspacePath on mark and reports a streaming workspace', () => {
      svc.markStreaming('s1', '/ws/a');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(true);
    });

    it('reports an awaiting-background workspace', () => {
      svc.markAwaitingBackground('s1', '/ws/a');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(true);
    });

    it('excludes the workspace once the session goes idle', () => {
      svc.markStreaming('s1', '/ws/a');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(true);
      svc.markIdle('s1');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(false);
    });

    it('excludes the workspace once the session fails', () => {
      svc.markStreaming('s1', '/ws/a');
      svc.markFailed('s1');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(false);
    });

    it('excludes the workspace once the session is cleared', () => {
      svc.markStreaming('s1', '/ws/a');
      svc.clear('s1');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(false);
      expect(svc.liveWorkspaces().size).toBe(0);
    });

    it('is reactive — re-derives when status flips', () => {
      const sig = svc.liveWorkspaces;
      svc.markStreaming('s1', '/ws/a');
      expect(sig().has('/ws/a')).toBe(true);
      svc.markIdle('s1');
      expect(sig().has('/ws/a')).toBe(false);
      svc.markAwaitingBackground('s1');
      expect(sig().has('/ws/a')).toBe(true);
    });

    it('keeps a workspace live while any of its sessions is live', () => {
      svc.markStreaming('s1', '/ws/a');
      svc.markStreaming('s2', '/ws/a');
      svc.markIdle('s1');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(true);
      svc.markIdle('s2');
      expect(svc.liveWorkspaces().has('/ws/a')).toBe(false);
    });

    it('omits a live session that has no recorded workspace', () => {
      svc.markStreaming('s1');
      expect(svc.liveWorkspaces().size).toBe(0);
    });

    it('mark* stays callable with only a sessionId (no workspace)', () => {
      svc.markStreaming('s1');
      expect(svc.statuses().get('s1')).toBe('streaming');
      expect(svc.liveWorkspaces().size).toBe(0);
    });

    it('is identity-stable when re-marking same status + workspace', () => {
      svc.markStreaming('s1', '/ws/a');
      const before = svc.liveWorkspaces();
      svc.markStreaming('s1', '/ws/a');
      expect(svc.liveWorkspaces()).toBe(before);
    });
  });
});
