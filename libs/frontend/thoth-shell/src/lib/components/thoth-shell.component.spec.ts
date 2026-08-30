import { TestBed } from '@angular/core/testing';
import { ErrorHandler, signal } from '@angular/core';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MODEL_REFRESH_CONTROL } from '@ptah-extension/chat-state';
import { MemoryStateService } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisStateService } from '@ptah-extension/skill-synthesis-ui';

import {
  ThothShellComponent,
  type ThothActiveTabId,
} from './thoth-shell.component';

/**
 * Angular routes an exception thrown inside a subscription or an effect to the
 * application {@link ErrorHandler}, which logs it and lets the test go green.
 * That is how a stub drifting behind the signals the shell reads stayed
 * invisible here: `this.appState.workspaceInfo is not a function` was logged on
 * every run while all five specs passed. Collect what the handler receives and
 * fail the test on it, so the next drift is a red suite rather than a line of
 * console noise.
 */
class RecordingErrorHandler implements ErrorHandler {
  public readonly errors: unknown[] = [];

  public handleError(error: unknown): void {
    this.errors.push(error);
  }
}

const modelRefreshStub = {
  refreshModels: () => Promise.resolve(),
};

/**
 * Minimal stub for {@link SkillSynthesisStateService} so the embedded
 * `<ptah-skill-synthesis-tab />` component can be constructed by Angular DI
 * even in non-Electron tests where it renders only the placeholder.
 */
const skillStateStub = {
  candidates: signal([]),
  invocations: signal([]),
  stats: signal(null),
  statusFilter: signal('all'),
  selectedCandidateId: signal(null),
  selectedCandidate: signal(null),
  loading: signal(false),
  error: signal(null),
  suggestions: signal([]),
  suggestionsLoading: signal(false),
  suggestionDetail: signal(null),
  suggestionDetailLoading: signal(false),
  candidateDetail: signal(null),
  candidateDetailLoading: signal(false),
  pendingSuggestionCount: signal(0),
  specs: signal([]),
  specsLoading: signal(false),
  staleSpecCount: signal(0),
  settings: signal(null),
  queueItems: signal([]),
  drainRuns: signal([]),
  stageSpend: signal([]),
  queueLoading: signal(false),
  queuedAttemptTotal: signal(0),
  digestItems: signal([]),
  digestLoading: signal(false),
  refreshCandidates: () => Promise.resolve(),
  refreshSuggestions: () => Promise.resolve(),
  refreshSpecs: () => Promise.resolve(),
  refreshQueue: () => Promise.resolve(),
  refreshDigest: () => Promise.resolve(),
  harvestSpecs: () => Promise.resolve(),
  clearStaleSpecs: () => Promise.resolve(),
  loadStats: () => Promise.resolve(),
  loadSettings: () => Promise.resolve(),
  loadCandidateDetail: () => Promise.resolve(),
  loadSuggestionDetail: () => Promise.resolve(),
  clearSuggestionDetail: () => undefined,
  updateSuggestion: () => Promise.resolve(),
  setStatusFilter: () => Promise.resolve(),
  selectCandidate: () => Promise.resolve(),
  promote: () => Promise.resolve(),
  promoteBulk: () => Promise.resolve(0),
  reject: () => Promise.resolve(),
  rejectBulk: () => Promise.resolve(0),
  rejectByPattern: () => Promise.resolve(0),
  accept: () => Promise.resolve(),
  dismiss: () => Promise.resolve(),
} as unknown as SkillSynthesisStateService;

/**
 * Minimal stub for {@link MemoryStateService} so the embedded
 * `<ptah-memory-curator-tab />` rendered by the `@case ('memory')` arm of
 * the shell does not pull a real RPC dependency into the test bed.
 */
const memoryStateStub = {
  entries: () => [],
  query: () => '',
  tierFilter: () => 'all',
  scopeFilter: () => 'workspace',
  stats: () => null,
  loading: () => false,
  error: () => null,
  filteredEntries: () => [],
  totalsByTier: () => ({
    core: 0,
    recall: 0,
    archival: 0,
    codeIndex: 0,
    total: 0,
  }),
  setQuery: () => undefined,
  setTierFilter: () => undefined,
  setScopeFilter: () => undefined,
  refresh: () => Promise.resolve(),
  search: () => Promise.resolve(),
  pin: () => Promise.resolve(),
  unpin: () => Promise.resolve(),
  forget: () => Promise.resolve(),
  rebuildIndex: () => Promise.resolve(),
  loadStats: () => Promise.resolve(),
  symbolQuery: () => '',
  symbolItems: () => [],
  symbolTotal: () => 0,
  symbolLoading: () => false,
  symbolError: () => null,
  symbolOffset: () => 0,
  symbolLimit: () => 50,
  setSymbolQuery: () => undefined,
  setSymbolPage: () => undefined,
  loadSymbols: () => Promise.resolve(),
} as unknown as MemoryStateService;

