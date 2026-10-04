import axe from 'axe-core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TurnTestRun } from '@ptah-extension/shared';
import { TurnTestsRowComponent } from './turn-tests-row.component';

function run(command: string, outcome: TurnTestRun['outcome']): TurnTestRun {
  return { command, outcome };
}

describe('TurnTestsRowComponent', () => {
  let fixture: ComponentFixture<TurnTestsRowComponent>;

  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null =>
    native().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => [
    ...native().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
  ];
  const text = (node: Element | null): string =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(runs: readonly TurnTestRun[], incomplete = false): void {
    fixture.componentRef.setInput('runs', runs);
    fixture.componentRef.setInput('incomplete', incomplete);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TurnTestsRowComponent] });
    fixture = TestBed.createComponent(TurnTestsRowComponent);
  });

  it('renders nothing for an empty list', () => {
    render([]);

    expect(query('turn-tests-row')).toBeNull();
    expect(native().textContent?.trim() ?? '').toBe('');
  });

  it('shows the right counts for a mixed list', () => {
    render([
      run('nx test chat', 'passed'),
      run('npx nx run-many -t lint,test', 'passed'),
      run('npx jest foo', 'failed'),
      run('pnpm vitest run', 'unknown'),
    ]);

    expect(text(query('turn-tests-summary'))).toBe(
      '2 passed, 1 failed, 1 unknown',
    );
  });

  it('shows just "unknown" for an all-unknown list', () => {
    render([run('npx jest foo', 'unknown'), run('nx test chat', 'unknown')]);

    expect(text(query('turn-tests-summary'))).toBe('unknown');
  });

  it('lists each run in execution order as outcome word plus command', () => {
    render([
      run('nx test chat', 'failed'),
      run('npx jest foo', 'unknown'),
      run('pnpm vitest run', 'passed'),
    ]);

    // The row is a flex pair: the visual gap comes from `gap-1.5`, so the
    // concatenated textContent has no space — assert the row's own spans.
    const rows = queryAll('turn-tests-run');
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => [
        text(row.querySelector('[data-testid="turn-tests-run-outcome"]')),
        text(row.querySelector('[data-testid="turn-tests-run-command"]')),
      ]),
    ).toEqual([
      ['failed', 'nx test chat'],
      ['unknown', 'npx jest foo'],
      ['passed', 'pnpm vitest run'],
    ]);
  });

  it.each(['passed', 'failed', 'unknown'] as const)(
    'spells the %s outcome as text, never colour alone',
    (outcome) => {
      render([run('npx cmd', outcome)]);

      expect(text(query('turn-tests-run-outcome'))).toBe(outcome);
    },
  );

  it('marks an aborted turn "(incomplete)" only when told', () => {
    render([run('nx test chat', 'failed')]);
    expect(query('turn-tests-incomplete')).toBeNull();

    render([run('nx test chat', 'failed')], true);
    expect(text(query('turn-tests-incomplete'))).toBe('(incomplete)');
  });

  it('labels the row a status region naming the outcome', () => {
    render([run('nx test chat', 'passed'), run('npx jest foo', 'failed')], true);

    const root = query('turn-tests-row');
    expect(root?.getAttribute('role')).toBe('status');
    expect(root?.getAttribute('aria-label')).toBe(
      'Tests: 1 passed, 1 failed (incomplete)',
    );
  });

  it('renders no file or +/- counts content (the change-set card owns that)', () => {
    render([run('nx test chat', 'passed'), run('pnpm vitest run', 'failed')]);

    expect(native().textContent ?? '').not.toMatch(/[+-]\d+/);
  });

  it('has no axe violations with a mixed, incomplete list', async () => {
    render(
      [
        run('nx test chat', 'failed'),
        run('npx jest foo', 'unknown'),
        run('pnpm vitest run', 'passed'),
      ],
      true,
    );

    const results = await axe.run(
      native() as Parameters<typeof axe.run>[0],
      {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      },
    );

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
