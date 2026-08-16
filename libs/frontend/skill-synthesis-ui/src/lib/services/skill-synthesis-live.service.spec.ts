import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_TYPES,
  type SkillSynthesisEventWire,
} from '@ptah-extension/shared';

import { SkillSynthesisLiveService } from './skill-synthesis-live.service';
import { SkillDiagnosticsStateService } from './skill-diagnostics-state.service';
import { SkillSynthesisStateService } from './skill-synthesis-state.service';

function makeDiagnosticsStub(): jest.Mocked<
  Pick<SkillDiagnosticsStateService, 'pushLiveEvent'>
> {
  return {
    pushLiveEvent: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<SkillDiagnosticsStateService, 'pushLiveEvent'>
  >;
}

type SkillStateStub = jest.Mocked<
  Pick<
    SkillSynthesisStateService,
    'refreshSuggestions' | 'refreshCandidates' | 'loadStats' | 'refreshDigest'
  >
>;

function makeSkillStateStub(): SkillStateStub {
  return {
    refreshSuggestions: jest.fn(async () => undefined),
    refreshCandidates: jest.fn(async () => undefined),
    loadStats: jest.fn(async () => undefined),
    refreshDigest: jest.fn(async () => undefined),
  } as unknown as SkillStateStub;
}

function event(
  partial: Partial<SkillSynthesisEventWire> &
    Pick<SkillSynthesisEventWire, 'kind'>,
): SkillSynthesisEventWire {
  return {
    timestamp: 1_700_000_000_000,
    ...partial,
  } as SkillSynthesisEventWire;
}

describe('SkillSynthesisLiveService', () => {
  function setup() {
    const diagnostics = makeDiagnosticsStub();
    const skillState = makeSkillStateStub();
    TestBed.configureTestingModule({
      providers: [
        SkillSynthesisLiveService,
        { provide: SkillDiagnosticsStateService, useValue: diagnostics },
        { provide: SkillSynthesisStateService, useValue: skillState },
      ],
    });
    const svc = TestBed.inject(SkillSynthesisLiveService);
    return { svc, diagnostics, skillState };
  }

  function send(
    svc: SkillSynthesisLiveService,
    ev: SkillSynthesisEventWire,
  ): void {
    svc.handleMessage({
      type: MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
      payload: { event: ev },
    });
  }

  it('ignores non-matching message types', () => {
    const { svc, diagnostics } = setup();
    svc.handleMessage({ type: 'something:else', payload: { event: {} } });
    expect(diagnostics.pushLiveEvent).not.toHaveBeenCalled();
    expect(svc.activity()).toBeNull();
  });

  it('ignores a payload with no event', () => {
    const { svc, diagnostics } = setup();
    svc.handleMessage({
      type: MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
      payload: undefined,
    });
    expect(diagnostics.pushLiveEvent).not.toHaveBeenCalled();
  });

  it('records every event via pushLiveEvent', () => {
    const { svc, diagnostics } = setup();
    const ev = event({ kind: 'manual-run' });
    send(svc, ev);
    expect(diagnostics.pushLiveEvent).toHaveBeenCalledWith(ev);
  });

  it('curator-pass-start sets the analyzing activity label', () => {
    const { svc } = setup();
    send(svc, event({ kind: 'curator-pass-start' }));
    expect(svc.activity()).toBe('Curator analyzing candidates…');
  });

  it('curator-pass with suggestionsCreated>0 refreshes suggestions and clears activity', () => {
    const { svc, skillState } = setup();
    svc.activity.set('Curator analyzing candidates…');
    send(
      svc,
      event({ kind: 'curator-pass', stats: { suggestionsCreated: 2 } }),
    );
    expect(svc.activity()).toBeNull();
    expect(skillState.refreshSuggestions).toHaveBeenCalledTimes(1);
    expect(skillState.loadStats).toHaveBeenCalledTimes(1);
  });

  it('curator-pass with no new suggestions still loads stats but not suggestions', () => {
    const { svc, skillState } = setup();
    send(
      svc,
      event({ kind: 'curator-pass', stats: { suggestionsCreated: 0 } }),
    );
    expect(skillState.refreshSuggestions).not.toHaveBeenCalled();
    expect(skillState.loadStats).toHaveBeenCalledTimes(1);
  });

  it('backfill-progress sets the N/M embedding label', () => {
    const { svc } = setup();
    send(
      svc,
      event({ kind: 'backfill-progress', stats: { done: 120, total: 207 } }),
    );
    expect(svc.activity()).toBe('Embedding candidates 120/207…');
  });

  it('backfill-complete clears activity and refreshes candidates + stats', () => {
    const { svc, skillState } = setup();
    svc.activity.set('Embedding candidates 1/2…');
    send(svc, event({ kind: 'backfill-complete', stats: { count: 5 } }));
    expect(svc.activity()).toBeNull();
    expect(skillState.refreshCandidates).toHaveBeenCalledTimes(1);
    expect(skillState.loadStats).toHaveBeenCalledTimes(1);
  });

  it('analyze-run loads stats but does NOT refresh candidates', () => {
    const { svc, skillState } = setup();
    send(svc, event({ kind: 'analyze-run' }));
    expect(skillState.loadStats).toHaveBeenCalledTimes(1);
    expect(skillState.refreshCandidates).not.toHaveBeenCalled();
  });

  /**
   * B4.5.2 — nudges ride THIS broadcast.
   *
   * The weekly digest is a pull; the only thing the push has to say is that the
   * tables underneath it moved. These tests pin which event kinds mean that,
   * which ones deliberately do not, and that a burst costs one sweep rather
   * than one per event — a full digest sweep reads a week of sessions, so the
   * debounce is a cost control, not a cosmetic detail.
   *
   * No new event kind and no second notification channel were added. If either
   * ever appears, the first of these tests is where it will be noticed.
   */
  describe('weekly digest nudges', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    /** Advance past the debounce window and let the queued refresh run. */
    function settle(): void {
      jest.advanceTimersByTime(5_000);
    }

    it.each([
      'analyze-run',
      'curator-pass',
      'backfill-complete',
      'edit-then-test',
    ] as const)('refreshes the digest after a %s event', (kind) => {
      const { svc, skillState } = setup();
      send(svc, event({ kind }));
      settle();
      expect(skillState.refreshDigest).toHaveBeenCalledTimes(1);
    });

    it.each(['ineligible', 'rate-limited', 'error'] as const)(
      'does NOT re-sweep after a %s event',
      (kind) => {
        // These report that nothing was recorded, so a sweep would re-derive
        // the digest already on screen at the cost of a week-long scan.
        const { svc, skillState } = setup();
        send(svc, event({ kind }));
        settle();
        expect(skillState.refreshDigest).not.toHaveBeenCalled();
      },
    );

    it('coalesces a burst of invalidating events into ONE sweep', () => {
      const { svc, skillState } = setup();
      send(svc, event({ kind: 'analyze-run' }));
      send(svc, event({ kind: 'edit-then-test' }));
      send(svc, event({ kind: 'curator-pass', stats: {} }));
      expect(skillState.refreshDigest).not.toHaveBeenCalled();

      settle();
      expect(skillState.refreshDigest).toHaveBeenCalledTimes(1);
    });

    it('sweeps again for a later burst rather than only once per session', () => {
      const { svc, skillState } = setup();
      send(svc, event({ kind: 'analyze-run' }));
      settle();
      send(svc, event({ kind: 'analyze-run' }));
      settle();
      expect(skillState.refreshDigest).toHaveBeenCalledTimes(2);
    });

    it('still does the per-kind work it did before the nudge was added', () => {
      // The nudge is scheduled alongside the existing switch, not instead of
      // it: a kind that both invalidates the digest and refreshes something
      // else must keep doing both.
      const { svc, skillState } = setup();
      send(svc, event({ kind: 'backfill-complete', stats: { count: 2 } }));
      settle();
      expect(skillState.refreshCandidates).toHaveBeenCalledTimes(1);
      expect(skillState.loadStats).toHaveBeenCalledTimes(1);
      expect(skillState.refreshDigest).toHaveBeenCalledTimes(1);
    });
  });
});
