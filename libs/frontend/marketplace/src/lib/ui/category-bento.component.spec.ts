/**
 * CategoryBentoComponent specs (plan C8, Task 11.2).
 *
 * One tile per non-empty connector category, in catalogue category order,
 * with its label, count and sample brand marks; pressing a tile emits the
 * category the page turns into `?category=`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  PTAH_CONNECTORS,
  PTAH_CONNECTOR_CATEGORIES,
  type PtahConnector,
  type PtahConnectorCategory,
} from '@ptah-extension/shared';

import {
  CATEGORY_BENTO_SAMPLE_SIZE,
  CONNECTOR_CATEGORY_QUERY_PARAM,
  CategoryBentoComponent,
  connectorCategoryQueryParams,
  groupConnectorsByCategory,
} from './category-bento.component';

function connector(
  id: string,
  category: PtahConnectorCategory,
  brandSlug: string = id,
): PtahConnector {
  return {
    id,
    label: id,
    brandSlug,
    description: `${id} description`,
    category,
    kind: 'oauth-dcr',
    url: `https://mcp.${id}.dev/mcp`,
    verifiedAt: '2026-09-04',
  };
}

const CATALOGUE: readonly PtahConnector[] = [
  connector('sentry', 'devops'),
  connector('notion', 'productivity'),
  connector('asana-v1', 'productivity', 'asana'),
  connector('asana-v2', 'productivity', 'asana'),
  connector('linear', 'productivity'),
  connector('monday', 'productivity'),
  connector('clickup', 'productivity'),
  connector('github', 'code'),
];

@Component({
  standalone: true,
  imports: [CategoryBentoComponent],
  template: `
    <ptah-category-bento
      [connectors]="connectors()"
      [activeCategory]="active()"
      (categorySelected)="selected.push($event)"
    />
  `,
})
class HostComponent {
  public readonly connectors = signal<readonly PtahConnector[]>(CATALOGUE);
  public readonly active = signal<PtahConnectorCategory | null>(null);
  public readonly selected: PtahConnectorCategory[] = [];
}

describe('groupConnectorsByCategory', () => {
  it('orders tiles by PTAH_CONNECTOR_CATEGORIES and skips empty categories', () => {
    expect(groupConnectorsByCategory(CATALOGUE).map((i) => i.category)).toEqual(
      ['code', 'productivity', 'devops'],
    );
  });

  it('counts every entry but samples distinct brands, up to four', () => {
    const productivity = groupConnectorsByCategory(CATALOGUE).find(
      (i) => i.category === 'productivity',
    );
    expect(productivity?.label).toBe('Productivity');
    expect(productivity?.count).toBe(6);
    expect(CATEGORY_BENTO_SAMPLE_SIZE).toBe(4);
    expect(productivity?.samples.map((s) => s.brandSlug)).toEqual([
      'notion',
      'asana',
      'linear',
      'monday',
    ]);
  });

  it('honours a smaller sample size and never goes negative', () => {
    const [code] = groupConnectorsByCategory(CATALOGUE, 0);
    expect(code.samples).toEqual([]);
    expect(groupConnectorsByCategory(CATALOGUE, -2)[0].samples).toEqual([]);
  });

  it('covers every connector of the real catalogue exactly once', () => {
    const items = groupConnectorsByCategory(PTAH_CONNECTORS);
    const total = items.reduce((sum, item) => sum + item.count, 0);
    expect(total).toBe(PTAH_CONNECTORS.length);
    for (const item of items) {
      expect(PTAH_CONNECTOR_CATEGORIES).toContain(item.category);
    }
  });
});

describe('connectorCategoryQueryParams', () => {
  it('builds the ?category= query params', () => {
    expect(CONNECTOR_CATEGORY_QUERY_PARAM).toBe('category');
    expect(connectorCategoryQueryParams('devops')).toEqual({
      category: 'devops',
    });
  });
});

describe('CategoryBentoComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  const tiles = (): HTMLButtonElement[] =>
    Array.from(
      element.querySelectorAll<HTMLButtonElement>(
        '[data-testid="category-bento-tile"]',
      ),
    );
  const tile = (category: string): HTMLButtonElement | null =>
    element.querySelector<HTMLButtonElement>(
      `[data-testid="category-bento-tile"][data-category="${category}"]`,
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

  it('renders one button tile per category inside a list', () => {
    expect(tiles()).toHaveLength(3);
    const list = element.querySelector('ul[role="list"]');
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(3);
    for (const node of tiles()) {
      expect(node.tagName).toBe('BUTTON');
      expect(node.getAttribute('type')).toBe('button');
    }
  });

  it('shows the label and count, and names the button with both', () => {
    const productivity = tile('productivity');
    expect(text(productivity)).toContain('Productivity');
    expect(
      text(
        productivity?.querySelector('[data-testid="category-bento-count"]') ??
          null,
      ),
    ).toBe('6 connectors');
    expect(productivity?.getAttribute('aria-label')).toBe(
      'Productivity, 6 connectors',
    );
    expect(
      text(
        tile('code')?.querySelector('[data-testid="category-bento-count"]') ??
          null,
      ),
    ).toBe('1 connector');
  });

  it('draws sample brands through ptah-brand-mark, hidden from assistive tech', () => {
    const productivity = tile('productivity');
    const brands = Array.from(
      productivity?.querySelectorAll('[data-brand]') ?? [],
    ).map((node) => node.getAttribute('data-brand'));
    expect(brands).toEqual(['notion', 'asana', 'linear', 'monday']);
    expect(productivity?.querySelectorAll('ptah-brand-mark')).toHaveLength(4);
    expect(
      productivity
        ?.querySelector('[data-brand]')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('emits the category when a tile is pressed', () => {
    tile('devops')?.click();
    tile('code')?.click();
    expect(host.selected).toEqual(['devops', 'code']);
  });

  it('marks the active category with aria-current', () => {
    expect(tile('devops')?.getAttribute('aria-current')).toBeNull();
    host.active.set('devops');
    fixture.detectChanges();
    expect(tile('devops')?.getAttribute('aria-current')).toBe('true');
    expect(tile('code')?.getAttribute('aria-current')).toBeNull();
  });

  it('renders an empty note instead of the grid with no connectors', () => {
    host.connectors.set([]);
    fixture.detectChanges();
    expect(tiles()).toHaveLength(0);
    expect(element.querySelector('ul')).toBeNull();
    expect(
      element.querySelector('[data-testid="category-bento-empty"]'),
    ).not.toBeNull();
  });

  it('titles the section with an h2', () => {
    const heading = element.querySelector('h2');
    expect(text(heading)).toBe('Explore by category');
    expect(
      element
        .querySelector('[data-testid="category-bento"]')
        ?.getAttribute('aria-labelledby'),
    ).toBe(heading?.id);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'category-bento.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
