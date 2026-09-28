/**
 * StorefrontHeroComponent specs (plan C8, Task 11.1).
 *
 * The wide-tier header: gold eyebrow, title (the page `<h1>` by default),
 * the storefront gradient, "Your stack" tiles from the counts the page
 * passes in (each with loading / error / Retry), and "Synced to" CLI marks
 * through `ptah-target-marks`. No search field and no "My Stack" link.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CLI_TARGET_BRANDS } from '@ptah-extension/ui';

import {
  StorefrontHeroComponent,
  type StorefrontHeroHeadingLevel,
  type StorefrontStackTile,
} from './storefront-hero.component';
import type { TargetMarkItem } from './target-marks.component';

const READY_TILES: readonly StorefrontStackTile[] = [
  {
    id: 'servers',
    label: 'MCP servers',
    state: 'ready',
    count: 12,
    detail: '2 need sign-in',
  },
  { id: 'connectors', label: 'Connected apps', state: 'ready', count: 0 },
  { id: 'skills', label: 'Installed skills', state: 'ready', count: 1204 },
];

@Component({
  standalone: true,
  imports: [StorefrontHeroComponent],
  template: `
    <ptah-storefront-hero
      [heading]="heading()"
      [eyebrow]="eyebrow()"
      [description]="description()"
      [tiles]="tiles()"
      [syncedTargets]="synced()"
      [headingLevel]="headingLevel()"
      (retryTile)="retried.push($event)"
    >
      <button hero-actions type="button" data-testid="projected-cta">
        Browse connectors
      </button>
    </ptah-storefront-hero>
  `,
})
class HostComponent {
  public readonly heading = signal('One-click connectors');
  public readonly eyebrow = signal<string | null>('Connectors');
  public readonly description = signal<string | null>(
    'Sign in once and every CLI gets the server.',
  );
  public readonly tiles = signal<readonly StorefrontStackTile[]>(READY_TILES);
  public readonly synced = signal<readonly TargetMarkItem[] | null>([
    { target: 'claude', label: 'Claude Code' },
    { target: 'codex', label: 'Codex CLI' },
  ]);
  public readonly headingLevel = signal<StorefrontHeroHeadingLevel>(1);
  public readonly retried: string[] = [];
}

describe('StorefrontHeroComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  const q = (testId: string): HTMLElement | null =>
    element.querySelector(`[data-testid="${testId}"]`);
  const tile = (id: string): HTMLElement | null =>
    element.querySelector(
      `[data-testid="storefront-hero-tile"][data-tile="${id}"]`,
    );
  const text = (node: Element | null): string =>
    node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('narrative', () => {
    it('renders the eyebrow in the gold accent with an icon', () => {
      const eyebrow = q('storefront-hero-eyebrow');
      expect(text(eyebrow)).toBe('Connectors');
      expect(eyebrow?.className).toContain('text-secondary');
      expect(eyebrow?.className).toContain('border-secondary/30');
      expect(
        eyebrow?.querySelector('lucide-angular')?.getAttribute('aria-hidden'),
      ).toBe('true');
    });

    it('uses the gold accent only on the eyebrow', () => {
      const gold = element.querySelectorAll('.text-secondary');
      expect(gold).toHaveLength(1);
      expect(gold[0]).toBe(q('storefront-hero-eyebrow'));
    });

    it('drops a blank eyebrow and description', () => {
      host.eyebrow.set('  ');
      host.description.set(null);
      fixture.detectChanges();
      expect(q('storefront-hero-eyebrow')).toBeNull();
      expect(q('storefront-hero-description')).toBeNull();
    });

    it('paints the storefront gradient from theme tokens', () => {
      const hero = q('storefront-hero');
      expect(hero?.className).toContain('bg-gradient-to-br');
      expect(hero?.className).toContain('from-base-200');
      expect(hero?.className).toContain('via-base-100');
      expect(hero?.className).toContain('to-primary/10');
    });

    it('is the page h1 by default and labels its section with it', () => {
      const heading = q('storefront-hero-heading');
      expect(heading?.tagName).toBe('H1');
      expect(text(heading)).toBe('One-click connectors');
      expect(q('storefront-hero')?.getAttribute('aria-labelledby')).toBe(
        heading?.id,
      );
      expect(text(element.querySelector('h2'))).toBe('Your stack');
    });

    it('steps every heading down one level at headingLevel 2', () => {
      host.headingLevel.set(2);
      fixture.detectChanges();
      expect(element.querySelector('h1')).toBeNull();
      expect(q('storefront-hero-heading')?.tagName).toBe('H2');
      expect(text(element.querySelector('h3'))).toBe('Your stack');
    });

    it('projects the calls to action', () => {
      expect(
        q('storefront-hero-actions')?.querySelector(
          '[data-testid="projected-cta"]',
        ),
      ).not.toBeNull();
    });

    it('has no search field and no "My Stack" link (both dropped)', () => {
      expect(element.querySelector('input')).toBeNull();
      expect(element.querySelector('[role="searchbox"]')).toBeNull();
      expect(text(element)).not.toMatch(/my stack/i);
      expect(text(element)).not.toContain('⌘K');
    });
  });

  describe('Your stack tiles', () => {
    it('renders each ready count with tabular numbers', () => {
      const servers = tile('servers');
      const count = servers?.querySelector(
        '[data-testid="storefront-hero-tile-count"]',
      );
      expect(text(servers?.querySelector('dt') ?? null)).toBe('MCP servers');
      expect(text(count ?? null)).toBe('12');
      expect(count?.className).toContain('tabular-nums');
      expect(
        text(
          servers?.querySelector(
            '[data-testid="storefront-hero-tile-detail"]',
          ) ?? null,
        ),
      ).toBe('2 need sign-in');
    });

    it('shows a real zero and groups large counts', () => {
      expect(
        text(
          tile('connectors')?.querySelector(
            '[data-testid="storefront-hero-tile-count"]',
          ) ?? null,
        ),
      ).toBe('0');
      expect(
        text(
          tile('skills')?.querySelector(
            '[data-testid="storefront-hero-tile-count"]',
          ) ?? null,
        ),
      ).toBe('1,204');
    });

    it('never invents a number for a missing or invalid ready count', () => {
      host.tiles.set([
        { id: 'a', label: 'A', state: 'ready', count: null },
        { id: 'b', label: 'B', state: 'ready', count: Number.NaN },
        { id: 'c', label: 'C', state: 'ready', count: -3 },
      ]);
      fixture.detectChanges();
      for (const id of ['a', 'b', 'c']) {
        const node = tile(id);
        expect(
          node?.querySelector('[data-testid="storefront-hero-tile-count"]'),
        ).toBeNull();
        expect(text(node)).toContain('—');
        expect(text(node)).toContain('Not available');
      }
    });

    it('renders a skeleton with a screen-reader word while loading', () => {
      host.tiles.set([
        {
          id: 'servers',
          label: 'MCP servers',
          state: 'loading',
          count: 99,
          detail: 'hidden while loading',
        },
      ]);
      fixture.detectChanges();
      const node = tile('servers');
      expect(node?.getAttribute('data-state')).toBe('loading');
      expect(
        node?.querySelector('.skeleton')?.getAttribute('aria-hidden'),
      ).toBe('true');
      expect(text(node)).toContain('Loading');
      expect(text(node)).not.toContain('99');
      expect(
        node?.querySelector('[data-testid="storefront-hero-tile-detail"]'),
      ).toBeNull();
    });

    it('offers a labelled Retry for a failed tile and emits its id', () => {
      host.tiles.set([
        { id: 'skills', label: 'Installed skills', state: 'error', count: 4 },
      ]);
      fixture.detectChanges();
      const node = tile('skills');
      expect(text(node)).toContain('Unavailable');
      expect(text(node)).not.toContain('4');
      const retry = node?.querySelector<HTMLButtonElement>(
        '[data-testid="storefront-hero-tile-retry"]',
      );
      expect(retry?.getAttribute('aria-label')).toBe(
        'Retry loading Installed skills',
      );
      retry?.click();
      expect(host.retried).toEqual(['skills']);
    });

    it('renders no tile grid when the page passes no tiles', () => {
      host.tiles.set([]);
      fixture.detectChanges();
      expect(element.querySelector('dl')).toBeNull();
      expect(q('storefront-hero-synced')).not.toBeNull();
    });
  });

  describe('Synced to', () => {
    it('draws detected CLIs through ptah-target-marks with brand marks', () => {
      const synced = q('storefront-hero-synced');
      expect(synced?.querySelector('ptah-target-marks')).not.toBeNull();
      const claude = synced?.querySelector('[data-target="claude"]');
      const brand = claude?.querySelector('ptah-brand-mark');
      expect(brand).not.toBeNull();
      expect(CLI_TARGET_BRANDS.claude.kind).toBe('brand');
      expect(synced?.querySelector('[data-target="codex"]')).not.toBeNull();
      const labels = Array.from(
        synced?.querySelectorAll('[data-testid="target-labels"] li') ?? [],
      ).map((li) => text(li));
      expect(labels).toEqual(['Claude Code', 'Codex CLI']);
    });

    it('says so when no CLI is detected', () => {
      host.synced.set([]);
      fixture.detectChanges();
      expect(text(q('storefront-hero-synced-empty'))).toBe('No CLI detected');
      expect(element.querySelector('ptah-target-marks')).toBeNull();
    });

    it('shows a skeleton while detection is unknown', () => {
      host.synced.set(null);
      fixture.detectChanges();
      const synced = q('storefront-hero-synced');
      expect(synced?.querySelector('.skeleton')).not.toBeNull();
      expect(text(synced)).toContain('Detecting CLIs');
      expect(synced?.querySelector('ptah-target-marks')).toBeNull();
    });
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'storefront-hero.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
