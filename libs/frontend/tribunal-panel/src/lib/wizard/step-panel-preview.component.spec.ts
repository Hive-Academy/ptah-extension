/**
 * Per-lane model-option isolation for the "Assemble the panel" wizard step.
 *
 * Regression guard: every lane's `<select>` must offer EXACTLY the models of
 * that lane's own vendor — never another lane's — including when the same
 * vendor occupies several lanes and after a lane is removed. Also pins the
 * rule that a lane can never carry a model id that is absent from its own
 * vendor's list (which would submit a cross-vendor id to the Run step while
 * the browser silently displayed a different option).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import {
  EffortStateService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { StepPanelPreviewComponent } from './step-panel-preview.component';
import {
  TribunalDiscoveryService,
  type DiscoveredVendor,
} from '../services/tribunal-discovery.service';
import type { VendorLane } from '../types/tribunal-ui.types';

function model(id: string, name: string): ProviderModelInfo {
  return {
    id,
    name,
    description: '',
    contextLength: 200000,
    supportsToolUse: true,
  };
}

const CLAUDE_MODELS: readonly ProviderModelInfo[] = [
  model('claude-opus-4-8', 'Claude Opus 4.8'),
  model('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
];

const OLLAMA_MODELS: readonly ProviderModelInfo[] = [
  model('kimi-k3:cloud', 'Kimi K3 (Cloud)'),
  model('kimi-k2.5:cloud', 'Kimi K2.5 (Cloud)'),
];

const CLAUDE_VENDOR: DiscoveredVendor = {
  lane: {
    laneId: 'ptah-cli|claude-cli#0',
    family: 'claude-cli',
    displayName: 'Claude (Subscription)',
    cli: 'ptah-cli',
    providerId: 'claude-cli',
    // Registry seed (`defaultTiers.opus`) — present in CLAUDE_MODELS.
    model: 'claude-opus-4-8',
  },
  available: true,
  needsSetup: false,
  baseKey: 'ptah-cli|claude-cli',
  supportsModelList: true,
  modelProviderId: 'claude-cli',
};

const OLLAMA_VENDOR: DiscoveredVendor = {
  lane: {
    laneId: 'ptah-cli|ollama-cloud#0',
    family: 'ollama-cloud',
    displayName: 'Ollama Cloud',
    cli: 'ptah-cli',
    providerId: 'ollama-cloud',
    // Registry seed that is NOT in OLLAMA_MODELS (stale tier default).
    model: 'gpt-oss:120b-cloud',
  },
  available: true,
  needsSetup: false,
  baseKey: 'ptah-cli|ollama-cloud',
  supportsModelList: true,
  modelProviderId: 'ollama-cloud',
};

const MODELS_BY_PROVIDER: Record<string, readonly ProviderModelInfo[]> = {
  'claude-cli': CLAUDE_MODELS,
  'ollama-cloud': OLLAMA_MODELS,
};

describe('StepPanelPreviewComponent — per-lane model options', () => {
  let fixture: ComponentFixture<StepPanelPreviewComponent>;
  let emitted: readonly VendorLane[];
  let discoveryDouble: {
    ensureDiscovered: jest.Mock;
    rediscover: jest.Mock;
    discover: jest.Mock;
  };

  beforeEach(async () => {
    // The step reads the SHARED discovery cache now, so the double exposes the
    // same surface: a `vendors` signal plus the two memoized entry points.
    const vendors = signal<readonly DiscoveredVendor[]>([]);
    const resolve = async () => {
      vendors.set([CLAUDE_VENDOR, OLLAMA_VENDOR]);
      return vendors();
    };
    const discovery = {
      maxVendors: 8,
      vendors: vendors.asReadonly(),
      discovered: signal(false).asReadonly(),
      ensureDiscovered: jest.fn(resolve),
      rediscover: jest.fn(resolve),
      discover: jest.fn().mockResolvedValue([CLAUDE_VENDOR, OLLAMA_VENDOR]),
      listModelsFor: jest.fn((vendor: DiscoveredVendor) =>
        Promise.resolve(MODELS_BY_PROVIDER[vendor.modelProviderId ?? ''] ?? []),
      ),
    };

    discoveryDouble = discovery;

    TestBed.configureTestingModule({
      imports: [StepPanelPreviewComponent],
      providers: [
        { provide: TribunalDiscoveryService, useValue: discovery },
        {
          provide: WebviewNavigationService,
          useValue: { navigateToSettingsTab: jest.fn() },
        },
        {
          provide: EffortStateService,
          useValue: {
            currentEffort: signal(undefined).asReadonly(),
            setEffort: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(StepPanelPreviewComponent);
    emitted = [];
    fixture.componentInstance.lanesChanged.subscribe((lanes) => {
      emitted = lanes;
      fixture.componentRef.setInput('selectedLanes', lanes);
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /** Click the "Add <displayName>" card and let the async add settle. */
  async function addLane(displayName: string): Promise<void> {
    const button = fixture.debugElement
      .queryAll(By.css('button'))
      .find(
        (candidate) =>
          (candidate.nativeElement as HTMLButtonElement).getAttribute(
            'aria-label',
          ) === `Add ${displayName}`,
      );
    if (!button) throw new Error(`Add button not found for ${displayName}`);
    (button.nativeElement as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function removeLane(laneId: string): void {
    fixture.componentInstance.lanesChanged.emit(
      emitted.filter((lane) => lane.laneId !== laneId),
    );
    fixture.detectChanges();
  }

  /** Option ids of every lane's model `<select>`, in lane order. */
  function optionIdsPerLane(): string[][] {
    return fixture.debugElement
      .queryAll(By.css('[data-testid="tribunal-selected-lanes"] select'))
      .map((select) =>
        Array.from(
          (select.nativeElement as HTMLSelectElement).options,
          (option) => option.value,
        ),
      );
  }

  it('offers only the lane vendor’s own models when two vendors share the panel', async () => {
    await addLane('Ollama Cloud');
    await addLane('Claude (Subscription)');

    expect(optionIdsPerLane()).toEqual([
      ['kimi-k3:cloud', 'kimi-k2.5:cloud'],
      ['claude-opus-4-8', 'claude-sonnet-4-6'],
    ]);
  });

  it('keeps options isolated when the same vendor occupies two lanes', async () => {
    await addLane('Claude (Subscription)');
    await addLane('Claude (Subscription)');
    await addLane('Ollama Cloud');

    expect(emitted.map((lane) => lane.laneId)).toEqual([
      'ptah-cli|claude-cli#0',
      'ptah-cli|claude-cli#1',
      'ptah-cli|ollama-cloud#0',
    ]);
    expect(optionIdsPerLane()).toEqual([
      ['claude-opus-4-8', 'claude-sonnet-4-6'],
      ['claude-opus-4-8', 'claude-sonnet-4-6'],
      ['kimi-k3:cloud', 'kimi-k2.5:cloud'],
    ]);
  });

  it('leaves the surviving lane’s options untouched after a lane is removed', async () => {
    await addLane('Ollama Cloud');
    await addLane('Claude (Subscription)');

    removeLane('ptah-cli|ollama-cloud#0');

    expect(emitted.map((lane) => lane.laneId)).toEqual([
      'ptah-cli|claude-cli#0',
    ]);
    expect(optionIdsPerLane()).toEqual([
      ['claude-opus-4-8', 'claude-sonnet-4-6'],
    ]);
  });

  it('never seeds a lane with a model id absent from its own vendor list', async () => {
    await addLane('Ollama Cloud');
    await addLane('Claude (Subscription)');

    const [ollamaLane, claudeLane] = emitted;
    // Ollama's registry seed is stale → falls back to a real Ollama model.
    expect(ollamaLane.model).toBe('kimi-k3:cloud');
    // Claude's registry seed is valid → preserved.
    expect(claudeLane.model).toBe('claude-opus-4-8');

    for (const [index, ids] of optionIdsPerLane().entries()) {
      expect(ids).toContain(emitted[index].model);
    }
  });

  // -------------------------------------------------------------------------
  // The shared discovery cache and the estimator that replaced TURNS_PER_VENDOR
  // -------------------------------------------------------------------------

  it('reads the SHARED discovery cache instead of running its own discovery', () => {
    // Three wizard steps want the same vendor list. `discover()` is the raw
    // uncached call; going through it directly is the regression.
    expect(discoveryDouble.ensureDiscovered).toHaveBeenCalledTimes(1);
    expect(discoveryDouble.discover).not.toHaveBeenCalled();
  });

  it('bypasses the cache only for the explicit Refresh affordance', async () => {
    await fixture.componentInstance.refresh();

    expect(discoveryDouble.rediscover).toHaveBeenCalledTimes(1);
    expect(discoveryDouble.discover).not.toHaveBeenCalled();
  });

  /** The `~N` figure in the stats strip. */
  function estimatedTurns(): number {
    const strip = fixture.debugElement
      .queryAll(By.css('span'))
      .map(
        (element) => (element.nativeElement as HTMLElement).textContent ?? '',
      )
      .find((text) => text.trim().startsWith('~'));
    return Number.parseInt((strip ?? '').trim().slice(1), 10);
  }

  it('estimates council turns exactly as the deleted per-vendor map did', async () => {
    // council: laneCount * 2 + 1. Two lanes → 5. AC-1.4 extends to the
    // displayed estimate, so this number must not move.
    await addLane('Ollama Cloud');
    await addLane('Claude (Subscription)');

    expect(estimatedTurns()).toBe(5);
  });

  it('estimates forge and race turns unchanged at three per lane', () => {
    fixture.componentRef.setInput('move', 'forge');
    fixture.componentRef.setInput('selectedLanes', [
      CLAUDE_VENDOR.lane,
      OLLAMA_VENDOR.lane,
    ]);
    fixture.detectChanges();
    expect(estimatedTurns()).toBe(7);

    fixture.componentRef.setInput('move', 'race');
    fixture.detectChanges();
    expect(estimatedTurns()).toBe(7);
  });
});
