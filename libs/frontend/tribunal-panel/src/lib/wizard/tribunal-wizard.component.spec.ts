import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';
import { TribunalWizardComponent } from './tribunal-wizard.component';
import { StepObjectiveComponent } from './step-objective.component';

@Component({ selector: 'ptah-step-pick-move', standalone: true, template: '' })
class StepPickMoveStub {}

@Component({
  selector: 'ptah-step-panel-preview',
  standalone: true,
  template: '',
})
class StepPanelPreviewStub {}

@Component({
  selector: 'ptah-step-confirm-cost',
  standalone: true,
  template: '',
})
class StepConfirmCostStub {}

@Component({ selector: 'ptah-step-run', standalone: true, template: '' })
class StepRunStub {}

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
          StepObjectiveComponent,
          StepPickMoveStub,
          StepPanelPreviewStub,
          StepConfirmCostStub,
          StepRunStub,
        ],
      },
    });
    fixture = TestBed.createComponent(TribunalWizardComponent);
    fixture.detectChanges();
  });

  function nextButton(): HTMLButtonElement | null {
    const next = fixture.debugElement.queryAll(By.css('button'));
    return (
      (next.find(
        (b) =>
          (b.nativeElement as HTMLButtonElement).getAttribute('aria-label') ===
          'Next step',
      )?.nativeElement as HTMLButtonElement) ?? null
    );
  }

  it('starts on the Objective step', () => {
    const host = fixture.debugElement.query(
      By.css('[data-testid="tribunal-step-objective"]'),
    );
    expect(host).toBeTruthy();
  });

  it('blocks advancing past the Objective step when objective is empty', () => {
    const button = nextButton();
    expect(button?.disabled).toBe(true);
  });

  it('allows advancing once a non-whitespace objective is entered', () => {
    const textarea = fixture.debugElement.query(By.css('textarea'))
      .nativeElement as HTMLTextAreaElement;
    textarea.value = 'Refactor the auth guard.';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(nextButton()?.disabled).toBe(false);
  });

  it('keeps advance blocked for whitespace-only objective', () => {
    const textarea = fixture.debugElement.query(By.css('textarea'))
      .nativeElement as HTMLTextAreaElement;
    textarea.value = '   ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(nextButton()?.disabled).toBe(true);
  });
});
