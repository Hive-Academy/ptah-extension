import {
  Component,
  signal,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranscriptPrependAnchorDirective } from './transcript-prepend-anchor.directive';

@Component({
  imports: [TranscriptPrependAnchorDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div
      #root
      [ptahTranscriptPrependAnchor]="messages()"
      [tabId]="tabId()"
      [sessionId]="sessionId()"
      [active]="active()"
      [historyReplaying]="historyReplaying()"
      [pinnedToBottom]="pinnedToBottom()"
    >
      @for (message of messages(); track message.id) {
        @if (message.id !== hiddenId()) {
          <div [attr.data-ptah-transcript-message-id]="message.id"></div>
        }
      }
    </div>
  `,
})
class PrependAnchorHostComponent {
  readonly messages = signal<readonly { readonly id: string }[]>([
    { id: 'current-1' },
    { id: 'current-2' },
  ]);
  readonly tabId = signal('tab-1');
  readonly sessionId = signal<string | null>('session-1');
  readonly active = signal(true);
  readonly historyReplaying = signal(false);
  readonly pinnedToBottom = signal(false);
  readonly hiddenId = signal<string | null>(null);
  readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
}

interface Harness {
  readonly fixture: ReturnType<
    typeof TestBed.createComponent<PrependAnchorHostComponent>
  >;
  readonly component: PrependAnchorHostComponent;
  readonly root: HTMLElement;
  readonly writes: jest.Mock<void, [number]>;
}

function makeHarness(
  initialIds: readonly string[] = ['current-1', 'current-2'],
): Harness {
  TestBed.configureTestingModule({ imports: [PrependAnchorHostComponent] });
  const fixture = TestBed.createComponent(PrependAnchorHostComponent);
  fixture.componentInstance.messages.set(messages(...initialIds));
  fixture.detectChanges();
  const component = fixture.componentInstance;
  const root = component.root().nativeElement;

  let scrollTop = 0;
  const writes = jest.fn<void, [number]>((value) => {
    scrollTop = value;
  });
  Object.defineProperty(root, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: writes,
  });
  Object.defineProperty(root, 'scrollHeight', {
    configurable: true,
    value: 10_000,
  });
  root.getBoundingClientRect = () => rect(0, 200);
  installDynamicSlotGeometry(root);
  return { fixture, component, root, writes };
}

/** jsdom has no layout; each slot explicitly occupies 100 px in DOM order. */
function installDynamicSlotGeometry(root: HTMLElement): void {
  for (const slot of root.querySelectorAll<HTMLElement>(
    '[data-ptah-transcript-message-id]',
  )) {
    slot.getBoundingClientRect = () => {
      const slots = Array.from(
        root.querySelectorAll<HTMLElement>('[data-ptah-transcript-message-id]'),
      );
      return rect(slots.indexOf(slot) * 100, 100);
    };
  }
}

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 100,
    bottom: top + height,
    left: 0,
    width: 100,
    height,
    toJSON: () => ({}),
  };
}

describe('TranscriptPrependAnchorDirective', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('restores the anchor offset at scrollTop 0 with exactly one write', () => {
    const h = makeHarness();

    h.component.messages.set(
      messages('older-1', 'older-2', 'current-1', 'current-2'),
    );
    h.fixture.detectChanges();

    expect(h.writes).toHaveBeenCalledTimes(1);
    expect(h.writes).toHaveBeenCalledWith(200);
    expect(h.root.scrollTop).toBe(200);
  });

  it('leaves a non-zero scrollTop to native anchoring', () => {
    const h = makeHarness();
    h.root.scrollTop = 40;
    h.writes.mockClear();

    h.component.messages.set(messages('older', 'current-1', 'current-2'));
    h.fixture.detectChanges();

    expect(h.writes).not.toHaveBeenCalled();
  });

  it('does not treat initial empty-to-populated history as a prepend', () => {
    const h = makeHarness([]);

    h.component.messages.set(messages('current-1', 'current-2'));
    h.fixture.detectChanges();

    expect(h.writes).not.toHaveBeenCalled();
  });

  it.each([
    ['pinned', () => ({ pinnedToBottom: true })],
    ['replaying', () => ({ historyReplaying: true })],
    ['inactive', () => ({ active: false })],
  ])('does not write while %s', (_label, arrange) => {
    const h = makeHarness();
    const state = arrange();
    if (state.pinnedToBottom) h.component.pinnedToBottom.set(true);
    if (state.historyReplaying) h.component.historyReplaying.set(true);
    if (state.active === false) h.component.active.set(false);

    h.component.messages.set(messages('older', 'current-1', 'current-2'));
    h.fixture.detectChanges();

    expect(h.writes).not.toHaveBeenCalled();
  });

  it.each([
    ['append', ['current-1', 'current-2', 'new-tail'], null, null],
    ['replacement', ['replacement-1', 'replacement-2'], null, null],
    ['session switch', ['older', 'current-1', 'current-2'], 'session-2', null],
    ['tab switch', ['older', 'current-1', 'current-2'], null, 'tab-2'],
  ] as const)('does not write for a %s', (_label, ids, sessionId, tabId) => {
    const h = makeHarness();
    if (sessionId) h.component.sessionId.set(sessionId);
    if (tabId) h.component.tabId.set(tabId);
    h.component.messages.set(messages(...ids));
    h.fixture.detectChanges();

    expect(h.writes).not.toHaveBeenCalled();
  });

  it('does nothing when the captured anchor is absent after render', () => {
    const h = makeHarness();
    h.component.hiddenId.set('current-1');
    h.component.messages.set(messages('older', 'current-1', 'current-2'));
    h.fixture.detectChanges();

    expect(h.writes).not.toHaveBeenCalled();
  });

  it.each([
    ['non-positive', -100],
    ['larger than scrollHeight', 20_000],
  ])('rejects a %s anchor delta', (_label, restoredTop) => {
    const h = makeHarness();
    const anchor = h.root.querySelector<HTMLElement>(
      '[data-ptah-transcript-message-id="current-1"]',
    ) as HTMLElement;
    let measured = false;
    anchor.getBoundingClientRect = () => {
      if (!measured) {
        measured = true;
        return rect(0, 100);
      }
      return rect(restoredTop, 100);
    };

    h.component.messages.set(messages('older', 'current-1', 'current-2'));
    h.fixture.detectChanges();

    expect(h.writes).not.toHaveBeenCalled();
  });
});

function messages(
  ...ids: readonly string[]
): readonly { readonly id: string }[] {
  return ids.map((id) => ({ id }));
}
