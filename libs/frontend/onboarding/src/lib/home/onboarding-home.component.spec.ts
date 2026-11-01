import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import type { SetupStatusGetResponse } from '@ptah-extension/shared';
import {
  OnboardingFlagService,
  type OnboardingFlag,
} from '../first-run/onboarding-flag.service';
import {
  ClaudeReadinessStore,
  type ClaudeReadinessState,
  type ClaudeReadinessView,
} from '../ready/claude-readiness.store';
import { OnboardingHomeComponent } from './onboarding-home.component';
import { OnboardingWorkspaceStore } from '../shell/onboarding-workspace.store';
import { WizardRpcService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from '../analyze/analysis-step.store';
import {
  OnboardingResumeStore,
  type OnboardingResumeItem,
} from './onboarding-resume.store';

/** The `SetupStatusStore` surface Home reads, as writable signals. */
function createStatusStore() {
  return {
    workspaceNotOpen: signal(false),
    folderError: signal<string | null>(null),
    isLoading: signal(false),
    status: signal<SetupStatusGetResponse | null>(null),
    error: signal<string | null>(null),
    scanError: signal<string | null>(null),
    scanReady: signal<boolean | null>(null),
    agentsReady: signal<boolean | null>(null),
    refresh: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn().mockResolvedValue(undefined),
    openFolder: jest.fn().mockResolvedValue(undefined),
  };
}

const CONFIGURED: SetupStatusGetResponse = {
  isConfigured: true,
  agentCount: 4,
  ruleCount: 2,
  lastUpdated: null,
  hasClaudeConfig: true,
};

describe('OnboardingHomeComponent', () => {
  let store: ReturnType<typeof createStatusStore>;
  let markDismissed: jest.Mock<void, []>;
  let setCurrentView: jest.Mock<void, [string]>;
  let fixture: ComponentFixture<OnboardingHomeComponent>;
  let readiness: ReturnType<typeof createReadinessStore>;
  let flag: WritableSignal<OnboardingFlag>;
  let workspacePath: WritableSignal<string>;
  let workspaceReady: WritableSignal<boolean>;
  const resume = {
    items: signal<readonly OnboardingResumeItem[]>([]),
    refresh: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
  };

  function createReadinessStore(available: boolean) {
    return {
      available,
      view: signal<ClaudeReadinessView>({
        state: 'checking',
        errorCause: null,
        path: null,
        version: null,
      }),
      rechecking: signal(false),
      refresh: jest.fn().mockResolvedValue('ready'),
    };
  }
  function setReadiness(state: ClaudeReadinessState): void {
    readiness.view.set({ state, errorCause: null, path: null, version: null });
    fixture.detectChanges();
  }
  function useReadiness(available: boolean): void {
    readiness = createReadinessStore(available);
    TestBed.overrideProvider(ClaudeReadinessStore, { useValue: readiness });
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function byTestId<T extends Element = HTMLElement>(id: string): T | null {
    return el().querySelector<T>(`[data-testid="${id}"]`);
  }
  function render(): void {
    fixture = TestBed.createComponent(OnboardingHomeComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    store = createStatusStore();
    markDismissed = jest.fn<void, []>();
    setCurrentView = jest.fn<void, [string]>();
    flag = signal<OnboardingFlag>({});
    workspacePath = signal('/workspace');
    workspaceReady = signal(true);
    readiness = createReadinessStore(true);
    resume.items.set([]);
    resume.refresh.mockClear();
    resume.clear.mockClear();
    TestBed.configureTestingModule({
      imports: [OnboardingHomeComponent],
      providers: [
        provideRouter([]),
        { provide: SetupStatusStore, useValue: store },
        { provide: OnboardingFlagService, useValue: { markDismissed, flag } },
        { provide: ClaudeReadinessStore, useValue: readiness },
        { provide: AppStateManager, useValue: { setCurrentView } },
        { provide: LoggingService, useValue: { warn: jest.fn() } },
        { provide: OnboardingResumeStore, useValue: resume },
        { provide: OnboardingWorkspaceStore, useValue: { isElectron: false, active: signal(null), activePath: workspacePath, readyForActivePath: workspaceReady, folders: signal([]), activeIndex: signal(-1) } },
        { provide: WizardRpcService, useValue: { getAnalysisStatus: jest.fn().mockResolvedValue({ state: 'missing' }) } },
        { provide: AnalysisStepStore, useValue: { useAnalysis: jest.fn() } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders one focusable h1 and asks for fresh status on entry', () => {
    render();
    const headings = el().querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent?.trim()).toBe('Set up Ptah for your work');
    expect(headings[0].getAttribute('tabindex')).toBe('-1');
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(resume.refresh).toHaveBeenCalledTimes(1);
  });
  it('refreshes resume actions when the active folder changes', () => {
    render();
    workspacePath.set('/another-workspace');
    fixture.detectChanges();
    expect(resume.refresh).toHaveBeenCalledTimes(2);
  });
  it('clears resume actions while a folder switch is pending', () => {
    render();
    workspaceReady.set(false);
    workspacePath.set('/another-workspace');
    fixture.detectChanges();
    expect(resume.clear).toHaveBeenCalledTimes(1);
    expect(resume.refresh).toHaveBeenCalledTimes(1);
    workspaceReady.set(true);
    fixture.detectChanges();
    expect(resume.refresh).toHaveBeenCalledTimes(2);
  });

  it('places resume banners after the Claude banner and opens their target', () => {
    resume.items.set([
      {
        id: 'generation:tab-1',
        title: 'Continue agent generation',
        detail: null,
        target: {
          subPath: ['analyze', 'agents'],
          queryParams: { tab: 'tab-1' },
        },
      },
    ]);
    render();
    const claude = el().querySelector('ptah-claude-readiness-banner');
    const banners = byTestId('onboarding-resume-banners');
    expect(claude).not.toBeNull();
    expect(banners?.textContent).toContain('Continue agent generation');
    expect(
      claude!.compareDocumentPosition(banners!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    banners?.querySelector('button')?.click();
    expect(navigate).toHaveBeenCalledWith(
      ['/onboarding', 'analyze', 'agents'],
      {
        queryParams: { tab: 'tab-1' },
      },
    );
  });

  it('shows the three paths in order, Analyze first, each named by its h2 link', () => {
    render();
    const links = [...el().querySelectorAll<HTMLAnchorElement>('h2 a')];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Analyze current project',
      'New project',
      'AI team builder',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/onboarding/analyze',
      '/onboarding/new-project',
      '/onboarding/team-builder',
    ]);
    for (const link of links) {
      const description = el().querySelector(
        `#${link.getAttribute('aria-describedby')}`,
      );
      expect(description?.textContent?.trim()).toBeTruthy();
    }
  });

  it('offers the Analyze secondary links', () => {
    render();
    expect(
      byTestId<HTMLAnchorElement>('onboarding-link-agents-only')?.getAttribute(
        'href',
      ),
    ).toBe('/onboarding/analyze/agents?source=catalog');
    expect(
      byTestId<HTMLAnchorElement>(
        'onboarding-link-guidance-only',
      )?.getAttribute('href'),
    ).toBe('/onboarding/guidance');
  });

  it('marks every icon decorative', () => {
    render();
    const icons = [...el().querySelectorAll('lucide-angular')];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('shows skeleton tiles while the first status read is pending', () => {
    store.isLoading.set(true);
    render();
    expect(
      el().querySelectorAll('[data-testid="onboarding-path-tile-skeleton"]'),
    ).toHaveLength(3);
    expect(el().querySelectorAll('h2 a')).toHaveLength(0);

    store.isLoading.set(false);
    store.status.set(CONFIGURED);
    fixture.detectChanges();
    expect(
      el().querySelectorAll('[data-testid="onboarding-path-tile-skeleton"]'),
    ).toHaveLength(0);
  });

  it('shows status chips with state text once the checks are known', () => {
    store.status.set(CONFIGURED);
    store.agentsReady.set(true);
    store.scanReady.set(false);
    render();

    const chips = [
      ...el().querySelectorAll('[data-testid="onboarding-status-chips"] li'),
    ].map((chip) => chip.textContent?.trim());
    expect(chips).toEqual(['Not analyzed yet', '4 agents set up']);
  });

  it('shows no chip for an unknown check', () => {
    render();
    expect(byTestId('onboarding-status-chips')).toBeNull();
  });

  it('replaces only the chips when the status read fails, and Retry retries', () => {
    store.error.set('Could not check agent setup. Please try again.');
    store.scanReady.set(true);
    render();

    expect(byTestId('onboarding-status-chips')).toBeNull();
    const unavailable = byTestId('onboarding-status-unavailable');
    expect(unavailable?.textContent).toContain('Status unavailable');
    expect(el().querySelectorAll('h2 a')).toHaveLength(3);

    unavailable?.querySelector('button')?.click();
    expect(store.retry).toHaveBeenCalledTimes(1);
  });

  it('disables the tiles with an inline reason when no folder is open', () => {
    store.workspaceNotOpen.set(true);
    render();

    expect(el().querySelectorAll('h2 a')).toHaveLength(0);
    expect(byTestId('onboarding-link-agents-only')).toBeNull();
    for (const id of ['analyze', 'new-project', 'team-builder']) {
      expect(
        byTestId(`onboarding-path-${id}`)?.getAttribute('aria-disabled'),
      ).toBe('true');
      expect(
        byTestId(`onboarding-path-disabled-${id}`)?.textContent?.trim(),
      ).toBe('Open a folder to use this path.');
    }

    byTestId<HTMLButtonElement>('onboarding-open-folder')?.click();
    expect(store.openFolder).toHaveBeenCalledTimes(1);
  });

  it('Skip for now dismisses onboarding and returns to chat', () => {
    render();
    byTestId<HTMLButtonElement>('onboarding-skip')?.click();
    expect(markDismissed).toHaveBeenCalledTimes(1);
    expect(setCurrentView).toHaveBeenCalledWith('chat');
  });

  it('tags its surfaces with approved glass roles only', () => {
    render();
    const roles = new Set(
      [...el().querySelectorAll('[data-glass-surface]')].map((node) =>
        node.getAttribute('data-glass-surface'),
      ),
    );
    expect([...roles].sort()).toEqual(['chrome', 'tile']);
  });
  describe('Get ready (Electron)', () => {
    it('shows the strip before the h1 on step 3 and reads readiness on mount', () => {
      render();
      const strip = el().querySelector('ptah-ready-strip');
      const h1 = el().querySelector('h1');
      expect(strip).not.toBeNull();
      expect(
        strip!.compareDocumentPosition(h1!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        strip!
          .querySelector('li[aria-current="step"]')
          ?.getAttribute('data-step'),
      ).toBe('3');
      expect(readiness.refresh).toHaveBeenCalledWith(false);
    });

    it('item 2 reads Skipped on Home after a skip', () => {
      flag.set({ ready: { skippedAt: '2026-10-01T10:00:00.000Z' } });
      render();
      expect(el().querySelector('li[data-step="2"]')?.textContent).toContain(
        'Skipped',
      );
    });

    it.each<[ClaudeReadinessState, string]>([
      ['missing', 'Install Claude Code'],
      ['signed-out', 'Sign in'],
      ['error', 'Check again'],
    ])(
      'shows the banner for %s with "%s", after the lede and before the paths',
      (state, action) => {
        render();
        setReadiness(state);
        const banner = byTestId('claude-readiness-banner');
        expect(banner?.querySelector('a')?.textContent?.trim()).toBe(action);
        const lede = el().querySelector('section > p');
        const tiles = el().querySelector('ptah-onboarding-path-tile');
        expect(
          lede!.compareDocumentPosition(banner!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          banner!.compareDocumentPosition(tiles!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      },
    );

    it('clears the banner without a flag write once a re-read returns ready', () => {
      render();
      setReadiness('missing');
      expect(byTestId('claude-readiness-banner')).not.toBeNull();
      setReadiness('ready');
      expect(byTestId('claude-readiness-banner')).toBeNull();
      expect(markDismissed).not.toHaveBeenCalled();
    });

    it('links "Review Claude Code and settings" to stage 1 in the footer', () => {
      render();
      const link = byTestId<HTMLAnchorElement>('onboarding-review-ready');
      expect(link?.textContent?.trim()).toBe('Review Claude Code and settings');
      expect(link?.getAttribute('href')).toBe('/onboarding/ready');
    });
  });

  describe('Get ready (VS Code)', () => {
    beforeEach(() => useReadiness(false));

    it('renders no strip, banner or link and reads nothing', () => {
      render();
      readiness.view.set({
        state: 'missing',
        errorCause: null,
        path: null,
        version: null,
      });
      fixture.detectChanges();
      expect(el().querySelector('ptah-ready-strip')).toBeNull();
      expect(el().querySelector('ptah-claude-readiness-banner')).toBeNull();
      expect(byTestId('onboarding-review-ready')).toBeNull();
      expect(readiness.refresh).not.toHaveBeenCalled();
    });
  });
});
