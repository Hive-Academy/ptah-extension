import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SurfaceRendererComponent } from '@ptah-extension/declarative-dashboard';
import { provideMarkdown } from 'ngx-markdown';
import {
  PTAH_UI_HOST_SOURCES,
  type PtahUiHostSources,
} from '../../services/ptah-ui-host-sources';
import {
  PTAH_UI_DISPLAY_DOCK,
  type PtahUiDisplayDock,
  type PtahUiDisplayFenceStatus,
} from '../../services/ptah-ui-display-dock';
import { PtahUiLiveWindow } from '../../services/ptah-ui-live-window';
import { PtahUiMessageTextComponent } from './ptah-ui-message-text.component';

const BODY = 'title Release checklist\nstats\n  Reviewers | 2\n';
const CLOSED = '```ptah-ui display release\n' + BODY + '```\n';
const OPEN = '```ptah-ui display release\n' + BODY;

class Dock implements PtahUiDisplayDock {
  readonly status = signal<PtahUiDisplayFenceStatus | null>(null);
  fenceStatus(): PtahUiDisplayFenceStatus | null {
    return this.status();
  }
  openSurface = jest.fn();
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PtahUiMessageTextComponent],
  providers: [PtahUiLiveWindow],
  template: `
    @if (mounted()) {
      <ptah-ui-message-text
        [text]="text()"
        messageId="m1"
        nodeId="n1"
        [orderKey]="1"
        (openInDisplayRequested)="opened.push($event)"
      />
    }
    @if (second()) {
      <ptah-ui-message-text
        [text]="secondText()"
        messageId="m2"
        nodeId="n2"
        [orderKey]="2"
        (openInDisplayRequested)="opened.push($event)"
      />
    }
  `,
})
class Host {
  readonly text = signal('');
  readonly secondText = signal('');
  readonly second = signal(false);
  readonly mounted = signal(true);
  readonly opened: string[] = [];
}

