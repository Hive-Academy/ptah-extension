import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type { SkillSuggestionSummary } from '@ptah-extension/shared';

import { SkillSuggestionsViewComponent } from './skill-suggestions-view.component';
import { SkillSynthesisStateService } from '../../services/skill-synthesis-state.service';

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
  } as unknown as Partial<VSCodeService>;
}

function suggestion(
  overrides: Partial<SkillSuggestionSummary> = {},
): SkillSuggestionSummary {
  return {
    id: 'sg-1',
    name: 'scaffold-nest-module',
    description: 'Scaffold a NestJS feature module with tests',
    clusterSize: 3,
    technologyFingerprint: 'nestjs,jest',
    judgeScore: 8.2,
    memberSessionIds: ['a', 'b', 'c'],
    status: 'pending',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface StateStub {
  readonly suggestions: ReturnType<typeof signal<SkillSuggestionSummary[]>>;
  readonly suggestionsLoading: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<string | null>>;
  readonly refreshSuggestions: jest.Mock<Promise<void>, []>;
  readonly accept: jest.Mock<Promise<void>, [string]>;
  readonly dismiss: jest.Mock<Promise<void>, [string, string | undefined]>;
}

function makeStateStub(initial: SkillSuggestionSummary[] = []): StateStub {
  return {
    suggestions: signal<SkillSuggestionSummary[]>(initial),
    suggestionsLoading: signal<boolean>(false),
    error: signal<string | null>(null),
    refreshSuggestions: jest.fn(async () => undefined),
    accept: jest.fn(async () => undefined),
    dismiss: jest.fn(async () => undefined),
  };
}

function setup(opts: { isElectron?: boolean; state?: StateStub }) {
  const state = opts.state ?? makeStateStub();
  TestBed.configureTestingModule({
    imports: [SkillSuggestionsViewComponent],
    providers: [
      { provide: SkillSynthesisStateService, useValue: state },
      {
        provide: VSCodeService,
        useValue: vscodeServiceStub(opts.isElectron ?? true),
      },
    ],
  });
  const fixture = TestBed.createComponent(SkillSuggestionsViewComponent);
  fixture.detectChanges();
  return { fixture, state };
}

describe('SkillSuggestionsViewComponent', () => {
  it('shows the desktop-only notice and does not refresh in VS Code', () => {
    const { fixture, state } = setup({ isElectron: false });
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="suggestions-desktop-notice"]'),
    ).toBeTruthy();
    expect(el.querySelector('[data-testid="suggestions-view"]')).toBeNull();
    expect(state.refreshSuggestions).not.toHaveBeenCalled();
  });

  it('refreshes suggestions on init in Electron', () => {
    const { state } = setup({ isElectron: true });
    expect(state.refreshSuggestions).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no pending suggestions', () => {
    const { fixture } = setup({
      isElectron: true,
      state: makeStateStub([suggestion({ status: 'dismissed' })]),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="suggestions-empty"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="suggestions-card"]').length).toBe(
      0,
    );
  });

  it('renders a pending suggestion card with cluster size, fingerprint, and score', () => {
    const { fixture } = setup({
      isElectron: true,
      state: makeStateStub([suggestion()]),
    });
    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('[data-testid="suggestions-card"]');
    expect(cards.length).toBe(1);
    const text = cards[0].textContent ?? '';
    expect(text).toContain('scaffold-nest-module');
    expect(text).toContain('3 sessions');
    expect(text).toContain('nestjs,jest');
    expect(text).toContain('8.2');
  });

  it('calls accept with the suggestion id', async () => {
    const state = makeStateStub([suggestion()]);
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="suggestions-accept-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(state.accept).toHaveBeenCalledWith('sg-1');
  });

  it('dismisses through the modal forwarding an optional reason', async () => {
    const state = makeStateStub([suggestion()]);
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="suggestions-dismiss-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="suggestions-dismiss-modal"]',
      ),
    ).toBeTruthy();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="suggestions-dismiss-confirm"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(state.dismiss).toHaveBeenCalledWith('sg-1', undefined);
  });

  it('surfaces an error alert from state', () => {
    const state = makeStateStub();
    state.error.set('store-unavailable');
    const { fixture } = setup({ isElectron: true, state });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('store-unavailable');
  });
});
