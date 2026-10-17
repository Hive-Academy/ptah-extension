import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { GenerationWorkflowShellComponent } from './generation-workflow-shell.component';

describe('GenerationWorkflowShellComponent', () => {
  it('rejects a tab with a mismatched workflow before embedding chat', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(
              convertToParamMap({
                tabId: 'tab',
                workflow: 'setup-agent-generation',
              }),
            ),
            snapshot: {
              paramMap: {
                get: (key: string) =>
                  key === 'tabId' ? 'tab' : 'setup-agent-generation',
              },
            },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => [
              { id: 'tab', workflow: 'setup-project-prompt' },
            ],
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind: jest.fn(),
            unbind: jest.fn(),
            state: () => 'idle',
            isBound: () => false,
            binding: () => null,
            run: () => null,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('unavailable');
    expect(
      fixture.nativeElement.querySelector('ptah-session-embed'),
    ).toBeNull();
  });

  it('binds only the current workspace and wires quiet Stop and guarded Send', () => {
    const tabs = signal([{ id: 'tab', workflow: 'setup-agent-generation' }]);
    const workspace = signal('/ws');
    const bind = jest.fn();
    const unbind = jest.fn();
    const stop = jest.fn();
    let bound = true;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(
              convertToParamMap({
                tabId: 'tab',
                workflow: 'setup-agent-generation',
              }),
            ),
            snapshot: {
              paramMap: {
                get: (key: string) =>
                  key === 'tabId' ? 'tab' : 'setup-agent-generation',
              },
            },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            activeWorkspacePath$: workspace,
            getWorkspaceTabs: (path: string) => (path === '/ws' ? tabs() : []),
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind,
            unbind,
            stop,
            state: () => 'quiet',
            isBound: () => bound,
          },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { template: '<p>shell</p>', imports: [] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    const shell = fixture.componentInstance;
    expect(bind).toHaveBeenCalledWith({
      tabId: 'tab',
      workspacePath: '/ws',
      workflow: 'setup-agent-generation',
    });
    expect(shell.startGuard()).toContain('Finish or stop generation');
    expect(shell.stopHandler('tab')).toBe('handled');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(shell.stopHandler('other')).toBe('not-handled');
    bound = false;
    expect(shell.startGuard()).toBeNull();
    expect(shell.stopHandler('tab')).toBe('not-handled');
    workspace.set('/other');
    fixture.detectChanges();
    expect(unbind).toHaveBeenCalled();
    expect(shell.binding()).toBeNull();
  });

  it('rebinds one shell instance when route tab and workflow params change', () => {
    const params = new BehaviorSubject(
      convertToParamMap({
        tabId: 'agent-tab',
        workflow: 'setup-agent-generation',
      }),
    );
    const tabs = signal([
      { id: 'agent-tab', workflow: 'setup-agent-generation' },
      { id: 'guidance-tab', workflow: 'setup-project-prompt' },
    ]);
    const bind = jest.fn();
    const unbind = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            snapshot: { paramMap: params.value },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => tabs(),
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind,
            unbind,
            state: () => 'idle',
            isBound: () => false,
          },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { template: '<p>shell</p>', imports: [] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.binding()?.tabId).toBe('agent-tab');
    params.next(
      convertToParamMap({
        tabId: 'guidance-tab',
        workflow: 'setup-project-prompt',
      }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.binding()).toEqual({
      tabId: 'guidance-tab',
      workspacePath: '/ws',
      workflow: 'setup-project-prompt',
    });
    expect(bind).toHaveBeenLastCalledWith({
      tabId: 'guidance-tab',
      workspacePath: '/ws',
      workflow: 'setup-project-prompt',
    });
    expect(unbind).not.toHaveBeenCalled();
  });
});
