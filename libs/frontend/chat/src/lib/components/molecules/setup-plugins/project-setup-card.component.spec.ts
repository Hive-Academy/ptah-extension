import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import { AppStateManager, PluginCatalogService } from '@ptah-extension/core';
import { ProjectSetupCardComponent } from './project-setup-card.component';

describe('ProjectSetupCardComponent', () => {
  let fixture: ComponentFixture<ProjectSetupCardComponent>;
  const count = signal<number | null>(null);
  const allReady = signal(false);
  const skillsReady = signal<boolean | null>(null);
  const agentsReady = signal<boolean | null>(null);
  const workspaceNotOpen = signal(false);
  const error = signal<string | null>(null);
  const launchError = signal<string | null>(null);
  const setup = {
    readyCount: count, allReady, skillsReady, agentsReady, workspaceNotOpen,
    error, launchError, folderError: signal<string | null>(null), isLoading: signal(false), launching: signal(false), status: signal({ agentCount: 2 }),
    launchWizard: jest.fn(), launchGeneration: jest.fn(), openFolder: jest.fn(), retry: jest.fn(), refresh: jest.fn(),
  };
  const catalog = { error: signal<string | null>(null), isLoaded: signal(false) };
  const appState = { openMarketplace: jest.fn() };
  const host = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) => Array.from(host().querySelectorAll('button')).find(item => item.textContent?.trim() === label);

  beforeEach(async () => {
    jest.clearAllMocks();
    setup.refresh.mockReset();
    count.set(null); allReady.set(false); skillsReady.set(null); agentsReady.set(null);
    workspaceNotOpen.set(false); error.set(null); launchError.set(null); setup.folderError.set(null); setup.isLoading.set(false); setup.launching.set(false); catalog.error.set(null); catalog.isLoaded.set(false);
    await TestBed.configureTestingModule({
      imports: [ProjectSetupCardComponent],
      providers: [
        { provide: SetupStatusStore, useValue: setup },
        { provide: PluginCatalogService, useValue: catalog },
        { provide: AppStateManager, useValue: appState },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectSetupCardComponent);
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it('announces checking until both counted signals are known', () => {
    expect(host().textContent).toContain('Checking readiness');
    count.set(1); skillsReady.set(true); agentsReady.set(false); fixture.detectChanges();
    expect(host().textContent).toContain('1 of 2 ready');
    expect(host().textContent).toContain('Project scan');
    expect(host().textContent).not.toContain('1 of 3');
  });

  it('keeps all actions in the Ready strip', () => {
    allReady.set(true); count.set(2); fixture.detectChanges();
    expect(host().textContent).toContain('Ready');
    expect(host().textContent).not.toContain('Project scan');
    for (const label of ['Open Library', 'Run setup', 'Generate agents', 'Project guidance']) expect(button(label)).toBeDefined();
    button('Open Library')?.click(); button('Run setup')?.click(); button('Generate agents')?.click(); button('Project guidance')?.click();
    expect(appState.openMarketplace).toHaveBeenCalledWith({ page: 'skills', source: 'ptah-plugins' });
    expect(setup.launchWizard).toHaveBeenCalledTimes(1);
    expect(setup.launchGeneration).toHaveBeenCalledWith('setup-agent-generation');
    expect(setup.launchGeneration).toHaveBeenCalledWith('setup-project-prompt');
  });

  it('routes Library and wizard actions', () => {
    button('Open Library')?.click(); button('Configure')?.click(); button('Run setup')?.click();
    expect(appState.openMarketplace).toHaveBeenCalledWith({ page: 'skills', source: 'ptah-plugins' });
    expect(setup.launchWizard).toHaveBeenCalledTimes(2);
  });

  it('offers folder and retry states with safe failure feedback', () => {
    workspaceNotOpen.set(true); error.set('unsafe detail'); fixture.detectChanges();
    expect(button('Open Folder')).toBeDefined(); expect(button('Retry')).toBeDefined();
    expect(host().textContent).toContain('Open a folder to check');
    expect(button('Generate agents')?.disabled).toBe(true);
    expect(button('Project guidance')?.disabled).toBe(true);
    expect(host().textContent).not.toContain('unsafe detail');
    button('Open Folder')?.click(); button('Retry')?.click();
    expect(setup.openFolder).toHaveBeenCalled(); expect(setup.retry).toHaveBeenCalled();
  });

  it('refreshes on mount and visible return and removes listeners on destroy', () => {
    expect(setup.refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    expect(setup.refresh).toHaveBeenCalledTimes(2);
    fixture.destroy();
    window.dispatchEvent(new Event('focus'));
    expect(setup.refresh).toHaveBeenCalledTimes(2);
  });

  it('updates the count when a card remounts after host setup completes', () => {
    let configuredOnHost = false;
    setup.refresh.mockImplementation(() => {
      agentsReady.set(configuredOnHost);
      count.set(Number(skillsReady()) + Number(configuredOnHost));
    });
    skillsReady.set(true);
    fixture.destroy();
    configuredOnHost = true;
    fixture = TestBed.createComponent(ProjectSetupCardComponent);
    fixture.detectChanges();
    expect(setup.refresh).toHaveBeenCalled();
    expect(host().textContent).toContain('2 of 2 ready');
    expect(count()).toBe(2);
  });

  it('shows unavailable copy and singular agent count', () => {
    catalog.isLoaded.set(true);
    error.set('failed'); fixture.detectChanges();
    expect(host().textContent).toContain('Readiness unavailable');
    error.set(null); count.set(1); agentsReady.set(true); setup.status.set({ agentCount: 1 }); fixture.detectChanges();
    expect(host().textContent).toContain('1 agent configured');
    setup.launching.set(true); fixture.detectChanges();
    expect(host().querySelector('.loading-spinner')).toBeTruthy();
  });
});
