import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import {
  ClaudeRpcService,
  ModelStateService,
  ThemeService,
  VSCodeService,
} from '@ptah-extension/core';
import type { WizardPreviewGenerationResponse } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { AgentSelectionListComponent } from './agent-selection-list.component';

const binding = {
  tabId: 'agents-tab',
  workspacePath: '/workspace',
  workflow: 'setup-agent-generation',
};
const agent = {
  agentId: 'frontend-developer',
  agentName: 'Frontend Developer',
  description: 'Builds interfaces',
  category: 'development',
  relevanceScore: 100,
  matchedCriteria: [],
  recommended: true,
};
const first = {
  agents: [
    {
      agentId: agent.agentId,
      files: [
        {
          target: 'claude',
          relPath: '.claude/agents/front.md',
          certainty: 'definite',
          willOverwrite: false,
        },
      ],
    },
  ],
};
const changed = {
  agents: [
    {
      agentId: agent.agentId,
      files: [
        {
          target: 'claude',
          relPath: '.claude/agents/front.md',
          certainty: 'definite',
          willOverwrite: true,
        },
      ],
    },
  ],
};

const target = {
  harnessRoot: '/workspace',
  openedFolder: '/workspace/packages/web',
  chosen: 'harness-root' as const,
  openedIsHarnessRoot: false,
};

function existing(
  revision: string,
  token: string,
  chosen: 'harness-root' | 'opened-folder' = 'harness-root',
  localState: 'exists' | 'unreadable' = 'exists',
): WizardPreviewGenerationResponse {
  return {
    previewToken: token,
    target: { ...target, chosen },
    rivalStatus: 'listed',
    agents: [
      {
        agentId: agent.agentId,
        files: [
          {
            target: 'claude',
            relPath: '.claude/agents/front.md',
            certainty: 'definite',
            willOverwrite: true,
            localState,
            ...(localState === 'exists' ? { revision } : {}),
          },
        ],
      },
    ],
  };
}