describe('inline display fences', () => {
  let fixture: ComponentFixture<Host>;
  let dock: Dock;
  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const action = (): HTMLButtonElement | null =>
    root().querySelector('[data-testid="ptah-ui-display-chip-open"]');
  async function show(text: string): Promise<void> {
    fixture.componentInstance.text.set(text);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function create(withDock = true): void {
    dock = new Dock();
    const hostSources: PtahUiHostSources = {
      tabId: signal('tab-1'),
      sessionId: signal('session-1'),
      turnFacts: signal([]),
      turnIndexOf: () => null,
      capacities: signal([]),
    };
    TestBed.configureTestingModule({
      providers: [
        provideMarkdown(),
        { provide: PTAH_UI_HOST_SOURCES, useValue: hostSources },
        ...(withDock
          ? [{ provide: PTAH_UI_DISPLAY_DOCK, useValue: dock }]
          : []),
      ],
    });
    fixture = TestBed.createComponent(Host);
  }

  it('keeps a streaming fence as code, then renders the closed fence inline', async () => {
    create();
    await show(OPEN);
    expect(root().querySelector('ptah-surface-renderer')).toBeNull();
    expect(root().querySelector('markdown code')?.textContent).toContain(
      'Reviewers | 2',
    );
    await show(CLOSED);
    expect(root().querySelector('ptah-surface-renderer')).not.toBeNull();
  });

  it('renders full inline content without a host display dock', async () => {
    create(false);
    await show(CLOSED);
    expect(root().querySelector('ptah-surface-renderer')).not.toBeNull();
    expect(
      root().querySelector('[data-testid="ptah-ui-display-chip"]'),
    ).toBeNull();
    expect(action()).toBeNull();
  });

  it('keeps a full inline renderer while display status is pending', async () => {
    create();
    await show(CLOSED);
    expect(root().querySelector('ptah-surface-renderer')).not.toBeNull();
    expect(
      root()
        .querySelector('[data-testid="ptah-ui-display-chip"]')
        ?.getAttribute('data-state'),
    ).toBe('pending');
    expect(action()).toBeNull();
  });

  it('shows a localized inline error for an invalid display id', async () => {
    create();
    await show('```ptah-ui display ptah.reserved\n' + BODY + '```\n');
    expect(root().querySelector('ptah-surface-renderer')).toBeNull();
    expect(
      root().querySelector('[data-ptah-ui-reason]')?.textContent,
    ).toContain('reserved display id');
    expect(root().querySelector('markdown code')?.textContent).toContain(
      'Reviewers | 2',
    );
    expect(action()).toBeNull();
  });

  it('keeps the inline renderer for a dock-reported invalid fence', async () => {
    create();
    dock.status.set({ kind: 'invalid', reason: 'collection rejected' });
    await show(CLOSED);
    expect(root().querySelector('ptah-surface-renderer')).not.toBeNull();
    expect(root().textContent).toContain('Not in display');
    expect(action()).toBeNull();
  });

  it('uses unique accessibility ids and local interaction state for repeated display ids', async () => {
    create();
    await show(CLOSED);
    fixture.componentInstance.secondText.set(CLOSED);
    fixture.componentInstance.second.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const renderers = fixture.debugElement.queryAll(
      By.directive(SurfaceRendererComponent),
    );
    expect(renderers).toHaveLength(2);
    const first = renderers[0].componentInstance as SurfaceRendererComponent;
    const second = renderers[1].componentInstance as SurfaceRendererComponent;
    expect(first.interaction()).not.toBe(second.interaction());
    expect(first.interaction().actions).not.toBe(second.interaction().actions);
    expect(first.interaction().submitDisabled).toBe(true);
    expect(second.interaction().submitDisabled).toBe(true);

    fixture.componentInstance.text.set(
      '```ptah-ui display ptah.reserved\n' + BODY + '```\n',
    );
    fixture.componentInstance.secondText.set(
      '```ptah-ui display ptah.reserved\n' + BODY + '```\n',
    );
    fixture.detectChanges();
    const reasons = [
      ...root().querySelectorAll<HTMLElement>('[data-ptah-ui-reason]'),
    ];
    expect(reasons).toHaveLength(2);
    expect(reasons[0].id).not.toBe(reasons[1].id);
    for (const reason of reasons) {
      expect(
        reason.previousElementSibling?.getAttribute('aria-describedby'),
      ).toBe(reason.id);
    }
  });

  it.each(['superseded', 'evicted'] as const)(
    'retains its historical renderer when %s',
    async (kind) => {
      create();
      await show(CLOSED);
      const renderer = root().querySelector('ptah-surface-renderer');
      dock.status.set({
        kind,
        surfaceKey: 'id:release',
        title: 'Release',
        description: null,
      });
      fixture.detectChanges();
      expect(root().querySelector('ptah-surface-renderer')).toBe(renderer);
      expect(root().textContent).toContain(
        kind === 'superseded' ? 'Updated later' : 'No longer in display',
      );
      expect(action()?.textContent?.trim() ?? null).toBe(
        kind === 'superseded' ? 'Open latest' : null,
      );
    },
  );

  it.each(['superseded', 'evicted'] as const)(
    'renders a remounted %s fence as a snapshot',
    async (kind) => {
      create();
      await show(CLOSED);
      dock.status.set({
        kind,
        surfaceKey: 'id:release',
        title: 'Release',
        description: null,
      });
      fixture.componentInstance.mounted.set(false);
      fixture.detectChanges();
      const liveWindow = fixture.debugElement.injector.get(PtahUiLiveWindow);
      for (let index = 0; index < 8; index++) {
        liveWindow.register(`newer:${index}`, index + 2);
      }
      fixture.componentInstance.mounted.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        root()
          .querySelector('[data-testid="ptah-ui-block"]')
          ?.getAttribute('data-ptah-ui-mode'),
      ).toBe('snapshot');
      expect(root().querySelector('ptah-surface-renderer')).not.toBeNull();
      expect(root().textContent).toContain(
        kind === 'superseded' ? 'Updated later' : 'No longer in display',
      );
      if (kind === 'superseded')
        expect(action()?.textContent).toContain('Open latest');
      else expect(action()).toBeNull();
    },
  );

  it('forwards the open request from the inline action', async () => {
    create();
    await show(CLOSED);
    dock.status.set({
      kind: 'applied',
      surfaceKey: 'id:release',
      title: 'Release',
      description: null,
    });
    fixture.detectChanges();
    (
      root().querySelector(
        '[data-testid="ptah-ui-display-chip-open"]',
      ) as HTMLButtonElement
    ).click();
    expect(fixture.componentInstance.opened).toEqual(['id:release']);
  });
});
