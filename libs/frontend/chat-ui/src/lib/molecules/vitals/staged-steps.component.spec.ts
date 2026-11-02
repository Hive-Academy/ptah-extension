import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import {
  StagedStepsComponent,
  type StagedStep,
} from './staged-steps.component';

const STEPS: readonly StagedStep[] = [
  { id: 'git', label: 'Git status', state: 'done', detail: '14 changed' },
  {
    id: 'scan',
    label: 'Scanning files',
    state: 'active',
    done: 240,
    total: 412,
  },
  { id: 'usage', label: 'Usage history', state: 'pending' },
];

describe('StagedStepsComponent', () => {
  let fixture: ComponentFixture<StagedStepsComponent>;
  let host: HTMLElement;

  function render(steps: readonly StagedStep[]): void {
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('ariaLabel', 'Preparing workspace');
    fixture.detectChanges();
  }

  function row(id: number): HTMLElement {
    return host.querySelectorAll('li')[id] as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StagedStepsComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(StagedStepsComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('is a labelled list inside a busy status region', () => {
    render(STEPS);

    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    const list = status?.querySelector('[role="list"]');
    expect(list?.getAttribute('aria-label')).toBe('Preparing workspace');
    expect(list?.querySelectorAll('li')).toHaveLength(3);
  });

  it('pairs every row with an icon or the pulse, and a state word, not colour alone', () => {
    render(STEPS);

    const words = Array.from(host.querySelectorAll('li .sr-only')).map((node) =>
      node.textContent?.trim(),
    );
    expect(words).toEqual([', done', ', in progress', ', pending']);
    for (const item of Array.from(host.querySelectorAll('li'))) {
      const icon = item.querySelector('lucide-angular');
      const pulse = item.querySelector('.ptah-staged-steps__pulse');
      expect(Boolean(icon) !== Boolean(pulse)).toBe(true);
      const marker = (icon ?? pulse) as Element;
      expect(marker.getAttribute('aria-hidden')).toBe('true');
    }
    expect(row(0).getAttribute('data-state')).toBe('done');
  });

  it('draws the pulse on the active row instead of an icon', () => {
    render(STEPS);

    expect(row(1).querySelector('.ptah-staged-steps__pulse')).not.toBeNull();
    expect(row(1).querySelector('lucide-angular')).toBeNull();
    expect(row(0).querySelector('.ptah-staged-steps__pulse')).toBeNull();
    expect(row(2).querySelector('.ptah-staged-steps__pulse')).toBeNull();
  });

  it('gives the active row a determinate bar when the total is known', () => {
    render(STEPS);

    const bar = row(1).querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('412');
    expect(bar.getAttribute('aria-valuenow')).toBe('240');
    expect(bar.getAttribute('aria-label')).toBe('Scanning files');
    const fill = bar.querySelector('.ptah-staged-steps__fill') as HTMLElement;
    expect(fill.style.transform).toBe(`scaleX(${240 / 412})`);
    expect(row(1).querySelector('.ptah-staged-steps__aside')?.textContent).toBe(
      '240 / 412',
    );
  });

  it('gives the active row an indeterminate bar without a total', () => {
    render([{ id: 'idx', label: 'Indexing', state: 'active' }]);

    const bar = row(0).querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.classList).toContain('ptah-staged-steps__bar--indeterminate');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.querySelector('.ptah-staged-steps__sweep')).toBeTruthy();
  });

  it('draws bars only on the active row', () => {
    render(STEPS);

    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  });

  it('shows the detail in the aside, preferring it over counts', () => {
    render([
      { id: 'a', label: 'A', state: 'done', done: 3, total: 3, detail: 'ok' },
    ]);

    expect(row(0).querySelector('.ptah-staged-steps__aside')?.textContent).toBe(
      'ok',
    );
  });

  it('clamps done to the total', () => {
    render([{ id: 'a', label: 'A', state: 'active', done: 900, total: 10 }]);

    const bar = row(0).querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('10');
  });

  it.each([
    [[{ id: 'a', label: 'A', state: 'done' }], 'false'],
    [
      [
        { id: 'a', label: 'A', state: 'failed' },
        { id: 'b', label: 'B', state: 'pending' },
      ],
      'false',
    ],
    [[{ id: 'a', label: 'A', state: 'pending' }], 'true'],
  ] as const)('sets aria-busy for %j to %s', (steps, busy) => {
    render(steps);

    expect(
      host.querySelector('[role="status"]')?.getAttribute('aria-busy'),
    ).toBe(busy);
  });

  it('hides the ticking count aside from the live region but keeps details', () => {
    render(STEPS);

    const aside = (i: number): Element | null =>
      row(i).querySelector('.ptah-staged-steps__aside');
    expect(aside(1)?.getAttribute('aria-hidden')).toBe('true');
    expect(aside(0)?.hasAttribute('aria-hidden')).toBe(false);
    expect(row(1).querySelector('.sr-only')?.textContent?.trim()).toBe(
      ', in progress',
    );
  });

  it('turns the indeterminate sweep into a full-width faint fill under reduce', () => {
    const css = readFileSync(
      join(__dirname, 'staged-steps.component.ts'),
      'utf8',
    );
    const media =
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/.exec(css);
    expect(media).not.toBeNull();
    const rest = css.slice((media?.index ?? 0) + (media?.[0].length ?? 0));
    const sweep =
      /\.ptah-staged-steps__sweep\s*\{([^}]*)\}/.exec(rest)?.[1] ?? '';
    expect(sweep).toMatch(/width\s*:\s*100%\s*;/);
    const opacity = /opacity\s*:\s*([\d.]+)\s*;/.exec(sweep)?.[1];
    expect(Number(opacity)).toBeGreaterThan(0);
    expect(Number(opacity)).toBeLessThan(1);
  });

  it('animates only transforms, only under no-preference', () => {
    const flat = readFileSync(
      join(__dirname, 'staged-steps.component.ts'),
      'utf8',
    ).replace(/\s+/g, ' ');
    const keyframes = flat.match(
      /@keyframes [\w-]+ \{(?:[^{}]*\{[^}]*\})+ \}/g,
    );
    expect(keyframes?.length).toBe(1);
    for (const block of keyframes ?? []) {
      const properties = [...block.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(properties.every((name) => name === 'transform')).toBe(true);
    }
    const all = flat.match(/\banimation:/g) ?? [];
    const gated =
      flat
        .split(/@media \( ?prefers-reduced-motion: no-preference ?\)/)[1]
        ?.split('@keyframes')[0] ?? '';
    expect((gated.match(/\banimation:/g) ?? []).length).toBe(all.length);
  });
});
