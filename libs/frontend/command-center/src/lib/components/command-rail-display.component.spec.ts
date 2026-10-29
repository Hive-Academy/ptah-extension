import { Component, input, output } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DisplayPanelComponent } from '@ptah-extension/chat-ui/display-panel';
import type { DisplaySurface } from '@ptah-extension/chat-ui';
import {
  ArtifactStore,
  ChangeSetActionsService,
  DisplayDockState,
  type DisplayDockSummary,
} from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import { CommandRailDisplayComponent } from './command-rail-display.component';
import { artifactStoreStub } from './command-rail.testing';

@Component({
  selector: 'ptah-display-panel',
  standalone: true,
  template: '',
})
class StubDisplayPanelComponent {
  public readonly surfaces = input<readonly DisplaySurface[]>([]);
  public readonly artifacts = input<readonly unknown[]>([]);
  public readonly open = input(true);
  public readonly fullscreenArtifactId = input<string | null>(null);
  public readonly summary = input<unknown>(null);
  public readonly summaryTurnKey = input('');
  public readonly selectedKey = input<string | null>(null);
  public readonly scrollToSelectedOnMount = input(false);
  public readonly pinned = input(false);
  public readonly viewStates = input<ReadonlyMap<string, unknown>>(new Map());
  public readonly actionError = input<string | null>(null);
  public readonly selectedKeyChange = output<string>();
  public readonly viewStateChange = output<unknown>();
  public readonly fullscreenChange = output<boolean>();
  public readonly openFile = output<string>();
  public readonly review = output<void>();
  public readonly openExternal = output<string>();
}

function surface(key: string): DisplaySurface {
  return { key } as unknown as DisplaySurface;
}

function summary(): DisplayDockSummary {
  return {
    model: { title: 'Turn' },
    changeSet: null,
  } as unknown as DisplayDockSummary;
}

describe('CommandRailDisplayComponent', () => {
  let dock: DisplayDockState;
  const actions = { openFile: jest.fn(), review: jest.fn() };

  function mount() {
    dock = new DisplayDockState();
    TestBed.configureTestingModule({
      imports: [CommandRailDisplayComponent],
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
      providers: [
        { provide: ArtifactStore, useValue: artifactStoreStub() },
        { provide: ChangeSetActionsService, useValue: actions },
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      ],
    });
    TestBed.overrideComponent(CommandRailDisplayComponent, {
      remove: { imports: [DisplayPanelComponent] },
      add: { imports: [StubDisplayPanelComponent] },
    });
    const fixture = TestBed.createComponent(CommandRailDisplayComponent);
    fixture.componentRef.setInput('dock', dock);
    fixture.componentRef.setInput('tabId', 'tab-1');
    return fixture;
  }

  async function settle(
    fixture: ReturnType<typeof mount>,
  ): Promise<StubDisplayPanelComponent | null> {
    for (let round = 0; round < 3; round += 1) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    return (
      fixture.debugElement.query(By.directive(StubDisplayPanelComponent))
        ?.componentInstance ?? null
    );
  }

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('shows the empty state when the tab has nothing to display', async () => {
    const fixture = mount();
    expect(await settle(fixture)).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="rail-display-empty"]',
      )?.textContent,
    ).toContain('Nothing displayed yet.');
  });

  it('renders the target tab surfaces and summary from the shared dock', async () => {
    const fixture = mount();
    const chart = surface('id:chart');
    dock.setSurfaces('tab-1', { surfaces: [chart], statuses: new Map() });
    dock.setSurfaces('tab-2', {
      surfaces: [surface('id:other')],
      statuses: new Map(),
    });
    const turn = summary();
    dock.setSummaries('tab-1', new Map([['turn-1', turn]]));
    const panel = await settle(fixture);
    expect(panel?.surfaces()).toEqual([chart]);
    expect(panel?.summary()).toBe(turn.model);
    expect(panel?.summaryTurnKey()).toBe('turn-1');
  });

  it('writes selection to the dock per tab, so a tab change resets it', async () => {
    const fixture = mount();
    dock.setSurfaces('tab-1', {
      surfaces: [surface('id:chart')],
      statuses: new Map(),
    });
    dock.setSurfaces('tab-2', {
      surfaces: [surface('id:other')],
      statuses: new Map(),
    });
    let panel = await settle(fixture);
    panel?.selectedKeyChange.emit('id:chart');
    panel = await settle(fixture);
    expect(dock.tab('tab-1').selection).toEqual({
      kind: 'surface',
      surfaceKey: 'id:chart',
    });
    expect(panel?.selectedKey()).toBe('id:chart');

    fixture.componentRef.setInput('tabId', 'tab-2');
    panel = await settle(fixture);
    expect(panel?.selectedKey()).toBeNull();
    expect(panel?.surfaces()).toEqual([surface('id:other')]);
  });

  it('reports a review with no change set instead of calling the action', async () => {
    const fixture = mount();
    dock.setSummaries('tab-1', new Map([['turn-1', summary()]]));
    let panel = await settle(fixture);
    panel?.review.emit();
    panel = await settle(fixture);
    expect(actions.review).not.toHaveBeenCalled();
    expect(panel?.actionError()).toBe(
      'This turn has no recorded file changes to open.',
    );
  });
});
