import { computed, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ElectronLayoutService,
  LoggingService,
  VSCodeService,
} from '@ptah-extension/core';
import type { PlanRingData } from '@ptah-extension/chat-ui';
import type { RecentWorkspace } from '@ptah-extension/shared';
import { RecentWorkspacesStore } from '../../services/vitals/recent-workspaces.store';
import type {
  ActivityVitals,
  SpendVitals,
} from '../../services/vitals/usage-vitals.view';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_LOADING,
  vitalsReady,
  type VitalsLoad,
} from '../../services/vitals/vitals-load';
import { WelcomeVitalsStore } from '../../services/vitals/welcome-vitals.store';
import { localDayKey } from '../../services/vitals/usage-vitals.model';
import { ElectronWelcomeComponent } from './electron-welcome.component';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY_MS = 86_400_000;

const RECENTS: readonly RecentWorkspace[] = [
  {
    path: 'D:\\projects\\ptah-extension',
    name: 'ptah-extension',
    lastOpenedAt: NOW.getTime() - 2 * DAY_MS,
  },
  {
    path: '/home/me/work/billing',
    name: 'billing',
    lastOpenedAt: NOW.getTime() - 21 * DAY_MS,
  },
];

const ACTIVITY: ActivityVitals = {
  activity: {
    metric: 'requests',
    today: '2026-10-26',
    days: [{ date: '2026-10-25', value: 4 }],
  },
  totals: { tokens: 1200, costUsd: 3.5 },
  sessionCount: 108,
};

const SPEND: SpendVitals = {
  days: [1, 2, null, 3, 0, 2.4, 4],
  totals: { tokens: 900, costUsd: 12.4 },
};

const PLAN: PlanRingData = {
  percent: 38,
  label: '5h window',
  resetsInMs: (2 * 60 + 14) * 60_000,
};

interface FakeVitals {
  recents: WritableSignal<VitalsLoad<readonly RecentWorkspace[]>>;
  activity90: WritableSignal<VitalsLoad<ActivityVitals>>;
  spend7: WritableSignal<VitalsLoad<SpendVitals>>;
  planRing: WritableSignal<VitalsLoad<PlanRingData>>;
  cliCount: WritableSignal<VitalsLoad<number>>;
  skillCount: WritableSignal<VitalsLoad<number>>;
  isFirstRun: WritableSignal<boolean | null>;
}

