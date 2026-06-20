import { TestBed, fakeAsync } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TribunalStateService } from '../services/tribunal-state.service';
import { TribunalSurfaceService } from '../services/tribunal-surface.service';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import {
  ConversationRegistry,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import { ScorecardComponent } from './scorecard.component';

@Component({
  standalone: true,
  imports: [ScorecardComponent],
  template: '<ptah-scorecard />',
})
class TestHostComponent {}

function makeStateStub(scores: unknown[]) {
  return {
    raceScores: () => scores,
    tiles: () => [],
    move: () => 'race',
    lanes: () => [],
    surfaceId: () => null,
    tribunalSessionId: () => null,
    phase: () => 'idle',
    vendorTileCount: () => 0,
    laneBindings: () => new Map(),
    conductorText: () => '',
    forgeDiffs: () => new Map(),
    streamingState: () => ({ events: new Map() }),
  };
}

describe('ScorecardComponent — parse-from-stream edge cases', () => {
  function configure(scores: unknown[]) {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        { provide: TribunalStateService, useValue: makeStateStub(scores) },
        {
          provide: TribunalSurfaceService,
          useValue: { streamingState: () => ({ events: new Map() }) },
        },
        {
          provide: AgentMonitorStore,
          useValue: {
            tick: jest.fn(),
            agentsForSession: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn().mockReturnValue([]) },
        },
        {
          provide: TabSessionBinding,
          useValue: { conversationForSurface: jest.fn().mockReturnValue(null) },
        },
        {
          provide: ConversationRegistry,
          useValue: { getRecord: jest.fn().mockReturnValue(null) },
        },
        {
          provide: StreamRouter,
          useValue: {
            onSurfaceCreated: jest.fn(),
            onSurfaceClosed: jest.fn(),
            routeStreamEventForSurface: jest.fn(),
          },
        },
        {
          provide: StreamingSurfaceRegistry,
          useValue: { register: jest.fn(), unregister: jest.fn() },
        },
      ],
    });
  }

  it('renders loading state when raceScores is empty (absent conductor data — no crash)', () => {
    configure([]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const host = fixture.debugElement.query(
      By.css('[data-testid="tribunal-scorecard"]'),
    );
    expect(host).toBeTruthy();
    const loadingDot = host.query(By.css('.loading'));
    expect(loadingDot).toBeTruthy();
  });

  it('does not throw with partial score data (null rank and verifyPassed)', () => {
    configure([
      { vendor: 'Codex', criteria: [], verifyPassed: null, rank: null },
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const host = fixture.debugElement.query(
      By.css('[data-testid="tribunal-scorecard"]'),
    );
    expect(host.query(By.css('.loading'))).toBeNull();
  });

  it('renders all vendor rows when scores are provided', fakeAsync(() => {
    configure([
      {
        vendor: 'Codex',
        criteria: [{ label: 'Quality', value: 'High' }],
        verifyPassed: true,
        rank: 1,
      },
      {
        vendor: 'Copilot',
        criteria: [{ label: 'Quality', value: 'Med' }],
        verifyPassed: false,
        rank: 2,
      },
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('tbody tr'));
    expect(rows).toHaveLength(2);
  }));

  it('renders verify pass indicator for verifyPassed=true without crashing', () => {
    configure([{ vendor: 'Codex', criteria: [], verifyPassed: true, rank: 1 }]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const verifyCell = fixture.debugElement.query(By.css('.text-success'));
    expect(verifyCell).toBeTruthy();
  });

  it('renders verify fail indicator for verifyPassed=false without crashing', () => {
    configure([
      { vendor: 'Codex', criteria: [], verifyPassed: false, rank: 1 },
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const failCell = fixture.debugElement.query(By.css('.text-error'));
    expect(failCell).toBeTruthy();
  });

  it('renders neutral dash for verifyPassed=null without crashing', () => {
    configure([
      { vendor: 'Codex', criteria: [], verifyPassed: null, rank: null },
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();
  });
});
