/**
 * path-containment.spec.ts
 *
 * Unit specs for the shared lexical containment predicate. `platform` is always
 * driven via the function argument so these assertions are OS-independent (they
 * run identically on the CI Linux box and a dev's win32 machine) — the same
 * posture as `shell-allowlist.spec.ts` in this directory.
 *
 * `path.resolve` still runs with host semantics, so fixtures use forward-slash
 * absolute paths and only ever compare containment RELATIONS (candidate vs root
 * resolve with the same drive prefix), never absolute resolved strings.
 */
import { isPathWithinRoots } from './path-containment';

describe('isPathWithinRoots', () => {
  describe('fail-closed guards', () => {
    it('rejects an empty candidate', () => {
      expect(isPathWithinRoots('', ['/ws/root'], 'linux')).toBe(false);
    });

    it('rejects an empty root set', () => {
      expect(isPathWithinRoots('/ws/root', [], 'linux')).toBe(false);
    });

    it('ignores falsy entries inside the root set', () => {
      expect(isPathWithinRoots('/ws/root', ['', '/ws/root'], 'linux')).toBe(
        true,
      );
    });
  });

  describe('containment', () => {
    it('accepts a root exactly', () => {
      expect(isPathWithinRoots('/ws/root', ['/ws/root'], 'linux')).toBe(true);
    });

    it('accepts a descendant of a root', () => {
      expect(
        isPathWithinRoots('/ws/root/a/b/c.txt', ['/ws/root'], 'linux'),
      ).toBe(true);
    });

    it('accepts a root with a trailing slash', () => {
      expect(isPathWithinRoots('/ws/root/', ['/ws/root'], 'linux')).toBe(true);
    });

    it('accepts a match against the second root in the set', () => {
      expect(
        isPathWithinRoots('/home/user/x', ['/ws/root', '/home/user'], 'linux'),
      ).toBe(true);
    });
  });

  describe('separator-boundary safety', () => {
    it('rejects a sibling that shares only a non-boundary prefix', () => {
      expect(isPathWithinRoots('/ws/root-extra', ['/ws/root'], 'linux')).toBe(
        false,
      );
    });

    it('rejects the parent of a root', () => {
      expect(isPathWithinRoots('/ws', ['/ws/root'], 'linux')).toBe(false);
    });

    it('rejects an unrelated path', () => {
      expect(isPathWithinRoots('/etc/passwd', ['/ws/root'], 'linux')).toBe(
        false,
      );
    });
  });

  describe('case fold is win32-only (F2)', () => {
    it('folds case on win32 — a differently-cased descendant is contained', () => {
      expect(isPathWithinRoots('/WS/ROOT/x', ['/ws/root'], 'win32')).toBe(true);
    });

    it('does NOT fold case on a case-sensitive platform', () => {
      expect(isPathWithinRoots('/WS/ROOT/x', ['/ws/root'], 'linux')).toBe(
        false,
      );
    });

    it('still accepts a same-case descendant on a case-sensitive platform', () => {
      expect(isPathWithinRoots('/ws/root/x', ['/ws/root'], 'linux')).toBe(true);
    });
  });
});
