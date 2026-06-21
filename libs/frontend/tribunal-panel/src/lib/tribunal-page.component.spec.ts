import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { By } from '@angular/platform-browser';

type AskUserQuestionRequest = { id: string; sessionId: string };

jest.mock('gridstack/dist/angular', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackStub {
    grid: unknown = null;
  }
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackItemStub {}
  return {
    GridstackComponent: GridstackStub,
    GridstackItemComponent: GridstackItemStub,
    nodesCB: undefined,
  };
});
jest.mock('gridstack', () => ({ GridStack: class {} }));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CanvasLayoutService } from '@ptah-extension/canvas';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { TribunalPageComponent } from './tribunal-page.component';
import { TribunalStateService } from './services/tribunal-state.service';
import { TribunalSurfaceService } from './services/tribunal-surface.service';

describe('TribunalPageComponent — resume / reattach lifecycle', () => {
  let fixture: ComponentFixture<TribunalPageComponent>;
  let mockState: {
    tiles: jest.Mock;
    lanes: jest.Mock;
    laneBindings: jest.Mock;
    refreshSessionId: jest.Mock;
    endRun: jest.Mock;
    tribunalSessionId: jest.Mock;
  };
  let mockSurface: jest.Mocked<Pick<TribunalSurfaceService, 'teardown'>>;

  beforeEach(() => {
    mockState = {
      tiles: jest.fn().mockReturnValue([]),
      lanes: jest.fn().mockReturnValue([]),
      laneBindings: jest.fn().mockReturnValue(new Map()),
      refreshSessionId: jest.fn(),
      endRun: jest.fn(),
      tribunalSessionId: jest.fn().mockReturnValue(null),
    };
    mockSurface = {
      teardown: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        { provide: TribunalStateService, useValue: mockState },
        { provide: TribunalSurfaceService, useValue: mockSurface },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: jest.fn().mockReturnValue([]),
            questionRequests: jest.fn().mockReturnValue([]),
            hasSurfaceTargets: jest.fn().mockReturnValue(false),
            questionTargetTabsFor: jest.fn().mockReturnValue([]),
            handlePermissionResponse: jest.fn(),
            handleQuestionResponse: jest.fn(),
          },
        },
        {
          provide: TabManagerService,
          useValue: { tabs: signal([]).asReadonly() },
        },
        {
          provide: CanvasLayoutService,
          useValue: {
            containerWidth: jest.fn().mockReturnValue(0),
            containerHeight: jest.fn().mockReturnValue(0),
            computeLayout: jest
              .fn()
              .mockReturnValue({ cellHeight: 120, tiles: [] }),
            observe: jest.fn(),
          },
        },
      ],
    }).overrideComponent(TribunalPageComponent, {
      set: { template: '<div></div>', imports: [], providers: [] },
    });

    fixture = TestBed.createComponent(TribunalPageComponent);
    fixture.detectChanges();
  });

  it('refreshes the session id on first render (re-entry rehydrate)', () => {
    expect(mockState.refreshSessionId).toHaveBeenCalled();
  });

  it('navigating away (component destroy) does NOT tear down the surface', () => {
    fixture.destroy();

    expect(mockSurface.teardown).not.toHaveBeenCalled();
    expect(mockState.endRun).not.toHaveBeenCalled();
  });

  it('onCloseRun triggers state.endRun exactly once (user-initiated teardown)', () => {
    (
      fixture.componentInstance as unknown as { onCloseRun(): void }
    ).onCloseRun();

    expect(mockState.endRun).toHaveBeenCalledTimes(1);
  });
});

@Component({
  selector: 'ptah-tribunal-tile-host',
  standalone: true,
  template: `<ng-content />`,
})
class TileHostStub {
  readonly tile = input<unknown>();
  readonly label = input<unknown>();
  readonly status = input<unknown>();
  readonly focused = input(false);
}

@Component({
  selector: 'ptah-conductor-strip',
  standalone: true,
  template: `<div></div>`,
})
class ConductorStripStub {}

@Component({
  selector: 'ptah-vendor-card',
  standalone: true,
  template: `<div></div>`,
})
class VendorCardStub {
  readonly lane = input<unknown>();
  readonly tribunalSessionId = input('');
}