describe('AgentSelectionListComponent', () => {
  const rejection = signal<{
    reason: 'blocked' | 'preview-required';
    ownerTabId?: string;
  } | null>(null);
  const chatTurnRejection = signal<string | null>(null);
  let call: jest.Mock;
  let startAgents: jest.Mock;
  const multiPhaseResult = signal<object | null>(null);

  beforeEach(() => {
    rejection.set(null);
    multiPhaseResult.set(null);
    chatTurnRejection.set(null);
    call = jest.fn().mockImplementation((method: string) =>
      Promise.resolve({
        isSuccess: () => true,
        data: method === 'wizard:recommend-agents' ? [agent] : first,
      }),
    );
    startAgents = jest.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        {
          provide: SetupWizardStateService,
          useValue: {
            multiPhaseResult,
            recommendations: signal([agent]),
            selectedAgentsMap: signal({}),
            communityPacks: signal([]),
            setCommunityPacks: jest.fn(),
          },
        },
        { provide: WizardRpcService, useValue: { listAgentPacks: jest.fn() } },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            isBound: signal(false),
            run: signal(null),
            provider: signal(null),
            model: signal(null),
            rejection,
            chatTurnRejection,
            state: signal('idle'),
            startAgents,
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'agents-tab', overrideModel: null }]),
            activeWorkspacePath: '/workspace',
            findTabByIdAcrossWorkspaces: jest.fn().mockReturnValue({
              workspacePath: '/workspace',
              tab: { title: 'Generate agents' },
            }),
            getWorkspaceTabs: jest.fn().mockReturnValue([]),
            setOverrideModel: jest.fn(),
          },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: signal([]), currentModel: signal('') },
        },
        { provide: VSCodeService, useValue: { isElectron: true } },
        { provide: ThemeService, useValue: { isDarkMode: signal(true) } },
        {
          provide: GenerationWorkflowLauncherService,
          useValue: {
            open: jest
              .fn()
              .mockResolvedValue({ outcome: 'landed', tabId: 'agents-tab' }),
          },
        },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(AgentSelectionListComponent);
    fixture.componentRef.setInput('binding', binding);
    fixture.detectChanges();
    return fixture;
  }

  it('loads the static catalog without analysis and hides relevance scores', async () => {
    const fixture = create();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(call).toHaveBeenCalledWith(
      'wizard:recommend-agents',
      { mode: 'workspace-catalog', tabBinding: binding },
      { timeout: 60_000 },
    );
    expect(fixture.nativeElement.textContent).toContain('Catalog list');
    expect(fixture.nativeElement.textContent).toContain('Frontend Developer');
    expect(fixture.nativeElement.textContent).not.toContain('100%');
  });

  it('keeps catalog selection and avoids a refetch when binding identity is unchanged', async () => {
    const fixture = create();
    await fixture.whenStable();
    fixture.componentInstance['toggle'](agent.agentId);
    fixture.componentRef.setInput('binding', { ...binding });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['selected']().has(agent.agentId)).toBe(
      true,
    );
    expect(
      call.mock.calls.filter(
        ([method]) => method === 'wizard:recommend-agents',
      ),
    ).toHaveLength(1);
  });

  it('keeps analysis selection when binding identity is unchanged', async () => {
    multiPhaseResult.set({});
    const fixture = create();
    fixture.componentInstance['toggle'](agent.agentId);
    fixture.componentRef.setInput('binding', { ...binding });
    fixture.detectChanges();
    expect(fixture.componentInstance['selected']().has(agent.agentId)).toBe(
      true,
    );
  });

  it('re-previews before submit and requires another confirmation for changed definite targets', async () => {
    const fixture = create();
    await fixture.whenStable();
    fixture.componentInstance['toggle'](agent.agentId);
    await fixture.componentInstance['openPreview']();
    call.mockResolvedValue({ isSuccess: () => true, data: changed });
    await fixture.componentInstance['confirmPreview']();
    expect(fixture.componentInstance['targetsChanged']()).toBe(true);
    expect(startAgents).not.toHaveBeenCalled();
    await fixture.componentInstance['confirmPreview']();
    expect(startAgents).toHaveBeenCalledWith([agent.agentId], {
      fileDecisions: {},
    });
  });

  /** Queue preview responses; the catalog call keeps answering the list. */
  function previews(...values: WizardPreviewGenerationResponse[]): void {
    call.mockImplementation((method: string) =>
      Promise.resolve({
        isSuccess: () => true,
        data:
          method === 'wizard:recommend-agents'
            ? [agent]
            : values.length > 1
              ? values.shift()
              : values[0],
      }),
    );
  }
  const previewCalls = () =>
    call.mock.calls.filter(
      ([method]) => method === 'wizard:preview-generation',
    );

  async function openWithSelection() {
    const fixture = create();
    await fixture.whenStable();
    fixture.componentInstance['toggle'](agent.agentId);
    await fixture.componentInstance['openPreview']();
    fixture.detectChanges();
    return fixture;
  }

  it('starts every existing file on Keep and submits the fresh token, Replace and target', async () => {
    previews(existing('r1', 'token-1'), existing('r1', 'token-2'));
    const fixture = await openWithSelection();
    const component = fixture.componentInstance;
    expect(component['decisions']()?.rows[0].decision).toBe('keep');
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="preview-confirm"]')
        ?.textContent?.trim(),
    ).toBe('Confirm and generate');
    component['setRowDecision']({ id: agent.agentId, decision: 'replace' });
    await component['confirmPreview']();
    expect(startAgents).toHaveBeenCalledWith([agent.agentId], {
      fileDecisions: {
        [agent.agentId]: { decision: 'replace', revision: 'r1' },
      },
      previewToken: 'token-2',
      target: 'harness-root',
    });
  });

  it('asks for another review when a replaced file changed before confirm', async () => {
    previews(existing('r1', 'token-1'), existing('r2', 'token-2'));
    const fixture = await openWithSelection();
    const component = fixture.componentInstance;
    component['setRowDecision']({ id: agent.agentId, decision: 'replace' });
    await component['confirmPreview']();
    expect(startAgents).not.toHaveBeenCalled();
    expect(component['targetsChanged']()).toBe(true);
    expect(component['decisions']()?.rows[0].decision).toBe('keep');
    await component['confirmPreview']();
    expect(startAgents).toHaveBeenCalledWith([agent.agentId], {
      fileDecisions: {},
      previewToken: 'token-2',
      target: 'harness-root',
    });
  });

  it('never sends Replace for an unreadable file', async () => {
    previews(existing('r1', 'token-1', 'harness-root', 'unreadable'));
    const fixture = await openWithSelection();
    const component = fixture.componentInstance;
    expect(component['decisions']()?.rows[0].forcedKeep).toBe(true);
    component['setRowDecision']({ id: agent.agentId, decision: 'replace' });
    component['setAllRowDecisions']('replace');
    expect(component['decisions']()?.rows[0].decision).toBe('keep');
    await component['confirmPreview']();
    expect(startAgents).toHaveBeenCalledWith([agent.agentId], {
      fileDecisions: {},
      previewToken: 'token-1',
      target: 'harness-root',
    });
  });

  it('re-runs the comparison for another target and resets every choice to Keep', async () => {
    previews(
      existing('r1', 'token-1'),
      existing('r1', 'token-2', 'opened-folder'),
      existing('r1', 'token-3', 'opened-folder'),
    );
    const fixture = await openWithSelection();
    const component = fixture.componentInstance;
    component['setRowDecision']({ id: agent.agentId, decision: 'replace' });
    await component['changeTarget']('opened-folder');
    expect(previewCalls()[1][1]).toEqual({
      selectedAgentIds: [agent.agentId],
      tabBinding: binding,
      target: 'opened-folder',
    });
    const snapshot = component['decisions']();
    expect(snapshot?.rows[0].decision).toBe('keep');
    expect(snapshot?.target).toBe('opened-folder');
    expect(snapshot?.status).toContain('every choice is reset to Keep');
    await component['confirmPreview']();
    expect(previewCalls()[2][1]).toEqual(
      expect.objectContaining({ target: 'opened-folder' }),
    );
    expect(startAgents).toHaveBeenCalledWith([agent.agentId], {
      fileDecisions: {},
      previewToken: 'token-3',
      target: 'opened-folder',
    });
  });

  it('drops a stale preview reply after Cancel', async () => {
    previews(existing('r1', 'token-1'));
    const fixture = create();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component['toggle'](agent.agentId);
    const opening = component['openPreview']();
    component['closePreview']();
    await opening;
    expect(component['preview']()).toBeNull();
    expect(component['decisions']()).toBeNull();
    expect(component['previewOpen']()).toBe(false);
  });

  it('re-previews with choices reset and the target kept after preview-required', async () => {
    previews(
      existing('r1', 'token-1'),
      existing('r1', 'token-2', 'opened-folder'),
      existing('r1', 'token-3', 'opened-folder'),
      existing('r1', 'token-4', 'opened-folder'),
    );
    startAgents.mockImplementation(() => {
      rejection.set({ reason: 'preview-required' });
      return Promise.resolve();
    });
    const fixture = await openWithSelection();
    const component = fixture.componentInstance;
    await component['changeTarget']('opened-folder');
    component['setRowDecision']({ id: agent.agentId, decision: 'replace' });
    await component['confirmPreview']();
    expect(startAgents).toHaveBeenCalledTimes(1);
    expect(component['previewOpen']()).toBe(true);
    expect(previewCalls()[3][1]).toEqual(
      expect.objectContaining({ target: 'opened-folder' }),
    );
    const snapshot = component['decisions']();
    expect(snapshot?.rows[0].decision).toBe('keep');
    expect(snapshot?.status).toBeNull();
  });

  it('reopens preview after preview-required rejection and shows same-workspace owner', async () => {
    const fixture = create();
    await fixture.whenStable();
    fixture.componentInstance['toggle'](agent.agentId);
    startAgents.mockImplementation(() => {
      rejection.set({ reason: 'preview-required' });
      return Promise.resolve();
    });
    await fixture.componentInstance['openPreview']();
    await fixture.componentInstance['confirmPreview']();
    expect(fixture.componentInstance['previewOpen']()).toBe(true);
    rejection.set({ reason: 'blocked', ownerTabId: 'agents-tab' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Open running tab');
  });

  it('shows the VS Code null-partition owner title and open action', async () => {
    const fixture = create();
    await fixture.whenStable();
    const tabs = TestBed.inject(TabManagerService);
    jest.spyOn(tabs, 'findTabByIdAcrossWorkspaces').mockReturnValue({
      workspacePath: null,
      tab: { title: 'Running agent tab' },
    } as ReturnType<TabManagerService['findTabByIdAcrossWorkspaces']>);
    jest
      .spyOn(tabs, 'getWorkspaceTabs')
      .mockReturnValue([{ id: 'agents-tab' }] as ReturnType<
        TabManagerService['getWorkspaceTabs']
      >);
    rejection.set({ reason: 'blocked', ownerTabId: 'agents-tab' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Running agent tab owns this run.',
    );
    expect(fixture.nativeElement.textContent).toContain('Open running tab');
  });

  it('shows chat busy reason and does not call Submit', async () => {
    const fixture = create();
    await fixture.whenStable();
    fixture.componentInstance['toggle'](agent.agentId);
    startAgents.mockImplementation(() => {
      chatTurnRejection.set('Finish this chat reply first');
      return Promise.resolve();
    });
    await fixture.componentInstance['openPreview']();
    await fixture.componentInstance['confirmPreview']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Finish this chat reply first',
    );
    expect(
      call.mock.calls.filter(
        ([method]) => method === 'wizard:submit-selection',
      ),
    ).toHaveLength(0);
  });
});
