import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, input, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MarkdownModule, provideMarkdown } from 'ngx-markdown';
import {
  SURFACE_VIEW_MODEL_BUILDER,
  SurfaceRendererComponent,
  type SurfaceViewModelBuilder,
} from '@ptah-extension/declarative-dashboard';
import { renderPtahUiBlock } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import { PtahUiLiveWindow } from '../../services/ptah-ui-live-window';
import {
  PTAH_UI_BLOCK_PIPELINE,
  PtahUiBlockComponent,
  type PtahUiBlockPipeline,
} from './ptah-ui-block.component';

const LITERAL_BODY =
  'title Release checklist\nstats\n  Reviewers | 2\n  Risk | low\ntable\n  Area | Status\n  Parser | ready\n  Renderer | queued\nlist\n  - Run the focused shared tests\n  - Attach the compactness report\nchart bar Completed checks\n  Draft | 1\n  Verified | 3\n';
const SOURCE_BODY =
  'title Turn summary\nstats\n  Files changed | $diff.files\n  Prompt cost | $usage.cost\ntable $diff\nlist $tests\nchart line Coverage by run\n  Baseline | 72.4\n  Pipeline | 84.6\n';
const INVALID_BODY = 'title Status\ngauge 5\n';

const fence = (body: string): string => '```ptah-ui\n' + body + '```\n';

const PENDING: TurnSourceSnapshot = {
  state: 'pending',
  incomplete: false,
  diff: { kind: 'pending' },
  tests: { kind: 'pending' },
  usage: { kind: 'pending' },
};
const EMPTY: TurnSourceSnapshot = {
  state: 'terminal',
  incomplete: false,
  diff: {
    kind: 'available',
    changeSet: {
      sessionId: 's1',
      workspaceRoot: '/repo',
      turnStartedAt: 1,
      turnEndedAt: 2,
      files: [],
      truncatedCount: 0,
      totals: { files: 0, additions: 0, deletions: 0 },
      countsUnavailable: false,
    },
  },
  tests: {
    kind: 'available',
    runs: [],
    summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
  },
  usage: { kind: 'available', input: 10, output: 20, cost: 0.01, durationMs: 1200 },
};

interface BlockSpec {
  readonly nodeId: string;
  readonly orderKey: number;
}

/** One block, in its own transcript-scoped live window. */
@Component({
  selector: 'ptah-test-block-host',
  standalone: true,
  imports: [PtahUiBlockComponent],
  providers: [PtahUiLiveWindow],
  template: `
    <ptah-ui-block
      [raw]="raw()"
      [body]="body()"
      [ordinal]="0"
      messageId="m1"
      nodeId="node-1"
      [orderKey]="1"
      [snapshot]="snapshot()"
    />
  `,
})
class BlockHostComponent {
  readonly body = signal(LITERAL_BODY);
  readonly raw = signal(fence(LITERAL_BODY));
  readonly snapshot = signal<TurnSourceSnapshot | null>(null);
}

/** Many blocks under one window, as a transcript renders them. */
@Component({
  selector: 'ptah-test-transcript-host',
  standalone: true,
  imports: [PtahUiBlockComponent],
  providers: [PtahUiLiveWindow],
  template: `
    @for (block of blocks(); track block.nodeId) {
      <ptah-ui-block
        [raw]="raw"
        [body]="body"
        [ordinal]="0"
        messageId="m"
        [nodeId]="block.nodeId"
        [orderKey]="block.orderKey"
        [snapshot]="snapshot()"
      />
    }
  `,
})
class TranscriptHostComponent {
  readonly body = LITERAL_BODY;
  readonly raw = fence(LITERAL_BODY);
  readonly blocks = signal<readonly BlockSpec[]>([]);
  readonly snapshot = signal<TurnSourceSnapshot | null>(null);
}

/** What any other fence renders through today. */
@Component({
  selector: 'ptah-test-plain-fence',
  standalone: true,
  imports: [MarkdownModule],
  template: `<markdown [data]="raw()" />`,
})
class PlainFenceComponent {
  readonly raw = input.required<string>();
}

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
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => violation.id);
}

function setTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-theme-mode', theme);
}

