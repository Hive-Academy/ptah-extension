import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import { SetupWizardStateService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from '../analyze/analysis-step.store';
import { OnboardingWorkspaceStore } from './onboarding-workspace.store';
import { WorkspaceHeaderComponent } from './workspace-header.component';

describe('OnboardingWorkspaceStore and header', () => {
  const folders = signal([{ path: '/one', name: 'one' }, { path: '/two', name: 'two' }]);
  const index = signal(0);
  const resolved = signal(true);
  const switchPending = signal(false);
  const layout = {
    workspaceFolders: folders,
    activeWorkspaceIndex: index,
    activeWorkspace: () => folders()[index()] ?? null,
    workspaceResolved: resolved,
    workspaceSwitchPending: switchPending,
    switchWorkspace: jest.fn((next: number) => index.set(next)),
    addFolder: jest.fn().mockResolvedValue('cancelled'),
  };
  const resetAnalysis = jest.fn();
  const resetWizard = jest.fn();
  beforeEach(() => {
    index.set(0); resolved.set(true); switchPending.set(false); jest.clearAllMocks();
    TestBed.configureTestingModule({ providers: [
      OnboardingWorkspaceStore,
      { provide: ElectronLayoutService, useValue: layout },
      { provide: VSCodeService, useValue: { config: () => ({ isElectron: true }) } },
      { provide: AnalysisStepStore, useValue: { resetForWorkspace: resetAnalysis } },
      { provide: SetupWizardStateService, useValue: { reset: resetWizard } },
    ] });
  });
  it('switches folders and clears workspace scoped analysis and wizard state', () => {
    const store = TestBed.inject(OnboardingWorkspaceStore);
    TestBed.flushEffects();
    store.switchTo(1); TestBed.flushEffects();
    expect(store.activePath()).toBe('/two');
    expect(resetAnalysis).toHaveBeenCalledTimes(1);
    expect(resetWizard).toHaveBeenCalledTimes(1);
  });
  it('opens the picker and renders keyboard operable folder actions', async () => {
    const fixture = TestBed.createComponent(WorkspaceHeaderComponent);
    fixture.componentRef.setInput('canSwitch', true);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('select')).not.toBeNull();
    (element.querySelectorAll('button')[0] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(layout.addFolder).toHaveBeenCalledWith('open');
  });
  it('opens the host directory picker from New folder', async () => {
    const fixture = TestBed.createComponent(WorkspaceHeaderComponent);
    fixture.componentRef.setInput('canSwitch', true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(layout.addFolder).toHaveBeenCalledWith('create');
  });
  it('holds analysis reads until the optimistic switch has settled', () => {
    const store = TestBed.inject(OnboardingWorkspaceStore);
    switchPending.set(true);
    index.set(1);
    TestBed.flushEffects();
    expect(store.activePath()).toBe('/two');
    expect(store.readyForActivePath()).toBe(false);
    switchPending.set(false);
    expect(store.readyForActivePath()).toBe(true);
  });
  it('stops waiting and resets switching when another path supersedes the picked folder', async () => {
    layout.addFolder.mockImplementationOnce(async () => {
      index.set(1);
      switchPending.set(true);
      return 'added';
    });
    const store = TestBed.inject(OnboardingWorkspaceStore);
    const picking = store.openFolder();
    await Promise.resolve();
    TestBed.flushEffects();

    resolved.set(false);
    index.set(0);
    TestBed.flushEffects();
    await picking;

    expect((store as never)['switching']()).toBe(false);
    expect(store.folderError()).toContain('Could not switch to that folder');
  });
  it('shows picker failure in the header and keeps cancellation quiet', async () => {
    layout.addFolder.mockResolvedValueOnce('failed');
    const fixture = TestBed.createComponent(WorkspaceHeaderComponent);
    fixture.componentRef.setInput('canSwitch', true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('button')[0] as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Could not open a folder');
    (fixture.nativeElement.querySelectorAll('button')[0] as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
  });
});
