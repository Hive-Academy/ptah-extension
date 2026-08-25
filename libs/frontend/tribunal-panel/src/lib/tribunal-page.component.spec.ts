import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule } from 'lucide-angular';
import {
  GridstackComponent,
  GridstackItemComponent,
} from 'gridstack/dist/angular';
import { TribunalPageComponent } from './tribunal-page.component';
import { TribunalStateService } from './services/tribunal-state.service';
import { TribunalRunService } from './services/tribunal-run.service';
import { TribunalProgressService } from './services/tribunal-progress.service';
import type {
  TribunalMove,
  TribunalProgress,
  TribunalTile,
  VendorLane,
} from './types/tribunal-ui.types';

@Component({
  selector: 'ptah-tribunal-tile-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="tile-host-stub">
      <span data-testid="tile-host-label">{{ label() }}</span>
      <span data-testid="tile-host-model">{{ model() }}</span>
    </div>
    <ng-content />
  `,
})
class TileHostStub {
  readonly tile = input<unknown>();
  readonly label = input('');
  readonly role = input('');
  readonly model = input('');
  readonly status = input<unknown>();
  readonly focused = input(false);
  readonly focusRequested = output<void>();
}

@Component({
  selector: 'ptah-relay-phase-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="relay-rail-stub">{{ progress().kind }}</div>`,
})
class RelayRailStub {
  readonly progress = input.required<TribunalProgress>();
  readonly lanes = input<readonly VendorLane[]>([]);
  readonly specTaskId = input<string | null>(null);
}

@Component({
  selector: 'ptah-crucible-verdict-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="verdict-panel-stub">{{ progress().kind }}</div>`,
})
class VerdictPanelStub {
  readonly progress = input.required<TribunalProgress>();
}

@Component({
  selector: 'ptah-conductor-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="conductor-tile-stub"></div>`,
})
class ConductorTileStub {}

@Component({
  selector: 'ptah-vendor-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="vendor-card-stub"></div>`,
})
class VendorCardStub {
  readonly lane = input<unknown>();
  readonly tribunalSessionId = input<string | null>(null);
}

@Component({
  selector: 'ptah-tribunal-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div></div>`,
})
class EmptyStateStub {}

@Component({
  selector: 'ptah-tribunal-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div></div>`,
})
class WizardStub {}

const STUBS = [
  TileHostStub,
  ConductorTileStub,
  VendorCardStub,
  EmptyStateStub,
  WizardStub,
  RelayRailStub,
  VerdictPanelStub,
  GridstackComponent,
  GridstackItemComponent,
  LucideAngularModule,
];

/** The progress service is injected for its derivation effect; stub it out. */
function progressStub(refresh = jest.fn().mockResolvedValue(undefined)) {
  return { provide: TribunalProgressService, useValue: { refresh } };
}

function makeLane(id: string, overrides: Partial<VendorLane> = {}): VendorLane {
  return {
    laneId: id,
    family: 'codex',
    displayName: `Vendor ${id}`,
    cli: 'codex',
    model: `model-${id}`,
    ...overrides,
  };
}

function makeTile(laneId: string): TribunalTile {
  return {
    tileId: laneId,
    kind: 'vendor',
    laneId,
    position: { x: 0, y: 0, w: 4, h: 6 },
  };
}

describe('TribunalPageComponent — lifecycle', () => {
  let fixture: ComponentFixture<TribunalPageComponent>;
  let mockState: {
    tiles: jest.Mock;
    lanes: jest.Mock;
    move: jest.Mock;
    laneBindings: jest.Mock;
    tribunalSessionId: jest.Mock;
    progress: jest.Mock;
    specTaskId: jest.Mock;
  };
  let mockRun: jest.Mocked<Pick<TribunalRunService, 'endRun'>>;

  beforeEach(() => {
    mockState = {
      tiles: jest.fn().mockReturnValue([]),
      lanes: jest.fn().mockReturnValue([]),
      move: jest.fn().mockReturnValue('council'),
      laneBindings: jest.fn().mockReturnValue(new Map()),
      tribunalSessionId: jest.fn().mockReturnValue(null),
      progress: jest.fn().mockReturnValue({ kind: 'none' }),
      specTaskId: jest.fn().mockReturnValue(null),
    };
    mockRun = { endRun: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        { provide: TribunalStateService, useValue: mockState },
        { provide: TribunalRunService, useValue: mockRun },
        progressStub(),
      ],
    }).overrideComponent(TribunalPageComponent, {
      set: { template: '<div></div>', imports: [], providers: [] },
    });

    fixture = TestBed.createComponent(TribunalPageComponent);
    fixture.detectChanges();
  });

  it('navigating away (component destroy) does NOT tear down the run', () => {
    fixture.destroy();

    expect(mockRun.endRun).not.toHaveBeenCalled();
  });

  it('onCloseRun delegates to runService.endRun (user-initiated teardown)', async () => {
    await (
      fixture.componentInstance as unknown as { onCloseRun(): Promise<void> }
    ).onCloseRun();

    expect(mockRun.endRun).toHaveBeenCalledTimes(1);
  });
});

