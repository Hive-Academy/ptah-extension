/**
 * The rail's job is to say only what the derivation actually established.
 *
 * The tests that matter here are the negative ones: an `unavailable` progress
 * value must NOT paint a four-step pending pipeline (AC-4.5 / R1), and no more
 * than one step may ever read as running (AC-4.2). Both are asserted against
 * `TribunalProgress` fixtures — no live run is involved (R10).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { RelayPhaseRailComponent } from './relay-phase-rail.component';
import type {
  RelayPhase,
  RelayPhaseStatus,
  RelayRole,
  TribunalProgress,
  VendorLane,
} from '../types/tribunal-ui.types';

const DELIVERABLES: Record<RelayRole, string> = {
  plan: 'task-description.md',
  architect: 'implementation-plan.md',
  implement: 'batches.md',
  review: 'code-logic-review.md',
};

function phase(
  role: RelayRole,
  status: RelayPhaseStatus,
  overrides: Partial<RelayPhase> = {},
): RelayPhase {
  return {
    role,
    deliverable: DELIVERABLES[role],
    laneId: `${role}-lane`,
    status,
    ...overrides,
  };
}

function relay(
  statuses: readonly RelayPhaseStatus[],
  runningIndex: number | null,
  overrides: readonly Partial<RelayPhase>[] = [],
): TribunalProgress {
  const roles: readonly RelayRole[] = [
    'plan',
    'architect',
    'implement',
    'review',
  ];
  return {
    kind: 'relay',
    phases: roles.map((role, i) =>
      phase(role, statuses[i], overrides[i] ?? {}),
    ),
    runningIndex,
  };
}

function lane(laneId: string, displayName: string): VendorLane {
  return { laneId, family: 'codex', displayName, cli: 'codex' };
}

describe('RelayPhaseRailComponent', () => {
  let fixture: ComponentFixture<RelayPhaseRailComponent>;
  let openFile: jest.Mock;

  function render(
    progress: TribunalProgress,
    opts: { lanes?: VendorLane[]; specTaskId?: string | null } = {},
  ): void {
    fixture = TestBed.createComponent(RelayPhaseRailComponent);
    fixture.componentRef.setInput('progress', progress);
    fixture.componentRef.setInput('lanes', opts.lanes ?? []);
    fixture.componentRef.setInput('specTaskId', opts.specTaskId ?? null);
    fixture.detectChanges();
  }

  function steps(): HTMLElement[] {
    return fixture.debugElement
      .queryAll(By.css('[data-testid="tribunal-phase-step"]'))
      .map((el) => el.nativeElement as HTMLElement);
  }

  function statuses(): (string | null)[] {
    return steps().map((el) => el.getAttribute('data-status'));
  }

  beforeEach(() => {
    openFile = jest.fn().mockResolvedValue({ isSuccess: () => true });
    TestBed.configureTestingModule({
      imports: [RelayPhaseRailComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { openFile } },
        { provide: VSCodeService, useValue: { isElectron: false } },
      ],
    });
  });

  it('renders the four phases in pipeline order with their deliverables (AC-4.1)', () => {
    render(relay(['complete', 'complete', 'pending', 'pending'], 2));

    const labels = steps().map((el) => el.getAttribute('data-role'));
    expect(labels).toEqual(['plan', 'architect', 'implement', 'review']);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Plan');
    expect(text).toContain('Architect');
    expect(text).toContain('Implement');
    expect(text).toContain('Review');
    expect(text).toContain('task-description.md');
    expect(text).toContain('code-logic-review.md');
  });

  it('labels each step with its assigned lane display name (AC-4.1)', () => {
    render(relay(['pending', 'pending', 'pending', 'pending'], null), {
      lanes: [lane('plan-lane', 'Codex GPT-5'), lane('review-lane', 'Cursor')],
    });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Codex GPT-5');
    expect(text).toContain('Cursor');
  });

  it('marks exactly one step running, from runningIndex alone (AC-4.2)', () => {
    render(relay(['complete', 'pending', 'pending', 'pending'], 1));

    expect(statuses()).toEqual(['complete', 'running', 'pending', 'pending']);
    expect(statuses().filter((s) => s === 'running')).toHaveLength(1);
  });

  it('never shows a running step when runningIndex is null', () => {
    render(relay(['complete', 'failed', 'pending', 'pending'], null));

    expect(statuses()).toEqual(['complete', 'failed', 'pending', 'pending']);
  });

  it('keeps a delivered phase complete even if runningIndex points at it', () => {
    // `complete` is a file on disk; `running` is a claim about right now. A
    // phase whose deliverable exists must not read as still working on it.
    render(relay(['complete', 'pending', 'pending', 'pending'], 0));

    expect(statuses()[0]).toBe('complete');
  });

  it('renders the "phase progress unavailable" arm, NOT an all-pending pipeline (AC-4.5)', () => {
    render({
      kind: 'unavailable',
      reason: 'No spec folder was allocated for this run.',
    });

    expect(steps()).toHaveLength(0);
    const unavailable = fixture.debugElement.query(
      By.css('[data-testid="tribunal-phase-unavailable"]'),
    );
    expect(unavailable).not.toBeNull();
    expect((unavailable.nativeElement as HTMLElement).textContent).toContain(
      'No spec folder was allocated for this run.',
    );
  });

  it('renders nothing at all for a flat move', () => {
    render({ kind: 'none' });

    expect(steps()).toHaveLength(0);
    expect(
      fixture.debugElement.query(
        By.css('[data-testid="tribunal-phase-unavailable"]'),
      ),
    ).toBeNull();
  });

  it('shows the reassignment instead of silently swapping the lane name (AC-4.4)', () => {
    render(
      relay(['complete', 'pending', 'pending', 'pending'], 1, [
        {},
        { laneId: 'spare-lane', reassignedFromLaneId: 'architect-lane' },
      ]),
      {
        lanes: [
          lane('architect-lane', 'Copilot'),
          lane('spare-lane', 'Cursor'),
        ],
      },
    );

    const reassigned = fixture.debugElement.query(
      By.css('[data-testid="tribunal-phase-reassigned"]'),
    );
    expect(reassigned).not.toBeNull();
    expect((reassigned.nativeElement as HTMLElement).textContent).toContain(
      'Reassigned from Copilot',
    );
    // The live lane is still named — the reassignment is additive, not a swap.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Cursor',
    );
  });

  it('makes the deliverable openable under the run spec folder (AC-4.4)', () => {
    render(relay(['complete', 'pending', 'pending', 'pending'], null), {
      specTaskId: 'TASK_2026_237',
    });

    const link = fixture.debugElement.query(
      By.css('[data-testid="tribunal-phase-deliverable-link"] span'),
    );
    (link.nativeElement as HTMLElement).click();

    expect(openFile).toHaveBeenCalledWith(
      '.ptah/specs/TASK_2026_237/task-description.md',
    );
  });

  it('names but does not linkify the deliverable when no spec folder exists', () => {
    render(relay(['pending', 'pending', 'pending', 'pending'], null), {
      specTaskId: null,
    });

    expect(
      fixture.debugElement.queryAll(
        By.css('[data-testid="tribunal-phase-deliverable-link"]'),
      ),
    ).toHaveLength(0);
    const names = fixture.debugElement.queryAll(
      By.css('[data-testid="tribunal-phase-deliverable-name"]'),
    );
    expect(names).toHaveLength(4);
    expect((names[0].nativeElement as HTMLElement).textContent).toContain(
      'task-description.md',
    );
  });

  it('falls back to the laneId when the roster does not know the lane', () => {
    render(relay(['pending', 'pending', 'pending', 'pending'], null));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'plan-lane',
    );
  });

  it('says so when a phase has no lane at all', () => {
    render(
      relay(['pending', 'pending', 'pending', 'pending'], null, [
        { laneId: null },
      ]),
    );

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No lane assigned',
    );
  });
});
