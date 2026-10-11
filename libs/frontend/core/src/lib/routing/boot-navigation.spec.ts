import type { WebviewRouteState } from '@ptah-extension/shared';
import { resolveBootNavigation } from './boot-navigation';

function restoredState(route: string, seed: string | null): WebviewRouteState {
  return { v: 1, route, seed, panelId: '' };
}

describe('resolveBootNavigation', () => {
  it('T1: the DevTools override beats the host value and the restored route', () => {
    expect(
      resolveBootNavigation({
        devToolsOverride: 'settings',
        hostInitialView: 'analytics',
        restored: restoredState('/thoth/skills', 'chat'),
      }),
    ).toEqual({ kind: 'surface', rawView: 'settings', seed: 'analytics' });
  });

  it('T2: no persisted state lands the host value', () => {
    expect(
      resolveBootNavigation({
        devToolsOverride: undefined,
        hostInitialView: 'setup-wizard',
        restored: null,
      }),
    ).toEqual({
      kind: 'surface',
      rawView: 'setup-wizard',
      seed: 'setup-wizard',
    });
  });

  it('T3: a host value that differs from the seed is a new deep link and wins', () => {
    expect(
      resolveBootNavigation({
        devToolsOverride: undefined,
        hostInitialView: 'analytics',
        restored: restoredState('/settings', 'chat'),
      }),
    ).toEqual({ kind: 'surface', rawView: 'analytics', seed: 'analytics' });
  });

  it('T4: a host value equal to the seed was consumed, so the route restores', () => {
    expect(
      resolveBootNavigation({
        devToolsOverride: undefined,
        hostInitialView: 'analytics',
        restored: restoredState('/settings', 'analytics'),
      }),
    ).toEqual({ kind: 'route', route: '/settings', seed: 'analytics' });
  });

  it.each([[null], [undefined]])(
    'T5: a host value of %p restores the route',
    (hostInitialView) => {
      expect(
        resolveBootNavigation({
          devToolsOverride: undefined,
          hostInitialView,
          restored: restoredState('/thoth/skills', 'analytics'),
        }),
      ).toEqual({ kind: 'route', route: '/thoth/skills', seed: 'analytics' });
    },
  );

  it("T6: Electron's 'chat' with seed 'chat' restores the route", () => {
    expect(
      resolveBootNavigation({
        devToolsOverride: undefined,
        hostInitialView: 'chat',
        restored: restoredState(
          '/chat/550e8400-e29b-41d4-a716-446655440000',
          'chat',
        ),
      }),
    ).toEqual({
      kind: 'route',
      route: '/chat/550e8400-e29b-41d4-a716-446655440000',
      seed: 'chat',
    });
  });

  describe('T7: seed carry-forward', () => {
    it('carries the restored seed when the host sends nothing', () => {
      expect(
        resolveBootNavigation({
          devToolsOverride: undefined,
          hostInitialView: null,
          restored: restoredState('/settings', 'analytics'),
        }).seed,
      ).toBe('analytics');
    });

    it('is null with no host value and no persisted state', () => {
      expect(
        resolveBootNavigation({
          devToolsOverride: undefined,
          hostInitialView: undefined,
          restored: null,
        }).seed,
      ).toBeNull();
    });

    it('never uses the DevTools override as the seed', () => {
      expect(
        resolveBootNavigation({
          devToolsOverride: 'settings',
          hostInitialView: undefined,
          restored: restoredState('/chat', null),
        }).seed,
      ).toBeNull();
    });
  });

  it('T8: no state and no host value lands surface undefined', () => {
    expect(
      resolveBootNavigation({
        devToolsOverride: undefined,
        hostInitialView: null,
        restored: null,
      }),
    ).toEqual({ kind: 'surface', rawView: undefined, seed: null });
  });
});
