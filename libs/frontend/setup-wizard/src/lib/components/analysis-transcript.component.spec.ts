import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { AnalysisTranscriptComponent } from './analysis-transcript.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

describe('AnalysisTranscriptComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SetupWizardStateService, useValue: {
          analysisStream: signal([]),
          phaseStreamingStates: signal([]),
          scanProgress: signal(null),
          phaseStatuses: signal([]),
        } },
        { provide: ExecutionTreeBuilderService, useValue: { buildTree: jest.fn() } },
      ],
    });
  });

  it('keeps the standalone toggle and height limit', () => {
    const fixture = TestBed.createComponent(AnalysisTranscriptComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('button[aria-controls="analysis-transcript-content"]')).not.toBeNull();
    expect(root.querySelector('div')?.classList.contains('max-h-[70vh]')).toBe(true);
    fixture.destroy();
  });

  it('renders a permanently expanded pane without the standalone height limit', () => {
    const fixture = TestBed.createComponent(AnalysisTranscriptComponent);
    fixture.componentRef.setInput('variant', 'pane');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('button[aria-controls="analysis-transcript-content"]')).toBeNull();
    expect(root.querySelector('div')?.classList.contains('max-h-[70vh]')).toBe(false);
    expect(root.querySelector('#analysis-transcript-content')).not.toBeNull();
    fixture.destroy();
  });
});
