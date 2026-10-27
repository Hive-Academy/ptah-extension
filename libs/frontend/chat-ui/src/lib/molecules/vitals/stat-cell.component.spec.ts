import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Gauge } from 'lucide-angular';

import { StatCellComponent, type StatCellState } from './stat-cell.component';
import { StatValueComponent } from './stat-value.component';

@Component({
  standalone: true,
  imports: [StatCellComponent, StatValueComponent],
  template: `
    <ptah-stat-cell
      [label]="label()"
      [state]="state()"
      [caption]="caption()"
      [icon]="icon()"
    >
      <ptah-stat-value text="$12.40" />
    </ptah-stat-cell>
  `,
})
class CellHostComponent {
  readonly label = signal('Spend 7d');
  readonly state = signal<StatCellState>('ready');
  readonly caption = signal<string | null>('last 7 days');
  readonly icon = signal<typeof Gauge | null>(Gauge);
}

describe('StatCellComponent', () => {
  let fixture: ComponentFixture<CellHostComponent>;

  function cell(): HTMLElement {
    return fixture.nativeElement.querySelector('ptah-stat-cell');
  }

  function projected(): HTMLElement {
    return cell().querySelector('.ptah-stat-cell__projected') as HTMLElement;
  }

  function setState(state: StatCellState): void {
    fixture.componentInstance.state.set(state);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CellHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CellHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('is a group named by the label and described by the caption', () => {
    const host = cell();
    expect(host.getAttribute('role')).toBe('group');
    expect(host.getAttribute('aria-label')).toBe('Spend 7d');
    const captionId = host.getAttribute('aria-describedby') as string;
    expect(captionId).toBeTruthy();
    expect(host.querySelector(`#${captionId}`)?.textContent?.trim()).toBe(
      'last 7 days',
    );
  });

  it('renders the icon and the label row, hidden from assistive tech', () => {
    const label = cell().querySelector('.ptah-stat-cell__label');
    expect(label?.getAttribute('aria-hidden')).toBe('true');
    expect(label?.querySelector('lucide-angular')).toBeTruthy();
    expect(label?.textContent).toContain('Spend 7d');
  });

  it('is not busy once ready', () => {
    expect(cell().hasAttribute('aria-busy')).toBe(false);
  });

  it('falls back to the row layout without a ptah-stat-row ancestor', () => {
    // CellHostComponent has no row: the optional inject resolves to null.
    expect(cell().hasAttribute('data-stacked')).toBe(false);
    expect(cell().querySelector('.ptah-stat-cell__label')).toBeTruthy();
    expect(
      cell().querySelector('.ptah-stat-cell__caption')?.textContent?.trim(),
    ).toBe('last 7 days');
  });

  it('omits the icon when none is given', () => {
    fixture.componentInstance.icon.set(null);
    fixture.detectChanges();

    expect(cell().querySelector('lucide-angular')).toBeNull();
  });

  it('shows the projected value when ready', () => {
    expect(projected().hidden).toBe(false);
    expect(projected().textContent).toContain('$12.40');
    expect(cell().querySelector('.ptah-stat-cell__dash')).toBeNull();
  });

  it('shows a busy shimmer instead of the value while loading', () => {
    setState('loading');

    expect(projected().hidden).toBe(true);
    expect(cell().querySelector('.ptah-stat-cell__shimmer')).toBeTruthy();
    expect(cell().getAttribute('aria-busy')).toBe('true');
    expect(
      cell().querySelector('.ptah-stat-cell__value')?.hasAttribute('aria-busy'),
    ).toBe(false);
    expect(cell().querySelector('.sr-only')?.textContent).toBe('Loading');
  });

  it.each([
    ['empty', 'none'],
    ['error', 'unavailable'],
  ] as const)('shows "—" plus the caption when %s', (state, word) => {
    setState(state);

    expect(projected().hidden).toBe(true);
    const dash = cell().querySelector('.ptah-stat-cell__dash');
    expect(dash?.textContent).toBe('—');
    expect(dash?.getAttribute('aria-hidden')).toBe('true');
    expect(cell().querySelector('.sr-only')?.textContent).toBe(word);
    expect(
      cell().querySelector('.ptah-stat-cell__caption')?.textContent?.trim(),
    ).toBe('last 7 days');
  });

  it('has no caption row or description without a caption', () => {
    fixture.componentInstance.caption.set(null);
    fixture.detectChanges();

    expect(cell().querySelector('.ptah-stat-cell__caption')).toBeNull();
    expect(cell().hasAttribute('aria-describedby')).toBe(false);
  });

  it('ellipsizes the one-line caption and scales placeholders with the numeral', () => {
    const css = readFileSync(join(__dirname, 'stat-cell.component.ts'), 'utf8');
    const rule = (selector: string): string =>
      new RegExp(String.raw`${selector}\s*\{([^}]*)\}`).exec(css)?.[1] ?? '';
    const numSize = String.raw`var\(\s*--ptah-stat-num-size\s*,\s*34px\s*\)`;

    const caption = rule(String.raw`\.ptah-stat-cell__caption`);
    expect(caption).toMatch(/overflow\s*:\s*hidden\s*;/);
    expect(caption).toMatch(/text-overflow\s*:\s*ellipsis\s*;/);
    expect(rule(String.raw`\.ptah-stat-cell__dash`)).toMatch(
      new RegExp(String.raw`font-size\s*:\s*${numSize}\s*;`),
    );
    const shimmer = rule(String.raw`\.ptah-stat-cell__shimmer`);
    expect(shimmer).toMatch(
      new RegExp(String.raw`width\s*:\s*calc\(\s*${numSize}`),
    );
    expect(shimmer).toMatch(
      new RegExp(String.raw`height\s*:\s*calc\(\s*${numSize}`),
    );
    expect(css).not.toMatch(/font-size\s*:\s*34px/);
  });

  it('declares the label, caption and shimmer styles from the vg() rules', () => {
    const css = readFileSync(join(__dirname, 'stat-cell.component.ts'), 'utf8');
    const flat = css.replace(/\s+/g, ' ');

    expect(flat).toMatch(/\.ptah-stat-cell__label \{[^}]*height: 16px;/);
    expect(flat).toMatch(/\.ptah-stat-cell__label \{[^}]*font-size: 12px;/);
    expect(flat).toMatch(
      /\.ptah-stat-cell__label \{[^}]*letter-spacing: 0?\.06em;/,
    );
    expect(flat).toMatch(
      /\.ptah-stat-cell__label \{[^}]*text-transform: uppercase;/,
    );
    expect(flat).toMatch(/\.ptah-stat-cell__label \{[^}]*white-space: nowrap;/);
    expect(flat).toMatch(/\.ptah-stat-cell__value \{[^}]*align-items: center;/);
    expect(flat).toMatch(/\.ptah-stat-cell__value \{[^}]*gap: 12px;/);
    expect(flat).toMatch(
      /\.ptah-stat-cell__caption \{[^}]*font-size: 12\.5px;/,
    );
    expect(flat).toMatch(
      /\.ptah-stat-cell__caption \{[^}]*white-space: nowrap;/,
    );
    expect(flat).toMatch(
      /@media \( ?max-width: 1000px ?\) \{ \.ptah-stat-cell__caption \{[^}]*white-space: normal;/,
    );
    expect(flat).toMatch(
      /@media \( ?prefers-reduced-motion: no-preference ?\) \{ \.ptah-stat-cell__shimmer \{[^}]*animation:/,
    );
  });
});
