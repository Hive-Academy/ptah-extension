import axe from 'axe-core';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMarkdown } from 'ngx-markdown';
import {
  PTAH_UI_HOST_SOURCES,
  type PtahUiHostSources,
} from '../../services/ptah-ui-host-sources';
import {
  PTAH_UI_DISPLAY_DOCK,
  displayFenceKey,
  type PtahUiDisplayDock,
  type PtahUiDisplayFenceStatus,
} from '../../services/ptah-ui-display-dock';
import { PTAH_UI_BLOCK_PIPELINE } from './ptah-ui-block.component';
import { PtahUiDisplayChipComponent } from './ptah-ui-display-chip.component';

const BODY = 'title Release checklist\nstats\n  Reviewers | 2\n  Risk | low\n';
const RAW = '```ptah-ui display release\n' + BODY + '```\n';
const TAB = 'tab-1';
const FENCE_KEY = displayFenceKey('m1', 'text-1', 2);

const AXE_OPTIONS = {
  rules: {
    // jsdom computes no layout or colour; contrast is checked in the app.
    'color-contrast': { enabled: false },
    'target-size': { enabled: false },
  },
};

async function axeViolations(root: HTMLElement): Promise<string[]> {
  const results = await axe.run(
    root as Parameters<typeof axe.run>[0],
    AXE_OPTIONS,
  );
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => violation.id);
}

/** A dock store stand-in: one status signal per fence key. */
class FakeDock implements PtahUiDisplayDock {
  readonly statuses = signal<ReadonlyMap<string, PtahUiDisplayFenceStatus>>(
    new Map(),
  );
  readonly lookups: Array<[string, string]> = [];
  readonly opened: Array<[string, string]> = [];

  fenceStatus(tabId: string, fenceKey: string): PtahUiDisplayFenceStatus | null {
    this.lookups.push([tabId, fenceKey]);
    return this.statuses().get(fenceKey) ?? null;
  }

  openSurface(tabId: string, surfaceKey: string): void {
    this.opened.push([tabId, surfaceKey]);
  }

  set(status: PtahUiDisplayFenceStatus): void {
    this.statuses.set(new Map([[FENCE_KEY, status]]));
  }
}

function hostSources(): PtahUiHostSources {
  return {
    tabId: signal(TAB),
    sessionId: signal('session-1'),
    turnFacts: signal([]),
    turnIndexOf: () => null,
    capacities: signal([]),
  };
}

@Component({
  selector: 'ptah-test-chip-host',
  standalone: true,
  imports: [PtahUiDisplayChipComponent],
  template: `
    <div (keydown.escape)="outerEscapes = outerEscapes + 1">
      <ptah-ui-display-chip
        [raw]="raw"
        [ordinal]="2"
        messageId="m1"
        nodeId="text-1"
      />
    </div>
  `,
})
class ChipHostComponent {
  readonly raw = RAW;
  outerEscapes = 0;
}

const APPLIED: PtahUiDisplayFenceStatus = {
  kind: 'applied',
  surfaceKey: 'id:release',
  title: 'Release checklist',
  description: 'Reviewers and risk for the release',
};

