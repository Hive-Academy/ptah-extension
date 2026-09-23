import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';

import {
  MONOGRAM_TINT_CLASSES,
  MonogramTileComponent,
  monogramGlyph,
  monogramTintClass,
  type MarkTileSize,
} from './monogram-tile.component';

describe('MonogramTileComponent', () => {
  function render(label: string, size?: MarkTileSize) {
    const fixture = TestBed.createComponent(MonogramTileComponent);
    fixture.componentRef.setInput('label', label);
    if (size !== undefined) fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const tile = host.querySelector(
      '[data-testid="monogram-tile"]',
    ) as HTMLElement;
    return { fixture, host, tile };
  }

  function tintOf(tile: HTMLElement): string[] {
    return MONOGRAM_TINT_CLASSES.filter((tint) =>
      tile.classList.contains(tint),
    );
  }

  it('draws the first grapheme of the label, upper-cased', () => {
    expect(render('klaviyo').tile.textContent?.trim()).toBe('K');
  });

  it('applies exactly one tint, the one the label hashes to', () => {
    const { tile } = render('Context7');
    expect(tintOf(tile)).toEqual([monogramTintClass('Context7')]);
  });

  it('keeps the glyph on base-content text so contrast never depends on the tint', () => {
    const { tile } = render('Zernio');
    expect(tile.classList.contains('text-base-content')).toBe(true);
    expect(tile.classList.contains('border-base-300')).toBe(true);
  });

  it.each<[MarkTileSize, string]>([
    ['sm', 'h-6'],
    ['md', 'h-8'],
    ['lg', 'h-14'],
  ])('sizes the %s tile with %s', (size, heightClass) => {
    expect(render('Neon', size).tile.classList.contains(heightClass)).toBe(
      true,
    );
  });

  it('defaults to the md tile', () => {
    expect(render('Neon').tile.classList.contains('h-8')).toBe(true);
  });

  it('is decorative: the host is aria-hidden', () => {
    expect(render('Canva').host.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows label changes', () => {
    const { fixture, tile } = render('Amplitude');
    fixture.componentRef.setInput('label', 'Pipedream');
    fixture.detectChanges();
    expect(tile.textContent?.trim()).toBe('P');
    expect(tintOf(tile)).toEqual([monogramTintClass('Pipedream')]);
  });

  it('imports no vendored artwork, so eager hosts stay light (R7)', () => {
    const source = readFileSync(
      join(__dirname, 'monogram-tile.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from\s+['"][^'"]*brand-marks\.generated['"]/);
    expect(source).not.toContain('BRAND_MARKS');
    expect(source).not.toContain('innerHTML');
  });
});

describe('monogramTintClass', () => {
  it('is deterministic across calls', () => {
    const labels = ['GitHub', 'Klaviyo', 'io.github.user/server', 'Σ'];
    for (const label of labels) {
      expect(monogramTintClass(label)).toBe(monogramTintClass(label));
    }
  });

  it('pins FNV-1a: fixed labels always land on the same tint', () => {
    // FNV-1a 32 of the lower-cased label, modulo the five tints. A change to
    // the hash or the tint order recolours every monogram users have seen.
    expect(monogramTintClass('')).toBe(MONOGRAM_TINT_CLASSES[0x811c9dc5 % 5]);
    expect(monogramTintClass('a')).toBe(MONOGRAM_TINT_CLASSES[0xe40c292c % 5]);
    expect(monogramTintClass('foobar')).toBe(
      MONOGRAM_TINT_CLASSES[0xbf9cf968 % 5],
    );
  });

  it('ignores case and surrounding whitespace', () => {
    expect(monogramTintClass('  GitHub ')).toBe(monogramTintClass('github'));
  });

  it('only ever returns one of the tints, and spreads labels over several', () => {
    const labels = Array.from({ length: 50 }, (_, i) => `server-${i}`);
    const seen = new Set(labels.map(monogramTintClass));
    for (const tint of seen) {
      expect(MONOGRAM_TINT_CLASSES).toContain(tint);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('uses low-alpha tints only, so base-content text stays readable', () => {
    for (const tint of MONOGRAM_TINT_CLASSES) {
      expect(tint).toMatch(/^bg-[a-z]+\/15$/);
    }
  });
});

describe('monogramGlyph', () => {
  it.each([
    ['github', 'G'],
    ['  sentry  ', 'S'],
    ['@scope/tool', 'S'],
    ['io.github.user/server', 'I'],
    ['7zip', '7'],
    ['éclair', 'É'],
    ['👩‍💻 tools', 'T'],
    ['👩‍💻', '👩‍💻'],
    ['---', '-'],
    ['', '?'],
    ['   ', '?'],
  ])('%j → %j', (label, glyph) => {
    expect(monogramGlyph(label)).toBe(glyph);
  });
});
