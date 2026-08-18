/**
 * The move picker's two jobs beyond "render five cards":
 *
 *  1. AC-1.2 — Relay and Crucible ship ENABLED. A card that is visible but
 *     permanently greyed teaches the user the feature does not exist.
 *  2. R7 — availability that depends on the machine is applied only ONCE
 *     discovery resolves. Painting a card disabled and then enabling it is the
 *     failure this suite exists to catch; the reverse flash reads as a bug.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal, type WritableSignal } from '@angular/core';
import {
  ClaudeRpcService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import { StepPickMoveComponent } from './step-pick-move.component';
import {
  TribunalDiscoveryService,
  type DiscoveredVendor,
} from '../services/tribunal-discovery.service';
import type { TribunalMove } from '../types/tribunal-ui.types';

/**
 * Every move the picker must offer, in card order.
 *
 * Written out here rather than imported: this is the assertion. A move that
 * disappears from the UI would still satisfy a test that derived its
 * expectation from the same source the component reads.
 */
const TRIBUNAL_MOVES: readonly TribunalMove[] = [
  'council',
  'forge',
  'race',
  'relay',
  'crucible',
];

function vendor(family: string, cli: 'codex' | 'copilot'): DiscoveredVendor {
  return {
    lane: { laneId: `${cli}#0`, family, displayName: family, cli },
    available: true,
    needsSetup: false,
    baseKey: cli,
    supportsModelList: false,
  };
}

const TWO_FAMILIES = [vendor('codex', 'codex'), vendor('copilot', 'copilot')];
const ONE_FAMILY = [vendor('codex', 'codex')];

interface Harness {
  fixture: ComponentFixture<StepPickMoveComponent>;
  vendors: WritableSignal<readonly DiscoveredVendor[]>;
  discovered: WritableSignal<boolean>;
  rpcCall: jest.Mock;
}

function skillsResult(skillIds: readonly string[]): unknown {
  return {
    isSuccess: () => true,
    data: {
      skills: skillIds.map((skillId) => ({
        skillId,
        displayName: skillId,
        description: '',
        pluginId: 'ptah-core',
      })),
    },
  };
}

async function setup(
  options: {
    vendors?: readonly DiscoveredVendor[];
    discovered?: boolean;
    skills?: readonly string[];
    probeFails?: boolean;
  } = {},
): Promise<Harness> {
  const vendors = signal<readonly DiscoveredVendor[]>(options.vendors ?? []);
  const discovered = signal(options.discovered ?? false);
  const rpcCall = jest.fn(() =>
    options.probeFails
      ? Promise.reject(new Error('transport closed'))
      : Promise.resolve(skillsResult(options.skills ?? ['tribunal'])),
  );

  TestBed.configureTestingModule({
    imports: [StepPickMoveComponent],
    providers: [
      {
        provide: TribunalDiscoveryService,
        useValue: {
          vendors: vendors.asReadonly(),
          discovered: discovered.asReadonly(),
          availableFamilyCount: () =>
            new Set(
              vendors()
                .filter((v) => v.available)
                .map((v) => v.lane.family),
            ).size,
          ensureDiscovered: jest.fn().mockResolvedValue(vendors()),
        },
      },
      {
        provide: WebviewNavigationService,
        useValue: { navigateToSettingsTab: jest.fn() },
      },
      { provide: ClaudeRpcService, useValue: { call: rpcCall } },
    ],
  });

  const fixture = TestBed.createComponent(StepPickMoveComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, vendors, discovered, rpcCall };
}

function cardFor(
  fixture: ComponentFixture<StepPickMoveComponent>,
  move: TribunalMove,
): HTMLButtonElement {
  const card = fixture.debugElement.query(
    By.css(`button[data-move="${move}"]`),
  );
  if (!card) throw new Error(`No card rendered for move ${move}`);
  return card.nativeElement as HTMLButtonElement;
}