describe('PtahUiDisplayChipComponent', () => {
  let fixture: ComponentFixture<ChipHostComponent>;
  let dock: FakeDock;
  const pipeline = { compile: jest.fn(), resolve: jest.fn() };
  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const chip = (): HTMLElement | null =>
    native().querySelector('[data-testid="ptah-ui-display-chip"]');
  const toggle = (): HTMLButtonElement =>
    native().querySelector('button[aria-controls]') as HTMLButtonElement;
  const region = (): HTMLElement =>
    native().querySelector('[role="region"]') as HTMLElement;
  const openButton = (): HTMLButtonElement | null =>
    native().querySelector('[data-testid="ptah-ui-display-chip-open"]');
  const stateText = (): string | undefined =>
    native()
      .querySelector('[data-testid="ptah-ui-display-chip-state"]')
      ?.textContent?.trim();
  const reasonLine = (): HTMLElement | null =>
    native().querySelector('[data-ptah-ui-reason]');

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function create(options: { dock?: boolean; host?: boolean } = {}): void {
    dock = new FakeDock();
    TestBed.configureTestingModule({
      providers: [
        provideMarkdown(),
        { provide: PTAH_UI_BLOCK_PIPELINE, useValue: pipeline },
        ...(options.dock === false
          ? []
          : [{ provide: PTAH_UI_DISPLAY_DOCK, useValue: dock }]),
        ...(options.host === false
          ? []
          : [{ provide: PTAH_UI_HOST_SOURCES, useValue: hostSources() }]),
      ],
    });
    fixture = TestBed.createComponent(ChipHostComponent);
  }

  async function expand(): Promise<void> {
    toggle().click();
    await settle();
  }

  beforeEach(() => {
    pipeline.compile.mockReset();
    pipeline.resolve.mockReset();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  describe('applied', () => {
    beforeEach(async () => {
      create();
      dock.set(APPLIED);
      await settle();
    });

    it('reads the status of this fence by messageId:nodeId:ordinal in the host tab', () => {
      expect(dock.lookups).toContainEqual([TAB, 'm1:text-1:2']);
    });

    it('shows one collapsed line: icon, title and the "Live" state', () => {
      expect(chip()?.getAttribute('data-state')).toBe('applied');
      expect(
        native().querySelector('[data-testid="ptah-ui-display-chip-title"]')
          ?.textContent,
      ).toBe('Release checklist');
      expect(stateText()).toBe('Live');
      expect(toggle().querySelector('lucide-angular')).not.toBeNull();
    });

    it('starts collapsed with an inert, hidden region the toggle controls (R9.1, R9.2, R9.4)', () => {
      expect(toggle().tagName).toBe('BUTTON');
      expect(toggle().type).toBe('button');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().getAttribute('aria-controls')).toBe(region().id);
      expect(region().getAttribute('aria-labelledby')).toBe(toggle().id);
      expect(region().hasAttribute('inert')).toBe(true);
      expect(region().getAttribute('data-open')).toBe('false');
    });

    it('expands on the toggle with the description and "Open in display"; focus stays on the toggle', async () => {
      toggle().focus();
      await expand();

      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(region().hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(toggle());
      expect(
        native().querySelector(
          '[data-testid="ptah-ui-display-chip-description"]',
        )?.textContent,
      ).toBe('Reviewers and risk for the release');
      expect(openButton()?.textContent?.trim()).toBe('Open in display');
      expect(openButton()?.disabled).toBe(false);
      expect(
        native().querySelector('[data-testid="ptah-ui-display-chip-note"]'),
      ).toBeNull();
    });

    it('flips with each activation of the native button (Enter and Space activate a button)', async () => {
      await expand();
      await expand();

      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(region().hasAttribute('inert')).toBe(true);
    });

    it('opens the surface in the dock of its tab', async () => {
      await expand();
      openButton()?.click();

      expect(dock.opened).toEqual([[TAB, 'id:release']]);
    });

    it('collapses on Escape inside and returns focus to the toggle', async () => {
      await expand();
      openButton()?.focus();
      openButton()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();

      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(region().hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(toggle());
      expect(fixture.componentInstance.outerEscapes).toBe(0);
    });

    it('lets Escape through to the host when already collapsed', async () => {
      toggle().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();

      expect(fixture.componentInstance.outerEscapes).toBe(1);
    });

    it('shows the chip only: no snapshot, no fence text, no pipeline run (decisions #7)', () => {
      expect(native().querySelector('ptah-surface-renderer')).toBeNull();
      expect(native().querySelector('code')).toBeNull();
      expect(native().textContent).not.toContain('Reviewers | 2');
      expect(pipeline.compile).not.toHaveBeenCalled();
      expect(pipeline.resolve).not.toHaveBeenCalled();
    });

    it('wraps instead of overflowing at narrow widths (R9.5)', () => {
      const title = native().querySelector(
        '[data-testid="ptah-ui-display-chip-title"]',
      ) as HTMLElement;
      expect(chip()?.classList).toContain('min-w-0');
      expect(title.classList).toContain('break-words');
      expect(title.parentElement?.classList).toContain('flex-wrap');
      expect(title.parentElement?.classList).toContain('min-w-0');
    });
  });

  it('titles an untitled block "Display"', async () => {
    create();
    dock.set({ ...APPLIED, title: null, description: null });
    await settle();

    expect(
      native().querySelector('[data-testid="ptah-ui-display-chip-title"]')
        ?.textContent,
    ).toBe('Display');
    await expand();
    expect(
      native().querySelector('[data-testid="ptah-ui-display-chip-description"]'),
    ).toBeNull();
  });

  it('says "Updated later" when superseded, with a note and "Open latest" (decisions #7)', async () => {
    create();
    dock.set({ ...APPLIED, kind: 'superseded' });
    await settle();

    expect(stateText()).toBe('Updated later');
    expect(chip()?.classList).toContain('border-dashed');
    await expand();
    expect(
      native().querySelector('[data-testid="ptah-ui-display-chip-note"]')
        ?.textContent,
    ).toContain('A newer version exists');
    expect(openButton()?.textContent?.trim()).toBe('Open latest');
    openButton()?.click();
    expect(dock.opened).toEqual([[TAB, 'id:release']]);
  });

  it('reads "No longer in display" when evicted and stays a plain chip (R1.12)', async () => {
    create();
    dock.set({ ...APPLIED, kind: 'evicted' });
    await settle();

    expect(stateText()).toBe('No longer in display');
    await expand();
    expect(openButton()).toBeNull();
    expect(
      native().querySelector('[data-testid="ptah-ui-display-chip-note"]')
        ?.textContent,
    ).toContain('No longer in display');
  });

  it('renders the 610 fallback for an invalid fence: raw fence plus the reason outside the code', async () => {
    create();
    dock.set({ kind: 'invalid', reason: 'reserved display id' });
    await settle();

    expect(chip()).toBeNull();
    const markdown = native().querySelector('markdown');
    expect(markdown?.querySelector('code')?.textContent).toContain(
      'Reviewers | 2',
    );
    const reason = reasonLine();
    expect(reason?.textContent?.trim()).toBe(
      'Not rendered: reserved display id',
    );
    expect(reason?.closest('code')).toBeNull();
    expect(reason?.closest('markdown')).toBeNull();
    expect(markdown?.getAttribute('aria-describedby')).toBe(reason?.id);
  });

  it('renders the raw fence as plain markdown before the sync computed a status', async () => {
    create();
    await settle();

    expect(chip()).toBeNull();
    expect(reasonLine()).toBeNull();
    expect(native().querySelector('markdown code')?.textContent).toContain(
      'Reviewers | 2',
    );
  });

  it('follows status changes in place: pending, applied, then superseded', async () => {
    create();
    await settle();
    expect(chip()).toBeNull();

    dock.set(APPLIED);
    await settle();
    expect(stateText()).toBe('Live');
    const instance = fixture.debugElement.query(
      By.directive(PtahUiDisplayChipComponent),
    ).componentInstance;

    dock.set({ ...APPLIED, kind: 'superseded' });
    await settle();
    expect(stateText()).toBe('Updated later');
    expect(
      fixture.debugElement.query(By.directive(PtahUiDisplayChipComponent))
        .componentInstance,
    ).toBe(instance);
  });

  it.each([
    ['no dock store', { dock: false }],
    ['no host sources', { host: false }],
  ] as const)(
    'shows "Display panel unavailable" with the open action disabled: %s',
    async (_label, options) => {
      create(options);
      await settle();

      expect(chip()?.getAttribute('data-state')).toBe('unavailable');
      expect(stateText()).toBe('Display panel unavailable');
      expect(
        native().querySelector('[data-testid="ptah-ui-display-chip-title"]')
          ?.textContent,
      ).toBe('Display');
      await expand();
      const button = openButton();
      expect(button?.disabled).toBe(true);
      const describedBy = button?.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(
        native().querySelector(`[id="${describedBy}"]`)?.textContent?.trim(),
      ).toBe('Display panel unavailable');
      button?.click();
      expect(dock.opened).toEqual([]);
    },
  );

  describe.each(['light', 'dark'] as const)('axe, %s theme', (theme) => {
    it.each([
      'applied',
      'applied-expanded',
      'superseded-expanded',
      'unavailable-expanded',
      'invalid',
    ] as const)(
      'has no serious or critical violations: %s',
      async (state) => {
        document.documentElement.setAttribute('data-theme', theme);
        create(state.startsWith('unavailable') ? { dock: false } : {});
        if (state.startsWith('applied')) dock.set(APPLIED);
        if (state.startsWith('superseded'))
          dock.set({ ...APPLIED, kind: 'superseded' });
        if (state === 'invalid')
          dock.set({ kind: 'invalid', reason: 'reserved display id' });
        await settle();
        if (state.endsWith('-expanded')) await expand();

        expect(await axeViolations(native())).toEqual([]);
      },
    );
  });
});
