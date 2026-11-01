import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import type { HarnessInitializeResponse } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessRpcService } from './harness-rpc.service';

const response: HarnessInitializeResponse = {
  workspaceEffectivelyEmpty: true,
  workspaceRoot: '/workspace/a',
  workspaceContext: {
    projectName: 'A',
    projectType: 'app',
    frameworks: [],
    languages: [],
  },
  availableAgents: [],
  availableSkills: [],
  existingPresets: [],
};

describe('HarnessBuilderStateService', () => {
  const workspaceInfo = signal<{ path: string } | null>({
    path: '/workspace/a',
  });
  let state: HarnessBuilderStateService;

  beforeEach(() => {
    workspaceInfo.set({ path: '/workspace/a' });
    TestBed.configureTestingModule({
      providers: [
        HarnessBuilderStateService,
        { provide: AppStateManager, useValue: { workspaceInfo } },
        { provide: HarnessRpcService, useValue: { initialize: jest.fn() } },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    state = TestBed.inject(HarnessBuilderStateService);
    TestBed.flushEffects();
  });

  it('pins configuration to the route tab across an unrelated workspace switch', () => {
    state.bindTab('/workspace/a', 'tab-a');
    state.initialize(response);
    state.setGeneratedDocument('A document');
    workspaceInfo.set({ path: '/workspace/b' });
    TestBed.flushEffects();
    expect(state.pinnedWorkspaceRoot()).toBe('/workspace/a');
    expect(state.generatedDocument()).toBe('A document');
    expect(state.workspaceSwitchedDuringBuild()).toBe(true);
  });

  it('clears local preview when the route binds another tab', () => {
    state.bindTab('/workspace/a', 'tab-a');
    state.setGeneratedDocument('A document');
    state.bindTab('/workspace/a', 'tab-b');
    expect(state.generatedDocument()).toBe('');
    expect(state.pinnedWorkspaceRoot()).toBe('/workspace/a');
  });

  it('does not contain a private stream surface', () => {
    expect('registerWorkflowSurface' in state).toBe(false);
    expect('registerOperationSurface' in state).toBe(false);
  });
});
