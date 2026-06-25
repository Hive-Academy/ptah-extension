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

function makeSkillStateStub(): jest.Mocked<
  Pick<
    SkillSynthesisStateService,
    'refreshSuggestions' | 'refreshCandidates' | 'loadStats'
  >
> {
  return {
    refreshSuggestions: jest.fn(async () => undefined),
    refreshCandidates: jest.fn(async () => undefined),
    loadStats: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<
    Pick<
      SkillSynthesisStateService,
      'refreshSuggestions' | 'refreshCandidates' | 'loadStats'
    >
  >;
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
});
