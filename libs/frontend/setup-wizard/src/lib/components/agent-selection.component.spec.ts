import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  AgentPackInfoDto,
  AgentRecommendation,
  MultiPhaseAnalysisResponse,
} from '@ptah-extension/shared';
import { AgentSelectionComponent } from './agent-selection.component';
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
  let installedCommunityAgentCount: ReturnType<typeof signal<number>>;
  let expandedPackSource: ReturnType<typeof signal<string | null>>;
  let agentInstallStatus: ReturnType<
    typeof signal<Record<string, 'idle' | 'installing' | 'installed' | 'error'>>
  >;

  beforeEach(async () => {
    recommendations = signal<AgentRecommendation[]>([]);
    selectedAgentsMap = signal<Record<string, boolean>>({});
    recommendedAgents = signal<AgentRecommendation[]>([]);
    multiPhaseResult = signal<MultiPhaseAnalysisResponse | null>(
      mockMultiPhase,
    );
    communityPacks = signal<AgentPackInfoDto[]>([]);
    communityPacksLoading = signal(false);
    installedCommunityAgentCount = signal(0);
    expandedPackSource = signal<string | null>(null);
    agentInstallStatus = signal<
      Record<string, 'idle' | 'installing' | 'installed' | 'error'>
    >({});

    mockStateService = {
      recommendations: recommendations.asReadonly(),
      selectedAgentsMap: selectedAgentsMap.asReadonly(),
      recommendedAgents: recommendedAgents.asReadonly(),
      multiPhaseResult: multiPhaseResult.asReadonly(),
      communityPacks: communityPacks.asReadonly(),
      communityPacksLoading: communityPacksLoading.asReadonly(),
      installedCommunityAgentCount: installedCommunityAgentCount.asReadonly(),
      expandedPackSource: expandedPackSource.asReadonly(),
      agentInstallStatus: agentInstallStatus.asReadonly(),
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
      setAgentInstallStatus: jest.fn(
        (
          key: string,
          status: 'idle' | 'installing' | 'installed' | 'error',
        ) => {
          agentInstallStatus.set({ ...agentInstallStatus(), [key]: status });
        },
      ),
      toggleExpandedPack: jest.fn((source: string) => {
        expandedPackSource.set(expandedPackSource() === source ? null : source);
      }),
    } as unknown as Partial<SetupWizardStateService>;

    mockRpcService = {
      submitAgentSelection: jest.fn().mockResolvedValue({ success: true }),
      listAgentPacks: jest.fn().mockResolvedValue([]),
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentSelectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

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
      );
    });

    it('should transition to the generation step on success', async () => {
      await component['onGenerateAgents']();

      expect(mockStateService.setSkillGenerationProgress).toHaveBeenCalled();
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith(
        'generation',
      );
    });

    it('should reset isGenerating after completion', async () => {
      await component['onGenerateAgents']();
      expect(component['isGenerating']()).toBe(false);
    });

    it('should not submit when nothing is selected', async () => {
      selectedAgentsMap.set({});
      await component['onGenerateAgents']();
      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
    });

    it('should surface an error when analysis data is missing', async () => {
      multiPhaseResult.set(null);
      await component['onGenerateAgents']();

      expect(mockRpcService.submitAgentSelection).not.toHaveBeenCalled();
      expect(component['errorMessage']()).toContain(
        'No analysis data available',
      );
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

      expect(component['errorMessage']()).toContain('Backend exploded');
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

      expect(component['errorMessage']()).toContain('RPC timeout');
      expect(component['isGenerating']()).toBe(false);
    });

    it('should prevent re-entry while generating', async () => {
      let resolve!: (v: { success: boolean }) => void;
      (mockRpcService.submitAgentSelection as jest.Mock).mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );

      const first = component['onGenerateAgents']();
      const second = component['onGenerateAgents']();

      expect(mockRpcService.submitAgentSelection).toHaveBeenCalledTimes(1);

      resolve({ success: true });
      await Promise.all([first, second]);
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

    it('should install a single agent and mark it installed', async () => {
      await component['onInstallAgent'](pack.source, 'agent-one.md');

      expect(mockRpcService.installPackAgents).toHaveBeenCalledWith(
        pack.source,
        ['agent-one.md'],
      );
      expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
        'installed',
      );
    });

    it('should mark an agent errored when install throws', async () => {
      (mockRpcService.installPackAgents as jest.Mock).mockRejectedValue(
        new Error('network down'),
      );
      await component['onInstallAgent'](pack.source, 'agent-one.md');

      expect(component['getAgentStatus'](pack.source, 'agent-one.md')).toBe(
        'error',
      );
    });

    it('should report when all pack agents are installed', () => {
      expect(component['allPackAgentsInstalled'](pack)).toBe(false);
      agentInstallStatus.set({
        [`${pack.source}::agent-one.md`]: 'installed',
      });
      expect(component['allPackAgentsInstalled'](pack)).toBe(true);
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