describe('ElectronWelcomeComponent', () => {
  let fixture: ComponentFixture<ElectronWelcomeComponent>;
  let vitals: FakeVitals;
  let folders: WritableSignal<{ path: string; name: string }[]>;
  let layout: {
    hasWorkspaceFolders: () => boolean;
    addFolder: jest.Mock;
    addFolderByPath: jest.Mock;
  };
  let recentsLoad: jest.Mock;
  let warn: jest.Mock;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent ?? '';
  }

  function cells(): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>('ptah-stat-cell'));
  }

  function cell(label: string): HTMLElement | undefined {
    return cells().find((item) => item.getAttribute('aria-label') === label);
  }

  function recentButtons(): HTMLButtonElement[] {
    return Array.from(
      host().querySelectorAll<HTMLButtonElement>('ptah-recent-workspace-list button'),
    );
  }

  /** Lets the awaited open settle (microtasks only; timers are faked). */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    vitals = {
      recents: signal<VitalsLoad<readonly RecentWorkspace[]>>(
        vitalsReady(RECENTS),
      ),
      activity90: signal<VitalsLoad<ActivityVitals>>(vitalsReady(ACTIVITY)),
      spend7: signal<VitalsLoad<SpendVitals>>(vitalsReady(SPEND)),
      planRing: signal<VitalsLoad<PlanRingData>>(vitalsReady(PLAN)),
      cliCount: signal<VitalsLoad<number>>(vitalsReady(6)),
      skillCount: signal<VitalsLoad<number>>(vitalsReady(12)),
      isFirstRun: signal<boolean | null>(false),
    };
    folders = signal<{ path: string; name: string }[]>([]);
    layout = {
      hasWorkspaceFolders: computed(() => folders().length > 0),
      addFolder: jest.fn(async () => undefined),
      addFolderByPath: jest.fn(async () => undefined),
    };
    recentsLoad = jest.fn(async () => undefined);
    warn = jest.fn();

    await TestBed.configureTestingModule({
      imports: [ElectronWelcomeComponent],
      providers: [
        { provide: ElectronLayoutService, useValue: layout },
        { provide: RecentWorkspacesStore, useValue: { load: recentsLoad } },
        { provide: LoggingService, useValue: { warn } },
        {
          provide: VSCodeService,
          useValue: { getPtahIconUri: () => 'ptah-icon.png' },
        },
      ],
    })
      .overrideComponent(ElectronWelcomeComponent, {
        set: { providers: [{ provide: WelcomeVitalsStore, useValue: vitals }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ElectronWelcomeComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  it('shows the medallion, the title and Open Folder, without the old copy', () => {
    expect(host().querySelector('h1')?.textContent?.trim()).toBe(
      'Open a workspace',
    );
    // Titles use the app font: no display (small-caps serif) face.
    expect(
      Array.from(host().querySelector('h1')?.classList ?? []),
    ).not.toContain('font-display');
    expect(host().querySelector('img')?.getAttribute('src')).toBe(
      'ptah-icon.png',
    );
    expect(text()).not.toContain('Welcome to Ptah Desktop');
    expect(text()).not.toContain('Workspace Intelligence');
    expect(host().querySelector('.bg-base-100')).toBeNull();
  });

  it('opens the folder dialog from Open Folder', () => {
    host()
      .querySelector<HTMLButtonElement>('[data-testid="welcome-open-folder"]')
      ?.click();
    expect(layout.addFolder).toHaveBeenCalledTimes(1);
  });

  it('lists recent workspaces with their parent folder and age', () => {
    const rows = recentButtons();
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('ptah-extension');
    expect(rows[0].textContent).toContain('D:\\projects');
    expect(rows[0].textContent).toContain('2d');
    expect(rows[1].textContent).toContain('/home/me/work');
    expect(rows[1].textContent).toContain('3w');
  });

  it('shows the 90-day grid with the session caption', () => {
    const grid = host().querySelector('ptah-activity-grid');
    expect(grid?.getAttribute('data-mode')).toBe('history');
    expect(grid?.textContent).toContain('108 sessions · 90 days');
  });

  it('advances the recent age label and local grid day on a coarse tick', () => {
    fixture.destroy();
    const beforeMidnight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 23, 59, 45);
    jest.setSystemTime(beforeMidnight);
    vitals.isFirstRun.set(true);
    vitals.recents.set(vitalsReady([{ ...RECENTS[0], lastOpenedAt: beforeMidnight.getTime() - 45_000 }]));
    fixture = TestBed.createComponent(ElectronWelcomeComponent);
    fixture.detectChanges();

    const todayCell = () => host().querySelector('.ptah-activity-grid__today')?.getAttribute('data-date');
    expect(recentButtons()[0].textContent).toContain('now');
    expect(todayCell()).toBe(localDayKey(beforeMidnight));

    jest.advanceTimersByTime(30_000);
    fixture.detectChanges();
    expect(recentButtons()[0].textContent).toContain('1m');
    expect(todayCell()).toBe(localDayKey(new Date(beforeMidnight.getTime() + 30_000)));
  });

  it('shows four vitals cells for a returning user', () => {
    expect(cells().map((item) => item.getAttribute('aria-label'))).toEqual([
      'Plan',
      'Spend 7d',
      'Agents',
      'Skills',
    ]);
    expect(cell('Plan')?.textContent).toContain('5h window · resets in 2h 14m');
    expect(cell('Spend 7d')?.textContent).toContain('$12.40');
    expect(cell('Spend 7d')?.querySelector('ptah-spend-bars')).not.toBeNull();
    expect(cell('Agents')?.textContent).toContain('6');
    expect(cell('Agents')?.textContent).toContain('detected');
    expect(cell('Skills')?.textContent).toContain('12');
    expect(cell('Skills')?.textContent).toContain('enabled');
  });

  it('shows the Day 1 field and three cells on first run', () => {
    vitals.recents.set(VITALS_EMPTY);
    vitals.activity90.set(VITALS_EMPTY);
    vitals.spend7.set(VITALS_EMPTY);
    vitals.isFirstRun.set(true);
    fixture.detectChanges();

    expect(recentButtons()).toHaveLength(0);
    const grid = host().querySelector('ptah-activity-grid');
    expect(grid?.getAttribute('data-mode')).toBe('day-one');
    expect(grid?.textContent).toContain('Day 1 · your activity will grow here');
    expect(cells().map((item) => item.getAttribute('aria-label'))).toEqual([
      'Plan',
      'Agents',
      'Skills',
    ]);
  });

  it('degrades a failed or empty source to a dash with its caption', () => {
    vitals.cliCount.set(VITALS_ERROR);
    vitals.planRing.set(VITALS_EMPTY);
    vitals.skillCount.set(VITALS_LOADING);
    fixture.detectChanges();

    expect(cell('Agents')?.getAttribute('data-state')).toBe('error');
    expect(cell('Agents')?.textContent).toContain('—');
    expect(cell('Agents')?.textContent).toContain('detected');
    expect(cell('Plan')?.getAttribute('data-state')).toBe('empty');
    expect(cell('Plan')?.textContent).toContain('no plan window');
    expect(cell('Skills')?.getAttribute('aria-busy')).toBe('true');
  });

  it('shows $0.00 with flat bars when there was no spend', () => {
    vitals.spend7.set(VITALS_EMPTY);
    fixture.detectChanges();
    expect(cell('Spend 7d')?.getAttribute('data-state')).toBe('ready');
    expect(cell('Spend 7d')?.textContent).toContain('$0.00');
  });

  it('opens a recent workspace by path', async () => {
    layout.addFolderByPath.mockImplementation(async (path: string) => {
      folders.set([{ path, name: 'ptah-extension' }]);
    });
    recentButtons()[0].click();
    await settle();

    expect(layout.addFolderByPath).toHaveBeenCalledWith(
      'D:\\projects\\ptah-extension',
    );
    expect(host().querySelector('[role="alert"]')).toBeNull();
    expect(recentsLoad).not.toHaveBeenCalled();
  });

  it('says a recent folder is gone and rereads the list when it fails to open', async () => {
    recentButtons()[1].click();
    await settle();

    const alert = host().querySelector('[data-testid="welcome-open-failed"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Folder is no longer available');
    expect(recentsLoad).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('hides the recents column and offers a retry when the list cannot be read', () => {
    vitals.recents.set(VITALS_ERROR);
    vitals.isFirstRun.set(false);
    fixture.detectChanges();

    expect(recentButtons()).toHaveLength(0);
    const alert = host().querySelector('[data-testid="welcome-recents-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Recent folders unavailable');
    expect(host().querySelector('ptah-activity-grid')).not.toBeNull();

    alert?.querySelector<HTMLButtonElement>('button')?.click();
    expect(recentsLoad).toHaveBeenCalledTimes(1);
  });

  it('marks the grid busy while activity loads', () => {
    vitals.activity90.set(VITALS_LOADING);
    vitals.isFirstRun.set(null);
    fixture.detectChanges();
    expect(
      host()
        .querySelector('[data-testid="welcome-activity"]')
        ?.getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('reserves the vitals row until first run is known, so no cell appears and vanishes', () => {
    vitals.isFirstRun.set(null);
    fixture.detectChanges();
    expect(cells()).toHaveLength(0);
    expect(
      host().querySelector('[data-testid="welcome-vitals-pending"]'),
    ).not.toBeNull();

    vitals.isFirstRun.set(true);
    fixture.detectChanges();
    expect(cells().map((item) => item.getAttribute('aria-label'))).toEqual([
      'Plan',
      'Agents',
      'Skills',
    ]);
    expect(
      host().querySelector('[data-testid="welcome-vitals-pending"]'),
    ).toBeNull();
  });

  it('clears a stale open failure when Open Folder starts a new open', async () => {
    recentButtons()[1].click();
    await settle();
    expect(
      host().querySelector('[data-testid="welcome-open-failed"]'),
    ).not.toBeNull();

    host()
      .querySelector<HTMLButtonElement>('[data-testid="welcome-open-folder"]')
      ?.click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="welcome-open-failed"]'),
    ).toBeNull();
  });

  it('clears a stale open failure when another recent folder opens', async () => {
    recentButtons()[1].click();
    await settle();
    layout.addFolderByPath.mockImplementation(async (path: string) => {
      folders.set([{ path, name: 'ptah-extension' }]);
    });
    recentButtons()[0].click();
    await settle();
    expect(
      host().querySelector('[data-testid="welcome-open-failed"]'),
    ).toBeNull();
  });
});
