import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';
import { TribunalWizardComponent } from './tribunal-wizard.component';
import type { TribunalMove, VendorLane } from '../types/tribunal-ui.types';

@Component({ selector: 'ptah-step-pick-move', standalone: true, template: '' })
class StepPickMoveStub {
  readonly selected = input<TribunalMove>('council');
  readonly moveSelected = output<TribunalMove>();
}

@Component({
  selector: 'ptah-step-panel-preview',
  standalone: true,
  template: '',
})
class StepPanelPreviewStub {
  readonly selectedLanes = input<readonly VendorLane[]>([]);
  readonly move = input<TribunalMove>('council');
  readonly lanesChanged = output<readonly VendorLane[]>();
}

@Component({ selector: 'ptah-step-run', standalone: true, template: '' })
class StepRunStub {
  readonly move = input<TribunalMove>('council');
  readonly lanes = input<readonly VendorLane[]>([]);
  readonly rubric = input<string>('');
  readonly roundCap = input<number>(2);
  readonly launched = output<void>();
}

@Component({
  selector: 'ptah-step-role-roster',
  standalone: true,
  template: '',
})
class StepRoleRosterStub {
  readonly move = input<TribunalMove>('relay');
  readonly selectedLanes = input<readonly VendorLane[]>([]);
  readonly lanesChanged = output<readonly VendorLane[]>();
}

@Component({
  selector: 'ptah-step-crucible-rubric',
  standalone: true,
  template: '',
})
class StepCrucibleRubricStub {
  readonly rubric = input<string>('');
  readonly roundCap = input<number>(2);
  readonly rubricChanged = output<string>();
  readonly roundCapChanged = output<number>();
}

