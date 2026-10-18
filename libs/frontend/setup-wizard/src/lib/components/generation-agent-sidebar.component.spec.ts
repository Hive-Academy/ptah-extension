import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { GenerationAgentSidebarComponent } from './generation-agent-sidebar.component';

describe('GenerationAgentSidebarComponent', () => {
  it('routes saved-run resume through the bound workflow store', () => {
    const resumeCheckpoint = jest.fn();
    const legacyResume = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: GenerationWorkflowStore, useValue: {
          state: () => 'idle', run: () => null, isBound: () => false,
          rejection: () => null, startError: () => null,
          resumeCheckpoint,
        } },
        { provide: AgentGenerationStore, useValue: {
          resumable: () => ({ runId: 'saved', agents: [] }),
          loading: () => false, remainingCounts: () => ({}),
          retryingIds: () => new Set<string>(),
          guidanceStatus: () => 'unknown', resume: legacyResume,
        } },
        { provide: GenerationHandoffStore, useValue: { pending: signal(null) } },
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
      ],
    });
    TestBed.overrideComponent(GenerationAgentSidebarComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(GenerationAgentSidebarComponent);
    fixture.componentRef.setInput('binding', {
      tabId: 'tab', workspacePath: '/ws', workflow: 'setup-agent-generation',
    });
    fixture.componentRef.setInput('now', 0);
    fixture.detectChanges();
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((candidate) => candidate.textContent?.includes('Resume saved run'));
    expect(button).toBeDefined();
    button?.click();
    expect(resumeCheckpoint).toHaveBeenCalledTimes(1);
    expect(legacyResume).not.toHaveBeenCalled();
  });
});
