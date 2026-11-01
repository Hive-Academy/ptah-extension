import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, provideRouter } from '@angular/router';
import type { MotionRouteKey } from '@ptah-extension/ui';
import { marketplacePageKey } from './marketplace-motion-key';

describe('marketplacePageKey', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
  });

  afterEach(() => TestBed.resetTestingModule());

  it.each<[string, MotionRouteKey | null]>([
    ['/marketplace/overview', { key: 'overview', index: 0 }],
    ['/marketplace/connectors', { key: 'connectors', index: 10 }],
    ['/marketplace/servers', { key: 'servers:', index: 20 }],
    ['/marketplace/servers/smithery', { key: 'servers:smithery', index: 21 }],
    ['/marketplace/servers/custom-url', { key: 'servers:custom-url', index: 23 }],
    ['/marketplace/servers/registry?sort=name', { key: 'servers:registry', index: 22 }],
    ['/marketplace/skills', { key: 'skills:', index: 30 }],
    ['/marketplace/skills/community', { key: 'skills:community', index: 32 }],
    ['/marketplace/skills/ptah-plugins', { key: 'skills:ptah-plugins', index: 31 }],
    ['/marketplace/skills/marketplaces?sort=name', { key: 'skills:marketplaces', index: 33 }],
    ['/chat', null],
  ])('maps pending URL %s', (url, expected) => {
    const key = marketplacePageKey(router);
    const target = { ...router.routerState.snapshot, url };
    expect(key(target)).toEqual(expected);
  });

  it('keeps every source in core route parsing in the motion key order', () => {
    const core = readFileSync(join(__dirname, '../../../../core/src/lib/marketplace/marketplace-route.ts'), 'utf8');
    const key = marketplacePageKey(router);
    for (const [page, list, base] of [
      ['servers', 'SERVER_SOURCES', 20],
      ['skills', 'SKILL_SOURCES', 30],
    ] as const) {
      const body = core.match(new RegExp(`const ${list} = \\[([\\s\\S]*?)\\] as const`))?.[1];
      if (!body) throw new Error(`${list} missing from core route config`);
      const sources = Array.from(body.matchAll(/'([^']+)'/g), (match) => match[1]);
      expect(sources.length).toBeGreaterThan(0);
      sources.forEach((source, index) => {
        expect(key({ ...router.routerState.snapshot, url: `/marketplace/${page}/${source}` }))
          .toEqual({ key: `${page}:${source}`, index: base + index + 1 });
      });
    }
  });
});
