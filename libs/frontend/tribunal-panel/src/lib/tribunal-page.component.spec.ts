import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
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
import type { TribunalTile, VendorLane } from './types/tribunal-ui.types';

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
  readonly model = input('');
  readonly status = input<unknown>();
  readonly focused = input(false);
  readonly focusRequested = output<void>();
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
  readonly tribunalSessionId = input('');
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
  GridstackComponent,
  GridstackItemComponent,
  LucideAngularModule,
];

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
  };
  let mockRun: jest.Mocked<Pick<TribunalRunService, 'endRun'>>;

  beforeEach(() => {
    mockState = {
      tiles: jest.fn().mockReturnValue([]),
      lanes: jest.fn().mockReturnValue([]),
      move: jest.fn().mockReturnValue('council'),
      laneBindings: jest.fn().mockReturnValue(new Map()),
      tribunalSessionId: jest.fn().mockReturnValue(null),
    };
    mockRun = { endRun: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        { provide: TribunalStateService, useValue: mockState },
        { provide: TribunalRunService, useValue: mockRun },
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
            updateTilePosition,
          },
        },
        {
          provide: TribunalRunService,
          useValue: { endRun: jest.fn().mockResolvedValue(true) },
        },
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
