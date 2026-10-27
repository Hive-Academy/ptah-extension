import { TestBed } from '@angular/core/testing';
import { LaneSubtotalTileComponent } from './lane-subtotal-tile.component';
import {
  LANE_CAPTION,
  LANES_SUBTOTAL_TILE_ID,
  type LaneSubtotalTileModel,
} from './stats-limit-view-model.types';

const SUBTOTAL: LaneSubtotalTileModel = {
  id: LANES_SUBTOTAL_TILE_ID,
  caption: LANE_CAPTION,
  tokensText: '≥2.6k tokens known',
  tokensValue: '≥2.6k',
  costValue: '≥$0.02',
  summary: '≥$0.02 known cost · 1 lane · 1 run · 0 cost unknown',
};

function render(
  variant: 'strip' | 'inspector',
  tile: LaneSubtotalTileModel = SUBTOTAL,
  captionShared = true,
): HTMLElement {
  TestBed.configureTestingModule({ imports: [LaneSubtotalTileComponent] });
  const fixture = TestBed.createComponent(LaneSubtotalTileComponent);
  fixture.componentRef.setInput('tile', tile);
  fixture.componentRef.setInput('variant', variant);
  fixture.componentRef.setInput('captionShared', captionShared);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** Text a sighted user sees: screen-reader-only text removed. */
function visible(el: Element | null): string {
  if (!el) return '';
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only').forEach((node) => node.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function srOnly(el: Element | null): string {
  return Array.from(el?.querySelectorAll('.sr-only') ?? [])
    .map((node) => (node.textContent ?? '').trim())
    .join(' | ');
}

const by = (root: HTMLElement, testId: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

describe('LaneSubtotalTileComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('inspector variant', () => {
    it('shows Σ, # tokens and coins cost as icons + numbers only', () => {
      const root = render('inspector');
      const row = by(root, 'lane-subtotal-tile');

      expect(row?.querySelectorAll('lucide-angular[aria-hidden="true"]')).toHaveLength(3);
      expect(visible(by(root, 'lane-subtotal-tokens'))).toBe('≥2.6k');
      expect(visible(by(root, 'lane-subtotal-cost'))).toBe('≥$0.02');
      expect(row?.className).toContain('text-[10.5px]');
      expect(visible(row)).not.toMatch(/Known subtotal|tokens known|known cost|lane|run|unknown/);
    });

    it('keeps the lower bound for screen readers', () => {
      const root = render('inspector');

      expect(srOnly(by(root, 'lane-subtotal-tokens'))).toContain('at least');
      expect(srOnly(by(root, 'lane-subtotal-cost'))).toContain('at least');
    });

    it('puts label, counts and caption behind a Σ toggle: tooltip, visible line, Escape closes', () => {
      TestBed.configureTestingModule({ imports: [LaneSubtotalTileComponent] });
      const fixture = TestBed.createComponent(LaneSubtotalTileComponent);
      fixture.componentRef.setInput('tile', SUBTOTAL);
      fixture.componentRef.setInput('variant', 'inspector');
      fixture.componentRef.setInput('captionShared', false);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const toggle = by(root, 'lane-subtotal-toggle') as HTMLButtonElement;
      const details = [
        'Known subtotal',
        '≥2.6k tokens known',
        '≥$0.02 known cost · 1 lane · 1 run · 0 cost unknown',
        'lane · not in totals',
      ].join(' · ');

      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.type).toBe('button');
      expect(toggle.getAttribute('aria-label')).toBe('Known subtotal details');
      expect(toggle.getAttribute('title')).toBe(details);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(by(root, 'lane-subtotal-detail')).toBeNull();

      toggle.click();
      fixture.detectChanges();
      const detail = by(root, 'lane-subtotal-detail');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe(detail?.id);
      expect(visible(detail)).toBe(details);
      expect(detail?.className).toContain('text-[10.5px]');

      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(by(root, 'lane-subtotal-detail')).toBeNull();
    });

    it('leaves the caption out of the detail line when the header shows it', () => {
      const root = render('inspector');
      expect(by(root, 'lane-subtotal-toggle')?.getAttribute('title')).not.toContain(LANE_CAPTION);
    });

    it('reads unknown sums as unavailable, never 0', () => {
      const root = render('inspector', {
        ...SUBTOTAL,
        tokensText: '—',
        tokensValue: '',
        costValue: '',
        summary: 'Usage unavailable',
      });

      expect(visible(by(root, 'lane-subtotal-tokens'))).toBe('—');
      expect(srOnly(by(root, 'lane-subtotal-tokens'))).toBe('Known subtotal tokens | unavailable');
      expect(srOnly(by(root, 'lane-subtotal-cost'))).toBe('Known subtotal cost | unavailable');
      expect(by(root, 'lane-subtotal-toggle')?.getAttribute('title')).not.toContain('—');
    });
  });

  it('strip variant keeps its label, sum and summary on its face', () => {
    const root = render('strip', SUBTOTAL, false);

    expect(visible(by(root, 'lane-subtotal-grid'))).toContain('Known subtotal');
    expect(visible(by(root, 'lane-subtotal-tokens'))).toBe('≥2.6k tokens known');
    expect(visible(by(root, 'lane-subtotal-summary'))).toBe(SUBTOTAL.summary);
    expect(visible(by(root, 'lane-subtotal-caption'))).toBe(LANE_CAPTION);
  });
});
