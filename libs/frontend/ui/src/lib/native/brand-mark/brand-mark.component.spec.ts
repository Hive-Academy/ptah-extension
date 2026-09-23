import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';

import { BrandMarkComponent } from './brand-mark.component';
import { BRAND_MARKS, MONOGRAM_SLUGS } from './brand-marks.generated';
import type { MarkTileSize } from './monogram-tile.component';

/** Fixtures are read from the generated table, not assumed. */
const ON_DARK_SLUG = 'github';
const LIGHT_SLUG = 'sentry';
const PLAIN_SLUG = 'airtable';

describe('BrandMarkComponent', () => {
  function render(
    brandSlug: string | null,
    label = 'Label',
    size?: MarkTileSize,
  ) {
    const fixture = TestBed.createComponent(BrandMarkComponent);
    fixture.componentRef.setInput('brandSlug', brandSlug);
    fixture.componentRef.setInput('label', label);
    if (size !== undefined) fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const find = (testId: string) =>
      host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, host, find };
  }

  function setThemeMode(mode: 'dark' | 'light' | null): void {
    const root = document.documentElement;
    if (mode === null) root.removeAttribute('data-theme-mode');
    else root.setAttribute('data-theme-mode', mode);
  }

  function isShown(element: HTMLElement | null): boolean {
    expect(element).not.toBeNull();
    return getComputedStyle(element as HTMLElement).display !== 'none';
  }

  afterEach(() => setThemeMode(null));

  it('reads its fixtures from the table as the tile rules expect them', () => {
    expect(BRAND_MARKS[ON_DARK_SLUG].onDark).toBeDefined();
    expect(BRAND_MARKS[ON_DARK_SLUG].surface).toBe('light');
    expect(BRAND_MARKS[LIGHT_SLUG].onDark).toBeUndefined();
    expect(BRAND_MARKS[LIGHT_SLUG].surface).toBe('light');
    expect(BRAND_MARKS[PLAIN_SLUG].onDark).toBeUndefined();
    expect(BRAND_MARKS[PLAIN_SLUG].surface).toBe('any');
  });

  describe('tile rules', () => {
    it('puts a light-surface mark without a dark variant on the white tile', () => {
      const tile = render(LIGHT_SLUG).find('brand-mark-tile');
      expect(tile?.getAttribute('data-tile')).toBe('light');
      expect(tile?.classList.contains('bg-white')).toBe(true);
      expect(tile?.classList.contains('border-base-300')).toBe(true);
    });

    it('checks the dark variant first: a light-surface mark with one stays on the theme tile', () => {
      const tile = render(ON_DARK_SLUG).find('brand-mark-tile');
      expect(tile?.getAttribute('data-tile')).toBe('theme');
      expect(tile?.classList.contains('bg-base-200')).toBe(true);
      expect(tile?.classList.contains('bg-white')).toBe(false);
    });

    it('puts any other mark on the theme tile', () => {
      const tile = render(PLAIN_SLUG).find('brand-mark-tile');
      expect(tile?.getAttribute('data-tile')).toBe('theme');
      expect(tile?.classList.contains('bg-base-200')).toBe(true);
    });

    it.each<[MarkTileSize, string, string]>([
      ['sm', 'h-6', 'h-4'],
      ['md', 'h-8', 'h-5'],
      ['lg', 'h-14', 'h-9'],
    ])('sizes the %s tile %s with %s artwork', (size, tileClass, artClass) => {
      const { find } = render(PLAIN_SLUG, 'Airtable', size);
      expect(find('brand-mark-tile')?.classList.contains(tileClass)).toBe(true);
      expect(find('brand-mark-art')?.classList.contains(artClass)).toBe(true);
    });
  });

  describe('artwork', () => {
    it('draws the table artwork through ptah-mark-svg in brand paint', () => {
      const art = render(PLAIN_SLUG).find('brand-mark-art');
      expect(art?.tagName.toLowerCase()).toBe('ptah-mark-svg');
      const svg = art?.querySelector('svg');
      expect(svg?.getAttribute('data-paint')).toBe('brand');
      expect(svg?.getAttribute('viewBox')).toBe(
        BRAND_MARKS[PLAIN_SLUG].art.viewBox,
      );
      expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
        BRAND_MARKS[PLAIN_SLUG].art.paths[0].d,
      );
    });

    it('renders both artworks when a dark variant exists', () => {
      const { find } = render(ON_DARK_SLUG);
      const onDark = BRAND_MARKS[ON_DARK_SLUG].onDark;
      expect(
        find('brand-mark-art')?.querySelector('path')?.getAttribute('d'),
      ).toBe(BRAND_MARKS[ON_DARK_SLUG].art.paths[0].d);
      expect(
        find('brand-mark-on-dark')?.querySelector('path')?.getAttribute('d'),
      ).toBe(onDark?.paths[0].d);
    });

    it('shows the dark variant, and hides art, when the theme mode is dark', () => {
      setThemeMode('dark');
      const { find } = render(ON_DARK_SLUG);
      expect(isShown(find('brand-mark-on-dark'))).toBe(true);
      expect(isShown(find('brand-mark-art'))).toBe(false);
    });

    it('shows art, and hides the dark variant, when the theme mode is light', () => {
      setThemeMode('light');
      const { find } = render(ON_DARK_SLUG);
      expect(isShown(find('brand-mark-art'))).toBe(true);
      expect(isShown(find('brand-mark-on-dark'))).toBe(false);
    });

    it('shows art before any theme mode is written', () => {
      const { find } = render(ON_DARK_SLUG);
      expect(isShown(find('brand-mark-art'))).toBe(true);
      expect(isShown(find('brand-mark-on-dark'))).toBe(false);
    });

    it('switches with the attribute alone — no input, no re-render', () => {
      setThemeMode('light');
      const { find } = render(ON_DARK_SLUG);
      setThemeMode('dark');
      expect(isShown(find('brand-mark-on-dark'))).toBe(true);
      expect(isShown(find('brand-mark-art'))).toBe(false);
    });

    it('shows art on a dark theme when the brand has no dark variant', () => {
      setThemeMode('dark');
      const { find } = render(LIGHT_SLUG);
      expect(find('brand-mark-on-dark')).toBeNull();
      expect(isShown(find('brand-mark-art'))).toBe(true);
    });
  });

  describe('monogram fallback', () => {
    it.each([
      ['an unknown slug', 'no-such-brand'],
      ['a declared monogram slug', MONOGRAM_SLUGS[0]],
      ['an inherited Object key', 'constructor'],
      ['a prototype key', '__proto__'],
    ])('renders a monogram for %s', (_case, slug) => {
      const { find } = render(slug, 'Klaviyo');
      expect(find('brand-mark-tile')).toBeNull();
      expect(find('monogram-tile')?.textContent?.trim()).toBe('K');
    });

    it('renders a monogram for a null slug', () => {
      const { find } = render(null, 'Sequential Thinking');
      expect(find('monogram-tile')?.textContent?.trim()).toBe('S');
    });

    it('passes its size to the monogram', () => {
      const { find } = render(null, 'Neon', 'lg');
      expect(find('monogram-tile')?.classList.contains('h-14')).toBe(true);
    });

    it('swaps between artwork and monogram when the slug changes', () => {
      const { fixture, find } = render(null, 'Airtable');
      expect(find('monogram-tile')).not.toBeNull();
      fixture.componentRef.setInput('brandSlug', PLAIN_SLUG);
      fixture.detectChanges();
      expect(find('monogram-tile')).toBeNull();
      expect(find('brand-mark-art')).not.toBeNull();
    });
  });

  it('is decorative: the host is aria-hidden', () => {
    expect(render(PLAIN_SLUG).host.getAttribute('aria-hidden')).toBe('true');
    expect(render(null).host.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no theme input and injects nothing; never binds innerHTML', () => {
    const source = readFileSync(
      join(__dirname, 'brand-mark.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bonDark\s*=\s*input/);
    expect(source).not.toMatch(/\binject\(/);
    expect(source).not.toContain('innerHTML');
    expect(source).toContain("[data-theme-mode='dark']");
  });
});
