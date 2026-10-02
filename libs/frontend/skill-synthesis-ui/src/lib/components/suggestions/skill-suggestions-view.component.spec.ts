import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  SkillSuggestionDetail,
  SkillSuggestionSummary,
} from '@ptah-extension/shared';

import { SkillSuggestionsViewComponent } from './skill-suggestions-view.component';
import { SkillSynthesisStateService } from '../../services/skill-synthesis-state.service';
import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';

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
  readonly suggestionDetail: ReturnType<
    typeof signal<SkillSuggestionDetail | null>
  >;
  readonly suggestionDetailLoading: ReturnType<typeof signal<boolean>>;
  readonly refreshSuggestions: jest.Mock<Promise<void>, []>;
  readonly accept: jest.Mock<Promise<boolean>, [string]>;
  readonly dismiss: jest.Mock<Promise<void>, [string, string | undefined]>;
  readonly loadSuggestionDetail: jest.Mock<Promise<void>, [string | null]>;
  readonly clearSuggestionDetail: jest.Mock<void, []>;
  readonly updateSuggestion: jest.Mock<
    Promise<boolean>,
    [string, { name?: string; description?: string; body?: string }]
  >;
}

function makeStateStub(initial: SkillSuggestionSummary[] = []): StateStub {
  return {
    suggestions: signal<SkillSuggestionSummary[]>(initial),
    suggestionsLoading: signal<boolean>(false),
    error: signal<string | null>(null),
    suggestionDetail: signal<SkillSuggestionDetail | null>(null),
    suggestionDetailLoading: signal<boolean>(false),
    refreshSuggestions: jest.fn(async () => undefined),
    accept: jest.fn(async () => true),
    dismiss: jest.fn(async () => undefined),
    loadSuggestionDetail: jest.fn(async () => undefined),
    clearSuggestionDetail: jest.fn(() => undefined),
    updateSuggestion: jest.fn(async () => true),
  };
}

interface DiagnosticsStub {
  readonly refresh: jest.Mock<Promise<void>, []>;
}

function setup(opts: { isElectron?: boolean; state?: StateStub }) {
  const state = opts.state ?? makeStateStub();
  const diagnostics: DiagnosticsStub = {
    refresh: jest.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    imports: [SkillSuggestionsViewComponent],
    providers: [
      { provide: SkillSynthesisStateService, useValue: state },
      { provide: SkillDiagnosticsStateService, useValue: diagnostics },
      {
        provide: VSCodeService,
        useValue: vscodeServiceStub(opts.isElectron ?? true),
      },
    ],
  });
  const fixture = TestBed.createComponent(SkillSuggestionsViewComponent);
  fixture.detectChanges();
  return { fixture, state, diagnostics };
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

  it('refreshes the pipeline counts after a successful accept', async () => {
    const state = makeStateStub([suggestion()]);
    const { fixture, diagnostics } = setup({ isElectron: true, state });
    const comp = fixture.componentInstance as unknown as {
      onAccept(s: SkillSuggestionSummary): Promise<void>;
    };

    await comp.onAccept(suggestion());

    expect(diagnostics.refresh).toHaveBeenCalledTimes(1);
    // The diagnostics read must see the accepted skill, so it follows the accept.
    expect(diagnostics.refresh.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.accept.mock.invocationCallOrder[0],
    );
    expect(fixture.componentInstance.toast()).toEqual({
      message: 'Accepted "scaffold-nest-module".',
      kind: 'success',
    });
  });

  it('accepts from the review modal: success toast, modal closed, counts refreshed', async () => {
    const state = makeStateStub([suggestion()]);
    const { fixture, diagnostics } = setup({ isElectron: true, state });
    const view = fixture.componentInstance;
    const comp = view as unknown as {
      onAcceptFromModal(id: string, name: string): Promise<void>;
    };
    view.reviewId.set('sg-1');

    await comp.onAcceptFromModal('sg-1', 'scaffold-nest-module');

    expect(state.accept).toHaveBeenCalledWith('sg-1');
    expect(diagnostics.refresh).toHaveBeenCalledTimes(1);
    expect(view.toast()?.kind).toBe('success');
    expect(view.reviewId()).toBeNull();
  });

  it('a failed accept shows no success toast and does not refresh the counts', async () => {
    const state = makeStateStub([suggestion()]);
    state.accept.mockResolvedValue(false);
    state.error.set('accept-failed');
    const { fixture, diagnostics } = setup({ isElectron: true, state });
    const view = fixture.componentInstance;
    const comp = view as unknown as {
      onAccept(s: SkillSuggestionSummary): Promise<void>;
    };

    await comp.onAccept(suggestion());

    expect(state.accept).toHaveBeenCalledWith('sg-1');
    expect(diagnostics.refresh).not.toHaveBeenCalled();
    // Same error-toast pattern as a failed save: the state error, not "Accepted".
    expect(view.toast()).toEqual({ message: 'accept-failed', kind: 'error' });
  });

  it('a failed accept from the review modal leaves the modal open for a retry', async () => {
    const state = makeStateStub([suggestion()]);
    state.accept.mockResolvedValue(false);
    state.error.set('accept-failed');
    const { fixture, diagnostics } = setup({ isElectron: true, state });
    const view = fixture.componentInstance;
    const comp = view as unknown as {
      onAcceptFromModal(id: string, name: string): Promise<void>;
    };
    view.reviewId.set('sg-1');

    await comp.onAcceptFromModal('sg-1', 'scaffold-nest-module');

    expect(diagnostics.refresh).not.toHaveBeenCalled();
    expect(view.toast()?.kind).toBe('error');
    expect(view.reviewId()).toBe('sg-1');
    expect(state.clearSuggestionDetail).not.toHaveBeenCalled();
    expect(view.busyId()).toBeNull();
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

  it('exits edit mode with a success toast when the save persists', async () => {
    const state = makeStateStub([suggestion()]);
    state.updateSuggestion.mockResolvedValue(true);
    const { fixture } = setup({ isElectron: true, state });
    const comp = fixture.componentInstance;
    comp.editing.set(true);
    comp.editName.set('renamed-skill');
    comp.editDescription.set('Use when X');
    comp.editBody.set('## Steps\n1. do');

    await (
      comp as unknown as { onSaveEdit(id: string): Promise<void> }
    ).onSaveEdit('sg-1');

    expect(state.updateSuggestion).toHaveBeenCalledWith('sg-1', {
      name: 'renamed-skill',
      description: 'Use when X',
      body: '## Steps\n1. do',
    });
    expect(comp.editing()).toBe(false);
    expect(comp.toast()?.kind).toBe('success');
  });

  it('keeps edit mode open with an error toast when the save does not persist', async () => {
    const state = makeStateStub([suggestion()]);
    state.updateSuggestion.mockResolvedValue(false);
    state.error.set(
      'This suggestion is no longer pending — your edits were not saved.',
    );
    const { fixture } = setup({ isElectron: true, state });
    const comp = fixture.componentInstance;
    comp.editing.set(true);
    comp.editName.set('renamed-skill');
    comp.editDescription.set('Use when X');
    comp.editBody.set('## Steps\n1. do');

    await (
      comp as unknown as { onSaveEdit(id: string): Promise<void> }
    ).onSaveEdit('sg-1');

    expect(comp.editing()).toBe(true);
    expect(comp.toast()?.kind).toBe('error');
  });
});
