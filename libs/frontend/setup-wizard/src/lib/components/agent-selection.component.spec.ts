import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ThemeService, VSCodeService } from '@ptah-extension/core';
import type {
  AgentPackInfoDto,
  AgentRecommendation,
  MultiPhaseAnalysisResponse,
  WizardInstallPackAgentsResult,
  WizardPlanPackInstallResult,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { AgentSelectionComponent } from './agent-selection.component';
import { PackInstallStore } from '../services/pack-install.store';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

function makeRecommendation(
  overrides: Partial<AgentRecommendation> = {},
): AgentRecommendation {
  return {
    agentId: 'frontend-developer',
    agentName: 'Frontend Developer',
    relevanceScore: 95,
    matchedCriteria: ['Angular detected'],
    category: 'development',
    recommended: true,
    description: 'Builds UI features',
    ...overrides,
  };
}

const mockMultiPhase = {
  isMultiPhase: true,
  analysisDir: '/mock/.ptah/analysis/demo',
} as unknown as MultiPhaseAnalysisResponse;

const preview: WizardPreviewGenerationResponse = {
  agents: [
    {
      agentId: 'a',
      files: [
        {
          relPath: '.claude/agents/a.md',
          target: 'claude',
          certainty: 'definite',
          willOverwrite: true,
        },
        {
          relPath: '.codex/agents/a.toml',
          target: 'codex',
          certainty: 'conditional',
          willOverwrite: true,
          condition:
            'generation changes at least one selected agent file; other CLIs are only synced when a file is written',
        },
      ],
    },
  ],
  warning: 'Some provider paths could not be checked',
};

const targetInfo = {
  harnessRoot: '/repo',
  openedFolder: '/repo/packages/api',
  chosen: 'harness-root' as const,
  openedIsHarnessRoot: false,
};

/** A current host's preview: token, target, rival status and revisions. */
function decisionPreview(
  revision = 'rev-a',
  chosen: 'harness-root' | 'opened-folder' = 'harness-root',
  token = 'token-1',
): WizardPreviewGenerationResponse {
  return {
    previewToken: token,
    target: { ...targetInfo, chosen },
    rivalStatus:
      chosen === 'opened-folder' ? 'opened-folder-elsewhere' : 'listed',
    agents: [
      {
        agentId: 'a',
        files: [
          {
            relPath: '.claude/agents/a.md',
            target: 'claude',
            certainty: 'definite',
            willOverwrite: true,
            localState: 'exists',
            revision,
          },
        ],
      },
      {
        agentId: 'b',
        files: [
          {
            relPath: '.claude/agents/b.md',
            target: 'claude',
            certainty: 'definite',
            willOverwrite: true,
            localState: 'unreadable',
          },
        ],
      },
    ],
  };
}

// jsdom lacks the native dialog methods; preserve the open attribute like the NativeModal specs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('AgentSelectionComponent', () => {
  let component: AgentSelectionComponent;
  let fixture: ComponentFixture<AgentSelectionComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;

  let recommendations: ReturnType<typeof signal<AgentRecommendation[]>>;
  let selectedAgentsMap: ReturnType<typeof signal<Record<string, boolean>>>;
  let recommendedAgents: ReturnType<typeof signal<AgentRecommendation[]>>;
  let multiPhaseResult: ReturnType<
    typeof signal<MultiPhaseAnalysisResponse | null>
  >;
  let communityPacks: ReturnType<typeof signal<AgentPackInfoDto[]>>;
  let communityPacksLoading: ReturnType<typeof signal<boolean>>;
  let expandedPackSource: ReturnType<typeof signal<string | null>>;

  beforeEach(async () => {
    recommendations = signal<AgentRecommendation[]>([]);
    selectedAgentsMap = signal<Record<string, boolean>>({});
    recommendedAgents = signal<AgentRecommendation[]>([]);
    multiPhaseResult = signal<MultiPhaseAnalysisResponse | null>(
      mockMultiPhase,
    );
    communityPacks = signal<AgentPackInfoDto[]>([]);
    communityPacksLoading = signal(false);
    expandedPackSource = signal<string | null>(null);

    mockStateService = {
      recommendations: recommendations.asReadonly(),
      selectedAgentsMap: selectedAgentsMap.asReadonly(),
      recommendedAgents: recommendedAgents.asReadonly(),
      multiPhaseResult: multiPhaseResult.asReadonly(),
      communityPacks: communityPacks.asReadonly(),
      communityPacksLoading: communityPacksLoading.asReadonly(),
      expandedPackSource: expandedPackSource.asReadonly(),
      toggleAgentRecommendationSelection: jest.fn((agentId: string) => {
        const next = { ...selectedAgentsMap() };
        next[agentId] = !next[agentId];
        selectedAgentsMap.set(next);
      }),
      selectAllRecommended: jest.fn(() => {
        const next = { ...selectedAgentsMap() };
        for (const agent of recommendedAgents()) next[agent.agentId] = true;
        selectedAgentsMap.set(next);
      }),
      deselectAllAgents: jest.fn(() => selectedAgentsMap.set({})),
      setCurrentStep: jest.fn(),
      setSkillGenerationProgress: jest.fn(),
      setCommunityPacks: jest.fn((packs: AgentPackInfoDto[]) =>
        communityPacks.set(packs),
      ),
      setCommunityPacksLoading: jest.fn((loading: boolean) =>
        communityPacksLoading.set(loading),
      ),
      toggleExpandedPack: jest.fn((source: string) => {
        expandedPackSource.set(expandedPackSource() === source ? null : source);
      }),
    } as unknown as Partial<SetupWizardStateService>;

    mockRpcService = {
      previewGeneration: jest.fn().mockResolvedValue(preview),
      submitAgentSelection: jest.fn().mockResolvedValue({ success: true }),
      listAgentPacks: jest.fn().mockResolvedValue([]),
      planPackInstall: jest.fn(),
      installPackAgents: jest.fn().mockResolvedValue({
        success: true,
        agentsDownloaded: 1,
        fromCache: false,
      }),
    } as unknown as Partial<WizardRpcService>;

    await TestBed.configureTestingModule({
      imports: [AgentSelectionComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
        { provide: VSCodeService, useValue: { isElectron: true } },
        { provide: ThemeService, useValue: { isDarkMode: signal(true) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentSelectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /**
   * Renders until the deferred dialogs have loaded: the first pass fires the
   * `@defer` trigger, later passes render the loaded block and let its
   * effects (the prompt's plan call) settle.
   */
  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initial state', () => {
    it('should start on the project tab', () => {
      expect(component['activeTab']()).toBe('project');
    });

    it('should initialize with isGenerating false and no error', () => {
      expect(component['isGenerating']()).toBe(false);
      expect(component['errorMessage']()).toBeNull();
    });

    it('should show empty-recommendations message when none available', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('No Agent Recommendations');
    });
  });

  describe('Recommendation display', () => {
    beforeEach(() => {
      recommendations.set([
        makeRecommendation({
          agentId: 'frontend-developer',
          agentName: 'Frontend Developer',
          relevanceScore: 95,
          category: 'development',
        }),
        makeRecommendation({
          agentId: 'qa-tester',
          agentName: 'QA Tester',
          relevanceScore: 70,
          category: 'qa',
        }),
      ]);
      fixture.detectChanges();
    });

    it('should render a card per recommendation', () => {
      const cards = fixture.nativeElement.querySelectorAll('[role="checkbox"]');
      expect(cards.length).toBe(2);
    });

    it('should display agent names', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Frontend Developer');
      expect(text).toContain('QA Tester');
    });

    it('should display relevance score percentages', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('95%');
      expect(text).toContain('70%');
    });

    it('should sort recommendations by score descending', () => {
      const sorted = component['sortedRecommendations']();
      expect(sorted[0].agentId).toBe('frontend-developer');
      expect(sorted[1].agentId).toBe('qa-tester');
    });

    it('should group agents by category', () => {
      expect(
        component['getAgentsByCategory']('development').map((a) => a.agentId),
      ).toEqual(['frontend-developer']);
      expect(
        component['getAgentsByCategory']('qa').map((a) => a.agentId),
      ).toEqual(['qa-tester']);
    });

    it('should place unknown categories under "other"', () => {
      recommendations.set([
        makeRecommendation({
          agentId: 'mystery',
          agentName: 'Mystery Agent',
          category: 'unknown-category' as never,
        }),
      ]);
      expect(
        component['getAgentsByCategory']('other').map((a) => a.agentId),
      ).toEqual(['mystery']);
    });
  });

  describe('Selection', () => {
    beforeEach(() => {
      recommendations.set([
        makeRecommendation({ agentId: 'a', agentName: 'Agent A' }),
        makeRecommendation({ agentId: 'b', agentName: 'Agent B' }),
      ]);
      fixture.detectChanges();
    });

    it('should toggle an agent on checkbox change', () => {
      const checkbox = fixture.nativeElement.querySelector(
        'input[type="checkbox"]',
      );
      checkbox.dispatchEvent(new Event('change'));

      expect(
        mockStateService.toggleAgentRecommendationSelection,
      ).toHaveBeenCalled();
    });

    it('should compute selected count from the selection map', () => {
      selectedAgentsMap.set({ a: true, b: false });
      expect(component['selectedCount']()).toBe(1);
    });

    it('should report noneSelected when nothing selected', () => {
      expect(component['noneSelected']()).toBe(true);
      selectedAgentsMap.set({ a: true });
      expect(component['noneSelected']()).toBe(false);
    });

    it('should delegate select-all-recommended to state', () => {
      recommendedAgents.set([makeRecommendation({ agentId: 'a' })]);
      component['onSelectAllRecommended']();
      expect(mockStateService.selectAllRecommended).toHaveBeenCalled();
      expect(selectedAgentsMap()['a']).toBe(true);
    });

    it('should delegate deselect-all to state', () => {
      selectedAgentsMap.set({ a: true });
      component['onDeselectAll']();
      expect(mockStateService.deselectAllAgents).toHaveBeenCalled();
      expect(component['selectedCount']()).toBe(0);
    });

    it('should compute allRecommendedSelected', () => {
      recommendedAgents.set([
        makeRecommendation({ agentId: 'a' }),
        makeRecommendation({ agentId: 'b' }),
      ]);
      selectedAgentsMap.set({ a: true });
      expect(component['allRecommendedSelected']()).toBe(false);
      selectedAgentsMap.set({ a: true, b: true });
      expect(component['allRecommendedSelected']()).toBe(true);
    });
  });

  describe('Navigation', () => {
    it('should go back to the analysis step', () => {
      component['onBack']();
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('analysis');
    });
  });

  describe('Generate agents', () => {
    beforeEach(() => {
      recommendations.set([
        makeRecommendation({
          agentId: 'a',
          agentName: 'Agent A',
          relevanceScore: 90,
          matchedCriteria: ['x'],
        }),
      ]);
      selectedAgentsMap.set({ a: true });
      fixture.detectChanges();
    });

    it('should submit the selected agents with the analysis dir', async () => {
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();

      // Generation now starts only after preview confirmation.
      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledWith(
        [
          {
            id: 'a',
            name: 'Agent A',
            selected: true,
            score: 90,
            reason: 'x',
            autoInclude: true,
          },
        ],
        mockMultiPhase.analysisDir,
        // An older host sends no token or target; an existing file it cannot
        // classify is forced Keep, so no Replace is sent.
        { fileDecisions: {} },
      );
    });

    it('should transition to the generation step on success', async () => {
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();

      // Generation now starts only after preview confirmation.
      expect(mockStateService.setSkillGenerationProgress).toHaveBeenCalled();
      // Generation now starts only after preview confirmation.
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith(
        'generation',
      );
    });

    it('should reset isGenerating after completion', async () => {
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();
      // Generation now starts only after preview confirmation.
      expect(component['isGenerating']()).toBe(false);
    });

    it('should not submit when nothing is selected', async () => {
      selectedAgentsMap.set({});
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();
      // Generation now starts only after preview confirmation.
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it('should surface an error when analysis data is missing', async () => {
      multiPhaseResult.set(null);
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();

      // Generation now starts only after preview confirmation.
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
      // Generation now starts only after preview confirmation.
      expect(component['errorMessage']()).toContain('could not start');
      // Generation now starts only after preview confirmation.
      expect(mockStateService.setCurrentStep).not.toHaveBeenCalledWith(
        'generation',
      );
    });

    it('should surface a backend rejection as an error', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      (mockRpcService.submitAgentSelection as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Backend exploded',
      });

      await component['onGenerateAgents']();
      await component['onConfirmPreview']();

      // Generation now starts only after preview confirmation.
      expect(component['errorMessage']()).toContain('could not start');
      // Generation now starts only after preview confirmation.
      expect(mockStateService.setCurrentStep).not.toHaveBeenCalledWith(
        'generation',
      );
    });

    it('should surface a thrown RPC error', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      (mockRpcService.submitAgentSelection as jest.Mock).mockRejectedValue(
        new Error('RPC timeout'),
      );

      await component['onGenerateAgents']();
      await component['onConfirmPreview']();

      // Generation now starts only after preview confirmation.
      expect(component['errorMessage']()).toContain('could not start');
      // Generation now starts only after preview confirmation.
      expect(component['isGenerating']()).toBe(false);
    });

    it('should prevent re-entry while generating', async () => {
      let resolve!: (v: { success: boolean }) => void;
      (mockRpcService.submitAgentSelection as jest.Mock).mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );

      await component['onGenerateAgents']();
      const first = component['onConfirmPreview']();
      // Let the confirm-time re-preview settle so the submit is in flight.
      await new Promise((r) => setTimeout(r, 0));
      const second = component['onConfirmPreview']();

      // Generation now starts only after preview confirmation.
      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);

      resolve({ success: true });
      await Promise.all([first, second]);
    });
    it('renders the preview modal with state badges, conditional files and the warning', async () => {
      await component['onGenerateAgents']();
      await settle();
      const dialog: HTMLDialogElement =
        fixture.nativeElement.querySelector('dialog');
      expect(dialog.open).toBe(true);
      expect(dialog.getAttribute('aria-label')).toBe(
        'Preview agent generation',
      );
      expect(dialog.textContent).toContain('.claude/agents/a.md');
      // An older host sends no localState: an existing file is forced Keep.
      expect(
        dialog
          .querySelector('[data-testid="file-state-badge"]')
          ?.textContent?.trim(),
      ).toBe('Could not read file');
      expect(dialog.textContent).toContain(preview.warning);
      const conditional = dialog.querySelector(
        '[data-testid="conditional-files"]',
      );
      // No warning sentence in the modal uses bare text-warning (2.46:1 on
      // the light theme's base-100).
      expect(dialog.querySelector('.text-warning')).toBeNull();
      expect(conditional?.textContent).toContain('May also write, if');
      expect(conditional?.textContent).toContain(
        preview.agents[0].files[1].condition,
      );
      expect(conditional?.textContent).toContain('.codex/agents/a.toml');
      expect(conditional?.textContent).not.toContain('.claude/agents/a.md');
      expect(mockRpcService.previewGeneration).toHaveBeenCalledWith(
        ['a'],
        undefined,
      );
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it('cancels the preview without submitting and keeps selection', async () => {
      await component['onGenerateAgents']();
      await settle();
      const cancel: HTMLButtonElement = fixture.nativeElement.querySelector(
        '[modal-footer] button',
      );
      cancel.click();
      await settle();
      expect(component['preview'].isOpen()).toBe(false);
      expect(selectedAgentsMap()).toEqual({ a: true });
      await component['onConfirmPreview']();
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it('re-previews unchanged targets and submits once on confirm', async () => {
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();
      expect(mockRpcService.previewGeneration).toHaveBeenCalledTimes(2);
      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);
    });

    it('shows Targets changed since preview and requires a second confirm for a changed definite set', async () => {
      const changed: WizardPreviewGenerationResponse = {
        agents: [
          {
            agentId: 'a',
            files: preview.agents[0].files.map((file) => ({
              ...file,
              certainty: 'definite',
            })),
          },
        ],
      };
      await component['onGenerateAgents']();
      (mockRpcService.previewGeneration as jest.Mock).mockResolvedValue(
        changed,
      );
      await component['onConfirmPreview']();
      await settle();
      expect(
        fixture.nativeElement.querySelector('dialog').textContent,
      ).toContain('Targets changed since preview');
      expect(
        fixture.nativeElement.querySelector('dialog').textContent,
      ).toContain('.codex/agents/a.toml');
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
      await component['onConfirmPreview']();
      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);
      expect(mockRpcService.previewGeneration).toHaveBeenCalledTimes(3);
    });

    it('requires renewed confirmation when a definite target changes overwrite status', async () => {
      await component['onGenerateAgents']();
      (mockRpcService.previewGeneration as jest.Mock).mockResolvedValue({
        agents: [
          {
            agentId: 'a',
            files: preview.agents[0].files.map((file) =>
              file.certainty === 'definite'
                ? { ...file, willOverwrite: false }
                : file,
            ),
          },
        ],
      });
      await component['onConfirmPreview']();
      expect(component['preview'].changed()).toBe(true);
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it.each(['initial', 'confirm'])(
      'shows the reason and permits explicit generation after %s preview failure',
      async (stage) => {
        if (stage === 'confirm') await component['onGenerateAgents']();
        (mockRpcService.previewGeneration as jest.Mock).mockRejectedValue(
          new Error('preview offline'),
        );
        if (stage === 'initial') await component['onGenerateAgents']();
        else await component['onConfirmPreview']();
        await settle();
        const dialog: HTMLDialogElement =
          fixture.nativeElement.querySelector('dialog');
        expect(dialog.textContent).toContain('Preview unavailable');
        expect(dialog.textContent).not.toContain('preview offline');
        const generate = dialog.querySelector<HTMLButtonElement>(
          '[modal-footer] .btn-primary',
        );
        expect(generate?.disabled).toBe(false);
        expect(generate?.textContent).toContain('Generate without preview');
        expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
        generate?.click();
        await fixture.whenStable();
        expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);
        // Generate without preview sends no token and no decisions.
        expect(
          (mockRpcService.submitAgentSelection as jest.Mock).mock.calls[0],
        ).toHaveLength(2);
      },
    );

    it.each(['preview', 'confirm'])(
      'keeps the chosen opened-folder target when generating without preview after a %s failure (B1)',
      async (stage) => {
        const rpc = mockRpcService.previewGeneration as jest.Mock;
        rpc.mockResolvedValueOnce(decisionPreview('rev-a'));
        await component['onGenerateAgents']();
        if (stage === 'preview') {
          rpc.mockRejectedValueOnce(new Error('preview offline'));
          await component['changeTarget']('opened-folder');
        } else {
          rpc.mockResolvedValueOnce(decisionPreview('rev-a', 'opened-folder'));
          await component['changeTarget']('opened-folder');
          rpc.mockRejectedValueOnce(new Error('preview offline'));
          await component['onConfirmPreview']();
        }
        expect(component['preview'].error()).toBe('Preview unavailable');
        expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();

        await component['onConfirmPreview']();
        const call = (mockRpcService.submitAgentSelection as jest.Mock).mock
          .calls[0];
        // No token and no Replace: create-only, but at the chosen root.
        expect(call[2]).toEqual({ fileDecisions: {}, target: 'opened-folder' });
      },
    );

    it('submits the fresh token, the Replace with its revision and the target', async () => {
      (mockRpcService.previewGeneration as jest.Mock)
        .mockResolvedValueOnce(decisionPreview('rev-a', 'harness-root', 't1'))
        .mockResolvedValueOnce(decisionPreview('rev-a', 'harness-root', 't2'));
      await component['onGenerateAgents']();
      component['setRowDecision']({ id: 'a', decision: 'replace' });
      component['setRowDecision']({ id: 'b', decision: 'replace' });
      await component['onConfirmPreview']();

      const call = (mockRpcService.submitAgentSelection as jest.Mock).mock
        .calls[0];
      expect(call[2]).toEqual({
        previewToken: 't2',
        fileDecisions: { a: { decision: 'replace', revision: 'rev-a' } },
        target: 'harness-root',
      });
    });

    it('asks for another review when a replaced file changed since the preview (exists A -> exists B)', async () => {
      (mockRpcService.previewGeneration as jest.Mock)
        .mockResolvedValueOnce(decisionPreview('rev-a'))
        .mockResolvedValueOnce(decisionPreview('rev-b'));
      await component['onGenerateAgents']();
      component['setRowDecision']({ id: 'a', decision: 'replace' });
      await component['onConfirmPreview']();

      expect(component['preview'].changed()).toBe(true);
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
      expect(
        component['preview'].decisions()?.rows.find((row) => row.id === 'a')
          ?.decision,
      ).toBe('keep');
    });

    it('re-runs the comparison for another target and resets every choice to Keep', async () => {
      (mockRpcService.previewGeneration as jest.Mock)
        .mockResolvedValueOnce(decisionPreview('rev-a'))
        .mockResolvedValueOnce(decisionPreview('rev-a', 'opened-folder'));
      await component['onGenerateAgents']();
      component['setRowDecision']({ id: 'a', decision: 'replace' });
      await component['changeTarget']('opened-folder');
      await settle();

      expect(mockRpcService.previewGeneration).toHaveBeenLastCalledWith(
        ['a'],
        'opened-folder',
      );
      const snapshot = component['preview'].decisions();
      expect(snapshot?.target).toBe('opened-folder');
      expect(snapshot?.rows.every((row) => row.decision === 'keep')).toBe(true);
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="target-reset-status"]')
          ?.textContent?.trim(),
      ).toBe(
        'Target changed. The comparison was run again and every choice is reset to Keep.',
      );
    });

    it('re-previews with choices reset and the target kept after preview-required', async () => {
      (mockRpcService.previewGeneration as jest.Mock)
        .mockResolvedValueOnce(decisionPreview('rev-a'))
        .mockResolvedValueOnce(decisionPreview('rev-a', 'opened-folder'))
        .mockResolvedValueOnce(decisionPreview('rev-a', 'opened-folder'))
        .mockResolvedValueOnce(decisionPreview('rev-a', 'opened-folder', 't9'));
      (mockRpcService.submitAgentSelection as jest.Mock).mockResolvedValueOnce({
        success: false,
        rejection: { reason: 'preview-required' },
      });
      await component['onGenerateAgents']();
      await component['changeTarget']('opened-folder');
      component['setRowDecision']({ id: 'a', decision: 'replace' });
      await component['onConfirmPreview']();

      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);
      expect(component['preview'].isOpen()).toBe(true);
      expect(component['preview'].changed()).toBe(true);
      expect(component['errorMessage']()).toBeNull();
      expect(mockStateService.setCurrentStep).not.toHaveBeenCalledWith(
        'generation',
      );
      expect(mockRpcService.previewGeneration).toHaveBeenLastCalledWith(
        ['a'],
        'opened-folder',
      );
      expect(
        component['preview']
          .decisions()
          ?.rows.every((row) => row.decision === 'keep'),
      ).toBe(true);
    });

    it('ignores a pending re-preview after cancellation', async () => {
      await component['onGenerateAgents']();
      let resolve!: (value: WizardPreviewGenerationResponse) => void;
      (mockRpcService.previewGeneration as jest.Mock).mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const confirm = component['onConfirmPreview']();
      component['preview'].cancel();
      resolve(preview);
      await confirm;
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
      expect(component['preview'].isOpen()).toBe(false);
    });

    it('compares definite paths as a set regardless of ordering or conditional changes', async () => {
      const files = [
        preview.agents[0].files[0],
        { ...preview.agents[0].files[0], relPath: '.claude/agents/b.md' },
      ];
      (mockRpcService.previewGeneration as jest.Mock)
        .mockResolvedValueOnce({ agents: [{ agentId: 'a', files }] })
        .mockResolvedValueOnce({
          agents: [
            { agentId: 'a', files: [...files].reverse().concat(files[0]) },
          ],
        });
      await component['onGenerateAgents']();
      await component['onConfirmPreview']();
      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe('Community packs tab', () => {
    const pack: AgentPackInfoDto = {
      source: 'https://example.com/pack.json',
      name: 'Example Pack',
      description: 'A pack of agents',
      agents: [
        {
          file: 'agent-one.md',
          name: 'Agent One',
          description: 'First agent',
          category: 'development',
        },
      ],
    } as unknown as AgentPackInfoDto;

    it('should switch to the community tab and lazy-load packs', async () => {
      component['onSwitchToCommunityTab']();
      await fixture.whenStable();

      expect(component['activeTab']()).toBe('community');
      expect(mockRpcService.listAgentPacks).toHaveBeenCalled();
    });

    it('should toggle pack expansion through state', () => {
      component['onTogglePackExpand'](pack.source);
      expect(mockStateService.toggleExpandedPack).toHaveBeenCalledWith(
        pack.source,
      );
      expect(component['isPackExpanded'](pack.source)).toBe(true);
    });

    const packPlan = (
      chosen: 'harness-root' | 'opened-folder' = 'harness-root',
    ): WizardPlanPackInstallResult => ({
      planToken: 'plan-1',
      target: { ...targetInfo, chosen },
      files: [
        {
          file: 'agent-one.md',
          state: 'differs',
          revision: 'rev-1',
          localText: 'a',
          incomingText: 'b',
        },
      ],
    });

    async function openPackTab(): Promise<void> {
      communityPacks.set([pack]);
      component['activeTab'].set('community');
      expandedPackSource.set(pack.source);
      fixture.detectChanges();
    }

    const button = (testId: string): HTMLButtonElement =>
      fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    it('opens the install prompt for a single agent and installs with the plan', async () => {
      (mockRpcService.planPackInstall as jest.Mock).mockResolvedValue(
        packPlan(),
      );
      await openPackTab();
      component['onInstallAgent'](pack.source, 'agent-one.md');
      await settle();

      expect(mockRpcService.planPackInstall).toHaveBeenCalledWith(
        pack.source,
        ['agent-one.md'],
        undefined,
      );
      expect(mockRpcService.installPackAgents).not.toHaveBeenCalled();
      const prompt: HTMLDialogElement =
        fixture.nativeElement.querySelector('ptah-pack-install-prompt dialog');
      expect(prompt.open).toBe(true);
      expect(prompt.textContent).toContain(
        'Install agent-one.md from "Example Pack"?',
      );

      button('pack-confirm').click();
      await settle();
      expect(mockRpcService.installPackAgents).toHaveBeenCalledWith(
        pack.source,
        ['agent-one.md'],
        { planToken: 'plan-1', decisions: {}, target: 'harness-root' },
      );
      expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
        'installed',
      );
    });

    it('opens the same prompt from Install All and Choose location', async () => {
      (mockRpcService.planPackInstall as jest.Mock).mockResolvedValue(
        packPlan(),
      );
      await openPackTab();
      button('pack-install-all').click();
      await settle();
      expect(fixture.nativeElement.textContent).toContain(
        'Install community pack "Example Pack"?',
      );
      expect(component['packRequest']()?.scope).toBe('pack');

      component['packRequest'].set(null);
      fixture.detectChanges();
      button('pack-choose-location').click();
      await settle();
      expect(component['packRequest']()?.files).toEqual(['agent-one.md']);
      expect(mockRpcService.planPackInstall).toHaveBeenCalledTimes(2);
    });

    it('shows a kept file as Kept, never as Installed', async () => {
      (mockRpcService.planPackInstall as jest.Mock).mockResolvedValue(
        packPlan(),
      );
      (mockRpcService.installPackAgents as jest.Mock).mockResolvedValue({
        success: true,
        agentsDownloaded: 0,
        fromCache: false,
        files: [{ file: 'agent-one.md', outcome: 'kept' }],
      });
      await openPackTab();
      component['onInstallAgent'](pack.source, 'agent-one.md');
      await settle();
      button('pack-confirm').click();
      await settle();

      expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
        'kept',
      );
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="pack-agent-kept"]')
          ?.textContent?.trim(),
      ).toBe('Kept');
      expect(fixture.nativeElement.textContent).toContain(
        'Your file was not changed. Origin stays Workspace file.',
      );
      expect(
        fixture.nativeElement.querySelector('[data-testid="pack-result"]')
          ?.textContent,
      ).toContain('1 Kept (your file)');
    });

    it('marks a failed file with its reason and retries through the prompt', async () => {
      (mockRpcService.planPackInstall as jest.Mock).mockResolvedValue(
        packPlan(),
      );
      (mockRpcService.installPackAgents as jest.Mock).mockResolvedValue({
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: 'Could not write agent-one.md',
        files: [{ file: 'agent-one.md', outcome: 'failed' }],
      });
      await openPackTab();
      component['onInstallAgent'](pack.source, 'agent-one.md');
      await settle();
      button('pack-confirm').click();
      await settle();

      expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
        'error',
      );
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="pack-agent-failure"]',
        )?.textContent,
      ).toContain('The install could not be completed. Try again.');
      expect(fixture.nativeElement.textContent).not.toContain(
        'Could not write agent-one.md',
      );

      const retry: HTMLButtonElement = Array.from(
        fixture.nativeElement.querySelectorAll(
          'button',
        ) as NodeListOf<HTMLButtonElement>,
      ).find(
        (node) => node.textContent?.trim() === 'Retry',
      ) as HTMLButtonElement;
      retry.click();
      await settle();
      expect(component['packRequest']()).toEqual(
        expect.objectContaining({ scope: 'file', files: ['agent-one.md'] }),
      );
      // A retry starts every choice on Keep: nothing is replaced unasked.
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="keep-segment"]')
          ?.getAttribute('aria-checked'),
      ).toBe('true');
    });

    it('shows the opened-folder notice and remembers the target for the next prompt', async () => {
      (mockRpcService.planPackInstall as jest.Mock)
        .mockResolvedValueOnce(packPlan())
        .mockResolvedValueOnce(packPlan('opened-folder'));
      await openPackTab();
      component['onInstallAgent'](pack.source, 'agent-one.md');
      await settle();
      button('target-opened').click();
      await settle();
      button('pack-confirm').click();
      await settle();

      expect(
        fixture.nativeElement
          .querySelector('[data-testid="pack-opened-folder-notice"]')
          ?.textContent?.trim(),
      ).toBe(
        'These agents are in packages/api/.claude/agents. They will not reach other CLIs and will not appear in the Library.',
      );
      expect(
        fixture.nativeElement.querySelector('[data-testid="pack-install-to"]')
          ?.textContent,
      ).toContain('(opened folder only)');
    });

    it('should report when all pack agents are installed', async () => {
      expect(component['allPackAgentsInstalled'](pack)).toBe(false);
      await TestBed.inject(PackInstallStore).install('wizard', {
        request: {
          source: pack.source,
          packName: pack.name,
          files: ['agent-one.md'],
          scope: 'file',
          target: null,
        },
        plan: packPlan(),
        decisions: {},
      });
      expect(component['allPackAgentsInstalled'](pack)).toBe(true);
      expect(component['installedCommunityCount']()).toBe(1);
    });

    describe('install outlives the component (B2, B4)', () => {
      function pendingInstall(): (
        result: WizardInstallPackAgentsResult,
      ) => void {
        let resolve!: (result: WizardInstallPackAgentsResult) => void;
        (mockRpcService.installPackAgents as jest.Mock).mockReturnValueOnce(
          new Promise<WizardInstallPackAgentsResult>((r) => {
            resolve = r;
          }),
        );
        return (result) => resolve(result);
      }

      async function confirmThenDestroy(): Promise<
        (result: WizardInstallPackAgentsResult) => void
      > {
        (mockRpcService.planPackInstall as jest.Mock).mockResolvedValue(
          packPlan(),
        );
        const finish = pendingInstall();
        await openPackTab();
        component['onInstallAgent'](pack.source, 'agent-one.md');
        await settle();
        button('pack-confirm').click();
        await settle();
        expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
          'installing',
        );
        fixture.destroy();
        return finish;
      }

      async function recreate(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture = TestBed.createComponent(AgentSelectionComponent);
        component = fixture.componentInstance;
        component['activeTab'].set('community');
        fixture.detectChanges();
      }

      it('reaches a terminal success while destroyed and restores it', async () => {
        const finish = await confirmThenDestroy();
        finish({
          success: true,
          agentsDownloaded: 1,
          fromCache: false,
          files: [{ file: 'agent-one.md', outcome: 'written' }],
        });
        await recreate();

        const store = TestBed.inject(PackInstallStore);
        expect(store.fileState('wizard', pack.source, 'agent-one.md')).toBe(
          'installed',
        );
        expect(store.isInstalling('wizard')).toBe(false);
        expect(
          fixture.nativeElement.querySelector('[data-testid="pack-result"]')
            ?.textContent,
        ).toContain('Installed');
        expect(component['installedCommunityCount']()).toBe(1);
      });

      it('reaches a terminal failure while destroyed, restores it safely and leaves Retry usable', async () => {
        const finish = await confirmThenDestroy();
        finish({
          success: false,
          agentsDownloaded: 0,
          fromCache: false,
          error: 'token=sk-live-SECRET <script>alert(1)</script>',
        });
        await recreate();

        expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
          'error',
        );
        const text: string = fixture.nativeElement.textContent;
        expect(text).toContain(
          'The install could not be completed. Try again.',
        );
        expect(text).not.toContain('sk-live');
        expect(fixture.nativeElement.innerHTML).not.toContain('script');
        expect(button('pack-install-all').disabled).toBe(false);
        expect(button('pack-choose-location').disabled).toBe(false);

        // A new prompt after re-creation starts on Keep: no stored consent.
        (mockRpcService.planPackInstall as jest.Mock).mockResolvedValue(
          packPlan(),
        );
        component['onInstallAgent'](pack.source, 'agent-one.md');
        await settle();
        expect(
          fixture.nativeElement
            .querySelector('[data-testid="keep-segment"]')
            ?.getAttribute('aria-checked'),
        ).toBe('true');
      });

      it('restores Kept after re-creation', async () => {
        const finish = await confirmThenDestroy();
        finish({
          success: true,
          agentsDownloaded: 0,
          fromCache: false,
          files: [{ file: 'agent-one.md', outcome: 'changed-since-preview' }],
        });
        await recreate();
        expect(
          fixture.nativeElement
            .querySelector('[data-testid="pack-agent-kept"]')
            ?.textContent?.trim(),
        ).toBe('Kept');
      });
    });
  });

  describe('Category helpers', () => {
    it('should map categories to labels', () => {
      expect(component['getCategoryLabel']('planning')).toBe(
        'Planning & Architecture',
      );
      expect(component['getCategoryLabel']('qa')).toBe('Quality Assurance');
      expect(component['getCategoryLabel']('other')).toBe('Other');
    });

    it('should map score to a badge class', () => {
      expect(component['getScoreBadgeClass'](90)).toBe('badge-success');
      expect(component['getScoreBadgeClass'](70)).toBe('badge-warning');
      expect(component['getScoreBadgeClass'](40)).toBe('badge-error');
    });
  });

  describe('Accessibility', () => {
    it('should expose recommendation cards as checkbox role with aria-label', () => {
      recommendations.set([
        makeRecommendation({
          agentId: 'a',
          agentName: 'Frontend Developer',
        }),
      ]);
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('[role="checkbox"]');
      expect(card.getAttribute('aria-label')).toContain('Frontend Developer');
    });
  });
});
