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
  readonly launched = output<void>();
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
