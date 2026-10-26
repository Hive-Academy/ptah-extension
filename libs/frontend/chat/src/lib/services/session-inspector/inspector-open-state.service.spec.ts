import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { InspectorOpenStateService } from './inspector-open-state.service';

describe('InspectorOpenStateService', () => {
  let closed: (event: { tabId: string }) => void;
  const unsubscribe = jest.fn();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            onTabClosed: (listener: typeof closed) => {
              closed = listener;
              return unsubscribe;
            },
          },
        },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('retains the compact/expanded boolean per tab and mode across consumers', () => {
    const state = TestBed.inject(InspectorOpenStateService);
    expect(state.dockedOpen('one', 'full', null)).toBe(true);
    state.setDocked('one', 'full', false);
    expect(
      TestBed.inject(InspectorOpenStateService).dockedOpen('one', 'full', true),
    ).toBe(false);
    expect(state.dockedOpen('two', 'full', null)).toBe(true);
    state.setDocked('one', 'full', true);
    expect(state.dockedOpen('one', 'full', false)).toBe(true);
  });

  it('forgets a closed tab so reusing its id starts with the default', () => {
    const state = TestBed.inject(InspectorOpenStateService);
    state.setDocked('one', 'full', false);
    closed({ tabId: 'one' });
    expect(state.dockedOpen('one', 'full', null)).toBe(true);
  });
});
