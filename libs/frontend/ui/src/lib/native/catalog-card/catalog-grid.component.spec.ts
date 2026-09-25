import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatalogCardComponent } from './catalog-card.component';
import {
  CATALOG_CONTAINER_NAME,
  CatalogGridComponent,
} from './catalog-grid.component';

@Component({
  standalone: true,
  imports: [CatalogGridComponent, CatalogCardComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-catalog-grid [ariaLabel]="label()">
      @for (name of names(); track name) {
        <ptah-catalog-card role="listitem" [heading]="name" />
        @if (expanded() === name) {
          <div role="listitem" class="col-span-full" data-testid="expansion">
            Setup form for {{ name }}
          </div>
        }
      }
    </ptah-catalog-grid>
  `,
})
class HostComponent {
  names = signal<readonly string[]>(['Sentry', 'Firecrawl', 'Shopify']);
  expanded = signal<string | null>(null);
  label = signal<string | null>(null);
}

/**
 * Collapsed text of the grid component's source. jest-preset-angular strips
 * inline `styles` at compile time, so the container rules are asserted on the
 * authored source rather than on an attached <style> element.
 */
function gridStyles(): string {
  return readFileSync(
    join(__dirname, 'catalog-grid.component.ts'),
    'utf8',
  ).replace(/\s+/g, ' ');
}

describe('CatalogGridComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const list = (): HTMLElement =>
    el().querySelector('[data-testid="catalog-grid"]') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('container rule', () => {
    it('establishes the ptah-catalog inline-size container on the host', () => {
      expect(CATALOG_CONTAINER_NAME).toBe('ptah-catalog');
      expect(gridStyles()).toMatch(
        /\{[^}]*container: ptah-catalog \/ inline-size/,
      );
    });

    it('lays out 1 column below 480px', () => {
      expect(gridStyles()).toMatch(
        /\.ptah-catalog-grid[^{]*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
      );
    });

    it.each([
      [480, 2],
      [800, 3],
      [1200, 4],
    ])('switches to %spx → %s columns via @container', (width, columns) => {
      const rule = new RegExp(
        `@container ptah-catalog \\(width >= ${width}px\\) \\{ \\.ptah-catalog-grid[^{]*\\{ grid-template-columns: repeat\\(${columns}, minmax\\(0, 1fr\\)\\);`,
      );
      expect(gridStyles()).toMatch(rule);
    });

    it('does not depend on the viewport (no @media rules)', () => {
      expect(gridStyles()).not.toMatch(/@media\s*\(/);
    });
  });

  describe('roles', () => {
    it('renders the track as role="list" containing the projected items', () => {
      expect(list().getAttribute('role')).toBe('list');
      const items = Array.from(list().children);
      expect(items).toHaveLength(3);
      for (const item of items) {
        expect(item.tagName).toBe('PTAH-CATALOG-CARD');
        expect(item.getAttribute('role')).toBe('listitem');
      }
    });

    it('names the list only when ariaLabel is set', () => {
      expect(list().getAttribute('aria-label')).toBeNull();

      host.label.set('Smithery servers');
      fixture.detectChanges();
      expect(list().getAttribute('aria-label')).toBe('Smithery servers');
    });

    it('places a col-span-full child as a full-row list item after its card', () => {
      host.expanded.set('Firecrawl');
      fixture.detectChanges();

      const items = Array.from(list().children);
      expect(items).toHaveLength(4);
      const expansion = items[2] as HTMLElement;
      expect(expansion.getAttribute('data-testid')).toBe('expansion');
      expect(expansion.getAttribute('role')).toBe('listitem');
      expect(expansion.classList).toContain('col-span-full');
      expect(items[1].querySelector('h3')?.textContent?.trim()).toBe(
        'Firecrawl',
      );
    });
  });

  it('keeps the card compact density keyed off the same container', () => {
    const cardSource = readFileSync(
      join(__dirname, 'catalog-card.component.ts'),
      'utf8',
    );
    expect(cardSource).toContain(`@container ${CATALOG_CONTAINER_NAME} (`);
  });
});