describe('TribunalWizardComponent', () => {
  let fixture: ComponentFixture<TribunalWizardComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TribunalWizardComponent],
    });
    TestBed.overrideComponent(TribunalWizardComponent, {
      set: {
        imports: [
          LucideAngularModule,
          StepPickMoveStub,
          StepPanelPreviewStub,
          StepRoleRosterStub,
          StepCrucibleRubricStub,
          StepRunStub,
        ],
      },
    });
    fixture = TestBed.createComponent(TribunalWizardComponent);
    fixture.detectChanges();
  });

  function nextButton(): HTMLButtonElement | null {
    const buttons = fixture.debugElement.queryAll(By.css('button'));
    return (
      (buttons.find(
        (b) =>
          (b.nativeElement as HTMLButtonElement).getAttribute('aria-label') ===
          'Next step',
      )?.nativeElement as HTMLButtonElement) ?? null
    );
  }

  function clickNext(): void {
    nextButton()?.click();
    fixture.detectChanges();
  }

  function clickBack(): void {
    const back = fixture.debugElement
      .queryAll(By.css('button'))
      .find(
        (b) =>
          (b.nativeElement as HTMLButtonElement).getAttribute('aria-label') ===
          'Previous step',
      );
    (back?.nativeElement as HTMLButtonElement | undefined)?.click();
    fixture.detectChanges();
  }

  it('starts on the Move step', () => {
    expect(
      fixture.debugElement.query(By.css('ptah-step-pick-move')),
    ).toBeTruthy();
  });

  it('allows advancing from the Move step (no gate)', () => {
    expect(nextButton()?.disabled).toBe(false);
  });

  it('blocks advancing past the Panel step until a lane is selected', () => {
    clickNext(); // → Panel step
    expect(
      fixture.debugElement.query(By.css('ptah-step-panel-preview')),
    ).toBeTruthy();
    expect(nextButton()?.disabled).toBe(true);
  });

  it('enables advancing once a lane is emitted from the Panel step', () => {
    clickNext(); // → Panel step
    const panel = fixture.debugElement.query(By.directive(StepPanelPreviewStub))
      .componentInstance as StepPanelPreviewStub;
    panel.lanesChanged.emit([
      { laneId: 'l1', family: 'codex', displayName: 'Codex', cli: 'codex' },
    ]);
    fixture.detectChanges();

    expect(nextButton()?.disabled).toBe(false);
  });

  /** Emit a move from the (stubbed) picker and settle. */
  function pickMove(move: TribunalMove): void {
    const picker = fixture.debugElement.query(By.directive(StepPickMoveStub))
      .componentInstance as StepPickMoveStub;
    picker.moveSelected.emit(move);
    fixture.detectChanges();
  }

  function stepLabels(): string[] {
    return fixture.debugElement
      .queryAll(By.css('nav span.text-xs'))
      .map((span) =>
        ((span.nativeElement as HTMLElement).textContent ?? '').trim(),
      );
  }

  it('keeps the flat move sequence Move → Panel → Run', () => {
    expect(stepLabels()).toEqual(['Move', 'Panel', 'Run']);
  });

  it('swaps the flat picker for the role roster on relay, with no extra step', () => {
    pickMove('relay');

    expect(stepLabels()).toEqual(['Move', 'Roster', 'Run']);
    clickNext();
    expect(
      fixture.debugElement.query(By.css('ptah-step-role-roster')),
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('ptah-step-panel-preview')),
    ).toBeNull();
  });

  it('adds a Rubric step for crucible only', () => {
    pickMove('crucible');

    expect(stepLabels()).toEqual(['Move', 'Roster', 'Rubric', 'Run']);
  });

  it('blocks Next on a relay roster that the rules reject', () => {
    pickMove('relay');
    clickNext(); // → Roster
    const roster = fixture.debugElement.query(By.directive(StepRoleRosterStub))
      .componentInstance as StepRoleRosterStub;

    // Only two of four phases assigned — validateRoster blocks.
    roster.lanesChanged.emit([
      {
        laneId: 'codex#0',
        family: 'codex',
        displayName: 'Codex',
        cli: 'codex',
        role: 'plan',
      },
      {
        laneId: 'codex#1',
        family: 'codex',
        displayName: 'Codex',
        cli: 'codex',
        role: 'architect',
      },
    ]);
    fixture.detectChanges();

    expect(nextButton()?.disabled).toBe(true);
  });

  it('allows Next once every relay phase is filled by an independent reviewer', () => {
    pickMove('relay');
    clickNext(); // → Roster
    const roster = fixture.debugElement.query(By.directive(StepRoleRosterStub))
      .componentInstance as StepRoleRosterStub;

    roster.lanesChanged.emit([
      {
        laneId: 'codex#0',
        family: 'codex',
        displayName: 'Codex',
        cli: 'codex',
        role: 'plan',
      },
      {
        laneId: 'codex#1',
        family: 'codex',
        displayName: 'Codex',
        cli: 'codex',
        role: 'architect',
      },
      {
        laneId: 'codex#2',
        family: 'codex',
        displayName: 'Codex',
        cli: 'codex',
        role: 'implement',
      },
      {
        laneId: 'copilot#3',
        family: 'copilot',
        displayName: 'Copilot',
        cli: 'copilot',
        role: 'review',
      },
    ]);
    fixture.detectChanges();

    expect(nextButton()?.disabled).toBe(false);
  });

  it('discards the roster when the move changes — a flat panel is not a role roster', () => {
    clickNext(); // → Panel
    const panel = fixture.debugElement.query(By.directive(StepPanelPreviewStub))
      .componentInstance as StepPanelPreviewStub;
    panel.lanesChanged.emit([
      { laneId: 'l1', family: 'codex', displayName: 'Codex', cli: 'codex' },
    ]);
    fixture.detectChanges();

    clickBack(); // → Move; the move can only be changed from its own step
    pickMove('relay');
    clickNext(); // → Roster
    const roster = fixture.debugElement.query(By.directive(StepRoleRosterStub))
      .componentInstance as StepRoleRosterStub;

    expect(roster.selectedLanes()).toEqual([]);
  });

  it('reaches the Run step directly after Panel (no Confirm step)', () => {
    clickNext(); // → Panel
    const panel = fixture.debugElement.query(By.directive(StepPanelPreviewStub))
      .componentInstance as StepPanelPreviewStub;
    panel.lanesChanged.emit([
      { laneId: 'l1', family: 'codex', displayName: 'Codex', cli: 'codex' },
    ]);
    fixture.detectChanges();
    clickNext(); // → Run

    expect(fixture.debugElement.query(By.css('ptah-step-run'))).toBeTruthy();
    // Final step → no Next button.
    expect(nextButton()).toBeNull();
  });
});