describe('StepPickMoveComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders exactly one card per shipped move', async () => {
    const { fixture } = await setup();

    const moves = fixture.debugElement
      .queryAll(By.css('button[data-move]'))
      .map((card) =>
        (card.nativeElement as HTMLButtonElement).getAttribute('data-move'),
      );

    expect(moves).toEqual([...TRIBUNAL_MOVES]);
  });

  it('gives every move its own icon — no move inherits another move’s picture', async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance as unknown as {
      iconFor(move: TribunalMove): unknown;
    };

    const icons = TRIBUNAL_MOVES.map((move) => component.iconFor(move));

    expect(new Set(icons).size).toBe(TRIBUNAL_MOVES.length);
    expect(icons.every((icon) => icon !== undefined)).toBe(true);
  });

  it('paints all five cards enabled before discovery has resolved (R7)', async () => {
    const { fixture } = await setup({ vendors: ONE_FAMILY, discovered: false });

    for (const move of TRIBUNAL_MOVES) {
      expect(cardFor(fixture, move).disabled).toBe(false);
    }
  });

  it('disables Crucible only once discovery reports fewer than two families', async () => {
    const { fixture, discovered } = await setup({
      vendors: ONE_FAMILY,
      discovered: false,
    });
    expect(cardFor(fixture, 'crucible').disabled).toBe(false);

    discovered.set(true);
    fixture.detectChanges();

    expect(cardFor(fixture, 'crucible').disabled).toBe(true);
    expect(cardFor(fixture, 'crucible').textContent).toContain(
      'fewer than two vendor families',
    );
    // Only Crucible. Relay runs a single lane per phase and needs no second family.
    expect(cardFor(fixture, 'relay').disabled).toBe(false);
  });

  it('keeps Crucible enabled when two families are available', async () => {
    const { fixture } = await setup({
      vendors: TWO_FAMILIES,
      discovered: true,
    });

    expect(cardFor(fixture, 'crucible').disabled).toBe(false);
  });

  it('never disables a move on a discovery that did not resolve', async () => {
    // A failed probe leaves `discovered` false — an answer we cannot trust must
    // not remove a move the user may well be able to run.
    const { fixture } = await setup({ vendors: [], discovered: false });

    expect(cardFor(fixture, 'crucible').disabled).toBe(false);
  });

  it('emits the picked move', async () => {
    const { fixture } = await setup({
      vendors: TWO_FAMILIES,
      discovered: true,
    });
    const picked: TribunalMove[] = [];
    fixture.componentInstance.moveSelected.subscribe((move) =>
      picked.push(move),
    );

    cardFor(fixture, 'relay').click();
    fixture.detectChanges();

    expect(picked).toEqual(['relay']);
  });

  it('emits nothing when a blocked card is clicked', async () => {
    const { fixture } = await setup({ vendors: ONE_FAMILY, discovered: true });
    const picked: TribunalMove[] = [];
    fixture.componentInstance.moveSelected.subscribe((move) =>
      picked.push(move),
    );

    cardFor(fixture, 'crucible').click();
    fixture.detectChanges();

    expect(picked).toEqual([]);
  });

  it('badges Relay and Crucible when the tribunal skill is definitely absent — and leaves them enabled', async () => {
    const { fixture } = await setup({
      vendors: TWO_FAMILIES,
      discovered: true,
      skills: ['orchestration'],
    });

    const badged = fixture.debugElement
      .queryAll(By.css('[data-testid="tribunal-skill-advisory"]'))
      .map((badge) =>
        (badge.nativeElement as HTMLElement)
          .closest('button')
          ?.getAttribute('data-move'),
      );

    expect(badged).toEqual(['relay', 'crucible']);
    expect(cardFor(fixture, 'relay').disabled).toBe(false);
    expect(cardFor(fixture, 'crucible').disabled).toBe(false);
  });

  it('shows no advisory when the skill is installed', async () => {
    const { fixture } = await setup({ skills: ['tribunal'] });

    expect(
      fixture.debugElement.queryAll(
        By.css('[data-testid="tribunal-skill-advisory"]'),
      ),
    ).toHaveLength(0);
  });

  it('shows no advisory when the probe itself failed — an unreliable check raises no alarm', async () => {
    const { fixture } = await setup({ probeFails: true });

    expect(
      fixture.debugElement.queryAll(
        By.css('[data-testid="tribunal-skill-advisory"]'),
      ),
    ).toHaveLength(0);
  });
});
