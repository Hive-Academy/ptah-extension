import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressRingComponent } from './progress-ring.component';

describe('ProgressRingComponent', () => {
  let fixture: ComponentFixture<ProgressRingComponent>;
  let host: HTMLElement;

  function render(inputs: {
    value: number | null;
    ariaLabel?: string;
    centerText?: string;
    subText?: string;
    tone?: 'gold' | 'teal';
    size?: 'value' | 'lg';
  }): void {
    fixture.componentRef.setInput('value', inputs.value);
    fixture.componentRef.setInput('ariaLabel', inputs.ariaLabel ?? 'Plan 38%');
    if (inputs.centerText !== undefined)
      fixture.componentRef.setInput('centerText', inputs.centerText);
    if (inputs.subText !== undefined)
      fixture.componentRef.setInput('subText', inputs.subText);
    if (inputs.tone) fixture.componentRef.setInput('tone', inputs.tone);
    if (inputs.size) fixture.componentRef.setInput('size', inputs.size);
    fixture.detectChanges();
  }

  function arc(): SVGCircleElement {
    return host.querySelector('.ptah-ring__arc') as SVGCircleElement;
  }

  function dash(): [number, number] {
    const [length, total] = (arc().getAttribute('stroke-dasharray') ?? '')
      .split(' ')
      .map(Number);
    return [length, total];
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressRingComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ProgressRingComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('is one image with the caller accessible name and a hidden svg', () => {
    render({ value: 0.38, ariaLabel: 'Plan: 38% used' });

    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Plan: 38% used');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the arc as the value fraction of the circumference', () => {
    render({ value: 0.25 });

    const [length, total] = dash();
    expect(length / total).toBeCloseTo(0.25, 5);
    expect(arc().getAttribute('transform')).toBe('rotate(-90 28 28)');
  });

  it('clamps out-of-range values and hides a zero-length arc', () => {
    render({ value: 1.7 });
    expect(dash()[0]).toBeCloseTo(dash()[1], 5);

    fixture.componentRef.setInput('value', -1);
    fixture.detectChanges();
    expect(dash()[0]).toBe(0);
    expect(arc().getAttribute('opacity')).toBe('0');
  });

  it.each([
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 0],
  ])('clamps %s to a fraction of %d', (value, expected) => {
    render({ value });

    const [length, total] = dash();
    expect(length / total).toBeCloseTo(expected, 5);
    expect(host.classList).not.toContain('ptah-ring--indeterminate');
  });

  it('treats NaN as indeterminate', () => {
    render({ value: Number.NaN });

    expect(host.classList).toContain('ptah-ring--indeterminate');
    const [length, total] = dash();
    expect(length / total).toBeCloseTo(0.25, 5);
  });

  it('marks a null value indeterminate with a quarter arc', () => {
    render({ value: null });

    expect(host.classList).toContain('ptah-ring--indeterminate');
    const [length, total] = dash();
    expect(length / total).toBeCloseTo(0.25, 5);
  });

  it('uses a 56-unit viewbox with stroke 6 for size value', () => {
    render({ value: 0.5 });

    expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '0 0 56 56',
    );
    expect(arc().getAttribute('stroke-width')).toBe('6');
    expect(host.classList).not.toContain('ptah-ring--lg');
  });

  it('uses a 112-unit viewbox with stroke 10 for size lg', () => {
    render({ value: 0.5, size: 'lg' });

    expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '0 0 112 112',
    );
    expect(arc().getAttribute('stroke-width')).toBe('10');
    expect(host.classList).toContain('ptah-ring--lg');
    expect(host.style.width).toBe('112px');
    expect(host.style.height).toBe('112px');
  });

  it('leaves the value ring sized by the stylesheet variable', () => {
    render({ value: 0.5 });

    expect(host.style.width).toBe('');
    expect(host.style.height).toBe('');
  });

  // jest-preset-angular strips component styles, so the declared CSS is read
  // from source (jsdom does no layout either way).
  it('sizes the value ring from the stat value-row height variable', () => {
    const source = readFileSync(
      join(__dirname, 'progress-ring.component.ts'),
      'utf8',
    );

    const sizeVar = String.raw`var\(\s*--ptah-stat-value-h\s*,\s*56px\s*\)`;
    expect(source).toMatch(new RegExp(String.raw`\bwidth\s*:\s*${sizeVar}`));
    expect(source).toMatch(new RegExp(String.raw`\bheight\s*:\s*${sizeVar}`));
  });

  /** Brace-balanced body of the block that opens at or after `from`. */
  function blockAt(source: string, from: number): string {
    const open = source.indexOf('{', from);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) {
        return source.slice(open + 1, i);
      }
    }
    return source.slice(open + 1);
  }

  it.each([
    'progress-ring.component.ts',
    'spend-bars.component.ts',
    'activity-grid.component.ts',
  ])('%s animates only opacity/transform, only under no-preference', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');

    const keyframes = [...source.matchAll(/@keyframes\b/g)].map((match) =>
      blockAt(source, match.index ?? 0),
    );
    expect(keyframes.length).toBeGreaterThan(0);
    for (const body of keyframes) {
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map(
        (match) => match[1],
      );
      expect(properties.length).toBeGreaterThan(0);
      expect(
        properties.every((name) => ['opacity', 'transform'].includes(name)),
      ).toBe(true);
    }

    const gate =
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/g;
    const gated = [...source.matchAll(gate)]
      .map((match) => blockAt(source, match.index ?? 0))
      .join('\n');
    const countAnimations = (text: string): number =>
      (text.match(/\banimation\s*:/g) ?? []).length;
    expect(countAnimations(gated)).toBeGreaterThan(0);
    expect(countAnimations(gated)).toBe(countAnimations(source));
  });

  it('exposes the tone for the teal plan ink', () => {
    render({ value: 0.5, tone: 'teal' });

    expect(host.getAttribute('data-tone')).toBe('teal');
  });

  it('renders centre and sub text hidden from assistive tech', () => {
    render({ value: 0.67, centerText: '2/3', subText: 'ready', size: 'lg' });

    const center = host.querySelector('.ptah-ring__center');
    expect(center?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.ptah-ring__value')?.textContent).toBe('2/3');
    expect(host.querySelector('.ptah-ring__sub')?.textContent).toBe('ready');
  });

  it('renders no centre block when both texts are empty', () => {
    render({ value: 0.5 });

    expect(host.querySelector('.ptah-ring__center')).toBeNull();
  });
});
