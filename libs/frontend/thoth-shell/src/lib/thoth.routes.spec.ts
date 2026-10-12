/**
 * `THOTH_ROUTES` specs (TASK_2026_524 Batch 4e, implementation-plan.md §9).
 *
 * The real tree runs under a real Router, mounted the way the app mounts it:
 * `loadChildren` under `thoth`. The shell is the real component with its
 * template emptied, because what this tree decides is which URL settles and
 * which shell instance shows it — the tab bodies have their own specs, and
 * `thoth-shell.component.spec.ts` covers the rendered rail.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { ThothStatusService } from '@ptah-extension/dashboard';

import {
  THOTH_TAB_IDS,
  ThothShellComponent,
  isThothTabId,
  type ThothActiveTabId,
} from './components/thoth-shell.component';
import { THOTH_ROUTES } from './thoth.routes';

describe('THOTH_ROUTES', () => {
  let remembered: ReturnType<typeof signal<ThothActiveTabId>>;
  let setThothActiveTab: jest.Mock<void, [ThothActiveTabId]>;
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    remembered = signal<ThothActiveTabId>('memory');
    setThothActiveTab = jest.fn((tab: ThothActiveTabId) => remembered.set(tab));

    TestBed.overrideComponent(ThothShellComponent, {
      set: { template: '', imports: [] },
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppStateManager,
          useValue: {
            thothActiveTab: remembered.asReadonly(),
            setThothActiveTab,
          },
        },
        { provide: VSCodeService, useValue: { config: signal(null) } },
        {
          provide: ThothStatusService,
          useValue: {
            pillars: signal({}),
            refresh: jest.fn(async () => undefined),
            refreshIfNeeded: jest.fn(async () => undefined),
            refreshPaused: jest.fn(async () => undefined),
          },
        },
        provideLocationMocks(),
        provideRouter([{ path: 'thoth', loadChildren: () => THOTH_ROUTES }]),
      ],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  it('T1: /thoth/skills activates the shell on the Skills tab', async () => {
    const shell = await harness.navigateByUrl(
      '/thoth/skills',
      ThothShellComponent,
    );

    expect(router.url).toBe('/thoth/skills');
    expect(shell.activeTab()).toBe('skills');
    expect(setThothActiveTab).toHaveBeenLastCalledWith('skills');
  });

  it.each(THOTH_TAB_IDS)(
    'T2: /thoth redirects to the remembered tab (%s)',
    async (tab) => {
      remembered.set(tab);

      await harness.navigateByUrl('/thoth');

      expect(router.url).toBe(`/thoth/${tab}`);
    },
  );

  it.each(['/thoth/bogus', '/thoth/Memory', '/thoth/skills/extra'])(
    'T3: %s falls back to /thoth/memory',
    async (url) => {
      remembered.set('cron');

      await harness.navigateByUrl(url);

      expect(router.url).toBe('/thoth/memory');
      expect(setThothActiveTab).toHaveBeenLastCalledWith('memory');
    },
  );

  it('T4: memory → skills reuses the shell instance', async () => {
    const onMemory = await harness.navigateByUrl(
      '/thoth/memory',
      ThothShellComponent,
    );
    const onSkills = await harness.navigateByUrl(
      '/thoth/skills',
      ThothShellComponent,
    );

    expect(onSkills).toBe(onMemory);
    expect(onSkills.activeTab()).toBe('skills');
  });
});

describe('isThothTabId', () => {
  it.each(THOTH_TAB_IDS)('accepts %s', (tab) => {
    expect(isThothTabId(tab)).toBe(true);
  });

  it.each([undefined, null, '', 'Memory', 'bogus', 'memory/'])(
    'rejects %p',
    (value) => {
      expect(isThothTabId(value)).toBe(false);
    },
  );
});
