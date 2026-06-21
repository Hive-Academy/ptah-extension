import { Component, ChangeDetectionStrategy } from '@angular/core';

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
import { CanvasLayoutService } from '@ptah-extension/canvas';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
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
            handlePermissionResponse: jest.fn(),
            handleQuestionResponse: jest.fn(),
          },
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