@Component({
  selector: 'ptah-question-card',
  standalone: true,
  template: `<div data-testid="question-card-stub"></div>`,
})
class QuestionCardStub {
  readonly request = input<AskUserQuestionRequest>();
}

@Component({
  selector: 'ptah-permission-request-card',
  standalone: true,
  template: `<div></div>`,
})
class PermissionRequestCardStub {
  readonly request = input<unknown>();
}

@Component({
  selector: 'ptah-tribunal-empty-state',
  standalone: true,
  template: `<div></div>`,
})
class EmptyStateStub {}

@Component({
  selector: 'ptah-tribunal-wizard',
  standalone: true,
  template: `<div></div>`,
})
class WizardStub {}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'gridstack',
  standalone: true,
  template: `<ng-content />`,
})
class GridstackPageStub {
  readonly options = input<unknown>();
  readonly changeCB = output<unknown>();
  grid: unknown = null;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'gridstack-item',
  standalone: true,
  template: `<ng-content />`,
})
class GridstackItemPageStub {
  readonly options = input<unknown>();
}

describe('TribunalPageComponent — surface question safety net', () => {
  function makeQuestion(id: string): AskUserQuestionRequest {
    return {
      id,
      sessionId: 'session-1',
      questions: [],
      timeoutAt: 0,
    } as unknown as AskUserQuestionRequest;
  }

  function configure(opts: {
    questions: AskUserQuestionRequest[];
    questionTargetTabsFor: (id: string) => readonly string[];
    tabs: { id: string }[];
  }) {
    const tile = {
      tileId: 'lane-1',
      kind: 'vendor' as const,
      laneId: 'lane-1',
      position: { x: 0, y: 0, w: 4, h: 6 },
    };

    TestBed.configureTestingModule({
      imports: [TribunalPageComponent],
      providers: [
        {
          provide: TribunalStateService,
          useValue: {
            tiles: jest.fn().mockReturnValue([tile]),
            lanes: jest.fn().mockReturnValue([]),
            laneBindings: jest.fn().mockReturnValue(new Map()),
            refreshSessionId: jest.fn(),
            endRun: jest.fn(),
            tribunalSessionId: jest.fn().mockReturnValue('session-1'),
          },
        },
        { provide: TribunalSurfaceService, useValue: { teardown: jest.fn() } },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: jest.fn().mockReturnValue([]),
            questionRequests: jest.fn().mockReturnValue(opts.questions),
            hasSurfaceTargets: jest.fn().mockReturnValue(false),
            questionTargetTabsFor: jest.fn(opts.questionTargetTabsFor),
            handlePermissionResponse: jest.fn(),
            handleQuestionResponse: jest.fn(),
          },
        },
        {
          provide: TabManagerService,
          useValue: { tabs: signal(opts.tabs).asReadonly() },
        },
        {
          provide: CanvasLayoutService,
          useValue: {
            containerWidth: jest.fn().mockReturnValue(0),
            containerHeight: jest.fn().mockReturnValue(0),
            computeLayout: jest
              .fn()
              .mockReturnValue({ cellHeight: 120, tiles: [] }),
            observe: jest.fn(),
          },
        },
      ],
    }).overrideComponent(TribunalPageComponent, {
      set: {
        imports: [
          GridstackPageStub,
          GridstackItemPageStub,
          TileHostStub,
          ConductorStripStub,
          VendorCardStub,
          QuestionCardStub,
          PermissionRequestCardStub,
          EmptyStateStub,
          WizardStub,
        ],
      },
    });

    const fixture = TestBed.createComponent(TribunalPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a question card when the question targets only the tribunal surface', () => {
    const fixture = configure({
      questions: [makeQuestion('q-1')],
      questionTargetTabsFor: () => ['surface-xyz'],
      tabs: [{ id: 'tab-a' }],
    });

    const cards = fixture.debugElement.queryAll(
      By.css('[data-testid="question-card-stub"]'),
    );
    expect(cards.length).toBe(1);
  });

  it('does NOT render a question card when the target is a real tab', () => {
    const fixture = configure({
      questions: [makeQuestion('q-2')],
      questionTargetTabsFor: () => ['tab-a'],
      tabs: [{ id: 'tab-a' }],
    });

    const cards = fixture.debugElement.queryAll(
      By.css('[data-testid="question-card-stub"]'),
    );
    expect(cards.length).toBe(0);
  });
});