type AppStateStub = jest.Mocked<
  Pick<
    AppStateManager,
    'thothActiveTab' | 'setThothActiveTab' | 'workspaceInfo'
  >
>;

type ActiveTabSignal = ReturnType<typeof signal<ThothActiveTabId>>;

/**
 * The one definition of the `AppStateManager` stub. Every TestBed in this file
 * builds it here rather than hand-writing its own literal — four separate
 * literals is exactly how two of them lost `workspaceInfo`, which
 * `ThothStatusService` reads on behalf of the shell.
 */
function makeAppStateStub(activeTab: ActiveTabSignal): AppStateStub {
  return {
    thothActiveTab: activeTab.asReadonly(),
    setThothActiveTab: jest.fn((tab: ThothActiveTabId) => activeTab.set(tab)),
    workspaceInfo: signal(null),
  } as unknown as AppStateStub;
}

describe('ThothShellComponent', () => {
  let appState: AppStateStub;
  let activeTabSignal: ActiveTabSignal;
  let errorHandler: RecordingErrorHandler;

  beforeEach(async () => {
    errorHandler = new RecordingErrorHandler();
    activeTabSignal = signal<ThothActiveTabId>('memory');
    appState = makeAppStateStub(activeTabSignal);

    await TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        { provide: AppStateManager, useValue: appState },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: true }) },
        },
        { provide: MemoryStateService, useValue: memoryStateStub },
        { provide: SkillSynthesisStateService, useValue: skillStateStub },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshStub },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    expect(errorHandler.errors).toEqual([]);
  });

  it('renders four tabs by default with Memory active', () => {
    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const tablist = fixture.nativeElement.querySelector(
      '[role="tablist"][aria-label="Thoth feature tabs"]',
    ) as HTMLElement;
    const tabs = tablist.querySelectorAll(
      ':scope > [role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(tabs.length).toBe(4);
    const labelOf = (t: HTMLElement) =>
      t.querySelector('[data-testid="thoth-tab-label"]')?.textContent?.trim();
    const labels = Array.from(tabs).map(labelOf);
    expect(labels).toEqual(['Memory', 'Skills', 'Schedules', 'Messaging']);

    const active = Array.from(tabs).find(
      (t) => t.getAttribute('aria-selected') === 'true',
    );
    expect(active ? labelOf(active) : undefined).toBe('Memory');
  });

  it('switches active tab via setThothActiveTab when a tab is clicked', () => {
    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const tablist = fixture.nativeElement.querySelector(
      '[role="tablist"][aria-label="Thoth feature tabs"]',
    ) as HTMLElement;
    const tabs = tablist.querySelectorAll(
      ':scope > [role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    tabs[1].click();
    fixture.detectChanges();

    expect(appState.setThothActiveTab).toHaveBeenCalledWith('skills');
    expect(activeTabSignal()).toBe('skills');
  });

  it('shows desktop-only placeholder for gateway tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('gateway');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        {
          provide: AppStateManager,
          useValue: makeAppStateStub(activeTabSignal),
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop');
  });

  it('shows desktop-only placeholder for memory tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('memory');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        {
          provide: AppStateManager,
          useValue: makeAppStateStub(activeTabSignal),
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
        { provide: MemoryStateService, useValue: memoryStateStub },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop');

    // Confirm the live memory UI is not rendered.
    const search = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="search"]',
    );
    expect(search).toBeNull();
  });

  it('shows desktop-only placeholder for skills tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('skills');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        {
          provide: AppStateManager,
          useValue: makeAppStateStub(activeTabSignal),
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
        { provide: SkillSynthesisStateService, useValue: skillStateStub },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshStub },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop');

    // Filter chips for the live skills UI must not render in placeholder mode.
    const skillFilterTabs = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('[aria-label="Status filter"] [role="tab"]');
    expect(skillFilterTabs.length).toBe(0);
  });
});
