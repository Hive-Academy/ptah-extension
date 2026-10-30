import axe from 'axe-core';
import { Component, input, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  SurfaceRendererComponent,
  type SurfaceInteractionState,
  type SurfaceViewState,
} from '@ptah-extension/declarative-dashboard';
import type { SurfaceContent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { ArtifactRecord, TurnSourceSnapshot } from '@ptah-extension/shared';
import {
  buildTurnSummaryModel,
  type TurnSummaryModel,
} from '../../molecules/turn-recap/turn-summary.model';
import {
  DISPLAY_PANEL_SUMMARY_KEY,
  DisplayPanelComponent,
  type DisplayPanelViewStateChange,
} from './display-panel.component';
import type { DisplaySurface } from './display-surfaces';

/** Stands in for the renderer so the panel's own wiring is what is tested. */
@Component({
  selector: 'ptah-surface-renderer',
  standalone: true,
  template: `<span data-testid="stub-renderer">{{ marker() }}</span>`,
})
class StubSurfaceRendererComponent {
  readonly renderable = input.required<SurfaceContent>();
  readonly viewState = input<SurfaceViewState>();
  readonly interaction = input<SurfaceInteractionState>();
  readonly layoutWidth = input<string>();
  readonly viewStateChange = output<SurfaceViewState>();
  readonly renderFailed = output<void>();

  marker(): string {
    return (this.renderable() as unknown as { marker: string }).marker;
  }
}

function surface(
  key: string,
  title: string | null,
  createdSeq: number,
  updatedSeq = createdSeq,
): DisplaySurface {
  return {
    key,
    displayId: key.startsWith('id:') ? key.slice(3) : null,
    content: { marker: `${key}@${updatedSeq}` } as unknown as SurfaceContent,
    title,
    description: null,
    turnKey: 'turn-1',
    fenceKey: `m1:n1:${key}:${updatedSeq}`,
    createdSeq,
    updatedSeq,
    componentSignatures: new Map(),
    retainedViewStateIds: new Set(),
  };
}

function summaryModel(): TurnSummaryModel {
  const snapshot: TurnSourceSnapshot = {
    state: 'terminal',
    incomplete: false,
    diff: {
      kind: 'available',
      changeSet: {
        sessionId: 's',
        workspaceRoot: '/w',
        turnStartedAt: 0,
        turnEndedAt: 1,
        files: [{ path: 'src/a.ts', status: 'M', additions: 1, deletions: 0 }],
        truncatedCount: 0,
        totals: { files: 1, additions: 1, deletions: 0 },
        countsUnavailable: false,
      },
    },
    tests: {
      kind: 'available',
      runs: [],
      summary: { total: 0, passed: 0, failed: 0, running: 0, unknown: 0 },
    },
    usage: {
      kind: 'available',
      input: 10,
      output: 5,
      cost: 0.5,
      durationMs: 1_000,
    },
  };
  const built = buildTurnSummaryModel(snapshot);
  if (built === null) throw new Error('expected a summary');
  return built;
}

describe('DisplayPanelComponent', () => {
  let fixture: ComponentFixture<DisplayPanelComponent>;
  let scrolled: string[];
  let selections: string[];
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null =>
    native().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => [
    ...native().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
  ];
  const text = (node: Element | null): string =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const tabs = (): HTMLButtonElement[] =>
    queryAll('display-panel-tab') as HTMLButtonElement[];
  const panels = (): HTMLElement[] => queryAll('display-panel-tabpanel');
  const selectedTab = (): HTMLButtonElement | undefined =>
    tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
  const visiblePanels = (): HTMLElement[] =>
    panels().filter((panel) => !panel.hidden);
  const renderers = (): StubSurfaceRendererComponent[] =>
    fixture.debugElement
      .queryAll(By.directive(StubSurfaceRendererComponent))
      .map((debug) => debug.componentInstance as StubSurfaceRendererComponent);

  function set(inputs: {
    surfaces?: readonly DisplaySurface[];
    summary?: TurnSummaryModel | null;
    selectedKey?: string | null;
    scrollToSelectedOnMount?: boolean;
    pinned?: boolean;
    viewStates?: ReadonlyMap<string, SurfaceViewState>;
    artifacts?: readonly ArtifactRecord[];
    open?: boolean;
  }): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    TestBed.tick();
  }

  function key(tab: HTMLElement, name: string): void {
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    fixture.detectChanges();
  }

  beforeEach(() => {
    scrolled = [];
    selections = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-key') ?? '');
    };
    TestBed.configureTestingModule({ imports: [DisplayPanelComponent] });
    TestBed.overrideComponent(DisplayPanelComponent, {
      remove: { imports: [SurfaceRendererComponent] },
      add: { imports: [StubSurfaceRendererComponent] },
    });
    fixture = TestBed.createComponent(DisplayPanelComponent);
    fixture.componentInstance.selectedKeyChange.subscribe((k) => selections.push(k));
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  describe('empty state (R1.13)', () => {
    it('explains what appears here and shows no strip', () => {
      set({});
      const empty = query('display-panel-empty');
      expect(text(empty)).toContain('Nothing to show yet');
      expect(text(empty)).toContain(
        'A turn that changes files or runs tests leaves its summary here',
      );
      expect(native().querySelector('[role="tablist"]')).toBeNull();
    });

    it('is not empty with only a summary', () => {
      set({ summary: summaryModel() });
      expect(query('display-panel-empty')).toBeNull();
      expect(text(selectedTab() ?? null)).toBe('Turn summary');
      expect(visiblePanels()[0].querySelector('ptah-turn-summary')).not.toBeNull();
    });
  });

  describe('strip tablist (design section 8, assertions 6-9)', () => {
    const published = [
      surface('id:plan', 'Release plan', 0, 4),
      surface('anon:m1:n2:0', null, 1),
      surface('id:agents', 'Subagents', 2),
    ];

    it('lists the summary first, then the surfaces in published order', () => {
      set({ summary: summaryModel(), surfaces: published });
      const list = native().querySelector('[role="tablist"]') as HTMLElement;
      expect(list.getAttribute('aria-label')).toBe('Displays');
      expect(tabs().map((tab) => text(tab))).toEqual([
        'Turn summary',
        'Release plan',
        'Display',
        'Subagents',
      ]);
      expect(tabs()[1].getAttribute('title')).toBe('Release plan');
    });

    it('selects exactly one tab; each tab controls a tabpanel labelled by it (6)', () => {
      set({ summary: summaryModel(), surfaces: published });
      expect(tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);
      for (const tab of tabs()) {
        expect(tab.getAttribute('role')).toBe('tab');
        const panel = document.getElementById(tab.getAttribute('aria-controls') as string);
        expect(panel?.getAttribute('role')).toBe('tabpanel');
        expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
        expect(panel?.hidden).toBe(tab.getAttribute('aria-selected') !== 'true');
        expect(panel?.getAttribute('tabindex')).toBe('0');
      }
      expect(visiblePanels()).toHaveLength(1);
    });

    it('uses a roving tabindex (7)', () => {
      set({ summary: summaryModel(), surfaces: published, selectedKey: 'id:agents' });
      expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual([
        '-1',
        '-1',
        '-1',
        '0',
      ]);
    });

    it('arrows wrap, Home and End jump; selection and focus follow (8)', () => {
      set({ summary: summaryModel(), surfaces: published });
      const first = tabs()[0];
      first.focus();

      key(first, 'ArrowLeft');
      expect(text(selectedTab() ?? null)).toBe('Subagents');
      expect(document.activeElement).toBe(selectedTab());
      expect(visiblePanels()[0].getAttribute('aria-labelledby')).toBe(selectedTab()?.id);

      key(selectedTab() as HTMLElement, 'ArrowRight');
      expect(text(selectedTab() ?? null)).toBe('Turn summary');

      key(selectedTab() as HTMLElement, 'End');
      expect(text(selectedTab() ?? null)).toBe('Subagents');

      key(selectedTab() as HTMLElement, 'Home');
      expect(text(selectedTab() ?? null)).toBe('Turn summary');
      expect(document.activeElement).toBe(selectedTab());

      expect(selections).toEqual([
        'id:agents',
        DISPLAY_PANEL_SUMMARY_KEY,
        'id:agents',
        DISPLAY_PANEL_SUMMARY_KEY,
      ]);
    });

    it('follows the store selection and falls back to the first item', () => {
      set({ summary: summaryModel(), surfaces: published, selectedKey: 'id:plan' });
      expect(text(selectedTab() ?? null)).toBe('Release plan');
      set({ selectedKey: 'id:gone' });
      expect(text(selectedTab() ?? null)).toBe('Turn summary');
    });

    it('a click selects and emits once', () => {
      set({ surfaces: published });
      tabs()[2].click();
      fixture.detectChanges();
      expect(text(selectedTab() ?? null)).toBe('Subagents');
      expect(selections).toEqual(['id:agents']);
    });
  });

  describe('scroll and pin (R1.6, R1.7; decision #79)', () => {
    const base = [surface('id:a', 'A', 0), surface('id:b', 'B', 1)];

    it('shows no dot and moves nothing for what is there at mount', () => {
      set({ surfaces: base, selectedKey: 'id:a' });
      expect(queryAll('display-panel-new-dot')).toHaveLength(0);
      expect(selections).toEqual([]);
      expect(scrolled).toEqual([]);
    });

    it('scrolls an explicitly requested surface on mount without moving focus', () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      set({ surfaces: base, selectedKey: 'id:b', scrollToSelectedOnMount: true });
      expect(scrolled).toEqual(['id:b']);
      expect(selections).toEqual([]);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('unpinned: selects and scrolls to the highest updatedSeq, never focusing', () => {
      set({ surfaces: base, selectedKey: 'id:b' });
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();

      // `id:a` was created first but updated last: it is the target.
      set({ surfaces: [surface('id:a', 'A', 0, 2), base[1]] });

      expect(selections).toEqual(['id:a']);
      expect(text(selectedTab() ?? null)).toBe('A');
      expect(scrolled).toEqual(['id:a']);
      expect(document.activeElement).toBe(outside);
      // Strip order stays the published order.
      expect(tabs().map((tab) => text(tab))).toEqual(['A', 'B']);
      outside.remove();
    });

    it('unpinned: a newly created surface is selected and scrolled to', () => {
      set({ surfaces: base, selectedKey: 'id:a' });
      set({ surfaces: [...base, surface('id:c', 'C', 2)] });
      expect(selections).toEqual(['id:c']);
      expect(scrolled).toEqual(['id:c']);
    });

    it('pinned: an update moves neither selection, scroll nor focus, and shows a "new" dot', () => {
      set({ surfaces: base, selectedKey: 'id:a', pinned: true });
      const selected = selectedTab() as HTMLButtonElement;
      selected.focus();

      set({ surfaces: [base[0], surface('id:b', 'B', 1, 3)] });

      expect(selections).toEqual([]);
      expect(scrolled).toEqual([]);
      expect(text(selectedTab() ?? null)).toBe('A');
      expect(document.activeElement).toBe(selected);
      const updated = tabs()[1];
      expect(text(updated)).toBe('New: B');
      expect(
        updated.querySelector('[data-testid="display-panel-new-dot"]')?.getAttribute('aria-hidden'),
      ).toBe('true');

      updated.click();
      fixture.detectChanges();
      TestBed.tick();
      expect(text(tabs()[1])).toBe('B');
    });
  });

  describe('surfaces', () => {
    it('mounts one frame for three artifacts and releases it on collapse', () => {
      const artifacts: ArtifactRecord[] = [1, 2, 3].map((n) => ({
        id: `artifact-${n}`, title: `Artifact ${n}`, sessionId: 'session-1', revision: 1,
        createdAt: '2026-10-20T00:00:00.000Z', viewerUrl: `ptah-artifact://artifact-${n}/index.html`,
      }));
      set({ artifacts, selectedKey: 'artifact:artifact-2', open: true });
      expect(native().querySelectorAll('iframe')).toHaveLength(1);
      expect(queryAll('display-panel-artifact-viewer')).toHaveLength(1);
      set({ open: false });
      expect(native().querySelectorAll('iframe')).toHaveLength(0);
    });

    it('shows an error for an artifact absent from this tab', () => {
      set({ selectedKey: 'artifact:missing' });
      const notices = queryAll('display-panel-artifact-missing');
      expect(notices).toHaveLength(1);
      expect(notices[0].getAttribute('role')).toBe('alert');
      expect(text(notices[0])).toContain(
        'This artifact is not available. It may have been deleted, or the list did not load.',
      );
      expect(text(native())).not.toContain('not loaded in this tab');
      expect(native().querySelector('iframe')).toBeNull();
    });

    it('emits retryArtifacts from the missing-artifact Retry button', () => {
      const retries: number[] = [];
      fixture.componentInstance.retryArtifacts.subscribe(() => retries.push(1));
      set({ selectedKey: 'artifact:missing' });
      const retry = query('display-panel-artifact-retry') as HTMLButtonElement;
      expect(retry.tagName).toBe('BUTTON');
      expect(retry.type).toBe('button');
      expect(text(retry)).toBe('Retry');
      retry.click();
      expect(retries).toHaveLength(1);
      expect(selections).toEqual([]);
    });

    it('shows one missing notice beside other items and no active tab', () => {
      set({
        surfaces: [surface('id:a', 'A', 0)],
        selectedKey: 'artifact:missing',
      });
      expect(queryAll('display-panel-artifact-missing')).toHaveLength(1);
      expect(query('display-panel-artifact-retry')).not.toBeNull();
      expect(selectedTab()).toBeUndefined();
      expect(visiblePanels()).toHaveLength(0);
      expect(native().querySelector('iframe')).toBeNull();
    });

    it('drops the notice once the selected artifact arrives', () => {
      set({ selectedKey: 'artifact:late' });
      expect(query('display-panel-artifact-missing')).not.toBeNull();
      set({
        artifacts: [{
          id: 'late', title: 'Late', sessionId: 'session-1', revision: 1,
          createdAt: '2026-10-20T00:00:00.000Z', viewerUrl: 'ptah-artifact://late/index.html',
        }],
      });
      expect(query('display-panel-artifact-missing')).toBeNull();
      expect(text(selectedTab() ?? null)).toBe('Late');
      expect(queryAll('display-panel-artifact-viewer')).toHaveLength(1);
    });

    it('has no axe violations with the missing-artifact notice', async () => {
      set({ selectedKey: 'artifact:missing' });
      const results = await axe.run(native() as Parameters<typeof axe.run>[0], {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      });
      expect(results.violations).toEqual([]);
    });

    it('renders each surface read-only at container width with the store view state', () => {
      const stored: SurfaceViewState = {
        components: { acc: { expanded: true } },
        drafts: {},
      };
      set({
        surfaces: [surface('id:a', 'A', 0), surface('id:b', 'B', 1)],
        viewStates: new Map([['id:a', stored]]),
      });
      const [a, b] = renderers();
      expect(a.viewState()).toBe(stored);
      expect(a.layoutWidth()).toBe('container');
      expect(a.interaction()?.submitDisabled).toBe(true);
      expect(a.interaction()?.selection).toBeNull();
      const empty = b.viewState();
      expect(empty).toEqual({ components: {}, drafts: {} });
      fixture.detectChanges();
      expect(renderers()[1].viewState()).toBe(empty);
    });

    it('forwards a renderer view-state write keyed by surface; it does not prune (decision #74)', () => {
      set({ surfaces: [surface('id:a', 'A', 0)] });
      const writes: DisplayPanelViewStateChange[] = [];
      fixture.componentInstance.viewStateChange.subscribe((w) => writes.push(w));
      const next: SurfaceViewState = { components: { t: { page: 1 } }, drafts: {} };
      renderers()[0].viewStateChange.emit(next);
      expect(writes).toEqual([{ surfaceKey: 'id:a', viewState: next }]);
    });

    it('shows "could not display" in the failing surface only, until a newer version', () => {
      set({ surfaces: [surface('id:a', 'A', 0), surface('id:b', 'B', 1)] });
      renderers()[0].renderFailed.emit();
      fixture.detectChanges();
      const failed = queryAll('display-panel-render-failed');
      expect(failed).toHaveLength(1);
      expect(text(failed[0])).toBe('Could not display this surface.');
      expect(panels()[0].contains(failed[0])).toBe(true);
      expect(renderers()).toHaveLength(1);

      set({ surfaces: [surface('id:a', 'A', 0, 2), surface('id:b', 'B', 1)] });
      expect(queryAll('display-panel-render-failed')).toHaveLength(0);
      expect(renderers()).toHaveLength(2);
    });

    it('passes summary actions through', () => {
      set({ summary: summaryModel() });
      const opened: string[] = [];
      let reviewed = 0;
      fixture.componentInstance.openFile.subscribe((p) => opened.push(p));
      fixture.componentInstance.review.subscribe(() => reviewed++);
      (query('turn-summary-card-toggle-files') as HTMLButtonElement).click();
      fixture.detectChanges();
      (query('turn-summary-file-action') as HTMLButtonElement).click();
      (query('turn-summary-review-all') as HTMLButtonElement).click();
      expect(opened).toEqual(['src/a.ts']);
      expect(reviewed).toBe(1);
    });
  });

  it.each([
    ['empty', false],
    ['with summary and surfaces', true],
  ])('has no axe violations (%s)', async (_name, filled) => {
    set(
      filled
        ? {
            summary: summaryModel(),
            surfaces: [surface('id:a', 'A', 0), surface('id:b', 'B', 1)],
          }
        : {},
    );
    const results = await axe.run(native() as Parameters<typeof axe.run>[0], {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