describe('PtahUiBlockComponent', () => {
  let pipelineCalls: Map<string, number>;
  let pipeline: PtahUiBlockPipeline;

  function configure(stub?: PtahUiBlockPipeline): void {
    pipelineCalls = new Map();
    pipeline =
      stub ??
      ((body, options) => {
        pipelineCalls.set(
          options.surfaceId,
          (pipelineCalls.get(options.surfaceId) ?? 0) + 1,
        );
        return renderPtahUiBlock(body, options);
      });
    TestBed.configureTestingModule({
      providers: [
        provideMarkdown(),
        { provide: PTAH_UI_BLOCK_PIPELINE, useValue: pipeline },
      ],
    });
  }

  async function settle<T>(fixture: ComponentFixture<T>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
  });

  describe('single block', () => {
    let fixture: ComponentFixture<BlockHostComponent>;
    const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const reasonLine = (): HTMLElement | null =>
      native().querySelector<HTMLElement>('[data-ptah-ui-reason]');

    function create(stub?: PtahUiBlockPipeline): void {
      configure(stub);
      fixture = TestBed.createComponent(BlockHostComponent);
    }

    function useBody(body: string): void {
      fixture.componentInstance.body.set(body);
      fixture.componentInstance.raw.set(fence(body));
    }

    it('renders a valid block through the renderer, display-only', async () => {
      create();
      await settle(fixture);

      const renderer = fixture.debugElement.query(
        By.directive(SurfaceRendererComponent),
      );
      expect(renderer).not.toBeNull();
      const instance = renderer.componentInstance as SurfaceRendererComponent;
      expect(instance.interaction().submitDisabled).toBe(true);
      expect(instance.interaction().selection).toBeNull();
      expect(reasonLine()).toBeNull();
      expect(native().querySelector('[data-testid="ptah-ui-block"]')?.getAttribute('data-ptah-ui-mode')).toBe('live');
    });

    it('binds only the void renderFailed output on the renderer (template)', () => {
      const source = readFileSync(
        join(__dirname, 'ptah-ui-block.component.ts'),
        'utf8',
      );
      const tag = source.match(/<ptah-surface-renderer[\s\S]*?\/>/)?.[0] ?? '';
      expect(tag).not.toBe('');
      expect([...tag.matchAll(/\((\w+)\)=/g)].map((match) => match[1])).toEqual([
        'renderFailed',
      ]);
    });

    it('subscribes to no interaction output of the rendered renderer', async () => {
      create();
      await settle(fixture);

      const renderer = fixture.debugElement.query(By.directive(SurfaceRendererComponent));
      const instance = renderer.componentInstance as SurfaceRendererComponent;
      const listenerCount = (name: keyof SurfaceRendererComponent): number =>
        (instance[name] as unknown as { listeners: unknown[] | null }).listeners?.length ?? 0;

      expect(listenerCount('renderFailed')).toBe(1);
      for (const name of ['actionInvoke', 'inputCommit', 'selectionChange', 'viewStateChange'] as const) {
        expect(listenerCount(name)).toBe(0);
      }
    });

    it('falls back to the ordinary fence with "could not display" when the renderer reports renderFailed', async () => {
      const failingBuilder: SurfaceViewModelBuilder = () => ({
        renderFailed: true,
        reason: 'unknown node kind',
        viewModel: null,
      });
      configure();
      TestBed.overrideProvider(SURFACE_VIEW_MODEL_BUILDER, { useValue: failingBuilder });
      fixture = TestBed.createComponent(BlockHostComponent);
      await settle(fixture);

      const plain = TestBed.createComponent(PlainFenceComponent);
      plain.componentRef.setInput('raw', fence(LITERAL_BODY));
      await settle(plain);

      const blockMarkdown = native().querySelector('markdown');
      const plainMarkdown = (plain.nativeElement as HTMLElement).querySelector('markdown');
      expect(blockMarkdown?.innerHTML).toBe(plainMarkdown?.innerHTML);
      expect(fixture.debugElement.query(By.directive(SurfaceRendererComponent))).toBeNull();

      const reason = reasonLine();
      expect(reason?.textContent?.trim()).toBe('Not rendered: could not display');
      expect(reason?.closest('code')).toBeNull();
      expect(reason?.closest('markdown')).toBeNull();
      expect(blockMarkdown?.getAttribute('aria-describedby')).toBe(reason?.id);
    });

    it('falls back to exactly the HTML of an ordinary fence, with the reason outside the code', async () => {
      create();
      useBody(INVALID_BODY);
      await settle(fixture);

      const plain = TestBed.createComponent(PlainFenceComponent);
      plain.componentRef.setInput('raw', fence(INVALID_BODY));
      await settle(plain);

      const blockMarkdown = native().querySelector('markdown');
      const plainMarkdown = (plain.nativeElement as HTMLElement).querySelector('markdown');
      expect(blockMarkdown?.innerHTML).toBe(plainMarkdown?.innerHTML);
      expect(blockMarkdown?.querySelector('code')?.textContent).toContain('gauge 5');

      const reason = reasonLine();
      expect(reason?.textContent?.trim()).toMatch(/^Not rendered: .*gauge/);
      expect(reason?.closest('code')).toBeNull();
      expect(reason?.closest('markdown')).toBeNull();
      expect(blockMarkdown?.textContent).not.toContain('Not rendered');
      expect(reason?.id).toBeTruthy();
      expect(blockMarkdown?.getAttribute('aria-describedby')).toBe(reason?.id);
      expect(fixture.debugElement.query(By.directive(SurfaceRendererComponent))).toBeNull();
    });

    it('falls back with "internal error" when the pipeline throws, and the host still renders', async () => {
      create(() => {
        throw new Error('boom');
      });
      await settle(fixture);

      expect(reasonLine()?.textContent?.trim()).toBe('Not rendered: internal error');
      expect(native().querySelector('markdown code')?.textContent).toContain('Release checklist');
    });

    it('updates a live block in place when the snapshot changes', async () => {
      create();
      useBody(SOURCE_BODY);
      await settle(fixture);
      const before = fixture.debugElement.query(By.directive(PtahUiBlockComponent)).componentInstance;
      expect(native().textContent).toContain('unavailable');

      fixture.componentInstance.snapshot.set(PENDING);
      await settle(fixture);

      const after = fixture.debugElement.query(By.directive(PtahUiBlockComponent)).componentInstance;
      expect(after).toBe(before);
      expect(native().textContent).toContain('pending');
    });

    it('updates a live block in place when $diff goes from pending to available', async () => {
      create();
      useBody(SOURCE_BODY);
      fixture.componentInstance.snapshot.set(PENDING);
      await settle(fixture);
      const before = fixture.debugElement.query(By.directive(PtahUiBlockComponent)).componentInstance;
      expect(native().textContent).toContain('pending');
      expect(native().textContent).not.toContain('No files changed this turn');

      fixture.componentInstance.snapshot.set(EMPTY);
      await settle(fixture);

      const after = fixture.debugElement.query(By.directive(PtahUiBlockComponent)).componentInstance;
      expect(after).toBe(before);
      expect(native().textContent).toContain('No files changed this turn');
      expect(native().textContent).toContain('No tests ran this turn');
      expect(native().textContent).toContain('$0.01');
      expect(native().textContent).not.toContain('pending');
    });

    it('never recomputes a frozen (non-live) block when the snapshot changes', async () => {
      create();
      // Eight newer blocks already hold the window: this one mounts as a snapshot.
      const window = fixture.debugElement.injector.get(PtahUiLiveWindow);
      for (let index = 0; index < 8; index += 1) window.register(`newer-${index}`, 100 + index);
      useBody(SOURCE_BODY);
      await settle(fixture);

      expect(
        native().querySelector('[data-testid="ptah-ui-block"]')?.getAttribute('data-ptah-ui-mode'),
      ).toBe('snapshot');
      const surfaceId = 'ptah-ui-node-1-0';
      expect(pipelineCalls.get(surfaceId)).toBe(1);

      fixture.componentInstance.snapshot.set(EMPTY);
      await settle(fixture);

      expect(pipelineCalls.get(surfaceId)).toBe(1);
      // The frozen renderable stays: the available data never reaches this block.
      expect(native().textContent).toContain('unavailable');
      expect(native().textContent).not.toContain('No files changed this turn');
    });

    it('renders "unavailable" for sources while the snapshot is null', async () => {
      create();
      useBody(SOURCE_BODY);
      await settle(fixture);

      expect(native().textContent).toContain('unavailable');
      expect(native().textContent).not.toContain('pending');
      expect(native().querySelector('[data-ptah-ui-reason]')).toBeNull();
    });

    it('leaves a block without sources unaffected by snapshot changes', async () => {
      create();
      await settle(fixture);
      const rendererBefore = fixture.debugElement.query(
        By.directive(SurfaceRendererComponent),
      ).componentInstance as SurfaceRendererComponent;
      const before = native().textContent;

      fixture.componentInstance.snapshot.set(PENDING);
      await settle(fixture);
      fixture.componentInstance.snapshot.set(EMPTY);
      await settle(fixture);

      expect(native().textContent).toBe(before);
      expect(
        native().querySelector('[data-testid="ptah-ui-block"]')?.getAttribute('data-ptah-ui-mode'),
      ).toBe('live');
      expect(native().querySelector('[data-ptah-ui-reason]')).toBeNull();
      const rendererAfter = fixture.debugElement.query(
        By.directive(SurfaceRendererComponent),
      ).componentInstance as SurfaceRendererComponent;
      expect(rendererAfter).toBe(rendererBefore);
    });

    it('keeps every control a natural tab stop in a live block (no trap)', async () => {
      create();
      await settle(fixture);

      const focusable = [
        ...native().querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex]'),
      ];
      expect(focusable.length).toBeGreaterThan(0);
      for (const element of focusable) {
        expect(element.tabIndex).toBeLessThanOrEqual(0);
        expect(element.closest('[inert]')).toBeNull();
      }
    });

    type AxeState = 'live' | 'pending' | 'unavailable' | 'empty' | 'fallback' | 'snapshot';
    const states: readonly AxeState[] = ['live', 'pending', 'unavailable', 'empty', 'fallback', 'snapshot'];

    describe.each(['light', 'dark'] as const)('axe, %s theme', (theme) => {
      it.each(states)('has no serious or critical violations: %s', async (state) => {
        setTheme(theme);
        create();
        if (state === 'pending' || state === 'unavailable' || state === 'empty') useBody(SOURCE_BODY);
        if (state === 'pending') fixture.componentInstance.snapshot.set(PENDING);
        if (state === 'empty') fixture.componentInstance.snapshot.set(EMPTY);
        if (state === 'fallback') useBody(INVALID_BODY);
        if (state === 'snapshot') {
          // Eight newer blocks already hold the window: this one mounts as a snapshot.
          const window = fixture.debugElement.injector.get(PtahUiLiveWindow);
          for (let index = 0; index < 8; index += 1) window.register(`newer-${index}`, 100 + index);
        }
        await settle(fixture);

        if (state === 'fallback') expect(reasonLine()).not.toBeNull();
        else expect(reasonLine()).toBeNull();
        if (state === 'snapshot') {
          expect(native().querySelector('[inert]')).not.toBeNull();
          expect(
            native().querySelector('[data-testid="ptah-ui-text-alternative"]')?.textContent,
          ).toContain('Release checklist');
        }
        expect(await axeViolations(native())).toEqual([]);
      });
    });

    it('gives each chart an accessible name', async () => {
      create();
      await settle(fixture);

      const charts = [...native().querySelectorAll('svg')].filter(
        (svg) => svg.getAttribute('role') === 'img',
      );
      expect(charts.length).toBeGreaterThan(0);
      for (const chart of charts) {
        const name = chart.getAttribute('aria-label') ?? chart.getAttribute('aria-labelledby');
        expect(name).toBeTruthy();
      }
    });
  });

  describe('live cap (Req 5.4, decision 10)', () => {
    let fixture: ComponentFixture<TranscriptHostComponent>;
    const detachSpies = new Map<string, jest.SpyInstance>();
    const reattachSpies = new Map<string, jest.SpyInstance>();

    const spec = (index: number): BlockSpec => ({ nodeId: `n${index}`, orderKey: index });
    const surfaceIdOf = (index: number): string => `ptah-ui-n${index}-0`;
    const liveWindow = (): PtahUiLiveWindow =>
      fixture.debugElement.injector.get(PtahUiLiveWindow);

    function blockElement(index: number): HTMLElement {
      const match = fixture.debugElement
        .queryAll(By.directive(PtahUiBlockComponent))
        .find((debug) => (debug.componentInstance as PtahUiBlockComponent).nodeId() === `n${index}`);
      if (match === undefined) throw new Error(`block ${index} is not mounted`);
      return match.nativeElement as HTMLElement;
    }

    function blockInstance(index: number): PtahUiBlockComponent {
      const match = fixture.debugElement
        .queryAll(By.directive(PtahUiBlockComponent))
        .find((debug) => (debug.componentInstance as PtahUiBlockComponent).nodeId() === `n${index}`);
      if (match === undefined) throw new Error(`block ${index} is not mounted`);
      return match.componentInstance as PtahUiBlockComponent;
    }

    function mode(index: number): string | null {
      return (
        blockElement(index)
          .querySelector('[data-testid="ptah-ui-block"]')
          ?.getAttribute('data-ptah-ui-mode') ?? null
      );
    }

    function spyOnDetector(index: number): void {
      const cdr = blockInstance(index)['cdr'];
      detachSpies.set(`n${index}`, jest.spyOn(cdr, 'detach'));
      reattachSpies.set(`n${index}`, jest.spyOn(cdr, 'reattach'));
    }

    function assertSnapshot(index: number): void {
      const element = blockElement(index);
      expect(mode(index)).toBe('snapshot');
      const renderer = element.querySelector('ptah-surface-renderer');
      expect(renderer?.closest('[inert]')).not.toBeNull();
      for (const control of element.querySelectorAll('button, a[href], input, select, [tabindex]')) {
        expect(control.closest('[inert]')).not.toBeNull();
      }
      expect(
        element.querySelector('[data-testid="ptah-ui-text-alternative"]')?.textContent,
      ).toContain('Release checklist');
    }

    function assertLive(index: number): void {
      const element = blockElement(index);
      expect(mode(index)).toBe('live');
      expect(element.querySelector('[inert]')).toBeNull();
      expect(element.querySelector('[data-testid="ptah-ui-text-alternative"]')).toBeNull();
    }

    beforeEach(() => {
      detachSpies.clear();
      reattachSpies.clear();
      configure();
      fixture = TestBed.createComponent(TranscriptHostComponent);
    });

    it('keeps at most 8 live blocks, freezes the 4 oldest, and survives remounts', async () => {
      // Insert 12 blocks one at a time, as a streaming transcript does.
      for (let index = 1; index <= 12; index += 1) {
        fixture.componentInstance.blocks.update((blocks) => [...blocks, spec(index)]);
        await settle(fixture);
        spyOnDetector(index);
        expect(liveWindow().liveCount()).toBeLessThanOrEqual(8);
      }

      for (let index = 1; index <= 4; index += 1) {
        assertSnapshot(index);
        expect(detachSpies.get(`n${index}`)).toHaveBeenCalledTimes(1);
      }
      for (let index = 5; index <= 12; index += 1) {
        assertLive(index);
        expect(detachSpies.get(`n${index}`)).not.toHaveBeenCalled();
      }

      // A snapshot change recomputes live blocks once and frozen blocks never.
      const before = new Map(pipelineCalls);
      fixture.componentInstance.snapshot.set(PENDING);
      await settle(fixture);
      for (let index = 1; index <= 12; index += 1) {
        const delta =
          (pipelineCalls.get(surfaceIdOf(index)) ?? 0) -
          (before.get(surfaceIdOf(index)) ?? 0);
        expect(delta).toBe(index <= 4 ? 0 : 1);
      }
      expect(liveWindow().liveCount()).toBeLessThanOrEqual(8);

      // Render-window remount of blocks 1, 6 and 12: destroy, then recreate.
      const remounted = new Set(['n1', 'n6', 'n12']);
      fixture.componentInstance.blocks.update((blocks) =>
        blocks.filter((block) => !remounted.has(block.nodeId)),
      );
      await settle(fixture);
      expect(liveWindow().liveCount()).toBeLessThanOrEqual(8);

      fixture.componentInstance.blocks.set(
        Array.from({ length: 12 }, (_, offset) => spec(offset + 1)),
      );
      await settle(fixture);
      expect(liveWindow().liveCount()).toBeLessThanOrEqual(8);

      assertSnapshot(1);
      for (let index = 2; index <= 4; index += 1) assertSnapshot(index);
      for (let index = 5; index <= 12; index += 1) assertLive(index);
      for (const spy of reattachSpies.values()) expect(spy).not.toHaveBeenCalled();
    });
  });
});
