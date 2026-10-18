import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { GuidanceGenerationStore } from '../services/guidance-generation.store';
import { GenerationGuidancePageComponent } from './generation-guidance-page.component';

describe('GenerationGuidancePageComponent', () => {
  it('shows push-driven run state, exact Stop action and escaped saved content', () => {
    const state = signal<'running' | 'completed'>('running');
    const stop = jest.fn();
    TestBed.configureTestingModule({
      imports: [GenerationGuidancePageComponent],
      providers: [
        {
          provide: GenerationWorkflowStore,
          useValue: {
            state,
            isBound: () => state() === 'running',
            stop,
            startGuidance: jest.fn(),
            regenerateGuidance: jest.fn(),
            refresh: jest.fn(),
          },
        },
        {
          provide: GuidanceGenerationStore,
          useValue: {
            status: () => 'completed',
            source: () => 'Verified latest analysis',
            snapshot: () => null,
            result: () => null,
            run: () => null,
            content: () => '<script>alert(1)</script>',
            actionFailed: () => false,
            setEnabled: jest.fn(),
            refreshCommitted: jest.fn(),
            loadContent: jest.fn(),
            download: jest.fn(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationGuidancePageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Verified latest analysis');
    expect(root.textContent).toContain('Generating project guidance');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Stop generation'))
      ?.click();
    expect(stop).toHaveBeenCalledTimes(1);
    state.set('completed');
    fixture.detectChanges();
    expect(root.textContent).toContain('Project guidance saved');
  });
});
