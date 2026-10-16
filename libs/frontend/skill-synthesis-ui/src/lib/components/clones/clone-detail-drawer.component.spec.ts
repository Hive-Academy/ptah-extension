import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AgentOutcomeSignals, CloneSummary } from '@ptah-extension/shared';

import {
  CloneBodySaveRequest,
  CloneDetailDrawerComponent,
} from './clone-detail-drawer.component';

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 10,
    successRate: 0.8,
    lastEnhancedAt: null,
    historyCount: 2,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
    ...overrides,
  };
}

type Fixture = ComponentFixture<CloneDetailDrawerComponent>;

interface Options {
  readonly canEditBody?: boolean;
  readonly body?: string | null;
  readonly bodySaving?: boolean;
  readonly busy?: boolean;
}

async function setup(options: Options = {}): Promise<Fixture> {
  await TestBed.configureTestingModule({
    imports: [CloneDetailDrawerComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(CloneDetailDrawerComponent);
  fixture.componentRef.setInput('clone', clone());
  fixture.componentRef.setInput('body', options.body ?? '# live body');
  fixture.componentRef.setInput('canEditBody', options.canEditBody ?? false);
  fixture.componentRef.setInput('bodySaving', options.bodySaving ?? false);
  fixture.componentRef.setInput('busy', options.busy ?? false);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const find = (fixture: Fixture, testid: string): HTMLElement | null =>
  fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

const require_ = (fixture: Fixture, testid: string): HTMLElement => {
  const el = find(fixture, testid);
  expect(el).not.toBeNull();
  return el as HTMLElement;
};

async function enterEditMode(fixture: Fixture): Promise<void> {
  (require_(fixture, 'drawer-body-edit-btn') as HTMLButtonElement).click();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('CloneDetailDrawerComponent — body edit mode', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT render the Edit affordance when canEditBody() is false', async () => {
    const fixture = await setup({ canEditBody: false });

    expect(find(fixture, 'drawer-body-edit-btn')).toBeNull();
    expect(find(fixture, 'drawer-body')).not.toBeNull();
  });

  it('renders the Edit affordance as a real button when canEditBody() is true', async () => {
    const fixture = await setup({ canEditBody: true });
    const button = require_(fixture, 'drawer-body-edit-btn');

    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toContain('deep-research');
  });

  it('disables the Edit affordance while another action is in flight', async () => {
    const fixture = await setup({ canEditBody: true, busy: true });

    expect(
      (require_(fixture, 'drawer-body-edit-btn') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('REPLACES the markdown render with the editor in edit mode', async () => {
    const fixture = await setup({ canEditBody: true });
    expect(find(fixture, 'drawer-body')).not.toBeNull();

    await enterEditMode(fixture);

    // One body on screen, never two: the read-only block is gone, not hidden.
    expect(find(fixture, 'drawer-body')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).toBeNull();
    expect(find(fixture, 'clone-body-editor')).not.toBeNull();
  });

  it('seeds the editor from the loaded body', async () => {
    const fixture = await setup({ canEditBody: true, body: '# seeded here' });
    await enterEditMode(fixture);

    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('# seeded here');
  });

  it('emits bodySaved with the entry and the edited text on Save', async () => {
    const fixture = await setup({ canEditBody: true });
    const requests: CloneBodySaveRequest[] = [];
    fixture.componentInstance.bodySaved.subscribe((r) => requests.push(r));

    await enterEditMode(fixture);
    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (require_(fixture, 'clone-body-editor-save') as HTMLButtonElement).click();

    expect(requests).toHaveLength(1);
    expect(requests[0].body).toBe('# edited');
    expect(requests[0].clone.slug).toBe('deep-research');
  });

  it('emits nothing on Cancel and restores the read-only render', async () => {
    const fixture = await setup({ canEditBody: true });
    const requests: CloneBodySaveRequest[] = [];
    fixture.componentInstance.bodySaved.subscribe((r) => requests.push(r));

    await enterEditMode(fixture);
    (
      require_(fixture, 'clone-body-editor-cancel') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(requests).toEqual([]);
    expect(find(fixture, 'clone-body-editor')).toBeNull();
    expect(find(fixture, 'drawer-body')).not.toBeNull();
    expect(find(fixture, 'drawer-body-edit-btn')).not.toBeNull();
  });

  it('stays in edit mode when a save fails and the body never changes', async () => {
    const fixture = await setup({ canEditBody: true });

    await enterEditMode(fixture);
    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (require_(fixture, 'clone-body-editor-save') as HTMLButtonElement).click();

    // The view flips bodySaving on and back off without the body changing.
    fixture.componentRef.setInput('bodySaving', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('bodySaving', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find(fixture, 'clone-body-editor')).not.toBeNull();
    expect(
      (require_(fixture, 'clone-body-editor-textarea') as HTMLTextAreaElement)
        .value,
    ).toBe('# edited');
  });

  it('leaves edit mode once the reloaded body matches what was saved', async () => {
    const fixture = await setup({ canEditBody: true });

    await enterEditMode(fixture);
    const textarea = require_(
      fixture,
      'clone-body-editor-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (require_(fixture, 'clone-body-editor-save') as HTMLButtonElement).click();

    fixture.componentRef.setInput('body', '# edited');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find(fixture, 'clone-body-editor')).toBeNull();
    expect(find(fixture, 'drawer-body')).not.toBeNull();
  });

  it('drops edit mode when the drawer switches to a different entry', async () => {
    const fixture = await setup({ canEditBody: true });
    await enterEditMode(fixture);
    expect(find(fixture, 'clone-body-editor')).not.toBeNull();

    fixture.componentRef.setInput('clone', clone({ slug: 'other-entry' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(find(fixture, 'clone-body-editor')).toBeNull();
  });
});

describe('CloneDetailDrawerComponent — outcome signals', () => {
  afterEach(() => TestBed.resetTestingModule());

  function signals(
    overrides: Partial<AgentOutcomeSignals> = {},
  ): AgentOutcomeSignals {
    return {
      slug: 'planner',
      windowDays: 30,
      runCount: 5,
      delivered: { numerator: 4, denominator: 5 },
      reviewPass: { numerator: 3, denominator: 4 },
      avgReviseRounds: 1.5,
      topFailureClass: 'timeout',
      ...overrides,
    };
  }

  async function render(
    entry: CloneSummary,
    outcomeSignals: AgentOutcomeSignals | null = null,
    outcomeStatus:
      'loading' | 'ready' | 'unavailable' | 'not-persistent' = 'ready',
  ): Promise<Fixture> {
    await TestBed.configureTestingModule({
      imports: [CloneDetailDrawerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(CloneDetailDrawerComponent);
    fixture.componentRef.setInput('clone', entry);
    fixture.componentRef.setInput('body', '# live body');
    fixture.componentRef.setInput('outcomeSignals', outcomeSignals);
    fixture.componentRef.setInput('outcomeStatus', outcomeStatus);
    fixture.componentRef.setInput(
      'outcomeWindowDays',
      outcomeSignals === null ? null : 30,
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('keeps Success on a skill drawer', async () => {
    const fixture = await render(
      clone({ kind: 'skill', invocationCount: 4, successRate: 0.5 }),
    );
    expect(find(fixture, 'clone-metric-success')?.textContent?.trim()).toBe(
      '50%',
    );
    expect(find(fixture, 'clone-metric-outcome-delivered')).toBeNull();
    expect(find(fixture, 'drawer-scorecard')).toBeNull();
  });

  it('keeps Success on a command drawer', async () => {
    const fixture = await render(
      clone({ kind: 'command', invocationCount: 4, successRate: 0.25 }),
    );
    expect(find(fixture, 'clone-metric-success')?.textContent?.trim()).toBe(
      '25%',
    );
    expect(find(fixture, 'clone-metric-outcome-empty')).toBeNull();
  });

  it('drops Success on an agent drawer and keeps the other metrics and the scorecard', async () => {
    const fixture = await render(
      clone({
        kind: 'agent',
        slug: 'planner',
        invocationCount: 7,
        successRate: 1,
        lastEnhancedAt: Date.now() - 3 * 60 * 60_000,
        historyCount: 3,
      }),
      signals(),
    );
    expect(find(fixture, 'clone-metric-success')).toBeNull();
    expect(find(fixture, 'clone-metric-invocations')?.textContent?.trim()).toBe(
      '7',
    );
    expect(
      find(fixture, 'clone-metric-last-enhanced')?.textContent?.trim(),
    ).toBe('3h ago');
    expect(find(fixture, 'clone-metric-history')?.textContent?.trim()).toBe(
      '3',
    );
    expect(
      find(fixture, 'clone-metric-outcome-delivered')?.textContent?.trim(),
    ).toBe('80% (4/5)');
    expect(
      find(fixture, 'clone-metric-outcome-window')?.textContent?.trim(),
    ).toBe('(last 30 days)');
    expect(find(fixture, 'drawer-scorecard')).toBeTruthy();
    expect(find(fixture, 'scorecard-badge')).toBeTruthy();
  });

  it('shows different signals for two agents', async () => {
    const planner = await render(
      clone({ kind: 'agent', slug: 'planner', successRate: 1 }),
      signals({ slug: 'planner' }),
    );
    expect(
      find(planner, 'clone-metric-outcome-delivered')?.textContent?.trim(),
    ).toBe('80% (4/5)');
    expect(
      find(planner, 'clone-metric-outcome-failure')?.textContent?.trim(),
    ).toBe('timeout');
    expect(find(planner, 'clone-metric-success')).toBeNull();

    TestBed.resetTestingModule();

    const reviewer = await render(
      clone({ kind: 'agent', slug: 'reviewer', successRate: 1 }),
      signals({
        slug: 'reviewer',
        runCount: 2,
        delivered: { numerator: 1, denominator: 2 },
        reviewPass: { numerator: 0, denominator: 0 },
        avgReviseRounds: null,
        topFailureClass: 'auth',
      }),
    );
    expect(
      find(reviewer, 'clone-metric-outcome-delivered')?.textContent?.trim(),
    ).toBe('50% (1/2)');
    expect(
      find(reviewer, 'clone-metric-outcome-review')?.textContent?.trim(),
    ).toBe('not reviewed yet');
    expect(find(reviewer, 'clone-metric-outcome-revise')).toBeNull();
    expect(
      find(reviewer, 'clone-metric-outcome-failure')?.textContent?.trim(),
    ).toBe('auth');
    expect(find(reviewer, 'clone-metric-success')).toBeNull();
  });

  it('says no data yet for an agent with no outcome record', async () => {
    const fixture = await render(
      clone({
        kind: 'agent',
        slug: 'planner',
        invocationCount: 0,
        successRate: 0,
        lastEnhancedAt: null,
        historyCount: 0,
      }),
    );
    expect(find(fixture, 'drawer-unused')).toBeNull();
    expect(find(fixture, 'clone-metric-success')).toBeNull();
    expect(
      find(fixture, 'clone-metric-outcome-empty')?.textContent?.trim(),
    ).toBe('no data yet');
    expect(find(fixture, 'drawer-scorecard')).toBeTruthy();
  });

  it('shows loading while the first drawer outcome read is pending', async () => {
    const fixture = await render(
      clone({ kind: 'agent', slug: 'planner' }),
      null,
      'loading',
    );
    expect(find(fixture, 'clone-metric-outcome-loading')).not.toBeNull();
    expect(find(fixture, 'clone-metric-outcome-empty')).toBeNull();
  });

  it('shows unavailable without replacing existing drawer figures', async () => {
    const fixture = await render(
      clone({ kind: 'agent', slug: 'planner' }),
      signals(),
      'unavailable',
    );
    expect(find(fixture, 'clone-metric-outcome-delivered')).not.toBeNull();
    expect(find(fixture, 'drawer-outcome-unavailable')?.textContent).toContain(
      'Outcome data unavailable',
    );
  });

  it('shows a non-durable host note in the drawer', async () => {
    const fixture = await render(
      clone({ kind: 'agent', slug: 'planner' }),
      null,
      'not-persistent',
    );
    expect(
      find(fixture, 'drawer-outcome-not-persistent')?.textContent,
    ).toContain('not stored durably');
  });
});
