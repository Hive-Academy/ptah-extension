import { ApplicationRef, ChangeDetectionStrategy, Component, NgModule, input, signal } from '@angular/core';

jest.mock('ngx-markdown', () => {
  // eslint-disable-next-line @angular-eslint/component-selector
  @Component({ selector: 'markdown', standalone: true, template: '' })
  class MarkdownStubComponent { readonly data = input<string | null>(''); }
  @NgModule({ imports: [MarkdownStubComponent], exports: [MarkdownStubComponent] })
  class MarkdownModule {}
  return {
    MarkdownModule, MarkdownComponent: MarkdownStubComponent, provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS', CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS', MERMAID_OPTIONS: 'MERMAID_OPTIONS', SANITIZE: 'SANITIZE',
  };
});

import { TestBed } from '@angular/core/testing';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { configureTranscriptTestBed } from './testing/transcript-spec-harness';

interface Tab {
  id: string;
  claudeSessionId: string;
  status: 'loaded';
  messages: readonly ExecutionChatMessage[];
  streamingState: null;
}

@Component({
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (id of ids; track id) {
      <ptah-chat-transcript [tabId]="id" [active]="selected() === id"
        [entering]="entering() === id" [historyReplaying]="replaying() === id" />
    }
  `,
})
class HostComponent {
  readonly ids = ['A', 'B'];
  readonly selected = signal('A');
  readonly entering = signal<string | null>(null);
  readonly replaying = signal<string | null>(null);
}

const messages = (prefix: string, count: number): ExecutionChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, role: 'assistant', rawContent: `reply ${index}`,
    timestamp: index + 1, streamingState: null,
  } as ExecutionChatMessage));

describe('ChatTranscriptComponent session entrance', () => {
  let rectSpy: jest.SpyInstance;
  const rect = (top: number, height: number) => DOMRectReadOnly.fromRect({ x: 0, y: top, width: 400, height });
  const tabs = signal<Tab[]>([]);
  const heightByTab = new Map<string, number>();
  const lastHeightByTab = new Map<string, number>();
  const viewportHeightByTab = new Map<string, number>();

  beforeEach(() => {
    tabs.set([
      { id: 'A', claudeSessionId: 'session-A', status: 'loaded', messages: messages('A', 10), streamingState: null },
      { id: 'B', claudeSessionId: 'session-B', status: 'loaded', messages: messages('B', 10), streamingState: null },
    ]);
    heightByTab.clear();
    lastHeightByTab.clear();
    viewportHeightByTab.clear();
    heightByTab.set('A', 100);
    heightByTab.set('B', 100);
    configureTranscriptTestBed({ tabs, buildTree: jest.fn(() => []) });
    TestBed.configureTestingModule({ imports: [HostComponent] });
    rectSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('.chat-scroll-container')) {
        const id = this.closest('[data-ptah-tab-id]')?.getAttribute('data-ptah-tab-id') ?? '';
        return rect(0, viewportHeightByTab.get(id) ?? 100);
      }
      if (this.matches('.chat-msg-slot')) {
        const id = this.getAttribute('data-ptah-transcript-message-id') ?? '';
        const [tabId, indexText] = id.split('-');
        const index = Number(indexText);
        const basic = heightByTab.get(tabId) ?? 100;
        const count = tabs().find(tab => tab.id === tabId)?.messages.length ?? 0;
        const height = index === count - 1 ? (lastHeightByTab.get(tabId) ?? basic) : basic;
        return rect(index * basic, height);
      }
      return rect(0, 0);
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
    TestBed.resetTestingModule();
  });

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    for (const id of ['A', 'B']) {
      const scroller = fixture.nativeElement.querySelector(`[data-ptah-tab-id="${id}"] .chat-scroll-container`) as HTMLElement;
      Object.defineProperties(scroller, {
        clientHeight: { configurable: true, get: () => viewportHeightByTab.get(id) ?? 100 },
        scrollHeight: { configurable: true, get: () => {
          const count = tabs().find(tab => tab.id === id)?.messages.length ?? 0;
          return Math.max(viewportHeightByTab.get(id) ?? 100, count * (heightByTab.get(id) ?? 100) +
            (lastHeightByTab.get(id) ?? heightByTab.get(id) ?? 100) - (heightByTab.get(id) ?? 100));
        } },
      });
    }
    const tick = () => { fixture.detectChanges(); TestBed.inject(ApplicationRef).tick(); };
    const slots = (id: string) => Array.from(
      fixture.nativeElement.querySelectorAll(`[data-ptah-tab-id="${id}"] .chat-msg-slot.ptah-turn-enter`) as NodeListOf<HTMLElement>,
    );
    const scroller = (id: string) => fixture.nativeElement.querySelector(`[data-ptah-tab-id="${id}"] .chat-scroll-container`) as HTMLElement;
    const enter = (id: string) => { fixture.componentInstance.selected.set(id); fixture.componentInstance.entering.set(id); tick(); };
    return { fixture, tick, slots, scroller, enter };
  }

  it('selects current B slots after hidden B received messages, in index order', () => {
    const h = setup();
    h.enter('B');
    h.fixture.componentInstance.entering.set(null); h.fixture.componentInstance.selected.set('A'); h.tick();
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: messages('B', 12) } : tab));
    h.enter('B');
    expect(h.slots('B').map(el => el.dataset['ptahTranscriptMessageId'])).toEqual(['B-11']);
    expect(h.slots('B').map(el => el.dataset['enterI'])).toEqual(['0']);
    expect(h.slots('B')[0].style.getPropertyValue('--i')).toBe('0');
  });

  it('projects the pending pinned restore so a tall last reply alone enters at zero', () => {
    lastHeightByTab.set('B', 400);
    const h = setup();
    expect(h.scroller('B').scrollTop).toBe(0);
    h.enter('B');
    expect(h.slots('B').map(el => el.dataset['ptahTranscriptMessageId'])).toEqual(['B-9']);
    expect(h.slots('B')[0].dataset['enterI']).toBe('0');
  });

  it('marks fewer than six visible slots in a long pinned thread', () => {
    heightByTab.set('B', 50);
    const h = setup(); h.enter('B');
    expect(h.slots('B').map(el => el.dataset['ptahTranscriptMessageId'])).toEqual(['B-8', 'B-9']);
    expect(h.slots('B').map(el => el.dataset['enterI'])).toEqual(['0', '1']);
  });

  it('caps a real long transcript at the newest six visible slots', () => {
    heightByTab.set('B', 40);
    viewportHeightByTab.set('B', 300);
    const h = setup(); h.enter('B');
    expect(h.slots('B').map(el => el.dataset['ptahTranscriptMessageId']))
      .toEqual(['B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'B-9']);
    expect(h.slots('B').map(el => el.dataset['enterI']))
      .toEqual(['0', '1', '2', '3', '4', '5']);
    expect(h.slots('B').every((el, i) => el.style.getPropertyValue('--i') === String(i))).toBe(true);
  });

  it('reuses retained multi-slot DOM on A to B and B to A', () => {
    for (const id of ['A', 'B']) {
      heightByTab.set(id, 40);
      viewportHeightByTab.set(id, 300);
    }
    const h = setup();
    h.enter('B');
    expect(h.slots('B').map(el => el.dataset['ptahTranscriptMessageId']))
      .toEqual(['B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'B-9']);
    h.fixture.componentInstance.entering.set(null); h.tick();
    h.enter('A');
    expect(h.slots('A').map(el => el.dataset['ptahTranscriptMessageId']))
      .toEqual(['A-4', 'A-5', 'A-6', 'A-7', 'A-8', 'A-9']);
  });

  it('does not write entrance marks during rect reads', () => {
    heightByTab.set('B', 40);
    viewportHeightByTab.set('B', 300);
    const h = setup();
    let slotReads = 0;
    const original = rectSpy.getMockImplementation();
    rectSpy.mockImplementation(function (this: HTMLElement) {
      if (this.matches('[data-ptah-tab-id="B"] .chat-msg-slot')) {
        slotReads++;
        const marked = h.fixture.nativeElement.querySelector('[data-ptah-tab-id="B"] .ptah-turn-enter, [data-ptah-tab-id="B"] [data-enter-i]');
        expect(marked).toBeNull();
      }
      return original?.call(this) ?? rect(0, 0);
    });
    h.enter('B');
    expect(slotReads).toBeGreaterThan(0);
    expect(h.slots('B')).toHaveLength(6);
  });

  it('bounds rect reads when every retained slot falls below the projected viewport', () => {
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: messages('B', 40) } : tab));
    const h = setup();
    const original = rectSpy.getMockImplementation();
    let slotReads = 0;
    rectSpy.mockImplementation(function (this: HTMLElement) {
      if (this.matches('[data-ptah-tab-id="B"] .chat-msg-slot')) {
        slotReads++;
        return rect(10000, 40);
      }
      return original?.call(this) ?? rect(0, 0);
    });
    h.enter('B');
    expect(h.slots('B')).toHaveLength(0);
    expect(slotReads).toBe(24);
  });

  it('does not animate history that arrives after an empty non-retained activation or replay', () => {
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: [] } : tab));
    const h = setup(); h.enter('B');
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: messages('B', 3) } : tab));
    h.tick();
    h.fixture.componentInstance.replaying.set('B'); h.tick();
    h.fixture.componentInstance.replaying.set(null); h.tick();
    expect(h.slots('B')).toHaveLength(0);
  });

  it('clears falling-edge marks and re-arms on rapid A to B to A', () => {
    const h = setup(); h.enter('B');
    const marked = h.slots('B');
    expect(marked).toHaveLength(1);
    h.fixture.componentInstance.entering.set(null); h.fixture.componentInstance.selected.set('A'); h.tick();
    expect(h.slots('B')).toHaveLength(0);
    expect(marked[0].hasAttribute('data-enter-i')).toBe(false);
    expect(marked[0].style.getPropertyValue('--i')).toBe('');
    h.fixture.componentInstance.entering.set('A'); h.tick();
    expect(h.slots('A')).toHaveLength(1);
  });

  it('uses a pane fade for a restored unpinned offset', () => {
    const h = setup();
    h.scroller('A').scrollTop = 800;
    h.scroller('A').dispatchEvent(new Event('scroll'));
    h.scroller('A').scrollTop = 300;
    h.scroller('A').dispatchEvent(new Event('scroll'));
    h.enter('B');
    h.fixture.componentInstance.entering.set(null); h.fixture.componentInstance.selected.set('A'); h.tick();
    h.fixture.componentInstance.entering.set('A'); h.tick();
    expect(h.scroller('A').classList.contains('ptah-pane-enter')).toBe(true);
    expect(h.slots('A')).toHaveLength(0);
  });

  it('never marks streaming or resync slots added after the snapshot', () => {
    const h = setup(); h.enter('B');
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: messages('B', 11) } : tab)); h.tick();
    expect(h.slots('B').some(el => el.dataset['ptahTranscriptMessageId'] === 'B-10')).toBe(false);
    tabs.set(tabs().map(tab => tab.id === 'B' ? { ...tab, messages: messages('B-new', 11) } : tab)); h.tick();
    expect(h.slots('B')).toHaveLength(0);
  });

  it('releases marked elements when destroyed during the entrance window', () => {
    const h = setup(); h.enter('B');
    const marked = h.slots('B');
    expect(() => h.fixture.destroy()).not.toThrow();
    expect(marked[0].classList.contains('ptah-turn-enter')).toBe(false);
    expect(marked[0].hasAttribute('data-enter-i')).toBe(false);
    expect(marked[0].style.getPropertyValue('--i')).toBe('');
  });
});
