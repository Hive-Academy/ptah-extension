import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';

import type { MarkArtwork } from './mark-artwork';
import { MarkSvgComponent, type MarkPaint } from './mark-svg.component';

const FILL_ART: MarkArtwork = {
  viewBox: '0 0 24 24',
  kind: 'fill',
  paths: [
    { d: 'M0 0h12v12H0z', fill: '#ff0000' },
    { d: 'M12 12h12v12H12z', fill: null, fillRule: 'evenodd', opacity: 0.5 },
  ],
};

const STROKE_ART: MarkArtwork = {
  viewBox: '0 0 24 24',
  kind: 'stroke',
  paths: [
    { d: 'M3 6 L12 12 L3 18', fill: null },
    { d: 'M21 6 L12 12 L21 18', fill: null },
  ],
};

describe('MarkSvgComponent', () => {
  function render(art: MarkArtwork, paint?: MarkPaint) {
    const fixture = TestBed.createComponent(MarkSvgComponent);
    fixture.componentRef.setInput('art', art);
    if (paint !== undefined) fixture.componentRef.setInput('paint', paint);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const svg = host.querySelector('svg') as SVGSVGElement;
    const paths = Array.from(svg.querySelectorAll('path'));
    return { fixture, host, svg, paths };
  }

  it('draws one path per artwork path, in paint order, in the artwork viewBox', () => {
    const { svg, paths } = render(FILL_ART);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(paths.map((p) => p.getAttribute('d'))).toEqual([
      'M0 0h12v12H0z',
      'M12 12h12v12H12z',
    ]);
  });

  describe('fill artwork', () => {
    it('brand paint keeps each colour and paints a null fill in currentColor', () => {
      const { svg, paths } = render(FILL_ART, 'brand');
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(svg.getAttribute('stroke')).toBeNull();
      expect(paths[0].getAttribute('fill')).toBe('#ff0000');
      expect(paths[1].getAttribute('fill')).toBe('currentColor');
    });

    it('defaults to brand paint', () => {
      const { paths } = render(FILL_ART);
      expect(paths[0].getAttribute('fill')).toBe('#ff0000');
    });

    it('mono paint replaces every fill with currentColor', () => {
      const { svg, paths } = render(FILL_ART, 'mono');
      expect(svg.getAttribute('data-paint')).toBe('mono');
      expect(paths.map((p) => p.getAttribute('fill'))).toEqual([
        'currentColor',
        'currentColor',
      ]);
    });

    it('binds fill-rule and opacity only where the artwork sets them', () => {
      const { paths } = render(FILL_ART);
      expect(paths[0].hasAttribute('fill-rule')).toBe(false);
      expect(paths[0].hasAttribute('opacity')).toBe(false);
      expect(paths[1].getAttribute('fill-rule')).toBe('evenodd');
      expect(paths[1].getAttribute('opacity')).toBe('0.5');
    });
  });

  describe('stroke artwork', () => {
    it.each<MarkPaint>(['brand', 'mono'])(
      'draws an unfilled round currentColor outline with %s paint',
      (paint) => {
        const { svg, paths } = render(STROKE_ART, paint);
        expect(svg.getAttribute('data-kind')).toBe('stroke');
        expect(svg.getAttribute('fill')).toBe('none');
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(svg.getAttribute('stroke-width')).toBe('2');
        expect(svg.getAttribute('stroke-linecap')).toBe('round');
        expect(svg.getAttribute('stroke-linejoin')).toBe('round');
        for (const path of paths) {
          expect(path.hasAttribute('fill')).toBe(false);
        }
      },
    );
  });

  it('re-renders when the artwork input changes', () => {
    const { fixture, host } = render(FILL_ART);
    fixture.componentRef.setInput('art', STROKE_ART);
    fixture.detectChanges();
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('data-kind')).toBe('stroke');
    expect(svg.querySelectorAll('path')[0].getAttribute('d')).toBe(
      'M3 6 L12 12 L3 18',
    );
  });

  it('is decorative: the host and the svg are hidden from assistive technology', () => {
    const { host, svg } = render(FILL_ART);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
  });

  it('never binds innerHTML — the svg is built from attribute bindings only', () => {
    const source = readFileSync(
      join(__dirname, 'mark-svg.component.ts'),
      'utf8',
    );
    expect(source).not.toContain('innerHTML');
    expect(source).toContain('[attr.d]');
  });
});
