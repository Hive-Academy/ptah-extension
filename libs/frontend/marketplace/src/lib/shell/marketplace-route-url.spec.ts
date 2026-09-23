import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MarketplaceRoute } from '@ptah-extension/core';
import {
  MARKETPLACE_SURFACE,
  marketplaceRouteLink,
  marketplaceRouteOfUrl,
} from './marketplace-route-url';

describe('marketplace-route-url', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('mounts under the marketplace surface', () => {
    expect(MARKETPLACE_SURFACE).toBe('marketplace');
  });

  it.each<[MarketplaceRoute, string[]]>([
    [{ page: 'overview' }, ['/', 'marketplace', 'overview']],
    [{ page: 'servers' }, ['/', 'marketplace', 'servers']],
    [
      { page: 'skills', source: 'community' },
      ['/', 'marketplace', 'skills', 'community'],
    ],
  ])('links %j as %j', (route, commands) => {
    expect(marketplaceRouteLink(route)).toEqual(commands);
  });

  it.each<[string, MarketplaceRoute | null]>([
    ['/marketplace/overview', { page: 'overview' }],
    ['/marketplace/servers/smithery', { page: 'servers', source: 'smithery' }],
    ['/marketplace/servers/claude-user%3Asentry', { page: 'servers' }],
    ['/marketplace/connectors?category=dev', { page: 'connectors' }],
    ['/marketplace', null],
    ['/chat', null],
    ['/settings/marketplace', null],
  ])('parses %s', (url, route) => {
    expect(marketplaceRouteOfUrl(router, url)).toEqual(route);
  });
});