describe('TribunalPageComponent — board rendering', () => {
  let updateTilePosition: jest.Mock;

  function configure(opts: {
    tiles: TribunalTile[];
    lanes: VendorLane[];
  }): ComponentFixture<TribunalPageComponent> {
    updateTilePosition = jest.fn();
    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        {
          provide: TribunalStateService,
          useValue: {
            tiles: jest.fn().mockReturnValue(opts.tiles),
            lanes: jest.fn().mockReturnValue(opts.lanes),
            move: jest.fn().mockReturnValue('council'),
            laneBindings: jest.fn().mockReturnValue(new Map()),
            tribunalSessionId: jest.fn().mockReturnValue('session-1'),
            progress: jest.fn().mockReturnValue({ kind: 'none' }),
            specTaskId: jest.fn().mockReturnValue(null),
            updateTilePosition,
          },
        },
        {
          provide: TribunalRunService,
          useValue: { endRun: jest.fn().mockResolvedValue(true) },
        },
        progressStub(),
      ],
    }).overrideComponent(TribunalPageComponent, {
      set: { imports: STUBS },
    });

    const fixture = TestBed.createComponent(TribunalPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the conductor tile and the top bar', () => {
    const fixture = configure({
      tiles: [makeTile('a')],
      lanes: [makeLane('a')],
    });

    expect(
      fixture.debugElement.query(By.css('[data-testid="conductor-tile-stub"]')),
    ).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="tribunal-top-bar"]')),
    ).not.toBeNull();
  });

  it('renders one gridstack tile per lane', () => {
    const fixture = configure({
      tiles: [makeTile('a'), makeTile('b'), makeTile('c')],
      lanes: [makeLane('a'), makeLane('b'), makeLane('c')],
    });

    expect(
      fixture.debugElement.queryAll(By.css('[data-testid="tribunal-tile"]'))
        .length,
    ).toBe(3);
  });

  it('renders all tiles (no 3-tile cap) when there are more than 3 lanes', () => {
    const lanes = ['a', 'b', 'c', 'd', 'e'].map((id) => makeLane(id));
    const tiles = lanes.map((l) => makeTile(l.laneId));
    const fixture = configure({ tiles, lanes });

    expect(
      fixture.debugElement.queryAll(By.css('[data-testid="tribunal-tile"]'))
        .length,
    ).toBe(5);
  });

  it('toggling the lock button flips its pressed state', () => {
    const fixture = configure({
      tiles: [makeTile('a')],
      lanes: [makeLane('a')],
    });

    const lock = fixture.debugElement.query(
      By.css('[data-testid="tribunal-lock-toggle"]'),
    );
    expect(
      (lock.nativeElement as HTMLElement).getAttribute('aria-pressed'),
    ).toBe('false');

    (lock.nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(
      (lock.nativeElement as HTMLElement).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('persists tile positions reported by gridstack onGridChange', () => {
    const fixture = configure({
      tiles: [makeTile('a')],
      lanes: [makeLane('a')],
    });

    (
      fixture.componentInstance as unknown as {
        onGridChange(data: { nodes: unknown[] }): void;
      }
    ).onGridChange({ nodes: [{ id: 'a', x: 4, y: 6, w: 4, h: 6 }] });

    expect(updateTilePosition).toHaveBeenCalledWith('a', {
      x: 4,
      y: 6,
      w: 4,
      h: 6,
    });
  });

  it('renders the model under the provider name in each tile header', () => {
    const fixture = configure({
      tiles: [makeTile('a')],
      lanes: [makeLane('a', { displayName: 'Codex', model: 'gpt-5' })],
    });

    const model = fixture.debugElement.query(
      By.css('[data-testid="tile-host-model"]'),
    );
    expect((model.nativeElement as HTMLElement).textContent).toContain('gpt-5');
  });
});

/**
 * The per-move strip renders ABOVE the tile grid (plan §1 Q5), which is what
 * lets `slotFor` and `TRIBUNAL_MAX_VENDOR_TILES` stay untouched (AC-6.3).
 */
describe('TribunalPageComponent — progress strip', () => {
  const RELAY_PROGRESS: TribunalProgress = {
    kind: 'relay',
    phases: [],
    runningIndex: null,
  };

  let refresh: jest.Mock;
  let tiles: ReturnType<typeof signal<TribunalTile[]>>;
  let move: ReturnType<typeof signal<TribunalMove>>;
  let progress: ReturnType<typeof signal<TribunalProgress>>;

  function configure(
    initialMove: TribunalMove,
    initialProgress: TribunalProgress,
  ): ComponentFixture<TribunalPageComponent> {
    refresh = jest.fn().mockResolvedValue(undefined);
    tiles = signal<TribunalTile[]>([makeTile('a')]);
    move = signal<TribunalMove>(initialMove);
    progress = signal<TribunalProgress>(initialProgress);

    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        {
          provide: TribunalStateService,
          useValue: {
            tiles,
            move,
            progress,
            lanes: jest.fn().mockReturnValue([makeLane('a')]),
            laneBindings: jest.fn().mockReturnValue(new Map()),
            tribunalSessionId: jest.fn().mockReturnValue('session-1'),
            specTaskId: jest.fn().mockReturnValue('TASK_2026_237'),
            updateTilePosition: jest.fn(),
          },
        },
        {
          provide: TribunalRunService,
          useValue: {
            // Mirrors `reset()` writing EMPTY_SLICE wholesale — the state-level
            // guarantee itself is pinned in tribunal-state.service.spec.ts.
            endRun: jest.fn().mockImplementation(async () => {
              tiles.set([]);
              move.set('council');
              progress.set({ kind: 'none' });
              return true;
            }),
          },
        },
        progressStub(refresh),
      ],
    }).overrideComponent(TribunalPageComponent, { set: { imports: STUBS } });

    const fixture = TestBed.createComponent(TribunalPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  function strip(fixture: ComponentFixture<TribunalPageComponent>) {
    return fixture.debugElement.query(
      By.css('[data-testid="tribunal-progress-strip"]'),
    );
  }

  it('renders the phase rail for a relay run', () => {
    const fixture = configure('relay', RELAY_PROGRESS);

    expect(strip(fixture)).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="relay-rail-stub"]')),
    ).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="verdict-panel-stub"]')),
    ).toBeNull();
  });

  it('renders the verdict panel for a crucible run', () => {
    const fixture = configure('crucible', {
      kind: 'crucible',
      roundCap: 2,
      currentRound: 1,
      rounds: [],
      termination: 'in-progress',
    });

    expect(
      fixture.debugElement.query(By.css('[data-testid="verdict-panel-stub"]')),
    ).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="relay-rail-stub"]')),
    ).toBeNull();
  });

  it('renders no strip at all for a flat move', () => {
    const fixture = configure('council', { kind: 'none' });

    expect(strip(fixture)).toBeNull();
  });

  it('keeps the strip (and its refresh button) when progress is unavailable', () => {
    // The strip disappearing would read as "nothing to report", which is the
    // AC-4.5 conflation the unavailable arm exists to prevent.
    const fixture = configure('relay', {
      kind: 'unavailable',
      reason: 'No spec folder was allocated for this run.',
    });

    expect(strip(fixture)).not.toBeNull();
    expect(
      fixture.debugElement.query(
        By.css('[data-testid="tribunal-refresh-progress"]'),
      ),
    ).not.toBeNull();
  });

  it('Refresh progress re-reads the spec folder on demand (R1)', async () => {
    const fixture = configure('relay', RELAY_PROGRESS);

    const button = fixture.debugElement.query(
      By.css('[data-testid="tribunal-refresh-progress"]'),
    ).nativeElement as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a second Refresh click while the first is in flight', async () => {
    const pending: Array<() => void> = [];
    const fixture = configure('relay', RELAY_PROGRESS);
    refresh.mockImplementation(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    );

    const button = fixture.debugElement.query(
      By.css('[data-testid="tribunal-refresh-progress"]'),
    ).nativeElement as HTMLButtonElement;
    button.click();
    button.click();
    pending.forEach((resolve) => resolve());
    await fixture.whenStable();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('Close Tribunal clears the strip along with the rest of the run (AC-6.4)', async () => {
    const fixture = configure('crucible', {
      kind: 'crucible',
      roundCap: 2,
      currentRound: 2,
      rounds: [],
      termination: 'cap-reached-with-defects',
    });
    expect(strip(fixture)).not.toBeNull();

    await (
      fixture.componentInstance as unknown as { onCloseRun(): Promise<void> }
    ).onCloseRun();
    fixture.detectChanges();

    expect(strip(fixture)).toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="tribunal-tile"]')),
    ).toBeNull();
  });

  it('shows the lane role as a tile badge for a role move', () => {
    refresh = jest.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        {
          provide: TribunalStateService,
          useValue: {
            tiles: jest.fn().mockReturnValue([makeTile('a')]),
            move: jest.fn().mockReturnValue('relay'),
            progress: jest.fn().mockReturnValue(RELAY_PROGRESS),
            lanes: jest
              .fn()
              .mockReturnValue([makeLane('a', { role: 'architect' })]),
            laneBindings: jest.fn().mockReturnValue(new Map()),
            tribunalSessionId: jest.fn().mockReturnValue('session-1'),
            specTaskId: jest.fn().mockReturnValue('TASK_2026_237'),
            updateTilePosition: jest.fn(),
          },
        },
        {
          provide: TribunalRunService,
          useValue: { endRun: jest.fn().mockResolvedValue(true) },
        },
        progressStub(refresh),
      ],
    }).overrideComponent(TribunalPageComponent, { set: { imports: STUBS } });

    const fixture = TestBed.createComponent(TribunalPageComponent);
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(TileHostStub));
    expect((host.componentInstance as TileHostStub).role()).toBe('architect');
  });
});
