import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import {
  AgentLaneStatsComponent,
  type AgentLaneStatsView,
} from './agent-lane-stats.component';

const empty: AgentLaneStatsView = {
  model: null,
  contextTokens: null,
  tokens: null,
  tokensPartial: false,
  tokensTitle: null,
  cost: undefined,
  costPartial: false,
  cache: null,
  cacheTitle: null,
};

function render(stats: Partial<AgentLaneStatsView>): HTMLElement {
  TestBed.configureTestingModule({
    imports: [AgentLaneStatsComponent],
    providers: [
      {
        provide: ModelStateService,
        useValue: {
          availableModels: signal([
            { id: 'claude-opus-4-7', name: 'Opus 4.7' },
          ]),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AgentLaneStatsComponent);
  fixture.componentRef.setInput('stats', { ...empty, ...stats });
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (host: HTMLElement, id: string): string | undefined =>
  host.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();

describe('AgentLaneStatsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is a labelled group', () => {
    const group = render({}).querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Agent usage');
  });

  it('shows the model display name and hides the chip without a model', () => {
    expect(text(render({ model: 'claude-opus-4-7' }), 'lane-stats-model')).toBe(
      'Opus 4.7',
    );
    TestBed.resetTestingModule();
    expect(
      render({}).querySelector('[data-testid="lane-stats-model"]'),
    ).toBeNull();
  });

  it('renders — for every missing figure, never 0', () => {
    const host = render({});
    expect(text(host, 'lane-stats-context')).toBe('—');
    expect(text(host, 'lane-stats-tokens')).toBe('—');
    expect(text(host, 'lane-stats-cost')).toBe('—');
  });

  it('formats context and tokens, with a lower-bound prefix when partial', () => {
    const host = render({
      contextTokens: 12_400,
      tokens: 1_500,
      tokensPartial: true,
      tokensTitle: 'in 1,000 · out 500',
    });
    expect(text(host, 'lane-stats-context')).toBe('12.4k');
    expect(text(host, 'lane-stats-tokens')).toBe('≥ 1.5k');
    const tokensChip = host.querySelector(
      '[data-testid="lane-stats-tokens"]',
    )?.parentElement;
    expect(tokensChip?.getAttribute('title')).toBe('in 1,000 · out 500');
  });

  it.each([undefined, null])('uses a muted accessible dash for missing cost %s', cost => {
    const root = render({ cost });
    const value = root.querySelector('[data-testid="lane-stats-cost"]');
    expect(value?.textContent?.trim()).toBe('—');
    expect(value?.getAttribute('aria-label')).toBe('Cost unavailable');
    expect(value?.classList.contains('text-base-content-muted')).toBe(true);
  });

  it('prefixes a partial known cost', () => {
    const cost = text(
      render({ cost: 0.25, costPartial: true }),
      'lane-stats-cost',
    );
    expect(cost).toContain('≥');
    expect(cost).toContain('$0.25');
  });

  it('shows the cache chip only when the cache state is known', () => {
    const host = render({ cache: 'warm', cacheTitle: 'Cache warm for 4m' });
    expect(text(host, 'lane-stats-cache')).toBe('warm');
    expect(
      host
        .querySelector('[data-testid="lane-stats-cache"]')
        ?.parentElement?.getAttribute('title'),
    ).toBe('Cache warm for 4m');
    TestBed.resetTestingModule();
    expect(
      render({}).querySelector('[data-testid="lane-stats-cache"]'),
    ).toBeNull();
  });

  it('never tints value text with an opacity shade (D3)', () => {
    const host = render({
      model: 'claude-opus-4-7',
      contextTokens: 10,
      tokens: 10,
      cache: 'cold',
    });
    const values = host.querySelectorAll('[data-testid^="lane-stats-"]');
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value.className).not.toMatch(/\/70\b/));
  });
});
