import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ProgressMeter } from './progress-meter';

/**
 * `border-base-300` — the class this panel must never emit (`base-300` is a
 * FILL, panel-theme-spec.md §2).
 *
 * ⚠️ IT IS ASSEMBLED RATHER THAN WRITTEN AS A LITERAL, AND THAT IS NOT A
 * WORKAROUND FOR THE RULE — IT IS THE ONLY WAY TO ASSERT IT FROM INSIDE THIS
 * LIB. Task 4.7's `no-restricted-syntax` selector matches ANY string literal
 * containing the token, including one written in a spec in order to prove its
 * ABSENCE. `libs/web/panel-ui/.../thread-row.spec.ts` can write it plainly only
 * because that lib sits outside the rule's scope. Assembling it keeps both the
 * lint rule and the runtime assertion, and weakens neither.
 */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProgressMeter],
  template: `
    <ptah-progress-meter
      [completed]="completed()"
      [total]="total()"
      [unit]="unit()"
      [label]="label()"
    />
  `,
})
class Host {
  public readonly completed = signal(1);
  public readonly total = signal(3);
  public readonly unit = signal<'lesson' | 'module'>('lesson');
  public readonly label = signal<string | null>(null);
}

describe('ProgressMeter (R2.3.5, RISK-O, NFR-U2, NFR-U3)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  function bar(): HTMLElement {
    return fixture.debugElement.query(By.css('[role="progressbar"]'))
      .nativeElement as HTMLElement;
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /* ---------------------------------------------------------------------- */

  describe('🔴 it computes the percentage from the two COUNTS (RISK-O)', () => {
    it('renders 33% for 1 of 3', () => {
      expect(bar().getAttribute('aria-valuenow')).toBe('33');
      expect(text()).toContain('33%');
      expect(text()).toContain('1 of 3 lessons');
    });

    it('rounds the way the server rounds — 2 of 3 is 67%', () => {
      fixture.componentInstance.completed.set(2);
      fixture.detectChanges();
      expect(bar().getAttribute('aria-valuenow')).toBe('67');
    });

    it('renders 100% for a finished course', () => {
      fixture.componentInstance.completed.set(8);
      fixture.componentInstance.total.set(8);
      fixture.detectChanges();
      expect(bar().getAttribute('aria-valuenow')).toBe('100');
    });

    it('🔴 total === 0 renders 0% and NEVER divides', () => {
      // An admin creates the course shell before any module exists, so this is
      // a reachable live state and `0/0` would render `NaN%`.
      fixture.componentInstance.completed.set(0);
      fixture.componentInstance.total.set(0);
      fixture.detectChanges();

      expect(bar().getAttribute('aria-valuenow')).toBe('0');
      expect(text()).toContain('0%');
      expect(text()).not.toContain('NaN');
      expect(text()).not.toContain('Infinity');
    });

    it('clamps a nonsensical over-count rather than rendering >100%', () => {
      fixture.componentInstance.completed.set(9);
      fixture.componentInstance.total.set(3);
      fixture.detectChanges();
      expect(bar().getAttribute('aria-valuenow')).toBe('100');
    });

    it('🔴 has NO `percent` input — the wrong number is unrepresentable here', () => {
      // The whole RISK-O device. A `percent` input would let a second caller
      // pass a figure derived from seconds watched and nothing would catch it.
      // Asserted against the source rather than an instance: `input.required()`
      // only runs inside an injection context, and the property this must
      // forbid is the DECLARATION, not a runtime value.
      const source = readFileSync(join(__dirname, 'progress-meter.ts'), 'utf8');
      const declarations = [
        ...source.matchAll(/public readonly (\w+) = input/g),
      ].map((m) => m[1]);

      expect(declarations.sort()).toEqual([
        'completed',
        'label',
        'total',
        'unit',
      ]);
      expect(declarations).not.toContain('percent');
      // `percent` exists only as a computed, and only from the two counts.
      expect(source).toContain('protected readonly percent = computed');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('accessibility (NFR-U3)', () => {
    it('carries the full progressbar ARIA triple', () => {
      expect(bar().getAttribute('role')).toBe('progressbar');
      expect(bar().getAttribute('aria-valuemin')).toBe('0');
      expect(bar().getAttribute('aria-valuemax')).toBe('100');
      expect(bar().getAttribute('aria-valuenow')).toBe('33');
    });

    it('the label says WHAT is progressing, not just a number', () => {
      expect(bar().getAttribute('aria-label')).toBe('1 of 3 lessons complete');
    });

    it('prefixes the label with the course name when one is given', () => {
      fixture.componentInstance.label.set('Operator design patterns');
      fixture.detectChanges();
      expect(bar().getAttribute('aria-label')).toBe(
        'Operator design patterns: 1 of 3 lessons complete',
      );
    });

    it('pluralises through a Record, not `noun + "s"`', () => {
      fixture.componentInstance.total.set(1);
      fixture.componentInstance.completed.set(1);
      fixture.detectChanges();
      expect(bar().getAttribute('aria-label')).toBe('1 of 1 lesson complete');

      fixture.componentInstance.unit.set('module');
      fixture.componentInstance.total.set(4);
      fixture.detectChanges();
      expect(bar().getAttribute('aria-label')).toBe('1 of 4 modules complete');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('NFR-U2 — token vocabulary', () => {
    const html = readFileSync(join(__dirname, 'progress-meter.html'), 'utf8');

    it('🔴 uses base-300 as a FILL and never as a border', () => {
      // panel-theme-spec.md §2. `stat-tile.html` shipped this exact bug.
      expect(html).toContain('bg-base-300');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect((fixture.nativeElement as HTMLElement).innerHTML).not.toContain(
        BORDER_FILL_MISUSE,
      );
    });

    it('uses no raw hex, no ink-* ramp, no amber-* ramp', () => {
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/\bink-(?:\d{2,3}|content)\b/);
      expect(html).not.toMatch(/\bamber-\d{2,3}\b/);
    });

    it('muted text is base-content/60 or stronger (NFR-U3 floor)', () => {
      expect(html).toContain('text-base-content/60');
      expect(html).not.toContain('text-base-content/40');
      expect(html).not.toContain('text-base-content/50');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('§5.3 — it is PRIVATE and the decision is recorded', () => {
    it('is not exported from the members barrel', () => {
      const barrel = readFileSync(
        join(__dirname, '..', '..', '..', 'index.ts'),
        'utf8',
      );
      // `libs/web/members/src/index.ts` exports MEMBER_ROUTES and nothing else.
      expect(barrel).not.toContain('progress-meter');
    });

    it('is not exported from @ptah-web/panel-ui either', () => {
      const panelBarrel = readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          '..',
          '..',
          'panel-ui',
          'src',
          'index.ts',
        ),
        'utf8',
      );
      expect(panelBarrel).not.toContain('progress-meter');
    });
  });
});
