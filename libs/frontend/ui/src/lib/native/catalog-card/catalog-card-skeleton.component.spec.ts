import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  CatalogCardSkeletonComponent,
  CatalogCardSkeletonDensity,
} from './catalog-card-skeleton.component';
import { CatalogCardComponent } from './catalog-card.component';
import { CATALOG_CARD_SHELL_CLASS } from './catalog-card-shell.styles';
import { CatalogGridComponent } from './catalog-grid.component';

@Component({
  standalone: true,
  imports: [
    CatalogGridComponent,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-catalog-grid>
      <ptah-catalog-card-skeleton role="listitem" [density]="density()" />
      <ptah-catalog-card role="listitem" heading="Loaded" />
    </ptah-catalog-grid>
  `,
})
class HostComponent {
  density = signal<CatalogCardSkeletonDensity>('comfortable');
}

/** Whitespace-collapsed source; jest-preset-angular strips inline styles. */
function source(file: string): string {
  return readFileSync(join(__dirname, file), 'utf8').replace(/\s+/g, ' ');
}

describe('CatalogCardSkeletonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const skeletonHost = (): HTMLElement =>
    el().querySelector('ptah-catalog-card-skeleton') as HTMLElement;
  const shell = (): HTMLElement =>
    el().querySelector('[data-testid="catalog-card-skeleton"]') as HTMLElement;
  const cardShell = (): HTMLElement =>
    el().querySelector('[data-testid="catalog-card"]') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('is hidden from assistive technology and keeps the consumer listitem role', () => {
    expect(skeletonHost().getAttribute('aria-hidden')).toBe('true');
    expect(skeletonHost().getAttribute('role')).toBe('listitem');
    expect(skeletonHost().textContent?.trim()).toBe('');
  });

  it('uses the same outer shell classes as the real card', () => {
    for (const cls of CATALOG_CARD_SHELL_CLASS.split(' ')) {
      expect(shell().classList).toContain(cls);
      expect(cardShell().classList).toContain(cls);
    }
    expect(shell().className).toContain('bg-base-200');
    expect(shell().className).toContain('border-base-300');
    expect(shell().className).toContain('rounded-xl');
  });

  it('renders skeleton blocks for mark, heading, two description lines and footer', () => {
    const q = (id: string): Element | null =>
      el().querySelector(`[data-testid="${id}"]`);
    expect(q('catalog-card-skeleton-mark')?.classList).toContain('skeleton');
    expect(q('catalog-card-skeleton-heading')?.classList).toContain('skeleton');

    const lines = el().querySelectorAll(
      '[data-testid="catalog-card-skeleton-line"]',
    );
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(line.classList).toContain('skeleton'));

    expect(
      q('catalog-card-skeleton-footer')?.querySelector('.skeleton'),
    ).not.toBeNull();
  });

  it('contains no focusable or interactive element', () => {
    expect(
      shell().querySelector('a, button, input, select, textarea, [tabindex]'),
    ).toBeNull();
  });

  it('applies comfortable density by default and compact on request', () => {
    expect(skeletonHost().getAttribute('data-density')).toBe('comfortable');
    expect(shell().classList).not.toContain('ptah-catalog-card--compact');

    host.density.set('compact');
    fixture.detectChanges();
    expect(skeletonHost().getAttribute('data-density')).toBe('compact');
    expect(shell().classList).toContain('ptah-catalog-card--compact');
  });

  it('shares the card shell density rules, including the compact container', () => {
    const shellStyles = source('catalog-card-shell.styles.ts');
    expect(shellStyles).toMatch(
      /\.ptah-catalog-card \{ gap: 0\.75rem; padding: 1rem; \}/,
    );
    expect(shellStyles).toMatch(
      /\.ptah-catalog-card\.ptah-catalog-card--compact \{ gap: 0\.5rem; padding: 0\.75rem; \}/,
    );
    expect(shellStyles).toMatch(
      /@container ptah-catalog \(width < 480px\) \{ \.ptah-catalog-card \{ gap: 0\.5rem; padding: 0\.75rem; \}/,
    );

    for (const file of [
      'catalog-card.component.ts',
      'catalog-card-skeleton.component.ts',
    ]) {
      expect(source(file)).toContain('CATALOG_CARD_SHELL_STYLES,');
    }
  });

  it('drops the second description line in compact density', () => {
    expect(source('catalog-card-skeleton.component.ts')).toMatch(
      /@container ptah-catalog \(width < 480px\) \{ \.ptah-catalog-card-skeleton__line-2 \{ display: none; \}/,
    );
  });
});
