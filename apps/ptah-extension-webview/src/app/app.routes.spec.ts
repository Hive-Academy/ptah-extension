import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CanMatchFn, Route } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { SURFACE_ACTIVE } from '@ptah-extension/core';

import { onboardingFirstRunGuard } from '@ptah-extension/onboarding/services';

import { appRoutes } from './app.routes';
import { reviewOnlySurface } from './review-only-surface.guard';

describe('Electron shell layout boundary', () => {
  it('bounds the outer row and configuration host', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../../../libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts',
      ),
      'utf-8',
    );
    const rowClasses = source.match(
      /<!-- 3-Panel Content Area -->\s*<div class="([^"]+)"/,
    )?.[1];
    const hostClasses = source.match(
      /data-test="configuration-surface-host"[\s\S]*?class="([^"]+)"/,
    )?.[1];
    expect(rowClasses?.split(' ')).toContain('min-h-0');
    expect(hostClasses?.split(' ')).toContain('min-h-0');
  });
});

function routeFor(path: string): Route {
  const route = appRoutes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`Missing route: ${path}`);
  return route;
}

describe('review runs route', () => {
  it('lazily resolves the review runs page on Electron', async () => {
    const route = routeFor('review-runs');
    TestBed.configureTestingModule({
      providers: [{ provide: VSCodeService, useValue: { isElectron: true } }],
    });
    expect(route.canMatch).toEqual([reviewOnlySurface]);
    expect(TestBed.runInInjectionContext(() => reviewOnlySurface(route, [], {} as Parameters<CanMatchFn>[2]))).toBe(true);
    const { ReviewRunsPageComponent } = await import('@ptah-extension/review-runs-ui');
    expect(await route.loadComponent?.()).toBe(ReviewRunsPageComponent);
  });

  it('refuses the route on hosts without the review surface', () => {
    const route = routeFor('review-runs');
    TestBed.configureTestingModule({
      providers: [{ provide: VSCodeService, useValue: { isElectron: false } }],
    });
    expect(TestBed.runInInjectionContext(() => reviewOnlySurface(route, [], {} as Parameters<CanMatchFn>[2]))).toBe(false);
    expect(appRoutes.at(-1)?.path).toBe('**');
  });
});

describe('onboarding route (TASK_2026_ONBOARDING)', () => {
  it('guards only the chat route with the first-run guard', () => {
    const guarded = appRoutes
      .filter((route) => route.canActivate !== undefined)
      .map((route) => route.path);

    expect(guarded).toEqual(['chat']);
    expect(routeFor('chat').canActivate).toEqual([onboardingFirstRunGuard]);
  });

  it('lazily loads ONBOARDING_ROUTES with its own SURFACE_ACTIVE provider', async () => {
    const route = routeFor('onboarding');
    const module = await import('@ptah-extension/onboarding');

    expect(route.component).toBeUndefined();
    expect(route.loadComponent).toBeUndefined();
    expect(route.canMatch).toBeUndefined();
    expect(route.providers).toEqual([
      expect.objectContaining({ provide: SURFACE_ACTIVE }),
    ]);
    expect(await route.loadChildren?.()).toBe(module.ONBOARDING_ROUTES);
  });

  it('declares onboarding right after chat', () => {
    const order = appRoutes.map((route) => route.path);
    expect(order.indexOf('onboarding')).toBe(order.indexOf('chat') + 1);
  });

  it('has no routes for the deleted setup surfaces', () => {
    const paths = appRoutes.map((route) => route.path);
    for (const legacyPath of ['setup-wizard', 'harness-builder', 'setup-hub']) {
      expect(paths).not.toContain(legacyPath);
    }
  });

  it('imports onboarding eagerly only through its narrow services entry', () => {
    const source = readFileSync(join(__dirname, 'app.routes.ts'), 'utf-8');
    expect(source).toContain("from '@ptah-extension/onboarding/services'");
    expect(source).not.toMatch(/from '@ptah-extension\/onboarding'/);
  });
});
