import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  ClaudeRpcService,
  PluginCatalogService,
} from '@ptah-extension/core';
import { ProjectSetupCardComponent } from './project-setup-card.component';

describe('ProjectSetupCardComponent', () => {
  let fixture: ComponentFixture<ProjectSetupCardComponent>;
  const tabs = { activeWorkspacePath: '/workspace' };
  const launcher = { open: jest.fn() };
  const appState = { openMarketplace: jest.fn() };
  const catalog = {
    isLoaded: signal(true),
    hasEnabledPlugins: signal(true),
    ensureLoaded: jest.fn().mockResolvedValue(undefined),
  };
  const rpc = {
    call: jest.fn(async (method: string) => ({
      data:
        method === 'setup-status:get-status'
          ? {
              isConfigured: false,
              agentCount: 0,
              ruleCount: 0,
              lastUpdated: null,
              hasClaudeConfig: false,
            }
          : { success: true },
      isSuccess: () => true,
    })),
  };

  function buttons(label: string): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).filter((element) => element.textContent?.trim() === label);
  }

  async function click(label: string): Promise<void> {
    expect(buttons(label)).toHaveLength(1);
    buttons(label)[0].click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    tabs.activeWorkspacePath = '/workspace';
    catalog.isLoaded.set(true);
    catalog.hasEnabledPlugins.set(true);
    jest.clearAllMocks();
    launcher.open.mockResolvedValue({ outcome: 'landed', tabId: 'tab-1' });
    await TestBed.configureTestingModule({
      imports: [ProjectSetupCardComponent],
      providers: [
        { provide: TabManagerService, useValue: tabs },
        { provide: GenerationWorkflowLauncherService, useValue: launcher },
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: appState },
        { provide: PluginCatalogService, useValue: catalog },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectSetupCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows one action for each workflow through the embedded status widget', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('ptah-setup-status-widget')).toHaveLength(1);
    expect(buttons('Generate agents')).toHaveLength(1);
    expect(buttons('Project guidance')).toHaveLength(1);
  });

  it.each([
    ['Generate agents', 'setup-agent-generation'],
    ['Project guidance', 'setup-project-prompt'],
  ] as const)(
    'opens %s for the active workspace through the widget',
    async (label, workflow) => {
      await click(label);
      expect(launcher.open).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        workflow,
        origin: 'independent-start',
      });
      expect(launcher.open).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the skills warning and marketplace action', async () => {
    catalog.hasEnabledPlugins.set(false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Skills Not Configured',
    );
    await click('Open Marketplace Skills');
    expect(appState.openMarketplace).toHaveBeenCalledWith({
      page: 'skills',
      source: 'ptah-plugins',
    });
    expect(rpc.call).toHaveBeenCalledWith(
      'setup-status:get-status',
      {},
      { timeout: 10000 },
    );
  });
});
