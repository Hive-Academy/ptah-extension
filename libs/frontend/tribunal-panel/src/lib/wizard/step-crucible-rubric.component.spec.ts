/**
 * The rubric step owns two user inputs that both cost real money if they are
 * wrong: the bar the judge grades against, and how many paid revise rounds the
 * loop may spend. Both are asserted here as VALUES the wizard receives, not as
 * rendered text — the framing forwards them verbatim.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  StepCrucibleRubricComponent,
  DEFAULT_CRUCIBLE_RUBRIC,
  MAX_CRUCIBLE_ROUND_CAP,
} from './step-crucible-rubric.component';

describe('StepCrucibleRubricComponent', () => {
  let fixture: ComponentFixture<StepCrucibleRubricComponent>;
  let rubrics: string[];
  let roundCaps: number[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StepCrucibleRubricComponent],
    });
    fixture = TestBed.createComponent(StepCrucibleRubricComponent);
    rubrics = [];
    roundCaps = [];
    fixture.componentInstance.rubricChanged.subscribe((value) =>
      rubrics.push(value),
    );
    fixture.componentInstance.roundCapChanged.subscribe((value) =>
      roundCaps.push(value),
    );
    fixture.detectChanges();
  });

  function textarea(): HTMLTextAreaElement {
    return fixture.debugElement.query(
      By.css('[data-testid="tribunal-rubric-input"]'),
    ).nativeElement as HTMLTextAreaElement;
  }

  function roundCapInput(): HTMLInputElement {
    return fixture.debugElement.query(
      By.css('[data-testid="tribunal-round-cap-input"]'),
    ).nativeElement as HTMLInputElement;
  }

  function type(
    element: HTMLTextAreaElement | HTMLInputElement,
    value: string,
  ) {
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('prefills the rubric from the skill’s own template', () => {
    expect(textarea().value).toBe(DEFAULT_CRUCIBLE_RUBRIC);
    // The prefill must be a real, gradeable rubric — not a placeholder.
    expect(DEFAULT_CRUCIBLE_RUBRIC).toContain('Pass condition');
    expect(DEFAULT_CRUCIBLE_RUBRIC.split('\n').length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it('defaults the round cap to the launch maximum', () => {
    expect(roundCapInput().value).toBe(String(MAX_CRUCIBLE_ROUND_CAP));
    expect(MAX_CRUCIBLE_ROUND_CAP).toBe(2);
  });

  it('emits the edited rubric verbatim', () => {
    type(textarea(), '| 1 | Only criterion | It compiles | Judge |');

    expect(rubrics).toEqual(['| 1 | Only criterion | It compiles | Judge |']);
  });

  it('clamps a typed round cap above the launch maximum', () => {
    // `max` on a number input is advisory; a typed 9 would otherwise authorise
    // nine paid rounds. The clamp is on the emitted value, not the markup.
    type(roundCapInput(), '9');

    expect(roundCaps).toEqual([MAX_CRUCIBLE_ROUND_CAP]);
  });

  it('clamps a round cap below one', () => {
    type(roundCapInput(), '0');

    expect(roundCaps).toEqual([1]);
  });

  it('emits nothing for a non-numeric round cap', () => {
    type(roundCapInput(), 'abc');

    expect(roundCaps).toEqual([]);
  });

  it('flags an emptied rubric — the judge would have nothing to grade against', () => {
    fixture.componentRef.setInput('rubric', '   ');
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[role="alert"]'))).toBeTruthy();
  });

  it('does not flag the prefilled rubric', () => {
    expect(fixture.debugElement.query(By.css('[role="alert"]'))).toBeNull();
  });
});
