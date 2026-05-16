import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MemoryStateService } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisStateService } from '@ptah-extension/skill-synthesis-ui';

import { ThothShellComponent } from './thoth-shell.component';

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
  refreshCandidates: () => Promise.resolve(),
  loadStats: () => Promise.resolve(),
  setStatusFilter: () => Promise.resolve(),
  selectCandidate: () => Promise.resolve(),
  promote: () => Promise.resolve(),
  reject: () => Promise.resolve(),
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
} as unknown as MemoryStateService;

describe('ThothShellComponent', () => {
  let appState: jest.Mocked<
    Pick<AppStateManager, 'thothActiveTab' | 'setThothActiveTab'>
  >;
  let activeTabSignal: ReturnType<
    typeof signal<'memory' | 'skills' | 'cron' | 'gateway'>
  >;

  beforeEach(async () => {
    activeTabSignal = signal<'memory' | 'skills' | 'cron' | 'gateway'>(
      'memory',
    );
    appState = {
      thothActiveTab: activeTabSignal.asReadonly(),
      setThothActiveTab: jest.fn((tab) => activeTabSignal.set(tab)),
      workspaceInfo: signal(null),
    } as unknown as jest.Mocked<
      Pick<AppStateManager, 'thothActiveTab' | 'setThothActiveTab'>
    >;

    await TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: AppStateManager, useValue: appState },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: true }) },
        },
        { provide: MemoryStateService, useValue: memoryStateStub },
        { provide: SkillSynthesisStateService, useValue: skillStateStub },
      ],
    }).compileComponents();
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
    const labels = Array.from(tabs).map((t) => t.textContent?.trim());
    expect(labels).toEqual(['Memory', 'Skills', 'Schedules', 'Messaging']);

    const active = Array.from(tabs).find((t) =>
      t.classList.contains('tab-active'),
    );
    expect(active?.textContent?.trim()).toBe('Memory');
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
    activeTabSignal = signal<'memory' | 'skills' | 'cron' | 'gateway'>(
      'gateway',
    );
    const stateMock = {
      thothActiveTab: activeTabSignal.asReadonly(),
      setThothActiveTab: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: AppStateManager, useValue: stateMock },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop app');
  });

  it('shows desktop-only placeholder for memory tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<'memory' | 'skills' | 'cron' | 'gateway'>(
      'memory',
    );
    const stateMock = {
      thothActiveTab: activeTabSignal.asReadonly(),
      setThothActiveTab: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: AppStateManager, useValue: stateMock },
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
    expect(text).toContain('Ptah desktop app');

    // Confirm the live memory UI is not rendered.
    const search = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="search"]',
    );
    expect(search).toBeNull();
  });

  it('shows desktop-only placeholder for skills tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<'memory' | 'skills' | 'cron' | 'gateway'>(
      'skills',
    );
    const stateMock = {
      thothActiveTab: activeTabSignal.asReadonly(),
      setThothActiveTab: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: AppStateManager, useValue: stateMock },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
        { provide: SkillSynthesisStateService, useValue: skillStateStub },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop app');

    // Filter chips for the live skills UI must not render in placeholder mode.
    const skillFilterTabs = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('[aria-label="Status filter"] [role="tab"]');
    expect(skillFilterTabs.length).toBe(0);
  });
});
