/**
 * The verdict panel is the one surface where being wrong is expensive: it
 * reports what a judge said about work the user is about to trust.
 *
 * So the assertions below are mostly about what must NOT appear — no PASS from
 * an unreadable report (AC-5.2), no revise affordance on a REJECT (AC-5.5), no
 * severity word remapped onto a friendlier one, and no defect resurrected that
 * the parser dropped (AC-5.3). Driven from `TribunalProgress` fixtures; no live
 * run is involved (R10).
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { CrucibleVerdictPanelComponent } from './crucible-verdict-panel.component';
import type {
  CrucibleDefect,
  CrucibleRound,
  CrucibleTermination,
  CrucibleVerdict,
  TribunalProgress,
} from '../types/tribunal-ui.types';

/**
 * Stubbed so the suite does not boot ngx-markdown, but kept as a REAL
 * component with the same selector and input — the panel must still bind the
 * mentor note to the markdown chokepoint, and the stub records what it got.
 */
@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span data-testid="markdown-stub">{{ content() }}</span>`,
})
class MarkdownBlockStub {
  readonly content = input.required<string>();
  readonly variant = input<'invert' | 'auto'>('invert');
}

function defect(overrides: Partial<CrucibleDefect> = {}): CrucibleDefect {
  return {
    id: 'D1',
    severity: 'blocking',
    location: 'libs/a/b.ts:42',
    what: 'The guard is never called',
    expected: 'Call it before the write',
    ...overrides,
  };
}

function round(
  n: number,
  verdict: CrucibleVerdict,
  overrides: Partial<CrucibleRound> = {},
): CrucibleRound {
  return {
    round: n,
    verdict,
    defects: [],
    mentorNote: null,
    ...overrides,
  };
}

function crucible(
  rounds: readonly CrucibleRound[],
  termination: CrucibleTermination,
  opts: { roundCap?: number; currentRound?: number } = {},
): TribunalProgress {
  return {
    kind: 'crucible',
    roundCap: opts.roundCap ?? 2,
    currentRound: opts.currentRound ?? Math.max(1, rounds.length),
    rounds,
    termination,
  };
}

describe('CrucibleVerdictPanelComponent', () => {
  let fixture: ComponentFixture<CrucibleVerdictPanelComponent>;

  function render(progress: TribunalProgress): void {
    fixture = TestBed.createComponent(CrucibleVerdictPanelComponent);
    fixture.componentRef.setInput('progress', progress);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function chip(): HTMLElement {
    return fixture.debugElement.query(
      By.css('[data-testid="tribunal-verdict-chip"]'),
    ).nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CrucibleVerdictPanelComponent],
    }).overrideComponent(CrucibleVerdictPanelComponent, {
      remove: { imports: [MarkdownBlockComponent] },
      add: { imports: [MarkdownBlockStub] },
    });
  });

  describe('round counter (AC-5.1)', () => {
    it('shows the round and the cap', () => {
      render(crucible([round(1, 'revise')], 'in-progress', { roundCap: 2 }));

      expect(
        (
          fixture.debugElement.query(
            By.css('[data-testid="tribunal-round-counter"]'),
          ).nativeElement as HTMLElement
        ).textContent,
      ).toContain('Round 1 of 2');
    });

    it('renders a user-authorised round past the cap rather than clamping it (R3)', () => {
      render(
        crucible([round(1, 'revise'), round(2, 'revise')], 'in-progress', {
          roundCap: 2,
          currentRound: 3,
        }),
      );

      expect(text()).toContain('Round 3 of 2');
      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-round-over-cap"]'),
        ),
      ).not.toBeNull();
    });
  });

  describe('verdict chip (AC-5.2)', () => {
    it.each<[CrucibleVerdict, string]>([
      ['pass', 'PASS'],
      ['revise', 'REVISE'],
      ['reject', 'REJECT'],
    ])('renders %s distinctly', (verdict, label) => {
      render(crucible([round(1, verdict)], 'in-progress'));

      expect(chip().textContent).toContain(label);
      expect(chip().getAttribute('data-verdict')).toBe(verdict);
    });

    it('renders an UNPARSED verdict as "awaiting verdict", never as PASS', () => {
      render(crucible([round(1, 'unparsed')], 'in-progress'));

      expect(chip().getAttribute('data-verdict')).toBe('awaiting');
      expect(chip().textContent).toContain('Awaiting verdict');
      expect(chip().textContent).not.toContain('PASS');
    });

    it('renders a MISSING verdict as "awaiting verdict", never as PASS', () => {
      render(crucible([], 'in-progress'));

      expect(chip().getAttribute('data-verdict')).toBe('awaiting');
      expect(text()).not.toContain('PASS');
      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-no-rounds"]'),
        ),
      ).not.toBeNull();
    });
  });

  describe('defects (AC-5.3)', () => {
    it('renders severity and file:line for each defect', () => {
      render(
        crucible(
          [round(1, 'revise', { defects: [defect(), defect({ id: 'D2' })] })],
          'in-progress',
        ),
      );

      const defects = fixture.debugElement.queryAll(
        By.css('[data-testid="tribunal-defect"]'),
      );
      expect(defects).toHaveLength(2);
      expect(text()).toContain('libs/a/b.ts:42');
      expect(text()).toContain('The guard is never called');
      expect(text()).toContain('Expected: Call it before the write');
    });

    it('keeps a Windows file:line citation intact', () => {
      render(
        crucible(
          [
            round(1, 'revise', {
              defects: [defect({ location: 'D:\\projects\\x\\foo.ts:42' })],
            }),
          ],
          'in-progress',
        ),
      );

      expect(
        (
          fixture.debugElement.query(
            By.css('[data-testid="tribunal-defect-location"]'),
          ).nativeElement as HTMLElement
        ).textContent,
      ).toContain('D:\\projects\\x\\foo.ts:42');
    });

    it('renders severity "unknown" literally — never remapped onto major', () => {
      // B2 kept an evidenced defect with an off-contract severity word instead
      // of dropping it, and refused to relabel it `major`. Relabelling it here
      // would reintroduce that bug at the render layer.
      render(
        crucible(
          [round(1, 'revise', { defects: [defect({ severity: 'unknown' })] })],
          'in-progress',
        ),
      );

      const severity = fixture.debugElement.query(
        By.css('[data-testid="tribunal-defect-severity"]'),
      ).nativeElement as HTMLElement;
      expect(severity.textContent?.trim()).toBe('unknown');
      expect(text()).not.toContain('major');
    });

    it('renders no defect list when the parser dropped them all', () => {
      render(crucible([round(1, 'revise', { defects: [] })], 'in-progress'));

      expect(
        fixture.debugElement.query(By.css('[data-testid="tribunal-defects"]')),
      ).toBeNull();
    });
  });

  describe('mentor note (AC-5.4 / AC-5.7)', () => {
    it('renders the note through the markdown chokepoint, with its round', () => {
      render(
        crucible(
          [
            round(1, 'revise', {
              mentorNote: 'Read the guard before the write.',
            }),
            round(2, 'pass', { mentorNote: 'Much better.' }),
          ],
          'pass',
        ),
      );

      const notes = fixture.debugElement.queryAll(
        By.css('[data-testid="tribunal-mentor-note"]'),
      );
      expect(notes).toHaveLength(2);
      expect((notes[0].nativeElement as HTMLElement).textContent).toContain(
        'round 1',
      );
      expect((notes[0].nativeElement as HTMLElement).textContent).toContain(
        'Read the guard before the write.',
      );

      const stubs = fixture.debugElement.queryAll(
        By.directive(MarkdownBlockStub),
      );
      expect(stubs).toHaveLength(2);
      expect((stubs[1].componentInstance as MarkdownBlockStub).content()).toBe(
        'Much better.',
      );
    });

    it('renders no note block when the judge wrote none', () => {
      render(crucible([round(1, 'revise')], 'in-progress'));

      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-mentor-note"]'),
        ),
      ).toBeNull();
    });

    it('escapes an injected payload in defect text rather than rendering it', () => {
      render(
        crucible(
          [
            round(1, 'revise', {
              defects: [defect({ what: '<img src=x onerror="alert(1)">' })],
            }),
          ],
          'in-progress',
        ),
      );

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('img')).toBeNull();
      expect(
        (
          fixture.debugElement.query(
            By.css('[data-testid="tribunal-defect-what"]'),
          ).nativeElement as HTMLElement
        ).textContent,
      ).toContain('<img src=x onerror="alert(1)">');
    });
  });

  describe('terminal states (AC-5.5 / AC-5.6)', () => {
    function terminationKind(): string | null {
      return (
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-termination"]'),
        ).nativeElement as HTMLElement
      ).getAttribute('data-termination');
    }

    it('labels PASS as the judge’s opinion, still to be verified against the build', () => {
      render(crucible([round(1, 'pass')], 'pass'));

      expect(terminationKind()).toBe('pass');
      expect(text()).toContain('opinion');
      expect(text()).toContain('build');
    });

    it('distinguishes a cap reached with defects still open', () => {
      render(
        crucible(
          [round(1, 'revise'), round(2, 'revise', { defects: [defect()] })],
          'cap-reached-with-defects',
        ),
      );

      expect(terminationKind()).toBe('cap-reached-with-defects');
      expect(text()).toContain('cap');
    });

    it('distinguishes a regression stop', () => {
      render(
        crucible([round(1, 'revise'), round(2, 'revise')], 'regression-stop'),
      );

      expect(terminationKind()).toBe('regression-stop');
      expect(text()).toContain('did not go down');
    });

    it('states REJECT stopped the loop and offers NO revise affordance (AC-5.5)', () => {
      render(crucible([round(1, 'reject', { defects: [defect()] })], 'reject'));

      expect(terminationKind()).toBe('reject');
      expect(text()).toContain('not a revisable round');
      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-revise-note"]'),
        ),
      ).toBeNull();
    });

    it('shows the next-round note ONLY while an open loop sits on a REVISE', () => {
      render(crucible([round(1, 'revise')], 'in-progress'));

      expect(
        (
          fixture.debugElement.query(
            By.css('[data-testid="tribunal-revise-note"]'),
          ).nativeElement as HTMLElement
        ).textContent,
      ).toContain('round 2');
    });

    it('offers no next-round note once the cap stopped the loop', () => {
      render(
        crucible(
          [round(1, 'revise'), round(2, 'revise')],
          'cap-reached-with-defects',
        ),
      );

      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-revise-note"]'),
        ),
      ).toBeNull();
    });

    it('shows no terminal banner while the loop is open', () => {
      render(crucible([round(1, 'revise')], 'in-progress'));

      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-termination"]'),
        ),
      ).toBeNull();
    });
  });

  describe('unavailable (AC-4.5 / R1)', () => {
    it('says progress is unavailable instead of claiming any verdict', () => {
      render({
        kind: 'unavailable',
        reason: 'Round 1’s judge report could not be read: EACCES.',
      });

      const panel = fixture.debugElement.query(
        By.css('[data-testid="tribunal-verdict-unavailable"]'),
      );
      expect(panel).not.toBeNull();
      expect((panel.nativeElement as HTMLElement).textContent).toContain(
        'EACCES',
      );
      expect(
        fixture.debugElement.query(
          By.css('[data-testid="tribunal-verdict-chip"]'),
        ),
      ).toBeNull();
      expect(text()).not.toContain('PASS');
    });

    it('renders nothing for a flat move', () => {
      render({ kind: 'none' });

      expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe(
        '',
      );
    });
  });
});
